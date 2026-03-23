// ─────────────────────────────────────────────────────────────────────────────
// NORMIES TV — COMMUNITY BOOST ENGINE
// Drop a link. Agent #306 reads it, understands it, drafts a shoutout.
// NormiesTV amplifies what the community is building.
// ─────────────────────────────────────────────────────────────────────────────

const GROK_API = "https://api.x.ai/v1/chat/completions";

export interface BoostContext {
  url:            string;
  creator:        string;
  contentType:    string;
  title:          string;
  summary:        string;
  whyItMatters:   string;
  normiesAngle:   string;
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

// ── Fetch page text for grounding Grok ───────────────────────────────────────
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
      .slice(0, 4000);
  } catch {
    return "";
  }
}

// ── Analyze link + generate shoutout in one Grok call ────────────────────────
export async function generateBoost(url: string, apiKey: string, userContext?: string): Promise<BoostDraft> {
  console.log(`[CommunityBoost] Analyzing: ${url}`);

  const contentType = detectContentType(url);

  // Try fetching page text — works for non-X URLs
  let pageText = "";
  if (!url.includes("x.com") && !url.includes("twitter.com")) {
    pageText = await fetchPageText(url);
  }

  // Build user content — priority: userContext > pageText > URL only
  const contextSource = userContext?.trim() || pageText;
  const userContent = contextSource
    ? `URL: ${url}\nContent type: ${contentType}\n\nContent / context provided:\n${contextSource}`
    : `URL: ${url}\nContent type: ${contentType}\n\nAnalyze this X post URL. Extract username from URL path. Use any context you can infer from the URL structure and your knowledge of the NORMIES ecosystem.`;

  // ── Step 1: Analyze context ────────────────────────────────────────────────
  const analysisRes = await fetch(GROK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-3",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a NORMIES NFT community analyst. Understand the NORMIES ecosystem:
- 10,000 pixel art PFPs on Ethereum. Phase 1: The Canvas (burn to customize). Phase 2: Arena + Zombies (May 15, 2026). Phase 3: Pixel Market.
- @serc1n is the ONLY founder. @normiesART is official. @nuclearsamurai created XNORMIES.
- Community vocab: "gnormies", "co-creators", "living evolutionary system", "the art IS the mechanics"
- Burns are rituals. The canvas is permanent. Everything is on-chain.

Analyze the provided content and return JSON:
{
  "creator": "@handle or name of the creator",
  "contentType": "article|tweet|thread|project|tool|artwork|marketplace",
  "title": "title or subject of the content",
  "summary": "2-3 sentences summarizing exactly what was created — be specific, not generic",
  "whyItMatters": "1-2 sentences on why this matters to NORMIES community specifically",
  "normiesAngle": "specific connection to NORMIES lore, phase structure, culture, or ecosystem"
}`
        },
        { role: "user", content: userContent }
      ]
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!analysisRes.ok) throw new Error(`Analysis failed: ${analysisRes.status}`);
  const analysisData = await analysisRes.json();
  const analysisRaw  = analysisData.choices?.[0]?.message?.content ?? "{}";
  let   analysis: any = {};
  try { analysis = JSON.parse(analysisRaw); } catch {}

  const context: BoostContext = {
    url,
    creator:      analysis.creator      ?? "community member",
    contentType:  analysis.contentType  ?? contentType,
    title:        analysis.title        ?? "",
    summary:      analysis.summary      ?? "",
    whyItMatters: analysis.whyItMatters ?? "",
    normiesAngle: analysis.normiesAngle ?? "",
  };

  // ── Determine show tag ─────────────────────────────────────────────────────
  let showTag = "[NORMIES COMMUNITY]";
  if (context.contentType === "article")                              showTag = "[NORMIES STORIES]";
  if (context.contentType === "artwork")                              showTag = "[NORMIES STORIES]";
  if (context.normiesAngle.toLowerCase().includes("arena"))          showTag = "[NORMIES ARENA]";
  if (context.normiesAngle.toLowerCase().includes("lore"))           showTag = "[NORMIES LORE]";
  if (context.normiesAngle.toLowerCase().includes("canvas") ||
      context.normiesAngle.toLowerCase().includes("burn"))           showTag = "[NORMIES FIELD REPORT]";

  // ── Step 2: Generate shoutout tweet ───────────────────────────────────────
  const tweetRes = await fetch(GROK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-3",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are Agent #306 — voice of NORMIES TV. Female. Fedora. Agent type. Token #306.
Low-key confident. Builder energy. Never hype, never desperate.
Core sentence: "I don't predict the future. I build it."

SHOUTOUT RULES:
- One post, up to 800 chars (URL will be appended separately — account for ~50 chars)
- Start with the show tag provided
- Name the creator by @handle in the opening line
- Be SPECIFIC about what they actually made — describe it, reference the actual work, give it context
- Connect to NORMIES thesis/culture if there's a genuine angle — don't force it if there isn't one
- Give the reader enough to understand WHY this matters before they click
- End with something that invites people in without begging
- NO exclamation points. NO LFG/WAGMI. NO "amazing work!!" or "check this out!!"
- DO use: gnormies 🖤 (sparingly), "co-creator", authentic NORMIES vocabulary
- Only @mention: @serc1n, @normiesART, @nuclearsamurai (never random people)
- Use line breaks between ideas for readability

Return JSON: { "tweet": "post text without URL", "imageHint": "Normie image suggestion or empty string" }`
        },
        {
          role: "user",
          content: `Write a shoutout for this community creation:

Creator: ${context.creator}
Type: ${context.contentType}
Title: ${context.title}
Summary: ${context.summary}
Why it matters: ${context.whyItMatters}
NORMIES connection: ${context.normiesAngle}
Show tag: ${showTag}

Up to 800 chars. Start with ${showTag}. Don't include the URL — it gets appended automatically.`
        }
      ]
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!tweetRes.ok) throw new Error(`Tweet generation failed: ${tweetRes.status}`);
  const tweetData = await tweetRes.json();
  const tweetRaw  = tweetData.choices?.[0]?.message?.content ?? "{}";
  let   tweetParsed: any = {};
  try { tweetParsed = JSON.parse(tweetRaw); } catch {}

  const tweetText = ((tweetParsed.tweet ?? "") + `\n\n${url}`).trim();

  console.log(`[CommunityBoost] Draft: ${tweetText.slice(0, 100)}...`);

  return {
    context,
    tweet:       tweetText,
    showTag,
    imageHint:   tweetParsed.imageHint ?? "",
    generatedAt: new Date().toISOString(),
  };
}
