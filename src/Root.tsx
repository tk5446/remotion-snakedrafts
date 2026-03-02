import { Composition } from "remotion";
import { RankedVideo } from "./RankedVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="RankedVideo"
      component={RankedVideo}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};