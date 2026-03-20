import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEpisodeSchema, insertRenderJobSchema, insertSignalSchema } from "@shared/schema";
import { TwitterApi } from "twitter-api-v2";
import * as crypto from "crypto";
import * as fs from "fs";

const NORMIES_API = "https://api.normies.art";

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
  accessToken:       "2035048299808661507-bsS8pLBYKEzaX9OOqsgxRDkAYiQrrp",
  accessSecret:      "EZHfeel6sh9UDgtMloJrEBJMdt35e46rQ0p5KQjNoRCeX",
});
const xWrite = xClient.readWrite;

async function fetchNormiesAPI(path: string) {
  const res = await fetch(`${NORMIES_API}${path}`);
  if (!res.ok) throw new Error(`Normies API error: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — AUTONOMOUS STORY ENGINE
// Polls on-chain data every 6 hours, builds a narrative from real activity,
// generates an episode, and auto-posts to @NORMIES_TV on X.
// Sources: Normies API burns + canvas leaderboard
// ─────────────────────────────────────────────────────────────────────────────

// Poller state
let pollerRunning = false;
let pollerStatus: {
  lastRun: string | null;
  lastEpisode: number | null;
  lastTweetUrl: string | null;
  lastError: string | null;
  signalsFound: number;
  cycleCount: number;
  nextRun: string | null;
} = {
  lastRun: null,
  lastEpisode: null,
  lastTweetUrl: null,
  lastError: null,
  signalsFound: 0,
  cycleCount: 0,
  nextRun: null,
};

// Track last seen burn commitId to avoid re-processing
let lastSeenBurnId: string | null = null;

// ── THE 100: expanded canvas leader IDs (top AP holders) ──────────
const THE100_IDS = [
  8553, 45, 1932, 235, 615, 603, 5665, 7834, 8043, 7783,
  9999, 8831, 5070, 4354, 7887, 3284, 666, 1337, 420, 100,
  200, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 9852,
];

// ── Story narrative generator — driven by real on-chain signals ───
interface BurnEvent {
  commitId: string;
  receiverTokenId: string;
  tokenCount: number;
  pixelCounts: string; // JSON array string
  totalActions: string;
  timestamp: string;
  txHash: string;
  owner: string;
}

interface CanvasLeader {
  id: number;
  actionPoints: number;
  level: number;
  customized: boolean;
}

function buildNarrative(burns: BurnEvent[], leaders: CanvasLeader[], epNum: number): {
  tweetText: string;
  narrative: string;
  featured: number;
  phase: string;
} {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const top = leaders[0];
  const featured = top?.id ?? (burns[0] ? Number(burns[0].receiverTokenId) : 603);

  // Parse total pixels burned this cycle
  let totalPixelsBurned = 0;
  let totalNormiesBurned = 0;
  const recentBurns = burns.slice(0, 5);
  for (const b of recentBurns) {
    totalNormiesBurned += b.tokenCount ?? 0;
    try {
      const counts = JSON.parse(b.pixelCounts ?? "[]");
      totalPixelsBurned += counts.reduce((s: number, n: number) => s + n, 0);
    } catch {}
  }

  // AP milestones
  const milestone = top?.actionPoints
    ? top.actionPoints >= 600 ? "Legendary"
    : top.actionPoints >= 400 ? "Master"
    : top.actionPoints >= 200 ? "Ascendant"
    : "Rising"
    : "Rising";

  // Pick narrative template based on what signals are strongest
  const hasBurns = recentBurns.length > 0;
  const hasCanvas = leaders.length > 0;
  const topTx = recentBurns[0]?.txHash?.slice(0, 10);

  let narrative: string;
  let tweetText: string;

  if (hasBurns && hasCanvas) {
    // Full signal: burns + canvas activity
    narrative =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")} · ${dateStr}\n\n` +
      `The Temple is active. ${totalNormiesBurned} Normie${totalNormiesBurned !== 1 ? "s" : ""} sacrificed ` +
      `this cycle — ${totalPixelsBurned.toLocaleString()} pixels offered to the chain.\n\n` +
      `Normie #${featured} rises above the rest. Level ${top?.level ?? "?"} · ` +
      `${top?.actionPoints ?? "?"} Action Points — status: ${milestone}.\n\n` +
      (recentBurns.length > 1
        ? `${recentBurns.length} burn events recorded. ` +
          `Latest: Normie #${recentBurns[0].receiverTokenId} absorbed ${recentBurns[0].tokenCount} soul${recentBurns[0].tokenCount > 1 ? "s" : ""}.\n\n`
        : "") +
      `The canvas never forgets. Every pixel is permanent. The story writes itself on-chain.\n\n` +
      `#NormiesTV #Normies #NFT #Web3 #PixelArt`;

    tweetText =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")}\n\n` +
      `${totalNormiesBurned} sacrificed · ${totalPixelsBurned.toLocaleString()} pixels burned\n` +
      `Normie #${featured} leads: LVL${top?.level ?? "?"} · ${top?.actionPoints ?? "?"}AP · ${milestone}\n\n` +
      (topTx ? `TX: ${topTx}...\n\n` : "") +
      `The Temple records all.\n` +
      `#NormiesTV #Normies #NFT #Web3`;
  } else if (hasBurns) {
    // Burns only
    narrative =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")} · ${dateStr}\n\n` +
      `${totalNormiesBurned} soul${totalNormiesBurned !== 1 ? "s" : ""} offered to the canvas. ` +
      `${totalPixelsBurned.toLocaleString()} pixels consumed by the chain.\n\n` +
      `Sacrifice is the language of the Temple. Each burn is permanent. Each pixel is memory.\n\n` +
      `Normie #${featured} anchors this episode. The story burns forward.\n\n` +
      `#NormiesTV #Normies #NFT #Web3 #PixelArt`;

    tweetText =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")}\n\n` +
      `${totalNormiesBurned} Normies burned · ${totalPixelsBurned.toLocaleString()} pixels to the chain\n` +
      `Normie #${featured} stands at the center\n\n` +
      `The Temple records all.\n` +
      `#NormiesTV #Normies #NFT #Web3`;
  } else if (hasCanvas) {
    // Canvas activity only — quiet burn cycle
    narrative =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")} · ${dateStr}\n\n` +
      `The fire is quiet but the canvas moves. No burns this cycle — ` +
      `but Normie #${featured} continues to evolve.\n\n` +
      `Level ${top?.level ?? "?"} · ${top?.actionPoints ?? "?"} Action Points. ` +
      `The ${milestone} tier holds its ground.\n\n` +
      `Art doesn't wait for sacrifice. The chain is always watching.\n\n` +
      `#NormiesTV #Normies #NFT #Web3 #PixelArt`;

    tweetText =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")}\n\n` +
      `Quiet cycle — canvas evolves without fire\n` +
      `Normie #${featured}: LVL${top?.level ?? "?"} · ${top?.actionPoints ?? "?"}AP\n\n` +
      `The Temple watches.\n` +
      `#NormiesTV #Normies #Web3`;
  } else {
    // Fallback — no live data
    narrative =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")} · ${dateStr}\n\n` +
      `The Temple breathes. Activity stirs beneath the surface.\n\n` +
      `The NORMIES story is always moving — on-chain, on the timeline, in the community.\n\n` +
      `Normie #306 guards the entrance. The canvas awaits its next chapter.\n\n` +
      `#NormiesTV #Normies #NFT #Web3`;

    tweetText =
      `🌙 SKULLIEMOON SPEAKS — EP${String(epNum).padStart(3,"0")}\n\n` +
      `The Temple breathes. The story moves on-chain.\n\n` +
      `#NormiesTV #Normies #Web3`;
  }

  return { tweetText, narrative, featured, phase: "phase1" };
}

// ── Main autonomous pipeline ───────────────────────────────────────
async function pollAndGenerateEpisode() {
  if (pollerRunning) return;
  pollerRunning = true;
  const runStart = new Date().toISOString();
  console.log(`[NormiesTV] Autonomous pipeline starting — ${runStart}`);

  try {
    // ── 1. Fetch on-chain burn events ─────────────────────────────
    const rawBurns = await fetchNormiesAPI("/history/burns?limit=20").catch(() => []);
    const burnList: BurnEvent[] = Array.isArray(rawBurns) ? rawBurns : [];

    // Only process burns newer than last seen
    const newBurns = lastSeenBurnId
      ? burnList.filter(b => b.commitId > lastSeenBurnId!)
      : burnList.slice(0, 10);
    if (burnList.length > 0) lastSeenBurnId = burnList[0].commitId;

    // Store burn signals
    let signalCount = 0;
    for (const burn of newBurns.slice(0, 5)) {
      const receiverId = Number(burn.receiverTokenId);
      let pixelTotal = 0;
      try { pixelTotal = JSON.parse(burn.pixelCounts ?? "[]").reduce((s: number, n: number) => s + n, 0); } catch {}
      storage.createSignal({
        type: "burn",
        tokenId: receiverId || null,
        description: `Normie #${burn.receiverTokenId} absorbed ${burn.tokenCount} soul${burn.tokenCount > 1 ? "s" : ""} — ${pixelTotal.toLocaleString()} pixels · TX ${burn.txHash?.slice(0,10)}...`,
        weight: 8 + Math.min(burn.tokenCount, 5),
        phase: "phase1",
        rawData: JSON.stringify(burn),
      });
      signalCount++;
    }

    // ── 2. Fetch canvas leaderboard ───────────────────────────────
    const canvasResults = await Promise.allSettled(
      THE100_IDS.map(id =>
        fetchNormiesAPI(`/normie/${id}/canvas/info`)
          .then(c => ({
            id,
            actionPoints: c.actionPoints ?? c.action_points ?? 0,
            level: c.level ?? 1,
            customized: c.customized ?? false,
          }))
          .catch(() => null)
      )
    );
    const leaders: CanvasLeader[] = canvasResults
      .filter((r): r is PromiseFulfilledResult<CanvasLeader | null> => r.status === "fulfilled")
      .map(r => r.value)
      .filter((v): v is CanvasLeader => v !== null && v.actionPoints > 0)
      .sort((a, b) => b.actionPoints - a.actionPoints)
      .slice(0, 10);

    // Store top canvas signals
    for (const leader of leaders.slice(0, 3)) {
      storage.createSignal({
        type: "canvas_edit",
        tokenId: leader.id,
        description: `Normie #${leader.id} — Level ${leader.level} · ${leader.actionPoints} AP · ${leader.customized ? "Canvas active" : "Uncustomized"}`,
        weight: 5 + Math.floor(leader.actionPoints / 100),
        phase: "phase1",
        rawData: JSON.stringify(leader),
      });
      signalCount++;
    }

    // ── 3. Build narrative ────────────────────────────────────────
    const epNum = storage.getEpisodes().length + 1;
    const { tweetText, narrative, featured, phase } = buildNarrative(newBurns, leaders, epNum);

    const episode = storage.createEpisode({
      tokenId: Number(featured),
      title: `EP ${String(epNum).padStart(3, "0")} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      narrative,
      phase,
      signals: JSON.stringify({
        burnCount: newBurns.length,
        totalPixelsBurned: newBurns.reduce((s, b) => {
          try { return s + JSON.parse(b.pixelCounts ?? "[]").reduce((a: number, n: number) => a + n, 0); } catch { return s; }
        }, 0),
        topLeader: leaders[0] ? { id: leaders[0].id, ap: leaders[0].actionPoints, level: leaders[0].level } : null,
        lastBurnTx: burnList[0]?.txHash ?? null,
      }),
      status: "ready",
    });

    console.log(`[NormiesTV] Episode ${episode.id} generated — posting to @NORMIES_TV`);

    // ── 4. Auto-post to @NORMIES_TV ────────────────────────────────
    let tweetId: string | undefined;
    let tweetUrl: string | undefined;
    try {
      // Try OAuth 2.0 first, fall back to OAuth 1.0a
      const oauth2Client = await getOAuth2Client();
      if (oauth2Client) {
        const tweet = await oauth2Client.v2.tweet(tweetText);
        tweetId = tweet.data?.id;
      } else {
        const tweet = await xWrite.v2.tweet(tweetText);
        tweetId = tweet.data?.id;
      }
      tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : undefined;
      if (tweetUrl) storage.updateEpisodeStatus(episode.id, "posted", tweetUrl);
      console.log(`[NormiesTV] Posted: ${tweetUrl}`);
    } catch (postErr: any) {
      console.error(`[NormiesTV] Auto-post failed: ${postErr.message}`);
      // Keep episode as "ready" — can be manually posted from dashboard
    }

    // ── 5. Update poller status ───────────────────────────────────
    pollerStatus = {
      lastRun: runStart,
      lastEpisode: episode.id,
      lastTweetUrl: tweetUrl ?? null,
      lastError: null,
      signalsFound: signalCount,
      cycleCount: pollerStatus.cycleCount + 1,
      nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    };

  } catch (e: any) {
    console.error("[NormiesTV] Pipeline error:", e.message);
    pollerStatus.lastError = e.message;
    pollerStatus.lastRun = runStart;
  } finally {
    pollerRunning = false;
  }
}

// Start 6-hour autonomous cycle
const POLL_INTERVAL = 6 * 60 * 60 * 1000;
setInterval(pollAndGenerateEpisode, POLL_INTERVAL);
// First run 15s after server start
setTimeout(() => {
  pollerStatus.nextRun = new Date(Date.now() + POLL_INTERVAL).toISOString();
  pollAndGenerateEpisode();
}, 15_000);

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

  // Manual trigger for pipeline
  app.post("/api/poller/run", async (_req, res) => {
    if (pollerRunning) return res.json({ ok: false, message: "Pipeline already running" });
    pollAndGenerateEpisode();
    res.json({ ok: true, message: "Pipeline triggered — episode will generate and post in background" });
  });

  // Poller status
  app.get("/api/poller/status", (_req, res) => {
    res.json({
      running: pollerRunning,
      ...pollerStatus,
      intervalHours: 6,
    });
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

  // ── Seed demo data ────────────────────────────────────────────────
  app.post("/api/seed", (_req, res) => {
    const demoSignals = [
      { type: "burn", tokenId: 603, description: "50 Normies burned into #603 — Skelemoon born", weight: 10, phase: "phase1", rawData: "{}" },
      { type: "canvas_edit", tokenId: 45, description: "Snowfro executes 515 pixel transforms on #45 via SERC delegation", weight: 9, phase: "phase1", rawData: "{}" },
      { type: "burn", tokenId: 5070, description: "14 burns committed to Normie #5070 — Level 31 reached", weight: 7, phase: "phase1", rawData: "{}" },
      { type: "social_mention", tokenId: 603, description: "@AdamWeitsman tweets Skelemoon reveal — 2.3k likes", weight: 8, phase: "phase1", rawData: "{}" },
      { type: "arena", tokenId: 0, description: "NORMIE ARENA launches — PvP combat mechanic activated", weight: 10, phase: "phase2", rawData: "{}" },
      { type: "arena", tokenId: 0, description: "First Arena battle: #1337 vs #420 — loser burned permanently", weight: 9, phase: "phase2", rawData: "{}" },
      { type: "zombie", tokenId: 0, description: "First Zombie sighting: burned Normie reanimates from graveyard", weight: 10, phase: "phase3", rawData: "{}" },
    ];
    demoSignals.forEach(s => storage.createSignal(s));

    const demoEpisodes = [
      { tokenId: 603, title: "EP 001 — The Birth of Skelemoon", narrative: "Skulliemoon narrates: 50 Normies sacrificed. The pixels of fifty souls pour into #603. ACK's brush moves with purpose. A moon-phase skeleton emerges — the first Legendary Canvas is born.", phase: "phase1", signals: JSON.stringify({ burns: 50, socialMentions: 12 }), status: "ready" },
      { tokenId: 45, title: "EP 002 — SERC Calls Snowfro", narrative: "Skulliemoon narrates: The founder makes the call. SERC burns 38 of his own — then hands the canvas to Snowfro. 515 pixel toggles. Art Blocks meets the on-chain museum.", phase: "phase1", signals: JSON.stringify({ burns: 38, canvasEdits: 515 }), status: "draft" },
    ];
    demoEpisodes.forEach(e => storage.createEpisode(e as any));

    res.json({ ok: true, signalsCreated: demoSignals.length, episodesCreated: demoEpisodes.length });
  });
}
