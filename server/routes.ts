import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertEpisodeSchema, insertRenderJobSchema, insertSignalSchema } from "@shared/schema";
import { TwitterApi } from "twitter-api-v2";

const NORMIES_API = "https://api.normies.art";

// ── X (Twitter) client ────────────────────────────────────────────
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

// ── Auto signal poller — runs every 6 hours ───────────────────────
let pollerRunning = false;

async function pollAndGenerateEpisode() {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    console.log("[NormiesTV] Polling Normies API for signals...");

    // Fetch latest burns
    const burns = await fetchNormiesAPI("/history/burns?limit=10").catch(() => []);
    const burnList = Array.isArray(burns) ? burns : [];

    // Create burn signals
    for (const burn of burnList.slice(0, 5)) {
      const tokenId = burn.tokenId ?? burn.token_id ?? burn.id ?? null;
      const desc = tokenId
        ? `Normie #${tokenId} burned — sacrifice recorded on-chain`
        : "Burn event recorded on-chain";
      storage.createSignal({
        type: "burn",
        tokenId: tokenId ? Number(tokenId) : null,
        description: desc,
        weight: 8,
        phase: "phase1",
        rawData: JSON.stringify(burn),
      });
    }

    // Fetch canvas info for top Normies
    const TOP_IDS = [603, 45, 5070, 9852, 7740, 666, 4354];
    const canvasResults = await Promise.allSettled(
      TOP_IDS.map(id => fetchNormiesAPI(`/normie/${id}/canvas/info`).then(c => ({ id, ...c })))
    );
    const canvasData = canvasResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map(r => r.value);

    // Find most active canvas this cycle
    const mostActive = canvasData.sort((a, b) =>
      (b.actionPoints ?? b.action_points ?? 0) - (a.actionPoints ?? a.action_points ?? 0)
    )[0];

    if (mostActive) {
      storage.createSignal({
        type: "canvas_edit",
        tokenId: mostActive.id,
        description: `Normie #${mostActive.id} leads canvas activity — Level ${mostActive.level ?? 1}, ${mostActive.actionPoints ?? 0} action points`,
        weight: 7,
        phase: "phase1",
        rawData: JSON.stringify(mostActive),
      });
    }

    // Generate narrative from current signals
    const signals = storage.getSignalsByPhase("phase1");
    const burnSignals = signals.filter(s => s.type === "burn");
    const canvasSignals = signals.filter(s => s.type === "canvas_edit");
    const epNum = storage.getEpisodes().length + 1;

    const featured = mostActive?.id ?? burnSignals[0]?.tokenId ?? 603;
    const narrative = `🌙 SKULLIEMOON SPEAKS: ${
      burnSignals.length > 0
        ? `${burnSignals.length} soul${burnSignals.length > 1 ? "s" : ""} sacrificed to the canvas this cycle. `
        : ""
    }${
      canvasSignals.length > 0
        ? `The canvas breathes — ${canvasSignals.length} transformation${canvasSignals.length > 1 ? "s" : ""} committed to the chain. `
        : ""
    }Normie #${featured} anchors this episode. The Temple records all. The canvas never forgets. #NormiesTV #Normies #Web3`;

    const episode = storage.createEpisode({
      tokenId: Number(featured),
      title: `EP ${String(epNum).padStart(3, "0")} — Auto-Generated · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      narrative,
      phase: "phase1",
      signals: JSON.stringify({ burnCount: burnSignals.length, canvasCount: canvasSignals.length }),
      status: "ready",
    });

    console.log(`[NormiesTV] Episode ${episode.id} auto-generated — ready to post`);
  } catch (e: any) {
    console.error("[NormiesTV] Poller error:", e.message);
  } finally {
    pollerRunning = false;
  }
}

// Start 6-hour poller
setInterval(pollAndGenerateEpisode, 6 * 60 * 60 * 1000);
// Also run once on startup after 10s delay
setTimeout(pollAndGenerateEpisode, 10_000);

export function registerRoutes(httpServer: Server, app: Express) {

  // ── X (Twitter) posting ───────────────────────────────────────────
  app.post("/api/x/post", async (req, res) => {
    const { episodeId, text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    try {
      const tweet = await xWrite.v2.tweet(text);
      const tweetId = tweet.data?.id;
      const tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : undefined;

      // Mark episode as posted if episodeId provided
      if (episodeId) {
        storage.updateEpisodeStatus(Number(episodeId), "posted", tweetUrl);
      }

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
      res.json({ ok: true, username: me.data?.username, name: me.data?.name });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger for signal poll
  app.post("/api/poller/run", async (_req, res) => {
    pollAndGenerateEpisode();
    res.json({ ok: true, message: "Poller triggered — episode will generate in background" });
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
