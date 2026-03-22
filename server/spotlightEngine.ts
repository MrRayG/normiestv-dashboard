/**
 * ─────────────────────────────────────────────────────────────
 *  THE SPOTLIGHT — Weekly Holder Feature
 *
 *  Every week Agent #306 picks one co-creator and writes
 *  their story. Not a stat dump — a human portrait.
 *  Who they are. What they've built. Why it matters.
 *
 *  Posts every Sunday at 11am ET.
 *  The holder shares it. Their network finds NormiesTV.
 * ─────────────────────────────────────────────────────────────
 */

import { dataPath } from "./dataPaths.js";
import { getMostActive, getStorySourceHolders } from "./holderCatalog.js";
import fs from "fs";

const SPOTLIGHT_STATE_FILE = dataPath("spotlight_state.json");

interface SpotlightState {
  lastPostedAt: string | null;
  lastHolderUsername: string | null;
  previousHolders: string[]; // avoid repeating
  totalSpotlights: number;
}

function loadState(): SpotlightState {
  try {
    if (fs.existsSync(SPOTLIGHT_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SPOTLIGHT_STATE_FILE, "utf8"));
    }
  } catch {}
  return { lastPostedAt: null, lastHolderUsername: null, previousHolders: [], totalSpotlights: 0 };
}

function saveState(s: SpotlightState) {
  try { fs.writeFileSync(SPOTLIGHT_STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

let state = loadState();

/** Pick the best holder for this week's spotlight */
function pickSpotlightHolder(): { username: string; displayName: string; reason: string } | null {
  // Priority order:
  // 1. Story source holders (tagged serc1n or normiesART — real community engagement)
  // 2. Most active holders not recently spotlighted
  // 3. PFP rockers — confirmed Normies holders

  const storySources = getStorySourceHolders()
    .filter(h => !state.previousHolders.includes(h.username))
    .filter(h => !["NORMIES_TV", "normiesART", "serc1n", "YigitDuman"].includes(h.username));

  const mostActive = getMostActive(20)
    .filter(h => !state.previousHolders.includes(h.username))
    .filter(h => !["NORMIES_TV", "normiesART", "serc1n", "YigitDuman"].includes(h.username));

  const candidate = storySources[0] ?? mostActive[0];
  if (!candidate) return null;

  return {
    username: candidate.username,
    displayName: candidate.displayName ?? `@${candidate.username}`,
    reason: candidate.notes || `${candidate.signalWeight} signal weight, spotted ${candidate.signalTypes.join(", ")}`,
  };
}

/** Generate spotlight prompt for Grok */
export function buildSpotlightPrompt(holder: { username: string; displayName: string; reason: string }): string {
  return `You are Agent #306, narrator of NormiesTV.

Write THIS WEEK'S HOLDER SPOTLIGHT for @${holder.username}.

WHAT YOU KNOW ABOUT THEM: ${holder.reason}

THE SPOTLIGHT FORMAT:
This is a human portrait, not a stat dump. 3 parts:

1. OPENING LINE — one sentence that captures who this person is in the NORMIES ecosystem. Make it feel earned, not promotional. Specific, not generic.

2. THE STORY — 2-3 sentences. What have they done? What are they building? What does their activity on the Canvas say about them? Reference real signals if you have them.

3. THE CLOSE — one line that passes the mic to them. End with their @handle and a genuine call to the community.

RULES:
- Max 240 characters total for the tweet version
- No hype language. No "incredible" or "amazing" or "thrilled"
- This is a co-creator being celebrated by a fellow co-creator
- Agent #306 tone: warm, specific, low-key confident
- End with #NormiesTV #NORMIES

Respond with JSON:
{
  "tweet": "<240 char tweet for X>",
  "narrative": "<longer dashboard version, 2-3 paragraphs>",
  "holderUsername": "${holder.username}",
  "weekLabel": "<e.g. 'Week of March 22'>",
  "headline": "<short headline like 'The Builder in the Dark'>"
}`;
}

/** Generate and return spotlight content via Grok */
export async function generateSpotlight(grokKey: string): Promise<{
  tweet: string;
  narrative: string;
  holderUsername: string;
  weekLabel: string;
  headline: string;
} | null> {
  const holder = pickSpotlightHolder();
  if (!holder) {
    console.log("[Spotlight] No eligible holders found yet — catalog needs more signals");
    return null;
  }

  console.log(`[Spotlight] Generating spotlight for @${holder.username}`);

  const prompt = buildSpotlightPrompt(holder);

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` },
      body: JSON.stringify({
        model: "grok-3-fast",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
      }),
    });

    const data = await res.json() as any;
    const content = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");

    if (!content.tweet) return null;

    // Record this holder as spotlighted
    state.previousHolders.push(holder.username);
    if (state.previousHolders.length > 52) state.previousHolders.shift(); // keep 1 year
    state.totalSpotlights++;
    saveState(state);

    return content;
  } catch (e: any) {
    console.error("[Spotlight] Grok error:", e.message);
    return null;
  }
}

/** Post the spotlight to X */
export async function postSpotlight(xWrite: any, grokKey: string): Promise<string | null> {
  const spotlight = await generateSpotlight(grokKey);
  if (!spotlight) return null;

  try {
    const tweet = await xWrite.v2.tweet({ text: spotlight.tweet });
    const tweetId = tweet.data?.id;
    const tweetUrl = tweetId ? `https://x.com/NORMIES_TV/status/${tweetId}` : null;

    state.lastPostedAt = new Date().toISOString();
    state.lastHolderUsername = spotlight.holderUsername;
    saveState(state);

    console.log(`[Spotlight] Posted — ${tweetUrl}`);
    return tweetUrl;
  } catch (e: any) {
    console.error("[Spotlight] Post error:", e.message);
    return null;
  }
}

/** Schedule spotlight — every Sunday 11am ET (15:00 UTC) */
export function scheduleSpotlight(xWrite: any, grokKey: string) {
  function msUntilNextSunday11am(): number {
    const now = new Date();
    const target = new Date();
    // Find next Sunday
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    target.setUTCDate(now.getUTCDate() + daysUntilSunday);
    target.setUTCHours(15, 0, 0, 0); // 11am ET = 15:00 UTC
    return target.getTime() - now.getTime();
  }

  const ms = msUntilNextSunday11am();
  console.log(`[Spotlight] Next spotlight in ${Math.round(ms / 3600000)}h (Sunday 11am ET)`);

  setTimeout(() => {
    postSpotlight(xWrite, grokKey);
    setInterval(() => postSpotlight(xWrite, grokKey), 7 * 24 * 60 * 60 * 1000);
  }, ms);
}

export function getSpotlightState() { return state; }
