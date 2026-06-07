/* ═══════════════════════════════════════════════════════════════
   Shared types for the MimiQ analysis pipeline
   ═══════════════════════════════════════════════════════════════ */

/** Raw metrics returned by the Python audio analysis service. */
export interface AudioMetrics {
  lufs: number;
  dynamicRange: number;
  spectralCentroid: number;
  lowEndEnergy: number;
  stereoWidth: number;
  reverbEstimate: number;
  /** Present only when a beat file was submitted alongside the vocal. */
  beatLufs?: number;
  /** The primary frequency range (kHz) where the vocal and beat collide. */
  collisionFrequency?: number;
}

/** A single step in the vocal processing chain. */
export interface ChainStep {
  step: number;
  tool: string;
  action: string;
  reason: string;
}

/** Position on the XY pad (x = dry→wet, y = dark→bright). */
export interface XYPosition {
  x: number;
  y: number;
}

/** Full structured response from Claude / the analyze route. */
export interface AnalysisResponse {
  chain: ChainStep[];
  summary: string;
  xyPosition: XYPosition;
  metrics: AudioMetrics;
}

/** Full structured response from Claude / the level-lab route. */
export interface LevelLabResponse {
  sessionScore: number;
  loudnessVerdict: string;
  dynamicsVerdict: string;
  brightnessVerdict: string;
  gainRideCallout: string;
  nextStep: string;
  processedMetrics: AudioMetrics;
}

/** Error response from the analyze route. */
export interface AnalysisError {
  error: "audio_service_unavailable" | "file_too_large" | "analysis_failed";
  message: string;
}

/** A saved chain record from the Supabase `chains` table. */
export interface SavedChain {
  id: string;
  user_id: string;
  era: string;
  daw: string;
  xy_x: number;
  xy_y: number;
  chain: ChainStep[];
  summary: string;
  measurements: AudioMetrics;
  created_at: string;
}
