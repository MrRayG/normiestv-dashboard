// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — FOLLOWING SYNC
// @NORMIES_TV follows = confirmed NORMIES community.
// Pulls the full following list every 6 hours and seeds the holder catalog.
// Their tweets shape the narrative — every PFP rocker is a node in the network.
// ─────────────────────────────────────────────────────────────────────────────

import { TwitterApi } from "twitter-api-v2";
import * as fs from "fs";
import { upsertHolder, getCatalog, type HolderEntry } from "./holderCatalog";

import { dataPath } from "./dataPaths.js";
const FOLLOWING_FILE  = dataPath("following.json");
const NORMIES_TV_ID   = "2035048299808661507";

// Interval: sync every 6 hours
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface FollowingEntry {
  userId:      string;
  username:    string;
  name:        string;
  description: string;
  syncedAt:    string;
  // detected from bio
  isPfpHolder: boolean;
  normieTokenIds: number[];
}

export interface FollowingState {
  accounts:    FollowingEntry[];
  totalCount:  number;
  lastSynced:  string | null;
  nextSync:    string | null;
}

// ── Persist ───────────────────────────────────────────────────────────────────
function loadState(): FollowingState {
  try {
    if (fs.existsSync(FOLLOWING_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWING_FILE, "utf8"));
    }
  } catch {}
  return { accounts: [], totalCount: 0, lastSynced: null, nextSync: null };
}

function saveState(state: FollowingState) {
  try { fs.writeFileSync(FOLLOWING_FILE, JSON.stringify(state, null, 2)); } catch {}
}

let followingState = loadState();

export function getFollowingState(): FollowingState { return followingState; }

// ── Detect Normie tokens from bio/description ─────────────────────────────────
function detectNormieTokens(text: string): number[] {
  // Matches "Normie #4354", "#4354", "normie 4354"
  const patterns = [
    /[Nn]ormie\s*#(\d{1,4})\b/g,
    /@normiesART.*?#(\d{1,4})\b/g,
  ];
  const tokens = new Set<number>();
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) {
      const n = Number(m[1]);
      if (n > 0 && n <= 10000) tokens.add(n);
    }
  }
  return [...tokens];
}

function isPfpHolder(description: string): boolean {
  const d = description.toLowerCase();
  return (
    d.includes("normie") ||
    d.includes("normiesart") ||
    d.includes("@normiesart") ||
    d.includes("serc") ||
    detectNormieTokens(description).length > 0
  );
}

// ── Pull full following list (paginates automatically) ─────────────────────────
export async function syncFollowing(xClient: TwitterApi): Promise<FollowingState> {
  console.log("[FollowingSync] Starting @NORMIES_TV following sync...");

  const entries: FollowingEntry[] = [];

  try {
    // Paginate through all following
    let nextToken: string | undefined;
    let page = 0;

    do {
      page++;
      const params: any = {
        max_results: 1000,
        "user.fields": ["username", "name", "description", "profile_image_url"],
      };
      if (nextToken) params.pagination_token = nextToken;

      const res = await xClient.v2.following(NORMIES_TV_ID, params);
      const users = res.data ?? [];
      nextToken = (res as any).meta?.next_token;

      for (const u of users) {
        const desc    = u.description ?? "";
        const tokens  = detectNormieTokens(desc);
        const pfp     = isPfpHolder(desc);

        entries.push({
          userId:         u.id,
          username:       u.username,
          name:           u.name,
          description:    desc,
          syncedAt:       new Date().toISOString(),
          isPfpHolder:    pfp,
          normieTokenIds: tokens,
        });
      }

      console.log(`[FollowingSync] Page ${page}: fetched ${users.length} accounts (total: ${entries.length})`);

      // Safety cap — X Basic plan limits
      if (page >= 15) break;

    } while (nextToken);

  } catch (err: any) {
    console.warn("[FollowingSync] X API error:", err.message ?? err);
    // Return stale state rather than crashing
    return followingState;
  }

  const now = new Date();
  const nextSync = new Date(now.getTime() + SYNC_INTERVAL_MS);

  followingState = {
    accounts:   entries,
    totalCount: entries.length,
    lastSynced: now.toISOString(),
    nextSync:   nextSync.toISOString(),
  };

  saveState(followingState);

  // ── Seed holder catalog with confirmed community ─────────────────────────
  let seeded = 0;
  for (const entry of entries) {
    // Skip the account itself and known bots
    if (entry.username.toLowerCase() === "normies_tv") continue;

    upsertHolder({
      username:    entry.username,
      signalType:  entry.isPfpHolder ? "pfp_holder" : "community",
      show:        "[NORMIES COMMUNITY]",
      text:        entry.description,
      tokenIds:    entry.normieTokenIds,
      confirmedHolder: true,
    });
    seeded++;
  }

  console.log(
    `[FollowingSync] Done. ${entries.length} accounts synced, ${seeded} seeded into catalog.`,
    `PFP holders: ${entries.filter(e => e.isPfpHolder).length}`
  );

  return followingState;
}

// ── Get usernames list for x_search queries ───────────────────────────────────
export function getFollowingUsernames(): string[] {
  return followingState.accounts.map(a => a.username);
}

export function getPfpHolderUsernames(): string[] {
  return followingState.accounts
    .filter(a => a.isPfpHolder)
    .map(a => a.username);
}

// ── Build an x_search query from the following list ───────────────────────────
// Returns a "from:" query targeting the most NORMIES-relevant followers
export function buildFollowingQuery(limit = 20): string {
  const pfp     = getPfpHolderUsernames().slice(0, 10);
  const all     = getFollowingUsernames()
    .filter(u => !pfp.includes(u))
    .slice(0, limit - pfp.length);

  const handles = [...pfp, ...all];
  if (handles.length === 0) return "(normies OR #normies OR normiesART)";

  // X search: (from:user1 OR from:user2 OR ...) normies
  const fromClause = handles.map(u => `from:${u}`).join(" OR ");
  return `(${fromClause}) (normies OR @normiesART OR #normies OR "normie #")`;
}

// ── Schedule recurring sync ────────────────────────────────────────────────────
export function scheduleFollowingSync(xClient: TwitterApi) {
  // Run immediately on startup
  syncFollowing(xClient).catch(e =>
    console.warn("[FollowingSync] Initial sync failed:", e.message)
  );

  // Then every 6 hours
  setInterval(() => {
    syncFollowing(xClient).catch(e =>
      console.warn("[FollowingSync] Scheduled sync failed:", e.message)
    );
  }, SYNC_INTERVAL_MS);

  console.log("[FollowingSync] Scheduled — syncing @NORMIES_TV following every 6h");
}
