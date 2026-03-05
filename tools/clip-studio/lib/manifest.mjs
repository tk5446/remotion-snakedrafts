import path from "node:path";
import fs from "node:fs/promises";
import { repoRoot } from "./paths.mjs";

const MANIFEST_PATH = path.join(repoRoot, "clips.json");

export async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.items)) return data;
  } catch {
    // missing or corrupt — return fresh
  }
  return { version: 1, items: [] };
}

/**
 * Insert or update an item in clips.json (matched by outPath).
 */
export async function upsertItem(item) {
  const manifest = await readManifest();
  const idx = manifest.items.findIndex((i) => i.outPath === item.outPath);
  if (idx >= 0) {
    manifest.items[idx] = item;
  } else {
    manifest.items.push(item);
  }
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}
