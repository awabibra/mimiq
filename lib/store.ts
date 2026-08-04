import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PluginBundleId, SupportedDaw } from "@/lib/types";

interface OnboardingState {
  daw: string | null;
  mic: string | null;
  plugins: string[];
  era: string | null;
  setDaw: (daw: string) => void;
  setMic: (mic: string) => void;
  setPlugins: (plugins: string[]) => void;
  setEra: (era: string) => void;
  hydrateStudioProfile: (
    daw: SupportedDaw,
    plugins: PluginBundleId[]
  ) => void;
  reset: () => void;
}

export const useStore = create<OnboardingState>()(
  persist(
    (set) => ({
      daw: null,
      mic: null,
      plugins: [],
      era: null,
      setDaw: (daw) => set({ daw }),
      setMic: (mic) => set({ mic }),
      setPlugins: (plugins) => set({ plugins }),
      setEra: (era) => set({ era }),
      hydrateStudioProfile: (daw, plugins) => set({ daw, plugins }),
      reset: () => set({ daw: null, mic: null, plugins: [], era: null }),
    }),
    {
      name: "mimiq-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
