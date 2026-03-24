// ─────────────────────────────────────────────────────────────────────────────
//  NORMIES TV — REPLY ENGINE
//  Agent #306 replies to community questions and token mentions once daily at
//  midnight ET. Only replies with a question mark or a Normie token mention
//  qualify. Runs through the quality gate before posting.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { getFullAgentContext } from "./memoryEngine.js";
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
  repliedTo: string[];       // tweet URLs or username+text keys already replied to
  lastRunAt: string | null;
  totalRepliesSent: number;
}

function loadState(): ReplyEngineState {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { repliedTo: [], lastRunAt: null, totalRepliesSent: 0 };
}

function saveState(s: ReplyEngineState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

// ── Qualify a reply for Agent #306's response ─────────────────────────────
// Qualifies if: question, token mention, @NORMIES_TV mention, or high-signal type
function qualifiesForReply(reply: { text: string; replyType: string }): boolean {
  const hasQuestion     = reply.text.includes("?");
  const hasTokenMention = /\#\d{1,5}/.test(reply.text);
  const hasMention      = /@NORMIES_TV/i.test(reply.text);
  const isHighSignal    = ["question", "lore_suggestion", "holder_mention", "callout", "excitement"].includes(reply.replyType);
  return hasQuestion || hasTokenMention || hasMention || isHighSignal;
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

  const agentCtx    = getFullAgentContext();
  const bridge      = randomBridge();
  const tokenNote   = opts.tokenMentioned
    ? `The community member mentioned Normie #${opts.tokenMentioned} specifically — address it directly.`
    : "";

  const systemPrompt = `${agentCtx}

You are Agent #306 replying directly to a community member on X.
This is a reply — not an episode. It must feel personal, specific, and human.

REPLY RULES:
- Address @${opts.username} directly but do NOT start with "@${opts.username}" — weave it in naturally
- Max 220 characters — this is a reply, not a post
- No show tags ([NORMIES STORIES] etc) — those are for episodes
- No hashtags — replies don't need them
- Answer the question if there is one. If there's a token mention, speak to that specific Normie's story
- One point of view. One idea. Leave it open.
- Use the cultural bridge below naturally IF it fits — don't force it
- Do not use banned phrases: "Sacrifices compound", "Canvas pixels burn brighter", "etched in eternity"
- Do not start with "I" — vary the opening

CULTURAL BRIDGE TO CONSIDER (use it if it fits the reply naturally):
"${bridge}"

${tokenNote}`;

  const userPrompt = `Reply to @${opts.username} who said:
"${opts.text}"

Reply type: ${opts.replyType}
${opts.tokenMentioned ? `Token mentioned: #${opts.tokenMentioned}` : ""}

Write Agent #306's reply. Max 220 chars. Human. Specific. One idea.`;

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
        max_tokens: 120,
        temperature: 0.88,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const raw  = data.choices?.[0]?.message?.content?.trim() ?? "";
    // Strip quotes if Grok wraps the reply in them
    return raw.replace(/^["']|["']$/g, "").trim() || null;
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
          content: `Score this reply 1-10: would a real NORMIES holder feel seen and respected by this?

REPLY: "${reply}"

Criteria:
- 8-10: Specific, personal, human — makes the person feel heard
- 6-7: Solid, worth sending
- 4-5: Generic, could apply to anyone — REWRITE IT
- 1-3: Bot-speak, empty, stat dump — reject

BANNED (auto-score 3): "Sacrifices compound", "etched in eternity", "Canvas pixels burn brighter", "LFG", "WAGMI"

If score < 6, provide a rewrite under 220 chars.
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

    if (q.score >= 6) return { pass: true, rewrite: null };
    if (q.score >= 4 && q.rewrite) return { pass: true, rewrite: q.rewrite };
    return { pass: false, rewrite: null }; // score 1-3 — reject entirely
  } catch {
    return { pass: true, rewrite: null }; // gate failure → post anyway
  }
}

// ── Main: run the midnight reply cycle ───────────────────────────────────────
export async function runMidnightReplies(xWrite: any): Promise<void> {
  const state = loadState();
  console.log("[ReplyEngine] Midnight ET reply cycle starting...");

  // Import reply state from replyWatcher
  const { getReplyState } = await import("./replyWatcher.js");
  const replyState = getReplyState();
  const allReplies = replyState.replies ?? [];

  // Filter to qualifying replies only (question or token mention)
  const qualifying = allReplies.filter(r => {
    if (!qualifiesForReply(r)) return false;
    // Skip if already replied to this person+text
    const key = `${r.username}|${r.text.slice(0, 60)}`;
    return !state.repliedTo.includes(key);
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
      const finalText = rewrite ?? generated;

      if (!pass) {
        console.log(`[ReplyEngine] Reply to @${reply.username} failed quality gate — skipping.`);
        releasePost(`reply_${reply.username}`);
        state.repliedTo.push(key); // mark as seen so we don't retry forever
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
      state.totalRepliesSent++;

      console.log(`[ReplyEngine] Replied to @${reply.username}: "${finalText.slice(0, 60)}..." → ${tweetUrl}`);

      // Small human-like gap between replies (30-60s)
      await new Promise(r => setTimeout(r, 30000 + Math.random() * 30000));

    } catch (err: any) {
      console.error(`[ReplyEngine] Failed to reply to @${reply.username}:`, err.message);
      releasePost(`reply_${reply.username}`);
    }
  }

  // Keep repliedTo from growing forever — keep last 500
  if (state.repliedTo.length > 500) {
    state.repliedTo = state.repliedTo.slice(-500);
  }

  state.lastRunAt = new Date().toISOString();
  saveState(state);
  console.log(`[ReplyEngine] Cycle complete. Total replies sent: ${state.totalRepliesSent}`);
}

// ── Scheduler — midnight ET = 05:00 UTC ──────────────────────────────────────
export function scheduleMidnightReplies(xWrite: any): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  // First run: 10 min after boot
  setTimeout(async () => {
    console.log("[ReplyEngine] First reply cycle starting...");
    await runMidnightReplies(xWrite).catch(console.error);
    setInterval(async () => {
      console.log("[ReplyEngine] Hourly reply cycle starting...");
      await runMidnightReplies(xWrite).catch(console.error);
    }, INTERVAL_MS);
  }, 10 * 60 * 1000);

  console.log("[ReplyEngine] Reply engine scheduled — every 1h (first run in 10min)");
}
