"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ProjectGate } from "@/components/ProjectGate";
import { defaultEra, eras, type Era } from "@/lib/eras";
import { useStore } from "@/lib/store";
import { useProject } from "@/lib/useProject";
import styles from "./page.module.css";

type JobStatus = "queued" | "processing" | "complete" | "failed";
type StemName = "vocals" | "drums" | "bass" | "other";

interface StemFile {
  name: StemName;
  filename: string;
  url: string;
}

interface SplitJob {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  source_filename: string;
  message?: string;
  error?: string;
  stems?: Partial<Record<StemName, StemFile>>;
}

interface ApiError {
  message?: string;
  error?: string;
}

const STEM_ORDER: StemName[] = ["vocals", "drums", "bass", "other"];
const STEM_LABELS: Record<StemName, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;

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
      data.message || data.error || "Stem Splitter could not process that file.",
    () => "Stem Splitter could not process that file."
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

function statusLabel(status: JobStatus | "idle" | "uploading") {
  if (status === "idle") return "Ready";
  if (status === "uploading") return "Uploading";
  if (status === "queued") return "Queued";
  if (status === "processing") return "Separating";
  if (status === "complete") return "Complete";
  return "Failed";
}

function ProcessingState({ job }: { job: SplitJob | null }) {
  return (
    <div className={styles.processingPanel} aria-live="polite">
      <div className={styles.cinematicContent}>
        <div className={styles.cinematicText}>
          <span className={styles.cinematicTextMain}>Separat</span>
          <span className={styles.cinematicLetterE}>e</span>
          <span className={styles.cinematicLetterIng}>ing</span>
          <span className={styles.cinematicDot}>.</span>
        </div>
        <div className={styles.cinematicBar}>
          <div className={styles.cinematicBarFill} />
        </div>
      </div>

      <div className={styles.processingRows}>
        {[
          "Source captured",
          "Demucs htdemucs queued",
          "Splitting vocals, drums, bass, other",
          "Preparing downloads",
        ].map((step, index) => (
          <div
            key={step}
            className={styles.processingRow}
            style={{ "--delay": `${index * 420}ms` } as React.CSSProperties}
          >
            <span>{step}</span>
            <span className={styles.processingTick} />
          </div>
        ))}
      </div>

      <div className={styles.processingMessage}>
        {job?.message || "CPU separation can take a minute on full songs."}
      </div>
    </div>
  );
}

function StemWaveform({ stem }: { stem: StemFile }) {
  const [bars, setBars] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function buildWaveform() {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;

        if (!AudioCtx) throw new Error("Web Audio API unavailable.");

        const res = await fetch(stem.url);
        if (!res.ok) throw new Error("Could not load stem.");

        const ctx = new AudioCtx();
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        const data = buffer.getChannelData(0);
        const count = 68;
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
        const normalized = peaks.map((peak) => Math.max(0.08, peak / maxPeak));

        await ctx.close().catch(() => undefined);
        if (!cancelled) setBars(normalized);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    buildWaveform();

    return () => {
      cancelled = true;
    };
  }, [stem.url]);

  if (failed) {
    return (
      <div className={styles.waveformFallback}>
        {Array.from({ length: 34 }, (_, index) => (
          <span
            key={index}
            style={{ "--height": `${20 + (index % 9) * 7}%` } as React.CSSProperties}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.waveform} aria-label={`${stem.name} waveform`}>
      {(bars ?? Array.from({ length: 68 }, () => 0.2)).map((height, index) => (
        <span
          key={index}
          className={bars ? styles.waveformBarReady : styles.waveformBarLoading}
          style={
            {
              "--height": `${Math.round(height * 100)}%`,
              "--delay": `${index * 12}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function StemCard({ stem, index }: { stem: StemFile; index: number }) {
  return (
    <article
      className={styles.stemCard}
      style={{ "--delay": `${index * 90}ms` } as React.CSSProperties}
    >
      <div className={styles.stemCardTop}>
        <div>
          <div className={styles.stemLabel}>{STEM_LABELS[stem.name]}</div>
          <div className={styles.stemMeta}>Separated WAV</div>
        </div>
        <a className={styles.downloadButton} href={stem.url} download={stem.filename}>
          Download
        </a>
      </div>
      <StemWaveform stem={stem} />
    </article>
  );
}

export default function StemSplitterPage() {
  const { era: storeEra, setEra } = useStore();
  const activeEra = eras.find((era) => era.id === storeEra) || defaultEra;
  const project = useProject((state) => state.project);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [job, setJob] = useState<SplitJob | null>(null);
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
    setSourceFile(null);
    setJob(null);
    setErrorText(null);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const startSplit = useCallback(async (file: File) => {
    if (!isAcceptedAudio(file)) {
      setErrorText("Stem Splitter accepts .wav or .mp3.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorText("Audio file exceeds 50 MB.");
      return;
    }

    setSourceFile(file);
    setJob(null);
    setErrorText(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.append("audio", file);

      const res = await fetch("/api/split-stems", {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error(await readFileError(res));

      setJob((await res.json()) as SplitJob);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : "Stem Splitter could not process that file."
      );
    } finally {
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    if (!job?.job_id || !["queued", "processing"].includes(job.status)) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/split-stems/${job.job_id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(await readFileError(res));
        setJob((await res.json()) as SplitJob);
      } catch (err) {
        setErrorText(
          err instanceof Error
            ? err.message
            : "Stem Splitter could not read the job status."
        );
      }
    };

    const interval = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(interval);
  }, [job?.job_id, job?.status]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void startSplit(file);
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void startSplit(file);
  };

  const stems = STEM_ORDER.map((stem) => job?.stems?.[stem]).filter(
    Boolean
  ) as StemFile[];
  const busy = uploading || job?.status === "queued" || job?.status === "processing";
  const currentStatus = uploading ? "uploading" : job?.status ?? "idle";

  return (
    <ProjectGate>
      <div className={styles.layout}>
        <Sidebar
          activePage="stem-splitter"
          activeEra={activeEra}
          onEraChange={handleEraChange}
          savedCount={0}
        />

        <main className={styles.contentArea}>
          <header className={styles.header}>
            <div>
              <div className={styles.title}>Stem Splitter</div>
              <div className={styles.subtitle}>
                {project?.name ?? "Select a project"} / htdemucs
              </div>
            </div>
            <button className={styles.resetButton} onClick={reset} disabled={!sourceFile && !job}>
              Reset
            </button>
          </header>

          <div className={styles.divider} />

          <section className={styles.metricsBar} aria-label="Stem split settings">
            <div className={styles.metricItem}>
              <span>Model</span>
              <strong>htdemucs</strong>
            </div>
            <div className={styles.metricItem}>
              <span>Output</span>
              <strong>4 stems</strong>
            </div>
            <div className={styles.metricItem}>
              <span>Limit</span>
              <strong>50 MB</strong>
            </div>
            <div className={styles.metricItem}>
              <span>Status</span>
              <strong>{statusLabel(currentStatus)}</strong>
            </div>
          </section>

          <section className={styles.centerCanvas}>
            {!sourceFile && !job && (
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
                aria-label="Upload a song or beat"
              >
                <AnimatedDashedBorder />
                <UploadArrowIcon className={styles.uploadIcon} />
                <span className={styles.uploadPrimary}>Drop a full song or beat</span>
                <span className={styles.uploadSecondary}>.wav or .mp3 / 50 MB max</span>
                {errorText && <span className={styles.uploadError}>{errorText}</span>}
              </div>
            )}

            {busy && <ProcessingState job={job} />}

            {job?.status === "failed" && (
              <div className={styles.failurePanel} aria-live="polite">
                <div className={styles.failureTitle}>Split failed</div>
                <div className={styles.failureText}>
                  {job.error || errorText || "Demucs could not separate this file."}
                </div>
                <button className={styles.retryButton} onClick={() => fileInputRef.current?.click()}>
                  Try another file
                </button>
              </div>
            )}

            {job?.status === "complete" && stems.length === 4 && (
              <div className={styles.resultsWrap}>
                <div className={styles.resultsGrid}>
                  {stems.map((stem, index) => (
                    <StemCard key={stem.name} stem={stem} index={index} />
                  ))}
                </div>
                <p className={styles.qualityNote}>
                  Separation quality depends on the original mix. Stems from loud,
                  compressed masters may bleed slightly — that&apos;s normal.
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleInput}
            />
          </section>

          <footer className={styles.transport} aria-label="Stem splitter transport">
            <div className={styles.transportLeft}>
              <span className={`${styles.statusDot} ${busy ? styles.statusDotLive : ""}`} />
              <span>{statusLabel(currentStatus)}</span>
            </div>
            <div className={styles.transportCenter}>
              <span>{sourceFile?.name ?? "No source loaded"}</span>
              {sourceFile && <span>{formatFileSize(sourceFile.size)}</span>}
            </div>
            <div className={styles.transportRight}>
              <span>{job?.job_id ? `Job ${job.job_id.slice(0, 8)}` : "Poll 3s"}</span>
            </div>
          </footer>
        </main>

        <MobileTabBar activePage="stem-splitter" />
      </div>
    </ProjectGate>
  );
}
