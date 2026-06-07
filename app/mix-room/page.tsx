"use client";

import { useEffect, useState } from "react";
import GateScreen from "@/components/GateScreen";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { eras, defaultEra } from "@/lib/eras";
import styles from "./page.module.css";

const logScale = (freq: number) => {
  const minFreq = 20;
  const maxFreq = 20000;
  return ((Math.log10(freq) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq))) * 100;
};

const interpolate = (f: number, points: { f: number; v: number }[]) => {
  if (points.length === 0) return 0;
  if (f <= points[0].f) return points[0].v;
  if (f >= points[points.length - 1].f) return points[points.length - 1].v;
  for (let i = 0; i < points.length - 1; i++) {
    if (f >= points[i].f && f <= points[i + 1].f) {
      const p1 = points[i], p2 = points[i + 1];
      const ratio = (Math.log10(f) - Math.log10(p1.f)) / (Math.log10(p2.f) - Math.log10(p1.f));
      return p1.v + ratio * (p2.v - p1.v);
    }
  }
  return 0;
};

const generatePath = (points: { f: number; v: number }[], isFill: boolean) => {
  if (points.length === 0) return "";
  let d = `M ${logScale(points[0].f)} ${100 - points[0].v}`;
  for (let i = 1; i < points.length; i++) {
    const x = logScale(points[i].f);
    const y = 100 - points[i].v;
    const prevX = logScale(points[i - 1].f);
    const prevY = 100 - points[i - 1].v;
    const cpX = (prevX + x) / 2;
    d += ` C ${cpX} ${prevY}, ${cpX} ${y}, ${x} ${y}`;
  }
  if (isFill) {
    d += ` L 100 100 L 0 100 Z`;
  }
  return d;
};

export default function MixRoomPage() {
  const { era: storeEra, setEra } = useStore();
  const activeEra = eras.find((e) => e.id === storeEra) || defaultEra;
  const { vocalFileUrl, beatFileUrl } = useAudioStore();

  const [vizVisible, setVizVisible] = useState(false);
  const [beatDrawn, setBeatDrawn] = useState(false);
  const [vocalDrawn, setVocalDrawn] = useState(false);
  const [zonesVisible, setZonesVisible] = useState(false);
  const [scoreVisible, setScoreVisible] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);

  const [apiData, setApiData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const hasBeat = !!beatFileUrl;
  const hasVocal = !!vocalFileUrl;

  const beatPoints = hasBeat
    ? [{ f: 20, v: 10 }, { f: 80, v: 80 }, { f: 200, v: 60 }, { f: 1000, v: 20 }, { f: 6000, v: 70 }, { f: 10000, v: 60 }, { f: 20000, v: 10 }]
    : [{ f: 20, v: 30 }, { f: 20000, v: 30 }];

  const vocalPoints = hasVocal
    ? [{ f: 20, v: 0 }, { f: 100, v: 10 }, { f: 300, v: 70 }, { f: 1000, v: 40 }, { f: 2500, v: 80 }, { f: 8000, v: 60 }, { f: 10000, v: 85 }, { f: 20000, v: 10 }]
    : [{ f: 20, v: 0 }, { f: 20000, v: 0 }];

  const zones: { type: string; start: number; end: number }[] = [];
  let currentZone: any = null;

  for (let i = 0; i <= 100; i++) {
    const f = Math.pow(10, Math.log10(20) + (i / 100) * (Math.log10(20000) - Math.log10(20)));
    const vVocal = interpolate(f, vocalPoints);
    const vBeat = interpolate(f, beatPoints);

    let type = null;
    if (hasBeat && hasVocal) {
      if (vVocal > 40 && vBeat > 40 && Math.abs(vVocal - vBeat) < 30) {
        type = "collision";
      } else if (vVocal > 50 && vBeat < 40) {
        type = "pocket";
      }
    }

    if (type) {
      if (!currentZone || currentZone.type !== type) {
        if (currentZone) zones.push(currentZone);
        currentZone = { type, start: Math.max(0, i - 1), end: i };
      } else {
        currentZone.end = i;
      }
    } else {
      if (currentZone) {
        zones.push(currentZone);
        currentZone = null;
      }
    }
  }
  if (currentZone) zones.push(currentZone);

  useEffect(() => {
    const t1 = setTimeout(() => setVizVisible(true), 100);
    const t2 = setTimeout(() => setBeatDrawn(true), 200);
    const t3 = setTimeout(() => setVocalDrawn(true), 400);
    const t4 = setTimeout(() => setZonesVisible(true), 800);
    const t5 = setTimeout(() => setScoreVisible(true), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, []);

  useEffect(() => {
    const targetScore = apiData?.matchScore || 0;
    if (!scoreVisible || !targetScore) return;
    let curr = 0;
    const interval = setInterval(() => {
      curr += Math.max(1, Math.floor(targetScore / 30));
      if (curr >= targetScore) {
        curr = targetScore;
        clearInterval(interval);
      }
      setDisplayScore(curr);
    }, 16);
    return () => clearInterval(interval);
  }, [scoreVisible, apiData]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/mix-room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vocalSpectrum: hasVocal,
            beatSpectrum: hasBeat,
            daw: "Unknown",
            era: activeEra.id,
          }),
        });
        const data = await res.json();
        setApiData(data);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [hasVocal, hasBeat, activeEra.id]);

  const ActionCard = ({ index, collision }: { index: number, collision: any }) => {
    const [added, setAdded] = useState(false);
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
          <div className={styles.cardFreq}>{collision.frequencyRange}</div>
          <div
            className={styles.severityBadge}
            style={{
              background:
                collision.severity === "HIGH" ? "rgba(220,50,50,0.15)"
                : collision.severity === "MED" ? "rgba(212,168,75,0.15)"
                : "rgba(74,173,106,0.15)",
              color:
                collision.severity === "HIGH" ? "rgba(220,50,50,0.8)"
                : collision.severity === "MED" ? "rgba(212,168,75,0.8)"
                : "rgba(74,173,106,0.8)",
            }}
          >
            {collision.severity}
          </div>
        </div>
        <div className={styles.cardInstruction}>{collision.instruction}</div>
        <button
          className={styles.cardButton}
          onClick={() => {
            setAdded(true);
            setTimeout(() => setAdded(false), 1500);
          }}
        >
          {added ? "Added ✓" : "Add to chain →"}
        </button>
      </div>
    );
  };

  return (
    <div className={styles.layout}>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
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
              <div className={`${styles.segment} ${styles.segmentActive}`}>Frequency View</div>
              <div className={styles.tooltipContainer}>
                <div className={styles.segment}>Timeline View</div>
                <div className={styles.tooltip}>Coming soon</div>
              </div>
            </div>
          </div>
          <div className={styles.divider} />
          <div className={styles.columns}>
            {/* Left Column */}
            <div className={styles.leftColumn}>
              <div className={styles.leftContent}>
                <div
                  className={styles.vizContainer}
                  style={{
                    opacity: vizVisible ? 1 : 0,
                    transition: "opacity 400ms ease-out",
                  }}
                >
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Beat Energy Fill */}
                    <path
                      d={generatePath(beatPoints, true)}
                      fill="rgba(212,168,75,0.15)"
                      style={{
                        clipPath: beatDrawn ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
                        transition: "clip-path 600ms ease-out",
                      }}
                    />

                    {/* Vocal Energy Stroke */}
                    <path
                      d={generatePath(vocalPoints, false)}
                      fill="none"
                      stroke="rgba(242,242,240,0.6)"
                      strokeWidth="1.5"
                      style={{
                        clipPath: vocalDrawn ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
                        transition: "clip-path 600ms ease-out",
                      }}
                    />

                    {/* Zones */}
                    {zones.map((z, i) => {
                      const isCollision = z.type === "collision";
                      return (
                        <rect
                          key={i}
                          x={`${z.start}%`}
                          y={0}
                          width={`${z.end - z.start}%`}
                          height={100}
                          fill={isCollision ? "rgba(220,50,50,0.12)" : "rgba(74,173,106,0.08)"}
                          stroke={isCollision ? "rgba(220,50,50,0.3)" : "rgba(74,173,106,0.2)"}
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                          style={{
                            opacity: zonesVisible ? 1 : 0,
                            transition: `opacity 300ms ease-out ${i * 50}ms`,
                          }}
                        />
                      );
                    })}
                    
                  </svg>
                  
                  {/* Placeholder text if no beat */}
                  {!hasBeat && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-tertiary)",
                        fontSize: "13px",
                        pointerEvents: "none",
                        opacity: zonesVisible ? 1 : 0,
                        transition: "opacity 300ms ease-out"
                      }}
                    >
                      Add a beat in Sandbox for collision analysis
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
                    <div className={styles.legendColor} style={{ background: "rgba(212,168,75,0.4)" }} />
                    <div className={styles.legendText}>Beat energy</div>
                  </div>
                  <div className={styles.legendItem}>
                    <div className={styles.legendColor} style={{ background: "rgba(242,242,240,0.6)" }} />
                    <div className={styles.legendText}>Vocal energy</div>
                  </div>
                  <div className={styles.legendItem}>
                    <div className={styles.legendColor} style={{ background: "rgba(220,50,50,0.4)" }} />
                    <div className={styles.legendText}>Collision zone</div>
                  </div>
                  <div className={styles.legendItem}>
                    <div className={styles.legendColor} style={{ background: "rgba(74,173,106,0.4)" }} />
                    <div className={styles.legendText}>Pocket</div>
                  </div>
                </div>

                <div className={styles.matchScoreSection}>
                  <div className={styles.matchScoreLeft}>
                    <div
                      className={styles.matchNumber}
                      style={{
                        color:
                          displayScore > 70 ? "var(--text-primary)"
                          : displayScore >= 50 ? "var(--accent)"
                          : "rgba(220,50,50,0.9)",
                        textShadow:
                          displayScore > 70 ? "0 0 16px rgba(255,255,255,0.4)"
                          : displayScore >= 50 ? "0 0 16px rgba(212,168,75,0.4)"
                          : "0 0 16px rgba(220,50,50,0.4)"
                      }}
                    >
                      {displayScore}
                    </div>
                    <div className={styles.matchLabel}>Pocket Match</div>
                  </div>
                  <div className={styles.matchSubtext}>
                    {apiData?.summary || (isLoading ? "Analyzing frequency spectrum..." : "Waiting for analysis...")}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className={styles.rightColumn}>
              <div className={styles.reportHeader}>
                <span>Collision Report</span>
                {apiData?.collisions && (
                  <div className={styles.badge}>{apiData.collisions.length} zones found</div>
                )}
              </div>
              <div className={styles.cardsContainer}>
                {isLoading ? (
                  <>
                    {[1, 2, 3].map((i) => (
                      <div key={i} className={styles.skeletonCard}>
                        <div className={styles.skeletonLine} style={{ width: "80%" }} />
                        <div className={styles.skeletonLine} style={{ width: "60%" }} />
                        <div className={styles.skeletonLine} style={{ width: "90%" }} />
                      </div>
                    ))}
                  </>
                ) : apiData?.collisions ? (
                  apiData.collisions.map((col: any, idx: number) => (
                    <ActionCard key={idx} index={idx} collision={col} />
                  ))
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </GateScreen>
    </div>
  );
}
