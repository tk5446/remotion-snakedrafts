#!/usr/bin/env python3
"""
transcribe_clips.py — TikTok captions pre-processing step

Transcribes each rank-1..5 clip with the OpenAI Whisper API and writes
word-level timestamps to public/data/transcripts/<actor-slug>-transcription.json.

KEY BEHAVIOUR
-------------
Captions must align with the trim window set in the Clip Review UI.
We ffmpeg-extract only the [trim_in, trim_out] segment before sending to
Whisper so all timestamps come back 0-based (0 ms = start of the displayed
clip).  If trim_in/trim_out change since the last run the clip is re-transcribed.

Index format (keyed by clipped_video filename):
  {
    "CHRISTIAN_BALE_1.mp4": {
      "trim_in": 3.993,
      "trim_out": 10.584,
      "captions": [
        { "text": "...", "startMs": 0, "endMs": 400,
          "timestampMs": null, "confidence": null },
        ...
      ]
    },
    ...
  }

Usage:
    python scripts/transcribe_clips.py <path/to/actor-top5.json>

    # Force re-transcription even if already indexed:
    python scripts/transcribe_clips.py <path> --force

Requirements:
    pip install openai
    export OPENAI_API_KEY=sk-...
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
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


def _trim_values_match(cached: dict, trim_in: float | None, trim_out: float | None) -> bool:
    """Return True if the cached entry was transcribed with the same trim window."""
    if not isinstance(cached, dict):
        # Old format (plain array) — always re-transcribe
        return False
    eps = 0.01  # 10ms tolerance
    ci = cached.get("trim_in")
    co = cached.get("trim_out")
    if trim_in is None and trim_out is None:
        return ci is None and co is None
    return (
        ci is not None and co is not None
        and abs(ci - (trim_in or 0)) < eps
        and abs(co - (trim_out or 0)) < eps
    )


def extract_segment(clip_path: str, trim_in: float, trim_out: float) -> str:
    """
    Use ffmpeg to cut [trim_in, trim_out] from clip_path into a temp file.
    Returns the temp file path — caller must delete it.
    """
    suffix = os.path.splitext(clip_path)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()

    duration = trim_out - trim_in
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(trim_in),
        "-i", clip_path,
        "-t", str(duration),
        "-c", "copy",
        tmp.name,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        os.unlink(tmp.name)
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[-300:]}")
    return tmp.name


def transcribe_clip(clip_path: str) -> list[dict]:
    """Call OpenAI Whisper API and return Caption-compatible word array."""
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        print("ERROR: openai package not installed. Run: pip install openai", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()

    with open(clip_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )

    words = getattr(response, "words", None) or []
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


def process_movies(movies: list, index: dict, force: bool) -> dict:
    actor_name = movies[0].get("actorName", "unknown")
    top5 = [m for m in movies if m.get("rank", 99) <= 5 and m.get("clipped_video")]

    print(f"\n{'='*60}")
    print(f"  {actor_name}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Title':<28} {'Clip':<26} Status")
    print(f"  {'-'*80}")

    for entry in top5:
        rank = entry.get("rank")
        title = entry.get("movieTitle", "")
        clip_filename = entry.get("clipped_video")
        trim_in: float | None = entry.get("trim_in")
        trim_out_val = entry.get("trim_in", 0) + entry.get("duration", 0) if trim_in is not None else None
        # Prefer explicit trim_out if stored; derive from trim_in + duration otherwise
        # top5.json stores trim_in but not trim_out — derive trim_out from trim_in + duration
        duration = entry.get("duration")
        trim_out: float | None = (trim_in + duration) if (trim_in is not None and duration is not None) else None

        prefix = f"  {str(rank):<6} {title:<28} {str(clip_filename):<26}"

        cached = index.get(clip_filename)
        if not force and cached and _trim_values_match(cached, trim_in, trim_out):
            word_count = len(cached.get("captions", cached) if isinstance(cached, dict) else cached)
            print(f"{prefix} skipped (already indexed, {word_count} words)")
            continue

        clip_path = os.path.join(CLIPS_DIR, clip_filename)
        if not os.path.isfile(clip_path):
            print(f"{prefix} skipped (file not found)")
            continue

        # Extract trimmed segment if trim points are available
        tmp_path = None
        source_path = clip_path
        segment_label = "full clip"

        if trim_in is not None and trim_out is not None and trim_out > trim_in:
            try:
                print(f"{prefix} extracting [{trim_in:.2f}s → {trim_out:.2f}s]...", end="", flush=True)
                tmp_path = extract_segment(clip_path, trim_in, trim_out)
                source_path = tmp_path
                segment_label = f"{trim_in:.2f}s–{trim_out:.2f}s"
            except Exception as e:
                print(f"\n{prefix} WARNING: ffmpeg extract failed ({e}), transcribing full clip")

        try:
            print(f"\r{prefix} transcribing {segment_label}...", end="", flush=True)
            captions = transcribe_clip(source_path)
        except Exception as e:
            print(f"\r{prefix} FAILED ({e})")
            continue
        finally:
            if tmp_path and os.path.isfile(tmp_path):
                os.unlink(tmp_path)

        index[clip_filename] = {
            "trim_in": trim_in,
            "trim_out": trim_out,
            "captions": captions,
        }
        print(f"\r{prefix} done ({len(captions)} words)    ")

    return index


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe top-5 clips with OpenAI Whisper (trim-aware)"
    )
    parser.add_argument("json_file", help="Path to actor top5.json (flat array of MovieEntry)")
    parser.add_argument("--force", action="store_true", help="Re-transcribe even if already indexed")
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
    updated = process_movies(data, index, force=args.force)
    save_index(updated, out_path)

    total = sum(1 for v in updated.values() if (v.get("captions") if isinstance(v, dict) else v))
    print(f"\n  Saved: {out_path}")
    print(f"  Clips with transcripts: {total}")


if __name__ == "__main__":
    main()
