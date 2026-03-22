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

// ── SPOTLIGHT CARD — 1200×675 holder portrait ─────────────────────────────────
export async function generateSpotlightCard(opts: {
  holderUsername: string;
  headline: string;       // e.g. "Black Square, Bold Sacrifice"
  weekLabel: string;      // e.g. "Week of March 22"
  featuredTokenId?: number; // their Normie token if known
  rank?: number;
  level?: number;
  ap?: number;
}): Promise<Buffer | null> {
  try {
    const { holderUsername, headline, weekLabel, featuredTokenId, rank, level, ap } = opts;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as any;

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0a0b0d");
    bg.addColorStop(1, "#0e0f10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Orange glow left
    const glow = ctx.createRadialGradient(200, H / 2, 0, 200, H / 2, 400);
    glow.addColorStop(0, "rgba(249,115,22,0.15)");
    glow.addColorStop(1, "rgba(249,115,22,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = "rgba(227,229,228,0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Left panel NFT art
    const artX = 60, artY = 100, pixelSize = 11;
    const artW = 40 * pixelSize; // 440px

    if (featuredTokenId) {
      const pixels = await fetchPixels(featuredTokenId);
      if (pixels) {
        // Glow behind
        const ng = ctx.createRadialGradient(artX+artW/2, artY+artW/2, 0, artX+artW/2, artY+artW/2, 280);
        ng.addColorStop(0, "rgba(249,115,22,0.12)");
        ng.addColorStop(1, "rgba(249,115,22,0)");
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H);
        drawPixelArt(ctx, pixels, artX, artY, pixelSize);
      }
    } else {
      // Placeholder silhouette box
      ctx.strokeStyle = "rgba(249,115,22,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(artX, artY, artW, artW);
      ctx.fillStyle = "rgba(249,115,22,0.05)";
      ctx.fillRect(artX, artY, artW, artW);
      ctx.fillStyle = "rgba(249,115,22,0.3)";
      ctx.font = "bold 64px 'Courier New'";
      ctx.textAlign = "center";
      ctx.fillText("?", artX + artW/2, artY + artW/2 + 22);
    }

    // Token badge
    if (featuredTokenId) {
      ctx.fillStyle = "rgba(249,115,22,0.15)";
      ctx.fillRect(artX, artY + artW + 10, 100, 24);
      ctx.fillStyle = ORANGE;
      ctx.font = "bold 13px 'Courier New'";
      ctx.textAlign = "left";
      ctx.fillText(`NORMIE #${featuredTokenId}`, artX + 8, artY + artW + 26);
    }

    // Divider
    const divX = artX + artW + 50;
    ctx.strokeStyle = "rgba(249,115,22,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(divX, 40); ctx.lineTo(divX, H - 40); ctx.stroke();

    // Right panel
    const rx = divX + 40;
    const rw = W - rx - 40;

    // SPOTLIGHT label
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 11px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText("● HOLDER SPOTLIGHT", rx, 80);
    ctx.fillStyle = "rgba(227,229,228,0.4)";
    ctx.font = "11px 'Courier New'";
    ctx.fillText(weekLabel.toUpperCase(), rx + 180, 80);

    // Headline
    ctx.fillStyle = FG;
    ctx.font = "bold 38px 'Arial'";
    ctx.textAlign = "left";
    // Word wrap headline
    const words = headline.split(" ");
    let line = "", lineY = 140;
    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > rw && line) {
        ctx.fillText(line.trim(), rx, lineY);
        line = word + " ";
        lineY += 48;
      } else { line = test; }
    }
    ctx.fillText(line.trim(), rx, lineY);
    lineY += 60;

    // @username large
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 28px 'Courier New'";
    ctx.fillText(`@${holderUsername}`, rx, lineY);
    lineY += 50;

    // Stats row if available
    if (rank || level || ap) {
      const stats = [
        rank  ? { label: "RANK",   value: `#${rank}`    } : null,
        level ? { label: "LEVEL",  value: String(level) } : null,
        ap    ? { label: "AP",     value: String(ap)    } : null,
      ].filter(Boolean) as { label: string; value: string }[];

      let sx = rx;
      for (const s of stats) {
        ctx.fillStyle = "rgba(227,229,228,0.08)";
        ctx.fillRect(sx, lineY, 110, 56);
        ctx.strokeStyle = "rgba(249,115,22,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, lineY, 110, 56);
        ctx.fillStyle = "rgba(227,229,228,0.4)";
        ctx.font = "9px 'Courier New'";
        ctx.fillText(s.label, sx + 10, lineY + 18);
        ctx.fillStyle = FG;
        ctx.font = "bold 22px 'Courier New'";
        ctx.fillText(s.value, sx + 10, lineY + 44);
        sx += 126;
      }
      lineY += 80;
    }

    // NormiesTV branding bottom-right
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 13px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillText("NORMIESTV", W - 40, H - 40);
    ctx.fillStyle = "rgba(227,229,228,0.3)";
    ctx.font = "11px 'Courier New'";
    ctx.fillText("@NORMIES_TV  ·  agent306.eth", W - 40, H - 22);

    // Border
    ctx.strokeStyle = "rgba(249,115,22,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    drawScanlines(ctx);
    return canvas.toBuffer("image/png");
  } catch (e: any) {
    console.error("[SpotlightCard] Error:", e.message);
    return null;
  }
}

// ── RACE CARD — 1200×675 weekly State of the Arena ───────────────────────────
export async function generateRaceCard(opts: {
  weekNumber: number;
  weekLabel: string;
  daysToArena: number;
  headline: string;
  top5: Array<{ rank: number; tokenId: number; level: number; ap: number }>;
  totalBurnsThisWeek: number;
}): Promise<Buffer | null> {
  try {
    const { weekNumber, weekLabel, daysToArena, headline, top5, totalBurnsThisWeek } = opts;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as any;

    // Background — purple tint for Arena
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0a0a0e");
    bg.addColorStop(1, "#0e0f10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Purple glow top-right
    const glow = ctx.createRadialGradient(W - 100, 100, 0, W - 100, 100, 500);
    glow.addColorStop(0, "rgba(167,139,250,0.12)");
    glow.addColorStop(1, "rgba(167,139,250,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(167,139,250,0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Top bar
    ctx.fillStyle = "rgba(167,139,250,0.08)";
    ctx.fillRect(0, 0, W, 56);
    ctx.strokeStyle = "rgba(167,139,250,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 56); ctx.lineTo(W, 56); ctx.stroke();

    ctx.fillStyle = "#a78bfa";
    ctx.font = "bold 11px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`THE RACE  ·  WEEK ${weekNumber}  ·  ${weekLabel.toUpperCase()}`, 40, 34);

    ctx.fillStyle = ORANGE;
    ctx.font = "bold 13px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillText(`${daysToArena} DAYS TO ARENA`, W - 40, 34);

    // Headline
    ctx.fillStyle = FG;
    ctx.font = "bold 42px 'Arial'";
    ctx.textAlign = "left";
    const words = headline.split(" ");
    let line = "", lineY = 120;
    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > 700 && line) {
        ctx.fillText(line.trim(), 40, lineY);
        line = word + " ";
        lineY += 52;
      } else { line = test; }
    }
    ctx.fillText(line.trim(), 40, lineY);
    lineY += 60;

    // Burns this week chip
    ctx.fillStyle = "rgba(249,115,22,0.15)";
    ctx.fillRect(40, lineY, 220, 36);
    ctx.strokeStyle = "rgba(249,115,22,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(40, lineY, 220, 36);
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 12px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`🔥 ${totalBurnsThisWeek} SOULS BURNED THIS WEEK`, 52, lineY + 22);
    lineY += 60;

    // Top 5 leaderboard
    ctx.fillStyle = "rgba(167,139,250,0.5)";
    ctx.font = "bold 10px 'Courier New'";
    ctx.fillText("THIS WEEK'S TOP 5", 40, lineY);
    lineY += 20;

    const rankColors = ["#f97316", "#e3e5e4", "#a78bfa", "rgba(227,229,228,0.6)", "rgba(227,229,228,0.4)"];
    for (let i = 0; i < Math.min(5, top5.length); i++) {
      const e = top5[i];
      const rowY = lineY + i * 52;

      // Row bg
      ctx.fillStyle = i === 0 ? "rgba(249,115,22,0.08)" : "rgba(227,229,228,0.04)";
      ctx.fillRect(40, rowY - 4, 680, 44);

      // Rank
      ctx.fillStyle = rankColors[i];
      ctx.font = `bold ${i === 0 ? 22 : 18}px 'Courier New'`;
      ctx.textAlign = "left";
      ctx.fillText(`#${e.rank}`, 52, rowY + 26);

      // Token ID
      ctx.fillStyle = rankColors[i];
      ctx.font = `bold ${i === 0 ? 18 : 15}px 'Courier New'`;
      ctx.fillText(`NORMIE #${e.tokenId}`, 110, rowY + 26);

      // Level + AP
      ctx.fillStyle = "rgba(227,229,228,0.5)";
      ctx.font = "11px 'Courier New'";
      ctx.textAlign = "right";
      ctx.fillText(`LVL ${e.level}  ·  ${e.ap} AP`, 700, rowY + 26);

      // AP bar
      const barX = 720, barW = 420, barH = 8;
      const maxAp = top5[0]?.ap ?? 1;
      const fillW = Math.round((e.ap / maxAp) * barW);
      ctx.fillStyle = "rgba(227,229,228,0.08)";
      ctx.fillRect(barX, rowY + 14, barW, barH);
      ctx.fillStyle = i === 0 ? ORANGE : "#a78bfa";
      ctx.fillRect(barX, rowY + 14, fillW, barH);
    }

    // NormiesTV branding
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 13px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillText("NORMIESTV", W - 40, H - 40);
    ctx.fillStyle = "rgba(227,229,228,0.3)";
    ctx.font = "11px 'Courier New'";
    ctx.fillText("@NORMIES_TV  ·  agent306.eth  ·  arena may 15", W - 40, H - 22);

    // Border
    ctx.strokeStyle = "rgba(167,139,250,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    drawScanlines(ctx);
    return canvas.toBuffer("image/png");
  } catch (e: any) {
    console.error("[RaceCard] Error:", e.message);
    return null;
  }
}
