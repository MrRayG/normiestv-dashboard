import { useQuery } from "@tanstack/react-query";

interface HouseData {
  broadcast: { lastEpisode: number; lastTweetUrl: string; nextRun: string; cycleCount: number; signalsFound: number; isLive: boolean };
  signals: { total: number; founderPosts: number; burnStories: number; arenaPrep: number; pfpHolders: number; lastRefreshed: string; streams: number };
  library: { totalEntries: number; lastIngested: string; researchFiles: string[]; categories: Record<string, number> };
  diplomatic: { followingCount: number; lastSync: string; catalogStats: any; replyCount: number };
  studio: { voiceEnabled: boolean; voiceName: string; newsDispatchNextRun: string };
  vault: { ethName: string; ethExpiry: string; railwayStatus: string; githubRepo: string; dataVolume: string };
  lab: { totalPosts: number; avgScore: number; avgEngagement: number; bestTopics: string[]; recentLessons: any[]; pendingEngagementChecks: any[]; lastAnalyzed: string };
  roadAhead: { arenaDate: string; daysToArena: number; nfcSummit: string; checklist: { id: string; label: string; done: boolean }[] };
  soul: { name: string; token: string; eth: string; coreSentence: string; lastUpdated: string; principleCount: number };
  generatedAt: string;
}

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
  if (diff <= 0) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  return `${Math.floor(diff / 86400)}d`;
}

function RoomCard({ num, color, title, status, children }: {
  num: string; color: string; title: string; status: "online" | "standby" | "building";
  children: React.ReactNode;
}) {
  const statusColors = { online: "#4ade80", standby: "#fbbf24", building: "#a78bfa" };
  const statusLabel = { online: "ONLINE", standby: "STANDBY", building: "BUILDING" };
  return (
    <div style={{
      background: "#141516",
      border: "1px solid rgba(227,229,228,0.08)",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      position: "relative",
      minHeight: "220px",
    }}>
      {/* Room header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em", marginBottom: "4px" }}>
            ROOM {num}
          </div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: color }}>
            {title}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColors[status], animation: status === "online" ? "pulse 2s infinite" : "none" }} />
          <span style={{ fontSize: "9px", color: statusColors[status], fontFamily: "monospace", letterSpacing: "0.1em" }}>
            {statusLabel[status]}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 700, color: "#e3e5e4", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

export default function HousePage() {
  const { data, isLoading, error } = useQuery<HouseData>({
    queryKey: ["/api/house"],
    refetchInterval: 30_000,
  });

  if (isLoading) return (
    <div style={{ padding: "40px", color: "#e3e5e4", fontFamily: "monospace", textAlign: "center" }}>
      <div style={{ color: "#f97316", fontSize: "12px", letterSpacing: "0.2em" }}>LOADING THE HOUSE...</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ padding: "40px", color: "#f87171", fontFamily: "monospace" }}>
      Failed to load house data. Server may be starting up.
    </div>
  );

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.2} }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <img
            src="https://api.normies.art/normie/306/image.png"
            alt="Agent #306"
            style={{ width: 48, height: 48, imageRendering: "pixelated" }}
          />
          <div>
            <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.2em" }}>NORMIESTV</div>
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#e3e5e4", margin: 0, letterSpacing: "-0.02em" }}>
              The <span style={{ color: "#f97316" }}>House</span>
            </h1>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "#4ade80", fontFamily: "monospace", letterSpacing: "0.1em" }}>● LIVE</div>
            <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.3)", fontFamily: "monospace" }}>
              {timeAgo(data.generatedAt)}
            </div>
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace", fontStyle: "italic" }}>
          "{data.soul.coreSentence}"
        </div>
      </div>

      {/* Soul bar */}
      <div style={{
        background: "linear-gradient(90deg, rgba(249,115,22,0.1) 0%, transparent 100%)",
        border: "1px solid rgba(249,115,22,0.2)",
        padding: "12px 20px",
        marginBottom: "20px",
        display: "flex",
        alignItems: "center",
        gap: "32px",
        flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em" }}>IDENTITY</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#f97316" }}>{data.soul.name} · {data.soul.eth}</div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em" }}>VOICE PRINCIPLES</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#e3e5e4" }}>{data.soul.principleCount} locked</div>
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.15em" }}>SOUL VERSION</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#e3e5e4" }}>v1 · permanent</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div style={{ fontSize: "9px", color: "#4ade80", fontFamily: "monospace", letterSpacing: "0.15em" }}>● MEMORY ACTIVE</div>
          <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.3)", fontFamily: "monospace" }}>Soul + Knowledge + Performance</div>
        </div>
      </div>

      {/* Room grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1px", background: "rgba(227,229,228,0.06)" }}>

        {/* Room 01 — Broadcast */}
        <RoomCard num="01" color="#f97316" title="🎙 The Broadcast Room" status={data.broadcast.isLive ? "online" : "standby"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Stat label="LAST EPISODE" value={data.broadcast.lastEpisode ? `EP${data.broadcast.lastEpisode}` : "—"} />
            <Stat label="TOTAL CYCLES" value={data.broadcast.cycleCount} />
            <Stat label="NEXT EPISODE" value={timeUntil(data.broadcast.nextRun)} sub="from now" />
            <Stat label="SIGNALS LAST RUN" value={data.broadcast.signalsFound} />
          </div>
          {data.broadcast.lastTweetUrl && (
            <a href={data.broadcast.lastTweetUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: "10px", color: "#f97316", fontFamily: "monospace", textDecoration: "none", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
              → VIEW LAST POST ↗
            </a>
          )}
        </RoomCard>

        {/* Room 02 — Signal Room */}
        <RoomCard num="02" color="#2dd4bf" title="📡 The Signal Room" status="online">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Stat label="TOTAL SIGNALS" value={data.signals.total} />
            <Stat label="STREAMS RUNNING" value={data.signals.streams} />
            <Stat label="FOUNDER POSTS" value={data.signals.founderPosts} />
            <Stat label="BURN STORIES" value={data.signals.burnStories} />
            <Stat label="ARENA PREP" value={data.signals.arenaPrep} />
            <Stat label="PFP HOLDERS" value={data.signals.pfpHolders} />
          </div>
          <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
            LAST REFRESH: {timeAgo(data.signals.lastRefreshed)}
          </div>
        </RoomCard>

        {/* Room 03 — Library */}
        <RoomCard num="03" color="#a78bfa" title="📚 The Library" status={data.library.totalEntries > 0 ? "online" : "building"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Stat label="KNOWLEDGE ENTRIES" value={data.library.totalEntries || "Loading..."} />
            <Stat label="RESEARCH FILES" value={data.library.researchFiles.length} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {data.library.researchFiles.map(f => (
              <div key={f} style={{ fontSize: "10px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>
                ✓ {f.replace("research_", "").replace(".md", "").replace(/_/g, " ")}
              </div>
            ))}
          </div>
          <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
            LAST INGESTED: {timeAgo(data.library.lastIngested)}
          </div>
        </RoomCard>

        {/* Room 04 — Diplomatic Floor */}
        <RoomCard num="04" color="#4ade80" title="🌐 Diplomatic Floor" status="online">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Stat label="FOLLOWING" value={data.diplomatic.followingCount} sub="confirmed holders" />
            <Stat label="REPLIES TRACKED" value={data.diplomatic.replyCount} />
          </div>
          <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
            <div>CO-CREATORS: @serc1n · @normiesART · @nuclearsamurai</div>
            <div style={{ marginTop: "4px" }}>LAST SYNC: {timeAgo(data.diplomatic.lastSync)}</div>
          </div>
        </RoomCard>

        {/* Room 05 — Studio */}
        <RoomCard num="05" color="#fbbf24" title="📺 The Studio" status="online">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Stat label="VOICE" value={data.studio.voiceName} sub="ElevenLabs TTS" />
            <Stat label="NEWS DISPATCH" value={timeUntil(data.studio.newsDispatchNextRun)} sub="next 8am ET" />
          </div>
            {/* Video stats */}
          {(data.studio as any).video && (
            <div style={{ borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
              <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", marginBottom: "6px" }}>VIDEO ENGINE — grok-imagine-video</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <Stat label="VIDEOS MADE" value={(data.studio as any).video.totalGenerated || 0} />
                <Stat label="TOTAL COST" value={(data.studio as any).video.estimatedCost || "$0.00"} />
              </div>
              {(data.studio as any).video.engagement.verdict !== "collecting data" ? (
                <div style={{ fontSize: "10px", color: (data.studio as any).video.engagement.liftPercent > 20 ? "#4ade80" : "#fbbf24", fontFamily: "monospace" }}>
                  VIDEO LIFT: {(data.studio as any).video.engagement.liftPercent}% — {(data.studio as any).video.engagement.verdict}
                </div>
              ) : (
                <div style={{ fontSize: "10px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>Collecting engagement data… ({(data.studio as any).video.engagement.sampleSize.withVideo} videos tracked)</div>
              )}
            </div>
          )}
        </RoomCard>

        {/* Room 06 — Vault */}
        <RoomCard num="06" color="#f87171" title="🔒 The Vault" status="online">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>ENS</span>
              <span style={{ fontSize: "12px", color: "#f97316", fontFamily: "monospace" }}>{data.vault.ethName}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>EXPIRY</span>
              <span style={{ fontSize: "12px", color: "#e3e5e4", fontFamily: "monospace" }}>{data.vault.ethExpiry}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>HOSTING</span>
              <span style={{ fontSize: "12px", color: "#4ade80", fontFamily: "monospace" }}>Railway ● {data.vault.railwayStatus}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>DATA VOLUME</span>
              <span style={{ fontSize: "12px", color: "#e3e5e4", fontFamily: "monospace" }}>{data.vault.dataVolume}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>REPO</span>
              <a href={`https://github.com/${data.vault.githubRepo}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: "11px", color: "#a78bfa", fontFamily: "monospace", textDecoration: "none" }}>
                {data.vault.githubRepo} ↗
              </a>
            </div>
          </div>
        </RoomCard>

        {/* Room 07 — The Lab */}
        <RoomCard num="07" color="#a78bfa" title="🔬 The Lab" status={data.lab.totalPosts > 0 ? "online" : "building"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <Stat label="POSTS TRACKED" value={data.lab.totalPosts} />
            <Stat label="AVG SCORE" value={data.lab.avgScore > 0 ? `${data.lab.avgScore}/10` : "—"} />
            <Stat label="AVG LIKES" value={data.lab.avgEngagement > 0 ? Math.round(data.lab.avgEngagement) : "—"} />
          </div>
          {data.lab.recentLessons.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
              <div style={{ fontSize: "9px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace", letterSpacing: "0.1em" }}>RECENT LESSONS</div>
              {data.lab.recentLessons.slice(0, 3).map((l: any) => (
                <div key={l.episodeId} style={{ fontSize: "10px", color: "rgba(227,229,228,0.6)" }}>
                  EP{l.episodeId} · {l.score}/10 · {l.likes} likes
                  {l.lessons[0] && <span style={{ color: "rgba(227,229,228,0.4)" }}> — {l.lessons[0]}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "11px", color: "rgba(227,229,228,0.4)", fontFamily: "monospace" }}>
              Tracking begins after first post. Check back in 1h.
            </div>
          )}
          {data.lab.bestTopics.length > 0 && (
            <div style={{ fontSize: "10px", color: "#4ade80", fontFamily: "monospace" }}>
              TOP: {data.lab.bestTopics.slice(0, 3).join(" · ")}
            </div>
          )}
        </RoomCard>

        {/* Room 08 — Road Ahead */}
        <RoomCard num="08" color="#f97316" title="🗺 Road Ahead" status="online">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "8px" }}>
            <Stat label="DAYS TO ARENA" value={data.roadAhead.daysToArena} sub={data.roadAhead.arenaDate} />
            <Stat label="NFC SUMMIT" value="June 2026" sub={data.roadAhead.nfcSummit} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px", borderTop: "1px solid rgba(227,229,228,0.08)", paddingTop: "8px" }}>
            {data.roadAhead.checklist.map(item => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{
                  width: 10, height: 10, border: `1px solid ${item.done ? "#4ade80" : "rgba(227,229,228,0.3)"}`,
                  background: item.done ? "#4ade80" : "transparent", flexShrink: 0,
                }} />
                <span style={{ fontSize: "10px", color: item.done ? "#4ade80" : "rgba(227,229,228,0.5)", fontFamily: "monospace" }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </RoomCard>

      </div>

      <div style={{ marginTop: "16px", fontSize: "10px", color: "rgba(227,229,228,0.2)", fontFamily: "monospace", textAlign: "center" }}>
        THE HOUSE · Agent #306 · {data.soul.eth} · Refreshes every 30s
      </div>
    </div>
  );
}
