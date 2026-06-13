"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StudioShell } from "@/components/StudioShell";
import { ToolLockedOverlay } from "@/components/ToolLockedOverlay";
import { AudioAssetPicker, pickReadyAsset } from "@/components/AudioAssetPicker";

import { authHeaders } from "@/lib/apiAuth";
import { defaultEra, eras, type Era } from "@/lib/eras";
import { useStore } from "@/lib/store";
import { isLocalProject, useProject } from "@/lib/useProject";
import { saveProjectPatch } from "@/lib/projects";
import {
  createStoredAudioAsset,
  getProjectAudioAssets,
  upsertProjectAudioAsset,
} from "@/lib/projectAudio";
import { useAuth } from "@/lib/useAuth";
import { useStemSplitterStore, type StemSplitterLaneState } from "@/lib/useStemSplitterStore";
import { loadWaveSurferFactory, type WaveSurferInstance } from "@/lib/waveSurferLoader";
import type {
  StemSplitFileMeta,
  StemSplitInsightClaims,
  StemSplitInsightResponse,
  StemSplitJobResponse,
  StemSplitMode,
  StemSplitStatus,
} from "@/lib/types";
import styles from "./page.module.css";

interface LanePlaybackController {
  play: () => void;
  pause: () => void;
  setTime: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  isPlaying: () => boolean;
}

type ClaimSection = {
  key: keyof StemSplitInsightClaims;
  title: string;
};

const CLAIM_SECTIONS: ClaimSection[] = [
  { key: "measured", title: "Measured facts" },
  { key: "inferred", title: "AI interpretation" },
  { key: "estimated", title: "Estimated context" },
  { key: "unknown", title: "Unknowns / limits" },
];

const ACCEPTED_EXTENSIONS = [".wav", ".mp3", ".flac"];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
const DEFAULT_MODEL = "htdemucs";
const MODE_OPTIONS: StemSplitMode[] = [2, 4, 6];
const STAGE_TEXT: Record<StemSplitStatus, string> = {
  idle: "Ready",
  uploading: "Uploading",
  queued: "Queued",
  processing: "Splitting",
  complete: "Complete",
  failed: "Failed",
};
const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  piano: "Piano",
  guitar: "Guitar",
  other: "Other",
};
const STEM_COLORS: Record<string, string> = {
  vocals: "#39c0ff",
  drums: "#f85f75",
  bass: "#6b60ff",
  piano: "#67e18a",
  guitar: "#f2cd5f",
  other: "#8f8f8f",
};
const STEM_ORDER: Record<string, number> = {
  vocals: 0,
  drums: 1,
  bass: 2,
  piano: 3,
  guitar: 4,
  other: 5,
};

function formatBytes(value: number) {
  const mb = value / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function formatDuration(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "--:--";

  const total = Math.max(0, Math.floor(value as number));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseServiceError(res: Response) {
  return res.text().then((text) => {
    try {
      const parsed = JSON.parse(text) as { message?: string; detail?: string };
      return parsed.message || parsed.detail || "Stem split failed.";
    } catch {
      return text || "Stem split failed.";
    }
  });
}

function isAcceptedStemFile(file: File | null) {
  if (!file) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function readAudioPreview(file: File): Promise<{ duration: number; peaks: number[] }> {
  return new Promise((resolve, reject) => {
    const AudioContextImpl =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextImpl) {
      reject(new Error("Audio context unavailable."));
      return;
    }

    file
      .arrayBuffer()
      .then(async (buffer) => {
        const context = new AudioContextImpl();
        try {
          const decoded = await context.decodeAudioData(buffer.slice(0));
          const channel = decoded.getChannelData(0);
          const sampleSlots = 68;
          const chunk = Math.max(1, Math.floor(channel.length / sampleSlots));
          const peaks = Array.from({ length: sampleSlots }, (_, index) => {
            const start = index * chunk;
            const end = Math.min(channel.length, start + chunk);
            let maxPeak = 0;

            for (let i = start; i < end; i += 1) {
              maxPeak = Math.max(maxPeak, Math.abs(channel[i] ?? 0));
            }

            return maxPeak;
          });

          const maxPeak = Math.max(...peaks, 0.001);
          resolve({
            duration: decoded.duration,
            peaks: peaks.map((peak) => Math.max(0.05, peak / maxPeak)),
          });
        } catch (error) {
          reject(error);
        } finally {
          void context.close().catch(() => undefined);
        }
      })
      .catch(reject);
  });
}

function SourceWaveform({ peaks }: { peaks: number[] }) {
  if (peaks.length === 0) {
    return (
      <div className={styles.sourceWaveform} aria-hidden>
        {Array.from({ length: 42 }, (_, index) => (
          <span
            key={index}
            className={styles.sourceWaveBar}
            style={{ height: `${18 + ((index % 9) * 5)}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.sourceWaveform} aria-label="Source waveform preview">
      {peaks.map((peak, index) => (
        <span
          key={index}
          className={styles.sourceWaveBar}
          style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }}
        />
      ))}
    </div>
  );
}

function buildQualityLine(meta?: StemSplitFileMeta | null) {
  if (!meta) {
    return "-- • --Hz • --bit";
  }

  return `${formatDuration(meta.duration_s)} • ${meta.sample_rate} Hz • ${
    meta.bit_depth == null ? "unknown bit" : `${meta.bit_depth}-bit`
  }`;
}

function LaneWaveformCard({
  lane,
  color,
  isAudible,
  onController,
  onMute,
  onSolo,
  onVolume,
  onPlayPause,
}: {
  lane: StemSplitterLaneState;
  color: string;
  isAudible: boolean;
  onController: (id: string, controller: LanePlaybackController | null) => void;
  onMute: (id: string, muted: boolean) => void;
  onSolo: (id: string) => void;
  onVolume: (id: string, volume: number) => void;
  onPlayPause: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [instance, setInstance] = useState<LanePlaybackController | null>(null);
  const laneMutedRef = useRef(lane.isMuted);
  const laneVolumeRef = useRef(lane.volume);

  useEffect(() => {
    laneMutedRef.current = lane.isMuted;
    laneVolumeRef.current = lane.volume;
  }, [lane.isMuted, lane.volume]);

  useEffect(() => {
    let mounted = true;
    let wavesurfer: WaveSurferInstance | null = null;

    loadWaveSurferFactory()
      .then((WaveSurferFactory) => {
        if (!WaveSurferFactory || !containerRef.current || !mounted) {
          return;
        }

        if (typeof WaveSurferFactory.create !== "function") {
          throw new Error("WaveSurfer factory missing create.");
        }

        wavesurfer = WaveSurferFactory.create({
          container: containerRef.current,
          url: lane.url,
          waveColor: "rgba(255,255,255,0.14)",
          progressColor: color,
          cursorColor: "transparent",
          cursorWidth: 0,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 58,
          normalize: true,
          responsive: true,
          interact: false,
        });

        const controller: LanePlaybackController = {
          play: () => wavesurfer?.play?.(),
          pause: () => wavesurfer?.pause?.(),
          setTime: (seconds) => wavesurfer?.setTime?.(seconds),
          getCurrentTime: () => wavesurfer?.getCurrentTime?.() ?? 0,
          getDuration: () => wavesurfer?.getDuration?.() ?? 0,
          setVolume: (volume) => wavesurfer?.setVolume?.(volume),
          isPlaying: () => wavesurfer?.isPlaying?.() ?? false,
        };

        setInstance(controller);
        onController(lane.id, controller);

        const onReady = () => {
          if (!mounted) {
            return;
          }

          wavesurfer?.setVolume?.(
            laneMutedRef.current ? 0 : laneVolumeRef.current
          );
          setReady(true);
        };

        const onPlay = () => {
          if (mounted) {
            setIsPlaying(true);
          }
        };

        const onPause = () => {
          if (mounted) {
            setIsPlaying(false);
          }
        };

        const onFinish = () => {
          if (mounted) {
            setIsPlaying(false);
          }
        };

        const onError = () => {
          if (!mounted) return;
          setError(true);
          setReady(true);
        };

        wavesurfer.on("ready", onReady);
        wavesurfer.on("play", onPlay);
        wavesurfer.on("pause", onPause);
        wavesurfer.on("finish", onFinish);
        wavesurfer.on("error", onError);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setError(true);
        setReady(true);
      });

    return () => {
      mounted = false;
      onController(lane.id, null);
      if (wavesurfer?.destroy) {
        wavesurfer.destroy();
      }
      setInstance(null);
      setReady(false);
      setIsPlaying(false);
    };
  }, [lane.id, lane.url, color, onController]);

  useEffect(() => {
    if (!instance) return;
    instance.setVolume(lane.isMuted ? 0 : lane.volume);
  }, [instance, lane.isMuted, lane.volume]);

  return (
    <motion.article
      className={styles.laneCard}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{ opacity: isAudible ? 1 : 0.65 }}
    >
      <header className={styles.laneHeader}>
        <div className={styles.laneTitleWrap}>
          <span className={styles.laneChip} style={{ color, borderColor: `${color}aa` }}>
            {STEM_LABELS[lane.name]}
          </span>
          <span className={styles.laneFilename}>{lane.filename}</span>
        </div>
        <a href={lane.url} className={styles.downloadButton} download={lane.filename}>
          WAV
        </a>
      </header>

      <p className={styles.laneMeta}>{buildQualityLine(lane.fileMeta)}</p>

      <div className={styles.laneWaveform} ref={containerRef} aria-label={`${lane.name} waveform`}>
        {!ready && !error ? <span>Loading waveform…</span> : null}
        {error ? <span>Could not load waveform.</span> : null}
      </div>

      <div className={styles.laneControls}>
        <button
          className={styles.playButton}
          type="button"
          onClick={() => onPlayPause(lane.id)}
          disabled={error}
          aria-label={`${isPlaying ? "Pause" : "Play"} lane ${STEM_LABELS[lane.name]}`}
        >
          {isPlaying ? "II" : "▶"}
        </button>

        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => onMute(lane.id, !lane.isMuted)}
        >
          {lane.isMuted ? "Unmute" : "Mute"}
        </button>

        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => onSolo(lane.id)}
        >
          {lane.isSolo ? "Unsolo" : "Solo"}
        </button>

        <input
          className={styles.volumeRange}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={lane.volume}
          onChange={(event) => onVolume(lane.id, Number(event.currentTarget.value))}
          aria-label={`${STEM_LABELS[lane.name]} volume`}
        />
      </div>
    </motion.article>
  );
}

function InsightPanel({
  status,
  summary,
  claims,
}: {
  status: StemSplitInsightResponse["status"];
  summary: string;
  claims: StemSplitInsightClaims;
}) {
  return (
    <section className={styles.insightPanel}>
      <h2 className={styles.sectionTitle}>AI insight panel</h2>
      <p className={styles.insightSummary}>{summary || "Awaiting completion."}</p>

      <div className={styles.insightBuckets}>
        {CLAIM_SECTIONS.map((section) => (
          <article
            key={section.key}
            className={styles.insightBucket}
            data-loading={status === "loading" ? "true" : "false"}
            data-error={status === "error" ? "true" : "false"}
          >
            <h3>{section.title}</h3>
            {claims[section.key].length === 0 ? (
              <p className={styles.insightEmpty}>No {section.title.toLowerCase()} claims yet.</p>
            ) : (
              <ul>
                {claims[section.key].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function StemSplitterPage() {
  const { daw: activeEraDaw, setEra } = useStore();
  const activeEra = eras.find((era) => era.id === activeEraDaw) || defaultEra;
  const project = useProject((state) => state.project);
  const updateProject = useProject((state) => state.updateProject);
  const user = useAuth((state) => state.user);

  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [sourcePeaks, setSourcePeaks] = useState<number[]>([]);
  const [savedZip, setSavedZip] = useState(false);
  const [latestJob, setLatestJob] = useState<StemSplitJobResponse | null>(null);
  const [selectedSourceAssetId, setSelectedSourceAssetId] = useState<string | null>(null);

  const pollControllerRef = useRef<AbortController | null>(null);
  const laneControllers = useRef<Record<string, LanePlaybackController | null>>({});
  const seekDragRef = useRef(false);
  const persistedJobRef = useRef<string | null>(null);

  const {
    sourceName,
    sourceSize,
    sourceDuration,
    sourceBpm,
    sourceUrl,
    mode,
    status,
    progress,
    stage,
    message,
    estimatedRemainingMs,
    error,
    jobId,
    stems,
    fallback,
    sixStemAvailable,
    globalPlaying,
    globalCurrentTime,
    duration,
    isSeeking,
    activeLaneIds,
    insightText,
    insightClaims,
    insightStatus,
    beginUpload,
    setSourcePreview,
    setSourceBpm,
    setMode,
    setUploadedMetadata,
    setJobSnapshot,
    setJobError,
    setLaneMute,
    toggleLaneSolo,
    setLaneVolume,
    setGlobalPlaying,
    setGlobalCurrentTime,
    setSeeking,
    setActiveLanes,
    setInsights,
    setInsightStatus,
    setSixStemAvailable,
    clear,
  } = useStemSplitterStore((state) => state);
  const projectAudioAssets = getProjectAudioAssets(project);
  const selectedSourceAsset =
    projectAudioAssets.find((asset) => asset.id === selectedSourceAssetId) ??
    pickReadyAsset(projectAudioAssets, ["full_song", "beat", "stem"], ["full_song"]);

  const orderedStems = useMemo(
    () =>
      [...stems].sort(
        (left, right) =>
          (STEM_ORDER[left.name] ?? 99) - (STEM_ORDER[right.name] ?? 99)
      ),
    [stems]
  );

  const audibleLaneIds = useMemo(() => {
    const hasSolo = orderedStems.some((lane) => lane.isSolo);
    return orderedStems
      .filter((lane) => (hasSolo ? lane.isSolo : !lane.isMuted))
      .map((lane) => lane.id);
  }, [orderedStems]);

  const hasAudibleLane = useMemo(() => {
    return audibleLaneIds.length > 0;
  }, [audibleLaneIds.length]);

  const laneById = useMemo(
    () => new Map(orderedStems.map((lane) => [lane.id, lane])),
    [orderedStems]
  );

  const totalDuration = useMemo(() => {
    if (duration > 0) return duration;
    return orderedStems.reduce(
      (max, lane) => Math.max(max, Number(lane.fileMeta?.duration_s || 0)),
      0
    );
  }, [duration, orderedStems]);

  const updateLaneController = useCallback((id: string, controller: LanePlaybackController | null) => {
    laneControllers.current[id] = controller;
  }, []);

  const handleGlobalPlayPause = useCallback(() => {
    const activeIds = audibleLaneIds.length > 0 ? audibleLaneIds : orderedStems.map((lane) => lane.id);

    if (activeIds.length === 0) return;

    if (globalPlaying) {
      activeIds.forEach((id) => {
        const controller = laneControllers.current[id];
        if (controller) {
          controller.pause();
        }
      });
      setGlobalPlaying(false);
      return;
    }

    activeIds.forEach((id) => {
      const lane = laneById.get(id);
      const controller = laneControllers.current[id];
      if (!lane || !controller) return;
      const targetTime = Math.min(globalCurrentTime, Math.max(0, controller.getDuration() - 0.03));
      controller.setTime(targetTime);
      controller.setVolume(lane.isMuted ? 0 : lane.volume);
      controller.play();
    });

    orderedStems
      .filter((lane) => !activeIds.includes(lane.id))
      .forEach((lane) => {
        const controller = laneControllers.current[lane.id];
        if (controller) {
          controller.pause();
        }
      });

    setActiveLanes(activeIds);
    setGlobalPlaying(true);
  }, [globalCurrentTime, globalPlaying, orderedStems, audibleLaneIds, setActiveLanes, setGlobalPlaying, laneById]);

  const latestSeekRef = useRef<number>(0);

  const handleGlobalSeek = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const seek = Number(event.currentTarget.value);
      latestSeekRef.current = seek;
      setSeeking(true);
      seekDragRef.current = true;
      setGlobalCurrentTime(seek);
    },
    [setGlobalCurrentTime, setSeeking]
  );

  const handleGlobalSeekRelease = useCallback(() => {
    seekDragRef.current = false;
    
    const seek = latestSeekRef.current;
    audibleLaneIds.forEach((id) => {
      const controller = laneControllers.current[id];
      if (controller) {
        controller.setTime(seek);
      }
    });

    setSeeking(false);
  }, [audibleLaneIds, setSeeking]);

  const requestInsights = useCallback(
    async (job: StemSplitJobResponse) => {
      try {
        setInsightStatus("loading");

        const response = await fetch("/api/stem-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job,
            project: project
              ? {
                  id: project.id,
                  name: project.name,
                  stem_split_url: project.stem_split_url,
                }
              : null,
          }),
        });

        const data = (await response.json()) as StemSplitInsightResponse;
        setInsights(data.summary ?? "Stem split insights generated.", data.claims);
        setInsightStatus(response.ok ? data.status : "error");
      } catch {
        setInsightStatus("error");
        setInsights("Could not generate stem insights.", {
          measured: [],
          inferred: [],
          estimated: [],
          unknown: ["Insight service unavailable."],
        });
      }
    },
    [project, setInsightStatus, setInsights]
  );

  const handleSubmit = useCallback(
    async (params: { file?: File | null; assetId?: string | null }) => {
      const file = params.file ?? null;
      if (!isAcceptedStemFile(file)) {
        setValidationMessage("Use WAV, MP3, or FLAC files only.");
        return;
      }

      if (file && file.size > MAX_FILE_SIZE) {
        setValidationMessage("Audio file exceeds 50 MB.");
        return;
      }

      if (!project || !user || isLocalProject(project)) {
        setValidationMessage("Sign in and select a project before splitting stems.");
        return;
      }

      setValidationMessage(null);
      setSourcePeaks([]);
      setLatestJob(null);
      persistedJobRef.current = null;
      setSavedZip(false);
      beginUpload(
        file ??
          new File([], selectedSourceAsset?.filename ?? "project-audio.mp3", {
            type: selectedSourceAsset?.mimeType ?? "audio/mpeg",
          })
      );
      setSourcePreview(
        "",
        file?.name ?? selectedSourceAsset?.filename ?? "Project asset",
        file?.size ?? selectedSourceAsset?.size ?? 0,
        null,
        []
      );
      setSourceBpm(null);

      if (file) try {
        const preview = await readAudioPreview(file);
        setSourcePreview("", file.name, file.size, preview.duration, preview.peaks);
        setSourcePeaks(preview.peaks);
      } catch {
        setSourcePeaks([]);
      }

      try {
        const formData = new FormData();
        if (project.id) formData.append("projectId", project.id);
        if (params.assetId) formData.append("sourceAssetId", params.assetId);
        if (file) formData.append("audio", file);
        formData.append("mode", String(mode));
        formData.append("model", DEFAULT_MODEL);

        const response = await fetch("/api/split-stems", {
          method: "POST",
          body: formData,
          headers: await authHeaders(),
        });

        if (!response.ok) {
          const reason = await parseServiceError(response);
          setJobError(reason);
          return;
        }

        const job = (await response.json()) as StemSplitJobResponse;
        setUploadedMetadata({
          jobId: job.job_id,
          requestedMode: job.requested_mode,
          requestedModel: job.requested_model,
        });
        setJobSnapshot(job);
        setLatestJob(job);
      } catch (error) {
        setJobError(error instanceof Error ? error.message : "Stem split request failed.");
      }
    },
	    [
        beginUpload,
        mode,
        project,
        setJobError,
        setJobSnapshot,
        setSourceBpm,
        setSourcePreview,
        setUploadedMetadata,
        selectedSourceAsset?.filename,
        selectedSourceAsset?.mimeType,
        selectedSourceAsset?.size,
        user,
      ]
	  );

  const handleSelectedAssetSplit = useCallback(async () => {
    if (!selectedSourceAsset) {
      setValidationMessage("Select or upload a full song, beat, or stem.");
      return;
    }

    try {
      setValidationMessage(null);
      await handleSubmit({ assetId: selectedSourceAsset.id });
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : "Stem Splitter could not load that asset."
      );
    }
  }, [handleSubmit, selectedSourceAsset]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", activeEra.accent);
  }, [activeEra.accent]);

  useEffect(() => () => pollControllerRef.current?.abort(), []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!jobId || (status !== "queued" && status !== "processing")) {
      return;
    }

    let active = true;
    pollControllerRef.current?.abort();
    pollControllerRef.current = new AbortController();
    const { signal } = pollControllerRef.current;

    const poll = async () => {
      if (!jobId || signal.aborted || !active) {
        return;
      }

      try {
        const response = await fetch(`/api/split-stems/${jobId}`, {
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          const reason = await parseServiceError(response);
          setJobError(reason);
          return;
        }

        const job = (await response.json()) as StemSplitJobResponse;
        setJobSnapshot(job);
        setLatestJob(job);

        if (job.requested_mode === 6) {
          setSixStemAvailable(!Boolean(job.fallback));
        }

        if (job.status === "complete" && persistedJobRef.current !== job.job_id) {
          void requestInsights(job);
          persistedJobRef.current = job.job_id;
        }
      } catch (err) {
        if (signal.aborted || !active) return;
        setJobError(err instanceof Error ? err.message : "Stem split status check failed.");
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      pollControllerRef.current?.abort();
    };
  }, [jobId, requestInsights, setJobError, setJobSnapshot, setSixStemAvailable, status]);

  const savedZipJobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId || status !== "complete" || !latestJob || !project || isLocalProject(project)) {
      return;
    }
    if (persistedJobRef.current !== jobId) {
      return;
    }
    if (savedZipJobRef.current === jobId) {
      return;
    }

    const zipUrl = `/api/split-stems/${jobId}/zip`;
    const existingAssets = getProjectAudioAssets(project);

    if (existingAssets.some((a) => a.storage_path === zipUrl)) {
      savedZipJobRef.current = jobId;
      setSavedZip(true);
      return;
    }

    savedZipJobRef.current = jobId;

    void (async () => {
      try {
        const stemAsset = createStoredAudioAsset({
          kind: "stem",
          filename: `${project.name}-stems.zip`,
          mimeType: "application/zip",
          storagePath: zipUrl,
        });
        const audio_assets = upsertProjectAudioAsset(
          getProjectAudioAssets(project),
          stemAsset
        );
        const patch = await saveProjectPatch(project.id, { audio_assets });
        updateProject({ audio_assets: patch.audio_assets });
        setSavedZip(true);
      } catch {
        setSavedZip(false);
      }
    })();
  }, [jobId, latestJob, project, status, updateProject]);

  useEffect(() => {
    if (status !== "processing" && status !== "complete") {
      return;
    }

    if (!globalPlaying || isSeeking) {
      return;
    }

    const activeIds =
      activeLaneIds.length > 0 ? activeLaneIds : audibleLaneIds.length > 0 ? audibleLaneIds : orderedStems.map((lane) => lane.id);
    if (activeIds.length === 0) return;

    let handle = requestAnimationFrame(() => undefined);

    const tick = () => {
      const leadId = activeIds[0];
      const lead = leadId ? laneControllers.current[leadId] : null;
      if (!lead) {
        handle = requestAnimationFrame(tick);
        return;
      }

      const current = lead.getCurrentTime();
      const total = lead.getDuration();
      setGlobalCurrentTime(Math.min(current, Math.max(0, total)));

      if (current >= Math.max(0, total - 0.05)) {
        setGlobalPlaying(false);
        activeIds.forEach((id) => {
          const controller = laneControllers.current[id];
          if (controller) {
            controller.pause();
          }
        });
        return;
      }

      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [
    activeLaneIds,
    audibleLaneIds,
    globalPlaying,
    isSeeking,
    orderedStems,
    setGlobalCurrentTime,
    setGlobalPlaying,
    status,
  ]);

  const onModeClick = useCallback(
    (nextMode: StemSplitMode) => {
      if (status === "uploading" || status === "queued" || status === "processing") {
        return;
      }

      if (nextMode === 6 && !sixStemAvailable) {
        return;
      }

      setMode(nextMode);
    },
    [setMode, status, sixStemAvailable]
  );

  const onLanePlayPause = useCallback(
    (laneId: string) => {
      const lane = laneById.get(laneId);
      const ctrl = laneControllers.current[laneId];
      if (!lane || !ctrl) return;

      if (ctrl.isPlaying()) {
        orderedStems.forEach((row) => {
          const rowCtrl = laneControllers.current[row.id];
          if (rowCtrl) rowCtrl.pause();
        });
        setActiveLanes([]);
        setGlobalPlaying(false);
        return;
      }

      orderedStems.forEach((row) => {
        const rowCtrl = laneControllers.current[row.id];
        if (!rowCtrl || row.id !== laneId) {
          if (rowCtrl && row.id !== laneId) rowCtrl.pause();
          return;
        }

        rowCtrl.setTime(globalCurrentTime);
        rowCtrl.setVolume(row.isMuted ? 0 : row.volume);
        rowCtrl.play();
      });

      setActiveLanes([laneId]);
      setGlobalPlaying(false);
    },
    [globalCurrentTime, laneById, orderedStems, setActiveLanes, setGlobalPlaying]
  );

  const canInteract = status === "idle" || status === "failed" || status === "complete";

  const handleClear = useCallback(() => {
    clear();
    setValidationMessage(null);
    setSourcePeaks([]);
    setLatestJob(null);
    setSavedZip(false);
    persistedJobRef.current = null;
    setInsights("", { measured: [], inferred: [], estimated: [], unknown: [] });
    setInsightStatus("idle");
  }, [clear, setInsights, setInsightStatus]);

  const fileSummary = sourceName && sourceSize
    ? `${sourceName} • ${formatBytes(sourceSize)} • ${formatDuration(sourceDuration)}`
    : "No source loaded";

  const estimatedText =
    estimatedRemainingMs == null ? "estimating" : `${Math.ceil(estimatedRemainingMs / 1000)}s`;

  const stateLabel = STAGE_TEXT[status] ?? "Ready";
  const hasStemSourceAsset = getProjectAudioAssets(project).some(
    (asset) =>
      asset.status === "ready" &&
      (asset.kind === "full_song" || asset.kind === "beat" || asset.kind === "stem")
  );

  return (
    <StudioShell
      activePage="stem-splitter"
      savedCount={project?.vocal_versions?.length ?? 0}
      contentClassName={styles.contentArea}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }}>
        <header className="globalToolHeader">
          <div className="globalToolHeaderTitle">
            <span>Isolation</span>
            <h1>Stem Rip</h1>
          </div>
          <div className="globalToolHeaderPickers">
            <AudioAssetPicker
              label="Source"
              value={selectedSourceAsset?.id ?? selectedSourceAssetId}
              onChange={setSelectedSourceAssetId}
              allowedKinds={["full_song", "beat", "stem"]}
              preferredKinds={["full_song"]}
              emptyLabel="Song or stem"
              variant="compact"
            />
          </div>
        </header>

      <ToolLockedOverlay
        key={project ? `${project.id}:stem-splitter` : "stem-splitter"}
        locked={!hasStemSourceAsset}
        momentKey={project ? `${project.id}:stem-splitter` : "stem-splitter"}
      >
          <motion.header
            className={styles.header}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >

            <div className={styles.modeSelector}>
              {MODE_OPTIONS.map((item) => {
                const isUnavailable = item === 6 && !sixStemAvailable;
                return (
                  <button
                    key={item}
                    type="button"
                    className={styles.modePill}
                    data-active={mode === item}
                    data-disabled={isUnavailable}
                    disabled={isUnavailable || !canInteract}
                    onClick={() => onModeClick(item)}
                  >
                    {item}-stem
                  </button>
                );
              })}

              <button
                type="button"
                className={styles.resetButton}
                onClick={handleClear}
                disabled={status === "uploading" || status === "queued" || status === "processing"}
              >
                Reset
              </button>
            </div>
          </motion.header>

          <motion.main
            className={styles.contentPanel}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          >
            {status === "idle" || status === "failed" || status === "uploading" ? (
              <section key="idle" className={styles.card}>
                {!hasStemSourceAsset ? (
                  <div style={{ opacity: 0.3, pointerEvents: "none", display: "grid", gap: "10px" }}>
                    <div className={styles.transportWrap} style={{ borderTop: "none", paddingTop: 0 }}>
                      <button className={styles.globalPlayButton} disabled><span>▶</span><span>Play / Pause All</span></button>
                      <input type="range" className={styles.seekBar} disabled />
                    </div>
                    <div className={styles.laneStack}>
                      {["vocals", "drums", "bass", "other"].map((name, i) => (
                        <div key={name} className={styles.laneCard}>
                          <div className={styles.laneHeader}>
                            <div className={styles.laneTitleWrap}>
                              <span className={styles.laneChip} style={{ borderColor: ["#CBFF1E", "#FF6B6B", "#4FACFE", "#A770EF"][i] }}>{name.toUpperCase()}</span>
                            </div>
                            <div className={styles.laneControls}>
                              <button className={styles.playButton} disabled>▶</button>
                              <button className={styles.toggleButton} disabled>M</button>
                              <button className={styles.toggleButton} disabled>S</button>
                              <input type="range" className={styles.volumeRange} disabled />
                            </div>
                          </div>
                          <div className={styles.laneWaveform}>
                            <div className={styles.sourceWaveform}>
                              {Array.from({ length: 42 }).map((_, idx) => (
                                <span key={idx} className={styles.sourceWaveBar} style={{ height: `${18 + (((idx + i * 3) % 9) * 5)}%` }} />
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                <div className={styles.emptyPanel}>

                  <button
                    type="button"
                    className={styles.globalPlayButton}
                    onClick={() => void handleSelectedAssetSplit()}
                    disabled={!selectedSourceAsset || status === "uploading"}
                  >
                    Split selected asset
                  </button>

                  <div className={styles.fileChips}>
                    {ACCEPTED_EXTENSIONS.map((ext) => (
                      <span key={ext} className={styles.fileChip}>
                        {ext.toUpperCase()}
                      </span>
                    ))}
                  </div>

                  {validationMessage ? <p className={styles.errorText}>{validationMessage}</p> : null}
                  {error ? <p className={styles.errorText}>{error}</p> : null}

                  {sourceUrl ? (
                    <section className={styles.previewStrip}>
                      <div className={styles.previewTitle}>Source preview</div>
                      <div>{fileSummary}</div>
                      <SourceWaveform peaks={sourcePeaks} />
                    </section>
                  ) : null}
                </div>
                )}
              </section>
            ) : (
              <AnimatePresence mode="wait">
                <motion.section
                  key="work"
                  className={styles.card}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <section className={styles.statusPanel}>
                    <div>
                      <div className={styles.statusTitle}>Source</div>
                      <div className={styles.statusMeta}>{fileSummary}</div>
                      <div className={styles.statusMeta}>
                        Duration {formatDuration(sourceDuration)} • BPM {sourceBpm ?? "--"}
                      </div>
                    </div>

                    <SourceWaveform peaks={sourcePeaks} />

                    <div className={styles.progressWrap}>
                      <div className={styles.progressText}>
                        {stateLabel}: {Math.round(progress)}%
                        <span className={styles.stageBadge}>{stage}</span>
                      </div>

                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressBar}
                          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                        />
                      </div>

                      <div className={styles.statusHint}>{message}</div>
                      {estimatedRemainingMs != null && status !== "complete" ? (
                        <div className={styles.statusHint}>ETA {estimatedText}</div>
                      ) : null}
                      {status === "complete" ? <div className={styles.statusHint}>Split complete.</div> : null}
                    </div>
                  </section>

                  {status === "complete" ? (
                    <>
                      <section className={styles.transportWrap}>
                        <button
                          type="button"
                          className={styles.globalPlayButton}
                          onClick={handleGlobalPlayPause}
                          disabled={orderedStems.length === 0 || !hasAudibleLane}
                          aria-label={globalPlaying ? "Pause all stems" : "Play all stems"}
                        >
                          <span>{globalPlaying ? "II" : "▶"}</span>
                          <span>Play / Pause All</span>
                        </button>

                        <input
                          type="range"
                          className={styles.seekBar}
                          min={0}
                          max={totalDuration}
                          step={0.02}
                          value={Math.min(globalCurrentTime, totalDuration)}
                          onChange={handleGlobalSeek}
                          onMouseUp={handleGlobalSeekRelease}
                          onPointerUp={handleGlobalSeekRelease}
                          onTouchEnd={handleGlobalSeekRelease}
                          aria-label="Seek stems"
                        />

                        <div className={styles.timeReadout}>
                          {formatDuration(globalCurrentTime)} / {formatDuration(totalDuration)}
                        </div>
                      </section>

                      <section className={styles.laneStack}>
                        {orderedStems.map((lane) => (
                          <LaneWaveformCard
                            key={lane.id}
                            lane={lane}
                            color={STEM_COLORS[lane.name] || "#8f8f8f"}
                            isAudible={audibleLaneIds.includes(lane.id)}
                            onController={updateLaneController}
                            onMute={(id, muted) => {
                              setLaneMute(id, muted);
                            }}
                            onSolo={(id) => {
                              toggleLaneSolo(id);
                            }}
                            onVolume={(id, value) => {
                              setLaneVolume(id, value);
                            }}
                            onPlayPause={onLanePlayPause}
                          />
                        ))}
                      </section>

                      {fallback ? (
                        <section className={styles.fallbackNotice}>
                          {fallback.reason} {fallback.delivered_stems.length} stem lane(s) returned.
                        </section>
                      ) : null}

                      <section className={styles.downloadRow}>
                        <a
                          className={styles.downloadButton}
                          href={jobId ? `/api/split-stems/${jobId}/zip` : "#"}
                          download="stems.zip"
                          aria-label="Download all stems as zip"
                        >
                          Download all as ZIP
                        </a>
                        <span className={styles.saveStatus}>
                          {savedZip ? "Saved in project" : ""}
                        </span>
                      </section>

                      <InsightPanel
                        status={insightStatus}
                        summary={insightText}
                        claims={insightClaims}
                      />
                    </>
                  ) : null}
                </motion.section>
              </AnimatePresence>
            )}
          </motion.main>
      </ToolLockedOverlay>
      </div>

    </StudioShell>
  );
}
