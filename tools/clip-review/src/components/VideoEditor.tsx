import { useEffect, useRef, useState } from "react";
import type { Candidate, Movie } from "../lib/types";

const DEFAULT_BRIGHTNESS = 1;
const DEFAULT_VOLUME = 1;

interface Props {
  candidate: Candidate | null;
  candidateIndex: number | null;
  movie: Movie;
  onUpdateMovie: (updates: Partial<Movie>) => void;
  onDeleteCandidate: () => void;
}

export function VideoEditor({ candidate, candidateIndex, movie, onUpdateMovie, onDeleteCandidate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const trimBarRef = useRef<HTMLDivElement>(null);
  const dragTarget = useRef<"in" | "out" | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(0);
  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  // Reset ALL settings to per-candidate saved values (or defaults) when candidate changes
  useEffect(() => {
    if (!candidate) return;

    const savedTrimIn = candidate.trim_in ?? 0;
    const savedTrimOut = candidate.trim_out ?? candidate.duration ?? 0;
    const savedBrightness = candidate.brightness ?? DEFAULT_BRIGHTNESS;
    const savedVolume = candidate.volume ?? DEFAULT_VOLUME;

    setTrimIn(savedTrimIn);
    setTrimOut(savedTrimOut);
    setBrightness(savedBrightness);
    setVolume(savedVolume);
    setDuration(0);
    setPlaying(false);
    setCurrentTime(0);

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.pause();
    }
  }, [candidate?.clip_filename]);

  // Sync video volume with state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = Math.min(Math.max(volume, 0), 1);
    }
  }, [volume]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current || candidateIndex === null) return;
    const dur = videoRef.current.duration;
    setDuration(dur);

    const tIn = candidate?.trim_in ?? 0;
    let tOut: number;
    if (candidate?.trim_out != null) {
      tOut = Math.min(candidate.trim_out, dur);
    } else {
      const cap = candidate?.duration != null ? Math.min(candidate.duration, dur) : dur;
      tOut = cap;
    }
    tOut = Math.max(tIn + 0.5, tOut);

    setTrimIn(tIn);
    setTrimOut(tOut);

    // Persist effective length: grid + *-clips.json use `duration`; must match trim span after load/clamp
    const eff = roundClipDuration(tOut - tIn);
    if (eff > 0) {
      updateCandidate({ trim_in: tIn, trim_out: tOut, duration: eff });
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      
      // Loop within trim range when playing
      if (playing && time >= trimOut) {
        videoRef.current.currentTime = trimIn;
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (playing) {
      videoRef.current.pause();
    } else {
      if (videoRef.current.currentTime < trimIn || videoRef.current.currentTime >= trimOut) {
        videoRef.current.currentTime = trimIn;
      }
      videoRef.current.play();
    }
    setPlaying(!playing);
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const stepFrame = (direction: "back" | "forward") => {
    if (!videoRef.current) return;
    const FRAME = 1 / 30; // ~1 frame at 30fps
    const next = Math.max(0, Math.min(duration, currentTime + (direction === "forward" ? FRAME : -FRAME)));
    handleSeek(next);
  };

  const stepSeconds = (seconds: number) => {
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(duration, currentTime + seconds));
    handleSeek(next);
  };

  // Seek bar: click or drag anywhere to scrub playhead
  const onSeekBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current || !duration) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    handleSeek(ratio * duration);
    const onMove = (ev: MouseEvent) => {
      const r2 = seekBarRef.current!.getBoundingClientRect();
      const ratio2 = Math.max(0, Math.min(1, (ev.clientX - r2.left) / r2.width));
      handleSeek(ratio2 * duration);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  // Trim bar: proximity detection — within 12px of a handle = drag that handle, else ignore
  const onTrimBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trimBarRef.current || !duration) return;
    const rect = trimBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const inX = (trimIn / duration) * rect.width;
    const outX = (trimOut / duration) * rect.width;
    const HANDLE_PX = 14;

    if (Math.abs(clickX - inX) <= HANDLE_PX) {
      dragTarget.current = "in";
    } else if (Math.abs(clickX - outX) <= HANDLE_PX) {
      dragTarget.current = "out";
    } else {
      return; // click in middle of trim region — do nothing
    }

    const onMove = (ev: MouseEvent) => {
      if (!dragTarget.current || !trimBarRef.current) return;
      const r2 = trimBarRef.current.getBoundingClientRect();
      const time = Math.max(0, Math.min(duration, ((ev.clientX - r2.left) / r2.width) * duration));
      if (dragTarget.current === "in") handleTrimInChange(time);
      else handleTrimOutChange(time);
    };
    const onUp = () => {
      dragTarget.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  const updateCandidate = (updates: Partial<Candidate>) => {
    if (candidateIndex === null) return;
    const newCandidates = [...movie.candidates];
    newCandidates[candidateIndex] = { ...newCandidates[candidateIndex], ...updates };
    onUpdateMovie({ candidates: newCandidates });
  };

  /** Effective clip length in seconds; kept in sync with trim so JSON / grid match the editor. */
  const roundClipDuration = (seconds: number) => Math.round(Math.max(0, seconds) * 100) / 100;

  const handleTrimInChange = (value: number) => {
    const newTrimIn = Math.max(0, Math.min(value, trimOut - 0.5));
    setTrimIn(newTrimIn);
    const newDuration = roundClipDuration(trimOut - newTrimIn);
    updateCandidate({ trim_in: newTrimIn, duration: newDuration });
  };

  const handleTrimOutChange = (value: number) => {
    const newTrimOut = Math.min(duration, Math.max(value, trimIn + 0.5));
    setTrimOut(newTrimOut);
    const newDuration = roundClipDuration(newTrimOut - trimIn);
    updateCandidate({ trim_out: newTrimOut, duration: newDuration });
  };

  const handleBrightnessChange = (value: number) => {
    setBrightness(value);
    updateCandidate({ brightness: value });
  };

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    updateCandidate({ volume: value });
  };

  const setAsClipped = () => {
    if (candidate && candidateIndex !== null) {
      onUpdateMovie({
        selected_candidate_index: candidateIndex,
      });
    }
  };

  const trimDuration = trimOut - trimIn;
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms}`;
  };

  if (!candidate) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-gray-700">
            <svg className="w-12 h-12 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold mb-2">Select a Clip</h3>
          <p className="text-gray-400 mb-6">
            Click any candidate on the left to preview and edit it
          </p>
          <div className="text-sm text-gray-500 space-y-1">
            <p>Then: <span className="text-gray-300">Drag handles to trim</span> → <span className="text-gray-300">Click "Use This Clip"</span> → <span className="text-gray-300">Save & Next</span></p>
          </div>
        </div>
      </div>
    );
  }

  // Only true when the USER has saved this candidate as their choice (not pipeline auto-selection)
  const isSelected = movie.selected_candidate_index === candidateIndex;

  return (
    <div className="h-full flex flex-col">
      {/* Video player - takes most space */}
      <div className="flex-1 flex items-center justify-center bg-black relative min-h-0">
        <video
          ref={videoRef}
          src={`/clips/${candidate.clip_filename}`}
          className="max-w-full max-h-full"
          style={{ filter: `brightness(${brightness})` }}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={togglePlay}
        />
        
        {/* Selected badge */}
        {isSelected && (
          <div className="absolute top-4 left-4 bg-green-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-lg">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Selected for this movie
          </div>
        )}

        {/* Transport controls overlay — bottom of video */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-6">
          <div className="flex items-center justify-center gap-2">
            {/* -5s */}
            <button onClick={() => stepSeconds(-5)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-gray-300 hover:text-white" title="-5 seconds">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.5 3a9 9 0 11-9 9h2a7 7 0 107-7v3l-4-4 4-4v3c2.76 0 5 2.24 5 5z" opacity=".3"/>
                <path d="M6.5 12a6 6 0 106-6v2a4 4 0 11-4 4H6.5z" className="hidden"/>
              </svg>
              <span className="text-xs">-5s</span>
            </button>

            {/* Back 1 frame */}
            <button onClick={() => stepFrame("back")} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-300 hover:text-white" title="Back 1 frame">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>

            {/* Play/Pause */}
            <button onClick={togglePlay} className="p-2.5 bg-white/20 hover:bg-white/30 rounded-full transition-colors text-white" title={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            {/* Forward 1 frame */}
            <button onClick={() => stepFrame("forward")} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-300 hover:text-white" title="Forward 1 frame">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>

            {/* +5s */}
            <button onClick={() => stepSeconds(5)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-gray-300 hover:text-white" title="+5 seconds">
              <span className="text-xs">+5s</span>
            </button>

            {/* Time display */}
            <div className="ml-4 bg-black/60 rounded px-3 py-1 text-sm font-mono">
              <span className="text-white">{formatTime(currentTime)}</span>
              <span className="text-gray-400"> / {formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 pt-3 pb-1 bg-gray-900 border-t border-gray-800 space-y-2">

        {/* ── ROW 1: Seek scrubber ── */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-16 font-mono text-right shrink-0">{formatTime(currentTime)}</span>
          <div
            ref={seekBarRef}
            onMouseDown={onSeekBarMouseDown}
            className="relative flex-1 h-3 bg-gray-700 rounded-full cursor-pointer select-none group"
          >
            {/* Played portion */}
            <div
              className="absolute h-full bg-gray-500 rounded-full pointer-events-none"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
            {/* Playhead thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md shadow-black/50 pointer-events-none -ml-2 group-hover:scale-110 transition-transform"
              style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 w-16 font-mono shrink-0">{formatTime(duration)}</span>
        </div>

        {/* ── ROW 2: Trim bar ── */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 w-16 justify-end shrink-0">
            <span className="text-xs font-bold text-green-400">IN</span>
            <input
              type="number"
              value={trimIn.toFixed(1)}
              onChange={(e) => handleTrimInChange(parseFloat(e.target.value) || 0)}
              className="w-10 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-center font-mono text-xs focus:border-green-500 focus:outline-none"
              step="0.1"
            />
          </div>

          <div
            ref={trimBarRef}
            onMouseDown={onTrimBarMouseDown}
            className="relative flex-1 h-7 bg-gray-800 rounded-lg select-none"
            style={{ cursor: "default" }}
          >
            {/* Muted regions */}
            <div
              className="absolute h-full bg-gray-900/60 rounded-l-lg pointer-events-none"
              style={{ left: 0, width: `${duration ? (trimIn / duration) * 100 : 0}%` }}
            />
            <div
              className="absolute h-full bg-gray-900/60 rounded-r-lg pointer-events-none"
              style={{
                left: `${duration ? (trimOut / duration) * 100 : 100}%`,
                right: 0,
              }}
            />

            {/* Active trim region */}
            <div
              className="absolute h-full bg-blue-500/20 border-y border-blue-400/40 pointer-events-none"
              style={{
                left: `${duration ? (trimIn / duration) * 100 : 0}%`,
                width: `${duration ? ((trimOut - trimIn) / duration) * 100 : 100}%`,
              }}
            />

            {/* Playhead marker in trim bar */}
            <div
              className="absolute w-px h-full bg-white/50 pointer-events-none"
              style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />

            {/* IN handle */}
            <div
              className="absolute top-0 h-full w-3.5 bg-green-500 hover:bg-green-400 rounded-l-sm flex items-center justify-center cursor-ew-resize transition-colors pointer-events-none"
              style={{ left: `calc(${duration ? (trimIn / duration) * 100 : 0}% - 7px)` }}
            >
              <div className="w-px h-3 bg-white/80 rounded" />
              <div className="w-px h-3 bg-white/80 rounded ml-0.5" />
            </div>

            {/* OUT handle */}
            <div
              className="absolute top-0 h-full w-3.5 bg-red-500 hover:bg-red-400 rounded-r-sm flex items-center justify-center cursor-ew-resize transition-colors pointer-events-none"
              style={{ left: `calc(${duration ? (trimOut / duration) * 100 : 100}% - 7px)` }}
            >
              <div className="w-px h-3 bg-white/80 rounded" />
              <div className="w-px h-3 bg-white/80 rounded ml-0.5" />
            </div>
          </div>

          <div className="flex items-center gap-1 w-16 shrink-0">
            <input
              type="number"
              value={trimOut.toFixed(1)}
              onChange={(e) => handleTrimOutChange(parseFloat(e.target.value) || duration)}
              className="w-10 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-center font-mono text-xs focus:border-red-500 focus:outline-none"
              step="0.1"
            />
            <span className="text-xs font-bold text-red-400">OUT</span>
          </div>
        </div>

        {/* ── ROW 3: Quick actions + duration ── */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTrimInChange(currentTime)}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-green-700 text-gray-300 hover:text-white rounded transition-colors"
            >
              Set IN to here
            </button>
            <button
              onClick={() => handleTrimOutChange(currentTime)}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white rounded transition-colors"
            >
              Set OUT to here
            </button>
          </div>
          <span className="text-sm font-bold text-white bg-blue-600/20 border border-blue-500/30 px-3 py-0.5 rounded-full">
            {trimDuration.toFixed(1)}s final
          </span>
        </div>
      </div>

      {/* Bottom bar - Adjustments + Action */}
      <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50 flex items-center gap-8">
        {/* Brightness */}
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <input
            type="range"
            min={0.4}
            max={1.8}
            step={0.05}
            value={brightness}
            onChange={(e) => handleBrightnessChange(parseFloat(e.target.value))}
            className="w-24 accent-yellow-400"
          />
          <span className="text-sm text-gray-400 w-12 tabular-nums">{Math.round(brightness * 100)}%</span>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-24 accent-blue-400"
          />
          <span className="text-sm text-gray-400 w-12 tabular-nums">{Math.round(volume * 100)}%</span>
        </div>

        <div className="flex-1" />

        {/* Delete button */}
        <button
          onClick={() => {
            if (confirm('Delete this clip? This cannot be undone.')) {
              onDeleteCandidate();
            }
          }}
          className="px-4 py-2.5 bg-red-600/20 hover:bg-red-600 border border-red-500/30 hover:border-red-500 rounded-xl text-red-400 hover:text-white font-medium transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>

        {/* Action button */}
        {isSelected ? (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-green-600/20 border border-green-500/30 rounded-xl text-green-400 font-medium">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Clip selected — click "Save & Next" above
          </div>
        ) : (
          <button
            onClick={setAsClipped}
            className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 shadow-lg shadow-green-500/20"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Use This Clip
          </button>
        )}
      </div>
    </div>
  );
}
