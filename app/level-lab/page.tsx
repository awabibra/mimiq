"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import GateScreen from "@/components/GateScreen";
import { Sidebar } from "@/components/Sidebar";
import { ProjectGate } from "@/components/ProjectGate";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { downloadProjectAudio, saveProjectPatch } from "@/lib/projects";
import { getLatestGeneratedChain, useProject } from "@/lib/useProject";
import { eras, defaultEra } from "@/lib/eras";
import styles from "./page.module.css";
import type { AudioMetrics, LevelLabResponse } from "@/lib/types";

interface GainPoint {
  time: number;
  dbfs: number;
}

interface LevelLabServerResponse extends Partial<LevelLabResponse> {
  status?: "client_only";
  message?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function gainRideToPoints(gainRide: number[] | undefined): GainPoint[] {
  const points = gainRide ?? [];

  return points.map((dbfs, index) => ({
    time: points.length <= 1 ? 0 : index / (points.length - 1),
    dbfs,
  }));
}

function isLevelLabReport(data: LevelLabServerResponse): data is LevelLabResponse {
  return (
    typeof data.sessionScore === "number" &&
    typeof data.loudnessVerdict === "string" &&
    typeof data.dynamicsVerdict === "string" &&
    typeof data.brightnessVerdict === "string" &&
    typeof data.gainRideCallout === "string" &&
    typeof data.nextStep === "string" &&
    !!data.processedMetrics &&
    typeof data.processedMetrics.lufs === "number" &&
    typeof data.processedMetrics.dynamicRange === "number" &&
    typeof data.processedMetrics.truePeak === "number" &&
    Array.isArray(data.processedMetrics.gainRide) &&
    !!data.delta &&
    (data.delta.verdict === "improved" ||
      data.delta.verdict === "regressed" ||
      data.delta.verdict === "unknown") &&
    typeof data.delta.lufs_delta === "number" &&
    typeof data.delta.dynamic_range_delta === "number"
  );
}

function isBrowserPlayableUrl(source: string | null) {
  if (!source) return false;
  return (
    source.startsWith("blob:") ||
    source.startsWith("data:") ||
    source.startsWith("http://") ||
    source.startsWith("https://")
  );
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

function LevelLabTransport({
  rawUrl,
  processedUrl,
  hasProcessed,
  score,
  trackName,
}: {
  rawUrl: string | null;
  processedUrl: string | null;
  hasProcessed: boolean;
  score: number | null;
  trackName: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackUrl = isBrowserPlayableUrl(
    hasProcessed && processedUrl ? processedUrl : rawUrl
  )
    ? hasProcessed && processedUrl
      ? processedUrl
      : rawUrl
    : null;
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
  }, [playbackUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !playbackUrl) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    await audio.play().catch(() => undefined);
    setPlaying(!audio.paused);
  };

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

  const sourceStatus = playbackUrl
    ? hasProcessed
      ? "processed export monitor"
      : "source vocal monitor"
    : rawUrl || processedUrl
      ? "project source stored"
      : "no audio loaded";

  return (
    <section className={styles.transportBar} aria-label="Audio transport">
      <audio
        ref={audioRef}
        src={playbackUrl ?? undefined}
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
          disabled={!playbackUrl}
          aria-label={playing ? "Pause monitor audio" : "Play monitor audio"}
        >
          {playing ? "II" : ">"}
        </button>
        <span>
          <strong>{trackName}</strong>
          <em>{sourceStatus}</em>
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
          disabled={!playbackUrl || duration === 0}
          aria-label="Scrub monitor audio"
        />
      </div>

      <div className={styles.transportTools}>
        <span className={styles.transportStatus}>
          {hasProcessed ? "processed compared" : "waiting for processed vocal"}
        </span>
        <span className={styles.transportScore}>
          {score === null ? "--" : `${score}/100`}
        </span>
      </div>
    </section>
  );
}

export default function LevelLabPage() {
  const router = useRouter();
  const { daw, era: storeEra } = useStore();
  const activeEra = eras.find((e) => e.id === storeEra) || defaultEra;
  const project = useProject((state) => state.project);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const updateProject = useProject((state) => state.updateProject);
  const latestProjectChain = getLatestGeneratedChain(project);
  
  const { 
    analysisResult, 
    processedAnalysis, 
    processedFileUrl,
    vocalFileUrl,
    setSession 
  } = useAudioStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [uploadWidgetMode, setUploadWidgetMode] = useState<
    "open" | "closing" | "mini" | "opening"
  >("open");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation states for STATE B
  const [scoreVisible, setScoreVisible] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [arrowsDrawn, setArrowsDrawn] = useState(false);
  const [gainVisible, setGainVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  const levelLabData: LevelLabResponse | null =
    (processedAnalysis as LevelLabResponse | null) ??
    (project?.level_lab_report as LevelLabResponse | null);

  const currentVocal =
    project?.vocal_versions?.[project.current_vocal_index] ?? null;
  const rawAudioUrl = currentVocal?.url ?? vocalFileUrl ?? null;
  const rawFilename = currentVocal?.filename ?? "raw-vocal.wav";
  const rawMetrics: AudioMetrics | LevelLabResponse["rawMetrics"] | null =
    levelLabData?.rawMetrics ??
    analysisResult?.metrics ??
    latestProjectChain?.chain_data.measurements ??
    null;
  const hasRawVocal = !!rawAudioUrl;
  const hasProcessed = !!levelLabData;
  const processedAudioUrl = processedFileUrl ?? project?.stem_split_url ?? null;
  const transportTrackName =
    currentVocal?.label ?? project?.name ?? "Level Lab Monitor";
  const levelScore = levelLabData?.sessionScore ?? null;
  const metricStatus = isProcessing ? "Reading" : hasProcessed ? "Ready" : "Waiting";
  const rawMissingMessage =
    "Upload or analyze the raw vocal in Sandbox first. Level Lab needs the original take as the before reference, then it can compare your processed export.";

  const closeUploadWidget = () => {
    if (isProcessing) return;
    setUploadWidgetMode("closing");
    window.setTimeout(() => setUploadWidgetMode("mini"), 320);
  };

  const openUploadWidget = () => {
    setUploadWidgetMode("opening");
    window.setTimeout(() => setUploadWidgetMode("open"), 260);
  };

  // Typewriter effect during processing
  useEffect(() => {
    if (!isProcessing) return;
    const fullText = "Reading your processed vocal...";
    let i = 0;
    const interval = setInterval(() => {
      setTypewriterText(fullText.slice(0, i));
      i++;
      if (i > fullText.length) clearInterval(interval);
    }, 40);
    return () => clearInterval(interval);
  }, [isProcessing]);

  // STATE B Entrance Animations
  useEffect(() => {
    if (!hasProcessed) return;
    
    const t1 = setTimeout(() => setScoreVisible(true), 100);
    const t2 = setTimeout(() => setArrowsDrawn(true), 400);
    const t3 = setTimeout(() => setGainVisible(true), 700);
    const t4 = setTimeout(() => setCardsVisible(true), 500);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [hasProcessed]);

  // Score counter animation
  useEffect(() => {
    const targetScore = levelLabData?.sessionScore || 0;
    if (!scoreVisible || !targetScore) return;
    
    let curr = 0;
    const interval = setInterval(() => {
      curr += Math.max(1, Math.floor(targetScore / 20));
      if (curr >= targetScore) {
        curr = targetScore;
        clearInterval(interval);
      }
      setDisplayScore(curr);
    }, 20);
    return () => clearInterval(interval);
  }, [scoreVisible, levelLabData?.sessionScore]);

  const saveLevelLabReport = (report: LevelLabResponse, processedFileUrl?: string) => {
    setSession({
      processedFileUrl,
      processedAnalysis: report,
    });

    if (project) {
      const patch = { level_lab_report: report };
      updateProject(patch);
      saveProjectPatch(project.id, patch)
        .then(setActiveProject)
        .catch(() => {});
    }
  };

  const handleFileUpload = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".mp3")) {
      setErrorText("Drop a WAV or MP3 processed vocal export.");
      return;
    }

    if (!hasRawVocal || !rawAudioUrl) {
      setErrorText(rawMissingMessage);
      return;
    }

    setUploadWidgetMode("open");
    setIsProcessing(true);
    setErrorText(null);
    const processedFileUrl = URL.createObjectURL(file);

    try {
      const rawFile = await loadAudioFile(rawAudioUrl, rawFilename);
      const formData = new FormData();
      formData.append("rawFile", rawFile);
      formData.append("processedFile", file);
      if (rawMetrics) {
        formData.append("rawMetrics", JSON.stringify(rawMetrics));
      }
      formData.append("daw", daw || "Logic Pro");
      formData.append("era", activeEra.id);

      const res = await fetch("/api/level-lab", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as LevelLabServerResponse;

      if (!res.ok) throw new Error(data.message || "Processing failed");
      if (data.status === "client_only") {
        throw new Error(data.message || "Audio service unavailable.");
      }
      if (!isLevelLabReport(data)) {
        throw new Error("Level Lab response did not include measured deltas.");
      }

      saveLevelLabReport(data, processedFileUrl);
    } catch (e) {
      console.warn("[level-lab] Server review unavailable.", e);
      URL.revokeObjectURL(processedFileUrl);
      setErrorText(
        e instanceof Error ? e.message : "Level Lab could not analyze that file."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const envelopePoints = hasProcessed
    ? gainRideToPoints(levelLabData!.processedMetrics.gainRide)
    : [];
  const spikePoints = envelopePoints.filter((point) => point.dbfs > -6);

  const getPathD = (points: typeof envelopePoints, isFill: boolean) => {
    if (points.length === 0) return "";
    const yMap = (db: number) => ((0 - clamp(db, -40, 0)) / 40) * 100;
    
    let d = `M 0 ${isFill ? 100 : yMap(points[0].dbfs)}`;
    if (isFill) d += ` L 0 ${yMap(points[0].dbfs)}`;
    
    points.forEach((p) => {
      d += ` L ${p.time * 100} ${yMap(p.dbfs)}`;
    });
    
    if (isFill) {
      d += ` L 100 100 Z`;
    }
    return d;
  };

  const yMap = (db: number) => ((0 - clamp(db, -40, 0)) / 40) * 100;

  const formatVal = (v: number | undefined, isFreq = false) => {
    if (v === undefined) return "-";
    if (isFreq) return (v / 1000).toFixed(2);
    return Math.abs(v).toFixed(1);
  };

  const formatDb = (v: number | undefined) => {
    if (v === undefined) return "-";
    return `${v.toFixed(1)}`;
  };

  const getDeltaColor = (
    before: number,
    after: number,
    metric: "lufs" | "dr" | "cent" | "peak"
  ) => {
    if (metric === 'lufs') {
      const bDiff = Math.abs(before - (-14));
      const aDiff = Math.abs(after - (-14));
      if (aDiff < bDiff - 0.5) return 'rgba(74,173,106,1)';
      if (aDiff > bDiff + 0.5) return 'rgba(220,50,50,1)';
      return 'var(--text-secondary)';
    }
    if (metric === 'dr') {
      if (after < before - 0.5 && after >= 4) return 'rgba(74,173,106,1)';
      if (after > before + 0.5) return 'rgba(220,50,50,1)';
      return 'var(--text-secondary)';
    }
    if (metric === 'cent') {
      if (after > before + 300) return 'rgba(74,173,106,1)';
      if (after < before - 300) return 'rgba(220,50,50,1)';
      return 'var(--text-secondary)';
    }
    if (metric === "peak") {
      if (after > -1) return "rgba(220,50,50,1)";
      if (after <= -6) return "var(--text-secondary)";
      return "rgba(74,173,106,1)";
    }
    return 'var(--text-secondary)';
  };

  return (
    <ProjectGate>
    <div className={styles.layout}>
      <Sidebar
        activePage="level-lab"
        activeEra={activeEra}
        onEraChange={() => {}}
        savedCount={0}
      />
      <GateScreen>
        <div className={styles.contentArea}>
          <section className={styles.metricsBar} aria-label="Level Lab metrics">
            <div className={styles.metricCell}>
              <span className={styles.metricIcon} aria-hidden="true">
                ||
              </span>
              <div>
                <span className={styles.metricLabel}>Before LUFS</span>
                <strong className={styles.metricValue}>
                  -{formatVal(rawMetrics?.lufs)}
                </strong>
              </div>
            </div>
            <div className={styles.metricCell}>
              <span className={styles.metricIcon} aria-hidden="true">
                DR
              </span>
              <div>
                <span className={styles.metricLabel}>Dynamic range</span>
                <strong className={styles.metricValue}>
                  {formatVal(rawMetrics?.dynamicRange)} dB
                </strong>
              </div>
            </div>
            <div className={styles.metricCell}>
              <span className={styles.metricIcon} aria-hidden="true">
                Hz
              </span>
              <div>
                <span className={styles.metricLabel}>Centroid</span>
                <strong className={styles.metricValue}>
                  {formatVal(rawMetrics?.spectralCentroid, true)} kHz
                </strong>
              </div>
            </div>
            <div className={styles.metricCell}>
              <span className={styles.metricIcon} aria-hidden="true">
                ++
              </span>
              <div>
                <span className={styles.metricLabel}>Level score</span>
                <strong className={styles.metricValue}>
                  {levelScore === null ? metricStatus : `${levelScore}/100`}
                </strong>
              </div>
            </div>
          </section>

          <div className={styles.mainContent}>
          {!hasProcessed ? (
            /* STATE A */
            <>
            <div
              className={`${styles.levelLabPreview} ${
                uploadWidgetMode === "mini"
                  ? styles.levelLabPreviewLive
                  : uploadWidgetMode === "closing"
                    ? styles.levelLabPreviewWaking
                    : styles.levelLabPreviewBlurred
              }`}
              aria-label="Level Lab preview"
            >
                <div className={styles.previewComparisonBar}>
                  <div className={`${styles.previewCompCol} ${styles.previewCompLeft}`}>
                    <div className={styles.compLabel}>BEFORE</div>
                    <div className={styles.compMetrics}>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>LUFS</div>
                        <div className={styles.detailValue}>-{formatVal(rawMetrics?.lufs)}</div>
                      </div>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>Dynamic Range</div>
                        <div className={styles.detailValue}>{formatVal(rawMetrics?.dynamicRange)}</div>
                      </div>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>Centroid</div>
                        <div className={styles.detailValue}>{formatVal(rawMetrics?.spectralCentroid, true)}k</div>
                      </div>
                    </div>
                  </div>

                  <div className={`${styles.previewCompCol} ${styles.previewCompCenter}`}>
                    <div className={styles.compLabel}>SCORE</div>
                    <div className={styles.previewScore}>--</div>
                    <div className={styles.compSubtext}>Awaiting export</div>
                  </div>

                  <div className={`${styles.previewCompCol} ${styles.previewCompRight}`}>
                    <div className={styles.compLabel}>AFTER</div>
                    <div className={styles.previewAfterMetrics}>
                      <div className={styles.previewMiniCard}>
                        <div className={styles.miniCardLabel}>LUFS</div>
                        <div className={styles.previewMiniValue}>--</div>
                      </div>
                      <div className={styles.previewMiniCard}>
                        <div className={styles.miniCardLabel}>Dynamic Range</div>
                        <div className={styles.previewMiniValue}>--</div>
                      </div>
                      <div className={styles.previewMiniCard}>
                        <div className={styles.miniCardLabel}>True Peak</div>
                        <div className={styles.previewMiniValue}>--</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.previewBottomPanels}>
                  <div className={styles.previewLeftPanel}>
                    <div className={styles.panelLabel}>GAIN RIDE</div>
                    <div className={styles.previewGainVisualizer}>
                      <div className={styles.axisLabel} style={{ top: "14%" }}>-6 dBFS</div>
                      <div className={styles.axisLabel} style={{ top: "44%" }}>-18 dBFS</div>
                      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,0.09)" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
                        <line x1="0" y1="45" x2="100" y2="45" stroke="rgba(255,255,255,0.09)" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
                        <path
                          d="M 0 58 C 12 45 20 52 30 38 S 50 48 60 31 S 76 52 88 42 S 96 46 100 35"
                          fill="none"
                          stroke="rgba(255,255,255,0.14)"
                          strokeWidth="1"
                          strokeDasharray="3 5"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    </div>
                    <div className={styles.previewCallout}>Measured deltas will appear after the processed vocal is checked.</div>
                  </div>

                  <div className={styles.previewRightPanel}>
                    <div className={styles.panelLabel}>WHAT CHANGED</div>
                    <div className={styles.previewDeltaCards}>
                      {["Loudness", "Dynamic Range", "True Peak"].map((name) => (
                        <div className={styles.previewDeltaCard} key={name}>
                          <div className={styles.deltaCardTop}>
                            <div className={styles.deltaName}>{name}</div>
                            <div className={styles.previewDeltaValue}>{"-- -> --"}</div>
                          </div>
                          <div className={styles.deltaBarContainer}>
                            <div className={styles.previewDeltaBar} />
                          </div>
                        </div>
                      ))}
                      <div className={styles.previewSummaryCard}>
                        <div className={styles.summaryTop}>NEXT STEP</div>
                        <div className={styles.summaryContent}>Drop the processed vocal to compare source and export.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {uploadWidgetMode !== "mini" && (
            <div className={styles.uploadCardWrapper}>
              <div
                className={`${styles.uploadCard} ${
                  uploadWidgetMode === "closing" ? styles.uploadCardClosing : ""
                } ${
                  uploadWidgetMode === "opening" ? styles.uploadCardOpening : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.dismissUploadButton}
                  onClick={closeUploadWidget}
                  disabled={isProcessing}
                  aria-label="Collapse upload card"
                >
                  X
                </button>
                <div className={styles.pulseLines}>
                  <div className={styles.pulseLineTop} />
                  <div className={styles.pulseLineBottom} />
                </div>
                
                <div className={styles.uploadHeading}>Drop your processed vocal</div>
                <div className={styles.uploadBody}>
                  {hasRawVocal
                    ? "Apply the chain in your DAW, export the vocal, and drop it here. MimiQ will compare it against the raw vocal from this project."
                    : rawMissingMessage}
                </div>

                {(!hasRawVocal || errorText) && (
                  <div className={styles.deltaInterpretation}>
                    {errorText ?? rawMissingMessage}
                  </div>
                )}

                {!isProcessing ? (
                  <>
                    <div 
                      className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""}`}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className={styles.dropZoneText}>
                        {hasRawVocal ? "Drop .wav or .mp3" : "Raw vocal required first"}
                      </span>
                    </div>
                    <div className={styles.browseLink} onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </div>
                    <input 
                      type="file" 
                      accept=".wav,.mp3"
                      ref={fileInputRef} 
                      style={{ display: 'none' }} 
                      onChange={onFileInput}
                    />
                  </>
                ) : (
                  <div style={{ width: "100%", marginTop: "16px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div className={styles.typewriterText}>{typewriterText}</div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressBar} style={{ width: "100%" }} />
                    </div>
                  </div>
                )}

                <div className={styles.cardDivider} />
                <div className={styles.beforeLabel}>BEFORE — raw vocal</div>
                <div className={styles.metricsRow}>
                  <div className={styles.metricPill}><span>LUFS</span> -{formatVal(rawMetrics?.lufs)}</div>
                  <div className={styles.metricPill}><span>DR</span> {formatVal(rawMetrics?.dynamicRange)}dB</div>
                  <div className={styles.metricPill}><span>CENT</span> {formatVal(rawMetrics?.spectralCentroid, true)}k</div>
                </div>
              </div>
            </div>
            )}
            {uploadWidgetMode === "mini" && !isProcessing && (
              <button
                type="button"
                className={styles.uploadMiniWidget}
                onClick={openUploadWidget}
                aria-label="Open processed vocal upload"
              >
                <span className={styles.miniUploadIcon} aria-hidden="true" />
                <span className={styles.uploadMiniText}>Drop processed vocal</span>
                {rawMetrics && (
                  <span className={styles.uploadMiniMetrics}>
                    <span><em>LUFS</em> -{formatVal(rawMetrics.lufs)}</span>
                    <span><em>DR</em> {formatVal(rawMetrics.dynamicRange)}</span>
                    <span><em>CENT</em> {formatVal(rawMetrics.spectralCentroid, true)}k</span>
                  </span>
                )}
              </button>
            )}
            </>
          ) : (
            /* STATE B */
            <div className={styles.analysisWorkspace}>
              <div className={styles.topSection}>
                <div className={styles.comparisonBar}>
                  
                  <div className={`${styles.compCol} ${styles.compLeft}`}>
                    <div className={styles.compLabel}>BEFORE</div>
                    <div className={styles.compMetrics}>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>LUFS</div>
                        <div className={styles.detailValue}>-{formatVal(rawMetrics?.lufs)}</div>
                      </div>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>Dynamic Range</div>
                        <div className={styles.detailValue}>{formatVal(rawMetrics?.dynamicRange)}</div>
                      </div>
                      <div className={styles.detailItem}>
                        <div className={styles.detailLabel}>Centroid</div>
                        <div className={styles.detailValue}>{formatVal(rawMetrics?.spectralCentroid, true)}k</div>
                      </div>
                    </div>
                  </div>

                  <div className={`${styles.compCol} ${styles.compCenter}`}>
                    <div className={styles.compLabel}>SCORE</div>
                    <div 
                      className={styles.scoreNumber}
                      style={{
                        color: displayScore >= 80 ? "var(--accent)" 
                             : displayScore >= 60 ? "rgba(212,168,75,0.9)" 
                             : "rgba(220,50,50,0.9)"
                      }}
                    >
                      {displayScore}
                    </div>
                    <div className={styles.compSubtext}>Session result</div>
                  </div>

                  <div className={`${styles.compCol} ${styles.compRight}`}>
                    <div className={styles.compLabel}>AFTER</div>
                    <div className={styles.compMetricsRight}>
                      <div className={styles.miniCard}>
                        <div className={styles.miniCardLabel}>LUFS</div>
                        <div className={styles.miniCardValue} style={{ color: getDeltaColor(rawMetrics?.lufs || -14, levelLabData!.processedMetrics.lufs, 'lufs') }}>
                          -{formatVal(levelLabData!.processedMetrics.lufs)}
                        </div>
                      </div>
                      <div className={styles.miniCard}>
                        <div className={styles.miniCardLabel}>Dynamic Range</div>
                        <div className={styles.miniCardValue} style={{ color: getDeltaColor(rawMetrics?.dynamicRange || 6, levelLabData!.processedMetrics.dynamicRange, 'dr') }}>
                          {formatVal(levelLabData!.processedMetrics.dynamicRange)}
                        </div>
                      </div>
                      <div className={styles.miniCard}>
                        <div className={styles.miniCardLabel}>Brightness</div>
                        <div className={styles.miniCardValue} style={{ color: getDeltaColor(rawMetrics?.spectralCentroid || 2600, levelLabData!.processedMetrics.spectralCentroid ?? 2600, 'cent') }}>
                          {formatVal(levelLabData!.processedMetrics.spectralCentroid, true)}k
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Connecting Arrows */}
                  <div className={styles.arrowLines}>
                    {[0, 1, 2].map((i) => (
                      <div 
                        key={i} 
                        className={styles.arrowLine}
                        style={{
                          borderColor: "rgba(255,255,255,0.1)",
                          borderBottom: "1px solid rgba(255,255,255,0.1)", // Base line
                          width: arrowsDrawn ? "100%" : "0%",
                          transition: `width 300ms ease-out ${i * 100}ms`
                        }}
                      />
                    ))}
                  </div>

                </div>
              </div>

              <div className={styles.bottomPanels}>
                
                {/* Left Panel: Gain Ride */}
                <div className={styles.leftPanel}>
                  <div className={styles.panelLabel}>GAIN RIDE</div>
                  <div className={styles.gainVisualizer}>
                    <div className={styles.axisLabel} style={{ top: "14%" }}>−6 dBFS</div>
                    <div className={styles.axisLabel} style={{ top: "44%" }}>−18 dBFS</div>
                    <div 
                      className={styles.gainSvgContainer}
                      style={{
                        clipPath: gainVisible ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
                        transition: "clip-path 700ms ease-out",
                      }}
                    >
                      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                        
                        {/* Reference Lines */}
                        <line x1="0" y1="15" x2="100" y2="15" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
                        <line x1="0" y1="45" x2="100" y2="45" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />

                        {/* Base / Dips layer (Below -18dB) */}
                        <g>
                          <path d={getPathD(envelopePoints, true)} fill="rgba(212,168,75,0.03)" />
                          <path d={getPathD(envelopePoints, false)} fill="none" stroke="rgba(212,168,75,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        </g>

                        {/* Ideal layer (Between -18 and -6) */}
                        <g clipPath="url(#idealClip)">
                          <clipPath id="idealClip">
                            <rect x="0" y="15" width="100" height="30" />
                          </clipPath>
                          <path d={getPathD(envelopePoints, true)} fill="rgba(74,173,106,0.05)" />
                          <path d={getPathD(envelopePoints, false)} fill="none" stroke="rgba(74,173,106,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        </g>

                        {/* Spikes layer (Above -6) */}
                        <g clipPath="url(#spikesClip)">
                          <clipPath id="spikesClip">
                            <rect x="0" y="0" width="100" height="15" />
                          </clipPath>
                          <path d={getPathD(envelopePoints, true)} fill="rgba(220,50,50,0.1)" />
                          <path d={getPathD(envelopePoints, false)} fill="none" stroke="rgba(220,50,50,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        </g>

                        {spikePoints.map((point, index) => (
                          <circle
                            key={`${point.time}-${index}`}
                            cx={point.time * 100}
                            cy={yMap(point.dbfs)}
                            r="1"
                            fill="rgba(220,50,50,0.95)"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}

                      </svg>
                    </div>
                  </div>
                  <div className={styles.gainCallout}>{levelLabData.gainRideCallout}</div>
                </div>

                {/* Right Panel: Delta Cards */}
                <div className={styles.rightPanel}>
                  <div className={styles.panelLabel}>WHAT CHANGED</div>
                  <div className={styles.deltaCards}>

                    {[
                      {
                        name: "Loudness",
                        b: rawMetrics?.lufs ?? -14,
                        a: levelLabData!.processedMetrics.lufs,
                        interp: levelLabData!.loudnessVerdict,
                        metric: 'lufs' as const
                      },
                      {
                        name: "Dynamic Range",
                        b: rawMetrics?.dynamicRange || 6,
                        a: levelLabData!.processedMetrics.dynamicRange,
                        interp: levelLabData!.dynamicsVerdict,
                        metric: 'dr' as const
                      },
                      {
                        name: "Brightness",
                        b: rawMetrics?.spectralCentroid ?? 2600,
                        a: levelLabData!.processedMetrics.spectralCentroid ?? rawMetrics?.spectralCentroid ?? 2600,
                        interp: levelLabData!.brightnessVerdict,
                        metric: 'cent' as const
                      }
                    ].map((card, i) => {
                      const color = getDeltaColor(card.b ?? card.a, card.a, card.metric);
                      const isBetter = color === 'rgba(74,173,106,1)';
                      const isWorse = color === 'rgba(220,50,50,1)';
                      const beforeWidth = '40%'; 
                      const afterWidth = isBetter ? '60%' : isWorse ? '20%' : '45%';
                      const beforeValue =
                        card.metric === "lufs"
                          ? formatDb(card.b)
                          : card.metric === "cent"
                            ? `${formatVal(card.b, true)}k`
                            : formatVal(card.b);
                      const afterValue =
                        card.metric === "lufs"
                          ? formatDb(card.a)
                          : card.metric === "cent"
                            ? `${formatVal(card.a, true)}k`
                            : formatVal(card.a);

                      return (
                        <div 
                          key={i} 
                          className={`${styles.deltaCard} ${cardsVisible ? styles.showCard : ''}`}
                          style={{ '--delay': `${i * 80}ms` } as React.CSSProperties}
                        >
                          <div className={styles.deltaCardTop}>
                            <div className={styles.deltaName}>{card.name}</div>
                            <div className={styles.deltaValues}>
                              <span className={styles.deltaBefore}>{beforeValue}</span>
                              <span className={styles.deltaArrow} style={{ color }}>{isBetter ? '↑' : isWorse ? '↓' : '→'}</span>
                              <span className={styles.deltaAfter} style={{ color }}>{afterValue}</span>
                            </div>
                          </div>
                          
                          <div className={styles.deltaBarContainer}>
                            <div className={styles.deltaBarBefore} style={{ width: beforeWidth }} />
                            <div 
                              className={styles.deltaBarAfter} 
                              style={{ 
                                width: afterWidth, 
                                background: isWorse ? "rgba(220,50,50,0.5)" : isBetter ? "var(--accent)" : "rgba(255,255,255,0.4)" 
                              }} 
                            />
                          </div>

                          <div className={styles.deltaInterpretation}>{card.interp}</div>
                        </div>
                      );
                    })}

                    <div 
                      className={`${styles.summaryCard} ${cardsVisible ? styles.showCard : ''}`}
                      style={{ '--delay': '240ms' } as React.CSSProperties}
                    >
                      <div className={styles.summaryTop}>DELTA SUMMARY</div>
                      <div className={styles.summaryContent}>{levelLabData.deltaSummary ?? levelLabData.nextStep}</div>
                      <div className={styles.deltaInterpretation}>
                        Delta: {levelLabData.delta.verdict}; LUFS {levelLabData.delta.lufs_delta > 0 ? "+" : ""}{levelLabData.delta.lufs_delta.toFixed(1)}, DR {levelLabData.delta.dynamic_range_delta > 0 ? "+" : ""}{levelLabData.delta.dynamic_range_delta.toFixed(1)}dB{levelLabData.delta.brightness_delta == null ? "" : `, brightness ${levelLabData.delta.brightness_delta > 0 ? "+" : ""}${levelLabData.delta.brightness_delta.toFixed(0)}Hz`}. {levelLabData.nextStep}
                      </div>
                      <div className={styles.applyLink} onClick={() => router.push('/sandbox')}>
                        Apply in Sandbox →
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}
          </div>
          <LevelLabTransport
            rawUrl={rawAudioUrl}
            processedUrl={processedAudioUrl}
            hasProcessed={hasProcessed}
            score={levelScore}
            trackName={transportTrackName}
          />
        </div>
      </GateScreen>
    </div>
    </ProjectGate>
  );
}
