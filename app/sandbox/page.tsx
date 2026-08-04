"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

import { eras, defaultEra, type Era } from "@/lib/eras";
import type {
  AudioMetrics,
  ChainStep,
  AnalysisResponse,
  AnalysisError,
  EvaluationResult,
  ProjectAudioAsset,
  VocalRoleEvidenceSource,
  VocalRoleId,
} from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AnimatedGrid } from "@/components/AnimatedGrid";
import { ProjectGate } from "@/components/ProjectGate";
import { ToolLockedOverlay } from "@/components/ToolLockedOverlay";
import { AudioAssetPicker } from "@/components/AudioAssetPicker";

import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/useAuth";
import { useAudioStore } from "@/lib/useAudioStore";
import { authHeaders } from "@/lib/apiAuth";
import { saveProjectPatch } from "@/lib/projects";
import {
  getFullSongAsset,
  getAssetPlaybackUrl,
  getPrimaryBeatAsset,
  getPrimaryVocalAsset,
  getProjectAudioAssets,
} from "@/lib/projectAudio";
import {
  getCurrentVocal,
  isGeneratedChain,
  useProject,
} from "@/lib/useProject";
import {
  defaultVocalRoleId,
  getGeneratedChainForRole,
  getProjectVocalArchitecture,
  getVocalRoleMeta,
  setActiveVocalRole,
  upsertVocalRoleChain,
  vocalRoles,
} from "@/lib/vocalArchitecture";
import { supabase } from "@/lib/supabase";
import type { GeneratedChain, ProjectPatch } from "@/lib/types";
import { VisualVocalChain } from "./VisualVocalChain";
import {
  buildAssistantModel,
  type AssistantFix,
  type AssistantModel,
} from "./chainLab/assistant";
import {
  buildMetricReadouts,
  formatInsights,
  hasMeasuredProvenance,
  measuredFitForProvenance,
  provenanceFromChainData,
  provenanceFromResult,
  SAFE_ANALYSIS_PROVENANCE,
  type AnalysisProvenance,
  type AudioInsights,
  type MetricReadout,
} from "./chainLab/metrics";
import styles from "./page.module.css";

/*
   Types
 */

type AppState = "empty" | "analyzing" | "results";
type SandboxMode = "view" | "edit";
type VocalChain = ChainStep[];
type GeneratedChainContext = Pick<
  GeneratedChain["chain_data"],
  | "sourceAssetId"
  | "beatAssetId"
  | "analysisInputKind"
  | "vocal_role_id"
  | "role_source"
  | "derived_from_chain_id"
>;

type EditState = {
  mode: SandboxMode;
  editedChain: VocalChain | null;
  isDirty: boolean;
  evaluationResult: EvaluationResult | null;
  feedbackPanelOpen: boolean;
  evaluating: boolean;
};

interface HighlightTarget {
  step: number;
  nonce: number;
}

const initialEditState: EditState = {
  mode: "view",
  editedChain: null,
  isDirty: false,
  evaluationResult: null,
  feedbackPanelOpen: false,
  evaluating: false,
};

/*
   Labels shown while analysis is running
 */

const ANALYSIS_STEPS = [
  "Reading loudness levels...",
  "Measuring dynamic range...",
  "Checking frequency balance...",
  "Mapping vocal character...",
];

/*
   Inline SVG icons
 */

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3,8 7,12 13,4" />
    </svg>
  );
}



/*
   API helper
 */

async function callAnalyze(params: {
  projectId?: string | null;
  vocalAssetId?: string | null;
  beatAssetId?: string | null;
  daw: string;
  mic?: string | null;
  plugins?: string[];
  eraId: string;
  vocalRoleId?: VocalRoleId;
  xyX?: number;
  xyY?: number;
  cachedMetrics?: AudioMetrics;
  cachedProvenance?: AnalysisProvenance | null;
  clientMetrics?: Partial<AudioMetrics>;
}): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("daw", params.daw);
  form.append("era", params.eraId);
  form.append("vocalRoleId", params.vocalRoleId ?? defaultVocalRoleId);

  if (params.projectId) form.append("projectId", params.projectId);
  if (params.vocalAssetId) form.append("vocalAssetId", params.vocalAssetId);
  if (params.beatAssetId) form.append("beatAssetId", params.beatAssetId);
  if (params.xyX != null) form.append("xyX", String(params.xyX));
  if (params.xyY != null) form.append("xyY", String(params.xyY));
  if (params.cachedMetrics) {
    form.append(
      "cachedMetrics",
      JSON.stringify({
        ...params.cachedMetrics,
        ...(params.cachedProvenance ?? SAFE_ANALYSIS_PROVENANCE),
      })
    );
  }

  const headers: Record<string, string> = {
    ...((await authHeaders()) as Record<string, string>),
  };
  if (params.clientMetrics) {
    headers["x-client-audio-metrics"] = JSON.stringify(params.clientMetrics);
  }

  const res = await fetch("/api/analyze", {
    method: "POST",
    body: form,
    headers,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as AnalysisError;
    throw body;
  }

  return (await res.json()) as AnalysisResponse;
}

async function callEvaluateChain(params: {
  chain: ChainStep[];
  metrics: AudioMetrics;
  genre: string;
  daw: string;
  iteration: number;
}): Promise<EvaluationResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((await authHeaders()) as Record<string, string>),
  };
  const res = await fetch("/api/evaluate-chain", {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error("Chain evaluation failed.");
  }

  return (await res.json()) as EvaluationResult;
}

function cloneChain(chain: ChainStep[]): ChainStep[] {
  if (typeof structuredClone === "function") {
    return structuredClone(chain);
  }

  return JSON.parse(JSON.stringify(chain)) as ChainStep[];
}

/*
   Chain edit helpers
 */

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const formatSignedDb = (value: number) =>
  `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}`;

const replaceOrAppend = (
  action: string,
  pattern: RegExp,
  replacement: string
) => (pattern.test(action) ? action.replace(pattern, replacement) : `${action}, ${replacement}`);

function scaleChainForXY(chain: ChainStep[], x: number, y: number) {
  const reverbMix = Math.round(clamp(x, 0, 1) * 30);
  const delayMix = Math.round(clamp(x, 0, 1) * 20);
  const airGain = Math.round((-4 + clamp(y, 0, 1) * 8) * 10) / 10;
  const deEssFrequency = Math.round(5000 + clamp(y, 0, 1) * 3000);

  return chain.map((step) => {
    const text = `${step.action} ${step.reason}`.toLowerCase();
    let action = step.action;

    if (text.includes("reverb")) {
      action = replaceOrAppend(action, /mix\s*[+\-−]?\d+(?:\.\d+)?%/i, `mix ${reverbMix}%`);
    } else if (
      text.includes("delay") ||
      text.includes("echo")
    ) {
      action = replaceOrAppend(action, /mix\s*[+\-−]?\d+(?:\.\d+)?%/i, `mix ${delayMix}%`);
    } else if (
      text.includes("de-esser") ||
      text.includes("deesser") ||
      text.includes("sibilance")
    ) {
      const targetPattern = /(target\s+)[+\-−]?\d+(?:\.\d+)?\s*(?:khz|hz)/i;
      action = targetPattern.test(action)
        ? action.replace(targetPattern, (_match, prefix: string) => `${prefix}${deEssFrequency} Hz`)
        : `${action}, Target ${deEssFrequency} Hz`;
    } else if (
      text.includes("air eq") ||
      text.includes("air ") ||
      text.includes("high shelf")
    ) {
      action = replaceOrAppend(
        action,
        /\b(gain|boost)\s*[+\-−]?\d+(?:\.\d+)?\s*dB/i,
        `$1 ${formatSignedDb(airGain)} dB`
      );
    }

    return action === step.action ? step : { ...step, action };
  });
}


const newClientId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
};

/*
   Transition Overlay Component
 */

function SandboxTransitionOverlay() {
  return (
    <div className={styles.cinematicOverlay}>
      <div className={styles.cinematicContent}>
        <div className={styles.cinematicTextContainer}>
          <span className={styles.cinematicTextMain}>
            creat
            <span className={styles.cinematicLetterE}>e</span>
            <span className={styles.cinematicLetterIng}>ing</span>
            {" what you thought isnt possible"}
          </span>
          <span className={styles.cinematicTextDot}>.</span>
        </div>
        <div className={styles.cinematicLoadingBarContainer}>
          <div className={styles.cinematicLoadingBarFill} />
        </div>
      </div>
    </div>
  );
}



/*
   Page component
 */

export default function SandboxPage() {
  /* Zustand Store */
  const { daw, mic, plugins, era: storeEra, setEra } = useStore();
  const setSession = useAudioStore((state) => state.setSession);
  const user = useAuth((state) => state.user);
  const project = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const updateProject = useProject((state) => state.updateProject);
  const vocalArchitecture = useMemo(
    () => getProjectVocalArchitecture(project),
    [project]
  );

  /* Core state */
  const [appState, setAppState] = useState<AppState>("empty");
  const [activeEra, setActiveEra] = useState<Era>(
    () => eras.find((e) => e.id === storeEra) || defaultEra
  );
  const [activeVocalRoleId, setActiveVocalRoleId] =
    useState<VocalRoleId>(defaultVocalRoleId);

  /* Sync activeEra when Zustand hydrates from localStorage */
  useEffect(() => {
    if (storeEra) {
      const era = eras.find((e) => e.id === storeEra);
      if (era && era.id !== activeEra.id) {
        const frame = requestAnimationFrame(() => setActiveEra(era));
        return () => cancelAnimationFrame(frame);
      }
    }
  }, [storeEra, activeEra.id]);

  const [selectedChainAssetId, setSelectedChainAssetId] = useState<string | null>(null);
  const [selectedBeatAssetId, setSelectedBeatAssetId] = useState<string | null>(null);
  const [selectedPlaybackUrl, setSelectedPlaybackUrl] = useState<string | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  /* Cinematic intro: only shown when arriving from onboarding */
  const [showCinematic, setShowCinematic] = useState(false);
  useEffect(() => {
    const fromOnboarding = sessionStorage.getItem("mimiq-from-onboarding");
    if (fromOnboarding) {
      sessionStorage.removeItem("mimiq-from-onboarding"); // Only show it once.
      const frame = requestAnimationFrame(() => setShowCinematic(true));
      return () => cancelAnimationFrame(frame);
    }
  }, []);

  /* Hydration guard to prevent FOUC of the default era */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* Real data from API */
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [engineerNote, setEngineerNote] = useState<string | null>(null);
  const [insights, setInsights] = useState<AudioInsights | null>(null);
  const [cachedMetrics, setCachedMetrics] = useState<AudioMetrics | null>(null);
  const [activeGeneratedChainId, setActiveGeneratedChainId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>(initialEditState);
  const [hasUnsavedEdit, setHasUnsavedEdit] = useState(false);
  const [evaluationIteration, setEvaluationIteration] = useState(0);
  const [chainFitGood, setChainFitGood] = useState(false);
  const [cachedAnalysisProvenance, setCachedAnalysisProvenance] =
    useState<AnalysisProvenance | null>(null);
  const [assistantHighlight, setAssistantHighlight] =
    useState<HighlightTarget | null>(null);
  const [audioPulse, setAudioPulse] = useState(0);

  /* Error states */
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  /* XY cursor position (normalised 0-1) */
  const [cursorX, setCursorX] = useState(0.55);
  const [cursorY, setCursorY] = useState(0.62);

  /* Whether the cursor has moved since the last full chain generation */
  const [hasPendingGenerate, setHasPendingGenerate] = useState(false);

  const padRef = useRef<HTMLDivElement>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveChainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<ChainStep[]>([]);
  const cursorRef = useRef({ x: 0.55, y: 0.62 });

  /* Era switching updates CSS variable */
  useIsomorphicLayoutEffect(() => {
    document.documentElement.style.setProperty("--accent", "#C8F135");
  }, [activeEra.id]);

  useEffect(() => {
    chainRef.current = chain;
  }, [chain]);

  useEffect(() => {
    cursorRef.current = { x: cursorX, y: cursorY };
  }, [cursorX, cursorY]);

  useEffect(
    () => () => {
      if (liveChainTimerRef.current) {
        clearTimeout(liveChainTimerRef.current);
      }
      if (assistantPulseTimerRef.current) {
        clearTimeout(assistantPulseTimerRef.current);
      }
    },
    []
  );

  /* Auto-dismiss error banner after 8s */
  const showBanner = useCallback((msg: string) => {
    setErrorBanner(msg);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setErrorBanner(null), 8000);
  }, []);

  const saveUserPrefs = useCallback(
    async (authedUser: User) => {
      try {
        await supabase.from("users").upsert({
          id: authedUser.id,
          daw: daw || "Logic Pro",
          genres: [activeEra.id],
        });
      } catch {
        // Preferences should never block saving the chain.
      }
    },
    [activeEra.id, daw]
  );

  const saveCurrentProject = useCallback(
    async (authedUser: User) => {
      if (!project || saveBusy) return;

      setSaveBusy(true);

      try {
        await saveUserPrefs(authedUser);

	        const now = new Date().toISOString();
	        const activeSavedChain =
	          project.generated_chains
	            .filter(isGeneratedChain)
	            .find((entry) => entry.id === activeGeneratedChainId) ??
	          getGeneratedChainForRole(project, activeVocalRoleId);
	        const selectedSourceAsset =
	          getProjectAudioAssets(project).find((asset) => asset.id === selectedChainAssetId) ??
	          null;
	        const analysisInputKind =
	          selectedSourceAsset?.kind === "vocal" || selectedSourceAsset?.kind === "full_song"
	            ? selectedSourceAsset.kind
	            : activeSavedChain?.chain_data.analysisInputKind;
	        let generatedChains = project.generated_chains;
	        let savedActiveChainId = activeGeneratedChainId;

	        if (chain.length > 0) {
	          const provenance =
	            cachedAnalysisProvenance ?? provenanceFromChainData(activeSavedChain?.chain_data);
	          const measuredProvenance = hasMeasuredProvenance(provenance);
	          const evaluationFit = editState.evaluationResult?.measured_fit;
	          const fit =
	            evaluationFit === "good" && !measuredProvenance
	              ? "unknown"
	              : evaluationFit ?? (chainFitGood && measuredProvenance ? "good" : undefined);
	          const nextId = activeGeneratedChainId ?? newClientId();
	          let replaced = false;

	          generatedChains = project.generated_chains.map((entry) => {
	            if (!isGeneratedChain(entry) || entry.id !== activeGeneratedChainId) {
	              return entry;
	            }

	            replaced = true;
	            return {
	              ...entry,
	              chain_data: {
	                ...entry.chain_data,
	                chain,
	                summary:
	                  entry.chain_data.summary ||
	                  engineerNote ||
	                  "Measured mimiq vocal chain.",
	                engineer_note: engineerNote ?? entry.chain_data.engineer_note,
	                measurements: cachedMetrics ?? entry.chain_data.measurements,
	                xyPosition: { x: cursorX, y: cursorY },
	                analysis_version: provenance.analysis_version,
	                vocal_role_id: activeVocalRoleId,
	                role_source:
	                  activeVocalRoleId === "lead"
	                    ? "measured_role"
	                    : activeSavedChain?.chain_data.role_source ?? "lead_derived",
	                derived_from_chain_id:
	                  activeSavedChain?.chain_data.derived_from_chain_id ?? null,
	                sourceAssetId:
	                  entry.chain_data.sourceAssetId ?? selectedChainAssetId ?? null,
	                beatAssetId:
	                  entry.chain_data.beatAssetId ?? selectedBeatAssetId ?? null,
	                ...(analysisInputKind ? { analysisInputKind } : {}),
	                fallback_used: provenance.fallback_used,
	                audio_service_status: provenance.audio_service_status,
	                ...(fit ? { measured_fit: fit } : {}),
	                ...(editState.evaluationResult
	                  ? {
	                      validation_timestamp: now,
	                      iteration_count: evaluationIteration,
	                      evaluation_summary: editState.evaluationResult.overall,
	                    }
	                  : {}),
	              },
	              genre: activeEra.id,
	              daw: daw || "Logic Pro",
	              sandbox_settings: {
	                ...entry.sandbox_settings,
	                era: activeEra.id,
	                mic,
	                plugins,
	                xyPosition: { x: cursorX, y: cursorY },
	              },
	            };
	          });

	          if (!replaced) {
	            const generated: GeneratedChain = {
	              id: nextId,
	              chain_data: {
	                chain,
	                summary:
	                  activeSavedChain?.chain_data.summary ||
	                  engineerNote ||
	                  "Measured mimiq vocal chain.",
	                engineer_note: engineerNote ?? activeSavedChain?.chain_data.engineer_note,
	                measurements: cachedMetrics ?? activeSavedChain?.chain_data.measurements,
	                xyPosition: { x: cursorX, y: cursorY },
	                analysis_version: provenance.analysis_version,
	                vocal_role_id: activeVocalRoleId,
	                role_source:
	                  activeVocalRoleId === "lead"
	                    ? "measured_role"
	                    : activeSavedChain?.chain_data.role_source ?? "lead_derived",
	                derived_from_chain_id:
	                  activeSavedChain?.chain_data.derived_from_chain_id ?? null,
	                sourceAssetId:
	                  activeSavedChain?.chain_data.sourceAssetId ?? selectedChainAssetId ?? null,
	                beatAssetId:
	                  activeSavedChain?.chain_data.beatAssetId ?? selectedBeatAssetId ?? null,
	                ...(analysisInputKind ? { analysisInputKind } : {}),
	                fallback_used: provenance.fallback_used,
	                audio_service_status: provenance.audio_service_status,
	                ...(fit ? { measured_fit: fit } : {}),
	                ...(editState.evaluationResult
	                  ? {
	                      validation_timestamp: now,
	                      iteration_count: evaluationIteration,
	                      evaluation_summary: editState.evaluationResult.overall,
	                    }
	                  : {}),
	              },
	              genre: activeEra.id,
	              daw: daw || "Logic Pro",
	              created_at: now,
	              sandbox_settings: {
	                era: activeEra.id,
	                mic,
	                plugins,
	                xyPosition: { x: cursorX, y: cursorY },
	              },
	            };

	            generatedChains = [generated, ...project.generated_chains];
	            savedActiveChainId = generated.id;
	          }
	        }

		        const audio_assets = getProjectAudioAssets(project);
		        const sourceAssetId =
		          activeSavedChain?.chain_data.sourceAssetId ?? selectedChainAssetId ?? null;
            const roleEvidence: VocalRoleEvidenceSource =
              activeVocalRoleId === "lead"
                ? "measured_role"
                : activeSavedChain?.chain_data.role_source ?? "lead_derived";
		        const patch: ProjectPatch = {
		          audio_assets,
		          generated_chains: generatedChains,
              vocal_architecture: savedActiveChainId
                ? upsertVocalRoleChain(project, activeVocalRoleId, savedActiveChainId, roleEvidence, {
                    sourceAssetId,
                    derivedFromChainId: activeSavedChain?.chain_data.derived_from_chain_id ?? null,
                    now,
                  })
                : setActiveVocalRole(project, activeVocalRoleId),
		          mix_room_report: project.mix_room_report,
		          level_lab_report: project.level_lab_report,
		          last_opened_at: now,
		        };

	        const saved = await saveProjectPatch(project.id, patch);
	        setActiveProject(saved);
	        if (savedActiveChainId) {
	          setActiveGeneratedChainId(savedActiveChainId);
	        }
	        showBanner("Chain saved.");
      } catch {
        showBanner("mimiq could not save this chain yet. Try again.");
        throw new Error("Save failed");
      } finally {
        setSaveBusy(false);
      }
    },
    [
	      activeEra.id,
	      activeGeneratedChainId,
        activeVocalRoleId,
	      cachedAnalysisProvenance,
	      cachedMetrics,
	      chain,
	      chainFitGood,
	      cursorX,
	      cursorY,
	      daw,
	      editState.evaluationResult,
	      engineerNote,
	      evaluationIteration,
	      mic,
	      plugins,
	      project,
	      saveBusy,
	      saveUserPrefs,
	      selectedBeatAssetId,
	      selectedChainAssetId,
      setActiveProject,
      showBanner,
    ]
  );

  const handleSaveChain = useCallback(async () => {
    if (!project || chain.length === 0 || saveBusy) return;

    if (!user) return;

    try {
      await saveCurrentProject(user);
    } catch {
      // saveCurrentProject already raised the visible banner.
    }
  }, [chain.length, project, saveBusy, saveCurrentProject, user]);

  useEffect(() => {
    if (!project) return;

    const currentVocal = getCurrentVocal(project);
    const projectArchitecture = getProjectVocalArchitecture(project);
    const activeRoleCandidate = projectArchitecture.active_role_id;
    const activeRoleChain = getGeneratedChainForRole(project, activeRoleCandidate);
    const leadChain = getGeneratedChainForRole(project, "lead");
    const selectedRoleId = activeRoleChain ? activeRoleCandidate : "lead";
    const selectedSavedChain = activeRoleChain ?? leadChain;
    const chainData = selectedSavedChain?.chain_data;
    const xyPosition = chainData?.xyPosition ?? { x: 0.55, y: 0.62 };
    const frame = requestAnimationFrame(() => {
      setUploadError(null);
      setActiveVocalRoleId(selectedRoleId);

      if (selectedSavedChain && chainData?.chain?.length && chainData.measurements) {
        const provenance = provenanceFromChainData(chainData);
        setChain(chainData.chain);
        setEngineerNote(chainData.engineer_note ?? null);
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
        setCachedAnalysisProvenance(provenance);
        setActiveGeneratedChainId(selectedSavedChain.id);
        setChainFitGood(chainData.measured_fit === "good");
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(chainData.iteration_count ?? 0);
        setCursorX(xyPosition.x);
        setCursorY(xyPosition.y);
        setHasPendingGenerate(false);
        setAppState("results");
	        setSession({
	          isAnalyzed: true,
	          analysisResult: {
            chain: chainData.chain,
            summary: chainData.summary,
            metrics: chainData.measurements,
            xyPosition,
            engineer_note: chainData.engineer_note,
            analysis_version: provenance.analysis_version,
            fallback_used: provenance.fallback_used,
            audio_service_status: provenance.audio_service_status,
          },
        });
        return;
      }

      if (currentVocal) {
        setChain([]);
        setEngineerNote(null);
        setInsights(null);
        setCachedMetrics(null);
        setCachedAnalysisProvenance(null);
        setActiveGeneratedChainId(null);
        setChainFitGood(false);
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(0);
        setHasPendingGenerate(false);
        setAppState("results");
	        setSession({
	          isAnalyzed: true,
	          analysisResult: null,
	        });
        return;
      }

      setChain([]);
      setEngineerNote(null);
      setInsights(null);
      setCachedMetrics(null);
      setCachedAnalysisProvenance(null);
      setActiveGeneratedChainId(null);
      setChainFitGood(false);
      setEditState(initialEditState);
      setHasUnsavedEdit(false);
      setEvaluationIteration(0);
      setHasPendingGenerate(false);
      setAppState("empty");
	      setSession({
	        isAnalyzed: false,
	        analysisResult: null,
	      });
    });

    return () => cancelAnimationFrame(frame);
  }, [project, setSession]);

  useEffect(() => {
    if (!project || typeof window === "undefined") return;

    const chainId = new URLSearchParams(window.location.search).get("chainId");
    if (!chainId) return;

    const selectedChain = project.generated_chains
      .filter(isGeneratedChain)
      .find((entry) => entry.id === chainId);
    if (!selectedChain) return;

    const chainData = selectedChain.chain_data;
    const roleId = chainData.vocal_role_id ?? "lead";
    const xyPosition = chainData.xyPosition ?? { x: 0.55, y: 0.62 };
    const provenance = provenanceFromChainData(chainData);

    const frame = requestAnimationFrame(() => {
      setActiveVocalRoleId(roleId);
      setChain(chainData.chain);
      setEngineerNote(chainData.engineer_note ?? null);
      if (chainData.measurements) {
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
        setCachedAnalysisProvenance(provenance);
      } else {
        setCachedAnalysisProvenance(null);
      }
      setActiveGeneratedChainId(selectedChain.id);
      setChainFitGood(chainData.measured_fit === "good");
      setEditState(initialEditState);
      setHasUnsavedEdit(false);
      setEvaluationIteration(chainData.iteration_count ?? 0);
      setCursorX(xyPosition.x);
      setCursorY(xyPosition.y);
      setHasPendingGenerate(false);
      setAppState("results");
      setSession({
        isAnalyzed: true,
        analysisResult: chainData.measurements
          ? {
              chain: chainData.chain,
              summary: chainData.summary,
              engineer_note: chainData.engineer_note,
              metrics: chainData.measurements,
              xyPosition,
              analysis_version: provenance.analysis_version,
              fallback_used: provenance.fallback_used,
              audio_service_status: provenance.audio_service_status,
            }
          : null,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [project, setSession]);

  const buildGeneratedChain = useCallback(
    (
      result: AnalysisResponse,
      eraId: string,
      xyX: number,
      xyY: number,
      context?: Partial<GeneratedChainContext>
    ): GeneratedChain => ({
      id: newClientId(),
      chain_data: {
        chain: result.chain,
        summary: result.summary,
        engineer_note: result.engineer_note,
        measurements: result.metrics,
        xyPosition: result.xyPosition ?? { x: xyX, y: xyY },
        analysis_version: result.analysis_version,
        vocal_role_id: context?.vocal_role_id ?? activeVocalRoleId,
        role_source:
          context?.role_source ??
          (activeVocalRoleId === "lead" ? "measured_role" : "lead_derived"),
        derived_from_chain_id: context?.derived_from_chain_id ?? null,
        ...(context?.sourceAssetId ? { sourceAssetId: context.sourceAssetId } : {}),
        ...(context?.beatAssetId ? { beatAssetId: context.beatAssetId } : {}),
        ...(context?.analysisInputKind
          ? { analysisInputKind: context.analysisInputKind }
          : {}),
        fallback_used: result.fallback_used,
        audio_service_status: result.audio_service_status,
      },
      genre: eraId,
      daw: daw || "Logic Pro",
      created_at: new Date().toISOString(),
      sandbox_settings: {
        era: eraId,
        mic,
        plugins,
        xyPosition: { x: xyX, y: xyY },
      },
    }),
    [activeVocalRoleId, daw, mic, plugins]
  );

  const persistProjectPatch = useCallback(
    async (patch: ProjectPatch) => {
      if (!project) return;

      updateProject(patch);

      try {
        const saved = await saveProjectPatch(project.id, patch);
        setActiveProject(saved);
      } catch {
        showBanner("Project updated locally, but Supabase did not save it yet.");
      }
    },
    [project, setActiveProject, showBanner, updateProject]
  );

	  const persistGeneratedResult = useCallback(
	    async (
	      result: AnalysisResponse,
      eraId: string,
      xyX: number,
      xyY: number,
      context?: Partial<GeneratedChainContext>
    ) => {
      if (!project) return;

      const generated = buildGeneratedChain(result, eraId, xyX, xyY, context);
      const roleId = generated.chain_data.vocal_role_id ?? activeVocalRoleId;
      const roleEvidence =
        generated.chain_data.role_source ??
        (roleId === "lead" ? "measured_role" : "lead_derived");
      setActiveGeneratedChainId(generated.id);
      setActiveVocalRoleId(roleId);
      setChainFitGood(false);
      setCachedAnalysisProvenance(provenanceFromResult(result));
      setEvaluationIteration(0);
      await persistProjectPatch({
        generated_chains: [generated, ...project.generated_chains],
        vocal_architecture: upsertVocalRoleChain(project, roleId, generated.id, roleEvidence, {
          sourceAssetId: generated.chain_data.sourceAssetId ?? null,
          derivedFromChainId: generated.chain_data.derived_from_chain_id ?? null,
        }),
      });
    },
	    [activeVocalRoleId, buildGeneratedChain, persistProjectPatch, project]
	  );

	  const regenerateChain = useCallback(
	    async (eraId: string, xyX: number, xyY: number) => {
	      if (!cachedMetrics) return;

	      if (liveChainTimerRef.current) {
	        clearTimeout(liveChainTimerRef.current);
	        liveChainTimerRef.current = null;
	      }

	      setChainLoading(true);
	      try {
	        const result = await callAnalyze({
	          daw: daw || "Logic Pro",
	          mic,
	          plugins,
	          eraId,
            vocalRoleId: activeVocalRoleId,
	          xyX,
	          xyY,
	          cachedMetrics,
	          cachedProvenance: cachedAnalysisProvenance,
	        });

	        const nextX = result.xyPosition?.x ?? xyX;
	        const nextY = result.xyPosition?.y ?? xyY;

	        setChain(result.chain);
	        setEngineerNote(result.engineer_note ?? null);
	        setInsights(formatInsights(result.metrics));
	        setCachedMetrics(result.metrics);
	        setCachedAnalysisProvenance(provenanceFromResult(result));
	        setCursorX(nextX);
	        setCursorY(nextY);
	        cursorRef.current = { x: nextX, y: nextY };
	        setHasPendingGenerate(false);
	        setChainFitGood(false);
	        setEditState(initialEditState);
	        setHasUnsavedEdit(false);
	        setEvaluationIteration(0);
	        setSession({
	          isAnalyzed: true,
	          analysisResult: result,
	          currentXyPosition: result.xyPosition,
	        });
	        const savedChainContext =
	          project?.generated_chains
	            .filter(isGeneratedChain)
	            .find((entry) => entry.id === activeGeneratedChainId)
	            ?.chain_data ?? getGeneratedChainForRole(project, activeVocalRoleId)?.chain_data;
	        void persistGeneratedResult(result, eraId, nextX, nextY, {
	          sourceAssetId: savedChainContext?.sourceAssetId,
	          beatAssetId: savedChainContext?.beatAssetId,
	          analysisInputKind: savedChainContext?.analysisInputKind,
            vocal_role_id: activeVocalRoleId,
            role_source:
              activeVocalRoleId === "lead"
                ? "measured_role"
                : savedChainContext?.role_source ?? "lead_derived",
            derived_from_chain_id: savedChainContext?.derived_from_chain_id ?? null,
	        });
	      } catch {
	        showBanner("Failed to regenerate chain. Try again.");
	      } finally {
	        setChainLoading(false);
	      }
	    },
	    [
	      cachedAnalysisProvenance,
	      cachedMetrics,
	      activeGeneratedChainId,
        activeVocalRoleId,
	      daw,
	      mic,
	      persistGeneratedResult,
	      plugins,
	      project,
	      setSession,
	      showBanner,
	    ]
	  );

	  const currentSavedFitGood = useCallback(() => {
    const saved = project?.generated_chains
      .filter(isGeneratedChain)
      .find((entry) => entry.id === activeGeneratedChainId) ??
      getGeneratedChainForRole(project, activeVocalRoleId);

    return (
      saved?.chain_data.measured_fit === "good" &&
      hasMeasuredProvenance(provenanceFromChainData(saved.chain_data))
    );
  }, [activeGeneratedChainId, activeVocalRoleId, project]);

  const applySavedChainToWorkspace = useCallback(
    (savedChain: GeneratedChain) => {
      const chainData = savedChain.chain_data;
      const xyPosition = chainData.xyPosition ?? { x: 0.55, y: 0.62 };
      const provenance = provenanceFromChainData(chainData);

      setChain(chainData.chain);
      setEngineerNote(chainData.engineer_note ?? null);
      if (chainData.measurements) {
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
      } else {
        setInsights(null);
        setCachedMetrics(null);
      }
      setCachedAnalysisProvenance(provenance);
      setActiveGeneratedChainId(savedChain.id);
      setChainFitGood(chainData.measured_fit === "good");
      setEditState(initialEditState);
      setHasUnsavedEdit(false);
      setEvaluationIteration(chainData.iteration_count ?? 0);
      setCursorX(xyPosition.x);
      setCursorY(xyPosition.y);
      cursorRef.current = xyPosition;
      setHasPendingGenerate(false);
      setAppState("results");
      setSession({
        isAnalyzed: true,
        analysisResult: chainData.measurements
          ? {
              chain: chainData.chain,
              summary: chainData.summary,
              metrics: chainData.measurements,
              xyPosition,
              engineer_note: chainData.engineer_note,
              analysis_version: provenance.analysis_version,
              fallback_used: provenance.fallback_used,
              audio_service_status: provenance.audio_service_status,
            }
          : null,
      });
    },
    [setSession]
  );

  const handleSelectVocalRole = useCallback(
    async (roleId: VocalRoleId) => {
      if (!project || editState.mode === "edit") return;

      setActiveVocalRoleId(roleId);
      const savedChain = getGeneratedChainForRole(project, roleId);
      if (savedChain) {
        applySavedChainToWorkspace(savedChain);
      } else {
        setChain([]);
        setEngineerNote(null);
        setInsights(null);
        setCachedMetrics(null);
        setCachedAnalysisProvenance(null);
        setActiveGeneratedChainId(null);
        setChainFitGood(false);
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(0);
        setHasPendingGenerate(false);
        setAppState("results");
      }

      await persistProjectPatch({
        vocal_architecture: setActiveVocalRole(project, roleId),
      });
    },
    [applySavedChainToWorkspace, editState.mode, persistProjectPatch, project]
  );

  const handleCreateVocalRole = useCallback(
    async (roleId: VocalRoleId) => {
      if (!project || chainLoading || editState.mode === "edit") return;

      if (roleId === "lead") return;

      const leadChain = getGeneratedChainForRole(project, "lead");
      const leadData = leadChain?.chain_data;
      if (
        !leadChain ||
        !leadData?.measurements ||
        !hasMeasuredProvenance(provenanceFromChainData(leadData))
      ) {
        showBanner("Measure the Lead before creating supporting vocal roles.");
        return;
      }

      const xyPosition = leadData.xyPosition ?? { x: cursorRef.current.x, y: cursorRef.current.y };
      setActiveVocalRoleId(roleId);
      setChainLoading(true);

      try {
        const result = await callAnalyze({
          daw: daw || "Logic Pro",
          mic,
          plugins,
          eraId: activeEra.id,
          vocalRoleId: roleId,
          xyX: xyPosition.x,
          xyY: xyPosition.y,
          cachedMetrics: leadData.measurements,
          cachedProvenance: provenanceFromChainData(leadData),
        });
        const nextX = result.xyPosition?.x ?? xyPosition.x;
        const nextY = result.xyPosition?.y ?? xyPosition.y;
        const generated = buildGeneratedChain(result, activeEra.id, nextX, nextY, {
          sourceAssetId: leadData.sourceAssetId ?? null,
          beatAssetId: leadData.beatAssetId ?? null,
          analysisInputKind: leadData.analysisInputKind,
          vocal_role_id: roleId,
          role_source: "lead_derived",
          derived_from_chain_id: leadChain.id,
        });

        setChain(result.chain);
        setEngineerNote(result.engineer_note ?? null);
        setInsights(formatInsights(result.metrics));
        setCachedMetrics(result.metrics);
        setCachedAnalysisProvenance(provenanceFromResult(result));
        setActiveGeneratedChainId(generated.id);
        setChainFitGood(false);
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(0);
        setCursorX(nextX);
        setCursorY(nextY);
        cursorRef.current = { x: nextX, y: nextY };
        setHasPendingGenerate(false);
        setAppState("results");
        setSession({
          isAnalyzed: true,
          analysisResult: result,
          currentXyPosition: result.xyPosition,
        });

        await persistProjectPatch({
          generated_chains: [generated, ...project.generated_chains],
          vocal_architecture: upsertVocalRoleChain(project, roleId, generated.id, "lead_derived", {
            sourceAssetId: leadData.sourceAssetId ?? null,
            derivedFromChainId: leadChain.id,
          }),
        });
      } catch {
        showBanner("mimiq could not create that role yet. Try again.");
      } finally {
        setChainLoading(false);
      }
    },
    [
      activeEra.id,
      buildGeneratedChain,
      chainLoading,
      daw,
      editState.mode,
      mic,
      persistProjectPatch,
      plugins,
      project,
      setSession,
      showBanner,
    ]
  );

  const handleEnterEditMode = useCallback(() => {
    if (chain.length === 0) return;

    setEditState({
      mode: "edit",
      editedChain: cloneChain(chain),
      isDirty: false,
      evaluationResult: null,
      feedbackPanelOpen: false,
      evaluating: false,
    });
    setHasUnsavedEdit(false);
  }, [chain]);

  const handleEditedChainChange = useCallback((nextChain: ChainStep[]) => {
    setEditState((state) => {
      if (state.mode !== "edit") return state;

      return {
        ...state,
        editedChain: nextChain,
        isDirty: true,
      };
    });
    setHasUnsavedEdit(true);
    setChainFitGood(false);
  }, []);

  const closeEditMode = useCallback(() => {
    setEditState(initialEditState);
    setHasUnsavedEdit(false);
  }, []);

  const handleDiscardEdit = useCallback(() => {
    setChainFitGood(currentSavedFitGood());
    closeEditMode();
  }, [closeEditMode, currentSavedFitGood]);

  const handleSaveEditedChain = useCallback(async () => {
    const editedChain = editState.editedChain;
    if (!editedChain) {
      closeEditMode();
      return;
    }

    const result = editState.evaluationResult;
    const measuredFit = measuredFitForProvenance(result?.measured_fit, cachedAnalysisProvenance);
    const fitGood =
      measuredFit === "good" && hasMeasuredProvenance(cachedAnalysisProvenance);
    const evaluationSummary =
      result?.overall ?? "Saved without a measured fit audit.";
    const iterationCount = Math.max(evaluationIteration, fitGood || result ? 1 : 0);
    const validationTimestamp = new Date().toISOString();

    setChain(editedChain);
    setChainFitGood(fitGood);

    if (project && activeGeneratedChainId) {
      let replaced = false;
      const generated_chains = project.generated_chains.map((entry) => {
        if (!isGeneratedChain(entry) || entry.id !== activeGeneratedChainId) {
          return entry;
        }

        replaced = true;
        return {
          ...entry,
          chain_data: {
            ...entry.chain_data,
            chain: editedChain,
            vocal_role_id: entry.chain_data.vocal_role_id ?? activeVocalRoleId,
            role_source:
              entry.chain_data.role_source ??
              (activeVocalRoleId === "lead" ? "measured_role" : "lead_derived"),
            measured_fit: measuredFit,
            validation_timestamp: validationTimestamp,
            iteration_count: iterationCount,
            evaluation_summary: evaluationSummary,
          },
        };
      });

      if (replaced) {
        await persistProjectPatch({
          generated_chains,
          vocal_architecture: upsertVocalRoleChain(
            project,
            activeVocalRoleId,
            activeGeneratedChainId,
            activeVocalRoleId === "lead" ? "measured_role" : "lead_derived",
            { now: validationTimestamp }
          ),
        });
      }
    }

    closeEditMode();
    showBanner(fitGood ? "Measured fit saved." : "Chain changes saved.");
  }, [
	    activeGeneratedChainId,
      activeVocalRoleId,
	    cachedAnalysisProvenance,
	    closeEditMode,
    editState.editedChain,
    editState.evaluationResult,
    evaluationIteration,
    persistProjectPatch,
    project,
    showBanner,
  ]);

  const handleEvaluateChain = useCallback(async () => {
    if (
      editState.mode !== "edit" ||
      !editState.editedChain ||
      !editState.isDirty ||
      editState.evaluating
    ) {
      return;
    }

    if (!cachedMetrics) {
      showBanner("mimiq needs vocal measurements before evaluating this chain.");
      return;
    }

    const nextIteration = evaluationIteration + 1;
    setEditState((state) => ({ ...state, evaluating: true }));

    try {
      const result = await callEvaluateChain({
        chain: editState.editedChain,
        metrics: cachedMetrics,
        genre: activeEra.id,
        daw: daw || "Logic Pro",
        iteration: nextIteration,
      });

      setEvaluationIteration(nextIteration);
      setChainFitGood(
        result.measured_fit === "good" && hasMeasuredProvenance(cachedAnalysisProvenance)
      );
      setEditState((state) => ({
        ...state,
        isDirty: false,
        evaluating: false,
        evaluationResult: result,
        feedbackPanelOpen: true,
      }));
    } catch {
      setEvaluationIteration(nextIteration);
      setChainFitGood(false);
      setEditState((state) => ({
        ...state,
        isDirty: false,
        evaluating: false,
        evaluationResult: {
          overall: "mimiq could not complete the chain audit.",
          issues: [
            {
              severity: "warning",
              plugin: "chain",
              problem: "The evaluation request did not complete.",
              fix: "Make one chain edit and evaluate again.",
              why: "A fresh edit gives the evaluator a clean request to inspect.",
            },
          ],
          strengths: [],
          measured_fit: "unknown",
          flags: ["evaluation_request_failed"],
          explanation: "The chain audit did not complete, so mimiq cannot label the edit as measured improvement.",
        },
        feedbackPanelOpen: true,
      }));
    }
  }, [
    activeEra.id,
    cachedAnalysisProvenance,
    cachedMetrics,
    daw,
    editState.editedChain,
    editState.evaluating,
    editState.isDirty,
    editState.mode,
    evaluationIteration,
    showBanner,
  ]);

  const handleFeedbackPanelOpenChange = useCallback((open: boolean) => {
    setEditState((state) => ({
      ...state,
      feedbackPanelOpen: open,
    }));
  }, []);

  useEffect(() => {
    if (editState.mode !== "edit") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleDiscardEdit();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editState.mode, handleDiscardEdit]);

  /* Handle era change */
	  const handleEraChange = useCallback(
	    async (era: Era) => {
	      setActiveEra(era);
	      setEra(era.id); // Persist user's manual era choice
	      if (appState === "results" && cachedMetrics && editState.mode !== "edit") {
	        const { x, y } = cursorRef.current;
	        await regenerateChain(era.id, x, y);
	      }
	    },
	    [
	      appState,
	      cachedMetrics,
	      editState.mode,
	      regenerateChain,
	      setEra,
	    ]
	  );

  const handleSelectedAssetAnalyze = useCallback(async () => {
    const asset =
      getProjectAudioAssets(project).find((item) => item.id === selectedChainAssetId) ??
      getPrimaryVocalAsset(project) ??
      getFullSongAsset(project);
    const beatAsset =
      getProjectAudioAssets(project).find((item) => item.id === selectedBeatAssetId) ??
      getPrimaryBeatAsset(project);

    if (!asset || !project) {
      setUploadError("Select or upload a vocal or full song in project audio.");
      return;
    }

    setUploadError(null);
    setAppState("analyzing");
    const MIN_ANALYZE_MS = 2600;
    const minDelay = new Promise<void>((resolve) =>
      setTimeout(resolve, MIN_ANALYZE_MS)
    );

    try {
      const [result] = await Promise.all([
        callAnalyze({
          projectId: project.id,
          vocalAssetId: asset.id,
          beatAssetId: beatAsset?.id ?? null,
          daw: daw || "Logic Pro",
          mic,
          plugins,
          eraId: activeEra.id,
          vocalRoleId: "lead",
        }),
        minDelay,
      ]);

      setChain(result.chain);
      setActiveVocalRoleId("lead");
      setEngineerNote(result.engineer_note ?? null);
      setInsights(formatInsights(result.metrics));
      setCachedMetrics(result.metrics);
      setCachedAnalysisProvenance(provenanceFromResult(result));
      setCursorX(result.xyPosition.x);
      setCursorY(result.xyPosition.y);
      setHasPendingGenerate(false);

      try {
        const leadRoleEvidence: VocalRoleEvidenceSource =
          result.audio_service_status === "ok" && !result.fallback_used
            ? "measured_role"
            : "saved_project_data";
	        const generated = buildGeneratedChain(
	          result,
	          activeEra.id,
	          result.xyPosition.x,
	          result.xyPosition.y,
	          {
	            sourceAssetId: asset.id,
	            beatAssetId: beatAsset?.id ?? null,
	            analysisInputKind:
	              asset.kind === "full_song" ? "full_song" : "vocal",
              vocal_role_id: "lead",
              role_source: leadRoleEvidence,
              derived_from_chain_id: null,
	          }
	        );
        setActiveGeneratedChainId(generated.id);
        setChainFitGood(false);
        setEvaluationIteration(0);
        await persistProjectPatch({
          generated_chains: [generated, ...project.generated_chains],
          vocal_architecture: upsertVocalRoleChain(project, "lead", generated.id, leadRoleEvidence, {
            sourceAssetId: asset.id,
          }),
        });
      } catch {
        showBanner("Analysis finished, but the generated chain did not save yet.");
      }

      setSession({
        isAnalyzed: true,
        analysisResult: result,
      });
      setAppState("results");
    } catch (err: unknown) {
      await minDelay;
      const apiErr = err as AnalysisError;
      showBanner(
        apiErr?.message || "Something went wrong during analysis."
      );
      setAppState("empty");
    }
  }, [
    activeEra.id,
    buildGeneratedChain,
    daw,
    mic,
    persistProjectPatch,
    plugins,
    project,
    selectedBeatAssetId,
    selectedChainAssetId,
    setSession,
    showBanner,
  ]);


  /* XY pad drag */
  const isDragging = useRef(false);

	  /* Generate Chain */
	  const handleGenerate = useCallback(async () => {
	    await regenerateChain(activeEra.id, cursorRef.current.x, cursorRef.current.y);
	  }, [activeEra.id, regenerateChain]);

  const handleResetChain = useCallback(() => {
    const savedChain =
      project?.generated_chains
        .filter(isGeneratedChain)
        .find((entry) => entry.id === activeGeneratedChainId) ??
      getGeneratedChainForRole(project, activeVocalRoleId);

    if (!savedChain) {
      handleDiscardEdit();
      return;
    }

    const chainData = savedChain.chain_data;
    const xyPosition = chainData.xyPosition ?? { x: 0.55, y: 0.62 };
    const provenance = provenanceFromChainData(chainData);

    setChain(chainData.chain);
    setEngineerNote(chainData.engineer_note ?? null);
    if (chainData.measurements) {
      setInsights(formatInsights(chainData.measurements));
      setCachedMetrics(chainData.measurements);
    }
    setCachedAnalysisProvenance(provenance);
    setActiveGeneratedChainId(savedChain.id);
    setChainFitGood(chainData.measured_fit === "good");
    setEditState(initialEditState);
    setHasUnsavedEdit(false);
    setEvaluationIteration(chainData.iteration_count ?? 0);
    setCursorX(xyPosition.x);
    setCursorY(xyPosition.y);
    setHasPendingGenerate(false);
    showBanner("Chain reset to the saved project state.");
  }, [activeGeneratedChainId, activeVocalRoleId, handleDiscardEdit, project, showBanner]);

  const handleAssistantFix = useCallback((fix: AssistantFix) => {
    if (!fix.targetStep) return;

    if (assistantPulseTimerRef.current) {
      clearTimeout(assistantPulseTimerRef.current);
    }

    setAssistantHighlight(null);
    requestAnimationFrame(() => {
      setAssistantHighlight((current) => ({
        step: fix.targetStep!,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    });

    assistantPulseTimerRef.current = setTimeout(() => {
      setAssistantHighlight(null);
    }, 900);
  }, []);

  const applyLiveXYChain = useCallback((x: number, y: number) => {
    const currentChain = chainRef.current;
    if (currentChain.length === 0) return;

    setChain(scaleChainForXY(currentChain, x, y));
  }, []);

  const scheduleLiveXYChain = useCallback(
    (x: number, y: number) => {
      if (liveChainTimerRef.current) {
        clearTimeout(liveChainTimerRef.current);
      }

      liveChainTimerRef.current = setTimeout(() => {
        applyLiveXYChain(x, y);
      }, 300);
    },
    [applyLiveXYChain]
  );

  const updateCursorFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return null;
      const rect = pad.getBoundingClientRect();
      const newX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newY = Math.max(
        0,
        Math.min(1, 1 - (clientY - rect.top) / rect.height)
      );
      const moved =
        Math.abs(newX - cursorRef.current.x) > 0.001 ||
        Math.abs(newY - cursorRef.current.y) > 0.001;
      setCursorX(newX);
      setCursorY(newY);
      if (moved && appState === "results" && cachedMetrics) {
        setHasPendingGenerate(true);
      }
      cursorRef.current = { x: newX, y: newY };
      return { x: newX, y: newY };
    },
    [appState, cachedMetrics]
  );

  const handleSliderX = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newX = parseFloat(e.target.value);
    const next = { x: newX, y: cursorRef.current.y };
    cursorRef.current = next;
    setCursorX(newX);
    if (cachedMetrics) {
      setHasPendingGenerate(true);
    }
    scheduleLiveXYChain(next.x, next.y);
  }, [cachedMetrics, scheduleLiveXYChain]);

  const handleSliderY = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newY = parseFloat(e.target.value);
    const next = { x: cursorRef.current.x, y: newY };
    cursorRef.current = next;
    setCursorY(newY);
    if (cachedMetrics) {
      setHasPendingGenerate(true);
    }
    scheduleLiveXYChain(next.x, next.y);
  }, [cachedMetrics, scheduleLiveXYChain]);

  const handlePadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const position = updateCursorFromPointer(e.clientX, e.clientY);
      if (position) {
        scheduleLiveXYChain(position.x, position.y);
      }
    },
    [scheduleLiveXYChain, updateCursorFromPointer]
  );

  const handlePadPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const position = updateCursorFromPointer(e.clientX, e.clientY);
      if (position) {
        scheduleLiveXYChain(position.x, position.y);
      }
    },
    [scheduleLiveXYChain, updateCursorFromPointer]
  );

  const handlePadPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    const position = updateCursorFromPointer(e.clientX, e.clientY);
    if (position) {
      scheduleLiveXYChain(position.x, position.y);
      if (cachedMetrics && appState === "results" && editState.mode !== "edit") {
        void regenerateChain(activeEra.id, position.x, position.y);
      }
    }
  }, [
    activeEra.id,
    appState,
    cachedMetrics,
    editState.mode,
    regenerateChain,
    scheduleLiveXYChain,
    updateCursorFromPointer,
  ]);

  /*
     Render
 */

  const isEditing = editState.mode === "edit";
  const displayedChain =
    isEditing && editState.editedChain ? editState.editedChain : chain;
  const showMeasuredFitBadge =
    !editState.isDirty &&
    hasMeasuredProvenance(cachedAnalysisProvenance) &&
    (chainFitGood || editState.evaluationResult?.measured_fit === "good");
	  const currentVocal = project ? getCurrentVocal(project) : null;
    const projectAudioAssets = getProjectAudioAssets(project);
    const selectedChainAsset =
      projectAudioAssets.find((asset) => asset.id === selectedChainAssetId) ??
      getPrimaryVocalAsset(project) ??
      getFullSongAsset(project);
    const selectedBeatAsset =
      projectAudioAssets.find((asset) => asset.id === selectedBeatAssetId) ??
      getPrimaryBeatAsset(project);
    const rawAudioUrl = selectedPlaybackUrl;
    const processedAudioUrl = null;
    const hasBeatContext = Boolean(selectedBeatAsset);
    const hasVocalChainAsset =
      selectedChainAsset?.kind === "full_song" || selectedChainAsset?.kind === "vocal";
    const playbackAssetId = selectedChainAsset?.id ?? null;
    const playbackAssetKind = selectedChainAsset?.kind ?? null;
    const playbackAssetFilename = selectedChainAsset?.filename ?? null;
    const playbackAssetMimeType = selectedChainAsset?.mimeType ?? "audio/mpeg";
    const playbackAssetSize = selectedChainAsset?.size ?? 0;
    const playbackAssetDuration = selectedChainAsset?.duration ?? null;
    const playbackAssetStoragePath = selectedChainAsset?.storagePath ?? null;
    const playbackAssetCreatedAt = selectedChainAsset?.createdAt ?? new Date(0).toISOString();
    const playbackAssetStatus = selectedChainAsset?.status ?? "ready";
    const playbackAssetError = selectedChainAsset?.error ?? null;
    const activeVocalRole = vocalArchitecture.roles[activeVocalRoleId];
    const activeRoleMeta = getVocalRoleMeta(activeVocalRoleId);
    const activeRoleCreated = activeVocalRole?.status === "created";
    const leadHasMeasuredContext = Boolean(
      getGeneratedChainForRole(project, "lead")?.chain_data.measurements &&
        hasMeasuredProvenance(
          provenanceFromChainData(getGeneratedChainForRole(project, "lead")!.chain_data)
        )
    );
    const showRoleCreateState =
      activeVocalRoleId !== "lead" &&
      !activeRoleCreated &&
      appState !== "analyzing" &&
      !chainLoading;
    const roleSourceLabel =
      activeVocalRole?.evidence_source === "measured_role"
        ? "Measured role"
        : activeVocalRole?.evidence_source === "lead_derived"
          ? "Lead-derived"
          : activeVocalRole?.evidence_source === "saved_project_data"
            ? "Saved data"
            : "Unknown source";
    useEffect(() => {
      let alive = true;

      const playbackAsset: ProjectAudioAsset | null =
        playbackAssetId && playbackAssetKind && playbackAssetFilename
          ? {
              id: playbackAssetId,
              kind: playbackAssetKind,
              filename: playbackAssetFilename,
              mimeType: playbackAssetMimeType,
              size: playbackAssetSize,
              duration: playbackAssetDuration,
              storagePath: playbackAssetStoragePath,
              createdAt: playbackAssetCreatedAt,
              status: playbackAssetStatus,
              error: playbackAssetError,
            }
          : null;

      void getAssetPlaybackUrl(playbackAsset).then((url) => {
        if (alive) setSelectedPlaybackUrl(url);
      });

      return () => {
        alive = false;
      };
    }, [
      playbackAssetCreatedAt,
      playbackAssetDuration,
      playbackAssetError,
      playbackAssetFilename,
      playbackAssetId,
      playbackAssetKind,
      playbackAssetMimeType,
      playbackAssetSize,
      playbackAssetStatus,
      playbackAssetStoragePath,
    ]);
	  const metricReadouts = useMemo(
    () =>
      buildMetricReadouts(
        insights,
        cachedMetrics,
        displayedChain,
        activeEra.id,
        cachedAnalysisProvenance
      ),
    [cachedAnalysisProvenance, cachedMetrics, displayedChain, insights, activeEra.id]
  );
  const assistantModel = useMemo(
    () =>
	      buildAssistantModel(
	        cachedMetrics,
	        displayedChain,
	        activeEra.id,
	        cachedAnalysisProvenance,
	        editState.isDirty ? null : editState.evaluationResult
	      ),
	    [
	      activeEra.id,
	      cachedAnalysisProvenance,
	      cachedMetrics,
	      displayedChain,
	      editState.evaluationResult,
	      editState.isDirty,
	    ]
	  );

  if (!mounted) return null;

  return (
    <ProjectGate>
    <div className={styles.layout}>
      {/*
          Entry overlay, only from onboarding
 */}
      {showCinematic && <SandboxTransitionOverlay />}

      {/*
          ERROR BANNER
 */}
      {errorBanner && (
        <div className={styles.errorBanner}>
          <span className={styles.errorBannerText}>{errorBanner}</span>
          <button
            className={styles.errorBannerDismiss}
            onClick={() => setErrorBanner(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/*
          SIDEBAR & MAIN CONTENT
 */}
      <Sidebar
        activePage="sandbox"
        savedCount={project?.generated_chains?.filter(isGeneratedChain).length ?? 0}
        dimNavItems={isEditing}
      />

      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }}>
        <header className="globalToolHeader">
          <div className="globalToolHeaderTitle">
            <span>Studio</span>
            <h1>Chain Lab</h1>
          </div>
          <div className="globalToolHeaderPickers">
	            <AudioAssetPicker
	              label="Vocal"
	              value={selectedChainAsset?.kind === "vocal" ? selectedChainAsset.id : null}
	              onChange={setSelectedChainAssetId}
	              allowedKinds={["vocal"]}
              emptyLabel="No vocal"
              warning="Best results need isolated vocal."
              variant="compact"
            />
            <AudioAssetPicker
              label="Beat"
              value={selectedBeatAsset?.id ?? selectedBeatAssetId}
              onChange={setSelectedBeatAssetId}
              allowedKinds={["beat"]}
              emptyLabel="No beat"
              variant="compact"
            />
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>OR</div>
	            <AudioAssetPicker
	              label="Song"
	              value={selectedChainAsset?.kind === "full_song" ? selectedChainAsset.id : null}
	              onChange={setSelectedChainAssetId}
              allowedKinds={["full_song"]}
              emptyLabel="No song"
              variant="compact"
            />
          </div>
        </header>

        <ToolLockedOverlay
        key={project ? `${project.id}:chain` : "chain"}
        locked={!hasVocalChainAsset}
        className={styles.studioContent}
        momentKey={project ? `${project.id}:chain` : "chain"}
      >
	        <WorkspaceMetricsBar
	          readouts={metricReadouts}
	          provenance={cachedAnalysisProvenance}
	          busyLabel={
	            appState === "analyzing"
	              ? "Analyzing"
	              : chainLoading
	                ? "Generating"
	                : null
	          }
	          canAnalyze={Boolean(cachedMetrics) && !chainLoading && !isEditing}
	          onAnalyze={handleGenerate}
	        />

          <section className={styles.roleSelector} aria-label="Vocal architecture roles">
            {vocalRoles.map((role) => {
              const projectRole = vocalArchitecture.roles[role.id];
              const roleChain = getGeneratedChainForRole(project, role.id);
              const isActive = role.id === activeVocalRoleId;
              const isCreated = projectRole.status === "created" || Boolean(roleChain);
              const evidence =
                projectRole.evidence_source === "measured_role"
                  ? "measured"
                  : projectRole.evidence_source === "lead_derived"
                    ? "lead-derived"
                    : projectRole.evidence_source === "saved_project_data"
                      ? "saved"
                      : "not created";

              return (
                <div
                  key={role.id}
                  className={`${styles.roleCard} ${isActive ? styles.roleCardActive : ""}`}
                >
                  <button
                    type="button"
                    className={styles.roleCardMain}
                    onClick={() => void handleSelectVocalRole(role.id)}
                    disabled={editState.mode === "edit"}
                    aria-pressed={isActive}
                  >
                    <span className={styles.roleCardLabel}>{role.shortLabel}</span>
                    <span className={styles.roleCardState}>{evidence}</span>
                  </button>
                  {!isCreated && role.id !== "lead" && (
                    <button
                      type="button"
                      className={styles.roleCreateButton}
                      onClick={() => void handleCreateVocalRole(role.id)}
                      disabled={
                        !leadHasMeasuredContext ||
                        chainLoading ||
                        editState.mode === "edit"
                      }
                    >
                      Create
                    </button>
                  )}
                </div>
              );
            })}
          </section>

        <main className={`${styles.chainWorkspace} ${isEditing ? styles.editDimmed : ""}`}>
          <header className={styles.workspaceHeader}>
            <div>
              <span className={styles.chainTitle}>Vocal Chain</span>
              <h1>{activeRoleMeta.label}</h1>
            </div>
            <div className={styles.workspaceActions}>
              <span className={styles.roleSourceBadge}>{roleSourceLabel}</span>
              {isEditing && <span className={styles.editingBadge}>Editing</span>}
              <span className={styles.optimizeLabel}>Optimize for</span>
              <span className={styles.optimizePill}>{activeEra.name}</span>
              {chain.length > 0 && !isEditing && (
                <button
                  type="button"
                  className={styles.saveChainButton}
                  onClick={handleSaveChain}
	                  disabled={saveBusy}
	                >
	                  {saveBusy ? "Saving chain" : "Save chain"}
	                </button>
              )}
            </div>
          </header>

          <section
            className={styles.chainCanvas}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeVocalRoleId}
                className={styles.roleStage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {showRoleCreateState && (
                  <div className={styles.roleEmptyState}>
                    <span className={styles.roleEmptyKicker}>7-track architecture</span>
                    <h2>{activeRoleMeta.label}</h2>
                    <p>{activeRoleMeta.description}</p>
                    <p className={styles.roleSourceNote}>
                      Create uses the Lead measurements first. Upload role-specific audio later for a measured-role chain.
                    </p>
                    <button
                      type="button"
                      className={styles.roleEmptyAction}
                      onClick={() => void handleCreateVocalRole(activeVocalRoleId)}
                      disabled={!leadHasMeasuredContext || chainLoading}
                    >
                      {leadHasMeasuredContext
                        ? activeRoleMeta.createLabel
                        : "Measure Lead first"}
                    </button>
                  </div>
                )}

                {!showRoleCreateState && appState === "empty" && (
                  <>
                    <div style={{ position: "relative", zIndex: 1, opacity: 0.3, pointerEvents: "none" }}>
                      <VisualVocalChain
                        chain={[
                          { step: 1, tool: "Gain", action: "Reduce input gain by -2 dB", reason: "Headroom" },
                          { step: 2, tool: "De-Esser", action: "Tame sibilance at 6kHz", reason: "Harshness" },
                          { step: 3, tool: "EQ", action: "High-pass at 85Hz", reason: "Remove rumble" },
                          { step: 4, tool: "Compressor", action: "4:1 fast attack", reason: "Dynamic control" },
                          { step: 5, tool: "EQ", action: "Boost high shelf by +1.5 dB", reason: "Air" }
                        ]}
                        mode="view"
                      />
                    </div>

                    <div className={styles.studioDropState} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
                      {uploadError && (
                        <span className={styles.uploadErrorInline}>{uploadError}</span>
                      )}
                      <button
                        type="button"
                        className={styles.skipLink}
                        onClick={() => void handleSelectedAssetAnalyze()}
                        disabled={!selectedChainAsset}
                      >
                        Generate Lead chain from selected asset
                      </button>
                    </div>
                  </>
                )}

                {!showRoleCreateState && appState === "analyzing" && (
                  <div className={styles.analysisCard}>
                    {ANALYSIS_STEPS.map((step, i) => (
                      <div key={i} className={styles.analysisRow}>
                        <span className={styles.analysisText}>{step}</span>
                        <CheckIcon className={styles.analysisCheck} />
                      </div>
                    ))}
                  </div>
                )}

	                {!showRoleCreateState && appState === "results" && chainLoading && (
	                  <div className={styles.skeleton}>
	                    <span className={styles.skeletonLabel}>
	                      Regenerating chain from measured vocal context...
	                    </span>
	                    <div className={styles.skeletonLine} />
	                    <div className={styles.skeletonLine} />
	                    <div className={styles.skeletonLine} />
                  </div>
                )}

                {!showRoleCreateState && appState === "results" && !chainLoading && chain.length === 0 && (
                  <div className={styles.rightEmpty}>
                    <span className={styles.rightEmptyDesc}>
                      Drag the XY cursor or upload audio to generate a chain.
                    </span>
                  </div>
                )}

                {!showRoleCreateState && appState === "results" && !chainLoading && displayedChain.length > 0 && (
                  <VisualVocalChain
                    chain={displayedChain}
                    engineerNote={engineerNote}
                    mode={editState.mode}
                    isDirty={editState.isDirty}
                    hasUnsavedChanges={hasUnsavedEdit}
                    evaluating={editState.evaluating}
                    evaluationResult={editState.evaluationResult}
                    feedbackPanelOpen={editState.feedbackPanelOpen}
                    displayedMeasuredFit={measuredFitForProvenance(
                      editState.evaluationResult?.measured_fit,
                      cachedAnalysisProvenance
                    )}
                    currentGenre={activeEra.id}
                    currentDaw={daw || "Logic Pro"}
                    measuredFit={
                      showMeasuredFitBadge ? "good" : editState.evaluationResult?.measured_fit
                    }
                    assistantHighlight={assistantHighlight}
                    audioPulse={audioPulse}
                    onEnterEditMode={handleEnterEditMode}
                    onEditedChainChange={handleEditedChainChange}
                    onEvaluate={handleEvaluateChain}
                    onConfirmSave={handleSaveEditedChain}
                    onDiscard={handleDiscardEdit}
                    onFeedbackPanelOpenChange={handleFeedbackPanelOpenChange}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </main>

        <AssistantPanel
          activeEra={activeEra}
          model={assistantModel}
          eras={eras}
          canApply={Boolean(cachedMetrics) && !chainLoading && !isEditing}
          applying={chainLoading}
          cursorX={cursorX}
          cursorY={cursorY}
          hasPendingGenerate={hasPendingGenerate}
          padRef={padRef}
          onEraChange={handleEraChange}
          onApply={handleGenerate}
          onReset={handleResetChain}
          onFixSelect={handleAssistantFix}
          onSliderX={handleSliderX}
          onSliderY={handleSliderY}
          onPadPointerDown={handlePadPointerDown}
          onPadPointerMove={handlePadPointerMove}
          onPadPointerUp={handlePadPointerUp}
        />

	        <AudioTransport
	          rawUrl={rawAudioUrl}
	          processedUrl={processedAudioUrl}
	          trackName={selectedChainAsset?.filename ?? currentVocal?.label ?? project?.name ?? "Lead Vocal"}
	          trackLabel={hasBeatContext ? "vocal + beat context" : "lead vocal"}
          lufs={metricReadouts[0]?.value}
          onPulseChange={setAudioPulse}
        />
      </ToolLockedOverlay>
      </div>

      {/*
          MOBILE BOTTOM TAB BAR
 */}
      <MobileTabBar activePage="sandbox" />

    </div>
    </ProjectGate>
  );
}

function AnimatedMetricValue({ value }: { value: string }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const nextNumber = Number(value.match(/[+\-−]?\d+(?:\.\d+)?/)?.[0]?.replace("−", "-"));
    const prevNumber = Number(previous.current.match(/[+\-−]?\d+(?:\.\d+)?/)?.[0]?.replace("−", "-"));
    const suffix = value.replace(/[+\-−]?\d+(?:\.\d+)?/, "");

    if (!Number.isFinite(nextNumber) || !Number.isFinite(prevNumber)) {
      previous.current = value;
      setDisplay(value);
      return;
    }

    let frame = 0;
    const frames = 12;
    const timer = window.setInterval(() => {
      frame += 1;
      const t = frame / frames;
      const eased = 1 - Math.pow(1 - t, 3);
      const current = prevNumber + (nextNumber - prevNumber) * eased;
      setDisplay(`${current.toFixed(Math.abs(nextNumber) >= 10 ? 1 : 1)}${suffix}`);

      if (frame >= frames) {
        window.clearInterval(timer);
        previous.current = value;
        setDisplay(value);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [value]);

  return <span>{display}</span>;
}

function WorkspaceMetricsBar({
  readouts,
  provenance,
  busyLabel,
  canAnalyze,
  onAnalyze,
}: {
  readouts: MetricReadout[];
  provenance: AnalysisProvenance | null;
  busyLabel: string | null;
  canAnalyze: boolean;
  onAnalyze: () => void;
}) {
  const isFallback = provenance?.fallback_used === true;

  return (
    <section className={styles.metricsBar} aria-label="Project metrics">
      {isFallback && (
        <div className={styles.fallbackBanner} role="alert">
          <span className={styles.fallbackBannerIcon}>⚠</span>
          <span>Audio analysis unavailable — showing genre estimates, not measurements of your file.</span>
        </div>
      )}
      {readouts.map((readout, index) => (
        <div className={styles.metricCell} key={readout.label}>
          <span className={styles.metricIcon} aria-hidden="true">
            {index === 0 ? "||" : index === 1 ? "I" : index === 2 ? "o" : "++"}
          </span>
          <div>
            <span className={styles.metricLabel}>{readout.label}</span>
            <strong className={styles.metricValue}>
              <AnimatedMetricValue value={readout.value} />
            </strong>
            {readout.statusLabel && (
              <div
                className={styles.metricStatusLabel}
                data-color={readout.statusColor}
              >
                {readout.statusLabel}
              </div>
            )}
          </div>
          <em className={styles.metricSource}>{readout.source}</em>
        </div>
      ))}
      <button
        type="button"
        className={styles.autoAnalyzeButton}
        onClick={onAnalyze}
        disabled={!canAnalyze}
	      >
	        {busyLabel ?? "Auto Analyze"}
	      </button>
    </section>
  );
}

function AssistantPanel({
  activeEra,
  model,
  eras: eraOptions,
  canApply,
  applying,
  cursorX,
  cursorY,
  hasPendingGenerate,
  padRef,
  onEraChange,
  onApply,
  onReset,
  onFixSelect,
  onSliderX,
  onSliderY,
  onPadPointerDown,
  onPadPointerMove,
  onPadPointerUp,
}: {
  activeEra: Era;
  model: AssistantModel;
  eras: Era[];
  canApply: boolean;
  applying: boolean;
  cursorX: number;
  cursorY: number;
  hasPendingGenerate: boolean;
  padRef: RefObject<HTMLDivElement | null>;
  onEraChange: (era: Era) => void;
  onApply: () => void;
  onReset: () => void;
  onFixSelect: (fix: AssistantFix) => void;
  onSliderX: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSliderY: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPadPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPadPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPadPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <aside className={styles.assistantPanel}>
      <div className={styles.assistantTabs}>
        <span className={styles.assistantTabActive}>AI Assistant</span>
      </div>

      <section className={styles.assistantSection}>
        <span className={styles.assistantLabel}>Target vibe</span>
        <div className={styles.vibePills}>
          {eraOptions.map((era) => (
            <button
              key={era.id}
              type="button"
              className={`${styles.vibePill} ${
                activeEra.id === era.id ? styles.vibePillActive : ""
              }`}
              onClick={() => onEraChange(era)}
            >
              {era.name}
            </button>
          ))}
        </div>
        <p className={styles.vibeSummary}>{model.vibeSummary}</p>
      </section>

      <section className={styles.assistantSection}>
        <span className={styles.assistantLabel}>Vocal issues detected</span>
        <div className={styles.issueListCompact}>
          {model.issues.map((issue) => (
            <div className={styles.issueRow} key={issue.id}>
              <span
                className={`${styles.issueDot} ${
                  issue.severity === "critical"
                    ? styles.issueDotCritical
                    : issue.severity === "warning"
                      ? styles.issueDotWarning
                      : styles.issueDotNote
                }`}
              />
              <span>
                <strong>{issue.label}</strong>
                <em>{issue.detail}</em>
              </span>
              <small>{issue.claim}</small>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.assistantSection}>
        <span className={styles.assistantLabel}>Recommended fixes</span>
        <div className={styles.fixList}>
          {model.fixes.map((fix) => (
            <button
              key={fix.id}
              type="button"
              className={styles.fixRow}
              onClick={() => onFixSelect(fix)}
            >
              <span className={styles.fixCheck}>✓</span>
              <span>
                <strong>{fix.label}</strong>
                <em>{fix.detail}</em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.assistantSection}>
        <span className={styles.assistantLabel}>One-click actions</span>
        <button
          type="button"
          className={styles.applyMixButton}
          onClick={onApply}
          disabled={!canApply}
        >
          {applying ? "Applying..." : "Apply AI Mix"}
        </button>
        <button type="button" className={styles.resetChainButton} onClick={onReset}>
          Reset Chain
        </button>
      </section>

      <section className={`${styles.assistantSection} ${styles.xyPanelSection}`}>
        <div className={styles.xyContainer}>
          <div className={styles.sliderTopWrapper}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={cursorX}
              onChange={onSliderX}
              className={styles.sleekSlider}
              aria-label="Dry to wet"
            />
          </div>

          <div className={styles.xyMiddleRow}>
            <div className={styles.sliderLeftWrapper}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={cursorY}
                onChange={onSliderY}
                className={`${styles.sleekSlider} ${styles.sliderVertical}`}
                aria-label="Dark to bright"
              />
            </div>

            <div
              ref={padRef}
              className={styles.xyPad}
              onPointerDown={onPadPointerDown}
              onPointerMove={onPadPointerMove}
              onPointerUp={onPadPointerUp}
              onPointerCancel={onPadPointerUp}
            >
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisTop}`}>Bright</span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisBottom}`}>Dark</span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisLeft}`}>Dry</span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisRight}`}>Wet</span>
              <AnimatedGrid cursorX={cursorX} cursorY={cursorY} />
              <div
                className={styles.xyCursor}
                style={{
                  left: `${cursorX * 100}%`,
                  top: `${(1 - cursorY) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
        <span className={styles.xyHint}>
          {hasPendingGenerate ? "Chain has unsaved XY changes" : "Adjust grid to generate"}
        </span>
      </section>
    </aside>
  );
}

function AudioTransport({
  rawUrl,
  processedUrl,
  trackName,
  trackLabel,
  lufs,
  onPulseChange,
}: {
  rawUrl: string | null;
  processedUrl: string | null;
  trackName: string;
  trackLabel: string;
  lufs?: string;
  onPulseChange: (value: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [bypassed, setBypassed] = useState(true);
  const [waveformData, setWaveformData] = useState<number[] | null>(null);
  const canUseProcessed = Boolean(processedUrl);
  const playbackUrl = !bypassed && processedUrl ? processedUrl : rawUrl;

  const stopPulse = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    onPulseChange(0);
  }, [onPulseChange]);

  const startPulse = useCallback(() => {
    const tick = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;

      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      const sum = data.reduce((acc, value) => {
        const centered = (value - 128) / 128;
        return acc + centered * centered;
      }, 0);
      const rms = Math.sqrt(sum / data.length);
      onPulseChange(Math.min(1, rms * 7));
      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  }, [onPulseChange]);

  const setupAnalyser = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) {
      await audioContextRef.current?.resume().catch(() => undefined);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const context = new AudioCtx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(context.destination);
      audioContextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      await context.resume();
    } catch {
      analyserRef.current = null;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPlaying(false);
      setCurrentTime(0);
      stopPulse();
    });

    return () => cancelAnimationFrame(frame);
  }, [playbackUrl, stopPulse]);

  // Decode real audio waveform from the source file for display
  useEffect(() => {
    let resetFrame: number | null = null;
    if (!rawUrl) {
      resetFrame = requestAnimationFrame(() => setWaveformData(null));
      return () => {
        if (resetFrame) cancelAnimationFrame(resetFrame);
      };
    }

    let alive = true;
    const controller = new AbortController();

    const decodeWaveform = async () => {
      try {
        const res = await fetch(rawUrl, { signal: controller.signal });
        const arrayBuf = await res.arrayBuffer();
        if (!alive) return;

        const AudioCtx =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        await ctx.close().catch(() => undefined);
        if (!alive) return;

        const ch = audioBuf.getChannelData(0);
        const BARS = 34;
        const bucket = Math.floor(ch.length / BARS);
        const bars = Array.from({ length: BARS }, (_, i) => {
          const slice = ch.slice(i * bucket, i * bucket + bucket);
          const rms = Math.sqrt(
            slice.reduce((sum, v) => sum + v * v, 0) / (slice.length || 1)
          );
          return Math.min(1, rms * 6);
        });
        if (alive) setWaveformData(bars);
      } catch {
        // A failed fetch just leaves the waveform empty.
      }
    };

    void decodeWaveform();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [rawUrl]);

  useEffect(
    () => () => {
      stopPulse();
      void audioContextRef.current?.close().catch(() => undefined);
    },
    [stopPulse]
  );

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !playbackUrl) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      stopPulse();
      return;
    }

    await setupAnalyser();
    await audio.play().catch(() => undefined);
    setPlaying(!audio.paused);
    if (!audio.paused) {
      startPulse();
    }
  }, [playbackUrl, playing, setupAnalyser, startPulse, stopPulse]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const bars = Array.from({ length: 34 }, (_, index) => {
    const active = index / 34 <= progress;
    const height = waveformData
      ? Math.max(8, waveformData[index] * 100)
      : 14 + ((index * 7) % 18); // slim placeholder until audio is decoded
    return (
      <span
        key={index}
        className={active ? styles.waveformBarActive : ""}
        style={{ height: `${height}%` }}
      />
    );
  });

  return (
    <section className={styles.transportBar} aria-label="Audio transport">
      <audio
        ref={audioRef}
        src={playbackUrl ?? undefined}
        crossOrigin="anonymous"
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          stopPulse();
        }}
      />

      <div className={styles.transportTrack}>
        <button
          type="button"
          className={styles.playButton}
          onClick={togglePlay}
          disabled={!playbackUrl}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "||" : "▶"}
        </button>
        <span>
          <strong>{trackName}</strong>
          <em>{playbackUrl ? trackLabel : "no audio loaded"}</em>
        </span>
      </div>

      <div className={styles.transportWaveform}>
        <div className={styles.waveformBars}>{bars}</div>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={currentTime}
          onChange={(event) => {
            const nextTime = Number(event.target.value);
            setCurrentTime(nextTime);
            if (audioRef.current) audioRef.current.currentTime = nextTime;
          }}
          disabled={!playbackUrl || duration === 0}
          aria-label="Scrub audio"
        />
      </div>

      <div className={styles.transportTools}>
        <span className={styles.transportLufs}>{lufs ?? "--"}</span>
        <label className={styles.volumeControl}>
          <span>Vol</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
        {canUseProcessed && (
          <button
            type="button"
            className={`${styles.bypassToggle} ${bypassed ? styles.bypassToggleActive : ""}`}
            onClick={() => setBypassed((value) => !value)}
            aria-pressed={bypassed}
            title="Toggle processed export monitor"
          >
            Bypass
          </button>
        )}
      </div>
    </section>
  );
}
