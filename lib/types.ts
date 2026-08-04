import type { GenreCategoryId, GenreSubgenreId } from "@/lib/genreCatalog";

export type SupportedDaw =
  | "Logic Pro"
  | "FL Studio"
  | "Ableton Live"
  | "Pro Tools";

export type PluginBundleId =
  | "waves_gold"
  | "waves_ultimate"
  | "fabfilter"
  | "soundtoys"
  | "antares_auto_tune";

export interface UserProfile {
  id: string;
  daw: SupportedDaw | null;
  genres: string[];
  plugins: PluginBundleId[];
  created_at: string;
  onboarding_completed_at: string | null;
}

/*
   Shared types for the mimiq analysis pipeline
 */

/** Raw metrics returned by the Python audio analysis service. */
export interface AudioMetrics {
  lufs: number;
  dynamicRange: number;
  spectralCentroid: number;
  truePeak: number;
  harshness: number;
  lowMidBuildup: number;
  noiseFloorDb: number;
  sibilancePeak: number;
  dynamicInconsistency: number;
  stereoWidth?: number;
  crestFactor: number;
  spectralEnvelope: number[];
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
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

/** Position on the XY pad (x = dry->wet, y = dark->bright). */
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

export type ProcessedVocalStage = "main_chain" | "buses" | "match_beat";

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
  processingStage?: ProcessedVocalStage | null;
  sourceAssetId?: string | null;
  alignedBeatAssetId?: string | null;
  timelineStartSeconds?: number | null;
}

export type WorkflowStage =
  | "setup"
  | "prepare"
  | "main_chain"
  | "buses"
  | "match_beat";
export type WorkflowStageState =
  | "preview"
  | "ready"
  | "in_progress"
  | "complete"
  | "needs_attention"
  | "outdated";

export interface WorkflowStageStatus {
  stage: WorkflowStage;
  state: WorkflowStageState;
  label: string;
  reason: string;
  blocked: boolean;
}

export interface ProjectTargetProfile {
  upfront: number;
  bright: number;
  atmospheric: number;
  dynamic: number;
  obviousTuning: number;
  wideSupport: number;
  directionNote?: string | null;
  updatedAt: string;
}

export type EvidenceSource =
  | "measured"
  | "estimated"
  | "inferred_from_project"
  | "user_provided"
  | "unknown";

export interface EvidenceReference {
  measurementKey: string;
  source: EvidenceSource;
  analysisVersion: string;
  inputAssetIds: string[];
  startSeconds?: number | null;
  endSeconds?: number | null;
  frequencyLowHz?: number | null;
  frequencyHighHz?: number | null;
}

export type DiagnosisFindingKind =
  | "collision"
  | "loudness"
  | "true_peak"
  | "dynamics"
  | "level_inconsistency"
  | "presence"
  | "harshness"
  | "low_mid"
  | "sibilance"
  | "pitch";

export type FindingSeverity = "high" | "medium" | "low" | "info";

export interface DiagnosisFinding {
  id: string;
  kind: DiagnosisFindingKind;
  title: string;
  severity: FindingSeverity;
  impactRank: number;
  evidence: EvidenceReference;
  vocalEnergyDb?: number | null;
  beatEnergyDb?: number | null;
  maskingDeltaDb?: number | null;
  value?: number | null;
  unit?: string | null;
  whyItMatters: string;
  suggestedCapability: PluginCapability | null;
  limitations: string[];
}

export interface AnalysisProvenanceRecord {
  source: "fastapi" | "saved_project_data" | "browser_fallback" | "unknown";
  status: AudioServiceStatus;
  algorithmVersion: string;
  createdAt: string;
  skippedMeasurements: string[];
  contextFingerprint?: string;
  verificationStage?: ProcessedVocalStage | null;
}

export interface AnalysisRun {
  id: string;
  project_id: string;
  run_type: "diagnosis" | "verification";
  input_asset_ids: string[];
  analysis_version: string;
  measurements: Record<string, unknown>;
  findings: DiagnosisFinding[];
  provenance: AnalysisProvenanceRecord;
  limitations: string[];
  fallback_used: boolean;
  fallback_reason: string | null;
  created_at: string;
}

export type PluginCapability =
  | "equalizer"
  | "compressor"
  | "de_esser"
  | "pitch"
  | "reverb"
  | "delay";

export interface PluginCatalogEntry {
  id: string;
  name: string;
  manufacturer: string;
  daw: SupportedDaw | null;
  bundle_id: PluginBundleId | null;
  capability: PluginCapability;
  parameter_schema: Record<string, unknown>;
  verified_ranges: Record<string, unknown>;
  stock: boolean;
  coverage_status: "draft" | "certified" | "unsupported";
  catalogue_version: string;
  verified_at: string | null;
  source_note: string;
}

export interface PluginInstruction {
  id: string;
  order: number;
  findingId: string;
  capability: PluginCapability;
  pluginCatalogId: string | null;
  pluginName: string | null;
  manufacturer: string | null;
  parameters: Record<string, number | string>;
  action: string;
  why: string;
  evidence: EvidenceReference;
  certified: boolean;
  unsupportedReason: string | null;
}

export interface MixPlan {
  id: string;
  project_id: string;
  analysis_run_id: string;
  target_profile: ProjectTargetProfile;
  plugin_catalogue_version: string;
  instructions: PluginInstruction[];
  completion_state: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface VerificationDelta {
  measurementKey: string;
  rawValue: number | null;
  processedValue: number | null;
  delta: number | null;
  verdict: "improved" | "regressed" | "unchanged" | "unknown";
  evidence: EvidenceReference;
}

export interface VerificationReport {
  run: AnalysisRun;
  mixPlanId: string;
  deltas: VerificationDelta[];
  improvements: string[];
  regressions: string[];
  unresolved: string[];
  translationRisks: Array<{
    label: string;
    source: "estimated";
    reason: string;
    limitation: string;
  }>;
}

export interface VocalCheckMeasurements {
  detectedKey: string;
  bpm: number;
  inKeyVoicedFrameRatio: number | null;
  medianPitchDeviationCents: number | null;
  voicedFrameCount: number;
  pitchDriftMap: Array<[number, number]>;
  recommendedScale: string;
  retuneSpeed: string;
  humanize: number;
  tuneMode: string;
  tuneReason: string;
  chordProgression: string;
  summary: string;
  analysisVersion: string;
}

export type ProjectAnalysisInputMode = "separate" | "stem_split";

export type RecordingEvidenceKind =
  | "presence_spike"
  | "low_mid_buildup"
  | "sibilance_spike"
  | "level_inconsistency";

export interface RecordingEvidence {
  kind: RecordingEvidenceKind;
  startSeconds: number;
  endSeconds: number;
  deltaDb: number;
  baselineDb: number;
  measuredDb: number;
  frequencyLowHz: number | null;
  frequencyHighHz: number | null;
  analysisVersion: string;
}

export interface ProjectAnalysisResponse {
  measurements: Record<string, unknown>;
  findings: DiagnosisFinding[];
  recordingEvidence: RecordingEvidence[];
  vocalCheck: VocalCheckMeasurements | null;
  inputMode: ProjectAnalysisInputMode;
  provenance: AnalysisProvenanceRecord;
  limitations: string[];
  fallback_used: boolean;
  fallback_reason: string | null;
}

export type ProjectAnalysisErrorCode =
  | "audio_service_unavailable"
  | "stem_split_failed"
  | "measurement_failed"
  | "save_failed"
  | "invalid_request";

export type AnalysisProgressPhase =
  | "idle"
  | "preparing"
  | "separating"
  | "analyzing"
  | "saving"
  | "complete"
  | "failed";

export interface AnalysisProgressState {
  phase: AnalysisProgressPhase;
  label: string;
  progress: number | null;
  message: string | null;
  errorCode: ProjectAnalysisErrorCode | null;
  retryable: boolean;
}

export type ProjectAnalysisFlowResponse =
  | {
      status: "processing";
      inputMode: "stem_split";
      jobId: string;
      jobToken: string;
      progress: number;
      stage: string;
      message: string;
      estimatedRemainingSeconds: number | null;
    }
  | {
      status: "complete";
      inputMode: ProjectAnalysisInputMode;
      result: ProjectAnalysisResponse;
    }
  | {
      status: "error";
      inputMode: ProjectAnalysisInputMode | null;
      code: ProjectAnalysisErrorCode;
      stage: Exclude<AnalysisProgressPhase, "idle" | "complete">;
      message: string;
      retryable: boolean;
      limitations: string[];
      skippedMeasurements: string[];
    };

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

export type VocalRoleId =
  | "lead"
  | "tight_double"
  | "wide_double"
  | "harmonies"
  | "adlibs"
  | "backing_bus"
  | "vocal_bus";

export type VocalRoleEvidenceSource =
  | "measured_role"
  | "lead_derived"
  | "saved_project_data"
  | "unknown";

export interface ProjectVocalRole {
  id: VocalRoleId;
  status: "created" | "uncreated";
  chain_id: string | null;
  source_asset_id: string | null;
  evidence_source: VocalRoleEvidenceSource;
  created_at: string | null;
  updated_at: string | null;
  derived_from_chain_id?: string | null;
}

export interface ProjectVocalArchitecture {
  version: 1;
  active_role_id: VocalRoleId;
  roles: Record<VocalRoleId, ProjectVocalRole>;
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
    vocal_role_id?: VocalRoleId;
    role_source?: VocalRoleEvidenceSource;
    derived_from_chain_id?: string | null;
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
  genre_category?: GenreCategoryId | null;
  genre_subgenre?: GenreSubgenreId | null;
  created_at: string;
  updated_at: string;
  audio_assets: ProjectAudioAsset[];
  beat_file_url: string | null;
  beat_filename: string | null;
  vocal_versions: VocalVersion[];
  current_vocal_index: number;
  generated_chains: ProjectChainEntry[];
  vocal_architecture?: ProjectVocalArchitecture | null;
  mix_room_report: MixRoomReport | null;
  level_lab_report: LevelLabResponse | null;
  stem_split_url: string | null;
  last_opened_at: string;
  target_profile?: ProjectTargetProfile | Record<string, never>;
  active_analysis_run_id?: string | null;
  active_mix_plan_id?: string | null;
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "genre_category"
    | "genre_subgenre"
    | "updated_at"
    | "audio_assets"
    | "beat_file_url"
    | "beat_filename"
    | "vocal_versions"
    | "current_vocal_index"
    | "generated_chains"
    | "vocal_architecture"
    | "mix_room_report"
    | "level_lab_report"
    | "stem_split_url"
    | "last_opened_at"
    | "target_profile"
    | "active_analysis_run_id"
    | "active_mix_plan_id"
  >
>;

export type StemSplitMode = 2 | 4 | 6;
export type StemSplitStatus = "idle" | "uploading" | "queued" | "processing" | "complete" | "failed";
export type StemSplitLaneName =
  | "vocals"
  | "instrumental"
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
  job_token?: string;
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
