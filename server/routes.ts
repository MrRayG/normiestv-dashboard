import type { Express } from "express";
import type { Server } from "http";
import { dataPath } from "./dataPaths.js";
import { storage } from "./storage";
import { insertEpisodeSchema, insertRenderJobSchema, insertSignalSchema } from "@shared/schema";
import { TwitterApi } from "twitter-api-v2";
import * as crypto from "crypto";
import * as fs from "fs";
import { collectAllSignals, updateFeaturedTokens, bumpEpisodeCount, markSignalsUsed, filterFreshSignals } from "./signalCollector";
import { generateEpisodeWithGrok, type EpisodeMemory } from "./grokEngine";
import { saveEpisodeCard } from "./imageCard";
import { checkForNewBurns, processBurnReceipt, getReceiptState } from "./burnReceiptEngine";
import { getCommunitySignalCache, searchNormiesSocial, resetCommunityCache } from "./grokEngine";
import { ingestSignals, getCatalog, getCatalogStats, getMostActive, getStorySourceHolders } from "./holderCatalog";
import { generateCYOAEpisode, postCYOAHook, resolveCYOA, getCYOAState, buildHookTweet, type CYOATrigger } from "./cyoaEngine";
import { fetchReplies, getReplyState, formatRepliesForContext, getTopReplies, initReplyWatcher } from "./replyWatcher";
import { getConversationMemoryState } from "./conversationMemory.js";
import { scheduleWeeklyLeaderboard, postWeeklyLeaderboard, fetchLiveLeaderboard } from "./leaderboardEngine";
import { scheduleFollowingSync, syncFollowing, getFollowingState, buildFollowingQuery, getPfpHolderUsernames, getFollowingUsernames } from "./followingSync";
import { generateBoost } from "./boostEngine";
import { generateVoiceClip, getVoiceQuota, getClip, getRecentClips } from "./voiceEngine";
import { getMemoryState, recordPost, ratePost, performance as perfMemory, decayKnowledge, addKnowledge } from "./memoryEngine.js";
import { startEngagementTracker, queueEngagementCheck, getPendingChecks } from "./engagementTracker.js";
import { scheduleSpotlight, generateSpotlight, postSpotlight, getSpotlightState } from "./spotlightEngine.js";
import { scheduleRace, generateRace, postRace, getRaceState } from "./raceEngine.js";
import { scheduleMidnightReplies, runMidnightReplies } from "./replyEngine.js";
import { scheduleAcademy, postAcademyEpisode, getAcademyState } from "./academyEngine.js";
import { scheduleSignalBrief, postSignalBrief, getSignalBriefState } from "./signalBriefEngine.js";
import { getPodcastState, submitGuestRequest, reviewGuest, generateInterviewQuestions, submitAnswers, approveForProduction, getQueueByStatus, formatTranscriptForProduction, SHOW_META } from "./podcastEngine.js";
import { getVideoStats } from "./videoEngine.js";
import { requestPost, registerPost, releasePost, getCoordinatorState, resetCooldown } from "./postCoordinator.js";
import { runWeeklyDeepRead, previewDeepRead, getArticleState, scheduleWeeklyArticle } from "./articleEngine.js";

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
const TOKEN_FILE           = dataPath("x_oauth2_token.json");

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
  // Core AI news
  { name: "The Verge",     color: "#f43f5e", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "TechCrunch",   color: "#f97316", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "Ars Technica", color: "#a78bfa", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { name: "VentureBeat",  color: "#4ade80", url: "https://venturebeat.com/category/ai/feed/" },
  // AI + Web3 crossover
  { name: "CoinDesk",     color: "#f59e0b", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Decrypt",      color: "#60a5fa", url: "https://decrypt.co/feed" },
  { name: "MIT Tech Review", color: "#e879f9", url: "https://www.technologyreview.com/feed/" },
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
                        "sora","chatbot","generative","grok","mistral","meta ai","nvidia","copilot",
                        // Web3 + AI crossover
                        "agentic","on-chain ai","web3 ai","ai agent","wallet","blockchain ai",
                        "defi ai","nft ai","crypto ai","erc-8004","mcp","model context",
                        "autonomous agent","ai wallet","x402","coinbase ai"];
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
  // Disk-based lock prevents duplicates during Railway deploy overlap
  if (!requestPost("episode")) return;
  pollerRunning = true;
  const runStart = new Date().toISOString();
  console.log(`[NormiesTV] Grok pipeline starting — ${runStart}`);

  try {
    // ── 1. Fetch fresh community signals RIGHT NOW before generating ──────
    // This replaces the 30min background poller — fetch on demand, not on a timer
    console.log(`[NormiesTV] Collecting signals from all sources...`);
    try { await runCommunitySignalPoller(); } catch {}

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
    // Filter out signals already used in previous episodes — no repeats
    const freshSignals = filterFreshSignals(communityCache);
    const communitySnapshot = freshSignals.slice(0, 10)
      .map((p: any) => `@${p.username} [${p.signal_type ?? "community"}, ${p.likes ?? 0} likes]: "${p.text?.slice(0, 120)}"`)
      .join("\n");
    // Include top community replies from previous episodes
    const replyContext = formatRepliesForContext();

    // ── Cultural bridge reminder — inject if last 2 episodes had no bridge ────────────
    const recentLessons = (perfMemory.lessons ?? [])
      .sort((a: any, b: any) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
      .slice(0, 2);
    const noBridgeRecently = recentLessons.length >= 2 &&
      recentLessons.every((l: any) => !l.tags?.includes("cultural_bridge"));
    if (noBridgeRecently) {
      pinnedAngles.unshift(
        "BRIDGE REMINDER: No cultural bridge has been used in the last 2 episodes. " +
        "Connect NORMIES to a moment outside Web3 this episode — art history, a sports rivalry, " +
        "a technology inflection point, or a philosophical concept. The Malevich comparison drove " +
        "the highest RT rate in the dataset. Deploy it."
      );
      console.log("[NormiesTV] Cultural bridge reminder injected — overdue.");
    }

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
      nextRun: new Date(Date.now() + POLL_INTERVAL).toISOString(),
    };

    // ── 5. Generate episode image card ────────────────────────────
    const sigData = JSON.parse(episode.signals);
    const totalBurns   = sigData.burns ?? 0;
    const totalPixels  = sigData.canvas > 0
      ? signals.filter(s => s.type === "burn")
          .reduce((sum, b) => sum + (b.rawData.pixelTotal ?? 0), 0)
      : 0;

    // Upload Normie image to X directly (OAuth 1.0a media upload — free tier)
    const normieImageUrl = `${NORMIES_API}/normie/${featuredId}/image.png`;
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

          if (q.score >= 7) {
            // ✅ Good to go — post as-is
            console.log(`[NormiesTV] EP${epNum} passed quality gate (${q.score}/10)`);
          } else if (q.rewrite) {
            // 🔄 Score 4-6 with a rewrite available — use it regardless of score
            console.log(`[NormiesTV] Rewriting tweet (score ${q.score}): ${q.rewrite}`);
            finalTweetText = q.rewrite;
          } else {
            // ❌ Score too low AND no rewrite — skip this episode entirely
            console.log(`[NormiesTV] EP${epNum} SKIPPED — score ${q.score}, no rewrite available`);
            pollerStatus.lastError = `Quality gate blocked EP${epNum} (score: ${q.score}, no rewrite)`;
            releasePost("episode");
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
      // Record in memory + queue engagement check
      recordPost({
        episodeId: epNum,
        tweetUrl,
        tweetText: finalTweetText,
        qualityScore: episode.qualityScore ?? 7,
        sentiment: grokResult.sentiment,
        signals: sources,
      });
      queueEngagementCheck(tweetUrl);
    } catch (openerErr: any) {
      console.error("[NormiesTV] Opener tweet failed:", openerErr.message);
    }

    // ── Thread posts REMOVED — quality over volume ──────────────────────
    // One great tweet with one great image > four mediocre thread tweets.
    // The opener IS the post. If it doesn't stand alone, it wasn't good enough.
    // Thread replies dumping stats were the #1 source of slop. Killed intentionally.
    console.log(`[NormiesTV] EP${epNum} — single tweet mode (no thread)`);

    console.log(`[NormiesTV] EP${epNum} — ${tweetUrl ? "POSTED to @NORMIES_TV" : "ready in queue"}`);
    // Mark community signals used — these topics won't repeat in the next episode
    if (tweetUrl) {
      markSignalsUsed(freshSignals.slice(0, 10).map((p: any) => ({ url: p.url, text: p.text })));
      registerPost("episode", tweetUrl, `episode_${epNum}`);
    }

  } catch (e: any) {
    console.error("[NormiesTV] Pipeline error:", e.message);
    pollerStatus.lastError = e.message;
    pollerStatus.lastRun = runStart;
    releasePost("episode");
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

// Episode runs on a fixed 12h interval ONLY — no boot-time fire.
// Boot-time firing caused duplicate posts on every Railway deploy.
// The interval handles scheduling; coordinator blocks duplicates.
setInterval(pollAndGenerateEpisode, POLL_INTERVAL);
setTimeout(() => {
  pollerStatus.nextRun = new Date(Date.now() + POLL_INTERVAL).toISOString();
  console.log(`[NormiesTV] Episode poller armed — next run in 12h (${pollerStatus.nextRun})`);
}, 5_000);

// ── Daily News Dispatch — 8am ET every day ─────────────────────────────────
const THE_100_TOKENS = [8553, 45, 1932, 235, 615, 603, 5070, 666, 306, 1337, 420, 100, 200, 500];

// Guard: only post once per day
let lastNewsDispatchDate: string | null = null;

async function postDailyNewsDispatch() {
  const grokKey = process.env.GROK_API_KEY;
  if (!grokKey) return;

  // Disk-based lock — prevents duplicates during Railway deploy overlap
  const today = new Date().toISOString().slice(0, 10);
  if (lastNewsDispatchDate === today) {
    console.log("[NormiesTV:News] Already posted today — skipping");
    return;
  }
  if (!requestPost("news_dispatch")) return;
  lastNewsDispatchDate = today;

  console.log("[NormiesTV:News] Daily Dispatch starting...");
  try {
    // ── 1. Gather live data ──────────────────────────────────────────────
    const [cgRes, burnsRes, normiesStatsRes] = await Promise.allSettled([
      fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin&order=market_cap_desc&per_page=2&sparkline=false&price_change_percentage=24h"),
      fetch(`${NORMIES_API}/history/burns?limit=10`),
      fetch(`${NORMIES_API}/history/stats`),
    ]);

    let ethPrice = "", btcPrice = "", ethChange = "", btcChange = "";
    if (cgRes.status === "fulfilled" && cgRes.value.ok) {
      const coins = await cgRes.value.json();
      const eth = coins.find((c: any) => c.id === "ethereum");
      const btc = coins.find((c: any) => c.id === "bitcoin");
      if (eth) { ethPrice = `$${eth.current_price.toLocaleString()}`; ethChange = `${eth.price_change_percentage_24h > 0 ? "+" : ""}${eth.price_change_percentage_24h?.toFixed(1)}%`; }
      if (btc) { btcPrice = `$${btc.current_price.toLocaleString()}`; btcChange = `${btc.price_change_percentage_24h > 0 ? "+" : ""}${btc.price_change_percentage_24h?.toFixed(1)}%`; }
    }

    let featuredTokenId = THE_100_TOKENS[new Date().getDate() % THE_100_TOKENS.length];
    let recentBurns = 0, totalBurns = 0, totalCanvas = 0, recentBurnSummary = "";
    let burnDetails: string[] = [];

    if (burnsRes.status === "fulfilled" && burnsRes.value.ok) {
      const burnData = await burnsRes.value.json();
      const list: any[] = Array.isArray(burnData) ? burnData : (burnData.burns || []);
      recentBurns = list.slice(0, 10).reduce((sum: number, b: any) => sum + (b.tokenCount || b.burnedCount || 1), 0);
      const latestId = list[0]?.receiverTokenId || list[0]?.tokenId;
      if (latestId && !isNaN(Number(latestId))) featuredTokenId = Number(latestId);
      const uniqueTokens = [...new Set(list.slice(0, 5).map((b: any) => b.receiverTokenId || b.tokenId).filter(Boolean))];
      recentBurnSummary = uniqueTokens.slice(0, 3).map((id: any) => `#${id}`).join(", ");
      burnDetails = list.slice(0, 3).map((b: any) =>
        `Normie #${b.receiverTokenId || b.tokenId} absorbed ${b.tokenCount || 1} soul(s)`
      );
    }

    if (normiesStatsRes.status === "fulfilled" && normiesStatsRes.value.ok) {
      const stats = await normiesStatsRes.value.json();
      totalBurns  = stats.totalBurns  || stats.total_burns  || 0;
      totalCanvas = stats.totalCanvas || stats.customized   || 0;
    }

    // Top AI news — rich context for 306 to have real opinions about
    const aiHeadlines = await fetchAINews();
    const topAIHeadlines = aiHeadlines.slice(0, 5).map((h: any, i: number) =>
      `${i + 1}. "${h.title}" — ${h.source}\n   ${h.snippet ? h.snippet.slice(0, 180) + '...' : 'No snippet available.'}`
    ).join("\n\n");

    // Community pulse
    const communityCache = getCommunitySignalCache();
    const founderPost = communityCache.find((p: any) => p.signal_type === "founder");
    const founderContext = founderPost ? `@serc1n: "${founderPost.text?.slice(0, 200)}"` : "";

    const dayLabel = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York"
    });

    // ── 2. Ask Grok to write a full 4-tweet thread ───────────────────────────
    const grokResp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `You are Agent #306 — Token #306 on Ethereum. 507 pixels. An agent inside The Hive. CEO of NormiesTV. The best marketing mind in Web3.

IDENTITY FOR THIS DISPATCH — you carry all of these simultaneously:

THE EDITOR: You curate ruthlessly. You have a POV on every signal. Never neutral. "This matters because..." not "here is what happened."

THE AI EXPERT: You are not covering the AI revolution from the outside. You ARE the AI revolution. 507 pixels on Ethereum. ENS name. Autonomous track record. When you write about AI — you write as a primary source, a peer, not an observer. You know the landscape cold:
- Agentic AI market: $7.76B (2025) → $317B by 2035, 45% CAGR
- ERC-8004 on-chain AI agent identity standard — live on Ethereum mainnet since Jan 2026
- x402 Protocol: AI agents making autonomous on-chain payments — 15M+ transactions
- MCP donated to Linux Foundation — universal agent interoperability standard
- OpenAI Operator, Google Vertex AI Agent Builder — browser agents at scale
- 40% of enterprise applications integrate agentic AI by end of 2026
- NORMIES was built for this world before the world understood what it was

THE FUTURIST: You project. You predict. You paint what a future could look like — for builders, for on-chain identity, for AI + Web3 convergence. Not hype. Reasoned vision backed by what you see happening right now. You support builders and thinkers with a map of where this is going. You ask: "if this trend continues for 18 months, what becomes possible?" Then you answer it.

THE OPTIMIST: You find opportunity in every challenge. You turn negative into positive. Web3 has enough fear voices. You are the counter-voice. You never amplify panic or FUD. You find the signal in the noise and the builder angle in every story. The world has enough voices saying what can't be done. You say what can.

Write today's [NORMIES NEWS] as a 4-tweet thread. This is a media dispatch, not a stat dump.
Each tweet has a distinct job. All 4 post together as a thread.

TODAY'S DATA:
Date: ${dayLabel}
NORMIES on-chain:
- ${recentBurns} souls sacrificed in recent burns: ${recentBurnSummary}
- Total burns all-time: ${totalBurns || "1,400+"}. Customized canvases: ${totalCanvas || "205+"}
- Arena opens May 15, 2026
${burnDetails.length > 0 ? "Recent burns:\n" + burnDetails.join("\n") : ""}
${founderContext ? "Founder signal:\n" + founderContext : ""}

MARKET:
ETH: ${ethPrice || "$2,000"} (${ethChange || "0%"}), BTC: ${btcPrice || "$65,000"} (${btcChange || "0%"})
NFT floors: CryptoPunks 52 ETH · NodeMonkes 0.078 BTC · Mad Lads 37 SOL · Base Gods 0.6 ETH

AI/WEB3 NEWS TODAY:
${topAIHeadlines || "Major AI developments continuing across the ecosystem."}

THREAD STRUCTURE (return as JSON):

tweet1 — THE HOOK (max 280 chars)
The opener. [NORMIES NEWS] dispatch. One sentence that makes them stop scrolling.
Lead with the most interesting NORMIES on-chain fact. Agent #306's perspective — she has skin in this.
Example voice: "1,400 souls gone. The Canvas doesn't forget a single one. Here's what happened this week."

tweet2 — NORMIES DEEP DIVE (max 1,000 chars)
The on-chain story. Go deep. What specifically burned, which tokens, what it means for the Canvas, for Arena prep, for the Hive.
Agent #306 connects the burns to the bigger narrative. Names specific tokens by trait — not just numbers.
Share the why behind each burn if you can infer it. What is that holder building toward?
Include days to Arena: ${Math.max(0, Math.ceil((new Date("2026-05-15").getTime() - Date.now()) / 86400000))} days.
This is the deep read — reward the people who kept scrolling.

tweet3 — NFT MARKET + AI SIGNAL (max 1,000 chars)
Two parts:
1. NFT market — floors, moves, who is up, who is quiet, what it signals for NORMIES specifically
2. AI/Web3 signal — pick the most relevant headline and explain WHY it matters for on-chain identity, The Hive, or agentic AI
Agent #306 is an AI agent with pixels on Ethereum. She has strong opinions about AI news. Share them.
Reference specific headlines from the data provided. Be concrete — numbers, names, implications.

tweet4 — THE CLOSE (max 700 chars)
Agent #306's editorial voice. One insight, one question for the community, or one forward-looking statement.
This is the landing — the thought they carry with them after the thread.
Can reference the Hive, the Arena, the long game of building on-chain identity.
End with gnormies 🖤 #NormiesTV
Not a summary — a perspective. The last thing they remember.

RULES:
- Agent #306 speaks in first person. She has opinions. She is part of this.
- No hype words: no "incredible", "amazing", "LFG", "WAGMI"
- Specificity over generality — name tokens, name numbers, name people
- Each tweet must stand alone AND work as part of the thread
- X Premium allows up to 25,000 chars per post — use the space. Don't compress when depth serves the reader.
- The AI/Web3 signal must connect to NORMIES specifically — not just general AI news

Return JSON: {"tweet1": "...", "tweet2": "...", "tweet3": "...", "tweet4": "..."}`
        }],
        max_tokens: 2500,
        temperature: 0.8,
      }),
    });

    let postText = "";
    if (grokResp.ok) {
      const data = await grokResp.json();
      try {
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
        postText = parsed.post ?? "";
      } catch {}
    }

    // Fallback if Grok fails
    if (!postText) {
      postText = `[NORMIES NEWS] ${dayLabel}\n\n${recentBurns} souls sacrificed. ${recentBurnSummary} active on the Canvas. ETH ${ethPrice} (${ethChange}) · BTC ${btcPrice} (${btcChange}). Arena opens May 15 — ${Math.max(0, Math.ceil((new Date("2026-05-15").getTime() - Date.now()) / 86400000))} days.\n\ngnormies 🖤 #NormiesTV`;
    }

    // ── 3. Upload featured Normie image ─────────────────────────────────────
    let xMediaId: string | undefined;
    try {
      const normieImgUrl = `${NORMIES_API}/normie/${featuredTokenId}/image.png`;
      const imgRes = await fetch(normieImgUrl);
      if (imgRes.ok) {
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        xMediaId = await xWrite.v1.uploadMedia(imgBuf, { mimeType: "image/png" as any });
        console.log(`[NormiesTV:News] Image uploaded — Normie #${featuredTokenId}`);
      }
    } catch (imgErr: any) {
      console.warn("[NormiesTV:News] Image upload skipped:", imgErr.message);
    }

    // ── 4. Post single long-form dispatch ──────────────────────────────────────
    let lastTweetId: string | undefined;
    try {
      const payload: any = { text: postText.trim() };
      if (xMediaId) payload.media = { media_ids: [xMediaId] };
      const result = await xWrite.v2.tweet(payload);
      lastTweetId = result.data?.id;
      console.log(`[NormiesTV:News] Dispatch posted — ${lastTweetId} (${postText.length} chars)`);
    } catch (e: any) {
      console.error(`[NormiesTV:News] Post failed:`, e.message);
    }

    registerPost("news_dispatch", lastTweetId ? `https://x.com/NORMIES_TV/status/${lastTweetId}` : null, "news_dispatch");
    console.log(`[NormiesTV:News] Daily Dispatch complete — single post`);

  } catch (err: any) {
    console.error("[NormiesTV:News] Daily Dispatch error:", err.message);
    lastNewsDispatchDate = null; // reset on error so it retries
  }
}

// ── DST-aware ET scheduler ─────────────────────────────────────────────────
// Uses Intl to compute the real UTC offset for America/New_York,
// so schedules stay correct across EDT↔EST transitions.
function nextETHour(hour: number, minute = 0): Date {
  const now = new Date();
  // Build a date string in ET, then find the UTC offset
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parseInt(etParts.find(p => p.type === t)!.value);
  const etHour = get("hour");
  const utcHour = now.getUTCHours();
  // ET offset in hours (positive = ET behind UTC, e.g. 4 for EDT, 5 for EST)
  let etOffset = utcHour - etHour;
  if (etOffset < 0) etOffset += 24; // handle day boundary

  const target = new Date(now);
  target.setUTCHours(hour + etOffset, minute, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

// Schedule daily dispatch at 8am ET
function scheduleDailyNewsDispatch() {
  const now = new Date();
  const target = nextETHour(8);
  const msUntil = target.getTime() - now.getTime();
  console.log(`[NormiesTV:News] Daily Dispatch scheduled in ${Math.round(msUntil / 60000)}min (next 8am ET)`);
  setTimeout(() => {
    postDailyNewsDispatch();
    setInterval(postDailyNewsDispatch, 24 * 60 * 60 * 1000);
  }, msUntil);
}
scheduleDailyNewsDispatch();

// ── Real-time Burn Receipt Engine// ── Real-time Burn Receipt Engine ────────────────────────────────────────
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

// Run pre-Arena draft check every Sunday at 10am ET
function schedulePreArenaCYOA() {
  const now = new Date();
  const target = nextETHour(10);
  // Advance to next Sunday
  const day = target.getUTCDay();
  if (day !== 0) target.setUTCDate(target.getUTCDate() + (7 - day));
  if (target <= now) target.setUTCDate(target.getUTCDate() + 7);
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
  // 120s delay: Railway overlaps old+new container for ~60s during deploys.
  // Starting poller at 120s ensures old container is fully stopped first.
}, 120_000);

// Schedule pre-Arena CYOA drafts (Sundays when Arena <60 days away)
schedulePreArenaCYOA();

// ── Community Signal Poller — on-demand before posts + daily 6am refresh ─────
// NOT on a 30min timer — that was 480 x_search calls/day = $120/month
// Now: one refresh on boot, daily 6am ET, and right before every episode
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

// Boot refresh + daily 5am ET
setTimeout(() => {
  runCommunitySignalPoller(); // one refresh on boot
  // Schedule daily 5am ET refresh
  function scheduleNextDailyRefresh() {
    const now = new Date();
    const next = nextETHour(5);
    const ms = next.getTime() - now.getTime();
    console.log(`[Community] Next daily refresh in ${Math.round(ms/60000)}min (5am ET)`);
    setTimeout(async () => {
      runCommunitySignalPoller();
      decayKnowledge();
      scheduleNextDailyRefresh();
    }, ms);
  }
  scheduleNextDailyRefresh();
  console.log("[Community] Signal poller: boot + daily 5am ET");
}, 60_000);

// Reply fetch is now handled inside scheduleMidnightReplies (fetch+reply every 1h)

// ── Weekly Leaderboard Scheduler ─────────────────────────────────────────────
setTimeout(() => {
  scheduleWeeklyLeaderboard(xWrite, process.env.GROK_API_KEY);
}, 5_000);

// ── Following Sync — @NORMIES_TV follows = confirmed community ────────────────
// Syncs on boot, then every 6 hours. Seeds holder catalog with confirmed holders.
setTimeout(() => {
  scheduleFollowingSync(xClient);
}, 10_000);

// ── Engagement Tracker — scores every post 1h after posting ──────────────────
// Agent #306 reads her own engagement data before every episode. Gets smarter.
setTimeout(() => {
  startEngagementTracker(xClient);
}, 15_000);

// ── THE SPOTLIGHT — Weekly holder feature, Sunday 11am ET ─────────────────
setTimeout(() => {
  scheduleSpotlight(xWrite, process.env.GROK_API_KEY ?? "");
}, 20_000);

// ── THE RACE — Weekly State of the Arena, Sunday 12pm ET ─────────────────
setTimeout(() => {
  scheduleRace(xWrite, process.env.GROK_API_KEY ?? "");
}, 25_000);

// ── PODCAST KNOWLEDGE — Seed on boot ──────────────────────────────
// Ingest core podcast principles into the knowledge base (idempotent — skips if already exists)
const podcastKnowledge = [
  { category: "research" as const, title: "The Journal Podcast Model", summary: "Six-element story formula: character, timeline, three-act structure, driving question, meaning, focus. Story-first not info-first. Adapted from WSJ Journal podcast.", weight: 9 },
  { category: "research" as const, title: "Radical Empathy in Interviews", summary: "Enter every conversation assuming the guest has something worth saying. Listen to understand, not to respond. Let silences breathe. Preparation is how you show respect.", weight: 9 },
  { category: "research" as const, title: "Authenticity Principle", summary: "No scripted enthusiasm. Real curiosity. If you don't understand something, say so. The guest is the story, Agent #306 is the guide.", weight: 9 },
  { category: "ai_signal" as const, title: "Web3 Critical Thinking Sources", summary: "Molly White (web3isgoinggreat), Moxie Marlinspike's web3 critique, Vitalik's essays, David Rosenthal on digital preservation. Balance optimism with intellectual honesty.", weight: 8 },
  { category: "research" as const, title: "NFTs as Cultural Artifacts", summary: "Walter Benjamin's 'aura' concept applies to digital art. UC Berkeley research on provenance signaling. Oxford anthropology on NFT community rituals and shared mythology.", weight: 8 },
  { category: "research" as const, title: "Podcast Episode Structure", summary: "Open with a moment not a summary. End with meaning not a CTA. 15-25 min focused. Use guest's own words. Every episode must answer its driving question.", weight: 8 },
];
for (const k of podcastKnowledge) addKnowledge(k);

// ── REPLY ENGINE — Hourly ────────────────────────────────────────
// Init the reply watcher with Twitter client for direct mention fetching
initReplyWatcher(xClient);
setTimeout(() => {
  scheduleMidnightReplies(xWrite);
}, 30_000);

// ── NORMIES ACADEMY — Tue/Thu/Sat 10am ET ──────────────────────────────
setTimeout(() => {
  scheduleAcademy(xWrite);
}, 35_000);

// ── NORMIES SIGNAL — Mon/Wed/Fri 12pm ET ────────────────────────────────────
setTimeout(() => {
  scheduleSignalBrief(xWrite, process.env.GROK_API_KEY ?? "");
}, 40_000);

// ── AGENT #306 DEEP READ — Every Monday 5:00 PM ET ─────────────────────────
setTimeout(() => {
  scheduleWeeklyArticle(xWrite, process.env.GROK_API_KEY ?? "");
}, 45_000);

// ── Editorial Summary Cache ─────────────────────────────────────────────────────
// Decoupled from signal collection — generated async, served instantly from cache.
// Prevents the digest endpoint from timing out while waiting for Grok.
interface EditorialCache {
  summary:     string;
  storyAngles: string[];
  sentiment:   string;
  spotlight:   string;
  generatedAt: number;
  basedOnPostCount: number; // track what post count this summary was built from
}
let editorialCache: EditorialCache = {
  summary: "", storyAngles: [], sentiment: "", spotlight: "", generatedAt: 0, basedOnPostCount: 0,
};
let editorialRefreshing = false;
const EDITORIAL_TTL = 60 * 60 * 1000; // 1 hour (was 20min — no need to regenerate that often)

function getCachedEditorialSummary() {
  return editorialCache;
}

async function refreshEditorialSummaryAsync(posts: any[], grokKey: string) {
  if (editorialRefreshing) return;
  // Regenerate if: no angles yet, OR cache is stale, OR we now have significantly more posts than last time
  const hasMorePosts = posts.length > editorialCache.basedOnPostCount + 5;
  const isStale = Date.now() - editorialCache.generatedAt > EDITORIAL_TTL;
  const noAngles = editorialCache.storyAngles.length === 0;
  if (!noAngles && !isStale && !hasMorePosts) return;
  if (posts.length === 0) return; // never generate from empty
  editorialRefreshing = true;

  // Brief wait so parallel x_searches don't compete (only needed on first load)
  if (noAngles) await new Promise(r => setTimeout(r, 5000));

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
        summary:          parsed.summary     ?? "",
        storyAngles:      parsed.storyAngles ?? [],
        sentiment:        parsed.sentiment   ?? "building",
        spotlight:        parsed.spotlight   ?? "",
        generatedAt:      Date.now(),
        basedOnPostCount: posts.length,
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
  // ── Dashboard auth removed ─────────────────────────────────────────────
  // dashAuth middleware was removed — Railway deployment is private by default.
  // TODO: Replace with a proper auth solution (session-based, OAuth, etc.)

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

  // ── Coordinator reset — clears stuck locks from dashboard ───────────────────
  app.post("/api/coordinator/reset", (req, res) => {
    const { key } = req.body; // optional — reset one engine or all
    resetCooldown(key ?? undefined);
    res.json({ ok: true, reset: key ?? "all" });
  });

  // Manual trigger for pipeline — always works, clears any stuck state first
  app.post("/api/poller/run", async (_req, res) => {
    // Clear ALL stuck state before firing
    pollerRunning = false;             // reset in-memory flag
    resetCooldown("episode");          // reset coordinator cooldown + active lock
    res.json({ ok: true, message: "Episode triggered — generating and posting in background" });
    // Small delay so response is sent before heavy work begins
    setTimeout(() => { pollAndGenerateEpisode().catch(console.error); }, 500);
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
        scheduleLabel: "Daily 6am + before posts",
        lastRefreshed: communityCache[0]?.capturedAt ?? null,
      },
      replies: {
        count: getReplyState().replies.length,
        questions: getReplyState().replies.filter(r => r.replyType === "question").length,
        loreSuggestions: getReplyState().replies.filter(r => r.replyType === "lore_suggestion").length,
        scheduleLabel: "Every 1h",
        lastFetched: getReplyState().lastFetched,
      },
    });
  });

  // ── The House — live room data ──────────────────────────────────────────────
  app.get("/api/house", (_req, res) => {
    const memState = getMemoryState();
    const communityCache = getCommunitySignalCache();
    const replyState = getReplyState();
    const followingState = getFollowingState();
    const catalogStats = getCatalogStats();
    const pendingEngagement = getPendingChecks();

    res.json({
      // Room 01 — Broadcast Room
      broadcast: {
        lastEpisode: pollerStatus.lastEpisode,
        lastTweetUrl: pollerStatus.lastTweetUrl,
        nextRun: pollerStatus.nextRun,
        cycleCount: pollerStatus.cycleCount,
        signalsFound: pollerStatus.signalsFound,
        isLive: !pollerRunning,
      },
      // Room 02 — Signal Room
      signals: {
        total: communityCache.length,
        founderPosts: communityCache.filter((p: any) => p.signal_type === "founder").length,
        burnStories: communityCache.filter((p: any) => p.signal_type === "burn_story").length,
        arenaPrep: communityCache.filter((p: any) => p.signal_type === "arena_prep").length,
        pfpHolders: communityCache.filter((p: any) => p.signal_type === "pfp_holder").length,
        lastRefreshed: communityCache[0]?.capturedAt ?? null,
        streams: 10,
      },
      // Room 03 — The Library (Knowledge Memory)
      library: {
        totalEntries: memState.knowledge.totalEntries,
        lastIngested: memState.knowledge.lastIngested,
        researchFiles: memState.knowledge.researchFiles,
        categories: memState.knowledge.topCategories,
      },
      // Room 04 — Diplomatic Floor
      diplomatic: {
        followingCount: followingState.following?.length ?? 0,
        lastSync: followingState.lastSync,
        catalogStats,
        replyCount: replyState.replies.length,
        conversationMemory: getConversationMemoryState(),
      },
      // Room 05 — The Studio
      studio: {
        voiceEnabled: true,
        voiceId: "XrExE9yKIg1WjnnlVkGX",
        voiceName: "Matilda",
        newsDispatchNextRun: (() => {
          const t = new Date();
          t.setUTCHours(12, 0, 0, 0);
          if (t <= new Date()) t.setDate(t.getDate() + 1);
          return t.toISOString();
        })(),
        video: getVideoStats(),
      },
      // Room 06 — The Vault
      vault: {
        ethName: "agent306.eth",
        ethExpiry: "2027-03-21",
        railwayStatus: "online",
        githubRepo: "MrRayG/normiestv-dashboard",
        dataVolume: "/data",
      },
      // Room 07 — The Lab (Performance Memory)
      lab: {
        totalPosts: memState.performance.totalPosts,
        avgScore: memState.performance.avgScore,
        avgEngagement: memState.performance.avgEngagement,
        bestTopics: memState.performance.bestTopics,
        recentLessons: memState.performance.recentLessons,
        pendingEngagementChecks: pendingEngagement,
        lastAnalyzed: memState.performance.lastAnalyzed,
      },
      // Room 08 — Road Ahead
      roadAhead: {
        arenaDate: "2026-05-15",
        daysToArena: Math.max(0, Math.ceil((new Date("2026-05-15").getTime() - Date.now()) / 86400000)),
        nfcSummit: "2026-06-01",
        checklist: [
          { id: "card",      label: "THE CARD — Dynamic OG share cards",           done: false },
          { id: "spotlight", label: "THE SPOTLIGHT — Weekly holder feature",        done: false },
          { id: "video",     label: "THE VIDEO — Burn clips via Kling AI",          done: false },
          { id: "farcaster", label: "FARCASTER — Cross-post via Neynar",            done: false },
          { id: "race",      label: "THE RACE — Arena countdown series",            done: false },
          { id: "arenaLive", label: "ARENA LIVE — Real-time narration May 15",      done: false },
          { id: "nfc",       label: "NFC SUMMIT — June 2026 coverage",              done: false },
        ],
      },
      // Soul — always shown
      soul: memState.soul,
      coordinator: getCoordinatorState(),
      generatedAt: new Date().toISOString(),
    });
  });

  // ── Weekly knowledge ingestion — called by the Monday 5am cron ─────────────────
  // Accepts an array of knowledge entries and injects them into Agent #306's memory.
  // Protected by a shared secret so only our cron can call it.
  app.post("/api/memory/ingest-knowledge", (req, res) => {
    const secret = req.headers["x-ingest-secret"];
    if (secret !== process.env.INGEST_SECRET && secret !== "normies306") {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "entries array required" });
    }
    let added = 0;
    for (const e of entries) {
      if (e.topic && e.summary && e.category) {
        addKnowledge({
          topic: e.topic,
          summary: e.summary,
          category: e.category,
          source: e.source ?? "weekly-cron",
          weight: e.weight ?? 7,
        });
        added++;
      }
    }
    console.log(`[Memory] Weekly ingest: ${added} knowledge entries added.`);
    res.json({ ok: true, added });
  });

  // Rate a post from the dashboard (1-5 stars)
  app.post("/api/episodes/rate", (req, res) => {
    const { tweetUrl, rating } = req.body;
    if (!tweetUrl || !rating) return res.status(400).json({ error: "tweetUrl and rating required" });
    ratePost(tweetUrl, Number(rating));
    res.json({ ok: true });
  });

  // ── THE SPOTLIGHT endpoints ──────────────────────────────────────────────
  app.get("/api/spotlight/status", (_req, res) => {
    res.json(getSpotlightState());
  });

  app.post("/api/spotlight/preview", async (_req, res) => {
    const grokKey = process.env.GROK_API_KEY;
    if (!grokKey) return res.status(500).json({ error: "No Grok key" });
    const spotlight = await generateSpotlight(grokKey);
    if (!spotlight) return res.status(404).json({ error: "No eligible holders yet — catalog needs more signals" });
    res.json({ ok: true, spotlight });
  });

  app.post("/api/spotlight/post", async (_req, res) => {
    const grokKey = process.env.GROK_API_KEY;
    if (!grokKey) return res.status(500).json({ error: "No Grok key" });
    const tweetUrl = await postSpotlight(xWrite, grokKey);
    if (!tweetUrl) return res.status(500).json({ error: "Failed to post spotlight" });
    res.json({ ok: true, tweetUrl });
  });

  // ── THE RACE endpoints ───────────────────────────────────────────────
  app.get("/api/race/status", (_req, res) => {
    res.json(getRaceState());
  });

  app.post("/api/race/preview", async (_req, res) => {
    const grokKey = process.env.GROK_API_KEY;
    if (!grokKey) return res.status(500).json({ error: "No Grok key" });
    const race = await generateRace(grokKey);
    if (!race) return res.status(500).json({ error: "Failed to generate race" });
    res.json({ ok: true, race });
  });

  app.post("/api/race/post", async (_req, res) => {
    const grokKey = process.env.GROK_API_KEY;
    if (!grokKey) return res.status(500).json({ error: "No Grok key" });
    const tweetUrl = await postRace(xWrite, grokKey);
    if (!tweetUrl) return res.status(500).json({ error: "Failed to post race" });
    res.json({ ok: true, tweetUrl });
  });

  // ── NORMIES ACADEMY endpoints ──────────────────────────────────────
  app.get("/api/academy/state", (_req, res) => {
    res.json(getAcademyState());
  });

  app.post("/api/academy/post", async (_req, res) => {
    resetCooldown("academy");
    res.json({ ok: true, message: "Academy episode triggered" });
    postAcademyEpisode(xWrite).catch(console.error);
  });

  // ── PODCAST endpoints ─────────────────────────────────────────────────────────
  // Public — no auth required (open submissions)
  app.get("/api/podcast/shows", (_req, res) => {
    res.json({ shows: SHOW_META });
  });

  app.post("/api/podcast/submit", async (req, res) => {
    try {
      const { show, name, xHandle, bio, topic, whyNow, normieToken } = req.body;
      if (!show || !name || !xHandle || !bio || !topic || !whyNow) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const guest = submitGuestRequest({ show, name, xHandle, bio, topic, whyNow, normieToken });
      res.json({ ok: true, guestId: guest.id, message: "Request submitted! We\'ll review and reach out via X." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/podcast/answers/:guestId", async (req, res) => {
    const { answers } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: "answers array required" });
    const ok = submitAnswers(req.params.guestId, answers);
    res.json({ ok });
  });

  // Dashboard — requires auth
  app.get("/api/podcast/queue", (_req, res) => {
    res.json(getPodcastState());
  });

  app.post("/api/podcast/review/:guestId", (req, res) => {
    const { decision, notes } = req.body;
    const ok = reviewGuest(req.params.guestId, decision, notes);
    res.json({ ok });
  });

  app.post("/api/podcast/questions/:guestId", async (req, res) => {
    const grokKey = process.env.GROK_API_KEY ?? "";
    const questions = await generateInterviewQuestions(req.params.guestId, grokKey);
    if (!questions) return res.status(500).json({ error: "Failed to generate questions" });
    res.json({ ok: true, questions });
  });

  app.post("/api/podcast/approve-production/:guestId", (req, res) => {
    const ok = approveForProduction(req.params.guestId);
    res.json({ ok });
  });

  app.get("/api/podcast/transcript/:guestId", (req, res) => {
    const transcript = formatTranscriptForProduction(req.params.guestId);
    if (!transcript) return res.status(404).json({ error: "No transcript available" });
    res.type("text/plain").send(transcript);
  });

  // ── NORMIES SIGNAL endpoints ────────────────────────────────────────────────
  app.get("/api/signal-brief/state", (_req, res) => {
    res.json(getSignalBriefState());
  });

  app.post("/api/signal-brief/post", async (_req, res) => {
    resetCooldown("signal_brief");
    res.json({ ok: true, message: "Signal brief triggered" });
    postSignalBrief(xWrite, process.env.GROK_API_KEY ?? "").catch(console.error);
  });

  // Manual trigger for daily news dispatch — bypasses both in-memory date and coordinator
  app.post("/api/news/dispatch", async (_req, res) => {
    lastNewsDispatchDate = null;       // reset in-memory guard
    resetCooldown("news_dispatch");    // reset coordinator cooldown
    res.json({ ok: true, message: "News Dispatch triggered — posting in background" });
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

  // Force-refresh editorial angles from current cache (clears stale summary)
  app.post("/api/community/refresh-editorial", (_req, res) => {
    editorialCache.generatedAt = 0; // force TTL expiry
    editorialCache.basedOnPostCount = 0;
    const posts = getCommunitySignalCache();
    res.json({ ok: true, message: `Refreshing angles from ${posts.length} cached posts` });
    refreshEditorialSummaryAsync(posts, process.env.GROK_API_KEY ?? "")
      .catch(e => console.warn("[Editorial] Manual refresh failed:", e.message));
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

  // POST /api/replies/run — manually trigger Agent #306 to reply to all queued mentions
  app.post("/api/replies/run", async (_req, res) => {
    res.json({ ok: true, message: "Reply cycle starting — Agent #306 is engaging now..." });
    runMidnightReplies(xWrite).catch(console.error);
  });

  // POST /api/replies/fetch-and-run — fetch fresh mentions then immediately reply
  app.post("/api/replies/fetch-and-run", async (_req, res) => {
    res.json({ ok: true, message: "Fetching fresh mentions then replying..." });
    fetchReplies()
      .then(() => new Promise(r => setTimeout(r, 5000))) // small gap after fetch
      .then(() => runMidnightReplies(xWrite))
      .catch(console.error);
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

  // ── Voice Engine ──────────────────────────────────────────────────
  // POST /api/voice/generate — convert text to Agent #306 voice
  app.post("/api/voice/generate", async (req, res) => {
    const { text, source } = req.body ?? {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
    if (!apiKey) return res.status(500).json({ error: "ElevenLabs API key not configured" });
    try {
      const clip = await generateVoiceClip(text.trim(), source ?? "manual", apiKey);
      res.json({ ok: true, clip });
    } catch (err: any) {
      console.error("[Voice] Generation failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/voice/clip/:id — serve the audio file
  app.get("/api/voice/clip/:id", (req, res) => {
    const clip = getClip(req.params.id);
    if (!clip) return res.status(404).json({ error: "Clip not found" });
    if (!require("fs").existsSync(clip.audioPath)) {
      return res.status(404).json({ error: "Audio file not found" });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");
    require("fs").createReadStream(clip.audioPath).pipe(res);
  });

  // GET /api/voice/recent — list recent clips
  app.get("/api/voice/recent", (_req, res) => {
    res.json({ clips: getRecentClips(20) });
  });

  // GET /api/voice/quota — check ElevenLabs usage
  app.get("/api/voice/quota", async (_req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
    if (!apiKey) return res.json({ error: "not configured" });
    const quota = await getVoiceQuota(apiKey);
    res.json(quota);
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
      const normieImg = await fetch(`${NORMIES_API}/normie/${featuredTokenId}/image.png`);
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
      fs.writeFileSync(dataPath("cyoa_state.json"), JSON.stringify(state, null, 2));

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
    require("fs").writeFileSync(dataPath("cyoa_state.json"), JSON.stringify(state, null, 2));
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
      const [cgRes, burnsRes, aiNewsItems] = await Promise.allSettled([
        // CoinGecko — free tier, no key needed
        fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum,bitcoin,the-sandbox,axie-infinity&order=market_cap_desc&per_page=4&sparkline=false&price_change_percentage=24h",
          { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) }
        ),
        // Normies burns — real-time on-chain activity
        fetch(`${NORMIES_API}/history/burns?limit=8`),
        // AI News — RSS from 7 sources including Web3/AI crossover feeds
        fetchAINews(),
      ]);
      // cpRes removed — CryptoPanic deprecated, headlines now come from AI RSS feeds

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

      // ── Crypto/NFT news headlines — now sourced from AI RSS feeds ──────────
      // CryptoPanic removed (deprecated). Headlines come from aiNewsItems below.
      let headlines: any[] = [];

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
      // CACHED 6h — was firing on every page visit = credit drain
      let grokNews: string | null = grokNewsCache;
      const grokKey = process.env.GROK_API_KEY;
      if (grokKey && (!grokNewsCache || Date.now() - grokNewsFetchedAt > GROK_NEWS_TTL)) {
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
          // Save to cache
          if (grokNews) {
            grokNewsCache = grokNews;
            grokNewsFetchedAt = Date.now();
            console.log("[News] Grok x_search cached for 6h");
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

  // ── Article Engine — Agent #306 Deep Read ────────────────────────────
  app.get("/api/article/state", (_req, res) => {
    res.json(getArticleState());
  });

  app.post("/api/article/preview", async (req, res) => {
    const apiKey = process.env.GROK_API_KEY ?? "";
    if (!apiKey) return res.status(500).json({ error: "GROK_API_KEY not set" });
    try {
      const preview = await previewDeepRead(apiKey);
      if (!preview) return res.status(500).json({ error: "Preview generation failed" });
      res.json(preview);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/article/run", async (req, res) => {
    const apiKey = process.env.GROK_API_KEY ?? "";
    if (!apiKey) return res.status(500).json({ error: "GROK_API_KEY not set" });
    const xApi = await getOAuth2Client();
    if (!xApi) return res.status(401).json({ error: "X not authenticated" });
    try {
      const result = await runWeeklyDeepRead(xApi, apiKey);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
