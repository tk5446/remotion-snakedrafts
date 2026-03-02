import { Composition } from "remotion";
import { Top10Board } from "./Top10Board";

const FPS = 30;
const SECONDS_PER_ROW = 5;

const top10Props = {
  bg: "/assets/got.png",
  title: "THE BEST SHOWS\nOF THE PAST 20 YEARS",
  left: [
    { rank: 10, label: "Entourage" },
    { rank: 9, label: "The Mandalorian" },
    { rank: 8, label: "The Last of Us" },
    { rank: 7, label: "True Detective" },
    { rank: 6, label: "Succession" },
  ],
  right: [
    { rank: 5, label: "The Sopranos" },
    { rank: 4, label: "The Wire" },
    { rank: 3, label: "Mad Men" },
    { rank: 2, label: "Breaking Bad" },
    { rank: 1, label: "Game of Thrones" },
  ],
};

const totalRows = top10Props.left.length + top10Props.right.length;
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
        defaultProps={top10Props}
      />
    </>
  );
};