/* ═══════════════════════════════════════════════════════════════
   Shared types for the mimiq analysis pipeline
   ═══════════════════════════════════════════════════════════════ */

/** Raw metrics returned by the Python audio analysis service. */
export interface AudioMetrics {
  lufs: number;
  dynamicRange: number;
  spectralCentroid: number;
  truePeak?: number;
  sibilanceEnergy?: number;
  harshness?: number;
  lowMidBuildup?: number;
  noiseFloorDb?: number;
  truePeakEstimateDb?: number;
  crestFactorDb?: number;
  reverbDecay?: number;
  sibilancePeak?: number;
  pitchVariance?: number;
  breathNoise?: number;
  dynamicInconsistency?: number;
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
  bus?:
    | "main"
    | "reverb_bus"
    | "delay_bus"
    | "parallel_comp_bus"
    | "width_bus"
    | "saturation_bus"
    | "distortion_bus"
    | "mastering_bus";
  role?: string;
  sendPoint?: "after-compressor-primary" | "post-chain" | "return";
  note?: string;
  enabled?: boolean;
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
  engineer_note?: string;
  xyPosition: XYPosition;
  metrics: AudioMetrics;
  analysis_version: "1.0";
  fallback_used: boolean;
  audio_service_status: AudioServiceStatus;
}

export type AudioServiceStatus = "ok" | "fallback" | "error" | "unknown";

export type AudioAssetKind =
  | "full_song"
  | "vocal"
  | "beat"
  | "stem"
  | "reference"
  | "processed";

export type AudioAssetStatus = "local" | "uploading" | "ready" | "failed";

export interface ProjectAudioAsset {
  id: string;
  kind: AudioAssetKind;
  filename: string;
  mimeType: string;
  size: number;
  duration: number | null;
  storagePath: string | null;
  createdAt: string;
  status: AudioAssetStatus;
  error?: string | null;
}

/** Full structured response from Claude / the level-lab route. */
export interface LevelLabResponse {
  sessionScore: number;
  loudnessVerdict: string;
  dynamicsVerdict: string;
  brightnessVerdict: string;
  gainRideCallout: string;
  nextStep: string;
  deltaSummary?: string;
  rawMetrics?: LevelMetrics;
  processedMetrics: LevelMetrics;
  delta: LevelLabDelta;
  rawAssetId?: string | null;
  processedAssetId?: string | null;
  audio_service_status?: AudioServiceStatus;
  fallback_used?: boolean;
  fallback_reason?: string | null;
}

export interface LevelMetrics {
  lufs: number;
  dynamicRange: number;
  truePeak: number;
  gainRide: number[];
  spectralCentroid?: number;
}

export interface LevelLabDelta {
  verdict: "improved" | "regressed" | "unknown";
  lufs_delta: number;
  dynamic_range_delta: number;
  brightness_delta?: number;
}

/** Error response from the analyze route. */
export interface AnalysisError {
  error: "audio_service_unavailable" | "file_too_large" | "analysis_failed";
  message: string;
}

export type EvaluationSeverity = "critical" | "warning" | "suggestion";

export interface EvaluationIssue {
  severity: EvaluationSeverity;
  plugin: string;
  problem: string;
  fix: string;
  why: string;
}

export interface EvaluationResult {
  overall: string;
  issues: EvaluationIssue[];
  strengths: string[];
  measured_fit: "good" | "needs_work" | "unknown";
  flags: string[];
  explanation: string;
  checked?: string[];
  unknowns?: string[];
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

export interface VocalVersion {
  id: string;
  filename: string;
  url: string;
  uploaded_at: string;
  label: string;
}

export interface GeneratedChain {
  id: string;
  chain_data: {
    chain: ChainStep[];
    summary: string;
    engineer_note?: string;
    measurements?: AudioMetrics;
    xyPosition?: XYPosition;
    analysis_version?: "1.0";
    sourceAssetId?: string | null;
    beatAssetId?: string | null;
    analysisInputKind?: "vocal" | "full_song" | "fallback";
    fallback_used?: boolean;
    audio_service_status?: AudioServiceStatus;
    measured_fit?: EvaluationResult["measured_fit"];
    validation_timestamp?: string;
    iteration_count?: number;
    evaluation_summary?: string;
  };
  genre: string;
  daw: string;
  created_at: string;
  sandbox_settings: {
    era: string;
    mic?: string | null;
    plugins?: string[];
    xyPosition?: XYPosition;
  };
}

export interface ChainModifier {
  type: "eq_cut";
  frequency: number;
  gain: number;
  q?: number;
  source: "mix_room";
}

export type ProjectChainEntry = GeneratedChain | ChainModifier;

export interface SpectralData {
  frequencies: number[];
  magnitudes: number[];
}

export interface CollisionZone {
  startFreq: number;
  endFreq: number;
  centerFreq: number;
  severity: number;
  peakVocalDb: number;
  peakBeatDb: number;
}

export interface PocketZone {
  startFreq: number;
  endFreq: number;
  centerFreq: number;
  strength: number;
  vocalDb: number;
  beatDb: number;
}

export interface MixRoomEQCut {
  id: string;
  frequency: number;
  gain: number;
  q: number;
  source: "mix_room";
  created_at: string;
}

export interface MixRoomReport {
  version?: 1;
  analysis_version?: "browser_fft_v1" | "mix_room_v1";
  analyzed_at?: string;
  vocal_version_id?: string | null;
  beat_file_url?: string | null;
  vocal_asset_id?: string | null;
  beat_asset_id?: string | null;
  full_song_asset_id?: string | null;
  vocal_source?: string | null;
  beat_source?: string | null;
  genre?: string;
  daw?: string;
  matchScore?: number;
  summary?: string;
  explanation?: string | null;
  collisions?: CollisionZone[];
  pockets?: PocketZone[];
  eq_cuts?: MixRoomEQCut[];
  audio_service_status?: AudioServiceStatus;
  fallback_used?: boolean;
  fallback_reason?: string | null;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  audio_assets: ProjectAudioAsset[];
  beat_file_url: string | null;
  beat_filename: string | null;
  vocal_versions: VocalVersion[];
  current_vocal_index: number;
  generated_chains: ProjectChainEntry[];
  mix_room_report: MixRoomReport | null;
  level_lab_report: LevelLabResponse | null;
  stem_split_url: string | null;
  last_opened_at: string;
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "updated_at"
    | "audio_assets"
    | "beat_file_url"
    | "beat_filename"
    | "vocal_versions"
    | "current_vocal_index"
    | "generated_chains"
    | "mix_room_report"
    | "level_lab_report"
    | "stem_split_url"
    | "last_opened_at"
  >
>;

export type StemSplitMode = 2 | 4 | 6;
export type StemSplitStatus = "idle" | "uploading" | "queued" | "processing" | "complete" | "failed";
export type StemSplitLaneName =
  | "vocals"
  | "drums"
  | "bass"
  | "other"
  | "guitar"
  | "piano";

export interface StemSplitFileMeta {
  filename: string;
  duration_s: number;
  sample_rate: number;
  bit_depth: number | null;
  channels?: number;
}

export interface StemSplitLane {
  name: StemSplitLaneName;
  filename: string;
  url: string;
  fileMeta?: StemSplitFileMeta | null;
}

export interface StemSplitFallback {
  requested_mode: StemSplitMode;
  requested_model: string;
  requested_stems: StemSplitLaneName[];
  delivered_mode: StemSplitMode;
  delivered_stems: StemSplitLaneName[];
  available_stems: StemSplitLaneName[];
  reason: string;
}

export interface StemSplitSourceMeta {
  duration: number;
  sample_rate: number;
  channels: number;
  bpm: number | null;
  bit_depth: number | null;
}

export interface StemSplitJobResponse {
  job_id: string;
  status: Exclude<StemSplitStatus, "idle" | "uploading">;
  progress: number;
  stage: string;
  requested_mode: StemSplitMode;
  requested_model: string;
  created_at: string;
  updated_at: string;
  source_filename: string;
  source?: StemSplitSourceMeta;
  message?: string;
  error?: string;
  stems?: Record<string, StemSplitLane>;
  fallback?: StemSplitFallback | null;
  estimated_remaining_seconds: number | null;
}

export interface StemSplitInsightClaims {
  measured: string[];
  inferred: string[];
  estimated: string[];
  unknown: string[];
}

export type StemSplitInsightStatus = "idle" | "loading" | "ready" | "error";

export interface StemSplitInsightResponse {
  status: StemSplitInsightStatus;
  summary: string;
  claims: StemSplitInsightClaims;
}
