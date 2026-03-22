// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — BURN RECEIPT ENGINE
// Real-time burn detection (polls every 90s) + personalized image card +
// Agent #306 narrative + auto-post to @NORMIES_TV
//
// Logic:
// 1. Poll normies.art/history/burns every 90 seconds
// 2. Compare against lastSeenCommitId — skip already-seen burns
// 3. For each NEW burn:
//    a. Generate personalized narrative via Grok
//    b. Build a custom image card showing burning Normie → receiving Normie
//    c. Upload image to X v1.1 media upload
//    d. Post tweet with image + narrative
//    e. Save to burnReceiptLog (persistent state)
// ─────────────────────────────────────────────────────────────────────────────

import { createCanvas } from "canvas";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";

const NORMIES_API  = "https://api.normies.art";
import { dataPath } from "./dataPaths.js";
const RECEIPT_STATE = dataPath("burn_receipts.json");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BurnEvent {
  commitId: string;
  receiverTokenId: number;
  tokenCount: number;
  pixelCounts: string;   // JSON array string
  timestamp: number;
  burnedTokenIds?: number[];
}

interface ReceiptState {
  lastCommitId: string | null;
  processedCommitIds: string[];  // keep last 200 to avoid replays
  totalReceipts: number;
  lastReceiptAt: string | null;
}

// ── Card palette ──────────────────────────────────────────────────────────────
const BG       = "#0a0b0d";
const BG_MID   = "#1a1b1c";
const FG       = "#e3e5e4";
const ORANGE   = "#f97316";
const DIM      = "rgba(227,229,228,0.3)";
const W = 1200;
const H = 675;

// ── State ─────────────────────────────────────────────────────────────────────
function loadReceiptState(): ReceiptState {
  try {
    if (fs.existsSync(RECEIPT_STATE)) {
      return JSON.parse(fs.readFileSync(RECEIPT_STATE, "utf8"));
    }
  } catch {}
  return { lastCommitId: null, processedCommitIds: [], totalReceipts: 0, lastReceiptAt: null };
}

function saveReceiptState(s: ReceiptState) {
  try { fs.writeFileSync(RECEIPT_STATE, JSON.stringify(s)); } catch {}
}

let receiptState = loadReceiptState();

export function getReceiptState() { return receiptState; }

// ── Safe fetch ────────────────────────────────────────────────────────────────
async function safeFetch(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Fetch pixel string ────────────────────────────────────────────────────────
async function fetchPixels(tokenId: number): Promise<string | null> {
  return new Promise(resolve => {
    const url = `${NORMIES_API}/normie/${tokenId}/pixels`;
    https.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data.trim().length === 1600 ? data.trim() : null));
    }).on("error", () => resolve(null));
  });
}

// ── Draw pixel art on canvas ──────────────────────────────────────────────────
function drawPixelArt(ctx: any, pixels: string, x: number, y: number, size: number, color = FG) {
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 40; col++) {
      if (pixels[row * 40 + col] !== "1") continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * size, y + row * size, size - 0.5, size - 0.5);
    }
  }
}

function drawScanlines(ctx: any) {
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(0, y, W, 1);
  }
}

// ── Generate burn receipt image card ─────────────────────────────────────────
// Layout: [Burning Normie(s)] → arrow → [Receiving Normie] + stats on right
export async function generateBurnReceiptCard(opts: {
  receiverTokenId: number;
  burnedTokenIds: number[];
  tokenCount: number;
  pixelTotal: number;
  narrative: string;
  receiptNumber: number;
  level: number;
  actionPoints: number;
}): Promise<Buffer | null> {
  const { receiverTokenId, burnedTokenIds, tokenCount, pixelTotal,
          narrative, receiptNumber, level, actionPoints } = opts;

  try {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as any;

    // ── Background ────────────────────────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, "#060708");
    bgGrad.addColorStop(1, "#0f1011");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(227,229,228,0.025)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // ── Burning Normie (left side, shown fading/ghosted) ─────────────────────
    const burnedId = burnedTokenIds[0] ?? receiverTokenId;
    const burnedPixels = await fetchPixels(burnedId);
    const smallSize = 5;   // 40×5 = 200px — smaller, ghost
    const burnedArtW = 40 * smallSize;
    const burnedX = 50;
    const burnedY = (H - burnedArtW) / 2;

    if (burnedPixels) {
      // Ghost glow
      const ghostGlow = ctx.createRadialGradient(burnedX + burnedArtW/2, burnedY + burnedArtW/2, 0, burnedX + burnedArtW/2, burnedY + burnedArtW/2, 140);
      ghostGlow.addColorStop(0, "rgba(249,115,22,0.08)");
      ghostGlow.addColorStop(1, "rgba(249,115,22,0)");
      ctx.fillStyle = ghostGlow;
      ctx.fillRect(0, 0, W, H);

      // Draw faded (ghost) — use dimmer color
      ctx.globalAlpha = 0.4;
      drawPixelArt(ctx, burnedPixels, burnedX, burnedY, smallSize, "rgba(227,229,228,0.6)");
      ctx.globalAlpha = 1;
    }

    // Burned ID badge
    ctx.fillStyle = "rgba(249,115,22,0.12)";
    ctx.fillRect(burnedX, burnedY + burnedArtW + 6, 68, 18);
    ctx.fillStyle = "rgba(249,115,22,0.6)";
    ctx.font = "bold 10px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`#${burnedId}`, burnedX + 6, burnedY + burnedArtW + 18);

    // If multiple burns, show +N more
    if (tokenCount > 1) {
      ctx.fillStyle = "rgba(249,115,22,0.35)";
      ctx.font = "10px 'Courier New'";
      ctx.fillText(`+${tokenCount - 1} more`, burnedX, burnedY + burnedArtW + 36);
    }

    // ── Arrow / sacrifice flow ────────────────────────────────────────────────
    const arrowX = burnedX + burnedArtW + 20;
    const arrowCY = H / 2;

    // Arrow line
    ctx.strokeStyle = "rgba(249,115,22,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowCY);
    ctx.lineTo(arrowX + 60, arrowCY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(arrowX + 65, arrowCY);
    ctx.lineTo(arrowX + 55, arrowCY - 6);
    ctx.lineTo(arrowX + 55, arrowCY + 6);
    ctx.closePath();
    ctx.fill();

    // "SACRIFICED" label
    ctx.fillStyle = "rgba(249,115,22,0.5)";
    ctx.font = "9px 'Courier New'";
    ctx.textAlign = "center";
    ctx.fillText("SACRIFICED", arrowX + 32, arrowCY - 10);

    // ── Receiver Normie (center, full bright) ─────────────────────────────────
    const receiverPixels = await fetchPixels(receiverTokenId);
    const bigSize = 8;   // 40×8 = 320px — bigger, vivid
    const receiverArtW = 40 * bigSize;
    const receiverX = arrowX + 80;
    const receiverY = (H - receiverArtW) / 2;

    if (receiverPixels) {
      // Bright glow behind receiver
      const receiverGlow = ctx.createRadialGradient(
        receiverX + receiverArtW/2, receiverY + receiverArtW/2, 0,
        receiverX + receiverArtW/2, receiverY + receiverArtW/2, 220
      );
      receiverGlow.addColorStop(0, "rgba(249,115,22,0.18)");
      receiverGlow.addColorStop(1, "rgba(249,115,22,0)");
      ctx.fillStyle = receiverGlow;
      ctx.fillRect(0, 0, W, H);

      drawPixelArt(ctx, receiverPixels, receiverX, receiverY, bigSize);
    }

    // Receiver badge
    ctx.fillStyle = ORANGE;
    ctx.fillRect(receiverX, receiverY + receiverArtW + 6, 90, 22);
    ctx.fillStyle = BG;
    ctx.font = "bold 12px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`#${receiverTokenId}`, receiverX + 8, receiverY + receiverArtW + 21);

    // ── Vertical divider ─────────────────────────────────────────────────────
    const divX = receiverX + receiverArtW + 40;
    ctx.strokeStyle = "rgba(249,115,22,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(divX, 60); ctx.lineTo(divX, H - 60); ctx.stroke();

    // ── Right side — stats + narrative ───────────────────────────────────────
    const rx = divX + 30;
    let ry = 75;

    // NORMIES TV + receipt number
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 11px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText("NORMIES TV", rx, ry);

    ctx.fillStyle = "rgba(227,229,228,0.25)";
    ctx.font = "11px 'Courier New'";
    ctx.fillText(`BURN RECEIPT #${String(receiptNumber).padStart(4, "0")}`, rx + 115, ry);

    ry += 35;

    // Title
    ctx.fillStyle = FG;
    ctx.font = "bold 28px 'Courier New'";
    ctx.fillText("SACRIFICE CONFIRMED", rx, ry);
    ry += 18;
    ctx.fillStyle = ORANGE;
    ctx.font = "bold 14px 'Courier New'";
    ctx.fillText(`${tokenCount} SOUL${tokenCount > 1 ? "S" : ""} → NORMIE #${receiverTokenId}`, rx, ry);

    ry += 40;

    // Stats row
    const stats = [
      { label: "SOULS BURNED", value: String(tokenCount) },
      { label: "PIXELS", value: pixelTotal >= 1000 ? `${(pixelTotal/1000).toFixed(1)}K` : String(pixelTotal) },
      { label: "LEVEL", value: `LV.${level}` },
      { label: "ACTION PTS", value: `${actionPoints}` },
    ];

    const statW = Math.min(110, (W - rx - 40) / stats.length);
    stats.forEach((s, i) => {
      const sx = rx + i * statW;
      ctx.fillStyle = ORANGE;
      ctx.font = "bold 32px 'Courier New'";
      ctx.textAlign = "left";
      ctx.fillText(s.value, sx, ry + 32);
      ctx.fillStyle = "rgba(227,229,228,0.5)";
      ctx.font = "9px 'Courier New'";
      ctx.fillText(s.label, sx, ry + 48);
    });

    ry += 80;

    // Narrative (word wrapped)
    ctx.fillStyle = "rgba(227,229,228,0.7)";
    ctx.font = "13px 'Courier New'";
    const maxLineW = W - rx - 40;
    const words = narrative.split(" ");
    let line = "";
    const lineH = 20;
    let narY = ry;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxLineW && line) {
        ctx.fillText(line, rx, narY);
        line = word;
        narY += lineH;
        if (narY > H - 80) break;
      } else {
        line = test;
      }
    }
    if (line && narY <= H - 80) ctx.fillText(line, rx, narY);

    // Agent #306 sig
    ctx.fillStyle = "rgba(227,229,228,0.4)";
    ctx.font = "12px 'Courier New'";
    ctx.fillText("— Agent #306", rx, H - 70);

    // ── Bottom bar ────────────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(249,115,22,0.12)";
    ctx.fillRect(0, H - 50, W, 50);
    ctx.strokeStyle = "rgba(249,115,22,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 50); ctx.lineTo(W, H - 50); ctx.stroke();

    ctx.fillStyle = "rgba(227,229,228,0.5)";
    ctx.font = "bold 11px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText("normies.art  ·  fully on-chain  ·  canvas phase  ·  ethereum", 40, H - 18);

    ctx.fillStyle = ORANGE;
    ctx.font = "bold 12px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillText("#NormiesTV  #NORMIES", W - 40, H - 18);

    drawScanlines(ctx);

    // Border
    ctx.strokeStyle = "rgba(249,115,22,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    return canvas.toBuffer("image/png");
  } catch (e: any) {
    console.error("[BurnReceipt] Card error:", e.message);
    return null;
  }
}

// ── Generate narrative via Grok ───────────────────────────────────────────────
export async function generateBurnNarrative(opts: {
  receiverTokenId: number;
  burnedTokenIds: number[];
  tokenCount: number;
  pixelTotal: number;
  level: number;
  actionPoints: number;
}): Promise<string> {
  const { receiverTokenId, burnedTokenIds, tokenCount, pixelTotal, level, actionPoints } = opts;
  const grokKey = process.env.GROK_API_KEY;

  // Scale the narrative length by burn size
  const scale = tokenCount >= 50 ? "LEGENDARY" : tokenCount >= 10 ? "MAJOR" : tokenCount >= 4 ? "significant" : "small";

  if (!grokKey) {
    // Fallback narratives by scale
    const fallbacks: Record<string, string> = {
      LEGENDARY: `50+ souls sacrificed. The Canvas shakes. Normie #${receiverTokenId} absorbs the light of ${tokenCount} fallen. This is not a burn — this is a birth. A legend is being written on-chain, pixel by pixel. Forever.`,
      MAJOR: `${tokenCount} Normies walk into the Canvas. One emerges transformed. Normie #${receiverTokenId} carries their pixels now — Level ${level}, ${actionPoints} AP. The sacrifice compounds. The Canvas remembers.`,
      significant: `${tokenCount} souls merge into Normie #${receiverTokenId}. Their pixels don't disappear — they evolve. Level ${level}. ${actionPoints} AP earned. The Canvas is forever changed.`,
      small: `Normie #${burnedTokenIds[0] ?? "?"} has entered the Canvas. Their ${pixelTotal} pixels now power #${receiverTokenId}. Every sacrifice counts. The Canvas grows stronger.`,
    };
    return fallbacks[scale];
  }

  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{
          role: "system",
          content: "You are Agent #306 — a female Normie with a fedora, born from 50 burns. You write burn receipt narratives for NormiesTV. Your style: cinematic, punchy, on-chain poetic. Never financial advice. Max 2 sentences.",
        }, {
          role: "user",
          content: `Write a burn receipt narrative for this on-chain event:
- Receiver: Normie #${receiverTokenId} (Level ${level}, ${actionPoints} AP)
- ${tokenCount} Normie(s) sacrificed (IDs: ${burnedTokenIds.slice(0, 5).join(", ")})
- Combined pixels: ${pixelTotal.toLocaleString()}
- Scale: ${scale}

Keep it under 160 chars. Punchy. Honor the sacrifice. Reference the on-chain permanence.`,
        }],
        max_tokens: 120,
        temperature: 0.85,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      return data.choices?.[0]?.message?.content?.trim() ?? "";
    }
  } catch {}

  return `${tokenCount} soul${tokenCount > 1 ? "s" : ""} sacrificed. Normie #${receiverTokenId} rises to Level ${level} with ${actionPoints} AP. ${pixelTotal.toLocaleString()} pixels absorbed forever. The Canvas remembers everything.`;
}

// ── Generate tweet text ───────────────────────────────────────────────────────
export function buildBurnTweetText(opts: {
  receiverTokenId: number;
  tokenCount: number;
  pixelTotal: number;
  level: number;
  actionPoints: number;
  narrative: string;
}): string {
  const { receiverTokenId, tokenCount, pixelTotal, level, actionPoints, narrative } = opts;
  const scale = tokenCount >= 50 ? "🔥🔥🔥 LEGENDARY SACRIFICE 🔥🔥🔥" :
                tokenCount >= 10 ? "🔥 MAJOR SACRIFICE 🔥" : "🔥 SACRIFICE";

  const stats = `Normie #${receiverTokenId} | ${tokenCount} soul${tokenCount > 1 ? "s" : ""} | ${pixelTotal >= 1000 ? `${(pixelTotal/1000).toFixed(1)}K` : pixelTotal}px | Lv.${level} | ${actionPoints}AP`;

  // Keep under 280 chars total
  const full = `${scale}\n\n${narrative}\n\n${stats}\n\n#NormiesTV #NORMIES #Ethereum`;
  if (full.length <= 280) return full;

  // Trim narrative if too long
  const short = `${scale}\n\n${stats}\n\n#NormiesTV #NORMIES #Ethereum`;
  return short;
}

// ── Poll for new burns ────────────────────────────────────────────────────────
export async function checkForNewBurns(): Promise<BurnEvent[]> {
  const data = await safeFetch(`${NORMIES_API}/history/burns?limit=20`);
  if (!Array.isArray(data) || data.length === 0) return [];

  const newBurns: BurnEvent[] = [];

  for (const b of data) {
    const commitId = String(b.commitId);

    // Skip already processed
    if (receiptState.processedCommitIds.includes(commitId)) continue;
    // Skip if older than last seen (on first run, skip all to avoid spamming)
    if (!receiptState.lastCommitId) {
      // First run — just record current state, don't process
      receiptState.lastCommitId = String(data[0].commitId);
      receiptState.processedCommitIds = data.map((b: any) => String(b.commitId));
      saveReceiptState(receiptState);
      console.log("[BurnReceipt] First run — recording current state, no posts");
      return [];
    }

    newBurns.push({
      commitId,
      receiverTokenId: Number(b.receiverTokenId),
      tokenCount: Number(b.tokenCount ?? 1),
      pixelCounts: b.pixelCounts ?? "[]",
      timestamp: Number(b.timestamp),
      burnedTokenIds: b.burnedTokenIds ?? [],
    });
  }

  return newBurns;
}

// ── Process a single burn event → post receipt ────────────────────────────────
export async function processBurnReceipt(
  burn: BurnEvent,
  xWrite: any   // twitter-api-v2 readWrite client
): Promise<void> {
  const { receiverTokenId, burnedTokenIds, tokenCount, pixelCounts } = burn;

  // Parse pixel total
  let pixelTotal = 0;
  try { pixelTotal = JSON.parse(pixelCounts).reduce((s: number, n: number) => s + n, 0); } catch {}

  // Fetch canvas info for level + AP
  let level = 1, actionPoints = tokenCount;
  try {
    const info = await safeFetch(`${NORMIES_API}/normie/${receiverTokenId}/canvas/info`);
    if (info) { level = info.level ?? 1; actionPoints = info.actionPoints ?? tokenCount; }
  } catch {}

  receiptState.totalReceipts++;
  const receiptNumber = receiptState.totalReceipts;

  console.log(`[BurnReceipt] Processing burn #${receiptNumber}: ${tokenCount} → #${receiverTokenId}`);

  // 1. Generate narrative
  const narrative = await generateBurnNarrative({
    receiverTokenId, burnedTokenIds, tokenCount, pixelTotal, level, actionPoints,
  });

  // 2. Build tweet text
  const tweetText = buildBurnTweetText({
    receiverTokenId, tokenCount, pixelTotal, level, actionPoints, narrative,
  });

  // 3. Generate image card
  let xMediaId: string | undefined;
  try {
    const cardBuf = await generateBurnReceiptCard({
      receiverTokenId, burnedTokenIds: burnedTokenIds.length > 0 ? burnedTokenIds : [receiverTokenId],
      tokenCount, pixelTotal, narrative, receiptNumber, level, actionPoints,
    });
    if (cardBuf) {
      xMediaId = await xWrite.v1.uploadMedia(cardBuf, { mimeType: "image/png" as any });
      console.log(`[BurnReceipt] Image uploaded — media_id: ${xMediaId}`);
    }
  } catch (imgErr: any) {
    console.warn("[BurnReceipt] Image upload failed:", imgErr.message);
  }

  // 4. Post tweet
  try {
    const tweet = await xWrite.v2.tweet({
      text: tweetText,
      ...(xMediaId ? { media: { media_ids: [xMediaId] } } : {}),
    });
    console.log(`[BurnReceipt] Posted burn receipt — tweet: ${tweet.data?.id}`);
  } catch (tweetErr: any) {
    console.error("[BurnReceipt] Tweet failed:", tweetErr.message);
  }

  // 5. Mark as processed
  receiptState.processedCommitIds.push(burn.commitId);
  if (receiptState.processedCommitIds.length > 200) {
    receiptState.processedCommitIds = receiptState.processedCommitIds.slice(-200);
  }
  receiptState.lastCommitId = burn.commitId;
  receiptState.lastReceiptAt = new Date().toISOString();
  saveReceiptState(receiptState);
}
