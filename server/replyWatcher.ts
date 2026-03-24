// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — REPLY WATCHER
// Reads replies to @NORMIES_TV posts via Grok x_search
// Classifies them and feeds the top ones into the episode narrative context
//
// This is what closes the loop:
// Episode posts → community replies → Agent #306 reads them →
// next episode references what the community said → they feel heard → they engage more
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";

import { dataPath } from "./dataPaths.js";
const REPLY_STATE_FILE = dataPath("replies.json");
const GROK_KEY = process.env.GROK_API_KEY ?? "";

export interface CommunityReply {
  username: string;
  text: string;
  likes: number;
  replyType: "question" | "lore_suggestion" | "holder_mention" | "excitement" | "callout" | "general";
  tokenMentioned?: number;       // if they mentioned a specific Normie #ID
  capturedAt: string;
  tweetUrl?: string;
}

interface ReplyState {
  replies: CommunityReply[];
  lastFetched: string | null;
  totalCaptured: number;
}

function loadState(): ReplyState {
  try {
    if (fs.existsSync(REPLY_STATE_FILE))
      return JSON.parse(fs.readFileSync(REPLY_STATE_FILE, "utf8"));
  } catch {}
  return { replies: [], lastFetched: null, totalCaptured: 0 };
}

function saveState(s: ReplyState) {
  try { fs.writeFileSync(REPLY_STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

let replyState = loadState();

export function getReplyState() { return replyState; }

export function getTopReplies(limit = 5): CommunityReply[] {
  return replyState.replies
    .sort((a, b) => {
      // Priority: questions and lore suggestions first, then by likes
      const typeScore = { question: 4, lore_suggestion: 4, callout: 3, holder_mention: 3, excitement: 2, general: 1 };
      const aScore = (typeScore[a.replyType] ?? 1) + (a.likes * 0.5);
      const bScore = (typeScore[b.replyType] ?? 1) + (b.likes * 0.5);
      return bScore - aScore;
    })
    .slice(0, limit);
}

// ── Format replies for episode prompt injection ───────────────────────────────
export function formatRepliesForContext(): string {
  const top = getTopReplies(5);
  if (top.length === 0) return "";

  const lines = top.map(r => {
    const typeLabel = {
      question: "❓ ASKED",
      lore_suggestion: "💡 SUGGESTED",
      holder_mention: "👤 MENTIONED",
      callout: "📣 CALLED OUT",
      excitement: "🔥 EXCITED",
      general: "💬 SAID",
    }[r.replyType] ?? "💬 SAID";

    const tokenNote = r.tokenMentioned ? ` [about #${r.tokenMentioned}]` : "";
    return `@${r.username} ${typeLabel}${tokenNote}: "${r.text.slice(0, 120)}"`;
  });

  return `COMMUNITY REPLIED TO RECENT EPISODES:\n${lines.join("\n")}\n\nThese are real replies from co-creators. Reference them in the story. If someone asked "what happens to #X next?" — answer it. If someone suggested a direction — take it seriously. Name them by @handle — they will see it and repost.`;
}

// ── Fetch replies via Grok x_search ──────────────────────────────────────────
export async function fetchReplies(): Promise<void> {
  if (!GROK_KEY) return;

  console.log("[ReplyWatcher] Fetching replies to @NORMIES_TV...");

  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast", // uses x_search tool to find @NORMIES_TV mentions on X
        stream: false,
        input: [{
          role: "user",
          content: `Search X for ALL engagement with @NORMIES_TV from the last 2 hours.

Find ALL of these — cast a WIDE net:
1. Direct replies to any @NORMIES_TV tweet
2. Quote tweets of @NORMIES_TV posts
3. Posts that @mention @NORMIES_TV directly (HIGHEST PRIORITY — every @mention deserves a reply)
4. Posts about "NORMIES" NFT that tag @NORMIES_TV
5. Posts mentioning "NORMIES" + "NFT" or "NORMIES" + "burn" or "NORMIES" + "arena" (even without the @mention)
6. Threaded conversations where @NORMIES_TV was mentioned earlier in the thread

For each reply/mention, classify it:
- "question": asking about tokens, mechanics, what happens next, how something works
- "lore_suggestion": suggesting story directions, contributing narrative ideas
- "holder_mention": sharing their own Normie, mentioning a specific token #ID, showing off
- "callout": tagging someone, calling attention to the project, introducing someone new
- "excitement": hyped, celebrating, reacting positively, cheering
- "general": other meaningful engagement

Also extract any Normie token numbers mentioned (e.g. #8553 → tokenMentioned: 8553).

Return JSON array (max 20 — get as many as possible):
[{
  "username": "handle without @",
  "text": "exact reply text",
  "likes": 0,
  "replyType": "question|lore_suggestion|holder_mention|callout|excitement|general",
  "tokenMentioned": null or number,
  "tweetUrl": "url if available"
}]`,
        }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      console.warn("[ReplyWatcher] x_search failed:", res.status);
      return;
    }

    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";

    if (!rawText) return;

    // Parse JSON array from response
    const firstBracket = rawText.indexOf("[");
    const lastBracket = rawText.lastIndexOf("]");

    if (firstBracket === -1 || lastBracket <= firstBracket) {
      console.log("[ReplyWatcher] No JSON array found in response");
      return;
    }

    let newReplies: CommunityReply[] = [];
    try {
      const parsed = JSON.parse(rawText.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(parsed)) {
        newReplies = parsed
          .filter((r: any) => r.username && r.text && r.text.length > 5)
          .map((r: any) => ({
            username: String(r.username).replace(/^@/, ""),
            text: String(r.text),
            likes: Number(r.likes ?? 0),
            replyType: r.replyType ?? "general",
            tokenMentioned: r.tokenMentioned ? Number(r.tokenMentioned) : undefined,
            capturedAt: new Date().toISOString(),
            tweetUrl: r.tweetUrl ?? "",
          }));
      }
    } catch (parseErr) {
      console.warn("[ReplyWatcher] Parse error:", parseErr);
      return;
    }

    if (newReplies.length === 0) {
      console.log("[ReplyWatcher] No replies found yet — account may be too new");
      return;
    }

    // Merge with existing — dedupe by username+text snippet
    const seen = new Set(replyState.replies.map(r => `${r.username}|${r.text.slice(0, 40)}`));
    const fresh = newReplies.filter(r => !seen.has(`${r.username}|${r.text.slice(0, 40)}`));

    // Keep latest 50, weight toward questions and lore suggestions
    replyState.replies = [...fresh, ...replyState.replies]
      .sort((a, b) => {
        const typeScore = { question: 4, lore_suggestion: 4, callout: 3, holder_mention: 3, excitement: 2, general: 1 };
        return (typeScore[b.replyType] ?? 1) - (typeScore[a.replyType] ?? 1);
      })
      .slice(0, 50);

    replyState.totalCaptured += fresh.length;
    replyState.lastFetched = new Date().toISOString();
    saveState(replyState);

    const byType = fresh.reduce((acc: any, r) => {
      acc[r.replyType] = (acc[r.replyType] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[ReplyWatcher] ${fresh.length} new replies captured:`, byType);

  } catch (err: any) {
    console.warn("[ReplyWatcher] Error:", err.message);
  }
}
