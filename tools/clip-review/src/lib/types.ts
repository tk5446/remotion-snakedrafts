export interface Actor {
  slug: string;
  name: string;
  movieCount: number;
  doneCount: number;
  clipsJsonPath: string;
}

export type ClipStatus =
  | "pending"
  | "success"
  | "exists"
  | "download_failed"
  | "ffmpeg_failed"
  | string;

export interface Candidate {
  yt_url: string;
  yt_video_id: string;
  yt_title: string;
  yt_duration_seconds: number;
  score: number;
  adjusted_score: number;
  start_seconds: number;
  start_time: string;
  duration: number;
  matched_quote: string;
  matched_text: string;
  clip_status?: ClipStatus;
  /** Present after yt-dlp + ffmpeg in pipeline or Clip Review download */
  clip_filename?: string;
  match_method?: string;
  // Per-clip user edits
  trim_in?: number;
  trim_out?: number;
  brightness?: number;
  volume?: number;
}

export interface Movie {
  rank: number;
  movie_title: string;
  year: number;
  character: string;
  quotes: string[];
  candidates?: Candidate[];
  // Selection state (set by user)
  selected_candidate_index?: number;
  clipped_video?: string;
}

export interface ClipsData {
  actor_slug: string;
  actor_name: string;
  movies: Movie[];
}
