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
YT_DLP = "/opt/homebrew/bin/yt-dlp"
DURATION_MIN = 60
DURATION_MAX = 900
MAX_RESULTS_PER_QUERY = 5


def folder_name_to_display(folder_name: str) -> str:
    """Convert BRAD-PITT → Brad Pitt"""
    return " ".join(w.capitalize() for w in folder_name.replace("-", " ").split())


def build_queries(entry_type: str, actor_name: str, label: str) -> list[str]:
    if entry_type == "Actor":
        return [
            f"{actor_name} {label} Best",
            f"{actor_name} {label} Highlights",
            # f"{actor_name} {label} Every Scene",
            # f"{actor_name} {label} Scene Compilation",
            # f"{actor_name} {label} All Clips",
            # f"{actor_name} {label} Full Performance",
            # f"{actor_name} {label} Best Scenes",
            # f"{actor_name} {label} Best Moments",
            # f"{actor_name} {label} Top Scenes",
            # f"{actor_name} {label} Greatest Moments",
            
            # f"{actor_name} {label} Scenes",
            # f"{actor_name} {label} Funny Moments",
            # f"{actor_name} {label} Iconic Scenes",
            # f"{actor_name} {label} Most Memorable Scenes",
            # f"{actor_name} {label} Movie Clips",
        ]
    return [f"{label} Highlights"]


def search_youtube(query: str, max_results: int = MAX_RESULTS_PER_QUERY, debug: bool = False) -> list[dict]:
    """Run yt-dlp search and return list of video metadata dicts."""
    if debug:
        print(f"  [query] {query}")
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
        if debug:
            for v in videos:
                print(f"    {v.get('duration', 'N/A')}s  {v.get('title', '')}")
        return videos
    except subprocess.TimeoutExpired:
        print(f"  [timeout] Query: {query}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  [error] yt-dlp failed for query '{query}': {e}", file=sys.stderr)
        return []


PRIORITY_KEYWORDS = {
    "highlights", "best scenes", "all scenes", "every scene",
    "scene compilation", "best moments", "top scenes", "greatest moments",
    "all clips", "iconic scenes", "most memorable",
}


def pick_best_video(
    queries: list[str], actor_name: str, label: str, entry_type: str
) -> dict:
    """
    Run all queries, collect candidates, apply duration filter, return best.
    Falls back to best available if nothing passes duration filter.
    """
    candidates = []

    for query in queries:
        videos = search_youtube(query, debug=True)
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
            candidates.append({"url": url, "title": title, "duration": duration})

    if not candidates:
        return {"url": "", "title": "", "duration": 0}

    # Deduplicate by URL (keep first occurrence)
    seen_urls = set()
    deduped = []
    for c in candidates:
        if c["url"] not in seen_urls:
            seen_urls.add(c["url"])
            deduped.append(c)
    candidates = deduped

    # Duration filter — fall back to full pool if nothing qualifies
    in_range = [c for c in candidates if DURATION_MIN <= c["duration"] <= DURATION_MAX]
    pool = in_range if in_range else candidates

    # Sort: priority keywords first, then original order
    def sort_key(c: dict) -> int:
        title_lower = c["title"].lower()
        return 0 if any(kw in title_lower for kw in PRIORITY_KEYWORDS) else 1

    pool.sort(key=sort_key)
    return pool[0]


def enrich_actor(actor: dict) -> dict:
    """Enrich a single actor JSON object with a yt_url field."""
    folder_name = actor.get("folder_name", "")
    entry_type = actor.get("type", "Actor")
    actor_name = folder_name_to_display(folder_name)
    rankings = actor.get("rankings", [])

    print(f"\n{'='*60}")
    print(f"  {actor.get('title', folder_name)}")
    print(f"{'='*60}")
    print(f"  {'Rank':<6} {'Label':<35} {'Dur':>5}  URL / Title")
    print(f"  {'-'*90}")

    enriched_rankings = []
    for entry in rankings:
        rank = entry.get("rank")
        label = entry.get("label", "")
        queries = build_queries(entry_type, actor_name, label)
        result = pick_best_video(queries, actor_name, label, entry_type)

        dur_str = f"{result['duration']}s" if result["duration"] else "N/A"
        print(f"  {str(rank):<6} {label:<35} {dur_str:>5}  {result['url']}")
        print(f"         Title: {result['title']}")

        enriched = {**entry, "yt_url": result["url"]}
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
