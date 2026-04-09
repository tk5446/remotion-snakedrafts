import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Movie, Quote } from "../lib/types";

interface Props {
  actorSlug: string;
  onBack: () => void;
  onFindClips: (actorSlug: string) => void;
}

interface MovieWithQuotes {
  movie: Movie;
  quotes: Quote[];
}

export function QuoteCuration({ actorSlug, onBack, onFindClips }: Props) {
  const [data, setData]           = useState<MovieWithQuotes[]>([]);
  const [actorName, setActorName] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  async function load() {
    const actorRes = await supabase.from("video_actors").select("*").eq("slug", actorSlug).single();
    if (actorRes.data) setActorName(actorRes.data.name);

    const moviesRes = await supabase
      .from("video_movies")
      .select("*")
      .eq("actor_slug", actorSlug)
      .order("rank");
    const movies: Movie[] = moviesRes.data ?? [];

    const movieIds = movies.map((m) => m.id);
    const quotesRes = await supabase
      .from("video_quotes")
      .select("*")
      .in("movie_id", movieIds);
    const quotes: Quote[] = quotesRes.data ?? [];

    const grouped = movies.map((movie) => ({
      movie,
      quotes: quotes.filter((q) => q.movie_id === movie.id),
    }));
    setData(grouped);
    setLoading(false);
  }

  useEffect(() => { load(); }, [actorSlug]);

  async function saveRanks(updates: { id: string; user_rank: number | null }[]) {
    setSaving(true);
    await Promise.all(
      updates.map(({ id, user_rank }) =>
        supabase.from("video_quotes").update({ user_rank }).eq("id", id)
      )
    );
    setSaving(false);
    await load();
  }

  async function dismiss(quoteId: string) {
    await saveRanks([{ id: quoteId, user_rank: 0 }]);
  }

  async function restore(quoteId: string) {
    await saveRanks([{ id: quoteId, user_rank: null }]);
  }

  async function preRankAll() {
    const updates: { id: string; user_rank: number }[] = [];
    for (const { quotes } of data) {
      const unranked = quotes.filter((q) => q.user_rank == null);
      unranked.forEach((q, i) => {
        updates.push({ id: q.id, user_rank: i + 1 });
      });
    }
    if (updates.length === 0) return;
    await saveRanks(updates);
  }

  const allReady = data.length > 0 && data.every(({ quotes }) =>
    quotes.some((q) => q.user_rank != null && q.user_rank > 0)
  );

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-700 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">{actorName} — Quote Curation</h1>
        <div className="ml-auto flex items-center gap-3">
          {saving && <span className="text-sm text-gray-400">saving…</span>}
          <button
            onClick={preRankAll}
            disabled={saving}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-gray-700 border border-gray-200 transition-all"
          >
            Pre-rank All
          </button>
          <button
            onClick={() => onFindClips(actorSlug)}
            disabled={!allReady || saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-all"
          >
            Find Clips →
          </button>
        </div>
      </div>

      {!allReady && (
        <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800">
          Rank at least one quote per movie before running Find Clips.
        </div>
      )}

      <div className="space-y-6">
        {data.map(({ movie, quotes }, index) => (
          <MovieSection
            key={movie.id}
            movie={movie}
            movieNumber={index + 1}
            quotes={quotes}
            saving={saving}
            onSaveRanks={saveRanks}
            onDismiss={dismiss}
            onRestore={restore}
          />
        ))}
      </div>
    </div>
  );
}

function MovieSection({
  movie,
  movieNumber,
  quotes,
  saving,
  onSaveRanks,
  onDismiss,
  onRestore,
}: {
  movie: Movie;
  movieNumber: number;
  quotes: Quote[];
  saving: boolean;
  onSaveRanks: (updates: { id: string; user_rank: number | null }[]) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const ranked    = quotes.filter((q) => q.user_rank != null && q.user_rank > 0)
                          .sort((a, b) => (a.user_rank ?? 0) - (b.user_rank ?? 0));
  const unranked  = quotes.filter((q) => q.user_rank == null);
  const dismissed = quotes.filter((q) => q.user_rank === 0);
  const hasRanked = ranked.length > 0;

  const [activeOrder, setActiveOrder] = useState<Quote[]>([...ranked, ...unranked]);
  const dragId     = useRef<string | null>(null);
  const dragOverId = useRef<string | null>(null);

  useEffect(() => {
    setActiveOrder([...ranked, ...unranked]);
  }, [quotes]);

  function handleDragStart(id: string) {
    dragId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (dragOverId.current !== id) {
      dragOverId.current = id;
      const from = activeOrder.findIndex((q) => q.id === dragId.current);
      const to   = activeOrder.findIndex((q) => q.id === id);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...activeOrder];
      next.splice(to, 0, next.splice(from, 1)[0]);
      setActiveOrder(next);
    }
  }

  async function handleDrop() {
    dragId.current = null;
    dragOverId.current = null;
    const updates = activeOrder.map((q, i) => ({ id: q.id, user_rank: i + 1 }));
    await onSaveRanks(updates);
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        hasRanked ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${hasRanked ? "bg-green-500" : "bg-gray-300"}`} />
        <h2 className="text-lg font-semibold text-gray-900">
          <span className="text-gray-400 font-normal mr-1">{movieNumber}.</span>
          {movie.movie_title}
        </h2>
        <span className="text-base text-gray-400">{movie.year}</span>
        {hasRanked && <span className="ml-auto text-sm text-green-600 font-medium">✓ Ready</span>}
      </div>

      <div className="space-y-2">
        {activeOrder.map((q) => {
          const isRanked = q.user_rank != null && q.user_rank > 0;
          return (
            <div
              key={q.id}
              draggable
              onDragStart={() => handleDragStart(q.id)}
              onDragOver={(e) => handleDragOver(e, q.id)}
              onDrop={handleDrop}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-colors ${
                isRanked
                  ? "bg-white border border-green-200 shadow-sm"
                  : "bg-white border border-gray-200"
              }`}
            >
              <span className="text-gray-300 mt-0.5 shrink-0 text-base">⠿</span>
              <span className={`shrink-0 w-6 text-center text-sm font-mono ${isRanked ? "text-green-600" : "text-gray-300"}`}>
                {isRanked ? q.user_rank : "—"}
              </span>
              <span className="flex-1 text-base leading-relaxed text-gray-800">
                {q.text}
              </span>
              {!saving && (
                <button
                  onClick={() => onDismiss(q.id)}
                  className="text-sm text-gray-300 hover:text-red-400 shrink-0 mt-0.5"
                >
                  dismiss
                </button>
              )}
            </div>
          );
        })}

        {dismissed.length > 0 && (
          <details className="mt-1">
            <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">
              {dismissed.length} dismissed
            </summary>
            <div className="mt-2 space-y-1">
              {dismissed.map((q) => (
                <div
                  key={q.id}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 opacity-50 bg-white border border-gray-100"
                >
                  <span className="text-gray-300 mt-0.5 shrink-0 text-base">⠿</span>
                  <span className="flex-1 text-base leading-relaxed text-gray-400 line-through">{q.text}</span>
                  {!saving && (
                    <button onClick={() => onRestore(q.id)} className="text-sm text-gray-400 hover:text-gray-700 shrink-0">
                      restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
