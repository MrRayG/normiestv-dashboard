/**
 * Central data path resolver for all persistent state files.
 * 
 * On Railway: set DATA_DIR=/data (mounted volume)
 * Locally:    defaults to ./data (relative to cwd)
 * 
 * Image/audio files stay in /tmp — they're ephemeral by design.
 */

import fs from "fs";
import path from "path";

// Railway persistent volume should be mounted at /data
// Locally we use ./data next to the project
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

// Ensure the directory exists on startup
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

export { DATA_DIR };
