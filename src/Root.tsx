import { Composition } from "remotion";
import { Top10Board } from "./Top10Board";
import { Top5Reel } from "./Top5Reel";
import { getTotalDurationFrames, FPS, type Top5Data } from "./lib/reels";

import top5Json from "../public/data/top5.json";

const SECONDS_PER_ROW = 3;
const TOTAL_ROWS = 10;
const top10Duration = TOTAL_ROWS * SECONDS_PER_ROW * FPS;

const top5Data = top5Json as Top5Data;
const top5Duration = getTotalDurationFrames(top5Data.rankings, FPS);

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Top10Board"
        component={Top10Board}
        width={1080}
        height={1350}
        fps={FPS}
        durationInFrames={top10Duration}
        defaultProps={{
          title: "THE BEST SHOWS\nOF THE PAST 20 YEARS",
          secondsPerRow: SECONDS_PER_ROW,
        }}
      />
      <Composition
        id="Top5Reel"
        component={Top5Reel}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={top5Duration}
      />
    </>
  );
};
