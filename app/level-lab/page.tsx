"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import GateScreen from "@/components/GateScreen";
import { Sidebar } from "@/components/Sidebar";
import { ProjectGate } from "@/components/ProjectGate";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { saveProjectPatch } from "@/lib/projects";
import { getLatestGeneratedChain, useProject } from "@/lib/useProject";
import { eras, defaultEra } from "@/lib/eras";
import styles from "./page.module.css";
import type {
  AudioMetrics,
  LevelLabDelta,
  LevelLabResponse,
  LevelMetrics,
} from "@/lib/types";

interface GainPoint {
  time: number;
  dbfs: number;
}

interface LevelLabServerResponse extends Partial<LevelLabResponse> {
  status?: "client_only";
  message?: string;
}

async function analyzeAudioClient(file: File): Promise<LevelMetrics> {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Web Audio API is unavailable in this browser.");
  }

  const ctx = new AudioCtx();
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  const blockSize = Math.floor(0.4 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const blocks: number[] = [];

  for (let i = 0; i + blockSize < data.length; i += hopSize) {
    const block = data.slice(i, i + blockSize);
    const rms = Math.sqrt(block.reduce((s, x) => s + x * x, 0) / block.length);
    const loudness = -0.691 + 10 * Math.log10(rms * rms + 1e-10);
    if (loudness > -70) blocks.push(loudness);
  }

  const integrated = blocks.length
    ? -0.691 +
      10 *
        Math.log10(
          blocks.reduce((s, b) => s + Math.pow(10, b / 10), 0) /
            blocks.length
        )
    : -60;

  const sorted = [...blocks].sort((a, b) => a - b);
  const lra =
    sorted.length > 10
      ? sorted[Math.floor(sorted.length * 0.95)] -
        sorted[Math.floor(sorted.length * 0.1)]
      : 0;

  const peak = data.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  const truePeak = 20 * Math.log10(peak + 1e-10);

  const step = Math.max(1, Math.floor(blocks.length / 200));
  const gainRide = blocks.filter((_, i) => i % step === 0).slice(0, 200);

  await ctx.close();

  return {
    lufs: Math.round(integrated * 10) / 10,
    dynamicRange: Math.round(lra * 10) / 10,
    truePeak: Math.round(truePeak * 10) / 10,
    gainRide,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function scoreFromMetrics(metrics: LevelMetrics) {
  const loudnessScore = Math.max(0, 35 - Math.abs(metrics.lufs - -14) * 4);
  const dynamicsScore = Math.max(0, 35 - Math.abs(metrics.dynamicRange - 6) * 5);
  const peakScore = metrics.truePeak <= -1 ? 20 : Math.max(0, 20 - (metrics.truePeak + 1) * 8);
  const spikePenalty = metrics.gainRide.filter((point) => point > -6).length * 1.5;

  return Math.round(clamp(loudnessScore + dynamicsScore + peakScore + 10 - spikePenalty, 0, 100));
}

function buildLevelDelta(
  rawMetrics: AudioMetrics,
  processedMetrics: LevelMetrics
): LevelLabDelta {
  const lufs_delta = Math.round((processedMetrics.lufs - rawMetrics.lufs) * 10) / 10;
  const dynamic_range_delta =
    Math.round((processedMetrics.dynamicRange - rawMetrics.dynamicRange) * 10) / 10;
  const rawLufsDistance = Math.abs(rawMetrics.lufs - -14);
  const processedLufsDistance = Math.abs(processedMetrics.lufs - -14);
  const rawDynamicsDistance = Math.abs(rawMetrics.dynamicRange - 6);
  const processedDynamicsDistance = Math.abs(processedMetrics.dynamicRange - 6);
  const improved =
    processedLufsDistance < rawLufsDistance - 0.5 ||
    processedDynamicsDistance < rawDynamicsDistance - 0.5;
  const regressed =
    processedLufsDistance > rawLufsDistance + 0.5 ||
    processedDynamicsDistance > rawDynamicsDistance + 0.5;

  return {
    verdict: improved && !regressed ? "improved" : regressed && !improved ? "regressed" : "unknown",
    lufs_delta,
    dynamic_range_delta,
  };
}

function buildClientReport(metrics: LevelMetrics, rawMetrics: AudioMetrics): LevelLabResponse {
  const spikeCount = metrics.gainRide.filter((point) => point > -6).length;

  return {
    sessionScore: scoreFromMetrics(metrics),
    loudnessVerdict:
      metrics.lufs > -10
        ? "Too loud for a vocal stem"
        : metrics.lufs < -22
          ? "Still too quiet"
          : "Loudness is in range",
    dynamicsVerdict:
      metrics.dynamicRange > 10
        ? "Dynamics still need control"
        : metrics.dynamicRange < 3
          ? "Dynamics are over-compressed"
          : "Dynamics are controlled",
    brightnessVerdict:
      metrics.truePeak > -1
        ? "True peak is too hot"
        : "True peak has headroom",
    gainRideCallout:
      spikeCount > 0
        ? `${spikeCount} loud point${spikeCount === 1 ? "" : "s"} cross -6 dBFS.`
        : "No gain ride points cross -6 dBFS.",
    nextStep:
      metrics.truePeak > -1
        ? "Pull the vocal down before limiting."
        : "Level-match against the beat and print again.",
    processedMetrics: metrics,
    delta: buildLevelDelta(rawMetrics, metrics),
  };
}

function gainRideToPoints(gainRide: number[] | undefined): GainPoint[] {
  const points = gainRide ?? [];

  return points.map((dbfs, index) => ({
    time: points.length <= 1 ? 0 : index / (points.length - 1),
    dbfs,
  }));
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
    setSession 
  } = useAudioStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation states for STATE B
  const [scoreVisible, setScoreVisible] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [arrowsDrawn, setArrowsDrawn] = useState(false);
  const [gainVisible, setGainVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  const rawMetrics: AudioMetrics | null =
    analysisResult?.metrics ?? latestProjectChain?.chain_data.measurements ?? null;
  const levelLabData: LevelLabResponse | null =
    (processedAnalysis as LevelLabResponse | null) ??
    (project?.level_lab_report as LevelLabResponse | null);

  const hasProcessed = !!levelLabData;

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

  const mergeServerReport = (
    clientReport: LevelLabResponse,
    serverData: LevelLabServerResponse,
    rawMetrics: AudioMetrics
  ): LevelLabResponse => {
    const serverMetrics = serverData.processedMetrics;
    const processedMetrics = {
      ...clientReport.processedMetrics,
      ...serverMetrics,
      gainRide: serverMetrics?.gainRide?.length
        ? serverMetrics.gainRide
        : clientReport.processedMetrics.gainRide,
      truePeak:
        serverMetrics?.truePeak ?? clientReport.processedMetrics.truePeak,
    };

    return {
      ...clientReport,
      sessionScore: serverData.sessionScore ?? clientReport.sessionScore,
      loudnessVerdict:
        serverData.loudnessVerdict ?? clientReport.loudnessVerdict,
      dynamicsVerdict:
        serverData.dynamicsVerdict ?? clientReport.dynamicsVerdict,
      brightnessVerdict:
        serverData.brightnessVerdict ?? clientReport.brightnessVerdict,
      gainRideCallout:
        serverData.gainRideCallout ?? clientReport.gainRideCallout,
      nextStep: serverData.nextStep ?? clientReport.nextStep,
      processedMetrics,
      delta: serverData.delta ?? buildLevelDelta(rawMetrics, processedMetrics),
    };
  };

  const handleFileUpload = async (file: File) => {
    if (!rawMetrics) {
      setErrorText("Analyze a raw vocal in Sandbox before using Level Lab.");
      return;
    }

    setIsProcessing(true);
    setErrorText(null);

    try {
      const processedFileUrl = URL.createObjectURL(file);
      const formData = new FormData();
      formData.append("processedFile", file);
      formData.append("rawMetrics", JSON.stringify(rawMetrics));
      formData.append("daw", daw || "Logic Pro");
      formData.append("era", activeEra.id);

      const res = await fetch("/api/level-lab", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as LevelLabServerResponse;

      if (!res.ok) throw new Error(data.message || "Processing failed");

      let clientReport: LevelLabResponse | null = null;
      try {
        const clientMetrics = await analyzeAudioClient(file);
        clientReport = buildClientReport(clientMetrics, rawMetrics);
      } catch (clientError) {
        if (data.status === "client_only" || !data.processedMetrics) {
          throw clientError;
        }
      }

      const baseReport =
        clientReport ??
        buildClientReport(
          {
            lufs: data.processedMetrics!.lufs,
            dynamicRange: data.processedMetrics!.dynamicRange,
            truePeak: data.processedMetrics!.truePeak,
            gainRide: data.processedMetrics!.gainRide ?? [],
            spectralCentroid: data.processedMetrics!.spectralCentroid,
          },
          rawMetrics
        );

      const finalReport =
        data.status === "client_only"
          ? baseReport
          : mergeServerReport(baseReport, data, rawMetrics);

      saveLevelLabReport(finalReport, processedFileUrl);

    } catch (e) {
      console.warn("[level-lab] Server review unavailable.", e);
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
          <div className={styles.header}>
            <div className={styles.title}>Level Lab</div>
          </div>
          <div className={styles.divider} />

          <div className={styles.mainContent}>
          {!hasProcessed ? (
            /* STATE A */
            <div className={styles.uploadCardWrapper}>
              <div className={styles.uploadCard}>
                <div className={styles.pulseLines}>
                  <div className={styles.pulseLineTop} />
                  <div className={styles.pulseLineBottom} />
                </div>
                
                <div className={styles.uploadHeading}>Drop your processed vocal</div>
                <div className={styles.uploadBody}>
                  Apply the chain in your DAW, export the vocal, and drop it here. MimiQ will show you exactly what changed.
                </div>

                {errorText && (
                  <div className={styles.deltaInterpretation}>{errorText}</div>
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
                      <span className={styles.dropZoneText}>Drop .wav or .mp3</span>
                    </div>
                    <div className={styles.browseLink} onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </div>
                    <input 
                      type="file" 
                      accept="audio/*" 
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
          ) : (
            /* STATE B */
            <>
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
                        <div className={styles.miniCardLabel}>True Peak</div>
                        <div className={styles.miniCardValue} style={{ color: getDeltaColor(0, levelLabData!.processedMetrics.truePeak, 'peak') }}>
                          {formatDb(levelLabData!.processedMetrics.truePeak)}
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
                        name: "True Peak",
                        b: undefined,
                        a: levelLabData!.processedMetrics.truePeak,
                        interp: levelLabData!.brightnessVerdict,
                        metric: 'peak' as const
                      }
                    ].map((card, i) => {
                      const color = getDeltaColor(card.b ?? card.a, card.a, card.metric);
                      const isBetter = color === 'rgba(74,173,106,1)';
                      const isWorse = color === 'rgba(220,50,50,1)';
                      const beforeWidth = '40%'; 
                      const afterWidth = isBetter ? '60%' : isWorse ? '20%' : '45%';

                      return (
                        <div 
                          key={i} 
                          className={`${styles.deltaCard} ${cardsVisible ? styles.showCard : ''}`}
                          style={{ '--delay': `${i * 80}ms` } as React.CSSProperties}
                        >
                          <div className={styles.deltaCardTop}>
                            <div className={styles.deltaName}>{card.name}</div>
                            <div className={styles.deltaValues}>
                              <span className={styles.deltaBefore}>{card.b === undefined ? "-" : formatVal(card.b)}</span>
                              <span className={styles.deltaArrow} style={{ color }}>{isBetter ? '↑' : isWorse ? '↓' : '→'}</span>
                              <span className={styles.deltaAfter} style={{ color }}>{card.metric === 'peak' ? formatDb(card.a) : formatVal(card.a)}</span>
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
                      <div className={styles.summaryTop}>NEXT STEP</div>
                      <div className={styles.summaryContent}>{levelLabData.nextStep}</div>
                      <div className={styles.applyLink} onClick={() => router.push('/sandbox')}>
                        Apply in Sandbox →
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            </>
          )}
          </div>
        </div>
      </GateScreen>
    </div>
    </ProjectGate>
  );
}
