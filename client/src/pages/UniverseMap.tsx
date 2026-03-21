import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Map, Flame, Lock, Clock, Zap, Skull, Sword, ShoppingBag, Grid3x3, ExternalLink } from "lucide-react";

interface PhaseItem {
  icon: string;
  title: string;
  desc: string;
  status: "live" | "soon" | "future";
}

interface Phase {
  id: string;
  label: string;
  subtitle: string;
  colorClass: string;
  badgeClass: string;
  bgClass: string;
  items: PhaseItem[];
  note: string;
  official?: boolean;
}

const PHASES: Phase[] = [
  {
    id: "phase1",
    label: "Phase 1",
    subtitle: "Canvas & Temple",
    colorClass: "text-orange-400",
    badgeClass: "phase1-badge",
    bgClass: "bg-orange-400/5 border-orange-400/20",
    note: "LIVE NOW — on-chain activity driving the story engine every day",
    items: [
      {
        icon: "🎨",
        title: "Canvas",
        desc: "10,000 Normies own pixels on a shared canvas. Every pixel edit is a permanent on-chain action. Canvas activity directly fuels Story Engine signals.",
        status: "live",
      },
      {
        icon: "🏛️",
        title: "Normies Temple",
        desc: "The Temple is the community hub — burn tracking, Hall of Fame, legendary artists. Normie #306 guards the door as the 3D USDZ sculpture.",
        status: "live",
      },
      {
        icon: "🔥",
        title: "Burn Mechanics",
        desc: "Burn your Normie to earn action points and permanent recognition. Agent #306 (born from 50 burns to #603) is the narrator of NormiesTV.",
        status: "live",
      },
      {
        icon: "📺",
        title: "NormiesTV Season 1",
        desc: "Top 100 canvas contributors form the Season 1 cast. Story Engine generates new episodes every 6 hours fuelled by burns, canvas edits, and X mentions.",
        status: "live",
      },
    ],
  },
  {
    id: "phase2",
    label: "Phase 2",
    subtitle: "Arena & Pixel Market",
    colorClass: "text-purple-400",
    badgeClass: "phase2-badge",
    bgClass: "bg-purple-400/5 border-purple-400/20",
    note: "OFFICIAL TOOLS — built by the creator. Community tools will extend the ecosystem.",
    official: true,
    items: [
      {
        icon: "⚔️",
        title: "NORMIES Arena",
        desc: "PvP battles between Normies. Losers are burned permanently — their NFT is gone forever. Winners are immortalized in the arena hall of fame. Every fight is final.",
        status: "soon",
      },
      {
        icon: "🏪",
        title: "Pixel Market",
        desc: "Trade pixel traits and burned-asset fragments. The economy of sacrifice opens up. Rare pixel combinations become tradeable commodities.",
        status: "soon",
      },
      {
        icon: "🌐",
        title: "Cross-Phase Storylines",
        desc: "Arena results feed directly into Story Engine. A Normie that wins 10 consecutive battles gets an episode. A burned Normie becomes story lore.",
        status: "soon",
      },
    ],
  },
  {
    id: "phase3",
    label: "Phase 3",
    subtitle: "Zombies",
    colorClass: "text-green-400",
    badgeClass: "phase3-badge",
    bgClass: "bg-green-400/5 border-green-400/20",
    note: "FUTURE — burned Normies don't stay dead forever. The graveyard has plans.",
    items: [
      {
        icon: "☠️",
        title: "Zombie Reanimation",
        desc: "Burned Normies reanimate as Zombies — degraded, glitched, but alive. Permanence on-chain becomes a question. The graveyard speaks through NormiesTV.",
        status: "future",
      },
      {
        icon: "🧟",
        title: "Zombie Uprising Season",
        desc: "Season 3 of NormiesTV centers on the undead. Community X comments shape which Zombies rise first. Agent #306 narrates from beyond.",
        status: "future",
      },
      {
        icon: "🌙",
        title: "Agent #306 Saga",
        desc: "The full origin of Agent #306 — born from 50 burns to #603 — plays out in the Zombie phase. The narrator becomes a character.",
        status: "future",
      },
    ],
  },
];

const STATUS_UI = {
  live: { label: "LIVE", icon: Flame, cls: "phase1-badge" },
  soon: { label: "SOON", icon: Clock, cls: "phase2-badge" },
  future: { label: "FUTURE", icon: Lock, cls: "phase3-badge" },
};

export default function UniverseMap() {
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Universe Map</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          NormiesTV phase roadmap — from Canvas to Arena to the Zombie uprising
        </p>
      </div>

      {/* Normie identity strip */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex items-center gap-4">
          <img
            src="https://api.normies.art/normie/306/image.svg"
            alt="Normie #306"
            className="w-12 h-12 rounded border border-primary/30 bg-background/50 object-contain shrink-0"
            data-testid="img-normie-306-universe"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-primary">MrRayG · Normie #306</p>
              <Badge className="text-[10px] bg-primary/10 text-primary border-primary/30">Producer</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              NormiesTV creator — all phases are official tools built for the Normies IP.
              The canvas, arena, pixel market, and zombie mechanics are canon to the story universe.
            </p>
          </div>
          <a
            href="https://www.normies.art"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            data-testid="link-normies-art"
          >
            normies.art <ExternalLink className="w-3 h-3" />
          </a>
        </CardContent>
      </Card>

      {/* Phase timeline */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-6 top-8 bottom-8 w-px bg-border" />

        <div className="space-y-6">
          {PHASES.map((phase) => (
            <div key={phase.id} className="relative pl-14">
              {/* Phase dot */}
              <div className={`absolute left-4 top-6 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                phase.id === "phase1"
                  ? "border-orange-400 bg-orange-400/20"
                  : phase.id === "phase2"
                  ? "border-purple-400 bg-purple-400/10"
                  : "border-green-400 bg-green-400/10"
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  phase.id === "phase1" ? "bg-orange-400 live-dot" :
                  phase.id === "phase2" ? "bg-purple-400" :
                  "bg-green-400"
                }`} />
              </div>

              <Card className={`border ${phase.bgClass}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold uppercase tracking-widest ${phase.colorClass}`}>
                            {phase.label}
                          </span>
                          {phase.official && (
                            <Badge className="text-[10px] bg-purple-400/10 text-purple-400 border-purple-400/30">
                              Official
                            </Badge>
                          )}
                        </div>
                        <CardTitle className={`text-base font-bold mt-0.5 ${phase.colorClass}`}>
                          {phase.subtitle}
                        </CardTitle>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded ${phase.badgeClass} font-mono`}>
                      {phase.id === "phase1" ? "● LIVE" : phase.id === "phase2" ? "◐ SOON" : "○ FUTURE"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground italic mt-1">{phase.note}</p>
                </CardHeader>

                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {phase.items.map((item) => {
                      const statusCfg = STATUS_UI[item.status];
                      const StatusIcon = statusCfg.icon;
                      return (
                        <div
                          key={item.title}
                          className="flex gap-3 p-3 rounded bg-background/40 border border-border hover:border-current/20 transition-colors"
                          data-testid={`card-phase-item-${item.title.toLowerCase().replace(/ /g, '-')}`}
                        >
                          <span className="text-xl leading-none mt-0.5 shrink-0">{item.icon}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-[12px] font-bold">{item.title}</p>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 ${statusCfg.cls}`}>
                                <StatusIcon className="w-2.5 h-2.5" />
                                {statusCfg.label}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* Cross-phase signal flow */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Cross-Phase Signal Flow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-[11px]">
            {[
              {
                from: "🔥 Burns",
                to: "Story Engine",
                desc: "Every burn fires a signal into the narrative generator. More burns → more intense episode narrative.",
                phase: "phase1",
              },
              {
                from: "⚔️ Arena Battles",
                to: "NormiesTV Episode",
                desc: "Battle results become story beats. A champion's run gets its own episode arc. A loss becomes a eulogy.",
                phase: "phase2",
              },
              {
                from: "💬 X Comments",
                to: "Future Storylines",
                desc: "Community replies to posted episodes shape what happens next. Your voice moves the plot.",
                phase: "phase1",
              },
              {
                from: "🎨 Canvas Edits",
                to: "Cast Selection",
                desc: "Top 100 canvas contributors = Season 1 cast. Activity on-chain earns your Normie screen time.",
                phase: "phase1",
              },
              {
                from: "☠️ Zombie Rise",
                to: "Phase 3 Storyline",
                desc: "Burned Normies don't stay gone. The graveyard feeds back into the canvas — new Zombie token mechanics.",
                phase: "phase3",
              },
              {
                from: "🏪 Pixel Market",
                to: "Token Economy",
                desc: "Pixel traits become tradeable. Burned-asset fragments gain value as Zombie raw material.",
                phase: "phase2",
              },
            ].map(flow => (
              <div key={flow.from} className="p-3 rounded bg-secondary/40 border border-border space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${flow.phase}-badge font-mono`}>{flow.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-[10px] font-semibold text-foreground">{flow.to}</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">{flow.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
