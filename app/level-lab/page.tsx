"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import GateScreen from "@/components/GateScreen";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { eras, defaultEra } from "@/lib/eras";
import styles from "./page.module.css";
import type { AudioMetrics, LevelLabResponse } from "@/lib/types";

// Mock envelope generator for the SVG
const generateEnvelope = (lufs: number, dr: number, count = 200) => {
  const points = [];
  // Ensure we have some spikes and some dips to show all colors
  const base = Math.max(-30, Math.min(-10, lufs));
  for (let i = 0; i < count; i++) {
    const time = i / (count - 1);
    const noise = Math.sin(i * 0.1) * Math.cos(i * 0.3) * (dr * 0.5) + (Math.random() - 0.5) * dr;
    let dbfs = base + noise;
    
    // Inject a few guaranteed spikes and dips if needed
    if (i === Math.floor(count * 0.2)) dbfs = -4; // Spike
    if (i === Math.floor(count * 0.7)) dbfs = -22; // Dip
    if (i === Math.floor(count * 0.5)) dbfs = -12; // Pocket
    
    if (dbfs > 0) dbfs = 0;
    if (dbfs < -40) dbfs = -40;
    points.push({ time, dbfs });
  }
  return points;
};

export default function LevelLabPage() {
  const router = useRouter();
  const { daw, era: storeEra } = useStore();
  const activeEra = eras.find((e) => e.id === storeEra) || defaultEra;
  
  const { 
    vocalFileUrl, 
    analysisResult, 
    processedFileUrl, 
    processedAnalysis, 
    setSession 
  } = useAudioStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [typewriterText, setTypewriterText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation states for STATE B
  const [scoreVisible, setScoreVisible] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [arrowsDrawn, setArrowsDrawn] = useState(false);
  const [gainVisible, setGainVisible] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  const rawMetrics: AudioMetrics | null = analysisResult?.metrics;
  const levelLabData: LevelLabResponse | null = processedAnalysis;

  const hasProcessed = !!processedFileUrl && !!levelLabData;

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

  const handleFileUpload = async (file: File) => {
    if (!rawMetrics) return;
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append("processedFile", file);
      formData.append("rawMetrics", JSON.stringify(rawMetrics));
      formData.append("daw", daw || "Logic Pro");
      formData.append("era", activeEra.id);

      const res = await fetch("/api/level-lab", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Processing failed");

      const data = await res.json();
      
      // Artificial delay to let the progress bar finish its 3s animation
      setTimeout(() => {
        setSession({
          processedFileUrl: URL.createObjectURL(file),
          processedAnalysis: data,
        });
        setIsProcessing(false);
      }, 3000);

    } catch (e) {
      console.error(e);
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
    ? generateEnvelope(levelLabData!.processedMetrics.lufs, levelLabData!.processedMetrics.dynamicRange)
    : [];

  const getPathD = (points: typeof envelopePoints, isFill: boolean) => {
    if (points.length === 0) return "";
    const yMap = (db: number) => (Math.abs(db) / 40) * 100;
    
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

  const formatVal = (v: number | undefined, isFreq = false) => {
    if (v === undefined) return "-";
    if (isFreq) return (v / 1000).toFixed(2);
    return Math.abs(v).toFixed(1);
  };

  const getDeltaColor = (before: number, after: number, metric: 'lufs' | 'dr' | 'cent') => {
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
    return 'var(--text-secondary)';
  };

  const MetricsBefore = () => (
    <div className={styles.metricsRow}>
      <div className={styles.metricPill}><span>LUFS</span> -{formatVal(rawMetrics?.lufs)}</div>
      <div className={styles.metricPill}><span>DR</span> {formatVal(rawMetrics?.dynamicRange)}dB</div>
      <div className={styles.metricPill}><span>CENT</span> {formatVal(rawMetrics?.spectralCentroid, true)}k</div>
    </div>
  );

  return (
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
                <MetricsBefore />
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
                        <div className={styles.miniCardLabel}>Centroid</div>
                        <div className={styles.miniCardValue} style={{ color: getDeltaColor(rawMetrics?.spectralCentroid || 2500, levelLabData!.processedMetrics.spectralCentroid, 'cent') }}>
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
                        b: -(rawMetrics?.lufs || -14), 
                        a: -levelLabData!.processedMetrics.lufs, 
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
                        b: rawMetrics?.spectralCentroid || 2500, 
                        a: levelLabData!.processedMetrics.spectralCentroid, 
                        interp: levelLabData!.brightnessVerdict,
                        metric: 'cent' as const
                      }
                    ].map((card, i) => {
                      const color = getDeltaColor(card.b, card.a, card.metric);
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
                              <span className={styles.deltaBefore}>{card.metric === 'cent' ? formatVal(card.b, true)+'k' : formatVal(card.b)}</span>
                              <span className={styles.deltaArrow} style={{ color }}>{isBetter ? '↑' : isWorse ? '↓' : '→'}</span>
                              <span className={styles.deltaAfter} style={{ color }}>{card.metric === 'cent' ? formatVal(card.a, true)+'k' : formatVal(card.a)}</span>
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
  );
}
