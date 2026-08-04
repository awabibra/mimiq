"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./XYPad.module.css";

/* Chain state presets */

interface ChainState {
  label: string;
  steps: string[];
}

const chainStates: ChainState[] = [
  {
    /* wet and dark */
    label: "Warm & Intimate",
    steps: [
      "1. High-pass — 80 Hz, 12dB/oct",
      "2. Optical comp — 3:1, attack 30ms",
      "3. Low shelf — +2dB at 200 Hz",
      "4. Plate reverb — 1.8s, 24% wet",
    ],
  },
  {
    /* neutral */
    label: "Balanced & Present",
    steps: [
      "1. High-pass — 100 Hz, 18dB/oct",
      "2. VCA comp — 4:1, attack 8ms",
      "3. Presence — +2dB at 3 kHz",
      "4. Room verb — 0.6s, 12% wet",
    ],
  },
  {
    /* wet and bright */
    label: "Airy & Spacious",
    steps: [
      "1. High-pass — 120 Hz, 18dB/oct",
      "2. Gentle comp — 2:1, auto release",
      "3. Air — +3dB shelf at 10 kHz",
      "4. Hall reverb — 2.4s, 28% wet",
    ],
  },
  {
    /* dry and dark */
    label: "Dark & Compressed",
    steps: [
      "1. High-pass — 60 Hz, 12dB/oct",
      "2. FET comp — 8:1, attack 1ms",
      "3. Low-mid — +3dB at 400 Hz",
      "4. Tape saturation — drive 30%",
    ],
  },
  {
    /* dry and bright */
    label: "Clean & Forward",
    steps: [
      "1. High-pass — 150 Hz, 24dB/oct",
      "2. Fast comp — 6:1, attack 2ms",
      "3. Clarity — +4dB at 5 kHz",
      "4. De-ess — 7 kHz, -6dB",
    ],
  },
];

/** Map normalised (x, y) to a chain index */
function getChainIndex(x: number, y: number): number {
  if (x < 0.35 && y < 0.35) return 3; // dry + dark
  if (x < 0.35 && y > 0.65) return 4; // dry + bright
  if (x > 0.65 && y > 0.65) return 2; // wet + bright
  if (x > 0.65 && y < 0.35) return 0; // wet + dark
  return 1; // centre
}

export function XYPad() {
  const dotRef = useRef<HTMLDivElement>(null);
  const hLineRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const [chainIndex, setChainIndex] = useState(1);
  const [fading, setFading] = useState(false);
  const pendingIndex = useRef(1);

  useEffect(() => {
    let start: number | null = null;

    const tick = (ts: number) => {
      if (!start) start = ts;
      const t = (ts - start) / 1000;

      /* Different speeds keep the cursor from falling into a short loop. */
      const x = 0.5 + 0.38 * Math.sin(t * 0.3);
      const y = 0.5 + 0.38 * Math.cos(t * 0.2);

      /* CSS: top = 0 is visual top, but y = 1 means "bright" (top) */
      const cssTop = (1 - y) * 100;
      const cssLeft = x * 100;

      if (dotRef.current) {
        dotRef.current.style.left = `${cssLeft}%`;
        dotRef.current.style.top = `${cssTop}%`;
      }
      if (hLineRef.current) {
        hLineRef.current.style.top = `${cssTop}%`;
      }
      if (vLineRef.current) {
        vLineRef.current.style.left = `${cssLeft}%`;
      }

      const next = getChainIndex(x, y);
      if (next !== pendingIndex.current) {
        pendingIndex.current = next;
        setFading(true);
        setTimeout(() => {
          setChainIndex(next);
          setFading(false);
        }, 180);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const chain = chainStates[chainIndex];

  return (
    <div className={styles.container}>
      {/* XY Pad */}
      <div className={styles.pad}>
        <span className={`${styles.axisLabel} ${styles.axisTop}`}>Bright</span>
        <span className={`${styles.axisLabel} ${styles.axisBottom}`}>Dark</span>
        <span className={`${styles.axisLabel} ${styles.axisLeft}`}>Dry</span>
        <span className={`${styles.axisLabel} ${styles.axisRight}`}>Wet</span>

        <div ref={hLineRef} className={styles.crosshairH} />
        <div ref={vLineRef} className={styles.crosshairV} />
        <div ref={dotRef} className={styles.dot} />
      </div>

      {/* Chain output */}
      <div
        className={`${styles.chainOutput} ${styles.chainFade} ${
          fading ? styles.chainFadeOut : styles.chainFadeIn
        }`}
      >
        <span className={styles.chainLabel}>{chain.label}</span>
        <ul className={styles.chainSteps}>
          {chain.steps.map((step, i) => (
            <li key={i} className={styles.chainStep}>
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
