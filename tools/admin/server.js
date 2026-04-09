/**
 * Admin API server — port 3001
 * Spawns Python pipeline scripts and streams stdout via SSE.
 */

import express from "express";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, "../..");
const SCRIPTS    = path.join(REPO_ROOT, "scripts");
const PYTHON     = "python3";

const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

/**
 * POST /api/run/:script
 * Body: { args: string[] }
 * Streams script stdout + stderr as SSE events.
 *
 * Event types:
 *   { type: "stdout", text: "..." }
 *   { type: "stderr", text: "..." }
 *   { type: "done",   code: 0 }
 *   { type: "error",  message: "..." }
 */
const ALLOWED_SCRIPTS = new Set(["get_quotes", "find_clips", "make_clips", "export_render_data"]);

app.post("/api/run/:script", (req, res) => {
  const { script } = req.params;

  if (!ALLOWED_SCRIPTS.has(script)) {
    return res.status(400).json({ error: "Unknown script" });
  }

  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  // Sanitise: only allow alphanumeric, hyphens, underscores, dots, slashes for args
  const safeArgs = args.filter((a) => /^[\w.\-/]+$/.test(a));
  const scriptPath = path.join(SCRIPTS, `${script}.py`);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({ type: "stdout", text: `▶ python3 ${script}.py ${safeArgs.join(" ")}\n` });

  let proc;
  try {
    proc = spawn(PYTHON, ["-u", scriptPath, ...safeArgs], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
  } catch (err) {
    send({ type: "error", message: String(err) });
    res.end();
    return;
  }

  proc.stdout.on("data", (data) => send({ type: "stdout", text: data.toString() }));
  proc.stderr.on("data", (data) => send({ type: "stderr", text: data.toString() }));
  proc.on("close", (code, signal) => {
    send({ type: "done", code, signal });
    res.end();
  });
  proc.on("error", (err) => {
    send({ type: "error", message: String(err) });
    res.end();
  });

  // If client disconnects, kill the process
  req.on("close", () => proc.kill());
});

app.listen(3001, () => {
  console.log("Admin server running on http://localhost:3001");
});
