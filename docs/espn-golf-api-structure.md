# ESPN PGA Golf API — Structural Analysis

> Based on live requests to `site.api.espn.com` and `sports.core.api.espn.com` on 2026-03-25.
> Event analyzed: **Valspar Championship** (id: `401811938`, STATUS_FINAL).

---

## 1. Scoreboard Endpoint

```
GET https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
    ?dates=YYYYMMDD  (optional, defaults to current/upcoming)
```

### Top-Level Keys

| Key        | Type   | Description |
|------------|--------|-------------|
| `leagues`  | array  | Always length 1 — the PGA TOUR league object |
| `season`   | object | `{ type: 2, year: 2026 }` |
| `day`      | object | `{ date: "2026-03-22" }` |
| `events`   | array  | Tournament(s) for the requested date window (typically 1) |
| `provider` | object | Betting partner info (e.g. DraftKings) |

### `leagues[0]` — League Object

| Key | Type | Example |
|-----|------|---------|
| `id` | string | `"1106"` |
| `name` | string | `"PGA TOUR"` |
| `abbreviation` | string | `"PGA"` |
| `slug` | string | `"pga"` |
| `logos` | array | Two items: default (light) and dark variants, 500×500 |
| `calendar` | array | All 48 events for the season, each `{ id, label, startDate, endDate, event.$ref }` |
| `calendarStartDate` | string | `"2026-01-08T05:00Z"` |
| `calendarEndDate` | string | `"2026-12-06T05:00Z"` |

### `events[i]` — Event/Tournament Object

| Key | Type | Example |
|-----|------|---------|
| `id` | string | `"401811938"` |
| `uid` | string | `"s:1100~l:1106~e:401811938"` |
| `name` | string | `"Valspar Championship"` |
| `shortName` | string | `"Valspar Championship"` |
| `date` | string | `"2026-03-19T04:00Z"` (start) |
| `endDate` | string | `"2026-03-22T04:00Z"` |
| `season` | object | `{ year: 2026, type: 2, slug: "regular-season" }` |
| `competitions` | array | Always length 1 for golf |
| `links` | array | ESPN web URLs (leaderboard page) |
| `status` | object | See Status below |

### `events[i].status`

```json
{
  "type": {
    "id": "3",
    "name": "STATUS_FINAL",
    "state": "post",
    "completed": true,
    "description": "Final"
  }
}
```

Known status types:
- `id: "1"` — `STATUS_SCHEDULED`, `state: "pre"`, `completed: false`
- `id: "2"` — `STATUS_IN_PROGRESS`, `state: "in"`, `completed: false`
- `id: "3"` — `STATUS_FINAL`, `state: "post"`, `completed: true`

### `events[i].competitions[0]` — Competition Object

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Same as event id |
| `date` / `startDate` | string | ISO date |
| `endDate` | string | ISO date |
| `competitors` | array | **All players in the field** (e.g. 135) |
| `status` | object | `{ period: 4, type: { ... } }` — includes `period` (current round) |
| `broadcasts` | array | `[{ market: "national", names: ["ESPN+","CBS","NBC",...] }]` |
| `broadcast` | string | Flat string: `"ESPN+/NBC/Golf Chnl/Peacock"` |
| `geoBroadcasts` | array | Per-network objects with logos |
| `highlights` | array | Video highlights (empty if none) |

### `competitions[0].status` (Competition-level, richer than event-level)

```json
{
  "period": 4,
  "type": {
    "id": "3",
    "name": "STATUS_FINAL",
    "state": "post",
    "completed": true,
    "description": "Final",
    "detail": "Final",
    "shortDetail": "Complete"
  }
}
```

---

## 2. Competitor / Player Structure (Scoreboard)

Path: **`events[i].competitions[0].competitors[j]`**

| Key | Type | Example |
|-----|------|---------|
| `id` | string | `"9037"` (ESPN athlete ID) |
| `uid` | string | `"s:1100~l:1106~a:9037"` |
| `type` | string | Always `"athlete"` |
| `order` | int | **Position/rank** in the tournament (1 = leader) |
| `athlete` | object | See below |
| `score` | string | Overall score to par: `"-11"`, `"+3"`, `"E"` |
| `linescores` | array | Per-round scores (see below) |
| `statistics` | array | Always `[]` in scoreboard response |

### `competitors[j].athlete` (Scoreboard — minimal)

| Key | Type | Example |
|-----|------|---------|
| `fullName` | string | `"Matt Fitzpatrick"` |
| `displayName` | string | `"Matt Fitzpatrick"` |
| `shortName` | string | `"M. Fitzpatrick"` |
| `flag` | object | Country flag image |

```json
{
  "flag": {
    "href": "https://a.espncdn.com/i/teamlogos/countries/500/eng.png",
    "alt": "England",
    "rel": ["country-flag"]
  }
}
```

> **IMPORTANT: No `headshot`, no `id`, no `active` field in the scoreboard athlete object.**
> The athlete `id` is on the *competitor* object, not nested inside `athlete`.

### `competitors[j].linescores` — Round Scores

Array of round objects. Length = number of rounds played (2 for cut players, 4 for finishers).

```json
{
  "value": 68.0,
  "displayValue": "-3",
  "period": 1,
  "linescores": [
    {
      "value": 4.0,
      "displayValue": "4",
      "period": 1,
      "scoreType": { "displayValue": "-1" }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `value` | float | Total strokes for the round (e.g. `68.0`) |
| `displayValue` | string | Score to par for the round (`"-3"`) |
| `period` | int | Round number (1–4) |
| `linescores` | array | 18 hole-by-hole scores |
| `linescores[h].value` | float | Strokes on that hole |
| `linescores[h].displayValue` | string | Strokes as string |
| `linescores[h].period` | int | Hole number (1–18) |
| `linescores[h].scoreType.displayValue` | string | Score relative to par (`"-1"`, `"E"`, `"+1"`) |

Pre-event (not yet started): linescores are stubs with only `{ period: N }` and no scores.

Round count distribution (Valspar):
- 4 rounds: 74 players (made the cut)
- 3 rounds: 1 player
- 2 rounds: 60 players (missed the cut)

---

## 3. Player Photos / Headshots

### Scoreboard Response: **No headshot data included.**

The scoreboard's `athlete` sub-object only contains `fullName`, `displayName`, `shortName`, and `flag`.

### Constructing Headshot URLs

Headshots follow a deterministic URL pattern using the athlete ID:

```
https://a.espncdn.com/i/headshots/golf/players/full/{athleteId}.png
```

Example: `https://a.espncdn.com/i/headshots/golf/players/full/9037.png`

You can resize via ESPN's combiner service:

```
https://a.espncdn.com/combiner/i?img=/i/headshots/golf/players/full/9037.png&w=96&h=70
```

### Individual Athlete Endpoint (for full headshot + bio data)

```
GET https://site.api.espn.com/apis/common/v3/sports/golf/pga/athletes/{athleteId}
```

Response at `athlete.headshot`:

```json
{
  "href": "https://a.espncdn.com/i/headshots/golf/players/full/9037.png",
  "alt": "Matt Fitzpatrick"
}
```

**No multiple sizes/labels** — only a single `full` resolution image is provided. Use the combiner service for resizing.

### Country Flag Images

Available on every competitor in the scoreboard at `athlete.flag.href`:

```
https://a.espncdn.com/i/teamlogos/countries/500/{countryCode}.png
```

---

## 4. Active Status on Athletes

### Scoreboard: **No active/status field on athletes.**

### Individual Athlete API (`/apis/common/v3/...`)

Path: **`athlete.status`**

```json
{
  "id": "1",
  "name": "Active",
  "type": "active",
  "abbreviation": "Active"
}
```

Also: **`athlete.active`** = `true` (boolean)

### Core Athlete API (`sports.core.api.espn.com`)

```
GET https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/{id}
```

Same fields available:
- `status.type` = `"active"`, `status.name` = `"Active"`
- `active` = `true` (boolean at top level)

---

## 5. Core API (sports.core.api.espn.com) — Richer Data

The scoreboard is a "site" API that inlines data. The **core API** uses `$ref` links and exposes richer sub-resources.

### Competitors List

```
GET https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/{eventId}/competitions/{eventId}/competitors?limit=N
```

Each competitor item:

```json
{
  "id": "9037",
  "uid": "s:1100~l:1106~a:9037",
  "type": "athlete",
  "order": 1,
  "athlete": { "$ref": "...athletes/9037" },
  "status": { "$ref": "...competitors/9037/status" },
  "score": { "$ref": "...competitors/9037/score" },
  "linescores": { "$ref": "...competitors/9037/linescores" },
  "statistics": { "$ref": "...competitors/9037/statistics" },
  "movement": -3,
  "amateur": false
}
```

Extra fields vs scoreboard: **`movement`** (leaderboard position change) and **`amateur`** (boolean).

### Competitor Status (Event-Level)

```
GET .../competitors/{athleteId}/status
```

```json
{
  "period": 4,
  "type": {
    "id": "2",
    "name": "STATUS_FINISH",
    "state": "post",
    "completed": true,
    "description": "Finish",
    "detail": "Finish",
    "shortDetail": "F"
  },
  "displayValue": "F",
  "teeTime": "2026-03-22T17:30Z",
  "hole": 18,
  "startHole": 1,
  "position": {
    "id": "1",
    "displayName": "1",
    "isTie": false
  },
  "thru": 18,
  "playoff": false
}
```

| Field | Description |
|-------|-------------|
| `position.displayName` | Finishing position as string (`"1"`, `"T5"`, etc.) |
| `position.isTie` | Whether the position is a tie |
| `teeTime` | ISO timestamp of tee time |
| `hole` | Current/last hole |
| `startHole` | Starting hole (1 or 10 for split tees) |
| `thru` | Holes completed |
| `playoff` | Boolean |

### Competitor Score

```
GET .../competitors/{athleteId}/score
```

```json
{
  "value": 273.0,
  "displayValue": "-11",
  "completedRoundsValue": 273.0,
  "completedRoundsDisplayValue": "-11"
}
```

### Core Linescores (Richer)

Same structure as scoreboard but with **additional `scoreType` fields**:

```json
{
  "scoreType": {
    "name": "BIRDIE",
    "displayName": "Birdie",
    "displayValue": "-1"
  },
  "par": 5
}
```

Score type names: `PAR`, `BIRDIE`, `EAGLE`, `BOGEY`, `DOUBLE_BOGEY`, etc. Core API also includes `par` per hole.

### Core Event Object

```
GET https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/{eventId}
```

Extra fields beyond scoreboard:

| Key | Type | Example |
|-----|------|---------|
| `purse` | float | `9100000.0` |
| `displayPurse` | string | `"$9,100,000"` |
| `courses` | array | Course objects with `name`, `totalYards`, `shotsToPar`, `address` |
| `venues` | array | Venue refs |
| `defendingChampion` | object | Athlete ref with name |
| `winner` | object | Athlete ref with name |
| `playoffType` | object | `{ id, description, minimumHoles }` |
| `hasPlayerStats` | bool | `true` |
| `hasCourseStats` | bool | `true` |
| `isSignature` | bool | Whether it's a "Signature Event" |

### Core Athlete Object

```
GET https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/athletes/{id}
```

Full player profile with:

| Key | Type | Example |
|-----|------|---------|
| `id` | string | `"9037"` |
| `firstName` / `lastName` | string | `"Matt"` / `"Fitzpatrick"` |
| `displayName` | string | `"Matt Fitzpatrick"` |
| `shortName` | string | `"M. Fitzpatrick"` |
| `headshot.href` | string | `"https://a.espncdn.com/i/headshots/golf/players/full/9037.png"` |
| `flag.href` | string | `"https://a.espncdn.com/i/teamlogos/countries/500/eng.png"` |
| `active` | bool | `true` |
| `status.type` | string | `"active"` |
| `age` | int | `31` |
| `displayHeight` | string | `"5' 10\""` |
| `displayWeight` | string | `"155 lbs"` |
| `dateOfBirth` | string | `"1994-09-01T07:00Z"` |
| `debutYear` | int | `2013` |
| `turnedPro` | int | `2014` |
| `amateur` | bool | `false` |
| `hand` | object | `{ type: "RIGHT", displayValue: "Right" }` |
| `birthPlace` | object | `{ city, country, countryAbbreviation }` |
| `college` | `$ref` | Links to college endpoint |
| `experience.years` | int | Years on tour |

---

## 6. Summary Endpoint

```
GET https://site.api.espn.com/apis/site/v2/sports/golf/pga/summary?event={eventId}
```

> **Note**: This endpoint returned `500 Internal Server Error` for all tested 2026 events (both completed and upcoming) as of 2026-03-25. It may be intermittently available or deprecated in favor of the core API sub-resources.

---

## 7. Quick Reference — Common Data Paths

| What | Scoreboard Path | Core API Path |
|------|----------------|---------------|
| Tournament name | `events[i].name` | same |
| Tournament status | `events[i].status.type.state` | same |
| Is completed? | `events[i].status.type.completed` | same |
| Current round | `events[i].competitions[0].status.period` | same |
| Player list | `events[i].competitions[0].competitors` | `.../competitors?limit=N` |
| Player ESPN ID | `competitors[j].id` | same |
| Player name | `competitors[j].athlete.displayName` | resolved from `$ref` |
| Player rank/position | `competitors[j].order` | same + `status.position.displayName` |
| Overall score | `competitors[j].score` (string like `"-11"`) | `score.displayValue` |
| Round scores | `competitors[j].linescores[r].displayValue` | same |
| Hole-by-hole | `competitors[j].linescores[r].linescores[h]` | same + `par` field |
| Country flag | `competitors[j].athlete.flag.href` | same |
| Player headshot | **Not in scoreboard** — construct URL | `athlete.headshot.href` |
| Player active status | **Not in scoreboard** | `athlete.active` / `athlete.status.type` |
| Position + tie | **Not in scoreboard** | `competitor status → position.displayName`, `isTie` |
| Tee time | **Not in scoreboard** | `competitor status → teeTime` |
| Movement | **Not in scoreboard** | `competitor → movement` (int) |
| Purse | **Not in scoreboard** | `event → purse` / `displayPurse` |
| Course info | **Not in scoreboard** | `event → courses[0]` |

---

## 8. Image Sizes / Labels

ESPN's golf API provides **one image size** for headshots:

| Image Type | Label | URL Pattern | Size |
|------------|-------|------------|------|
| Player headshot | `full` | `https://a.espncdn.com/i/headshots/golf/players/full/{id}.png` | ~600×436 (varies) |
| Country flag | `country-flag` | `https://a.espncdn.com/i/teamlogos/countries/500/{code}.png` | 500×500 |
| League logo (default) | `full, default` | `https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/pgatour.png` | 500×500 |
| League logo (dark) | `full, dark` | `https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500-dark/pgatour.png` | 500×500 |

For custom sizes, use the ESPN combiner:
```
https://a.espncdn.com/combiner/i?img=/i/headshots/golf/players/full/{id}.png&w={width}&h={height}
```

There are **no named size variants** (small/medium/large) — only `full` is served natively. Resizing is done client-side via the combiner URL.
