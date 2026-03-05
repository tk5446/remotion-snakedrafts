import { spawn } from "node:child_process";

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Accept a number (seconds) or a string like "HH:MM:SS.mmm" / "MM:SS".
 * Returns a string suitable for ffmpeg -ss / -to / -t.
 */
export function parseTime(input) {
  if (input == null) return null;
  if (typeof input === "number" || /^\d+(\.\d+)?$/.test(String(input))) {
    const total = Number(input);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = s.toFixed(3).padStart(6, "0");
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${ss}`;
  }
  return String(input);
}

export function safeJson(res, status, obj) {
  res.status(status).json(obj);
}

/**
 * Spawn a command with an args array (no shell). Returns { stdout, stderr, code }.
 * Rejects on non-zero exit unless opts.allowNonZero is set.
 */
export function runCmd(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
      shell: false,
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on("data", (d) => stdoutChunks.push(d));
    proc.stderr.on("data", (d) => stderrChunks.push(d));

    proc.on("error", (err) =>
      reject(new Error(`Failed to start "${cmd}": ${err.message}`))
    );

    proc.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0 && !opts.allowNonZero) {
        const snippet = stderr.slice(-500);
        const err = new Error(
          `"${cmd}" exited with code ${code}.\n${snippet}`
        );
        err.code = code;
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr, code });
    });
  });
}

const ID_RE = /^[A-Za-z0-9_-]{6,15}$/;

export function validateId(id) {
  if (!id || !ID_RE.test(id)) {
    const err = new Error(`Invalid video id: "${id}"`);
    err.statusCode = 400;
    throw err;
  }
  return id;
}

export function validateDimension(n, label) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 100 || v > 4096) {
    const err = new Error(`${label} must be an integer between 100 and 4096, got ${n}`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}
