import { Composition } from "remotion";
import { Top10Board } from "./Top10Board";
import data from "../public/data/top10.json";

const FPS = 30;
const SECONDS_PER_ROW = 5;

const totalRows = (data as unknown[]).length;
const durationInFrames = totalRows * SECONDS_PER_ROW * FPS;

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="Top10Board"
        component={Top10Board}
        width={1080}
        height={1350}
        fps={FPS}
        durationInFrames={durationInFrames}
        defaultProps={{
          title: "THE BEST SHOWS\nOF THE PAST 20 YEARS",
        }}
      />
    </>
  );
};
