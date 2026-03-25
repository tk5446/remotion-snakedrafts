#!/usr/bin/env python3
"""
make_clips.py — SNA-137

Downloads YouTube videos and cuts clips at specified timestamps.
Input JSON must already have yt_url, start_time, and duration populated
for each ranking entry.

Usage:
    python scripts/make_clips.py <path/to/top5_with_urls.json>
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


def make_clip_filename(folder_name: str, rank: int) -> str:
    """BRAD-PITT + 5 → BRAD_PITT_5.mp4"""
    base = folder_name.replace("-", "_")
    return f"{base}_{rank}.mp4"


def download_video(yt_url: str, tmp_path: str) -> bool:
    """Download video from yt_url to tmp_path using yt-dlp. Returns True on success."""
    cmd = [
        YT_DLP,
        "--no-warnings",
        "--quiet",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", tmp_path,
        yt_url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"    [yt-dlp error] {result.stderr.strip()}", file=sys.stderr)
            return False
        return True
    except subprocess.TimeoutExpired:
        print("    [error] yt-dlp download timed out", file=sys.stderr)
        return False
    except Exception as e:
        print(f"    [error] yt-dlp failed: {e}", file=sys.stderr)
        return False


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


def process_actor(actor: dict) -> dict:
    folder_name = actor.get("folder_name", "UNKNOWN")
    rankings = actor.get("rankings", [])

    os.makedirs(CLIPS_DIR, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  {actor.get('title', folder_name)}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Label':<30} {'Start':>6}  {'Output':<25} Status")
    print(f"  {'-'*85}")

    updated_rankings = []
    for entry in rankings:
        rank = entry.get("rank")
        label = entry.get("label", "")
        video = entry.get("video", {})
        yt_url = video.get("yt_url", "")
        start_time_str = video.get("start_time", "0:00")
        duration = video.get("duration", 10)

        clip_filename = make_clip_filename(folder_name, rank)
        clip_path = os.path.join(CLIPS_DIR, clip_filename)
        status_prefix = f"  {str(rank):<6} {label:<30} {start_time_str:>6}  {clip_filename:<25}"

        # Skip if already exists
        if os.path.isfile(clip_path):
            print(f"{status_prefix} skipped (already exists)")
            updated_video = {**video, "clipped_video": clip_filename}
            updated_rankings.append({**entry, "video": updated_video})
            continue

        if not yt_url:
            print(f"{status_prefix} FAILED (no yt_url)")
            updated_rankings.append(entry)
            continue

        # Parse start time
        try:
            start_seconds = parse_start_time(start_time_str)
        except ValueError as e:
            print(f"{status_prefix} FAILED ({e})")
            updated_rankings.append(entry)
            continue

        # Download to temp file
        with tempfile.NamedTemporaryFile(suffix=".mp4", prefix="make_clips_", dir="/tmp", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            print(f"{status_prefix} downloading...", end="", flush=True)
            if not download_video(yt_url, tmp_path):
                print(f"\r{status_prefix} FAILED (download error)")
                updated_rankings.append(entry)
                continue

            print(f"\r{status_prefix} clipping...   ", end="", flush=True)
            if not cut_clip(tmp_path, clip_path, start_seconds, duration):
                print(f"\r{status_prefix} FAILED (ffmpeg error)")
                updated_rankings.append(entry)
                continue

            print(f"\r{status_prefix} done")
            updated_video = {**video, "clipped_video": clip_filename}
            updated_rankings.append({**entry, "video": updated_video})

        finally:
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)

    return {**actor, "rankings": updated_rankings}


def main():
    parser = argparse.ArgumentParser(description="Cut clips from YouTube videos at specified timestamps.")
    parser.add_argument("json_file", help="Path to Top5 JSON file with yt_url, start_time, and duration fields")
    args = parser.parse_args()

    input_path = args.json_file
    if not os.path.isfile(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path) as f:
        data = json.load(f)

    actors = data if isinstance(data, list) else [data]
    updated_actors = [process_actor(a) for a in actors]

    output = updated_actors if isinstance(data, list) else updated_actors[0]
    with open(input_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  Updated: {input_path}")


if __name__ == "__main__":
    main()
