import { useState, type FormEvent } from "react";
import type { Candidate } from "../lib/types";

interface Props {
  actorSlug: string;
  movieRank: number;
  onAdded: (candidate: Candidate) => void;
}

/** Parse user-typed start time: accepts "1:25" or "85" → returns seconds as number */
function parseStartTime(input: string): number {
  const clean = input.trim();
  if (clean.includes(":")) {
    const parts = clean.split(":");
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return parseFloat(clean) || 0;
}

export function AddClipForm({ actorSlug, movieRank, onAdded }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) {
      setError("YouTube URL is required");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/add-clip/${actorSlug}/${movieRank}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yt_url: ytUrl.trim(),
          start_seconds: parseStartTime(startTime),
          duration: parseFloat(duration) || 30,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        onAdded(data.candidate as Candidate);
        const title = (data.candidate.yt_title as string)?.slice(0, 45) ?? "clip";
        setSuccess(`Added: ${title}`);
        setYtUrl("");
        setStartTime("");
        setDuration("");
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data.error || "Unknown error");
      }
    } catch (err) {
      setError(String(err));
    }

    setLoading(false);
  };

  return (
    <div className="border-t border-gray-800">
      {/* Collapsible toggle */}
      <button
        type="button"
        onClick={() => { setExpanded(e => !e); setError(null); setSuccess(null); }}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add from YouTube URL
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="px-4 pb-4 space-y-2.5">
          {/* YouTube URL */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">YouTube URL</label>
            <input
              type="url"
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
              disabled={loading}
            />
          </div>

          <div className="flex gap-2">
            {/* Start time */}
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Start (M:SS or secs)</label>
              <input
                type="text"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                placeholder="1:25 or 85"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                disabled={loading}
              />
            </div>

            {/* Duration */}
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Duration (secs)</label>
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="30"
                min={1}
                max={120}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !ytUrl.trim()}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Downloading & clipping…
              </>
            ) : (
              "Download & Add Clip"
            )}
          </button>

          {/* Feedback */}
          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-2.5 py-1.5">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-green-400 bg-green-900/20 border border-green-800/50 rounded px-2.5 py-1.5">
              ✓ {success}
            </p>
          )}

          {loading && (
            <p className="text-xs text-gray-500 text-center">
              yt-dlp is downloading — this takes 15–30s
            </p>
          )}
        </form>
      )}
    </div>
  );
}
