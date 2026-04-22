#!/usr/bin/env python3
"""
get_quotes_json.py — Phase 1 (JSON mode, no Supabase)

Sources quotes from IMDB via Wayback Machine + BeautifulSoup.
Claude is used to identify the character name and to rank quotes.

Flow:
  1. Claude identifies the character name (single API call per movie)
  2. IMDB Suggestions API resolves the movie title to an IMDB tt-ID
  3. Wayback Machine returns a cached snapshot of the IMDB quotes page
  4. BeautifulSoup parses the exchange list, filtering to the target character
  5. Claude (Haiku) filters and ranks the raw quotes to 8-12 clip-findable ones
  6. If the Wayback cache misses for the target year, older years are tried

Usage:
    python scripts/get_quotes_json.py path/to/top5.json
    python scripts/get_quotes_json.py path/to/top5.json --count 6
    python scripts/get_quotes_json.py path/to/top5.json --overwrite
    python scripts/get_quotes_json.py path/to/top5.json --no-rank

Output:
    Same directory as input — {actor-slug}-clips.json

Env vars (loaded from .env):
    ANTHROPIC_API_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


# ---------------------------------------------------------------------------
# Step 1: Get character name from Claude (factual lookup only — no quotes)
# ---------------------------------------------------------------------------

def get_character_name(actor: str, movie: str, year: int) -> str:
    """Ask Claude what character the actor plays. Returns empty string on failure."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic not installed. Run: pip install anthropic", file=sys.stderr)
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    prompt = (
        f'What is the name of the character played by {actor} in the movie "{movie}" ({year})? '
        f'Return a JSON object with a single field: {{"character": "Character Name"}}'
    )
    try:
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=128,
            system="You are a film expert. Respond with valid JSON only, no markdown.",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        return data.get("character", "").strip()
    except Exception as e:
        print(f"  [claude error] {e}")
        return ""


# ---------------------------------------------------------------------------
# Character name matching helper
# ---------------------------------------------------------------------------

def _name_matches(name: str, char_lower: str, char_words: set[str]) -> bool:
    n = name.lower().strip()
    n_words = {w for w in re.findall(r"[a-z]{3,}", n)}
    return (
        n == char_lower
        or char_lower in n
        or n in char_lower
        or bool(char_words & n_words)
    )


# ---------------------------------------------------------------------------
# Step 2: Resolve IMDB tt-ID via Suggestions API
# ---------------------------------------------------------------------------

def get_imdb_id(movie_title: str, year: int) -> str | None:
    """
    Uses the IMDB Suggestions API to find the movie's tt-ID.
    Returns e.g. "tt0357413" or None.
    """
    query = urllib.parse.quote(movie_title.lower())
    url   = f"https://v3.sg.media-imdb.com/suggestion/x/{query}.json"
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f" [suggestions API error: {e}]", end="")
        return None

    title_lower = movie_title.lower()
    results = data.get("d", [])

    # Prefer title + year match
    for item in results[:8]:
        tt   = item.get("id", "")
        name = (item.get("l", "") or "").lower()
        y    = item.get("y") or 0
        if tt.startswith("tt") and (title_lower in name or name in title_lower):
            if abs(y - year) <= 1:
                return tt

    # Fallback: exact title match regardless of year
    for item in results[:5]:
        tt   = item.get("id", "")
        name = (item.get("l", "") or "").lower()
        if tt.startswith("tt") and name == title_lower:
            return tt

    # Last resort: first movie result
    for item in results[:3]:
        if item.get("id", "").startswith("tt"):
            return item["id"]

    return None


# ---------------------------------------------------------------------------
# Step 3a: Fetch IMDB quotes page via Wayback Machine (CDX-backed)
# ---------------------------------------------------------------------------

_WAYBACK_YEARS = ["2026", "2025", "2024", "2023"]


def _cdx_find_snapshot(imdb_url: str) -> str | None:
    """
    Use the Wayback Machine CDX API to find the timestamp of the most recent
    stored 200-OK snapshot for this URL. Returns the full Wayback URL if found.

    This avoids blind year-based fetches that return 403 when no snapshot exists
    for that year range.
    """
    cdx = (
        "http://web.archive.org/cdx/search/cdx"
        "?output=json&limit=5&fl=timestamp&filter=statuscode:200"
        "&from=20220101"
        f"&url={urllib.parse.quote_plus(imdb_url)}"
    )
    try:
        req = urllib.request.Request(cdx, headers={"User-Agent": _HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read())
        # rows[0] is the header row ["timestamp"], rows[1+] are actual snapshots
        if len(rows) >= 2:
            ts = rows[-1][0]  # most recent available snapshot
            return f"https://web.archive.org/web/{ts}/{imdb_url}"
    except Exception as e:
        print(f" [cdx-err: {e}]", end="")
    return None


def _fetch_wayback(tt_id: str) -> str | None:
    """
    1. Use CDX API to find an actual stored snapshot — avoids 403s on year
       ranges that have no snapshot.
    2. Fall back to blind year-based URLs if CDX fails.
    Returns HTML on success, None if all strategies fail.
    """
    imdb_url = f"https://www.imdb.com/title/{tt_id}/quotes/"

    # Strategy 1: CDX-backed fetch (precise timestamp)
    print(f" [cdx]", end="", flush=True)
    snapshot_url = _cdx_find_snapshot(imdb_url)
    if snapshot_url:
        try:
            req = urllib.request.Request(snapshot_url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                html = r.read().decode("utf-8", errors="replace")
            print(f" [ok]", end="")
            return html
        except urllib.error.HTTPError as e:
            print(f" [cdx-fetch {e.code}]", end="")
        except Exception as e:
            print(f" [cdx-fetch err]", end="")
    else:
        print(f" [no snapshot]", end="")

    time.sleep(2)

    # Strategy 2: Blind year-based fallback
    for year in _WAYBACK_YEARS:
        url = f"https://web.archive.org/web/{year}/{imdb_url}"
        for attempt in range(2):  # one retry per year on 429
            try:
                req = urllib.request.Request(url, headers=_HEADERS)
                with urllib.request.urlopen(req, timeout=25) as r:
                    return r.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt == 0:
                    print(f" [429 retry {year}]", end="", flush=True)
                    time.sleep(15)
                    continue
                print(f" [{e.code}/{year}]", end="")
                break
            except Exception:
                print(f" [err/{year}]", end="")
                break
        time.sleep(2)  # polite gap between year attempts

    return None


def fetch_quotes_imdb(tt_id: str, character: str) -> list[str]:
    """Fetch IMDB quotes page via Wayback Machine and filter by character."""
    from bs4 import BeautifulSoup

    html = _fetch_wayback(tt_id)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    return _parse_imdb_quotes_html(soup, character)


# ---------------------------------------------------------------------------
# Step 3b: Wikiquote fallback
# Used when the Wayback Machine has no snapshot for a given IMDB quotes page.
# Works well for widely-known films. Known limitation: Wikiquote sections are
# structured by speaker, so misattribution is possible when the character
# section contains attributed dialogue from other characters. Claude's ranking
# step mitigates this by filtering for clip-quality lines.
# ---------------------------------------------------------------------------

_WIKIQUOTE_API = "https://en.wikiquote.org/w/api.php"


def _wq_api_get(params: dict) -> dict:
    url = _WIKIQUOTE_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "snakedrafts-clips/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _wq_fetch_page(title: str) -> tuple[str, str]:
    data = _wq_api_get({"action": "parse", "page": title, "prop": "wikitext", "format": "json"})
    if "parse" not in data:
        return "", ""
    wikitext   = data["parse"]["wikitext"]["*"]
    page_title = data["parse"]["title"]
    redirect   = re.match(r"#REDIRECT\s*\[\[([^\]]+)\]\]", wikitext, re.IGNORECASE)
    if redirect:
        return _wq_fetch_page(redirect.group(1))
    return page_title, wikitext


def _wq_fetch_wikitext(movie_title: str) -> tuple[str, str]:
    try:
        title, wt = _wq_fetch_page(movie_title.replace(" ", "_"))
        if wt:
            return title, wt
    except Exception:
        pass
    try:
        results = _wq_api_get({"action": "opensearch", "search": movie_title,
                                "limit": "5", "format": "json"})
        for candidate in results[1]:
            try:
                title, wt = _wq_fetch_page(candidate)
                if wt:
                    return title, wt
            except Exception:
                continue
    except Exception:
        pass
    return "", ""


def _wq_clean(text: str) -> str:
    text = re.sub(r"\[\[(?:File|Image):[^\]]+\]\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    text = re.sub(r"'{2,3}", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _wq_extract_quotes(wikitext: str, character: str) -> list[str]:
    """
    Extracts bullet-point quotes from the target character's section.
    When no character section exists, falls back to all top-level bullets
    (covers films where Wikiquote uses a single flat list).
    """
    char_lower = character.lower().strip()
    char_words = {w for w in re.findall(r"[a-z]{3,}", char_lower)}
    parts = re.split(r"={1,4}([^=\n]+)={1,4}", wikitext)

    target_body: str | None = None
    for i in range(1, len(parts), 2):
        header       = parts[i].strip().lower()
        header_words = {w for w in re.findall(r"[a-z]{3,}", header)}
        if header == char_lower or char_lower in header or (char_words & header_words):
            target_body = parts[i + 1] if i + 1 < len(parts) else ""
            break

    # No character-specific section — use the full wikitext
    if target_body is None:
        target_body = wikitext

    quotes: list[str] = []
    for line in target_body.splitlines():
        line = line.strip()
        if re.match(r"^\*(?!\*)", line):
            quote = _wq_clean(line.lstrip("*").strip())
            if quote and len(quote.split()) >= 4 and not quote.startswith("{"):
                quotes.append(quote)
    return quotes


def fetch_quotes_wikiquote(movie_title: str, character: str) -> list[str]:
    try:
        _, wikitext = _wq_fetch_wikitext(movie_title)
        if not wikitext:
            return []
        return _wq_extract_quotes(wikitext, character)
    except Exception:
        return []


def _parse_imdb_quotes_html(soup, character: str) -> list[str]:
    """
    IMDB quotes page structure (2023-2025):
      <div class="ipc-html-content-inner-div">
        <ul>
          <li><a href="...">Character Name</a>: dialogue text here</li>
          ...
        </ul>
      </div>

    Filter to lines whose character <a> tag matches the target.
    """
    char_lower = character.lower().strip()
    char_words = {w for w in re.findall(r"[a-z]{3,}", char_lower)}
    quotes: list[str] = []

    for div in soup.find_all("div", class_="ipc-html-content-inner-div"):
        ul = div.find("ul")
        if not ul:
            continue
        for li in ul.find_all("li"):
            a = li.find("a")
            if not a:
                continue
            char_text = a.get_text(strip=True)
            if not _name_matches(char_text, char_lower, char_words):
                continue
            full_text = li.get_text()
            dialogue  = full_text[len(char_text):].lstrip(":").strip()
            if dialogue and len(dialogue.split()) >= 3:
                quotes.append(dialogue)

    return _dedupe(quotes)


def _dedupe(quotes: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for q in quotes:
        key = q[:80].lower()
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out


# ---------------------------------------------------------------------------
# Step 4: Filter and rank quotes with Claude Haiku
# ---------------------------------------------------------------------------

def _basic_filter(quotes: list[str]) -> list[str]:
    """Remove obviously bad quotes before sending to Claude."""
    out = []
    for q in quotes:
        stripped = q.strip()
        # Pure stage directions
        if re.match(r"^[\[\(]", stripped):
            continue
        # Under 6 words
        if len(stripped.split()) < 6:
            continue
        out.append(q)
    return out


def rank_quotes_with_claude(
    actor: str,
    movie: str,
    year: int,
    character: str,
    quotes: list[str],
) -> list[str]:
    """
    Uses Claude Haiku to filter and rank raw IMDB quotes to the 8-12 best
    for clip-finding. Falls back to basic filtering if Claude fails or
    returns fewer than 5 quotes.
    """
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return _basic_filter(quotes)

    pre_filtered = _basic_filter(quotes)
    if len(pre_filtered) < 5:
        return pre_filtered or quotes

    numbered = "\n".join(f"{i+1}. {q}" for i, q in enumerate(pre_filtered))
    prompt = (
        f"Actor: {actor}\n"
        f"Movie: {movie} ({year})\n"
        f"Character: {character}\n\n"
        f"Here are {len(pre_filtered)} raw IMDB quotes:\n\n"
        f"{numbered}\n\n"
        f"Return the 8-12 best quotes for finding clean YouTube clips, ranked "
        f"most clip-findable first. Prioritize:\n"
        f"- Iconic, widely-recognized lines from this specific movie\n"
        f"- Lines with enough unique words to be searchable on YouTube\n"
        f"- Lines with clear comedic or dramatic energy — not flat exposition\n"
        f"- Lines that are self-contained and make sense without surrounding context\n\n"
        f"Remove:\n"
        f"- Mid-conversation fragments with no standalone meaning\n"
        f'- Generic filler ("That doesn\'t make sense.", "What?", "I know.", "Really?")\n'
        f"- Near-duplicate lines that say the same thing\n\n"
        f"Return a JSON array of the selected quote strings only, in ranked order. "
        f"No other fields, no numbering, no explanation."
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system="You are a film expert and content curator. Respond with valid JSON only, no markdown.",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        ranked = json.loads(raw)
        if isinstance(ranked, list) and len(ranked) >= 5:
            return [q for q in ranked if isinstance(q, str)]
        print(f" [rank: {len(ranked)} returned, using basic filter]", end="")
    except Exception as e:
        print(f" [rank error: {e}]", end="")

    return pre_filtered


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch character quotes from IMDB (via Wayback Machine) and write clips input JSON."
    )
    parser.add_argument("json_file",   help="Path to flat top5.json (MovieEntry array) or existing clips JSON")
    parser.add_argument("--count",     type=int, default=None, help="Process only the first N movies")
    parser.add_argument("--overwrite", action="store_true",    help="Re-fetch movies that already have quotes")
    parser.add_argument("--no-rank",   action="store_true",    help="Skip Claude ranking step, use raw quotes")
    args = parser.parse_args()

    if not os.path.isfile(args.json_file):
        print(f"ERROR: file not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)

    # Verify BeautifulSoup is installed upfront
    try:
        import bs4  # noqa: F401
    except ImportError:
        print("ERROR: beautifulsoup4 not installed. Run: pip install beautifulsoup4", file=sys.stderr)
        sys.exit(1)

    with open(args.json_file, encoding="utf-8") as f:
        raw_data = json.load(f)

    if isinstance(raw_data, list):
        flat_movies = raw_data
        first       = flat_movies[0]
        actor_slug  = first.get("actorSlug") or first.get("actor_slug", "unknown")
        actor_name  = first.get("actorName") or first.get("actor_name", actor_slug)
        subset      = flat_movies[:args.count] if args.count else flat_movies
        clips_data  = {
            "actor_slug": actor_slug,
            "actor_name": actor_name,
            "movies": [
                {
                    "rank":        m.get("rank", i + 1),
                    "movie_title": m.get("movieTitle") or m.get("movie_title", ""),
                    "year":        m.get("year"),
                    "character":   "",
                    "quotes":      [],
                }
                for i, m in enumerate(subset)
            ],
        }
    elif isinstance(raw_data, dict) and "movies" in raw_data:
        clips_data = raw_data
        actor_slug = clips_data["actor_slug"]
        actor_name = clips_data["actor_name"]
        if args.count:
            clips_data["movies"] = clips_data["movies"][:args.count]
    else:
        print("ERROR: JSON must be a flat MovieEntry array or an existing clips JSON", file=sys.stderr)
        sys.exit(1)

    out_dir  = os.path.dirname(os.path.abspath(args.json_file))
    out_path = os.path.join(out_dir, f"{actor_slug}-clips.json")

    # Resume: merge already-fetched quotes from an existing output file
    if os.path.isfile(out_path) and not args.overwrite:
        try:
            with open(out_path, encoding="utf-8") as f:
                existing = json.load(f)
            by_rank = {m["rank"]: m for m in existing.get("movies", [])}
            for m in clips_data["movies"]:
                if m["rank"] in by_rank and by_rank[m["rank"]].get("quotes"):
                    m["character"] = by_rank[m["rank"]].get("character", "")
                    m["quotes"]    = by_rank[m["rank"]]["quotes"]
        except (json.JSONDecodeError, KeyError):
            pass

    print(f"\n{'='*60}")
    print(f"  get_quotes_json  —  {actor_name}")
    rank_label = "raw (--no-rank)" if args.no_rank else "ranked via Claude Haiku"
    print(f"  Source: IMDB via Wayback Machine  |  quotes: {rank_label}")
    print(f"  {len(clips_data['movies'])} movie(s)")
    print(f"{'='*60}")

    for movie in clips_data["movies"]:
        rank  = movie["rank"]
        title = movie["movie_title"]
        year  = movie.get("year") or 0

        if movie.get("quotes") and not args.overwrite:
            print(f"  #{rank}  {title} — {len(movie['quotes'])} quotes  [{movie.get('character', '?')}]  skipping")
            continue

        print(f"  #{rank}  {title} ({year})")

        # Step 1 — character name
        print(f"        character…", end="", flush=True)
        character = get_character_name(actor_name, title, year)
        if not character:
            print(f" FAILED — skipping")
            continue
        print(f" {character}")

        # Step 2 — IMDB ID
        print(f"        imdb id…", end="", flush=True)
        tt_id = get_imdb_id(title, year)
        if not tt_id:
            print(f" not found — add quotes manually")
            movie["character"] = character
            movie["quotes"]    = []
            _save(clips_data, out_path)
            continue
        print(f" {tt_id}")

        # Step 3 — quotes via Wayback Machine, then Wikiquote fallback
        print(f"        imdb quotes…", end="", flush=True)
        quotes = fetch_quotes_imdb(tt_id, character)
        if quotes:
            print(f" {len(quotes)} raw  [imdb]")
        else:
            print(f" none")
            print(f"        wikiquote…", end="", flush=True)
            quotes = fetch_quotes_wikiquote(title, character)
            if quotes:
                print(f" {len(quotes)} raw  [wikiquote]")
            else:
                print(f" none")

        # Step 4 — filter + rank with Claude Haiku
        if quotes and not args.no_rank:
            raw_count = len(quotes)
            print(f"        ranking…", end="", flush=True)
            quotes = rank_quotes_with_claude(actor_name, title, year, character, quotes)
            print(f" {len(quotes)} (filtered from {raw_count})")

        movie["character"] = character
        movie["quotes"]    = quotes

        _save(clips_data, out_path)
        time.sleep(4)  # pause between movies to avoid Wayback Machine rate-limiting

    # Final save
    _save(clips_data, out_path)

    total      = len(clips_data["movies"])
    has_quotes = sum(1 for m in clips_data["movies"] if m.get("quotes"))
    missing    = [m["movie_title"] for m in clips_data["movies"] if not m.get("quotes")]

    print(f"\n{'='*60}")
    print(f"  {has_quotes}/{total} movies have quotes")
    if missing:
        print(f"  No quotes found (retry or check IMDB/Wikiquote coverage):")
        for t in missing:
            print(f"    · {t}")
    print(f"\n  Written: {out_path}")
    print(f"\n  Next steps:")
    print(f"    1. Open {os.path.basename(out_path)}")
    print(f"    2. Reorder quotes[] so the most searchable quotes are first")
    print(f"    3. python scripts/find_clips_json.py {out_path}")
    print(f"{'='*60}\n")


def _save(clips_data: dict, out_path: str) -> None:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(clips_data, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
