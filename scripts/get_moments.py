#!/usr/bin/env python3
"""
get_moments.py
Given an actor and list of movies, uses Claude to return the top iconic
scene/moment for each movie with a key dialogue phrase to search for in transcripts.
"""

import anthropic
import json
import os
import re
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    print("ERROR: ANTHROPIC_API_KEY env var not set.", file=sys.stderr)
    sys.exit(1)

ACTOR = "Adam Sandler"
MOVIES = [
    {"title": "Happy Gilmore", "year": 1996},
    {"title": "The Wedding Singer", "year": 1998},
    {"title": "Punch-Drunk Love", "year": 2002},
]

SYSTEM_PROMPT = """You are a film expert assistant. When given an actor and movie, 
return structured data about iconic scenes. Always respond with valid JSON only, 
no markdown, no preamble."""

def get_moments_for_movie(client, actor, movie):
    prompt = f"""For the movie "{movie['title']}" ({movie['year']}) featuring {actor}, 
give me up to 10 of the best / most iconic or memorable quotes from {actor} in this movie. Each can
include a second actor in dialogue with {actor}. Use trusted sources like IMDB, TMDB, or Rotten Tomatoes to find the quotes.

When a quote includes a character name as a speaker label, always wrap it in square brackets like this: "[Happy Gilmore] You're gonna die, clown!" or "[Bob Barker] The price is wrong, bitch." Never use "Character: quote" colon format — always use "[Character] quote" bracket format.

Return a JSON object with exactly these fields:
{{
  "movie": "{movie['title']}",
  "year": {movie['year']},
  "quotes": [
    {{
      "quote": "the exact quote with any character names in [square brackets]",
      "source": "the source of the quote (IMDB, TMDB, Rotten Tomatoes, etc.)"
    }}
  ]
}}"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    print(f"    RAW RESPONSE: {raw[:300]}")
    return json.loads(raw)


def main():
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    print(f"\n{'='*60}")
    print(f"  Getting iconic moments for: {ACTOR}")
    print(f"{'='*60}\n")

    results = []
    for movie in MOVIES:
        print(f"  Processing: {movie['title']} ({movie['year']})...")
        try:
            moment = get_moments_for_movie(client, ACTOR, movie)
            results.append(moment)
            for i, q in enumerate(moment.get("quotes", []), 1):
                print(f"    [{i}] {q['quote']}")
            print()
        except Exception as e:
            print(f"    ERROR: {e}\n")

    print(f"{'='*60}")
    print("  FULL JSON OUTPUT:")
    print(f"{'='*60}")
    print(json.dumps(results, indent=2))

    # save for use by find_clips.py
    actor_slug = ACTOR.lower().replace(" ", "-")
    output_file = f"/tmp/{actor_slug}-moments.json"
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Saved to {output_file} for use by find_clips.py")


if __name__ == "__main__":
    main()
