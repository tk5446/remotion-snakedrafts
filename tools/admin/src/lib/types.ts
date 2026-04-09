export interface Actor {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Movie {
  id: string;
  actor_id: string;
  rank: number;
  video_rank: number | null;
  movie_title: string;
  movie_slug: string | null;
  year: number | null;
  tmdb_id: number | null;
  tmdb_description: string | null;
  local_filename: string | null;
  actor_name: string | null;
  actor_slug: string | null;
  brightness: number;
  clipped_video: string | null;
  approved_candidate_id: string | null;
}

export interface Quote {
  id: string;
  movie_id: string;
  text: string;
  user_rank: number | null;  // null = unreviewed, 0 = dismissed, 1+ = ranked
}

export interface ClipCandidate {
  id: string;
  movie_id: string;
  yt_url: string;
  yt_video_id: string;
  yt_title: string | null;
  yt_duration_seconds: number | null;
  score: number | null;
  adjusted_score: number | null;
  start_seconds: number | null;
  start_time: string | null;
  duration: number | null;
  matched_quote: string | null;
  matched_text: string | null;
  status: "pending" | "approved" | "dismissed";
}
