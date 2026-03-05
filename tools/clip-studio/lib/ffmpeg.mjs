import { runCmd, parseTime } from "./util.mjs";

/**
 * Build a scale-to-fill + center-crop filter for the given target dimensions.
 * Works for both landscape and portrait source videos.
 */
export function buildFilter(targetW, targetH) {
  const tw = targetW;
  const th = targetH;
  const ratio = `${tw}/${th}`;
  // Scale so the smaller dimension matches, then crop the excess from center
  const scale = [
    `scale=`,
    `'if(gt(a,${ratio}),-2,${tw})':`,
    `'if(gt(a,${ratio}),${th},-2)'`,
  ].join("");
  const crop = `crop=${tw}:${th}:(in_w-${tw})/2:(in_h-${th})/2`;
  return `${scale},${crop}`;
}

/**
 * Clip (and optionally crop) a video with ffmpeg.
 *
 * @param {object} opts
 * @param {string} opts.inputAbs  - absolute path to source mp4
 * @param {string} opts.outAbs    - absolute path for output mp4
 * @param {number|string} opts.start
 * @param {number|string|null} opts.end
 * @param {number|null} opts.duration
 * @param {number} opts.targetW
 * @param {number} opts.targetH
 */
export async function clipAndCrop({
  inputAbs,
  outAbs,
  start,
  end,
  duration,
  targetW,
  targetH,
}) {
  const args = ["-y"];

  // -ss before -i for fast seek
  const startStr = parseTime(start);
  if (startStr) args.push("-ss", startStr);

  args.push("-i", inputAbs);

  // Duration takes priority over end
  if (duration != null) {
    args.push("-t", String(Number(duration)));
  } else if (end != null) {
    const startNum = Number(start);
    const endNum = Number(end);
    if (Number.isFinite(startNum) && Number.isFinite(endNum)) {
      args.push("-t", String(endNum - startNum));
    } else {
      args.push("-to", parseTime(end));
    }
  }

  // Only apply scale+crop filter if dimensions were provided
  if (targetW && targetH) {
    const vf = buildFilter(targetW, targetH);
    args.push("-vf", vf);
  }

  // Encoding
  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    outAbs,
  );

  await runCmd("ffmpeg", args);
}
