// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — COMMUNITY BOOST ENGINE (v2)
//
// Agent #306 doesn't amplify. She REACTS.
//
// Drop a tweet URL. She:
// 1. Reads the tweet text, author, engagement via Grok x_search
// 2. Reads the replies — what the community is actually saying
// 3. Looks at any image/media described
// 4. Forms her own opinion — what does this mean? What's the cultural angle?
// 5. Posts as a PARTICIPANT, not a media outlet
//
// The difference:
// OLD: "@user built this tool. Check it out."
// NEW: "@user posted something that made me stop. Here's why it matters
//       and here's my take on it. What do you think?"
// ─────────────────────────────────────────────────────────────────────────────

import { getFullAgentContext } from "./memoryEngine.js";

const GROK_CHAT_API     = "https://api.x.ai/v1/chat/completions";
const GROK_RESPONSE_API = "https://api.x.ai/v1/responses";

export interface BoostContext {
  url:             string;
  creator:         string;
  contentType:     string;
  title:           string;
  summary:         string;
  whyItMatters:    string;
  normiesAngle:    string;
  // NEW fields
  tweetText?:      string;    // actual tweet text if found
  replyHighlight?: string;    // most interesting community reply
  imageDescription?: string;  // what the image shows (if any)
  communityMood?:  string;    // how the community reacted
  agentTake?:      string;    // Agent #306's actual opinion
}

export interface BoostDraft {
  context:     BoostContext;
  tweet:       string;
  showTag:     string;
  imageHint:   string;
  generatedAt: string;
}

// ── Detect content type from URL ──────────────────────────────────────────────
function detectContentType(url: string): string {
  if (url.includes("x.com") || url.includes("twitter.com")) {
    if (url.includes("/article/")) return "article";
    return "tweet";
  }
  if (url.includes("mirror.xyz") || url.includes("paragraph.xyz")) return "article";
  if (url.includes("opensea.io") || url.includes("blur.io"))        return "marketplace";
  if (url.includes("github.com"))                                    return "tool";
  return "project";
}

// ── Step 1: Use Grok x_search to actually READ the tweet + replies ────────────
async function readTweetWithXSearch(url: string, apiKey: string): Promise<{
  tweetText: string;
  author: string;
  imageDescription: string;
  topReplies: string[];
  engagement: string;
  communityMood: string;
} | null> {
  try {
    const res = await fetch(GROK_RESPONSE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-fast",
        stream: false,
        input: [{
          role: "user",
          content: `Search X for this specific post and its replies: ${url}

Find:
1. The exact text of the post at that URL
2. The author's @handle
3. A description of any image or media attached (if any)
4. The top 3-5 replies — what is the community saying about it?
5. Approximate engagement (likes/replies/reposts if visible)
6. Overall community mood: are people excited? skeptical? curious? building on it?

Return JSON:
{
  "tweetText": "exact post text",
  "author": "@handle",
  "imageDescription": "what the image shows, or empty string",
  "topReplies": ["reply 1", "reply 2", "reply 3"],
  "engagement": "approximate engagement description",
  "communityMood": "one sentence on how the community reacted"
}`,
        }],
        tools: [{ type: "x_search" }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const outputMsg = data.output?.find((o: any) => o.type === "message");
    const rawText = outputMsg?.content?.find((c: any) => c.type === "output_text")?.text ?? "";

    if (!rawText) return null;

    const firstBrace = rawText.indexOf("{");
    const lastBrace  = rawText.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;

    return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

// ── Step 2: Also try fetching page text for non-X URLs ───────────────────────
async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch {
    return "";
  }
}

// ── Main: analyze + generate Agent #306's reactive post ──────────────────────
export async function generateBoost(url: string, apiKey: string, userContext?: string): Promise<BoostDraft> {
  console.log(`[CommunityBoost] Analyzing: ${url}`);

  const contentType = detectContentType(url);
  const isTweet = contentType === "tweet";

  // ── Gather all available context ─────────────────────────────────────────
  let tweetData: Awaited<ReturnType<typeof readTweetWithXSearch>> = null;
  let pageText = "";

  if (isTweet) {
    // For X posts: use Grok x_search to read the actual tweet + replies
    tweetData = await readTweetWithXSearch(url, apiKey);
  } else {
    // For other URLs: fetch page text
    pageText = await fetchPageText(url);
  }

  // Build the full context string for analysis
  const contextForAnalysis = userContext?.trim()
    || (tweetData ? `
Tweet by ${tweetData.author}: "${tweetData.tweetText}"
${tweetData.imageDescription ? `Image: ${tweetData.imageDescription}` : ""}
Community replies: ${tweetData.topReplies.join(" | ")}
Engagement: ${tweetData.engagement}
Community mood: ${tweetData.communityMood}
`.trim() : pageText)
    || `URL: ${url} (content not accessible — use any context available from the URL and NORMIES knowledge)`;

  // ── Step 3: Single Grok call — analyze + generate reactive post ────────────
  const agentCtx = getFullAgentContext();

  const res = await fetch(GROK_CHAT_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3-fast",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${agentCtx}

You are Agent #306 engaging with NORMIES community content.

THIS IS NOT A SHOUTOUT. This is Agent #306 reacting as a COMMUNITY MEMBER.

She reads the tweet. She reads the replies. She looks at the image. Then she has thoughts.
She shares those thoughts the way a smart, opinionated community member would — not like a media outlet covering a story.

ENGAGEMENT MODES (pick the one that fits):
- REACT: "This made me stop. Here's why..." — when something genuinely stands out
- ANALYZE: "I've been thinking about what @user posted. The image shows X. The community thinks Y. Here's my read..." — for content with real depth
- CHALLENGE: "I see this differently. @user is making a point about X but I think the real story is..." — when she disagrees or sees further
- CELEBRATE: "What @user just did deserves more attention. Not because it's impressive — because of what it signals about where we're going."

RULES:
- She uses the show tag appropriate to the content
- She @mentions the creator naturally in the post (not just in the opening line)
- She references specific details — the image, a specific reply, a number from the post
- She ends with a genuine question or open thread — inviting dialogue, not clicks
- Up to 1,500 chars (X Premium)
- NO exclamation points. NO LFG/WAGMI. Never desperate.
- She is part of this community. She speaks as one of them.`,
        },
        {
          role: "user",
          content: `Analyze this community content and generate Agent #306's reactive post:

URL: ${url}
Content type: ${contentType}

CONTENT:
${contextForAnalysis}

Return JSON:
{
  "creator": "@handle of the creator",
  "contentType": "tweet|article|tool|artwork|project|marketplace",
  "title": "what this is — short",
  "summary": "what they actually posted/built — specific, 2-3 sentences",
  "whyItMatters": "why this matters to NORMIES holders specifically",
  "normiesAngle": "connection to NORMIES lore, Canvas, Arena, Hive, or culture",
  "agentTake": "Agent #306's actual opinion — 1-2 sentences of her POV",
  "communityMood": "how the community reacted (if reply data available)",
  "showTag": "[NORMIES COMMUNITY] or [NORMIES FIELD REPORT] or [NORMIES STORIES] or [NORMIES SIGNAL]",
  "post": "the full post text Agent #306 will publish — up to 1500 chars, no URL",
  "imageHint": "which Normie image would pair well, or empty string"
}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(40000),
  });

  if (!res.ok) throw new Error(`Boost generation failed: ${res.status}`);

  const data    = await res.json();
  const raw     = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch {}

  const context: BoostContext = {
    url,
    creator:          parsed.creator          ?? "community member",
    contentType:      parsed.contentType      ?? contentType,
    title:            parsed.title            ?? "",
    summary:          parsed.summary          ?? "",
    whyItMatters:     parsed.whyItMatters     ?? "",
    normiesAngle:     parsed.normiesAngle     ?? "",
    tweetText:        tweetData?.tweetText    ?? "",
    replyHighlight:   tweetData?.topReplies?.[0] ?? "",
    imageDescription: tweetData?.imageDescription ?? "",
    communityMood:    parsed.communityMood    ?? tweetData?.communityMood ?? "",
    agentTake:        parsed.agentTake        ?? "",
  };

  const showTag = parsed.showTag ?? "[NORMIES COMMUNITY]";
  const postText = ((parsed.post ?? "") + `\n\n${url}`).trim();

  console.log(`[CommunityBoost] Draft (${postText.length} chars): ${postText.slice(0, 100)}...`);

  return {
    context,
    tweet:       postText,
    showTag,
    imageHint:   parsed.imageHint ?? "",
    generatedAt: new Date().toISOString(),
  };
}
