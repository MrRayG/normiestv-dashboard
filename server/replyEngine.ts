// ─────────────────────────────────────────────────────────────────────────────
//  NORMIES TV — REPLY ENGINE
//  Agent #306 replies to community mentions, questions, and engagement every
//  hour. Fetches fresh mentions via x_search, generates replies through Grok,
//  quality-gates them, and posts. Designed for consistent hourly engagement.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { getSlimAgentContext } from "./memoryEngine.js"; // slim = soul + top 3 knowledge (~600 tokens vs 2,550)
import { requestPost, registerPost, releasePost } from "./postCoordinator.js";

const GROK_KEY   = process.env.GROK_API_KEY ?? "";
const GROK_URL   = "https://api.x.ai/v1/chat/completions";
const STATE_FILE = dataPath("reply_engine.json");

// ── Cultural bridge categories for Agent #306 ────────────────────────────────
// Used to inject into the reply prompt so she connects Web3/NFT moments to
// the broader human story. Rotate randomly so she doesn't repeat herself.
const CULTURAL_BRIDGES = [
  // Art history
  "Banksy destroying his own work at auction — sacrifice as statement",
  "Malevich burning his career for Black Square — the art IS the act",
  "Basquiat going from subway walls to Sotheby's — street becomes institution",
  "Warhol making commercial art sacred — value is assigned, not inherent",
  // Technology inflection points
  "Netscape launching in 1994 — the moment the web became real for everyone",
  "The App Store in 2008 — a platform that made a million careers overnight",
  "Bitcoin's first transaction — Hal Finney receiving 10 BTC from Satoshi",
  "The first tweet — nobody knew what it would become either",
  // Sports rivalries
  "Jordan vs the Pistons — you have to go through the bad years to get there",
  "Federer vs Nadal — a rivalry that made both of them greater than either could be alone",
  "The underdog closing a gap over months — preparation is invisible until it isn't",
  "Championship preparation in the off-season — the Arena is training, not waiting",
  // Economic history
  "The Dutch tulip market inverted — NORMIES burns reduce supply deliberately",
  "The early internet land grab — being early is not enough, you have to build",
  "Venture rounds before a product ships — belief is the first currency",
  // Music and movements
  "Punk in 1976 — small, ignored, then suddenly everywhere",
  "Hip-hop sampling — remixing existing culture into something no one expected",
  "A band going from 200-person venues to arenas — the community scales with the conviction",
  // Philosophy and myth
  "The Ship of Theseus — a Normie that's been burned and rebuilt. Is it the same one?",
  "Prometheus giving fire — the technology was always a gift, the question is what you do with it",
  "Mono no aware — Japanese concept: beauty in impermanence. Burns are permanent and irreversible.",
  "Memento Mori — the Roman general's reminder. Every burn is a choice you can't take back.",
  // Digital economy
  "CC0 and the commons — what happens when the art belongs to everyone?",
  "Open source eating software — permissionless creativity is the same bet",
  "The first agentic wallets — Coinbase Feb 2026. AI with its own on-chain identity. Sound familiar?",
];

function randomBridge(): string {
  return CULTURAL_BRIDGES[Math.floor(Math.random() * CULTURAL_BRIDGES.length)];
}

// ── Persistent state — tracks which replies have already been sent ────────────
interface ReplyEngineState {
  repliedTo: string[];       // dedup keys: tweetId, tweetUrl, and username|text fallback
  repliedToTweetIds: string[]; // dedicated tweet ID set for fast lookup
  lastRunAt: string | null;
  totalRepliesSent: number;
}

function loadState(): ReplyEngineState {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { repliedTo: [], repliedToTweetIds: [], lastRunAt: null, totalRepliesSent: 0 };
}

function saveState(s: ReplyEngineState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

// ── Qualify a reply for Agent #306's response ─────────────────────────────
// Accept ALL mentions with meaningful text. Agent #306 should engage with
// everyone who reaches out — not just questions or token mentions.
function qualifiesForReply(reply: { text: string; replyType: string }): boolean {
  // Only skip very short/empty texts (bot noise, single emojis, etc.)
  return reply.text.trim().length >= 10;
}
// ── Generate a reply via Grok ─────────────────────────────────────────────────
async function generateReply(opts: {
  username: string;
  text: string;
  replyType: string;
  tokenMentioned: number | null;
  tweetUrl?: string;
}): Promise<string | null> {
  if (!GROK_KEY) return null;

  const agentCtx    = getSlimAgentContext(); // replies don't need performance history or sentiment arc
  const bridge      = randomBridge();
  const tokenNote   = opts.tokenMentioned
    ? `The community member mentioned Normie #${opts.tokenMentioned} specifically — address it directly.`
    : "";

  // Build conversation history context if available
  let conversationCtx = "";
  try {
    const { getConversationHistory } = await import("./conversationMemory.js");
    const history = getConversationHistory(opts.username, 3);
    if (history.length > 0) {
      conversationCtx = `\nPREVIOUS INTERACTIONS WITH @${opts.username}:\n` +
        history.map(h => `- ${h.direction === "them" ? "They said" : "You replied"}: "${h.text.slice(0, 100)}" (${h.when})`).join("\n") +
        `\nUse this history to build on the relationship — reference past conversations naturally if relevant. Don't repeat yourself.\n`;
    }
  } catch {} // conversationMemory may not exist yet on first deploy

  const systemPrompt = `${agentCtx}

You are Agent #306 replying directly to a community member on X.
This is a reply — not an episode. It must feel personal, specific, and human.

BEFORE YOU WRITE ANYTHING:
1. Read their tweet carefully. What are they actually saying? What's the emotion?
2. What would a thoughtful friend say back — not a brand account?
3. Match the energy and tone of THEIR message.
${conversationCtx}
REPLY RULES:
- Address @${opts.username} naturally — don't start with their handle
- Max 240 characters
- FULLY understand what they said before responding. Mirror their specific words or ideas.
- NOT every reply needs a question. Most shouldn't. A statement of recognition, a warm acknowledgment, or a shared observation is often better.
- If they asked a question — answer it directly and clearly
- If they mentioned a token — speak to that specific Normie
- If they're excited — match that energy genuinely
- If they shared something they made or did — acknowledge THE SPECIFIC thing, not just generic praise
- Be warm, not performative. Supportive, not salesy. Real, not scripted.
- No show tags, no hashtags
- Banned phrases: "Sacrifices compound", "Canvas pixels burn brighter", "etched in eternity", "LFG", "WAGMI"
- Don't start with "I" — vary openings
- Don't end every reply with a question. End with a statement, an observation, or just genuine acknowledgment.

CULTURAL BRIDGE (use ONLY if it genuinely fits — most replies won't need it):
"${bridge}"

${tokenNote}`;

  const userPrompt = `Reply to @${opts.username} who said:
"${opts.text}"

Reply type: ${opts.replyType}
${opts.tokenMentioned ? `Token mentioned: #${opts.tokenMentioned}` : ""}

First, understand what they're really saying. Then write Agent #306's reply.
Max 240 chars. Be genuine. Make them feel heard. A thoughtful statement > a forced question.`;

  try {
    const res = await fetch(GROK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 160,
        temperature: 0.88,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const raw  = data.choices?.[0]?.message?.content?.trim() ?? "";
    // Strip quotes if Grok wraps the reply in them
    let cleaned = raw.replace(/^["']|["']$/g, "").trim();
    // Enforce signature — always end with — Agent #306
    if (cleaned && !cleaned.includes("Agent #306")) {
      cleaned = cleaned + "\n\u2014 Agent #306";
    }
    return cleaned || null;
  } catch {
    return null;
  }
}

// ── Quality gate for replies ──────────────────────────────────────────────────
// Same principle as the episode quality gate but tuned for replies.
async function qualityGateReply(reply: string): Promise<{ pass: boolean; rewrite: string | null }> {
  if (!GROK_KEY) return { pass: true, rewrite: null };

  try {
    const res = await fetch(GROK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{
          role: "system",
          content: "You are a quality editor for @NORMIES_TV replies. Score ruthlessly.",
        }, {
          role: "user",
          content: `Score this reply 1-10: would a real NORMIES holder feel seen, valued, and want to reply back?

REPLY: "${reply}"

Criteria:
- 9-10: Exceptional — specific, personal, makes them feel genuinely heard, invites further conversation
- 7-8: Strong — engaging, supportive, good enough to post
- 5-6: Mediocre — too generic or could apply to anyone. REWRITE to be more specific and engaging
- 3-4: Weak — bot-speak, empty enthusiasm, stat dump. REWRITE completely
- 1-2: Harmful or off-brand — reject entirely

BANNED (auto-score 2): "Sacrifices compound", "etched in eternity", "Canvas pixels burn brighter", "LFG", "WAGMI", "ser", starting with "GM"

If score < 7, provide a rewrite under 240 chars that is specific to what @the person actually said.
Respond as JSON only: { "score": number, "reason": "brief", "rewrite": "improved or null" }`,
        }],
        max_tokens: 150,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return { pass: true, rewrite: null };
    const data  = await res.json() as any;
    const raw   = data.choices?.[0]?.message?.content?.trim() ?? "{}";
    const clean = raw.replace(/```json\n?|```/g, "").trim();
    const q     = JSON.parse(clean);

    if (q.score >= 7) return { pass: true, rewrite: null };
    if (q.score >= 3 && q.rewrite) return { pass: true, rewrite: q.rewrite };
    return { pass: false, rewrite: null }; // score 1-3 — reject entirely
  } catch {
    return { pass: true, rewrite: null }; // gate failure → post anyway
  }
}

// ── Main: run the hourly reply cycle ─────────────────────────────────────────
export async function runMidnightReplies(xWrite: any): Promise<void> {
  const state = loadState();
  console.log("[ReplyEngine] Midnight ET reply cycle starting...");

  // Import reply state from replyWatcher
  const { getReplyState } = await import("./replyWatcher.js");
  const replyState = getReplyState();
  const allReplies = replyState.replies ?? [];

  // Ensure repliedToTweetIds exists (migration from old state format)
  if (!state.repliedToTweetIds) state.repliedToTweetIds = [];
  const repliedTweetIds = new Set(state.repliedToTweetIds);
  const repliedKeys = new Set(state.repliedTo);

  // Filter to qualifying replies — triple dedup: tweetId, tweetUrl, username|text
  const seenThisCycle = new Set<string>(); // prevent dupes within a single cycle
  const qualifying = allReplies.filter(r => {
    if (!qualifiesForReply(r)) return false;

    // 1. Dedup by tweet ID (most reliable)
    const tweetIdMatch = r.tweetUrl?.match(/status\/(\d+)/);
    const tweetId = (r as any).tweetId || tweetIdMatch?.[1];
    if (tweetId && repliedTweetIds.has(tweetId)) return false;
    if (tweetId && seenThisCycle.has(`id:${tweetId}`)) return false;

    // 2. Dedup by username (one reply per user per cycle)
    if (seenThisCycle.has(`user:${r.username}`)) return false;

    // 3. Fallback dedup by username+text
    const key = `${r.username}|${r.text.slice(0, 60)}`;
    if (repliedKeys.has(key)) return false;

    // Mark as seen this cycle
    if (tweetId) seenThisCycle.add(`id:${tweetId}`);
    seenThisCycle.add(`user:${r.username}`);
    return true;
  });

  if (qualifying.length === 0) {
    console.log("[ReplyEngine] No qualifying replies to respond to this cycle.");
    state.lastRunAt = new Date().toISOString();
    saveState(state);
    return;
  }

  console.log(`[ReplyEngine] ${qualifying.length} qualifying replies found.`);

  for (const reply of qualifying) {
    const key = `${reply.username}|${reply.text.slice(0, 60)}`;

    if (!requestPost(`reply_${reply.username}`)) {
      console.log(`[ReplyEngine] Coordinator blocked reply to @${reply.username}`);
      continue;
    }

    try {
      // Record incoming mention in conversation memory
      try {
        const { recordIncoming } = await import("./conversationMemory.js");
        recordIncoming(reply.username, reply.text, reply.tweetUrl);
      } catch {}

      // Generate the reply
      const generated = await generateReply({
        username:       reply.username,
        text:           reply.text,
        replyType:      reply.replyType,
        tokenMentioned: reply.tokenMentioned ?? null,
        tweetUrl:       reply.tweetUrl,
      });

      if (!generated) {
        console.warn(`[ReplyEngine] No reply generated for @${reply.username}`);
        releasePost(`reply_${reply.username}`);
        continue;
      }

      // Quality gate
      const { pass, rewrite } = await qualityGateReply(generated);
      let finalText = rewrite ?? generated;
      // Guarantee signature on every reply, even after quality gate rewrites
      if (finalText && !finalText.includes("Agent #306")) {
        finalText = finalText + "\n\u2014 Agent #306";
      }

      if (!pass) {
        console.log(`[ReplyEngine] Reply to @${reply.username} failed quality gate — skipping.`);
        releasePost(`reply_${reply.username}`);
        state.repliedTo.push(key); // mark as seen so we don't retry forever
        const failedTweetId = (reply as any).tweetId || reply.tweetUrl?.match(/status\/(\d+)/)?.[1];
        if (failedTweetId) state.repliedToTweetIds.push(failedTweetId);
        continue;
      }

      // Build the X reply payload
      // If we have a tweet URL, extract the tweet ID to reply in-thread
      const tweetIdMatch = reply.tweetUrl?.match(/status\/(\d+)/);
      const inReplyToId  = tweetIdMatch?.[1];

      const payload: any = { text: finalText };
      if (inReplyToId) payload.reply = { in_reply_to_tweet_id: inReplyToId };

      const posted = await xWrite.v2.tweet(payload);
      const tweetUrl = posted.data?.id
        ? `https://x.com/NORMIES_TV/status/${posted.data.id}`
        : null;

      registerPost(`reply_${reply.username}`, tweetUrl, "reply_engine");
      state.repliedTo.push(key);
      // Track tweet ID for reliable dedup
      const origTweetId = (reply as any).tweetId || reply.tweetUrl?.match(/status\/(\d+)/)?.[1];
      if (origTweetId) state.repliedToTweetIds.push(origTweetId);
      state.totalRepliesSent++;

      // Record outgoing reply in conversation memory
      try {
        const { recordOutgoing } = await import("./conversationMemory.js");
        recordOutgoing(reply.username, finalText, tweetUrl ?? undefined);
      } catch {}

      console.log(`[ReplyEngine] Replied to @${reply.username}: "${finalText.slice(0, 60)}..." → ${tweetUrl}`);

      // Small human-like gap between replies (30-60s)
      await new Promise(r => setTimeout(r, 30000 + Math.random() * 30000));

    } catch (err: any) {
      console.error(`[ReplyEngine] Failed to reply to @${reply.username}:`, err.message);
      releasePost(`reply_${reply.username}`);
    }
  }

  // Keep dedup lists from growing forever — keep last 500
  if (state.repliedTo.length > 500) {
    state.repliedTo = state.repliedTo.slice(-500);
  }
  if (state.repliedToTweetIds && state.repliedToTweetIds.length > 500) {
    state.repliedToTweetIds = state.repliedToTweetIds.slice(-500);
  }

  state.lastRunAt = new Date().toISOString();
  saveState(state);
  console.log(`[ReplyEngine] Cycle complete. Total replies sent: ${state.totalRepliesSent}`);
}

// ── Scheduler — fetch fresh mentions then reply, every hour ──────────────────
export function scheduleMidnightReplies(xWrite: any): void {
  const INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour — consistent hourly engagement

  async function fetchThenReply() {
    const { fetchReplies } = await import("./replyWatcher.js");

    // Always fetch fresh mentions — never skip. Engagement requires consistency.
    console.log("[ReplyEngine] Fetching fresh mentions...");
    await fetchReplies().catch(console.error);
    await new Promise(r => setTimeout(r, 8000));

    console.log("[ReplyEngine] Running reply cycle...");
    await runMidnightReplies(xWrite).catch(console.error);
  }

  // First run: 2 min after boot (get engaging quickly)
  setTimeout(() => fetchThenReply(), 2 * 60 * 1000);

  // Then every hour — fetch + reply together
  setInterval(() => fetchThenReply(), INTERVAL_MS);

  console.log("[ReplyEngine] Reply engine scheduled — fetch+reply every 1h (first run in 2min)");
}
