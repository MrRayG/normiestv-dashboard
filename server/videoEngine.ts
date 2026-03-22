/**
 * ─────────────────────────────────────────────────────────────
 *  NORMIESTV — xAI VIDEO ENGINE
 *
 *  Animates Normie pixel art using grok-imagine-video.
 *  $0.0639/video. Used selectively — burns ≥2 souls, weekly
 *  Race and Spotlight posts.
 *
 *  Strategy: build it, measure engagement lift vs static image,
 *  scale up or back based on data.
 * ─────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import https from "https";
import { dataPath } from "./dataPaths.js";

const XAI_API_KEY = process.env.GROK_API_KEY ?? "";
const VIDEO_API   = "https://api.x.ai/v1/videos/generations";
const POLL_URL    = "https://api.x.ai/v1/videos";

// Track video generation stats
const STATS_FILE = dataPath("video_stats.json");

interface VideoStats {
  totalGenerated: number;
  totalCost: number;        // estimated at $0.0639/video
  burnVideos: number;
  raceVideos: number;
  spotlightVideos: number;
  lastGenerated: string | null;
  engagementComparison: {
    withVideo: number[];    // likes on posts with video
    withoutVideo: number[]; // likes on posts without video
  };
}

function loadStats(): VideoStats {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch {}
  return {
    totalGenerated: 0, totalCost: 0,
    burnVideos: 0, raceVideos: 0, spotlightVideos: 0,
    lastGenerated: null,
    engagementComparison: { withVideo: [], withoutVideo: [] },
  };
}

function saveStats(s: VideoStats) {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2)); } catch {}
}

let stats = loadStats();

// ── Build a cinematic prompt for a Normie ────────────────────────────────────
function buildBurnPrompt(opts: {
  tokenId: number;
  tokenCount: number;
  level: number;
  ap: number;
  scale: "small" | "significant" | "major" | "legendary";
}): string {
  const { tokenId, tokenCount, level, ap, scale } = opts;

  const prompts = {
    small: `Pixel art figure, monochrome black and white, on a dark background. 
Subtle orange glow pulses around the edges. The figure slowly brightens, 
gaining definition. A single spark drifts upward. Cinematic, minimal, respectful.
9:16 vertical format. No text. No UI.`,

    significant: `Pixel art figure in black and white pixels, dark background with orange ambient light.
The figure absorbs glowing energy — small orange particles stream inward from the edges.
The canvas reshapes slightly. New pixels solidify. A moment of transformation.
Slow, deliberate motion. Cinematic. 9:16 vertical.`,

    major: `Pixel art figure absorbing multiple streams of orange light particles from all directions.
Black and white pixels, dark field. The figure grows slightly larger, more defined.
Orange glow intensifies then settles. Power contained. Arena-ready.
Dramatic but controlled. 9:16 vertical. No text.`,

    legendary: `Epic pixel art transformation. Black and white figure on black background.
Massive orange energy surge — particles, light beams, pixel fragments all converging.
The figure at the center holds perfectly still as chaos swirls around it.
Then stillness. More defined. More powerful. The canvas has changed forever.
Cinematic quality. 9:16 vertical. No text or UI elements.`,
  };

  return prompts[scale];
}

// ── Generate a video from a Normie image ─────────────────────────────────────
export async function generateBurnVideo(opts: {
  tokenId: number;
  tokenCount: number;
  level: number;
  ap: number;
}): Promise<string | null> {
  const { tokenId, tokenCount, level, ap } = opts;

  const scale = tokenCount >= 50 ? "legendary"
              : tokenCount >= 10 ? "major"
              : tokenCount >= 3  ? "significant"
              : "small";

  const prompt = buildBurnPrompt({ tokenId, tokenCount, level, ap, scale });
  const imageUrl = `https://api.normies.art/normie/${tokenId}/image.png`;

  console.log(`[Video] Generating ${scale} burn video for #${tokenId} (${tokenCount} souls)...`);

  try {
    // Step 1: Start generation (image-to-video)
    const startResp = await fetch(VIDEO_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt,
        image_url: imageUrl,  // animate from the actual Normie image
        duration: 8,
        aspect_ratio: "9:16", // vertical — best for X/Twitter
        resolution: "720p",
      }),
    });

    if (!startResp.ok) {
      const err = await startResp.text();
      console.error(`[Video] Start failed: ${startResp.status} ${err.slice(0, 200)}`);
      return null;
    }

    const { request_id } = await startResp.json() as { request_id: string };
    console.log(`[Video] Generation started — request_id: ${request_id}`);

    // Step 2: Poll until done (up to 5 minutes)
    const maxAttempts = 60; // 60 × 5s = 5 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const pollResp = await fetch(`${POLL_URL}/${request_id}`, {
        headers: { "Authorization": `Bearer ${XAI_API_KEY}` },
      });

      if (!pollResp.ok) continue;

      const data = await pollResp.json() as {
        status: "pending" | "done" | "expired" | "failed";
        video?: { url: string; duration: number };
      };

      if (data.status === "done" && data.video?.url) {
        console.log(`[Video] Done — ${data.video.url}`);

        // Update stats
        stats.totalGenerated++;
        stats.totalCost += 0.0639;
        stats.burnVideos++;
        stats.lastGenerated = new Date().toISOString();
        saveStats(stats);

        // Download video to /tmp for X upload
        const videoPath = `/tmp/normiestv_burn_${tokenId}_${Date.now()}.mp4`;
        await downloadFile(data.video.url, videoPath);
        return videoPath;

      } else if (data.status === "expired" || data.status === "failed") {
        console.error(`[Video] Generation ${data.status} for #${tokenId}`);
        return null;
      }
      // Still pending — keep polling
    }

    console.error(`[Video] Timed out waiting for #${tokenId}`);
    return null;

  } catch (e: any) {
    console.error(`[Video] Error: ${e.message}`);
    return null;
  }
}

// ── Download a video file to local path ──────────────────────────────────────
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : require("http");
    protocol.get(url, (res: any) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (e: Error) => {
      fs.unlink(dest, () => {});
      reject(e);
    });
  });
}

// ── Record engagement for a post (called by engagement tracker) ──────────────
export function recordVideoEngagement(likes: number, hadVideo: boolean) {
  if (hadVideo) {
    stats.engagementComparison.withVideo.push(likes);
  } else {
    stats.engagementComparison.withoutVideo.push(likes);
  }
  // Keep last 20 of each
  if (stats.engagementComparison.withVideo.length > 20)
    stats.engagementComparison.withVideo.shift();
  if (stats.engagementComparison.withoutVideo.length > 20)
    stats.engagementComparison.withoutVideo.shift();
  saveStats(stats);
}

// ── Get video stats for the dashboard ────────────────────────────────────────
export function getVideoStats() {
  const wv = stats.engagementComparison.withVideo;
  const wov = stats.engagementComparison.withoutVideo;
  const avgWith = wv.length > 0
    ? Math.round(wv.reduce((a, b) => a + b, 0) / wv.length)
    : null;
  const avgWithout = wov.length > 0
    ? Math.round(wov.reduce((a, b) => a + b, 0) / wov.length)
    : null;

  const lift = (avgWith !== null && avgWithout !== null && avgWithout > 0)
    ? Math.round(((avgWith - avgWithout) / avgWithout) * 100)
    : null;

  return {
    totalGenerated: stats.totalGenerated,
    estimatedCost: `$${stats.totalCost.toFixed(2)}`,
    costPerVideo: "$0.0639",
    breakdown: {
      burns: stats.burnVideos,
      race: stats.raceVideos,
      spotlight: stats.spotlightVideos,
    },
    lastGenerated: stats.lastGenerated,
    engagement: {
      avgLikesWithVideo: avgWith,
      avgLikesWithoutVideo: avgWithout,
      liftPercent: lift,
      sampleSize: { withVideo: wv.length, withoutVideo: wov.length },
      verdict: lift === null ? "collecting data"
              : lift > 20   ? "video is working — scale up"
              : lift > 0    ? "slight lift — monitor"
              : lift === 0  ? "no difference — reassess"
              :               "underperforming — scale back",
    },
  };
}
