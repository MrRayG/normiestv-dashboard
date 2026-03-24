import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ArticlePreview {
  headline:    string;
  teaser:      string;
  body:        string;
  sourceUrl:   string;
  sourceTitle: string;
}

interface ArticleEntry {
  articleId:    string;
  postedAt:     string;
  sourceUrl:    string;
  sourceTitle:  string;
  headline:     string;
  tweetUrl?:    string;
  articleText?: string;
}

interface ArticleState {
  lastPostedAt: string | null;
  history:      ArticleEntry[];
}

// ── Style tokens ───────────────────────────────────────────────────────────────
const mono  = { fontFamily: "'Courier New', monospace" } as const;
const pixel = { fontFamily: "'Courier New', monospace", textTransform: "uppercase" as const, letterSpacing: "0.15em" } as const;

// ── Rich article body renderer ────────────────────────────────────────────────
// Renders markdown-style formatting:
//   ## Section Header  → bold header with orange underline
//   **text**           → bold orange accent text
//   > quote            → styled blockquote
//   Regular text       → clean paragraph
function ArticleBody({ body }: { body: string }) {
  if (!body) return null;

  const lines = body.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line → spacer
    if (!line.trim()) {
      elements.push(<div key={i} style={{ height: "0.65rem" }} />);
      i++;
      continue;
    }

    // ## Section header
    if (line.startsWith("## ")) {
      const text = line.replace(/^##\s*/, "");
      elements.push(
        <div key={i} style={{ marginTop: "1.8rem", marginBottom: "0.6rem" }}>
          <div style={{
            ...mono,
            fontSize: "0.62rem",
            color: "rgba(249,115,22,0.5)",
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            marginBottom: "0.35rem",
          }}>
            ── {text} ──
          </div>
          <div style={{ height: 1, background: "rgba(249,115,22,0.12)" }} />
        </div>
      );
      i++;
      continue;
    }

    // # Main header (article title in body — skip, shown above)
    if (line.startsWith("# ")) {
      i++;
      continue;
    }

    // > Blockquote
    if (line.startsWith("> ")) {
      const quoteText = line.replace(/^>\s*/, "");
      elements.push(
        <div key={i} style={{
          margin: "1rem 0",
          padding: "0.85rem 1.25rem",
          borderLeft: "3px solid rgba(249,115,22,0.4)",
          background: "rgba(249,115,22,0.04)",
        }}>
          <p style={{
            ...mono,
            fontSize: "0.78rem",
            color: "#e3e5e4",
            lineHeight: 1.8,
            margin: 0,
            fontStyle: "italic",
          }}>
            "{renderInlineMarkdown(quoteText)}"
          </p>
        </div>
      );
      i++;
      continue;
    }

    // --- horizontal rule
    if (line.trim() === "---") {
      elements.push(
        <div key={i} style={{
          margin: "1.5rem 0",
          height: 1,
          background: "rgba(227,229,228,0.08)",
        }} />
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} style={{
        ...mono,
        fontSize: "0.78rem",
        color: "rgba(227,229,228,0.82)",
        lineHeight: 1.85,
        margin: "0 0 0.1rem 0",
      }}>
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return <div>{elements}</div>;
}

// Inline markdown: **bold** and *italic*
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} style={{ color: "#f97316", fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={idx} style={{ color: "rgba(227,229,228,0.65)" }}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Generate" },
    { n: 2, label: "Review & Copy" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "2rem" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "unset" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: step >= s.n ? "#f97316" : "rgba(227,229,228,0.06)",
              border: `1px solid ${step >= s.n ? "#f97316" : "rgba(227,229,228,0.12)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{ ...mono, fontSize: "0.6rem", color: step >= s.n ? "#1a1b1c" : "rgba(227,229,228,0.3)", fontWeight: 700 }}>
                {step > s.n ? "✓" : s.n}
              </span>
            </div>
            <span style={{ ...mono, fontSize: "0.6rem", color: step >= s.n ? "#e3e5e4" : "rgba(227,229,228,0.3)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
              {s.label}
            </span>
          </div>
          {i < 2 && (
            <div style={{ flex: 1, height: 1, background: step > s.n ? "#f97316" : "rgba(227,229,228,0.08)", margin: "0 12px" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── History entry ──────────────────────────────────────────────────────────────
function HistoryCard({ entry }: { entry: ArticleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(entry.postedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div style={{
      border: "1px solid rgba(227,229,228,0.07)",
      background: "rgba(227,229,228,0.015)",
      marginBottom: "0.65rem",
      padding: "1rem 1.25rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: 0, marginBottom: 4, lineHeight: 1.5, fontWeight: 700 }}>
            {entry.headline}
          </p>
          <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)", margin: 0 }}>
            {date} · Source: {entry.sourceTitle}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          {entry.tweetUrl && (
            <a
              href={entry.tweetUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                ...mono, fontSize: "0.58rem", color: "#4ade80",
                border: "1px solid rgba(74,222,128,0.2)",
                padding: "3px 8px", textDecoration: "none",
                textTransform: "uppercase" as const, letterSpacing: "0.08em",
              }}
            >
              View on X →
            </a>
          )}
          {entry.articleText && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                ...mono, fontSize: "0.58rem", background: "transparent",
                border: "1px solid rgba(227,229,228,0.12)",
                color: "rgba(227,229,228,0.4)", cursor: "pointer",
                padding: "3px 8px", textTransform: "uppercase" as const, letterSpacing: "0.08em",
              }}
            >
              {expanded ? "Collapse" : "Read"}
            </button>
          )}
        </div>
      </div>

      {expanded && entry.articleText && (
        <div style={{
          marginTop: "1rem",
          paddingTop: "1rem",
          borderTop: "1px solid rgba(227,229,228,0.06)",
        }}>
          <ArticleBody body={entry.articleText} />
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function ArticleStudio() {
  const { toast } = useToast();

  const [preview, setPreview]   = useState<ArticlePreview | null>(null);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"studio" | "history">("studio");
  const [inputUrl, setInputUrl]   = useState("");
  const [genError, setGenError]   = useState<string | null>(null);

  const step: 1 | 2 | 3 = preview ? 2 : 1;

  // Load article history
  const { data: articleState } = useQuery<ArticleState>({
    queryKey: ["/api/article/state"],
    refetchInterval: 30_000,
  });

  // Preview mutation — Agent finds article + drafts Deep Read
  const previewMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (inputUrl.trim()) body.url = inputUrl.trim();
      const r = await apiRequest("POST", "/api/article/preview", body);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Preview generation failed");
      return data as ArticlePreview;
    },
    onSuccess: (data: ArticlePreview) => {
      setPreview(data);
      setPostedUrl(null);
      setGenError(null);
    },
    onError: (err: any) => {
      const msg = err.message ?? "Preview generation failed";
      setGenError(msg);
      toast({ title: "Preview failed", description: msg, variant: "destructive" });
    },
  });

  // Image download — generates 1200x500 PNG card for X Article header
  const [imgLoading, setImgLoading] = useState(false);

  async function downloadImage() {
    if (!preview) return;
    setImgLoading(true);
    try {
      // Use raw fetch — apiRequest consumes the body before blob() can read it
      const DASH_SECRET = (import.meta as any).env?.VITE_DASHBOARD_SECRET ?? "";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (DASH_SECRET) headers["x-dashboard-secret"] = DASH_SECRET;

      const r = await fetch("/api/article/image", {
        method: "POST",
        headers,
        body: JSON.stringify({
          headline:    preview.headline,
          sourceTitle: preview.sourceTitle,
          teaser:      preview.teaser,
          date:        new Date().toISOString().slice(0, 10),
        }),
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => "Image generation failed");
        let errMsg = errText;
        try { errMsg = JSON.parse(errText).error ?? errText; } catch {}
        toast({ title: "Image failed", description: errMsg, variant: "destructive" });
        return;
      }

      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `agent306-deep-read-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toast({ title: "Image downloaded — 1200×500 (5:2)" });
    } catch (e: any) {
      toast({ title: "Image failed", description: e.message, variant: "destructive" });
    } finally {
      setImgLoading(false);
    }
  }

      const r = await fetch("/api/article/image", {
        method: "POST",
        headers,
        body: JSON.stringify({
          headline:    preview.headline,
          sourceTitle: preview.sourceTitle,
          teaser:      preview.teaser,
          date:        new Date().toISOString().slice(0, 10),
        }),
      });

      if (!r.ok) {
        // Try to read error as JSON
        const errText = await r.text().catch(() => "Image generation failed");
        let errMsg = errText;
        try { errMsg = JSON.parse(errText).error ?? errText; } catch {}
        toast({ title: "Image failed", description: errMsg, variant: "destructive" });
        return;
      }

      // Read binary PNG and trigger download
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `agent306-deep-read-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Image downloaded — 1200×500 (5:2)" });
    } catch (e: any) {
      toast({ title: "Image failed", description: e.message, variant: "destructive" });
    } finally {
      setImgLoading(false);
    }
  }

  function reset() {
    setPreview(null);
    setPostedUrl(null);
    setGenError(null);
  }

  const lastPosted = articleState?.lastPostedAt
    ? new Date(articleState.lastPostedAt).toLocaleDateString("en-US", {
        weekday: "long", month: "short", day: "numeric",
      })
    : null;

  const nextMonday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const daysUntil = (1 - day + 7) % 7 || 7;
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + daysUntil);
    next.setUTCHours(22, 0, 0, 0);
    return next.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  })();

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1.5rem" }}>

      {/* Header */}
      <div style={{ marginBottom: "1.75rem" }}>
        <h1 style={{ ...pixel, fontSize: "0.85rem", color: "#f97316", margin: 0, marginBottom: 6 }}>
          ARTICLE STUDIO — THE DEEP READ
        </h1>
        <p style={{ ...mono, fontSize: "0.7rem", color: "rgba(227,229,228,0.45)", margin: 0, lineHeight: 1.6 }}>
          Agent #306 finds this week's most important AI article, performs a Deep Read across 70 years of context, and drafts a long-form X Article for your review.
        </p>
      </div>

      {/* Schedule status */}
      <div style={{
        display: "flex", gap: "1rem", marginBottom: "1.75rem", flexWrap: "wrap" as const,
      }}>
        <div style={{
          flex: 1, minWidth: 180,
          background: "rgba(249,115,22,0.04)",
          border: "1px solid rgba(249,115,22,0.12)",
          padding: "0.75rem 1rem",
        }}>
          <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(249,115,22,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", margin: 0, marginBottom: 4 }}>Auto-Schedule</p>
          <p style={{ ...mono, fontSize: "0.7rem", color: "#f97316", margin: 0 }}>Every Monday · 5:00 PM ET</p>
        </div>
        <div style={{
          flex: 1, minWidth: 180,
          background: "rgba(227,229,228,0.02)",
          border: "1px solid rgba(227,229,228,0.07)",
          padding: "0.75rem 1rem",
        }}>
          <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.15em", margin: 0, marginBottom: 4 }}>Last Published</p>
          <p style={{ ...mono, fontSize: "0.7rem", color: "#e3e5e4", margin: 0 }}>{lastPosted ?? "None yet"}</p>
        </div>
        <div style={{
          flex: 1, minWidth: 180,
          background: "rgba(167,139,250,0.03)",
          border: "1px solid rgba(167,139,250,0.1)",
          padding: "0.75rem 1rem",
        }}>
          <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(167,139,250,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", margin: 0, marginBottom: 4 }}>Next Auto-Post</p>
          <p style={{ ...mono, fontSize: "0.7rem", color: "#a78bfa", margin: 0 }}>{nextMonday}</p>
        </div>
        <div style={{
          flex: 1, minWidth: 180,
          background: "rgba(45,212,191,0.02)",
          border: "1px solid rgba(45,212,191,0.08)",
          padding: "0.75rem 1rem",
        }}>
          <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(45,212,191,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.15em", margin: 0, marginBottom: 4 }}>Published</p>
          <p style={{ ...mono, fontSize: "0.7rem", color: "#2dd4bf", margin: 0 }}>{articleState?.history?.length ?? 0} articles</p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: "1.5rem", borderBottom: "1px solid rgba(227,229,228,0.08)" }}>
        {(["studio", "history"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...mono, fontSize: "0.65rem", textTransform: "uppercase" as const, letterSpacing: "0.12em",
              background: "transparent", border: "none",
              borderBottom: activeTab === tab ? "2px solid #f97316" : "2px solid transparent",
              color: activeTab === tab ? "#f97316" : "rgba(227,229,228,0.35)",
              padding: "0.6rem 1.25rem",
              cursor: "pointer",
              marginBottom: -1,
              transition: "color 0.15s",
            }}
          >
            {tab === "studio" ? "Studio" : `History (${articleState?.history?.length ?? 0})`}
          </button>
        ))}
      </div>

      {/* ── STUDIO TAB ── */}
      {activeTab === "studio" && (
        <>
          <StepBar step={step} />

          {/* STEP 1 — Generate */}
          <div style={{
            border: `1px solid ${step === 1 ? "rgba(249,115,22,0.2)" : "rgba(227,229,228,0.06)"}`,
            background: "rgba(227,229,228,0.015)",
            padding: "1.5rem",
            marginBottom: "1.25rem",
          }}>
            <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(249,115,22,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: "1rem" }}>
              1 — Generate Deep Read
            </p>

            <p style={{ ...mono, fontSize: "0.7rem", color: "rgba(227,229,228,0.55)", marginBottom: "1.25rem", lineHeight: 1.7 }}>
              Agent #306 will scan global news for this week's most important AI story — preferably breaking or hot — then perform a Deep Read cross-referencing 70 years of AI history and forward-project the next 70.
            </p>

            {/* Optional direct URL */}
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ ...mono, fontSize: "0.55rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.12em", marginBottom: "0.5rem" }}>
                Direct URL (optional) — paste a specific article for Agent #306 to Deep Read
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  placeholder="https://... paste article URL, or leave blank for auto-discovery"
                  style={{
                    flex: 1, background: "rgba(227,229,228,0.04)",
                    border: "1px solid rgba(227,229,228,0.1)", color: "#e3e5e4",
                    ...mono, fontSize: "0.68rem", padding: "0.55rem 0.85rem",
                    outline: "none", borderRadius: 0,
                  }}
                />
                {inputUrl && (
                  <button
                    onClick={() => setInputUrl("")}
                    style={{
                      background: "transparent", border: "1px solid rgba(227,229,228,0.1)",
                      color: "rgba(227,229,228,0.35)", ...mono, fontSize: "0.62rem",
                      padding: "0.55rem 0.75rem", cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              {inputUrl && (
                <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(45,212,191,0.5)", marginTop: 4 }}>
                  Agent #306 will Deep Read this specific article
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const }}>
              <button
                onClick={() => { setGenError(null); previewMutation.mutate(); }}
                disabled={previewMutation.isPending}
                style={{
                  background: previewMutation.isPending ? "rgba(249,115,22,0.15)" : "#f97316",
                  color: previewMutation.isPending ? "rgba(249,115,22,0.4)" : "#1a1b1c",
                  border: "none", ...mono, fontSize: "0.7rem", fontWeight: 700,
                  padding: "0.7rem 1.5rem",
                  cursor: previewMutation.isPending ? "not-allowed" : "pointer",
                  textTransform: "uppercase" as const, letterSpacing: "0.08em",
                }}
              >
                {previewMutation.isPending
                  ? (inputUrl ? "Agent #306 is reading..." : "Scanning news · deep reading...")
                  : (inputUrl ? "Deep Read This Article →" : "Generate Deep Read →")}
              </button>

              {previewMutation.isPending && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f97316", animation: "article-pulse 1.2s infinite" }} />
                  <span style={{ ...mono, fontSize: "0.62rem", color: "rgba(249,115,22,0.5)" }}>
                    {inputUrl ? "Fetching article · cross-referencing 70 years · drafting..." : "Scanning news · reading article · cross-referencing 70 years · drafting..."}
                  </span>
                </div>
              )}
            </div>

            {/* Error display */}
            {genError && !previewMutation.isPending && (
              <div style={{
                marginTop: "1rem",
                padding: "0.85rem 1rem",
                background: "rgba(248,113,113,0.06)",
                border: "1px solid rgba(248,113,113,0.2)",
                borderLeft: "3px solid #f87171",
              }}>
                <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(248,113,113,0.7)", textTransform: "uppercase" as const, letterSpacing: "0.12em", margin: 0, marginBottom: 4 }}>Error</p>
                <p style={{ ...mono, fontSize: "0.68rem", color: "#f87171", margin: 0, lineHeight: 1.6 }}>{genError}</p>
                <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", margin: "0.5rem 0 0" }}>
                  Try again — or paste a direct article URL above to skip auto-discovery.
                </p>
              </div>
            )}
          </div>

          {/* STEP 2 — Review */}
          {preview && !postedUrl && (
            <div style={{
              border: "1px solid rgba(249,115,22,0.2)",
              background: "rgba(249,115,22,0.015)",
              padding: "1.5rem",
              marginBottom: "1.25rem",
            }}>
              <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(249,115,22,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: "1.5rem" }}>
                2 — Review Draft
              </p>

              {/* Source */}
              <div style={{
                padding: "0.85rem 1rem",
                background: "rgba(227,229,228,0.02)",
                border: "1px solid rgba(227,229,228,0.07)",
                marginBottom: "1.5rem",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.12em", margin: 0, marginBottom: 4 }}>Source Article</p>
                  <p style={{ ...mono, fontSize: "0.7rem", color: "#e3e5e4", margin: 0, marginBottom: 4 }}>{preview.sourceTitle}</p>
                  <a
                    href={preview.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...mono, fontSize: "0.6rem", color: "rgba(249,115,22,0.5)", textDecoration: "none" }}
                  >
                    {preview.sourceUrl.slice(0, 72)}...
                  </a>
                </div>
              </div>

              {/* Teaser */}
              <div style={{ marginBottom: "1.5rem" }}>
                <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(45,212,191,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: "0.6rem" }}>
                  X Teaser Post (280 chars)
                </p>
                <div style={{
                  padding: "1rem",
                  background: "rgba(45,212,191,0.03)",
                  border: "1px solid rgba(45,212,191,0.12)",
                  borderLeft: "3px solid rgba(45,212,191,0.4)",
                }}>
                  <p style={{ ...mono, fontSize: "0.75rem", color: "#e3e5e4", margin: 0, lineHeight: 1.7, fontStyle: "italic" }}>
                    {preview.teaser}
                  </p>
                  <p style={{ ...mono, fontSize: "0.55rem", color: "rgba(227,229,228,0.25)", margin: "0.5rem 0 0" }}>
                    {preview.teaser.length}/280 chars
                  </p>
                </div>
              </div>

              {/* Article headline */}
              <div style={{ marginBottom: "1.25rem" }}>
                <p style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: "0.6rem" }}>
                  Article Headline
                </p>
                <h2 style={{
                  ...mono, fontSize: "1.1rem", color: "#e3e5e4",
                  margin: 0, lineHeight: 1.4, fontWeight: 700,
                }}>
                  {preview.headline}
                </h2>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: "rgba(227,229,228,0.07)", margin: "1.25rem 0" }} />

              {/* Article body */}
              <div style={{
                padding: "1.5rem 1.75rem",
                background: "rgba(14,15,16,0.6)",
                border: "1px solid rgba(227,229,228,0.06)",
                maxHeight: "60vh",
                overflowY: "auto",
              }}>
                <div style={{
                  borderBottom: "1px solid rgba(249,115,22,0.15)",
                  marginBottom: "1.5rem",
                  paddingBottom: "0.75rem",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <img
                    src="https://api.normies.art/normie/306/image.png"
                    alt="#306"
                    style={{ width: 28, height: 28, imageRendering: "pixelated", borderRadius: 2 }}
                  />
                  <div>
                    <p style={{ ...mono, fontSize: "0.6rem", color: "#f97316", margin: 0, fontWeight: 700 }}>Agent #306 — The Deep Read</p>
                    <p style={{ ...mono, fontSize: "0.55rem", color: "rgba(227,229,228,0.3)", margin: 0 }}>agent306.eth · NORMIES TV</p>
                  </div>
                </div>

                <ArticleBody body={preview.body} />

                <div style={{
                  marginTop: "2rem", paddingTop: "1rem",
                  borderTop: "1px solid rgba(227,229,228,0.06)",
                }}>
                  <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.25)", margin: 0 }}>
                    Agent #306 · NORMIES TV · agent306.eth
                  </p>
                  <a
                    href={preview.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...mono, fontSize: "0.58rem", color: "rgba(249,115,22,0.4)", display: "block", marginTop: 4 }}
                  >
                    Source: {preview.sourceTitle}
                  </a>
                </div>
              </div>

              {/* Word count */}
              <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.25)", marginTop: "0.65rem" }}>
                {preview.body.split(/\s+/).filter(Boolean).length} words · Long-form X Article format
              </p>

              {/* How to post guide */}
              <div style={{
                marginTop: "1rem",
                padding: "0.85rem 1rem",
                background: "rgba(45,212,191,0.03)",
                border: "1px solid rgba(45,212,191,0.1)",
                borderLeft: "3px solid rgba(45,212,191,0.3)",
              }}>
                <p style={{ ...mono, fontSize: "0.55rem", color: "rgba(45,212,191,0.6)", textTransform: "uppercase" as const, letterSpacing: "0.12em", margin: 0, marginBottom: 6 }}>
                  How to post on X
                </p>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                  {["1 — Download the image below (1200×500, 5:2)", "2 — Copy Article text", "3 — Go to X → Create Article → paste headline + body", "4 — Upload the image as the article header", "5 — Publish"].map(step => (
                    <p key={step} style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.45)", margin: 0 }}>{step}</p>
                  ))}
                </div>
              </div>

              {/* Action row */}
              <div style={{ display: "flex", gap: 10, marginTop: "1.25rem", flexWrap: "wrap" as const, alignItems: "center" }}>

                {/* DOWNLOAD IMAGE */}
                <button
                  onClick={downloadImage}
                  disabled={imgLoading}
                  style={{
                    background: imgLoading ? "rgba(249,115,22,0.15)" : "#f97316",
                    color: imgLoading ? "rgba(249,115,22,0.4)" : "#1a1b1c",
                    border: "none", ...mono, fontSize: "0.7rem", fontWeight: 700,
                    padding: "0.7rem 1.5rem",
                    cursor: imgLoading ? "not-allowed" : "pointer",
                    letterSpacing: "0.08em", textTransform: "uppercase" as const,
                  }}
                >
                  {imgLoading ? "Generating image..." : "↓ Download Header Image (1200×500)"}
                </button>

                {/* COPY ARTICLE */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${preview.headline}\n\n${preview.body}`);
                    toast({ title: "Article copied — paste into X Article editor" });
                  }}
                  style={{
                    background: "#4ade80", color: "#1a1b1c",
                    border: "none", ...mono, fontSize: "0.7rem", fontWeight: 700,
                    padding: "0.7rem 1.5rem", cursor: "pointer",
                    letterSpacing: "0.08em", textTransform: "uppercase" as const,
                  }}
                >
                  Copy Article Text →
                </button>

                {/* COPY TEASER */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(preview.teaser);
                    toast({ title: "Teaser copied — paste as your X post" });
                  }}
                  style={{
                    background: "transparent", ...mono, fontSize: "0.65rem",
                    color: "rgba(45,212,191,0.6)", border: "1px solid rgba(45,212,191,0.2)",
                    padding: "0.7rem 1rem", cursor: "pointer",
                    textTransform: "uppercase" as const, letterSpacing: "0.08em",
                  }}
                >
                  Copy Teaser
                </button>

                {/* REGENERATE */}
                <button
                  onClick={() => { setGenError(null); previewMutation.mutate(); }}
                  disabled={previewMutation.isPending}
                  style={{
                    background: "transparent", ...mono, fontSize: "0.65rem",
                    color: "rgba(167,139,250,0.5)", border: "1px solid rgba(167,139,250,0.15)",
                    padding: "0.7rem 1rem", cursor: previewMutation.isPending ? "not-allowed" : "pointer",
                    textTransform: "uppercase" as const, letterSpacing: "0.08em",
                  }}
                >
                  {previewMutation.isPending ? "..." : "Regenerate"}
                </button>

                {/* DISCARD */}
                <button
                  onClick={reset}
                  style={{
                    background: "transparent", ...mono, fontSize: "0.65rem",
                    color: "rgba(227,229,228,0.2)", border: "none",
                    padding: "0.7rem 0.5rem", cursor: "pointer",
                    textTransform: "uppercase" as const, letterSpacing: "0.08em",
                  }}
                >
                  New Article
                </button>
              </div>
            </div>
          )}



          {/* Empty state */}
          {step === 1 && !previewMutation.isPending && (
            <div style={{
              marginTop: "0.75rem",
              border: "1px solid rgba(167,139,250,0.08)",
              background: "rgba(167,139,250,0.015)",
              padding: "1.25rem 1.5rem",
            }}>
              <p style={{ ...mono, fontSize: "0.56rem", color: "rgba(167,139,250,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.15em", marginBottom: "0.85rem" }}>
                The Deep Read Format
              </p>
              {[
                ["Discovery",         "Agent #306 scans global news for the week's most significant AI story — breaking news, turning points, and moments that most people haven't processed yet."],
                ["Deep Read",         "She cross-references the article against 70 years of AI history — from the 1956 Dartmouth Workshop through AI Winters, neural networks, and the current agent era."],
                ["Forward Projection","She projects what it means for the next 70 years. AGI timelines. Human-AI symbiosis. Autonomous economies. The civilizational implications most analysts won't touch."],
                ["X Article Format",  "800–1,500 words. Bold section headers. Blockquote citations. Clean typography. Published as a long-form X Article with a teaser tweet to drive readers in."],
              ].map(([title, desc]) => (
                <div key={title} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(167,139,250,0.05)", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ ...mono, fontSize: "0.63rem", color: "#a78bfa", display: "block", marginBottom: 2 }}>{title}</span>
                    <span style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)", lineHeight: 1.6 }}>{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === "history" && (
        <div>
          {!articleState?.history?.length ? (
            <div style={{
              padding: "2rem",
              border: "1px solid rgba(227,229,228,0.07)",
              background: "rgba(227,229,228,0.015)",
              textAlign: "center" as const,
            }}>
              <p style={{ ...mono, fontSize: "0.7rem", color: "rgba(227,229,228,0.3)", margin: 0 }}>
                No articles published yet. Generate your first Deep Read above.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginBottom: "1rem", textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>
                {articleState.history.length} article{articleState.history.length !== 1 ? "s" : ""} published
              </p>
              {articleState.history.map((entry) => (
                <HistoryCard key={entry.articleId} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes article-pulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.7)} }
      `}</style>
    </div>
  );
}
