import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Film, RefreshCw, Send, CheckCircle2, Clock, Loader2,
  Share2, AlertCircle, FileText, Zap, Flame
} from "lucide-react";
import type { Episode } from "@shared/schema";

const STATUS_CONFIG = {
  draft: { icon: FileText, label: "Draft", className: "status-draft", bg: "bg-muted/50" },
  rendering: { icon: Loader2, label: "Rendering", className: "status-rendering", bg: "bg-yellow-400/10" },
  ready: { icon: CheckCircle2, label: "Ready", className: "status-ready", bg: "bg-cyan-400/10" },
  posted: { icon: Share2, label: "Posted", className: "status-posted", bg: "bg-green-400/10" },
};

const PHASE_LABELS: Record<string, string> = {
  phase1: "Canvas · P1",
  phase2: "Arena · P2",
  phase3: "Zombies · P3",
};

function EpisodeCard({ episode, onUpdateStatus }: {
  episode: Episode;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  const cfg = STATUS_CONFIG[episode.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const StatusIcon = cfg.icon;
  const isSpinning = episode.status === "rendering";

  const nextAction: Record<string, { label: string; status: string; icon: typeof Send } | null> = {
    draft: { label: "Start Render", status: "rendering", icon: Zap },
    rendering: { label: "Mark Ready", status: "ready", icon: CheckCircle2 },
    ready: { label: "Post to X", status: "posted", icon: Send },
    posted: null,
  };
  const action = nextAction[episode.status];

  return (
    <Card className="pixel-hover" data-testid={`card-episode-${episode.id}`}>
      <CardContent className="p-4">
        <div className="flex gap-3">
          {/* Normie thumbnail */}
          <img
            src={`https://api.normies.art/normie/${episode.tokenId}/image.svg`}
            alt={`Normie #${episode.tokenId}`}
            className="w-14 h-14 rounded border border-border bg-secondary/50 object-contain shrink-0"
            data-testid={`img-episode-normie-${episode.id}`}
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
                      Posted {new Date(episode.postedAt).toLocaleDateString()}
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

            {action && (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant={episode.status === "ready" ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => onUpdateStatus(episode.id, action.status)}
                  data-testid={`button-episode-action-${episode.id}`}
                >
                  <action.icon className="w-3 h-3 mr-1.5" />
                  {action.label}
                </Button>
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

  const { data: episodes = [], isLoading, refetch } = useQuery<Episode[]>({
    queryKey: ["/api/episodes"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/episodes/${id}/status`, { status, ...(status === "posted" ? { videoUrl: undefined } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/episodes"] });
      toast({ title: "Episode updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update episode", variant: "destructive" });
    },
  });

  const handleUpdateStatus = (id: number, status: string) => {
    updateStatusMutation.mutate({ id, status });
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
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-episodes">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total", value: counts.total, cls: "" },
          { label: "Draft", value: counts.draft, cls: "status-draft" },
          { label: "Rendering", value: counts.rendering, cls: "status-rendering" },
          { label: "Ready", value: counts.ready, cls: "status-ready" },
          { label: "Posted", value: counts.posted, cls: "status-posted" },
        ].map(s => (
          <Card key={s.label} className="pixel-hover">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest">{s.label}</p>
              <p className={`text-2xl font-bold font-mono mt-1 ${s.cls}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline flow */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            {[
              { step: "1", label: "Story Engine", desc: "AI narrative from signals", icon: Zap, active: true },
              { step: "→", label: "", desc: "", icon: null, active: false },
              { step: "2", label: "Render Studio", desc: "3D voxel generation", icon: Film, active: true },
              { step: "→", label: "", desc: "", icon: null, active: false },
              { step: "3", label: "Episode Queue", desc: "Ready to broadcast", icon: CheckCircle2, active: true },
              { step: "→", label: "", desc: "", icon: null, active: false },
              { step: "4", label: "Post to X", desc: "Publish to community", icon: Send, active: false },
            ].map((item, i) => {
              if (!item.label && !item.icon) {
                return <div key={i} className="text-muted-foreground/40 text-lg">→</div>;
              }
              const Icon = item.icon!;
              return (
                <div key={i} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded ${item.active ? "bg-secondary/60" : "opacity-40"}`}>
                  <Icon className="w-4 h-4 text-primary" />
                  <p className="font-semibold text-foreground">{item.label}</p>
                  <p className="text-muted-foreground text-center leading-tight">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {["all", "draft", "rendering", "ready", "posted"].map(filter => (
          <button
            key={filter}
            className="px-3 py-1.5 rounded text-xs capitalize transition-colors bg-secondary text-muted-foreground hover:text-foreground border border-border"
            data-testid={`filter-${filter}`}
          >
            {filter} {filter === "all" ? `(${counts.total})` : `(${counts[filter as keyof typeof counts] ?? 0})`}
          </button>
        ))}
      </div>

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
              Go to Story Engine → create a narrative → click "Create Episode Draft"
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {episodes.map(ep => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              onUpdateStatus={handleUpdateStatus}
            />
          ))}
        </div>
      )}

      {/* 6-hour automation note */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Flame className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">Automated 6-Hour Loop</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Every 6 hours: Story Engine polls on-chain burns + X mentions → generates narrative →
              queues a 3D render → creates episode draft. Community replies on X shape the next episode's story.
              Manual posting controls are above — automation handles the pipeline.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
