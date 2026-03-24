import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const mono  = { fontFamily: "'Courier New', monospace" } as const;
const pixel = { fontFamily: "'Courier New', monospace", textTransform: "uppercase" as const, letterSpacing: "0.15em" } as const;

const SHOWS = {
  "306_podcast":     { label: "The 306 Podcast",  color: "#f97316", icon: "🎙" },
  "holder_sessions": { label: "Holder Sessions",  color: "#4ade80", icon: "🖤" },
  "web3_builders":   { label: "Web3 Builders",    color: "#a78bfa", icon: "⛓" },
  "ai_dispatch":     { label: "AI Dispatch",      color: "#60a5fa", icon: "🤖" },
};

const STATUS_COLORS: Record<string, string> = {
  pending_review:          "rgba(251,191,36,0.8)",
  approved:                "rgba(74,222,128,0.8)",
  questions_sent:          "rgba(96,165,250,0.8)",
  answered:                "rgba(167,139,250,0.8)",
  approved_for_production: "rgba(249,115,22,0.8)",
  published:               "rgba(74,222,128,1)",
  declined:                "rgba(248,113,113,0.6)",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PodcastStudio() {
  const { toast } = useToast();
  const [selectedGuest, setSelectedGuest] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "transcript">("queue");
  const [working, setWorking] = useState(false);

  const { data: queue, refetch } = useQuery<any>({
    queryKey: ["/api/podcast/queue"],
  });

  const guests = queue?.guests ?? [];
  const pending   = guests.filter((g: any) => g.status === "pending_review");
  const approved  = guests.filter((g: any) => g.status === "approved");
  const inProgress = guests.filter((g: any) => ["questions_sent", "answered"].includes(g.status));
  const production = guests.filter((g: any) => ["approved_for_production", "published"].includes(g.status));

  async function approveGuest(guestId: string) {
    setWorking(true);
    try {
      await apiRequest("POST", `/api/podcast/review/${guestId}`, { decision: "approved" });
      toast({ title: "Guest approved", description: "Next: generate questions" });
      refetch();
      if (selectedGuest?.id === guestId) setSelectedGuest({ ...selectedGuest, status: "approved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setWorking(false);
  }

  async function declineGuest(guestId: string) {
    setWorking(true);
    try {
      await apiRequest("POST", `/api/podcast/review/${guestId}`, { decision: "declined" });
      toast({ title: "Guest declined" });
      refetch();
      setSelectedGuest(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setWorking(false);
  }

  async function generateQuestions(guestId: string) {
    setWorking(true);
    toast({ title: "Generating questions...", description: "Agent #306 is preparing — ~20 seconds" });
    try {
      const res = await apiRequest("POST", `/api/podcast/questions/${guestId}`, {});
      const data = await res.json();
      toast({ title: `${data.questions?.length} questions generated`, description: "Ready to send to guest" });
      refetch();
      if (selectedGuest?.id === guestId) setSelectedGuest({ ...selectedGuest, status: "questions_sent", questions: data.questions });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setWorking(false);
  }

  async function approveForProduction(guestId: string) {
    setWorking(true);
    try {
      await apiRequest("POST", `/api/podcast/approve-production/${guestId}`, {});
      toast({ title: "Approved for production", description: "Transcript ready — export for NotebookLM" });
      refetch();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setWorking(false);
  }

  async function downloadTranscript(guestId: string, name: string) {
    try {
      const res = await apiRequest("GET", `/api/podcast/transcript/${guestId}`, undefined);
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `podcast-transcript-${name.replace(/\s+/g, "-").toLowerCase()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error downloading transcript", description: e.message, variant: "destructive" });
    }
  }

  const bg      = { background: "#0a0b0d" };
  const surface = { background: "#141516" };
  const border  = "1px solid rgba(227,229,228,0.08)";

  return (
    <div style={{ ...bg, minHeight: "100vh", padding: "24px", color: "#e3e5e4" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ ...pixel, fontSize: "9px", color: "rgba(227,229,228,0.35)", marginBottom: "4px" }}>NORMIESTV</div>
        <h1 style={{ fontSize: "22px", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          Podcast <span style={{ color: "#f97316" }}>Studio</span>
        </h1>
        <p style={{ ...mono, fontSize: "12px", color: "rgba(227,229,228,0.45)", margin: 0 }}>
          Guest queue · Interview questions · Transcript export for NotebookLM
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1px", background: "rgba(227,229,228,0.06)", marginBottom: "24px" }}>
        {[
          { label: "Pending Review", value: pending.length, color: "#fbbf24" },
          { label: "In Progress", value: inProgress.length, color: "#60a5fa" },
          { label: "Ready to Produce", value: production.length, color: "#f97316" },
          { label: "Total Submitted", value: queue?.totalSubmitted ?? 0, color: "#e3e5e4" },
        ].map((s, i) => (
          <div key={i} style={{ ...surface, padding: "16px 20px" }}>
            <div style={{ ...pixel, fontSize: "8px", color: "rgba(227,229,228,0.3)", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ fontSize: "28px", fontWeight: 800, color: s.color, ...mono }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "rgba(227,229,228,0.06)" }}>

        {/* Left — guest list */}
        <div style={{ ...surface, padding: "20px" }}>
          <div style={{ ...pixel, fontSize: "9px", color: "rgba(227,229,228,0.35)", marginBottom: "16px" }}>Guest Queue</div>

          {guests.length === 0 ? (
            <div style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.3)", textAlign: "center", padding: "40px 20px" }}>
              No guests yet.<br/>Share the request link to start filling the queue.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "rgba(227,229,228,0.06)" }}>
              {[...guests].reverse().map((g: any) => {
                const show = SHOWS[g.show as keyof typeof SHOWS] ?? { label: g.show, color: "#e3e5e4", icon: "🎙" };
                return (
                  <div
                    key={g.id}
                    onClick={() => setSelectedGuest(g)}
                    style={{
                      background: selectedGuest?.id === g.id ? "rgba(249,115,22,0.08)" : "#141516",
                      padding: "12px 16px",
                      cursor: "pointer",
                      borderLeft: selectedGuest?.id === g.id ? "2px solid #f97316" : "2px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                      <span style={{ fontSize: "14px" }}>{show.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ ...mono, fontSize: "12px", fontWeight: 700, color: "#e3e5e4" }}>{g.name}</div>
                        <div style={{ ...mono, fontSize: "10px", color: "rgba(227,229,228,0.4)" }}>@{g.xHandle} · {show.label}</div>
                      </div>
                      <div style={{ ...pixel, fontSize: "8px", color: STATUS_COLORS[g.status] ?? "#e3e5e4" }}>
                        {g.status.replace(/_/g, " ")}
                      </div>
                    </div>
                    <div style={{ ...mono, fontSize: "10px", color: "rgba(227,229,228,0.5)", marginLeft: "24px" }}>
                      {g.topic.slice(0, 60)}{g.topic.length > 60 ? "..." : ""}
                    </div>
                    <div style={{ ...mono, fontSize: "9px", color: "rgba(227,229,228,0.3)", marginLeft: "24px", marginTop: "2px" }}>
                      {timeAgo(g.submittedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — guest detail */}
        <div style={{ ...surface, padding: "20px" }}>
          {!selectedGuest ? (
            <div style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.25)", textAlign: "center", padding: "60px 20px" }}>
              Select a guest to review
            </div>
          ) : (
            <div>
              {/* Guest header */}
              <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: border }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "16px", fontWeight: 800, ...mono }}>{selectedGuest.name}</div>
                    <div style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.5)" }}>@{selectedGuest.xHandle}</div>
                  </div>
                  <div style={{ ...pixel, fontSize: "8px", color: STATUS_COLORS[selectedGuest.status] ?? "#e3e5e4",
                    background: `${STATUS_COLORS[selectedGuest.status]}20`, padding: "4px 8px" }}>
                    {selectedGuest.status.replace(/_/g, " ")}
                  </div>
                </div>
                {selectedGuest.normieToken && (
                  <div style={{ ...mono, fontSize: "10px", color: "#4ade80" }}>🖤 Normie #{selectedGuest.normieToken} holder</div>
                )}
              </div>

              {/* Content sections */}
              {[
                { label: "Show", value: SHOWS[selectedGuest.show as keyof typeof SHOWS]?.label ?? selectedGuest.show },
                { label: "Topic", value: selectedGuest.topic },
                { label: "Why Now", value: selectedGuest.whyNow },
                { label: "Bio", value: selectedGuest.bio },
              ].map((s, i) => (
                <div key={i} style={{ marginBottom: "14px" }}>
                  <div style={{ ...pixel, fontSize: "8px", color: "rgba(227,229,228,0.3)", marginBottom: "4px" }}>{s.label}</div>
                  <div style={{ ...mono, fontSize: "12px", color: "#e3e5e4", lineHeight: 1.6 }}>{s.value}</div>
                </div>
              ))}

              {/* Questions */}
              {selectedGuest.questions?.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ ...pixel, fontSize: "8px", color: "#f97316", marginBottom: "8px" }}>
                    Agent #306's Questions
                  </div>
                  {selectedGuest.questions.map((q: string, i: number) => (
                    <div key={i} style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.75)",
                      padding: "8px 12px", background: "rgba(249,115,22,0.05)",
                      borderLeft: "2px solid rgba(249,115,22,0.3)", marginBottom: "6px", lineHeight: 1.6 }}>
                      <span style={{ color: "#f97316" }}>Q{i + 1}. </span>{q}
                    </div>
                  ))}
                </div>
              )}

              {/* Answers */}
              {selectedGuest.answers?.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ ...pixel, fontSize: "8px", color: "#a78bfa", marginBottom: "8px" }}>
                    Guest Responses
                  </div>
                  {selectedGuest.answers.map((qa: any, i: number) => (
                    <div key={i} style={{ marginBottom: "12px" }}>
                      <div style={{ ...mono, fontSize: "10px", color: "#a78bfa", marginBottom: "4px" }}>{qa.question}</div>
                      <div style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.7)",
                        padding: "8px 12px", background: "rgba(167,139,250,0.05)",
                        borderLeft: "2px solid rgba(167,139,250,0.3)", lineHeight: 1.6 }}>
                        {qa.answer}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "20px", paddingTop: "16px", borderTop: border }}>
                {selectedGuest.status === "pending_review" && (
                  <>
                    <button onClick={() => approveGuest(selectedGuest.id)} disabled={working}
                      style={{ ...mono, fontSize: "10px", padding: "8px 16px", background: "rgba(74,222,128,0.1)",
                        border: "1px solid rgba(74,222,128,0.4)", color: "#4ade80", cursor: "pointer" }}>
                      ✓ APPROVE
                    </button>
                    <button onClick={() => declineGuest(selectedGuest.id)} disabled={working}
                      style={{ ...mono, fontSize: "10px", padding: "8px 16px", background: "rgba(248,113,113,0.1)",
                        border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", cursor: "pointer" }}>
                      ✕ DECLINE
                    </button>
                  </>
                )}
                {selectedGuest.status === "approved" && (
                  <button onClick={() => generateQuestions(selectedGuest.id)} disabled={working}
                    style={{ ...mono, fontSize: "10px", padding: "8px 16px", background: "rgba(249,115,22,0.1)",
                      border: "1px solid rgba(249,115,22,0.4)", color: "#f97316", cursor: "pointer" }}>
                    {working ? "GENERATING..." : "⚡ GENERATE QUESTIONS"}
                  </button>
                )}
                {selectedGuest.status === "answered" && (
                  <button onClick={() => approveForProduction(selectedGuest.id)} disabled={working}
                    style={{ ...mono, fontSize: "10px", padding: "8px 16px", background: "rgba(167,139,250,0.1)",
                      border: "1px solid rgba(167,139,250,0.4)", color: "#a78bfa", cursor: "pointer" }}>
                    ✓ APPROVE FOR PRODUCTION
                  </button>
                )}
                {["approved_for_production", "published"].includes(selectedGuest.status) && (
                  <button onClick={() => downloadTranscript(selectedGuest.id, selectedGuest.name)}
                    style={{ ...mono, fontSize: "10px", padding: "8px 16px", background: "rgba(96,165,250,0.1)",
                      border: "1px solid rgba(96,165,250,0.4)", color: "#60a5fa", cursor: "pointer" }}>
                    ↓ EXPORT TRANSCRIPT (NotebookLM)
                  </button>
                )}
              </div>

              {/* Production note */}
              {selectedGuest.status === "approved_for_production" && (
                <div style={{ marginTop: "16px", padding: "12px 16px",
                  background: "rgba(249,115,22,0.06)", borderLeft: "3px solid #f97316" }}>
                  <div style={{ ...pixel, fontSize: "8px", color: "#f97316", marginBottom: "6px" }}>Production Ready</div>
                  <div style={{ ...mono, fontSize: "11px", color: "rgba(227,229,228,0.65)", lineHeight: 1.6 }}>
                    Export the transcript and paste into NotebookLM. Select "Audio Overview" format.
                    Target: 3-5 minute episode. Download the MP3 and upload to Buzzsprout.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
