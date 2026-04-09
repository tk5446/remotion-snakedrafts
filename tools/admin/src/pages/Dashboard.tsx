import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Actor, Movie, Quote, ClipCandidate } from "../lib/types";
import { TerminalPanel, type LogLine } from "../components/TerminalPanel";

interface ActorStats {
  actor: Actor;
  movies: Movie[];
  quotesRanked: number;
  candidatesFound: number;
  approved: number;
  cut: number;
}

interface Props {
  onNavigate: (page: string, actorSlug?: string) => void;
}

async function runScript(
  script: string,
  args: string[],
  onLine: (line: LogLine) => void
): Promise<void> {
  const res = await fetch("/api/run/" + script, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (line) {
        try {
          onLine(JSON.parse(line));
        } catch {}
      }
    }
  }
}

export function Dashboard({ onNavigate }: Props) {
  const [stats, setStats]     = useState<ActorStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs]       = useState<LogLine[]>([]);
  const [running, setRunning] = useState<string | null>(null); // actorSlug of running script

  const addLog = (line: LogLine) => setLogs((prev) => [...prev, line]);

  async function loadStats() {
    const actorsRes = await supabase.from("video_actors").select("*").order("name");
    const actors: Actor[] = actorsRes.data ?? [];

    const allStats: ActorStats[] = [];
    for (const actor of actors) {
      const moviesRes = await supabase
        .from("video_movies")
        .select("*")
        .eq("actor_id", actor.id)
        .order("video_rank", { ascending: false });
      const movies: Movie[] = moviesRes.data ?? [];

      const movieIds = movies.map((m) => m.id);

      const quotesRes = await supabase
        .from("video_quotes")
        .select("movie_id, user_rank")
        .in("movie_id", movieIds);
      const quotes: Pick<Quote, "movie_id" | "user_rank">[] = quotesRes.data ?? [];
      const quotesRanked = new Set(
        quotes.filter((q) => q.user_rank != null && q.user_rank > 0).map((q) => q.movie_id)
      ).size;

      const candsRes = await supabase
        .from("video_clip_candidates")
        .select("movie_id, status")
        .in("movie_id", movieIds);
      const cands: Pick<ClipCandidate, "movie_id" | "status">[] = candsRes.data ?? [];
      const candidatesFound = new Set(cands.map((c) => c.movie_id)).size;
      const approved = cands.filter((c) => c.status === "approved").length;
      const cut = movies.filter((m) => m.clipped_video).length;

      allStats.push({ actor, movies, quotesRanked, candidatesFound, approved, cut });
    }
    setStats(allStats);
    setLoading(false);
  }

  useEffect(() => { loadStats(); }, []);

  async function handleRun(script: string, actorSlug: string, jsonPath?: string) {
    setLogs([]);
    setRunning(actorSlug);
    const args = jsonPath ? [actorSlug, jsonPath] : [actorSlug];
    await runScript(script, args, addLog);
    setRunning(null);
    loadStats();
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  if (stats.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Clip Admin</h1>
        <p className="text-gray-400 mb-6">No actors found. Run <code className="text-yellow-300">get_quotes.py</code> from the terminal to seed the first actor.</p>
        <pre className="bg-black rounded p-4 text-sm text-gray-300 font-mono">
          python scripts/get_quotes.py adam-sandler public/data/adam-sandler/top5.json
        </pre>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Clip Admin</h1>

      <div className="space-y-4">
        {stats.map(({ actor, movies, quotesRanked, candidatesFound, approved, cut }) => {
          const total = movies.length;
          const isRunning = running === actor.slug;

          return (
            <div key={actor.id} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{actor.name}</h2>
                <span className="text-xs text-gray-500">{actor.slug}</span>
              </div>

              {/* Status bar */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                <StatBox label="Quotes ranked" value={`${quotesRanked}/${total}`} done={quotesRanked === total} />
                <StatBox label="Candidates found" value={`${candidatesFound}/${total}`} done={candidatesFound === total} />
                <StatBox label="Approved" value={`${approved}/${total}`} done={approved === total} />
                <StatBox label="Clips cut" value={`${cut}/${total}`} done={cut === total} />
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  label="Rank Quotes"
                  onClick={() => onNavigate("quotes", actor.slug)}
                  variant="secondary"
                  disabled={isRunning}
                />
                <ActionButton
                  label="Find Clips"
                  onClick={() => handleRun("find_clips", actor.slug)}
                  variant="primary"
                  disabled={isRunning || quotesRanked === 0}
                  loading={isRunning && running === actor.slug}
                />
                <ActionButton
                  label="Review Clips"
                  onClick={() => onNavigate("review", actor.slug)}
                  variant="secondary"
                  disabled={isRunning || candidatesFound === 0}
                />
                <ActionButton
                  label="Make Clips"
                  onClick={() => handleRun("make_clips", actor.slug)}
                  variant="primary"
                  disabled={isRunning || approved === 0}
                  loading={isRunning}
                />
                <ActionButton
                  label="Export JSON"
                  onClick={() => handleRun("export_render_data", actor.slug)}
                  variant="success"
                  disabled={isRunning || cut === 0}
                />
                <ActionButton
                  label="Render Prep →"
                  onClick={() => onNavigate("render", actor.slug)}
                  variant="secondary"
                  disabled={isRunning}
                />
              </div>
            </div>
          );
        })}
      </div>

      <TerminalPanel lines={logs} running={running !== null} />
    </div>
  );
}

function StatBox({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className={`rounded-lg p-3 text-center border ${done ? "border-green-700 bg-green-900/20" : "border-[#333] bg-[#242424]"}`}>
      <div className={`text-xl font-bold ${done ? "text-green-400" : "text-white"}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  variant,
  disabled,
  loading,
}: {
  label: string;
  onClick: () => void;
  variant: "primary" | "secondary" | "success";
  disabled?: boolean;
  loading?: boolean;
}) {
  const base = "px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    primary:   "bg-blue-600 hover:bg-blue-500 text-white",
    secondary: "bg-[#2a2a2a] hover:bg-[#333] text-gray-200 border border-[#444]",
    success:   "bg-green-700 hover:bg-green-600 text-white",
  };
  return (
    <button className={`${base} ${styles[variant]}`} onClick={onClick} disabled={disabled || loading}>
      {loading ? "Running…" : label}
    </button>
  );
}
