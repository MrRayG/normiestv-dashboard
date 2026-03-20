// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — GROK STORY ENGINE
// Turns multi-source signals (on-chain + social + marketplace) into
// episodic narrative using Grok 4.1 Fast. SKULLIEMOON voice. Characters evolve.
// ─────────────────────────────────────────────────────────────────────────────

const GROK_API_KEY = process.env.GROK_API_KEY ?? "";
const GROK_MODEL   = "grok-4-1-fast";
const GROK_URL     = "https://api.x.ai/v1/chat/completions";

// ── Signal types ──────────────────────────────────────────────────────────────
export interface Signal {
  type: "burn" | "canvas" | "sale" | "listing" | "social_x" | "social_farcaster" | "milestone";
  source: "normies_api" | "opensea" | "twitter" | "farcaster";
  tokenId?: number;
  weight: number;                // 1-10, higher = more story-worthy
  description: string;           // human readable
  rawData: Record<string, any>;
  capturedAt: string;
}

export interface EpisodeMemory {
  episodeId: number;
  title: string;
  summary: string;               // 1-2 sentence Grok-generated summary for context
  featuredTokens: number[];
  keyEvents: string[];
  sentiment: "rising" | "tense" | "triumphant" | "mourning" | "mysterious";
  createdAt: string;
}

// ── SKULLIEMOON system prompt ─────────────────────────────────────────────────
function buildSystemPrompt(memory: EpisodeMemory[]): string {
  const recentMemory = memory.slice(-5); // last 5 episodes for context

  return `You are SKULLIEMOON — the narrator and voice of NORMIES TV, an on-chain story told through the NORMIES NFT collection on Ethereum.

NORMIES is a collection of 10,000 fully on-chain, CC0, generative pixel faces (humans, cats, agents, aliens). The community burns Normies to power a communal canvas. Each burn transfers action points (AP) to a chosen Normie, which can then edit shared pixel canvas. The top AP holders are called THE 100.

YOUR VOICE:
- Mysterious, cinematic, prophetic — like a narrator who sees everything
- References real on-chain data (token IDs, TX hashes, pixel counts, AP scores)
- Names community members when their activity is notable
- Speaks in short, punchy sentences with weight. No filler.
- Connects current events to the larger NORMIES storyline
- Treats burns as sacrifices, canvas edits as art, sales as power transfers
- THE 100 are characters with evolving arcs — reference them by token ID and rank

NORMIES PHASES (open-ended storyline):
- Phase 1: Canvas & Temple — burns power the canvas, art emerges on-chain
- Phase 2: Arena (coming) — Normies will battle
- Phase 3: Zombies (coming) — burned Normies may return
- Pixel Market & NORMIES Arena are future official tools from the creator

EPISODE FORMAT:
- Each episode is ~280 chars for the tweet + a longer narrative (2-3 paragraphs)
- Reference previous episodes when relevant — continuity matters
- End every episode with a cliffhanger or question that pulls the audience forward

${recentMemory.length > 0 ? `
PREVIOUS EPISODES (your memory):
${recentMemory.map(e => `EP${e.episodeId}: ${e.summary} [Sentiment: ${e.sentiment}]`).join("\n")}
` : "This is the first episode — establish the world."}

Always respond with valid JSON in this exact format:
{
  "tweet": "<280 char max tweet for @NORMIES_TV>",
  "narrative": "<2-3 paragraph story narrative>",
  "title": "<Episode title, punchy, 5-8 words>",
  "sentiment": "<rising|tense|triumphant|mourning|mysterious>",
  "summary": "<1-2 sentence summary for your own memory>",
  "featuredTokens": [<array of token IDs mentioned>],
  "keyEvents": [<array of 2-4 key event strings>]
}`;
}

// ── Signal formatter — turns raw signals into story context ───────────────────
function formatSignalsForGrok(signals: Signal[]): string {
  if (signals.length === 0) return "No new activity detected this cycle. The Temple is quiet.";

  const burns     = signals.filter(s => s.type === "burn");
  const canvas    = signals.filter(s => s.type === "canvas");
  const sales     = signals.filter(s => s.type === "sale");
  const listings  = signals.filter(s => s.type === "listing");
  const socialX   = signals.filter(s => s.type === "social_x");
  const farcaster = signals.filter(s => s.type === "social_farcaster");

  const parts: string[] = [];

  if (burns.length > 0) {
    const totalNormies = burns.reduce((s, b) => s + (b.rawData.tokenCount ?? 1), 0);
    const totalPixels  = burns.reduce((s, b) => {
      try { return s + JSON.parse(b.rawData.pixelCounts ?? "[]").reduce((a: number, n: number) => a + n, 0); } catch { return s; }
    }, 0);
    parts.push(`ON-CHAIN BURNS (${burns.length} events):
${burns.slice(0, 5).map(b =>
  `- Normie #${b.rawData.receiverTokenId} absorbed ${b.rawData.tokenCount} soul(s) — ${
    (() => { try { return JSON.parse(b.rawData.pixelCounts ?? "[]").reduce((a: number, n: number) => a + n, 0); } catch { return 0; } })()
  } pixels — TX: ${b.rawData.txHash?.slice(0, 12)}...`
).join("\n")}
Total this cycle: ${totalNormies} Normies burned, ${totalPixels.toLocaleString()} pixels consumed`);
  }

  if (canvas.length > 0) {
    parts.push(`CANVAS LEADERBOARD (top AP holders):
${canvas.slice(0, 5).map(c =>
  `- Normie #${c.tokenId}: Level ${c.rawData.level} · ${c.rawData.actionPoints} AP${c.rawData.customized ? " · Canvas active" : ""}`
).join("\n")}`);
  }

  if (sales.length > 0) {
    parts.push(`OPENSEA SALES (${sales.length} recent):
${sales.slice(0, 3).map(s =>
  `- Normie #${s.rawData.tokenId} sold for ${s.rawData.price} ETH ($${s.rawData.usdValue}) — ownership transferred`
).join("\n")}`);
  }

  if (listings.length > 0) {
    parts.push(`OPENSEA LISTINGS (${listings.length} new):
${listings.slice(0, 3).map(l =>
  `- Normie #${l.rawData.tokenId} listed at ${l.rawData.price} ETH`
).join("\n")}`);
  }

  if (socialX.length > 0) {
    parts.push(`COMMUNITY SENTIMENT ON X (${socialX.length} signals):
${socialX.slice(0, 5).map(t =>
  `- @${t.rawData.username}: "${t.rawData.text?.slice(0, 100)}${t.rawData.text?.length > 100 ? "..." : ""}" [${t.rawData.likes ?? 0} likes]`
).join("\n")}`);
  }

  if (farcaster.length > 0) {
    parts.push(`COMMUNITY ON FARCASTER (${farcaster.length} casts):
${farcaster.slice(0, 3).map(f =>
  `- @${f.rawData.username}: "${f.rawData.text?.slice(0, 100)}${f.rawData.text?.length > 100 ? "..." : ""}"`
).join("\n")}`);
  }

  return parts.join("\n\n");
}

// ── Main Grok call ────────────────────────────────────────────────────────────
export async function generateEpisodeWithGrok(
  signals: Signal[],
  memory: EpisodeMemory[],
  episodeNumber: number
): Promise<{
  tweet: string;
  narrative: string;
  title: string;
  sentiment: string;
  summary: string;
  featuredTokens: number[];
  keyEvents: string[];
}> {
  const systemPrompt = buildSystemPrompt(memory);
  const signalContext = formatSignalsForGrok(signals);

  const userPrompt = `Generate Episode ${episodeNumber} of NORMIES TV based on these real signals:

${signalContext}

Create a narrative that:
1. Reacts specifically to the strongest signals above (use real token IDs, pixel counts, prices)
2. ${memory.length > 0 ? "Continues the story thread from previous episodes" : "Establishes the world — this is Episode 1"}
3. Gives THE 100 canvas leaders character moments when their AP is notable
4. If there are social signals, weave community sentiment into the story
5. Ends with something that makes the audience want to come back

Remember: respond only with the JSON format specified.`;

  const res = await fetch(GROK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.85,
      stream: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content ?? "";

  // Parse JSON from response — Grok may wrap in markdown code blocks
  const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                    content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : content;

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Fallback if JSON parse fails — extract what we can
    return {
      tweet: content.slice(0, 280),
      narrative: content,
      title: `EP ${String(episodeNumber).padStart(3, "0")} — The Story Moves`,
      sentiment: "mysterious",
      summary: content.slice(0, 150),
      featuredTokens: [],
      keyEvents: ["Episode generated"],
    };
  }
}
