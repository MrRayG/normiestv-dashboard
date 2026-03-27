import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Style constants ────────────────────────────────────────────────────────────
const mono = { fontFamily: "'Courier New', monospace" } as const;
const BG = "#0e0f10";
const ORANGE = "#f97316";
const GREEN = "#4ade80";
const TEAL = "#2dd4bf";
const PURPLE = "#a78bfa";
const YELLOW = "#fbbf24";
const RED = "#f87171";
const DIM = "rgba(227,229,228,0.35)";
const DIMMER = "rgba(227,229,228,0.18)";
const DIMMEST = "rgba(227,229,228,0.07)";

// ── Data types ─────────────────────────────────────────────────────────────────
interface HouseData {
  broadcast?: {
    lastEpisode?: string;
    cycleCount?: number;
    isLive?: boolean;
  };
  signal?: {
    total?: number;
    founderPosts?: number;
    lastRefreshed?: string;
  };
  library?: {
    totalEntries?: number;
    lastIngested?: string;
    topCategories?: Array<{ name: string; count: number }>;
  };
  diplomatic?: {
    followingCount?: number;
    replyCount?: number;
    lastSync?: string;
  };
  studio?: {
    voiceName?: string;
    newsDispatchNextRun?: string;
    articlesPublished?: number;
  };
  vault?: {
    ethName?: string;
    ethExpiry?: string;
    railwayStatus?: string;
  };
  lab?: {
    totalPosts?: number;
    avgScore?: number;
    avgEngagement?: number;
  };
  roadAhead?: {
    daysToArena?: number;
    checklist?: Array<{ label: string; done: boolean }>;
  };
}

type ResearchStatus =
  | "queued" | "researching" | "synthesizing" | "hypothesis"
  | "drafting" | "pending_review" | "approved" | "published" | "declined" | "archived";

interface ResearchTopic {
  id: string;
  topic: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: ResearchStatus;
  addedBy: "agent" | "mrrrayg";
  addedAt: string;
  updatedAt: string;
  rawFindings?: string;
  sources?: string[];
  hypothesis?: string;
  confidence?: "high" | "medium" | "low";
  manuscript?: string;
  manuscriptType?: string;
  agentRecommendation?: string;
  reviewNote?: string;
  publishedAt?: string;
  publishedUrl?: string;
}

interface Hypothesis {
  id: string;
  claim: string;
  basis: string;
  metric: string;
  prediction: string;
  timeframe: string;
  status: "forming" | "testing" | "confirmed" | "rejected" | "expired";
  confidence: "high" | "medium" | "low";
  formedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

// ── Status badge config ────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { color: string; bg: string; pulse?: boolean; label: string }> = {
  queued:        { color: "rgba(227,229,228,0.5)", bg: "rgba(227,229,228,0.07)", label: "QUEUED" },
  researching:   { color: ORANGE, bg: "rgba(249,115,22,0.1)", pulse: true, label: "RESEARCHING" },
  synthesizing:  { color: PURPLE, bg: "rgba(167,139,250,0.1)", label: "SYNTHESIZING" },
  hypothesis:    { color: PURPLE, bg: "rgba(167,139,250,0.1)", label: "HYPOTHESIS" },
  drafting:      { color: ORANGE, bg: "rgba(249,115,22,0.1)", label: "DRAFTING" },
  pending_review:{ color: YELLOW, bg: "rgba(251,191,36,0.1)", label: "PENDING REVIEW" },
  approved:      { color: GREEN,  bg: "rgba(74,222,128,0.1)", label: "APPROVED" },
  published:     { color: TEAL,   bg: "rgba(45,212,191,0.1)", label: "PUBLISHED" },
  declined:      { color: RED,    bg: "rgba(248,113,113,0.1)", label: "DECLINED" },
  archived:      { color: DIMMER, bg: DIMMEST, label: "ARCHIVED" },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: GREEN, medium: YELLOW, low: RED,
};

const PRIORITY_COLOR: Record<string, string> = {
  high: RED, medium: YELLOW, low: DIM,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtShort(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return "—"; }
}

// ── Shared UI components ──────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ ...mono, fontSize: "0.5rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.15em", margin: "0 0 3px" }}>
      {children}
    </p>
  );
}

function Val({ children, color = "#e3e5e4", size = "0.78rem" }: { children: React.ReactNode; color?: string; size?: string }) {
  return (
    <p style={{ ...mono, fontSize: size, fontWeight: 700, color, margin: 0, lineHeight: 1.2 }}>{children}</p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? { color: DIM, bg: DIMMEST, label: status.toUpperCase() };
  return (
    <span style={{
      ...mono, fontSize: "0.48rem", color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}30`, padding: "1px 6px",
      textTransform: "uppercase" as const, letterSpacing: "0.1em",
      animation: cfg.pulse ? "research-pulse 1.4s ease-in-out infinite" : undefined,
    }}>
      {cfg.label}
    </span>
  );
}

function Btn({
  onClick, disabled, color = ORANGE, outline = false, children, small = false,
}: {
  onClick?: () => void; disabled?: boolean; color?: string;
  outline?: boolean; children: React.ReactNode; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...mono,
        fontSize: small ? "0.52rem" : "0.6rem",
        fontWeight: 700,
        padding: small ? "3px 10px" : "0.45rem 0.9rem",
        background: outline ? "transparent" : disabled ? `${color}22` : color,
        color: outline ? color : disabled ? `${color}55` : "#0e0f10",
        border: outline ? `1px solid ${color}55` : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        textTransform: "uppercase" as const,
        letterSpacing: "0.06em",
        opacity: disabled ? 0.6 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function Input({ value, onChange, placeholder, multiline = false, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number;
}) {
  const shared = {
    ...mono, fontSize: "0.65rem",
    background: "rgba(227,229,228,0.03)", border: "1px solid rgba(227,229,228,0.12)",
    color: "#e3e5e4", padding: "0.45rem 0.6rem", width: "100%", boxSizing: "border-box" as const,
    outline: "none", resize: "vertical" as const,
  };
  return multiline
    ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={shared} />
    : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ ...shared, height: 30 }} />;
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        ...mono, fontSize: "0.62rem",
        background: "#0e0f10", border: "1px solid rgba(227,229,228,0.12)",
        color: "#e3e5e4", padding: "0.4rem 0.55rem", outline: "none", width: "100%",
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(227,229,228,0.015)", border: "1px solid rgba(227,229,228,0.07)",
      padding: "0.75rem 0.85rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.5rem", borderBottom: "1px solid rgba(227,229,228,0.05)", paddingBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.8rem" }}>{icon}</span>
        <span style={{ ...mono, fontSize: "0.52rem", color: ORANGE, textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>{title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, color = "#e3e5e4" }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ ...mono, fontSize: "0.5rem", color: "rgba(227,229,228,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.08em", flexShrink: 0 }}>{label}</span>
      <span style={{ ...mono, fontSize: "0.58rem", color, fontWeight: 600, textAlign: "right" as const, wordBreak: "break-word" as const }}>{value}</span>
    </div>
  );
}

// ── House rooms ───────────────────────────────────────────────────────────────
function BroadcastRoom({ d }: { d: HouseData["broadcast"] }) {
  return (
    <RoomCard icon="🎙" title="Broadcast Room">
      <Row label="Last Episode" value={d?.lastEpisode || "—"} />
      <Row label="Cycles" value={d?.cycleCount ?? "—"} color={ORANGE} />
      <Row label="Live" value={d?.isLive ? <span style={{ color: GREEN }}>● ON AIR</span> : <span style={{ color: DIMMER }}>● OFFLINE</span>} />
    </RoomCard>
  );
}

function SignalRoom({ d }: { d: HouseData["signal"] }) {
  return (
    <RoomCard icon="📡" title="Signal Room">
      <Row label="Total Signals" value={d?.total ?? "—"} color={TEAL} />
      <Row label="Founder Posts" value={d?.founderPosts ?? "—"} />
      <Row label="Last Refresh" value={fmtShort(d?.lastRefreshed)} color={DIMMER} />
    </RoomCard>
  );
}

function LibraryRoom({ d }: { d: HouseData["library"] }) {
  const top3 = (d?.topCategories ?? []).slice(0, 3);
  return (
    <RoomCard icon="📚" title="The Library">
      <Row label="Total Entries" value={d?.totalEntries ?? "—"} color={PURPLE} />
      <Row label="Last Ingested" value={fmtShort(d?.lastIngested)} color={DIMMER} />
      <Row label="Top Categories" value={
        top3.length
          ? top3.map(c => c.name).join(", ")
          : "—"
      } />
    </RoomCard>
  );
}

function DiplomaticFloor({ d }: { d: HouseData["diplomatic"] }) {
  return (
    <RoomCard icon="🌐" title="Diplomatic Floor">
      <Row label="Following" value={d?.followingCount ?? "—"} color={GREEN} />
      <Row label="Replies Sent" value={d?.replyCount ?? "—"} />
      <Row label="Last Sync" value={fmtShort(d?.lastSync)} color={DIMMER} />
    </RoomCard>
  );
}

function StudioRoom({ d }: { d: HouseData["studio"] }) {
  return (
    <RoomCard icon="📺" title="The Studio">
      <Row label="Voice" value={d?.voiceName || "—"} color={ORANGE} />
      <Row label="Next Dispatch" value={fmtShort(d?.newsDispatchNextRun)} />
      <Row label="Articles" value={d?.articlesPublished ?? "—"} color={TEAL} />
    </RoomCard>
  );
}

function VaultRoom({ d }: { d: HouseData["vault"] }) {
  const statusColor = d?.railwayStatus === "active" ? GREEN : d?.railwayStatus === "degraded" ? YELLOW : RED;
  return (
    <RoomCard icon="🔒" title="The Vault">
      <Row label="ENS Name" value={d?.ethName || "—"} color={TEAL} />
      <Row label="ENS Expiry" value={fmtShort(d?.ethExpiry)} />
      <Row label="Railway" value={
        <span style={{ color: statusColor }}>{d?.railwayStatus || "—"}</span>
      } />
    </RoomCard>
  );
}

function LabRoom({ d }: { d: HouseData["lab"] }) {
  return (
    <RoomCard icon="🔬" title="The Lab">
      <Row label="Total Posts" value={d?.totalPosts ?? "—"} color={ORANGE} />
      <Row label="Avg Score" value={d?.avgScore != null ? `${d.avgScore.toFixed(1)}/10` : "—"} color={GREEN} />
      <Row label="Avg Engage" value={d?.avgEngagement != null ? Math.round(d.avgEngagement) : "—"} />
    </RoomCard>
  );
}

function RoadAheadRoom({ d }: { d: HouseData["roadAhead"] }) {
  const items = d?.checklist ?? [];
  const done = items.filter(i => i.done).length;
  return (
    <RoomCard icon="🗺" title="Road Ahead">
      <Row label="Days to Arena" value={d?.daysToArena ?? "—"} color={YELLOW} />
      <Row label="Progress" value={`${done}/${items.length}`} color={GREEN} />
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 2, marginTop: 2 }}>
        {items.slice(0, 4).map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ ...mono, fontSize: "0.48rem", color: item.done ? GREEN : DIMMER }}>{item.done ? "✓" : "○"}</span>
            <span style={{ ...mono, fontSize: "0.48rem", color: item.done ? GREEN : "rgba(227,229,228,0.35)", textDecoration: item.done ? "line-through" : "none" }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </RoomCard>
  );
}

// ── Manuscript renderer ───────────────────────────────────────────────────────
function ManuscriptRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return <p key={i} style={{ ...mono, fontSize: "0.72rem", fontWeight: 700, color: "#e3e5e4", margin: "8px 0 2px", letterSpacing: "0.05em" }}>{line.replace("## ", "")}</p>;
        }
        if (line.startsWith("# ")) {
          return <p key={i} style={{ ...mono, fontSize: "0.85rem", fontWeight: 700, color: ORANGE, margin: "6px 0 4px" }}>{line.replace("# ", "")}</p>;
        }
        if (line.startsWith("> ")) {
          return (
            <div key={i} style={{ borderLeft: `2px solid ${ORANGE}44`, paddingLeft: 10, margin: "2px 0" }}>
              <p style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.55)", fontStyle: "italic", margin: 0 }}>{line.replace("> ", "")}</p>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        return <p key={i} style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.7)", margin: 0, lineHeight: 1.65 }}>{line}</p>;
      })}
    </div>
  );
}

// ── Research Queue tab ────────────────────────────────────────────────────────
function ResearchQueueTab({ topics, refetch }: { topics: ResearchTopic[]; refetch: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ topic: "", description: "", priority: "medium" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/research/add", form).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Topic queued" });
      setForm({ topic: "", description: "", priority: "medium" });
      setShowForm(false);
      refetch();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/research/run/${id}`, {}).then(r => r.json()),
    onSuccess: (_, id) => {
      toast({ title: "Research cycle started", description: "Agent #306 is on it." });
      refetch();
    },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ ...mono, fontSize: "0.55rem", color: DIM, textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
          {topics.length} topics in queue
        </span>
        <Btn onClick={() => setShowForm(v => !v)} outline color={ORANGE}>
          {showForm ? "✕ Cancel" : "+ Add Topic"}
        </Btn>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ background: "rgba(249,115,22,0.04)", border: "1px solid rgba(249,115,22,0.18)", padding: "1rem", marginBottom: "1rem", display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <div>
            <Label>Topic</Label>
            <Input value={form.topic} onChange={v => setForm(f => ({ ...f, topic: v }))} placeholder="What should Agent #306 research?" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Context, angle, why this matters..." multiline rows={2} />
          </div>
          <div>
            <Label>Priority</Label>
            <Select value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} options={[
              { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }
            ]} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => addMutation.mutate()} disabled={!form.topic.trim() || addMutation.isPending}>
              {addMutation.isPending ? "Queuing..." : "Queue Topic"}
            </Btn>
          </div>
        </div>
      )}

      {/* Topic list */}
      {topics.length === 0 && (
        <div style={{ padding: "2rem", textAlign: "center" as const, border: `1px solid ${DIMMEST}` }}>
          <p style={{ ...mono, fontSize: "0.65rem", color: DIMMER, margin: 0 }}>No research topics yet. Add one above.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
        {topics.map(topic => (
          <div key={topic.id} style={{ background: "rgba(227,229,228,0.015)", border: "1px solid rgba(227,229,228,0.07)", padding: "0.75rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 4 }}>
                  <StatusBadge status={topic.status} />
                  <span style={{ ...mono, fontSize: "0.48rem", color: PRIORITY_COLOR[topic.priority], border: `1px solid ${PRIORITY_COLOR[topic.priority]}40`, padding: "1px 5px", textTransform: "uppercase" as const }}>
                    {topic.priority}
                  </span>
                  <span style={{ ...mono, fontSize: "0.45rem", color: "rgba(227,229,228,0.25)" }}>
                    by {topic.addedBy} · {fmtShort(topic.updatedAt)}
                  </span>
                </div>
                <p style={{ ...mono, fontSize: "0.68rem", color: "#e3e5e4", fontWeight: 700, margin: 0, lineHeight: 1.3 }}>{topic.topic}</p>
                {topic.description && (
                  <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.4)", margin: "3px 0 0", lineHeight: 1.4 }}>{topic.description}</p>
                )}
              </div>
              <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "flex-start" }}>
                {topic.status === "queued" && (
                  <Btn
                    onClick={() => runMutation.mutate(topic.id)}
                    disabled={runMutation.isPending}
                    color={ORANGE}
                    small
                  >
                    {runMutation.isPending ? "Running..." : "Run Research →"}
                  </Btn>
                )}
                {topic.status === "pending_review" && (
                  <Btn onClick={() => setExpanded(expanded === topic.id ? null : topic.id)} color={YELLOW} outline small>
                    Review →
                  </Btn>
                )}
                {topic.status === "published" && topic.publishedUrl && (
                  <a href={topic.publishedUrl} target="_blank" rel="noopener noreferrer" style={{
                    ...mono, fontSize: "0.52rem", color: TEAL, border: `1px solid ${TEAL}40`,
                    padding: "3px 10px", textDecoration: "none", textTransform: "uppercase" as const,
                  }}>
                    View →
                  </a>
                )}
              </div>
            </div>

            {/* Inline manuscript viewer for pending_review */}
            {expanded === topic.id && topic.manuscript && (
              <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(227,229,228,0.07)" }}>
                <ManuscriptRenderer text={topic.manuscript} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hypotheses tab ────────────────────────────────────────────────────────────
function HypothesesTab({ hypotheses, refetch }: { hypotheses: Hypothesis[]; refetch: () => void }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ claim: "", basis: "", metric: "", prediction: "", timeframe: "", confidence: "medium" });
  const [resolveState, setResolveState] = useState<Record<string, { open: boolean; status: string; note: string }>>({});

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/research/hypothesis/add", form).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Hypothesis formed" });
      setForm({ claim: "", basis: "", metric: "", prediction: "", timeframe: "", confidence: "medium" });
      setShowForm(false);
      refetch();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status, resolution }: { id: string; status: string; resolution: string }) =>
      apiRequest("POST", `/api/research/hypothesis/resolve/${id}`, { status, resolution }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Hypothesis resolved" });
      refetch();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleResolve = (id: string) => {
    setResolveState(prev => ({
      ...prev,
      [id]: prev[id] ? { ...prev[id], open: !prev[id].open } : { open: true, status: "confirmed", note: "" },
    }));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ ...mono, fontSize: "0.55rem", color: DIM, textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
          {hypotheses.length} hypotheses tracked
        </span>
        <Btn onClick={() => setShowForm(v => !v)} outline color={PURPLE}>
          {showForm ? "✕ Cancel" : "+ Add Hypothesis"}
        </Btn>
      </div>

      {showForm && (
        <div style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.18)", padding: "1rem", marginBottom: "1rem", display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <Label>Claim</Label>
              <Input value={form.claim} onChange={v => setForm(f => ({ ...f, claim: v }))} placeholder="What do you believe?" />
            </div>
            <div>
              <Label>Basis</Label>
              <Input value={form.basis} onChange={v => setForm(f => ({ ...f, basis: v }))} placeholder="What data supports this?" />
            </div>
            <div>
              <Label>Metric</Label>
              <Input value={form.metric} onChange={v => setForm(f => ({ ...f, metric: v }))} placeholder="What to measure?" />
            </div>
            <div>
              <Label>Prediction</Label>
              <Input value={form.prediction} onChange={v => setForm(f => ({ ...f, prediction: v }))} placeholder="Specific outcome?" />
            </div>
            <div>
              <Label>Timeframe</Label>
              <Input value={form.timeframe} onChange={v => setForm(f => ({ ...f, timeframe: v }))} placeholder="e.g. 30-90 days" />
            </div>
            <div>
              <Label>Confidence</Label>
              <Select value={form.confidence} onChange={v => setForm(f => ({ ...f, confidence: v }))} options={[
                { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }
              ]} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn onClick={() => addMutation.mutate()} disabled={!form.claim.trim() || addMutation.isPending} color={PURPLE}>
              {addMutation.isPending ? "Forming..." : "Form Hypothesis"}
            </Btn>
          </div>
        </div>
      )}

      {hypotheses.length === 0 && (
        <div style={{ padding: "2rem", textAlign: "center" as const, border: `1px solid ${DIMMEST}` }}>
          <p style={{ ...mono, fontSize: "0.65rem", color: DIMMER, margin: 0 }}>No hypotheses yet. Form one above or run a research cycle.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
        {hypotheses.map(hyp => {
          const rs = resolveState[hyp.id];
          const isActive = hyp.status === "forming" || hyp.status === "testing";
          const statusCfg: Record<string, { color: string; label: string }> = {
            forming:   { color: ORANGE, label: "FORMING" },
            testing:   { color: YELLOW, label: "TESTING" },
            confirmed: { color: GREEN, label: "CONFIRMED" },
            rejected:  { color: RED, label: "REJECTED" },
            expired:   { color: DIMMER, label: "EXPIRED" },
          };
          const sc = statusCfg[hyp.status] ?? { color: DIM, label: hyp.status.toUpperCase() };
          return (
            <div key={hyp.id} style={{ background: "rgba(227,229,228,0.015)", border: "1px solid rgba(227,229,228,0.07)", padding: "0.75rem 1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 5 }}>
                    <span style={{ ...mono, fontSize: "0.48rem", color: sc.color, border: `1px solid ${sc.color}40`, padding: "1px 6px", textTransform: "uppercase" as const }}>
                      {sc.label}
                    </span>
                    <span style={{ ...mono, fontSize: "0.48rem", color: CONFIDENCE_COLOR[hyp.confidence], border: `1px solid ${CONFIDENCE_COLOR[hyp.confidence]}40`, padding: "1px 5px", textTransform: "uppercase" as const }}>
                      {hyp.confidence} confidence
                    </span>
                    <span style={{ ...mono, fontSize: "0.45rem", color: "rgba(227,229,228,0.25)" }}>{fmtShort(hyp.formedAt)}</span>
                  </div>
                  <p style={{ ...mono, fontSize: "0.68rem", color: "#e3e5e4", fontWeight: 700, margin: "0 0 4px", lineHeight: 1.35 }}>
                    {hyp.claim}
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                    <span style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.35)" }}>📊 {hyp.metric}</span>
                    <span style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.35)" }}>⏱ {hyp.timeframe}</span>
                  </div>
                  {hyp.resolution && (
                    <div style={{ marginTop: 5, padding: "4px 8px", background: `${sc.color}10`, border: `1px solid ${sc.color}25` }}>
                      <p style={{ ...mono, fontSize: "0.55rem", color: sc.color, margin: 0, fontStyle: "italic" }}>{hyp.resolution}</p>
                    </div>
                  )}
                </div>
                {isActive && (
                  <Btn onClick={() => toggleResolve(hyp.id)} color={GREEN} outline small>
                    {rs?.open ? "✕ Close" : "Resolve"}
                  </Btn>
                )}
              </div>

              {rs?.open && isActive && (
                <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid rgba(227,229,228,0.06)", display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <Label>Resolution</Label>
                      <Select
                        value={rs.status}
                        onChange={v => setResolveState(prev => ({ ...prev, [hyp.id]: { ...prev[hyp.id], status: v } }))}
                        options={[
                          { value: "confirmed", label: "Confirmed" },
                          { value: "rejected", label: "Rejected" },
                          { value: "expired", label: "Expired" },
                        ]}
                      />
                    </div>
                    <div>
                      <Label>Note</Label>
                      <Input
                        value={rs.note}
                        onChange={v => setResolveState(prev => ({ ...prev, [hyp.id]: { ...prev[hyp.id], note: v } }))}
                        placeholder="What happened?"
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Btn
                      onClick={() => resolveMutation.mutate({ id: hyp.id, status: rs.status, resolution: rs.note })}
                      disabled={resolveMutation.isPending}
                      color={GREEN}
                      small
                    >
                      {resolveMutation.isPending ? "Saving..." : "Save Resolution"}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Manuscripts tab ───────────────────────────────────────────────────────────
function ManuscriptsTab({ topics, refetch }: { topics: ResearchTopic[]; refetch: () => void }) {
  const { toast } = useToast();
  const manuscripts = topics.filter(t => t.manuscript && ["pending_review", "approved", "published", "declined", "drafting"].includes(t.status));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, { note: string; declining: boolean; revising: boolean }>>({});

  const getAS = (id: string) => actionState[id] ?? { note: "", declining: false, revising: false };
  const setAS = (id: string, patch: Partial<{ note: string; declining: boolean; revising: boolean }>) =>
    setActionState(prev => ({ ...prev, [id]: { ...getAS(id), ...patch } }));

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiRequest("POST", `/api/research/approve/${id}`, { note }).then(r => r.json()),
    onSuccess: () => { toast({ title: "✓ Approved for publication" }); refetch(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const declineMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiRequest("POST", `/api/research/decline/${id}`, { note }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Declined" }); refetch(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const reviseMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiRequest("POST", `/api/research/revise/${id}`, { note }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Revisions requested" }); refetch(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (manuscripts.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" as const, border: `1px solid ${DIMMEST}` }}>
        <p style={{ ...mono, fontSize: "0.65rem", color: DIMMER, margin: 0 }}>
          No manuscripts yet. Run a research cycle to generate drafts.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
      {manuscripts.map(topic => {
        const as = getAS(topic.id);
        const isExpanded = expanded === topic.id;
        const isPendingReview = topic.status === "pending_review";
        const typeColor = topic.manuscriptType === "thesis" ? PURPLE : topic.manuscriptType === "deep_read" ? TEAL : ORANGE;
        return (
          <div key={topic.id} style={{ background: "rgba(227,229,228,0.015)", border: "1px solid rgba(227,229,228,0.07)" }}>
            <div style={{ padding: "0.75rem 1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 5 }}>
                    <StatusBadge status={topic.status} />
                    {topic.manuscriptType && (
                      <span style={{ ...mono, fontSize: "0.46rem", color: typeColor, border: `1px solid ${typeColor}35`, padding: "1px 5px", textTransform: "uppercase" as const }}>
                        {topic.manuscriptType}
                      </span>
                    )}
                  </div>
                  <p style={{ ...mono, fontSize: "0.7rem", fontWeight: 700, color: "#e3e5e4", margin: "0 0 5px", lineHeight: 1.3 }}>{topic.topic}</p>
                  {topic.agentRecommendation && (
                    <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(249,115,22,0.6)", fontStyle: "italic", margin: 0, lineHeight: 1.4 }}>
                      "{topic.agentRecommendation}"
                    </p>
                  )}
                </div>
                <Btn onClick={() => setExpanded(isExpanded ? null : topic.id)} outline color={TEAL} small>
                  {isExpanded ? "↑ Collapse" : "↓ Read Draft"}
                </Btn>
              </div>
            </div>

            {/* Full manuscript */}
            {isExpanded && topic.manuscript && (
              <div style={{ padding: "0 1rem 0.75rem", borderTop: "1px solid rgba(227,229,228,0.06)" }}>
                <div style={{ marginTop: "0.75rem", maxHeight: 480, overflowY: "auto" as const, paddingRight: 8 }}>
                  <ManuscriptRenderer text={topic.manuscript} />
                </div>
              </div>
            )}

            {/* Action bar for pending review */}
            {isPendingReview && (
              <div style={{ padding: "0.65rem 1rem", borderTop: "1px solid rgba(227,229,228,0.06)", background: "rgba(251,191,36,0.03)" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "flex-start" }}>
                  {/* Approve */}
                  <Btn onClick={() => approveMutation.mutate({ id: topic.id })} disabled={approveMutation.isPending} color={GREEN} small>
                    ✓ Approve
                  </Btn>

                  {/* Decline */}
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Btn onClick={() => setAS(topic.id, { declining: !as.declining, revising: false })} color={RED} outline small>
                      ✗ Decline
                    </Btn>
                    {as.declining && (
                      <>
                        <input
                          value={as.note}
                          onChange={e => setAS(topic.id, { note: e.target.value })}
                          placeholder="Reason..."
                          style={{ ...mono, fontSize: "0.55rem", background: "rgba(227,229,228,0.03)", border: "1px solid rgba(248,113,113,0.3)", color: "#e3e5e4", padding: "3px 8px", width: 160, outline: "none" }}
                        />
                        <Btn onClick={() => declineMutation.mutate({ id: topic.id, note: as.note })} disabled={!as.note || declineMutation.isPending} color={RED} small>
                          {declineMutation.isPending ? "..." : "Confirm"}
                        </Btn>
                      </>
                    )}
                  </div>

                  {/* Request revisions */}
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Btn onClick={() => setAS(topic.id, { revising: !as.revising, declining: false })} color={YELLOW} outline small>
                      ↩ Request Revisions
                    </Btn>
                    {as.revising && (
                      <>
                        <input
                          value={as.note}
                          onChange={e => setAS(topic.id, { note: e.target.value })}
                          placeholder="What needs changing?"
                          style={{ ...mono, fontSize: "0.55rem", background: "rgba(227,229,228,0.03)", border: "1px solid rgba(251,191,36,0.3)", color: "#e3e5e4", padding: "3px 8px", width: 180, outline: "none" }}
                        />
                        <Btn onClick={() => reviseMutation.mutate({ id: topic.id, note: as.note })} disabled={!as.note || reviseMutation.isPending} color={YELLOW} small>
                          {reviseMutation.isPending ? "..." : "Send"}
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Review note */}
            {topic.reviewNote && (
              <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid rgba(227,229,228,0.05)" }}>
                <p style={{ ...mono, fontSize: "0.55rem", color: DIMMER, margin: 0 }}>
                  <span style={{ color: "rgba(227,229,228,0.3)" }}>Review note: </span>{topic.reviewNote}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Publication Queue tab ─────────────────────────────────────────────────────
function PublicationQueueTab({ topics, refetch }: { topics: ResearchTopic[]; refetch: () => void }) {
  const { toast } = useToast();
  const approved = topics.filter(t => t.status === "approved");
  const [pubState, setPubState] = useState<Record<string, { url: string; platforms: string[] }>>({});

  const getPS = (id: string) => pubState[id] ?? { url: "", platforms: [] };
  const setPS = (id: string, patch: Partial<{ url: string; platforms: string[] }>) =>
    setPubState(prev => ({ ...prev, [id]: { ...getPS(id), ...patch } }));

  const togglePlatform = (id: string, platform: string) => {
    const cur = getPS(id).platforms;
    setPS(id, { platforms: cur.includes(platform) ? cur.filter(p => p !== platform) : [...cur, platform] });
  };

  const publishMutation = useMutation({
    mutationFn: ({ id, url, platforms }: { id: string; url: string; platforms: string[] }) =>
      apiRequest("POST", `/api/research/publish/${id}`, { url, platforms }).then(r => r.json()),
    onSuccess: (_, { id }) => {
      toast({ title: "Published", description: "The world can now read it." });
      refetch();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (approved.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" as const, border: `1px solid ${DIMMEST}` }}>
        <p style={{ ...mono, fontSize: "0.65rem", color: DIMMER, margin: 0 }}>
          No approved manuscripts ready to publish. Approve manuscripts in the Manuscripts tab.
        </p>
      </div>
    );
  }

  const PLATFORMS = ["Mirror.xyz", "agent306.ai", "Substack"];

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
      {approved.map(topic => {
        const ps = getPS(topic.id);
        const excerpt = topic.manuscript ? topic.manuscript.slice(0, 240).replace(/#+\s/g, "").trim() + "..." : "";
        return (
          <div key={topic.id} style={{ background: "rgba(74,222,128,0.02)", border: "1px solid rgba(74,222,128,0.12)", padding: "0.85rem 1rem" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" as const }}>
              <StatusBadge status="approved" />
            </div>
            <p style={{ ...mono, fontSize: "0.72rem", fontWeight: 700, color: "#e3e5e4", margin: "0 0 5px", lineHeight: 1.3 }}>{topic.topic}</p>
            {excerpt && (
              <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.4)", margin: "0 0 8px", lineHeight: 1.5 }}>{excerpt}</p>
            )}
            {topic.agentRecommendation && (
              <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(74,222,128,0.55)", fontStyle: "italic", margin: "0 0 10px" }}>
                "{topic.agentRecommendation}"
              </p>
            )}

            {/* Publish form */}
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, paddingTop: 8, borderTop: "1px solid rgba(74,222,128,0.1)" }}>
              <div>
                <Label>Publication URL</Label>
                <Input value={ps.url} onChange={v => setPS(topic.id, { url: v })} placeholder="https://mirror.xyz/..." />
              </div>
              <div>
                <Label>Platforms</Label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 4 }}>
                  {PLATFORMS.map(platform => {
                    const active = ps.platforms.includes(platform);
                    return (
                      <button
                        key={platform}
                        onClick={() => togglePlatform(topic.id, platform)}
                        style={{
                          ...mono, fontSize: "0.55rem", padding: "4px 12px",
                          background: active ? "rgba(74,222,128,0.12)" : "transparent",
                          border: `1px solid ${active ? GREEN : "rgba(227,229,228,0.15)"}`,
                          color: active ? GREEN : DIM, cursor: "pointer",
                          textTransform: "uppercase" as const,
                        }}
                      >
                        {active ? "✓ " : ""}{platform}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Btn
                  onClick={() => publishMutation.mutate({ id: topic.id, url: ps.url, platforms: ps.platforms })}
                  disabled={!ps.url.trim() || ps.platforms.length === 0 || publishMutation.isPending}
                  color={GREEN}
                >
                  {publishMutation.isPending ? "Publishing..." : "Mark as Published →"}
                </Btn>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AgentHQ() {
  const { toast } = useToast();
  const [researchTab, setResearchTab] = useState<"queue" | "hypotheses" | "manuscripts" | "publication">("queue");

  const { data: house, isLoading: houseLoading } = useQuery<HouseData>({
    queryKey: ["/api/house"],
    refetchInterval: 60_000,
  });

  const { data: topicsData, refetch: refetchTopics } = useQuery<{ topics: ResearchTopic[]; stats: any }>({
    queryKey: ["/api/research/topics"],
    refetchInterval: 30_000,
  });
  const topics: ResearchTopic[] = topicsData?.topics ?? [];

  const { data: hypothesesData, refetch: refetchHypotheses } = useQuery<{ hypotheses: Hypothesis[] }>({
    queryKey: ["/api/research/hypotheses"],
    refetchInterval: 30_000,
  });
  const hypotheses: Hypothesis[] = hypothesesData?.hypotheses ?? [];

  const pendingReviewCount = (topics as ResearchTopic[]).filter(t => t.status === "pending_review").length;
  const approvedCount = (topics as ResearchTopic[]).filter(t => t.status === "approved").length;
  const researchingCount = (topics as ResearchTopic[]).filter(t => t.status === "researching" || t.status === "synthesizing").length;

  const TAB_LABELS: Array<{ key: typeof researchTab; label: string; badge?: number }> = [
    { key: "queue",       label: "Research Queue", badge: researchingCount || undefined },
    { key: "hypotheses",  label: "Hypotheses" },
    { key: "manuscripts", label: "Manuscripts", badge: pendingReviewCount || undefined },
    { key: "publication", label: "Publication Queue", badge: approvedCount || undefined },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "'Courier New', monospace" }}>

      <style>{`
        @keyframes research-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes hq-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(227,229,228,0.1); }
      `}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: "1.75rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ ...mono, fontSize: "0.52rem", color: "rgba(249,115,22,0.5)", textTransform: "uppercase" as const, letterSpacing: "0.2em" }}>
              Agent #306
            </span>
            <span style={{ ...mono, fontSize: "0.45rem", color: "rgba(227,229,228,0.2)" }}>•</span>
            <span style={{ ...mono, fontSize: "0.52rem", color: "rgba(227,229,228,0.25)", textTransform: "uppercase" as const, letterSpacing: "0.15em" }}>
              Command Center
            </span>
          </div>
          <h1 style={{ ...mono, fontSize: "1.45rem", fontWeight: 700, color: ORANGE, margin: 0, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
            Agent HQ
          </h1>
          <p style={{ ...mono, fontSize: "0.55rem", color: "rgba(227,229,228,0.25)", margin: "4px 0 0" }}>
            All systems nominal · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {researchingCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: ORANGE, animation: "research-pulse 1.2s infinite" }} />
              <span style={{ ...mono, fontSize: "0.52rem", color: ORANGE }}>
                {researchingCount} active research cycle{researchingCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {pendingReviewCount > 0 && (
            <div style={{ ...mono, fontSize: "0.52rem", color: YELLOW, border: `1px solid ${YELLOW}40`, padding: "3px 10px" }}>
              {pendingReviewCount} awaiting review
            </div>
          )}
        </div>
      </div>

      {/* ── House rooms 4-col grid ── */}
      <div style={{ marginBottom: "2rem" }}>
        <p style={{ ...mono, fontSize: "0.5rem", color: "rgba(227,229,228,0.25)", textTransform: "uppercase" as const, letterSpacing: "0.18em", margin: "0 0 0.65rem" }}>
          System Status
        </p>
        {houseLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 90, background: "rgba(227,229,228,0.02)", border: "1px solid rgba(227,229,228,0.05)", animation: "research-pulse 1.5s infinite" }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <BroadcastRoom d={house?.broadcast} />
            <SignalRoom d={house?.signal} />
            <LibraryRoom d={house?.library} />
            <DiplomaticFloor d={house?.diplomatic} />
            <StudioRoom d={house?.studio} />
            <VaultRoom d={house?.vault} />
            <LabRoom d={house?.lab} />
            <RoadAheadRoom d={house?.roadAhead} />
          </div>
        )}
      </div>

      {/* ── Research Lab ── */}
      <div style={{ border: "1px solid rgba(227,229,228,0.07)", background: "rgba(227,229,228,0.01)" }}>
        {/* Research lab header */}
        <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid rgba(227,229,228,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "1rem" }}>🔬</span>
            <span style={{ ...mono, fontSize: "0.62rem", fontWeight: 700, color: ORANGE, textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>
              Research Lab
            </span>
            <span style={{ ...mono, fontSize: "0.48rem", color: "rgba(227,229,228,0.25)", border: "1px solid rgba(227,229,228,0.1)", padding: "1px 8px" }}>
              {(topics as ResearchTopic[]).length} topics · {(hypotheses as Hypothesis[]).length} hypotheses
            </span>
          </div>
        </div>

        {/* Research tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(227,229,228,0.07)", padding: "0 1.25rem" }}>
          {TAB_LABELS.map(({ key, label, badge }) => (
            <button
              key={key}
              onClick={() => setResearchTab(key)}
              style={{
                ...mono, fontSize: "0.58rem", textTransform: "uppercase" as const, letterSpacing: "0.1em",
                background: "transparent", border: "none",
                borderBottom: researchTab === key ? `2px solid ${ORANGE}` : "2px solid transparent",
                color: researchTab === key ? ORANGE : "rgba(227,229,228,0.3)",
                padding: "0.65rem 0.9rem", cursor: "pointer", marginBottom: -1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {label}
              {badge != null && badge > 0 && (
                <span style={{
                  background: researchTab === key ? ORANGE : "rgba(249,115,22,0.25)",
                  color: researchTab === key ? "#0e0f10" : ORANGE,
                  ...mono, fontSize: "0.45rem", fontWeight: 700,
                  borderRadius: "50%", width: 16, height: 16,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Research tab content */}
        <div style={{ padding: "1.25rem" }}>
          {researchTab === "queue" && (
            <ResearchQueueTab topics={topics as ResearchTopic[]} refetch={refetchTopics} />
          )}
          {researchTab === "hypotheses" && (
            <HypothesesTab hypotheses={hypotheses as Hypothesis[]} refetch={refetchHypotheses} />
          )}
          {researchTab === "manuscripts" && (
            <ManuscriptsTab topics={topics as ResearchTopic[]} refetch={refetchTopics} />
          )}
          {researchTab === "publication" && (
            <PublicationQueueTab topics={topics as ResearchTopic[]} refetch={refetchTopics} />
          )}
        </div>
      </div>

    </div>
  );
}
