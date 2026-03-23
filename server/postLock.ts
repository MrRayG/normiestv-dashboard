/**
 * ─────────────────────────────────────────────────────────────
 *  POST LOCK — Disk-based deduplication
 *
 *  Prevents duplicate posts when Railway runs old + new
 *  containers simultaneously during deploys (~60s overlap).
 *
 *  Each post type has a cooldown. If a post of that type
 *  was made within the cooldown window, skip it.
 * ─────────────────────────────────────────────────────────────
 */

import fs from "fs";
import { dataPath } from "./dataPaths.js";

const LOCK_FILE = dataPath("post_locks.json");

interface PostLocks {
  [key: string]: number; // key → timestamp of last post
}

function load(): PostLocks {
  try {
    if (fs.existsSync(LOCK_FILE)) return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {}
  return {};
}

function save(locks: PostLocks) {
  try { fs.writeFileSync(LOCK_FILE, JSON.stringify(locks, null, 2)); } catch {}
}

/**
 * Acquire a post lock. Returns true if safe to post, false if duplicate.
 * @param key    Unique identifier for the post type (e.g. "episode", "news_dispatch", "burn_123")
 * @param cooldownMs  How long to block re-posts (default 10 minutes)
 */
export function acquirePostLock(key: string, cooldownMs = 10 * 60 * 1000): boolean {
  const locks = load();
  const lastPost = locks[key] ?? 0;
  const elapsed = Date.now() - lastPost;

  if (elapsed < cooldownMs) {
    console.log(`[PostLock] BLOCKED "${key}" — posted ${Math.round(elapsed / 1000)}s ago (cooldown: ${Math.round(cooldownMs / 1000)}s)`);
    return false;
  }

  // Acquire lock immediately
  locks[key] = Date.now();
  save(locks);
  console.log(`[PostLock] ACQUIRED "${key}"`);
  return true;
}

/**
 * Release a lock (call on error to allow retry)
 */
export function releasePostLock(key: string) {
  const locks = load();
  delete locks[key];
  save(locks);
  console.log(`[PostLock] RELEASED "${key}"`);
}

/**
 * Check if a lock exists without acquiring
 */
export function isLocked(key: string, cooldownMs = 10 * 60 * 1000): boolean {
  const locks = load();
  const lastPost = locks[key] ?? 0;
  return Date.now() - lastPost < cooldownMs;
}
