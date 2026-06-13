"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  StemSplitFallback,
  StemSplitFileMeta,
  StemSplitInsightClaims,
  StemSplitInsightResponse,
  StemSplitJobResponse,
  StemSplitLane,
  StemSplitLaneName,
  StemSplitMode,
  StemSplitStatus,
} from "@/lib/types";

export interface StemSplitterLaneState {
  id: string;
  name: StemSplitLaneName;
  filename: string;
  url: string;
  fileMeta: StemSplitFileMeta | null;
  duration: number;
  isMuted: boolean;
  isSolo: boolean;
  volume: number;
  waveformReady: boolean;
}

interface StemSplitterStoreState {
  sourceUrl: string | null;
  sourceName: string | null;
  sourceSize: number | null;
  sourceDuration: number | null;
  sourceWaveform: number[];
  sourceBpm: number | null;
  sixStemAvailable: boolean;
  mode: StemSplitMode;

  jobId: string | null;
  status: StemSplitStatus;
  progress: number;
  stage: string;
  message: string;
  estimatedRemainingMs: number | null;
  error: string | null;
  fallback: StemSplitFallback | null;
  requestedMode: StemSplitMode;
  requestedModel: string;

  stems: StemSplitterLaneState[];
  globalPlaying: boolean;
  globalCurrentTime: number;
  duration: number;
  isSeeking: boolean;
  activeLaneIds: string[];

  insightText: string;
  insightClaims: StemSplitInsightClaims;
  insightStatus: StemSplitInsightResponse["status"];

  beginUpload: (file: File) => void;
  setSourcePreview: (
    url: string,
    name: string,
    size: number,
    duration: number | null,
    waveform: number[]
  ) => void;
  setSourceBpm: (bpm: number | null) => void;
  setMode: (mode: StemSplitMode) => void;
  setUploadedMetadata: (payload: {
    jobId: string;
    requestedMode: StemSplitMode;
    requestedModel: string;
  }) => void;
  setJobSnapshot: (job: StemSplitJobResponse) => void;
  setJobError: (message: string) => void;
  setSixStemAvailable: (isAvailable: boolean) => void;
  setLaneMute: (id: string, isMuted: boolean) => void;
  toggleLaneSolo: (id: string) => void;
  setLaneVolume: (id: string, volume: number) => void;
  setLaneWaveformReady: (id: string, ready: boolean) => void;
  setGlobalPlaying: (playing: boolean) => void;
  setGlobalCurrentTime: (time: number) => void;
  setSeeking: (state: boolean) => void;
  setDuration: (duration: number) => void;
  setActiveLanes: (ids: string[]) => void;
  setInsights: (text: string, claims: StemSplitInsightClaims) => void;
  setInsightStatus: (status: StemSplitInsightResponse["status"]) => void;
  clear: () => void;
}

const STORE_KEY = "mimiq-stem-splitter-session";
const DEFAULT_STEM_MODEL = "htdemucs";

const STEM_COLORS: StemSplitLaneName[] = [
  "vocals",
  "drums",
  "bass",
  "piano",
  "guitar",
  "other",
];

const DEFAULT_INSIGHT_CLAIMS: StemSplitInsightClaims = {
  measured: [],
  inferred: [],
  estimated: [],
  unknown: [],
};

const laneOrder = STEM_COLORS.reduce<Record<string, number>>((acc, name, index) => {
  acc[name] = index;
  return acc;
}, {});

const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const clampVolume = (value: number) => Math.max(0, Math.min(1, value));
const clampDuration = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

const sortLaneOrder = (stems: StemSplitterLaneState[]) =>
  stems.slice().sort(
    (left, right) =>
      (laneOrder[left.name] ?? STEM_COLORS.length) -
      (laneOrder[right.name] ?? STEM_COLORS.length)
  );

const createLaneFromJobStem = (
  id: string,
  source: StemSplitLane,
  existing?: StemSplitterLaneState
): StemSplitterLaneState => ({
  id,
  name: source.name as StemSplitLaneName,
  filename: source.filename,
  url: source.url,
  fileMeta: source.fileMeta ?? null,
  duration: source.fileMeta?.duration_s ?? 0,
  isMuted: existing?.isMuted ?? false,
  isSolo: existing?.isSolo ?? false,
  volume: existing?.volume ?? 0.85,
  waveformReady: existing?.waveformReady ?? false,
});

const defaultStatus = () => ({
  sourceUrl: null,
  sourceName: null,
  sourceSize: null,
  sourceDuration: null,
  sourceWaveform: [],
  sourceBpm: null,
  sixStemAvailable: true,
  mode: 4 as StemSplitMode,

  jobId: null,
  status: "idle" as StemSplitStatus,
  progress: 0,
  stage: "Ready",
  message: "Upload a WAV, MP3 or FLAC file to split stems.",
  estimatedRemainingMs: null,
  error: null,
  fallback: null,
  requestedMode: 4 as StemSplitMode,
  requestedModel: DEFAULT_STEM_MODEL,

  stems: [],
  globalPlaying: false,
  globalCurrentTime: 0,
  duration: 0,
  isSeeking: false,
  activeLaneIds: [],

  insightText: "",
  insightClaims: DEFAULT_INSIGHT_CLAIMS,
  insightStatus: "idle" as StemSplitInsightResponse["status"],
});

const persistSubset = (state: StemSplitterStoreState) => ({
  sourceName: state.sourceName,
  sourceSize: state.sourceSize,
  sourceDuration: state.sourceDuration,
  sourceWaveform: state.sourceWaveform,
  sourceBpm: state.sourceBpm,
  sixStemAvailable: state.sixStemAvailable,
  mode: state.mode,
  jobId: state.jobId,
  status: state.status,
  progress: state.progress,
  stage: state.stage,
  message: state.message,
  estimatedRemainingMs: state.estimatedRemainingMs,
  error: state.error,
  fallback: state.fallback,
  requestedMode: state.requestedMode,
  requestedModel: state.requestedModel,
  stems: state.stems,
  globalPlaying: state.globalPlaying,
  globalCurrentTime: state.globalCurrentTime,
  duration: state.duration,
  isSeeking: state.isSeeking,
  activeLaneIds: state.activeLaneIds,
  insightText: state.insightText,
  insightClaims: state.insightClaims,
  insightStatus: state.insightStatus,
});

export const useStemSplitterStore = create<StemSplitterStoreState>()(
  persist(
    (set, get) => ({
      ...defaultStatus(),

      beginUpload(file) {
        set({
          sourceName: file.name,
          sourceSize: file.size,
          sourceDuration: null,
          sourceWaveform: [],
          sourceBpm: null,
          jobId: null,
          status: "uploading",
          progress: 0,
          stage: "Uploading",
          message: "Uploading source file.",
          estimatedRemainingMs: null,
          error: null,
          fallback: null,
          requestedMode: get().mode,
          requestedModel: DEFAULT_STEM_MODEL,
          stems: [],
          globalPlaying: false,
          globalCurrentTime: 0,
          duration: 0,
          isSeeking: false,
          activeLaneIds: [],
          insightText: "",
          insightClaims: DEFAULT_INSIGHT_CLAIMS,
          insightStatus: "idle",
        });
      },

      setSourcePreview(url, name, size, duration, waveform) {
        set({
          sourceUrl: url,
          sourceName: name,
          sourceSize: size,
          sourceDuration: clampDuration(duration),
          sourceWaveform: waveform,
        });
      },

      setSourceBpm(bpm) {
        set({ sourceBpm: bpm });
      },

      setMode(mode) {
        if (["uploading", "queued", "processing"].includes(get().status)) return;

        set({
          mode,
          requestedMode: mode,
        });
      },

      setUploadedMetadata({ jobId, requestedMode, requestedModel }) {
        set({
          jobId,
          requestedMode,
          requestedModel: requestedModel || DEFAULT_STEM_MODEL,
          status: "queued",
          progress: 0,
          stage: "Queued",
          message: "Split queued.",
          estimatedRemainingMs: null,
          error: null,
          fallback: null,
          stems: [],
          globalPlaying: false,
          globalCurrentTime: 0,
          duration: 0,
          isSeeking: false,
          insightText: "",
          insightClaims: DEFAULT_INSIGHT_CLAIMS,
          insightStatus: "idle",
        });
      },

      setJobSnapshot(job) {
        const existingMap = new Map(
          get().stems.map((lane) => [lane.id, lane] as const)
        );
        const nextStems = sortLaneOrder(
          Object.entries(job.stems ?? {}).map(([stemId, stem]) =>
            createLaneFromJobStem(stemId, stem, existingMap.get(stemId))
          )
        );

        const nextDuration = Math.max(
          0,
          nextStems.reduce((maxDuration, lane) => Math.max(maxDuration, lane.duration), 0)
        );

        const requestedMode = job.requested_mode ?? get().mode;
        const requestedModel = job.requested_model || get().requestedModel;

        set({
          jobId: job.job_id,
          status: job.status as StemSplitStatus,
          progress: clampProgress(job.progress),
          stage: job.stage,
          message: job.message ?? "",
          estimatedRemainingMs:
            job.estimated_remaining_seconds != null
              ? Math.round(job.estimated_remaining_seconds * 1000)
              : null,
          error: job.error ?? null,
          requestedMode,
          requestedModel,
          sourceBpm:
            typeof job.source?.bpm === "number" ? job.source.bpm : get().sourceBpm,
          sourceDuration:
            typeof job.source?.duration === "number"
              ? clampDuration(job.source.duration)
              : get().sourceDuration,
          fallback: job.fallback ?? null,
          stems: nextStems,
          duration: nextDuration,
          globalPlaying: false,
          globalCurrentTime: job.status === "complete" ? Math.min(get().globalCurrentTime, nextDuration) : 0,
          isSeeking: false,
          activeLaneIds: nextStems.map((lane) => lane.id),
          sixStemAvailable:
            requestedMode === 6
              ? !Boolean(job.fallback)
              : get().sixStemAvailable,
        });
      },

      setJobError(message) {
        set({
          status: "failed",
          stage: "Failed",
          message,
          error: message,
        });
      },

      setSixStemAvailable(isAvailable) {
        set({ sixStemAvailable: isAvailable });
      },

      setLaneMute(id, isMuted) {
        set((state) => ({
          stems: state.stems.map((lane) =>
            lane.id === id ? { ...lane, isMuted } : lane
          ),
        }));
      },

      toggleLaneSolo(id) {
        set((state) => {
          const target = state.stems.find((lane) => lane.id === id);
          const shouldEnable = !target?.isSolo;

          if (!target) return state;

          return {
            stems: state.stems.map((lane) => ({
              ...lane,
              isSolo: shouldEnable ? lane.id === id : false,
            })),
          };
        });
      },

      setLaneVolume(id, volume) {
        const nextVolume = clampVolume(volume);
        set((state) => ({
          stems: state.stems.map((lane) =>
            lane.id === id ? { ...lane, volume: nextVolume } : lane
          ),
        }));
      },

      setLaneWaveformReady(id, ready) {
        set((state) => ({
          stems: state.stems.map((lane) =>
            lane.id === id ? { ...lane, waveformReady: ready } : lane
          ),
        }));
      },

      setGlobalPlaying(playing) {
        set({ globalPlaying: playing });
      },

      setGlobalCurrentTime(time) {
        set({ globalCurrentTime: Math.max(0, time) });
      },

      setSeeking(state) {
        set({ isSeeking: state });
      },

      setDuration(duration) {
        set({ duration: Math.max(0, duration) });
      },

      setActiveLanes(ids) {
        set({ activeLaneIds: ids });
      },

      setInsights(text, claims) {
        set({
          insightText: text,
          insightClaims: claims,
        });
      },

      setInsightStatus(status) {
        set({ insightStatus: status });
      },

      clear() {
        set(defaultStatus());
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) =>
        persistSubset({
          ...state,
        }),
    }
  )
);
