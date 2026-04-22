// Clip Review Server
//
// Serves the clip review UI and provides API endpoints for:
// - Listing available actors (scans public/data/ for -clips.json files)
// - Loading/saving clips JSON
// - Serving video files from public/data/clips/
// - Trimming clips via ffmpeg
//
// Run: npm run server (starts on port 3040)

import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 3050;
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DATA_DIR = path.join(REPO_ROOT, "public/data");
const CLIPS_DIR = path.join(DATA_DIR, "clips");
const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";

const app = express();
app.use(cors());
app.use(express.json());

// Serve video clips
app.use("/clips", express.static(CLIPS_DIR));

// --- API: List available actors ---
app.get("/api/actors", async (req, res) => {
  try {
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const actors = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "clips" || entry.name === "transcripts") continue;

      const actorDir = path.join(DATA_DIR, entry.name);
      const clipsJsonPath = path.join(actorDir, `${entry.name}-clips.json`);

      try {
        await fs.access(clipsJsonPath);
        const content = await fs.readFile(clipsJsonPath, "utf-8");
        const data = JSON.parse(content);
        
        const movieCount = data.movies?.length || 0;
        // "done" = user saved a choice that has a local clip file (downloaded in UI or --auto-download)
        const doneCount = data.movies?.filter((m) => {
          const i = m.selected_candidate_index;
          if (i === undefined || i === null) return false;
          return !!(m.candidates && m.candidates[i]?.clip_filename);
        })?.length || 0;

        actors.push({
          slug: entry.name,
          name: data.actor_name || entry.name,
          movieCount,
          doneCount,
          clipsJsonPath: `${entry.name}/${entry.name}-clips.json`,
        });
      } catch {
        // No clips.json in this folder, skip
      }
    }

    actors.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ actors });
  } catch (err) {
    console.error("Error listing actors:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- API: Load clips JSON for an actor ---
app.get("/api/clips/:slug", async (req, res) => {
  const { slug } = req.params;
  const clipsJsonPath = path.join(DATA_DIR, slug, `${slug}-clips.json`);

  try {
    const content = await fs.readFile(clipsJsonPath, "utf-8");
    const data = JSON.parse(content);
    res.json(data);
  } catch (err) {
    console.error(`Error loading clips for ${slug}:`, err);
    res.status(404).json({ error: `Clips not found for ${slug}` });
  }
});

// --- API: Save clips JSON for an actor ---
app.put("/api/clips/:slug", async (req, res) => {
  const { slug } = req.params;
  const clipsJsonPath = path.join(DATA_DIR, slug, `${slug}-clips.json`);

  try {
    const content = JSON.stringify(req.body, null, 2) + "\n";
    await fs.writeFile(clipsJsonPath, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    console.error(`Error saving clips for ${slug}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// --- API: Trim a clip ---
app.post("/api/trim", async (req, res) => {
  const { sourceFilename, startSeconds, duration, outputFilename } = req.body;

  if (!sourceFilename || startSeconds == null || !duration || !outputFilename) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const inputPath = path.join(CLIPS_DIR, sourceFilename);
  const outputPath = path.join(CLIPS_DIR, outputFilename);

  try {
    await fs.access(inputPath);
  } catch {
    return res.status(404).json({ error: `Source file not found: ${sourceFilename}` });
  }

  const args = [
    "-y",
    "-ss", String(startSeconds),
    "-i", inputPath,
    "-t", String(duration),
    "-c:v", "libx264",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ];

  const ffmpeg = spawn("ffmpeg", args);
  let stderr = "";

  ffmpeg.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  ffmpeg.on("close", (code) => {
    if (code === 0) {
      res.json({ ok: true, outputFilename });
    } else {
      console.error("ffmpeg error:", stderr.slice(-500));
      res.status(500).json({ error: "ffmpeg failed", details: stderr.slice(-500) });
    }
  });

  ffmpeg.on("error", (err) => {
    console.error("ffmpeg spawn error:", err);
    res.status(500).json({ error: err.message });
  });
});

// --- API: Get video metadata (duration) ---
app.get("/api/video-info/:filename", async (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(CLIPS_DIR, filename);

  try {
    await fs.access(videoPath);
  } catch {
    return res.status(404).json({ error: `File not found: ${filename}` });
  }

  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=duration",
    "-of", "json",
    videoPath,
  ];

  const ffprobe = spawn("ffprobe", args);
  let stdout = "";
  let stderr = "";

  ffprobe.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  ffprobe.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  ffprobe.on("close", (code) => {
    if (code === 0) {
      try {
        const info = JSON.parse(stdout);
        const duration = parseFloat(info.streams?.[0]?.duration) || 0;
        res.json({ duration });
      } catch {
        res.status(500).json({ error: "Failed to parse ffprobe output" });
      }
    } else {
      res.status(500).json({ error: "ffprobe failed", details: stderr });
    }
  });

  ffprobe.on("error", (err) => {
    res.status(500).json({ error: err.message });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a movie title for fuzzy matching (lowercase, alphanumeric only) */
function normalizeTitle(title = "") {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Slugify a movie title for use in URLs */
function slugify(title = "") {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Format seconds as "M:SS" */
function formatStartTime(seconds = 0) {
  const totalSecs = Math.floor(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// API: Finalize — merge reviewed clip data into top5.json
// ---------------------------------------------------------------------------
app.post("/api/finalize/:slug", async (req, res) => {
  const { slug } = req.params;
  const actorDir = path.join(DATA_DIR, slug);
  const clipsPath = path.join(actorDir, `${slug}-clips.json`);
  const top5Path = path.join(actorDir, "top5.json");

  try {
    // Load clips JSON (source of truth for user selections)
    const clipsRaw = await fs.readFile(clipsPath, "utf-8");
    const clipsData = JSON.parse(clipsRaw);

    // Load existing top5.json (has static metadata: tmdbId, description, localFilename, etc.)
    let top5 = [];
    try {
      const top5Raw = await fs.readFile(top5Path, "utf-8");
      top5 = JSON.parse(top5Raw);
    } catch {
      // No top5.json yet — we'll build from scratch with what we have
    }

    // Build lookup: normalizedTitle → top5 entry index
    const top5IndexMap = new Map();
    for (let i = 0; i < top5.length; i++) {
      top5IndexMap.set(normalizeTitle(top5[i].movieTitle), i);
    }

    let updatedCount = 0;

    for (const movie of clipsData.movies) {
      if (movie.selected_candidate_index === undefined || movie.selected_candidate_index === null) continue;

      const candidate = (movie.candidates ?? [])[movie.selected_candidate_index];
      if (!candidate) continue;

      const key = normalizeTitle(movie.movie_title);
      let idx = top5IndexMap.get(key);

      if (idx === undefined) {
        // Movie not in top5.json yet — create a new entry with available data
        const newEntry = {
          actorName: clipsData.actor_name,
          actorSlug: clipsData.actor_slug,
          rank: movie.rank,
          movieTitle: movie.movie_title,
          movieSlug: slugify(movie.movie_title),
          localFilename: `${movie.rank}.jpg`,
          year: movie.year,
          tmdbId: null,
          tmdb_description: null,
          yt_url: null,
          start_time: null,
          duration: null,
          brightness: null,
        };
        idx = top5.length;
        top5.push(newEntry);
        top5IndexMap.set(key, idx);
      }

      const entry = top5[idx];

      // Calculate effective start_time and duration from trim points if set
      let effectiveDuration = candidate.duration ?? null;
      let effectiveStartTime = candidate.start_time ?? null;

      if (candidate.trim_in !== undefined && candidate.trim_out !== undefined) {
        // Round to 2 decimal places — Remotion requires integer frames so keep precision
        // reasonable; Root.tsx rounds seconds*fps to an integer.
        effectiveDuration = Math.round((candidate.trim_out - candidate.trim_in) * 100) / 100;
        effectiveStartTime = formatStartTime(candidate.trim_in);
      } else if (effectiveDuration !== null) {
        effectiveDuration = Math.round(effectiveDuration * 100) / 100;
      }

      // Apply the reviewed clip data — these are the only fields we overwrite
      entry.rank = movie.rank;
      entry.clipped_video = candidate.clip_filename;
      entry.yt_url = candidate.yt_url ?? entry.yt_url;
      entry.start_time = effectiveStartTime;
      // trim_in: raw seconds offset for OffthreadVideo startFrom (more precise than start_time string)
      entry.trim_in = candidate.trim_in !== undefined ? candidate.trim_in : null;
      entry.duration = effectiveDuration;
      entry.brightness = candidate.brightness ?? null;
      if (candidate.volume !== undefined) {
        entry.volume = candidate.volume;
      }

      updatedCount++;
    }

    // Re-sort by rank so the JSON is clean
    top5.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

    await fs.writeFile(top5Path, JSON.stringify(top5, null, 2) + "\n", "utf-8");

    // Mirror to the root public/data/top5.json that Remotion reads
    const globalTop5Path = path.join(DATA_DIR, "top5.json");
    await fs.copyFile(top5Path, globalTop5Path);

    // Kick off transcription in the background (trim-aware — only re-runs if trim changed)
    const scriptPath = path.join(REPO_ROOT, "scripts", "transcribe_clips.py");
    const python = process.platform === "win32" ? "python" : "python3";
    const transcribeProc = spawn(python, [scriptPath, top5Path], {
      env: { ...process.env },
      detached: false,
    });

    let transcribeLog = "";
    transcribeProc.stdout.on("data", (d) => { transcribeLog += d.toString(); });
    transcribeProc.stderr.on("data", (d) => { transcribeLog += d.toString(); });
    transcribeProc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[transcribe] exited ${code}:\n${transcribeLog}`);
      } else {
        console.log(`[transcribe] done for ${slug}\n${transcribeLog}`);
      }
    });
    transcribeProc.on("error", (err) => {
      console.error(`[transcribe] spawn error:`, err.message);
    });

    res.json({
      ok: true,
      updatedMovies: updatedCount,
      totalMovies: top5.length,
      transcribing: true,
    });
  } catch (err) {
    console.error("Finalize error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

/** Wrap spawn in a Promise. Resolves with { code, stdout, stderr }. */
function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, opts);
    let stdout = "";
    let stderr = "";
    if (proc.stdout) proc.stdout.on("data", (d) => { stdout += d.toString(); });
    if (proc.stderr) proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
    proc.on("error", reject);
  });
}

/** Extract YouTube video ID from a URL. */
function extractVideoId(url = "") {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** First free filename in series ACTOR_1.mp4, ACTOR_1_v2.mp4, … (matches find_clips_json). */
async function nextAvailableClipName(slug, rank) {
  const stem = `${slug.toUpperCase().replace(/-/g, "_")}_${rank}`;
  const names = [`${stem}.mp4`];
  for (let n = 2; n < 30; n++) names.push(`${stem}_v${n}.mp4`);
  for (const name of names) {
    const full = path.join(CLIPS_DIR, name);
    try {
      await fs.access(full);
    } catch {
      return name;
    }
  }
  return `${stem}_yt_${Date.now()}.mp4`;
}

// ---------------------------------------------------------------------------
// API: Download & clip a pipeline candidate in place (same row in -clips.json)
// ---------------------------------------------------------------------------
app.post("/api/download-candidate/:slug/:rank/:index", async (req, res) => {
  const { slug, rank: rankStr, index: indexStr } = req.params;
  const { start_seconds, duration } = req.body;
  const rank = parseInt(rankStr, 10);
  const candidateIndex = parseInt(indexStr, 10);

  if (start_seconds == null || duration == null) {
    return res.status(400).json({ error: "Missing start_seconds or duration" });
  }
  if (isNaN(rank) || isNaN(candidateIndex) || candidateIndex < 0) {
    return res.status(400).json({ error: "Invalid rank or index" });
  }

  const clipsJsonPath = path.join(DATA_DIR, slug, `${slug}-clips.json`);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dl-cand-"));

  try {
    const clipsRaw = await fs.readFile(clipsJsonPath, "utf-8");
    const clipsData = JSON.parse(clipsRaw);
    const movieIdx = clipsData.movies.findIndex((m) => m.rank === rank);
    if (movieIdx === -1) {
      return res.status(404).json({ error: `Movie rank ${rank} not found` });
    }

    const movie = clipsData.movies[movieIdx];
    const list = movie.candidates ?? [];
    if (candidateIndex >= list.length) {
      return res.status(400).json({ error: "Candidate index out of range" });
    }

    const orig = list[candidateIndex];
    if (!orig?.yt_url) {
      return res.status(400).json({ error: "Candidate has no yt_url" });
    }

    const outFilename = await nextAvailableClipName(slug, rank);
    const outPath = path.join(CLIPS_DIR, outFilename);

    const tmpBase = path.join(tmpDir, "video");
    const dlResult = await spawnAsync(YT_DLP, [
      "--no-warnings", "--quiet",
      "-f", "bestvideo[height>=1080]+bestaudio/bestvideo[height>=720]+bestaudio/bestvideo+bestaudio/best",
      "--merge-output-format", "mkv",
      "-o", `${tmpBase}.%(ext)s`,
      orig.yt_url,
    ]);

    if (dlResult.code !== 0) {
      return res.status(500).json({ error: "yt-dlp download failed", details: dlResult.stderr.slice(-500) });
    }

    let downloadedPath = null;
    for (const ext of ["mkv", "mp4", "webm"]) {
      const p = `${tmpBase}.${ext}`;
      try { await fs.access(p); downloadedPath = p; break; } catch { /* next */ }
    }
    if (!downloadedPath) {
      return res.status(500).json({ error: "Downloaded file not found" });
    }

    await fs.mkdir(CLIPS_DIR, { recursive: true });
    const ffResult = await spawnAsync("ffmpeg", [
      "-y",
      "-ss", String(start_seconds),
      "-i", downloadedPath,
      "-t", String(duration),
      "-c:v", "libx264",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ]);

    if (ffResult.code !== 0) {
      return res.status(500).json({ error: "ffmpeg failed", details: ffResult.stderr.slice(-500) });
    }

    const updated = {
      ...orig,
      start_seconds: Number(start_seconds),
      start_time: formatStartTime(Number(start_seconds)),
      duration: Number(duration),
      clip_status: "success",
      clip_filename: outFilename,
    };
    list[candidateIndex] = updated;
    movie.candidates = list;

    await fs.writeFile(clipsJsonPath, JSON.stringify(clipsData, null, 2) + "\n", "utf-8");

    res.json({ ok: true, candidate: updated });
  } catch (err) {
    console.error("[download-candidate] error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

// ---------------------------------------------------------------------------
// API: Add a clip from a YouTube URL (manual entry in the dashboard)
// ---------------------------------------------------------------------------
app.post("/api/add-clip/:slug/:movieRank", async (req, res) => {
  const { slug, movieRank } = req.params;
  const { yt_url, start_seconds, duration } = req.body;

  if (!yt_url || start_seconds == null || !duration) {
    return res.status(400).json({ error: "Missing required fields: yt_url, start_seconds, duration" });
  }

  const rank = parseInt(movieRank, 10);
  if (isNaN(rank)) {
    return res.status(400).json({ error: "Invalid movieRank — must be an integer" });
  }

  const clipsJsonPath = path.join(DATA_DIR, slug, `${slug}-clips.json`);
  const timestamp = Date.now();
  const actorBase = slug.toUpperCase().replace(/-/g, "_");
  const outFilename = `${actorBase}_${rank}_custom_${timestamp}.mp4`;
  const outPath = path.join(CLIPS_DIR, outFilename);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "add-clip-"));

  try {
    // Step 1: Get video title/metadata (fast — no download)
    let ytTitle = yt_url;
    let ytDurationSeconds = null;
    try {
      const infoResult = await spawnAsync(YT_DLP, [
        "--no-warnings", "--quiet",
        "--print", "%(title)s|%(duration)s",
        yt_url,
      ]);
      if (infoResult.code === 0) {
        const [titlePart, durPart] = infoResult.stdout.trim().split("|");
        if (titlePart) ytTitle = titlePart;
        if (durPart && !isNaN(parseInt(durPart, 10))) ytDurationSeconds = parseInt(durPart, 10);
      }
    } catch (e) {
      console.warn("[add-clip] metadata fetch failed:", e.message);
    }

    // Step 2: Download full video with yt-dlp
    const tmpBase = path.join(tmpDir, "video");
    const dlResult = await spawnAsync(YT_DLP, [
      "--no-warnings", "--quiet",
      "-f", "bestvideo[height>=1080]+bestaudio/bestvideo[height>=720]+bestaudio/bestvideo+bestaudio/best",
      "--merge-output-format", "mkv",
      "-o", `${tmpBase}.%(ext)s`,
      yt_url,
    ]);

    if (dlResult.code !== 0) {
      return res.status(500).json({ error: "yt-dlp download failed", details: dlResult.stderr.slice(-500) });
    }

    // Find downloaded file
    let downloadedPath = null;
    for (const ext of ["mkv", "mp4", "webm"]) {
      const p = `${tmpBase}.${ext}`;
      try { await fs.access(p); downloadedPath = p; break; } catch { /* try next */ }
    }
    if (!downloadedPath) {
      return res.status(500).json({ error: "Downloaded file not found after yt-dlp" });
    }

    // Step 3: Cut the clip with ffmpeg
    await fs.mkdir(CLIPS_DIR, { recursive: true });
    const ffResult = await spawnAsync("ffmpeg", [
      "-y",
      "-ss", String(start_seconds),
      "-i", downloadedPath,
      "-t", String(duration),
      "-c:v", "libx264",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outPath,
    ]);

    if (ffResult.code !== 0) {
      return res.status(500).json({ error: "ffmpeg failed", details: ffResult.stderr.slice(-500) });
    }

    // Step 4: Build new candidate object
    const newCandidate = {
      yt_url,
      yt_video_id: extractVideoId(yt_url),
      yt_title: ytTitle,
      yt_duration_seconds: ytDurationSeconds,
      score: 100,
      adjusted_score: 100,
      start_seconds: Number(start_seconds),
      start_time: formatStartTime(Number(start_seconds)),
      duration: Number(duration),
      matched_quote: "",
      matched_text: "[manual entry]",
      match_method: "manual",
      clip_status: "success",
      clip_filename: outFilename,
    };

    // Step 5: Prepend to movie.candidates in clips.json
    const clipsRaw = await fs.readFile(clipsJsonPath, "utf-8");
    const clipsData = JSON.parse(clipsRaw);

    const movieIdx = clipsData.movies.findIndex((m) => m.rank === rank);
    if (movieIdx === -1) {
      return res.status(404).json({ error: `Movie with rank ${rank} not found` });
    }

    clipsData.movies[movieIdx].candidates = [
      newCandidate,
      ...(clipsData.movies[movieIdx].candidates ?? []),
    ];

    // Shift selected_candidate_index if one was set (we prepended, so all indices shift +1)
    const prev = clipsData.movies[movieIdx].selected_candidate_index;
    if (prev !== undefined && prev !== null) {
      clipsData.movies[movieIdx].selected_candidate_index = prev + 1;
    }

    await fs.writeFile(clipsJsonPath, JSON.stringify(clipsData, null, 2) + "\n", "utf-8");

    res.json({ ok: true, candidate: newCandidate });
  } catch (err) {
    console.error("[add-clip] error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});

app.listen(PORT, () => {
  console.log(`\n  Clip Review server running at http://localhost:${PORT}\n`);
  console.log(`  Data directory: ${DATA_DIR}`);
  console.log(`  Clips directory: ${CLIPS_DIR}\n`);
});
