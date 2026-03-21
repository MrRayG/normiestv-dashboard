// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — MULTI-SOURCE SIGNAL COLLECTOR
// Sources: Normies API (on-chain) + OpenSea (marketplace) + Farcaster (social)
//          + TwitterAPI.io (X social) — all optional, degrade gracefully
// ─────────────────────────────────────────────────────────────────────────────

import type { Signal } from "./grokEngine";
import { searchNormiesSocial } from "./grokEngine";
import * as fs from "fs";

const NORMIES_API   = "https://api.normies.art";
const OPENSEA_API   = "https://api.opensea.io/api/v2";
const NEYNAR_API    = "https://api.neynar.com/v2/farcaster";
const TWITTER_API   = "https://api.twitterapi.io/twitter";
const STATE_FILE    = "/tmp/normiestv_collector_state.json";

// Keys — add via env or hardcode once obtained
const OPENSEA_KEY   = process.env.OPENSEA_API_KEY  ?? "";
const NEYNAR_KEY    = process.env.NEYNAR_API_KEY   ?? "";
const TWITTER_KEY   = process.env.TWITTER_API_KEY  ?? "";

// THE 100 — top canvas creator IDs to track
const THE100_IDS = [
  8553, 45, 1932, 235, 615, 603, 5665, 7834, 8043, 7783,
  9999, 8831, 5070, 4354, 7887, 3284, 666, 1337, 420, 100,
  200, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 9852,
];

// Persist state to disk so server restarts don't re-process old burns
interface CollectorState {
  lastBurnCommitId: string | null;
  lastFeaturedTokens: number[];   // last 3 featured tokens — avoid repeating
  episodeCount: number;           // for narrative rotation
}

function loadState(): CollectorState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch {}
  return { lastBurnCommitId: null, lastFeaturedTokens: [], episodeCount: 0 };
}

function saveState(state: CollectorState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

let state = loadState();

// Track last seen IDs to avoid duplicate signals
let lastBurnCommitId: string | null = state.lastBurnCommitId;
let lastOpenSeaEventId: string | null = null;
let lastFarcasterCastHash: string | null = null;

export function getCollectorState() { return state; }
export function bumpEpisodeCount() {
  state.episodeCount++;
  saveState(state);
}
export function updateFeaturedTokens(tokens: number[]) {
  state.lastFeaturedTokens = tokens.slice(0, 3);
  saveState(state);
}
let lastTweetId: string | null = null;

async function safeFetch(url: string, opts: RequestInit = {}): Promise<any> {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 1. On-chain burns from Normies API ────────────────────────────────────────
export async function collectBurnSignals(): Promise<Signal[]> {
  const data = await safeFetch(`${NORMIES_API}/history/burns?limit=20`);
  if (!Array.isArray(data)) return [];

  const newBurns = lastBurnCommitId
    ? data.filter((b: any) => b.commitId > lastBurnCommitId!)
    : data.slice(0, 8);

  if (data.length > 0) {
    lastBurnCommitId = data[0].commitId;
    state.lastBurnCommitId = lastBurnCommitId;
    saveState(state);
  }

  return newBurns.map((b: any): Signal => {
    let pixelTotal = 0;
    try { pixelTotal = JSON.parse(b.pixelCounts ?? "[]").reduce((s: number, n: number) => s + n, 0); } catch {}

    return {
      type: "burn",
      source: "normies_api",
      tokenId: Number(b.receiverTokenId),
      weight: Math.min(10, 6 + (b.tokenCount ?? 1)),
      description: `Normie #${b.receiverTokenId} absorbed ${b.tokenCount} soul(s) — ${pixelTotal.toLocaleString()} pixels consumed`,
      rawData: { ...b, pixelTotal },
      capturedAt: new Date(Number(b.timestamp) * 1000).toISOString(),
    };
  });
}

// ── 2. Canvas leaderboard from Normies API ────────────────────────────────────
export async function collectCanvasSignals(): Promise<Signal[]> {
  const results = await Promise.allSettled(
    THE100_IDS.map(id =>
      safeFetch(`${NORMIES_API}/normie/${id}/canvas/info`)
        .then((c: any) => c ? { id, ...c } : null)
    )
  );

  const leaders = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value)
    .filter(v => v.actionPoints > 0)
    .sort((a, b) => (b.actionPoints ?? 0) - (a.actionPoints ?? 0))
    .slice(0, 10);

  return leaders.map((c: any, i: number): Signal => ({
    type: "canvas",
    source: "normies_api",
    tokenId: c.id,
    weight: Math.min(10, 4 + Math.floor((c.actionPoints ?? 0) / 100)),
    description: `Normie #${c.id} — Rank #${i + 1} · Level ${c.level} · ${c.actionPoints} AP`,
    rawData: { tokenId: c.id, level: c.level, actionPoints: c.actionPoints, customized: c.customized, rank: i + 1 },
    capturedAt: new Date().toISOString(),
  }));
}

// ── 3. OpenSea marketplace events ─────────────────────────────────────────────
export async function collectOpenSeaSignals(): Promise<Signal[]> {
  if (!OPENSEA_KEY) return [];

  const signals: Signal[] = [];

  // Sales
  const salesData = await safeFetch(
    `${OPENSEA_API}/events/collection/normies?event_type=sale&limit=10`,
    { headers: { "X-API-KEY": OPENSEA_KEY, accept: "application/json" } }
  );

  if (salesData?.asset_events) {
    for (const e of salesData.asset_events.slice(0, 5)) {
      const tokenId = Number(e.nft?.identifier);
      const ethPrice = e.payment ? (Number(e.payment.quantity) / 1e18).toFixed(4) : "?";
      const usdValue = e.payment?.usd_amount?.toFixed(0) ?? "?";
      signals.push({
        type: "sale",
        source: "opensea",
        tokenId,
        weight: 7,
        description: `Normie #${tokenId} sold for ${ethPrice} ETH ($${usdValue})`,
        rawData: { tokenId, price: ethPrice, usdValue, buyer: e.buyer, seller: e.seller },
        capturedAt: new Date(e.event_timestamp * 1000).toISOString(),
      });
    }
  }

  // New listings
  const listingsData = await safeFetch(
    `${OPENSEA_API}/events/collection/normies?event_type=listing&limit=5`,
    { headers: { "X-API-KEY": OPENSEA_KEY, accept: "application/json" } }
  );

  if (listingsData?.asset_events) {
    for (const e of listingsData.asset_events.slice(0, 3)) {
      const tokenId = Number(e.nft?.identifier);
      const ethPrice = e.payment ? (Number(e.payment.quantity) / 1e18).toFixed(4) : "?";
      signals.push({
        type: "listing",
        source: "opensea",
        tokenId,
        weight: 4,
        description: `Normie #${tokenId} listed at ${ethPrice} ETH`,
        rawData: { tokenId, price: ethPrice },
        capturedAt: new Date().toISOString(),
      });
    }
  }

  return signals;
}

// ── 4. Farcaster social signals via Neynar ────────────────────────────────────
export async function collectFarcasterSignals(): Promise<Signal[]> {
  if (!NEYNAR_KEY) return [];

  const searches = ["normies", "normies nft", "skulliemoon"];
  const signals: Signal[] = [];

  for (const q of searches) {
    const data = await safeFetch(
      `${NEYNAR_API}/cast/search?q=${encodeURIComponent(q)}&limit=5`,
      { headers: { "api_key": NEYNAR_KEY, accept: "application/json" } }
    );

    if (data?.result?.casts) {
      for (const cast of data.result.casts.slice(0, 3)) {
        if (lastFarcasterCastHash && cast.hash === lastFarcasterCastHash) continue;
        signals.push({
          type: "social_farcaster",
          source: "farcaster",
          weight: 5 + Math.min(4, Math.floor((cast.reactions?.likes_count ?? 0) / 5)),
          description: `@${cast.author?.username} on Farcaster: "${cast.text?.slice(0, 100)}"`,
          rawData: {
            hash: cast.hash,
            username: cast.author?.username,
            text: cast.text,
            likes: cast.reactions?.likes_count ?? 0,
            recasts: cast.reactions?.recasts_count ?? 0,
          },
          capturedAt: cast.timestamp ?? new Date().toISOString(),
        });
      }
      if (data.result.casts[0]) lastFarcasterCastHash = data.result.casts[0].hash;
    }
  }

  return signals;
}

// ── 5. X / Twitter social signals ────────────────────────────────────────────
export async function collectXSignals(): Promise<Signal[]> {
  if (!TWITTER_KEY) return [];

  const queries = ["#Normies NFT", "#NormiesTV", "normies canvas burn"];
  const signals: Signal[] = [];

  for (const q of queries.slice(0, 2)) {
    const data = await safeFetch(
      `${TWITTER_API}/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Latest`,
      { headers: { "X-API-Key": TWITTER_KEY } }
    );

    if (data?.tweets) {
      for (const tweet of (data.tweets as any[]).slice(0, 5)) {
        if (lastTweetId && tweet.id === lastTweetId) break;
        signals.push({
          type: "social_x",
          source: "twitter",
          weight: 4 + Math.min(5, Math.floor((tweet.likeCount ?? 0) / 10)),
          description: `@${tweet.author?.userName}: "${tweet.text?.slice(0, 100)}"`,
          rawData: {
            id: tweet.id,
            username: tweet.author?.userName,
            text: tweet.text,
            likes: tweet.likeCount ?? 0,
            retweets: tweet.retweetCount ?? 0,
          },
          capturedAt: tweet.createdAt ?? new Date().toISOString(),
        });
      }
      if (data.tweets[0]) lastTweetId = data.tweets[0].id;
    }
  }

  return signals;
}

// ── 6. Grok Live Search — X social signals via Grok's built-in search ────────
export async function collectGrokSocialSignals(): Promise<Signal[]> {
  const posts = await searchNormiesSocial();
  return posts.map((p): Signal => ({
    type: "social_x",
    source: "twitter",
    weight: 5 + Math.min(4, Math.floor((p.likes ?? 0) / 10)),
    description: `@${p.username} on X: "${p.text?.slice(0, 100)}${p.text?.length > 100 ? "..." : ""}"`  ,
    rawData: { username: p.username, text: p.text, likes: p.likes, url: p.url },
    capturedAt: new Date().toISOString(),
  }));
}

// ── Master collector ─────────────────────────────────────────────────
export async function collectAllSignals(): Promise<{
  signals: Signal[];
  sources: Record<string, number>;
  diversity: { lastFeaturedTokens: number[]; episodeCount: number; };
}> {
  console.log("[NormiesTV] Collecting signals from all sources...");

  const [burns, canvas, opensea, farcaster, xSignals, grokSocial] = await Promise.allSettled([
    collectBurnSignals(),
    collectCanvasSignals(),
    collectOpenSeaSignals(),
    collectFarcasterSignals(),
    collectXSignals(),
    collectGrokSocialSignals(),  // Grok live search — always runs
  ]);

  const get = (r: PromiseSettledResult<Signal[]>) =>
    r.status === "fulfilled" ? r.value : [];

  const allSignals = [
    ...get(burns),
    ...get(canvas),
    ...get(opensea),
    ...get(farcaster),
    ...get(xSignals),
    ...get(grokSocial),
  ].sort((a, b) => b.weight - a.weight);

  const sources = {
    burns:      get(burns).length,
    canvas:     get(canvas).length,
    opensea:    get(opensea).length,
    farcaster:  get(farcaster).length,
    twitter:    get(xSignals).length + get(grokSocial).length,
  };

  console.log(`[NormiesTV] Signals collected:`, sources);
  return {
    signals: allSignals,
    sources,
    diversity: {
      lastFeaturedTokens: state.lastFeaturedTokens,
      episodeCount: state.episodeCount,
    },
  };
}
