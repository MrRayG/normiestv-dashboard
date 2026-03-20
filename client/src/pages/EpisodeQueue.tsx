import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Send, CheckCircle2, Clock, Loader2, ExternalLink,
  Zap, RefreshCw, Copy, Twitter, Edit2, X as XIcon
} from "lucide-react";
import { useState } from "react";
import type { Episode } from "@shared/schema";

// ── helpers ──────────────────────────────────────────────────────────
function buildTweet(ep: Episode): string {
  const base = ep.narrative.slice(0, 230);
  return `${base}\n\n#NormiesTV #Normies #NFT #Web3`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };

// ── Pending card — the main action item ──────────────────────────────
function PendingCard({
  ep, onPost, isPosting,
}: {
  ep: Episode;
  onPost: (ep: Episode, text: string) => void;
  isPosting: boolean;
}) {
  const [tweet, setTweet] = useState(() => buildTweet(ep));
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const charCount = tweet.length;
  const overLimit = charCount > 280;

  // Robust copy — works in iframes and non-HTTPS contexts
  const handleCopy = async () => {
    let ok = false;
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(tweet);
        ok = true;
      } catch {}
    }
    // Fallback: create a temporary textarea and execCommand
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = tweet;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    toast({ title: ok ? "Copied!" : "Select & copy manually", description: ok ? "Now paste into X" : "Text is selected below" });
    setTimeout(() => setCopied(false), 3000);
  };

  // Build X intent URL — pre-populates the compose box
  const xIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;

  return (
    <div style={{
      border: "1px solid rgba(249,115,22,0.35)",
      background: "rgba(249,115,22,0.04)",
      padding: "1.25rem",
      marginBottom: 12,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <img
          src={`https://api.normies.art/normie/${ep.tokenId}/image.svg`}
          alt={`#${ep.tokenId}`}
          style={{ width: 44, height: 44, imageRendering: "pixelated", border: "1px solid rgba(227,229,228,0.15)", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{
              ...mono, fontSize: "0.6rem", padding: "2px 7px",
              background: "rgba(249,115,22,0.15)", color: "#f97316",
              textTransform: "uppercase", letterSpacing: "0.12em",
            }}>
              Ready to Post
            </span>
            <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.35)" }}>
              #{ep.tokenId} · {timeAgo(ep.createdAt)}
            </span>
          </div>
          <p style={{ ...mono, fontSize: "0.78rem", color: "#e3e5e4", fontWeight: 600 }}>{ep.title}</p>
        </div>
      </div>

      {/* Tweet preview / editor */}
      <div style={{
        background: "rgba(227,229,228,0.03)",
        border: "1px solid rgba(227,229,228,0.10)",
        padding: "0.85rem",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Twitter style={{ width: 11, height: 11, color: "#e3e5e4" }} />
            <span style={{ ...mono, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(227,229,228,0.4)" }}>
              Tweet preview
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              ...mono, fontSize: "0.6rem",
              color: overLimit ? "#ef4444" : "rgba(227,229,228,0.35)",
            }}>
              {charCount}/280
            </span>
            <button
              onClick={() => setEditing(!editing)}
              style={{
                ...mono, fontSize: "0.58rem", display: "flex", alignItems: "center", gap: 4,
                background: "none", border: "none", cursor: "pointer",
                color: editing ? "#f97316" : "rgba(227,229,228,0.4)",
                padding: "2px 6px",
              }}
            >
              <Edit2 style={{ width: 10, height: 10 }} />
              {editing ? "Done" : "Edit"}
            </button>
          </div>
        </div>

        {editing ? (
          <textarea
            value={tweet}
            onChange={e => setTweet(e.target.value)}
            rows={5}
            style={{
              ...mono, fontSize: "0.72rem", width: "100%", boxSizing: "border-box",
              background: "rgba(227,229,228,0.05)", border: "1px solid rgba(227,229,228,0.15)",
              color: "#e3e5e4", padding: "0.6rem", resize: "vertical",
              outline: "none", lineHeight: 1.6,
            }}
          />
        ) : (
          <p style={{
            ...mono, fontSize: "0.72rem", color: "#e3e5e4",
            lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0,
          }}>
            {tweet}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Primary: Copy to clipboard — works without X API */}
        <button
          onClick={handleCopy}
          style={{
            flex: "1 1 auto",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "0.65rem 1.2rem",
            background: copied ? "rgba(74,222,128,0.15)" : "rgba(249,115,22,0.18)",
            border: `1px solid ${copied ? "rgba(74,222,128,0.4)" : "rgba(249,115,22,0.5)"}`,
            color: copied ? "#4ade80" : "#f97316",
            cursor: "pointer",
            ...mono, fontSize: "0.72rem", textTransform: "uppercase" as const, letterSpacing: "0.12em",
          }}
        >
          {copied
            ? <><CheckCircle2 style={{ width: 13, height: 13 }} /> Copied — paste into X</>
            : <><Copy style={{ width: 13, height: 13 }} /> Copy &amp; Post to X</>
          }
        </button>

        {/* Open X intent URL — pre-populates compose box with tweet text */}
        <a
          href={xIntentUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0.65rem 1rem",
            background: "rgba(249,115,22,0.10)",
            border: "1px solid rgba(249,115,22,0.35)",
            color: "#f97316", textDecoration: "none",
            ...mono, fontSize: "0.68rem", textTransform: "uppercase" as const, letterSpacing: "0.1em",
          }}
        >
          <Twitter style={{ width: 12, height: 12 }} />
          Post on X
        </a>

        {/* Mark as posted manually */}
        <button
          onClick={() => onPost(ep, tweet)}
          disabled={isPosting}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0.65rem 1rem",
            background: "rgba(227,229,228,0.03)",
            border: "1px solid rgba(227,229,228,0.12)",
            color: "rgba(227,229,228,0.45)",
            cursor: isPosting ? "not-allowed" : "pointer",
            ...mono, fontSize: "0.62rem", textTransform: "uppercase" as const, letterSpacing: "0.1em",
          }}
        >
          {isPosting
            ? <><Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> Marking...</>
            : <><CheckCircle2 style={{ width: 11, height: 11 }} /> Mark Posted</>
          }
        </button>
      </div>

      {/* Instruction */}
      <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.25)", marginTop: 8 }}>
        → Click <strong style={{color:"rgba(227,229,228,0.45)"}}>Post on X</strong> to open X with the tweet pre-filled — just hit Post. Then click <strong style={{color:"rgba(227,229,228,0.45)"}}>Mark Posted</strong> to log it here.
      </p>
    </div>
  );
}

// ── Posted card — compact history row ────────────────────────────────
function PostedCard({ ep }: { ep: Episode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "0.75rem 1rem",
      border: "1px solid rgba(74,222,128,0.12)",
      background: "rgba(74,222,128,0.03)",
      marginBottom: 6,
    }}>
      <img
        src={`https://api.normies.art/normie/${ep.tokenId}/image.svg`}
        alt={`#${ep.tokenId}`}
        style={{ width: 32, height: 32, imageRendering: "pixelated", border: "1px solid rgba(227,229,228,0.1)", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...mono, fontSize: "0.7rem", color: "#e3e5e4", marginBottom: 2 }}>{ep.title}</p>
        <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)" }}>
          Posted {ep.postedAt ? timeAgo(ep.postedAt) : ""}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{
          ...mono, fontSize: "0.55rem", padding: "2px 7px",
          background: "rgba(74,222,128,0.12)", color: "#4ade80",
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>Posted</span>
        {ep.videoUrl && (
          <a href={ep.videoUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "#4ade80", display: "flex", alignItems: "center", gap: 3, textDecoration: "none", ...mono, fontSize: "0.6rem" }}>
            <ExternalLink style={{ width: 11, height: 11 }} /> View
          </a>
        )}
      </div>
    </div>
  );
}

// ── Draft card — compact ──────────────────────────────────────────────
function DraftCard({ ep, onMarkReady }: { ep: Episode; onMarkReady: (id: number) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "0.75rem 1rem",
      border: "1px solid rgba(227,229,228,0.08)",
      marginBottom: 6,
    }}>
      <img
        src={`https://api.normies.art/normie/${ep.tokenId}/image.svg`}
        alt={`#${ep.tokenId}`}
        style={{ width: 32, height: 32, imageRendering: "pixelated", border: "1px solid rgba(227,229,228,0.1)", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...mono, fontSize: "0.7rem", color: "#e3e5e4", marginBottom: 2 }}>{ep.title}</p>
        <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineClamp: 1 }}>
          {ep.narrative.slice(0, 80)}...
        </p>
      </div>
      <button
        onClick={() => onMarkReady(ep.id)}
        style={{
          ...mono, fontSize: "0.6rem", padding: "0.4rem 0.8rem",
          background: "rgba(227,229,228,0.06)", border: "1px solid rgba(227,229,228,0.15)",
          color: "rgba(227,229,228,0.6)", cursor: "pointer", flexShrink: 0,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}
      >
        Approve
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function EpisodeQueue() {
  const { toast } = useToast();
  const [postingId, setPostingId] = useState<number | null>(null);

  const { data: episodes = [], isLoading, refetch } = useQuery<Episode[]>({
    queryKey: ["/api/episodes"],
    refetchInterval: 20_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, videoUrl }: { id: number; status: string; videoUrl?: string }) =>
      apiRequest("PATCH", `/api/episodes/${id}/status`, { status, videoUrl }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/episodes"] }),
  });

  const pollerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/poller/run"),
    onSuccess: () => {
      toast({ title: "Generating episode…", description: "New post will appear in ~15 seconds" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/episodes"] }), 15_000);
    },
  });

  const handleMarkPosted = (ep: Episode, text: string) => {
    setPostingId(ep.id);
    updateStatusMutation.mutate(
      { id: ep.id, status: "posted" },
      {
        onSuccess: () => {
          setPostingId(null);
          toast({ title: "Marked as posted", description: ep.title });
        },
        onError: () => setPostingId(null),
      }
    );
  };

  const pending = episodes.filter(e => e.status === "ready");
  const drafts  = episodes.filter(e => e.status === "draft");
  const posted  = episodes.filter(e => e.status === "posted");

  return (
    <div style={{ padding: "1.75rem", maxWidth: 780 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Send style={{ color: "#f97316", width: 15, height: 15 }} />
            <span style={{ ...mono, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(227,229,228,0.4)" }}>
              Post Queue
            </span>
          </div>
          <h1 style={{ ...mono, fontSize: "1.3rem", color: "#e3e5e4", margin: 0, letterSpacing: "0.05em" }}>
            APPROVE &amp; POST
          </h1>
          <p style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.35)", marginTop: 3 }}>
            Review generated episodes · copy tweet · post to @NORMIES_TV
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => pollerMutation.mutate()}
            disabled={pollerMutation.isPending}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0.5rem 1rem",
              background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.35)",
              color: "#f97316", cursor: "pointer",
              ...mono, fontSize: "0.65rem", textTransform: "uppercase" as const, letterSpacing: "0.1em",
            }}
          >
            {pollerMutation.isPending
              ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
              : <Zap style={{ width: 12, height: 12 }} />
            }
            Generate
          </button>
          <button
            onClick={() => refetch()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "0.5rem 1rem",
              background: "rgba(227,229,228,0.05)", border: "1px solid rgba(227,229,228,0.12)",
              color: "rgba(227,229,228,0.5)", cursor: "pointer",
              ...mono, fontSize: "0.65rem",
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
        {[
          { label: "Pending", value: pending.length, color: "#f97316" },
          { label: "Drafts",  value: drafts.length,  color: "rgba(227,229,228,0.4)" },
          { label: "Posted",  value: posted.length,  color: "#4ade80" },
          { label: "Total",   value: episodes.length, color: "rgba(227,229,228,0.6)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, padding: "0.75rem",
            background: "rgba(227,229,228,0.03)", border: "1px solid rgba(227,229,228,0.08)",
            textAlign: "center",
          }}>
            <p style={{ ...mono, fontSize: "1.3rem", fontWeight: 700, color, margin: 0 }}>{value}</p>
            <p style={{ ...mono, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(227,229,228,0.3)", marginTop: 2 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── PENDING SECTION ── */}
      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Clock style={{ width: 13, height: 13, color: "#f97316" }} />
          <span style={{ ...mono, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.16em", color: "#f97316" }}>
            Pending Approval
          </span>
          {pending.length > 0 && (
            <span style={{
              ...mono, fontSize: "0.58rem", padding: "1px 7px",
              background: "rgba(249,115,22,0.2)", color: "#f97316",
              borderRadius: 999,
            }}>{pending.length}</span>
          )}
        </div>

        {isLoading ? (
          <div style={{ height: 120, background: "rgba(227,229,228,0.04)", animation: "pulse 1.5s infinite" }} />
        ) : pending.length === 0 ? (
          <div style={{
            padding: "2rem", textAlign: "center",
            border: "1px dashed rgba(249,115,22,0.2)",
            background: "rgba(249,115,22,0.02)",
          }}>
            <p style={{ ...mono, fontSize: "0.7rem", color: "rgba(227,229,228,0.35)", marginBottom: 10 }}>
              No episodes pending — generate one from live on-chain data
            </p>
            <button
              onClick={() => pollerMutation.mutate()}
              disabled={pollerMutation.isPending}
              style={{
                ...mono, fontSize: "0.65rem", padding: "0.5rem 1.2rem",
                background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.4)",
                color: "#f97316", cursor: "pointer",
                textTransform: "uppercase", letterSpacing: "0.1em",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <Zap style={{ width: 12, height: 12 }} /> Generate Now
            </button>
          </div>
        ) : (
          pending.map(ep => (
            <PendingCard
              key={ep.id}
              ep={ep}
              onPost={handleMarkPosted}
              isPosting={postingId === ep.id}
            />
          ))
        )}
      </div>

      {/* ── DRAFTS SECTION ── */}
      {drafts.length > 0 && (
        <div style={{ marginBottom: "1.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ ...mono, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.16em", color: "rgba(227,229,228,0.4)" }}>
              Drafts
            </span>
          </div>
          {drafts.map(ep => (
            <DraftCard
              key={ep.id}
              ep={ep}
              onMarkReady={id => updateStatusMutation.mutate({ id, status: "ready" })}
            />
          ))}
        </div>
      )}

      {/* ── POSTED HISTORY ── */}
      {posted.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <CheckCircle2 style={{ width: 13, height: 13, color: "#4ade80" }} />
            <span style={{ ...mono, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.16em", color: "#4ade80" }}>
              Posted History
            </span>
          </div>
          {posted.map(ep => <PostedCard key={ep.id} ep={ep} />)}
        </div>
      )}

    </div>
  );
}
