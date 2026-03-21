import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ─────────────────────────────────────────────────────────
interface CommunityPost {
  username: string; text: string; likes: number;
  url: string; signal_type: string; capturedAt: string | null;
}
interface TypeGroup { type: string; count: number; posts: CommunityPost[]; }
interface DigestData {
  totalPosts: number; uniquePosters: number;
  byType: TypeGroup[]; summary: string;
  storyAngles: string[]; generatedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────
function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  founder:          { label: "Founder · serc1n",   color: "#f97316", emoji: "🎯" },
  developer:        { label: "Developer · Yigit",  color: "#f97316", emoji: "⚙️" },
  creator:          { label: "Creator",            color: "#2dd4bf", emoji: "🎨" },
  holder_builder:   { label: "Holders · Builders", color: "#4ade80", emoji: "🔨" },
  burn_story:       { label: "Burn Stories",       color: "#f97316", emoji: "🔥" },
  arena_prep:       { label: "Arena Prep",         color: "#a78bfa", emoji: "⚔️" },
  arena_hype:       { label: "Arena Hype",         color: "#a78bfa", emoji: "⚔️" },
  nfc_summit:       { label: "NFC Summit",         color: "#fbbf24", emoji: "🏛️" },
  pfp_holder:       { label: "PFP Holders",        color: "#4ade80", emoji: "👤" },
  holder_spotlight: { label: "Holder Spotlight",   color: "#4ade80", emoji: "✨" },
  xnormies:         { label: "XNORMIES",           color: "#2dd4bf", emoji: "🎁" },
  creativity:       { label: "Creativity",         color: "#2dd4bf", emoji: "🎨" },
  holder_milestone: { label: "Milestones",         color: "#4ade80", emoji: "🏆" },
  community:        { label: "Community",          color: "#e3e5e4", emoji: "💬" },
  engagement:       { label: "Engagement",         color: "#e3e5e4", emoji: "↩️" },
  general:          { label: "General",            color: "rgba(227,229,228,0.4)", emoji: "📌" },
};

const SENTIMENT_CONFIG: Record<string, { color: string; label: string }> = {
  excited:     { color: "#f97316", label: "🔥 Excited" },
  building:    { color: "#4ade80", label: "🔨 Building" },
  celebratory: { color: "#f97316", label: "🎉 Celebrating" },
  anxious:     { color: "#f87171", label: "😤 Anxious" },
  quiet:       { color: "rgba(227,229,228,0.4)", label: "🤫 Quiet" },
};

// ─── Post Card ─────────────────────────────────────────────────────
function PostCard({ post }: { post: CommunityPost }) {
  const cfg = TYPE_CONFIG[post.signal_type] ?? TYPE_CONFIG.general;
  return (
    <div style={{
      padding: "0.75rem 1rem",
      background: "rgba(227,229,228,0.02)",
      border: "1px solid rgba(227,229,228,0.06)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontFamily: "'Courier New'", fontSize: "0.6rem",
          color: cfg.color, background: `${cfg.color}15`,
          border: `1px solid ${cfg.color}25`,
          padding: "1px 6px", flexShrink: 0,
        }}>{cfg.emoji} {cfg.label}</span>
        <span style={{ fontFamily: "'Courier New'", fontSize: "0.68rem", color: "#f97316", fontWeight: 700 }}>
          @{post.username}
        </span>
        {post.likes > 0 && (
          <span style={{ fontFamily: "'Courier New'", fontSize: "0.58rem", color: "rgba(227,229,228,0.35)", marginLeft: "auto" }}>
            ♥ {post.likes}
          </span>
        )}
        <span style={{ fontFamily: "'Courier New'", fontSize: "0.55rem", color: "rgba(227,229,228,0.25)" }}>
          {timeAgo(post.capturedAt)}
        </span>
      </div>
      <p style={{
        fontFamily: "'Courier New'", fontSize: "0.75rem",
        color: "rgba(227,229,228,0.8)", lineHeight: 1.6, margin: 0,
      }}>
        {post.text}
      </p>
      {post.url && (
        <a href={post.url} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: "'Courier New'", fontSize: "0.58rem", color: "rgba(249,115,22,0.5)", textDecoration: "none" }}>
          View on X →
        </a>
      )}
    </div>
  );
}

// ─── Story Angle Card ──────────────────────────────────────────────
function StoryAngleCard({ angle, onPin }: { angle: string; onPin: (a: string) => void }) {
  return (
    <div style={{
      padding: "0.85rem 1rem",
      background: "rgba(167,139,250,0.04)",
      border: "1px solid rgba(167,139,250,0.15)",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ color: "#a78bfa", fontSize: "0.8rem", flexShrink: 0, marginTop: 2 }}>▸</span>
      <p style={{
        fontFamily: "'Courier New'", fontSize: "0.78rem",
        color: "rgba(227,229,228,0.85)", lineHeight: 1.6, margin: 0, flex: 1,
      }}>
        {angle}
      </p>
      <button
        onClick={() => onPin(angle)}
        style={{
          fontFamily: "'Courier New'", fontSize: "0.58rem",
          textTransform: "uppercase", letterSpacing: "0.1em",
          color: "#a78bfa", background: "transparent",
          border: "1px solid rgba(167,139,250,0.3)",
          padding: "3px 8px", cursor: "pointer", flexShrink: 0,
          transition: "border-color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(167,139,250,0.8)")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(167,139,250,0.3)")}
      >
        Pin →
      </button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────
export default function CommunityIntel() {
  const { toast } = useToast();

  const { data, isLoading, refetch, isFetching } = useQuery<DigestData>({
    queryKey: ["/api/community/digest"],
    queryFn: () => apiRequest("GET", "/api/community/digest").then(r => r.json()),
    staleTime: 25 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  const { data: pinned } = useQuery<{ pinnedAngles: string[] }>({
    queryKey: ["/api/community/pinned"],
    refetchInterval: 60_000,
  });

  const pinMutation = useMutation({
    mutationFn: (angle: string) =>
      apiRequest("POST", "/api/community/pin-angle", { angle }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/pinned"] });
      toast({ title: "Story angle pinned", description: "Agent #306 will use this in the next episode." });
    },
  });

  const mono = { fontFamily: "'Courier New', monospace" } as const;
  const label = { ...mono, fontSize: "0.65rem", textTransform: "uppercase" as const, letterSpacing: "0.15em", color: "rgba(227,229,228,0.4)" };
  const card = {
    background: "rgba(227,229,228,0.03)",
    border: "1px solid rgba(227,229,228,0.08)",
    padding: "1.25rem",
  };

  // Sort type groups: founders first, then by count
  const sortedGroups = [...(data?.byType ?? [])].sort((a, b) => {
    if (a.type === "founder") return -1;
    if (b.type === "founder") return 1;
    return b.count - a.count;
  });

  const sentiment = data?.summary ? "building" : "quiet";
  const sentCfg = SENTIMENT_CONFIG[sentiment] ?? SENTIMENT_CONFIG.quiet;

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: 1100, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", paddingBottom: "1rem", borderBottom: "1px solid rgba(227,229,228,0.08)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2dd4bf", display: "inline-block", animation: "pulse-dot 1.6s ease-in-out infinite" }} />
            <h1 className="pixel" style={{ fontSize: "1.1rem", color: "#e3e5e4", letterSpacing: "0.12em", margin: 0 }}>
              COMMUNITY INTEL
            </h1>
          </div>
          <p style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.35)", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            What NORMIES are posting · Shape the next episode · You're the editor
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {data?.generatedAt && (
            <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.25)" }}>
              {timeAgo(data.generatedAt)}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              ...mono, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em",
              color: "#2dd4bf", background: "transparent",
              border: "1px solid rgba(45,212,191,0.3)", padding: "0.35rem 0.85rem",
              cursor: "pointer", opacity: isFetching ? 0.5 : 1,
            }}
          >
            {isFetching ? "Scanning..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
        {[
          { label: "Posts Found", value: isLoading ? "..." : String(data?.totalPosts ?? 0), color: "#e3e5e4" },
          { label: "Unique Holders", value: isLoading ? "..." : String(data?.uniquePosters ?? 0), color: "#4ade80" },
          { label: "Story Angles", value: isLoading ? "..." : String(data?.storyAngles?.length ?? 0), color: "#a78bfa" },
          { label: "Pinned Angles", value: isLoading ? "..." : String(pinned?.pinnedAngles?.length ?? 0), color: "#f97316" },
        ].map(({ label: l, value, color }) => (
          <div key={l} style={card}>
            <p style={label}>{l}</p>
            <p style={{ ...mono, fontSize: "1.4rem", fontWeight: 700, color, margin: "4px 0 0" }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem" }}>

        {/* ── LEFT: Summary + Story Angles ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* AI Summary */}
          {(isLoading || data?.summary) && (
            <section style={card}>
              <p style={{ ...label, marginBottom: "0.85rem" }}>📡 What the Community is Saying Today</p>
              {isLoading
                ? <div style={{ height: 60, background: "rgba(227,229,228,0.04)", animation: "pulse-skeleton 1.6s infinite" }} />
                : (
                  <p style={{ ...mono, fontSize: "0.8rem", color: "rgba(227,229,228,0.8)", lineHeight: 1.8, margin: 0 }}>
                    {data?.summary || "Scanning community posts..."}
                  </p>
                )
              }
            </section>
          )}

          {/* Story Angles */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.85rem" }}>
              <div style={{ width: 3, height: 18, background: "#a78bfa", flexShrink: 0 }} />
              <span className="pixel upper" style={{ fontSize: "0.7rem", letterSpacing: "0.2em", color: "#e3e5e4" }}>
                Story Angles for Agent #306
              </span>
              <span style={{ ...mono, fontSize: "0.58rem", color: "rgba(227,229,228,0.3)", marginLeft: 4 }}>
                Pin one to shape the next episode
              </span>
            </div>
            {isLoading
              ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[1,2,3].map(i => <div key={i} style={{ height: 52, background: "rgba(227,229,228,0.04)", animation: "pulse-skeleton 1.6s infinite" }} />)}
                </div>
              : data?.storyAngles?.length
                ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.storyAngles.map((angle, i) => (
                      <StoryAngleCard key={i} angle={angle} onPin={a => pinMutation.mutate(a)} />
                    ))}
                  </div>
                : (
                  <div style={{ ...card, color: "rgba(227,229,228,0.35)", ...mono, fontSize: "0.7rem", textAlign: "center" as const, padding: "1.5rem" }}>
                    Refresh to generate story angles from today's community posts
                  </div>
                )
            }
          </section>

          {/* All Posts by Type */}
          {sortedGroups.map(group => {
            const cfg = TYPE_CONFIG[group.type] ?? TYPE_CONFIG.general;
            return (
              <section key={group.type}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.75rem" }}>
                  <div style={{ width: 3, height: 18, background: cfg.color, flexShrink: 0 }} />
                  <span className="pixel upper" style={{ fontSize: "0.68rem", letterSpacing: "0.15em", color: "#e3e5e4" }}>
                    {cfg.emoji} {cfg.label}
                  </span>
                  <span style={{ ...mono, fontSize: "0.6rem", color: "rgba(227,229,228,0.3)" }}>
                    {group.count} post{group.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {group.posts.map((post, i) => (
                    <PostCard key={i} post={post} />
                  ))}
                </div>
              </section>
            );
          })}

          {!isLoading && (!data || data.totalPosts === 0) && (
            <div style={{ ...card, textAlign: "center" as const, padding: "2rem" }}>
              <div className="pixel" style={{ fontSize: "0.7rem", color: "#f97316", marginBottom: 8 }}>NO SIGNALS YET</div>
              <p style={{ ...mono, fontSize: "0.72rem", color: "rgba(227,229,228,0.4)" }}>
                Hit Refresh to scan X for NORMIES community posts.
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT: Pinned Angles + Type Breakdown ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Pinned Angles */}
          <section style={card}>
            <p style={{ ...label, marginBottom: "0.85rem" }}>📌 Pinned for Next Episode</p>
            {pinned?.pinnedAngles?.length
              ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pinned.pinnedAngles.map((angle, i) => (
                    <div key={i} style={{
                      padding: "0.65rem 0.85rem",
                      background: "rgba(249,115,22,0.05)",
                      border: "1px solid rgba(249,115,22,0.2)",
                    }}>
                      <p style={{ ...mono, fontSize: "0.72rem", color: "#e3e5e4", margin: 0, lineHeight: 1.5 }}>
                        {angle}
                      </p>
                      <p style={{ ...mono, fontSize: "0.56rem", color: "rgba(249,115,22,0.5)", marginTop: 4 }}>
                        Agent #306 will use this →
                      </p>
                    </div>
                  ))}
                </div>
              : (
                <p style={{ ...mono, fontSize: "0.7rem", color: "rgba(227,229,228,0.3)", textAlign: "center" as const, padding: "0.5rem 0" }}>
                  No angles pinned yet.<br />Pin a story angle above to guide the next episode.
                </p>
              )
            }
          </section>

          {/* Signal type breakdown */}
          <section style={card}>
            <p style={{ ...label, marginBottom: "0.85rem" }}>Signal Breakdown</p>
            {isLoading
              ? <div style={{ height: 120, background: "rgba(227,229,228,0.04)", animation: "pulse-skeleton 1.6s infinite" }} />
              : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sortedGroups.map(group => {
                    const cfg = TYPE_CONFIG[group.type] ?? TYPE_CONFIG.general;
                    const pct = data ? Math.round((group.count / data.totalPosts) * 100) : 0;
                    return (
                      <div key={group.type}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ ...mono, fontSize: "0.62rem", color: cfg.color }}>{cfg.emoji} {cfg.label}</span>
                          <span style={{ ...mono, fontSize: "0.62rem", color: "rgba(227,229,228,0.4)" }}>{group.count}</span>
                        </div>
                        <div style={{ height: 4, background: "rgba(227,229,228,0.06)" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: cfg.color, opacity: 0.7 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </section>

          {/* How it works */}
          <section style={{ ...card, background: "rgba(45,212,191,0.03)", borderColor: "rgba(45,212,191,0.12)" }}>
            <p style={{ ...label, marginBottom: "0.85rem", color: "#2dd4bf" }}>You're the Editor</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", text: "Community posts about NORMIES are scanned from X every 30 minutes" },
                { step: "2", text: "Grok classifies and summarizes what the community is saying today" },
                { step: "3", text: "Story angles are surfaced — you review and pin what feels right" },
                { step: "4", text: "Pinned angles feed directly into Agent #306's next episode narrative" },
              ].map(({ step, text }) => (
                <div key={step} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ ...mono, fontSize: "0.6rem", color: "#2dd4bf", flexShrink: 0, marginTop: 2 }}>{step}.</span>
                  <p style={{ ...mono, fontSize: "0.68rem", color: "rgba(227,229,228,0.6)", lineHeight: 1.5, margin: 0 }}>{text}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <style>{`
        @keyframes pulse-skeleton { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
      `}</style>
    </div>
  );
}
