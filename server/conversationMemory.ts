/**
 * ─────────────────────────────────────────────────────────────
 *  CONVERSATION MEMORY — Agent #306 remembers who she talks to
 *
 *  Tracks per-user interaction history so replies can reference
 *  past conversations. Stored on /data volume, survives restarts.
 *
 *  Every reply sent and every mention received is logged here.
 *  When generating a new reply, the engine pulls the last N
 *  interactions with that user for context.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import { dataPath } from "./dataPaths.js";

const STATE_FILE = dataPath("conversation_memory.json");

export interface ConversationEntry {
  direction: "them" | "us";  // "them" = they said something, "us" = we replied
  text: string;
  tweetUrl?: string;
  timestamp: string;
}

interface UserConversation {
  username: string;
  firstInteraction: string;
  lastInteraction: string;
  totalInteractions: number;
  entries: ConversationEntry[];
}

interface ConversationMemoryState {
  conversations: Record<string, UserConversation>;  // keyed by lowercase username
  totalUsers: number;
  totalEntries: number;
}

function loadState(): ConversationMemoryState {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { conversations: {}, totalUsers: 0, totalEntries: 0 };
}

function saveState(s: ConversationMemoryState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

let state = loadState();

/**
 * Record that a community member said something to us (mention, reply, tag).
 */
export function recordIncoming(username: string, text: string, tweetUrl?: string): void {
  const key = username.toLowerCase().replace(/^@/, "");
  if (!state.conversations[key]) {
    state.conversations[key] = {
      username: key,
      firstInteraction: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      totalInteractions: 0,
      entries: [],
    };
    state.totalUsers++;
  }

  const convo = state.conversations[key];
  convo.entries.push({
    direction: "them",
    text: text.slice(0, 280), // cap storage
    tweetUrl,
    timestamp: new Date().toISOString(),
  });
  convo.totalInteractions++;
  convo.lastInteraction = new Date().toISOString();

  // Keep last 20 entries per user
  if (convo.entries.length > 20) {
    convo.entries = convo.entries.slice(-20);
  }

  state.totalEntries++;
  saveState(state);
}

/**
 * Record that Agent #306 replied to someone.
 */
export function recordOutgoing(username: string, text: string, tweetUrl?: string): void {
  const key = username.toLowerCase().replace(/^@/, "");
  if (!state.conversations[key]) {
    state.conversations[key] = {
      username: key,
      firstInteraction: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      totalInteractions: 0,
      entries: [],
    };
    state.totalUsers++;
  }

  const convo = state.conversations[key];
  convo.entries.push({
    direction: "us",
    text: text.slice(0, 280),
    tweetUrl,
    timestamp: new Date().toISOString(),
  });
  convo.totalInteractions++;
  convo.lastInteraction = new Date().toISOString();

  // Keep last 20 entries per user
  if (convo.entries.length > 20) {
    convo.entries = convo.entries.slice(-20);
  }

  state.totalEntries++;
  saveState(state);
}

/**
 * Get conversation history with a specific user (for prompt injection).
 * Returns most recent entries, formatted with relative timestamps.
 */
export function getConversationHistory(username: string, limit = 5): Array<{
  direction: "them" | "us";
  text: string;
  when: string;
}> {
  const key = username.toLowerCase().replace(/^@/, "");
  const convo = state.conversations[key];
  if (!convo || convo.entries.length === 0) return [];

  return convo.entries
    .slice(-limit)
    .map(e => ({
      direction: e.direction,
      text: e.text,
      when: timeAgo(e.timestamp),
    }));
}

/**
 * Get stats about a user's interaction history (for dashboard/context).
 */
export function getUserRelationship(username: string): {
  known: boolean;
  firstSeen: string | null;
  totalInteractions: number;
  lastInteraction: string | null;
} {
  const key = username.toLowerCase().replace(/^@/, "");
  const convo = state.conversations[key];
  if (!convo) return { known: false, firstSeen: null, totalInteractions: 0, lastInteraction: null };
  return {
    known: true,
    firstSeen: convo.firstInteraction,
    totalInteractions: convo.totalInteractions,
    lastInteraction: convo.lastInteraction,
  };
}

/**
 * Get full conversation memory state for the dashboard.
 */
export function getConversationMemoryState() {
  return {
    totalUsers: state.totalUsers,
    totalEntries: state.totalEntries,
    topUsers: Object.values(state.conversations)
      .sort((a, b) => b.totalInteractions - a.totalInteractions)
      .slice(0, 10)
      .map(c => ({
        username: c.username,
        totalInteractions: c.totalInteractions,
        firstInteraction: c.firstInteraction,
        lastInteraction: c.lastInteraction,
      })),
  };
}

// ── Helper ────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}
