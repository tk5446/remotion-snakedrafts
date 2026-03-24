#!/usr/bin/env python3
"""
find_yt_urls.py — SNA-137

Enriches a Top5 JSON file (or array of them) with YouTube URLs for each ranking entry.
Uses yt-dlp search (no API key required) to find the best matching video.

Usage:
    python scripts/find_yt_urls.py <path/to/top5.json>
"""

import argparse
import json
import os
import subprocess
import sys
import re

YT_DLP = "/opt/homebrew/bin/yt-dlp"
DURATION_MIN = 60
DURATION_MAX = 300
CONFIDENCE_WARN = 0.7
MAX_RESULTS_PER_QUERY = 5


def folder_name_to_display(folder_name: str) -> str:
    """Convert BRAD-PITT → Brad Pitt"""
    return " ".join(w.capitalize() for w in folder_name.replace("-", " ").split())


def build_queries(entry_type: str, actor_name: str, label: str) -> list[str]:
    if entry_type == "Actor":
        return [
            f"{actor_name} {label} All Scenes",
            f"{actor_name} {label} Every Scene",
            f"{actor_name} {label} Scene Compilation",
            f"{actor_name} {label} All Clips",
            f"{actor_name} {label} Full Performance",
            f"{actor_name} {label} Best Scenes",
            f"{actor_name} {label} Best Moments",
            f"{actor_name} {label} Top Scenes",
            f"{actor_name} {label} Greatest Moments",
            f"{actor_name} {label} Highlights",
            f"{actor_name} {label} Scenes",
            f"{actor_name} {label} Funny Moments",
            f"{actor_name} {label} Iconic Scenes",
            f"{actor_name} {label} Most Memorable Scenes",
            f"{actor_name} {label} Movie Clips",
        ]
    return [f"{label} Highlights"]


def search_youtube(query: str, max_results: int = MAX_RESULTS_PER_QUERY) -> list[dict]:
    """Run yt-dlp search and return list of video metadata dicts."""
    search_url = f"ytsearch{max_results}:{query}"
    cmd = [
        YT_DLP,
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        "--quiet",
        search_url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        videos = []
        for line in result.stdout.strip().splitlines():
            if not line.strip():
                continue
            try:
                videos.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return videos
    except subprocess.TimeoutExpired:
        print(f"  [timeout] Query: {query}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  [error] yt-dlp failed for query '{query}': {e}", file=sys.stderr)
        return []


def compute_confidence(title: str, actor_name: str, label: str, entry_type: str) -> float:
    """
    Score 0.0–1.0 based on how well the video title matches actor + movie label.
    """
    title_lower = title.lower()

    if entry_type == "Actor":
        # Check actor name words
        actor_words = [w.lower() for w in actor_name.split() if len(w) > 1]
        actor_hits = sum(1 for w in actor_words if w in title_lower)
        actor_score = actor_hits / len(actor_words) if actor_words else 0.0
    else:
        actor_score = 1.0  # not applicable

    # Check label words
    label_words = [w.lower() for w in re.split(r"[\s\.\-]+", label) if len(w) > 2]
    label_hits = sum(1 for w in label_words if w in title_lower)
    label_score = label_hits / len(label_words) if label_words else 0.0

    if entry_type == "Actor":
        return round(0.4 * actor_score + 0.6 * label_score, 3)
    return round(label_score, 3)


def pick_best_video(
    queries: list[str], actor_name: str, label: str, entry_type: str
) -> dict:
    """
    Run all queries, collect candidates, apply duration filter, return best.
    Falls back to best available if nothing passes duration filter.
    """
    candidates = []  # list of (confidence, video)

    for query in queries:
        videos = search_youtube(query)
        for v in videos:
            duration = v.get("duration") or 0
            title = v.get("title") or ""
            url = v.get("webpage_url") or v.get("url") or ""
            if not url:
                # Reconstruct from id
                vid_id = v.get("id") or ""
                url = f"https://www.youtube.com/watch?v={vid_id}" if vid_id else ""
            if not url:
                continue

            conf = compute_confidence(title, actor_name, label, entry_type)
            in_duration = DURATION_MIN <= duration <= DURATION_MAX
            candidates.append({
                "confidence": conf,
                "url": url,
                "title": title,
                "duration": duration,
                "in_duration": in_duration,
            })

    if not candidates:
        return {"url": "", "title": "", "duration": 0, "confidence": 0.0}

    # Deduplicate by video ID (keep first occurrence)
    seen_urls = set()
    deduped = []
    for c in candidates:
        if c["url"] not in seen_urls:
            seen_urls.add(c["url"])
            deduped.append(c)
    candidates = deduped

    # Compilation title bonus: +0.2 (capped at 1.0)
    COMPILATION_KEYWORDS = {
        "compilation", "all scenes", "every scene", "best scenes", "highlights",
        "top scenes", "all clips", "full performance",
    }
    for c in candidates:
        title_lower = c["title"].lower()
        if any(kw in title_lower for kw in COMPILATION_KEYWORDS):
            c["confidence"] = min(1.0, round(c["confidence"] + 0.2, 3))

    # Prefer candidates within duration range, then sort by confidence desc
    in_range = [c for c in candidates if c["in_duration"]]
    pool = in_range if in_range else candidates
    pool.sort(key=lambda c: c["confidence"], reverse=True)
    best = pool[0]
    return best


def enrich_actor(actor: dict) -> dict:
    """Enrich a single actor JSON object with yt_url and yt_confidence fields."""
    folder_name = actor.get("folder_name", "")
    entry_type = actor.get("type", "Actor")
    actor_name = folder_name_to_display(folder_name)
    rankings = actor.get("rankings", [])

    print(f"\n{'='*60}")
    print(f"  {actor.get('title', folder_name)}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Label':<35} {'Conf':>5}  {'Dur':>5}  URL / Title")
    print(f"  {'-'*100}")

    enriched_rankings = []
    for entry in rankings:
        rank = entry.get("rank")
        label = entry.get("label", "")
        queries = build_queries(entry_type, actor_name, label)
        result = pick_best_video(queries, actor_name, label, entry_type)

        warn = "⚠️ " if result["confidence"] < CONFIDENCE_WARN else "   "
        dur_str = f"{result['duration']}s" if result["duration"] else "N/A"
        conf_str = f"{result['confidence']:.2f}"
        print(f"  {str(rank):<6} {label:<35} {conf_str:>5}  {dur_str:>5}  {warn}{result['url']}")
        print(f"         Title: {result['title']}")

        enriched = {**entry, "yt_url": result["url"], "yt_confidence": result["confidence"]}
        enriched_rankings.append(enriched)

    return {**actor, "rankings": enriched_rankings}


def main():
    parser = argparse.ArgumentParser(description="Find YouTube URLs for Top5 JSON entries.")
    parser.add_argument("json_file", help="Path to the Top5 JSON file (single object or array)")
    args = parser.parse_args()

    input_path = args.json_file
    if not os.path.isfile(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_path) as f:
        data = json.load(f)

    actors = data if isinstance(data, list) else [data]
    enriched_actors = [enrich_actor(a) for a in actors]

    input_dir = os.path.dirname(os.path.abspath(input_path))

    for actor in enriched_actors:
        folder_name = actor.get("folder_name", "output")
        out_path = os.path.join(input_dir, f"{folder_name}_with_urls.json")
        with open(out_path, "w") as f:
            json.dump(actor if len(actors) == 1 else enriched_actors, f, indent=2)
        print(f"\n  Wrote: {out_path}")

    if len(actors) > 1:
        # Also write the full array to a combined file named after the input
        base = os.path.splitext(os.path.basename(input_path))[0]
        combined_path = os.path.join(input_dir, f"{base}_with_urls.json")
        with open(combined_path, "w") as f:
            json.dump(enriched_actors, f, indent=2)
        print(f"\n  Combined output: {combined_path}")


if __name__ == "__main__":
    main()
