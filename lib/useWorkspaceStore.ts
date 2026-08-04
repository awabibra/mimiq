import { create } from "zustand";
import type {
  AnalysisProgressState,
  ProjectAnalysisResponse,
  WorkflowStage,
} from "@/lib/types";

type AuditionMode = "raw" | "processed";
type AnalysisRetryAction = "restart" | "poll_split" | "save" | null;

interface WorkspaceState {
  stage: WorkflowStage;
  selectedFindingId: string | null;
  selectedRange: { start: number; end: number } | null;
  isPlaying: boolean;
  loopEnabled: boolean;
  auditionMode: AuditionMode;
  levelMatched: boolean;
  monoCheck: boolean;
  analysisProgress: AnalysisProgressState;
  pendingAnalysis: ProjectAnalysisResponse | null;
  analysisRetryAction: AnalysisRetryAction;
  analysisSourceFingerprint: string | null;
  intentLocks: Record<"tone" | "dynamics" | "space", boolean>;
  setStage: (stage: WorkflowStage) => void;
  selectFinding: (
    findingId: string | null,
    range?: { start: number; end: number } | null
  ) => void;
  setPlaying: (isPlaying: boolean) => void;
  setLoopEnabled: (loopEnabled: boolean) => void;
  setAuditionMode: (auditionMode: AuditionMode) => void;
  setLevelMatched: (levelMatched: boolean) => void;
  setMonoCheck: (monoCheck: boolean) => void;
  setAnalysisProgress: (analysisProgress: AnalysisProgressState) => void;
  setPendingAnalysis: (pendingAnalysis: ProjectAnalysisResponse | null) => void;
  setAnalysisRetryAction: (analysisRetryAction: AnalysisRetryAction) => void;
  setAnalysisSourceFingerprint: (analysisSourceFingerprint: string | null) => void;
  toggleIntentLock: (lock: "tone" | "dynamics" | "space") => void;
  clearAnalysisFlow: () => void;
  resetWorkspace: () => void;
}

const idleAnalysisProgress: AnalysisProgressState = {
  phase: "idle",
  label: "Ready to diagnose",
  progress: null,
  message: null,
  errorCode: null,
  retryable: false,
};

const initialState = {
  stage: "prepare" as const,
  selectedFindingId: null,
  selectedRange: null,
  isPlaying: false,
  loopEnabled: true,
  auditionMode: "raw" as const,
  levelMatched: true,
  monoCheck: false,
  analysisProgress: idleAnalysisProgress,
  pendingAnalysis: null,
  analysisRetryAction: null,
  analysisSourceFingerprint: null,
  intentLocks: { tone: true, dynamics: false, space: true },
};

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  ...initialState,
  setStage: (stage) => set({ stage }),
  selectFinding: (selectedFindingId, selectedRange = null) =>
    set({ selectedFindingId, selectedRange }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  setAuditionMode: (auditionMode) => set({ auditionMode }),
  setLevelMatched: (levelMatched) => set({ levelMatched }),
  setMonoCheck: (monoCheck) => set({ monoCheck }),
  setAnalysisProgress: (analysisProgress) => set({ analysisProgress }),
  setPendingAnalysis: (pendingAnalysis) => set({ pendingAnalysis }),
  setAnalysisRetryAction: (analysisRetryAction) => set({ analysisRetryAction }),
  setAnalysisSourceFingerprint: (analysisSourceFingerprint) =>
    set({ analysisSourceFingerprint }),
  toggleIntentLock: (lock) =>
    set((state) => ({
      intentLocks: { ...state.intentLocks, [lock]: !state.intentLocks[lock] },
    })),
  clearAnalysisFlow: () =>
    set({
      analysisProgress: idleAnalysisProgress,
      pendingAnalysis: null,
      analysisRetryAction: null,
      analysisSourceFingerprint: null,
    }),
  resetWorkspace: () => set(initialState),
}));
