/**
 * ─────────────────────────────────────────────────────────────
 *  POST COORDINATOR — Central truth for all posting activity
 *
 *  Every engine checks here before posting.
 *  Every engine registers here after posting.
 *  Stored on /data volume — survives Railway restarts + deploys.
 *
 *  This is the single source of truth for "what posted, when,
 *  and who is allowed to post next."
 * ─────────────────────────────────────────────────────────────
 */

import fs from "fs";
import { dataPath } from "./dataPaths.js";

const STATE_FILE = dataPath("post_coordinator.json");

// ── Cooldown windows per engine ───────────────────────────────
const COOLDOWNS: Record<string, number> = {
  episode:       11 * 60 * 60 * 1000,  // 11h  — fires every 12h, 1h buffer
  news_dispatch: 23 * 60 * 60 * 1000,  // 23h  — daily, never twice same day
  leaderboard:    6 * 24 * 60 * 60 * 1000, // 6d — weekly
  spotlight:      6 * 24 * 60 * 60 * 1000, // 6d — weekly
  race:           6 * 24 * 60 * 60 * 1000, // 6d — weekly
  cyoa:           6 * 24 * 60 * 60 * 1000, // 6d — weekly
};

// Per-burn cooldown: 5 minutes per commitId
const BURN_COOLDOWN = 5 * 60 * 1000;

export interface PostRecord {
  engine: string;
  tweetUrl: string | null;
  postedAt: string;
  key: string;    // unique key used for dedup (e.g. "episode", "burn_566")
}

interface CoordinatorState {
  posts: PostRecord[];           // full history (last 200)
  lastPost: Record<string, number>; // engine/key → timestamp of last post
  activeEngine: string | null;   // which engine is currently posting
  activeEngineStarted: string | null;
}

function load(): CoordinatorState {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { posts: [], lastPost: {}, activeEngine: null, activeEngineStarted: null };
}

function save(state: CoordinatorState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

/**
 * Request permission to post.
 * Returns true if allowed, false if duplicate/too soon.
 */
export function requestPost(key: string): boolean {
  const state = load();
  const now = Date.now();

  // Get cooldown for this key
  const cooldown = key.startsWith("burn_")
    ? BURN_COOLDOWN
    : (COOLDOWNS[key] ?? 5 * 60 * 1000);

  const lastPostTime = state.lastPost[key] ?? 0;
  const elapsed = now - lastPostTime;

  if (elapsed < cooldown) {
    const mins = Math.round(elapsed / 60000);
    const cooldownMins = Math.round(cooldown / 60000);
    console.log(`[Coordinator] BLOCKED "${key}" — posted ${mins}m ago (cooldown: ${cooldownMins}m)`);
    return false;
  }

  // Check if another engine is actively posting (stale after 10min)
  if (state.activeEngine && state.activeEngineStarted) {
    const activeMs = now - new Date(state.activeEngineStarted).getTime();
    if (activeMs < 10 * 60 * 1000) {
      console.log(`[Coordinator] BLOCKED "${key}" — "${state.activeEngine}" is currently posting`);
      return false;
    }
  }

  // Grant permission — mark as active
  state.activeEngine = key;
  state.activeEngineStarted = new Date().toISOString();
  state.lastPost[key] = now;
  save(state);

  console.log(`[Coordinator] GRANTED "${key}"`);
  return true;
}

/**
 * Register a completed post.
 * Call after successfully posting.
 */
export function registerPost(key: string, tweetUrl: string | null, engine: string) {
  const state = load();

  const record: PostRecord = {
    engine,
    tweetUrl,
    postedAt: new Date().toISOString(),
    key,
  };

  state.posts.push(record);
  if (state.posts.length > 200) state.posts = state.posts.slice(-200);

  // Clear active engine
  if (state.activeEngine === key) {
    state.activeEngine = null;
    state.activeEngineStarted = null;
  }

  save(state);
  console.log(`[Coordinator] REGISTERED "${key}" → ${tweetUrl ?? "no url"}`);
}

/**
 * Release the active lock (call on error)
 */
export function releasePost(key: string) {
  const state = load();
  if (state.activeEngine === key) {
    state.activeEngine = null;
    state.activeEngineStarted = null;
    save(state);
  }
}

/**
 * Get full coordinator state for the dashboard
 */
export function getCoordinatorState() {
  const state = load();
  const now = Date.now();

  const engines = Object.entries(COOLDOWNS).map(([key, cooldown]) => {
    const lastPostTime = state.lastPost[key] ?? 0;
    const elapsed = now - lastPostTime;
    const nextAllowed = lastPostTime + cooldown;
    const recentPost = state.posts.filter(p => p.key === key).slice(-1)[0];

    return {
      engine: key,
      lastPostedAt: lastPostTime ? new Date(lastPostTime).toISOString() : null,
      nextAllowedAt: lastPostTime ? new Date(nextAllowed).toISOString() : null,
      isReady: elapsed >= cooldown,
      lastTweetUrl: recentPost?.tweetUrl ?? null,
    };
  });

  return {
    activeEngine: state.activeEngine,
    engines,
    recentPosts: state.posts.slice(-10).reverse(),
    totalPosts: state.posts.length,
  };
}
