#!/usr/bin/env python3
"""
transcribe_clips.py — TikTok captions pre-processing step

Transcribes each rank-1..5 clip with the OpenAI Whisper API and writes
word-level timestamps to public/data/transcripts/<actor-slug>-transcription.json.

Each file is keyed by clipped_video filename, e.g.:
  { "EDDIE_MURPHY_1.mp4": [ { "text": "...", "startMs": 0, "endMs": 400,
                               "timestampMs": null, "confidence": null }, ... ] }

This format matches @remotion/captions Caption type exactly.

Usage:
    python scripts/transcribe_clips.py <path/to/top5.json>

Requirements:
    pip install openai
    export OPENAI_API_KEY=sk-...
"""

import argparse
import json
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS_DIR = os.path.join(REPO_ROOT, "public", "data", "clips")
TRANSCRIPTS_DIR = os.path.join(REPO_ROOT, "public", "data", "transcripts")


def transcript_path(actor_slug: str) -> str:
    return os.path.join(TRANSCRIPTS_DIR, f"{actor_slug}-transcription.json")


def load_index(path: str) -> dict:
    if os.path.isfile(path):
        with open(path) as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}


def save_index(index: dict, path: str) -> None:
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    with open(path, "w") as f:
        json.dump(index, f, indent=2)


def transcribe_clip(clip_path: str) -> list[dict] | None:
    """Call OpenAI Whisper API and return Caption-compatible word array."""
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        print("ERROR: openai package not installed. Run: pip install openai", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()  # uses OPENAI_API_KEY from environment

    with open(clip_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )

    words = getattr(response, "words", None) or []
    if not words:
        return []

    captions = []
    for w in words:
        text = getattr(w, "word", None) or getattr(w, "text", "")
        start_s = getattr(w, "start", 0.0)
        end_s = getattr(w, "end", 0.0)
        captions.append({
            "text": text.strip(),
            "startMs": round(start_s * 1000),
            "endMs": round(end_s * 1000),
            "timestampMs": None,
            "confidence": None,
        })

    return captions


def process_movies(movies: list, index: dict, out_path: str) -> dict:
    actor_name = movies[0].get("actorName", "unknown")
    top5 = [m for m in movies if m.get("rank", 99) <= 5]

    print(f"\n{'='*60}")
    print(f"  {actor_name}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Title':<30} {'Clip':<28} Status")
    print(f"  {'-'*80}")

    for entry in top5:
        rank = entry.get("rank")
        title = entry.get("movieTitle", "")
        clip_filename = entry.get("clipped_video")

        status_prefix = f"  {str(rank):<6} {title:<30} {str(clip_filename or ''):<28}"

        if not clip_filename:
            print(f"{status_prefix} skipped (no clipped_video)")
            continue

        if clip_filename in index:
            word_count = len(index[clip_filename])
            print(f"{status_prefix} skipped (already indexed, {word_count} words)")
            continue

        clip_path = os.path.join(CLIPS_DIR, clip_filename)
        if not os.path.isfile(clip_path):
            print(f"{status_prefix} skipped (clip file not found: {clip_path})")
            continue

        print(f"{status_prefix} transcribing...", end="", flush=True)
        try:
            captions = transcribe_clip(clip_path)
        except Exception as e:
            print(f"\r{status_prefix} FAILED ({e})")
            continue

        index[clip_filename] = captions
        word_count = len(captions)
        print(f"\r{status_prefix} done ({word_count} words)    ")

    return index


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe top-5 clips with OpenAI Whisper and write to transcripts/index.json"
    )
    parser.add_argument("json_file", help="Path to movies JSON file with clipped_video fields")
    args = parser.parse_args()

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.json_file):
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)

    with open(args.json_file) as f:
        data = json.load(f)

    if not isinstance(data, list) or not data:
        print("ERROR: JSON must be a non-empty flat array of movie entries", file=sys.stderr)
        sys.exit(1)

    actor_slug = data[0].get("actorSlug", "unknown")
    out_path = transcript_path(actor_slug)

    index = load_index(out_path)
    updated_index = process_movies(data, index, out_path)
    save_index(updated_index, out_path)

    total = sum(1 for v in updated_index.values() if v)
    print(f"\n  Updated: {out_path}")
    print(f"  Clips with transcripts: {total}")


if __name__ == "__main__":
    main()
