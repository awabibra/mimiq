import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getProjectRecord } from "@/lib/projects";
import type {
  ChainModifier,
  ChainStep,
  GeneratedChain,
  MixRoomEQCut,
  MixRoomReport,
  Project,
  ProjectAudioAsset,
  ProjectChainEntry,
  ProjectPatch,
  VocalVersion,
} from "@/lib/types";
import {
  getPrimaryVocalAsset,
  getProjectAudioAssets,
  upsertProjectAudioAsset,
} from "@/lib/projectAudio";

export const ACTIVE_PROJECT_STORAGE_KEY = "mimiq-active-project";

export interface ProjectState {
  project: Project | null;
  prompt: string | null;
  setActiveProject: (project: Project) => void;
  clearActiveProject: () => void;
  updateProject: (patch: ProjectPatch) => void;
  upsertAudioAsset: (asset: ProjectAudioAsset) => void;
  addVocalVersion: (version: VocalVersion) => void;
  addGeneratedChain: (chain: GeneratedChain) => void;
  addMixRoomEQCut: (cut: Omit<MixRoomEQCut, "id" | "created_at"> & Partial<Pick<MixRoomEQCut, "id" | "created_at">>) => MixRoomEQCut | null;
  setPrompt: (prompt: string | null) => void;
}

const withUpdatedAt = (patch: ProjectPatch): ProjectPatch => ({
  ...patch,
  updated_at: new Date().toISOString(),
});

const newClientId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
};

const emptyMixRoomReport = (): MixRoomReport => ({
  version: 1,
  analysis_version: "browser_fft_v1",
  analyzed_at: new Date().toISOString(),
  vocal_version_id: null,
  beat_file_url: null,
  vocal_source: null,
  beat_source: null,
  genre: "unknown",
  daw: "unknown",
  matchScore: 0,
  summary: "",
  explanation: null,
  collisions: [],
  pockets: [],
  eq_cuts: [],
});

export function isMixRoomReport(report: unknown): report is MixRoomReport {
  if (!report || typeof report !== "object") return false;

  const value = report as Partial<MixRoomReport>;

  return (
    (value.analysis_version === "browser_fft_v1" ||
      value.analysis_version === "mix_room_v1") &&
    Array.isArray(value.collisions) &&
    Array.isArray(value.pockets) &&
    Array.isArray(value.eq_cuts)
  );
}

export function appendMixRoomEQCut(
  report: MixRoomReport | null | undefined,
  cut: MixRoomEQCut
): MixRoomReport {
  const base = isMixRoomReport(report) ? report : emptyMixRoomReport();

  return {
    ...base,
    eq_cuts: [cut, ...(base.eq_cuts ?? [])],
  };
}

export function getMixRoomEQCuts(report: MixRoomReport | null | undefined) {
  return isMixRoomReport(report) ? report.eq_cuts ?? [] : [];
}

function formatFrequency(freq: number) {
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }

  return `${Math.round(freq)} Hz`;
}

function formatGain(gain: number) {
  const rounded = Math.abs(gain).toFixed(1).replace(/\.0$/, "");
  return `${gain < 0 ? "cut" : "boost"} ${rounded} dB`;
}

export function isLocalProject(project: Project | null | undefined) {
  return Boolean(project?.id.startsWith("local-"));
}

export function createLocalProject(params: {
  daw: string;
  era: string;
}): Project {
  const now = new Date().toISOString();

  return {
    id: `local-${newClientId()}`,
    user_id: "guest",
    name: `${params.daw} sandbox`,
    created_at: now,
    updated_at: now,
    audio_assets: [],
    beat_file_url: null,
    beat_filename: null,
    vocal_versions: [],
    current_vocal_index: 0,
    generated_chains: [],
    mix_room_report: null,
    level_lab_report: null,
    stem_split_url: null,
    last_opened_at: now,
  };
}

function mixRoomCutStep(cuts: MixRoomEQCut[]): ChainStep {
  const action = cuts
    .map(
      (cut) =>
        `${formatGain(cut.gain)} at ${formatFrequency(cut.frequency)} (Q ${cut.q.toFixed(1)})`
    )
    .join("; ");

  return {
    step: 1,
    tool: "EQ",
    action,
    reason: "Mix Room found beat and vocal energy fighting here, so this cut creates space before the rest of the chain.",
  };
}

function withMixRoomCuts(chain: GeneratedChain, cuts: MixRoomEQCut[]): GeneratedChain {
  if (cuts.length === 0) return chain;

  return {
    ...chain,
    chain_data: {
      ...chain.chain_data,
      chain: [
        mixRoomCutStep(cuts),
        ...chain.chain_data.chain.map((step, index) => ({
          ...step,
          step: index + 2,
        })),
      ],
    },
  };
}

export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
      project: null,
      prompt: null,
      setActiveProject: (project) => set({ project, prompt: null }),
      clearActiveProject: () => set({ project: null, prompt: null }),
	      updateProject: (patch) =>
	        set((state) => {
	          if (!state.project) return state;

          return {
            project: {
              ...state.project,
              ...withUpdatedAt(patch),
	            },
	          };
	        }),
      upsertAudioAsset: (asset) =>
        set((state) => {
          if (!state.project) return state;

          const audio_assets = upsertProjectAudioAsset(
            getProjectAudioAssets(state.project),
            asset
          );

          return {
            project: {
              ...state.project,
              audio_assets,
              updated_at: new Date().toISOString(),
            },
          };
        }),
      addVocalVersion: (version) =>
        set((state) => {
          if (!state.project) return state;

          const vocal_versions = [...state.project.vocal_versions, version];

          return {
            project: {
              ...state.project,
              vocal_versions,
              current_vocal_index: vocal_versions.length - 1,
              updated_at: new Date().toISOString(),
            },
          };
        }),
      addGeneratedChain: (chain) =>
        set((state) => {
          if (!state.project) return state;

          return {
            project: {
              ...state.project,
              generated_chains: [chain, ...state.project.generated_chains],
              updated_at: new Date().toISOString(),
            },
          };
        }),
      addMixRoomEQCut: (cut) => {
        const savedCut: MixRoomEQCut = {
          id: cut.id ?? newClientId(),
          frequency: cut.frequency,
          gain: cut.gain,
          q: cut.q,
          source: cut.source,
          created_at: cut.created_at ?? new Date().toISOString(),
        };

        set((state) => {
          if (!state.project) return state;

          return {
            project: {
              ...state.project,
              mix_room_report: appendMixRoomEQCut(
                state.project.mix_room_report,
                savedCut
              ),
              updated_at: new Date().toISOString(),
            },
          };
        });

        return savedCut;
      },
      setPrompt: (prompt) => set({ prompt }),
    }),
    {
      name: ACTIVE_PROJECT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ project: state.project }),
    }
  )
);

export function getPersistedProjectId() {
  return getPersistedProject()?.id ?? null;
}

function getPersistedProject() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as {
      state?: { project?: Project | null };
    };
    const project = stored.state?.project;
    return project && typeof project.id === "string" ? project : null;
  } catch {
    return null;
  }
}

export async function rehydrateActiveProject() {
  const storedProject = getPersistedProject();
  if (!storedProject) return null;

  if (isLocalProject(storedProject)) {
    useProject.getState().setActiveProject(storedProject);
    return storedProject;
  }

  const project = await getProjectRecord(storedProject.id);
  useProject.getState().setActiveProject(project);

  return project;
}

export function getCurrentVocal(project: Project | null) {
  const asset = getPrimaryVocalAsset(project);
  if (asset?.storagePath) {
    return {
      id: asset.id,
      filename: asset.filename,
      url: asset.storagePath,
      uploaded_at: asset.createdAt,
      label: asset.filename,
    };
  }

  if (!project || project.vocal_versions.length === 0) return null;

  const lastIndex = project.vocal_versions.length - 1;
  const index = Math.max(0, Math.min(project.current_vocal_index, lastIndex));

  return project.vocal_versions[index] ?? null;
}

export function getCurrentVocalAsset(project: Project | null) {
  return getPrimaryVocalAsset(project);
}

export function isGeneratedChain(entry: unknown): entry is GeneratedChain {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      "chain_data" in entry &&
      Array.isArray((entry as GeneratedChain).chain_data?.chain)
  );
}

export function isChainModifier(entry: ProjectChainEntry): entry is ChainModifier {
  return "type" in entry && entry.type === "eq_cut";
}

export function getMixRoomModifiers(project: Project | null) {
  if (!project) return [];

  const reportCuts: ChainModifier[] =
    getMixRoomEQCuts(project.mix_room_report).map((cut) => ({
      type: "eq_cut",
      frequency: cut.frequency,
      gain: cut.gain,
      q: cut.q,
      source: cut.source,
    }));

  return [...reportCuts, ...project.generated_chains.filter(isChainModifier)];
}

export function getLatestGeneratedChain(project: Project | null) {
  if (!project) return null;

  const chain = project.generated_chains.find(isGeneratedChain) ?? null;
  if (!chain) return null;

  return withMixRoomCuts(chain, getMixRoomEQCuts(project.mix_room_report));
}
