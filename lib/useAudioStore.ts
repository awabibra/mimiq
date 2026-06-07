import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioState {
  vocalFileUrl: string | null;
  beatFileUrl: string | null;
  analysisResult: any | null;
  processedFileUrl: string | null;
  processedAnalysis: any | null;
  isAnalyzed: boolean;
  currentXyPosition: { x: number; y: number };
  setSession: (data: Partial<AudioState>) => void;
  clearSession: () => void;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      vocalFileUrl: null,
      beatFileUrl: null,
      analysisResult: null,
      processedFileUrl: null,
      processedAnalysis: null,
      isAnalyzed: false,
      currentXyPosition: { x: 0, y: 0 },
      setSession: (data) =>
        set((state) => {
          // If vocalFileUrl is being updated (i.e. new session start), clear processed context
          const isNewSession = data.vocalFileUrl !== undefined && data.vocalFileUrl !== state.vocalFileUrl;
          return {
            ...state,
            ...data,
            ...(isNewSession && { processedFileUrl: null, processedAnalysis: null }),
          };
        }),
      clearSession: () =>
        set({
          vocalFileUrl: null,
          beatFileUrl: null,
          analysisResult: null,
          processedFileUrl: null,
          processedAnalysis: null,
          isAnalyzed: false,
        }),
    }),
    { name: 'mimiq-audio-session' }
  )
);
