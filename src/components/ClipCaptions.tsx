import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokToken,
} from "@remotion/captions";
import { REEL_W } from "../lib/reels";

// Vertical position within the video footage area (VIDEO_Y=350, VIDEO_Y+VIDEO_H=1390).
// Sitting at y=1180 gives roughly the bottom quarter of the clip — readable but
// not clashing with SlamText which starts at y=1450.
const CAPTION_Y = 1140;
const CAPTION_H = 210;

const ACTIVE_COLOR = "#FFE135";  // TikTok-yellow for the word being spoken
const INACTIVE_COLOR = "#FFFFFF";
const FONT_SIZE = 48;
const TEXT_SHADOW =
  "0 2px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,1), 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000";

type Props = {
  captions: Caption[];
};

export const ClipCaptions: React.FC<Props> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const { pages } = React.useMemo(() => {
    // createTikTokStyleCaptions splits pages when text.startsWith(' ') AND the
    // accumulated duration exceeds combineTokensWithinMilliseconds. Whisper API
    // returns each word without a leading space, so we prepend one to every word
    // after the first so the splitter can do its job.
    const normalized: Caption[] = captions.map((c, i) => ({
      ...c,
      text: i === 0 ? c.text : ` ${c.text}`,
    }));

    return createTikTokStyleCaptions({
      captions: normalized,
      combineTokensWithinMilliseconds: 800,
    });
  }, [captions]);

  if (pages.length === 0) return null;

  const activePage = pages.find(
    (p) => ms >= p.startMs && ms < p.startMs + p.durationMs,
  );

  if (!activePage) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: CAPTION_Y,
        left: 0,
        width: REEL_W,
        height: CAPTION_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 60px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          gap: "0 10px",
          lineHeight: 1.2,
        }}
      >
        {activePage.tokens.map((token: TikTokToken, i: number) => {
          const isActive = ms >= token.fromMs && ms < token.toMs;
          return (
            <span
              key={i}
              style={{
                fontFamily: "Arial, sans-serif",
                fontWeight: 700,
                fontSize: FONT_SIZE,
                letterSpacing: "0.01em",
                // textTransform: "uppercase",
                color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR,
                textShadow: TEXT_SHADOW,
                transition: "color 0.05s",
              }}
            >
              {token.text.trim()}
            </span>
          );
        })}
      </div>
    </div>
  );
};
