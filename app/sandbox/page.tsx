"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { User } from "@supabase/supabase-js";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

import { eras, defaultEra, type Era } from "@/lib/eras";
import type {
  AudioMetrics,
  ChainStep,
  AnalysisResponse,
  AnalysisError,
  EvaluationResult,
} from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AnimatedGrid } from "@/components/AnimatedGrid";
import { AuthModal } from "@/components/AuthModal";
import { ProjectGate } from "@/components/ProjectGate";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/useAuth";
import { useAudioStore } from "@/lib/useAudioStore";
import {
  createProjectRecord,
  downloadProjectAudio,
  saveProjectPatch,
  uploadProjectAudio,
} from "@/lib/projects";
import {
  getCurrentVocal,
  getLatestGeneratedChain,
  isGeneratedChain,
  isLocalProject,
  useProject,
} from "@/lib/useProject";
import { supabase } from "@/lib/supabase";
import type { GeneratedChain, ProjectPatch, VocalVersion } from "@/lib/types";
import { VisualVocalChain } from "./VisualVocalChain";
import styles from "./page.module.css";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

type AppState = "empty" | "analyzing" | "results";
type SandboxMode = "view" | "edit";
type VocalChain = ChainStep[];

type EditState = {
  mode: SandboxMode;
  editedChain: VocalChain | null;
  isDirty: boolean;
  evaluationResult: EvaluationResult | null;
  feedbackPanelOpen: boolean;
  evaluating: boolean;
};

interface AudioInsights {
  loudness: string;
  dynamicRange: string;
  brightness: string;
}

const initialEditState: EditState = {
  mode: "view",
  editedChain: null,
  isDirty: false,
  evaluationResult: null,
  feedbackPanelOpen: false,
  evaluating: false,
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const SAVE_AFTER_AUTH_KEY = "mimiq-save-chain-after-auth";

/* ═══════════════════════════════════════════════════════════════
   Analysis steps labels (cosmetic — fill the wait)
   ═══════════════════════════════════════════════════════════════ */

const ANALYSIS_STEPS = [
  "Reading loudness levels...",
  "Measuring dynamic range...",
  "Checking frequency balance...",
  "Mapping vocal character...",
];

/* ═══════════════════════════════════════════════════════════════
   Inline SVG icons
   ═══════════════════════════════════════════════════════════════ */

function UploadArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5,12 12,5 19,12" />
    </svg>
  );
}

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



/* ═══════════════════════════════════════════════════════════════
   API helper
   ═══════════════════════════════════════════════════════════════ */

async function callAnalyze(params: {
  vocalFile?: File;
  beatFile?: File | null;
  daw: string;
  mic?: string | null;
  plugins?: string[];
  eraId: string;
  xyX?: number;
  xyY?: number;
  cachedMetrics?: AudioMetrics;
  clientMetrics?: Partial<AudioMetrics>;
}): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("daw", params.daw);
  form.append("era", params.eraId);

  if (params.vocalFile) form.append("vocalFile", params.vocalFile);
  if (params.beatFile) form.append("beatFile", params.beatFile);
  if (params.xyX != null) form.append("xyX", String(params.xyX));
  if (params.xyY != null) form.append("xyY", String(params.xyY));
  if (params.cachedMetrics)
    form.append("cachedMetrics", JSON.stringify(params.cachedMetrics));

  const headers: HeadersInit = {};
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
  const res = await fetch("/api/evaluate-chain", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

async function computeClientMetrics(file: File): Promise<Partial<AudioMetrics>> {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Web Audio API is unavailable.");
  }

  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const energy = data.reduce((sum, s) => sum + s * s, 0);
    const rms = Math.sqrt(energy / data.length);
    const safeRms = Math.max(rms, 1e-8);

    const lufs = 20 * Math.log10(safeRms) - 0.691;
    const peak = data.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    const peakDb = 20 * Math.log10(Math.max(peak, 1e-8));
    const dynamicRange = peakDb - 20 * Math.log10(safeRms);

    return {
      lufs: Math.max(-40, lufs),
      dynamicRange: Math.min(20, dynamicRange),
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Format helpers
   ═══════════════════════════════════════════════════════════════ */

function formatInsights(m: AudioMetrics): AudioInsights {
  const centroidKhz =
    m.spectralCentroid > 100
      ? m.spectralCentroid / 1000
      : m.spectralCentroid;

  return {
    loudness: `${m.lufs.toFixed(1)} LUFS`,
    dynamicRange: `${m.dynamicRange.toFixed(1)} dB`,
    brightness: `${centroidKhz.toFixed(1)} kHz`,
  };
}

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

function getExploreMetrics(eraId: string): AudioMetrics {
  const defaults: Record<string, AudioMetrics> = {
    nocturnal: {
      lufs: -18,
      dynamicRange: 8,
      spectralCentroid: 1800,
      reverbDecay: 0.5,
      sibilancePeak: -14,
      pitchVariance: 0.45,
      breathNoise: -46,
      dynamicInconsistency: 0.32,
      lowEndEnergy: 0.32,
      stereoWidth: 0.2,
      reverbEstimate: 0.24,
    },
    volatile: {
      lufs: -15,
      dynamicRange: 6,
      spectralCentroid: 2600,
      reverbDecay: 0.22,
      sibilancePeak: -11,
      pitchVariance: 0.58,
      breathNoise: -43,
      dynamicInconsistency: 0.42,
      lowEndEnergy: 0.42,
      stereoWidth: 0.16,
      reverbEstimate: 0.12,
    },
    current: {
      lufs: -16,
      dynamicRange: 7,
      spectralCentroid: 2300,
      reverbDecay: 0.38,
      sibilancePeak: -12,
      pitchVariance: 0.52,
      breathNoise: -45,
      dynamicInconsistency: 0.34,
      lowEndEnergy: 0.34,
      stereoWidth: 0.24,
      reverbEstimate: 0.18,
    },
    golden: {
      lufs: -17,
      dynamicRange: 9,
      spectralCentroid: 1900,
      reverbDecay: 0.24,
      sibilancePeak: -15,
      pitchVariance: 0.42,
      breathNoise: -48,
      dynamicInconsistency: 0.28,
      lowEndEnergy: 0.3,
      stereoWidth: 0.1,
      reverbEstimate: 0.1,
    },
    crystalline: {
      lufs: -16,
      dynamicRange: 6.5,
      spectralCentroid: 3000,
      reverbDecay: 0.28,
      sibilancePeak: -10,
      pitchVariance: 0.5,
      breathNoise: -44,
      dynamicInconsistency: 0.36,
      lowEndEnergy: 0.24,
      stereoWidth: 0.14,
      reverbEstimate: 0.09,
    },
    foryou: {
      lufs: -15,
      dynamicRange: 6,
      spectralCentroid: 2200,
      reverbDecay: 0.32,
      sibilancePeak: -12,
      pitchVariance: 0.46,
      breathNoise: -46,
      dynamicInconsistency: 0.3,
      lowEndEnergy: 0.28,
      stereoWidth: 0.18,
      reverbEstimate: 0.14,
    },
  };

  const aliases: Record<string, string> = {
    rnb: "nocturnal",
    trap: "volatile",
    foryou: "foryou",
  };

  return defaults[eraId] ?? defaults[aliases[eraId]] ?? defaults.golden;
}

const newClientId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
};

/* ═══════════════════════════════════════════════════════════════
   Transition Overlay Component
   ═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Animated Border Component
   ═══════════════════════════════════════════════════════════════ */

function AnimatedDashedBorder() {
  return (
    <svg className={styles.dashedSvg} xmlns="http://www.w3.org/2000/svg">
      <rect className={styles.dashedRect1} x="0" y="0" width="100%" height="100%" rx="12" />
      <rect className={styles.dashedRect2} x="0" y="0" width="100%" height="100%" rx="12" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Page component
   ═══════════════════════════════════════════════════════════════ */

export default function SandboxPage() {
  /* Zustand Store */
  const { daw, mic, plugins, era: storeEra, setEra } = useStore();
  const setSession = useAudioStore((state) => state.setSession);
  const user = useAuth((state) => state.user);
  const project = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const updateProject = useProject((state) => state.updateProject);

  /* Core state */
  const [appState, setAppState] = useState<AppState>("empty");
  const [activeEra, setActiveEra] = useState<Era>(
    () => eras.find((e) => e.id === storeEra) || defaultEra
  );

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

  const [vocalFile, setVocalFile] = useState<File | null>(null);
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);

  /* Cinematic intro: only shown when arriving from onboarding */
  const [showCinematic, setShowCinematic] = useState(false);
  useEffect(() => {
    const fromOnboarding = sessionStorage.getItem("mimiq-from-onboarding");
    if (fromOnboarding) {
      sessionStorage.removeItem("mimiq-from-onboarding"); // consume — fires once only
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
  const [chainValidated, setChainValidated] = useState(false);

  /* Error states */
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showSignUpPrompt, setShowSignUpPrompt] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  /* XY cursor position (normalised 0-1) */
  const [cursorX, setCursorX] = useState(0.55);
  const [cursorY, setCursorY] = useState(0.62);

  /* Whether the cursor has moved since the last full chain generation */
  const [hasPendingGenerate, setHasPendingGenerate] = useState(false);

  const vocalInputRef = useRef<HTMLInputElement>(null);
  const beatInputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveChainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<ChainStep[]>([]);
  const cursorRef = useRef({ x: 0.55, y: 0.62 });

  /* ── Era switching updates CSS variable ── */
  useIsomorphicLayoutEffect(() => {
    document.documentElement.style.setProperty("--accent", activeEra.accent);
  }, [activeEra]);

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
    },
    []
  );

  /* ── Auto-dismiss error banner after 8s ── */
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

        const remoteProject = isLocalProject(project)
          ? await createProjectRecord(project.name, authedUser.id)
          : project;

        let patch: ProjectPatch = {
          beat_file_url: project.beat_file_url,
          beat_filename: project.beat_filename,
          vocal_versions: project.vocal_versions,
          current_vocal_index: project.current_vocal_index,
          generated_chains: project.generated_chains,
          mix_room_report: project.mix_room_report,
          level_lab_report: project.level_lab_report,
          stem_split_url: project.stem_split_url,
          last_opened_at: new Date().toISOString(),
        };

        if (beatFile) {
          const beatPath = await uploadProjectAudio({
            userId: authedUser.id,
            projectId: remoteProject.id,
            kind: "beat",
            file: beatFile,
          });

          patch = {
            ...patch,
            beat_file_url: beatPath,
            beat_filename: beatFile.name,
          };
        }

        if (vocalFile) {
          const vocalPath = await uploadProjectAudio({
            userId: authedUser.id,
            projectId: remoteProject.id,
            kind: "vocal",
            file: vocalFile,
          });
          const vocalVersion: VocalVersion = {
            id: newClientId(),
            filename: vocalFile.name,
            url: vocalPath,
            uploaded_at: new Date().toISOString(),
            label: `Vocal ${project.vocal_versions.length + 1}`,
          };
          const vocal_versions = [...project.vocal_versions, vocalVersion];

          patch = {
            ...patch,
            vocal_versions,
            current_vocal_index: vocal_versions.length - 1,
          };
        }

        const saved = await saveProjectPatch(remoteProject.id, patch);
        setActiveProject(saved);
        setShowSignUpPrompt(false);
        showBanner("Chain saved.");
      } catch {
        showBanner("MimiQ could not save this chain yet. Try again.");
        throw new Error("Save failed");
      } finally {
        setSaveBusy(false);
      }
    },
    [
      beatFile,
      project,
      saveBusy,
      saveUserPrefs,
      setActiveProject,
      showBanner,
      vocalFile,
    ]
  );

  const handleSaveChain = useCallback(async () => {
    if (!project || chain.length === 0 || saveBusy) return;

    if (!user) {
      setShowSignUpPrompt(true);
      return;
    }

    try {
      await saveCurrentProject(user);
    } catch {
      // saveCurrentProject already raised the visible banner.
    }
  }, [chain.length, project, saveBusy, saveCurrentProject, user]);

  const handleAuthedForSave = useCallback(
    async (authedUser: User) => {
      await saveCurrentProject(authedUser);
    },
    [saveCurrentProject]
  );

  useEffect(() => {
    if (!user || !project) return;

    const shouldSave = sessionStorage.getItem(SAVE_AFTER_AUTH_KEY) === "1";
    if (!shouldSave) return;

    sessionStorage.removeItem(SAVE_AFTER_AUTH_KEY);
    const frame = requestAnimationFrame(() => {
      void saveCurrentProject(user).catch(() => undefined);
    });

    return () => cancelAnimationFrame(frame);
  }, [project, saveCurrentProject, user]);

  useEffect(() => {
    if (!project) return;

    const currentVocal = getCurrentVocal(project);
    const latestChain = getLatestGeneratedChain(project);
    const chainData = latestChain?.chain_data;
    const xyPosition = chainData?.xyPosition ?? { x: 0.55, y: 0.62 };
    const frame = requestAnimationFrame(() => {
      setVocalFile(null);
      setBeatFile(null);
      setUploadError(null);

      if (latestChain && chainData?.chain?.length && chainData.measurements) {
        setChain(chainData.chain);
        setEngineerNote(chainData.engineer_note ?? null);
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
        setActiveGeneratedChainId(latestChain.id);
        setChainValidated(Boolean(chainData.validated));
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(chainData.iteration_count ?? 0);
        setCursorX(xyPosition.x);
        setCursorY(xyPosition.y);
        setHasPendingGenerate(false);
        setAppState("results");
        setSession({
          isAnalyzed: true,
          vocalFileUrl: currentVocal?.url ?? null,
          beatFileUrl: project.beat_file_url,
          analysisResult: {
            chain: chainData.chain,
            summary: chainData.summary,
            metrics: chainData.measurements,
            xyPosition,
            engineer_note: chainData.engineer_note,
          },
        });
        return;
      }

      if (currentVocal) {
        setChain([]);
        setEngineerNote(null);
        setInsights(null);
        setCachedMetrics(null);
        setActiveGeneratedChainId(null);
        setChainValidated(false);
        setEditState(initialEditState);
        setHasUnsavedEdit(false);
        setEvaluationIteration(0);
        setHasPendingGenerate(false);
        setAppState("results");
        setSession({
          isAnalyzed: true,
          vocalFileUrl: currentVocal.url,
          beatFileUrl: project.beat_file_url,
          analysisResult: null,
        });
        return;
      }

      setChain([]);
      setEngineerNote(null);
      setInsights(null);
      setCachedMetrics(null);
      setActiveGeneratedChainId(null);
      setChainValidated(false);
      setEditState(initialEditState);
      setHasUnsavedEdit(false);
      setEvaluationIteration(0);
      setHasPendingGenerate(false);
      setAppState("empty");
      setSession({
        isAnalyzed: false,
        vocalFileUrl: null,
        beatFileUrl: project.beat_file_url,
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
    const xyPosition = chainData.xyPosition ?? { x: 0.55, y: 0.62 };

    const frame = requestAnimationFrame(() => {
      setChain(chainData.chain);
      setEngineerNote(chainData.engineer_note ?? null);
      if (chainData.measurements) {
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
      }
      setActiveGeneratedChainId(selectedChain.id);
      setChainValidated(Boolean(chainData.validated));
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
      xyY: number
    ): GeneratedChain => ({
      id: newClientId(),
      chain_data: {
        chain: result.chain,
        summary: result.summary,
        engineer_note: result.engineer_note,
        measurements: result.metrics,
        xyPosition: result.xyPosition ?? { x: xyX, y: xyY },
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
    [daw, mic, plugins]
  );

  const persistProjectPatch = useCallback(
    async (patch: ProjectPatch) => {
      if (!project) return;

      updateProject(patch);

      if (!user || isLocalProject(project)) {
        return;
      }

      try {
        const saved = await saveProjectPatch(project.id, patch);
        setActiveProject(saved);
      } catch {
        showBanner("Project updated locally, but Supabase did not save it yet.");
      }
    },
    [project, setActiveProject, showBanner, updateProject, user]
  );

  const persistGeneratedResult = useCallback(
    async (
      result: AnalysisResponse,
      eraId: string,
      xyX: number,
      xyY: number
    ) => {
      if (!project) return;

      const generated = buildGeneratedChain(result, eraId, xyX, xyY);
      setActiveGeneratedChainId(generated.id);
      setChainValidated(false);
      setEvaluationIteration(0);
      await persistProjectPatch({
        generated_chains: [generated, ...project.generated_chains],
      });
    },
    [buildGeneratedChain, persistProjectPatch, project]
  );

  const currentSavedValidation = useCallback(() => {
    const saved = project?.generated_chains
      .filter(isGeneratedChain)
      .find((entry) => entry.id === activeGeneratedChainId);

    return Boolean(saved?.chain_data.validated);
  }, [activeGeneratedChainId, project]);

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
    setChainValidated(false);
  }, []);

  const closeEditMode = useCallback(() => {
    setEditState(initialEditState);
    setHasUnsavedEdit(false);
  }, []);

  const handleDiscardEdit = useCallback(() => {
    setChainValidated(currentSavedValidation());
    closeEditMode();
  }, [closeEditMode, currentSavedValidation]);

  const handleSaveEditedChain = useCallback(async () => {
    const editedChain = editState.editedChain;
    if (!editedChain) {
      closeEditMode();
      return;
    }

    const result = editState.evaluationResult;
    const validated = result?.measured_fit === "good";
    const evaluationSummary =
      result?.overall ?? "Saved without a measured fit check.";
    const iterationCount = Math.max(evaluationIteration, validated || result ? 1 : 0);
    const validationTimestamp = new Date().toISOString();

    setChain(editedChain);
    setChainValidated(validated);

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
            validated,
            validation_timestamp: validationTimestamp,
            iteration_count: iterationCount,
            evaluation_summary: evaluationSummary,
          },
        };
      });

      if (replaced) {
        await persistProjectPatch({ generated_chains });
      }
    }

    closeEditMode();
    showBanner(validated ? "Measured chain draft saved." : "Chain changes saved.");
  }, [
    activeGeneratedChainId,
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
      showBanner("MimiQ needs vocal measurements before evaluating this chain.");
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
      setChainValidated(result.measured_fit === "good");
      setEditState((state) => ({
        ...state,
        isDirty: false,
        evaluating: false,
        evaluationResult: result,
        feedbackPanelOpen: true,
      }));
    } catch {
      setEvaluationIteration(nextIteration);
      setChainValidated(false);
      setEditState((state) => ({
        ...state,
        isDirty: false,
        evaluating: false,
        evaluationResult: {
          overall: "MimiQ could not complete the chain audit.",
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
          measured_fit: "rebuild",
          flags: ["unknown"],
          explanation: "The chain was not evaluated by the measured fit engine.",
        },
        feedbackPanelOpen: true,
      }));
    }
  }, [
    activeEra.id,
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

  /* ── Handle era change ── */
  const handleEraChange = useCallback(
    async (era: Era) => {
      setActiveEra(era);
      setEra(era.id); // Persist user's manual era choice
      if (appState === "results" && cachedMetrics) {
        setChainLoading(true);
        try {
          const result = await callAnalyze({
            daw: daw || "Logic Pro",
            mic,
            plugins,
            eraId: era.id,
            xyX: cursorX,
            xyY: cursorY,
            cachedMetrics,
          });
          setChain(result.chain);
          setEngineerNote(result.engineer_note ?? null);
          setHasPendingGenerate(false);
          void persistGeneratedResult(result, era.id, cursorX, cursorY);
        } catch {
          showBanner("Failed to regenerate chain. Try again.");
        } finally {
          setChainLoading(false);
        }
      }
    },
    [
      appState,
      cachedMetrics,
      cursorX,
      cursorY,
      showBanner,
      daw,
      mic,
      plugins,
      persistGeneratedResult,
      setEra,
    ]
  );

  /* ── File handling ── */
  const handleVocalSelect = useCallback(
    async (file: File) => {
      /* Client-side size check */
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("File exceeds 20 MB limit. Try a shorter clip.");
        return;
      }
      setUploadError(null);
      setVocalFile(file);
      setAppState("analyzing");
      const MIN_ANALYZE_MS = 2600;
      const minDelay = new Promise<void>((resolve) =>
        setTimeout(resolve, MIN_ANALYZE_MS)
      );

      try {
        let clientMetrics: Partial<AudioMetrics> | undefined;
        try {
          clientMetrics = await computeClientMetrics(file);
        } catch (metricError) {
          console.warn("[sandbox] Client-side metric calculation failed.", metricError);
        }

        let beatForAnalysis = beatFile;

        if (!beatForAnalysis && project?.beat_file_url) {
          beatForAnalysis = await downloadProjectAudio(
            project.beat_file_url,
            project.beat_filename ?? "project-beat.wav"
          );
        }

        const [result] = await Promise.all([
          callAnalyze({
            vocalFile: file,
            beatFile: beatForAnalysis,
            daw: daw || "Logic Pro",
            mic,
            plugins,
            eraId: activeEra.id,
            clientMetrics,
          }),
          minDelay,
        ]);

        setChain(result.chain);
        setEngineerNote(result.engineer_note ?? null);
        setInsights(formatInsights(result.metrics));
        setCachedMetrics(result.metrics);
        setCursorX(result.xyPosition.x);
        setCursorY(result.xyPosition.y);
        setHasPendingGenerate(false);

        const localVocalUrl = URL.createObjectURL(file);
        const localBeatUrl = beatFile
          ? URL.createObjectURL(beatFile)
          : project?.beat_file_url ?? null;
        let storedVocalUrl = localVocalUrl;

        if (project) {
          try {
            const generated = buildGeneratedChain(
              result,
              activeEra.id,
              result.xyPosition.x,
              result.xyPosition.y
            );
            const patch: ProjectPatch = {
              generated_chains: [generated, ...project.generated_chains],
            };

            if (user && !isLocalProject(project)) {
              storedVocalUrl = await uploadProjectAudio({
                userId: user.id,
                projectId: project.id,
                kind: "vocal",
                file,
              });

              const vocalVersion: VocalVersion = {
                id: newClientId(),
                filename: file.name,
                url: storedVocalUrl,
                uploaded_at: new Date().toISOString(),
                label: `Vocal ${project.vocal_versions.length + 1}`,
              };
              patch.vocal_versions = [...project.vocal_versions, vocalVersion];
              patch.current_vocal_index = project.vocal_versions.length;
            }

            await persistProjectPatch(patch);
          } catch {
            showBanner("Analysis finished, but the project file did not save yet.");
          }
        }

        setSession({
          isAnalyzed: true,
          vocalFileUrl: storedVocalUrl,
          beatFileUrl: localBeatUrl,
          analysisResult: result,
        });

        setAppState("results");
      } catch (err: unknown) {
        await minDelay;
        const apiErr = err as AnalysisError;
        if (apiErr?.error === "audio_service_unavailable") {
          showBanner(
            "Analysis unavailable right now. You can still explore the XY pad for general guidance."
          );
          setAppState("results");
        } else {
          showBanner(
            apiErr?.message || "Something went wrong during analysis."
          );
          setAppState("empty");
          setVocalFile(null);
        }
      }
    },
    [
      beatFile,
      project,
      activeEra.id,
      showBanner,
      daw,
      mic,
      plugins,
      buildGeneratedChain,
      persistProjectPatch,
      setSession,
      user,
    ]
  );

  const handleVocalInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleVocalSelect(file);
    },
    [handleVocalSelect]
  );

  const handleBeatInput = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("Beat file exceeds 20 MB limit.");
        return;
      }
      setUploadError(null);
      setBeatFile(file);

      if (project) {
        try {
          if (user && !isLocalProject(project)) {
            const path = await uploadProjectAudio({
              userId: user.id,
              projectId: project.id,
              kind: "beat",
              file,
            });

            await persistProjectPatch({
              beat_file_url: path,
              beat_filename: file.name,
            });

            setSession({
              beatFileUrl: path,
            });
            return;
          }

          const localBeatUrl = URL.createObjectURL(file);

          await persistProjectPatch({
            beat_file_url: null,
            beat_filename: file.name,
          });

          setSession({
            beatFileUrl: localBeatUrl,
          });
        } catch {
          showBanner("Beat selected, but it did not save to the project yet.");
        }
      }
    }
  }, [persistProjectPatch, project, setSession, showBanner, user]);

  /* ── Drag and drop ── */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleVocalSelect(file);
    },
    [handleVocalSelect]
  );

  /* ── Skip upload — explore without audio ── */
  const handleSkip = useCallback(async () => {
    setAppState("analyzing");
    // Minimum display time so the analyzing state reads properly
    const MIN_ANALYZE_MS = 2600;
    const minDelay = new Promise<void>((resolve) =>
      setTimeout(resolve, MIN_ANALYZE_MS)
    );
    try {
      const exploreMetrics = getExploreMetrics(activeEra.id);

      const [result] = await Promise.all([
        callAnalyze({
          daw: daw || "Logic Pro",
          mic,
          plugins,
          eraId: activeEra.id,
          xyX: 0.55,
          xyY: 0.62,
          cachedMetrics: exploreMetrics,
        }),
        minDelay,
      ]);

      setChain(result.chain);
      setEngineerNote(result.engineer_note ?? null);
      setInsights(formatInsights(result.metrics));
      setCachedMetrics(result.metrics);
      setCursorX(result.xyPosition.x);
      setCursorY(result.xyPosition.y);
      setHasPendingGenerate(false);
      void persistGeneratedResult(
        result,
        activeEra.id,
        result.xyPosition.x,
        result.xyPosition.y
      );

      setSession({
        isAnalyzed: true,
        vocalFileUrl: null,
        beatFileUrl: null,
        analysisResult: result,
      });

      setAppState("results");
    } catch {
      // Wait out the minimum time even on error
      await minDelay;
      setAppState("results");
    }
  }, [activeEra.id, daw, mic, plugins, persistGeneratedResult, setSession]);

  /* ── Remove file ── */
  const handleRemoveVocal = useCallback(() => {
    setVocalFile(null);
    setBeatFile(null);
    setChain([]);
    setEngineerNote(null);
    setInsights(null);
    setCachedMetrics(null);
    setActiveGeneratedChainId(null);
    setEditState(initialEditState);
    setHasUnsavedEdit(false);
    setEvaluationIteration(0);
    setChainValidated(false);
    setErrorBanner(null);
    setUploadError(null);
    setHasPendingGenerate(false);
    setAppState("empty");
  }, []);

  /* ── XY pad drag ── */
  const isDragging = useRef(false);

  /* ── Generate Chain ── */
  const handleGenerate = useCallback(async () => {
    if (!cachedMetrics) return;
    setChainLoading(true);
    try {
      const result = await callAnalyze({
        daw: daw || "Logic Pro",
        mic,
        plugins,
        eraId: activeEra.id,
        xyX: cursorX,
        xyY: cursorY,
        cachedMetrics,
      });
      setChain(result.chain);
      setEngineerNote(result.engineer_note ?? null);
      setHasPendingGenerate(false);
      void persistGeneratedResult(result, activeEra.id, cursorX, cursorY);
    } catch {
      showBanner("Failed to generate chain. Try again.");
    } finally {
      setChainLoading(false);
    }
  }, [
    cachedMetrics,
    activeEra.id,
    daw,
    mic,
    plugins,
    cursorX,
    cursorY,
    showBanner,
    persistGeneratedResult,
  ]);

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
      updateCursorFromPointer(e.clientX, e.clientY);
    },
    [updateCursorFromPointer]
  );

  const handlePadPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      updateCursorFromPointer(e.clientX, e.clientY);
    },
    [updateCursorFromPointer]
  );

  const handlePadPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    const position = updateCursorFromPointer(e.clientX, e.clientY);
    if (position) {
      scheduleLiveXYChain(position.x, position.y);
    }
  }, [scheduleLiveXYChain, updateCursorFromPointer]);

  /* ═══════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════ */

  if (!mounted) return null;

  const isEditing = editState.mode === "edit";
  const displayedChain =
    isEditing && editState.editedChain ? editState.editedChain : chain;
  const showValidatedStamp =
    !editState.isDirty &&
    (chainValidated || editState.evaluationResult?.measured_fit === "good");

  return (
    <ProjectGate>
    <div className={styles.layout}>
      {/* ─────────────────────────────────────────────────
          ENTRANCE OVERLAY — only from onboarding
          ───────────────────────────────────────────────── */}
      {showCinematic && <SandboxTransitionOverlay />}

      {/* ─────────────────────────────────────────────────
          ERROR BANNER
          ───────────────────────────────────────────────── */}
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

      {/* ─────────────────────────────────────────────────
          SIDEBAR & MAIN CONTENT
          ───────────────────────────────────────────────── */}
      <Sidebar
        activePage="sandbox"
        activeEra={activeEra}
        onEraChange={handleEraChange}
        savedCount={0}
        dimNavItems={isEditing}
      />

      <div
        className={`${styles.sandboxContent} ${
          appState === "results" ? styles.sandboxContentResults : ""
        }`}
      >
        {/* ─────────────────────────────────────────────────
            CENTER PANEL
            ───────────────────────────────────────────────── */}


      {/* ─────────────────────────────────────────────────
          CENTER PANEL
          ───────────────────────────────────────────────── */}
      <main
        className={`${styles.center} ${
          appState === "results" ? styles.centerToolDock : ""
        } ${isEditing ? styles.editDimmed : ""}`}
      >
        {/* File chip — shows uploaded file name */}
        {vocalFile && appState !== "empty" && (
          <div className={styles.fileChip}>
            <span className={styles.fileChipName}>{vocalFile.name}</span>
            <button
              className={styles.fileChipRemove}
              onClick={handleRemoveVocal}
              aria-label="Remove vocal"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {appState === "empty" && (
          <>
            <div
              className={`${styles.uploadZone} ${
                dragOver ? styles.uploadZoneDragover : ""
              }`}
              onClick={() => vocalInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Upload vocal file"
            >
              <AnimatedDashedBorder />
              <UploadArrowIcon className={styles.uploadIcon} />
              <span className={styles.uploadPrimary}>
                Drop your vocal here
              </span>
              <span className={styles.uploadSecondary}>
                .wav or .mp3 · up to 60 seconds
              </span>
              {uploadError && (
                <span className={styles.uploadErrorInline}>{uploadError}</span>
              )}
            </div>
            <input
              ref={vocalInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleVocalInput}
            />

            <div
              className={styles.beatUpload}
              onClick={() => beatInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload beat file (optional)"
            >
              <AnimatedDashedBorder />
              <UploadArrowIcon className={styles.uploadIcon} />
              <span className={styles.beatUploadText}>
                {beatFile
                  ? `Beat: ${beatFile.name}`
                  : project?.beat_filename
                    ? `Beat: ${project.beat_filename}`
                  : "Add your beat too (optional)"}
              </span>
            </div>
            <input
              ref={beatInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleBeatInput}
            />

            <button className={styles.skipLink} onClick={handleSkip}>
              Skip upload — explore without audio
            </button>
          </>
        )}

        {/* ── Analyzing state ── */}
        {appState === "analyzing" && (
          <div className={styles.analysisCard}>
            {ANALYSIS_STEPS.map((step, i) => (
              <div key={i} className={styles.analysisRow}>
                <span className={styles.analysisText}>{step}</span>
                <CheckIcon className={styles.analysisCheck} />
              </div>
            ))}
          </div>
        )}

        {/* ── Results state ── */}
        {appState === "results" && (
          <>
            {/* XY Pad and Sliders Container */}
            <div className={styles.xyContainer}>
              {/* Top horizontal slider */}
              <div className={styles.sliderTopWrapper}>
                <input
                  type="range"
                  min="0" max="1" step="0.01"
                  value={cursorX}
                  onChange={handleSliderX}
                  className={styles.sleekSlider}
                />
              </div>

              <div className={styles.xyMiddleRow}>
                {/* Left vertical slider */}
                <div className={styles.sliderLeftWrapper}>
                  <input
                    type="range"
                    min="0" max="1" step="0.01"
                    value={cursorY}
                    onChange={handleSliderY}
                    className={`${styles.sleekSlider} ${styles.sliderVertical}`}
                  />
                </div>

                {/* XY Pad */}
                <div
                  ref={padRef}
                  className={styles.xyPad}
                  onPointerDown={handlePadPointerDown}
                  onPointerMove={handlePadPointerMove}
                  onPointerUp={handlePadPointerUp}
                  onPointerCancel={handlePadPointerUp}
                >
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisTop}`}>
                Bright
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisBottom}`}>
                Dark
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisLeft}`}>
                Dry
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisRight}`}>
                Wet
              </span>

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

            {/* Generate Button */}
            {!isEditing && (
              <div className={`${styles.generateWrapper} ${styles.generateWrapperVisible}`}>
                {hasPendingGenerate || chainLoading ? (
                  <button
                    className={`${styles.generateButton} ${chainLoading ? styles.generateButtonLoading : ''}`}
                    onClick={handleGenerate}
                    disabled={chainLoading}
                  >
                    {chainLoading ? (
                      <>
                        <div className={styles.analysisSpinner} style={{ width: '12px', height: '12px' }} />
                        Generating...
                      </>
                    ) : (
                      "Generate Chain"
                    )}
                  </button>
                ) : (
                  <span className={styles.generateHint}>Adjust grid to generate</span>
                )}
              </div>
            )}
          </>
        )}
        </main>

      {/* ─────────────────────────────────────────────────
          RIGHT PANEL
          ───────────────────────────────────────────────── */}
      <aside className={styles.right}>
        {appState === "results" && (
          <div className={`${styles.insightStrip} ${isEditing ? styles.editDimmed : ""}`}>
            <div className={styles.insightCard}>
              <span className={styles.insightLabel}>Loudness</span>
              <span className={styles.insightValue}>
                {insights?.loudness ?? "-"}
              </span>
            </div>
            <div className={styles.insightCard}>
              <span className={styles.insightLabel}>Dynamic Range</span>
              <span className={styles.insightValue}>
                {insights?.dynamicRange ?? "-"}
              </span>
            </div>
            <div className={styles.insightCard}>
              <span className={styles.insightLabel}>Brightness</span>
              <span className={styles.insightValue}>
                {insights?.brightness ?? "-"}
              </span>
            </div>
          </div>
        )}

        {/* ── Empty / exploring state ── */}
        {(appState === "empty" || appState === "analyzing") && (
          <div className={styles.rightEmpty}>
            <span className={styles.rightEmptyTitle}>
              Your chain will appear here
            </span>
            <span className={styles.rightEmptyDesc}>
              Upload a vocal to get a personalized chain, or explore the XY pad
              for general guidance.
            </span>
          </div>
        )}

        {/* ── Skeleton loading ── */}
        {appState === "results" && chainLoading && (
          <>
            <div className={styles.chainHeader}>
              <span className={styles.chainTitle}>Vocal Chain</span>
            </div>
            <div className={styles.skeleton}>
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
            </div>
          </>
        )}

        {/* ── Results chain ── */}
        {appState === "results" && !chainLoading && (
          <>
            <div className={styles.chainHeader}>
              <span className={styles.chainTitle}>Vocal Chain</span>
              <div className={styles.chainMeta}>
                {isEditing && (
                  <span className={styles.editingBadge}>Editing</span>
                )}
                {chain.length > 0 && !isEditing && (
                  <button
                    type="button"
                    className={styles.saveChainButton}
                    onClick={handleSaveChain}
                    disabled={saveBusy}
                  >
                    {saveBusy ? "Saving" : "Save chain"}
                  </button>
                )}
              </div>
            </div>

            {chain.length === 0 && (
              <div className={styles.rightEmpty}>
                <span className={styles.rightEmptyDesc}>
                  Drag the XY cursor or upload audio to generate a chain.
                </span>
              </div>
            )}

            {displayedChain.length > 0 && (
              <VisualVocalChain
                chain={displayedChain}
                engineerNote={engineerNote}
                mode={editState.mode}
                isDirty={editState.isDirty}
                hasUnsavedChanges={hasUnsavedEdit}
                evaluating={editState.evaluating}
                evaluationResult={editState.evaluationResult}
                feedbackPanelOpen={editState.feedbackPanelOpen}
                currentGenre={activeEra.id}
                currentDaw={daw || "Logic Pro"}
                validated={showValidatedStamp}
                onEnterEditMode={handleEnterEditMode}
                onEditedChainChange={handleEditedChainChange}
                onEvaluate={handleEvaluateChain}
                onConfirmSave={handleSaveEditedChain}
                onDiscard={handleDiscardEdit}
                onFeedbackPanelOpenChange={handleFeedbackPanelOpenChange}
              />
            )}
          </>
        )}
      </aside>

      </div>

      {/* ─────────────────────────────────────────────────
          MOBILE BOTTOM TAB BAR
          ───────────────────────────────────────────────── */}
      <MobileTabBar activePage="sandbox" />

      <AuthModal
        open={showSignUpPrompt}
        onClose={() => {
          if (!saveBusy) setShowSignUpPrompt(false);
        }}
        onAuthed={handleAuthedForSave}
        initialMode="signup"
        title="Save your chain - create a free account"
        text="Keep this vocal chain in your MimiQ projects."
        subtext="Your chain will be saved automatically after signing up."
        nextPath="/sandbox"
        pendingAuthKey={SAVE_AFTER_AUTH_KEY}
      />
    </div>
    </ProjectGate>
  );
}
