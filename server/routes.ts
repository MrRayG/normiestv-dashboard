import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEpisodeSchema, insertRenderJobSchema, insertSignalSchema } from "@shared/schema";
import { TwitterApi } from "twitter-api-v2";
import * as crypto from "crypto";
import * as fs from "fs";
import { collectAllSignals } from "./signalCollector";
import { generateEpisodeWithGrok, type EpisodeMemory } from "./grokEngine";

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
    const { signals, sources } = await collectAllSignals();

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
    console.log(`[NormiesTV] Calling Grok for EP${epNum} — ${signals.length} signals...`);

    const grokResult = await generateEpisodeWithGrok(signals, episodeMemory, epNum);
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
      lastTweetUrl: null,
      lastError: null,
      signalsFound: signals.length,
      sources,
      cycleCount: pollerStatus.cycleCount + 1,
      nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    };

    console.log(`[NormiesTV] EP${epNum} ready — awaiting manual post to @NORMIES_TV`);

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
