#!/usr/bin/env python3
"""
export_render_data.py  — Pipeline Phase 4

Reads approved data from Supabase for an actor and writes
public/data/top5.json in the MovieEntry shape that Remotion reads.
Movies are sorted by video_rank descending (5 → 4 → 3 → 2 → 1),
matching Top5Version2's countdown reveal order.

Run this immediately before: npx remotion render Top5Version2

Usage:
    python scripts/export_render_data.py <actor-slug>

Env vars required:
    SUPABASE_URL
    SUPABASE_ANON_KEY
"""

import argparse
import json
import os
import sys

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from supabase_client import get_client

REPO_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(REPO_ROOT, "public", "data", "top5.json")


def main():
    parser = argparse.ArgumentParser(description="Export approved clip data to public/data/top5.json for Remotion.")
    parser.add_argument("actor_slug", help="Actor slug, e.g. adam-sandler")
    args = parser.parse_args()

    supa = get_client()

    # Look up actor
    actor_res = supa.table("video_actors").select("*").eq("slug", args.actor_slug).execute()
    if not actor_res.data:
        print(f"ERROR: actor '{args.actor_slug}' not found in Supabase.", file=sys.stderr)
        sys.exit(1)
    actor = actor_res.data[0]

    print(f"\n  Exporting: {actor['name']}")

    # Load top 5 movies by video_rank descending
    movies_res = (
        supa.table("video_movies")
        .select("*")
        .eq("actor_id", actor["id"])
        .order("video_rank", desc=True)
        .limit(5)
        .execute()
    )
    movies = movies_res.data

    if not movies:
        print("ERROR: no movies found.", file=sys.stderr)
        sys.exit(1)

    # Load approved candidates for these movies
    movie_ids = [m["id"] for m in movies]
    cands_res = (
        supa.table("video_clip_candidates")
        .select("*")
        .in_("id", [m["approved_candidate_id"] for m in movies if m.get("approved_candidate_id")])
        .execute()
    )
    cands_by_id = {c["id"]: c for c in cands_res.data}

    entries = []
    warnings = []

    for movie in movies:
        approved_id = movie.get("approved_candidate_id")
        candidate   = cands_by_id.get(approved_id) if approved_id else None

        entry = {
            "actorName":       movie.get("actor_name", ""),
            "actorSlug":       movie.get("actor_slug", ""),
            "rank":            movie.get("rank", 0),
            "video_rank":      movie.get("video_rank", movie.get("rank", 0)),
            "movieTitle":      movie.get("movie_title", ""),
            "movieSlug":       movie.get("movie_slug", ""),
            "localFilename":   movie.get("local_filename", ""),
            "year":            movie.get("year", 0),
            "tmdbId":          movie.get("tmdb_id", 0),
            "tmdb_description": movie.get("tmdb_description", ""),
            "brightness":      movie.get("brightness", 1.0),
            "yt_url":          candidate["yt_url"]    if candidate else None,
            "start_time":      candidate["start_time"] if candidate else None,
            "duration":        candidate["duration"]   if candidate else None,
            "clipped_video":   movie.get("clipped_video"),
        }
        entries.append(entry)

        status = "✓" if candidate and movie.get("clipped_video") else "⚠"
        print(f"  {status}  video_rank={entry['video_rank']}  {entry['movieTitle']}"
              + (f"  → {movie['clipped_video']}" if movie.get("clipped_video") else "  (no clip)"))

        if not candidate:
            warnings.append(f"  ⚠  {entry['movieTitle']} has no approved candidate")
        if not movie.get("clipped_video"):
            warnings.append(f"  ⚠  {entry['movieTitle']} has no cut clip (run make_clips.py)")

    with open(OUTPUT_PATH, "w") as f:
        json.dump(entries, f, indent=2)

    print(f"\n  Written: {OUTPUT_PATH}")

    if warnings:
        print("\n  Warnings:")
        for w in warnings:
            print(w)
    else:
        print("\n  All 5 entries complete. Ready to render.")

    print(f"\n  Run:  npx remotion render Top5Version2\n")


if __name__ == "__main__":
    main()
