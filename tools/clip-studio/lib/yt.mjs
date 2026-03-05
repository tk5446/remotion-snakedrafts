import path from "node:path";
import fs from "node:fs/promises";
import { runCmd, validateId } from "./util.mjs";
import { absMediaRaw, ensureDir } from "./paths.mjs";

function thumbUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
function thumbMaxUrl(id) {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}
function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Fast flat-playlist search via yt-dlp. Returns [{id, title, url, thumbnail, thumbnailMax}].
 */
export async function searchFlat(query, limit = 10) {
  const { stdout } = await runCmd("yt-dlp", [
    "--flat-playlist",
    "--print",
    "%(id)s\t%(title)s",
    `ytsearch${limit}:${query}`,
  ]);

  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("\t");
      if (idx === -1) return null;
      const id = line.slice(0, idx).trim();
      const title = line.slice(idx + 1).trim();
      if (!id) return null;
      return {
        id,
        title,
        url: watchUrl(id),
        thumbnail: thumbUrl(id),
        thumbnailMax: thumbMaxUrl(id),
      };
    })
    .filter(Boolean);
}

/**
 * Simple concurrency-limited promise pool.
 */
async function poolMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Enrich items with duration + durationString. Failures per-item set nulls.
 */
export async function enrichDurations(items, concurrency = 3) {
  await poolMap(items, concurrency, async (item) => {
    try {
      const { stdout } = await runCmd("yt-dlp", [
        "--print",
        "%(duration)s\t%(duration_string)s",
        item.url,
      ]);
      const line = stdout.trim();
      const idx = line.indexOf("\t");
      if (idx !== -1) {
        const raw = line.slice(0, idx).trim();
        const durNum = Number(raw);
        item.duration = Number.isFinite(durNum) ? durNum : null;
        item.durationString = line.slice(idx + 1).trim() || null;
      } else {
        item.duration = null;
        item.durationString = null;
      }
    } catch {
      item.duration = null;
      item.durationString = null;
    }
  });
  return items;
}

/**
 * Download a YouTube video as MP4 into media/raw/<id>.mp4. Returns abs path.
 */
export async function downloadMp4(id) {
  validateId(id);
  const rawDir = absMediaRaw();
  await ensureDir(rawDir);

  const outTemplate = path.join(rawDir, "%(id)s.%(ext)s");

  await runCmd("yt-dlp", [
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bestvideo+bestaudio",
    "--merge-output-format",
    "mp4",
    "-o",
    outTemplate,
    watchUrl(id),
  ]);

  const expected = path.join(rawDir, `${id}.mp4`);

  try {
    await fs.access(expected);
    return expected;
  } catch {
    // yt-dlp may have saved with a different extension; find it and remux
    const files = await fs.readdir(rawDir);
    const match = files.find((f) => f.startsWith(`${id}.`) && f !== `${id}.mp4`);
    if (!match) {
      throw new Error(`Download completed but output file not found for id=${id}`);
    }
    const actual = path.join(rawDir, match);
    await runCmd("ffmpeg", [
      "-i", actual,
      "-c", "copy",
      "-movflags", "+faststart",
      expected,
      "-y",
    ]);
    await fs.unlink(actual);
    return expected;
  }
}
