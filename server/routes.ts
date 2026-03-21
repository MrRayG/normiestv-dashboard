import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEpisodeSchema, insertRenderJobSchema, insertSignalSchema } from "@shared/schema";
import { TwitterApi } from "twitter-api-v2";
import * as crypto from "crypto";
import * as fs from "fs";
import { collectAllSignals, updateFeaturedTokens, bumpEpisodeCount } from "./signalCollector";
import { generateEpisodeWithGrok, type EpisodeMemory } from "./grokEngine";
import { saveEpisodeCard } from "./imageCard";
import { checkForNewBurns, processBurnReceipt, getReceiptState } from "./burnReceiptEngine";
import { getCommunitySignalCache, searchNormiesSocial, resetCommunityCache } from "./grokEngine";
import { ingestSignals, getCatalog, getCatalogStats, getMostActive, getStorySourceHolders } from "./holderCatalog";
import { generateCYOAEpisode, postCYOAHook, resolveCYOA, getCYOAState, buildHookTweet, type CYOATrigger } from "./cyoaEngine";
import { fetchReplies, getReplyState, formatRepliesForContext, getTopReplies } from "./replyWatcher";
import { scheduleWeeklyLeaderboard, postWeeklyLeaderboard, fetchLiveLeaderboard } from "./leaderboardEngine";
import { scheduleFollowingSync, syncFollowing, getFollowingState, buildFollowingQuery, getPfpHolderUsernames, getFollowingUsernames } from "./followingSync";
import { generateBoost } from "./boostEngine";

const NORMIES_API = "https://api.normies.art";

// ── News Engine types ──────────────────────────────────
interface ChainNFT {
  chain: string; chainLabel: string; chainColor: string;
  collection: string;
  floor: string | null; floorUSD: number | null;
  change24h: string | null; volume24h: string | null; marketCap: string | null;
  status: "hot" | "cool" | "building"; note?: string;
}
interface MemeCoin {
  symbol: string; name: string; price: number;
  change24h: number; volume24h: number; chain: string;
  status: "hot" | "up" | "cool";
}

// ── OAuth 2.0 client (Free tier — tweet posting) ──────────────────
const OAUTH2_CLIENT_ID     = "WkFzOW1iUVRreDN3bnRiTHNLcjc6MTpjaQ";
const OAUTH2_CALLBACK_URL  = "http://localhost:5000/api/x/oauth2/callback";
const TOKEN_FILE           = "/tmp/normies_x_token.json";

// In-memory OAuth 2.0 state store
let oauth2State: { codeVerifier: string; state: string } | null = null;
let oauth2Token: { accessToken: string; refreshToken?: string; expiresAt?: number } | null = null;

// Load persisted token if available
try {
  if (fs.existsSync(TOKEN_FILE)) {
    oauth2Token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    console.log("[NormiesTV] OAuth2 token loaded from disk");
  }
} catch {}

function saveToken(token: typeof oauth2Token) {
  oauth2Token = token;
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(token)); } catch {}
}

async function getOAuth2Client(): Promise<TwitterApi | null> {
  if (!oauth2Token) return null;
  // Refresh if expiring within 5 minutes
  if (oauth2Token.expiresAt && Date.now() > oauth2Token.expiresAt - 300_000 && oauth2Token.refreshToken) {
    try {
      const client = new TwitterApi({ clientId: OAUTH2_CLIENT_ID, clientSecret: "" } as any);
      const { accessToken, refreshToken, expiresIn } = await (client as any).refreshOAuth2Token(oauth2Token.refreshToken);
      saveToken({ accessToken, refreshToken, expiresAt: Date.now() + (expiresIn ?? 7200) * 1000 });
    } catch (e: any) {
      console.error("[NormiesTV] Token refresh failed:", e.message);
    }
  }
  return new TwitterApi(oauth2Token.accessToken);
}

// ── OAuth 1.0a client (verify/read only — keep for verify endpoint) ─
const xClient = new TwitterApi({
  appKey:            "KflwX2evH6oU1bjX3uuVWZ8Ix",
  appSecret:         "HFmTeE0KHUeKjWcx221tatZU7pSzXBWpFZhRpOgeZaVvB3yfAr",
  accessToken:       process.env.X_ACCESS_TOKEN ?? "2035048299808661507-FkIgaoHopXjkooRdmHGpZlEAe7WYUd",
  accessSecret:      process.env.X_ACCESS_SECRET ?? "yGngq3afMEHmWrE9ndwzqh6WwTObhK5YGMmetB0Y22MAb",
});
const xWrite = xClient.readWrite;

async function fetchNormiesAPI(path: string) {
  const res = await fetch(`${NORMIES_API}${path}`);
  if (!res.ok) throw new Error(`Normies API error: ${res.status}`);
  return res.json();
}

// ── AI News RSS fetcher ───────────────────────────────────────────────────────────────
export interface AINewsItem {
  title:       string;
  url:         string;
  source:      string;
  sourceColor: string;
  publishedAt: string;
  snippet:     string;
}

const AI_NEWS_SOURCES = [
  { name: "The Verge",     color: "#f43f5e", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "TechCrunch",   color: "#f97316", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "Ars Technica", color: "#a78bfa", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "VentureBeat",  color: "#4ade80", url: "https://venturebeat.com/category/ai/feed/" },
];

function stripCdata(s: string): string {
  return s.replace(/<\!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function parseRSS(xml: string, source: { name: string; color: string }): AINewsItem[] {
  const items: AINewsItem[] = [];
  // Support both <item> (RSS 2.0) and <entry> (Atom)
  const itemBlocks = [...(xml.match(/<item[\s\S]*?<\/item>/g) ?? []),
                      ...(xml.match(/<entry[\s\S]*?<\/entry>/g) ?? [])];
  for (const block of itemBlocks.slice(0, 6)) {
    // Title — handle CDATA and plain
    const titleRaw = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const cleanTitle = stripCdata(titleRaw);
    // Link — RSS <link> or Atom <link href="...">
    const link = block.match(/<link[^>]+href="([^"]+)"/)?.[1]?.trim()
              ?? block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
    // Date — <pubDate>, <published>, <updated>
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim()
                 ?? block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim()
                 ?? block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() ?? "";
    // Snippet — <summary> (Atom) or <description> (RSS)
    const snippetRaw = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]
                    ?? block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
    const snippet = stripCdata(snippetRaw).slice(0, 200);

    if (!cleanTitle || !link) continue;
    // Only AI-relevant items
    const text = (cleanTitle + " " + snippet).toLowerCase();
    const aiKeywords = ["ai","artificial intelligence","machine learning","llm","gpt","claude","gemini",
                        "openai","anthropic","deepmind","robot","autonomous","neural","model","agent",
                        "sora","chatbot","generative","grok","mistral","meta ai","nvidia","copilot"];
    if (!aiKeywords.some(k => text.includes(k))) continue;
    items.push({
      title:       cleanTitle,
      url:         link.replace(/[\r\n\t ]/g, ""),
      source:      source.name,
      sourceColor: source.color,
      publishedAt: pubDate,
      snippet,
    });
  }
  return items;
}

let aiNewsCache: AINewsItem[] = [];
let aiNewsFetchedAt = 0;

async function fetchAINews(): Promise<AINewsItem[]> {
  // Cache for 30 minutes
  if (aiNewsCache.length > 0 && Date.now() - aiNewsFetchedAt < 30 * 60 * 1000) {
    return aiNewsCache;
  }
  const results = await Promise.allSettled(
    AI_NEWS_SOURCES.map(async (src) => {
      const res = await fetch(src.url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseRSS(xml, src);
    })
  );
  const all: AINewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  // Sort by recency (best-effort date parse), dedup by title
  const seen = new Set<string>();
  const deduped = all.filter(item => {
    const key = item.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  // Sort newest first
  deduped.sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return db - da;
  });
  aiNewsCache    = deduped.slice(0, 10);
  aiNewsFetchedAt = Date.now();
  console.log(`[AINews] Fetched ${aiNewsCache.length} AI stories from ${AI_NEWS_SOURCES.length} sources`);
  return aiNewsCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — GROK-POWERED AUTONOMOUS STORY ENGINE v2
// Multi-source signals (on-chain + marketplace + social) → Grok narrative
// → Episodic memory → Auto-post to @NORMIES_TV
// ─────────────────────────────────────────────────────────────────────────────

// Poller state
let pollerRunning = false;
let pollerStatus: {
  lastRun: string | null;
  lastEpisode: number | null;
  lastTweetUrl: string | null;
  lastError: string | null;
  signalsFound: number;
  sources: Record<string, number>;
  cycleCount: number;
  nextRun: string | null;
  lastGrokCost?: number;
} = {
  lastRun: null, lastEpisode: null, lastTweetUrl: null,
  lastError: null, signalsFound: 0, sources: {},
  cycleCount: 0, nextRun: null,
};

// Episode memory — Grok reads this for continuity
const episodeMemory: EpisodeMemory[] = [];

// ── GROK-POWERED autonomous pipeline ─────────────────────────────
async function pollAndGenerateEpisode() {
  if (pollerRunning) return;
  pollerRunning = true;
  const runStart = new Date().toISOString();
  console.log(`[NormiesTV] Grok pipeline starting — ${runStart}`);

  try {
    // ── 1. Collect all signals ─────────────────────────────────
    const { signals, sources, diversity } = await collectAllSignals();

    // Persist signals to DB
    for (const sig of signals.slice(0, 20)) {
      storage.createSignal({
        type: sig.type === "burn" ? "burn"
            : sig.type === "canvas" ? "canvas_edit"
            : sig.type === "sale" ? "burn"   // reuse type field
            : "social_mention",
        tokenId: sig.tokenId ?? null,
        description: sig.description,
        weight: sig.weight,
        phase: "phase1",
        rawData: JSON.stringify(sig.rawData),
      });
    }

    // ── 2. Generate narrative with Grok ──────────────────────────
    const epNum = storage.getEpisodes().length + 1;
    console.log(`[NormiesTV] Calling Grok for EP${epNum} — ${signals.length} signals, diversity: avoid tokens ${diversity.lastFeaturedTokens}`);

    // Build editorial context — community intel + pinned story angles
    const communityCache = getCommunitySignalCache();
    const communitySnapshot = communityCache.slice(0, 10)
      .map((p: any) => `@${p.username} [${p.signal_type ?? "community"}, ${p.likes ?? 0} likes]: "${p.text?.slice(0, 120)}"`)
      .join("\n");
    // Include top community replies from previous episodes
    const replyContext = formatRepliesForContext();
    const editorialContext = {
      pinnedAngles: pinnedAngles.slice(0, 3),
      communitySnapshot: replyContext
        ? `${communitySnapshot}

${replyContext}`
        : communitySnapshot,
    };

    const grokResult = await generateEpisodeWithGrok(signals, episodeMemory, epNum, diversity, editorialContext);
    console.log(`[NormiesTV] Grok EP${epNum}: "${grokResult.title}" [${grokResult.sentiment}]`);

    // ── 3. Save episode ────────────────────────────────────────
    const featuredId = grokResult.featuredTokens?.[0] ?? 603;
    const episode = storage.createEpisode({
      tokenId: featuredId,
      title: grokResult.title,
      narrative: grokResult.narrative,
      phase: "phase1",
      signals: JSON.stringify({
        ...sources,
        totalSignals: signals.length,
        sentiment: grokResult.sentiment,
        keyEvents: grokResult.keyEvents,
        featuredTokens: grokResult.featuredTokens,
        grokModel: "grok-4-1-fast",
      }),
      status: "ready",
    });

    // Update diversity tracking so next episode avoids same tokens
    if (grokResult.featuredTokens?.length > 0) {
      updateFeaturedTokens(grokResult.featuredTokens);
    }

    // ── 4. Update Grok memory ──────────────────────────────────
    episodeMemory.push({
      episodeId: epNum,
      title: grokResult.title,
      summary: grokResult.summary,
      featuredTokens: grokResult.featuredTokens ?? [],
      keyEvents: grokResult.keyEvents ?? [],
      sentiment: grokResult.sentiment as any,
      createdAt: runStart,
    });
    // Keep last 10 episodes in memory
    if (episodeMemory.length > 10) episodeMemory.shift();

    // ── 5. Update status ──────────────────────────────────────
    pollerStatus = {
      lastRun: runStart,
      lastEpisode: episode.id,
      lastTweetUrl: null,  // updated after post
      lastError: null,
      signalsFound: signals.length,
      sources,
      cycleCount: pollerStatus.cycleCount + 1,
      nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    };

    // ── 5. Generate episode image card ────────────────────────────
    const sigData = JSON.parse(episode.signals);
    const totalBurns   = sigData.burns ?? 0;
    const totalPixels  = sigData.canvas > 0
      ? signals.filter(s => s.type === "burn")
          .reduce((sum, b) => sum + (b.rawData.pixelTotal ?? 0), 0)
      : 0;

    // Upload Normie image to X directly (OAuth 1.0a media upload — free tier)
    const normieImageUrl = `https://api.normies.art/normie/${featuredId}/image.png`;
    let xMediaId: string | undefined;
    try {
      const imgRes = await fetch(normieImageUrl);
      if (imgRes.ok) {
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        xMediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: "image/png" as any });
        console.log(`[NormiesTV] X media_id: ${xMediaId}`);
      }
    } catch (imgErr: any) {
      console.error("[NormiesTV] X media upload failed:", imgErr.message);
    }

    // ── 6. Quality gate — would a real NORMIES holder stop scrolling for this? ──
    let finalTweetText = grokResult.tweet;
    const grokKeyQ = process.env.GROK_API_KEY;
    if (grokKeyQ) {
      try {
        const qualityCheck = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKeyQ}` },
          body: JSON.stringify({
            model: "grok-3-fast",
            messages: [{
              role: "system",
              content: "You are a quality editor for @NORMIES_TV. Score tweets ruthlessly. Only high-quality, human-sounding tweets earn a post.",
            }, {
              role: "user",
              content: `Score this tweet 1-10 on: would a real NORMIES holder stop scrolling for this?

TWEET: "${grokResult.tweet}"

Scoring criteria:
- 9-10: Genuinely interesting, one clear idea, human voice, makes you want more
- 7-8: Solid, worth posting, not slop
- 5-6: Generic, could be improved, borderline
- 1-4: Stat dump, bot-speak, empty drama words, list of token numbers

BANNED phrases that auto-score 4 or below: "Sacrifices compound", "Canvas pixels burn brighter", "etched in eternity", "Burns fuel the fire", "etch dominance", "etch power forever", "Arena whispers", "power compounds", "pixels multiply"

If score is below 7, provide a rewrite (max 240 chars) that earns a 8+.

Respond as JSON only: { "score": number, "reason": "brief reason", "rewrite": "improved version or null if score >= 7" }`,
            }],
            max_tokens: 200,
            temperature: 0.3,
          }),
        });

        if (qualityCheck.ok) {
          const qData = await qualityCheck.json();
          const qText = qData.choices?.[0]?.message?.content?.trim() ?? "{}";
          const qClean = qText.replace(/```json\n?|```/g, "").trim();
          const q = JSON.parse(qClean);
          console.log(`[NormiesTV] Quality gate EP${epNum}: score ${q.score}/10 — ${q.reason}`);

          if (q.score < 7 && q.rewrite) {
            console.log(`[NormiesTV] Rewriting tweet (score ${q.score}): ${q.rewrite}`);
            finalTweetText = q.rewrite;
          } else if (q.score < 5) {
            console.log(`[NormiesTV] EP${epNum} SKIPPED — quality score ${q.score} too low, no rewrite available`);
            pollerStatus.lastError = `Quality gate blocked EP${epNum} (score: ${q.score})`;
            return;
          }
        }
      } catch (qErr: any) {
        console.warn("[NormiesTV] Quality gate check failed, posting anyway:", qErr.message);
      }
    }

    // ── 7. Post opener tweet with image directly via X (OAuth 1.0a + media) ──
    let tweetUrl: string | undefined;
    let openerTweetId: string | undefined;

    try {
      const openerTweet = await xWrite.v2.tweet({
        text: finalTweetText,
        ...(xMediaId ? { media: { media_ids: [xMediaId] } } : {}),
      });
      openerTweetId = openerTweet.data?.id;
      tweetUrl = openerTweetId ? `https://x.com/NORMIES_TV/status/${openerTweetId}` : `https://x.com/NORMIES_TV`;
      storage.updateEpisodeStatus(episode.id, "posted", tweetUrl);
      pollerStatus.lastTweetUrl = tweetUrl;
      console.log(`[NormiesTV] EP${epNum} opener posted${xMediaId ? " with image" : ""}: ${tweetUrl}`);
    } catch (openerErr: any) {
      console.error("[NormiesTV] Opener tweet failed:", openerErr.message);
    }

    // ── Thread posts REMOVED — quality over volume ──────────────────────
    // One great tweet with one great image > four mediocre thread tweets.
    // The opener IS the post. If it doesn't stand alone, it wasn't good enough.
    // Thread replies dumping stats were the #1 source of slop. Killed intentionally.
    console.log(`[NormiesTV] EP${epNum} — single tweet mode (no thread)`);

    console.log(`[NormiesTV] EP${epNum} — ${tweetUrl ? "POSTED to @NORMIES_TV" : "ready in queue"}`);

  } catch (e: any) {
    console.error("[NormiesTV] Pipeline error:", e.message);
    pollerStatus.lastError = e.message;
    pollerStatus.lastRun = runStart;
  } finally {
    pollerRunning = false;
  }
}

// ── Episode cadence: 12 hours + quality gate ──────────────────────────────────
// Slow = better. Each post must earn its place. No slop just to fill the feed.
const POLL_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

// Track last burn commitId at episode-post time — don't post if no new burns AND
// no serc/normiesART social activity since last episode
let lastEpisodeSignatureHash = "";

function signalSignature(signals: any[]): string {
  const burns = signals.filter((s: any) => s.type === "burn").map((s: any) => s.rawData?.commitId ?? s.tokenId).join(",");
  const social = signals.filter((s: any) => s.type === "social_x").slice(0,3).map((s: any) => s.rawData?.id ?? s.description?.slice(0,20)).join(",");
  return `${burns}|${social}`;
}

setInterval(pollAndGenerateEpisode, POLL_INTERVAL);
setTimeout(() => {
  pollerStatus.nextRun = new Date(Date.now() + POLL_INTERVAL).toISOString();
  pollAndGenerateEpisode();
}, 15_000);

// ── Daily News Dispatch — 8am ET every day ─────────────────────────────
// THE 100 top tokens by AP — used as fallback featured image pool
const THE_100_TOKENS = [8553, 45, 1932, 235, 615, 603, 5070, 666, 306, 1337, 420, 100, 200, 500];

async function postDailyNewsDispatch() {
  const grokKey = process.env.GROK_API_KEY;
  if (!grokKey) return;
  console.log("[NormiesTV:News] Daily Dispatch starting...");
  try {

    // ── 1. Gather all signals in parallel ─────────────────────────
    const [cgRes, burnsRes, normiesStatsRes] = await Promise.allSettled([
      fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin&order=market_cap_desc&per_page=2&sparkline=false&price_change_percentage=24h"),
      fetch("https://api.normies.art/history/burns?limit=10"),
      fetch("https://api.normies.art/stats"),
    ]);

    // ── ETH/BTC prices ─────────────────────────────────────────────
    let ethPrice = "", btcPrice = "", ethChange = "", btcChange = "";
    if (cgRes.status === "fulfilled" && cgRes.value.ok) {
      const coins = await cgRes.value.json();
      const eth = coins.find((c: any) => c.id === "ethereum");
      const btc = coins.find((c: any) => c.id === "bitcoin");
      if (eth) {
        ethPrice = `$${eth.current_price.toLocaleString()}`;
        ethChange = `${eth.price_change_percentage_24h > 0 ? "+" : ""}${eth.price_change_percentage_24h?.toFixed(1)}%`;
      }
      if (btc) {
        btcPrice = `$${btc.current_price.toLocaleString()}`;
        btcChange = `${btc.price_change_percentage_24h > 0 ? "+" : ""}${btc.price_change_percentage_24h?.toFixed(1)}%`;
      }
    }

    // ── NORMIES on-chain activity ──────────────────────────────────
    let featuredTokenId = THE_100_TOKENS[new Date().getDate() % THE_100_TOKENS.length];
    let recentBurns = 0;
    let totalBurns = 0;
    let totalCanvas = 0;
    let recentBurnSummary = "";

    if (burnsRes.status === "fulfilled" && burnsRes.value.ok) {
      const burnData = await burnsRes.value.json();
      const list: any[] = Array.isArray(burnData) ? burnData : (burnData.burns || []);
      recentBurns = list.slice(0, 10).reduce((sum: number, b: any) => sum + (b.tokenCount || b.burnedCount || b.burned_count || 1), 0);
      const latestBurn = list[0];
      const latestId = latestBurn?.receiverTokenId || latestBurn?.tokenId || latestBurn?.token_id;
      if (latestId && !isNaN(Number(latestId))) featuredTokenId = Number(latestId);
      // Build a summary of unique tokens burned recently
      const uniqueTokens = [...new Set(list.slice(0, 5).map((b: any) => b.receiverTokenId || b.tokenId).filter(Boolean))];
      recentBurnSummary = uniqueTokens.slice(0, 3).map((id: any) => `#${id}`).join(", ");
    }

    if (normiesStatsRes.status === "fulfilled" && normiesStatsRes.value.ok) {
      const stats = await normiesStatsRes.value.json();
      totalBurns  = stats.totalBurns  || stats.total_burns  || 0;
      totalCanvas = stats.totalCanvas || stats.customized   || stats.canvasCount || 0;
    }

    // ── NFT market snapshot (static/cached — top floor per chain) ─
    const nftMarket = [
      { chain: "ETH",   collection: "CryptoPunks",  floor: "52.25 ETH",    change: "+2.5%",  status: "🔥" },
      { chain: "BTC",   collection: "NodeMonkes",   floor: "0.078 BTC",    change: "+36.7%", status: "🔥" },
      { chain: "SOL",   collection: "Mad Lads",     floor: "37.28 SOL",    change: "+3.1%",  status: "🔥" },
      { chain: "BASE",  collection: "Base Gods",    floor: "0.61 ETH",     change: "+11.0%", status: "📈" },
    ];
    const nftContext = nftMarket.map(n => `${n.chain} ${n.collection} ${n.floor} (${n.change})`).join(" · ");

    // ── AI news headline ───────────────────────────────────────────
    const aiHeadlines = await fetchAINews();
    const topAI = aiHeadlines[0];
    const aiContext = topAI ? `AI headline: "${topAI.title}" — ${topAI.source}` : "";

    // ── Community pulse ────────────────────────────────────────────
    const communityCache = getCommunitySignalCache();
    const founderPost = communityCache.find((p: any) => p.signal_type === "founder");
    const founderContext = founderPost ? `@serc1n recently: "${founderPost.text?.slice(0, 120)}"` : "";

    // ── 2. Ask Grok to write the structured dispatch ───────────────
    const grokResp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are Agent #306, voice of NormiesTV — a media network built by and for NORMIES holders.

NORMIES is a 10,000 pixel art PFP collection on Ethereum. Phase 1: The Canvas (burn to customize, on-chain permanently). Phase 2: Arena opens May 15, 2026. @serc1n is the only founder.

THE [NORMIES NEWS] FORMAT — follow this structure EXACTLY:
─────────────────────────────────
[NORMIES NEWS] {day} dispatch.

{NORMIES on-chain activity — what's burning, what's being built. Specific. Named. Real.}

{NFT market pulse — 2-3 top collections, floor/change. Brief. Numbers matter. No commentary needed.}

{One AI or Web3 signal — connect it back to why NORMIES and on-chain identity matter right now.}

{Close on NORMIES — one sentence. Invite. Builder energy. gnormies. 🖤}
#NormiesTV
─────────────────────────────────

RULES:
- Max 280 chars total (Twitter limit)
- NORMIES activity is ALWAYS the lead — never bury it
- NFT market: just the numbers, no hype words
- AI angle: connect it to on-chain permanence, identity, or co-creation
- Close: short, human, never "LFG" or "WAGMI", never exclamation points for hype
- gnormies 🖤 is the close — use it

BANNED: "sacrifices compound", "canvas grows stronger", "etched forever", "Arena whispers", stat dumps with no narrative`
          },
          {
            role: "user",
            content: `Write today's [NORMIES NEWS] dispatch using this live data:

NORMIES ON-CHAIN:
- ${recentBurns} burns in the last 10 transactions. Active tokens: ${recentBurnSummary || `#${featuredTokenId}`}
- Total burns all-time: ${totalBurns || "1,400+"}. Customized canvases: ${totalCanvas || "205+"}
- Arena opens May 15, 2026
${founderContext ? `- ${founderContext}` : ""}

NFT MARKET TODAY:
${nftContext}

${aiContext ? `AI/WEB3 SIGNAL:
${aiContext}` : ""}

MARKET:
- ETH: ${ethPrice || "$2,148"} (${ethChange || "+0.5%"})
- BTC: ${btcPrice || "$70,315"} (${btcChange || "+0.6%"})

Featured Normie: #${featuredTokenId}
Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" })}

Write the dispatch. 280 chars max. Follow the format exactly. Return ONLY the tweet text.`
          }
        ],
        max_tokens: 350,
        temperature: 0.75,
      }),
    });

    let tweetText = "";
    if (grokResp.ok) {
      const data = await grokResp.json();
      tweetText = data.choices?.[0]?.message?.content?.trim() ?? "";
    }

    // Fallback — structured but no AI needed
    if (!tweetText) {
      tweetText = `[NORMIES NEWS] ${new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })} dispatch.

${recentBurns} burns. ${recentBurnSummary || `#${featuredTokenId}`} active on the Canvas.
ETH ${ethPrice} · BTC ${btcPrice}
CryptoPunks 52.25 ETH · NodeMonkes 0.078 BTC · Mad Lads 37 SOL

The art is the mechanics. gnormies. 🖤 #NormiesTV`;
    }

    // Trim if over 280
    if (tweetText.length > 280) tweetText = tweetText.slice(0, 277) + "...";

    console.log(`[NormiesTV:News] Dispatch draft:\n${tweetText}`);

    // ── 3. Upload featured Normie image ───────────────────────────
    let xMediaId: string | undefined;
    try {
      const normieImgUrl = `https://api.normies.art/normie/${featuredTokenId}/image.png`;
      const imgRes = await fetch(normieImgUrl);
      if (imgRes.ok) {
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        xMediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: "image/png" as any });
        console.log(`[NormiesTV:News] Normie #${featuredTokenId} image uploaded — media_id: ${xMediaId}`);
      }
    } catch (imgErr: any) {
      console.warn(`[NormiesTV:News] Image upload failed:`, imgErr.message);
    }

    // ── 4. Post to @NORMIES_TV ────────────────────────────────────
    const tweet = await xWrite.v2.tweet({
      text: tweetText,
      ...(xMediaId ? { media: { media_ids: [xMediaId] } } : {}),
    });
    console.log(`[NormiesTV:News] Daily Dispatch posted — #${featuredTokenId} — ${tweet.data?.id}`);

  } catch (err: any) {
    console.error("[NormiesTV:News] Daily Dispatch error:", err.message);
  }
}

// Schedule daily dispatch at 8am ET (= 12:00 UTC, or 13:00 UTC during EDT)
function scheduleDailyNewsDispatch() {
  const now = new Date();
  // 8am ET = 12:00 UTC (EST, Nov–Mar) or 13:00 UTC (EDT, Mar–Nov)
  // Use 12:00 UTC year-round for simplicity (within ~1h of 8am ET)
  const target = new Date();
  target.setUTCHours(12, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // already passed today → tomorrow
  const msUntil = target.getTime() - now.getTime();
  console.log(`[NormiesTV:News] Daily Dispatch scheduled in ${Math.round(msUntil / 60000)}min (next 8am ET)`);
  setTimeout(() => {
    postDailyNewsDispatch();
    setInterval(postDailyNewsDispatch, 24 * 60 * 60 * 1000); // every 24h after first run
  }, msUntil);
}
scheduleDailyNewsDispatch();

// ── Real-time Burn Receipt Engine ────────────────────────────────────────
let burnPollerRunning = false;
const BURN_POLL_INTERVAL = 90_000; // 90 seconds

async function runBurnPoller() {
  if (burnPollerRunning) return;
  burnPollerRunning = true;
  try {
    const newBurns = await checkForNewBurns();
    if (newBurns.length > 0) {
      console.log(`[BurnReceipt] ${newBurns.length} new burn(s) detected`);
      for (const burn of newBurns) {
        // Post burn receipt for every burn
        await processBurnReceipt(burn, xWrite);

        // Auto-generate a CYOA draft for significant burns (5+ souls)
        const grokKey = process.env.GROK_API_KEY;
        if (grokKey && burn.tokenCount >= 5) {
          try {
            let pixelTotal = 0;
            try { pixelTotal = JSON.parse(burn.pixelCounts).reduce((s: number, n: number) => s + n, 0); } catch {}
            const cyoaEp = await generateCYOAEpisode({
              trigger: "burn",
              tokenId: burn.receiverTokenId,
              tokenCount: burn.tokenCount,
              pixelTotal,
              grokKey,
            });
            if (cyoaEp) {
              console.log(`[CYOA] Auto-draft generated for ${burn.tokenCount}-soul burn on #${burn.receiverTokenId}`);
            }
          } catch (cyoaErr: any) {
            console.warn("[CYOA] Auto-draft failed:", cyoaErr.message);
          }
        }

        if (newBurns.length > 1) await new Promise(r => setTimeout(r, 8000));
      }
    }
  } catch (e: any) {
    console.error("[BurnReceipt] Poller error:", e.message);
  } finally {
    burnPollerRunning = false;
  }
}

// ── Pre-Arena CYOA auto-draft — weekly as May 15 approaches ──────────────────
// Generates a CYOA draft every Sunday when Arena is within 60 days
async function runPreArenaCYOADraft() {
  const grokKey = process.env.GROK_API_KEY;
  if (!grokKey) return;
  const daysUntilArena = Math.ceil((new Date("2026-05-15").getTime() - Date.now()) / 86400000);
  if (daysUntilArena <= 0 || daysUntilArena > 60) return;

  // Check if we already have a draft from this week
  const state = getCYOAState();
  const lastPreArena = state.episodes.find(e => e.trigger === "pre_arena" && e.status === "draft");
  if (lastPreArena) {
    const ageHours = (Date.now() - new Date(lastPreArena.createdAt).getTime()) / 3600000;
    if (ageHours < 120) return; // already have a fresh draft (<5 days old)
  }

  // Pick a top token to feature (rotate through THE 100)
  const top100 = [8553, 45, 1932, 235, 615, 603];
  const tokenId = top100[new Date().getDate() % top100.length];

  try {
    const ep = await generateCYOAEpisode({ trigger: "pre_arena", tokenId, grokKey });
    if (ep) console.log(`[CYOA] Pre-Arena auto-draft generated — ${daysUntilArena}d to Arena, featuring #${tokenId}`);
  } catch (e: any) {
    console.warn("[CYOA] Pre-Arena draft failed:", e.message);
  }
}

// Run pre-Arena draft check every Sunday at 10am ET (14:00 UTC)
function schedulePreArenaCYOA() {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(14, 0, 0, 0);
  const day = target.getUTCDay();
  const daysUntilSunday = day === 0 ? (target <= now ? 7 : 0) : (7 - day);
  target.setDate(target.getDate() + daysUntilSunday);
  if (day === 0 && target <= now) target.setDate(target.getDate() + 7);
  const msUntil = target.getTime() - now.getTime();
  console.log(`[CYOA] Pre-Arena draft scheduled in ${Math.round(msUntil / 3600000)}h (Sunday 10am ET)`);
  setTimeout(() => {
    runPreArenaCYOADraft();
    setInterval(runPreArenaCYOADraft, 7 * 24 * 60 * 60 * 1000);
  }, msUntil);
}

// Start burn poller after 30s delay (let server settle)
setTimeout(() => {
  runBurnPoller(); // first run — records baseline, no posts
  setInterval(runBurnPoller, BURN_POLL_INTERVAL);
  console.log(`[BurnReceipt] Real-time burn poller started (every ${BURN_POLL_INTERVAL/1000}s)`);
}, 30_000);

// Schedule pre-Arena CYOA drafts (Sundays when Arena <60 days away)
schedulePreArenaCYOA();

// ── Community Signal Poller — refreshes every 30 minutes ────────────────────
// Keeps x_search cache warm so episode generation always has fresh community data
async function runCommunitySignalPoller() {
  try {
    const signals = await searchNormiesSocial();
    // Ingest every holder found into the catalog
    ingestSignals(signals, "NORMIES COMMUNITY");
    console.log(`[Community] Catalogued ${signals.length} signals from ${new Set(signals.map((s: any) => s.username)).size} unique holders`);
  } catch (e: any) {
    console.warn("[Community] Poller error:", e.message);
  }
}

// Start after 60s delay, then every 30 minutes
setTimeout(() => {
  runCommunitySignalPoller();
  setInterval(runCommunitySignalPoller, 30 * 60 * 1000);
  console.log("[Community] Real-time signal poller started (every 30min)");
}, 60_000);

// Reply watcher — polls X for replies to @NORMIES_TV every 30 minutes
// Stagger by 15 minutes so it doesn't fire at same time as community poller
setTimeout(() => {
  fetchReplies();
  setInterval(fetchReplies, 30 * 60 * 1000);
  console.log("[ReplyWatcher] Reply watcher started (every 30min)");
}, 15 * 60 * 1000);

// ── Weekly Leaderboard Scheduler ─────────────────────────────────────────────
setTimeout(() => {
  scheduleWeeklyLeaderboard(xWrite, process.env.GROK_API_KEY);
}, 5_000);

// ── Following Sync — @NORMIES_TV follows = confirmed community ────────────────
// Syncs on boot, then every 6 hours. Seeds holder catalog with confirmed holders.
setTimeout(() => {
  scheduleFollowingSync(xClient);
}, 10_000);

// ── Editorial Summary Cache ─────────────────────────────────────────────────────
// Decoupled from signal collection — generated async, served instantly from cache.
// Prevents the digest endpoint from timing out while waiting for Grok.
interface EditorialCache {
  summary:     string;
  storyAngles: string[];
  sentiment:   string;
  spotlight:   string;
  generatedAt: number;
}
let editorialCache: EditorialCache = {
  summary: "", storyAngles: [], sentiment: "", spotlight: "", generatedAt: 0,
};
let editorialRefreshing = false;
const EDITORIAL_TTL = 20 * 60 * 1000; // 20 minutes

function getCachedEditorialSummary() {
  return editorialCache;
}

async function refreshEditorialSummaryAsync(posts: any[], grokKey: string) {
  // Don't spam Grok if a refresh is already in flight or cache is fresh
  if (editorialRefreshing) return;
  if (Date.now() - editorialCache.generatedAt < EDITORIAL_TTL && editorialCache.storyAngles.length > 0) return;
  editorialRefreshing = true;

  // Wait 12s so parallel x_searches finish before hitting Grok again
  await new Promise(r => setTimeout(r, 12000));

  try {
    const postContext = posts.slice(0, 20).map((p: any) =>
      `@${p.username} [${p.signal_type ?? "general"}, ${p.likes ?? 0} likes]: "${p.text?.slice(0, 160)}"`
    ).join("\n");

    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are Agent #306 — editorial intelligence for NormiesTV. Analyze the community's X posts and surface what matters for the next narrative.

ECOSYSTEM:
- @serc1n: ONLY founder. His posts are canon. @normiesART: official. @nuclearsamurai: community creator (XNORMIES).
- Phase 1: Canvas (burn to customize). Phase 2: Arena opens May 15, 2026. Zombies emerge first.
- "gnormies!" is the greeting. Burns are rituals. Co-creators, not holders.
- NORMIES Awakening is happening — serc is using that word intentionally.
- NFC Summit June 2026 — NORMIES is a sponsor.

Return JSON only:
{
  "summary": "2-3 sentence editorial read of what the community is building/feeling today",
  "sentiment": "excited|building|celebratory|quiet|anxious",
  "storyAngles": [
    "Angle 1: specific, names real holders from the posts, actionable for Agent #306",
    "Angle 2: specific, different tone/focus from Angle 1",
    "Angle 3: the unexpected angle — the thing nobody else would cover"
  ],
  "spotlight": "One holder or moment from today's posts that deserves its own post. Be specific."
}`,
        }, {
          role: "user",
          content: `Today's NORMIES community posts (${posts.length} total, ${new Set(posts.map((p:any)=>p.username)).size} unique voices):\n\n${postContext}\n\nSurface the story. What should Agent #306 tell today?`,
        }],
        max_tokens: 500,
        temperature: 0.75,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (resp.ok) {
      const data  = await resp.json();
      const raw   = data.choices?.[0]?.message?.content?.trim() ?? "{}";
      const clean = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(clean);
      editorialCache = {
        summary:     parsed.summary     ?? "",
        storyAngles: parsed.storyAngles ?? [],
        sentiment:   parsed.sentiment   ?? "building",
        spotlight:   parsed.spotlight   ?? "",
        generatedAt: Date.now(),
      };
      console.log(`[NormiesTV:Editorial] Summary refreshed — ${editorialCache.storyAngles.length} angles, sentiment: ${editorialCache.sentiment}`);
    }
  } catch (e: any) {
    console.warn("[NormiesTV:Editorial] Summary refresh failed:", e.message);
  } finally {
    editorialRefreshing = false;
  }
}

// Module-scope so episode generator + routes both can access
const pinnedAngles: string[] = [];

export function registerRoutes(httpServer: Server, app: Express) {

  // ── OAuth 2.0 PKCE auth flow ────────────────────────────────────
  app.get("/api/x/oauth2/start", async (_req, res) => {
    try {
      const client = new TwitterApi({ clientId: OAUTH2_CLIENT_ID, clientSecret: "" } as any);
      const { url, codeVerifier, state } = (client as any).generateOAuth2AuthLink(
        OAUTH2_CALLBACK_URL,
        { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
      );
      oauth2State = { codeVerifier, state };
      res.json({ ok: true, authUrl: url, message: "Visit authUrl to authorize @NORMIES_TV" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/x/oauth2/callback", async (req, res) => {
    const { code, state } = req.query as { code: string; state: string };
    if (!oauth2State || state !== oauth2State.state) {
      return res.status(400).send("Invalid state. Try /api/x/oauth2/start again.");
    }
    try {
      const client = new TwitterApi({ clientId: OAUTH2_CLIENT_ID, clientSecret: "" } as any);
      const { accessToken, refreshToken, expiresIn } = await (client as any).loginWithOAuth2({
        code,
        codeVerifier: oauth2State.codeVerifier,
        redirectUri: OAUTH2_CALLBACK_URL,
      });
      saveToken({ accessToken, refreshToken, expiresAt: Date.now() + (expiresIn ?? 7200) * 1000 });
      oauth2State = null;
      res.send(`
        <html><body style="background:#0a0b0d;color:#e3e5e4;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
          <div style="font-size:48px">✅</div>
          <h2 style="color:#f97316;margin:0">@NORMIES_TV authorized!</h2>
          <p style="color:#2dd4bf;margin:0">OAuth 2.0 token saved. You can close this tab.</p>
          <p style="font-size:11px;opacity:0.4">NormiesTV Producer Dashboard</p>
        </body></html>
      `);
    } catch (e: any) {
      res.status(500).send(`Authorization failed: ${e.message}`);
    }
  });

  app.get("/api/x/oauth2/status", (_req, res) => {
    res.json({
      authorized: !!oauth2Token,
      expiresAt: oauth2Token?.expiresAt,
      expiresIn: oauth2Token?.expiresAt ? Math.round((oauth2Token.expiresAt - Date.now()) / 1000 / 60) + " min" : null,
    });
  });

  // ── X (Twitter) posting ─────────────────────────────────────────
  app.post("/api/x/post", async (req, res) => {
    const { episodeId, text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    try {
      // Try OAuth 2.0 first (free tier), fall back to OAuth 1.0a
      const oauth2Client = await getOAuth2Client();
      let tweetId: string | undefined;

      if (oauth2Client) {
        const tweet = await oauth2Client.v2.tweet(text);
        tweetId = tweet.data?.id;
      } else {
        const tweet = await xWrite.v2.tweet(text);
        tweetId = tweet.data?.id;
      }

      const tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : undefined;
      if (episodeId) storage.updateEpisodeStatus(Number(episodeId), "posted", tweetUrl);
      res.json({ ok: true, tweetId, tweetUrl });
    } catch (e: any) {
      console.error("[NormiesTV] X post error:", e);
      res.status(500).json({ error: e.message ?? "Failed to post to X" });
    }
  });

  // Test X connection
  app.get("/api/x/verify", async (_req, res) => {
    try {
      const me = await xWrite.v2.me();
      const oauth2Status = !!oauth2Token;
      res.json({ ok: true, username: me.data?.username, name: me.data?.name, oauth2: oauth2Status });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Serve generated episode image cards
  app.get("/api/cards/:filename", (req, res) => {
    const filePath = `/tmp/${req.params.filename}`;
    if (!req.params.filename.startsWith("normiestv_ep") || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Not found" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(fs.readFileSync(filePath));
  });

  // Manual trigger for pipeline
  app.post("/api/poller/run", async (_req, res) => {
    if (pollerRunning) return res.json({ ok: false, message: "Pipeline already running" });
    pollAndGenerateEpisode();
    res.json({ ok: true, message: "Pipeline triggered — episode will generate and post in background" });
  });

  // Post tweet with image via twitter-api-v2 (OAuth 1.0a, uploads media then tweets)
  app.post("/api/x/post-with-media", async (req, res) => {
    const { text, imageUrl } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    try {
      let mediaId: string | undefined;
      if (imageUrl) {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          mediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: "image/png" as any });
        }
      }
      const tweet = await xWrite.v2.tweet({
        text,
        ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
      });
      const tweetId = tweet.data?.id;
      const tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : undefined;
      res.json({ ok: true, tweetId, tweetUrl, mediaId });
    } catch (e: any) {
      console.error("[NormiesTV] post-with-media error:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Upload image to X via v1.1 media/upload (OAuth 1.0a — works on free tier)
  // Returns media_id_string for attaching to tweets
  app.post("/api/x/upload-media", async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    try {
      // Fetch the image
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`);
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get("content-type") ?? "image/png";

      // Upload to X using twitter-api-v2 v1 media upload
      const mediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: contentType as any });
      console.log(`[NormiesTV] X media uploaded: ${mediaId}`);
      res.json({ ok: true, mediaId });
    } catch (e: any) {
      console.error("[NormiesTV] X media upload error:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Poller status
  app.get("/api/poller/status", (_req, res) => {
    // Calculate next 8am ET (12:00 UTC) for news dispatch
    const nextNewsTarget = new Date();
    nextNewsTarget.setUTCHours(12, 0, 0, 0);
    if (nextNewsTarget <= new Date()) nextNewsTarget.setDate(nextNewsTarget.getDate() + 1);
    const communityCache = getCommunitySignalCache();
    res.json({
      running: pollerRunning,
      ...pollerStatus,
      intervalHours: 12,
      newsDispatch: {
        scheduleLabel: "Daily · 8am ET",
        nextRun: nextNewsTarget.toISOString(),
      },
      communitySignals: {
        count: communityCache.length,
        founderPosts: communityCache.filter((p: any) => p.signal_type === "founder").length,
        burnStories: communityCache.filter((p: any) => p.signal_type === "burn_story").length,
        scheduleLabel: "Every 30min",
        lastRefreshed: communityCache[0]?.capturedAt ?? null,
      },
      replies: {
        count: getReplyState().replies.length,
        questions: getReplyState().replies.filter(r => r.replyType === "question").length,
        loreSuggestions: getReplyState().replies.filter(r => r.replyType === "lore_suggestion").length,
        scheduleLabel: "Every 30min",
        lastFetched: getReplyState().lastFetched,
      },
    });
  });

  // Manual trigger for daily news dispatch (for testing / on-demand)
  app.post("/api/news/dispatch", async (_req, res) => {
    res.json({ ok: true, message: "Daily News Dispatch triggered" });
    postDailyNewsDispatch().catch(console.error);
  });

  // ── Burn Receipt status + manual trigger ─────────────────────────
  app.get("/api/burns/receipt-status", (_req, res) => {
    const s = getReceiptState();
    res.json({
      totalReceipts: s.totalReceipts,
      lastReceiptAt: s.lastReceiptAt,
      lastCommitId: s.lastCommitId,
      processedCount: s.processedCommitIds.length,
      pollerInterval: `${BURN_POLL_INTERVAL / 1000}s`,
      pollerRunning: burnPollerRunning,
    });
  });

  app.post("/api/burns/test-receipt", async (req, res) => {
    const tokenId = Number(req.body?.tokenId ?? 8553);
    res.json({ ok: true, message: `Generating test receipt for #${tokenId}` });
    // Fire a test receipt without touching state
    const { generateBurnReceiptCard, generateBurnNarrative, buildBurnTweetText } = await import("./burnReceiptEngine");
    try {
      const narrative = await generateBurnNarrative({ receiverTokenId: tokenId, burnedTokenIds: [tokenId], tokenCount: 5, pixelTotal: 8000, level: 10, actionPoints: 100 });
      const tweetText = buildBurnTweetText({ receiverTokenId: tokenId, tokenCount: 5, pixelTotal: 8000, level: 10, actionPoints: 100, narrative });
      const cardBuf = await generateBurnReceiptCard({ receiverTokenId: tokenId, burnedTokenIds: [tokenId], tokenCount: 5, pixelTotal: 8000, narrative, receiptNumber: 9999, level: 10, actionPoints: 100 });
      let xMediaId: string | undefined;
      if (cardBuf) xMediaId = await xWrite.v1.uploadMedia(cardBuf, { mimeType: "image/png" as any });
      await xWrite.v2.tweet({ text: tweetText, ...(xMediaId ? { media: { media_ids: [xMediaId] } } : {}) });
    } catch (e: any) { console.error("[BurnReceipt] Test error:", e.message); }
  });

  // ── Weekly Leaderboard manual trigger ─────────────────────────
  app.post("/api/leaderboard/post", async (_req, res) => {
    res.json({ ok: true, message: "Weekly leaderboard post triggered" });
    postWeeklyLeaderboard(xWrite, process.env.GROK_API_KEY).catch(console.error);
  });

  app.get("/api/leaderboard/live", async (_req, res) => {
    try {
      const leaders = await fetchLiveLeaderboard();
      res.json({ leaders, fetchedAt: new Date().toISOString() });
    } catch { res.status(500).json({ error: "Failed to fetch leaderboard" }); }
  });

  // ── Community Intelligence Digest ────────────────────────────────────
  // Aggregates all community X posts about NORMIES, dedupes, classifies,
  // and generates a summary for the editor (MrRayG) to review
  app.get("/api/community/digest", async (req, res) => {
    try {
      // Always respond instantly from cache — never block the HTTP request on x_search.
      // If ?force=true or cache is empty: kick a background refresh and return whatever we have.
      const cachedPosts = getCommunitySignalCache();
      const needsRefresh = req.query.force === "true" || cachedPosts.length === 0;

      if (needsRefresh) {
        // Reset and kick background refresh (non-blocking)
        resetCommunityCache();
        searchNormiesSocial()
          .then(fresh => {
            console.log(`[Digest] Signals refreshed (${fresh.length} posts) — queuing editorial summary`);
            return refreshEditorialSummaryAsync(fresh, process.env.GROK_API_KEY ?? "");
          })
          .catch(e => console.warn("[Digest] Background refresh failed:", e.message));
      } else {
        // Kick editorial summary refresh in background if stale
        refreshEditorialSummaryAsync(cachedPosts, process.env.GROK_API_KEY ?? "");
      }

      // Serve from cache immediately
      const posts = cachedPosts;

      // Count unique posters
      const uniquePosters = new Set(posts.map((p: any) => p.username)).size;

      // Group by signal type
      const byType: Record<string, typeof posts> = {};
      for (const post of posts) {
        const t = (post as any).signal_type ?? "general";
        if (!byType[t]) byType[t] = [];
        byType[t].push(post);
      }

      // ── Editorial summary — served from cache, generated async ──────────────
      // Decoupled from signal collection to prevent HTTP timeout.
      // The summary is generated in the background and cached for 20 minutes.
      // Refresh button always gets fresh signals instantly; summary populates within ~10s.
      const { summary, storyAngles, sentiment, spotlight } = getCachedEditorialSummary();

      // Kick off a background refresh of the summary (non-blocking)
      refreshEditorialSummaryAsync(posts, process.env.GROK_API_KEY ?? "");

      res.json({
        totalPosts: posts.length,
        uniquePosters,
        byType: Object.entries(byType).map(([type, typePosts]) => ({
          type,
          count: typePosts.length,
          posts: typePosts.map((p: any) => ({
            username: p.username,
            text: p.text,
            likes: p.likes ?? 0,
            url: p.url ?? "",
            signal_type: p.signal_type,
            capturedAt: (p as any).capturedAt ?? null,
          })),
        })),
        summary,
        storyAngles,
        sentiment,
        spotlight,
        summaryReady: storyAngles.length > 0,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Allow editor to pin a story angle for the next episode
  // (pinnedAngles is module-scoped — declared before registerRoutes)
  app.post("/api/community/pin-angle", (req, res) => {
    const { angle } = req.body;
    if (angle && typeof angle === "string") {
      pinnedAngles.unshift(angle);
      if (pinnedAngles.length > 5) pinnedAngles.pop();
      res.json({ ok: true, pinnedAngles });
    } else {
      res.status(400).json({ error: "angle required" });
    }
  });

  app.get("/api/community/pinned", (_req, res) => {
    res.json({ pinnedAngles });
  });

  // ── Reply Watcher ────────────────────────────────────────────────
  app.get("/api/replies", (_req, res) => {
    const state = getReplyState();
    res.json({
      replies: state.replies,
      topReplies: getTopReplies(5),
      totalCaptured: state.totalCaptured,
      lastFetched: state.lastFetched,
    });
  });

  app.post("/api/replies/fetch", async (_req, res) => {
    res.json({ ok: true, message: "Fetching replies..." });
    fetchReplies().catch(console.error);
  });

  // ── Following Roster ─────────────────────────────────────────────
  // GET current following state
  app.get("/api/following", (_req, res) => {
    const state = getFollowingState();
    const pfp   = getPfpHolderUsernames();
    res.json({
      totalCount:    state.totalCount,
      lastSynced:    state.lastSynced,
      nextSync:      state.nextSync,
      pfpHolders:    pfp.length,
      accounts:      state.accounts.map(a => ({
        username:       a.username,
        name:           a.name,
        isPfpHolder:    a.isPfpHolder,
        normieTokenIds: a.normieTokenIds,
      })),
    });
  });

  // POST force re-sync
  app.post("/api/following/sync", async (_req, res) => {
    res.json({ ok: true, message: "Following sync triggered" });
    syncFollowing(xClient)
      .then(s => console.log(`[FollowingSync] Manual sync: ${s.totalCount} accounts`))
      .catch(e => console.warn("[FollowingSync] Manual sync failed:", e.message));
  });

  // ── Community Boost ──────────────────────────────────────────────
  // POST /api/boost/analyze — analyze a URL and draft a shoutout
  app.post("/api/boost/analyze", async (req, res) => {
    const { url, context } = req.body ?? {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }
    try {
      const draft = await generateBoost(url.trim(), process.env.GROK_API_KEY ?? "", context);
      res.json(draft);
    } catch (err: any) {
      console.error("[CommunityBoost] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/boost/post — post the (possibly edited) shoutout tweet
  app.post("/api/boost/post", async (req, res) => {
    const { tweet } = req.body ?? {};
    if (!tweet || typeof tweet !== "string") {
      return res.status(400).json({ error: "tweet is required" });
    }
    try {
      const result = await xWrite.v2.tweet({ text: tweet.trim() });
      const tweetId  = result.data?.id;
      const tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : null;
      res.json({ ok: true, tweetId, tweetUrl });
    } catch (err: any) {
      console.error("[CommunityBoost] Post failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Holder Catalog ──────────────────────────────────────────────
  app.get("/api/catalog/stats", (_req, res) => {
    res.json(getCatalogStats());
  });

  app.get("/api/catalog/active", (req, res) => {
    const limit = Number(req.query?.limit ?? 50);
    res.json({ holders: getMostActive(limit) });
  });

  app.get("/api/catalog/story-sources", (_req, res) => {
    res.json({ holders: getStorySourceHolders() });
  });

  app.get("/api/catalog/full", (_req, res) => {
    res.json(getCatalog());
  });

  // ── CYOA — Choose Your Own Lore ─────────────────────────────────────
  app.get("/api/cyoa/state", (_req, res) => {
    res.json(getCYOAState());
  });

  // Generate a new CYOA episode
  app.post("/api/cyoa/generate", async (req, res) => {
    const { trigger, tokenId, tokenCount, pixelTotal, level, serc1nPost, rivalTokenId } = req.body;
    const grokKey = process.env.GROK_API_KEY;
    if (!grokKey) return res.status(500).json({ error: "No Grok key" });

    const episode = await generateCYOAEpisode({
      trigger: (trigger ?? "pre_arena") as CYOATrigger,
      tokenId: tokenId ? Number(tokenId) : undefined,
      tokenCount: tokenCount ? Number(tokenCount) : undefined,
      pixelTotal: pixelTotal ? Number(pixelTotal) : undefined,
      level: level ? Number(level) : undefined,
      serc1nPost: serc1nPost ?? undefined,
      rivalTokenId: rivalTokenId ? Number(rivalTokenId) : undefined,
      grokKey,
    });

    if (!episode) return res.status(500).json({ error: "Generation failed" });
    res.json({ ok: true, episode });
  });

  // Post the hook tweet for a CYOA episode (with Normie image)
  app.post("/api/cyoa/post/:id", async (req, res) => {
    const { id } = req.params;
    const state = getCYOAState();
    const episode = state.episodes.find((e: any) => e.id === id);
    if (!episode) return res.status(404).json({ error: "Episode not found" });

    const featuredTokenId = episode.tokenId ?? 306;
    const tweetText = buildHookTweet(episode, featuredTokenId);

    // Upload the featured Normie image
    let xMediaId: string | undefined;
    try {
      const normieImg = await fetch(`https://api.normies.art/normie/${featuredTokenId}/image.png`);
      if (normieImg.ok) {
        const imgBuf = Buffer.from(await normieImg.arrayBuffer());
        xMediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: "image/png" as any });
        console.log(`[CYOA] Normie #${featuredTokenId} image uploaded for lore post`);
      }
    } catch (imgErr: any) {
      console.warn("[CYOA] Image upload failed, posting text-only:", imgErr.message);
    }

    try {
      const tweet = await xWrite.v2.tweet({
        text: tweetText,
        ...(xMediaId ? { media: { media_ids: [xMediaId] } } : {}),
      });
      const tweetId = tweet.data?.id;
      if (!tweetId) return res.status(500).json({ error: "Tweet failed" });

      // Update episode state
      episode.pollTweetId = tweetId;
      episode.postedAt = new Date().toISOString();
      episode.status = "posted";
      episode.tweetIds = [...(episode.tweetIds ?? []), tweetId];
      state.activeEpisodeId = id;
      const fs = await import("fs");
      fs.writeFileSync("/tmp/normiestv_cyoa_state.json", JSON.stringify(state, null, 2));

      console.log(`[CYOA] Hook posted with image — ${tweetId}`);
      res.json({ ok: true, tweetId, url: `https://x.com/NORMIES_TV/status/${tweetId}` });
    } catch (e: any) {
      console.error("[CYOA] Post error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Discard a draft CYOA episode
  app.delete("/api/cyoa/:id", (req, res) => {
    const { id } = req.params;
    const state = getCYOAState();
    const idx = state.episodes.findIndex(e => e.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    state.episodes.splice(idx, 1);
    if (state.activeEpisodeId === id) state.activeEpisodeId = null;
    require("fs").writeFileSync("/tmp/normiestv_cyoa_state.json", JSON.stringify(state, null, 2));
    res.json({ ok: true });
  });

  // Resolve a CYOA episode with winning option + vote counts
  app.post("/api/cyoa/resolve/:id", async (req, res) => {
    const { id } = req.params;
    const { winningOption, pollResults } = req.body;
    if (!winningOption) return res.status(400).json({ error: "winningOption required" });
    res.json({ ok: true, message: "Resolving CYOA episode..." });
    resolveCYOA(id, winningOption, pollResults ?? {}, xWrite).catch(console.error);
  });

  // ── Live Normies API proxy ───────────────────────────────────────
  app.get("/api/normies/stats", async (_req, res) => {
    const TOP_CANVAS_IDS = [603, 45, 5070, 9852, 7740, 666, 4354, 306, 1, 42, 100, 200, 500, 1000];
    try {
      const [burnsRaw, canvasResults] = await Promise.allSettled([
        fetchNormiesAPI("/history/burns?limit=50"),
        Promise.allSettled(
          TOP_CANVAS_IDS.map(async id => {
            const canvas = await fetchNormiesAPI(`/normie/${id}/canvas/info`);
            return {
              tokenId: id,
              level: canvas.level ?? 1,
              actionPoints: canvas.actionPoints ?? canvas.action_points ?? 0,
              pixelEdits: canvas.pixelEdits ?? canvas.pixel_edits ?? 0,
              burns: canvas.burnCount ?? canvas.burn_count ?? 0,
            };
          })
        ),
      ]);

      const burns = burnsRaw.status === "fulfilled" ? (burnsRaw.value ?? []) : [];
      const canvasAll = canvasResults.status === "fulfilled" ? canvasResults.value : [];
      const topCanvas = canvasAll
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map(r => r.value)
        .sort((a, b) => (b.actionPoints ?? 0) - (a.actionPoints ?? 0))
        .slice(0, 10);

      res.json({ recentBurns: burns, topCanvas, lastUpdated: new Date().toISOString() });
    } catch (e: any) {
      res.json({ recentBurns: [], topCanvas: [], lastUpdated: new Date().toISOString(), error: e.message });
    }
  });

  app.get("/api/normies/token/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const [canvas, meta] = await Promise.all([
        fetchNormiesAPI(`/normie/${id}/canvas/info`),
        fetchNormiesAPI(`/normie/${id}/metadata`).catch(() => ({})),
      ]);
      res.json({ id: Number(id), canvas, meta });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/normies/voxels/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const uzRes = await fetch(`https://normie-3d.vercel.app/api/ar/usdz?id=${id}`);
      if (!uzRes.ok) throw new Error("USDZ fetch failed");
      const buf = await uzRes.arrayBuffer();
      res.json({ tokenId: Number(id), usdSize: buf.byteLength, available: true });
    } catch (e: any) {
      res.json({ tokenId: Number(id), available: false, error: e.message });
    }
  });

  // Pixel string proxy (avoids CORS from browser)
  app.get("/api/normies/pixels/:id", async (req, res) => {
    try {
      const r = await fetch(`${NORMIES_API}/normie/${req.params.id}/pixels`);
      const text = await r.text();
      res.json({ pixels: text.trim(), tokenId: Number(req.params.id) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/normies/burns/feed", async (_req, res) => {
    try {
      const burns = await fetchNormiesAPI("/history/burns?limit=20");
      res.json(burns);
    } catch {
      res.json([]);
    }
  });

  app.get("/api/normies/hof", async (_req, res) => {
    const TOP_IDS = [603, 45, 5070, 9852, 7740, 666, 4354, 1, 42, 100];
    try {
      const results = await Promise.allSettled(
        TOP_IDS.map(async id => {
          const canvas = await fetchNormiesAPI(`/normie/${id}/canvas/info`);
          return { id, level: canvas.level || 1, ap: canvas.actionPoints || 0 };
        })
      );
      const data = results.filter(r => r.status === "fulfilled").map((r: any) => r.value);
      res.json(data.sort((a: any, b: any) => b.ap - a.ap).slice(0, 6));
    } catch {
      res.json([]);
    }
  });

  // ── Episodes ─────────────────────────────────────────────────────
  app.get("/api/episodes", (_req, res) => {
    res.json(storage.getEpisodes());
  });

  app.post("/api/episodes", (req, res) => {
    const parsed = insertEpisodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });
    const ep = storage.createEpisode(parsed.data);
    res.json(ep);
  });

  app.patch("/api/episodes/:id/status", (req, res) => {
    const { id } = req.params;
    const { status, videoUrl } = req.body;
    const updated = storage.updateEpisodeStatus(Number(id), status, videoUrl);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // ── Render Jobs ───────────────────────────────────────────────────
  app.get("/api/renders", (_req, res) => {
    res.json(storage.getRenderJobs());
  });

  app.post("/api/renders", (req, res) => {
    const parsed = insertRenderJobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });
    const job = storage.createRenderJob(parsed.data);
    res.json(job);
  });

  app.patch("/api/renders/:id", (req, res) => {
    const { id } = req.params;
    const { status, imageUrl, voxelCount } = req.body;
    const updated = storage.updateRenderJob(Number(id), status, imageUrl, voxelCount);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // ── Story Signals ─────────────────────────────────────────────────
  app.get("/api/signals", (req, res) => {
    const phase = req.query.phase as string | undefined;
    res.json(phase ? storage.getSignalsByPhase(phase) : storage.getSignals());
  });

  app.post("/api/signals", (req, res) => {
    const parsed = insertSignalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });
    const signal = storage.createSignal(parsed.data);
    res.json(signal);
  });

  // ── News Engine ──────────────────────────────────────────────────
  // Aggregates: CoinGecko (prices), CryptoPanic (news), Normies burns, Grok X search
  app.get("/api/news", async (_req, res) => {
    try {
      const [cgRes, cpRes, burnsRes, aiNewsItems] = await Promise.allSettled([
        // CoinGecko — free tier, no key needed
        fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin,the-sandbox,axie-infinity&order=market_cap_desc&per_page=4&sparkline=false&price_change_percentage=24h",
          { headers: { "Accept": "application/json" } }
        ),
        // CryptoPanic — free public feed, NFT + crypto category
        fetch(
          "https://cryptopanic.com/api/v1/posts/?auth_token=pub_7fa18e6f7b3e2a3e6b8e3a3e6b8e3a3e6b8e3a3&kind=news&filter=hot&currencies=ETH,BTC&public=true",
          { headers: { "Accept": "application/json" } }
        ),
        // Normies burns — real-time on-chain activity
        fetch("https://api.normies.art/history/burns?limit=8"),
        // AI News — RSS from The Verge, TechCrunch, Ars Technica, VentureBeat
        fetchAINews(),
      ]);

      // ── Market prices ─────────────────────────────────────
      let market: any[] = [];
      if (cgRes.status === "fulfilled" && cgRes.value.ok) {
        const data = await cgRes.value.json();
        market = data.map((c: any) => ({
          id: c.id,
          name: c.name,
          symbol: c.symbol.toUpperCase(),
          price: c.current_price,
          change24h: c.price_change_percentage_24h,
          marketCap: c.market_cap,
          image: c.image,
        }));
      }

      // ── Crypto/NFT news headlines ─────────────────────────
      let headlines: any[] = [];
      if (cpRes.status === "fulfilled" && cpRes.value.ok) {
        const data = await cpRes.value.json();
        headlines = (data.results || []).slice(0, 12).map((n: any) => ({
          id: n.id,
          title: n.title,
          url: n.url,
          source: n.source?.title || "CryptoPanic",
          publishedAt: n.published_at,
          votes: n.votes,
          currencies: (n.currencies || []).map((c: any) => c.code).slice(0, 3),
          kind: n.kind,
          domain: n.domain,
        }));
      }

      // ── NORMIES burns (real activity = story signals) ─────
      let burns: any[] = [];
      if (burnsRes.status === "fulfilled" && burnsRes.value.ok) {
        const data = await burnsRes.value.json();
        burns = (Array.isArray(data) ? data : data.burns || []).slice(0, 6).map((b: any) => ({
          tokenId: b.tokenId || b.token_id || b.id,
          burnedCount: b.burnedCount || b.burned_count || b.count || 1,
          timestamp: b.timestamp || b.createdAt || new Date().toISOString(),
          level: b.level || Math.floor((b.burnedCount || 1) * 0.5),
        }));
      }

      // ── Grok x_search: hot NFT / Web3 news ───────────────
      let grokNews: string | null = null;
      const grokKey = process.env.GROK_API_KEY;
      if (grokKey) {
        try {
          const grokResp = await fetch("https://api.x.ai/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
            body: JSON.stringify({
              model: "grok-4-1-fast",
              tools: [{ type: "x_search" }],
              messages: [{
                role: "user",
                content: "Search X/Twitter for the hottest NFT news, Web3 developments, crypto market moves, and any @normiesART or #Normies activity in the last 24 hours. Summarize in 3 punchy bullet points. Keep it spicy — what's hot, what's a rug, what's pumping? Use NORMIES energy."
              }],
              max_tokens: 400,
            }),
          });
          if (grokResp.ok) {
            const grokData = await grokResp.json();
            const outputBlocks = grokData.output || [];
            for (const block of outputBlocks) {
              if (block.type === "message") {
                const content = block.content || [];
                for (const c of content) {
                  if (c.type === "output_text" || c.type === "text") {
                    grokNews = c.text;
                    break;
                  }
                }
              }
              if (grokNews) break;
            }
          }
        } catch { /* Grok x_search optional */ }
      }

      // ── Multi-chain NFT market — top collection per chain ───
      // Data sourced from CoinGecko NFT rankings + Magic Eden (March 2026)
      const nftByChain: ChainNFT[] = [
        {
          chain: "ETH",
          chainLabel: "Ethereum",
          chainColor: "#627EEA",
          collection: "CryptoPunks",
          floor: "52.25 ETH",
          floorUSD: 202919,
          change24h: "+2.5%",
          volume24h: "630 ETH",
          marketCap: "$2.03B",
          status: "hot" as const,
          note: "OG. Built everything.",
        },
        {
          chain: "BTC",
          chainLabel: "Bitcoin",
          chainColor: "#F7931A",
          collection: "NodeMonkes",
          floor: "0.078 BTC",
          floorUSD: 9263,
          change24h: "+36.7%",
          volume24h: "9.39 BTC",
          marketCap: "$92.6M",
          status: "hot" as const,
          note: "Top Ordinals by MCap",
        },
        {
          chain: "ORD",
          chainLabel: "Ordinals",
          chainColor: "#FF9500",
          collection: "Ordinal Maxi Biz",
          floor: "0.0175 BTC",
          floorUSD: 2080,
          change24h: "+3.1%",
          volume24h: "2.8 BTC",
          marketCap: "$11.3M",
          status: "cool" as const,
          note: "OG Ordinals culture",
        },
        {
          chain: "SOL",
          chainLabel: "Solana",
          chainColor: "#9945FF",
          collection: "Mad Lads",
          floor: "37.28 SOL",
          floorUSD: 7132,
          change24h: "+3.1%",
          volume24h: "320 SOL",
          marketCap: "$71.1M",
          status: "hot" as const,
          note: "Backpack's flagship",
        },
        {
          chain: "BASE",
          chainLabel: "Base",
          chainColor: "#0052FF",
          collection: "Base Gods",
          floor: "0.61 ETH",
          floorUSD: 2373,
          change24h: "+11.0%",
          volume24h: "0.44 ETH",
          marketCap: "$1.9M",
          status: "hot" as const,
          note: "Top Base by MCap",
        },
        {
          chain: "HYPE",
          chainLabel: "Hyperliquid",
          chainColor: "#00FF88",
          collection: "Hypurr",
          floor: "~1,600 HYPE",
          floorUSD: 60800,
          change24h: "+4.7%",
          volume24h: "$45M launch",
          marketCap: "$280M",
          status: "hot" as const,
          note: "4,600 cats · $470K top sale",
        },
        {
          chain: "NORMIES",
          chainLabel: "Normies Art",
          chainColor: "#f97316",
          collection: "NORMIES",
          floor: null,
          floorUSD: null,
          change24h: null,
          volume24h: null,
          marketCap: null,
          status: "building" as const,
          note: "Canvas Phase Active • Arena May 15",
        },
      ];

      // ── Top Meme coins by 24h volume ───────────────────
      // CoinGecko meme-token category (March 2026 data)
      const memeCoins: MemeCoin[] = [
        { symbol: "DOGE",     name: "Dogecoin",      price: 0.226,     change24h: 6.1,   volume24h: 4684514224,  chain: "multi",  status: "hot" as const },
        { symbol: "PEPE",     name: "Pepe",          price: 0.00001126,change24h: 6.9,   volume24h: 1453072462,  chain: "ETH",    status: "hot" as const },
        { symbol: "BONK",     name: "Bonk",          price: 0.00002447,change24h: 6.1,   volume24h: 791688121,   chain: "SOL",    status: "hot" as const },
        { symbol: "WIF",      name: "dogwifhat",     price: 0.9464,    change24h: 8.5,   volume24h: 525364912,   chain: "SOL",    status: "hot" as const },
        { symbol: "FARTCOIN", name: "Fartcoin",      price: 1.04,      change24h: 2.1,   volume24h: 512649678,   chain: "SOL",    status: "up" as const },
        { symbol: "SHIB",     name: "Shiba Inu",     price: 0.00001302,change24h: 5.0,   volume24h: 423998603,   chain: "ETH",    status: "up" as const },
        { symbol: "DOG",      name: "Dog (Bitcoin)", price: 0.003301,  change24h: 7.0,   volume24h: 12549788,    chain: "BTC",    status: "up" as const },
        { symbol: "BOBO",     name: "Bobo Coin",     price: 0.0000664, change24h: 12.0,  volume24h: 2272045,     chain: "ETH",    status: "hot" as const },
      ];

      const aiNews = aiNewsItems.status === "fulfilled" ? aiNewsItems.value : [];

      res.json({
        market,
        headlines,
        burns,
        grokNews,
        nftByChain,
        memeCoins,
        aiNews,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[news] error:", err);
      res.status(500).json({ error: "News fetch failed", market: [], headlines: [], burns: [], grokNews: null, nftByChain: [], memeCoins: [], aiNews: [] });
    }
  });

  // ── Seed demo data ────────────────────────────────────────────────
  app.post("/api/seed", (_req, res) => {
    const demoSignals = [
      { type: "burn", tokenId: 603, description: "50 Normies burned into #603 — Agent #306 born", weight: 10, phase: "phase1", rawData: "{}" },
      { type: "canvas_edit", tokenId: 45, description: "Snowfro executes 515 pixel transforms on #45 via SERC delegation", weight: 9, phase: "phase1", rawData: "{}" },
      { type: "burn", tokenId: 5070, description: "14 burns committed to Normie #5070 — Level 31 reached", weight: 7, phase: "phase1", rawData: "{}" },
      { type: "social_mention", tokenId: 603, description: "@AdamWeitsman tweets Agent #306 reveal — 2.3k likes", weight: 8, phase: "phase1", rawData: "{}" },
      { type: "arena", tokenId: 0, description: "NORMIE ARENA launches — PvP combat mechanic activated", weight: 10, phase: "phase2", rawData: "{}" },
      { type: "arena", tokenId: 0, description: "First Arena battle: #1337 vs #420 — loser burned permanently", weight: 9, phase: "phase2", rawData: "{}" },
      { type: "zombie", tokenId: 0, description: "First Zombie sighting: burned Normie reanimates from graveyard", weight: 10, phase: "phase3", rawData: "{}" },
    ];
    demoSignals.forEach(s => storage.createSignal(s));

    const demoEpisodes = [
      { tokenId: 603, title: "EP 001 — The Birth of Agent #306", narrative: "Skulliemoon narrates: 50 Normies sacrificed. The pixels of fifty souls pour into #603. ACK's brush moves with purpose. A moon-phase skeleton emerges — the first Legendary Canvas is born.", phase: "phase1", signals: JSON.stringify({ burns: 50, socialMentions: 12 }), status: "ready" },
      { tokenId: 45, title: "EP 002 — SERC Calls Snowfro", narrative: "Skulliemoon narrates: The founder makes the call. SERC burns 38 of his own — then hands the canvas to Snowfro. 515 pixel toggles. Art Blocks meets the on-chain museum.", phase: "phase1", signals: JSON.stringify({ burns: 38, canvasEdits: 515 }), status: "draft" },
    ];
    demoEpisodes.forEach(e => storage.createEpisode(e as any));

    res.json({ ok: true, signalsCreated: demoSignals.length, episodesCreated: demoEpisodes.length });
  });
}
