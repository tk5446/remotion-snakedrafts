import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Movie, ClipCandidate } from "../lib/types";

interface Props {
  actorSlug: string;
  onBack: () => void;
}

interface MovieWithCandidates {
  movie: Movie;
  candidates: ClipCandidate[];
}

export function ClipReview({ actorSlug, onBack }: Props) {
  const [data, setData]             = useState<MovieWithCandidates[]>([]);
  const [actorName, setActorName]   = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  async function load() {
    const actorRes = await supabase.from("video_actors").select("*").eq("slug", actorSlug).single();
    if (actorRes.data) setActorName(actorRes.data.name);

    const moviesRes = await supabase
      .from("video_movies")
      .select("*")
      .eq("actor_slug", actorSlug)
      .order("video_rank", { ascending: false });
    const movies: Movie[] = moviesRes.data ?? [];

    const movieIds = movies.map((m) => m.id);
    const candsRes = await supabase
      .from("video_clip_candidates")
      .select("*")
      .in("movie_id", movieIds)
      .neq("status", "dismissed")
      .order("adjusted_score", { ascending: false });
    const cands: ClipCandidate[] = candsRes.data ?? [];

    const grouped = movies.map((movie) => ({
      movie,
      candidates: cands.filter((c) => c.movie_id === movie.id),
    }));
    setData(grouped);
    if (!selectedId && grouped.length > 0) {
      // Auto-select first unresolved movie
      const first = grouped.find(({ movie }) => !movie.approved_candidate_id) ?? grouped[0];
      setSelectedId(first.movie.id);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [actorSlug]);

  async function moveVideoRank(movieId: string, direction: "up" | "down") {
    const idx = data.findIndex((d) => d.movie.id === movieId);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= data.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const a = data[idx].movie;
    const b = data[swapIdx].movie;

    await Promise.all([
      supabase.from("video_movies").update({ video_rank: b.video_rank }).eq("id", a.id),
      supabase.from("video_movies").update({ video_rank: a.video_rank }).eq("id", b.id),
    ]);
    load();
  }

  async function approveCandidate(movie: Movie, candidate: ClipCandidate) {
    // Clear any previous approval on other candidates for this movie
    await supabase
      .from("video_clip_candidates")
      .update({ status: "pending" })
      .eq("movie_id", movie.id)
      .eq("status", "approved");

    await supabase
      .from("video_clip_candidates")
      .update({ status: "approved" })
      .eq("id", candidate.id);

    await supabase
      .from("video_movies")
      .update({ approved_candidate_id: candidate.id })
      .eq("id", movie.id);

    await load();

    // Auto-advance to next unresolved movie
    const nextUnresolved = data.find(
      ({ movie: m }) => m.id !== movie.id && !m.approved_candidate_id
    );
    if (nextUnresolved) setSelectedId(nextUnresolved.movie.id);
  }

  async function dismissCandidate(candidateId: string) {
    await supabase.from("video_clip_candidates").update({ status: "dismissed" }).eq("id", candidateId);
    load();
  }

  async function updateCandidate(id: string, patch: Partial<ClipCandidate>) {
    await supabase.from("video_clip_candidates").update(patch).eq("id", id);
    load();
  }

  async function updateBrightness(movieId: string, brightness: number) {
    await supabase.from("video_movies").update({ brightness }).eq("id", movieId);
    load();
  }

  const approvedCount = data.filter(({ movie }) => movie.approved_candidate_id).length;
  const selected = data.find((d) => d.movie.id === selectedId);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left sidebar — movie list */}
      <div className="w-56 shrink-0 border-r border-[#333] bg-[#141414] flex flex-col">
        <div className="p-4 border-b border-[#333]">
          <button onClick={onBack} className="text-gray-400 hover:text-white text-xs mb-2 block">← Back</button>
          <div className="font-semibold text-sm truncate">{actorName}</div>
          <div className="text-xs text-gray-500 mt-1">{approvedCount}/{data.length} approved</div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {data.map(({ movie }, idx) => {
            const isApproved = !!movie.approved_candidate_id;
            const isSelected = movie.id === selectedId;
            return (
              <div
                key={movie.id}
                className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-l-2 transition-all ${
                  isSelected
                    ? "bg-[#1e1e1e] border-blue-500"
                    : "border-transparent hover:bg-[#1a1a1a]"
                }`}
                onClick={() => setSelectedId(movie.id)}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${isApproved ? "bg-green-400" : "bg-gray-600"}`} />
                <span className="text-xs flex-1 truncate text-gray-200">{movie.movie_title}</span>
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveVideoRank(movie.id, "up"); }}
                    className="text-gray-500 hover:text-white text-xs leading-none"
                    title="Move up in video"
                  >▲</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveVideoRank(movie.id, "down"); }}
                    className="text-gray-500 hover:text-white text-xs leading-none"
                    title="Move down in video"
                  >▼</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel — candidates */}
      <div className="flex-1 overflow-y-auto bg-[#111]">
        {selected ? (
          <MovieCandidates
            data={selected}
            onApprove={approveCandidate}
            onDismiss={dismissCandidate}
            onUpdate={updateCandidate}
            onBrightness={updateBrightness}
          />
        ) : (
          <div className="p-8 text-gray-400">Select a movie to review candidates.</div>
        )}
      </div>
    </div>
  );
}

function MovieCandidates({
  data,
  onApprove,
  onDismiss,
  onUpdate,
  onBrightness,
}: {
  data: MovieWithCandidates;
  onApprove: (movie: Movie, candidate: ClipCandidate) => void;
  onDismiss: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ClipCandidate>) => void;
  onBrightness: (movieId: string, brightness: number) => void;
}) {
  const { movie, candidates } = data;
  const [brightness, setBrightness] = useState(movie.brightness ?? 1.0);

  const pending   = candidates.filter((c) => c.status === "pending");
  const approved  = candidates.find((c) => c.id === movie.approved_candidate_id);

  async function saveBrightness(val: number) {
    setBrightness(val);
    onBrightness(movie.id, val);
  }

  return (
    <div className="p-5">
      {/* Movie header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{movie.movie_title}</h2>
          <div className="text-sm text-gray-500">{movie.year} · video_rank {movie.video_rank}</div>
        </div>
        {/* Brightness */}
        <div className="flex items-center gap-3 bg-[#1a1a1a] rounded-lg px-4 py-2 border border-[#333]">
          <span className="text-xs text-gray-400">Brightness</span>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.05}
            value={brightness}
            onChange={(e) => setBrightness(parseFloat(e.target.value))}
            onMouseUp={(e) => saveBrightness(parseFloat((e.target as HTMLInputElement).value))}
            className="w-24 accent-blue-500"
          />
          <span className="text-xs text-white w-8 text-right">{brightness.toFixed(2)}</span>
        </div>
      </div>

      {/* Approved candidate (pinned at top) */}
      {approved && (
        <div className="mb-4">
          <div className="text-xs text-green-400 font-semibold mb-2 uppercase tracking-wide">✓ Approved</div>
          <CandidateCard
            candidate={approved}
            isApproved
            onApprove={() => onApprove(movie, approved)}
            onDismiss={() => onDismiss(approved.id)}
            onUpdate={(patch) => onUpdate(approved.id, patch)}
          />
        </div>
      )}

      {/* Pending candidates */}
      {pending.length > 0 ? (
        <div>
          {approved && <div className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wide">Other candidates</div>}
          <div className="space-y-4">
            {pending.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                isApproved={false}
                onApprove={() => onApprove(movie, c)}
                onDismiss={() => onDismiss(c.id)}
                onUpdate={(patch) => onUpdate(c.id, patch)}
              />
            ))}
          </div>
        </div>
      ) : !approved ? (
        <div className="text-gray-500 text-sm">No candidates found for this movie. Try running Find Clips again.</div>
      ) : null}
    </div>
  );
}

function scoreColor(score: number | null) {
  if (score == null) return "bg-gray-700 text-gray-300";
  if (score >= 0.7)  return "bg-green-800 text-green-200";
  if (score >= 0.5)  return "bg-yellow-800 text-yellow-200";
  return "bg-orange-900 text-orange-200";
}

function CandidateCard({
  candidate,
  isApproved,
  onApprove,
  onDismiss,
  onUpdate,
}: {
  candidate: ClipCandidate;
  isApproved: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onUpdate: (patch: Partial<ClipCandidate>) => void;
}) {
  const [startTime, setStartTime]   = useState(candidate.start_time ?? "0:00");
  const [duration, setDuration]     = useState(candidate.duration ?? 10);
  const [previewStart, setPreviewStart] = useState(candidate.start_seconds ?? 0);
  const [iframeKey, setIframeKey]   = useState(0);

  function parseStartToSeconds(val: string): number {
    const parts = val.split(":").map(Number);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    return 0;
  }

  function handlePreview() {
    const secs = parseStartToSeconds(startTime);
    setPreviewStart(secs);
    setIframeKey((k) => k + 1);
  }

  function handleSave() {
    const secs = parseStartToSeconds(startTime);
    onUpdate({ start_time: startTime, start_seconds: secs, duration });
  }

  return (
    <div className={`rounded-xl border p-4 ${isApproved ? "border-green-700 bg-green-900/10" : "border-[#333] bg-[#1a1a1a]"}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreColor(candidate.adjusted_score)}`}>
          {candidate.adjusted_score?.toFixed(3) ?? "?"}
        </span>
        <span className="text-sm text-gray-300 truncate flex-1">{candidate.yt_title}</span>
        <span className="text-xs text-gray-600 shrink-0">{candidate.yt_duration_seconds}s</span>
      </div>

      {/* YouTube embed */}
      <div className="relative w-full mb-3" style={{ paddingTop: "56.25%" }}>
        <iframe
          key={iframeKey}
          src={`https://www.youtube.com/embed/${candidate.yt_video_id}?start=${previewStart}&rel=0`}
          className="absolute inset-0 w-full h-full rounded-lg"
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>

      {/* Matched quote */}
      {candidate.matched_quote && (
        <div className="mb-3 text-xs">
          <span className="text-gray-500">Matched quote: </span>
          <span className="text-gray-300 italic">"{candidate.matched_quote}"</span>
        </div>
      )}
      {candidate.matched_text && (
        <div className="mb-3 text-xs text-gray-600 italic truncate">
          Found: "{candidate.matched_text}"
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Start</label>
          <input
            type="text"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-16 bg-[#111] border border-[#444] rounded text-white text-xs py-1 px-2 text-center focus:outline-none focus:border-blue-500 font-mono"
            placeholder="1:23"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Duration</label>
          <input
            type="number"
            value={duration}
            min={3}
            max={60}
            onChange={(e) => setDuration(parseInt(e.target.value) || 10)}
            className="w-14 bg-[#111] border border-[#444] rounded text-white text-xs py-1 px-2 text-center focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-600">s</span>
        </div>
        <button
          onClick={handlePreview}
          className="px-3 py-1 bg-[#2a2a2a] hover:bg-[#333] border border-[#444] rounded text-xs text-gray-300 transition-colors"
        >
          ▶ Preview
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1 bg-[#2a2a2a] hover:bg-[#333] border border-[#444] rounded text-xs text-gray-300 transition-colors"
        >
          Save
        </button>
      </div>

      {/* Approve / Dismiss */}
      <div className="flex gap-2">
        {!isApproved && (
          <button
            onClick={onApprove}
            className="flex-1 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-medium text-white transition-colors"
          >
            ✓ Approve
          </button>
        )}
        {isApproved && (
          <button
            onClick={onApprove}
            className="flex-1 py-2 bg-green-900 border border-green-700 rounded-lg text-sm font-medium text-green-300"
            disabled
          >
            ✓ Approved
          </button>
        )}
        <button
          onClick={onDismiss}
          className="px-4 py-2 bg-[#2a2a2a] hover:bg-red-900/40 border border-[#444] hover:border-red-700 rounded-lg text-sm text-gray-400 hover:text-red-300 transition-colors"
        >
          ✗ Dismiss
        </button>
      </div>
    </div>
  );
}
