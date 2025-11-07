#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const SOUNDS_DIR = "assets/sounds/bingobuzz";
const LICENSE_SUBDIR = "NonCommerseLicense";
const TARGET_DIR = path.join(SOUNDS_DIR, LICENSE_SUBDIR);
const VALID_CHAR_REGEX = /[^A-Za-z0-9_-]+/g;

function slugify(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const normalized = base
    .replace(/\s+/g, "_")
    .replace(VALID_CHAR_REGEX, "")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${normalized}${ext.toLowerCase()}`;
}

async function renameFiles() {
  const entries = await fs.readdir(TARGET_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const oldName = entry.name;
    const newName = slugify(oldName);
    if (oldName === newName) continue;
    const from = path.join(TARGET_DIR, oldName);
    const to = path.join(TARGET_DIR, newName);
    console.log(`Renaming ${oldName} -> ${newName}`);
    await fs.rename(from, to);
  }
}

renameFiles().catch((error) => {
  console.error("rename-sounds failed", error);
  process.exit(1);
});
