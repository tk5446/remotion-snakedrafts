#!/usr/bin/env python3
"""
find_clips_json.py — Full clip pipeline (JSON mode, no Supabase)

For each movie in the input JSON:
  1. Search YouTube for scene compilations
  2. Fetch VTT transcripts, match quotes via fuzzywuzzy (partial_ratio >= 80)
  3. Auto-select best candidate by adjusted score
  4. (Optional) Download full video via yt-dlp, cut clip — only with --auto-download
  5. (Optional) Transcribe clip via OpenAI Whisper (after batch download)
  6. Write all results back to JSON, print full summary

**Default: candidates only (YouTube URLs + suggested in/out) — use Clip Review UI to
download clips, or re-run with --auto-download to batch clips locally (legacy / CI).

Usage:
    python scripts/find_clips_json.py actor.json
    python scripts/find_clips_json.py actor.json --auto-download  # also batch download + clip
    python scripts/find_clips_json.py actor.json --dry-run         # same as default (candidates only)
    python scripts/find_clips_json.py actor.json --overwrite     # redo even if a primary clip file exists
    python scripts/find_clips_json.py actor.json --no-transcribe  # skip Whisper (only with --auto-download)

Input JSON format:
    {
      "actor_slug": "adam-sandler",
      "actor_name": "Adam Sandler",
      "movies": [
        {
          "rank": 1,
          "movie_title": "Happy Gilmore",
          "year": 1996,
          "quotes": ["Just tap it in.", "You're gonna die, clown!"]
        }
      ]
    }

Env vars (loaded from .env):
    OPENAI_API_KEY  — required unless --no-transcribe
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

YT_DLP          = shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"
REPO_ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS_DIR       = os.path.join(REPO_ROOT, "public", "data", "clips")
TRANSCRIPTS_DIR = os.path.join(REPO_ROOT, "public", "data", "transcripts")

MAX_VIDEOS       = 8     # max videos to check per movie
MATCH_THRESHOLD  = 60    # fuzzywuzzy partial_ratio (0–100)
WINDOW_SEGMENTS  = 6     # VTT segments per sliding window
PREFER_SHORT_MAX = 300   # seconds — short video bonus threshold
SHORT_BONUS      = 5     # points added to adjusted_score for short videos
BUFFER_SECONDS   = 15    # pre-roll before matched window start
TAIL_SECONDS     = 15    # post-roll after matched window end
MAX_CLIP_DURATION = 90   # hard cap — prevents runaway long clips
MIN_CLIP_DURATION = 4    # floor — very short quips still get a clip

MAX_CLIPS_PER_QUOTE = 2  # max downloads per unique matched quote
MAX_CLIPS_PER_MOVIE = 5  # hard ceiling on total downloads per movie


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean_quote(quote: str) -> str:
    # Strip leading [Character] or (action) stage direction prefixes
    quote = re.sub(r"^\[.*?\]\s*", "", quote)
    quote = re.sub(r"^\(.*?\)\s*", "", quote)
    # Remove embedded stage directions anywhere in the string
    quote = re.sub(r"\[.*?\]", "", quote)
    quote = re.sub(r"\(.*?\)", "", quote)
    quote = re.sub(r"[^\w\s']", " ", quote)
    return quote.lower().strip()


# ---------------------------------------------------------------------------
# COMMENTED OUT — Jaccard bigram matching replaced by fuzzywuzzy
# (Jaccard produced poor match rates on YouTube auto-captions)
# ---------------------------------------------------------------------------
# def bigrams(text: str) -> set:
#     words = text.lower().split()
#     return set(zip(words, words[1:])) if len(words) >= 2 else set()
#
# def jaccard(a: set, b: set) -> float:
#     if not a or not b:
#         return 0.0
#     return len(a & b) / len(a | b)
#
# MIN_SCORE = 0.35
# score = jaccard(bigrams(clean), window_bigrams)
# ---------------------------------------------------------------------------

try:
    from fuzzywuzzy import fuzz  # type: ignore
except ImportError:
    print("ERROR: fuzzywuzzy not installed. Run: pip install fuzzywuzzy python-Levenshtein", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# YouTube search
# ---------------------------------------------------------------------------

def build_search_queries(actor: str, movie: str, quotes: list[str]) -> list[str]:
    queries = [
        f"Best Scenes {actor} {movie}",
        f"{actor} {movie} Best Moments",
        f"{actor} {movie} Top Scenes",
        f"{actor} {movie} Compilation",
    ]
    # All quotes — not just the top 3
    for q in quotes:
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
            parts = line.split("|")
            if len(parts) >= 3:
                vid_id, title, dur = parts[0], parts[1], parts[2]
                videos.append({
                    "id":       vid_id,
                    "title":    title,
                    "duration": int(dur) if dur.isdigit() else 0,
                    "url":      f"https://www.youtube.com/watch?v={vid_id}",
                })
        return videos
    except Exception as e:
        print(f"    [search error] {e}")
        return []


def filter_videos(videos: list[dict]) -> list[dict]:
    skip = {"trailer", "official trailer", "full movie", "reaction", "review", "explained"}
    filtered = [
        v for v in videos
        if not any(kw in v["title"].lower() for kw in skip)
        and 30 <= v["duration"] <= 3600
    ]
    return filtered or videos   # fall back to unfiltered if all get filtered out


def filter_titles_with_haiku(
    videos: list[dict], actor_name: str, movie_title: str
) -> list[dict]:
    """
    Ask Claude Haiku to classify which video titles are relevant to actor_name
    in movie_title. Returns only the relevant subset.
    Falls back to all videos if the API call fails.
    """
    if not videos:
        return videos

    try:
        from anthropic import Anthropic  # type: ignore
    except ImportError:
        print("  [haiku filter] anthropic not installed — skipping title filter")
        return videos

    client = Anthropic()
    numbered = "\n".join(f"{i + 1}. {v['title']}" for i, v in enumerate(videos))
    prompt = (
        f"Actor: {actor_name}\nMovie: {movie_title}\n\n"
        f"Which of these YouTube video titles are plausibly relevant "
        f"(scenes, quotes, clips, or compilations from this actor and/or movie)?\n\n"
        f"{numbered}\n\n"
        f"Reply with ONLY the relevant line numbers, comma-separated (e.g. 1,3,5). "
        f"If none are relevant reply with 'none'."
    )

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=64,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip().lower()
        if text == "none":
            print(f"  Haiku title filter: 0/{len(videos)} relevant — keeping all to avoid empty set")
            return videos  # never drop everything; fall back
        indices = {int(x.strip()) - 1 for x in text.split(",") if x.strip().isdigit()}
        relevant = [v for i, v in enumerate(videos) if i in indices]
        if not relevant:
            return videos  # safety: don't filter everything out
        print(f"  Haiku title filter: {len(relevant)}/{len(videos)} relevant")
        return relevant
    except Exception as e:
        print(f"  [haiku filter error] {e} — keeping all titles")
        return videos


# ---------------------------------------------------------------------------
# Transcripts (yt-dlp VTT)
# ---------------------------------------------------------------------------

def get_transcript(video_id: str) -> str | None:
    # Check any previously fetched VTT for this video
    for suffix in (f".en.vtt", f".en-US.vtt", f".en-GB.vtt"):
        path = f"/tmp/transcript_{video_id}{suffix}"
        if os.path.isfile(path):
            with open(path) as f:
                return f.read()

    # Fetch both manual subs (--write-subs) and auto-generated (--write-auto-subs).
    # Manual captions exist on many official movie clips that have no auto-caps.
    cmd = [
        YT_DLP,
        f"https://www.youtube.com/watch?v={video_id}",
        "--write-subs", "--write-auto-subs",
        "--sub-lang", "en.*",
        "--sub-format", "vtt",
        "--skip-download", "--output", f"/tmp/transcript_{video_id}",
        "--quiet", "--no-warnings",
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        for suffix in (f".en.vtt", f".en-US.vtt", f".en-GB.vtt"):
            path = f"/tmp/transcript_{video_id}{suffix}"
            if os.path.isfile(path):
                with open(path) as f:
                    return f.read()
    except Exception:
        pass
    return None


def parse_vtt(vtt_text: str) -> list[dict]:
    segments = []
    lines = vtt_text.split("\n")
    i = 0
    while i < len(lines):
        ts = re.match(
            r"(\d+):(\d+):(\d+)[\.,]\d+\s+-->\s+(\d+):(\d+):(\d+)",
            lines[i].strip(),
        )
        if ts:
            h, m, s   = int(ts.group(1)), int(ts.group(2)), int(ts.group(3))
            eh, em, es = int(ts.group(4)), int(ts.group(5)), int(ts.group(6))
            start = h * 3600 + m * 60 + s
            end   = eh * 3600 + em * 60 + es
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip() and "-->" not in lines[i]:
                text_lines.append(lines[i].strip())
                i += 1
            text = re.sub(r"<[^>]+>", "", " ".join(text_lines)).strip()
            if text:
                segments.append({"start_seconds": start, "end_seconds": end, "text": text})
        else:
            i += 1
    return segments


# ---------------------------------------------------------------------------
# Quote matching (fuzzywuzzy)
# ---------------------------------------------------------------------------

def all_matches_in_transcript(segments: list[dict], quotes: list[str]) -> list[dict]:
    cleaned_quotes = [
        (clean_quote(q), q)
        for q in quotes
        if len(clean_quote(q).split()) >= 3
    ]

    best_by_start: dict[int, dict] = {}

    for i in range(len(segments)):
        window_segs = segments[i: i + WINDOW_SEGMENTS]
        window_text = " ".join(seg["text"] for seg in window_segs)
        window_clean = re.sub(r"[^\w\s']", " ", window_text).lower()

        for clean, original in cleaned_quotes:
            # fuzz.partial_ratio needs the quote to be the *shorter* string.
            # Take the first sentence (up to . ! ?) capped at 120 chars.
            # Wikiquote quotes can be 200+ words; a VTT window is ~50–80 words.
            first = re.split(r"[.!?]", clean)[0].strip()
            match_str = (first if len(first.split()) >= 3 else clean)[:120]
            score = fuzz.partial_ratio(match_str, window_clean)  # 0–100
            if score >= MATCH_THRESHOLD:
                start      = segments[i]["start_seconds"]
                last_seg   = window_segs[-1]
                window_end = last_seg.get("end_seconds", last_seg["start_seconds"] + 3)
                if start not in best_by_start or score > best_by_start[start]["score"]:
                    best_by_start[start] = {
                        "score":              score,
                        "start_seconds":      start,
                        "window_end_seconds": window_end,
                        "quote":              original,
                        "matched_text":       window_text[:120],
                    }

    return list(best_by_start.values())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def seconds_to_mss(total_seconds: int) -> str:
    m = total_seconds // 60
    s = total_seconds % 60
    return f"{m}:{s:02d}"


def make_clip_filename(actor_slug: str, rank: int) -> str:
    base = actor_slug.upper().replace("-", "_")
    return f"{base}_{rank}.mp4"


# ---------------------------------------------------------------------------
# Download + clip (yt-dlp → ffmpeg)
# ---------------------------------------------------------------------------

def download_video(yt_url: str, tmp_dir: str) -> str | None:
    tmp_base = os.path.join(tmp_dir, "video")
    cmd = [
        YT_DLP, "--no-warnings", "--quiet",
        "-f", "bestvideo[height>=1080]+bestaudio/bestvideo[height>=720]+bestaudio/bestvideo+bestaudio/best",
        "--merge-output-format", "mkv",
        "-o", tmp_base + ".%(ext)s",
        yt_url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            return None
        for ext in ("mkv", "mp4", "webm"):
            candidate = f"{tmp_base}.{ext}"
            if os.path.isfile(candidate):
                return candidate
        return None
    except (subprocess.TimeoutExpired, Exception):
        return None


def cut_clip(input_path: str, output_path: str, start_seconds: int, duration: int) -> bool:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_seconds),
        "-i", input_path,
        "-t", str(duration),
        "-c:v", "libx264",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, Exception):
        return False


# ---------------------------------------------------------------------------
# Transcription (OpenAI Whisper)
# ---------------------------------------------------------------------------

def transcribe_clip(clip_path: str) -> list[dict] | None:
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        print("  [transcribe] openai package not installed — skipping transcription", file=sys.stderr)
        return None

    client = OpenAI()
    try:
        with open(clip_path, "rb") as f:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word"],
            )
        words = getattr(response, "words", None) or []
        return [
            {
                "text":        getattr(w, "word", getattr(w, "text", "")).strip(),
                "startMs":     round(getattr(w, "start", 0.0) * 1000),
                "endMs":       round(getattr(w, "end", 0.0) * 1000),
                "timestampMs": None,
                "confidence":  None,
            }
            for w in words
        ]
    except Exception as e:
        print(f"  [transcribe error] {e}", file=sys.stderr)
        return None


def run_transcription(actor_slug: str, clipped_movies: list[dict]) -> dict[str, int]:
    """Transcribe all newly clipped movies. Returns {filename: word_count}."""
    transcript_path = os.path.join(TRANSCRIPTS_DIR, f"{actor_slug}-transcription.json")

    index: dict = {}
    if os.path.isfile(transcript_path):
        try:
            with open(transcript_path) as f:
                index = json.load(f)
        except json.JSONDecodeError:
            index = {}

    results: dict[str, int] = {}

    for movie in clipped_movies:
        # Transcribe every version, not just the primary clip
        all_clips = movie.get("all_clips") or []
        if not all_clips and movie.get("clipped_video"):
            all_clips = [movie["clipped_video"]]

        for clip_filename in all_clips:
            if clip_filename in index:
                results[clip_filename] = len(index[clip_filename])
                continue

            clip_path = os.path.join(CLIPS_DIR, clip_filename)
            if not os.path.isfile(clip_path):
                continue

            captions = transcribe_clip(clip_path)
            if captions is not None:
                index[clip_filename] = captions
                results[clip_filename] = len(captions)

    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    with open(transcript_path, "w") as f:
        json.dump(index, f, indent=2)

    return results


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------

def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------------------
# Per-movie processing
# ---------------------------------------------------------------------------

def process_movie(
    movie: dict,
    actor_slug: str,
    actor_name: str,
    clips_dir: str,
    auto_download: bool,
    overwrite: bool,
    max_quotes: int | None = None,
) -> dict:
    """
    Find (and optionally batch-download) clips for one movie.
    If auto_download is False, writes candidates with clip_status "pending" only.
    Returns a result dict for the final summary.
    """
    rank        = movie.get("rank", 0)
    title       = movie.get("movie_title", "")
    year        = movie.get("year", "")
    quotes      = movie.get("quotes", [])
    if max_quotes:
        quotes = quotes[:max_quotes]
    year_str    = f" ({year})" if year else ""

    print(f"\n  {'─'*56}")
    print(f"  #{rank}  {title}{year_str}")

    clip_filename = make_clip_filename(actor_slug, rank)
    clip_path     = os.path.join(clips_dir, clip_filename)

    base_result = {"rank": rank, "movie_title": title, "output_file": clip_filename}

    # Skip already-clipped unless --overwrite
    if not overwrite and os.path.isfile(clip_path):
        print(f"  Already clipped: {clip_filename} — skipping (use --overwrite to redo)")
        movie["clipped_video"] = clip_filename
        return {**base_result, "status": "skipped"}

    if not quotes:
        print("  No quotes — skipping.")
        return {**base_result, "status": "not_found", "reason": "no quotes provided"}

    # -----------------------------------------------------------------------
    # Step 1: Build search queries and collect videos
    # (Each search is a separate yt-dlp subprocess, often 2–30s; no output until
    #  this loop finishes, which is why the script can look "stuck" after the
    #  movie title — it is not hung, it is just waiting on search 1, 2, 3, …)
    # -----------------------------------------------------------------------
    queries   = build_search_queries(actor_name, title, quotes)
    nq = len(queries)
    print(f"  YouTube: {nq} search queries (sequential yt-dlp — can take several minutes)…", flush=True)
    seen_ids: set = set()
    all_videos: list[dict] = []
    for i, q in enumerate(queries, 1):
        q_preview = f"{q[:70]}…" if len(q) > 70 else q
        print(f"    [{i}/{nq}] {q_preview}", flush=True)
        for v in search_youtube(q):
            if v["id"] not in seen_ids:
                seen_ids.add(v["id"])
                all_videos.append(v)

    videos = filter_videos(all_videos)   # no cap — check everything
    if videos:
        print("  Relevance: filtering video titles with Claude Haiku…", flush=True)
    videos = filter_titles_with_haiku(videos, actor_name, title)
    print(f"  {len(videos)} video(s) to check  ({len(queries)} queries, {len(all_videos)} raw)")

    # -----------------------------------------------------------------------
    # Step 2: Fetch transcripts and match quotes
    # -----------------------------------------------------------------------
    candidates: list[dict] = []

    for v in videos:
        label = f"    · {v['title'][:52]}  ({v['duration']}s)"
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
            best       = max(hits, key=lambda h: h["score"])
            bonus      = SHORT_BONUS if v["duration"] <= PREFER_SHORT_MAX else 0
            adj        = min(100, best["score"] + bonus)
            clip_start = max(0, best["start_seconds"] - BUFFER_SECONDS)
            clip_end   = best.get("window_end_seconds", best["start_seconds"] + 10) + TAIL_SECONDS
            duration   = max(MIN_CLIP_DURATION, min(MAX_CLIP_DURATION, clip_end - clip_start))
            print(f" — match {best['score']}{f' +{bonus}' if bonus else ''} → {adj}  ({duration}s)")

            candidates.append({
                "yt_url":              v["url"],
                "yt_video_id":         v["id"],
                "yt_title":            v["title"],
                "yt_duration_seconds": v["duration"],
                "score":               best["score"],
                "adjusted_score":      adj,
                "start_seconds":       clip_start,
                "start_time":          seconds_to_mss(clip_start),
                "duration":            duration,
                "matched_quote":       best["quote"],
                "matched_text":        best["matched_text"],
            })
        else:
            print(" — no match")

    # -----------------------------------------------------------------------
    # Step 2b: Title-match fallback for no-transcript videos
    # When a video has no captions at all but its title fuzzy-matches one of
    # our quotes, it's likely the right clip. Clip starting 20s in (skip
    # YouTube intros) with the standard buffer on each side.
    # Only runs when the transcript pass found zero candidates.
    # -----------------------------------------------------------------------
    if not candidates:
        no_transcript = [v for v in videos if not get_transcript(v["id"])]
        for v in no_transcript:
            title_clean = re.sub(r"[^\w\s']", " ", v["title"]).lower()
            best_score  = 0
            best_quote  = ""
            for q in quotes:
                qs = clean_quote(q)[:80]
                if qs:
                    s = fuzz.partial_ratio(qs, title_clean)
                    if s > best_score:
                        best_score, best_quote = s, q
            if best_score >= 70:
                bonus      = SHORT_BONUS if v["duration"] <= PREFER_SHORT_MAX else 0
                adj        = min(100, best_score + bonus)
                clip_start = 20  # skip YouTube intro
                duration   = min(MAX_CLIP_DURATION, BUFFER_SECONDS + 30 + TAIL_SECONDS)
                print(f"    · {v['title'][:52]}  ({v['duration']}s) — title match {best_score} → {adj}  ({duration}s)")
                candidates.append({
                    "yt_url":              v["url"],
                    "yt_video_id":         v["id"],
                    "yt_title":            v["title"],
                    "yt_duration_seconds": v["duration"],
                    "score":               best_score,
                    "adjusted_score":      adj,
                    "start_seconds":       clip_start,
                    "start_time":          seconds_to_mss(clip_start),
                    "duration":            duration,
                    "matched_quote":       best_quote,
                    "matched_text":        f"[title match] {v['title']}",
                    "match_method":        "title",
                })

    # Save candidates; mark as pending until downloaded (Clip Review or --auto-download)
    candidates.sort(key=lambda c: c["adjusted_score"], reverse=True)
    for c in candidates:
        c["clip_status"] = "pending"
    movie["candidates"] = candidates

    if not candidates:
        print("  NOT FOUND — no match above threshold across all videos")
        return {**base_result, "status": "not_found", "reason": f"no match ≥ {MATCH_THRESHOLD} across {len(videos)} videos"}

    top = candidates[0]
    print(f"  Best: [{top['adjusted_score']}] {top['yt_title'][:50]}  @ {top['start_time']}")
    print(f"        Quote:   {top['matched_quote'][:70]}")
    print(f"        Matched: {top['matched_text'][:70]}")

    if not auto_download:
        print("  [candidates only — use Clip Review to download, or: --auto-download]")
        return {
            **base_result,
            "status":        "candidates_only",
            "candidate_count": len(candidates),
            **top,
        }

    # -----------------------------------------------------------------------
    # Step 3: Download and clip — capped per quote and per movie.
    # Build a download_queue (subset of candidates) so we don't spam downloads:
    #   - max MAX_CLIPS_PER_QUOTE attempts per unique matched quote
    #   - max MAX_CLIPS_PER_MOVIE total across all quotes
    # movie["candidates"] still holds the full ranked list for the UI.
    # -----------------------------------------------------------------------
    quote_counts: dict[str, int] = {}
    download_queue: list[dict] = []
    for cand in candidates:
        q = cand["matched_quote"]
        if quote_counts.get(q, 0) < MAX_CLIPS_PER_QUOTE and len(download_queue) < MAX_CLIPS_PER_MOVIE:
            download_queue.append(cand)
            quote_counts[q] = quote_counts.get(q, 0) + 1
    print(f"  Download queue: {len(download_queue)}/{len(candidates)} candidates "
          f"(cap: {MAX_CLIPS_PER_QUOTE}/quote, {MAX_CLIPS_PER_MOVIE}/movie)")

    os.makedirs(clips_dir, exist_ok=True)

    base_stem       = clip_filename.replace(".mp4", "")   # e.g. ADAM_SANDLER_1
    successful_clips: list[dict] = []

    for i, cand in enumerate(download_queue):
        version      = "" if i == 0 else f"_v{i + 1}"
        out_filename = f"{base_stem}{version}.mp4"
        out_path     = os.path.join(clips_dir, out_filename)
        label        = f"    [{i+1}/{len(download_queue)}] [{cand['adjusted_score']}] {cand['yt_title'][:42]}"

        if not overwrite and os.path.isfile(out_path):
            print(f"{label}  already exists → {out_filename}")
            cand["clip_status"]   = "exists"
            cand["clip_filename"] = out_filename
            successful_clips.append(cand)
            continue

        with tempfile.TemporaryDirectory(prefix="find_clips_", dir="/tmp") as tmp_dir:
            print(f"{label}  downloading…", end="", flush=True)
            tmp_path = download_video(cand["yt_url"], tmp_dir)
            if not tmp_path:
                print(f"\r{label}  FAILED (download)                    ")
                cand["clip_status"] = "download_failed"
                continue

            print(f"\r{label}  clipping…    ", end="", flush=True)
            if not cut_clip(tmp_path, out_path, cand["start_seconds"], cand["duration"]):
                print(f"\r{label}  FAILED (ffmpeg)                      ")
                cand["clip_status"] = "ffmpeg_failed"
                continue

            print(f"\r{label}  done → {out_filename}          ")
            cand["clip_status"]   = "success"
            cand["clip_filename"] = out_filename
            successful_clips.append(cand)

    if not successful_clips:
        return {**base_result, "status": "error", "reason": f"all {len(download_queue)} queued candidates failed"}

    # Highest-scoring successful clip becomes the primary (clipped_video)
    best = successful_clips[0]
    movie["yt_url"]        = best["yt_url"]
    movie["start_time"]    = best["start_time"]
    movie["duration"]      = best["duration"]
    movie["clipped_video"] = best["clip_filename"]
    movie["all_clips"]     = [c["clip_filename"] for c in successful_clips]

    return {
        **base_result,
        "status":          "success",
        "clips_made":      len(successful_clips),
        "clips_attempted": len(download_queue),
        "all_clips":       movie["all_clips"],
        "yt_title":        best["yt_title"],
        "score":           best["score"],
        "adjusted_score":  best["adjusted_score"],
        "matched_quote":   best["matched_quote"],
        "matched_text":    best["matched_text"],
        "start_time":      best["start_time"],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find YouTube candidates for each movie (default). Use --auto-download to batch download clips on disk (legacy/CI)."
    )
    parser.add_argument("json_file",       help="Path to actor JSON file")
    parser.add_argument(
        "--auto-download",
        action="store_true",
        help="After matching, batch-download and clip to public/data/clips/ (capped). Default is candidates + pending only.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Same as default: find candidates only (implies no --auto-download).",
    )
    parser.add_argument("--overwrite",     action="store_true", help="Re-process movies that already have a clip")
    parser.add_argument("--no-transcribe", action="store_true", help="Skip Whisper transcription step")
    parser.add_argument("--movies",        type=int, default=None, help="Process only the first N movies (by rank)")
    parser.add_argument("--quotes",        type=int, default=None, help="Use only the first N quotes per movie")
    args = parser.parse_args()

    do_batch_download = bool(args.auto_download) and not args.dry_run

    if not os.path.isfile(args.json_file):
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)

    data = load_json(args.json_file)

    if not isinstance(data, dict) or "movies" not in data:
        print("ERROR: JSON must be an object with a 'movies' array", file=sys.stderr)
        sys.exit(1)

    actor_slug = data.get("actor_slug", "unknown")
    actor_name = data.get("actor_name", actor_slug)
    movies     = sorted(data.get("movies", []), key=lambda m: m.get("rank", 999))

    if args.movies:
        movies = movies[:args.movies]

    if not movies:
        print("ERROR: 'movies' array is empty", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  find_clips_json  —  {actor_name}")
    if do_batch_download:
        mode = "BATCH DOWNLOAD" + ("  |  overwrite" if args.overwrite else "")
    else:
        mode = "candidates only (use Clip Review to download, or --auto-download)"
    print(f"  {len(movies)} movie(s)   mode: {mode}")
    print(f"{'='*60}")

    t_start  = time.time()
    results  = []

    for movie in movies:
        result = process_movie(
            movie, actor_slug, actor_name, CLIPS_DIR,
            auto_download=do_batch_download, overwrite=args.overwrite,
            max_quotes=args.quotes,
        )
        results.append(result)
        save_json(args.json_file, data)   # save after every movie (crash-safe)

    # -----------------------------------------------------------------------
    # Transcription
    # -----------------------------------------------------------------------
    transcript_results: dict[str, int] = {}
    if do_batch_download and not args.no_transcribe:
        if not os.getenv("OPENAI_API_KEY"):
            print("\n  [transcribe] OPENAI_API_KEY not set — skipping transcription")
        else:
            clipped = [m for m in movies if m.get("clipped_video")]
            if clipped:
                print(f"\n  Transcribing {len(clipped)} clip(s)…")
                transcript_results = run_transcription(actor_slug, clipped)

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    elapsed = time.time() - t_start
    mins, secs = divmod(int(elapsed), 60)

    n_success   = sum(1 for r in results if r["status"] == "success")
    n_skipped   = sum(1 for r in results if r["status"] == "skipped")
    n_candidate_only = sum(1 for r in results if r["status"] == "candidates_only")
    n_not_found = sum(1 for r in results if r["status"] == "not_found")
    n_error     = sum(1 for r in results if r["status"] == "error")

    print(f"\n{'='*60}")
    print(f"  RESULTS — {actor_name}")
    print(f"{'='*60}\n")

    for r in results:
        status = r["status"]
        title  = r["movie_title"]
        rank   = r["rank"]

        if status == "success":
            score_str  = f"{r.get('score', '?')} → {r.get('adjusted_score', '?')}"
            clips_made = r.get("clips_made", 1)
            attempted  = r.get("clips_attempted", 1)
            print(f"  #{rank}  {title}")
            print(f"      Status:  {clips_made}/{attempted} clipped  ✓")
            print(f"      Primary: {r['output_file']}")
            for cf in r.get("all_clips", [])[1:]:
                print(f"      Alt:     {cf}")
            print(f"      Video:   {r.get('yt_title', '')[:55]}")
            print(f"      Score:   {score_str}")
            print(f"      Quote:   {r.get('matched_quote', '')[:65]}")
            print(f"      Matched: {r.get('matched_text', '')[:65]}")
            print(f"      Start:   {r.get('start_time', '')}")
            for cf in r.get("all_clips", [r["output_file"]]):
                wc = transcript_results.get(cf)
                if wc is not None:
                    print(f"      Caption: {cf}  ({wc} words)")

        elif status == "skipped":
            print(f"  #{rank}  {title}")
            print(f"      Status:  skipped (already clipped)")

        elif status == "candidates_only":
            score_str = f"{r.get('score', '?')} → {r.get('adjusted_score', '?')}"
            print(f"  #{rank}  {title}")
            n_c = r.get("candidate_count", "?")
            print(f"      Status:  {n_c} candidate(s) — open Clip Review to preview & download")
            print(f"      Video:   {r.get('yt_title', '')[:55]}")
            print(f"      Score:   {score_str}")
            print(f"      Quote:   {r.get('matched_quote', '')[:65]}")
            print(f"      Matched: {r.get('matched_text', '')[:65]}")

        elif status == "not_found":
            print(f"  #{rank}  {title}")
            print(f"      Status:  NOT FOUND — {r.get('reason', '')}")

        elif status == "error":
            print(f"  #{rank}  {title}")
            print(f"      Status:  ERROR — {r.get('reason', '')}")

        print()

    print(f"  {'─'*50}")
    parts = []
    if n_success:   parts.append(f"{n_success} clipped")
    if n_skipped:   parts.append(f"{n_skipped} skipped")
    if n_candidate_only: parts.append(f"{n_candidate_only} candidates only (use Clip Review)")
    if n_not_found: parts.append(f"{n_not_found} not found")
    if n_error:     parts.append(f"{n_error} error")
    print(f"  {',  '.join(parts)}   —   {mins}m {secs:02d}s")
    print(f"  Clips:       {CLIPS_DIR}")
    if transcript_results:
        print(f"  Transcripts: {TRANSCRIPTS_DIR}/{actor_slug}-transcription.json")
    print(f"  JSON:        {os.path.abspath(args.json_file)}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
