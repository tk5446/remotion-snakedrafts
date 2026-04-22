#!/usr/bin/env python3
"""
make_clips_local.py — Local clip pipeline (no Supabase)

Reads a JSON file: an array of objects with actorSlug, rank, movieTitle,
yt_url, start_time, duration (and other fields ignored for clipping).

For each row that has yt_url, start_time, and duration, downloads via yt-dlp
and cuts with ffmpeg into public/data/clips/{ACTORSLUG}_{rank}.mp4.

After a clip is saved (or already on disk), the script sets clipped_video on
that row and writes the JSON file back (same path; array order unchanged).

Rows missing any of those three fields are skipped (e.g. no trailer).

Usage:
    python scripts/make_clips_local.py path/to/movies.json

Optional:
    --clips-dir DIR   Output directory (default: repo public/data/clips)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

YT_DLP = shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS_DIR = os.path.join(REPO_ROOT, "public", "data", "clips")


def parse_start_time(start_time: str) -> int:
    parts = start_time.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid start_time format: '{start_time}' (expected M:SS)")
    return int(parts[0]) * 60 + int(parts[1])


def make_clip_filename(actor_slug: str, rank: int) -> str:
    base = actor_slug.upper().replace("-", "_")
    return f"{base}_{rank}.mp4"


def download_video(yt_url: str, tmp_dir: str) -> str | None:
    tmp_base = os.path.join(tmp_dir, "video")
    cmd = [
        YT_DLP,
        "--no-warnings",
        "--quiet",
        "-f",
        "bestvideo+bestaudio/best",
        "--merge-output-format",
        "mkv",
        "-o",
        tmp_base + ".%(ext)s",
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
        "ffmpeg",
        "-y",
        "-ss",
        str(start_seconds),
        "-i",
        input_path,
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
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


def load_rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("JSON root must be an array of movie objects")
    return data


def save_rows(path: str, data: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download and cut clips from a local JSON manifest (no Supabase)."
    )
    parser.add_argument(
        "json_file",
        help="Path to JSON array (actorSlug, rank, movieTitle, yt_url, start_time, duration, …)",
    )
    parser.add_argument(
        "--clips-dir",
        default=CLIPS_DIR,
        help=f"Output directory for .mp4 clips (default: {CLIPS_DIR})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download and re-encode even if output file already exists",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.json_file):
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)

    try:
        rows = load_rows(args.json_file)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("ERROR: JSON array is empty.", file=sys.stderr)
        sys.exit(1)

    actor_name = rows[0].get("actorName") or rows[0].get("actor_slug") or "clips"
    actor_slug = rows[0].get("actorSlug") or rows[0].get("actor_slug")
    if not actor_slug:
        print("ERROR: entries must include actorSlug.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.clips_dir, exist_ok=True)
    json_dirty = False
    rank_key = lambda r: (r.get("rank") is None, r.get("rank") or 0)

    print(f"\n{'='*60}")
    print(f"  make_clips_local  —  {actor_name}")
    print(f"{'='*60}")

    print(f"\n  {'Rank':<6} {'Title':<30} {'Start':>6}  {'Output':<25} Status")
    print(f"  {'-'*85}")

    def set_clipped_video(row: dict, filename: str) -> None:
        nonlocal json_dirty
        if row.get("clipped_video") != filename:
            row["clipped_video"] = filename
            json_dirty = True

    for row in sorted(rows, key=rank_key):
        rank = row.get("rank", 0)
        title = row.get("movieTitle") or row.get("movie_title") or ""
        slug = row.get("actorSlug") or actor_slug
        yt_url = row.get("yt_url")
        start_time = row.get("start_time")
        duration = row.get("duration")

        clip_filename = make_clip_filename(slug, rank)
        clip_path = os.path.join(args.clips_dir, clip_filename)
        prefix = f"  {str(rank):<6} {str(title)[:30]:<30}"
        status_pfx = f"{prefix} {str(start_time or ''):>6}  {clip_filename:<25}"

        if not yt_url or start_time is None or duration is None:
            print(f"{status_pfx} skipped (missing yt_url/start_time/duration)")
            continue

        if os.path.isfile(clip_path) and not args.force:
            print(f"{status_pfx} skipped (already exists)")
            set_clipped_video(row, clip_filename)
            continue

        try:
            start_seconds = parse_start_time(str(start_time))
        except ValueError as e:
            print(f"{status_pfx} FAILED ({e})")
            continue

        try:
            duration_int = int(duration)
        except (TypeError, ValueError):
            print(f"{status_pfx} FAILED (invalid duration: {duration!r})")
            continue

        with tempfile.TemporaryDirectory(prefix="make_clips_", dir="/tmp") as tmp_dir:
            print(f"{status_pfx} downloading…", end="", flush=True)
            tmp_path = download_video(yt_url, tmp_dir)
            if not tmp_path:
                print(f"\r{status_pfx} FAILED (download error)")
                continue

            print(f"\r{status_pfx} clipping…    ", end="", flush=True)
            if not cut_clip(tmp_path, clip_path, start_seconds, duration_int):
                print(f"\r{status_pfx} FAILED (ffmpeg error)")
                continue

            print(f"\r{status_pfx} done         ")
            set_clipped_video(row, clip_filename)

    if json_dirty:
        save_rows(args.json_file, rows)
        print(f"\n  Updated JSON with clipped_video: {args.json_file}")

    print(f"\n{'='*60}")
    print("  Done.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
