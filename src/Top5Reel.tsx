import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  OffthreadVideo,
} from "remotion";

import {
  FPS,
  REEL_W,
  useFont,
  safeStaticFile,
  isVideoFile,
  buildCumulativeFrames,
  getActiveIndex,
  type Top5Data,
  type Ranking,
} from "./lib/reels";

import jsonData from "../public/data/top5.json";

// ---------------------------------------------------------------------------
// Layout constants (pixels, 1080 x 1920)
// ---------------------------------------------------------------------------

const VIDEO_Y = 80;
const VIDEO_H = 608;
const TITLE_Y = 688;
const TITLE_H = 122;
const LIST_BG_H = 1090;

// The list background image has 118px of internal black padding at top.
// Position the image so that its purple gradient starts right at y=810.
const LIST_BG_INTERNAL_OFFSET = 118;
const LIST_BG_Y = TITLE_Y + TITLE_H - LIST_BG_INTERNAL_OFFSET; // 692

const ENTRY_W = 872;
const ENTRY_H = 119;
const ENTRY_X = 160;

// Y offsets relative to the list background image top (from Pillow analysis)
const ENTRY_Y_OFFSETS = [148, 285, 422, 559, 696]; // ranks 5, 4, 3, 2, 1

const FONT_FAMILY = "Circus of Innocents";
const FONT_URL = staticFile("assets/fonts/Circus-Of-Innocents.ttf");

const TEMPLATE_BASE = "assets/template/reels/top5";
const VIDEO_BASE = "assets/media/out";

// ---------------------------------------------------------------------------
// Title text with auto-shrink
// ---------------------------------------------------------------------------

const BASE_TITLE_SIZE = 60;
const MIN_TITLE_SIZE = 28;
const TITLE_PADDING = 40;
const TITLE_CHAR_WIDTH_RATIO = 0.48;

const fitFontSize = (
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  charWidthRatio: number,
): number => {
  let size = baseSize;
  while (size > minSize) {
    if (text.length * size * charWidthRatio <= maxWidth) break;
    size -= 1;
  }
  return size;
};

const AutoShrinkTitle: React.FC<{ text: string }> = ({ text }) => {
  const display = text.toUpperCase();
  const maxWidth = REEL_W - TITLE_PADDING * 2;
  const fontSize = fitFontSize(display, maxWidth, BASE_TITLE_SIZE, MIN_TITLE_SIZE, TITLE_CHAR_WIDTH_RATIO);

  return (
    <div
      style={{
        position: "absolute",
        top: TITLE_Y,
        left: 0,
        width: REEL_W,
        height: TITLE_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontFamily: FONT_FAMILY,
        fontStyle: "italic",
        fontWeight: 700,
        fontSize,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        padding: `0 ${TITLE_PADDING}px`,
      }}
    >
      {display}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Entry overlay
// ---------------------------------------------------------------------------

type EntryState = "highlighted" | "active" | "empty";

const entryBgFile = (state: EntryState): string => {
  switch (state) {
    case "highlighted":
      return `${TEMPLATE_BASE}/highlighted-entry.png`;
    case "active":
      return `${TEMPLATE_BASE}/active-entry.png`;
    case "empty":
      return `${TEMPLATE_BASE}/empty-entry.png`;
  }
};

const BASE_ENTRY_SIZE = 70;
const MIN_ENTRY_SIZE = 32;
const ENTRY_TEXT_PADDING = 30;
const ENTRY_CHAR_WIDTH_RATIO = 0.48;

const EntryOverlay: React.FC<{
  ranking: Ranking;
  index: number;
  state: EntryState;
}> = ({ ranking, index, state }) => {
  const yOffset = ENTRY_Y_OFFSETS[index];
  const showLabel = state !== "empty";
  const maxTextWidth = ENTRY_W - ENTRY_TEXT_PADDING * 2;
  const fontSize = fitFontSize(ranking.label, maxTextWidth, BASE_ENTRY_SIZE, MIN_ENTRY_SIZE, ENTRY_CHAR_WIDTH_RATIO);

  return (
    <div
      style={{
        position: "absolute",
        left: ENTRY_X,
        top: LIST_BG_Y + yOffset,
        width: ENTRY_W,
        height: ENTRY_H,
      }}
    >
      <Img
        src={staticFile(entryBgFile(state))}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: ENTRY_W,
          height: ENTRY_H,
        }}
      />
      {showLabel && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: ENTRY_W,
            height: ENTRY_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontFamily: FONT_FAMILY,
            fontStyle: "italic",
            fontWeight: 700,
            fontSize,
            textAlign: "center",
            whiteSpace: "nowrap",
            padding: `0 ${ENTRY_TEXT_PADDING}px`,
          }}
        >
          {ranking.label}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const Top5Reel: React.FC = () => {
  const frame = useCurrentFrame();
  const data = jsonData as Top5Data;
  const { rankings, title } = data;

  useFont(FONT_FAMILY, FONT_URL);

  const cumulativeFrames = buildCumulativeFrames(rankings, FPS);
  const activeIndex = getActiveIndex(frame, cumulativeFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Video area */}
      {rankings.map((r, i) => {
        const segFrom = cumulativeFrames[i];
        const segDur = r.video.duration * FPS;
        const videoPath = `${VIDEO_BASE}/${r.video.clipped_video}`;
        const resolved = safeStaticFile(videoPath);

        if (!resolved) return null;

        if (!isVideoFile(videoPath)) {
          return (
            <div
              key={r.rank}
              style={{
                position: "absolute",
                top: VIDEO_Y,
                left: 0,
                width: REEL_W,
                height: VIDEO_H,
                display: frame >= segFrom && frame < segFrom + segDur ? "block" : "none",
              }}
            >
              <Img
                src={resolved}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          );
        }

        return (
          <Sequence key={r.rank} from={segFrom} durationInFrames={segDur}>
            <div
              style={{
                position: "absolute",
                top: VIDEO_Y,
                left: 0,
                width: REEL_W,
                height: VIDEO_H,
                overflow: "hidden",
              }}
            >
              <OffthreadVideo
                src={resolved}
                startFrom={0}
                endAt={segDur}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          </Sequence>
        );
      })}

      {/* List background (rendered before title so title covers the overlap) */}
      <Img
        src={staticFile(`${TEMPLATE_BASE}/top-5-list-background.png`)}
        style={{
          position: "absolute",
          top: LIST_BG_Y,
          left: 0,
          width: REEL_W,
          height: LIST_BG_H,
        }}
      />

      {/* Title background */}
      <Img
        src={staticFile(`${TEMPLATE_BASE}/title-background.png`)}
        style={{
          position: "absolute",
          top: TITLE_Y,
          left: 0,
          width: REEL_W,
          height: TITLE_H,
        }}
      />

      {/* Title text */}
      <AutoShrinkTitle text={title} />

      {/* Entry overlays */}
      {rankings.map((r, i) => {
        let state: EntryState;
        if (i < activeIndex) {
          state = "active";
        } else if (i === activeIndex) {
          state = "highlighted";
        } else {
          state = "empty";
        }

        return (
          <EntryOverlay key={r.rank} ranking={r} index={i} state={state} />
        );
      })}
    </AbsoluteFill>
  );
};
