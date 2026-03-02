import { AbsoluteFill, Sequence, OffthreadVideo, useCurrentFrame } from "remotion";

const FPS = 30;
const SEG = 5 * FPS;

const data = [
  {
    video: "https://www.w3schools.com/html/mov_bbb.mp4",
    rows: ["DodgeBall", "The 40-Year-Old Virgin", "?", "?", "?"],
    active: 0,
  },
  {
    video: "https://www.w3schools.com/html/mov_bbb.mp4",
    rows: ["DodgeBall", "The 40-Year-Old Virgin", "Superbad", "?", "?"],
    active: 1,
  },
];

const Slide = ({ video, rows, active }: any) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      {/* Top video */}
      <OffthreadVideo
        src={video}
        style={{ width: "100%", height: "60%", objectFit: "cover" }}
        muted
      />

      {/* Bottom rows */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          width: "100%",
          height: "40%",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {rows.map((text: string, i: number) => {
          const isActive = i === active;

          return (
            <div
              key={i}
              style={{
                flex: 1,
                background: isActive ? "#e11d48" : "#1e293b",
                color: "white",
                display: "flex",
                alignItems: "center",
                paddingLeft: 20,
                fontSize: 40,
                borderRadius: 12,
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const RankedVideo = () => {
  return (
    <>
      {data.map((d, i) => (
        <Sequence key={i} from={i * SEG} durationInFrames={SEG}>
          <Slide {...d} />
        </Sequence>
      ))}
    </>
  );
};