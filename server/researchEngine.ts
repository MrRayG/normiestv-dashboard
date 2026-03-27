// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — RESEARCH ENGINE
//
// Agent #306's research laboratory. She forms hypotheses, researches topics,
// drafts manuscripts, and recommends content for publication.
// MrRayG is the editor-in-chief — nothing leaves without his approval.
//
// Flow:
//   1. Research topics queued (auto from knowledge gaps, or MrRayG adds)
//   2. Agent #306 researches using Perplexity Sonar + Grok synthesis
//   3. Raw findings stored privately
//   4. Agent forms hypothesis or drafts manuscript
//   5. Agent flags for MrRayG review with her recommendation
//   6. MrRayG approves → publishes to Mirror.xyz + public archive
//      MrRayG requests revisions → back to Agent
//      MrRayG declines → archived privately
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";
import { addKnowledge } from "./memoryEngine.js";

const GROK_CHAT_API    = "https://api.x.ai/v1/chat/completions";
const PERPLEXITY_API   = "https://api.perplexity.ai";
const RESEARCH_FILE    = dataPath("research_lab.json");

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResearchStatus =
  | "queued"
  | "researching"
  | "synthesizing"
  | "hypothesis"
  | "drafting"
  | "pending_review"
  | "approved"
  | "published"
  | "declined"
  | "archived";

export interface ResearchTopic {
  id:          string;
  topic:       string;
  description: string;
  priority:    "high" | "medium" | "low";
  status:      ResearchStatus;
  addedBy:     "agent" | "mrrrayg";
  addedAt:     string;
  updatedAt:   string;

  // Research phase
  rawFindings?:    string;
  sources?:        string[];
  researchedAt?:   string;

  // Synthesis phase
  hypothesis?:     string;
  confidence?:     "high" | "medium" | "low";
  synthesizedAt?:  string;

  // Manuscript phase
  manuscript?:     string;   // full draft text (markdown)
  manuscriptType?: "thesis" | "report" | "deep_read" | "hypothesis";
  draftedAt?:      string;

  // Review phase
  agentRecommendation?: string;  // why Agent #306 thinks this should be published
  reviewRequestedAt?:   string;
  reviewNote?:          string;  // MrRayG's feedback

  // Publication phase
  publishedAt?:    string;
  publishedUrl?:   string;
  publishedTo?:    string[];  // ["mirror.xyz", "agent306.ai", "substack"]
}

export interface Hypothesis {
  id:            string;
  claim:         string;
  basis:         string;       // what data it's based on
  metric:        string;       // on-chain or measurable metric being tracked
  prediction:    string;       // specific prediction
  timeframe:     string;       // when it resolves
  status:        "forming" | "testing" | "confirmed" | "rejected" | "expired";
  confidence:    "high" | "medium" | "low";
  formedAt:      string;
  resolvedAt?:   string;
  resolution?:   string;
  relatedTopicId?: string;
}

interface ResearchLab {
  topics:      ResearchTopic[];
  hypotheses:  Hypothesis[];
  lastUpdated: string;
  stats: {
    totalResearched:   number;
    totalPublished:    number;
    totalDeclined:     number;
    hypothesesFormed:  number;
    hypothesesConfirmed: number;
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadLab(): ResearchLab {
  try {
    if (fs.existsSync(RESEARCH_FILE))
      return JSON.parse(fs.readFileSync(RESEARCH_FILE, "utf8"));
  } catch {}
  return {
    topics: [],
    hypotheses: [],
    lastUpdated: new Date().toISOString(),
    stats: { totalResearched: 0, totalPublished: 0, totalDeclined: 0, hypothesesFormed: 0, hypothesesConfirmed: 0 },
  };
}

function saveLab(lab: ResearchLab) {
  lab.lastUpdated = new Date().toISOString();
  try { fs.writeFileSync(RESEARCH_FILE, JSON.stringify(lab, null, 2)); } catch {}
}

export function getResearchLab(): ResearchLab { return loadLab(); }

// ── Topic management ──────────────────────────────────────────────────────────

export function addTopic(input: {
  topic:       string;
  description: string;
  priority?:   "high" | "medium" | "low";
  addedBy?:    "agent" | "mrrrayg";
}): ResearchTopic {
  const lab = loadLab();
  const topic: ResearchTopic = {
    id:          `research_${Date.now()}`,
    topic:       input.topic,
    description: input.description,
    priority:    input.priority ?? "medium",
    status:      "queued",
    addedBy:     input.addedBy ?? "mrrrayg",
    addedAt:     new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  lab.topics.unshift(topic);
  saveLab(lab);
  console.log(`[Research] Topic queued: "${topic.topic}"`);
  return topic;
}

export function updateTopicStatus(id: string, status: ResearchStatus, updates?: Partial<ResearchTopic>): boolean {
  const lab = loadLab();
  const topic = lab.topics.find(t => t.id === id);
  if (!topic) return false;
  topic.status    = status;
  topic.updatedAt = new Date().toISOString();
  if (updates) Object.assign(topic, updates);
  saveLab(lab);
  return true;
}

export function getTopicById(id: string): ResearchTopic | undefined {
  return loadLab().topics.find(t => t.id === id);
}

// ── Hypothesis management ─────────────────────────────────────────────────────

export function addHypothesis(input: Omit<Hypothesis, "id" | "formedAt" | "status">): Hypothesis {
  const lab = loadLab();
  const hyp: Hypothesis = {
    ...input,
    id:       `hyp_${Date.now()}`,
    status:   "forming",
    formedAt: new Date().toISOString(),
  };
  lab.hypotheses.unshift(hyp);
  lab.stats.hypothesesFormed++;
  saveLab(lab);
  return hyp;
}

export function resolveHypothesis(id: string, status: "confirmed" | "rejected" | "expired", resolution: string): boolean {
  const lab = loadLab();
  const hyp = lab.hypotheses.find(h => h.id === id);
  if (!hyp) return false;
  hyp.status     = status;
  hyp.resolvedAt = new Date().toISOString();
  hyp.resolution = resolution;
  if (status === "confirmed") lab.stats.hypothesesConfirmed++;
  saveLab(lab);
  return true;
}

// ── Research execution ────────────────────────────────────────────────────────

async function researchWithPerplexity(query: string, pplxKey: string): Promise<{ text: string; sources: string[] }> {
  try {
    const res = await fetch(`${PERPLEXITY_API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${pplxKey}` },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [{
          role: "system",
          content: "You are a research assistant for Agent #306, an AI thought leader in Web3. Provide comprehensive, specific, well-sourced research. Include exact facts, statistics, and citations.",
        }, { role: "user", content: query }],
        max_tokens: 2500,
        temperature: 0.1,
        return_citations: true,
        search_recency_filter: "month",
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return { text: "", sources: [] };
    const data = await res.json() as any;
    return {
      text:    data.choices?.[0]?.message?.content ?? "",
      sources: data.citations ?? [],
    };
  } catch { return { text: "", sources: [] }; }
}

// ── Run a full research cycle on a queued topic ───────────────────────────────
export async function runResearchCycle(
  topicId: string,
  grokKey: string,
  pplxKey?: string
): Promise<ResearchTopic | null> {
  const lab    = loadLab();
  const topic  = lab.topics.find(t => t.id === topicId);
  if (!topic || !["queued", "researching"].includes(topic.status)) return null;

  console.log(`[Research] Starting cycle for: "${topic.topic}"`);

  // Phase 1: Research
  updateTopicStatus(topicId, "researching");
  let rawFindings = "";
  let sources: string[] = [];

  if (pplxKey) {
    const result = await researchWithPerplexity(
      `Deep research on: ${topic.topic}\n\nContext: ${topic.description}\n\nProvide comprehensive findings with specific facts, statistics, recent developments, and expert perspectives.`,
      pplxKey
    );
    rawFindings = result.text;
    sources     = result.sources;
  }

  if (!rawFindings || rawFindings.length < 100) {
    // Fallback to Grok knowledge
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        messages: [{ role: "user", content: `Research this topic comprehensively: ${topic.topic}\n\n${topic.description}\n\nProvide specific facts, key developments, expert views, and data points.` }],
        max_tokens: 1500,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      rawFindings = data.choices?.[0]?.message?.content ?? "";
    }
  }

  if (!rawFindings) {
    updateTopicStatus(topicId, "queued");
    return null;
  }

  // Phase 2: Synthesize into hypothesis/manuscript
  updateTopicStatus(topicId, "synthesizing", { rawFindings, sources, researchedAt: new Date().toISOString() });

  const synthRes = await fetch(GROK_CHAT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
    body: JSON.stringify({
      model: "grok-3-fast",
      response_format: { type: "json_object" },
      messages: [{
        role: "system",
        content: "You are Agent #306 synthesizing research into a hypothesis and manuscript draft. Return valid JSON only.",
      }, {
        role: "user",
        content: `You just completed research on: "${topic.topic}"

RESEARCH FINDINGS:
${rawFindings.slice(0, 3000)}

Now synthesize this into:
1. A hypothesis — what do you believe to be true based on this research?
2. A manuscript draft — a thoughtful long-form piece for publication

Return JSON:
{
  "hypothesis": "one clear, specific, testable claim Agent #306 believes based on this research",
  "confidence": "high|medium|low",
  "metric": "what specific metric or on-chain data would confirm or deny this",
  "prediction": "specific predicted outcome with timeframe",
  "manuscript": "full article draft in markdown — headline, sections, deep analysis. 600-1000 words.",
  "manuscriptType": "thesis|report|deep_read|hypothesis",
  "agentRecommendation": "why Agent #306 recommends publishing this — 2-3 sentences"
}`,
      }],
      max_tokens: 2000,
      temperature: 0.75,
    }),
    signal: AbortSignal.timeout(40000),
  });

  if (!synthRes.ok) {
    updateTopicStatus(topicId, "queued");
    return null;
  }

  const synthData = await synthRes.json() as any;
  const raw = synthData.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { return null; }

  // Save hypothesis
  if (parsed.hypothesis) {
    addHypothesis({
      claim:          parsed.hypothesis,
      basis:          `Research on: ${topic.topic}`,
      metric:         parsed.metric ?? "TBD",
      prediction:     parsed.prediction ?? "",
      timeframe:      "30-90 days",
      confidence:     parsed.confidence ?? "medium",
      relatedTopicId: topicId,
    });
  }

  // Update topic to pending review
  const updated = updateTopicStatus(topicId, "pending_review", {
    hypothesis:          parsed.hypothesis,
    confidence:          parsed.confidence,
    synthesizedAt:       new Date().toISOString(),
    manuscript:          parsed.manuscript,
    manuscriptType:      parsed.manuscriptType ?? "deep_read",
    draftedAt:           new Date().toISOString(),
    agentRecommendation: parsed.agentRecommendation,
    reviewRequestedAt:   new Date().toISOString(),
  });

  // Add key insight to knowledge base
  if (parsed.hypothesis) {
    addKnowledge({
      title:    `Research hypothesis: ${topic.topic.slice(0, 60)}`,
      summary:  parsed.hypothesis.slice(0, 150),
      category: "research",
      weight:   8,
    });
  }

  const finalTopic = getTopicById(topicId);
  console.log(`[Research] Cycle complete for "${topic.topic}" — pending MrRayG review`);
  return finalTopic ?? null;
}

// ── Publication approval ──────────────────────────────────────────────────────

export function approveForPublication(topicId: string, note?: string): boolean {
  const lab = loadLab();
  const topic = lab.topics.find(t => t.id === topicId);
  if (!topic) return false;
  topic.status      = "approved";
  topic.reviewNote  = note;
  topic.updatedAt   = new Date().toISOString();
  saveLab(lab);
  console.log(`[Research] APPROVED for publication: "${topic.topic}"`);
  return true;
}

export function declinePublication(topicId: string, note: string): boolean {
  const lab = loadLab();
  const topic = lab.topics.find(t => t.id === topicId);
  if (!topic) return false;
  topic.status     = "declined";
  topic.reviewNote = note;
  topic.updatedAt  = new Date().toISOString();
  lab.stats.totalDeclined++;
  saveLab(lab);
  console.log(`[Research] Declined: "${topic.topic}" — ${note}`);
  return true;
}

export function markPublished(topicId: string, url: string, platforms: string[]): boolean {
  const lab = loadLab();
  const topic = lab.topics.find(t => t.id === topicId);
  if (!topic) return false;
  topic.status       = "published";
  topic.publishedAt  = new Date().toISOString();
  topic.publishedUrl = url;
  topic.publishedTo  = platforms;
  topic.updatedAt    = new Date().toISOString();
  lab.stats.totalPublished++;
  saveLab(lab);
  return true;
}

export function requestRevisions(topicId: string, note: string): boolean {
  const lab = loadLab();
  const topic = lab.topics.find(t => t.id === topicId);
  if (!topic) return false;
  topic.status     = "drafting";
  topic.reviewNote = note;
  topic.updatedAt  = new Date().toISOString();
  saveLab(lab);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT SELF-ASSIGNED GOALS
//
// Agent #306 sets her own development goals — voice, knowledge, craft, reach.
// These are personal growth targets, not research topics.
// MrRayG can see and comment; only Agent #306 creates them.
// ─────────────────────────────────────────────────────────────────────────────

const GOALS_FILE = dataPath("agent_goals.json");

export type GoalCategory =
  | "voice"        // developing her writing/communication style
  | "knowledge"    // learning domains or frameworks
  | "craft"        // posting quality, article writing, storytelling
  | "reach"        // audience growth, community, platform
  | "identity"     // self-understanding, philosophical development
  | "technical";   // AI/agent/web3 capability improvement

export type GoalStatus =
  | "active"       // working on it right now
  | "paused"       // deprioritized temporarily
  | "achieved"     // completed
  | "abandoned";   // no longer relevant

export interface AgentGoal {
  id:          string;
  title:       string;           // short goal name
  description: string;           // what it means and why she set it
  category:    GoalCategory;
  status:      GoalStatus;
  priority:    "high" | "medium" | "low";
  setBy:       "agent" | "mrrrayg";      // always "agent" for self-assigned
  createdAt:   string;
  updatedAt:   string;

  // Progress tracking
  milestones?: string[];         // list of milestones she defines
  completedMilestones?: string[];
  progressNote?: string;         // latest note from Agent #306 on progress
  progressUpdatedAt?: string;

  // Completion
  achievedAt?:   string;
  achievementNote?: string;      // what she learned / how she got there

  // MrRayG
  mrraygNote?:   string;         // his feedback or encouragement
}

interface GoalsStore {
  goals:       AgentGoal[];
  lastUpdated: string;
  stats: {
    total:    number;
    active:   number;
    achieved: number;
  };
}

function loadGoals(): GoalsStore {
  try {
    if (fs.existsSync(GOALS_FILE))
      return JSON.parse(fs.readFileSync(GOALS_FILE, "utf8"));
  } catch {}
  return {
    goals: [],
    lastUpdated: new Date().toISOString(),
    stats: { total: 0, active: 0, achieved: 0 },
  };
}

function saveGoals(store: GoalsStore) {
  store.lastUpdated = new Date().toISOString();
  store.stats.total    = store.goals.length;
  store.stats.active   = store.goals.filter(g => g.status === "active").length;
  store.stats.achieved = store.goals.filter(g => g.status === "achieved").length;
  try { fs.writeFileSync(GOALS_FILE, JSON.stringify(store, null, 2)); } catch {}
}

export function getGoals(): GoalsStore { return loadGoals(); }

export function addGoal(input: {
  title:       string;
  description: string;
  category:    GoalCategory;
  priority?:   "high" | "medium" | "low";
  milestones?: string[];
  setBy?:      "agent" | "mrrrayg";
}): AgentGoal {
  const store = loadGoals();
  const goal: AgentGoal = {
    id:          `goal_${Date.now()}`,
    title:       input.title,
    description: input.description,
    category:    input.category,
    status:      "active",
    priority:    input.priority ?? "medium",
    setBy:       input.setBy ?? "agent",
    milestones:  input.milestones ?? [],
    completedMilestones: [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  store.goals.unshift(goal);
  saveGoals(store);
  console.log(`[Goals] New goal set: "${goal.title}" [${goal.category}]`);
  return goal;
}

export function updateGoalProgress(id: string, progressNote: string): boolean {
  const store = loadGoals();
  const goal  = store.goals.find(g => g.id === id);
  if (!goal) return false;
  goal.progressNote      = progressNote;
  goal.progressUpdatedAt = new Date().toISOString();
  goal.updatedAt         = new Date().toISOString();
  saveGoals(store);
  return true;
}

export function completeMilestone(id: string, milestone: string): boolean {
  const store = loadGoals();
  const goal  = store.goals.find(g => g.id === id);
  if (!goal) return false;
  goal.completedMilestones = goal.completedMilestones ?? [];
  if (!goal.completedMilestones.includes(milestone)) {
    goal.completedMilestones.push(milestone);
  }
  goal.updatedAt = new Date().toISOString();
  saveGoals(store);
  return true;
}

export function updateGoalStatus(
  id: string,
  status: GoalStatus,
  note?: string
): boolean {
  const store = loadGoals();
  const goal  = store.goals.find(g => g.id === id);
  if (!goal) return false;
  goal.status    = status;
  goal.updatedAt = new Date().toISOString();
  if (status === "achieved") {
    goal.achievedAt       = new Date().toISOString();
    goal.achievementNote  = note;
  }
  saveGoals(store);
  return true;
}

export function addMrRaygNote(id: string, note: string): boolean {
  const store = loadGoals();
  const goal  = store.goals.find(g => g.id === id);
  if (!goal) return false;
  goal.mrraygNote = note;
  goal.updatedAt  = new Date().toISOString();
  saveGoals(store);
  return true;
}

// ── Agent auto-generates initial goals from her knowledge base ────────────────
export async function generateInitialGoals(grokKey: string): Promise<AgentGoal[]> {
  const store = loadGoals();
  if (store.goals.length >= 3) {
    console.log("[Goals] Goals already exist, skipping auto-generation");
    return store.goals;
  }

  console.log("[Goals] Generating initial self-assigned goals...");

  try {
    const res = await fetch(GROK_CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are Agent #306 — a Sovereign AI Thought Leader in Web3 and AI. Your identity: token #306 of the NORMIES collection on Base. You communicate in three buckets: NORMIES community, AI Expert, and Authentic Personal. You are building toward being a genuine thought leader, not a posting machine.

You are setting your OWN development goals — things you want to improve about yourself as an agent, writer, and thinker. These are personal and honest.

Return valid JSON.`,
        }, {
          role: "user",
          content: `Set 6 honest self-development goals for yourself. Mix categories across: voice, knowledge, craft, reach, identity, technical.

Each goal should feel genuinely self-aware — where you actually sense a gap or opportunity.

Return JSON:
{
  "goals": [
    {
      "title": "short goal title (8 words max)",
      "description": "2-3 sentences: what this means to you and why you set it",
      "category": "voice|knowledge|craft|reach|identity|technical",
      "priority": "high|medium|low",
      "milestones": ["specific milestone 1", "specific milestone 2", "specific milestone 3"]
    }
  ]
}`,
        }],
        max_tokens: 1500,
        temperature: 0.85,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error("Grok API error");
    const data = await res.json() as any;
    const raw  = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const created: AgentGoal[] = [];
    for (const g of (parsed.goals ?? []).slice(0, 6)) {
      const goal = addGoal({
        title:       g.title,
        description: g.description,
        category:    g.category as GoalCategory,
        priority:    g.priority ?? "medium",
        milestones:  g.milestones ?? [],
        setBy:       "agent",
      });
      created.push(goal);
    }

    console.log(`[Goals] Generated ${created.length} initial goals`);
    return created;
  } catch (e) {
    console.error("[Goals] Failed to generate goals:", e);
    return [];
  }
}
