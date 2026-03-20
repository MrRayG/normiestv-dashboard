import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import StoryEngine from "@/pages/StoryEngine";
import RenderStudio from "@/pages/RenderStudio";
import EpisodeQueue from "@/pages/EpisodeQueue";
import UniverseMap from "@/pages/UniverseMap";
import LiveStats from "@/pages/LiveStats";
import NotFound from "@/pages/not-found";
import PerplexityAttribution from "@/components/PerplexityAttribution";
import {
  Tv2, Zap, Film, Map, Activity,
  Flame, Play, Radio
} from "lucide-react";

function Sidebar() {
  const [location] = useHashLocation();

  const nav = [
    { href: "/", label: "Story Engine", icon: Zap, desc: "AI narrative generator" },
    { href: "/render", label: "Render Studio", icon: Tv2, desc: "3D voxel pipeline" },
    { href: "/episodes", label: "Episode Queue", icon: Film, desc: "Clips & posting" },
    { href: "/universe", label: "Universe Map", icon: Map, desc: "Phase roadmap" },
    { href: "/stats", label: "Live Stats", icon: Activity, desc: "Chain + social" },
  ];

  return (
    <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-card h-screen sticky top-0">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Radio className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-widest uppercase text-foreground leading-none">NormiesTV</p>
            <p className="text-[10px] text-muted-foreground tracking-wider mt-0.5">Producer Dashboard</p>
          </div>
        </div>
      </div>

      {/* Live indicator */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary live-dot" />
        <span className="text-[11px] text-muted-foreground uppercase tracking-widest">On Air</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon, desc }) => {
          const active = location === href;
          return (
            <Link key={href} href={href}>
              <a className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded text-sm transition-all cursor-pointer ${
                active ? "nav-active font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`} data-testid={`nav-${label.toLowerCase().replace(/ /g, '-')}`}>
                <Icon className="w-4 h-4 shrink-0" />
                <div>
                  <p className="leading-none">{label}</p>
                  <p className="text-[10px] opacity-60 mt-0.5">{desc}</p>
                </div>
              </a>
            </Link>
          );
        })}
      </nav>

      {/* Phase indicator */}
      <div className="p-4 border-t border-border space-y-1.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Active Phases</p>
        {[
          { label: "Phase 1 · Canvas", cls: "phase1-badge", active: true },
          { label: "Phase 2 · Arena", cls: "phase2-badge", active: false },
          { label: "Phase 3 · Zombies", cls: "phase3-badge", active: false },
        ].map(p => (
          <div key={p.label} className={`text-[10px] px-2 py-1 rounded ${p.cls} flex items-center gap-1.5 ${!p.active && "opacity-40"}`}>
            {p.active && <Flame className="w-3 h-3" />}
            {!p.active && <Play className="w-3 h-3" />}
            {p.label}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border">
        <PerplexityAttribution />
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Layout>
          <Switch>
            <Route path="/" component={StoryEngine} />
            <Route path="/render" component={RenderStudio} />
            <Route path="/episodes" component={EpisodeQueue} />
            <Route path="/universe" component={UniverseMap} />
            <Route path="/stats" component={LiveStats} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
