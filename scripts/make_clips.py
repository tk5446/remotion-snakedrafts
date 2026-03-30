#!/usr/bin/env python3
"""
make_clips.py — SNA-137

Downloads YouTube videos and cuts clips at specified timestamps.
Input JSON is a flat array of movie entries with yt_url, start_time,
and duration at the root level of each entry.

Only processes entries with rank <= 5.

Usage:
    python scripts/make_clips.py <path/to/movies.json>
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

YT_DLP = "/opt/homebrew/bin/yt-dlp"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS_DIR = os.path.join(REPO_ROOT, "public", "data", "clips")


def parse_start_time(start_time: str) -> int:
    """Convert 'M:SS' or 'MM:SS' string to total seconds."""
    parts = start_time.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid start_time format: '{start_time}' — expected M:SS or MM:SS")
    minutes, seconds = int(parts[0]), int(parts[1])
    return minutes * 60 + seconds


def make_clip_filename(actor_slug: str, rank: int) -> str:
    """al-pacino + 5 → AL_PACINO_5.mp4"""
    base = actor_slug.upper().replace("-", "_")
    return f"{base}_{rank}.mp4"


def download_video(yt_url: str, tmp_dir: str) -> str | None:
    """Download to tmp_dir, return actual output path or None on failure."""
    tmp_base = os.path.join(tmp_dir, "video")
    cmd = [
        YT_DLP,
        "--no-warnings",
        "--quiet",
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
        print("    [error] yt-dlp download timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    [error] yt-dlp failed: {e}", file=sys.stderr)
        return None


def cut_clip(input_path: str, output_path: str, start_seconds: int, duration: int) -> bool:
    """Cut a clip from input_path using ffmpeg. Returns True on success."""
    cmd = [
        "ffmpeg",
        "-y",
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


def process_movies(movies: list) -> list:
    # Derive actor info from first entry
    actor_slug = movies[0].get("actorSlug", "unknown")
    actor_name = movies[0].get("actorName", actor_slug)

    # Only process top 5
    top5 = [m for m in movies if m.get("rank", 99) <= 5]
    skipped = [m for m in movies if m.get("rank", 99) > 5]

    os.makedirs(CLIPS_DIR, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  {actor_name}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Title':<30} {'Start':>6}  {'Output':<25} Status")
    print(f"  {'-'*85}")

    updated_top5 = []
    for entry in top5:
        rank = entry.get("rank")
        title = entry.get("movieTitle", "")
        yt_url = entry.get("yt_url")
        start_time_str = entry.get("start_time")
        duration = entry.get("duration")

        clip_filename = make_clip_filename(actor_slug, rank)
        clip_path = os.path.join(CLIPS_DIR, clip_filename)
        status_prefix = f"  {str(rank):<6} {title:<30} {str(start_time_str or ''):>6}  {clip_filename:<25}"

        # Skip if already exists
        if os.path.isfile(clip_path):
            print(f"{status_prefix} skipped (already exists)")
            updated_top5.append({**entry, "clipped_video": clip_filename})
            continue

        # Skip if no yt_url
        if not yt_url:
            print(f"{status_prefix} skipped (no yt_url)")
            updated_top5.append(entry)
            continue

        # Skip if missing start_time or duration
        if start_time_str is None or duration is None:
            print(f"{status_prefix} skipped (missing start_time or duration)")
            updated_top5.append(entry)
            continue

        # Parse start time
        try:
            start_seconds = parse_start_time(start_time_str)
        except ValueError as e:
            print(f"{status_prefix} FAILED ({e})")
            updated_top5.append(entry)
            continue

        # Download and clip
        with tempfile.TemporaryDirectory(prefix="make_clips_", dir="/tmp") as tmp_dir:
            print(f"{status_prefix} downloading...", end="", flush=True)
            tmp_path = download_video(yt_url, tmp_dir)
            if not tmp_path:
                print(f"\r{status_prefix} FAILED (download error)")
                updated_top5.append(entry)
                continue

            print(f"\r{status_prefix} clipping...   ", end="", flush=True)
            if not cut_clip(tmp_path, clip_path, start_seconds, duration):
                print(f"\r{status_prefix} FAILED (ffmpeg error)")
                updated_top5.append(entry)
                continue

            print(f"\r{status_prefix} done")
            updated_top5.append({**entry, "clipped_video": clip_filename})

    return updated_top5 + skipped


def main():
    parser = argparse.ArgumentParser(description="Cut clips from YouTube videos at specified timestamps.")
    parser.add_argument("json_file", help="Path to movies JSON file with yt_url, start_time, and duration fields")
    args = parser.parse_args()

    input_path = args.json_file
    if not os.path.isfile(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path) as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("Error: JSON must be a flat array of movie entries", file=sys.stderr)
        sys.exit(1)

    if not data:
        print("Error: JSON array is empty", file=sys.stderr)
        sys.exit(1)

    updated = process_movies(data)

    with open(input_path, "w") as f:
        json.dump(updated, f, indent=2)

    print(f"\n  Updated: {input_path}")


if __name__ == "__main__":
    main()