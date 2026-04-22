import { useState, useEffect } from "react";
import type { Actor, Candidate, ClipsData, Movie } from "./lib/types";
import { ActorSelector } from "./components/ActorSelector";
import { Header } from "./components/Header";
import { CandidateGrid } from "./components/CandidateGrid";
import { VideoEditor } from "./components/VideoEditor";
import { AddClipForm } from "./components/AddClipForm";
import { YouTubePreview } from "./components/YouTubePreview";

function movieIsReviewedWithFile(m: Movie): boolean {
  if (m.selected_candidate_index === undefined || m.selected_candidate_index === null) return false;
  const c = m.candidates?.[m.selected_candidate_index];
  return !!c?.clip_filename;
}

export default function App() {
  const [actors, setActors] = useState<Actor[]>([]);
  const [selectedActor, setSelectedActor] = useState<Actor | null>(null);
  const [clipsData, setClipsData] = useState<ClipsData | null>(null);
  const [currentMovieIndex, setCurrentMovieIndex] = useState(0);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchActors = async () => {
    const data = await fetch("/api/actors").then((r) => r.json());
    setActors(data.actors || []);
  };

  // Load actors list on mount
  useEffect(() => {
    fetchActors().catch(console.error);
  }, []);

  useEffect(() => {
    setDownloadError(null);
  }, [currentMovieIndex, selectedCandidateIndex]);

  // Load clips data when actor is selected, auto-restore selected candidate
  useEffect(() => {
    if (!selectedActor) return;
    fetch(`/api/clips/${selectedActor.slug}`)
      .then((res) => res.json())
      .then((data: ClipsData) => {
        setClipsData(data);
        setCurrentMovieIndex(0);
        // Auto-select the saved candidate for movie 0
        const firstMovie = data.movies?.[0];
        setSelectedCandidateIndex(firstMovie?.selected_candidate_index ?? null);
      })
      .catch(console.error);
  }, [selectedActor]);

  const currentMovie = clipsData?.movies?.[currentMovieIndex];
  const totalMovies = clipsData?.movies?.length || 0;

  const handleSelectActor = (actor: Actor) => {
    setSelectedActor(actor);
  };

  const handleBack = () => {
    setSelectedActor(null);
    setClipsData(null);
  };

  const handleSelectCandidate = (index: number) => {
    setSelectedCandidateIndex(index);
  };

  const handleDeleteCandidate = (index: number) => {
    if (!clipsData || currentMovieIndex < 0) return;
    
    const newMovies = [...clipsData.movies];
    const movie = newMovies[currentMovieIndex];
    
    // Remove the candidate
    const newCandidates = (movie.candidates ?? []).filter((_, i) => i !== index);
    newMovies[currentMovieIndex] = { 
      ...movie, 
      candidates: newCandidates,
      // Shift or clear selected_candidate_index when a candidate is deleted
      selected_candidate_index: movie.selected_candidate_index === index 
        ? undefined 
        : movie.selected_candidate_index !== undefined && movie.selected_candidate_index > index
        ? movie.selected_candidate_index - 1
        : movie.selected_candidate_index,
    };
    
    setClipsData({ ...clipsData, movies: newMovies });
    
    // Clear selection if we deleted the currently selected candidate
    if (selectedCandidateIndex === index) {
      setSelectedCandidateIndex(null);
    } else if (selectedCandidateIndex !== null && selectedCandidateIndex > index) {
      setSelectedCandidateIndex(selectedCandidateIndex - 1);
    }
  };

  const handleCandidateAdded = (newCandidate: Candidate) => {
    if (!clipsData || currentMovieIndex < 0) return;

    const newMovies = [...clipsData.movies];
    const movie = newMovies[currentMovieIndex];
    const existing = movie.candidates ?? [];

    // Shift existing selected_candidate_index since we're prepending
    const shiftedSelected =
      movie.selected_candidate_index !== undefined && movie.selected_candidate_index !== null
        ? movie.selected_candidate_index + 1
        : movie.selected_candidate_index;

    newMovies[currentMovieIndex] = {
      ...movie,
      candidates: [newCandidate, ...existing],
      selected_candidate_index: shiftedSelected,
    };

    setClipsData({ ...clipsData, movies: newMovies });
    // Auto-select the newly added clip so it immediately loads in the editor
    setSelectedCandidateIndex(0);
  };

  const handleUpdateMovie = (updates: Partial<Movie>) => {
    if (!clipsData || currentMovieIndex < 0) return;
    
    const newMovies = [...clipsData.movies];
    newMovies[currentMovieIndex] = { ...newMovies[currentMovieIndex], ...updates };
    setClipsData({ ...clipsData, movies: newMovies });
  };

  const handleRequestDownload = async (startSeconds: number, duration: number) => {
    if (!clipsData || !selectedActor || !currentMovie || selectedCandidateIndex === null) return;
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      const res = await fetch(
        `/api/download-candidate/${selectedActor.slug}/${currentMovie.rank}/${selectedCandidateIndex}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_seconds: startSeconds, duration }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setDownloadError(data.error || data.details || "Download failed");
        return;
      }
      const newMovies = [...clipsData.movies];
      const movie = newMovies[currentMovieIndex];
      const cands = [...(movie.candidates ?? [])];
      cands[selectedCandidateIndex] = data.candidate as Candidate;
      newMovies[currentMovieIndex] = { ...movie, candidates: cands };
      setClipsData({ ...clipsData, movies: newMovies });
    } catch (e) {
      setDownloadError(String(e));
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleSave = async () => {
    if (!clipsData || !selectedActor) return;

    // Commit the open candidate, sync duration to trim span, and set selection when needed.
    let dataToSave = clipsData;
    if (selectedCandidateIndex !== null && currentMovieIndex >= 0) {
      const movie = clipsData.movies[currentMovieIndex];
      const candidate = (movie.candidates ?? [])[selectedCandidateIndex];
      if (candidate) {
        const newMovies = [...clipsData.movies];
        const newCands = [...(movie.candidates ?? [])];
        let c = { ...candidate };
        if (typeof c.trim_in === "number" && typeof c.trim_out === "number") {
          c.duration = Math.round((c.trim_out - c.trim_in) * 100) / 100;
        }
        newCands[selectedCandidateIndex] = c;
        const selectedIdxUpdate =
          movie.selected_candidate_index !== selectedCandidateIndex
            ? { selected_candidate_index: selectedCandidateIndex }
            : {};
        newMovies[currentMovieIndex] = {
          ...movie,
          candidates: newCands,
          ...selectedIdxUpdate,
        };
        const changed =
          movie.selected_candidate_index !== selectedCandidateIndex ||
          candidate.duration !== c.duration;
        if (changed) {
          dataToSave = { ...clipsData, movies: newMovies };
          setClipsData(dataToSave);
        }
      }
    }

    setSaving(true);
    try {
      await fetch(`/api/clips/${selectedActor.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSave),
      });
    } catch (err) {
      console.error("Save failed:", err);
    }
    setSaving(false);
  };

  const handleFinalize = async () => {
    if (!selectedActor) return;
    setFinalizing(true);
    setFinalizeResult(null);
    try {
      const res = await fetch(`/api/finalize/${selectedActor.slug}`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setFinalizeResult(
          `✓ ${data.updatedMovies} clip(s) written → public/data/top5.json${data.transcribing ? " · transcribing in background" : ""}`
        );
      } else {
        setFinalizeResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setFinalizeResult(`Error: ${String(err)}`);
    }
    setFinalizing(false);
    // Clear the toast after 4 seconds
    setTimeout(() => setFinalizeResult(null), 4000);
  };

  // Navigate to a movie index and restore its previously selected candidate
  const goToMovie = (index: number) => {
    setCurrentMovieIndex(index);
    const movie = clipsData?.movies?.[index];
    setSelectedCandidateIndex(movie?.selected_candidate_index ?? null);
  };

  const handleSaveAndNext = async () => {
    await handleSave();
    if (currentMovieIndex < totalMovies - 1) {
      goToMovie(currentMovieIndex + 1);
    }
  };

  const handlePrevMovie = () => {
    if (currentMovieIndex > 0) goToMovie(currentMovieIndex - 1);
  };

  const handleNextMovie = () => {
    if (currentMovieIndex < totalMovies - 1) goToMovie(currentMovieIndex + 1);
  };

  const handleRankChange = (direction: "up" | "down") => {
    if (!clipsData || !currentMovie) return;

    const newMovies = [...clipsData.movies];
    const swapIndex = direction === "up" ? currentMovieIndex - 1 : currentMovieIndex + 1;
    
    if (swapIndex < 0 || swapIndex >= newMovies.length) return;

    // Swap ranks
    const currentRank = newMovies[currentMovieIndex].rank;
    const swapRank = newMovies[swapIndex].rank;
    newMovies[currentMovieIndex].rank = swapRank;
    newMovies[swapIndex].rank = currentRank;

    // Sort by rank
    newMovies.sort((a, b) => a.rank - b.rank);

    // Find new index of current movie
    const newIndex = newMovies.findIndex(m => m.movie_title === currentMovie.movie_title);

    setClipsData({ ...clipsData, movies: newMovies });
    setCurrentMovieIndex(newIndex);
  };

  // Show actor selector if no actor selected
  if (!selectedActor) {
    return <ActorSelector actors={actors} onSelect={handleSelectActor} onRefresh={fetchActors} />;
  }

  // Loading state
  if (!clipsData || !currentMovie) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-gray-900 to-black">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-gray-400">Loading clips for {selectedActor.name}...</div>
        </div>
      </div>
    );
  }

  const candidates = currentMovie.candidates ?? [];
  const selectedCandidate = selectedCandidateIndex !== null
    ? candidates[selectedCandidateIndex] ?? null
    : null;

  // The clip the user has explicitly confirmed for this movie (via Save in this UI).
  // Derived from selected_candidate_index — never from the pipeline's clipped_video.
  const userReviewedIndex = currentMovie.selected_candidate_index ?? null;
  const userReviewedFilename = userReviewedIndex !== null
    ? (candidates[userReviewedIndex]?.clip_filename ?? null)
    : null;

  const reviewedCount = clipsData.movies.filter(movieIsReviewedWithFile).length;

  return (
    <div className="h-screen flex flex-col">
      <Header
        actorName={clipsData.actor_name}
        movie={currentMovie}
        currentIndex={currentMovieIndex}
        totalMovies={totalMovies}
        reviewedCount={reviewedCount}
        onBack={handleBack}
        onPrev={handlePrevMovie}
        onNext={handleNextMovie}
        onRankUp={() => handleRankChange("up")}
        onRankDown={() => handleRankChange("down")}
        onSave={handleSave}
        onSaveAndNext={handleSaveAndNext}
        onFinalize={handleFinalize}
        saving={saving}
        finalizing={finalizing}
      />

      {/* Finalize toast */}
      {finalizeResult && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-sm font-semibold shadow-xl transition-all ${
          finalizeResult.startsWith("✓")
            ? "bg-purple-700 text-white"
            : "bg-red-700 text-white"
        }`}>
          {finalizeResult}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Candidate Grid */}
        <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900/30">
          <div className="p-4 border-b border-gray-800 bg-gray-900/50">
            {userReviewedFilename ? (
              <>
                <h2 className="text-sm font-semibold text-green-400 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Clip Selected
                </h2>
                <p className="text-xs text-gray-500 mt-1">Click another to change</p>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-gray-300">Step 1: Pick a Clip</h2>
                <p className="text-xs text-gray-500 mt-1">Click a candidate to preview</p>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <CandidateGrid
              candidates={candidates}
              selectedIndex={selectedCandidateIndex}
              chosenFilename={userReviewedFilename}
              onSelect={handleSelectCandidate}
              onDelete={handleDeleteCandidate}
            />
          </div>
          <AddClipForm
            actorSlug={selectedActor.slug}
            movieRank={currentMovie.rank}
            onAdded={handleCandidateAdded}
          />
        </div>

        {/* Right: Video Editor */}
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-950">
          <div className="px-6 py-3 border-b border-gray-800 bg-gray-900/50">
            {selectedCandidate?.clip_filename ? (
              <>
                <h2 className="text-sm font-semibold text-gray-300">Step 2: Trim & adjust (local file)</h2>
                <p className="text-xs text-gray-500 mt-0.5">Fine-tune trim, brightness, volume, then save your choice</p>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-gray-300">Step 2: Preview on YouTube</h2>
                <p className="text-xs text-gray-500 mt-0.5">Set start and duration, then download the clip to disk to enable trimming</p>
              </>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            {!selectedCandidate ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                Select a candidate on the left
              </div>
            ) : !selectedCandidate.clip_filename ? (
              <YouTubePreview
                candidate={selectedCandidate}
                loading={downloadLoading}
                error={downloadError}
                onRequestDownload={handleRequestDownload}
              />
            ) : (
              <VideoEditor
                candidate={selectedCandidate}
                candidateIndex={selectedCandidateIndex}
                movie={currentMovie}
                onUpdateMovie={handleUpdateMovie}
                onDeleteCandidate={() => {
                  if (selectedCandidateIndex !== null) {
                    handleDeleteCandidate(selectedCandidateIndex);
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-14 border-t border-gray-800 bg-gray-900/50 flex items-center px-6 gap-6">
        <div className="text-sm text-gray-400">
          Progress:
        </div>
        <div className="flex-1 flex items-center gap-1">
          {clipsData.movies.map((movie, i) => {
            const isCurrent = i === currentMovieIndex;
            const isDone = movieIsReviewedWithFile(movie);
            return (
              <button
                key={i}
                onClick={() => goToMovie(i)}
                className={`relative group flex-1 h-2 rounded-full transition-all ${
                  isCurrent
                    ? "bg-blue-500 ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900"
                    : isDone
                    ? "bg-green-500 hover:bg-green-400"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
                title={`#${movie.rank} ${movie.movie_title}${isDone ? ' ✓' : ''}`}
              >
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
                  <div className="bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap border border-gray-700">
                    #{movie.rank} {movie.movie_title}
                    {isDone && <span className="text-green-400 ml-1">✓</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-sm">
          <span className="text-green-400 font-semibold">
            {clipsData.movies.filter(movieIsReviewedWithFile).length}
          </span>
          <span className="text-gray-500"> / {clipsData.movies.length} done</span>
        </div>
      </div>
    </div>
  );
}
