#!/usr/bin/env python3
"""
make_clips.py  — Pipeline Phase 3

Reads approved clip candidates from Supabase, downloads the YouTube
videos, cuts clips at the approved timestamps via ffmpeg, and writes
clipped_video back to video_movies.

Only processes the top 5 movies by video_rank.

Usage:
    python scripts/make_clips.py <actor-slug>

Env vars required:
    SUPABASE_URL
    SUPABASE_ANON_KEY
"""

import argparse
import os
import subprocess
import sys
import tempfile

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from supabase_client import get_client

YT_DLP    = "/opt/homebrew/bin/yt-dlp"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS_DIR = os.path.join(REPO_ROOT, "public", "data", "clips")


def parse_start_time(start_time: str) -> int:
    parts = start_time.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid start_time format: '{start_time}'")
    return int(parts[0]) * 60 + int(parts[1])


def make_clip_filename(actor_slug: str, rank: int) -> str:
    base = actor_slug.upper().replace("-", "_")
    return f"{base}_{rank}.mp4"


def download_video(yt_url: str, tmp_dir: str) -> str | None:
    tmp_base = os.path.join(tmp_dir, "video")
    cmd = [
        YT_DLP, "--no-warnings", "--quiet",
        "-f", "bestvideo+bestaudio/best",
        "--merge-output-format", "mkv",
        "-o", tmp_base + ".%(ext)s",
        yt_url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"    [yt-dlp error] {result.stderr.strip()}", file=sys.stderr)
            return None
        for ext in ("mkv", "mp4", "webm"):
            candidate = f"{tmp_base}.{ext}"
            if os.path.isfile(candidate):
                return candidate
        return None
    except subprocess.TimeoutExpired:
        print("    [error] yt-dlp timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    [error] yt-dlp failed: {e}", file=sys.stderr)
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
        if result.returncode != 0:
            print(f"    [ffmpeg error] {result.stderr.strip()[-500:]}", file=sys.stderr)
            return False
        return True
    except subprocess.TimeoutExpired:
        print("    [error] ffmpeg timed out", file=sys.stderr)
        return False
    except Exception as e:
        print(f"    [error] ffmpeg failed: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Download and cut approved clips for an actor.")
    parser.add_argument("actor_slug", help="Actor slug, e.g. adam-sandler")
    args = parser.parse_args()

    supa = get_client()

    # Look up actor
    actor_res = supa.table("video_actors").select("*").eq("slug", args.actor_slug).execute()
    if not actor_res.data:
        print(f"ERROR: actor '{args.actor_slug}' not found in Supabase.", file=sys.stderr)
        sys.exit(1)
    actor = actor_res.data[0]

    print(f"\n{'='*60}")
    print(f"  make_clips  —  {actor['name']}")
    print(f"{'='*60}")

    # Load top 5 movies by video_rank
    movies_res = (
        supa.table("video_movies")
        .select("*, video_clip_candidates(*)")
        .eq("actor_id", actor["id"])
        .order("video_rank", desc=True)
        .limit(5)
        .execute()
    )
    movies = movies_res.data

    if not movies:
        print("ERROR: no movies found.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(CLIPS_DIR, exist_ok=True)

    print(f"\n  {'Rank':<6} {'Title':<30} {'Start':>6}  {'Output':<25} Status")
    print(f"  {'-'*85}")

    for movie in movies:
        rank        = movie.get("video_rank") or movie.get("rank", 0)
        title       = movie.get("movie_title", "")
        actor_slug  = movie.get("actor_slug", args.actor_slug)
        approved_id = movie.get("approved_candidate_id")

        clip_filename = make_clip_filename(actor_slug, rank)
        clip_path     = os.path.join(CLIPS_DIR, clip_filename)
        prefix        = f"  {str(rank):<6} {title:<30}"

        # Find the approved candidate
        candidate = None
        if approved_id:
            cands = [c for c in (movie.get("video_clip_candidates") or []) if c["id"] == approved_id]
            candidate = cands[0] if cands else None

        if not candidate:
            print(f"{prefix} {'':>6}  {clip_filename:<25} skipped (no approved candidate)")
            continue

        yt_url     = candidate.get("yt_url")
        start_time = candidate.get("start_time")
        duration   = candidate.get("duration")
        status_pfx = f"{prefix} {str(start_time or ''):>6}  {clip_filename:<25}"

        # Skip if already exists
        if os.path.isfile(clip_path):
            print(f"{status_pfx} skipped (already exists)")
            # Still update clipped_video in case it wasn't set
            supa.table("video_movies").update({"clipped_video": clip_filename}).eq("id", movie["id"]).execute()
            continue

        if not yt_url or start_time is None or duration is None:
            print(f"{status_pfx} skipped (missing yt_url/start_time/duration)")
            continue

        try:
            start_seconds = parse_start_time(start_time)
        except ValueError as e:
            print(f"{status_pfx} FAILED ({e})")
            continue

        with tempfile.TemporaryDirectory(prefix="make_clips_", dir="/tmp") as tmp_dir:
            print(f"{status_pfx} downloading…", end="", flush=True)
            tmp_path = download_video(yt_url, tmp_dir)
            if not tmp_path:
                print(f"\r{status_pfx} FAILED (download error)")
                continue

            print(f"\r{status_pfx} clipping…    ", end="", flush=True)
            if not cut_clip(tmp_path, clip_path, start_seconds, duration):
                print(f"\r{status_pfx} FAILED (ffmpeg error)")
                continue

            print(f"\r{status_pfx} done         ")
            supa.table("video_movies").update({"clipped_video": clip_filename}).eq("id", movie["id"]).execute()

    print(f"\n{'='*60}")
    print("  Done.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
