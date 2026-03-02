import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  staticFile,
  OffthreadVideo,
} from "remotion";

import data from "../public/data/top10.json";

type Row = {
  rank: number;
  label: string;
  // New key:
  media?: string;
  // Backward-compat with your earlier JSON:
  image?: string;
};

const FPS = 30;
const FRAMES_PER_ROW = 5 * FPS; // 150 frames

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
  // Prevent accidental leading slash issues like "/assets/x.png"
  const cleaned = p.startsWith("/") ? p.slice(1) : p;
  return staticFile(cleaned);
};

const Media = ({
  src,
  style,
}: {
  src: string | undefined;
  style: React.CSSProperties;
}) => {
  const resolved = safeStaticFile(src);

  if (!resolved) {
    return (
      <AbsoluteFill
        style={{
          ...style,
          backgroundColor: "black",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 700,
          padding: 24,
          textAlign: "center",
        }}
      >
        Missing media path (src is undefined). Check JSON keys: use "media" (or
        legacy "image").
      </AbsoluteFill>
    );
  }

  if (src && isVideoFile(src)) {
    return <OffthreadVideo src={resolved} muted style={style} />;
  }

  return <Img src={resolved} style={style} />;
};

export const Top10Board = ({
  // Accept BOTH names so Root.tsx prop mismatch can’t crash you
  bg,
  fallbackBg,
  title,
}: {
  bg?: string; // legacy prop
  fallbackBg?: string; // new prop
  title: string;
}) => {
  const frame = useCurrentFrame();

  const rows: Row[] = (data as Row[]) ?? [];

  const activeIndex = Math.floor(frame / FRAMES_PER_ROW);
  const activeRow = rows[activeIndex];

  const left = rows.slice(0, 5);
  const right = rows.slice(5, 10);

  // Use media first, then image (legacy), then bg/fallbackBg
  const chosen =
    activeRow?.media ??
    activeRow?.image ??
    fallbackBg ??
    bg ??
    "assets/got.png"; // last-ditch default so you see *something*

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Dynamic Background (image OR video) */}
      <Media
        src={chosen}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Bottom board */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 420,
          padding: 24,
          background:
            "linear-gradient(90deg, rgba(168,85,247,0.95), rgba(147,51,234,0.95))",
        }}
      >
        {/* Title */}
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: "rgba(0,0,0,0.55)",
            color: "white",
            fontWeight: 800,
            fontSize: 42,
            lineHeight: 1.1,
            textAlign: "center",
            whiteSpace: "pre-line",
            borderRadius: 8,
          }}
        >
          {title}
        </div>

        {/* Columns */}
        <div style={{ display: "flex", gap: 18 }}>
          <Column frame={frame} rows={left} offset={0} />
          <Column frame={frame} rows={right} offset={5} />
        </div>

        {/* CTA */}
        <div
          style={{
            textAlign: "center",
            marginTop: 14,
            color: "white",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          Draft this on the SnakeDrafts app!
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Column = ({
  frame,
  rows,
  offset,
}: {
  frame: number;
  rows: Row[];
  offset: number;
}) => {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {rows.map((r, i) => {
        const globalIndex = offset + i;

        const START = globalIndex * FRAMES_PER_ROW;
        const DURATION = 20;

        const isRevealed = frame >= START && !!r.label;

        const appear = interpolate(frame, [START, START + DURATION], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={r.rank}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "stretch",
            }}
          >
            {/* Rank */}
            <div
              style={{
                width: 60,
                borderRadius: 8,
                background: "rgba(255,255,255,0.2)",
                border: "2px solid rgba(255,255,255,0.7)",
                color: "white",
                fontWeight: 900,
                fontSize: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {r.rank}
            </div>

            {/* Label */}
            <div
              style={{
                flex: 1,
                borderRadius: 8,
                border: "2px solid rgba(255,255,255,0.7)",
                background: isRevealed
                  ? "rgba(236,72,153,0.95)"
                  : "rgba(255,255,255,0.08)",
                color: "white",
                fontWeight: 800,
                fontSize: 24,
                display: "flex",
                alignItems: "center",
                paddingLeft: 12,
                opacity: isRevealed ? appear : 1,
                transform: isRevealed
                  ? `scale(${0.95 + 0.05 * appear}) translateY(${
                      (1 - appear) * 8
                    }px)`
                  : undefined,
              }}
            >
              {isRevealed ? r.label : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
};