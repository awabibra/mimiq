"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Sidebar } from "@/components/Sidebar";
import { ProjectGate } from "@/components/ProjectGate";
import { ToolLockedOverlay } from "@/components/ToolLockedOverlay";
import { AudioAssetPicker } from "@/components/AudioAssetPicker";

import { authHeaders } from "@/lib/apiAuth";
import { useStore } from "@/lib/store";
import { saveProjectPatch } from "@/lib/projects";
import {
  getFullSongAsset,
  getPrimaryBeatAsset,
  getPrimaryVocalAsset,
  getProjectAudioAssets,
  resolveAssetFile,
} from "@/lib/projectAudio";
import {
  appendMixRoomEQCut,
  getCurrentVocal,
  getMixRoomEQCuts,
  isMixRoomReport,
  useProject,
} from "@/lib/useProject";
import { eras, defaultEra } from "@/lib/eras";
import type {
  CollisionZone,
  MixRoomReport,
  SpectralData,
} from "@/lib/types";
import styles from "./page.module.css";

const MIX_ROOM_UPLOAD_MAX_SIZE = 50 * 1024 * 1024;

const FFT_SIZE = 4096;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_DB = -80;
const MAX_DB = 0;
const EXPIRED_FILE_ACCESS_MESSAGE = "File access expired, please re-upload.";

interface CurvePoint {
  f: number;
  db: number;
}

interface SpectrumState {
  vocal: SpectralData;
  beat: SpectralData;
}

type AudioTrackKind = "vocal" | "beat";
type AudioSourceOrigin = "session-file" | "project" | "audio-store" | "expired" | "missing";

interface AudioSourceDescriptor {
  kind: AudioTrackKind;
  file: File | null;
  source: string | null;
  playbackUrl: string | null;
  origin: AudioSourceOrigin;
  expired: boolean;
}

interface HoverState {
  x: number;
  y: number;
  frequency: number;
  cursorDb: number;
  vocalDb: number;
  beatDb: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const logScale = (freq: number) => {
  const safeFreq = clamp(freq, MIN_FREQ, MAX_FREQ);
  return (
    ((Math.log10(safeFreq) - Math.log10(MIN_FREQ)) /
      (Math.log10(MAX_FREQ) - Math.log10(MIN_FREQ))) *
    100
  );
};

const frequencyFromX = (xPercent: number) =>
  Math.pow(
    10,
    Math.log10(MIN_FREQ) +
      (clamp(xPercent, 0, 100) / 100) *
        (Math.log10(MAX_FREQ) - Math.log10(MIN_FREQ))
  );

const dbToY = (db: number) =>
  ((MAX_DB - clamp(db, MIN_DB, MAX_DB)) / (MAX_DB - MIN_DB)) * 100;

const yToDb = (yPercent: number) =>
  MAX_DB - (clamp(yPercent, 0, 100) / 100) * (MAX_DB - MIN_DB);

const formatFrequency = (freq: number) => {
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }

  return `${Math.round(freq)} Hz`;
};

const formatDb = (db: number) => `${db.toFixed(1)} dB`;

const formatRange = (zone: { startFreq: number; endFreq: number }) =>
  `${formatFrequency(zone.startFreq)} - ${formatFrequency(zone.endFreq)}`;

const severityLabel = (severity: number) => {
  if (severity >= 52) return "HIGH";
  if (severity >= 28) return "MED";
  return "LOW";
};

const pluginForDaw = (daw: string) => {
  const lower = daw.toLowerCase();
  if (lower.includes("fl")) return "Fruity Parametric EQ 2";
  if (lower.includes("ableton")) return "EQ Eight";
  if (lower.includes("logic")) return "Channel EQ";
  if (lower.includes("pro tools")) return "EQ III";
  if (lower.includes("studio one")) return "Pro EQ";
  return "your stock EQ";
};

const getAudioContext = () => {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Web Audio API is unavailable in this browser.");
  }

  return new AudioCtx();
};

function fft(real: Float64Array, imag: Float64Array) {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;

    if (i < j) {
      const realTemp = real[i];
      const imagTemp = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = realTemp;
      imag[j] = imagTemp;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;

      for (let j = 0; j < len / 2; j++) {
        const evenReal = real[i + j];
        const evenImag = imag[i + j];
        const oddReal = real[i + j + len / 2] * wReal - imag[i + j + len / 2] * wImag;
        const oddImag = real[i + j + len / 2] * wImag + imag[i + j + len / 2] * wReal;

        real[i + j] = evenReal + oddReal;
        imag[i + j] = evenImag + oddImag;
        real[i + j + len / 2] = evenReal - oddReal;
        imag[i + j + len / 2] = evenImag - oddImag;

        const nextReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextReal;
      }
    }
  }
}

function getWindowStarts(sampleCount: number) {
  if (sampleCount <= FFT_SIZE) return [0];

  const positions = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92];
  const maxStart = sampleCount - FFT_SIZE;
  return positions.map((position) => Math.round(maxStart * position));
}

async function analyzeSpectrum(file: File): Promise<SpectralData> {
  const ctx = getAudioContext();

  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const bins = FFT_SIZE / 2;
    const starts = getWindowStarts(buffer.length);
    const sums = new Float64Array(bins);
    const hann = Array.from(
      { length: FFT_SIZE },
      (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
    );
    const windowGain =
      hann.reduce((sum, value) => sum + value, 0) / FFT_SIZE;
    const scale = (FFT_SIZE * windowGain) / 2;

    for (const start of starts) {
      const real = new Float64Array(FFT_SIZE);
      const imag = new Float64Array(FFT_SIZE);

      for (let i = 0; i < FFT_SIZE; i++) {
        const sampleIndex = start + i;
        let sample = 0;

        if (sampleIndex < buffer.length) {
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            sample += buffer.getChannelData(channel)[sampleIndex] ?? 0;
          }
          sample /= Math.max(1, buffer.numberOfChannels);
        }

        real[i] = sample * hann[i];
      }

      fft(real, imag);

      for (let bin = 0; bin < bins; bin++) {
        sums[bin] += Math.hypot(real[bin], imag[bin]) / scale;
      }
    }

    return {
      frequencies: Array.from(
        { length: bins },
        (_, i) => (i * buffer.sampleRate) / FFT_SIZE
      ),
      magnitudes: Array.from(sums, (sum) =>
        clamp(20 * Math.log10(Math.max(sum / starts.length, 1e-8)), -120, 0)
      ),
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function interpolateSpectrum(data: SpectralData | null, frequency: number) {
  if (!data || data.frequencies.length < 2) return MIN_DB;

  const binWidth = data.frequencies[1] - data.frequencies[0];
  if (binWidth <= 0) return MIN_DB;

  const rawIndex = frequency / binWidth;
  const lower = Math.floor(rawIndex);
  const upper = Math.ceil(rawIndex);

  if (lower < 0) return data.magnitudes[0] ?? MIN_DB;
  if (upper >= data.magnitudes.length) {
    return data.magnitudes[data.magnitudes.length - 1] ?? MIN_DB;
  }

  const ratio = rawIndex - lower;
  return (
    (data.magnitudes[lower] ?? MIN_DB) * (1 - ratio) +
    (data.magnitudes[upper] ?? MIN_DB) * ratio
  );
}

function buildCurve(data: SpectralData | null): CurvePoint[] {
  if (!data) {
    return [
      { f: MIN_FREQ, db: MIN_DB },
      { f: MAX_FREQ, db: MIN_DB },
    ];
  }

  return Array.from({ length: 241 }, (_, index) => {
    const freq = frequencyFromX((index / 240) * 100);
    return {
      f: freq,
      db: clamp(interpolateSpectrum(data, freq), MIN_DB, MAX_DB),
    };
  });
}

function generatePath(points: CurvePoint[], isFill: boolean) {
  if (points.length === 0) return "";

  const commands = points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${logScale(point.f)} ${dbToY(point.db)}`;
  });

  if (isFill) {
    commands.push("L 100 100 L 0 100 Z");
  }

  return commands.join(" ");
}

function isNonDurableAudioUrl(value: unknown) {
  return (
    typeof value === "string" &&
    (value.startsWith("blob:") ||
      value.startsWith("data:") ||
      value.startsWith("filesystem:"))
  );
}

function isDurableAudioUrl(value: unknown) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !isNonDurableAudioUrl(value)
  );
}

function isRemoteAudioUrl(source: string | null) {
  return Boolean(
    source && (source.startsWith("http://") || source.startsWith("https://"))
  );
}

function pickAudioSource(params: {
  kind: AudioTrackKind;
  localFile: File | null;
  localObjectUrl: string | null;
  projectSource: string | null | undefined;
  storeSource: string | null | undefined;
}): AudioSourceDescriptor {
  if (params.localFile) {
    return {
      kind: params.kind,
      file: params.localFile,
      source: params.localObjectUrl,
      playbackUrl: params.localObjectUrl,
      origin: "session-file",
      expired: false,
    };
  }

  const projectExpired = isNonDurableAudioUrl(params.projectSource);
  const storeExpired = isNonDurableAudioUrl(params.storeSource);

	  if (isDurableAudioUrl(params.projectSource)) {
      const projectSource = params.projectSource ?? null;
	    return {
	      kind: params.kind,
	      file: null,
	      source: projectSource,
	      playbackUrl: isRemoteAudioUrl(projectSource)
	        ? projectSource
	        : null,
	      origin: "project",
	      expired: false,
    };
  }

	  if (isDurableAudioUrl(params.storeSource)) {
      const storeSource = params.storeSource ?? null;
	    return {
	      kind: params.kind,
	      file: null,
	      source: storeSource,
	      playbackUrl: isRemoteAudioUrl(storeSource)
	        ? storeSource
	        : null,
	      origin: "audio-store",
      expired: false,
    };
  }

  return {
    kind: params.kind,
    file: null,
    source: null,
    playbackUrl: null,
    origin: projectExpired || storeExpired ? "expired" : "missing",
    expired: projectExpired || storeExpired,
  };
}

async function loadAudioFile(source: string, filename: string) {
  if (isNonDurableAudioUrl(source)) {
    throw new Error(EXPIRED_FILE_ACCESS_MESSAGE);
  }

  if (isRemoteAudioUrl(source)) {
    const res = await fetch(source);
    const blob = await res.blob();
    return new File([blob], filename, {
      type: blob.type || "audio/mpeg",
    });
  }

  throw new Error(`Project audio asset is missing for ${filename}.`);
}

function scoreTone(score: number) {
  if (score > 70) return "var(--text-primary)";
  if (score >= 50) return "var(--accent-lime)";
  return "var(--status-active)";
}

function scoreGlow(score: number) {
  if (score > 70) return "0 0 16px rgba(255,255,255,0.32)";
  if (score >= 50) return "0 0 16px rgba(200,241,53,0.2)";
  return "0 0 16px rgba(245,166,35,0.28)";
}

type MixRoomViewMode = "frequency" | "timeline";

interface MixRoomApiResponse {
  report?: MixRoomReport;
  spectrum?: SpectrumState;
  error?: string;
  message?: string;
  audio_service_status?: string;
  fallback_used?: boolean;
  fallback_reason?: string | null;
}

async function resolveAudioFile(
  localFile: File | null,
  source: string | null,
  filename: string
) {
  if (localFile) return localFile;
  if (!source) throw new Error("Missing audio source.");
  return loadAudioFile(source, filename);
}

function MixRoomTransport({
  sourceUrl,
  hasSource,
  trackName,
  sourceLabel,
  statusText,
  matchScore,
}: {
  sourceUrl: string | null;
  hasSource: boolean;
  trackName: string;
  sourceLabel: string;
  statusText: string;
  matchScore: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPlaying(false);
      setDuration(0);
      setCurrentTime(0);
    });

    return () => cancelAnimationFrame(frame);
  }, [sourceUrl]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !sourceUrl) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    await audio.play().catch(() => undefined);
    setPlaying(!audio.paused);
  }, [playing, sourceUrl]);

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
        src={sourceUrl ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />

      <div className={styles.transportTrack}>
        <button
          type="button"
          className={styles.playButton}
          onClick={togglePlay}
          disabled={!sourceUrl}
          aria-label={playing ? "Pause source audio" : "Play source audio"}
        >
          {playing ? "II" : ">"}
        </button>
        <span>
          <strong>{trackName}</strong>
          <em>{hasSource ? sourceLabel : "no source audio loaded"}</em>
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
          disabled={!sourceUrl || duration === 0}
          aria-label="Scrub source audio"
        />
      </div>

      <div className={styles.transportTools}>
        <span className={styles.transportStatus}>{statusText}</span>
        <span className={styles.transportScore}>
          {matchScore === null ? "--" : `${matchScore}/100`}
        </span>
      </div>
    </section>
  );
}

export default function MixRoomPage() {
  const { daw, era: storeEra, setEra } = useStore();
  const activeEra = eras.find((e) => e.id === storeEra) || defaultEra;
  const project = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const updateProject = useProject((state) => state.updateProject);
  const addMixRoomEQCut = useProject((state) => state.addMixRoomEQCut);
  const projectVocal = getCurrentVocal(project);
  const projectAudioAssets = getProjectAudioAssets(project);
  const [selectedVocalAssetId, setSelectedVocalAssetId] = useState<string | null>(null);
  const [selectedBeatAssetId, setSelectedBeatAssetId] = useState<string | null>(null);
  const [selectedFullSongAssetId, setSelectedFullSongAssetId] = useState<string | null>(null);
  const vocalAsset =
    projectAudioAssets.find((asset) => asset.id === selectedVocalAssetId) ??
    getPrimaryVocalAsset(project);
  const beatAsset =
    projectAudioAssets.find((asset) => asset.id === selectedBeatAssetId) ??
    getPrimaryBeatAsset(project);
  const fullSongAsset =
    projectAudioAssets.find((asset) => asset.id === selectedFullSongAssetId) ??
    getFullSongAsset(project);
  const fullSongMode = Boolean(fullSongAsset && (!vocalAsset || !beatAsset));
  const isMixRoomUnlocked = Boolean((vocalAsset && beatAsset) || fullSongAsset);
  const projectId = project?.id;
  const dawName = daw || "Logic Pro";
  const savedReport = isMixRoomReport(project?.mix_room_report)
    ? project?.mix_room_report
    : null;

  const [localVocalFile] = useState<File | null>(null);
  const [localBeatFile] = useState<File | null>(null);
  const [localVocalUrl] = useState<string | null>(null);
  const [localBeatUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MixRoomViewMode>("frequency");
  const [vizVisible, setVizVisible] = useState(false);
  const [beatDrawn, setBeatDrawn] = useState(false);
  const [vocalDrawn, setVocalDrawn] = useState(false);
  const [zonesVisible, setZonesVisible] = useState(false);
  const [scoreVisible, setScoreVisible] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [spectrum, setSpectrum] = useState<SpectrumState | null>(null);
  const [report, setReport] = useState<MixRoomReport | null>(savedReport);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for project audio...");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [savingZone, setSavingZone] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const selectUploadedAsset = useCallback((asset: { id: string; kind: string }) => {
    if (asset.kind === "vocal") setSelectedVocalAssetId(asset.id);
    if (asset.kind === "beat") setSelectedBeatAssetId(asset.id);
    if (asset.kind === "full_song") setSelectedFullSongAssetId(asset.id);
  }, [setSelectedBeatAssetId, setSelectedFullSongAssetId, setSelectedVocalAssetId]);

  const vocalAudioSource = useMemo(
    () =>
      pickAudioSource({
        kind: "vocal",
        localFile: localVocalFile,
        localObjectUrl: localVocalUrl,
	        projectSource: vocalAsset?.storagePath ?? (fullSongMode ? fullSongAsset?.storagePath : null),
	        storeSource: null,
	      }),
	    [fullSongAsset?.storagePath, fullSongMode, localVocalFile, localVocalUrl, vocalAsset?.storagePath]
	  );
  const beatAudioSource = useMemo(
    () =>
      pickAudioSource({
        kind: "beat",
        localFile: localBeatFile,
        localObjectUrl: localBeatUrl,
	        projectSource: beatAsset?.storagePath ?? (fullSongMode ? fullSongAsset?.storagePath : null),
	        storeSource: null,
	      }),
	    [beatAsset?.storagePath, fullSongAsset?.storagePath, fullSongMode, localBeatFile, localBeatUrl]
	  );
  const vocalSource = vocalAudioSource.source;
  const beatSource = beatAudioSource.source;
  const vocalFilename =
	    localVocalFile?.name ?? vocalAsset?.filename ?? fullSongAsset?.filename ?? "project-vocal.wav";
  const beatFilename =
	    localBeatFile?.name ?? beatAsset?.filename ?? fullSongAsset?.filename ?? "project-beat.wav";
  const hasBeat = Boolean(beatAudioSource.file || beatSource);
  const hasVocal = Boolean(vocalAudioSource.file || vocalSource);
	  const hasExpiredAudioAccess = vocalAudioSource.expired || beatAudioSource.expired;
  const missingPrompt =
    hasExpiredAudioAccess
	      ? EXPIRED_FILE_ACCESS_MESSAGE
	      : !hasVocal && !hasBeat
	      ? "Add project audio in Mix Room to see where it needs space."
      : !hasVocal
        ? "Vocal missing. Upload the vocal you want to fit into this beat."
        : !hasBeat
          ? "Beat missing. Upload the instrumental so mimiq can compare it with the vocal."
          : null;
  const collisions = report?.collisions ?? [];
  const pockets = report?.pockets ?? [];
  const topCollisions = collisions.slice(0, 4);
  const savedCuts = getMixRoomEQCuts(report);
  const beatCurve = useMemo(() => buildCurve(spectrum?.beat ?? null), [spectrum]);
  const vocalCurve = useMemo(
    () => buildCurve(spectrum?.vocal ?? null),
    [spectrum]
  );
  const sourceUrl = vocalAudioSource.source ?? beatAudioSource.source ?? null;
  const playbackUrl =
    vocalAudioSource.playbackUrl ?? beatAudioSource.playbackUrl ?? null;
  const transportTrackName =
    projectVocal?.label ?? project?.name ?? "Lead Vocal";
  const transportSourceLabel = playbackUrl
    ? vocalSource
      ? "source vocal monitor"
      : "beat source monitor"
    : sourceUrl
      ? "project source stored"
	      : fullSongMode
	        ? "full song source"
	        : "waiting for project audio";
  const matchScore = report?.matchScore ?? null;
  const metricStatus = isLoading ? "Scanning" : report ? "Ready" : "Waiting";

  useEffect(() => {
    const t1 = setTimeout(() => setVizVisible(true), 100);
    const t2 = setTimeout(() => setBeatDrawn(true), 200);
    const t3 = setTimeout(() => setVocalDrawn(true), 400);
    const t4 = setTimeout(() => setZonesVisible(true), 800);
    const t5 = setTimeout(() => setScoreVisible(true), 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const currentReport = useProject.getState().project?.mix_room_report;
      setReport(isMixRoomReport(currentReport) ? currentReport : null);
      setSpectrum(null);
      setConfirmation(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [projectId]);

  useEffect(() => {
    const targetScore = report?.matchScore || 0;
    let curr = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    const frame = requestAnimationFrame(() => {
      setDisplayScore(0);
      if (!scoreVisible || !targetScore) return;

      interval = setInterval(() => {
        curr += Math.max(1, Math.floor(targetScore / 30));
        if (curr >= targetScore) {
          curr = targetScore;
          if (interval) clearInterval(interval);
        }
        setDisplayScore(curr);
      }, 16);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (interval) clearInterval(interval);
    };
  }, [scoreVisible, report?.matchScore]);

  const saveReport = useCallback(
    (nextReport: MixRoomReport) => {
      if (!projectId) return;

      const patch = { mix_room_report: nextReport };
      updateProject(patch);
      saveProjectPatch(projectId, patch)
        .then(setActiveProject)
        .catch(() => {
          setErrorText("Analysis is local for now. Supabase did not save it yet.");
        });
    },
    [projectId, setActiveProject, updateProject]
  );

  const handleRunAnalysis = useCallback(async () => {
    if (!vocalSource || !beatSource) {
      setIsLoading(false);
      setSpectrum(null);
      setStatusText(missingPrompt ?? "Waiting for both audio files...");
      return;
    }

    setIsLoading(true);
    setErrorText(null);
    setStatusText("Loading vocal and beat...");

      try {
        const currentVocalAsset = vocalAsset ?? (fullSongMode ? fullSongAsset : null);
        const currentBeatAsset = beatAsset ?? (fullSongMode ? fullSongAsset : null);
        let vocalFile: File | null = null;
        let beatFile: File | null = null;
        let vocalSpectrum: SpectralData | null = null;
        let beatSpectrum: SpectralData | null = null;

        // Always resolve files and run browser FFT so the analysis never
        // depends on the audio service being online. Asset IDs are still
        // sent to the server for its own resolution context.
        setStatusText("Downloading audio files...");
        [vocalFile, beatFile] = await Promise.all([
          vocalAudioSource.file
            ? Promise.resolve(vocalAudioSource.file)
            : currentVocalAsset
              ? resolveAssetFile(currentVocalAsset)
              : resolveAudioFile(null, vocalSource, vocalFilename),
          beatAudioSource.file
            ? Promise.resolve(beatAudioSource.file)
            : currentBeatAsset
              ? resolveAssetFile(currentBeatAsset)
              : resolveAudioFile(null, beatSource, beatFilename),
        ]);

        if (!vocalFile || !beatFile) {
          throw new Error("Could not load audio files. Check that the uploads completed.");
        }

        setStatusText("Reading frequency balance...");

        [vocalSpectrum, beatSpectrum] = await Promise.all([
          analyzeSpectrum(vocalFile),
          analyzeSpectrum(beatFile),
        ]);

        setStatusText("Sending both files to Mix Room...");

        const form = new FormData();
        if (projectId) form.append("projectId", projectId);
        form.append("vocalFile", vocalFile);
        form.append("beatFile", beatFile);
        form.append("genre", activeEra.name);
        form.append("daw", dawName);
        form.append("vocalSource", vocalSource ?? `upload:${vocalFile?.name ?? "asset"}`);
        form.append("beatSource", beatSource ?? `upload:${beatFile?.name ?? "asset"}`);
        if (vocalAsset?.id) form.append("vocalAssetId", vocalAsset.id);
        if (beatAsset?.id) form.append("beatAssetId", beatAsset.id);
        if (fullSongMode && fullSongAsset?.id) form.append("fullSongAssetId", fullSongAsset.id);
        if (vocalSpectrum) form.append("vocalSpectrum", JSON.stringify(vocalSpectrum));
        if (beatSpectrum) form.append("beatSpectrum", JSON.stringify(beatSpectrum));

        const analysisRes = await fetch("/api/mix-room", {
          method: "POST",
          body: form,
          headers: await authHeaders(),
        });

        const analysisData = (await analysisRes.json()) as MixRoomApiResponse;
        if (!analysisRes.ok || !analysisData.report || !analysisData.spectrum) {
          throw new Error(
            analysisData.message ||
              "Mix Room could not analyze the vocal and beat together."
          );
        }

        const existingCuts = getMixRoomEQCuts(
          useProject.getState().project?.mix_room_report ?? null
        );
        const nextReport = {
          ...analysisData.report,
          eq_cuts: existingCuts.length
            ? [...(analysisData.report.eq_cuts ?? []), ...existingCuts]
            : analysisData.report.eq_cuts,
        };

        setSpectrum(analysisData.spectrum);
        setReport(nextReport);
        saveReport(nextReport);
        setStatusText(
          analysisData.fallback_used
            ? "Analysis complete with labeled fallback."
            : "Analysis complete."
        );
      } catch (error) {
        console.error(error);
        setErrorText(
          error instanceof Error
            ? error.message
            : "Mix Room could not read both files yet."
        );
        setStatusText("Analysis paused.");
      } finally {
        setIsLoading(false);
      }
  }, [
	    activeEra.name,
      beatAsset,
	    beatFilename,
	    beatSource,
	    dawName,
      fullSongAsset,
      fullSongMode,
	    localBeatFile,
	    localVocalFile,
    missingPrompt,
    projectId,
    projectVocal?.id,
    saveReport,
    beatAudioSource.file,
	    vocalAudioSource.file,
      vocalAsset,
	    vocalFilename,
    vocalSource,
  ]);

  const handleHover = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
      const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
      const frequency = frequencyFromX(x);

      setHover({
        x,
        y,
        frequency,
        cursorDb: yToDb(y),
        vocalDb: interpolateSpectrum(spectrum?.vocal ?? null, frequency),
        beatDb: interpolateSpectrum(spectrum?.beat ?? null, frequency),
      });
    },
    [spectrum]
  );

  const isCutSaved = useCallback(
    (zone: CollisionZone) =>
      savedCuts.some(
        (cut) =>
          cut.source === "mix_room" &&
          Math.abs(cut.frequency - zone.centerFreq) < 12
      ),
    [savedCuts]
  );

  const handleAddToChain = useCallback(
    async (zone: CollisionZone) => {
      if (!projectId || !report) return;

      const zoneKey = `${Math.round(zone.startFreq)}-${Math.round(zone.endFreq)}`;
      const recommendedCut = -Math.min(6, zone.severity / 10);
      setSavingZone(zoneKey);
      setConfirmation(null);

      const savedCut = addMixRoomEQCut({
        frequency: zone.centerFreq,
        gain: recommendedCut,
        q: 1.4,
        source: "mix_room",
      });

      if (!savedCut) {
        setSavingZone(null);
        return;
      }

      const nextReport = appendMixRoomEQCut(report, savedCut);
      setReport(nextReport);

      try {
        const saved = await saveProjectPatch(projectId, {
          mix_room_report: nextReport,
        });
        setActiveProject(saved);
        setConfirmation(
          `Added EQ cut at ${formatFrequency(zone.centerFreq)} to your chain`
        );
      } catch {
        setErrorText("EQ cut is local for now. Supabase did not save it yet.");
      } finally {
        setSavingZone(null);
      }
    },
    [addMixRoomEQCut, projectId, report, setActiveProject]
  );

  const ActionCard = ({
    index,
    zone,
  }: {
    index: number;
    zone: CollisionZone;
  }) => {
    const label = severityLabel(zone.severity);
    const cut = -Math.min(6, zone.severity / 10);
    const zoneKey = `${Math.round(zone.startFreq)}-${Math.round(zone.endFreq)}`;
    const added = isCutSaved(zone);
    const saving = savingZone === zoneKey;

    return (
      <div
        className={styles.actionCard}
        style={{
          opacity: 0,
          transform: "translateY(8px)",
          animation: `fadeInUp 300ms ease-out ${600 + index * 80}ms forwards`,
        }}
      >
        <div className={styles.cardTop}>
          <div className={styles.cardFreq}>{formatRange(zone)}</div>
          <div
            className={`${styles.severityBadge} ${
              label === "HIGH"
                ? styles.severityHigh
                : label === "MED"
                  ? styles.severityMed
                  : styles.severityLow
            }`}
          >
            {label}
          </div>
        </div>
        <div className={styles.cardInstruction}>
          Cut {formatFrequency(zone.centerFreq)} by {Math.abs(cut).toFixed(1)} dB
          with {pluginForDaw(dawName)}. Keep Q at 1.4 and listen while the vocal
          plays.
        </div>
        <button
          className={styles.cardButton}
          disabled={added || saving}
          onClick={() => void handleAddToChain(zone)}
        >
          {added ? "Added" : saving ? "Saving..." : "Add to chain"}
        </button>
      </div>
    );
  };

  const timelineZones = [
    ...collisions.slice(0, 5).map((zone) => ({
      kind: "collision" as const,
      startFreq: zone.startFreq,
      endFreq: zone.endFreq,
      centerFreq: zone.centerFreq,
      value: zone.severity,
      label: "Fight",
    })),
    ...pockets.slice(0, 4).map((zone) => ({
      kind: "pocket" as const,
      startFreq: zone.startFreq,
      endFreq: zone.endFreq,
      centerFreq: zone.centerFreq,
      value: zone.strength,
      label: "Pocket",
    })),
  ].sort((a, b) => a.centerFreq - b.centerFreq);
  return (
    <ProjectGate>
      <div className={styles.layout}>
        <style
          dangerouslySetInnerHTML={{
            __html: `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `,
          }}
        />
        <Sidebar
          activePage="mix-room"
          savedCount={0}
        />
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minWidth: 0, overflow: "hidden" }}>
          <header className="globalToolHeader">
            <div className="globalToolHeaderTitle">
              <span>Spectrum</span>
              <h1>Collision Check</h1>
            </div>
            <div className="globalToolHeaderPickers">
                <AudioAssetPicker
                  label="Vocal"
                  value={vocalAsset?.id ?? selectedVocalAssetId}
                  onChange={setSelectedVocalAssetId}
                  allowedKinds={["vocal"]}
                  emptyLabel="No vocal"
                  variant="compact"
                />
                <AudioAssetPicker
                  label="Beat"
                  value={beatAsset?.id ?? selectedBeatAssetId}
                  onChange={setSelectedBeatAssetId}
                  allowedKinds={["beat"]}
                  emptyLabel="No beat"
                  variant="compact"
                />
                <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>OR</div>
                <AudioAssetPicker
                  label="Song"
                  value={fullSongAsset?.id ?? selectedFullSongAssetId}
                  onChange={setSelectedFullSongAssetId}
                  allowedKinds={["full_song"]}
                  emptyLabel="No song"
                  variant="compact"
                />
                <button
                  type="button"
                  className={styles.resetButton}
                  onClick={() => void handleRunAnalysis()}
                  disabled={isLoading || (!vocalSource && !beatSource && !fullSongMode)}
                  style={{ marginLeft: 12, height: 32, margin: 0, padding: "0 16px" }}
                >
                  {isLoading ? "Analyzing..." : "Analyze"}
                </button>
            </div>
          </header>
        <ToolLockedOverlay
          key={project ? `${project.id}:mix-room` : "mix-room"}
          locked={!isMixRoomUnlocked}
          className={styles.contentArea}
          momentKey={project ? `${project.id}:mix-room` : "mix-room"}
        >
            <section className={styles.metricsBar} aria-label="Mix Room metrics">
              <div className={styles.metricCell}>
                <span className={styles.metricIcon} aria-hidden="true">
                  ||
                </span>
                <div>
                  <span className={styles.metricLabel}>Pocket match</span>
                  <strong className={styles.metricValue}>
                    {matchScore === null ? "--" : `${matchScore}/100`}
                  </strong>
                </div>
              </div>
              <div className={styles.metricCell}>
                <span className={styles.metricIcon} aria-hidden="true">
                  !!
                </span>
                <div>
                  <span className={styles.metricLabel}>Collisions</span>
                  <strong className={styles.metricValue}>{collisions.length}</strong>
                </div>
              </div>
              <div className={styles.metricCell}>
                <span className={styles.metricIcon} aria-hidden="true">
                  --
                </span>
                <div>
                  <span className={styles.metricLabel}>Pockets</span>
                  <strong className={styles.metricValue}>{pockets.length}</strong>
                </div>
              </div>
              <div className={styles.metricCell}>
                <span className={styles.metricIcon} aria-hidden="true">
                  Hz
                </span>
                <div>
                  <span className={styles.metricLabel}>Cursor</span>
                  <strong className={styles.metricValue}>
                    {hover ? formatFrequency(hover.frequency) : metricStatus}
                  </strong>
                </div>
              </div>

              <div className={styles.segmentedControl}>
                <button
                  type="button"
                  className={`${styles.segment} ${
                    viewMode === "frequency" ? styles.segmentActive : ""
                  }`}
                  aria-pressed={viewMode === "frequency"}
                  onClick={() => setViewMode("frequency")}
                >
                  Frequency View
                </button>
                <button
                  type="button"
                  className={`${styles.segment} ${
                    viewMode === "timeline" ? styles.segmentActive : ""
                  }`}
                  aria-pressed={viewMode === "timeline"}
                  onClick={() => setViewMode("timeline")}
                >
                  Timeline View
                </button>
              </div>
            </section>
            <div className={styles.columns}>
              <div className={styles.leftColumn}>
                <div className={styles.leftContent}>
                  <div
                    className={styles.vizContainer}
                    onPointerMove={viewMode === "frequency" ? handleHover : undefined}
                    onPointerLeave={() => setHover(null)}
                    style={{
                      opacity: vizVisible ? 1 : 0,
                      transition: "opacity 400ms ease-out",
                    }}
                  >
                    {viewMode === "frequency" ? (
                      <>
                        <svg
                          width="100%"
                          height="100%"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          {[0, -20, -40, -60, -80].map((db) => (
                            <line
                              key={db}
                              x1="0"
                              x2="100"
                              y1={dbToY(db)}
                              y2={dbToY(db)}
                              className={styles.gridLine}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                          {[20, 100, 500, 1000, 5000, 10000, 20000].map((freq) => (
                            <line
                              key={freq}
                              x1={logScale(freq)}
                              x2={logScale(freq)}
                              y1="0"
                              y2="100"
                              className={styles.gridLine}
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}

                          {zonesVisible &&
                            pockets.slice(0, 8).map((zone) => (
                              <rect
                                key={`pocket-${zone.startFreq}-${zone.endFreq}`}
                                x={logScale(zone.startFreq)}
                                y={0}
                                width={Math.max(
                                  0.25,
                                  logScale(zone.endFreq) - logScale(zone.startFreq)
                                )}
                                height={100}
                                className={styles.pocketBand}
                                vectorEffect="non-scaling-stroke"
                              />
                            ))}

                          {zonesVisible &&
                            collisions.slice(0, 10).map((zone) => (
                              <rect
                                key={`collision-${zone.startFreq}-${zone.endFreq}`}
                                x={logScale(zone.startFreq)}
                                y={0}
                                width={Math.max(
                                  0.25,
                                  logScale(zone.endFreq) - logScale(zone.startFreq)
                                )}
                                height={100}
                                className={styles.collisionBand}
                                vectorEffect="non-scaling-stroke"
                              />
                            ))}

                          <path
                            d={generatePath(beatCurve, true)}
                            className={styles.beatFill}
                            style={{
                              clipPath: beatDrawn
                                ? "inset(0 0% 0 0)"
                                : "inset(0 100% 0 0)",
                              transition: "clip-path 600ms ease-out",
                            }}
                          />
                          <path
                            d={generatePath(beatCurve, false)}
                            className={styles.beatStroke}
                            style={{
                              clipPath: beatDrawn
                                ? "inset(0 0% 0 0)"
                                : "inset(0 100% 0 0)",
                              transition: "clip-path 600ms ease-out",
                            }}
                          />
                          <path
                            d={generatePath(vocalCurve, false)}
                            className={styles.vocalStroke}
                            style={{
                              clipPath: vocalDrawn
                                ? "inset(0 0% 0 0)"
                                : "inset(0 100% 0 0)",
                              transition: "clip-path 600ms ease-out",
                            }}
                          />

                          {hover && (
                            <>
                              <line
                                x1={hover.x}
                                x2={hover.x}
                                y1="0"
                                y2="100"
                                className={styles.hoverLine}
                                vectorEffect="non-scaling-stroke"
                              />
                              <line
                                x1="0"
                                x2="100"
                                y1={hover.y}
                                y2={hover.y}
                                className={styles.hoverLine}
                                vectorEffect="non-scaling-stroke"
                              />
                            </>
                          )}
                        </svg>

                        <div className={styles.yAxis}>
                          {[0, -20, -40, -60, -80].map((db) => (
                            <span key={db} style={{ top: `${dbToY(db)}%` }}>
                              {db}
                            </span>
                          ))}
                        </div>

                        {hover && (
                          <div
                            className={styles.hoverTooltip}
                            style={{
                              left: `${hover.x}%`,
                              top: `${hover.y}%`,
                            }}
                          >
                            <span>{formatFrequency(hover.frequency)}</span>
                            <span>Cursor {formatDb(hover.cursorDb)}</span>
                            <span>Vocal {formatDb(hover.vocalDb)}</span>
                            <span>Beat {formatDb(hover.beatDb)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={styles.timelineView}>
                        <div className={styles.timelineHeader}>
                          <span>Measured zones</span>
                          <span>{timelineZones.length || 0} total</span>
                        </div>
                        <div className={styles.timelineRows}>
                          {timelineZones.length > 0 ? (
                            timelineZones.map((zone) => (
                              <div
                                key={`${zone.kind}-${zone.startFreq}-${zone.endFreq}`}
                                className={styles.timelineRow}
                              >
                                <span className={styles.timelineLabel}>
                                  {zone.label}
                                </span>
                                <div className={styles.timelineTrack}>
                                  <span
                                    className={
                                      zone.kind === "collision"
                                        ? styles.timelineCollision
                                        : styles.timelinePocket
                                    }
                                    style={{
                                      left: `${logScale(zone.startFreq)}%`,
                                      width: `${Math.max(
                                        2,
                                        logScale(zone.endFreq) - logScale(zone.startFreq)
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <span className={styles.timelineFreq}>
                                  {formatFrequency(zone.centerFreq)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className={styles.timelineEmpty}>
                              {hasBeat && hasVocal
                                ? "No measured fight zones yet."
                                : missingPrompt}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {(!hasBeat || !hasVocal || isLoading || errorText) && (
                      <div
                        className={styles.vizMessage}
                        style={{
                          opacity: zonesVisible ? 1 : 0,
                          transition: "opacity 300ms ease-out",
                        }}
                      >
                        {errorText || statusText}
                      </div>
                    )}
                  </div>

                  <div className={styles.xAxis}>
                    {[20, 100, 500, 1000, 5000, 10000, 20000].map((f) => (
                      <div
                        key={f}
                        className={styles.xAxisLabel}
                        style={{ left: `${logScale(f)}%` }}
                      >
                        {f >= 1000 ? `${f / 1000}kHz` : `${f}Hz`}
                      </div>
                    ))}
                  </div>

                  <div className={styles.legend}>
                    <div className={styles.legendItem}>
                      <div className={`${styles.legendColor} ${styles.legendBeat}`} />
                      <div className={styles.legendText}>Beat dBFS</div>
                    </div>
                    <div className={styles.legendItem}>
                      <div className={`${styles.legendColor} ${styles.legendVocal}`} />
                      <div className={styles.legendText}>Vocal dBFS</div>
                    </div>
                    <div className={styles.legendItem}>
                      <div className={`${styles.legendColor} ${styles.legendCollision}`} />
                      <div className={styles.legendText}>Collision zone</div>
                    </div>
                    <div className={styles.legendItem}>
                      <div className={`${styles.legendColor} ${styles.legendPocket}`} />
                      <div className={styles.legendText}>Pocket</div>
                    </div>
                  </div>

                  <div className={styles.matchScoreSection}>
                    <div className={styles.matchScoreLeft}>
                      <div className={styles.matchLabel}>Pocket Match</div>
                      <div className={styles.matchNumberRow}>
                        <div
                          className={styles.matchNumber}
                          style={{
                            color: scoreTone(displayScore),
                            textShadow: scoreGlow(displayScore),
                          }}
                        >
                          {displayScore}
                        </div>
                        <div className={styles.matchOutOf}>out of 100</div>
                      </div>
                    </div>
                    <div className={styles.matchSubtext}>
                      {report?.summary || statusText}
                    </div>
                  </div>

                  <div className={styles.explanationPanel}>
                    <div className={styles.explanationTitle}>What this means</div>
                    <div className={styles.explanationText}>
                      {report?.explanation ||
                        (isLoading
                          ? "mimiq is comparing the vocal and beat so it can explain the strongest fight spot."
                          : missingPrompt ??
                            "Run Mix Room with a vocal and beat to get a plain-English move.")}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.rightColumn}>
                <div className={styles.reportHeader}>
                  <span>Collision Report</span>
                  {report && (
                    <div className={styles.badge}>
                      {collisions.length} zones found
                    </div>
                  )}
                </div>
                {confirmation && (
                  <div className={styles.confirmation} aria-live="polite">
                    {confirmation}
                  </div>
                )}
                <div className={styles.cardsContainer}>
                  {isLoading ? (
                    <>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className={styles.skeletonCard}>
                          <div
                            className={styles.skeletonLine}
                            style={{ width: "80%" }}
                          />
                          <div
                            className={styles.skeletonLine}
                            style={{ width: "60%" }}
                          />
                          <div
                            className={styles.skeletonLine}
                            style={{ width: "90%" }}
                          />
                        </div>
                      ))}
                    </>
                  ) : topCollisions.length > 0 ? (
                    topCollisions.map((zone, idx) => (
                      <ActionCard
                        key={`${zone.startFreq}-${zone.endFreq}`}
                        index={idx}
                        zone={zone}
                      />
                    ))
                  ) : (
                    <div className={styles.emptyReport}>
                      {hasBeat && hasVocal
                        ? "No major collision cuts needed yet."
                        : missingPrompt}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <MixRoomTransport
              sourceUrl={playbackUrl}
              hasSource={!!sourceUrl}
              trackName={transportTrackName}
              sourceLabel={transportSourceLabel}
              statusText={statusText}
              matchScore={matchScore}
            />
        </ToolLockedOverlay>
        </div>
        <MobileTabBar activePage="mix-room" />
      </div>
    </ProjectGate>
  );
}
