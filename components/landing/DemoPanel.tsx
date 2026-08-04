"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./DemoPanel.module.css";

const PRESETS = [
  {
    label: "Balanced & Present",
    steps: [
      "High-pass — 100 Hz, 18dB/oct",
      "VCA comp — 4:1, attack 8ms",
      "Presence — +2dB at 3 kHz",
      "Room verb — 0.6s, 12% wet",
    ],
  },
  {
    label: "Dark & Dense",
    steps: [
      "High-pass — 80 Hz, 12dB/oct",
      "Bus comp — 8:1, slow attack",
      "Low-mid cut — −3dB at 350 Hz",
      "Plate verb — 1.2s, 8% wet",
    ],
  },
  {
    label: "Bright & Forward",
    steps: [
      "High-pass — 120 Hz, 24dB/oct",
      "FET comp — 6:1, attack 2ms",
      "Air shelf — +3dB at 12 kHz",
      "Short room — 0.3s, 15% wet",
    ],
  },
];

export function DemoPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const timeRef   = useRef(0);

  const [presetIdx, setPresetIdx] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState<string[]>([]);
  const preset = PRESETS[presetIdx];

  useEffect(() => {
    queueMicrotask(() => setVisibleSteps([]));
    const steps = PRESETS[presetIdx].steps;
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setVisibleSteps(prev => [...prev, steps[i]]);
      }, 500 + i * 340));
    });
    timers.push(setTimeout(() => {
      setPresetIdx(p => (p + 1) % PRESETS.length);
    }, 500 + steps.length * 340 + 2200));
    return () => timers.forEach(clearTimeout);
  }, [presetIdx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const t = timeRef.current;

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth   = 0.5;
      for (let gx = 0; gx < w; gx += w / 6) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += h / 4) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      ctx.restore();

      const waves = [
        { amp: h * 0.28, freq: 0.016, speed: 0.022, phase: 0,           alpha: 0.22, width: 1 },
        { amp: h * 0.18, freq: 0.024, speed: 0.014, phase: Math.PI / 3,  alpha: 0.14, width: 1 },
        { amp: h * 0.10, freq: 0.038, speed: 0.030, phase: Math.PI * 0.7,alpha: 0.32, width: 1.5 },
      ];

      waves.forEach(({ amp, freq, speed, phase, alpha, width }) => {
        const envelope = 1 + 0.18 * Math.sin(t * 0.008 + phase);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 1.5) {
          const norm = x / w;
          const edge = Math.min(norm * 6, (1 - norm) * 6, 1);
          const y = h / 2
            + Math.sin(x * freq + t * speed + phase) * amp * envelope * edge
            + Math.sin(x * freq * 0.5 - t * speed * 0.7) * amp * 0.22 * edge;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(203,255,30,${alpha})`;
        ctx.lineWidth   = width;
        ctx.stroke();
      });

      const scanX = ((t * 0.4) % (w + 60)) - 30;
      const grad  = ctx.createLinearGradient(scanX - 30, 0, scanX + 30, 0);
      grad.addColorStop(0,    "transparent");
      grad.addColorStop(0.5,  "rgba(203,255,30,0.07)");
      grad.addColorStop(1,    "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 30, 0, 60, h);

      timeRef.current += 0.9;
      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.panel}>
      <div className={styles.scope}>
        <span className={styles.scopeLabel}>Input</span>
        <canvas ref={canvasRef} className={styles.canvas} />
        <span className={styles.scopeLabelRight}>Gain</span>
      </div>

      <div className={styles.chain}>
        <div className={styles.chainHeader}>
          <AnimatePresence mode="wait">
            <motion.span
              key={preset.label}
              className={styles.chainLabel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
            >
              {preset.label}
            </motion.span>
          </AnimatePresence>
          <span className={styles.chainLive} aria-hidden>●</span>
        </div>

        <ol className={styles.steps}>
          <AnimatePresence>
            {visibleSteps.map((step, i) => (
              <motion.li
                key={`${presetIdx}-${i}`}
                className={styles.step}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className={styles.stepNum}>{i + 1}.</span>
                <span className={styles.stepText}>{step}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}
