import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Film, RefreshCw, Send, CheckCircle2, Clock, Loader2,
  Share2, FileText, Zap, Flame, ExternalLink, Play
} from "lucide-react";
import { useState } from "react";
import type { Episode } from "@shared/schema";

const STATUS_CONFIG = {
  draft:     { icon: FileText,    label: "Draft",     className: "status-draft",     bg: "bg-muted/50" },
  rendering: { icon: Loader2,     label: "Rendering", className: "status-rendering", bg: "bg-yellow-400/10" },
  ready:     { icon: CheckCircle2,label: "Ready",     className: "status-ready",     bg: "bg-cyan-400/10" },
  posted:    { icon: Share2,      label: "Posted",    className: "status-posted",    bg: "bg-green-400/10" },
};

const PHASE_LABELS: Record<string, string> = {
  phase1: "Canvas · P1",
  phase2: "Arena · P2",
  phase3: "Zombies · P3",
};

function buildTweetText(episode: Episode): string {
  // Twitter limit: 280 chars. Build a crisp version.
  const base = episode.narrative.replace(/^🌙 SKULLIEMOON SPEAKS: /, "🌙 ");
  const truncated = base.length > 220 ? base.slice(0, 217) + "…" : base;
  return `${truncated}\n\n#NormiesTV #Normies #Web3 #NFT`;
}

function EpisodeCard({ episode, onUpdateStatus, onPostToX, isPosting }: {
  episode: Episode;
  onUpdateStatus: (id: number, status: string) => void;
  onPostToX: (episode: Episode) => void;
  isPosting: boolean;
}) {
  const [showTweet, setShowTweet] = useState(false);
  const [tweetText, setTweetText] = useState(() => buildTweetText(episode));
  const cfg = STATUS_CONFIG[episode.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const StatusIcon = cfg.icon;
  const isSpinning = episode.status === "rendering";

  return (
    <Card className="pixel-hover" data-testid={`card-episode-${episode.id}`}>
      <CardContent className="p-4">
        <div className="flex gap-3">
          <img
            src={`https://api.normies.art/normie/${episode.tokenId}/image.svg`}
            alt={`Normie #${episode.tokenId}`}
            className="w-14 h-14 rounded border border-border bg-secondary/50 object-contain shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{episode.title}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${episode.phase}-badge`}>
                    {PHASE_LABELS[episode.phase] ?? episode.phase}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">Token #{episode.tokenId}</span>
                  {episode.postedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      Posted {new Date(episode.postedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded shrink-0 ${cfg.bg}`}>
                <StatusIcon className={`w-3.5 h-3.5 ${cfg.className} ${isSpinning ? "animate-spin" : ""}`} />
                <span className={`text-[11px] font-medium ${cfg.className}`}>{cfg.label}</span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed line-clamp-2">
              {episode.narrative}
            </p>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3 flex-wrap">
              {episode.status === "draft" && (
                <Button size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => onUpdateStatus(episode.id, "ready")}
                  data-testid={`button-mark-ready-${episode.id}`}>
                  <CheckCircle2 className="w-3 h-3 mr-1.5" /> Mark Ready
                </Button>
              )}

              {episode.status === "ready" && (
                <>
                  <Button size="sm" className="text-xs h-7 bg-primary hover:bg-primary/80"
                    onClick={() => setShowTweet(!showTweet)}
                    data-testid={`button-compose-${episode.id}`}>
                    <Send className="w-3 h-3 mr-1.5" /> Post to X
                  </Button>
                </>
              )}

              {episode.status === "posted" && episode.videoUrl && (
                <a href={episode.videoUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="text-xs h-7">
                    <ExternalLink className="w-3 h-3 mr-1.5" /> View on X
                  </Button>
                </a>
              )}
            </div>

            {/* Tweet composer */}
            {showTweet && episode.status === "ready" && (
              <div className="mt-3 space-y-2 border border-primary/30 rounded p-3 bg-primary/5">
                <p className="text-[10px] text-primary font-semibold uppercase tracking-wider">
                  Tweet Preview — {tweetText.length}/280 chars
                </p>
                <textarea
                  value={tweetText}
                  onChange={e => setTweetText(e.target.value)}
                  rows={4}
                  maxLength={280}
                  className="w-full text-xs bg-secondary border border-border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  data-testid={`textarea-tweet-${episode.id}`}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="text-xs h-7 flex-1"
                    onClick={() => onPostToX({ ...episode, narrative: tweetText })}
                    disabled={isPosting || tweetText.length > 280}
                    data-testid={`button-send-tweet-${episode.id}`}
                  >
                    {isPosting
                      ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Posting…</>
                      : <><Send className="w-3 h-3 mr-1.5" /> Post Now</>
                    }
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7"
                    onClick={() => setShowTweet(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EpisodeQueue() {
  const { toast } = useToast();
  const [postingId, setPostingId] = useState<number | null>(null);

  const { data: episodes = [], isLoading, refetch } = useQuery<Episode[]>({
    queryKey: ["/api/episodes"],
    refetchInterval: 30_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/episodes/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/episodes"] });
      toast({ title: "Episode updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update", variant: "destructive" }),
  });

  const pollerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/poller/run"),
    onSuccess: () => {
      toast({ title: "Signal poll triggered", description: "New episode will appear in ~10 seconds" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/episodes"] }), 12_000);
    },
  });

  const postToXMutation = useMutation({
    mutationFn: ({ episodeId, text }: { episodeId: number; text: string }) =>
      apiRequest("POST", "/api/x/post", { episodeId, text }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/episodes"] });
      setPostingId(null);
      toast({
        title: "Posted to X!",
        description: data.tweetUrl
          ? `Live at ${data.tweetUrl}`
          : "Episode posted to @NORMIES_TV",
      });
    },
    onError: (e: any) => {
      setPostingId(null);
      toast({ title: "Post failed", description: e.message ?? "Check X API credentials", variant: "destructive" });
    },
  });

  const handlePostToX = (episode: Episode) => {
    setPostingId(episode.id);
    postToXMutation.mutate({ episodeId: episode.id, text: buildTweetText(episode) });
  };

  const counts = {
    total: episodes.length,
    draft: episodes.filter(e => e.status === "draft").length,
    rendering: episodes.filter(e => e.status === "rendering").length,
    ready: episodes.filter(e => e.status === "ready").length,
    posted: episodes.filter(e => e.status === "posted").length,
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Episode Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Generated clips — manage status and post to X</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"
            onClick={() => pollerMutation.mutate()}
            disabled={pollerMutation.isPending}
            data-testid="button-run-poller">
            {pollerMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <Zap className="w-3.5 h-3.5 mr-1.5" />}
            Generate Now
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-episodes">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total",     value: counts.total,     cls: "" },
          { label: "Draft",     value: counts.draft,     cls: "status-draft" },
          { label: "Rendering", value: counts.rendering, cls: "status-rendering" },
          { label: "Ready",     value: counts.ready,     cls: "status-ready" },
          { label: "Posted",    value: counts.posted,    cls: "status-posted" },
        ].map(s => (
          <Card key={s.label} className="pixel-hover">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest">{s.label}</p>
              <p className={`text-2xl font-bold font-mono mt-1 ${s.cls}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-1 text-[11px]">
            {[
              { label: "Signal Poll", desc: "Burns + canvas", icon: Zap },
              null,
              { label: "Story Engine", desc: "AI narrative", icon: Film },
              null,
              { label: "Episode Queue", desc: "Ready to post", icon: CheckCircle2 },
              null,
              { label: "Post to X", desc: "@NORMIES_TV", icon: Send },
            ].map((item, i) => {
              if (!item) return <div key={i} className="text-muted-foreground/40">→</div>;
              const Icon = item.icon;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 p-2 rounded bg-secondary/60">
                  <Icon className="w-4 h-4 text-primary" />
                  <p className="font-semibold text-foreground">{item.label}</p>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Episode list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 bg-secondary rounded animate-pulse" />)}
        </div>
      ) : episodes.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Film className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No episodes yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click "Generate Now" to pull live signals and create the first episode automatically.
            </p>
            <Button className="mt-4" size="sm" onClick={() => pollerMutation.mutate()}
              disabled={pollerMutation.isPending}>
              <Play className="w-3.5 h-3.5 mr-1.5" /> Generate First Episode
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {episodes.map(ep => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
              onPostToX={handlePostToX}
              isPosting={postingId === ep.id && postToXMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* 6-hour automation */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Flame className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">Automated 6-Hour Loop — Active</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Every 6 hours the engine polls on-chain burns + canvas activity → generates a Skulliemoon narrative →
              creates a ready episode. Use "Post to X" to publish to @NORMIES_TV, or click "Generate Now" to trigger
              an immediate cycle.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
