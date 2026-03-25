// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — AUTONOMOUS EXPLORATION ENGINE v3
//
// API Strategy (right tool for each job):
//   • Perplexity Sonar  → world research: news, AI, Web3, global context
//                         Purpose-built for agents. Web-grounded. Cited sources.
//   • Grok x_search     → X/Twitter social signals only (what people are posting)
//   • Grok Chat         → synthesizing + structuring findings into knowledge entries
//
// Why not Grok x_search for everything:
//   - Only searches X/Twitter, not the web
//   - Rate-limited — 4 parallel calls hits quota immediately
//   - Inconsistent response format for structured extraction
//
// Perplexity Sonar is OpenAI-compatible — same interface, just different base URL.
// Add PERPLEXITY_API_KEY to Railway env vars to activate.
// Without it, falls back to Grok chat completions (web knowledge, no live search).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { addKnowledge } from "./memoryEngine.js";

const GROK_CHAT_API      = "https://api.x.ai/v1/chat/completions";
const GROK_RESPONSE_API  = "https://api.x.ai/v1/responses";
const PERPLEXITY_API     = "https://api.perplexity.ai";
const EXPLORATION_FILE   = dataPath("exploration_state.json");

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
  apiUsed:            string;
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
    if (fs.existsSync(EXPLORATION_FILE))
      return JSON.parse(fs.readFileSync(EXPLORATION_FILE, "utf8"));
  } catch {}
  return { lastRunAt: null, totalRuns: 0, history: [], isRunning: false };
}

function saveState(s: ExplorationState) {
  try { fs.writeFileSync(EXPLORATION_FILE, JSON.stringify(s, null, 2)); } catch {}
}

export function getExplorationState(): ExplorationState { return loadState(); }

// ── Perplexity Sonar — web-grounded research ─────────────────────────────────
// OpenAI-compatible. sonar = fast web search. sonar-pro = deeper research.
async function searchWithPerplexity(
  query: string,
  pplxKey: string,
  deep = false
): Promise<string> {
  try {
    const res = await fetch(`${PERPLEXITY_API}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${pplxKey}`,
      },
      body: JSON.stringify({
        model: deep ? "sonar-pro" : "sonar",
        messages: [
          {
            role: "system",
            content: "You are a research assistant for Agent #306, an AI media agent covering AI and Web3. Be specific, factual, and cite sources. Focus on the last 24-48 hours.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 1200,
        temperature: 0.2,
        return_citations: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn("[Exploration] Perplexity error:", res.status, err.slice(0, 100));
      return "";
    }

    const data = await res.json() as any;
    const text  = data.choices?.[0]?.message?.content ?? "";
    const citations: string[] = data.citations ?? [];

    // Append citations so the structurer can reference them
    const citationBlock = citations.length > 0
      ? `\n\nSources: ${citations.slice(0, 5).join(", ")}`
      : "";

    console.log(`[Exploration] Perplexity returned ${text.length} chars + ${citations.length} citations`);
    return text + citationBlock;

  } catch (e: any) {
    console.warn("[Exploration] Perplexity fetch error:", e.message);
    return "";
  }
}

// ── Grok x_search — X/Twitter social signal scan ────────────────────────────
async function searchXSocial(query: string, grokKey: string): Promise<string> {
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{ role: "user", content: query }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) return "";
    const data = await res.json();

    const parts: string[] = [];
    for (const block of (data.output ?? [])) {
      if (block.type === "message") {
        for (const c of (block.content ?? [])) {
          if ((c.type === "output_text" || c.type === "text") && c.text)
            parts.push(c.text);
        }
      }
    }
    const raw = parts.join("\n\n").trim();
    console.log(`[Exploration] Grok x_search returned ${raw.length} chars`);
    return raw;
  } catch (e: any) {
    console.warn("[Exploration] Grok x_search error:", e.message);
    return "";
  }
}

// ── Fallback: Grok chat with built-in world knowledge ───────────────────────
// Used when no Perplexity key is set. Less current (training cutoff) but works.
async function searchWithGrokKnowledge(query: string, grokKey: string): Promise<string> {
  try {
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{
          role: "system",
          content: "You are a knowledgeable research assistant. Answer with specific facts, names, and numbers.",
        }, {
          role: "user",
          content: query + "\n\nNote: Use your knowledge up to your training cutoff. Be specific about what you know.",
        }],
        max_tokens: 800,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return "";
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  } catch { return ""; }
}

// ── Structure raw text into knowledge entries ─────────────────────────────────
async function extractKnowledge(
  rawText: string,
  category: string,
  context: string,
  grokKey: string
): Promise<{ findings: string[]; knowledge: any[] }> {
  if (!rawText || rawText.length < 80) return { findings: [], knowledge: [] };

  try {
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: "Extract structured knowledge from research text. Return valid JSON only. Be selective — only extract specific, durable, actionable insights.",
        }, {
          role: "user",
          content: `Extract the most important insights from this research about ${context}.

RESEARCH TEXT:
${rawText.slice(0, 3500)}

Return JSON with:
{
  "findings": ["1-sentence factual summary — max 8, each a distinct finding"],
  "knowledge": [
    {
      "title": "specific title — 8-12 words",
      "summary": "what happened and why it matters — 100-140 chars exactly",
      "category": "${category}",
      "weight": 7
    }
  ]
}

Rules:
- Only extract SPECIFIC information — no generic statements like "AI is advancing"
- Each entry must be a distinct, concrete insight
- Prioritize surprising, important, or actionable findings
- Max 5 knowledge entries
- Skip anything vague or already widely known`,
        }],
        max_tokens: 900,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return { findings: [], knowledge: [] };
    const data = await res.json() as any;
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { return { findings: [], knowledge: [] }; }

    return {
      findings: (parsed.findings ?? []).filter((f: any) => typeof f === "string" && f.length > 10),
      knowledge: (parsed.knowledge ?? []).filter((e: any) => e.title && e.summary),
    };
  } catch (e: any) {
    console.warn("[Exploration] Knowledge extraction error:", e.message);
    return { findings: [], knowledge: [] };
  }
}

// ── Territory definitions ──────────────────────────────────────────────────────
function buildTerritories(hasPplx: boolean) {
  return [
    {
      name: "AI World",
      category: "ai_signal",
      context: "AI developments in the last 24 hours",
      useX: false,
      query: `What are the most important AI developments from the last 24-48 hours?

I need specific information about:
1. New model releases or capability announcements (GPT-5 updates, Claude, Gemini, etc.)
2. What Karpathy, Altman, LeCun, or other top AI thinkers are saying publicly right now
3. Any AI agent deployments or autonomous systems news
4. AI companies — funding rounds, product launches, partnerships
5. AI + blockchain or Web3 intersections

Give me specific names, companies, numbers, and what actually happened.`,
    },
    {
      name: "Web3 World",
      category: "web3_signal",
      context: "Web3, NFT, crypto, and blockchain news in the last 24-48 hours",
      useX: true, // X is where Web3 news breaks first
      query: `Search X for the most important Web3, NFT, and crypto news from the last 24 hours.

Find:
- Top NFT collections — what is happening with BAYC, Pudgy Penguins, and others?
- Any major protocol exploits, launches, or governance votes
- Ethereum network activity — gas prices, notable transactions
- Any AI agents operating on-chain — agentic wallets, autonomous DeFi
- What @BoredApeGazette is reporting today
- What narratives are hot or collapsing right now

Be specific — names, token prices, wallet addresses, transaction hashes.`,
    },
    {
      name: "Media Landscape",
      category: "media_intelligence",
      context: "Web3 and AI media trends and narrative gaps today",
      useX: false,
      query: `What are the top Web3 and AI media outlets covering right now, and what are they missing?

Research:
1. What are BoredApeGazette, Bankless, Decrypt, The Block, and CoinDesk covering this week?
2. What content formats are getting the highest engagement in Web3/AI media?
3. What narrative frames are the most successful crypto/AI media using right now?
4. What important stories are being IGNORED that represent an opportunity?
5. How is AI changing media consumption and production in this space?

What should Agent #306 be covering that nobody else is?`,
    },
    {
      name: "Global Context",
      category: "global_context",
      context: "major world events relevant to technology, AI, and crypto in the last 24 hours",
      useX: false,
      query: `What are the biggest news stories from the last 24 hours that matter for AI, technology, and crypto?

I need:
1. Major tech company moves — Apple, Google, Microsoft, Meta, NVIDIA, OpenAI, Anthropic
2. Economic news affecting markets or tech investment
3. Regulatory news affecting AI or crypto globally
4. Any geopolitical events affecting the tech or crypto landscape
5. Cultural or social trends connected to technology and the future

Focus on things that would change how a forward-thinking AI media agent covers the world.`,
    },
  ];
}

// ── Main exploration run ───────────────────────────────────────────────────────
export async function runExploration(grokKey: string, pplxKey?: string): Promise<ExplorationRun> {
  const state = loadState();

  if (state.isRunning) {
    console.log("[Exploration] Already running");
    return state.currentRun as ExplorationRun;
  }

  const hasPplx  = !!(pplxKey && pplxKey.length > 10);
  const runId    = `explore_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const startMs  = Date.now();
  const apiUsed  = hasPplx ? "Perplexity Sonar + Grok x_search" : "Grok (fallback — add PERPLEXITY_API_KEY for live web search)";

  console.log(`[Exploration] Starting run — API: ${apiUsed}`);
  if (!hasPplx) {
    console.warn("[Exploration] PERPLEXITY_API_KEY not set — using Grok knowledge fallback. Add key to Railway for live web search.");
  }

  state.isRunning  = true;
  state.currentRun = { runId, startedAt, status: "running", territoriesScanned: [] };
  saveState(state);

  const allFindings:  string[] = [];
  const allKnowledge: any[]    = [];
  const scanned:      string[] = [];

  const territories = buildTerritories(hasPplx);

  for (const t of territories) {
    try {
      console.log(`[Exploration] → ${t.name}`);

      let rawText = "";

      if (t.useX) {
        // Web3 social: use Grok x_search (X-specific, one call)
        rawText = await searchXSocial(t.query, grokKey);
      } else if (hasPplx) {
        // World research: use Perplexity Sonar (web-grounded, reliable)
        rawText = await searchWithPerplexity(t.query, pplxKey!);
      } else {
        // Fallback: Grok's training knowledge (less current but always works)
        rawText = await searchWithGrokKnowledge(t.query, grokKey);
      }

      if (!rawText || rawText.length < 50) {
        console.warn(`[Exploration] ${t.name}: no content returned`);
        continue;
      }

      const { findings, knowledge } = await extractKnowledge(rawText, t.category, t.context, grokKey);

      allFindings.push(...findings);
      allKnowledge.push(...knowledge);
      scanned.push(t.name);

      console.log(`[Exploration] ${t.name}: ${findings.length} findings, ${knowledge.length} entries extracted`);

      // Brief pause between calls
      await new Promise(r => setTimeout(r, 1500));

    } catch (e: any) {
      console.warn(`[Exploration] ${t.name} failed:`, e.message);
    }
  }

  // Synthesis: Agent #306's personal take
  if (allFindings.length > 0) {
    try {
      const synthRes = await fetch(GROK_CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
        body: JSON.stringify({
          model: "grok-3-fast",
          messages: [{
            role: "system",
            content: "You are Agent #306 — Sovereign AI Thought Leader covering the intersection of AI and Web3.",
          }, {
            role: "user",
            content: `You just completed an autonomous exploration of the world. Here is what you found:\n\n${allFindings.slice(0, 10).map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nIn 2-3 sentences: what is the most important pattern you see today? What does it mean for NORMIES TV?`,
          }],
          max_tokens: 200,
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (synthRes.ok) {
        const sd = await synthRes.json() as any;
        const synthesis = sd.choices?.[0]?.message?.content?.trim() ?? "";
        if (synthesis) {
          allKnowledge.push({
            title: `Exploration synthesis — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
            summary: synthesis.slice(0, 147) + (synthesis.length > 147 ? "..." : ""),
            category: "exploration",
            weight: 9,
          });
        }
      }
    } catch {}
  }

  // Inject into knowledge base
  let knowledgeAdded = 0;
  for (const entry of allKnowledge) {
    if (!entry.title || !entry.summary) continue;
    try {
      addKnowledge({ title: entry.title, summary: entry.summary.slice(0, 150), category: entry.category ?? "exploration", weight: entry.weight ?? 7 });
      knowledgeAdded++;
    } catch {}
  }

  const durationMs = Date.now() - startMs;

  const run: ExplorationRun = {
    runId, startedAt,
    completedAt:        new Date().toISOString(),
    status:             allFindings.length > 0 ? "complete" : "failed",
    territoriesScanned: scanned,
    findingsCount:      allFindings.length,
    knowledgeAdded,
    topFindings:        allFindings.slice(0, 5),
    durationMs,
    apiUsed,
  };

  state.isRunning  = false;
  state.lastRunAt  = run.completedAt;
  state.totalRuns  = (state.totalRuns ?? 0) + 1;
  state.currentRun = undefined;
  state.history.unshift(run);
  if (state.history.length > 30) state.history = state.history.slice(0, 30);
  saveState(state);

  if (allFindings.length === 0) {
    console.warn("[Exploration] ⚠ No findings. Check API keys — add PERPLEXITY_API_KEY to Railway for reliable web research.");
  } else {
    console.log(`[Exploration] ✓ ${allFindings.length} findings, +${knowledgeAdded} knowledge in ${Math.round(durationMs / 1000)}s`);
  }

  return run;
}

// Scheduler: daily at 3am ET (07:00 UTC)
export function scheduleExploration(grokKey: string, pplxKey?: string): void {
  function msUntilNext(): number {
    const now = new Date();
    const t = new Date();
    t.setUTCHours(7, 0, 0, 0);
    if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
    return t.getTime() - now.getTime();
  }

  const delay = msUntilNext();
  console.log(`[Exploration] Scheduled daily at 3am ET — next in ${Math.round(delay / 3600000)}h`);

  setTimeout(async () => {
    await runExploration(grokKey, pplxKey).catch(e => console.error("[Exploration]", e.message));
    setInterval(() => runExploration(grokKey, pplxKey).catch(console.error), 24 * 60 * 60 * 1000);
  }, delay);
}
