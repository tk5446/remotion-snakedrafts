import type { Movie } from "../lib/types";

interface Props {
  actorName: string;
  movie: Movie;
  currentIndex: number;
  totalMovies: number;
  reviewedCount: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRankUp: () => void;
  onRankDown: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onFinalize: () => void;
  saving: boolean;
  finalizing: boolean;
}

export function Header({
  actorName,
  movie,
  currentIndex,
  totalMovies,
  reviewedCount,
  onBack,
  onPrev,
  onNext,
  onRankUp,
  onRankDown,
  onSave,
  onSaveAndNext,
  onFinalize,
  saving,
  finalizing,
}: Props) {
  const selectedIdx = movie.selected_candidate_index;
  const selectedCand =
    selectedIdx !== undefined && selectedIdx !== null
      ? movie.candidates?.[selectedIdx]
      : undefined;
  /** A saved row with a local file (YouTube-only rows don’t count). */
  const hasClipSelected = !!selectedCand?.clip_filename;

  return (
    <div className="h-20 border-b border-gray-800 flex items-center px-6 gap-6 bg-gradient-to-r from-gray-900 to-gray-900/80">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
        title="Back to actor list"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="text-sm font-medium">{actorName}</span>
      </button>

      <div className="w-px h-8 bg-gray-700" />

      {/* Rank controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onRankUp}
          disabled={movie.rank === 1}
          className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up in rank"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="flex items-center gap-2 bg-gray-800/80 rounded-lg px-3 py-2 min-w-[80px] justify-center">
          <span className="text-2xl font-bold text-white">#{movie.rank}</span>
        </div>
        <button
          onClick={onRankDown}
          disabled={movie.rank === totalMovies}
          className="p-1.5 hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down in rank"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Movie title */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-xl truncate">{movie.movie_title}</h1>
          <span className="text-gray-500">({movie.year})</span>
          {hasClipSelected && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Clip Selected
            </span>
          )}
        </div>
        <div className="text-sm text-gray-400 mt-0.5">
          as <span className="text-gray-300">{movie.character}</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-1">
        <button
          onClick={onPrev}
          disabled={currentIndex === 0}
          className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous movie"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="px-3 py-1 min-w-[70px] text-center">
          <span className="text-white font-semibold">{currentIndex + 1}</span>
          <span className="text-gray-500"> / {totalMovies}</span>
        </div>
        <button
          onClick={onNext}
          disabled={currentIndex === totalMovies - 1}
          className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next movie"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Finalize button — writes reviewed clips into top5.json */}
      <button
        onClick={onFinalize}
        disabled={finalizing || reviewedCount === 0}
        title={reviewedCount === 0 ? "Review at least one movie to finalize" : `Write ${reviewedCount} reviewed clip(s) to top5.json`}
        className="px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-900/30"
      >
        {finalizing ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Finalizing…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
            Finalize ({reviewedCount})
          </>
        )}
      </button>

      {/* Save button */}
      <button
        onClick={onSave}
        disabled={saving}
        className="px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        title="Save without advancing"
      >
        {saving ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
        )}
        Save
      </button>

      {/* Save & Next button */}
      <button
        onClick={onSaveAndNext}
        disabled={saving}
        className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 ${
          hasClipSelected
            ? "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {saving ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving...
          </>
        ) : (
          <>
            {hasClipSelected ? "Save & Next" : "Skip & Next"}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </>
        )}
      </button>
    </div>
  );
}
