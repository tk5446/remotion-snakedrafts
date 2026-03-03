import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  staticFile,
  OffthreadVideo,
  Sequence,
} from "remotion";

import data from "../public/data/top10.json";

type Row = {
  rank: number;
  label: string;
<<<<<<< Updated upstream
  media?: string;
  image?: string;
};

const FPS = 30;
const FRAMES_PER_ROW = 5 * FPS;

const BOX_W = 405;
const BOX_H = 77;
const LEFT_X = 110;
const RIGHT_X = 647;
const ROW_Y = [852, 942, 1030, 1118, 1207];
=======
  media?: string; // preferred
  image?: string; // legacy support
};

const FPS = 30;
const SECONDS_PER_ROW = 5;
const FRAMES_PER_ROW = SECONDS_PER_ROW * FPS; // 150
>>>>>>> Stashed changes

const isVideoFile = (p: string) => {
  const lower = p.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".m4v")
  );
};

const safeStaticFile = (p: string | undefined) => {
  if (!p) return null;
  const cleaned = p.startsWith("/") ? p.slice(1) : p;
  return staticFile(cleaned);
};

const BackgroundMedia = ({
  src,
  segmentStartFrame,
  activeIndex,
}: {
  src: string | undefined;
  segmentStartFrame: number;
  activeIndex: number;
}) => {
  const resolved = safeStaticFile(src);

  if (!resolved) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "black",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 700,
          padding: 24,
          textAlign: "center",
        }}
      >
<<<<<<< Updated upstream
        Missing media path. Check JSON keys: use "media" or "image".
=======
        Missing media path. Ensure each row has "media" (or legacy "image").
>>>>>>> Stashed changes
      </AbsoluteFill>
    );
  }

  // Image case
  if (!src || !isVideoFile(src)) {
    return (
      <Img
        src={resolved}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    );
  }

  // Video case (audio ON)
  return (
    <Sequence from={segmentStartFrame} durationInFrames={FRAMES_PER_ROW}>
      <OffthreadVideo
        key={`${resolved}-${activeIndex}`} // force restart per segment
        src={resolved}
        // ✅ audio on (remove muted)
        // muted
        startFrom={0}
        endAt={FRAMES_PER_ROW}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </Sequence>
  );
};

<<<<<<< Updated upstream
export const Top10Board = ({ title }: { title: string }) => {
=======
export const Top10Board = ({
  bg,
  fallbackBg,
  title,
}: {
  bg?: string; // legacy
  fallbackBg?: string; // preferred
  title: string;
}) => {
>>>>>>> Stashed changes
  const frame = useCurrentFrame();
  const rows: Row[] = (data as Row[]) ?? [];

  const activeIndex = Math.floor(frame / FRAMES_PER_ROW);
  const segmentStartFrame = activeIndex * FRAMES_PER_ROW;

  const activeRow = rows[activeIndex];

  const left = rows.slice(0, 5);
  const right = rows.slice(5, 10);

  const chosen =
<<<<<<< Updated upstream
    activeRow?.media ?? activeRow?.image ?? "assets/got.png";

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Layer 1: Hero image/video */}
      <Media
        src={chosen}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Layer 2: Bottom board template */}
      <Img
        src={staticFile("assets/template/bottom-layer.png")}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: 1080,
          height: 815,
        }}
=======
    activeRow?.media ??
    activeRow?.image ??
    fallbackBg ??
    bg ??
    "assets/got.png";

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <BackgroundMedia
        src={chosen}
        segmentStartFrame={segmentStartFrame}
        activeIndex={activeIndex}
>>>>>>> Stashed changes
      />

      {/* Layer 3: Title background */}
      <Img
        src={staticFile("assets/template/title-background.png")}
        style={{
          position: "absolute",
          top: 680,
          left: 0,
          width: 1080,
          height: 170,
        }}
      />

      {/* Layer 4: Title text */}
      <div
        style={{
          position: "absolute",
          top: 680,
          left: 0,
          width: 1080,
          height: 170,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 900,
          fontSize: 48,
          lineHeight: 1.15,
          textAlign: "center",
          whiteSpace: "pre-line",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>

      {/* Layer 5: SD logo */}
      <Img
        src={staticFile("assets/template/sd-logo.png")}
        style={{
          position: "absolute",
          top: 25,
          right: 25,
          width: 80,
          height: 83,
        }}
      />

      {/* Layer 6 & 7: Revealed items */}
      {left.map((r, i) => (
        <RevealedItem
          key={r.rank}
          row={r}
          globalIndex={i}
          frame={frame}
          x={LEFT_X}
          y={ROW_Y[i]}
        />
      ))}
      {right.map((r, i) => (
        <RevealedItem
          key={r.rank}
          row={r}
          globalIndex={5 + i}
          frame={frame}
          x={RIGHT_X}
          y={ROW_Y[i]}
        />
      ))}
    </AbsoluteFill>
  );
};

const RevealedItem = ({
  row,
  globalIndex,
  frame,
  x,
  y,
}: {
  row: Row;
  globalIndex: number;
  frame: number;
  x: number;
  y: number;
}) => {
  const START = globalIndex * FRAMES_PER_ROW;
  const DURATION = 20;

  const isRevealed = frame >= START && !!row.label;
  if (!isRevealed) return null;

  const appear = interpolate(frame, [START, START + DURATION], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: BOX_W,
        height: BOX_H,
        opacity: appear,
        transform: `scale(${0.95 + 0.05 * appear})`,
        transformOrigin: "center center",
      }}
    >
      <Img
        src={staticFile("assets/template/highlighted-text-rectangle.png")}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: BOX_W,
          height: BOX_H,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: BOX_W,
          height: BOX_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 800,
          fontSize: 28,
          textAlign: "center",
        }}
      >
        {row.label}
      </div>
    </div>
  );
};
