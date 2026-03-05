import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// lib/ -> clip-studio/ -> tools/ -> repo root
export const repoRoot = path.resolve(__dirname, "..", "..", "..");

export async function ensureDir(absPath) {
  await fs.mkdir(absPath, { recursive: true });
}

export function absMediaRaw() {
  return path.join(repoRoot, "media", "raw");
}

export function absMediaOut() {
  return path.join(repoRoot, "public", "assets", "media", "out");
}

export function relFromRoot(absPath) {
  return path.relative(repoRoot, absPath);
}
