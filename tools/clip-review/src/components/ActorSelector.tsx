import { useState } from "react";
import type { Actor } from "../lib/types";

interface Props {
  actors: Actor[];
  onSelect: (actor: Actor) => void;
  onRefresh: () => Promise<void>;
}

export function ActorSelector({ actors, onSelect, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  // Sort: incomplete first (to work on), then complete
  const sortedActors = [...actors].sort((a, b) => {
    const aComplete = a.doneCount === a.movieCount;
    const bComplete = b.doneCount === b.movieCount;
    if (aComplete !== bComplete) return aComplete ? 1 : -1;
    // Within same completion status, sort by progress percentage
    const aProgress = a.movieCount > 0 ? a.doneCount / a.movieCount : 0;
    const bProgress = b.movieCount > 0 ? b.doneCount / b.movieCount : 0;
    return bProgress - aProgress; // Higher progress first
  });

  const needsWork = sortedActors.filter(a => a.doneCount < a.movieCount);
  const complete = sortedActors.filter(a => a.doneCount === a.movieCount);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      {/* Header */}
      <div className="border-b border-gray-800 bg-black/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Clip Review</h1>
            <p className="text-gray-400 mt-1">
              {actors.length === 0
                ? "No clips found yet"
                : `${needsWork.length} actor${needsWork.length !== 1 ? "s" : ""} ready to review`}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 mt-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg text-sm text-gray-300 hover:text-white transition-all disabled:opacity-50"
            title="Rescan public/data/ for new actor folders"
          >
            <svg
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {actors.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">No Clips Ready</h2>
            <p className="text-gray-400 max-w-sm mx-auto mb-6">
              Add an actor folder, then hit <span className="text-white font-medium">Refresh</span> above.
            </p>
            <div className="text-left bg-gray-900 border border-gray-700 rounded-xl p-4 max-w-sm mx-auto text-sm">
              <p className="text-gray-400 mb-3 font-medium">Expected folder structure:</p>
              <pre className="font-mono text-xs text-gray-300 leading-relaxed">{`public/data/
└── adam-sandler/
    └── adam-sandler-clips.json`}</pre>
              <p className="text-gray-500 mt-3 text-xs">
                Folder name and JSON prefix must match.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Needs Review Section */}
            {needsWork.length > 0 && (
              <div className="mb-10">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Ready to Review
                </h2>
                <div className="grid gap-3">
                  {needsWork.map((actor) => (
                    <ActorCard key={actor.slug} actor={actor} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            )}

            {/* Complete Section */}
            {complete.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Complete
                </h2>
                <div className="grid gap-3 opacity-60">
                  {complete.map((actor) => (
                    <ActorCard key={actor.slug} actor={actor} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActorCard({ actor, onSelect }: { actor: Actor; onSelect: (actor: Actor) => void }) {
  const isComplete = actor.doneCount === actor.movieCount;
  const progress = actor.movieCount > 0 ? (actor.doneCount / actor.movieCount) * 100 : 0;

  return (
    <button
      onClick={() => onSelect(actor)}
      className={`group relative flex items-center gap-4 p-5 rounded-xl border transition-all text-left ${
        isComplete
          ? "bg-gray-900/50 border-gray-800 hover:border-gray-700"
          : "bg-gray-900 border-gray-700 hover:border-blue-500 hover:bg-gray-800"
      }`}
    >
      {/* Progress bar background */}
      <div className="absolute inset-0 rounded-xl overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${
            isComplete ? "bg-green-500/10" : "bg-blue-500/10"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Content */}
      <div className="relative flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-lg">{actor.name}</span>
          {isComplete && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Done
            </span>
          )}
        </div>
        <div className="text-sm text-gray-400 mt-1">
          {actor.movieCount} movie{actor.movieCount !== 1 ? 's' : ''}
          {!isComplete && actor.doneCount > 0 && (
            <span className="text-yellow-400 ml-2">
              {actor.doneCount} clip{actor.doneCount !== 1 ? 's' : ''} selected
            </span>
          )}
        </div>
      </div>

      {/* Progress indicator */}
      <div className="relative flex items-center gap-3">
        <div className="text-right">
          <div className={`text-2xl font-bold tabular-nums ${
            isComplete ? "text-green-400" : actor.doneCount > 0 ? "text-blue-400" : "text-gray-500"
          }`}>
            {actor.doneCount}/{actor.movieCount}
          </div>
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${
            isComplete ? "text-gray-600" : "text-gray-400 group-hover:translate-x-1"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
