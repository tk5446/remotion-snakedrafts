import type { Candidate } from "../lib/types";

interface Props {
  candidates: Candidate[];
  selectedIndex: number | null;   // currently open in the editor
  chosenFilename: string | undefined; // the confirmed "use this clip" selection
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
}

function youtubeThumbUrl(ytId: string | undefined): string | null {
  if (!ytId) return null;
  return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
}

export function CandidateGrid({ candidates, selectedIndex, chosenFilename, onSelect, onDelete }: Props) {
  const withUrl = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.yt_url);

  if (withUrl.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
        </div>
        <p className="text-gray-400 font-medium">No candidates</p>
        <p className="text-gray-500 text-sm mt-1">Run find_clips_json or add a YouTube URL below</p>
      </div>
    );
  }

  const downloaded = (c: Candidate) => !!c.clip_filename;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Candidates</span>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
          {withUrl.length} total · {withUrl.filter(({ c }) => downloaded(c)).length} on disk
        </span>
      </div>
      
      {withUrl.map(({ c: candidate, i: index }) => {
        const isInEditor = index === selectedIndex;
        const isChosen = !!chosenFilename && candidate.clip_filename === chosenFilename;
        const hasFile = downloaded(candidate);
        const thumb = hasFile
          ? null
          : youtubeThumbUrl(candidate.yt_video_id);

        return (
          <div key={index} className="relative group">
            <button
              onClick={() => onSelect(index)}
              className={`w-full text-left rounded-xl border-2 transition-all overflow-hidden ${
                isChosen
                  ? "border-green-500 bg-green-500/10 ring-2 ring-green-500/20"
                  : isInEditor
                  ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/20"
                  : "border-gray-700 bg-gray-800/50 hover:border-gray-500 hover:bg-gray-800"
              }`}
            >
              <div className="aspect-video bg-black relative">
                {hasFile ? (
                  <video
                    src={`/clips/${candidate.clip_filename!}`}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                ) : thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                    YouTube
                  </div>
                )}

                {!hasFile && (
                  <div className="absolute top-2 left-2 bg-amber-600/95 text-white text-xs font-bold px-2 py-0.5 rounded">
                    YouTube
                  </div>
                )}

                {isChosen && (
                  <div className="absolute inset-0 bg-green-500/10 pointer-events-none" />
                )}

                {!isChosen && !isInEditor && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/30 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                )}
                
                <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-medium px-2 py-1 rounded">
                  {Math.round(candidate.duration)}s
                </div>

                {isChosen && (
                  <div className="absolute top-0 left-0 right-0 flex items-center justify-center gap-2 bg-green-500 text-white text-sm font-bold px-3 py-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    SELECTED CLIP
                  </div>
                )}

                {isInEditor && !isChosen && (
                  <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    {hasFile ? "Editing" : "Preview"}
                  </div>
                )}

                <div className={`absolute ${isChosen ? 'top-10' : 'top-2'} right-2 text-xs font-bold px-2 py-1 rounded ${
                  candidate.adjusted_score >= 90
                    ? "bg-green-600 text-white"
                    : candidate.adjusted_score >= 80
                    ? "bg-yellow-500 text-black"
                    : "bg-gray-700 text-gray-300"
                }`}>
                  {candidate.adjusted_score}
                </div>
              </div>

              <div className="p-3">
                <div className="text-sm text-gray-300 line-clamp-2 leading-snug">
                  "{candidate.matched_quote?.slice(0, 100)}{candidate.matched_quote && candidate.matched_quote.length > 100 ? '...' : ''}"
                </div>
                {isChosen && (candidate.trim_in !== undefined || candidate.trim_out !== undefined) && hasFile && (
                  <div className="flex gap-3 mt-2 text-xs font-mono">
                    <span className="text-green-400">IN: {(candidate.trim_in ?? 0).toFixed(1)}s</span>
                    <span className="text-green-400">OUT: {(candidate.trim_out ?? candidate.duration).toFixed(1)}s</span>
                    {candidate.brightness !== undefined && candidate.brightness !== 1 && (
                      <span className="text-yellow-400">☀ {Math.round(candidate.brightness * 100)}%</span>
                    )}
                    {candidate.volume !== undefined && candidate.volume !== 1 && (
                      <span className="text-blue-400">♪ {Math.round(candidate.volume * 100)}%</span>
                    )}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1.5 truncate">
                  {candidate.yt_title}
                </div>
                {!hasFile && (
                  <div className="text-xs text-amber-500/90 mt-1">Not on disk — open to preview, then download</div>
                )}
              </div>
            </button>

            {!isChosen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Remove this candidate from the list?')) {
                    onDelete(index);
                  }
                }}
                className="absolute top-2 left-2 p-1.5 bg-red-600/90 hover:bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title="Remove candidate"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
