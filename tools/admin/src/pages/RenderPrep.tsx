import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Movie } from "../lib/types";
import { TerminalPanel, type LogLine } from "../components/TerminalPanel";

interface Props {
  actorSlug: string;
  onBack: () => void;
}

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
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
        try { onLine(JSON.parse(line)); } catch {}
      }
    }
  }
}

export function RenderPrep({ actorSlug, onBack }: Props) {
  const [actorName, setActorName]   = useState("");
  const [checks, setChecks]         = useState<Check[]>([]);
  const [loading, setLoading]       = useState(true);
  const [logs, setLogs]             = useState<LogLine[]>([]);
  const [running, setRunning]       = useState(false);

  const addLog = (line: LogLine) => setLogs((prev) => [...prev, line]);

  async function load() {
    const actorRes = await supabase.from("video_actors").select("*").eq("slug", actorSlug).single();
    if (actorRes.data) setActorName(actorRes.data.name);

    const moviesRes = await supabase
      .from("video_movies")
      .select("*, video_clip_candidates!approved_candidate_id(*)")
      .eq("actor_slug", actorSlug)
      .order("video_rank", { ascending: false })
      .limit(5);
    const movies: (Movie & { video_clip_candidates: any })[] = moviesRes.data ?? [];

    const newChecks: Check[] = [
      {
        label: "5 movies with video_rank set",
        ok: movies.length === 5 && movies.every((m) => m.video_rank != null),
        detail: `${movies.filter((m) => m.video_rank != null).length}/5`,
      },
      {
        label: "All movies have approved candidate",
        ok: movies.every((m) => m.approved_candidate_id != null),
        detail: `${movies.filter((m) => m.approved_candidate_id).length}/5 approved`,
      },
      {
        label: "All clips cut (clipped_video set)",
        ok: movies.every((m) => m.clipped_video),
        detail: `${movies.filter((m) => m.clipped_video).length}/5 cut`,
      },
    ];
    setChecks(newChecks);
    setLoading(false);
  }

  useEffect(() => { load(); }, [actorSlug]);

  async function handleExport() {
    setLogs([]);
    setRunning(true);
    await runScript("export_render_data", [actorSlug], addLog);
    setRunning(false);
    load();
  }

  const allGreen = checks.every((c) => c.ok);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
        <h1 className="text-xl font-bold">{actorName} — Render Prep</h1>
      </div>

      {/* Checklist */}
      <div className="space-y-2 mb-6">
        {checks.map((check) => (
          <div
            key={check.label}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
              check.ok ? "border-green-700 bg-green-900/15" : "border-[#444] bg-[#1a1a1a]"
            }`}
          >
            <span className={`text-lg ${check.ok ? "text-green-400" : "text-gray-600"}`}>
              {check.ok ? "✓" : "○"}
            </span>
            <span className="text-sm flex-1">{check.label}</span>
            {check.detail && (
              <span className="text-xs text-gray-500">{check.detail}</span>
            )}
          </div>
        ))}
      </div>

      {/* Export button */}
      <div className="flex gap-3 mb-4">
        <button
          onClick={handleExport}
          disabled={running || !checks[1].ok}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-all"
        >
          {running ? "Exporting…" : "Export public/data/top5.json"}
        </button>
      </div>

      <TerminalPanel lines={logs} running={running} />

      {/* Render command */}
      {allGreen && (
        <div className="mt-6 p-4 bg-[#1a1a1a] border border-[#333] rounded-xl">
          <div className="text-sm text-gray-400 mb-2">Run this to render the video:</div>
          <pre className="text-sm text-green-300 font-mono bg-black rounded p-3 select-all">
            npx remotion render Top5Version2
          </pre>
        </div>
      )}
    </div>
  );
}
