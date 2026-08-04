"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Maximize2 } from "lucide-react";
import type { DiagnosisFinding } from "@/lib/types";
import { useWorkspaceStore } from "@/lib/useWorkspaceStore";
import styles from "./WorkspaceTimeline.module.css";

interface WorkspaceTimelineProps {
  vocalUrl: string | null;
  beatUrl: string | null;
  findings: DiagnosisFinding[];
  duration: number;
  preview: boolean;
  empty?: boolean;
  timelineStartSeconds?: number;
  vocalDuration?: number | null;
  alignmentMode?: boolean;
  onTimelineStartChange?: (seconds: number) => void;
}

const SECTIONS = [
  ["Intro", 0],
  ["Verse 1", 16],
  ["Hook", 45],
  ["Verse 2", 78],
  ["Hook", 105],
  ["Outro", 132],
] as const;

function previewWaveBlob() {
  const sampleRate = 8000;
  const seconds = 18;
  const samples = sampleRate * seconds;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const phrase = 0.28 + 0.72 * Math.abs(Math.sin(time * 1.7));
    const transient = Math.sin(time * 2 * Math.PI * 3.7) > 0.76 ? 1 : 0.42;
    const value = phrase * transient * (
      Math.sin(time * 2 * Math.PI * 132) * 0.48 +
      Math.sin(time * 2 * Math.PI * 263) * 0.22 +
      Math.sin(time * 2 * Math.PI * 521) * 0.08
    );
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

export function WorkspaceTimeline({
  vocalUrl,
  beatUrl,
  findings,
  duration,
  preview,
  empty = false,
  timelineStartSeconds = 0,
  vocalDuration = null,
  alignmentMode = false,
  onTimelineStartChange,
}: WorkspaceTimelineProps) {
  const vocalRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const vocalWave = useRef<WaveSurfer | null>(null);
  const beatWave = useRef<WaveSurfer | null>(null);
  const [readySource, setReadySource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isPlaying = useWorkspaceStore((state) => state.isPlaying);
  const setPlaying = useWorkspaceStore((state) => state.setPlaying);
  const selectedRange = useWorkspaceStore((state) => state.selectedRange);
  const selectedFindingId = useWorkspaceStore((state) => state.selectedFindingId);
  const selectFinding = useWorkspaceStore((state) => state.selectFinding);
  const displayDuration = Math.max(1, duration || 150);
  const vocalStartPercent = Math.min(
    96,
    Math.max(0, (timelineStartSeconds / displayDuration) * 100)
  );
  const vocalWidthPercent = Math.max(
    4,
    Math.min(
      100 - vocalStartPercent,
      ((vocalDuration ?? displayDuration) / displayDuration) * 100
    )
  );
  const sourceKey = vocalUrl
    ? `separate:${vocalUrl}:${beatUrl ?? ""}:${timelineStartSeconds}`
    : preview
      ? "preview"
      : null;
  const ready = sourceKey != null && readySource === sourceKey;
  useEffect(() => {
    if ((!vocalUrl && !preview) || !vocalRef.current || empty) return;
    let alive = true;
    setReadySource(null);
    setLoadError(null);
    const vocal = WaveSurfer.create({
      container: vocalRef.current,
      height: 112,
      waveColor: "rgba(232,232,224,.58)",
      progressColor: "#d7ff3f",
      cursorColor: "#d7ff3f",
      cursorWidth: 1,
      normalize: true,
      interact: !alignmentMode,
      barWidth: 1,
      barGap: 1,
      barRadius: 1,
    });
    const beat = beatRef.current
      ? WaveSurfer.create({
          container: beatRef.current,
          height: 54,
          waveColor: "rgba(107,107,107,.42)",
          progressColor: "rgba(215,255,63,.28)",
          cursorColor: "transparent",
          normalize: true,
          interact: false,
          barWidth: 1,
          barGap: 2,
          barRadius: 1,
        })
      : null;
    const handleFailure = (error: unknown) => {
      if (!alive || isAbortError(error)) return;
      setLoadError(error instanceof Error ? error.message : "The waveform could not be decoded.");
    };
    vocal.on("ready", () => {
      if (alive) setReadySource(sourceKey);
    });
    vocal.on("finish", () => {
      if (alive) setPlaying(false);
    });
    vocal.on("timeupdate", (time) => {
      if (alive && beat) beat.setTime(Number(time) + timelineStartSeconds);
    });
    vocalWave.current = vocal;
    beatWave.current = beat;
    if (vocalUrl) {
      void vocal.load(vocalUrl).catch(handleFailure);
      if (beat && beatUrl) void beat.load(beatUrl).catch(handleFailure);
    } else {
      const previewAudio = previewWaveBlob();
      void vocal.loadBlob(previewAudio).catch(handleFailure);
      if (beat) void beat.loadBlob(previewAudio).catch(handleFailure);
    }

    return () => {
      alive = false;
      vocal.destroy();
      beat?.destroy();
      vocalWave.current = null;
      beatWave.current = null;
    };
  }, [alignmentMode, beatUrl, empty, preview, setPlaying, sourceKey, timelineStartSeconds, vocalUrl]);

  useEffect(() => {
    const wave = vocalWave.current;
    if (!wave || !ready) return;
    if (isPlaying) {
      void wave.play().catch((error: unknown) => {
        if (!isAbortError(error)) {
          setLoadError(error instanceof Error ? error.message : "Playback failed.");
        }
        setPlaying(false);
      });
    }
    else wave.pause();
  }, [isPlaying, ready, setPlaying]);

  useEffect(() => {
    if (!selectedRange || !ready) return;
    vocalWave.current?.setTime(Math.max(0, selectedRange.start - timelineStartSeconds));
    beatWave.current?.setTime(selectedRange.start);
  }, [ready, selectedRange, timelineStartSeconds]);

  return (
    <section className={styles.timeline} aria-label="Project waveform and collision timeline">
      <div className={styles.timelineHeader}>
        <span>Arrangement</span>
        <button type="button" aria-label="Expand timeline">
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.sectionRail}>
        {SECTIONS.map(([label, start]) => (
          <span key={`${label}-${start}`} style={{ left: `${(start / displayDuration) * 100}%` }}>
            <i />{label}
          </span>
        ))}
      </div>
      <div className={styles.ruler} aria-hidden="true">
        {Array.from({ length: 11 }, (_, index) => (
          <span key={index}>{formatTime((displayDuration / 10) * index)}</span>
        ))}
      </div>
      {loadError && <div className={styles.waveError} role="status">{loadError}</div>}
      <div
        className={styles.canvas}
        data-empty={empty ? "true" : "false"}
        data-alignment={alignmentMode ? "true" : "false"}
      >
        <div className={styles.laneLabel}><strong>Lead vocal</strong><span>{timelineStartSeconds > 0 ? `Starts ${formatTime(timelineStartSeconds)}` : "Timeline start"}</span></div>
        <div
          className={styles.vocalWave}
          ref={vocalRef}
          style={
            alignmentMode
              ? {
                  left: `calc(86px + ${vocalStartPercent}%)`,
                  width: `${vocalWidthPercent}%`,
                }
              : undefined
          }
        />
        {alignmentMode && (
          <input
            className={styles.alignmentDrag}
            type="range"
            min="0"
            max={displayDuration}
            step="0.1"
            value={timelineStartSeconds}
            onChange={(event) =>
              onTimelineStartChange?.(
                Math.max(0, Number(event.currentTarget.value))
              )
            }
            aria-label="Drag vocal start across the beat timeline"
          />
        )}
        <>
          <div className={styles.beatLabel}><strong>Beat energy</strong><span>Ghosted</span></div>
          <div className={styles.beatWave} ref={beatRef} />
        </>
        <div className={styles.collisionGrid} aria-label="Measured collision bands">
          {[250, 1000, 2500, 6000, 12000].map((frequency) => (
            <div key={frequency} className={styles.frequencyRow}>
              <span>{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}</span>
            </div>
          ))}
          {!empty && findings.filter((finding) => finding.evidence.frequencyLowHz != null && finding.evidence.startSeconds != null).map((finding) => {
            const start = finding.evidence.startSeconds ?? 0;
            const end = finding.evidence.endSeconds ?? start;
            const low = finding.evidence.frequencyLowHz ?? 250;
            const top = Math.max(6, 82 - Math.log10(Math.max(low, 100)) * 23);
            return (
              <button
                key={finding.id}
                type="button"
                className={`${styles.collision} ${selectedFindingId === finding.id ? styles.collisionSelected : ""}`}
                style={{
                  left: `${(start / displayDuration) * 100}%`,
                  width: `${Math.max(1.5, ((end - start) / displayDuration) * 100)}%`,
                  top: `${top}%`,
                }}
                onClick={() => selectFinding(finding.id, { start, end })}
                aria-label={`${finding.title}, ${formatTime(start)} to ${formatTime(end)}`}
              />
            );
          })}
        </div>
        {empty && <div className={styles.emptyTimeline}><span>Processed vocal + beat</span><strong>Waveforms and measured events will appear here.</strong><small>No example audio or collision data is being substituted.</small></div>}
        {selectedRange && (
          <div
            className={styles.selection}
            style={{
              left: `${(selectedRange.start / displayDuration) * 100}%`,
              width: `${Math.max(1, ((selectedRange.end - selectedRange.start) / displayDuration) * 100)}%`,
            }}
            aria-hidden="true"
          >
            <span>{formatTime(selectedRange.start)}</span>
            <span>{formatTime(selectedRange.end)}</span>
          </div>
        )}
      </div>
      <div className={styles.navigator}>
        <span>Navigator</span>
        <div><i /></div>
      </div>
    </section>
  );
}
