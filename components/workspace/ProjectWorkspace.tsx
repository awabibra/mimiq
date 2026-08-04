"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  FolderKanban,
  History,
  GitBranch,
  LoaderCircle,
  Lock,
  Pause,
  Play,
  Repeat2,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  SplitSquareVertical,
  TimerReset,
  Unlock,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ProjectAudioUpload } from "@/components/ProjectAudioUpload";
import { Logo } from "@/components/ui/logo";
import { WorkspaceTimeline } from "@/components/workspace/WorkspaceTimeline";
import { authHeaders } from "@/lib/apiAuth";
import {
  getAssetPlaybackUrl,
  getLatestProcessedVocalAsset,
  getProcessedVocalAsset,
  getPrimaryBeatAsset,
  getPrimaryVocalAsset,
  getProjectAudioAssets,
  updateProjectAudioAsset,
} from "@/lib/projectAudio";
import {
  buildDeterministicMixPlan,
  defaultTargetProfile,
  deriveWorkflowStageStatuses,
  listCertifiedPlugins,
  listProjectAnalysisRuns,
  listProjectMixPlans,
  normalizeTargetProfile,
  saveAnalysisRun,
  saveMixPlan,
  updateMixPlanCompletion,
  workflowContextFingerprint,
  WORKFLOW_ANALYSIS_VERSION,
} from "@/lib/projectWorkflow";
import { getProjectRecord, saveProjectPatch } from "@/lib/projects";
import { useStore } from "@/lib/store";
import type {
  AnalysisRun,
  AnalysisProgressState,
  DiagnosisFinding,
  MixPlan,
  PluginInstruction,
  Project,
  ProjectAudioAsset,
  ProjectAnalysisFlowResponse,
  ProjectAnalysisResponse,
  ProjectTargetProfile,
  SupportedDaw,
  StemSplitJobResponse,
  WorkflowStage,
  WorkflowStageStatus,
} from "@/lib/types";
import { useProject } from "@/lib/useProject";
import { useWorkspaceStore } from "@/lib/useWorkspaceStore";
import styles from "./ProjectWorkspace.module.css";

const STAGE_COPY: Record<WorkflowStage, { title: string; subtitle: string }> = {
  setup: { title: "Setup", subtitle: "Inputs & direction" },
  prepare: { title: "Vocal check", subtitle: "Performance readiness" },
  main_chain: { title: "Vocal chain", subtitle: "Core vocal control" },
  buses: { title: "Buses", subtitle: "Space & parallel tone" },
  match_beat: { title: "Match to beat", subtitle: "Context & translation" },
};

const PREVIEW_TARGET = {
  ...defaultTargetProfile(),
  upfront: 0.76,
  bright: 0.55,
  atmospheric: 0.31,
  dynamic: 0.42,
};

const PREVIEW_PROJECT: Project = {
  id: "preview",
  user_id: "preview",
  name: "Late Nights_120bpm",
  genre_category: "rap" as Project["genre_category"],
  genre_subgenre: "dark_trap" as Project["genre_subgenre"],
  created_at: "2026-07-22T10:42:00.000Z",
  updated_at: "2026-07-22T10:42:00.000Z",
  audio_assets: [
    { id: "preview-vocal", kind: "vocal", filename: "Lead Vocal Dry.wav", mimeType: "audio/wav", size: 1, duration: 115, storagePath: null, createdAt: "2026-07-22T10:42:00.000Z", status: "ready", alignedBeatAssetId: "preview-beat", timelineStartSeconds: 35 },
    { id: "preview-beat", kind: "beat", filename: "Late Nights Beat.wav", mimeType: "audio/wav", size: 1, duration: 150, storagePath: null, createdAt: "2026-07-22T10:42:00.000Z", status: "ready" },
    { id: "preview-chain", kind: "processed", filename: "Lead Vocal Chain.wav", mimeType: "audio/wav", size: 1, duration: 115, storagePath: null, createdAt: "2026-07-22T10:48:00.000Z", status: "ready", processingStage: "main_chain", sourceAssetId: "preview-vocal", alignedBeatAssetId: "preview-beat", timelineStartSeconds: 35 },
  ],
  beat_file_url: null,
  beat_filename: "Late Nights Beat.wav",
  vocal_versions: [],
  current_vocal_index: 0,
  generated_chains: [],
  vocal_architecture: null,
  mix_room_report: null,
  level_lab_report: null,
  stem_split_url: null,
  last_opened_at: "2026-07-22T10:42:00.000Z",
  target_profile: PREVIEW_TARGET,
  active_analysis_run_id: "preview-run",
  active_mix_plan_id: "preview-plan",
};

const PREVIEW_FINDINGS: DiagnosisFinding[] = [
  {
    id: "collision-1",
    kind: "collision",
    title: "Vocal clashes with beat",
    severity: "high",
    impactRank: 1,
    evidence: { measurementKey: "frequency_collisions.0", source: "measured", analysisVersion: "temporal_masking_v2", inputAssetIds: ["preview-vocal", "preview-beat"], startSeconds: 45, endSeconds: 70, frequencyLowHz: 2100, frequencyHighHz: 2600 },
    vocalEnergyDb: -18.7,
    beatEnergyDb: -10.9,
    maskingDeltaDb: 7.8,
    whyItMatters: "The beat is measurably louder in the vocal presence band during this range, reducing consonant clarity.",
    suggestedCapability: "equalizer",
    limitations: ["Mic movement and room reflections above 8 kHz were not isolated."],
  },
  {
    id: "collision-2",
    kind: "harshness",
    title: "Harshness peak",
    severity: "medium",
    impactRank: 2,
    evidence: { measurementKey: "frequency_collisions.1", source: "measured", analysisVersion: "temporal_masking_v2", inputAssetIds: ["preview-vocal", "preview-beat"], startSeconds: 78, endSeconds: 91, frequencyLowHz: 5500, frequencyHighHz: 6800 },
    maskingDeltaDb: 4.2,
    whyItMatters: "Short presence spikes may become tiring after compression.",
    suggestedCapability: "equalizer",
    limitations: [],
  },
  {
    id: "collision-3",
    kind: "low_mid",
    title: "Low-mid mud",
    severity: "medium",
    impactRank: 3,
    evidence: { measurementKey: "frequency_collisions.2", source: "measured", analysisVersion: "temporal_masking_v2", inputAssetIds: ["preview-vocal", "preview-beat"], startSeconds: 96, endSeconds: 110, frequencyLowHz: 180, frequencyHighHz: 250 },
    maskingDeltaDb: 2.6,
    whyItMatters: "Sustained overlap in the body range can make the vocal feel clouded.",
    suggestedCapability: "equalizer",
    limitations: [],
  },
  {
    id: "pitch-alignment",
    kind: "pitch",
    title: "Pitch alignment",
    severity: "info",
    impactRank: 4,
    evidence: { measurementKey: "vocal_check.in_key_voiced_frame_ratio", source: "measured", analysisVersion: "vocal_check_v3", inputAssetIds: ["preview-vocal"] },
    value: 0.82,
    unit: "ratio",
    whyItMatters: "82% of reliably voiced frames are nearest to notes in the detected F# minor scale.",
    suggestedCapability: null,
    limitations: ["Key detection can be ambiguous for an unaccompanied vocal."],
  },
];

const PREVIEW_RUN: AnalysisRun = {
  id: "preview-run",
  project_id: "preview",
  run_type: "diagnosis",
  input_asset_ids: ["preview-vocal", "preview-beat"],
  analysis_version: WORKFLOW_ANALYSIS_VERSION,
  measurements: {
    vocal: { lufs: -18.2, dynamic_range: 11.4, spectral_centroid: 2470, true_peak_db: -2.1 },
    vocalCheck: { detectedKey: "F# minor", bpm: 120, inKeyVoicedFrameRatio: 0.82, medianPitchDeviationCents: 14.2, voicedFrameCount: 2048, analysisVersion: "vocal_check_v3" },
  },
  findings: PREVIEW_FINDINGS,
  provenance: { source: "fastapi", status: "ok", algorithmVersion: WORKFLOW_ANALYSIS_VERSION, createdAt: "2026-07-22T10:42:00.000Z", skippedMeasurements: [], contextFingerprint: "preview" },
  limitations: ["Device translation is an estimated risk check, not calibrated speaker simulation."],
  fallback_used: false,
  fallback_reason: null,
  created_at: "2026-07-22T10:42:00.000Z",
};

const PREVIEW_PLAN: MixPlan = {
  id: "preview-plan",
  project_id: "preview",
  analysis_run_id: "preview-run",
  target_profile: PREVIEW_TARGET,
  plugin_catalogue_version: "stock-v1",
  instructions: PREVIEW_FINDINGS.slice(0, 3).map((finding, index) => ({
    id: `preview-action-${index}`,
    order: index + 1,
    findingId: finding.id,
    capability: "equalizer",
    pluginCatalogId: "logic-channel-eq",
    pluginName: "Channel EQ",
    manufacturer: "Apple",
    parameters: { frequency_hz: Math.round(((finding.evidence.frequencyLowHz ?? 2000) + (finding.evidence.frequencyHighHz ?? 2000)) / 2), gain_db: index === 0 ? -3 : -2, q: 1.4 },
    action: index === 0 ? "Channel EQ: 2.3 kHz, -3.0 dB, Q 1.4" : `Channel EQ: ${index === 1 ? "6.2 kHz" : "215 Hz"}, -2.0 dB, Q 1.4`,
    why: finding.whyItMatters,
    evidence: finding.evidence,
    certified: true,
    unsupportedReason: null,
  })),
  completion_state: {},
  created_at: "2026-07-22T10:42:00.000Z",
  updated_at: "2026-07-22T10:42:00.000Z",
};

function formatTime(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.round(seconds % 60).toString().padStart(2, "0")}`;
}

function formatFrequency(value: number | null | undefined) {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
}

function formatUtcTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatUtcDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

function waitForPoll(signal: AbortSignal, milliseconds = 1400) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Analysis polling aborted.", "AbortError"));
    }, { once: true });
  });
}

function workflowIcon(state: WorkflowStageStatus["state"]) {
  if (state === "complete") return <Check size={11} aria-hidden="true" />;
  if (state === "outdated" || state === "needs_attention") return <AlertTriangle size={11} aria-hidden="true" />;
  return null;
}

function LoadingWorkspace() {
  return <div className={styles.loading}><LoaderCircle size={22} /> Loading project workspace</div>;
}

function Gate({ preview, children }: { preview: boolean; children: ReactNode }) {
  return preview ? children : <AuthGate>{children}</AuthGate>;
}

export function ProjectWorkspace({
  projectId,
  initialStage,
  preview,
  openHistory,
}: {
  projectId: string;
  initialStage: WorkflowStage;
  preview: boolean;
  openHistory: boolean;
}) {
  return (
    <Gate preview={preview}>
      <WorkspaceInner projectId={projectId} initialStage={initialStage} preview={preview} openHistory={openHistory} />
    </Gate>
  );
}

function WorkspaceInner({ projectId, initialStage, preview, openHistory }: { projectId: string; initialStage: WorkflowStage; preview: boolean; openHistory: boolean }) {
  const router = useRouter();
  const storedProject = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const daw = (useStore((state) => state.daw) ?? "Logic Pro") as SupportedDaw;
  const plugins = useStore((state) => state.plugins);
  const stage = useWorkspaceStore((state) => state.stage);
  const setStage = useWorkspaceStore((state) => state.setStage);
  const selectedFindingId = useWorkspaceStore((state) => state.selectedFindingId);
  const selectedRange = useWorkspaceStore((state) => state.selectedRange);
  const selectFinding = useWorkspaceStore((state) => state.selectFinding);
  const isPlaying = useWorkspaceStore((state) => state.isPlaying);
  const setPlaying = useWorkspaceStore((state) => state.setPlaying);
  const loopEnabled = useWorkspaceStore((state) => state.loopEnabled);
  const setLoopEnabled = useWorkspaceStore((state) => state.setLoopEnabled);
  const auditionMode = useWorkspaceStore((state) => state.auditionMode);
  const setAuditionMode = useWorkspaceStore((state) => state.setAuditionMode);
  const levelMatched = useWorkspaceStore((state) => state.levelMatched);
  const setLevelMatched = useWorkspaceStore((state) => state.setLevelMatched);
  const monoCheck = useWorkspaceStore((state) => state.monoCheck);
  const setMonoCheck = useWorkspaceStore((state) => state.setMonoCheck);
  const analysisProgress = useWorkspaceStore((state) => state.analysisProgress);
  const setAnalysisProgress = useWorkspaceStore((state) => state.setAnalysisProgress);
  const pendingAnalysis = useWorkspaceStore((state) => state.pendingAnalysis);
  const setPendingAnalysis = useWorkspaceStore((state) => state.setPendingAnalysis);
  const analysisRetryAction = useWorkspaceStore((state) => state.analysisRetryAction);
  const setAnalysisRetryAction = useWorkspaceStore((state) => state.setAnalysisRetryAction);
  const setAnalysisSourceFingerprint = useWorkspaceStore((state) => state.setAnalysisSourceFingerprint);
  const clearAnalysisFlow = useWorkspaceStore((state) => state.clearAnalysisFlow);
  const intentLocks = useWorkspaceStore((state) => state.intentLocks);
  const toggleIntentLock = useWorkspaceStore((state) => state.toggleIntentLock);
  const [project, setProject] = useState<Project | null>(preview ? PREVIEW_PROJECT : null);
  const [runs, setRuns] = useState<AnalysisRun[]>(preview ? [PREVIEW_RUN] : []);
  const [plans, setPlans] = useState<MixPlan[]>(preview ? [PREVIEW_PLAN] : []);
  const [target, setTarget] = useState<ProjectTargetProfile>(preview ? PREVIEW_TARGET : defaultTargetProfile());
  const [vocalUrl, setVocalUrl] = useState<string | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"saving" | "analyzing" | "building" | "verifying" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(openHistory);
  const [checkpointStage, setCheckpointStage] = useState<
    "main_chain" | "buses" | null
  >(null);
  const analysisAbortRef = useRef<AbortController | null>(null);

  const activeRun = useMemo(
    () => runs.find((run) => run.id === project?.active_analysis_run_id) ?? runs.find((run) => run.run_type === "diagnosis") ?? null,
    [project?.active_analysis_run_id, runs]
  );
  const verificationRuns = useMemo(
    () => runs.filter((run) => run.run_type === "verification"),
    [runs]
  );
  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === project?.active_mix_plan_id) ?? plans[0] ?? null,
    [plans, project?.active_mix_plan_id]
  );
  const contextFingerprints = useMemo(() => {
    const stages = ["prepare", "main_chain", "buses", "match_beat"] as const;
    return Object.fromEntries(
      stages.map((fingerprintStage) => [
        fingerprintStage,
        project
          ? preview
            ? "preview"
            : workflowContextFingerprint({
                project,
                daw,
                plugins: plugins as never[],
                stage: fingerprintStage,
              })
          : "",
      ])
    ) as Record<(typeof stages)[number], string>;
  }, [daw, plugins, preview, project]);
  const statuses = useMemo(
    () => project
      ? deriveWorkflowStageStatuses({
          project,
          activeRun,
          activePlan,
          verificationRuns,
          contextFingerprints,
        })
      : [],
    [activePlan, activeRun, contextFingerprints, project, verificationRuns]
  );
  const findings = useMemo(
    () => pendingAnalysis?.findings ?? activeRun?.findings ?? [],
    [activeRun?.findings, pendingAnalysis?.findings]
  );
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? findings[0] ?? null;
  const vocal = project ? getPrimaryVocalAsset(project) : null;
  const beat = project ? getPrimaryBeatAsset(project) : null;
  const chainPrint = project ? getProcessedVocalAsset(project, "main_chain") : null;
  const busPrint = project ? getProcessedVocalAsset(project, "buses") : null;
  const processed = project ? getLatestProcessedVocalAsset(project) : null;
  const duration = Math.max(
    beat?.duration ?? 0,
    (vocal?.duration ?? 0) + (vocal?.timelineStartSeconds ?? 0),
    150
  );
  const analysisMeasurements = pendingAnalysis?.measurements ?? activeRun?.measurements;
  const vocalCheck = analysisMeasurements?.vocalCheck as Record<string, unknown> | undefined;
  const vocalMetrics = analysisMeasurements?.vocal as Record<string, unknown> | undefined;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("stage");
    setStage(
      requested && requested in STAGE_COPY
        ? (requested as WorkflowStage)
        : initialStage
    );
  }, [initialStage, setStage]);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    Promise.all([
      getProjectRecord(projectId),
      listProjectAnalysisRuns(projectId),
      listProjectMixPlans(projectId),
    ]).then(([loadedProject, loadedRuns, loadedPlans]) => {
      if (!alive) return;
      setProject(loadedProject);
      setActiveProject(loadedProject);
      setTarget(normalizeTargetProfile(loadedProject.target_profile));
      setRuns(loadedRuns);
      setPlans(loadedPlans);
    }).catch(() => {
      if (alive) setMessage("This project could not be loaded. Return to Projects and try again.");
    });
    return () => { alive = false; };
  }, [preview, projectId, setActiveProject]);

  useEffect(() => {
    if (!storedProject || storedProject.id !== projectId || preview) return;
    const frame = requestAnimationFrame(() => setProject(storedProject));
    return () => cancelAnimationFrame(frame);
  }, [preview, projectId, storedProject]);

  useEffect(() => {
    const vocalSource = auditionMode === "processed" && processed ? processed : vocal;
    let alive = true;
    Promise.all([
      getAssetPlaybackUrl(vocalSource),
      getAssetPlaybackUrl(beat),
    ]).then(([nextVocalUrl, nextBeatUrl]) => {
      if (!alive) return;
      setVocalUrl(nextVocalUrl);
      setBeatUrl(nextBeatUrl);
    }).catch(() => {
      if (!alive) return;
      setVocalUrl(null);
      setBeatUrl(null);
    });
    return () => { alive = false; };
  }, [auditionMode, beat, processed, vocal]);

  useEffect(() => {
    analysisAbortRef.current?.abort();
    clearAnalysisFlow();
    return () => analysisAbortRef.current?.abort();
  }, [clearAnalysisFlow, projectId]);

  useEffect(() => {
    if (!selectedFinding && findings[0]) {
      const evidence = findings[0].evidence;
      selectFinding(findings[0].id, evidence.startSeconds != null && evidence.endSeconds != null
        ? { start: evidence.startSeconds, end: evidence.endSeconds }
        : null);
    }
  }, [findings, selectFinding, selectedFinding]);

  const changeStage = useCallback((next: WorkflowStage) => {
    const status = statuses.find((item) => item.stage === next);
    if (status?.blocked) {
      setMessage(status.reason);
      return;
    }
    setMessage(null);
    setCheckpointStage(null);
    setStage(next);
    router.replace(`/projects/${projectId}?stage=${next}${preview ? "&preview=1" : ""}`, { scroll: false });
  }, [preview, projectId, router, setStage, statuses]);

  const setFlowProgress = useCallback((next: Partial<AnalysisProgressState> & Pick<AnalysisProgressState, "phase" | "label">) => {
    setAnalysisProgress({
      progress: null,
      message: null,
      errorCode: null,
      retryable: false,
      ...next,
    });
  }, [setAnalysisProgress]);

  const persistTarget = useCallback(async (sourceProject: Project) => {
    const nextTarget = { ...target, updatedAt: new Date().toISOString() };
    const saved = await saveProjectPatch(sourceProject.id, { target_profile: nextTarget });
    setProject(saved);
    setActiveProject(saved);
    setTarget(nextTarget);
    return saved;
  }, [setActiveProject, target]);

  const saveTarget = useCallback(async () => {
    if (!project || preview) return;
    setBusy("saving");
    setMessage(null);
    try {
      await persistTarget(project);
      setMessage("Target saved. Existing downstream results remain in History and are now marked outdated.");
    } catch {
      setMessage("The target could not be saved. Your choices are still visible—try again.");
    } finally {
      setBusy(null);
    }
  }, [persistTarget, preview, project]);

  const saveMeasuredResult = useCallback(async (params: {
    sourceProject: Project;
    runType: "diagnosis" | "verification";
    result: ProjectAnalysisResponse;
    verificationStage?: "main_chain" | "buses" | "match_beat";
  }) => {
    const sourceVocal = params.runType === "verification"
      ? params.verificationStage
        ? getProcessedVocalAsset(params.sourceProject, params.verificationStage) ??
          getLatestProcessedVocalAsset(params.sourceProject)
        : getLatestProcessedVocalAsset(params.sourceProject)
      : getPrimaryVocalAsset(params.sourceProject);
    const sourceBeat = getPrimaryBeatAsset(params.sourceProject);
    setFlowProgress({ phase: "saving", label: "Saving measured evidence", message: "Writing this run to project History." });
    setPendingAnalysis(params.result);
    setAnalysisRetryAction("save");
    try {
      const saved = await saveAnalysisRun(params.sourceProject.id, {
        run_type: params.runType,
        input_asset_ids: [
          sourceVocal?.id,
          sourceBeat?.id,
        ].filter(Boolean) as string[],
        analysis_version: WORKFLOW_ANALYSIS_VERSION,
        measurements: params.result.measurements,
        findings: params.result.findings,
        provenance: {
          ...params.result.provenance,
          verificationStage:
            params.runType === "verification"
              ? params.verificationStage ?? "match_beat"
              : null,
        },
        limitations: params.result.limitations,
        fallback_used: params.result.fallback_used,
        fallback_reason: params.result.fallback_reason,
      });
      setRuns((current) => [saved, ...current]);
      if (params.runType === "diagnosis") {
        setProject((current) => current ? { ...current, active_analysis_run_id: saved.id } : current);
        if (saved.findings[0]) {
          const evidence = saved.findings[0].evidence;
          selectFinding(
            saved.findings[0].id,
            evidence.startSeconds != null && evidence.endSeconds != null
              ? { start: evidence.startSeconds, end: evidence.endSeconds }
              : null
          );
        }
      }
      setPendingAnalysis(null);
      setAnalysisRetryAction(null);
      setFlowProgress({
        phase: "complete",
        label: params.result.provenance.status === "ok" ? "Full diagnosis complete" : "Diagnosis needs attention",
        message: params.result.provenance.status === "ok"
          ? "Measured evidence is saved in project History."
          : "Measured sections were saved, but skipped checks must be retried before Build.",
      });
      setMessage(params.result.fallback_used
        ? `Measured with limitations: ${params.result.fallback_reason}`
        : "Measured analysis saved to project History.");
      return saved;
    } catch {
      setFlowProgress({
        phase: "failed",
        label: "Measured evidence is not saved yet",
        message: "The measurements remain available here. Retry saving without re-running audio analysis.",
        errorCode: "save_failed",
        retryable: true,
      });
      setMessage("Saving failed. The measured draft is preserved and audio analysis will not be repeated.");
      return null;
    }
  }, [selectFinding, setAnalysisRetryAction, setFlowProgress, setPendingAnalysis]);

  const runDiagnosis = useCallback(async (
    runType: "diagnosis" | "verification" = "diagnosis",
    sourceProject: Project | null = project,
    verificationStage?: "main_chain" | "buses" | "match_beat"
  ) => {
    if (!sourceProject || preview) return;
    const sourceVocal = runType === "verification"
      ? verificationStage
        ? getProcessedVocalAsset(sourceProject, verificationStage) ??
          (verificationStage === "match_beat"
            ? getLatestProcessedVocalAsset(sourceProject)
            : null)
        : getLatestProcessedVocalAsset(sourceProject)
      : getPrimaryVocalAsset(sourceProject);
    const sourceBeat =
      runType === "verification" && verificationStage !== "main_chain"
        ? getPrimaryBeatAsset(sourceProject)
        : null;
    if (runType === "diagnosis" && !sourceVocal) {
      setMessage("Upload one consolidated raw vocal in Setup before running Vocal Check.");
      return;
    }
    if (runType === "verification" && !sourceVocal) {
      setMessage("Upload the processed vocal before verification.");
      return;
    }
    if (
      runType === "verification" &&
      verificationStage !== "main_chain" &&
      !sourceBeat
    ) {
      setMessage("Add the separate beat in Setup before this context check.");
      return;
    }
    const alignedVocal = getPrimaryVocalAsset(sourceProject);
    if (
      runType === "verification" &&
      verificationStage !== "main_chain" &&
      (alignedVocal?.timelineStartSeconds ?? 0) > 0
    ) {
      setMessage(
        "The timeline offset is saved. Alignment-aware beat measurement is the remaining backend step, so MimiQ will not return an unaligned result."
      );
      return;
    }

    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const sourceFingerprint = workflowContextFingerprint({
      project: sourceProject,
      daw,
      plugins: plugins as never[],
      stage:
        runType === "diagnosis"
          ? "prepare"
          : verificationStage ?? "match_beat",
    });
    setAnalysisSourceFingerprint(sourceFingerprint);
    setPendingAnalysis(null);
    setAnalysisRetryAction("restart");
    setBusy(runType === "diagnosis" ? "analyzing" : "verifying");
    setMessage(null);
    setFlowProgress({
      phase: "preparing",
      label: "Preparing project audio",
      message: "Checking the current assets and measurement service.",
    });

    const makeForm = (job?: { id: string; token: string }) => {
      const form = new FormData();
      form.append("projectId", sourceProject.id);
      form.append("contextFingerprint", sourceFingerprint);
      form.append("runType", runType);
      if (runType === "verification" && sourceVocal) form.append("processedAssetId", sourceVocal.id);
      else if (sourceVocal) form.append("vocalAssetId", sourceVocal.id);
      if (sourceBeat) form.append("beatAssetId", sourceBeat.id);
      if (job) {
        form.append("stemJobId", job.id);
        form.append("stemJobToken", job.token);
      }
      return form;
    };

    const postAnalysis = async (job?: { id: string; token: string }) => {
      const response = await fetch("/api/project-analysis", {
        method: "POST",
        body: makeForm(job),
        headers: await authHeaders(),
        signal: controller.signal,
      });
      return response.json() as Promise<ProjectAnalysisFlowResponse>;
    };

    try {
      setFlowProgress({
        phase: "analyzing",
        label:
          runType === "diagnosis"
            ? "Measuring vocal performance"
            : sourceBeat
              ? "Measuring processed vocal and beat"
              : "Measuring raw and processed vocal",
        message: "MimiQ is running deterministic audio measurements.",
      });
      let flow = await postAnalysis();

      if (flow.status === "processing") {
        const job = { id: flow.jobId, token: flow.jobToken };
        setAnalysisRetryAction("poll_split");
        let complete = false;
        while (!complete) {
          setFlowProgress({
            phase: "separating",
            label: "Separating vocal and instrumental",
            progress: flow.progress,
            message: flow.message,
          });
          await waitForPoll(controller.signal);
          const statusResponse = await fetch(
            `/api/split-stems/${job.id}?jobToken=${encodeURIComponent(job.token)}`,
            {
              cache: "no-store",
              headers: await authHeaders(),
              signal: controller.signal,
            }
          );
          const jobStatus = await statusResponse.json() as StemSplitJobResponse & { message?: string };
          if (!statusResponse.ok || jobStatus.status === "failed") {
            throw new Error(jobStatus.error ?? jobStatus.message ?? "Stem Rip failed.");
          }
          flow = {
            status: "processing",
            inputMode: "stem_split",
            jobId: job.id,
            jobToken: job.token,
            progress: jobStatus.progress,
            stage: jobStatus.stage,
            message: jobStatus.message ?? "Separating vocal and instrumental.",
            estimatedRemainingSeconds: jobStatus.estimated_remaining_seconds,
          };
          complete = jobStatus.status === "complete";
        }
        setAnalysisRetryAction("restart");
        setFlowProgress({
          phase: "analyzing",
          label: "Measuring vocal, instrumental, pitch, and collisions",
          message: "Stem Rip is complete. MimiQ is measuring the separated signals.",
        });
        flow = await postAnalysis(job);
      }

      if (flow.status === "error") {
        setFlowProgress({
          phase: "failed",
          label: flow.stage === "separating" ? "Stem Rip could not finish" : "Diagnosis could not finish",
          message: flow.message,
          errorCode: flow.code,
          retryable: flow.retryable,
        });
        setAnalysisRetryAction(flow.retryable ? "restart" : null);
        setMessage(flow.message);
        return;
      }
      if (flow.status !== "complete") {
        throw new Error("Analysis ended before measured results were returned.");
      }
      await saveMeasuredResult({
        sourceProject,
        runType,
        result: flow.result,
        verificationStage,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Analysis failed. No result was saved.";
      setFlowProgress({
        phase: "failed",
        label: runType === "verification" ? "Comparison failed" : "Diagnosis failed",
        message,
        errorCode: "measurement_failed",
        retryable: true,
      });
      setAnalysisRetryAction("restart");
      setMessage(message);
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setBusy(null);
    }
  }, [daw, plugins, preview, project, saveMeasuredResult, setAnalysisRetryAction, setAnalysisSourceFingerprint, setFlowProgress, setPendingAnalysis]);

  const startSetupDiagnosis = useCallback(async () => {
    if (!project || preview) return;
    setStage("prepare");
    router.replace(`/projects/${projectId}?stage=prepare`, { scroll: false });
    setBusy("saving");
    setMessage(null);
    setFlowProgress({
      phase: "preparing",
      label: "Preparing project audio",
      message: "Saving the target before measurement starts.",
    });
    try {
      const savedProject = await persistTarget(project);
      await runDiagnosis("diagnosis", savedProject);
    } catch {
      setFlowProgress({
        phase: "failed",
        label: "Project setup could not be saved",
        message: "Your uploads and target choices are still here. Retry when the project connection is available.",
        errorCode: "save_failed",
        retryable: true,
      });
      setAnalysisRetryAction("restart");
      setMessage("The target could not be saved. Your choices are still visible—try again.");
      setBusy(null);
    }
  }, [persistTarget, preview, project, projectId, router, runDiagnosis, setAnalysisRetryAction, setFlowProgress, setStage]);

  const continueFromSetup = useCallback(async () => {
    if (!project || preview || !vocal) {
      if (!vocal) setMessage("Add one consolidated raw vocal to continue.");
      return;
    }
    setBusy("saving");
    setMessage(null);
    try {
      await persistTarget(project);
      changeStage("prepare");
    } catch {
      setMessage("Setup could not be saved. Your uploads remain attached to the project.");
    } finally {
      setBusy(null);
    }
  }, [changeStage, persistTarget, preview, project, vocal]);

  const retryPendingSave = useCallback(async () => {
    if (!project || !pendingAnalysis) return;
    setBusy("saving");
    await saveMeasuredResult({ sourceProject: project, runType: "diagnosis", result: pendingAnalysis });
    setBusy(null);
  }, [pendingAnalysis, project, saveMeasuredResult]);

  const buildPlan = useCallback(async () => {
    if (!project || !activeRun || preview) return;
    setBusy("building");
    setMessage(null);
    try {
      const catalog = await listCertifiedPlugins();
      const draft = buildDeterministicMixPlan({
        projectId: project.id,
        run: activeRun,
        target,
        catalog,
        daw,
        plugins: plugins as never[],
      });
      const saved = await saveMixPlan(draft);
      setPlans((current) => [saved, ...current]);
      setProject((current) => current ? { ...current, active_mix_plan_id: saved.id } : current);
      changeStage("main_chain");
      setMessage(saved.instructions.every((instruction) => instruction.certified)
        ? "Catalogue-backed action plan saved."
        : "Plan saved with unsupported capabilities clearly labeled.");
    } catch {
      setMessage("The certified plugin catalogue could not be loaded. No plan was invented or saved.");
    } finally {
      setBusy(null);
    }
  }, [activeRun, changeStage, daw, plugins, preview, project, target]);

  const toggleInstruction = useCallback(async (instruction: PluginInstruction) => {
    if (!activePlan || preview) return;
    const completion = {
      ...activePlan.completion_state,
      [instruction.id]: !activePlan.completion_state[instruction.id],
    };
    setPlans((current) => current.map((plan) => plan.id === activePlan.id ? { ...plan, completion_state: completion } : plan));
    try {
      const saved = await updateMixPlanCompletion(activePlan.id, completion);
      setPlans((current) => current.map((plan) => plan.id === saved.id ? saved : plan));
    } catch {
      setMessage("That completion state could not be saved. Try again.");
    }
  }, [activePlan, preview]);

  const toggleBusChoice = useCallback(async (
    bus: "parallel" | "reverb" | "delay"
  ) => {
    if (!activePlan || preview) return;
    const key = `bus:${bus}`;
    const completion = {
      ...activePlan.completion_state,
      [key]: !activePlan.completion_state[key],
    };
    setPlans((current) =>
      current.map((plan) =>
        plan.id === activePlan.id
          ? { ...plan, completion_state: completion }
          : plan
      )
    );
    try {
      const saved = await updateMixPlanCompletion(activePlan.id, completion);
      setPlans((current) =>
        current.map((plan) => (plan.id === saved.id ? saved : plan))
      );
    } catch {
      setMessage("That bus choice could not be saved. Try again.");
    }
  }, [activePlan, preview]);

  const saveAlignment = useCallback(async (seconds: number) => {
    if (!project || !vocal || !beat || preview) return;
    const audioAssets = updateProjectAudioAsset(
      getProjectAudioAssets(project),
      vocal.id,
      {
        alignedBeatAssetId: beat.id,
        timelineStartSeconds: Math.max(0, seconds),
      }
    );
    setMessage(null);
    try {
      const saved = await saveProjectPatch(project.id, {
        audio_assets: audioAssets,
      });
      setProject(saved);
      setActiveProject(saved);
      setMessage(`Vocal 0:00 aligned to beat ${formatTime(seconds)}.`);
    } catch {
      setMessage("The alignment could not be saved. Try again.");
    }
  }, [beat, preview, project, setActiveProject, vocal]);

  if (!project) return <LoadingWorkspace />;

  const diagnosisComplete = statuses.find((status) => status.stage === "prepare")?.state === "complete";
  const alignmentReady = Boolean(
    vocal &&
      beat &&
      vocal.alignedBeatAssetId === beat.id &&
      typeof vocal.timelineStartSeconds === "number"
  );
  const enabledBuses = {
    parallel: Boolean(activePlan?.completion_state["bus:parallel"]),
    reverb: Boolean(activePlan?.completion_state["bus:reverb"]),
    delay: Boolean(activePlan?.completion_state["bus:delay"]),
  };
  const verificationRunFor = (
    verificationStage: "main_chain" | "buses" | "match_beat"
  ) =>
    verificationRuns.find(
      (run) => run.provenance.verificationStage === verificationStage
    ) ??
    (verificationStage === "match_beat"
      ? verificationRuns.find(
          (run) => run.provenance.verificationStage == null
        ) ?? null
      : null);
  const retryDiagnosis = analysisRetryAction === "save"
    ? retryPendingSave
    : () => runDiagnosis("diagnosis", project);
  const primaryAction = checkpointStage
    ? {
        label:
          busy === "verifying"
            ? "Measuring comparison"
            : checkpointStage === "main_chain"
              ? "Run Chain Print Check"
              : "Run Bus Print Check",
        action: () =>
          runDiagnosis("verification", project, checkpointStage),
        disabled:
          Boolean(busy) ||
          (checkpointStage === "main_chain" ? !chainPrint : !busPrint) ||
          (checkpointStage === "buses" && (!beat || !alignmentReady)),
      }
    : stage === "setup"
      ? {
          label: busy === "saving" ? "Saving setup" : "Continue to Vocal Check",
          action: continueFromSetup,
          disabled: Boolean(busy) || !vocal,
        }
      : stage === "prepare"
      ? diagnosisComplete
        ? { label: "Open Vocal Chain", action: () => changeStage("main_chain"), disabled: false }
        : { label: busy ? "Running Vocal Check" : "Run Vocal Check", action: startSetupDiagnosis, disabled: Boolean(busy) || !vocal }
      : stage === "main_chain"
        ? activePlan
          ? { label: "Continue to buses", action: () => changeStage("buses"), disabled: false }
          : { label: busy === "building" ? "Building main chain" : "Build catalogue-backed chain", action: buildPlan, disabled: Boolean(busy) || !diagnosisComplete }
        : stage === "buses"
          ? { label: "Match vocal to beat", action: () => changeStage("match_beat"), disabled: false }
          : {
              label:
                busy === "verifying"
                  ? "Measuring final match"
                  : "Run Match to Beat",
              action: () =>
                runDiagnosis("verification", project, "match_beat"),
              disabled:
                Boolean(busy) ||
                !processed ||
                !beat ||
                !alignmentReady,
            };

  const requirement =
    stage !== "setup" && !vocal
      ? {
          title: "Raw vocal needed to run this stage",
          copy: "You can explore the workflow now. Add one consolidated raw vocal when you are ready for measured results.",
        }
      : stage === "buses" && !beat
        ? {
            title: "Beat needed for bus context",
            copy: "The bus layout stays available to explore. Add the separate beat in Setup before applying guidance.",
          }
        : stage === "buses" && !alignmentReady
          ? {
              title: "Align the vocal to the beat",
              copy: "Set where vocal 0:00 begins on the beat timeline before using beat-aware bus guidance.",
            }
          : stage === "match_beat" && (!processed || !beat)
            ? {
                title: "Processed vocal and beat needed",
                copy: "Explore the final check now, then add the separate files when you are ready to measure them.",
              }
            : stage === "match_beat" && !alignmentReady
              ? {
                  title: "Alignment needed for the final match",
                  copy: "Confirm where vocal 0:00 begins on the beat before measuring time-coded collisions.",
                }
              : null;

  return (
    <div className={styles.shell} data-preview={preview ? "true" : "false"}>
      <aside className={styles.iconRail}>
        <Link href="/projects" className={styles.logo} aria-label="MimiQ projects"><Logo className="text-base" /></Link>
        <nav>
          <Link href="/projects" aria-label="Projects"><FolderKanban size={20} /></Link>
          <button type="button" className={styles.railActive} aria-label="Workspace"><Waves size={21} /></button>
          <Link href="/stem-splitter" aria-label="Stem Rip"><SplitSquareVertical size={20} /></Link>
        </nav>
        <Link href="/onboarding" className={styles.railSettings} aria-label="Studio settings"><Settings size={20} /></Link>
      </aside>

      <aside className={styles.projectDrawer}>
        <div className={styles.drawerProject}>
          <span>{project.name}</span>
          <button type="button" aria-label="Collapse project drawer"><ChevronLeft size={14} /></button>
        </div>
        <button type="button" className={styles.drawerActive}><AudioLines size={14} /> Lead vocal <i /></button>
        <span className={styles.drawerItem}>Lead doubles</span>
        <span className={styles.drawerItem}>Beat {beat ? "· ready" : "· optional"}</span>
        <span className={styles.drawerItem}>Chain print {chainPrint ? "· ready" : "· none"}</span>
        <span className={styles.drawerItem}>Bus print {busPrint ? "· ready" : "· none"}</span>
        <button type="button" className={styles.addStem}>+ Add stem</button>
        <button type="button" className={styles.historyButton} onClick={() => setHistoryOpen(true)}><History size={14} /> Project history <strong>{runs.length + plans.length}</strong></button>
      </aside>

      <div className={styles.mainColumn} data-stage={stage}>
        {preview && <div className={styles.previewNotice}>Interface preview — audio and measurements shown here are illustrative, not a saved analysis.</div>}
        <header className={styles.topBar}>
          <div><span>Project</span><strong>{project.name}</strong></div>
          <div><span>Workspace</span><strong>Lead vocal</strong></div>
          <div><span>Input</span><strong>{vocal ? "Raw vocal ready" : "Setup needed"}</strong></div>
          <div className={styles.analyzedState}><i /><span>{activeRun ? "Analyzed" : "Not analyzed"}</span><small>{activeRun ? formatUtcTime(activeRun.created_at) : "—"}</small></div>
          <div className={styles.vocalStrip}>
            <span>Key <strong>{String(vocalCheck?.detectedKey ?? "—")}</strong></span>
            <span>BPM <strong>{typeof vocalCheck?.bpm === "number" ? Math.round(vocalCheck.bpm) : "—"}</strong></span>
            <span>Pitch <strong>{typeof vocalCheck?.inKeyVoicedFrameRatio === "number" ? `${Math.round(vocalCheck.inKeyVoicedFrameRatio * 100)}% in key` : "Unknown"}</strong></span>
          </div>
        </header>

        <div className={styles.workflowRail} aria-label="Project workflow">
          {statuses.map((status, index) => (
            <button
              type="button"
              key={status.stage}
              className={stage === status.stage ? styles.stageActive : ""}
              data-state={status.state}
              onClick={() => changeStage(status.stage)}
              aria-current={stage === status.stage ? "step" : undefined}
              title={status.reason}
            >
              <span>{status.stage === "setup" ? 0 : index}</span>
              <div><strong>{STAGE_COPY[status.stage].title}</strong><small>{STAGE_COPY[status.stage].subtitle}</small></div>
              <em>{workflowIcon(status.state)} {status.label}</em>
            </button>
          ))}
          <div className={styles.nextAction}><span>Next action</span><strong>{primaryAction.label}</strong></div>
          <button type="button" className={styles.nextButton} onClick={() => void primaryAction.action()} disabled={primaryAction.disabled} aria-label={primaryAction.label}>
            {busy ? <LoaderCircle className={styles.spin} size={17} /> : <ArrowRight size={18} />}
          </button>
        </div>

        <div className={styles.workArea}>
          <div className={styles.centerWorkspace}>
            <div className={styles.stageContextBar}>
              <div>
                <span>
                  {checkpointStage === "main_chain"
                    ? "Chain Print Check"
                    : checkpointStage === "buses"
                      ? "Bus Print Check"
                      : STAGE_COPY[stage].title}
                </span>
                <strong>
                  {checkpointStage
                    ? "Optional measured comparison after applying this stage."
                    : STAGE_COPY[stage].subtitle}
                </strong>
              </div>
              {checkpointStage ? (
                <button type="button" onClick={() => setCheckpointStage(null)}>
                  <ChevronLeft size={13} /> Back to {checkpointStage === "main_chain" ? "Vocal Chain" : "Buses"}
                </button>
              ) : stage === "main_chain" || stage === "buses" ? (
                <button type="button" onClick={() => setCheckpointStage(stage)}>
                  <TimerReset size={13} /> {stage === "main_chain" ? "Check chain print" : "Check bus print"}
                </button>
              ) : null}
            </div>
            {stage === "match_beat" && !checkpointStage && (
              <WorkspaceTimeline
                vocalUrl={vocalUrl}
                beatUrl={beatUrl}
                findings={findings}
                duration={duration}
                preview={preview}
                empty={!processed || !beat}
                timelineStartSeconds={vocal?.timelineStartSeconds ?? 0}
              />
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={stage}
                className={styles.stageContent}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: .24 }}
              >
                {checkpointStage ? (
                  <VerifyStage
                    stage={checkpointStage}
                    project={project}
                    processed={checkpointStage === "main_chain" ? chainPrint : busPrint}
                    source={checkpointStage === "main_chain" ? vocal : chainPrint ?? vocal}
                    beat={beat}
                    verificationRun={verificationRunFor(checkpointStage)}
                    rawRun={activeRun}
                  />
                ) : stage === "setup" ? (
                  <SetupStage
                    project={project}
                    target={target}
                    setTarget={setTarget}
                    saveTarget={saveTarget}
                    preview={preview}
                    busy={busy}
                    intentLocks={intentLocks}
                    toggleIntentLock={toggleIntentLock}
                  />
                ) : stage === "prepare" ? (
                  <PrepareVocalStage
                    findings={findings}
                    measurements={analysisMeasurements ?? null}
                    selectedFinding={selectedFinding}
                    selectFinding={selectFinding}
                    progress={analysisProgress}
                    limitations={pendingAnalysis?.limitations ?? activeRun?.limitations ?? []}
                    skippedMeasurements={pendingAnalysis?.provenance.skippedMeasurements ?? activeRun?.provenance.skippedMeasurements ?? []}
                    onRetry={() => void retryDiagnosis()}
                    hasVocal={Boolean(vocal)}
                  />
                ) : stage === "main_chain" ? (
                  <MainChainStage plan={activePlan} selectedFindingId={selectedFinding?.id ?? null} selectFinding={selectFinding} onToggle={toggleInstruction} preview={preview} />
                ) : stage === "buses" ? (
                  <BusesStage
                    enabled={enabledBuses}
                    toggleBus={toggleBusChoice}
                    actionable={Boolean(activePlan && beat && alignmentReady)}
                    vocal={vocal}
                    beat={beat}
                    vocalUrl={vocalUrl}
                    beatUrl={beatUrl}
                    duration={duration}
                    preview={preview}
                    onSaveAlignment={saveAlignment}
                  />
                ) : (
                  <MatchBeatStage
                    project={project}
                    findings={findings}
                    selectedFinding={selectedFinding}
                    selectFinding={selectFinding}
                    processed={processed}
                    beat={beat}
                    verificationRun={verificationRunFor("match_beat")}
                  />
                )}
              </motion.div>
            </AnimatePresence>
            {message && <div className={styles.message} role="status"><CircleHelp size={14} />{message}</div>}
          </div>

        </div>

        {requirement && (
          <motion.aside
            key={`${stage}-${requirement.title}`}
            className={styles.requirementDock}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <div><strong>{requirement.title}</strong><span>{requirement.copy}</span></div>
            <button type="button" onClick={() => changeStage("setup")}>Go to Setup</button>
          </motion.aside>
        )}

        {stage !== "setup" && <footer className={styles.transport}>
          <button type="button" aria-label="Previous marker"><SkipBack size={18} /></button>
          <button type="button" className={styles.playButton} aria-label={isPlaying ? "Pause" : "Play"} onClick={() => setPlaying(!isPlaying)}>{isPlaying ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}</button>
          <button type="button" aria-label="Next marker"><SkipForward size={18} /></button>
          <button type="button" className={loopEnabled ? styles.transportActive : ""} onClick={() => setLoopEnabled(!loopEnabled)}><Repeat2 size={17} /><span>{selectedRange ? `${formatTime(selectedRange.start)} — ${formatTime(selectedRange.end)}` : "Loop range"}</span></button>
          {(stage === "main_chain" || stage === "buses" || stage === "match_beat") && <div className={styles.abControl}><button type="button" className={auditionMode === "raw" ? styles.abActive : ""} onClick={() => setAuditionMode("raw")}>A <span>{stage === "buses" ? "Previous" : "Raw"}</span></button><button type="button" className={auditionMode === "processed" ? styles.abActive : ""} onClick={() => setAuditionMode("processed")} disabled={!processed}>B <span>Current</span></button></div>}
          {(stage === "main_chain" || stage === "buses" || stage === "match_beat") && <button type="button" className={levelMatched ? styles.transportActive : ""} onClick={() => setLevelMatched(!levelMatched)}><span>Level match</span><strong>{levelMatched ? "On" : "Off"}</strong></button>}
          {stage === "match_beat" && <button type="button" className={monoCheck ? styles.transportActive : ""} onClick={() => setMonoCheck(!monoCheck)}><span>Mono check</span><strong>{monoCheck ? "On" : "Off"}</strong></button>}
          <div className={styles.output}><Volume2 size={15} /><span>Output preview<small>Studio default</small></span><div><i /><i /><i /><i /><i /><i /><i /><i /></div><strong>{typeof vocalMetrics?.lufs === "number" ? `${vocalMetrics.lufs.toFixed(1)} LUFS` : "Unknown"}</strong></div>
        </footer>}
      </div>

      <AnimatePresence>
        {historyOpen && (
          <motion.aside className={styles.historyPanel} initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }} transition={{ duration: .26 }}>
            <header><div><span>Project history</span><strong>Evidence never disappears</strong></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close History"><X size={17} /></button></header>
            {[...runs, ...plans].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((item) => (
              <div className={styles.historyItem} key={item.id}>
                {"run_type" in item ? <Waves size={15} /> : <SlidersHorizontal size={15} />}
                <span><strong>{"run_type" in item ? item.run_type : "Mix plan"}</strong><small>{formatUtcDateTime(item.created_at)}</small></span>
                {project.active_analysis_run_id === item.id || project.active_mix_plan_id === item.id ? <em>Active</em> : null}
              </div>
            ))}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function SetupStage({
  project,
  target,
  setTarget,
  saveTarget,
  preview,
  busy,
  intentLocks,
  toggleIntentLock,
}: {
  project: Project;
  target: ProjectTargetProfile;
  setTarget: (target: ProjectTargetProfile) => void;
  saveTarget: () => Promise<void>;
  preview: boolean;
  busy: string | null;
  intentLocks: Record<"tone" | "dynamics" | "space", boolean>;
  toggleIntentLock: (lock: "tone" | "dynamics" | "space") => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryAxes: Array<[keyof ProjectTargetProfile, string, string, string]> = [
    ["upfront", "Vocal position", "Recessed", "Upfront"],
    ["bright", "Tone", "Dark", "Bright"],
    ["atmospheric", "Space", "Dry", "Atmospheric"],
  ];
  const detailAxes: Array<[keyof ProjectTargetProfile, string, string, string]> = [
    ["dynamic", "Control", "Tight", "Dynamic"],
    ["obviousTuning", "Tuning", "Natural", "Obvious"],
    ["wideSupport", "Supporting vocals", "Narrow", "Wide"],
  ];
  const vocal = getPrimaryVocalAsset(project);
  const beat = getPrimaryBeatAsset(project);
  const axis = ([key, label, low, high]: typeof primaryAxes[number]) => (
    <label key={key}>
      <span><strong>{label}</strong><small>{low} / {high}</small></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={Number(target[key])}
        onChange={(event) =>
          setTarget({ ...target, [key]: Number(event.currentTarget.value) })
        }
      />
    </label>
  );
  return (
    <section className={styles.setupStage}>
      <header><span>Stage 00 / Setup</span><h1>Give MimiQ the vocal. Add the beat when you need context.</h1><p>One consolidated raw vocal is required for measurement. The beat and direction are optional here and can be changed later.</p></header>
      <div className={styles.uploadPaths}>
        <div className={styles.uploadPath} data-ready={Boolean(vocal)}>
          <strong><CheckCircle2 size={16} /> Required input</strong>
          <h2>Consolidated raw vocal</h2>
          <p>Use one continuous file containing the chosen takes and intentional gaps. It can begin at vocal 0:00.</p>
          {preview ? <span className={styles.previewAsset}>Lead Vocal Dry.wav</span> : <ProjectAudioUpload label="Raw vocal" defaultKind="vocal" description="Required for Vocal Check" existingAsset={vocal} />}
        </div>
        <div className={styles.uploadPath} data-ready={Boolean(beat)}>
          <strong><AudioLines size={16} /> Optional now</strong>
          <h2>Separate beat</h2>
          <p>Add it now or before Buses. Alignment is handled later, so the files do not need the same start time.</p>
          {preview ? <span className={styles.previewAsset}>Late Nights Beat.wav</span> : <ProjectAudioUpload label="Beat" defaultKind="beat" description="Required from Buses onward" existingAsset={beat} />}
        </div>
      </div>
      <div className={styles.intentLocks}>
        <div><span>Artist intent locks</span><h2>Protect deliberate choices.</h2><p>Locks affect how optional guidance is worded. They do not suppress measurements.</p></div>
        {(["tone", "dynamics", "space"] as const).map((lock) => <button type="button" key={lock} className={intentLocks[lock] ? styles.intentLocked : ""} onClick={() => toggleIntentLock(lock)}>{intentLocks[lock] ? <Lock size={13} /> : <Unlock size={13} />}<span>{lock}</span><strong>{intentLocks[lock] ? "Preserve" : "Open"}</strong></button>)}
      </div>
      <div className={styles.targetPanel}>
        <div>
          <span>Direction</span><h2>Describe where this vocal should go.</h2>
          <p>Optional context guides interpretation. It never replaces measured evidence.</p>
          <textarea
            value={target.directionNote ?? ""}
            onChange={(event) =>
              setTarget({ ...target, directionNote: event.currentTarget.value })
            }
            placeholder="For example: intimate lead, controlled verses, wider hooks."
            maxLength={280}
          />
        </div>
        <div className={styles.targetAxes}>
          {primaryAxes.map(axis)}
          {moreOpen && detailAxes.map(axis)}
          <button type="button" className={styles.moreDirection} onClick={() => setMoreOpen(!moreOpen)}>
            {moreOpen ? "Show less" : "More detail"}
          </button>
        </div>
        <button type="button" onClick={() => void saveTarget()} disabled={preview || Boolean(busy)}>{busy === "saving" ? <LoaderCircle className={styles.spin} size={15} /> : <Check size={15} />} Save intent</button>
      </div>
    </section>
  );
}

function PrepareVocalStage({
  findings,
  measurements,
  selectedFinding,
  selectFinding,
  progress,
  limitations,
  skippedMeasurements,
  onRetry,
  hasVocal,
}: {
  findings: DiagnosisFinding[];
  measurements: Record<string, unknown> | null;
  selectedFinding: DiagnosisFinding | null;
  selectFinding: (id: string | null, range?: { start: number; end: number } | null) => void;
  progress: AnalysisProgressState;
  limitations: string[];
  skippedMeasurements: string[];
  onRetry: () => void;
  hasVocal: boolean;
}) {
  const preparationFindings = findings.filter(
    (finding) => finding.kind !== "collision" && finding.kind !== "low_mid"
  );
  const preparationSelection =
    preparationFindings.find((finding) => finding.id === selectedFinding?.id) ??
    preparationFindings[0] ??
    null;
  return (
    <section className={styles.setupStage}>
      <header><span>Stage 01 / Vocal Check</span><h1>Is this take ready to mix?</h1><p>MimiQ reviews the complete raw performance and returns measured, time-coded risks. Creative choices stay yours.</p></header>
      {!hasVocal && (
        <StagePreview
          title="See what Vocal Check will diagnose"
          items={["Time-coded performance risks", "Pitch and level consistency", "Recording problems and unknowns"]}
        />
      )}
      <PrepareCheckReport
        findings={preparationFindings}
        measurements={measurements}
        selectedFinding={preparationSelection}
        selectFinding={selectFinding}
        progress={progress}
        limitations={limitations}
        skippedMeasurements={skippedMeasurements}
        onRetry={onRetry}
      />
    </section>
  );
}

function PrepareCheckReport({
  findings,
  measurements,
  selectedFinding,
  selectFinding,
  progress,
  limitations,
  skippedMeasurements,
  onRetry,
}: {
  findings: DiagnosisFinding[];
  measurements: Record<string, unknown> | null;
  selectedFinding: DiagnosisFinding | null;
  selectFinding: (id: string | null, range?: { start: number; end: number } | null) => void;
  progress: AnalysisProgressState;
  limitations: string[];
  skippedMeasurements: string[];
  onRetry: () => void;
}) {
  const processing = ["preparing", "separating", "analyzing", "saving"].includes(progress.phase);
  const vocal = measurements?.vocal as Record<string, unknown> | null | undefined;
  const vocalCheck = measurements?.vocalCheck as Record<string, unknown> | null | undefined;
  const metric = (key: string, digits = 1) =>
    typeof vocal?.[key] === "number" ? (vocal[key] as number).toFixed(digits) : "Unknown";
  const overview = [
    ["LUFS", metric("lufs"), "BS.1770 integrated"],
    ["True peak", metric("true_peak_db"), "dBTP"],
    ["Dynamic range", metric("dynamic_range"), "dB percentile spread"],
    ["Noise floor", metric("noise_floor_db"), "dBFS"],
    ["Key", typeof vocalCheck?.detectedKey === "string" ? vocalCheck.detectedKey : "Unknown", "measured estimate"],
    ["BPM", typeof vocalCheck?.bpm === "number" ? Math.round(vocalCheck.bpm).toString() : "Unknown", "tempo estimate"],
    ["Voiced frames in key", typeof vocalCheck?.inKeyVoicedFrameRatio === "number" ? `${Math.round(vocalCheck.inKeyVoicedFrameRatio * 100)}%` : "Unknown", "reliably voiced frames"],
    ["Median pitch deviation", typeof vocalCheck?.medianPitchDeviationCents === "number" ? `${vocalCheck.medianPitchDeviationCents.toFixed(1)} ct` : "Unknown", "nearest semitone"],
  ];
  const hasReport = Boolean(measurements || findings.length);
  const verdict = !hasReport || skippedMeasurements.length > 0
    ? "Could not determine"
    : findings.some((finding) => finding.severity === "high")
      ? "Re-record recommended"
      : findings.length > 0
        ? "Mixable with repairs"
        : "Ready to mix";

  return <section className={styles.diagnosisReport}>
    {(processing || progress.phase === "failed") && (
      <div className={progress.phase === "failed" ? styles.recoveryPanel : styles.analysisProgress}>
        <div className={styles.progressGlyph}>{progress.phase === "failed" ? <AlertTriangle size={18} /> : <LoaderCircle className={styles.spin} size={18} />}</div>
        <div>
          <span>{progress.phase === "failed" ? "Vocal check paused" : "Measured vocal check"}</span>
          <h2>{progress.label}</h2>
          <p>{progress.message}</p>
          {progress.phase === "separating" && progress.progress != null && <div className={styles.realProgress} aria-label={`Stem separation ${progress.progress}%`}><i style={{ width: `${progress.progress}%` }} /><strong>{progress.progress}%</strong></div>}
        </div>
        {progress.phase === "failed" && <div className={styles.recoveryActions}>
          {progress.retryable && <button type="button" onClick={onRetry}>{progress.errorCode === "save_failed" ? "Retry saving" : "Retry vocal check"}</button>}
        </div>}
      </div>
    )}
    {!hasReport && !processing && progress.phase !== "failed" && <EmptyMeasured title="No vocal check yet" copy="Run the measured check. MimiQ will show skipped measurements instead of filling the page with guesses." />}
    {hasReport && <>
      <div className={styles.readinessVerdict} data-verdict={verdict}>
        <span>Measured readiness</span>
        <strong>{verdict}</strong>
        <p>{verdict === "Could not determine" ? "One or more required measurements were skipped. Review the limitations before continuing." : "This verdict summarizes measured thresholds; it does not judge the artistic performance."}</p>
      </div>
      <div className={styles.metricOverview}><header><span>Measured overview</span><strong>Whole take</strong></header><div>{overview.map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div></div>
      <div className={styles.diagnosisGrid}>
        <div className={styles.findings}><header>Readiness findings <span>Measured, not taste-scored</span></header>{findings.length ? findings.map((finding, index) => <button type="button" key={finding.id} className={selectedFinding?.id === finding.id ? styles.findingActive : ""} data-severity={finding.severity} onClick={() => selectFinding(finding.id, finding.evidence.startSeconds != null && finding.evidence.endSeconds != null ? { start: finding.evidence.startSeconds, end: finding.evidence.endSeconds } : null)}><b>{index + 1}</b><span><strong>{finding.title}</strong><small>{finding.evidence.startSeconds != null ? `${formatTime(finding.evidence.startSeconds)}–${formatTime(finding.evidence.endSeconds)}` : "Whole take"}</small></span><em>{finding.value != null ? finding.unit === "ratio" ? `${Math.round(finding.value * 100)}%` : `${finding.value.toFixed(1)} ${finding.unit ?? ""}` : "Measured"}</em></button>) : <p className={styles.noFindings}>No preparation issue crossed the measured thresholds. Beat collisions are reviewed later.</p>}</div>
        <div className={styles.evidence}><header>Evidence <span>{selectedFinding?.evidence.startSeconds != null ? `${formatTime(selectedFinding.evidence.startSeconds)}–${formatTime(selectedFinding.evidence.endSeconds)}` : "Whole take"}</span></header>{selectedFinding ? <><h2>{selectedFinding.title}.</h2><div className={styles.metricRow}><span>Vocal<strong>{selectedFinding.vocalEnergyDb != null ? `${selectedFinding.vocalEnergyDb.toFixed(1)} dB` : "—"}</strong></span><span>Beat<strong>{selectedFinding.beatEnergyDb != null ? `${selectedFinding.beatEnergyDb.toFixed(1)} dB` : "—"}</strong></span><span>Measured delta<strong>{selectedFinding.maskingDeltaDb != null ? `${selectedFinding.maskingDeltaDb.toFixed(1)} dB` : selectedFinding.value != null ? `${selectedFinding.value.toFixed(1)} ${selectedFinding.unit ?? ""}` : "—"}</strong></span></div><p>{selectedFinding.whyItMatters}</p></> : <p className={styles.noFindings}>Select a measured event to inspect its evidence.</p>}</div>
      </div>
      {(skippedMeasurements.length > 0 || limitations.length > 0) && <div className={styles.limitationsPanel}><div><span>Skipped checks</span><strong>{skippedMeasurements.length ? skippedMeasurements.join(", ") : "None"}</strong></div><div><span>Limitations and unknowns</span><ul>{limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div></div>}
    </>}
  </section>;
}

function MainChainStage({ plan, selectedFindingId, selectFinding, onToggle, preview }: { plan: MixPlan | null; selectedFindingId: string | null; selectFinding: (id: string | null, range?: { start: number; end: number } | null) => void; onToggle: (instruction: PluginInstruction) => Promise<void>; preview: boolean }) {
  if (!plan) return <StagePreview title="Explore the Vocal Chain" items={["Ordered stock-plugin signal flow", "Measured reason for each active move", "Optional Chain Print Check after you apply it"]} />;
  const equalizers = plan.instructions.filter((instruction) => instruction.capability === "equalizer");
  const selectedInstruction = plan.instructions.find((instruction) => instruction.findingId === selectedFindingId) ?? plan.instructions[0] ?? null;
  const chainSlots = [
    { name: "Noise control", role: "Only when measured", instruction: null, state: "Conditional" },
    { name: "Pitch correction", role: "Key + performance", instruction: plan.instructions.find((instruction) => instruction.capability === "pitch") ?? null, state: "Not mapped" },
    { name: "Corrective EQ", role: "Measured cleanup", instruction: equalizers[0] ?? null, state: "Measured" },
    { name: "De-esser", role: "Consonant control", instruction: plan.instructions.find((instruction) => instruction.capability === "de_esser") ?? null, state: "Conditional" },
    { name: "Fast compression", role: "Peak control", instruction: plan.instructions.find((instruction) => instruction.capability === "compressor") ?? null, state: "Not mapped" },
    { name: "Leveling", role: "Body + stability", instruction: null, state: "Optional" },
    { name: "Tone", role: "Artist choice", instruction: equalizers[1] ?? null, state: equalizers[1] ? "Measured" : "Optional" },
  ];
  return <section className={styles.mainChainStage}>
    <header><div><span>Stage 02 / Main chain</span><h1>Build the vocal from left to right.</h1><p>Each active step is tied to measured evidence. Optional tone moves stay optional.</p></div><strong>{plan.instructions.filter((instruction) => instruction.certified).length}/{plan.instructions.length} catalogue-backed</strong></header>
    <div className={styles.signalFlow} aria-label="Ordered main vocal chain">
      {chainSlots.map((slot, index) => <button type="button" key={slot.name} className={slot.instruction && selectedFindingId === slot.instruction.findingId ? styles.flowActive : ""} data-available={Boolean(slot.instruction)} onClick={() => { if (!slot.instruction) return; selectFinding(slot.instruction.findingId, slot.instruction.evidence.startSeconds != null && slot.instruction.evidence.endSeconds != null ? { start: slot.instruction.evidence.startSeconds, end: slot.instruction.evidence.endSeconds } : null); }}><b>{(index + 1).toString().padStart(2, "0")}</b><GitBranch size={15} /><span><strong>{slot.name}</strong><small>{slot.instruction?.action ?? slot.role}</small></span><em data-certified={Boolean(slot.instruction?.certified)}>{slot.instruction ? slot.instruction.certified ? "Verified" : "Unsupported" : slot.state}</em></button>)}
    </div>
    <div className={styles.planList}><header><span>DAW transfer sheet</span><strong>Apply, audition, then mark complete</strong></header>{plan.instructions.map((instruction) => <button type="button" key={instruction.id} className={selectedFindingId === instruction.findingId ? styles.planActive : ""} onClick={() => selectFinding(instruction.findingId, instruction.evidence.startSeconds != null && instruction.evidence.endSeconds != null ? { start: instruction.evidence.startSeconds, end: instruction.evidence.endSeconds } : null)}><b>{instruction.order}</b><span><strong>{instruction.action}</strong><small>{instruction.why}</small></span><em data-certified={instruction.certified}>{instruction.certified ? "Measured path" : "Unknown path"}</em><i role="checkbox" aria-checked={Boolean(plan.completion_state[instruction.id])} onClick={(event) => { event.stopPropagation(); if (!preview) void onToggle(instruction); }}>{plan.completion_state[instruction.id] ? <Check size={13} /> : null}</i></button>)}</div>
    {selectedInstruction && <details className={styles.inlineEvidence}><summary>Why, how, and measurement provenance</summary><div><section><span>Why this move</span><p>{selectedInstruction.why}</p></section><section><span>How to apply</span><p>Insert {selectedInstruction.pluginName ?? "the supported stock tool"}, apply the bounded settings shown above, and audition the measured range at matched loudness.</p></section><dl><div><dt>Measurement</dt><dd>{selectedInstruction.evidence.measurementKey}</dd></div><div><dt>Algorithm</dt><dd>{selectedInstruction.evidence.analysisVersion}</dd></div><div><dt>Catalogue</dt><dd>{selectedInstruction.pluginCatalogId ?? "Unsupported"}</dd></div></dl></div></details>}
  </section>;
}

function BusesStage({
  enabled,
  toggleBus,
  actionable,
  vocal,
  beat,
  vocalUrl,
  beatUrl,
  duration,
  preview,
  onSaveAlignment,
}: {
  enabled: Record<"parallel" | "reverb" | "delay", boolean>;
  toggleBus: (bus: "parallel" | "reverb" | "delay") => void;
  actionable: boolean;
  vocal: ProjectAudioAsset | null;
  beat: ProjectAudioAsset | null;
  vocalUrl: string | null;
  beatUrl: string | null;
  duration: number;
  preview: boolean;
  onSaveAlignment: (seconds: number) => Promise<void>;
}) {
  const [offset, setOffset] = useState(vocal?.timelineStartSeconds ?? 0);
  const buses = [
    { id: "parallel" as const, number: "A", name: "Parallel control", purpose: "Add density beneath the lead without flattening its main dynamics.", start: "Estimated starting range: heavy compression, low return." },
    { id: "reverb" as const, number: "B", name: "Short room", purpose: "Create front-to-back placement while keeping the lead readable.", start: "Estimated starting range: short decay, filtered return." },
    { id: "delay" as const, number: "C", name: "Delay throw", purpose: "Create phrase-end movement without washing the full performance.", start: "Optional creative move: automate selected words." },
  ];
  return <section className={styles.busStage}>
    <header><span>Stage 03 / Buses</span><h1>Add depth without rebuilding the lead.</h1><p>These are workflow starting points, not measured plugin values. Enable only the roles that serve the song, then set exact values by ear in context.</p></header>
    {vocal && beat && (vocal.alignedBeatAssetId !== beat.id || vocal.timelineStartSeconds == null) && <>
      <WorkspaceTimeline
        vocalUrl={vocalUrl}
        beatUrl={beatUrl}
        findings={[]}
        duration={duration}
        preview={preview}
        timelineStartSeconds={offset}
        vocalDuration={vocal.duration}
        alignmentMode
        onTimelineStartChange={setOffset}
      />
      <div className={styles.alignmentPanel}><div><span>Timeline alignment</span><h2>Where does vocal 0:00 begin on the beat?</h2><p>Drag the vocal waveform or enter the exact beat timestamp. Internal vocal pauses stay unchanged.</p></div><label><span>Beat timestamp</span><input type="number" min="0" step="0.1" value={offset} onChange={(event) => setOffset(Math.max(0, Number(event.currentTarget.value)))} /><strong>{formatTime(offset)}</strong></label><button type="button" onClick={() => void onSaveAlignment(offset)}>Confirm alignment</button></div>
    </>}
    <div className={styles.busWorkbench}>{buses.map((bus) => <article key={bus.id} data-enabled={enabled[bus.id]} data-actionable={actionable}><div className={styles.busNode}><b>{bus.number}</b><GitBranch size={16} /><span>Send</span></div><div><span>{actionable ? enabled[bus.id] ? "In workflow" : "Skipped" : "Preview"}</span><h2>{bus.name}</h2><p>{bus.purpose}</p><small>{bus.start}</small></div><button type="button" onClick={() => toggleBus(bus.id)} disabled={!actionable}>{enabled[bus.id] ? <Check size={13} /> : null}<span>{enabled[bus.id] ? "Enabled" : "Enable"}</span></button></article>)}</div>
    <div className={styles.evidenceNotice}><AlertTriangle size={15} /><div><strong>No invented bus settings</strong><p>MimiQ will not label time, feedback, drive, or send values as measured until the backend has the evidence and plugin catalogue mapping to support them.</p></div></div>
  </section>;
}

function MatchBeatStage({
  project,
  findings,
  selectedFinding,
  selectFinding,
  processed,
  beat,
  verificationRun,
}: {
  project: Project;
  findings: DiagnosisFinding[];
  selectedFinding: DiagnosisFinding | null;
  selectFinding: (id: string | null, range?: { start: number; end: number } | null) => void;
  processed: ProjectAudioAsset | null;
  beat: ProjectAudioAsset | null;
  verificationRun: AnalysisRun | null;
}) {
  const measuredFindings = verificationRun?.findings ?? findings;
  const collisions = measuredFindings.filter(
    (finding) =>
      finding.kind === "collision" ||
      finding.kind === "low_mid" ||
      finding.kind === "harshness"
  );
  const selected =
    collisions.find((finding) => finding.id === selectedFinding?.id) ??
    collisions[0] ??
    null;
  const source =
    getProcessedVocalAsset(project, "buses") ??
    getProcessedVocalAsset(project, "main_chain") ??
    getPrimaryVocalAsset(project);

  return <section className={styles.matchStage}>
    <header><span>Stage 04 / Match to beat</span><h1>Make space in context, not by chasing a preset sound.</h1><p>MimiQ separates measurable overlap from interpretation. A bright, narrow, distorted, or forward vocal can remain an intentional choice.</p></header>
    <div className={styles.matchUpload}><ProjectAudioUpload label="Latest processed vocal" defaultKind="processed" description="Separate vocal export after your current processing" existingAsset={processed} metadata={{ processingStage: "match_beat", sourceAssetId: source?.id ?? null, alignedBeatAssetId: beat?.id ?? null, timelineStartSeconds: source?.timelineStartSeconds ?? null }} /></div>
    {!processed || !beat ? (
      <StagePreview title="Explore the final context check" items={["Aligned vocal and beat timeline", "Time-coded masking and harshness", "Measured facts separated from optional actions"]} />
    ) : verificationRun ? collisions.length ? (
      <div className={styles.matchGrid}><div className={styles.collisionList}><header>Measured facts <span>Ranked by overlap</span></header>{collisions.map((finding, index) => <button type="button" key={finding.id} className={selected?.id === finding.id ? styles.collisionActive : ""} onClick={() => selectFinding(finding.id, finding.evidence.startSeconds != null && finding.evidence.endSeconds != null ? { start: finding.evidence.startSeconds, end: finding.evidence.endSeconds } : null)}><b>{index + 1}</b><span><strong>{finding.title}</strong><small>{formatTime(finding.evidence.startSeconds)}–{formatTime(finding.evidence.endSeconds)} · {formatFrequency(finding.evidence.frequencyLowHz)}–{formatFrequency(finding.evidence.frequencyHighHz)}</small></span><em>{finding.maskingDeltaDb != null ? `${finding.maskingDeltaDb.toFixed(1)} dB` : "Measured"}</em></button>)}</div><div className={styles.matchDecision}><span>Measured fact</span><h2>{selected?.title}</h2><p>{selected?.whyItMatters}</p><dl><div><dt>Vocal energy</dt><dd>{selected?.vocalEnergyDb != null ? `${selected.vocalEnergyDb.toFixed(1)} dB` : "Unknown"}</dd></div><div><dt>Beat energy</dt><dd>{selected?.beatEnergyDb != null ? `${selected.beatEnergyDb.toFixed(1)} dB` : "Unknown"}</dd></div><div><dt>Overlap delta</dt><dd>{selected?.maskingDeltaDb != null ? `${selected.maskingDeltaDb.toFixed(1)} dB` : "Unknown"}</dd></div></dl><section><span>Possible implication</span><p>This range may reduce intelligibility. That is context, not a command to reshape the artist.</p></section><section><span>Optional action</span><p>Loop the measured range and audition the smallest supported move. Keep it only if the vocal sits better without losing intent.</p></section></div></div>
    ) : (
      <EmptyMeasured title="No collision crossed the measured threshold" copy="The current final match run did not return a time-coded collision above its measurement threshold." />
    ) : (
      <EmptyMeasured title="Final match is ready" copy="Run Match to Beat to measure the separate processed vocal and aligned beat." />
    )}
  </section>;
}

function VerifyStage({
  stage,
  processed,
  source,
  beat,
  verificationRun,
  rawRun,
}: {
  stage: "main_chain" | "buses";
  project: Project;
  processed: ProjectAudioAsset | null;
  source: ProjectAudioAsset | null;
  beat: ProjectAudioAsset | null;
  verificationRun: AnalysisRun | null;
  rawRun: AnalysisRun | null;
}) {
  const raw = rawRun?.measurements.vocal as Record<string, number> | undefined;
  const measured = verificationRun?.measurements.vocal as Record<string, number> | undefined;
  const keys = [["lufs", "Integrated loudness"], ["true_peak_db", "True peak"], ["dynamic_range", "Dynamic range"]] as const;
  const label = stage === "main_chain" ? "Chain-processed vocal" : "Bus-processed vocal";
  return <section className={styles.verifyStage}><div className={styles.verifyUpload}><span>{label}</span><h2>{processed ? processed.filename : `Upload your ${stage === "main_chain" ? "Chain" : "Bus"} print`}</h2><p>{stage === "main_chain" ? "Compare the raw vocal with the result of the core chain. No beat is required." : "Compare the previous vocal state with the bus-processed print in the saved beat context."} A louder result is never treated as automatically better.</p><ProjectAudioUpload label={label} defaultKind="processed" description={`Optional export after applying ${stage === "main_chain" ? "the Vocal Chain" : "the enabled buses"}`} existingAsset={processed} metadata={{ processingStage: stage, sourceAssetId: source?.id ?? null, alignedBeatAssetId: stage === "buses" ? beat?.id ?? null : null, timelineStartSeconds: source?.timelineStartSeconds ?? null }} /></div>{verificationRun ? <div className={styles.deltaList}><header>Measured deltas <span>{stage === "main_chain" ? "Raw → Chain" : "Previous → Bus"}</span></header>{keys.map(([key, metricLabel]) => { const before = raw?.[key]; const after = measured?.[key]; const hasPair = typeof before === "number" && typeof after === "number"; const delta = hasPair ? after - before : null; return <div key={key}><span>{metricLabel}</span><strong>{delta == null ? "Unknown" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}</strong><small>{hasPair ? `${before.toFixed(1)} → ${after.toFixed(1)}` : "Could not be measured"}</small></div>;})}<p>Measured changes, regressions, and unknowns remain separate. Translation risks are estimates, not device simulation.</p></div> : <EmptyMeasured title={`${stage === "main_chain" ? "Chain" : "Bus"} Print Check is waiting`} copy={`Upload the ${stage === "main_chain" ? "Chain" : "Bus"} print, then run the optional measured comparison.`} />}</section>;
}

function StagePreview({ title, items }: { title: string; items: string[] }) {
  return <div className={styles.stagePreview}><div className={styles.previewGlyph}><Waves size={23} /></div><div><span>Explore before upload</span><h2>{title}</h2><p>These sections unlock with project-backed measurements. Nothing shown here is a simulated result.</p></div><ul>{items.map((item) => <li key={item}><CheckCircle2 size={13} />{item}</li>)}</ul></div>;
}

function EmptyMeasured({ title, copy }: { title: string; copy: string }) {
  return <div className={styles.emptyMeasured}><Waves size={25} /><h2>{title}</h2><p>{copy}</p></div>;
}
