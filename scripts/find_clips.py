#!/usr/bin/env python3
"""
find_clips.py  — Pipeline Phase 2

Reads ranked quotes from Supabase for an actor, searches YouTube,
and writes ALL candidates above MIN_SCORE to video_clip_candidates.

Must run get_quotes.py first, then rank quotes in the admin UI.

Usage:
    python scripts/find_clips.py <actor-slug>
    python scripts/find_clips.py <actor-slug> --dry-run
    python scripts/find_clips.py <actor-slug> --overwrite

Env vars required:
    SUPABASE_URL
    SUPABASE_ANON_KEY
"""

import argparse
import os
import re
import subprocess
import sys

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from supabase_client import get_client

YT_DLP = "/opt/homebrew/bin/yt-dlp"
MAX_VIDEOS      = 8
MIN_SCORE       = 0.35
WINDOW_SEGMENTS = 6
PREFER_SHORT_MAX = 300
CLIP_DURATION   = 10
BUFFER_SECONDS  = 2


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean_quote(quote: str) -> str:
    quote = re.sub(r"^\[.*?\]\s*", "", quote)
    quote = re.sub(r"[^\w\s']", " ", quote)
    return quote.lower().strip()


def bigrams(text: str) -> set:
    words = text.lower().split()
    return set(zip(words, words[1:])) if len(words) >= 2 else set()


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# ---------------------------------------------------------------------------
# YouTube search
# ---------------------------------------------------------------------------

def build_search_queries(actor: str, movie: str, quotes: list[str]) -> list[str]:
    queries = [
        f"Best Scenes {actor} {movie}",
        f"{actor} {movie} Best Moments",
        f"{actor} {movie} scene clip",
        f"{actor} {movie} funny scene",
    ]
    for q in quotes[:3]:
        cleaned = clean_quote(q)[:60].strip()
        if cleaned:
            queries.append(f"{movie} {cleaned}")
    return queries


def search_youtube(query: str, max_results: int = MAX_VIDEOS) -> list[dict]:
    cmd = [
        YT_DLP,
        f"ytsearch{max_results}:{query}",
        "--print", "%(id)s|%(title)s|%(duration)s",
        "--no-playlist", "--quiet", "--no-warnings",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        videos = []
        for line in result.stdout.strip().splitlines():
            if not line:
                continue
            parts = line.split("|")
            if len(parts) >= 3:
                vid_id, title, dur = parts[0], parts[1], parts[2]
                videos.append({
                    "id": vid_id,
                    "title": title,
                    "duration": int(dur) if dur.isdigit() else 0,
                    "url": f"https://www.youtube.com/watch?v={vid_id}",
                })
        return videos
    except Exception as e:
        print(f"    [yt-dlp search error] {e}")
        return []


def filter_videos(videos: list[dict]) -> list[dict]:
    skip = {"trailer", "official trailer", "full movie", "reaction", "review", "explained"}
    filtered = [
        v for v in videos
        if not any(kw in v["title"].lower() for kw in skip)
        and 30 <= v["duration"] <= 3600
    ]
    return filtered or videos


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------

def get_transcript(video_id: str) -> str | None:
    vtt_path = f"/tmp/transcript_{video_id}.en.vtt"
    if os.path.isfile(vtt_path):
        with open(vtt_path) as f:
            return f.read()
    cmd = [
        YT_DLP,
        f"https://www.youtube.com/watch?v={video_id}",
        "--write-auto-subs", "--sub-lang", "en", "--sub-format", "vtt",
        "--skip-download", "--output", f"/tmp/transcript_{video_id}",
        "--quiet", "--no-warnings",
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if os.path.isfile(vtt_path):
            with open(vtt_path) as f:
                return f.read()
    except Exception:
        pass
    return None


def parse_vtt(vtt_text: str) -> list[dict]:
    segments = []
    lines = vtt_text.split("\n")
    i = 0
    while i < len(lines):
        ts = re.match(r"(\d+):(\d+):(\d+)[\.,]\d+\s+-->\s+\d+:\d+:\d+", lines[i].strip())
        if ts:
            h, m, s = int(ts.group(1)), int(ts.group(2)), int(ts.group(3))
            start = h * 3600 + m * 60 + s
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip() and "-->" not in lines[i]:
                text_lines.append(lines[i].strip())
                i += 1
            text = re.sub(r"<[^>]+>", "", " ".join(text_lines)).strip()
            if text:
                segments.append({"start_seconds": start, "text": text})
        else:
            i += 1
    return segments


# ---------------------------------------------------------------------------
# Matching — returns ALL hits above MIN_SCORE, not just the best
# ---------------------------------------------------------------------------

def all_matches_in_transcript(segments: list[dict], quotes: list[str]) -> list[dict]:
    cleaned_quotes = [
        (clean_quote(q), q)
        for q in quotes
        if len(clean_quote(q).split()) >= 3
    ]

    # Collect best score per unique start_seconds to avoid duplicates
    best_by_start: dict[int, dict] = {}

    for i in range(len(segments)):
        window_text = " ".join(seg["text"] for seg in segments[i: i + WINDOW_SEGMENTS])
        window_clean = re.sub(r"[^\w\s']", " ", window_text).lower()
        window_bigrams = bigrams(window_clean)

        for clean, original in cleaned_quotes:
            score = jaccard(bigrams(clean), window_bigrams)
            if score >= MIN_SCORE:
                start = segments[i]["start_seconds"]
                if start not in best_by_start or score > best_by_start[start]["score"]:
                    best_by_start[start] = {
                        "score": score,
                        "start_seconds": start,
                        "quote": original,
                        "matched_text": window_text[:120],
                    }

    return list(best_by_start.values())


def seconds_to_mss(total_seconds: int) -> str:
    m = total_seconds // 60
    s = total_seconds % 60
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# Per-movie processing
# ---------------------------------------------------------------------------

def process_movie(movie: dict, quotes: list[str], supa, dry_run: bool, overwrite: bool):
    movie_id    = movie["id"]
    actor_name  = movie.get("actor_name", "")
    movie_title = movie.get("movie_title", "")
    year        = movie.get("year", 0)
    rank        = movie.get("rank", 0)

    print(f"\n  {'─'*56}")
    print(f"  #{rank}  {movie_title} ({year})")

    if not quotes:
        print("  No ranked quotes — skipping. Rank quotes in the admin UI first.")
        return

    # Check existing candidates
    if not overwrite:
        existing = supa.table("video_clip_candidates").select("id").eq("movie_id", movie_id).neq("status", "dismissed").execute()
        if existing.data:
            print(f"  {len(existing.data)} candidates already exist — skipping (use --overwrite to redo)")
            return

    print(f"  {len(quotes)} ranked quotes")
    for q in quotes[:3]:
        print(f"    · {q[:80]}")

    # Search YouTube
    queries = build_search_queries(actor_name, movie_title, quotes)
    seen_ids: set = set()
    all_videos = []
    for q in queries:
        for v in search_youtube(q):
            if v["id"] not in seen_ids:
                seen_ids.add(v["id"])
                all_videos.append(v)

    videos = filter_videos(all_videos)[:MAX_VIDEOS]
    print(f"  Checking {len(videos)} video(s)…  ({len(queries)} queries, {len(all_videos)} raw candidates)")

    # Fetch transcripts and collect all matches above MIN_SCORE
    all_candidates = []

    for v in videos:
        label = f"    · {v['title'][:55]}  ({v['duration']}s)"
        print(label, end="", flush=True)

        vtt = get_transcript(v["id"])
        if not vtt:
            print(" — no transcript")
            continue

        segments = parse_vtt(vtt)
        if not segments:
            print(" — empty transcript")
            continue

        hits = all_matches_in_transcript(segments, quotes)
        if hits:
            bonus = 0.05 if v["duration"] <= PREFER_SHORT_MAX else 0.0
            best_hit = max(hits, key=lambda h: h["score"])
            adjusted = round(best_hit["score"] + bonus, 3)
            print(f" — {len(hits)} match(es), best {best_hit['score']:.3f}{f' +{bonus} short bonus' if bonus else ''}")

            # Use best hit per video as the candidate
            raw_start = max(0, best_hit["start_seconds"] - BUFFER_SECONDS)
            all_candidates.append({
                "movie_id":            movie_id,
                "yt_url":              v["url"],
                "yt_video_id":         v["id"],
                "yt_title":            v["title"],
                "yt_duration_seconds": v["duration"],
                "score":               round(best_hit["score"], 4),
                "adjusted_score":      adjusted,
                "start_seconds":       raw_start,
                "start_time":          seconds_to_mss(raw_start),
                "duration":            CLIP_DURATION,
                "matched_quote":       best_hit["quote"],
                "matched_text":        best_hit["matched_text"],
                "status":              "pending",
            })
        else:
            print(" — no match")

    if not all_candidates:
        print("  No candidates found.")
        return

    # Sort by adjusted_score descending for display
    all_candidates.sort(key=lambda c: c["adjusted_score"], reverse=True)
    print(f"\n  {len(all_candidates)} candidate(s) found:")
    for c in all_candidates:
        print(f"    [{c['adjusted_score']:.3f}] {c['yt_title'][:55]}  @ {c['start_time']}")

    if dry_run:
        print("  [dry-run] not writing to Supabase.")
        return

    # Clear old candidates if overwriting
    if overwrite:
        supa.table("video_clip_candidates").delete().eq("movie_id", movie_id).execute()

    # Upsert candidates (unique on movie_id + yt_video_id)
    supa.table("video_clip_candidates").upsert(
        all_candidates, on_conflict="movie_id,yt_video_id"
    ).execute()
    print(f"  Written {len(all_candidates)} candidate(s) to Supabase.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Search YouTube for clip candidates using ranked quotes from Supabase.")
    parser.add_argument("actor_slug", help="Actor slug, e.g. adam-sandler")
    parser.add_argument("--dry-run",  action="store_true", help="Find matches but don't write to Supabase")
    parser.add_argument("--overwrite", action="store_true", help="Clear existing candidates and re-search")
    args = parser.parse_args()

    supa = get_client()

    # Look up actor
    actor_res = supa.table("video_actors").select("*").eq("slug", args.actor_slug).execute()
    if not actor_res.data:
        print(f"ERROR: actor '{args.actor_slug}' not found in Supabase. Run get_quotes.py first.", file=sys.stderr)
        sys.exit(1)
    actor = actor_res.data[0]

    print(f"\n{'='*60}")
    print(f"  find_clips  —  {actor['name']}")
    print(f"{'='*60}")

    # Load movies for this actor
    movies_res = supa.table("video_movies").select("*").eq("actor_id", actor["id"]).order("rank").execute()
    movies = movies_res.data

    if not movies:
        print("ERROR: no movies found. Run get_quotes.py first.", file=sys.stderr)
        sys.exit(1)

    for movie in movies:
        # Load ranked quotes ordered by user_rank (1 first), then unranked, skip dismissed (0)
        quotes_res = (
            supa.table("video_quotes")
            .select("text, user_rank")
            .eq("movie_id", movie["id"])
            .neq("user_rank", 0)   # exclude dismissed
            .order("user_rank", desc=False)
            .execute()
        )
        # user_rank null (unranked) comes after ranked ones
        ranked   = [q["text"] for q in quotes_res.data if q["user_rank"] is not None]
        unranked = [q["text"] for q in quotes_res.data if q["user_rank"] is None]
        quotes   = ranked + unranked

        process_movie(movie, quotes, supa, dry_run=args.dry_run, overwrite=args.overwrite)

    print(f"\n{'='*60}")
    print("  Done. Open the admin UI to review candidates.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
