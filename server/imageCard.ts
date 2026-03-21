// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — EPISODE IMAGE CARD GENERATOR
// Creates a 1200×675 PNG card for each episode using the featured Normie's
// on-chain pixel art. Styled in normies.art palette. Uploaded to a public
// URL via a temp file so Publer can attach it to the tweet.
// ─────────────────────────────────────────────────────────────────────────────

import { createCanvas, loadImage } from "canvas";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const W = 1200;
const H = 675;

// Normies.art palette
const BG_DARK    = "#0e0f10";
const BG_MID     = "#1a1b1c";
const PIXEL_COLOR = "#48494b";
const FG         = "#e3e5e4";
const ORANGE     = "#f97316";
const DIM        = "rgba(227,229,228,0.25)";

// ── Fetch pixel string for a token ───────────────────────────────────────────
async function fetchPixels(tokenId: number): Promise<string | null> {
  return new Promise(resolve => {
    const url = `https://api.normies.art/normie/${tokenId}/pixels`;
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data.trim().length === 1600 ? data.trim() : null));
    }).on("error", () => resolve(null));
  });
}

// ── Draw pixel art at given position and scale ────────────────────────────────
function drawPixelArt(
  ctx: any,
  pixels: string,
  x: number, y: number,
  pixelSize: number,
  glowColor = ORANGE
) {
  const W = 40;
  for (let row = 0; row < W; row++) {
    for (let col = 0; col < W; col++) {
      if (pixels[row * W + col] !== "1") continue;
      ctx.fillStyle = FG;
      ctx.fillRect(x + col * pixelSize, y + row * pixelSize, pixelSize - 0.5, pixelSize - 0.5);
    }
  }
}

// ── Draw scanline overlay for that cinematic feel ─────────────────────────────
function drawScanlines(ctx: any) {
  ctx.save();
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, y, W, 1);
  }
  ctx.restore();
}

// ── Main card generator ────────────────────────────────────────────────────────
export async function generateEpisodeCard(opts: {
  tokenId: number;
  episodeTitle: string;
  episodeNum: number;
  stat1Label: string;  // e.g. "SOULS SACRIFICED"
  stat1Value: string;  // e.g. "20"
  stat2Label: string;  // e.g. "PIXELS CONSUMED"
  stat2Value: string;  // e.g. "9,863"
  sentiment: string;
}): Promise<Buffer | null> {
  try {
    const { tokenId, episodeTitle, episodeNum, stat1Label, stat1Value, stat2Label, stat2Value } = opts;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as any;

    // ── Background ────────────────────────────────────────────────────────────
    // Dark gradient base
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, "#0a0b0d");
    bgGrad.addColorStop(1, "#111213");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Orange glow in top-left (where Normie will sit)
    const glow = ctx.createRadialGradient(220, H/2, 0, 220, H/2, 380);
    glow.addColorStop(0, "rgba(249,115,22,0.12)");
    glow.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid lines
    ctx.strokeStyle = "rgba(227,229,228,0.03)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // ── Normie pixel art (left side) ─────────────────────────────────────────
    const pixels = await fetchPixels(tokenId);
    const pixelSize = 10;
    const artW = 40 * pixelSize; // 400px
    const artX = 60;
    const artY = (H - artW) / 2;

    if (pixels) {
      // Glow behind the Normie
      const normieGlow = ctx.createRadialGradient(
        artX + artW/2, artY + artW/2, 0,
        artX + artW/2, artY + artW/2, 260
      );
      normieGlow.addColorStop(0, "rgba(249,115,22,0.10)");
      normieGlow.addColorStop(1, "rgba(249,115,22,0)");
      ctx.fillStyle = normieGlow;
      ctx.fillRect(0, 0, W, H);

      drawPixelArt(ctx, pixels, artX, artY, pixelSize);
    }

    // Token ID badge
    ctx.fillStyle = "rgba(249,115,22,0.15)";
    ctx.fillRect(artX, artY + artW + 8, 80, 22);
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 12px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`#${tokenId}`, artX + 8, artY + artW + 22);

    // ── Divider line ─────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(249,115,22,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(artX + artW + 40, 60);
    ctx.lineTo(artX + artW + 40, H - 60);
    ctx.stroke();

    // ── Right side content ────────────────────────────────────────────────────
    const rx = artX + artW + 70;
    const contentW = W - rx - 60;

    // NORMIES TV label
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 11px 'Courier New'";
    ctx.textAlign = "left";
    ctx.letterSpacing = "0.2em";
    ctx.fillText("NORMIES TV", rx, 90);

    // Episode number
    ctx.fillStyle = "rgba(227,229,228,0.25)";
    ctx.font = "11px 'Courier New'";
    ctx.fillText(`EP ${String(episodeNum).padStart(3, "0")}`, rx + 110, 90);

    // Episode title
    ctx.fillStyle = FG;
    ctx.font = "bold 38px 'Courier New'";
    ctx.textAlign = "left";

    // Word wrap title
    const words = episodeTitle.split(" ");
    let line = "";
    let titleY = 145;
    const maxW = contentW;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const metrics = ctx.measureText(test);
      if (metrics.width > maxW && line) {
        ctx.fillText(line, rx, titleY);
        line = word;
        titleY += 48;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, rx, titleY);

    // ── Stats ─────────────────────────────────────────────────────────────────
    const statsY = titleY + 70;

    // Stat 1
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 52px 'Courier New'";
    ctx.fillText(stat1Value, rx, statsY);
    ctx.fillStyle = "rgba(227,229,228,0.8)";
    ctx.font = "bold 13px 'Courier New'";
    ctx.fillText(stat1Label, rx, statsY + 24);

    // Stat 2
    const stat2X = rx + 200;
    ctx.fillStyle = FG;
    ctx.font = "bold 52px 'Courier New'";
    ctx.fillText(stat2Value, stat2X, statsY);
    ctx.fillStyle = "rgba(227,229,228,0.8)";
    ctx.font = "bold 13px 'Courier New'";
    ctx.fillText(stat2Label, stat2X, statsY + 24);

    // ── Agent #306 signature ───────────────────────────────────────────────────
    ctx.fillStyle = "rgba(227,229,228,0.6)";
    ctx.font = "15px 'Courier New'";
    ctx.fillText("— Agent #306", rx, statsY + 90);

    // ── Bottom bar ────────────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(249,115,22,0.15)";
    ctx.fillRect(0, H - 50, W, 50);
    ctx.strokeStyle = "rgba(249,115,22,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 50); ctx.lineTo(W, H - 50); ctx.stroke();

    ctx.fillStyle = "rgba(227,229,228,0.75)";
    ctx.font = "bold 13px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText("normies.art  ·  fully on-chain  ·  ethereum", rx, H - 18);

    ctx.fillStyle = ORANGE;
    ctx.font = "bold 14px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillText("#NormiesTV", W - 40, H - 18);

    // Scanlines for that pixel TV feel
    drawScanlines(ctx);

    // ── Orange accent border ──────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(249,115,22,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    return canvas.toBuffer("image/png");
  } catch (e: any) {
    console.error("[NormiesTV] Image card error:", e.message);
    return null;
  }
}

// ── Save card to /tmp and return file path ────────────────────────────────────
export async function saveEpisodeCard(opts: Parameters<typeof generateEpisodeCard>[0]): Promise<string | null> {
  const buf = await generateEpisodeCard(opts);
  if (!buf) return null;
  const filePath = `/tmp/normiestv_ep${opts.episodeNum}_${Date.now()}.png`;
  fs.writeFileSync(filePath, buf);
  console.log(`[NormiesTV] Image card saved: ${filePath} (${(buf.length / 1024).toFixed(1)}KB)`);
  return filePath;
}
