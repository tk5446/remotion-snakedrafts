import { useState, useEffect, type FormEvent } from "react";
import type { Candidate } from "../lib/types";

function parseTimeToSeconds(input: string): number {
  const clean = input.trim();
  if (clean.includes(":")) {
    const parts = clean.split(":");
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return parseFloat(clean) || 0;
}

interface Props {
  candidate: Candidate;
  loading: boolean;
  error: string | null;
  onRequestDownload: (startSeconds: number, duration: number) => void;
}

export function YouTubePreview({
  candidate,
  loading,
  error,
  onRequestDownload,
}: Props) {
  const [startInput, setStartInput] = useState(() => String(Math.floor(candidate.start_seconds ?? 0)));
  const [durationInput, setDurationInput] = useState(() => String(candidate.duration ?? 30));

  useEffect(() => {
    setStartInput(String(Math.floor(candidate.start_seconds ?? 0)));
    setDurationInput(String(candidate.duration ?? 30));
  }, [candidate.yt_url, candidate.start_seconds, candidate.duration]);

  const videoId = candidate.yt_video_id || (candidate.yt_url?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? "");
  const startForEmbed = Math.max(0, Math.floor(parseTimeToSeconds(startInput) || candidate.start_seconds || 0));
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${startForEmbed}&rel=0`
    : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const startSeconds = parseTimeToSeconds(startInput);
    const dur = parseFloat(durationInput) || 4;
    if (dur < 1 || dur > 300) {
      return;
    }
    onRequestDownload(startSeconds, dur);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 flex flex-col bg-black rounded-lg overflow-hidden border border-gray-800">
        {embedUrl ? (
          <iframe
            title="YouTube preview"
            className="w-full flex-1 min-h-[min(50vh,360px)] aspect-video"
            src={embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-6">
            Invalid or missing YouTube video ID. URL: {candidate.yt_url?.slice(0, 80) ?? "—"}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 p-4 bg-gray-900/50 rounded-xl border border-gray-800 space-y-3">
        <p className="text-sm text-gray-400">
          Suggested in/out from the matcher are pre-filled. Adjust if needed, then download once — you can fine-trim the local file next.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start (sec or M:SS)</label>
            <input
              type="text"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Duration (seconds)</label>
            <input
              type="number"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              min={1}
              max={300}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              disabled={loading}
            />
          </div>
        </div>
        <div className="text-xs text-gray-600 break-all">URL: {candidate.yt_url}</div>
        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded px-2 py-1.5">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !videoId}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-lg"
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Downloading…
            </>
          ) : (
            "Download this clip to disk"
          )}
        </button>
      </form>
    </div>
  );
}
