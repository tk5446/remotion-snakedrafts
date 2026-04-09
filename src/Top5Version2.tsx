import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  OffthreadVideo,
  useCurrentFrame,
  spring,
  delayRender,
  continueRender,
} from "remotion";

import {
  FPS,
  REEL_W,
  useFont,
  safeStaticFile,
  isVideoFile,
  type MovieEntry,
} from "./lib/reels";

import jsonData from "../public/data/top5.json";
import { ClipCaptions } from "./components/ClipCaptions";
import type { Caption } from "@remotion/captions";

// ---------------------------------------------------------------------------
// Layout constants (pixels, 1080 x 1920)
// ---------------------------------------------------------------------------

// Vertical layout — keeps content inside the platform safe zone:
//   ~160px top margin  (Instagram/TikTok top chrome)
//   ~290px bottom margin (action buttons, comment bar)
const TITLE_Y = 80;
const TITLE_H = 190;
const VIDEO_Y = TITLE_Y + TITLE_H;   // 350
const VIDEO_H = 1040;                 // 270 – 1310  (~54% of 1920)
const SLAM_Y  = VIDEO_Y + VIDEO_H;   // 1450
const SLAM_H  = 180;                  // 1450 – 1630  (290px clear at bottom)
const BADGE_Y = SLAM_Y + SLAM_H;     // below slam text

const FONT_FAMILY = "Arial";
// const FONT_URL    = staticFile("assets/fonts/Circus-Of-Innocents.ttf");

const VIDEO_BASE  = "data/clips";
const CARD_FRAMES = 1.5 * FPS; // 1.5-second outro card

const BACKGROUND_COLOR = "#121212";
const TEXT_COLOR = "#fff";

// ---------------------------------------------------------------------------
// Title header — white text on black, wraps to 2 lines
// ---------------------------------------------------------------------------

const TitleHeader: React.FC<{ text: string }> = ({ text }) => (
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
      padding: "0 70px 12px",
    }}
  >
    <div
      style={{
        color: TEXT_COLOR,
        fontFamily: FONT_FAMILY,
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 62,
        lineHeight: 1.15,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Slam text — "#X Movie Title" springs in with impact sound
// ---------------------------------------------------------------------------

const SlamText: React.FC<{ rank: number; movieTitle: string }> = ({
  rank,
  movieTitle,
}) => {
  const frame = useCurrentFrame();
  const scale =
    spring({
      frame,
      fps: FPS,
      config: { damping: 6, stiffness: 200, mass: 0.4, overshootClamping: false },
    }) * 1.1;
  const opacity = Math.min(1, frame / 3);

  return (
    <div
      style={{
        position: "absolute",
        top: SLAM_Y,
        left: 0,
        width: REEL_W,
        height: SLAM_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 70px 0",
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <Audio src={staticFile("assets/sounds/impact.mp3")} volume={0.07} />
      <div
        style={{
          color: TEXT_COLOR,
          fontFamily: FONT_FAMILY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 62,
          lineHeight: 1.15,
          textAlign: "center",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        #{rank} {movieTitle}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const Top5Version2: React.FC = () => {
  const allEntries = jsonData as MovieEntry[];
  const rankings = allEntries
    .slice()
    .sort((a, b) => b.video_rank - a.video_rank);

  console.log("[Top5Version2] allEntries count:", allEntries.length);
  console.log("[Top5Version2] rankings count:", rankings.length);
  rankings.forEach((r, i) => {
    console.log(
      `[Top5Version2] ranking[${i}]: rank=${r.rank}, movie="${r.movieTitle}", ` +
      `duration=${r.duration}, clipped_video="${r.clipped_video}"`,
    );
  });

  const actorName = allEntries[0]?.actorName ?? "";
  const actorSlug = allEntries[0]?.actorSlug ?? "";
  const title = actorName
    ? `The Best ${actorName} Movies`
    : "Top 5";

  const [transcriptIndex, setTranscriptIndex] = React.useState<Record<string, Caption[]>>({});
  React.useEffect(() => {
    if (!actorSlug) return;
    const handle = delayRender(`Loading transcripts for ${actorSlug}`);
    fetch(staticFile(`data/transcripts/${actorSlug}-transcription.json`))
      .then((res) => res.json())
      .then((data: Record<string, Caption[]>) => {
        setTranscriptIndex(data);
        continueRender(handle);
      })
      .catch(() => {
        continueRender(handle);
      });
  }, [actorSlug]);

//   useFont(FONT_FAMILY);

  // Build segment boundaries: clips only, starting at frame 0
  const segmentStarts: number[] = [];
  let cursor = 0;
  for (const r of rankings) {
    segmentStarts.push(cursor);
    cursor += (r.duration ?? 0) * FPS;
  }

  console.log("[Top5Version2] FPS:", FPS);
  console.log("[Top5Version2] segmentStarts:", JSON.stringify(segmentStarts));
  console.log("[Top5Version2] total cursor (end frame):", cursor);

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR }}>
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
          `willRender=${!!(resolved && clipDur > 0)}`,
        );

        const clipCaptions = (
          (transcriptIndex as Record<string, Caption[]>)[r.clipped_video ?? ""] ?? []
        );

        return (
          <React.Fragment key={r.rank}>
            {resolved && clipDur > 0 && (
              <Sequence from={segFrom} durationInFrames={clipDur}>
                <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR }}>

                  {/* Title — above the video */}
                  <TitleHeader text={title} />

                  {/* Video — large, fills the middle */}
                  <div
                    style={{
                      position: "absolute",
                      top: VIDEO_Y,
                      left: 0,
                      width: REEL_W,
                      height: VIDEO_H,
                      overflow: "hidden",
                      filter: (() => {
                        const b = r.brightness ?? 1.0;
                        const c = 1 + (b - 1) * 0.3;
                        return b === 1.0 ? undefined : `brightness(${b}) contrast(${c})`;
                      })(),
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

                  {/* TikTok-style captions — bottom third of video area */}
                  {clipCaptions.length > 0 && (
                    <ClipCaptions captions={clipCaptions} />
                  )}

                  {/* Rank + movie slam text — springs in at clip start */}
                  <SlamText rank={r.rank} movieTitle={r.movieTitle} />

                  {/* App store badge */}
                  <div
                    style={{
                      position: "absolute",
                      top: BADGE_Y,
                      left: 0,
                      width: REEL_W,
                      display: "flex",
                      justifyContent: "center",
                      padding: "10px 0",
                    }}
                  >
                    <Img
                      src={staticFile("assets/snakedrafts-app-store.png")}
                      style={{ width: 780, height: "auto" }}
                    />
                  </div>

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
            backgroundColor: BACKGROUND_COLOR,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 70px",
          }}
        >
          <div
            style={{
              color: TEXT_COLOR,
              fontFamily: FONT_FAMILY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 130,
              lineHeight: 1.2,
              textAlign: "center",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            Comment and let us know what we missed!
          </div>
          <Img
            src={staticFile("assets/snakedrafts-app-store.png")}
            style={{ float: "left", width: 950, height: "auto", marginTop: 40 }}
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
