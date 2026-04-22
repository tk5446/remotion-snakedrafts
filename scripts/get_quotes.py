#!/usr/bin/env python3
"""
get_quotes.py  — Pipeline Phase 1

Upserts actor + movies into Supabase, then fetches iconic quotes
from Claude for each movie and writes them to video_quotes.

Usage:
    python scripts/get_quotes.py <actor-slug> <path/to/top5.json>

Example:
    python scripts/get_quotes.py adam-sandler public/data/adam-sandler/top5.json

Env vars required:
    ANTHROPIC_API_KEY
    SUPABASE_URL
    SUPABASE_ANON_KEY
"""

import argparse
import json
import os
import re
import sys

import anthropic
from supabase_client import get_client


# ---------------------------------------------------------------------------
# Claude — get quotes
# ---------------------------------------------------------------------------

def get_quotes_from_claude(client: anthropic.Anthropic, actor: str, movie: str, year: int) -> list[str]:
    prompt = (
        f'For the movie "{movie}" ({year}), give me up to 10 of the most iconic, memorable '
        f"quotes spoken by {actor}'s character. Only include quotes that are definitively "
        f"spoken by {actor} — do not include quotes from other characters in the film. "
        f"Use trusted sources like IMDB, TMDB, or Rotten Tomatoes.\n\n"
        f"Return a JSON array of plain quote strings only — no character names, no labels, "
        f"no other fields. Example:\n"
        f'["I\'m kind of a big deal.", "You stay classy, San Diego."]'
    )
    try:
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system="You are a film expert. Respond with valid JSON only, no markdown.",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        quotes = json.loads(raw)
        if isinstance(quotes, list):
            return [q for q in quotes if isinstance(q, str)]
    except Exception as e:
        print(f"    [claude error] {e}")
    return []


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fetch Claude quotes and seed Supabase for an actor.")
    parser.add_argument("actor_slug", help="Actor slug, e.g. adam-sandler")
    parser.add_argument("json_file", help="Path to top5.json for this actor")
    args = parser.parse_args()

    if not os.path.isfile(args.json_file):
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)

    with open(args.json_file) as f:
        movies = json.load(f)

    if not isinstance(movies, list) or not movies:
        print("ERROR: JSON must be a non-empty array.", file=sys.stderr)
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    supa = get_client()
    claude = anthropic.Anthropic(api_key=api_key)

    actor_name = movies[0].get("actorName", args.actor_slug)

    print(f"\n{'='*60}")
    print(f"  get_quotes  —  {actor_name}")
    print(f"{'='*60}")

    # --- Upsert actor ---
    actor_res = supa.table("video_actors").upsert(
        {"name": actor_name, "slug": args.actor_slug},
        on_conflict="slug",
    ).execute()
    actor_id = actor_res.data[0]["id"]
    print(f"\n  Actor: {actor_name}  (id: {actor_id[:8]}…)")

    # --- Upsert movies ---
    for entry in movies:
        rank = entry.get("rank", 0)
        movie_data = {
            "actor_id":         actor_id,
            "rank":             rank,
            "video_rank":       rank,   # default to listicle rank; user can reorder in UI
            "movie_title":      entry.get("movieTitle", ""),
            "movie_slug":       entry.get("movieSlug", ""),
            "year":             entry.get("year"),
            "tmdb_id":          entry.get("tmdbId"),
            "tmdb_description": entry.get("tmdb_description", ""),
            "local_filename":   entry.get("localFilename", ""),
            "actor_name":       entry.get("actorName", ""),
            "actor_slug":       entry.get("actorSlug", args.actor_slug),
        }
        supa.table("video_movies").upsert(movie_data, on_conflict="actor_id,rank").execute()

    print(f"  Upserted {len(movies)} movies.\n")

    # --- Fetch quotes for each movie ---
    for entry in movies:
        rank = entry.get("rank", 0)
        movie_title = entry.get("movieTitle", "")
        year = entry.get("year", 0)

        # Look up movie id
        movie_res = supa.table("video_movies").select("id").eq("actor_id", actor_id).eq("rank", rank).execute()
        if not movie_res.data:
            print(f"  #{rank}  {movie_title} — could not find movie row, skipping")
            continue
        movie_id = movie_res.data[0]["id"]

        # Skip if quotes already exist
        existing = supa.table("video_quotes").select("id").eq("movie_id", movie_id).execute()
        if existing.data:
            print(f"  #{rank}  {movie_title} — {len(existing.data)} quotes already exist, skipping")
            continue

        print(f"  #{rank}  {movie_title} ({year}) — fetching quotes...", end="", flush=True)
        quotes = get_quotes_from_claude(claude, actor_name, movie_title, year)

        if not quotes:
            print(" no quotes returned")
            continue

        rows = [{"movie_id": movie_id, "text": q, "user_rank": None} for q in quotes]
        supa.table("video_quotes").insert(rows).execute()
        print(f" {len(quotes)} quotes written")

    print(f"\n{'='*60}")
    print("  Done. Open the admin UI to rank quotes.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
