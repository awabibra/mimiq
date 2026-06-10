"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ProjectGate } from "@/components/ProjectGate";
import { Sidebar } from "@/components/Sidebar";
import { defaultEra, eras, type Era } from "@/lib/eras";
import { useStore } from "@/lib/store";
import { useProject } from "@/lib/useProject";
import styles from "./page.module.css";

interface DiagnosticResult {
  detectedKey: string;
  bpm: number;
  pitchConsistencyScore: number;
  pitchDriftMap: [number, number][];
  retuneSpeed: "fast" | "medium" | "slow";
  recommendedScale: string;
  humanize: number;
  tuneMode: "hard tune" | "natural tune";
  tuneReason: string;
  chordProgression: string;
  summary: string;
}

interface ApiError {
  message?: string;
  error?: string;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

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
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function DialIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l4-5" />
      <path d="M8 18h8" />
    </svg>
  );
}

function AnimatedDashedBorder() {
  return (
    <svg
      className={styles.dashedSvg}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        className={styles.dashedRectPrimary}
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="3"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        className={styles.dashedRectSecondary}
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function readFileError(res: Response) {
  return res.json().then(
    (data: ApiError) =>
      data.message || data.error || "Vocal Diagnostics could not read that file.",
    () => "Vocal Diagnostics could not read that file."
  );
}

function isAcceptedAudio(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".wav") || name.endsWith(".mp3");
}

function formatFileSize(size: number) {
  const mb = size / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function buildWaveform(file: File): Promise<WaveformData> {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Web Audio API is unavailable in this browser.");
  }

  const ctx = new AudioCtx();

  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const count = 120;
    const blockSize = Math.max(1, Math.floor(data.length / count));
    const peaks = Array.from({ length: count }, (_, index) => {
      const start = index * blockSize;
      const end = Math.min(data.length, start + blockSize);
      let peak = 0;

      for (let i = start; i < end; i++) {
        peak = Math.max(peak, Math.abs(data[i] ?? 0));
      }

      return peak;
    });
    const maxPeak = Math.max(...peaks, 0.01);

    return {
      peaks: peaks.map((peak) => Math.max(0.06, peak / maxPeak)),
      duration: buffer.duration,
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

function scaleForKey(key: string) {
  const [rootName, modeName] = key.split(" ");
  const root = NOTE_TO_PC[rootName] ?? 0;
  const intervals = modeName === "Minor" ? MINOR_INTERVALS : MAJOR_INTERVALS;
  return new Set(intervals.map((interval) => (root + interval) % 12));
}

function pitchToPc(hz: number) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return ((midi % 12) + 12) % 12;
}

function isPitchInKey(hz: number, key: string) {
  if (!Number.isFinite(hz) || hz <= 0) return false;
  return scaleForKey(key).has(pitchToPc(hz));
}

function chordToFrequency(chord: string) {
  const root = chord.replace("m", "");
  const pc = NOTE_TO_PC[root] ?? 0;
  return 130.81 * Math.pow(2, pc / 12);
}

function chordIntervals(chord: string) {
  return chord.endsWith("m") ? [0, 3, 7] : [0, 4, 7];
}

async function playChord(chord: string) {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
  gain.connect(ctx.destination);

  const base = chordToFrequency(chord);
  chordIntervals(chord).forEach((interval, index) => {
    const osc = ctx.createOscillator();
    osc.type = index === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(base * Math.pow(2, interval / 12), now);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.9);
  });

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, 950);
}

function ProcessingState() {
  return (
    <div className={styles.processingPanel} aria-live="polite">
      <div className={styles.processingCore}>
        <DialIcon className={styles.processingIcon} />
        <div className={styles.processingNeedle} />
      </div>
      <div className={styles.processingRows}>
        {[
          "Finding the song key",
          "Reading BPM and vocal timing",
          "Tracking pitch drift",
          "Building tune settings",
        ].map((step, index) => (
          <div
            key={step}
            className={styles.processingRow}
            style={{ "--delay": `${index * 380}ms` } as React.CSSProperties}
          >
            <span>{step}</span>
            <span className={styles.processingTick} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PitchMap({
  result,
  waveform,
}: {
  result: DiagnosticResult;
  waveform: WaveformData | null;
}) {
  const points = result.pitchDriftMap;
  const duration = Math.max(
    waveform?.duration ?? 0,
    points.length ? points[points.length - 1][0] : 1,
    1
  );
  const validPitches = points.map((point) => point[1]).filter((pitch) => pitch > 0);
  const minPitch = Math.max(60, Math.min(...validPitches, 110));
  const maxPitch = Math.min(1100, Math.max(...validPitches, 440));
  const yForPitch = (hz: number) => {
    const low = Math.log2(minPitch);
    const high = Math.log2(maxPitch);
    const value = Math.log2(Math.max(hz, 1));
    return 86 - ((value - low) / Math.max(0.01, high - low)) * 68;
  };

  return (
    <div className={styles.pitchMap}>
      <div className={styles.pitchMapHeader}>
        <div>
          <div className={styles.panelKicker}>Pitch tracking</div>
          <div className={styles.pitchMapTitle}>Vocal drift over the take</div>
        </div>
        <div className={styles.legend}>
          <span><i className={styles.legendInKey} /> In key</span>
          <span><i className={styles.legendOutKey} /> Out of key</span>
        </div>
      </div>

      <svg className={styles.pitchSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        {[22, 38, 54, 70, 86].map((y) => (
          <line
            key={y}
            x1="0"
            x2="100"
            y1={y}
            y2={y}
            className={styles.gridLine}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {(waveform?.peaks ?? Array.from({ length: 120 }, (_, index) => 0.16 + (index % 11) * 0.035)).map((peak, index, list) => {
          const width = 100 / list.length;
          const height = peak * 36;
          return (
            <rect
              key={index}
              x={index * width}
              y={50 - height / 2}
              width={Math.max(0.18, width * 0.56)}
              height={height}
              className={styles.waveBar}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const inKey = isPitchInKey((point[1] + next[1]) / 2, result.detectedKey);

          return (
            <line
              key={`${point[0]}-${index}`}
              x1={(point[0] / duration) * 100}
              x2={(next[0] / duration) * 100}
              y1={yForPitch(point[1])}
              y2={yForPitch(next[1])}
              className={inKey ? styles.pitchLineInKey : styles.pitchLineOutKey}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <div className={styles.pitchAxis}>
        <span>{Math.round(maxPitch)} Hz</span>
        <span>{Math.round(minPitch)} Hz</span>
      </div>
    </div>
  );
}

function SettingsPanel({ result }: { result: DiagnosticResult }) {
  const chords = useMemo(
    () => result.chordProgression.split(" - ").map((chord) => chord.trim()),
    [result.chordProgression]
  );

  return (
    <aside className={styles.rightPanel}>
      <section className={styles.settingsCard}>
        <div className={styles.panelKicker}>Autotune Settings</div>
        <div className={styles.settingGrid}>
          <div className={styles.settingItem}>
            <span>Retune Speed</span>
            <strong>{result.retuneSpeed.toUpperCase()}</strong>
          </div>
          <div className={styles.settingItem}>
            <span>Scale</span>
            <strong>{result.recommendedScale}</strong>
          </div>
          <div className={styles.settingItem}>
            <span>Humanize</span>
            <strong>{result.humanize}</strong>
          </div>
        </div>
        <p className={styles.pluginNote}>
          Use these as the starting point in Antares Auto-Tune, Waves Tune, or
          Logic Pitch Correction.
        </p>
      </section>

      <section className={styles.chordCard}>
        <div className={styles.panelKicker}>Chord Progression</div>
        <div className={styles.chordRow}>
          {chords.map((chord) => (
            <button
              key={chord}
              className={styles.chordPill}
              onClick={() => void playChord(chord)}
            >
              {chord}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.summaryCard}>
        <div className={styles.panelKicker}>Producer note</div>
        <p>{result.summary}</p>
      </section>
    </aside>
  );
}

export default function VocalDiagnosticsPage() {
  const { era: storeEra, setEra } = useStore();
  const activeEra = eras.find((era) => era.id === storeEra) || defaultEra;
  const project = useProject((state) => state.project);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", activeEra.accent);
  }, [activeEra.accent]);

  const handleEraChange = useCallback(
    (era: Era) => {
      setEra(era.id);
    },
    [setEra]
  );

  const reset = useCallback(() => {
    setDragOver(false);
    setSourceFile(null);
    setResult(null);
    setWaveform(null);
    setIsProcessing(false);
    setErrorText(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const diagnoseFile = useCallback(async (file: File) => {
    if (!isAcceptedAudio(file)) {
      setErrorText("Vocal Diagnostics accepts .wav or .mp3.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorText("Vocal file exceeds 50 MB.");
      return;
    }

    setSourceFile(file);
    setResult(null);
    setWaveform(null);
    setErrorText(null);
    setIsProcessing(true);

    try {
      const form = new FormData();
      form.append("vocal", file);

      const [waveformData, res] = await Promise.all([
        buildWaveform(file).catch(() => null),
        fetch("/api/diagnose-vocal", {
          method: "POST",
          body: form,
        }),
      ]);

      if (!res.ok) throw new Error(await readFileError(res));

      setWaveform(waveformData);
      setResult((await res.json()) as DiagnosticResult);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : "Vocal Diagnostics could not analyze that file."
      );
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void diagnoseFile(file);
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void diagnoseFile(file);
  };

  const statusText = isProcessing ? "Analyzing" : result ? "Complete" : "Ready";

  return (
    <ProjectGate>
      <div className={styles.layout}>
        <Sidebar
          activePage="vocal-diagnostics"
          activeEra={activeEra}
          onEraChange={handleEraChange}
          savedCount={0}
        />

        <main className={styles.contentArea}>
          <header className={styles.header}>
            <div>
              <div className={styles.title}>Vocal Diagnostics</div>
              <div className={styles.subtitle}>
                {project?.name ?? "Select a project"} / key, BPM, pitch tune
              </div>
            </div>
            <button className={styles.resetButton} onClick={reset} disabled={!sourceFile && !result}>
              Reset
            </button>
          </header>

          <div className={styles.divider} />

          <section className={styles.metricsBar} aria-label="Vocal diagnostic metrics">
            <div className={styles.metricItem}>
              <span>Key</span>
              <strong>{result?.detectedKey ?? "-"}</strong>
            </div>
            <div className={styles.metricItem}>
              <span>BPM</span>
              <strong>{result ? Math.round(result.bpm) : "-"}</strong>
            </div>
            <div className={styles.metricItem}>
              <span>Pitch Score</span>
              <strong className={styles.scoreValue}>
                {result?.pitchConsistencyScore ?? "-"}
              </strong>
            </div>
            <div className={styles.metricItem}>
              <span>Tune Mode</span>
              <strong>{result ? titleCase(result.tuneMode) : "-"}</strong>
            </div>
          </section>

          <section className={result ? styles.workspace : styles.centerCanvas}>
            {!sourceFile && !result && !isProcessing && (
              <div
                className={`${styles.uploadZone} ${dragOver ? styles.uploadZoneActive : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                aria-label="Upload a raw vocal"
              >
                <AnimatedDashedBorder />
                <UploadArrowIcon className={styles.uploadIcon} />
                <span className={styles.uploadPrimary}>Drop a raw vocal</span>
                <span className={styles.uploadSecondary}>
                  .wav or .mp3 / key, BPM, pitch tune
                </span>
                {errorText && <span className={styles.uploadError}>{errorText}</span>}
              </div>
            )}

            {isProcessing && <ProcessingState />}

            {errorText && sourceFile && !isProcessing && !result && (
              <div className={styles.failurePanel} aria-live="polite">
                <div className={styles.failureTitle}>Diagnostics failed</div>
                <div className={styles.failureText}>{errorText}</div>
                <button className={styles.retryButton} onClick={() => fileInputRef.current?.click()}>
                  Try another vocal
                </button>
              </div>
            )}

            {result && (
              <>
                <PitchMap result={result} waveform={waveform} />
                <SettingsPanel result={result} />
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleInput}
            />
          </section>

          <footer className={styles.transport} aria-label="Vocal diagnostics transport">
            <div className={styles.transportLeft}>
              <span className={`${styles.statusDot} ${isProcessing ? styles.statusDotLive : ""}`} />
              <span>{statusText}</span>
            </div>
            <div className={styles.transportCenter}>
              <span>{sourceFile?.name ?? "No vocal loaded"}</span>
              {sourceFile && <span>{formatFileSize(sourceFile.size)}</span>}
            </div>
            <div className={styles.transportRight}>
              <span>{result ? `${result.detectedKey} / ${Math.round(result.bpm)} BPM` : "Librosa"}</span>
            </div>
          </footer>
        </main>

        <MobileTabBar activePage="vocal-diagnostics" />
      </div>
    </ProjectGate>
  );
}
