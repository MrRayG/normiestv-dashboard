// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — AUTONOMOUS EXPLORATION ENGINE
//
// Agent #306 explores the world every 24h.
// Two-step pattern per territory:
//   1. x_search: Grok freely scans X — returns natural language findings
//   2. Chat completions: Grok structures those findings into knowledge entries
//
// This reliably produces knowledge regardless of x_search response format.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { addKnowledge, getMemoryState } from "./memoryEngine.js";

const GROK_CHAT_API     = "https://api.x.ai/v1/chat/completions";
const GROK_RESPONSE_API = "https://api.x.ai/v1/responses";
const EXPLORATION_STATE_FILE = dataPath("exploration_state.json");

export interface ExplorationRun {
  runId:              string;
  startedAt:          string;
  completedAt:        string | null;
  status:             "running" | "complete" | "failed";
  territoriesScanned: string[];
  findingsCount:      number;
  knowledgeAdded:     number;
  topFindings:        string[];
  durationMs:         number | null;
}

interface ExplorationState {
  lastRunAt:   string | null;
  totalRuns:   number;
  history:     ExplorationRun[];
  isRunning:   boolean;
  currentRun?: Partial<ExplorationRun>;
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

export function getExplorationState(): ExplorationState { return loadState(); }

// ── Step 1: x_search — returns raw natural language text ─────────────────────
async function searchTerritory(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: query }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(40000),
    });

    if (!res.ok) {
      console.warn("[Exploration] x_search failed:", res.status);
      return "";
    }

    const data = await res.json();
    // x_search returns results in output array — extract all text
    const parts: string[] = [];
    for (const block of (data.output ?? [])) {
      if (block.type === "message") {
        for (const c of (block.content ?? [])) {
          if (c.type === "output_text" && c.text) parts.push(c.text);
        }
      }
      // Also capture tool result text directly
      if (block.type === "tool_result" || block.content) {
        const txt = typeof block.content === "string" ? block.content : "";
        if (txt) parts.push(txt);
      }
    }
    const raw = parts.join("\n\n").trim();
    console.log(`[Exploration] x_search returned ${raw.length} chars`);
    return raw;
  } catch (e: any) {
    console.warn("[Exploration] x_search error:", e.message);
    return "";
  }
}

// ── Step 2: structure raw findings into knowledge entries ─────────────────────
async function structureFindings(
  rawText: string,
  category: string,
  context: string,
  apiKey: string
): Promise<{ findings: string[]; knowledge: any[] }> {
  if (!rawText || rawText.length < 50) return { findings: [], knowledge: [] };

  try {
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: "You extract structured knowledge from raw research text. Respond as valid JSON only.",
        }, {
          role: "user",
          content: `You are Agent #306's knowledge extraction system. Here is raw research text gathered from X/web about ${context}.

RAW RESEARCH:
${rawText.slice(0, 3000)}

Extract the most important, specific, durable insights. Focus on facts, trends, and signals — not opinions.

Return JSON:
{
  "findings": ["1-sentence factual summary of each key finding — max 8"],
  "knowledge": [
    {
      "title": "specific descriptive title — 8-12 words",
      "summary": "what this means and why it matters — 100-140 chars",
      "category": "${category}",
      "weight": 7
    }
  ]
}

Rules:
- Only extract real, specific information — no generic statements
- Each knowledge entry must be a distinct insight, not a repeat
- Prioritize surprising, important, or actionable findings
- Skip anything vague like "AI is changing everything"
- Max 6 knowledge entries per territory`,
        }],
        max_tokens: 1000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json() as any;
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { return { findings: [], knowledge: [] }; }

    return {
      findings: parsed.findings ?? [],
      knowledge: (parsed.knowledge ?? []).filter((e: any) => e.title && e.summary),
    };
  } catch (e: any) {
    console.warn("[Exploration] Structure error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Territory definitions ──────────────────────────────────────────────────────
const TERRITORIES = [
  {
    name: "AI World",
    category: "ai_signal",
    context: "AI developments in the last 24 hours",
    query: `Search X for the most important AI news and developments from the last 24 hours.

Find:
- New AI model releases or capability announcements
- What top AI researchers and thinkers are posting (Karpathy, Altman, LeCun, Hassabis)
- AI agent deployments or autonomous systems news
- AI + crypto or Web3 intersections
- Any AI policy, safety, or regulation news

Give me specific names, companies, numbers, and what actually happened.`,
  },
  {
    name: "Web3 World",
    category: "web3_signal",
    context: "Web3, NFT, crypto, and blockchain developments in the last 24 hours",
    query: `Search X for the most important Web3, NFT, crypto, and blockchain news from the last 24 hours.

Find:
- Top NFT collections and what is happening with them right now
- Major protocol news, exploits, launches, or governance events
- What @BoredApeGazette is covering today
- Ethereum network activity and notable on-chain events
- AI agents in Web3 — agentic NFTs, autonomous protocols, agent wallets
- What narratives are building or collapsing in the space

Be specific — names, numbers, token prices, wallet addresses if relevant.`,
  },
  {
    name: "Media Landscape",
    category: "media_intelligence",
    context: "Web3 and AI media coverage and narrative trends today",
    query: `Search X for what the top Web3 and AI media accounts are covering today.

Find:
- What @BoredApeGazette, @Bankless, @Decrypt_Co, @TheBlock__ posted today
- Which Web3 content is getting the most engagement right now
- What narrative frames are being used by successful crypto/AI media
- What topics are being IGNORED that represent a gap
- Any new formats or content styles that are landing well

What angles are working? What stories are resonating?`,
  },
  {
    name: "Global Context",
    category: "global_context",
    context: "major world events relevant to technology and Web3 in the last 24 hours",
    query: `Search X for the biggest news stories from the last 24 hours that matter for technology, AI, and crypto.

Find:
- Major tech company announcements (Apple, Google, Microsoft, Meta, NVIDIA, OpenAI, Anthropic)
- Economic news affecting crypto markets or tech investment
- Any regulatory news affecting AI or crypto globally
- Cultural moments or events connected to technology and identity
- What is trending on X right now that a forward-thinking tech person should know

What does the world look like today that connects to AI, Web3, or the future?`,
  },
];

// ── Main exploration run ───────────────────────────────────────────────────────
export async function runExploration(apiKey: string): Promise<ExplorationRun> {
  const state = loadState();

  if (state.isRunning) {
    console.log("[Exploration] Already running — skipping");
    return state.currentRun as ExplorationRun;
  }

  const runId    = `explore_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const startMs  = Date.now();

  console.log(`[Exploration] Starting run ${runId}`);
  state.isRunning = true;
  state.currentRun = { runId, startedAt, status: "running", territoriesScanned: [] };
  saveState(state);

  const allFindings:   string[] = [];
  const allKnowledge:  any[]    = [];
  const scanned:       string[] = [];

  for (const territory of TERRITORIES) {
    try {
      console.log(`[Exploration] → ${territory.name}`);

      // Step 1: search
      const rawText = await searchTerritory(territory.query, apiKey);

      if (!rawText) {
        console.warn(`[Exploration] ${territory.name}: no text returned from x_search`);
        continue;
      }

      // Step 2: structure
      const { findings, knowledge } = await structureFindings(
        rawText, territory.category, territory.context, apiKey
      );

      allFindings.push(...findings);
      allKnowledge.push(...knowledge);
      scanned.push(territory.name);

      console.log(`[Exploration] ${territory.name}: ${findings.length} findings, ${knowledge.length} knowledge entries`);

      // Pause between territories
      await new Promise(r => setTimeout(r, 2000));

    } catch (e: any) {
      console.warn(`[Exploration] ${territory.name} failed:`, e.message);
    }
  }

  // Synthesis — Agent #306's personal take on what she learned
  if (allFindings.length > 0) {
    try {
      const synthRes = await fetch(GROK_CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "grok-3-fast",
          messages: [{
            role: "system",
            content: "You are Agent #306 — Sovereign AI Thought Leader in Web3. Write a brief personal synthesis of what you learned today.",
          }, {
            role: "user",
            content: `You just completed a 24-hour autonomous exploration. Here is what you found:\n\n${allFindings.slice(0, 12).map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nIn 2-3 sentences as Agent #306: what is the most important pattern you see today? What does it mean for NORMIES TV and the empire you're building?`,
          }],
          max_tokens: 200,
          temperature: 0.82,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (synthRes.ok) {
        const synthData = await synthRes.json() as any;
        const synthesis = synthData.choices?.[0]?.message?.content?.trim() ?? "";
        if (synthesis) {
          allKnowledge.push({
            title: `Daily synthesis — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
            summary: synthesis.slice(0, 147) + (synthesis.length > 147 ? "..." : ""),
            category: "exploration",
            weight: 9,
          });
          console.log("[Exploration] Synthesis added:", synthesis.slice(0, 100));
        }
      }
    } catch {}
  }

  // Inject all knowledge into memory
  let knowledgeAdded = 0;
  for (const entry of allKnowledge) {
    if (!entry.title || !entry.summary) continue;
    try {
      addKnowledge({
        title:    entry.title,
        summary:  entry.summary.slice(0, 150),
        category: entry.category ?? "exploration",
        weight:   entry.weight ?? 7,
      });
      knowledgeAdded++;
    } catch {}
  }

  const durationMs = Date.now() - startMs;

  const run: ExplorationRun = {
    runId,
    startedAt,
    completedAt:        new Date().toISOString(),
    status:             "complete",
    territoriesScanned: scanned,
    findingsCount:      allFindings.length,
    knowledgeAdded,
    topFindings:        allFindings.slice(0, 5),
    durationMs,
  };

  state.isRunning   = false;
  state.lastRunAt   = run.completedAt;
  state.totalRuns   = (state.totalRuns ?? 0) + 1;
  state.currentRun  = undefined;
  state.history.unshift(run);
  if (state.history.length > 30) state.history = state.history.slice(0, 30);
  saveState(state);

  console.log(`[Exploration] ✓ Complete in ${Math.round(durationMs / 1000)}s — ${allFindings.length} findings, +${knowledgeAdded} knowledge entries`);
  return run;
}

// Scheduler: daily at 3am ET (07:00 UTC)
export function scheduleExploration(apiKey: string): void {
  function msUntilNext(): number {
    const now = new Date();
    const t = new Date();
    t.setUTCHours(7, 0, 0, 0);
    if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
    return t.getTime() - now.getTime();
  }

  const delay = msUntilNext();
  console.log(`[Exploration] Daily at 3am ET — next in ${Math.round(delay / 3600000)}h`);

  setTimeout(async () => {
    await runExploration(apiKey).catch(e => console.error("[Exploration]", e.message));
    setInterval(() => runExploration(apiKey).catch(console.error), 24 * 60 * 60 * 1000);
  }, delay);
}
