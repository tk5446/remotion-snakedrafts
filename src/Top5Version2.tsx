import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  OffthreadVideo,
  useCurrentFrame,
  spring,
} from "remotion";

import {
  FPS,
  REEL_W,
  REEL_H,
  useFont,
  safeStaticFile,
  isVideoFile,
  type MovieEntry,
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
const VIDEO_BASE = "data/clips";
const CARD_FRAMES = 1.5 * FPS; // 1.5-second intro card before each clip

const HOOK_FRAMES = 90;        // 3s total hook at the very start
const MONTAGE_FRAMES = 45;     // Part 1: poster montage (frames 0–44)
const SLAM_FRAMES = 45;        // Part 2: title slam (frames 45–89)
const FRAMES_PER_POSTER = 4;   // 10 posters in 45 frames

// ---------------------------------------------------------------------------
// Title text with auto-shrink
// ---------------------------------------------------------------------------

const BASE_TITLE_SIZE = 120;
const MIN_TITLE_SIZE = 34;
const TITLE_PADDING = 20;
const TITLE_CHAR_WIDTH_RATIO = 0.44;

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
  entry: MovieEntry;
  index: number;
  state: EntryState;
}> = ({ entry, index, state }) => {
  const yOffset = ENTRY_Y_OFFSETS[index];
  const showLabel = state !== "empty";
  const maxTextWidth = ENTRY_W - ENTRY_TEXT_PADDING * 2;
  const fontSize = fitFontSize(entry.movieTitle, maxTextWidth, BASE_ENTRY_SIZE, MIN_ENTRY_SIZE, ENTRY_CHAR_WIDTH_RATIO);

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
          {entry.movieTitle}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Poster montage – rapidly flashes all posters in shuffled order
// ---------------------------------------------------------------------------

const shuffleArray = <T,>(arr: T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const PosterMontage: React.FC<{ entries: MovieEntry[] }> = ({ entries }) => {
  const shuffled = useMemo(() => shuffleArray(entries), [entries]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {shuffled.map((entry, i) => (
        <Sequence
          key={entry.rank}
          from={i * FRAMES_PER_POSTER}
          durationInFrames={FRAMES_PER_POSTER}
        >
          <Img
            src={staticFile(
              `data/${entry.actorSlug}/${entry.localFilename}`,
            )}
            style={{ width: REEL_W, height: REEL_H, objectFit: "cover" }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Title slam – spring-animated question text with impact sound
// ---------------------------------------------------------------------------

const TitleSlamInner: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();

  const rawSpring = spring({
    frame,
    fps: FPS,
    config: { damping: 6, stiffness: 200, mass: 0.4, overshootClamping: false },
  });

  const scale = rawSpring * 1.15;
  const opacity = Math.min(1, frame / 3);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 60px",
      }}
    >
      <Audio src={staticFile("assets/sounds/impact.mp3")} />
      <div
        style={{
          color: "white",
          fontFamily: FONT_FAMILY,
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 120,
          lineHeight: 1.2,
          textAlign: "center",
          whiteSpace: "normal",
          wordBreak: "break-word",
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Countdown card – full-screen black card shown before each clip
// ---------------------------------------------------------------------------

const CountdownCard: React.FC<{ rank: number; movieTitle: string }> = ({
  rank,
  movieTitle,
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
    }}
  >
    <div
      style={{
        color: "white",
        fontFamily: FONT_FAMILY,
        fontStyle: "italic",
        fontWeight: 700,
        fontSize: 160,
        lineHeight: 1,
        textAlign: "center",
      }}
    >
      #{rank}
    </div>
    <div
      style={{
        color: "white",
        fontFamily: FONT_FAMILY,
        fontStyle: "italic",
        fontWeight: 700,
        fontSize: 160,
        lineHeight: 1.2,
        textAlign: "center",
        padding: "0 60px",
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      {movieTitle}
    </div>
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const Top5Version2: React.FC = () => {
  const allEntries = jsonData as MovieEntry[];
  const rankings = allEntries
    .filter((e) => e.rank <= 5)
    .sort((a, b) => b.rank - a.rank);

  console.log("[Top5Version2] allEntries count:", allEntries.length);
  console.log("[Top5Version2] rankings count:", rankings.length);
  rankings.forEach((r, i) => {
    console.log(
      `[Top5Version2] ranking[${i}]: rank=${r.rank}, movie="${r.movieTitle}", ` +
      `duration=${r.duration}, clipped_video="${r.clipped_video}"`,
    );
  });

  const actorName = allEntries[0]?.actorName ?? "";
  const title = actorName
    ? `The Most Drafted ${actorName} Movies on SnakeDrafts`
    : "Top 5";

  useFont(FONT_FAMILY, FONT_URL);

  // Build segment boundaries: each entry = CARD_FRAMES + clip frames
  // offset by HOOK_FRAMES (montage + slam replaces the old intro card)
  const segmentStarts: number[] = [];
  let cursor = HOOK_FRAMES;
  for (const r of rankings) {
    segmentStarts.push(cursor);
    cursor += CARD_FRAMES + (r.duration ?? 0) * FPS;
  }

  console.log("[Top5Version2] CARD_FRAMES:", CARD_FRAMES, "FPS:", FPS);
  console.log("[Top5Version2] segmentStarts:", JSON.stringify(segmentStarts));
  console.log("[Top5Version2] total cursor (end frame):", cursor);

  // Volume ducking: 0.1 during clip segments, 0.4 everywhere else.
  // Built as a lookup instead of interpolate() to avoid non-monotonic keyframes.
  const clipRanges: [number, number][] = rankings.map((r, i) => {
    const clipStart = segmentStarts[i] + CARD_FRAMES;
    const clipEnd = clipStart + (r.duration ?? 0) * FPS;
    return [clipStart, clipEnd];
  });

  console.log("[Top5Version2] clipRanges for ducking:", JSON.stringify(clipRanges));

  const musicVolume = (f: number) => {
    for (const [start, end] of clipRanges) {
      if (f >= start && f < end) return 0.025;
    }
    return 0.4;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Background music — wall-to-wall */}
      <Audio
        src={staticFile("assets/sounds/funky1.mp3")}
        volume={musicVolume}
      />

      {/* Hook Part 1 — poster montage (frames 0–44) */}
      <Sequence from={0} durationInFrames={MONTAGE_FRAMES}>
        <PosterMontage entries={allEntries} />
      </Sequence>

      {/* Hook Part 2 — title slam with impact (frames 45–89) */}
      <Sequence from={MONTAGE_FRAMES} durationInFrames={SLAM_FRAMES}>
        <TitleSlamInner text={title} />
      </Sequence>
      {rankings.map((r, i) => {
        const segFrom = segmentStarts[i];
        const clipDur = (r.duration ?? 0) * FPS;
        const videoPath = r.clipped_video
          ? `${VIDEO_BASE}/${r.clipped_video}`
          : undefined;
        const resolved = safeStaticFile(videoPath);

        console.log(
          `[Top5Version2] RENDER rank=${r.rank}: segFrom=${segFrom}, clipDur=${clipDur}, ` +
          `videoPath="${videoPath}", resolved="${resolved}", ` +
          `isVideo=${videoPath ? isVideoFile(videoPath) : "N/A"}, ` +
          `clipSequenceFrom=${segFrom + CARD_FRAMES}, clipSequenceDur=${clipDur}, ` +
          `willRender=${!!(resolved && clipDur > 0)}`,
        );

        // Determine entry overlay states for this clip segment
        const entryOverlays = rankings.map((entry, j) => {
          let state: EntryState;
          if (j < i) {
            state = "active";
          } else if (j === i) {
            state = "highlighted";
          } else {
            state = "empty";
          }
          return { entry, j, state };
        });

        return (
          <React.Fragment key={r.rank}>
            {/* Full-screen intro card */}
            <Sequence from={segFrom} durationInFrames={CARD_FRAMES}>
              <CountdownCard rank={r.rank} movieTitle={r.movieTitle} />
            </Sequence>

            {/* Clip segment with list overlay */}
            {resolved && clipDur > 0 && (
              <Sequence from={segFrom + CARD_FRAMES} durationInFrames={clipDur}>
                <AbsoluteFill style={{ backgroundColor: "#000" }}>
                  {/* Video */}
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
                    {videoPath && isVideoFile(videoPath) ? (
                      <OffthreadVideo
                        src={resolved}
                        startFrom={0}
                        endAt={clipDur}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          console.error(`[Top5Version2] OffthreadVideo ERROR rank=${r.rank}:`, e);
                        }}
                      />
                    ) : (
                      <Img
                        src={resolved}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                  </div>

                  {/* List background */}
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
                  {entryOverlays.map(({ entry, j, state }) => (
                    <EntryOverlay key={entry.rank} entry={entry} index={j} state={state} />
                  ))}
                </AbsoluteFill>
              </Sequence>
            )}
          </React.Fragment>
        );
      })}

      {/* Outro card */}
      <Sequence from={cursor} durationInFrames={CARD_FRAMES}>
        <AbsoluteFill
          style={{
            backgroundColor: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 60px",
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily: FONT_FAMILY,
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: 100,
              lineHeight: 1.2,
              textAlign: "center",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            Do you agree? Let us know in the comments!
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
