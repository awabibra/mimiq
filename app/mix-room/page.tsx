"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import GateScreen from "@/components/GateScreen";
import { Sidebar } from "@/components/Sidebar";
import { ProjectGate } from "@/components/ProjectGate";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { downloadProjectAudio, saveProjectPatch } from "@/lib/projects";
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
  MixRoomEQCut,
  MixRoomReport,
  PocketZone,
  SpectralData,
} from "@/lib/types";
import styles from "./page.module.css";

const FFT_SIZE = 4096;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_DB = -80;
const MAX_DB = 0;
const COLLISION_THRESHOLD_DB = -40;
const POCKET_BEAT_THRESHOLD_DB = -50;
const POCKET_VOCAL_THRESHOLD_DB = -55;

interface CurvePoint {
  f: number;
  db: number;
}

interface SpectrumState {
  vocal: SpectralData;
  beat: SpectralData;
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

function findCollisions(
  vocal: SpectralData,
  beat: SpectralData
): CollisionZone[] {
  const zones: CollisionZone[] = [];

  for (let i = 0; i < vocal.magnitudes.length; i++) {
    const freq = vocal.frequencies[i];
    if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

    const vocalDb = vocal.magnitudes[i] ?? MIN_DB;
    const beatDb = interpolateSpectrum(beat, freq);

    if (
      vocalDb > COLLISION_THRESHOLD_DB &&
      beatDb > COLLISION_THRESHOLD_DB
    ) {
      const severity =
        Math.max(0, vocalDb - COLLISION_THRESHOLD_DB) +
        Math.max(0, beatDb - COLLISION_THRESHOLD_DB);
      const previous = zones[zones.length - 1];

      if (previous && freq - previous.endFreq < 50) {
        previous.endFreq = freq;
        previous.peakVocalDb = Math.max(previous.peakVocalDb, vocalDb);
        previous.peakBeatDb = Math.max(previous.peakBeatDb, beatDb);

        if (severity > previous.severity) {
          previous.severity = severity;
          previous.centerFreq = freq;
        }
      } else {
        zones.push({
          startFreq: freq,
          endFreq: freq,
          centerFreq: freq,
          severity,
          peakVocalDb: vocalDb,
          peakBeatDb: beatDb,
        });
      }
    }
  }

  return zones
    .filter((zone) => zone.endFreq - zone.startFreq > 20)
    .sort((a, b) => b.severity - a.severity);
}

function findPockets(vocal: SpectralData, beat: SpectralData): PocketZone[] {
  const zones: PocketZone[] = [];

  for (let i = 0; i < vocal.magnitudes.length; i++) {
    const freq = vocal.frequencies[i];
    if (freq < MIN_FREQ || freq > MAX_FREQ) continue;

    const vocalDb = vocal.magnitudes[i] ?? MIN_DB;
    const beatDb = interpolateSpectrum(beat, freq);

    if (beatDb < POCKET_BEAT_THRESHOLD_DB && vocalDb > POCKET_VOCAL_THRESHOLD_DB) {
      const strength = vocalDb - beatDb;
      const previous = zones[zones.length - 1];

      if (previous && freq - previous.endFreq < 70) {
        previous.endFreq = freq;
        if (strength > previous.strength) {
          previous.strength = strength;
          previous.centerFreq = freq;
          previous.vocalDb = vocalDb;
          previous.beatDb = beatDb;
        }
      } else {
        zones.push({
          startFreq: freq,
          endFreq: freq,
          centerFreq: freq,
          strength,
          vocalDb,
          beatDb,
        });
      }
    }
  }

  return zones
    .filter((zone) => zone.endFreq - zone.startFreq > 30)
    .sort((a, b) => b.strength - a.strength);
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

async function loadAudioFile(source: string, filename: string) {
  if (
    source.startsWith("blob:") ||
    source.startsWith("data:") ||
    source.startsWith("http://") ||
    source.startsWith("https://")
  ) {
    const res = await fetch(source);
    const blob = await res.blob();
    return new File([blob], filename, {
      type: blob.type || "audio/mpeg",
    });
  }

  return downloadProjectAudio(source, filename);
}

function makeSummary(collisions: CollisionZone[], pockets: PocketZone[]) {
  if (collisions.length > 0) {
    const first = collisions[0];
    return `${collisions.length} collision zone${collisions.length === 1 ? "" : "s"} found, strongest around ${formatFrequency(first.centerFreq)}.`;
  }

  if (pockets.length > 0) {
    return `No major collisions found. The cleanest pocket is around ${formatFrequency(pockets[0].centerFreq)}.`;
  }

  return "No major collisions found between the vocal and beat.";
}

function makeMatchScore(collisions: CollisionZone[], pockets: PocketZone[]) {
  const collisionPressure = collisions
    .slice(0, 3)
    .reduce((sum, zone) => sum + zone.severity, 0);
  const pocketLift = Math.min(
    18,
    pockets.slice(0, 2).reduce((sum, zone) => sum + zone.strength, 0) / 4
  );

  return Math.round(clamp(88 - collisionPressure / 2 + pocketLift, 0, 100));
}

function makeReport(params: {
  projectId: string | undefined;
  vocalVersionId: string | null;
  vocalSource: string | null;
  beatSource: string | null;
  genre: string;
  daw: string;
  collisions: CollisionZone[];
  pockets: PocketZone[];
  explanation: string | null;
  cuts: MixRoomEQCut[];
}): MixRoomReport {
  return {
    version: 1,
    analysis_version: "browser_fft_v1",
    analyzed_at: new Date().toISOString(),
    vocal_version_id: params.vocalVersionId,
    beat_file_url: params.beatSource,
    vocal_source: params.vocalSource,
    beat_source: params.beatSource,
    genre: params.genre,
    daw: params.daw,
    matchScore: makeMatchScore(params.collisions, params.pockets),
    summary: makeSummary(params.collisions, params.pockets),
    explanation: params.explanation,
    collisions: params.collisions,
    pockets: params.pockets,
    eq_cuts: params.cuts,
  };
}

export default function MixRoomPage() {
  const { daw, era: storeEra, setEra } = useStore();
  const activeEra = eras.find((e) => e.id === storeEra) || defaultEra;
  const { vocalFileUrl, beatFileUrl } = useAudioStore();
  const project = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const updateProject = useProject((state) => state.updateProject);
  const addMixRoomEQCut = useProject((state) => state.addMixRoomEQCut);
  const projectVocal = getCurrentVocal(project);
  const projectId = project?.id;
  const vocalSource = projectVocal?.url ?? vocalFileUrl;
  const beatSource = project?.beat_file_url ?? beatFileUrl;
  const vocalFilename = projectVocal?.filename ?? "project-vocal.wav";
  const beatFilename = project?.beat_filename ?? "project-beat.wav";
  const dawName = daw || "Logic Pro";
  const savedReport = isMixRoomReport(project?.mix_room_report)
    ? project?.mix_room_report
    : null;

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

  const hasBeat = !!beatSource;
  const hasVocal = !!vocalSource;
  const collisions = report?.collisions ?? [];
  const pockets = report?.pockets ?? [];
  const topCollisions = collisions.slice(0, 4);
  const savedCuts = getMixRoomEQCuts(report);
  const beatCurve = useMemo(() => buildCurve(spectrum?.beat ?? null), [spectrum]);
  const vocalCurve = useMemo(
    () => buildCurve(spectrum?.vocal ?? null),
    [spectrum]
  );

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

  useEffect(() => {
    if (!projectId || !vocalSource || !beatSource) {
      const frame = requestAnimationFrame(() => {
        setIsLoading(false);
        setSpectrum(null);
        setStatusText(
          !hasVocal
            ? "Upload a vocal in Sandbox to start Mix Room."
            : "Add a beat in Sandbox for collision analysis."
        );
      });

      return () => cancelAnimationFrame(frame);
    }

    let cancelled = false;
    const savedVocalSource = vocalSource;
    const savedBeatSource = beatSource;
    if (!savedVocalSource || !savedBeatSource) return;

    async function runAnalysis() {
      setIsLoading(true);
      setErrorText(null);
      setStatusText("Loading project audio...");

      try {
        const [vocalFile, beatFile] = await Promise.all([
          loadAudioFile(savedVocalSource, vocalFilename),
          loadAudioFile(savedBeatSource, beatFilename),
        ]);

        if (cancelled) return;
        setStatusText("Running browser FFT...");

        const [vocalSpectrum, beatSpectrum] = await Promise.all([
          analyzeSpectrum(vocalFile),
          analyzeSpectrum(beatFile),
        ]);

        if (cancelled) return;

        const nextSpectrum = {
          vocal: vocalSpectrum,
          beat: beatSpectrum,
        };
        const nextCollisions = findCollisions(vocalSpectrum, beatSpectrum);
        const nextPockets = findPockets(vocalSpectrum, beatSpectrum);
        const currentSavedReport =
          useProject.getState().project?.mix_room_report ?? null;
        const existingCuts = getMixRoomEQCuts(currentSavedReport);
        const existingExplanation = isMixRoomReport(currentSavedReport)
          ? currentSavedReport.explanation
          : null;
        const baseReport = makeReport({
          projectId,
          vocalVersionId: projectVocal?.id ?? null,
          vocalSource: savedVocalSource,
          beatSource: savedBeatSource,
          genre: activeEra.name,
          daw: dawName,
          collisions: nextCollisions,
          pockets: nextPockets,
          explanation: existingExplanation ?? null,
          cuts: existingCuts,
        });

        setSpectrum(nextSpectrum);
        setReport(baseReport);
        saveReport(baseReport);

        setStatusText("Asking Claude what it means...");

        const explainRes = await fetch("/api/mix-room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collisions: nextCollisions.slice(0, 3),
            genre: activeEra.name,
            daw: dawName,
          }),
        });

        if (!explainRes.ok) throw new Error("Claude explanation failed.");
        const explainData = (await explainRes.json()) as {
          explanation?: string;
        };

        if (cancelled) return;

        const explainedReport = {
          ...baseReport,
          explanation:
            explainData.explanation?.trim() ||
            "These spots are where the beat is covering the vocal. Make a small EQ cut at the strongest collision so the words can sit forward.",
        };

        setReport(explainedReport);
        saveReport(explainedReport);
        setStatusText("Analysis complete.");
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setErrorText("Mix Room could not read both project files yet.");
          setStatusText("Analysis paused.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void runAnalysis();

    return () => {
      cancelled = true;
    };
  }, [
    activeEra.name,
    beatFilename,
    beatSource,
    dawName,
    hasVocal,
    projectId,
    projectVocal?.id,
    saveReport,
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
          activeEra={activeEra}
          onEraChange={(era) => setEra(era.id)}
          savedCount={0}
        />
        <GateScreen>
          <div className={styles.contentArea}>
            <div className={styles.header}>
              <div className={styles.title}>Mix Room</div>
              <div className={styles.segmentedControl}>
                <div className={`${styles.segment} ${styles.segmentActive}`}>
                  Frequency View
                </div>
                <div className={styles.tooltipContainer}>
                  <div className={styles.segment}>Timeline View</div>
                  <div className={styles.tooltip}>Coming soon</div>
                </div>
              </div>
            </div>
            <div className={styles.divider} />
            <div className={styles.columns}>
              <div className={styles.leftColumn}>
                <div className={styles.leftContent}>
                  <div
                    className={styles.vizContainer}
                    onPointerMove={handleHover}
                    onPointerLeave={() => setHover(null)}
                    style={{
                      opacity: vizVisible ? 1 : 0,
                      transition: "opacity 400ms ease-out",
                    }}
                  >
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
                      <div
                        className={styles.matchNumber}
                        style={{
                          color:
                            displayScore > 70
                              ? "var(--text-primary)"
                              : displayScore >= 50
                                ? "var(--accent)"
                                : "rgba(220,50,50,0.9)",
                          textShadow:
                            displayScore > 70
                              ? "0 0 16px rgba(255,255,255,0.4)"
                              : displayScore >= 50
                                ? "0 0 16px rgba(215,255,63,0.22)"
                                : "0 0 16px rgba(220,50,50,0.4)",
                        }}
                      >
                        {displayScore}
                      </div>
                      <div className={styles.matchLabel}>Pocket Match</div>
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
                          ? "Claude is reading the top collision zones..."
                          : "Run Mix Room with a vocal and beat to get a plain-English move.")}
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
                        : "Upload both files in Sandbox to unlock Mix Room."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </GateScreen>
      </div>
    </ProjectGate>
  );
}
