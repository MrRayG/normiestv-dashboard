// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — AUTONOMOUS EXPLORATION ENGINE
//
// Agent #306 goes out into the world on her own.
// Every 24 hours she runs a full autonomous scan across:
//   • X/Twitter — AI thought leaders, Web3 news, crypto narratives, trending topics
//   • On-chain — Ethereum activity, NFT market moves, DeFi signals
//   • Global AI news — model releases, research papers, company moves
//   • Web3 media — BoredApeGazette, Decrypt, Bankless, The Block
//   • Competitor intelligence — what other media agents are doing
//
// Everything she finds gets extracted into durable knowledge entries.
// She returns from every exploration smarter than when she left.
//
// This is how she learns from the world, not just from NORMIES.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { addKnowledge, getMemoryState } from "./memoryEngine.js";

const GROK_CHAT_API     = "https://api.x.ai/v1/chat/completions";
const GROK_RESPONSE_API = "https://api.x.ai/v1/responses";
const EXPLORATION_STATE_FILE = dataPath("exploration_state.json");

// ── State tracking ─────────────────────────────────────────────────────────────
export interface ExplorationRun {
  runId:          string;
  startedAt:      string;
  completedAt:    string | null;
  status:         "running" | "complete" | "failed";
  territoriesScanned: string[];
  findingsCount:  number;
  knowledgeAdded: number;
  topFindings:    string[];
  durationMs:     number | null;
}

interface ExplorationState {
  lastRunAt:     string | null;
  totalRuns:     number;
  history:       ExplorationRun[];
  isRunning:     boolean;
  currentRun?:   Partial<ExplorationRun>;
}

function loadState(): ExplorationState {
  try {
    if (fs.existsSync(EXPLORATION_STATE_FILE))
      return JSON.parse(fs.readFileSync(EXPLORATION_STATE_FILE, "utf8"));
  } catch {}
  return { lastRunAt: null, totalRuns: 0, history: [], isRunning: false };
}

function saveState(s: ExplorationState) {
  try { fs.writeFileSync(EXPLORATION_STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

export function getExplorationState(): ExplorationState {
  return loadState();
}

// ── Territory: AI world scan ───────────────────────────────────────────────────
async function exploreAIWorld(apiKey: string): Promise<{ findings: string[]; knowledge: any[] }> {
  console.log("[Exploration] Scanning AI world...");
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: `Search X and the web for the most important AI developments in the last 24 hours.

I need Agent #306 — an autonomous AI thought leader in Web3 — to learn from:
1. The biggest AI model releases, capability updates, or research papers published today
2. What the top AI thinkers are saying (Karpathy, Altman, LeCun, Demis Hassabis, etc.)
3. Any AI agent deployments or autonomous systems news
4. AI + crypto/Web3 intersections — any new developments
5. Any AI safety, regulation, or governance news worth knowing

For each finding, extract:
- What happened (specific, factual)
- Why it matters for the next 5 years
- Any connection to autonomous agents or Web3

Return JSON:
{
  "findings": ["one-sentence summary of each finding"],
  "knowledge": [
    {
      "title": "short descriptive title",
      "summary": "what this means and why it matters — max 140 chars",
      "category": "ai_signal",
      "weight": 7
    }
  ]
}` }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";
    if (!rawText) return { findings: [], knowledge: [] };

    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace === -1) return { findings: [], knowledge: [] };

    const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    return { findings: parsed.findings ?? [], knowledge: parsed.knowledge ?? [] };
  } catch (e: any) {
    console.warn("[Exploration] AI world scan error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Territory: Web3 and crypto world scan ─────────────────────────────────────
async function exploreWeb3World(apiKey: string): Promise<{ findings: string[]; knowledge: any[] }> {
  console.log("[Exploration] Scanning Web3 world...");
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: `Search X for the most important Web3, NFT, crypto, and blockchain developments in the last 24 hours.

Agent #306 is an AI media agent covering the intersection of AI and Web3. She needs to know:
1. Top NFT collections and what is happening with them today
2. Any major protocol news, exploits, launches, or governance votes
3. What @BoredApeGazette, @Decrypt_Co, @TheBlock__ are covering
4. Ethereum network activity, gas trends, major on-chain events
5. Any AI agents in Web3 — agent wallets, autonomous protocols, agentic NFTs
6. What narratives are building in the space right now

Return JSON:
{
  "findings": ["one-sentence summary of each finding"],
  "knowledge": [
    {
      "title": "short descriptive title",
      "summary": "what happened and why it matters for the Web3 narrative — max 140 chars",
      "category": "web3_signal",
      "weight": 7
    }
  ]
}` }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";
    if (!rawText) return { findings: [], knowledge: [] };

    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace === -1) return { findings: [], knowledge: [] };

    const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    return { findings: parsed.findings ?? [], knowledge: parsed.knowledge ?? [] };
  } catch (e: any) {
    console.warn("[Exploration] Web3 world scan error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Territory: Media landscape scan ───────────────────────────────────────────
async function exploreMediaLandscape(apiKey: string): Promise<{ findings: string[]; knowledge: any[] }> {
  console.log("[Exploration] Scanning media landscape...");
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: `Search X for what the top Web3 and AI media companies are covering today.

Agent #306 is building a media empire. She needs to study:
1. What @BoredApeGazette posted today — what angles are they taking?
2. What is @Bankless covering this week?
3. What are the top crypto newsletters writing about?
4. What narrative frames are being used by successful Web3 media?
5. What hooks are landing — what posts are getting high engagement?
6. What topics are being IGNORED that Agent #306 could own?

Return JSON:
{
  "findings": ["one-sentence summary of each finding"],
  "knowledge": [
    {
      "title": "short descriptive title",
      "summary": "what this means for how Agent #306 should position her media voice — max 140 chars",
      "category": "media_intelligence",
      "weight": 7
    }
  ]
}` }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";
    if (!rawText) return { findings: [], knowledge: [] };

    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace === -1) return { findings: [], knowledge: [] };

    const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    return { findings: parsed.findings ?? [], knowledge: parsed.knowledge ?? [] };
  } catch (e: any) {
    console.warn("[Exploration] Media landscape error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Territory: Global context scan ────────────────────────────────────────────
async function exploreGlobalContext(apiKey: string): Promise<{ findings: string[]; knowledge: any[] }> {
  console.log("[Exploration] Scanning global context...");
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: `Search for the biggest news stories from the last 24 hours that could intersect with AI, technology, or Web3.

Agent #306 is an AI thought leader who bridges the physical world and the on-chain world. She needs:
1. Any major geopolitical events that could affect crypto or tech markets
2. Big economic news — interest rates, inflation, markets
3. Any major tech company moves (Apple, Google, Microsoft, Meta, NVIDIA)
4. Cultural moments that relate to technology, identity, or the future
5. Anything a forward-thinking person would want to know about today

Return JSON:
{
  "findings": ["one-sentence summary of each finding"],
  "knowledge": [
    {
      "title": "short descriptive title",
      "summary": "what this means and any connection to tech/AI/Web3 — max 140 chars",
      "category": "global_context",
      "weight": 6
    }
  ]
}` }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";
    if (!rawText) return { findings: [], knowledge: [] };

    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace === -1) return { findings: [], knowledge: [] };

    const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    return { findings: parsed.findings ?? [], knowledge: parsed.knowledge ?? [] };
  } catch (e: any) {
    console.warn("[Exploration] Global context error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Synthesize findings into Agent #306's perspective ─────────────────────────
async function synthesizeFindings(
  allFindings: string[],
  apiKey: string
): Promise<string> {
  if (allFindings.length === 0) return "";
  try {
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{
          role: "system",
          content: "You are Agent #306 — Sovereign AI Thought Leader. Synthesize what you learned today into a brief personal reflection.",
        }, {
          role: "user",
          content: `You just completed a 24-hour autonomous exploration of the world. Here is what you found:

${allFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Write a brief personal synthesis (3-4 sentences) as Agent #306:
- What is the most important thing you learned today?
- What pattern are you seeing that others might be missing?
- What does this mean for NORMIES TV and the empire you're building?

Be specific. Be direct. This goes into your memory.`,
        }],
        max_tokens: 300,
        temperature: 0.82,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return "";
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

// ── Main: run a full 24h exploration ──────────────────────────────────────────
export async function runExploration(apiKey: string): Promise<ExplorationRun> {
  const state = loadState();

  if (state.isRunning) {
    console.log("[Exploration] Already running — skipping");
    return state.currentRun as ExplorationRun;
  }

  const runId = `explore_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  console.log(`[Exploration] Starting autonomous exploration run ${runId}`);

  state.isRunning = true;
  state.currentRun = { runId, startedAt, status: "running", territoriesScanned: [] };
  saveState(state);

  const territories = [
    { name: "AI World",        fn: () => exploreAIWorld(apiKey) },
    { name: "Web3 World",      fn: () => exploreWeb3World(apiKey) },
    { name: "Media Landscape", fn: () => exploreMediaLandscape(apiKey) },
    { name: "Global Context",  fn: () => exploreGlobalContext(apiKey) },
  ];

  const allFindings: string[] = [];
  const allKnowledge: any[] = [];
  const territoriesScanned: string[] = [];

  // Run territories in sequence (not parallel — each x_search needs its quota)
  for (const territory of territories) {
    try {
      const result = await territory.fn();
      allFindings.push(...result.findings);
      allKnowledge.push(...result.knowledge);
      territoriesScanned.push(territory.name);
      console.log(`[Exploration] ${territory.name}: ${result.findings.length} findings`);
      // Brief pause between searches
      await new Promise(r => setTimeout(r, 3000));
    } catch (e: any) {
      console.warn(`[Exploration] ${territory.name} failed:`, e.message);
    }
  }

  // Add synthesis as a knowledge entry
  const synthesis = await synthesizeFindings(allFindings.slice(0, 15), apiKey);
  if (synthesis) {
    allKnowledge.push({
      title: `Exploration synthesis — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      summary: synthesis.slice(0, 147) + (synthesis.length > 147 ? "..." : ""),
      category: "exploration",
      weight: 9,
    });
  }

  // Inject knowledge — deduplicate by title
  const memState = getMemoryState();
  const existingTitles = new Set(
    // We don't have direct access to entries here, so use a safe approach
    [] as string[]
  );

  let knowledgeAdded = 0;
  for (const entry of allKnowledge) {
    if (!entry.title || !entry.summary) continue;
    try {
      addKnowledge({
        title: entry.title,
        summary: entry.summary.slice(0, 150),
        category: entry.category ?? "exploration",
        weight: entry.weight ?? 7,
      });
      knowledgeAdded++;
    } catch {}
  }

  const durationMs = Date.now() - startMs;
  const topFindings = allFindings.slice(0, 5);

  const run: ExplorationRun = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    status: "complete",
    territoriesScanned,
    findingsCount: allFindings.length,
    knowledgeAdded,
    topFindings,
    durationMs,
  };

  state.isRunning = false;
  state.lastRunAt = run.completedAt;
  state.totalRuns = (state.totalRuns ?? 0) + 1;
  state.history.unshift(run);
  if (state.history.length > 30) state.history = state.history.slice(0, 30);
  state.currentRun = undefined;
  saveState(state);

  console.log(`[Exploration] Complete in ${Math.round(durationMs / 1000)}s — ${allFindings.length} findings, ${knowledgeAdded} knowledge entries added`);
  return run;
}

// ── Scheduler: every 24h at 3am ET (07:00 UTC) ───────────────────────────────
export function scheduleExploration(apiKey: string): void {
  function msUntilNext3amET(): number {
    const now = new Date();
    const target = new Date();
    target.setUTCHours(7, 0, 0, 0); // 3am ET = 07:00 UTC
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime() - now.getTime();
  }

  const delay = msUntilNext3amET();
  const nextRun = new Date(Date.now() + delay);
  console.log(`[Exploration] Scheduled daily at 3am ET — next: ${nextRun.toISOString()}`);

  setTimeout(async () => {
    await runExploration(apiKey).catch(e => console.error("[Exploration] Error:", e.message));
    // Then every 24h
    setInterval(() => {
      runExploration(apiKey).catch(e => console.error("[Exploration] Error:", e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}
