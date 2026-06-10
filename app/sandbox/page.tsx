"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
import { getGenreProfile } from "@/lib/chainKnowledge";
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
type AnalysisProvenance = Pick<
  AnalysisResponse,
  "analysis_version" | "fallback_used" | "audio_service_status"
>;

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

interface MetricReadout {
  label: string;
  value: string;
  source: "measured" | "chain" | "unknown";
}

type AssistantSeverity = "critical" | "warning" | "note";

interface AssistantIssue {
  id: string;
  severity: AssistantSeverity;
  label: string;
  detail: string;
  claim: "measured" | "estimated" | "unknown";
  targetRole?: string;
}

interface AssistantFix {
  id: string;
  label: string;
  detail: string;
  targetStep?: number;
  targetRole?: string;
}

interface AssistantModel {
  vibeSummary: string;
  issues: AssistantIssue[];
  fixes: AssistantFix[];
}

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

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const SAVE_AFTER_AUTH_KEY = "mimiq-save-chain-after-auth";
const SAFE_ANALYSIS_PROVENANCE: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: true,
  audio_service_status: "unknown",
};

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
  cachedProvenance?: AnalysisProvenance | null;
  clientMetrics?: Partial<AudioMetrics>;
}): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("daw", params.daw);
  form.append("era", params.eraId);

  if (params.vocalFile) form.append("vocalFile", params.vocalFile);
  if (params.beatFile) form.append("beatFile", params.beatFile);
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

const toKhz = (hz: number) => (hz > 100 ? hz / 1000 : hz);

const formatMetricDb = (value: number) =>
  `${value > 0 ? "+" : ""}${Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)} dB`;

function parsePresenceFromChain(chain: ChainStep[]) {
  for (const step of chain) {
    const role = step.role ?? "";
    if (!/(additive|air|presence|eq)/i.test(`${role} ${step.tool}`)) continue;

    const matches = Array.from(
      step.action.matchAll(/([+\-−]?\d+(?:\.\d+)?)\s*dB\s+at\s+(\d+(?:\.\d+)?)\s*(kHz|Hz)/gi)
    );
    const presence = matches.find((match) => {
      const rawFreq = Number(match[2]);
      const hz = match[3]?.toLowerCase() === "khz" ? rawFreq * 1000 : rawFreq;
      return hz >= 1800 && hz <= 5500;
    });

    if (presence?.[1]) {
      const value = Number(presence[1].replace("−", "-"));
      if (Number.isFinite(value)) return formatMetricDb(value);
    }
  }

  return "--";
}

function formatPresenceBand(metrics: AudioMetrics | null, chain: ChainStep[]) {
  if (metrics && typeof metrics.harshness === "number" && Number.isFinite(metrics.harshness)) {
    const presenceDb = 10 * Math.log10(Math.max(metrics.harshness, 1e-12));
    return `${presenceDb.toFixed(1)} dB`;
  }

  return parsePresenceFromChain(chain);
}

function buildMetricReadouts(
  insights: AudioInsights | null,
  metrics: AudioMetrics | null,
  chain: ChainStep[]
): MetricReadout[] {
  return [
    {
      label: "Loudness",
      value: insights?.loudness ?? (metrics ? `${metrics.lufs.toFixed(1)} LUFS` : "--"),
      source: metrics ? "measured" : "unknown",
    },
    {
      label: "Dynamic Range",
      value:
        insights?.dynamicRange ??
        (metrics ? `${metrics.dynamicRange.toFixed(1)} dB` : "--"),
      source: metrics ? "measured" : "unknown",
    },
    {
      label: "Brightness",
      value:
        insights?.brightness ??
        (metrics ? `${toKhz(metrics.spectralCentroid).toFixed(1)} kHz` : "--"),
      source: metrics ? "measured" : "unknown",
    },
    {
      label: "Presence",
      value: formatPresenceBand(metrics, chain),
      source:
        metrics && typeof metrics.harshness === "number" && Number.isFinite(metrics.harshness)
          ? "measured"
          : chain.length > 0
            ? "chain"
            : "unknown",
    },
  ];
}

function findStepByRole(chain: ChainStep[], role: string) {
  const roleText = role.toLowerCase();
  return chain.find((step) => {
    const haystack = `${step.role ?? ""} ${step.tool} ${step.action}`.toLowerCase();
    if (roleText === "chain") return true;
    if (roleText === "eq") return /eq|shelf|boost|cut/.test(haystack);
    if (roleText === "deesser") return haystack.includes("deess") || haystack.includes("de-ess");
    if (roleText === "highpass") return haystack.includes("highpass") || haystack.includes("high-pass");
    if (roleText === "compressor") return haystack.includes("compressor") || haystack.includes("comp");
    if (roleText === "compressor_primary") return haystack.includes("compressor") || haystack.includes("comp");
    if (roleText === "mastering_limiter") return haystack.includes("limiter") || haystack.includes("ceiling");
    if (roleText === "presence") return haystack.includes("eq") || haystack.includes("presence") || haystack.includes("air");
    return haystack.includes(roleText);
  });
}

function issueToFix(issue: AssistantIssue, chain: ChainStep[]): AssistantFix {
  const target = issue.targetRole ? findStepByRole(chain, issue.targetRole) : undefined;
  const fixLabels: Record<string, Pick<AssistantFix, "label" | "detail">> = {
    sibilance: {
      label: "De-ess around 7 kHz",
      detail: "Reduces sharp consonants while keeping the top end visible.",
    },
    low_end: {
      label: "High-pass filter",
      detail: "Cleans low-end rumble before compression raises it.",
    },
    dynamics: {
      label: "Compression leveling",
      detail: "Smooths loudness swings without promising a finished mix.",
    },
    quiet: {
      label: "Re-check gain staging",
      detail: "Keeps the chain target aligned with the selected vibe.",
    },
    bright: {
      label: "Soften presence EQ",
      detail: "Pulls the vocal away from brittle upper-mid emphasis.",
    },
    dark: {
      label: "Lift presence carefully",
      detail: "Adds clarity without treating brightness as a guaranteed fix.",
    },
  };
  const copy = fixLabels[issue.id] ?? {
    label: "Review chain stage",
    detail: "This points to the closest matching plugin in the current chain.",
  };

  return {
    id: `fix-${issue.id}`,
    ...copy,
    targetRole: issue.targetRole,
    targetStep: target?.step,
  };
}

function evaluationIssueToAssistantIssue(
  issue: EvaluationResult["issues"][number],
  index: number,
  claim: AssistantIssue["claim"]
): AssistantIssue {
  return {
    id: `evaluation-${issue.plugin}-${index}`,
    severity: issue.severity === "critical" ? "critical" : issue.severity === "warning" ? "warning" : "note",
    label: issue.plugin === "chain" ? "Chain edit check" : issue.plugin.replace(/_/g, " "),
    detail: issue.problem,
    claim,
    targetRole: issue.plugin,
  };
}

function evaluationIssueToFix(
  issue: EvaluationResult["issues"][number],
  index: number,
  chain: ChainStep[]
): AssistantFix {
  const target = findStepByRole(chain, issue.plugin);

  return {
    id: `fix-evaluation-${issue.plugin}-${index}`,
    label: issue.fix,
    detail: issue.why,
    targetRole: issue.plugin,
    targetStep: target?.step,
  };
}

function buildAssistantModel(
  metrics: AudioMetrics | null,
  chain: ChainStep[],
  eraId: string,
  provenance: AnalysisProvenance | null,
  evaluationResult?: EvaluationResult | null
): AssistantModel {
  const profile = getGenreProfile(eraId);
  const issues: AssistantIssue[] = [];
  const sourceIsFallback = provenance?.fallback_used || provenance?.audio_service_status !== "ok";
  const claim = sourceIsFallback ? "estimated" : "measured";

  if (evaluationResult) {
    const evaluationIssues = evaluationResult.issues
      .slice(0, 3)
      .map((issue, index) => evaluationIssueToAssistantIssue(issue, index, claim));

    return {
      vibeSummary: evaluationResult.overall,
      issues:
        evaluationIssues.length > 0
          ? evaluationIssues
          : [
              {
                id: "evaluation-clear",
                severity: "note",
                label: "No major edit issue",
                detail: evaluationResult.explanation,
                claim,
              },
            ],
      fixes:
        evaluationResult.issues.length > 0
          ? evaluationResult.issues
              .slice(0, 3)
              .map((issue, index) => evaluationIssueToFix(issue, index, chain))
          : [
              {
                id: "fix-evaluation-keep",
                label: "Keep evaluated chain",
                detail: evaluationResult.explanation,
              },
            ],
    };
  }

  if (!metrics) {
    return {
      vibeSummary: "Upload or select a vocal to show measured guidance.",
      issues: [
        {
          id: "unknown",
          severity: "note",
          label: "No measured vocal yet",
          detail: "MimiQ can show the chain, but issues stay unknown until audio is analyzed.",
          claim: "unknown",
        },
      ],
      fixes: [],
    };
  }

  if ((metrics.sibilancePeak ?? -14) > -12) {
    issues.push({
      id: "sibilance",
      severity: (metrics.sibilancePeak ?? -14) > -9 ? "critical" : "warning",
      label: "Sharp S sounds",
      detail: `Energy near the de-ess range is ${formatMetricDb(metrics.sibilancePeak ?? -12)}.`,
      claim,
      targetRole: "deesser",
    });
  }

  if ((metrics.lowEndEnergy ?? 0) > 0.36 || (metrics.lowMidBuildup ?? 0) > 0.0002) {
    issues.push({
      id: "low_end",
      severity: "warning",
      label: "Low-end rumble",
      detail: "The measured low band is high enough to check before compression.",
      claim,
      targetRole: "highpass",
    });
  }

  if (
    metrics.dynamicRange > profile.dynamic_range_target + 1 ||
    (metrics.dynamicInconsistency ?? 0) > 0.36
  ) {
    issues.push({
      id: "dynamics",
      severity: "warning",
      label: "Uneven vocal level",
      detail: `${metrics.dynamicRange.toFixed(1)} dB range is above the ${profile.dynamic_range_target} dB target.`,
      claim,
      targetRole: "compressor",
    });
  }

  if (metrics.lufs < profile.lufs_target - 2) {
    issues.push({
      id: "quiet",
      severity: "note",
      label: "Vocal sits quiet",
      detail: `${metrics.lufs.toFixed(1)} LUFS is below the selected target context.`,
      claim,
      targetRole: "compressor",
    });
  }

  if (metrics.spectralCentroid > 3000) {
    issues.push({
      id: "bright",
      severity: "warning",
      label: "Top end may feel edgy",
      detail: `Brightness measured around ${toKhz(metrics.spectralCentroid).toFixed(1)} kHz.`,
      claim,
      targetRole: "presence",
    });
  } else if (metrics.spectralCentroid < 1800) {
    issues.push({
      id: "dark",
      severity: "note",
      label: "Vocal reads dark",
      detail: `Brightness measured around ${toKhz(metrics.spectralCentroid).toFixed(1)} kHz.`,
      claim,
      targetRole: "presence",
    });
  }

  const visibleIssues = issues.slice(0, 3);
  return {
    vibeSummary: `${profile.philosophy.split(".")[0]}.`,
    issues: visibleIssues,
    fixes:
      visibleIssues.length > 0
        ? visibleIssues.map((issue) => issueToFix(issue, chain)).slice(0, 3)
        : [
            {
              id: "fix-keep-chain",
              label: "Keep measured chain",
              detail: "No major measured issue is flagged in this pass.",
            },
          ],
  };
}

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

function provenanceFromResult(result: AnalysisResponse): AnalysisProvenance {
  return {
    analysis_version: result.analysis_version,
    fallback_used: result.fallback_used,
    audio_service_status: result.audio_service_status,
  };
}

function provenanceFromChainData(
  chainData?: GeneratedChain["chain_data"]
): AnalysisProvenance {
  if (!chainData) return SAFE_ANALYSIS_PROVENANCE;

  return {
    analysis_version: chainData.analysis_version ?? "1.0",
    fallback_used:
      typeof chainData.fallback_used === "boolean"
        ? chainData.fallback_used
        : SAFE_ANALYSIS_PROVENANCE.fallback_used,
    audio_service_status:
      chainData.audio_service_status ?? SAFE_ANALYSIS_PROVENANCE.audio_service_status,
  };
}

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
  const sessionVocalFileUrl = useAudioStore((state) => state.vocalFileUrl);
  const sessionBeatFileUrl = useAudioStore((state) => state.beatFileUrl);
  const sessionProcessedFileUrl = useAudioStore((state) => state.processedFileUrl);
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
  const [chainFitGood, setChainFitGood] = useState(false);
  const [cachedAnalysisProvenance, setCachedAnalysisProvenance] =
    useState<AnalysisProvenance | null>(null);
  const [assistantHighlight, setAssistantHighlight] =
    useState<HighlightTarget | null>(null);
  const [audioPulse, setAudioPulse] = useState(0);

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
  const assistantPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<ChainStep[]>([]);
  const cursorRef = useRef({ x: 0.55, y: 0.62 });

  /* ── Era switching updates CSS variable ── */
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
	        const now = new Date().toISOString();
	        const activeSavedChain =
	          project.generated_chains
	            .filter(isGeneratedChain)
	            .find((entry) => entry.id === activeGeneratedChainId) ??
	          getLatestGeneratedChain(project);
	        let generatedChains = project.generated_chains;
	        let savedActiveChainId = activeGeneratedChainId;

	        if (chain.length > 0) {
	          const provenance =
	            cachedAnalysisProvenance ?? provenanceFromChainData(activeSavedChain?.chain_data);
	          const fit = editState.evaluationResult?.measured_fit ?? (chainFitGood ? "good" : undefined);
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
	                  "Measured MimiQ vocal chain.",
	                engineer_note: engineerNote ?? entry.chain_data.engineer_note,
	                measurements: cachedMetrics ?? entry.chain_data.measurements,
	                xyPosition: { x: cursorX, y: cursorY },
	                analysis_version: provenance.analysis_version,
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
	                  "Measured MimiQ vocal chain.",
	                engineer_note: engineerNote ?? activeSavedChain?.chain_data.engineer_note,
	                measurements: cachedMetrics ?? activeSavedChain?.chain_data.measurements,
	                xyPosition: { x: cursorX, y: cursorY },
	                analysis_version: provenance.analysis_version,
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

	        let patch: ProjectPatch = {
	          beat_file_url: project.beat_file_url,
	          beat_filename: project.beat_filename,
	          vocal_versions: project.vocal_versions,
	          current_vocal_index: project.current_vocal_index,
	          generated_chains: generatedChains,
	          mix_room_report: project.mix_room_report,
	          level_lab_report: project.level_lab_report,
	          stem_split_url: project.stem_split_url,
	          last_opened_at: now,
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
	        if (savedActiveChainId) {
	          setActiveGeneratedChainId(savedActiveChainId);
	        }
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
	      activeEra.id,
	      activeGeneratedChainId,
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
        const provenance = provenanceFromChainData(chainData);
        setChain(chainData.chain);
        setEngineerNote(chainData.engineer_note ?? null);
        setInsights(formatInsights(chainData.measurements));
        setCachedMetrics(chainData.measurements);
        setCachedAnalysisProvenance(provenance);
        setActiveGeneratedChainId(latestChain.id);
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
          vocalFileUrl: currentVocal?.url ?? null,
          beatFileUrl: project.beat_file_url,
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
    const provenance = provenanceFromChainData(chainData);

    const frame = requestAnimationFrame(() => {
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
      xyY: number
    ): GeneratedChain => ({
      id: newClientId(),
      chain_data: {
        chain: result.chain,
        summary: result.summary,
        engineer_note: result.engineer_note,
        measurements: result.metrics,
        xyPosition: result.xyPosition ?? { x: xyX, y: xyY },
        analysis_version: result.analysis_version,
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
      setChainFitGood(false);
      setCachedAnalysisProvenance(provenanceFromResult(result));
      setEvaluationIteration(0);
      await persistProjectPatch({
        generated_chains: [generated, ...project.generated_chains],
      });
    },
	    [buildGeneratedChain, persistProjectPatch, project]
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
	        void persistGeneratedResult(result, eraId, nextX, nextY);
	      } catch {
	        showBanner("Failed to regenerate chain. Try again.");
	      } finally {
	        setChainLoading(false);
	      }
	    },
	    [
	      cachedAnalysisProvenance,
	      cachedMetrics,
	      daw,
	      mic,
	      persistGeneratedResult,
	      plugins,
	      setSession,
	      showBanner,
	    ]
	  );

	  const currentSavedFitGood = useCallback(() => {
    const saved = project?.generated_chains
      .filter(isGeneratedChain)
      .find((entry) => entry.id === activeGeneratedChainId);

    return saved?.chain_data.measured_fit === "good";
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
    const measuredFit = result?.measured_fit ?? "unknown";
    const fitGood = measuredFit === "good";
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
            measured_fit: measuredFit,
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
    showBanner(fitGood ? "Measured fit saved." : "Chain changes saved.");
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
      setChainFitGood(result.measured_fit === "good");
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
          measured_fit: "unknown",
          flags: ["evaluation_request_failed"],
          explanation: "The chain audit did not complete, so MimiQ cannot label the edit as measured improvement.",
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
        setCachedAnalysisProvenance(provenanceFromResult(result));
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
	            setActiveGeneratedChainId(generated.id);
	            setChainFitGood(false);
	            setEvaluationIteration(0);
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
          cachedProvenance: SAFE_ANALYSIS_PROVENANCE,
        }),
        minDelay,
      ]);

      setChain(result.chain);
      setEngineerNote(result.engineer_note ?? null);
      setInsights(formatInsights(result.metrics));
      setCachedMetrics(result.metrics);
      setCachedAnalysisProvenance(provenanceFromResult(result));
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
    setCachedAnalysisProvenance(null);
    setActiveGeneratedChainId(null);
    setEditState(initialEditState);
    setHasUnsavedEdit(false);
    setEvaluationIteration(0);
    setChainFitGood(false);
    setErrorBanner(null);
    setUploadError(null);
    setHasPendingGenerate(false);
    setAppState("empty");
  }, []);

  /* ── XY pad drag ── */
  const isDragging = useRef(false);

	  /* ── Generate Chain ── */
	  const handleGenerate = useCallback(async () => {
	    await regenerateChain(activeEra.id, cursorRef.current.x, cursorRef.current.y);
	  }, [activeEra.id, regenerateChain]);

  const handleResetChain = useCallback(() => {
    const savedChain =
      project?.generated_chains
        .filter(isGeneratedChain)
        .find((entry) => entry.id === activeGeneratedChainId) ??
      getLatestGeneratedChain(project);

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
  }, [activeGeneratedChainId, handleDiscardEdit, project, showBanner]);

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

  /* ═══════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════ */

  const isEditing = editState.mode === "edit";
  const displayedChain =
    isEditing && editState.editedChain ? editState.editedChain : chain;
  const showMeasuredFitBadge =
    !editState.isDirty &&
    (chainFitGood || editState.evaluationResult?.measured_fit === "good");
  const currentVocal = project ? getCurrentVocal(project) : null;
  const rawAudioUrl = sessionVocalFileUrl ?? currentVocal?.url ?? null;
  const processedAudioUrl = sessionProcessedFileUrl ?? project?.stem_split_url ?? null;
  const metricReadouts = useMemo(
    () => buildMetricReadouts(insights, cachedMetrics, displayedChain),
    [cachedMetrics, displayedChain, insights]
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
        uploadedVocalName={vocalFile?.name ?? null}
        onVocalUpload={handleVocalSelect}
        onVocalClear={handleRemoveVocal}
      />

      <div className={styles.studioContent}>
	        <WorkspaceMetricsBar
	          readouts={metricReadouts}
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

        <main className={`${styles.chainWorkspace} ${isEditing ? styles.editDimmed : ""}`}>
          <header className={styles.workspaceHeader}>
            <div>
              <span className={styles.chainTitle}>Vocal Chain</span>
              <h1>Chain</h1>
            </div>
            <div className={styles.workspaceActions}>
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
            onDragOver={appState === "empty" ? handleDragOver : undefined}
            onDragLeave={appState === "empty" ? handleDragLeave : undefined}
            onDrop={appState === "empty" ? handleDrop : undefined}
          >
            {vocalFile && appState !== "empty" && (
              <div className={styles.fileChip}>
                <span className={styles.fileChipName}>{vocalFile.name}</span>
                <button
                  className={styles.fileChipRemove}
                  onClick={handleRemoveVocal}
                  aria-label="Remove vocal"
                >
                  x
                </button>
              </div>
            )}

            {appState === "empty" && (
              <div className={styles.studioDropState}>
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
                  <span className={styles.uploadPrimary}>Drop your vocal here</span>
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
                  Skip upload - explore without audio
                </button>
              </div>
            )}

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

	            {appState === "results" && chainLoading && (
	              <div className={styles.skeleton}>
	                <span className={styles.skeletonLabel}>
	                  Regenerating chain from measured vocal context...
	                </span>
	                <div className={styles.skeletonLine} />
	                <div className={styles.skeletonLine} />
	                <div className={styles.skeletonLine} />
              </div>
            )}

            {appState === "results" && !chainLoading && chain.length === 0 && (
              <div className={styles.rightEmpty}>
                <span className={styles.rightEmptyDesc}>
                  Drag the XY cursor or upload audio to generate a chain.
                </span>
              </div>
            )}

            {appState === "results" && !chainLoading && displayedChain.length > 0 && (
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
          trackName={currentVocal?.label ?? project?.name ?? "Lead Vocal"}
          trackLabel={sessionBeatFileUrl ? "vocal + beat context" : "lead vocal"}
          lufs={metricReadouts[0]?.value}
          onPulseChange={setAudioPulse}
        />
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
  busyLabel,
  canAnalyze,
  onAnalyze,
}: {
  readouts: MetricReadout[];
  busyLabel: string | null;
  canAnalyze: boolean;
  onAnalyze: () => void;
}) {
  return (
    <section className={styles.metricsBar} aria-label="Project metrics">
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
        <span>Chain Insights</span>
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
    const base = 18 + ((index * 19) % 42);
    const active = index / 34 <= progress;
    return (
      <span
        key={index}
        className={active ? styles.waveformBarActive : ""}
        style={{ height: `${base}%` }}
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
        <button
          type="button"
          className={`${styles.bypassToggle} ${bypassed ? styles.bypassToggleActive : ""}`}
          disabled={!canUseProcessed}
          onClick={() => setBypassed((value) => !value)}
          aria-pressed={bypassed}
          title={canUseProcessed ? "Toggle processed export monitor" : "No processed export to compare"}
        >
          Bypass
        </button>
      </div>
    </section>
  );
}
