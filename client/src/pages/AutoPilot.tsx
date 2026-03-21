import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Zap, Radio, Flame, Twitter, RefreshCw, Clock, CheckCircle2, AlertCircle, Activity, TrendingUp } from "lucide-react";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "soon";
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 60) return `${m}m`;
  return `${h}h ${m % 60}m`;
}

export default function AutoPilot() {
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<any>({
    queryKey: ["/api/poller/status"],
    refetchInterval: 10_000,
  });

  const { data: episodes = [] } = useQuery<any[]>({
    queryKey: ["/api/episodes"],
    refetchInterval: 15_000,
  });

  const { data: burns = [] } = useQuery<any[]>({
    queryKey: ["/api/normies/burns/feed"],
    refetchInterval: 30_000,
  });

  const { data: signals = [] } = useQuery<any[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 15_000,
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/poller/run"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/poller/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/episodes"] });
      toast({ title: data.ok ? "Pipeline triggered" : "Already running", description: data.message });
    },
    onError: () => toast({ title: "Trigger failed", variant: "destructive" }),
  });

  const recentEpisodes = episodes.slice(0, 5);
  const postedEpisodes = episodes.filter((e: any) => e.status === "posted");
  const recentBurns = Array.isArray(burns) ? burns.slice(0, 8) : [];
  const recentSignals = Array.isArray(signals) ? signals.slice(0, 10) : [];

  const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };
  const card: React.CSSProperties = {
    background: "rgba(227,229,228,0.03)",
    border: "1px solid rgba(227,229,228,0.10)",
    padding: "1.25rem",
  };
  const label: React.CSSProperties = {
    ...mono,
    fontSize: "0.58rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.18em",
    color: "rgba(227,229,228,0.35)",
    marginBottom: "0.35rem",
  };

  return (
    <div style={{ padding: "1.75rem", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Radio style={{ color: "#f97316", width: 16, height: 16 }} />
            <span style={{ ...mono, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(227,229,228,0.5)" }}>
              Autonomous Pipeline
            </span>
          </div>
          <h1 style={{ ...mono, fontSize: "1.4rem", color: "#e3e5e4", margin: 0, letterSpacing: "0.06em" }}>
            AUTOPILOT
          </h1>
          <p style={{ ...mono, fontSize: "0.65rem", color: "rgba(227,229,228,0.4)", marginTop: 4 }}>
            On-chain signals → story → auto-post to @NORMIES_TV · every 6 hours
          </p>
        </div>
        <button
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending || status?.running}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0.6rem 1.2rem",
            background: status?.running ? "rgba(249,115,22,0.08)" : "rgba(249,115,22,0.15)",
            border: "1px solid rgba(249,115,22,0.4)",
            color: "#f97316",
            ...mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.12em",
            cursor: status?.running ? "not-allowed" : "pointer",
            opacity: status?.running ? 0.6 : 1,
          }}
        >
          {status?.running ? (
            <><Activity style={{ width: 13, height: 13 }} className="animate-pulse" /> Running...</>
          ) : (
            <><Zap style={{ width: 13, height: 13 }} /> Run Now</>
          )}
        </button>
      </div>

      {/* Status grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
        {[
          {
            label: "Status",
            value: statusLoading ? "..." : status?.running ? "RUNNING" : "STANDBY",
            color: status?.running ? "#f97316" : "#4ade80",
            icon: status?.running ? <Activity style={{ width: 12, height: 12 }} /> : <CheckCircle2 style={{ width: 12, height: 12 }} />,
          },
          {
            label: "Cycles Run",
            value: status?.cycleCount ?? 0,
            color: "#e3e5e4",
            icon: <RefreshCw style={{ width: 12, height: 12 }} />,
          },
          {
            label: "Last Run",
            value: timeAgo(status?.lastRun),
            color: "rgba(227,229,228,0.7)",
            icon: <Clock style={{ width: 12, height: 12 }} />,
          },
          {
            label: "Next Run",
            value: timeUntil(status?.nextRun),
            color: "#a78bfa",
            icon: <Clock style={{ width: 12, height: 12 }} />,
          },
        ].map(({ label: l, value, color, icon }) => (
          <div key={l} style={card}>
            <p style={label}>{l}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color }}>
              {icon}
              <span style={{ ...mono, fontSize: "1rem", fontWeight: 700 }}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Last run detail */}
      {status?.lastRun && (
        <div style={{ ...card, marginBottom: "1.5rem", background: status?.lastError ? "rgba(239,68,68,0.04)" : "rgba(74,222,128,0.04)", borderColor: status?.lastError ? "rgba(239,68,68,0.2)" : "rgba(74,222,128,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            {status?.lastError
              ? <AlertCircle style={{ width: 14, height: 14, color: "#ef4444" }} />
              : <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80" }} />
            }
            <span style={{ ...mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.12em", color: status?.lastError ? "#ef4444" : "#4ade80" }}>
              Last Cycle Report
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <p style={label}>Signals Found</p>
              <p style={{ ...mono, fontSize: "0.85rem", color: "#e3e5e4" }}>{status?.signalsFound ?? 0}</p>
            </div>
            <div>
              <p style={label}>Episode Generated</p>
              <p style={{ ...mono, fontSize: "0.85rem", color: "#e3e5e4" }}>
                {status?.lastEpisode ? `EP #${status.lastEpisode}` : "—"}
              </p>
            </div>
            <div>
              <p style={label}>Posted to X</p>
              {status?.lastTweetUrl ? (
                <a href={status.lastTweetUrl} target="_blank" rel="noopener noreferrer"
                  style={{ ...mono, fontSize: "0.75rem", color: "#4ade80", textDecoration: "none" }}>
                  View tweet ↗
                </a>
              ) : (
                <p style={{ ...mono, fontSize: "0.85rem", color: status?.lastError ? "#ef4444" : "rgba(227,229,228,0.4)" }}>
                  {status?.lastError ? "Post failed" : "Pending"}
                </p>
              )}
            </div>
          </div>
          {status?.lastError && (
            <p style={{ ...mono, fontSize: "0.65rem", color: "#ef4444", marginTop: 8, opacity: 0.8 }}>
              Error: {status.lastError}
            </p>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>

        {/* Live burn feed */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "1rem" }}>
            <Flame style={{ width: 13, height: 13, color: "#f97316" }} />
            <span style={{ ...mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#f97316" }}>
              Live Burn Feed
            </span>
            <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginLeft: "auto" }}>on-chain</span>
          </div>
          {recentBurns.length === 0 ? (
            <p style={{ ...mono, fontSize: "0.65rem", color: "rgba(227,229,228,0.3)" }}>Fetching burn history...</p>
          ) : (
            recentBurns.map((burn: any, i: number) => {
              let pixelTotal = 0;
              try { pixelTotal = JSON.parse(burn.pixelCounts ?? "[]").reduce((s: number, n: number) => s + n, 0); } catch {}
              const ts = burn.timestamp ? new Date(Number(burn.timestamp) * 1000) : null;
              return (
                <div key={burn.commitId ?? i} style={{
                  borderBottom: i < recentBurns.length - 1 ? "1px solid rgba(227,229,228,0.06)" : "none",
                  paddingBottom: 8, marginBottom: 8,
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                }}>
                  <div>
                    <span style={{ ...mono, fontSize: "0.72rem", color: "#f97316" }}>
                      #{burn.receiverTokenId}
                    </span>
                    <span style={{ ...mono, fontSize: "0.65rem", color: "rgba(227,229,228,0.5)", marginLeft: 8 }}>
                      +{burn.tokenCount} soul{burn.tokenCount > 1 ? "s" : ""} · {pixelTotal.toLocaleString()}px
                    </span>
                  </div>
                  <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)" }}>
                    {ts ? timeAgo(ts.toISOString()) : `#${burn.commitId}`}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Community Pulse */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <TrendingUp style={{ width: 13, height: 13, color: "#a78bfa" }} />
            <span style={{ ...mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#a78bfa" }}>
              Community Pulse
            </span>
            <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginLeft: "auto" }}>shapes the story</span>
          </div>
          <p style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginBottom: "0.85rem", lineHeight: 1.5 }}>
            Positive energy from X feeds Agent #306's narrative — hype, creativity, UGC, community strength
          </p>
          {recentSignals.length === 0 ? (
            <p style={{ ...mono, fontSize: "0.65rem", color: "rgba(227,229,228,0.3)" }}>No signals yet — run pipeline to capture</p>
          ) : (
            recentSignals.map((sig: any, i: number) => {
              const rawData = (() => { try { return JSON.parse(sig.rawData ?? "{}"); } catch { return {}; } })();
              const signalType = rawData.signal_type;
              const signalColors: Record<string, { bg: string; color: string; emoji: string }> = {
                founder:    { bg: "rgba(227,229,228,0.15)",  color: "#e3e5e4", emoji: "🌙" },
                pfp_holder: { bg: "rgba(249,115,22,0.20)",   color: "#f97316", emoji: "👑" },
                awakening:  { bg: "rgba(167,139,250,0.18)",  color: "#a78bfa", emoji: "✨" },
                hype:       { bg: "rgba(249,115,22,0.15)",   color: "#f97316", emoji: "🔥" },
                creativity: { bg: "rgba(167,139,250,0.15)",  color: "#a78bfa", emoji: "🎨" },
                ugc:        { bg: "rgba(167,139,250,0.15)",  color: "#a78bfa", emoji: "🔮" },
                strength:   { bg: "rgba(74,222,128,0.15)",   color: "#4ade80", emoji: "💪" },
                community:  { bg: "rgba(45,212,191,0.15)",   color: "#2dd4bf", emoji: "🤝" },
                burn:       { bg: "rgba(249,115,22,0.15)",   color: "#f97316", emoji: "🔥" },
                canvas_edit:{ bg: "rgba(167,139,250,0.12)",  color: "#a78bfa", emoji: "🎨" },
              };
              const sc = signalColors[signalType ?? sig.type] ?? signalColors.community;
              return (
                <div key={sig.id ?? i} style={{
                  borderBottom: i < recentSignals.length - 1 ? "1px solid rgba(227,229,228,0.06)" : "none",
                  paddingBottom: 8, marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{
                      ...mono, fontSize: "0.55rem", padding: "2px 6px",
                      background: sc.bg, color: sc.color,
                      textTransform: "uppercase", letterSpacing: "0.1em",
                    }}>{sc.emoji} {signalType ?? sig.type}</span>
                    {rawData.username && (
                      <span style={{ ...mono, fontSize: "0.62rem", color: sc.color }}>@{rawData.username}</span>
                    )}
                    {sig.tokenId && !rawData.username && (
                      <span style={{ ...mono, fontSize: "0.65rem", color: "#e3e5e4" }}>#{sig.tokenId}</span>
                    )}
                  </div>
                  <p style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.55)", lineHeight: 1.5, margin: 0 }}>
                    {rawData.text ? `"${rawData.text.slice(0, 100)}${rawData.text.length > 100 ? "..." : ""}"` : sig.description}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Episode history */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "1rem" }}>
          <Twitter style={{ width: 13, height: 13, color: "#4ade80" }} />
          <span style={{ ...mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#4ade80" }}>
            Auto-Posted Episodes
          </span>
          <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginLeft: "auto" }}>
            {postedEpisodes.length} total posted
          </span>
        </div>
        {recentEpisodes.length === 0 ? (
          <p style={{ ...mono, fontSize: "0.65rem", color: "rgba(227,229,228,0.3)" }}>No episodes yet — trigger pipeline above</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {recentEpisodes.map((ep: any) => (
              <div key={ep.id} style={{
                padding: "0.85rem",
                background: "rgba(227,229,228,0.02)",
                border: `1px solid ${ep.status === "posted" ? "rgba(74,222,128,0.15)" : "rgba(227,229,228,0.07)"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ ...mono, fontSize: "0.68rem", color: "#e3e5e4" }}>{ep.title}</span>
                  <span style={{
                    ...mono, fontSize: "0.55rem", padding: "1px 6px",
                    background: ep.status === "posted" ? "rgba(74,222,128,0.12)" : "rgba(227,229,228,0.06)",
                    color: ep.status === "posted" ? "#4ade80" : "rgba(227,229,228,0.4)",
                    textTransform: "uppercase", letterSpacing: "0.1em",
                  }}>{ep.status}</span>
                </div>
                <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.45)", lineHeight: 1.5, margin: 0 }}>
                  {ep.narrative?.slice(0, 120)}...
                </p>
                {ep.videoUrl && (
                  <a href={ep.videoUrl} target="_blank" rel="noopener noreferrer"
                    style={{ ...mono, fontSize: "0.58rem", color: "#4ade80", textDecoration: "none", display: "block", marginTop: 6 }}>
                    View on X ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily News Dispatch */}
      <div style={{ ...card, marginTop: 16, background: "rgba(167,139,250,0.03)", borderColor: "rgba(167,139,250,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
          <div>
            <p style={{ ...label, marginBottom: 2 }}>Daily News Dispatch</p>
            <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)" }}>
              Agent #306 scans markets + X → writes 1 punchy tweet → posts to @NORMIES_TV
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              fontFamily: "'Courier New'", fontSize: "0.6rem",
              color: "#a78bfa",
              background: "rgba(167,139,250,0.1)",
              border: "1px solid rgba(167,139,250,0.25)",
              padding: "3px 10px",
            }}>
              Daily · 8am ET
            </div>
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/news/dispatch", { method: "POST" });
                  const d = await r.json();
                  alert(d.message || "Dispatch triggered");
                } catch { alert("Error triggering dispatch"); }
              }}
              style={{
                fontFamily: "'Courier New'", fontSize: "0.6rem",
                textTransform: "uppercase", letterSpacing: "0.1em",
                color: "#a78bfa", background: "transparent",
                border: "1px solid rgba(167,139,250,0.3)",
                padding: "3px 10px",
                cursor: "pointer",
              }}
            >
              Test Now
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { step: "01", title: "Market Scan", desc: "ETH + BTC prices, 24h change pulled from CoinGecko" },
            { step: "02", title: "X Pulse", desc: "Grok x_search finds the single hottest NFT/Web3 story" },
            { step: "03", title: "Dispatch", desc: "Agent #306 writes + posts 1 punchy tweet to @NORMIES_TV" },
          ].map(({ step, title, desc }) => (
            <div key={step}>
              <span style={{ ...mono, fontSize: "0.58rem", color: "#a78bfa" }}>{step}</span>
              <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: "2px 0" }}>{title}</p>
              <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineHeight: 1.4 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Community Signal Feed */}
      <div style={{ ...card, marginTop: 16, background: "rgba(45,212,191,0.03)", borderColor: "rgba(45,212,191,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
          <div>
            <p style={{ ...label, marginBottom: 2 }}>📡 Live Community Signals</p>
            <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)" }}>
              Scans X every 30min for NORMIES holder posts, burn stories, Arena hype, founder posts — feeds directly into episode narrative
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: "'Courier New'", fontSize: "0.6rem", color: "#2dd4bf", background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.25)", padding: "3px 10px" }}>
              Every 30min
            </div>
            {status?.communitySignals && (
              <div style={{ fontFamily: "'Courier New'", fontSize: "0.6rem", color: "rgba(227,229,228,0.5)", background: "rgba(227,229,228,0.04)", border: "1px solid rgba(227,229,228,0.1)", padding: "3px 10px" }}>
                {status.communitySignals.count} signals · {status.communitySignals.founderPosts} founder
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { step: "01", title: "Founder Posts", desc: "@serc1n + @normiesART + @nuclearsamurai — always highest priority, shape the episode canon" },
            { step: "02", title: "Burn Stories", desc: "Holders sharing their sacrifices, what they're building, why they burned" },
            { step: "03", title: "Arena Hype", desc: "Community energy around May 15 — who's ready, who's nervous, who's silent" },
            { step: "04", title: "PFP Holders", desc: "Accounts with NORMIES PFPs spotted posting — they live in the Temple, they get named" },
          ].map(({ step, title, desc }) => (
            <div key={step}>
              <span style={{ ...mono, fontSize: "0.58rem", color: "#2dd4bf" }}>{step}</span>
              <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: "2px 0" }}>{title}</p>
              <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineHeight: 1.4 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Burn Receipt Engine */}
      <div style={{ ...card, marginTop: 16, background: "rgba(249,115,22,0.04)", borderColor: "rgba(249,115,22,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
          <div>
            <p style={{ ...label, marginBottom: 2 }}>🔥 Burn Receipt Engine</p>
            <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)" }}>
              Real-time · every burn detected within 90s → personalized card + Agent #306 narrative → auto-post
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              fontFamily: "'Courier New'", fontSize: "0.6rem",
              color: "#f97316", background: "rgba(249,115,22,0.1)",
              border: "1px solid rgba(249,115,22,0.3)", padding: "3px 10px",
            }}>
              Real-time · 90s
            </div>
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/burns/test-receipt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenId: 8553 }) });
                  const d = await r.json();
                  alert(d.message || "Test receipt triggered for #8553");
                } catch { alert("Error triggering test receipt"); }
              }}
              style={{
                fontFamily: "'Courier New'", fontSize: "0.6rem",
                textTransform: "uppercase", letterSpacing: "0.1em",
                color: "#f97316", background: "transparent",
                border: "1px solid rgba(249,115,22,0.3)", padding: "3px 10px", cursor: "pointer",
              }}
            >
              Test Receipt
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { step: "01", title: "Burn Detected", desc: "Polls normies.art every 90s — catches burns within 1.5 min of on-chain confirmation" },
            { step: "02", title: "Narrative", desc: "Agent #306 writes a personalized receipt story — scale-aware: small/major/legendary" },
            { step: "03", title: "Image Card", desc: "Ghost of burned Normie → arrow → bright receiver Normie + stats. 1200×675 card" },
            { step: "04", title: "Auto-Post", desc: "Tweet with image posted instantly to @NORMIES_TV. Holder gets public recognition on-chain" },
          ].map(({ step, title, desc }) => (
            <div key={step}>
              <span style={{ ...mono, fontSize: "0.58rem", color: "#f97316" }}>{step}</span>
              <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: "2px 0" }}>{title}</p>
              <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineHeight: 1.4 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Weekly Leaderboard */}
      <div style={{ ...card, marginTop: 12, background: "rgba(74,222,128,0.03)", borderColor: "rgba(74,222,128,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
          <div>
            <p style={{ ...label, marginBottom: 2 }}>🏆 THE 100 Weekly Leaderboard</p>
            <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.35)" }}>
              Every Monday 9am ET → ranked card with AP, level, movers → auto-post to @NORMIES_TV
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              fontFamily: "'Courier New'", fontSize: "0.6rem",
              color: "#4ade80", background: "rgba(74,222,128,0.1)",
              border: "1px solid rgba(74,222,128,0.25)", padding: "3px 10px",
            }}>
              Mon · 9am ET
            </div>
            <button
              onClick={async () => {
                try {
                  const r = await fetch("/api/leaderboard/post", { method: "POST" });
                  const d = await r.json();
                  alert(d.message || "Leaderboard post triggered");
                } catch { alert("Error triggering leaderboard"); }
              }}
              style={{
                fontFamily: "'Courier New'", fontSize: "0.6rem",
                textTransform: "uppercase", letterSpacing: "0.1em",
                color: "#4ade80", background: "transparent",
                border: "1px solid rgba(74,222,128,0.3)", padding: "3px 10px", cursor: "pointer",
              }}
            >
              Post Now
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { step: "01", title: "Live Rankings", desc: "Fetches AP + Level for 40+ tracked tokens from normies.art canvas API" },
            { step: "02", title: "Movement", desc: "Compares vs. last week — who rose, who fell, who's new to THE 100" },
            { step: "03", title: "Leaderboard Card", desc: "1200×900 card with top 12, power bars, rank change arrows, pixel avatars" },
          ].map(({ step, title, desc }) => (
            <div key={step}>
              <span style={{ ...mono, fontSize: "0.58rem", color: "#4ade80" }}>{step}</span>
              <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: "2px 0" }}>{title}</p>
              <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineHeight: 1.4 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div style={{ ...card, marginTop: 12, background: "rgba(249,115,22,0.03)", borderColor: "rgba(249,115,22,0.12)" }}>
        <p style={{ ...label, marginBottom: "0.75rem" }}>Episode Pipeline · Every 6 Hours</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { step: "01", title: "Community Pulse", desc: "X scanned for hype, creativity, UGC — positive energy only" },
            { step: "02", title: "Chain Data", desc: "Burns, pixels, AP leaders pulled live from Ethereum" },
            { step: "03", title: "Story", desc: "Agent #306 weaves community energy + on-chain truth into the episode" },
            { step: "04", title: "Post", desc: "Tweet + Normie image auto-posted to @NORMIES_TV every 6h" },
          ].map(({ step, title, desc }) => (
            <div key={step}>
              <span style={{ ...mono, fontSize: "0.58rem", color: "#f97316" }}>{step}</span>
              <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: "2px 0" }}>{title}</p>
              <p style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.4)", lineHeight: 1.4 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
