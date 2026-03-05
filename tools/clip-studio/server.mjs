/**
 * Clip Studio — server + CLI entrypoint
 *
 * How to run (from repo root):
 *   npm run clips:install        # install deps (once)
 *   npm run clips:dev            # start UI at http://localhost:3037
 *
 * Or manually:
 *   cd tools/clip-studio && npm install
 *   npm run dev                  # http://localhost:3037
 *
 * CLI usage:
 *   npm run search -- "funny cats"
 *   npm run download -- "dQw4w9WgXcQ"
 *   npm run clip -- --id dQw4w9WgXcQ --start 10 --duration 30
 *   npm run clip -- --id dQw4w9WgXcQ --start 10 --duration 30 --w 1080 --h 1920  # with crop
 */

import path from "node:path";
import fs from "node:fs/promises";
import express from "express";

import { repoRoot, absMediaRaw, absMediaOut, ensureDir, relFromRoot } from "./lib/paths.mjs";
import { slugify, parseTime, safeJson, validateId, validateDimension } from "./lib/util.mjs";
import { searchFlat, enrichDurations, downloadMp4 } from "./lib/yt.mjs";
import { clipAndCrop } from "./lib/ffmpeg.mjs";
import { upsertItem } from "./lib/manifest.mjs";

// ─── CLI dispatch ──────────────────────────────────────────────────────────────

const subcommand = process.argv[2];

if (subcommand === "search") {
  const query = process.argv.slice(3).join(" ");
  if (!query) {
    console.error("Usage: node server.mjs search <query>");
    process.exit(1);
  }
  try {
    let results = await searchFlat(query);
    results = await enrichDurations(results);
    console.log(JSON.stringify({ results }, null, 2));
  } catch (err) {
    console.error("Search failed:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

if (subcommand === "download") {
  const id = process.argv[3];
  if (!id) {
    console.error("Usage: node server.mjs download <videoId>");
    process.exit(1);
  }
  try {
    validateId(id);
    const absPath = await downloadMp4(id);
    const rawPath = relFromRoot(absPath);
    console.log(JSON.stringify({ ok: true, rawPath }, null, 2));
  } catch (err) {
    console.error("Download failed:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

if (subcommand === "clip") {
  const args = process.argv.slice(3);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];
    if (key === "--id") { opts.id = val; i++; }
    else if (key === "--start") { opts.start = val; i++; }
    else if (key === "--end") { opts.end = val; i++; }
    else if (key === "--duration") { opts.duration = val; i++; }
    else if (key === "--w") { opts.targetW = val; i++; }
    else if (key === "--h") { opts.targetH = val; i++; }
    else if (key === "--name") { opts.name = val; i++; }
  }
  if (!opts.id || opts.start == null) {
    console.error("Usage: node server.mjs clip --id <id> --start <s> [--end <e>] [--duration <d>] [--w <W>] [--h <H>] [--name <n>]");
    process.exit(1);
  }
  try {
    const result = await handleClip(opts);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Clip failed:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

// ─── Shared clip logic (used by both CLI and HTTP) ─────────────────────────────

async function handleClip({ id, start, end, duration, targetW, targetH, mode, name }) {
  validateId(id);
  const tw = targetW ? validateDimension(targetW, "targetW") : null;
  const th = targetH ? validateDimension(targetH, "targetH") : null;
  const doCrop = tw != null && th != null;

  const inputAbs = path.join(absMediaRaw(), `${id}.mp4`);
  try {
    await fs.access(inputAbs);
  } catch {
    const err = new Error("Download first — source file not found");
    err.statusCode = 400;
    throw err;
  }

  await ensureDir(absMediaOut());

  const baseName = slugify(name || id) || id;
  let outName = `${baseName}.mp4`;
  let outAbs = path.join(absMediaOut(), outName);

  // Collision avoidance
  let counter = 1;
  while (true) {
    try {
      await fs.access(outAbs);
      outName = `${baseName}-${counter}.mp4`;
      outAbs = path.join(absMediaOut(), outName);
      counter++;
    } catch {
      break;
    }
  }

  const parsedDuration = duration != null ? Number(duration) : null;
  const parsedEnd = end != null ? (Number.isFinite(Number(end)) ? Number(end) : end) : null;
  const parsedStart = Number.isFinite(Number(start)) ? Number(start) : start;

  await clipAndCrop({
    inputAbs,
    outAbs,
    start: parsedStart,
    end: parsedEnd,
    duration: parsedDuration,
    targetW: doCrop ? tw : null,
    targetH: doCrop ? th : null,
  });

  const outPath = relFromRoot(outAbs);

  await upsertItem({
    id,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    title: name || id,
    rawPath: `media/raw/${id}.mp4`,
    clip: {
      start: parsedStart,
      end: parsedEnd,
      duration: parsedDuration,
      targetW: tw,
      targetH: th,
      mode: doCrop ? (mode || "centerCrop") : null,
    },
    outPath,
    createdAt: new Date().toISOString(),
  });

  return { ok: true, outPath, manifestUpdated: true };
}

// ─── HTTP server ───────────────────────────────────────────────────────────────

if (!subcommand) {
  const app = express();
  const PORT = 3037;

  app.use(express.json());

  // Serve frontend
  app.use(express.static(path.resolve(import.meta.dirname, "public")));

  // Serve media files for preview (raw downloads + output clips)
  app.use("/media", express.static(path.join(repoRoot, "media")));
  app.use("/assets/media", express.static(path.join(repoRoot, "public", "assets", "media")));

  // --- API routes ---

  app.get("/api/search", async (req, res) => {
    const q = req.query.q;
    if (!q) return safeJson(res, 400, { error: "Missing query parameter ?q=" });

    try {
      let results = await searchFlat(String(q));
      results = await enrichDurations(results);
      safeJson(res, 200, { results });
    } catch (err) {
      console.error("Search error:", err.message);
      safeJson(res, 500, { error: err.message });
    }
  });

  app.post("/api/download", async (req, res) => {
    const { id } = req.body || {};
    try {
      validateId(id);
      const absPath = await downloadMp4(id);
      const rawPath = relFromRoot(absPath);
      safeJson(res, 200, { ok: true, rawPath });
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Download error:", err.message);
      safeJson(res, status, { error: err.message });
    }
  });

  app.post("/api/clip", async (req, res) => {
    try {
      const result = await handleClip(req.body || {});
      safeJson(res, 200, result);
    } catch (err) {
      const status = err.statusCode || 500;
      console.error("Clip error:", err.message);
      safeJson(res, status, { error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`\n  Clip Studio running at http://localhost:${PORT}\n`);
  });
}
