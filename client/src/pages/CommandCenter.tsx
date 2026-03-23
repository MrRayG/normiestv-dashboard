import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "READY";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  return `${Math.floor(diff / 86400)}d ${Math.floor((diff % 86400) / 3600)}h`;
}

const ENGINE_LABELS: Record<string, { label: string; color: string; schedule: string }> = {
  episode:       { label: "Episode",        color: "#f97316", schedule: "Every 12h"       },
  news_dispatch: { label: "News Dispatch",  color: "#4ade80", schedule: "Daily 8am ET"    },
  leaderboard:   { label: "THE 100",        color: "#e3e5e4", schedule: "Monday 9am ET"   },
  spotlight:     { label: "Spotlight",      color: "#f97316", schedule: "Sunday 11am ET"  },
  race:          { label: "THE RACE",       color: "#a78bfa", schedule: "Sunday 12pm ET"  },
  cyoa:          { label: "CYOA Draft",     color: "#2dd4bf", schedule: "Sunday 10am ET"  },
};

export default function CommandCenter() {
  const { toast } = useToast();
  const [triggering, setTriggering] = useState<string | null>(null);

  const { data: house, refetch } = useQuery<any>({
    queryKey: ["/api/house"],
  });

  const { data: pollerStatus } = useQuery<any>({
    queryKey: ["/api/poller/status"],
  });

  const coord = house?.coordinator;

  async function trigger(endpoint: string, label: string) {
    setTriggering(label);
    try {
      await apiRequest("POST", endpoint, {});
      toast({ title: `${label} triggered`, description: "Check X in ~30 seconds" });
      setTimeout(() => refetch(), 5000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setTriggering(null);
  }

  const TRIGGERS: Record<string, { endpoint: string }> = {
    episode:       { endpoint: "/api/poller/trigger"   },
    news_dispatch: { endpoint: "/api/news/dispatch"    },
    leaderboard:   { endpoint: "/api/leaderboard/post" },
    spotlight:     { endpoint: "/api/spotlight/post"   },
    race:          { endpoint: "/api/race/post"        },
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.2em", marginBottom: "4px" }}>NORMIESTV</div>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#e3e5e4", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          Command <span style={{ color: "#f97316" }}>Center</span>
        </h1>
        <p style={{ fontSize: "12px", color: "rgba(227,229,228,0.5)", margin: 0 }}>
          Every engine. Every schedule. One view. Nothing posts without going through here.
        </p>
      </div>

      {/* Active engine indicator */}
      {coord?.activeEngine && (
        <div style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.3)", padding: "10px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f97316", animation: "pulse 1s infinite" }} />
          <span style={{ fontSize: "11px", color: "#f97316", fontFamily: "monospace" }}>
            {coord.activeEngine.toUpperCase()} IS CURRENTLY POSTING
          </span>
        </div>
      )}

      {/* Engine schedule grid */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em", marginBottom: "10px" }}>POSTING SCHEDULE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "rgba(227,229,228,0.06)" }}>
          {coord?.engines?.map((e: any) => {
            const meta = ENGINE_LABELS[e.engine] ?? { label: e.engine, color: "#e3e5e4", schedule: "—" };
            const trigger_info = TRIGGERS[e.engine];

            return (
              <div key={e.engine} style={{
                background: "#141516",
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
              }}>
                {/* Status dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: e.isReady ? "#4ade80" : "rgba(227,229,228,0.2)",
                  flexShrink: 0,
                }} />

                {/* Engine name + schedule */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>{meta.schedule}</div>
                </div>

                {/* Last posted */}
                <div style={{ textAlign: "right", minWidth: "100px" }}>
                  <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>LAST POST</div>
                  <div style={{ fontSize: "11px", color: "#e3e5e4", fontFamily: "monospace" }}>{timeAgo(e.lastPostedAt)}</div>
                </div>

                {/* Next allowed */}
                <div style={{ textAlign: "right", minWidth: "80px" }}>
                  <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>NEXT</div>
                  <div style={{
                    fontSize: "11px",
                    color: e.isReady ? "#4ade80" : "rgba(227,229,228,0.5)",
                    fontFamily: "monospace",
                    fontWeight: e.isReady ? 700 : 400,
                  }}>
                    {e.isReady ? "READY" : timeUntil(e.nextAllowedAt)}
                  </div>
                </div>

                {/* Last tweet link */}
                {e.lastTweetUrl && (
                  <a href={e.lastTweetUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: "10px", color: "#a78bfa", fontFamily: "monospace", textDecoration: "none", minWidth: "40px" }}>
                    ↗ view
                  </a>
                )}

                {/* Manual trigger */}
                {trigger_info && (
                  <button
                    onClick={() => trigger(trigger_info.endpoint, meta.label)}
                    disabled={triggering === meta.label}
                    style={{
                      background: "transparent",
                      border: `1px solid ${e.isReady ? meta.color : "rgba(227,229,228,0.15)"}`,
                      color: e.isReady ? meta.color : "rgba(227,229,228,0.3)",
                      padding: "4px 12px",
                      fontFamily: "monospace",
                      fontSize: "10px",
                      cursor: triggering === meta.label ? "not-allowed" : "pointer",
                      minWidth: "70px",
                    }}
                  >
                    {triggering === meta.label ? "..." : "TRIGGER"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent posts feed */}
      <div>
        <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em", marginBottom: "10px" }}>
          RECENT POSTS — {coord?.totalPosts ?? 0} total
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "rgba(227,229,228,0.06)" }}>
          {coord?.recentPosts?.length > 0 ? coord.recentPosts.map((p: any, i: number) => (
            <div key={i} style={{ background: "#141516", padding: "10px 20px", display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", minWidth: "80px" }}>
                {timeAgo(p.postedAt)}
              </div>
              <div style={{ fontSize: "11px", color: "#e3e5e4", fontFamily: "monospace", flex: 1 }}>
                {p.engine.toUpperCase()}
              </div>
              <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>
                {p.key}
              </div>
              {p.tweetUrl && (
                <a href={p.tweetUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "10px", color: "#a78bfa", fontFamily: "monospace", textDecoration: "none" }}>
                  ↗ view
                </a>
              )}
            </div>
          )) : (
            <div style={{ background: "#141516", padding: "16px 20px", fontSize: "11px", color: "rgba(227,229,228,0.3)", fontFamily: "monospace" }}>
              No posts recorded yet — history builds after first post
            </div>
          )}
        </div>
      </div>

      {/* Server status */}
      <div style={{ marginTop: "16px", padding: "12px 20px", background: "#141516", border: "1px solid rgba(227,229,228,0.06)", display: "flex", gap: "32px" }}>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>SERVER</div>
          <div style={{ fontSize: "11px", color: "#4ade80", fontFamily: "monospace" }}>● RAILWAY ONLINE</div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>LAST EPISODE</div>
          <div style={{ fontSize: "11px", color: "#e3e5e4", fontFamily: "monospace" }}>
            {pollerStatus?.lastEpisode ? `EP${pollerStatus.lastEpisode}` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>NEXT EPISODE</div>
          <div style={{ fontSize: "11px", color: "#e3e5e4", fontFamily: "monospace" }}>
            {timeUntil(pollerStatus?.nextRun)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>ERRORS</div>
          <div style={{ fontSize: "11px", color: pollerStatus?.lastError ? "#f87171" : "#4ade80", fontFamily: "monospace" }}>
            {pollerStatus?.lastError ? "⚠ ERROR" : "● NONE"}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "12px", fontSize: "10px", color: "rgba(227,229,228,0.2)", fontFamily: "monospace", textAlign: "center" }}>
        All engines share the same disk-based coordinator — no duplicates across Railway restarts
      </div>
    </div>
  );
}
