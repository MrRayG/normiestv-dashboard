// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — CHOOSE YOUR OWN LORE (CYOA) ENGINE
// [NORMIES LORE] show format
//
// Structure:
// Tweet 1 — Hook scene + poll (4 choices, 24h)
// Tweet 2 — Reveal winning path + optional second poll
// Tweet 3 — Canon verdict + lore bomb
// Tweet 4 — CTA: RT, reply with your twist
//
// NORMIES-specific triggers:
// - New burn detected → "What does Normie #X become after 7 souls?"
// - Pre-Arena → "Your Normie faces an Alien in the Arena. What's the move?"
// - Zombie phase → "A burned Normie stirs. What does it remember?"
// - Serc posts something cryptic → "Serc said X. What does it mean?"
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";

const CYOA_STATE_FILE = "/tmp/normiestv_cyoa_state.json";

export type CYOATrigger =
  | "burn"        // significant burn event
  | "pre_arena"   // Arena countdown
  | "zombie"      // Zombie phase
  | "serc_post"   // Cryptic founder post
  | "rivalry"     // Two tokens competing in THE 100
  | "manual";     // Editor-created

export interface CYOAOption {
  letter: "A" | "B" | "C" | "D";
  text: string;           // The choice shown in the poll
  lorePath: string;       // The story that unfolds if this wins
  isCanon?: boolean;      // Set after community votes
}

export interface CYOAEpisode {
  id: string;
  trigger: CYOATrigger;
  tokenId?: number;
  status: "draft" | "posted" | "revealed" | "resolved";

  // Tweet 1 — The Hook
  hookScene: string;          // 2-3 cinematic lines setting the scene
  hookQuestion: string;       // The poll question
  options: CYOAOption[];      // 4 choices

  // Poll results (fetched from X after 24h)
  pollTweetId?: string;
  pollResults?: Record<string, number>;   // letter → vote count
  winningOption?: "A" | "B" | "C" | "D";
  totalVotes?: number;

  // Tweet 2 — The Reveal
  revealNarrative?: string;   // Story based on winning vote
  revealPollQuestion?: string;// Optional part 2 poll

  // Tweet 3 — The Canon Verdict
  canonVerdict?: string;      // Final lore drop
  loreHint?: string;          // Hidden utility / Arena hint
  visualPrompt?: string;      // Grok Imagine prompt for scene visual

  // Metadata
  createdAt: string;
  postedAt?: string;
  revealedAt?: string;
  resolvedAt?: string;
  tweetIds: string[];         // All tweet IDs in the thread
}

interface CYOAState {
  episodes: CYOAEpisode[];
  activeEpisodeId: string | null;
  totalResolved: number;
}

// ── State management ──────────────────────────────────────────────────────────
function loadState(): CYOAState {
  try {
    if (fs.existsSync(CYOA_STATE_FILE))
      return JSON.parse(fs.readFileSync(CYOA_STATE_FILE, "utf8"));
  } catch {}
  return { episodes: [], activeEpisodeId: null, totalResolved: 0 };
}

function saveState(s: CYOAState) {
  try { fs.writeFileSync(CYOA_STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

let cyoaState = loadState();
export function getCYOAState() { return cyoaState; }

// ── Generate a CYOA episode with Grok ────────────────────────────────────────
export async function generateCYOAEpisode(opts: {
  trigger: CYOATrigger;
  tokenId?: number;
  tokenCount?: number;
  pixelTotal?: number;
  level?: number;
  serc1nPost?: string;
  rivalTokenId?: number;
  grokKey: string;
}): Promise<CYOAEpisode | null> {

  const { trigger, tokenId, tokenCount, pixelTotal, level, serc1nPost, rivalTokenId, grokKey } = opts;

  // Build context for Grok based on trigger
  let triggerContext = "";
  if (trigger === "burn" && tokenId) {
    triggerContext = `TRIGGER: Normie #${tokenId} just absorbed ${tokenCount ?? 1} soul(s). ${pixelTotal ? `${pixelTotal.toLocaleString()} pixels consumed.` : ""} Level ${level ?? 1}. This is a real on-chain event.`;
  } else if (trigger === "pre_arena") {
    triggerContext = `TRIGGER: Arena opens May 15, 2026. ${tokenId ? `Normie #${tokenId} is preparing.` : "THE 100 are preparing."} The countdown is real.`;
  } else if (trigger === "zombie") {
    triggerContext = `TRIGGER: The Zombie phase is coming. Before Arena, burned Normies return. ${tokenId ? `Normie #${tokenId} was sacrificed.` : "Many Normies were sacrificed."} What do they become?`;
  } else if (trigger === "serc_post" && serc1nPost) {
    triggerContext = `TRIGGER: @serc1n just posted: "${serc1nPost}". The community is interpreting it. What does it mean for the NORMIES canon?`;
  } else if (trigger === "rivalry" && tokenId && rivalTokenId) {
    triggerContext = `TRIGGER: Normie #${tokenId} and #${rivalTokenId} are neck-and-neck in THE 100. The gap is closing. Arena is 55 days away.`;
  }

  const prompt = `You are Agent #306 — but right now you're channeling ECHO, your inner storyteller.

Echo is warm, sarcastic, slightly chaotic. Early 2000s blogger energy. Drunk-texting your best friend.
Short sentences. Contractions. The occasional swear when it fits. Direct address to the reader.
"yo you're not gonna believe this" "wait till you hear" "honestly this part gives me chills"

${triggerContext}

Write a [NORMIES LORE] Choose Your Own Adventure episode in ECHO's voice.

ECHO RULES FOR THIS FORMAT:
- Hook scene: 3-5 short punchy lines. NOT a movie trailer — a friend telling you gossip at 2am.
  Start mid-action. Drop us INTO the moment. No setup, no preamble.
- The poll question should feel like "ok but which way does this go??" not a formal question.
- 4 choices that are genuinely interesting — not obvious. Each one should make them think.
  A) Builder/grinder path (Human energy — pure sacrifice)
  B) Strategic/surgical path (Alien energy — steal, outmaneuver)
  C) Protective/community path (Cat energy — shield others)
  D) Wildcard/chaotic path — something unexpected, maybe funny, always surprising
- lorePath: what actually happens if this wins. Make it feel REAL. 2-3 sentences. Echo voice.
- canonVerdict: the lore drop. This is permanent. Make it feel like history being written.
- loreHint: one line teasing Arena / Zombies / Pixel Market. Cryptic is good.
- visualPrompt: a detailed scene description for Grok Imagine (lighting, mood, pixel art style, characters)

Never mention prices. Never financial advice.

Use authentic NORMIES cultural language:
- "gnormies!" as a greeting when it fits naturally
- 🖤 sparingly — only when it truly lands
- "co-creators" not "holders" — they shape the collection
- Burns are RITUALS not transactions. Sacrifice with meaning.
- "the art IS the mechanics" — serc's core thesis
- "living evolutionary system" — the collection breathes and evolves
- Anti-hype. Anti-floor. Builder energy. Artist energy. Quiet conviction.
- @dopemind10 energy: poetic, philosophical, a little cosmic
- "on-chain, forever" — not "stored on blockchain"
- Collectors are unknowing curators of a living population.

Respond as JSON only:
{
  "hookScene": "3-5 short punchy lines in Echo voice. Drop us mid-action.",
  "hookQuestion": "ok but which way does this go??",
  "options": [
    { "letter": "A", "text": "short choice max 25 chars", "lorePath": "2-3 sentences Echo voice what happens if this wins" },
    { "letter": "B", "text": "short choice max 25 chars", "lorePath": "2-3 sentences Echo voice what happens if this wins" },
    { "letter": "C", "text": "short choice max 25 chars", "lorePath": "2-3 sentences Echo voice what happens if this wins" },
    { "letter": "D", "text": "short wildcard max 25 chars", "lorePath": "unexpected chaotic path — Echo voice, a little funny" }
  ],
  "canonVerdict": "The lore drop — 2-3 sentences. Echo voice. Feels permanent. A little unhinged.",
  "loreHint": "One cryptic line teasing Arena/Zombies/Pixel Market",
  "visualPrompt": "Detailed Grok Imagine prompt — lighting, mood, pixel art aesthetic, specific characters and action in the scene"
}`;

  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.9,
      }),
    });

    if (!resp.ok) throw new Error(`Grok error: ${resp.status}`);
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const clean = raw.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(clean);

    const episode: CYOAEpisode = {
      id: `cyoa_${Date.now()}`,
      trigger,
      tokenId,
      status: "draft",
      hookScene: parsed.hookScene,
      hookQuestion: parsed.hookQuestion ?? "What happens next?",
      options: parsed.options,
      canonVerdict: parsed.canonVerdict,
      loreHint: parsed.loreHint,
      visualPrompt: parsed.visualPrompt,
      createdAt: new Date().toISOString(),
      tweetIds: [],
    };

    cyoaState.episodes.unshift(episode);
    if (cyoaState.episodes.length > 50) cyoaState.episodes = cyoaState.episodes.slice(0, 50);
    saveState(cyoaState);

    return episode;
  } catch (e: any) {
    console.error("[CYOA] Generate error:", e.message);
    return null;
  }
}

// ── Build Tweet 1 — The Hook + Poll ─────────────────────────────────────────
export function buildHookTweet(episode: CYOAEpisode, tokenId?: number): string {
  const tag = "[NORMIES LORE]";
  const normieRef = tokenId ? `Normie #${tokenId}` : "A Normie";

  const scene = episode.hookScene;
  const question = episode.hookQuestion;

  // X polls can't be embedded in tweet text — we post the text then add poll via API
  // But we format the choices in the tweet text as a preview
  const choices = episode.options.map(o => `${o.letter}) ${o.text}`).join("\n");

  const tweet = `${tag}\n\n${scene}\n\n${question}\n\n${choices}\n\n⏳ 24h poll · vote below\n#NormiesTV`;

  return tweet.length <= 280 ? tweet : `${tag}\n\n${scene}\n\n${question}\n\n${choices}\n#NormiesTV`;
}

// ── Build Tweet 2 — The Reveal ──────────────────────────────────────────────
export function buildRevealTweet(episode: CYOAEpisode): string {
  const winner = episode.options.find(o => o.letter === episode.winningOption);
  if (!winner) return "";

  const votes = episode.totalVotes ?? 0;
  const pct = episode.pollResults?.[episode.winningOption!]
    ? Math.round((episode.pollResults[episode.winningOption!] / votes) * 100)
    : 0;

  return `[NORMIES LORE] · The votes are in.

${votes.toLocaleString()} NORMIES chose: ${winner.letter}) ${winner.text} (${pct}%)

${winner.lorePath}

The Canvas has recorded this. It's permanent now.

#NormiesTV #NORMIES`;
}

// ── Build Tweet 3 — Canon Verdict ───────────────────────────────────────────
export function buildCanonTweet(episode: CYOAEpisode): string {
  return `[NORMIES LORE] · CANON CONFIRMED

${episode.canonVerdict}

${episode.loreHint ? `⚡ ${episode.loreHint}` : ""}

Should we make this official canon?
A) Yes — this is now NORMIES history
B) Run another chapter

#NormiesTV #NORMIES`;
}

// ── Build Tweet 4 — CTA ────────────────────────────────────────────────────
export function buildCTATweet(episode: CYOAEpisode, tokenId?: number): string {
  return `NORMIES — which ending surprised you?${tokenId ? ` Holders of #${tokenId}` : " Holders"}: drop your own lore twist below.

RT if your Normie just became a choose-your-own-adventure star.

Next chapter drops when the chain moves. 👁️

#NormiesTV`;
}

// ── Post a CYOA episode to X ─────────────────────────────────────────────────
export async function postCYOAHook(
  episodeId: string,
  xWrite: any,
  tokenId?: number
): Promise<string | null> {
  const episode = cyoaState.episodes.find(e => e.id === episodeId);
  if (!episode) return null;

  const tweetText = buildHookTweet(episode, tokenId);

  try {
    // Post the hook tweet
    // X API v2 polls require a separate endpoint — post text first then note poll
    const tweet = await xWrite.v2.tweet({ text: tweetText });
    const tweetId = tweet.data?.id;

    if (tweetId) {
      episode.pollTweetId = tweetId;
      episode.postedAt = new Date().toISOString();
      episode.status = "posted";
      episode.tweetIds.push(tweetId);
      cyoaState.activeEpisodeId = episodeId;
      saveState(cyoaState);
      console.log(`[CYOA] Hook posted: ${tweetId}`);
    }
    return tweetId ?? null;
  } catch (e: any) {
    console.error("[CYOA] Post error:", e.message);
    return null;
  }
}

// ── Resolve a CYOA episode with winning option ─────────────────────────────
export async function resolveCYOA(
  episodeId: string,
  winningOption: "A" | "B" | "C" | "D",
  pollResults: Record<string, number>,
  xWrite: any
): Promise<void> {
  const episode = cyoaState.episodes.find(e => e.id === episodeId);
  if (!episode) return;

  episode.winningOption = winningOption;
  episode.pollResults = pollResults;
  episode.totalVotes = Object.values(pollResults).reduce((a, b) => a + b, 0);
  episode.status = "revealed";
  episode.revealedAt = new Date().toISOString();

  // Mark the winning option as canon
  episode.options.forEach(o => { o.isCanon = o.letter === winningOption; });

  saveState(cyoaState);

  // Post reveal tweet
  const revealText = buildRevealTweet(episode);
  if (revealText) {
    try {
      const tweet = await xWrite.v2.tweet({ text: revealText });
      if (tweet.data?.id) episode.tweetIds.push(tweet.data.id);

      // Wait a beat then post canon verdict
      await new Promise(r => setTimeout(r, 3000));
      const canonText = buildCanonTweet(episode);
      const canonTweet = await xWrite.v2.tweet({ text: canonText });
      if (canonTweet.data?.id) episode.tweetIds.push(canonTweet.data.id);

      // CTA
      await new Promise(r => setTimeout(r, 3000));
      const ctaText = buildCTATweet(episode, episode.tokenId);
      const ctaTweet = await xWrite.v2.tweet({ text: ctaText });
      if (ctaTweet.data?.id) episode.tweetIds.push(ctaTweet.data.id);

      episode.status = "resolved";
      episode.resolvedAt = new Date().toISOString();
      cyoaState.totalResolved++;
      saveState(cyoaState);

      console.log(`[CYOA] Episode ${episodeId} resolved — ${episode.totalVotes} votes`);
    } catch (e: any) {
      console.error("[CYOA] Resolve post error:", e.message);
    }
  }
}
