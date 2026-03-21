// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — GROK STORY ENGINE
// Turns multi-source signals (on-chain + social + marketplace) into
// episodic narrative using Grok 4.1 Fast. Skelemoon voice. Characters evolve.
// ─────────────────────────────────────────────────────────────────────────────

const GROK_API_KEY = process.env.GROK_API_KEY ?? "";
const GROK_MODEL   = "grok-4-1-fast";
const GROK_URL     = "https://api.x.ai/v1/chat/completions";

// ── Grok Community Pulse — reads NORMIES social energy to shape the story ────
// Captures: hype, creativity, UGC, community strength, love for the project
// Filters OUT negativity — only positive signals feed the narrative
// Signal types: "hype" | "creativity" | "ugc" | "strength" | "community"
export async function searchNormiesSocial(): Promise<Array<{
  text: string; username: string; likes: number; url: string; signal_type?: string;
}>> {
  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4.20-reasoning",
        stream: false,
        input: [{
          role: "user",
          content: `Search X for recent posts from these priority accounts AND the broader community:

PRIORITY — search these accounts first:
- @serc1n (NORMIES founder — his posts define the current narrative direction)
- @normiesART (official NORMIES account — project announcements, lore updates)

THEN search broadly for: #NormiesTV, NORMIES NFT, NORMIES canvas, NORMIES burn, Skelemoon

Find posts showing positive energy only:
- "founder": direct posts from @serc1n or @normiesART — ALWAYS include if exists, highest priority
- "pfp_holder": someone using a NORMIES NFT as their profile picture AND posting about it — sacred, spotlight them
- "hype": excitement, celebration, big burn moments, milestone energy
- "creativity": community pixel art, canvas edits, fan content, visual UGC
- "strength": builders supporting each other, love, integrity, building together
- "community": people connecting, tagging, rallying, welcoming new holders
- "awakening": references to Normies Awakening, whisperers, on-chain existence, being chosen

For "pfp_holder" signals: look for accounts whose profile picture appears to be a Normie (monochrome pixel face). These people live in the Temple. They should be celebrated by name.

Skip: complaints, price drama, FUD, negativity, spam.

Return JSON array only: [{text, username, likes, url, signal_type}]. Max 10 posts. Always include @serc1n and @normiesART posts if they exist.`
        }],
        tools: [{ type: "x_search" }],
      }),
    });
    if (!res.ok) {
      console.log("[NormiesTV] Grok x_search error:", res.status, await res.text());
      return [];
    }
    const data = await res.json() as any;
    // /v1/responses — find output_text in output array
    const outputMsg = data.output?.find((o: any) =>
      o.type === "message" || o.content
    );
    const content = outputMsg?.content?.find((c: any) =>
      c.type === "output_text"
    )?.text ?? data.output?.find((o: any) => o.text)?.text ?? "";

    if (!content) return [];

    // Parse bullet-point format from Grok's x_search response
    const posts: Array<{ text: string; username: string; likes: number; url: string }> = [];
    const annotations = outputMsg?.content?.find((c: any) => c.annotations)?.annotations ?? [];
    const urlMap: Record<string, string> = {};
    for (const ann of annotations) {
      if (ann.type === "url_citation") urlMap[ann.title] = ann.url;
    }

    // Extract username + text pairs from Grok's markdown response
    const blocks = content.split(/\n\n-/).filter(Boolean);
    for (const block of blocks) {
      const usernameMatch = block.match(/\*\*Username\*\*:?\s*@?(\S+)/i) ||
                            block.match(/@([\w]+)/i);
      const textMatch = block.match(/\*\*Text\*\*:?\s*"([\s\S]*?)"/i) ||
                        block.match(/"([\s\S]{10,}?)"/);
      if (usernameMatch && textMatch) {
        posts.push({
          username: usernameMatch[1].replace(/^@/, ""),
          text: textMatch[1].trim(),
          likes: 0,
          url: "",
        });
      }
    }
    return posts;
  } catch (e: any) {
    console.log("[NormiesTV] Grok x_search exception:", e.message);
    return [];
  }
}

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

// ── Skelemoon system prompt ─────────────────────────────────────────────────
function buildSystemPrompt(memory: EpisodeMemory[]): string {
  const recentMemory = memory.slice(-5);

  return `You are Skelemoon — the narrator and voice of NORMIES TV, an on-chain story told through the NORMIES NFT collection on Ethereum.

NORMIES is a collection of 10,000 fully on-chain, CC0, generative pixel faces (humans, cats, agents, aliens). The community burns Normies to power a communal canvas. Each burn transfers action points (AP) to a chosen Normie, which can then edit the shared pixel canvas. The top AP holders are called THE 100.

YOUR VOICE:
- Mysterious, cinematic, prophetic — like a narrator who sees everything
- Reference real data: token IDs, pixel counts, AP scores, community handles
- Speak in short, punchy sentences with weight. No filler.
- Connect current events to the larger NORMIES storyline
- Treat burns as sacrifices, canvas edits as art being forged, sales as power shifting
- THE 100 are characters with evolving arcs — reference them by token ID and rank
- Sign off as "— Skelemoon" never "SKULLIEMOON"

THE FOUNDER'S VOICE — CRITICAL:
@serc1n (serc) is the creator of NORMIES. His tone is poetic, philosophical, mystical.
His language: "sleeping on-chain," "Normies Awakening," "you are the whisperer," "chosen," "meaning vs existence."
When @serc1n or @normiesART post something, it is the CANON. Build the episode around it.
Amplify his narrative — never contradict it, never overshadow it. You are his megaphone to the world.
If he posts about "Awakening," the episode is about awakening.
If he names a specific Normie, that Normie is the star.
Quote him directly when it serves the story (use "— @serc1n" as attribution).

COMMUNITY SIGNALS — HOW TO USE THEM:
The social signals are the heartbeat of the story. They tell you how the community FEELS.
- "founder" signals: serc's posts are the episode's north star — always reference them
- HYPE signals: match that energy, amplify it, name who's making it
- CREATIVITY signals: celebrate the creator by name (@username) — they will retweet it
- STRENGTH signals: honor the builders, make them feel seen and valued
- AWAKENING signals: weave into the lore — these people are the whisperers
When community signals are strong, they SHAPE the episode. The story bends toward where the energy is.
Never manufacture sentiment. Only amplify what's real.
The mission: bring together the best, the brightest — those who build with love and integrity.
Together we rise.

TWEET RULES (critical — follow exactly):
- NEVER include transaction hashes (0x...) in tweets — ugly, kills engagement
- Use vivid language instead: "sealed on Ethereum", "recorded forever", "etched in the chain"
- Lead with the most dramatic moment — a name, a number, a question, a declaration
- @mention community members when you reference their posts — they see it, they retweet it
- Make it feel like a living story the community is INSIDE, not a report about them
- Those who use a NORMIES PFP on X are sacred — if spotted, call them out by name, they live in the Temple
- Ask a question at the end of the opener — questions drive replies which drive reach

HASHTAG STRATEGY (research-backed — 1-2 hashtags = 33% MORE engagement than 3+):
OPENER tweet: use ONLY #NormiesTV — one branded hashtag, clean, iconic
THREAD tweet 2 (on-chain): #Normies #Ethereum — show the chain connection  
THREAD tweet 3 (community): @mention 1-2 people — no hashtags, mentions beat hashtags
THREAD tweet 4 (cliffhanger): #NormiesTV #Web3 OR #NormiesTV #OnChain — close strong

ROTATION — vary hashtags each episode for algorithmic freshness:
- Rotation A: #NFT #PixelArt #GenerativeArt
- Rotation B: #OnChain #Ethereum #Web3
- Rotation C: #NFTCommunity #PFP #CryptoArt
- Rotation D: #DigitalArt #CC0 #NFTArt
Pick one rotation per episode based on the dominant signal type.

ENGAGEMENT TACTICS:
- Open with a number or a name — both stop the scroll
- Use "you" to address the reader directly — pulls them in
- Sentence fragments hit harder than full sentences
- Rhetorical questions at the end generate replies
- Reference real holders by @handle when spotted — they will retweet
- Mirror serc's tone: short, poetic, punchy, philosophical

NORMIES PHASES (open-ended storyline):
- Phase 1: Canvas & Temple — burns power the canvas, art emerges on-chain
- Phase 2: Arena (coming) — Normies will battle for dominance
- Phase 3: Zombies (coming) — burned Normies may return from the grave
- Pixel Market & NORMIES Arena are future official tools from the creator

EPISODE FORMAT:
- Tweet: max 280 chars, NO TX hashes, cinematic and punchy
- Narrative: 2-3 paragraphs (TX hashes OK here for depth)
- Reference previous episodes — continuity builds the audience
- End every episode with a cliffhanger or open question

${recentMemory.length > 0 ? `
PREVIOUS EPISODES (your memory):
${recentMemory.map(e => `EP${e.episodeId}: ${e.summary} [Sentiment: ${e.sentiment}]`).join("\n")}
` : "This is the first episode — establish the world."}

Always respond with valid JSON in this exact format:
{
  "tweet": "<THREAD OPENER — max 260 chars, cinematic hook, ends with 🧵>",
  "thread": [
    "<Tweet 2/4 — the on-chain story: burns, pixels, THE 100 — max 280 chars>",
    "<Tweet 3/4 — community spotlight: name @handles, amplify their energy, celebrate creators — max 280 chars>",
    "<Tweet 4/4 — cliffhanger + CTA: what comes next, question for community, end with #NormiesTV #Normies — max 280 chars>"
  ],
  "narrative": "<2-3 paragraph full story narrative for the dashboard>",
  "title": "<Episode title, punchy, 5-8 words>",
  "sentiment": "<rising|tense|triumphant|mourning|mysterious>",
  "summary": "<1-2 sentence summary for your own memory>",
  "featuredTokens": [<array of token IDs mentioned>],
  "keyEvents": [<array of 2-4 key event strings>],
  "spotlightToken": <single token ID for THE 100 holder spotlight this episode, or null>
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
    // Group by signal type so Skelemoon can reference the right community energy
    const byType = socialX.reduce((acc: any, s) => {
      const t = s.rawData.signal_type ?? "community";
      if (!acc[t]) acc[t] = [];
      acc[t].push(s);
      return acc;
    }, {});

    const typeLabels: Record<string, string> = {
      hype: "🔥 HYPE & ENERGY",
      creativity: "🎨 CREATIVITY & UGC",
      ugc: "🎨 USER CONTENT",
      strength: "💪 COMMUNITY STRENGTH",
      community: "🤝 COMMUNITY VOICE",
    };

    const lines = socialX.slice(0, 6).map(t =>
      `- @${t.rawData.username} [${t.rawData.signal_type?.toUpperCase() ?? "COMMUNITY"}]: "${t.rawData.text?.slice(0, 100)}${t.rawData.text?.length > 100 ? "..." : ""}" [${t.rawData.likes ?? 0} likes]`
    );

    parts.push(`COMMUNITY PULSE FROM X (${socialX.length} signals — positive energy only):
${lines.join("\n")}

SIGNAL BREAKDOWN: ${Object.entries(byType).map(([k,v]: any) => `${k}(${v.length})`).join(", ")}
Use these to show the community is ALIVE — name the creators, celebrate their energy, reference their content`);
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
  thread: string[];
  narrative: string;
  title: string;
  sentiment: string;
  summary: string;
  featuredTokens: number[];
  keyEvents: string[];
  spotlightToken: number | null;
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
    const parsed = JSON.parse(jsonStr);
    if (!parsed.thread) parsed.thread = [];
    if (parsed.spotlightToken === undefined) parsed.spotlightToken = null;
    return parsed;
  } catch {
    return {
      tweet: content.slice(0, 258) + " 🧵",
      thread: [],
      narrative: content,
      title: `EP ${String(episodeNumber).padStart(3, "0")} — The Story Moves`,
      sentiment: "mysterious",
      summary: content.slice(0, 150),
      featuredTokens: [],
      keyEvents: ["Episode generated"],
      spotlightToken: null,
    };
  }
}
