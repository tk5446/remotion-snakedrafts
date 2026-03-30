import { Composition } from "remotion";
import { Top10Board } from "./Top10Board";
import { Top5Reel } from "./Top5Reel";
import { getTotalDurationFrames, FPS, type MovieEntry } from "./lib/reels";

import top5Json from "../public/data/top5.json";

const SECONDS_PER_ROW = 3;
const TOTAL_ROWS = 10;
const top10Duration = TOTAL_ROWS * SECONDS_PER_ROW * FPS;

const CARD_FRAMES = 1.5 * FPS;
const HOOK_FRAMES = 90;
const top5Entries = (top5Json as MovieEntry[]).filter((e) => e.rank <= 5);
const OUTRO_FRAMES = CARD_FRAMES;
const top5Duration = getTotalDurationFrames(top5Entries, FPS) + CARD_FRAMES * top5Entries.length + HOOK_FRAMES + OUTRO_FRAMES;

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
