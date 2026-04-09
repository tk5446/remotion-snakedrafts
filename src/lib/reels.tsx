import React, { useEffect } from "react";
import {
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FPS = 30;
export const REEL_W = 1080;
export const REEL_H = 1920;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MovieEntry = {
  actorName: string;
  actorSlug: string;
  rank: number;
  video_rank: number;
  movieTitle: string;
  movieSlug: string;
  localFilename: string;
  year: number;
  tmdbId: number;
  tmdb_description: string;
  yt_url: string | null;
  start_time: string | null;
  duration: number | null;
  clipped_video?: string;
  brightness?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".m4v"];

export const isVideoFile = (p: string): boolean => {
  const lower = p.toLowerCase();
  return VIDEO_EXTS.some((ext) => lower.endsWith(ext));
};

export const safeStaticFile = (p: string | undefined): string | null => {
  if (!p) return null;
  const cleaned = p.startsWith("/") ? p.slice(1) : p;
  return staticFile(cleaned);
};

// ---------------------------------------------------------------------------
// Font hook
// ---------------------------------------------------------------------------

export const useFont = (fontFamily: string, fontUrl: string): void => {
  useEffect(() => {
    const handle = delayRender(`Loading font: ${fontFamily}`);
    const face = new FontFace(fontFamily, `url(${fontUrl})`);
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(`Failed to load font "${fontFamily}":`, err);
        continueRender(handle);
      });
  }, [fontFamily, fontUrl]);
};

// ---------------------------------------------------------------------------
// ReelVideo – renders video or image media with proper sizing
// ---------------------------------------------------------------------------

type ReelVideoProps = {
  src: string | undefined;
  from: number;
  durationInFrames: number;
  muted?: boolean;
  style?: React.CSSProperties;
};

export const ReelVideo: React.FC<ReelVideoProps> = ({
  src,
  from,
  durationInFrames,
  muted = false,
  style,
}) => {
  const resolved = safeStaticFile(src);

  if (!resolved) {
    return (
      <div
        style={{
          ...style,
          backgroundColor: "black",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          fontSize: 20,
        }}
      >
        No media
      </div>
    );
  }

  if (!src || !isVideoFile(src)) {
    return (
      <Img
        src={resolved}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          ...style,
        }}
      />
    );
  }

  return (
    <Sequence from={from} durationInFrames={durationInFrames}>
      <OffthreadVideo
        src={resolved}
        startFrom={0}
        endAt={durationInFrames}
        muted={muted}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          ...style,
        }}
      />
    </Sequence>
  );
};

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

export const buildCumulativeFrames = (
  entries: MovieEntry[],
  fps: number = FPS,
): number[] => {
  const boundaries: number[] = [0];
  for (const r of entries) {
    boundaries.push(boundaries[boundaries.length - 1] + (r.duration ?? 0) * fps);
  }
  return boundaries;
};

export const getActiveIndex = (
  frame: number,
  cumulativeFrames: number[],
): number => {
  for (let i = 0; i < cumulativeFrames.length - 1; i++) {
    if (frame < cumulativeFrames[i + 1]) return i;
  }
  return cumulativeFrames.length - 2;
};

export const getTotalDurationFrames = (
  entries: MovieEntry[],
  fps: number = FPS,
): number => {
  return entries.reduce((sum, r) => sum + (r.duration ?? 0) * fps, 0);
};
