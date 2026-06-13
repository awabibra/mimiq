import { create } from "zustand";
import type { AnalysisResponse, LevelLabResponse, XYPosition } from "@/lib/types";

interface AudioState {
  analysisResult: AnalysisResponse | null;
  processedAnalysis: LevelLabResponse | null;
  isAnalyzed: boolean;
  currentXyPosition: XYPosition;
  setSession: (data: Partial<AudioState>) => void;
  clearSession: () => void;
}

export const useAudioStore = create<AudioState>()((set) => ({
  analysisResult: null,
  processedAnalysis: null,
  isAnalyzed: false,
  currentXyPosition: { x: 0, y: 0 },
  setSession: (data) =>
    set((state) => ({
      ...state,
      ...data,
    })),
  clearSession: () =>
    set({
      analysisResult: null,
      processedAnalysis: null,
      isAnalyzed: false,
      currentXyPosition: { x: 0, y: 0 },
    }),
}));
