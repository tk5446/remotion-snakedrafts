# CLAUDE.md — remotion-snakedrafts
Remotion video generation — social media videos for SnakeDrafts content engine.
Early stage repo. Not yet in production.

## How This Repo Works
- Remotion renders React components to video
- Source content comes from YT listicles and snakedrafts.app pages
- Output videos are used for IG posting engine (2 posts/day target)
- Currently scaffolded only — no production pipeline yet

## Tech Stack
- Remotion
- React + TypeScript

## Useful Commands
- npm i              → install dependencies
- npm run dev        → start Remotion preview
- npx remotion render → render a video
- npx remotion upgrade → upgrade Remotion

## Cross-Repo Context
See ../shared-docs/README.md for types and cross-platform patterns.
Content source: snakedrafts-static listicles and movie pages.

---

## Rules

### NEVER (no exceptions)
- Delete any video template or composition file without approval
- Run npx remotion render for long batch jobs without Tom's approval
  (rendering is CPU-intensive and can run for a long time)

### ASK FIRST
- Adding new video compositions or templates
- Installing new dependencies
- Any change to render output format or resolution
- Integrating with external APIs or services

### AUTONOMOUS (no approval needed)
- Reading and analysing any file in the repo
- Editing existing video compositions and components
- Creating feature branches
- Running npm run dev to preview changes
- Suggesting new template ideas and scaffolding them

---

## Branch Strategy
- main → source of truth
- feature/* → all new work, PR to main
- Lower risk than other repos — not yet in production

## Current Priority
Early stage. Main goal is building reusable video templates for the
IG content engine. Focus on: listicle → video template first.
