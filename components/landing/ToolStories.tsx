"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import styles from "./ToolStories.module.css";

/* ─────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────── */

function Rise({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useInView(ref, { once: true, margin: "-60px 0px" });
  return (
    <motion.div
      ref={ref}
      className={className || undefined}
      initial={{ opacity: 0, y: 36 }}
      animate={v ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.95, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Tilt({
  children,
  rx = 8,
  ry = -14,
  className = "",
}: {
  children: React.ReactNode;
  rx?: number;
  ry?: number;
  className?: string;
}) {
  return (
    <div style={{ perspective: "1400px" }} className={className}>
      <motion.div
        style={{ transformStyle: "preserve-3d" }}
        initial={{ rotateX: rx, rotateY: ry }}
        whileHover={{ rotateX: rx * 0.12, rotateY: ry * 0.12 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function SectionText({
  tool,
  headline,
  sub,
  delay = 0,
}: {
  tool: string;
  headline: React.ReactNode;
  sub: string;
  delay?: number;
}) {
  return (
    <Rise className={styles.text} delay={delay}>
      <span className={styles.toolLabel}>{tool}</span>
      <h2 className={styles.heading}>{headline}</h2>
      <p className={styles.body}>{sub}</p>
    </Rise>
  );
}

/** Deterministic sine-wave path (SSR-safe) */
function wave(
  width: number,
  midY: number,
  amp: number,
  freq: number,
  phase: number
): string {
  const pts: string[] = [];
  for (let x = 0; x <= width; x += 3) {
    const y =
      midY +
      Math.sin(x * freq + phase) * amp +
      Math.sin(x * freq * 2.1 + phase * 1.5) * amp * 0.28 +
      Math.sin(x * freq * 4.7 + phase * 0.9) * amp * 0.11;
    pts.push(x === 0 ? `M ${x} ${y.toFixed(1)}` : `L ${x} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/* ─────────────────────────────────────────────────────────
   01 — CHAIN LAB: animated plugin signal chain
   ───────────────────────────────────────────────────────── */

const PLUGINS = [
  { type: "EQ",   name: "High-pass", param: "80 Hz · 18dB", c: "#cbff1e" },
  { type: "COMP", name: "VCA Comp",  param: "4:1 · 8ms",    c: "#7dd3fc" },
  { type: "EQ",   name: "Presence",  param: "+2dB @ 3kHz",  c: "#cbff1e" },
  { type: "SAT",  name: "Drive",     param: "22% · soft",   c: "#fb923c" },
  { type: "FX",   name: "Room",      param: "0.6s · 12%",   c: "#a78bfa" },
];

const VU: number[][] = [
  [10, 18, 13, 7],
  [16, 9, 21, 11],
  [8, 22, 11, 17],
  [20, 14, 7, 23],
  [12, 8, 18, 14],
];

function ChainSVG() {
  return (
    <svg viewBox="0 0 760 200" className={styles.svg} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <pattern id="cg" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0v24" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="760" height="200" rx="8" fill="#090909" />
      <rect width="760" height="200" rx="8" fill="url(#cg)" />

      {PLUGINS.map((p, i) => {
        const bx = 28 + i * 141;
        const by = 36;
        const vus = VU[i];
        const notLast = i < PLUGINS.length - 1;
        return (
          <g key={p.name}>
            {notLast && (
              <>
                <line x1={bx + 100} y1={by + 58} x2={bx + 141} y2={by + 58}
                  stroke="rgba(255,255,255,0.07)" strokeWidth="1" strokeDasharray="2 3" />
                <circle r="2.5" fill={p.c}>
                  <animateMotion dur={`${1.5 + i * 0.28}s`} repeatCount="indefinite"
                    begin={`${i * 0.5}s`}
                    path={`M${bx + 100},${by + 58} L${bx + 141},${by + 58}`} />
                  <animate attributeName="opacity" values="0;0.95;0.95;0"
                    keyTimes="0;0.12;0.88;1"
                    dur={`${1.5 + i * 0.28}s`} repeatCount="indefinite" begin={`${i * 0.5}s`} />
                </circle>
              </>
            )}
            <rect x={bx} y={by} width="100" height="122" rx="7"
              fill="#0d0d11" stroke={`${p.c}20`} strokeWidth="1" />
            <rect x={bx + 1} y={by + 1} width="98" height="2" rx="1" fill={p.c} opacity="0.5" />
            <rect x={bx + 8} y={by + 12} width="28" height="13" rx="3" fill={`${p.c}18`} />
            <text x={bx + 22} y={by + 22.5} textAnchor="middle" fill={p.c}
              fontSize="7" fontFamily="'JetBrains Mono',monospace" fontWeight="700" letterSpacing="0.08em">
              {p.type}
            </text>
            <text x={bx + 50} y={by + 46} textAnchor="middle" fill="rgba(240,240,237,0.82)"
              fontSize="9.5" fontFamily="Inter,sans-serif" fontWeight="600">{p.name}</text>
            <text x={bx + 50} y={by + 60} textAnchor="middle" fill="rgba(240,240,237,0.3)"
              fontSize="7.5" fontFamily="'JetBrains Mono',monospace">{p.param}</text>
            {vus.map((h, b) => (
              <rect key={b} x={bx + 12 + b * 20} y={by + 88} width="12" height={h} rx="2"
                fill={p.c} opacity="0.28">
                <animate attributeName="opacity"
                  values={`0.15;${0.38 + b * 0.1};0.2;${0.45 + b * 0.07};0.15`}
                  dur={`${0.62 + b * 0.19}s`} repeatCount="indefinite" begin={`${b * 0.14}s`} />
              </rect>
            ))}
          </g>
        );
      })}
      <text x="14" y="101" fill="rgba(255,255,255,0.13)" fontSize="7"
        fontFamily="'JetBrains Mono',monospace" letterSpacing="0.1em">IN</text>
      <text x="736" y="101" fill="rgba(255,255,255,0.13)" fontSize="7"
        fontFamily="'JetBrains Mono',monospace" letterSpacing="0.1em">OUT</text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   02 — STEM RIP: source → 4 colour stems
   ───────────────────────────────────────────────────────── */

const SRC_WV  = wave(580, 40, 20, 0.028, 0.5);
const VOC_WV  = wave(136, 28, 14, 0.052, 1.2);
const DRM_WV  = wave(108, 28, 18, 0.082, 2.4);
const BSS_WV  = wave(118, 28, 11, 0.026, 0.8);
const FX_WV   = wave(94,  28, 7,  0.044, 3.1);

const STEMS = [
  { name: "VOCALS", path: VOC_WV, color: "#cbff1e", x: 10,  w: 136 },
  { name: "DRUMS",  path: DRM_WV, color: "#ff6b6b", x: 162, w: 108 },
  { name: "BASS",   path: BSS_WV, color: "#60a5fa", x: 286, w: 118 },
  { name: "FX",     path: FX_WV,  color: "#a78bfa", x: 420, w: 94  },
];

function StemSVG() {
  const srcCx = 30 + 580 / 2;
  const stemY = 170;
  return (
    <svg viewBox="0 0 560 260" className={styles.svg} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="560" height="260" rx="8" fill="#090909" />
      <rect x="20" y="10" width="520" height="74" rx="6" fill="#0d0d11"
        stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      <text x="38" y="28" fill="rgba(255,255,255,0.22)" fontSize="8"
        fontFamily="'JetBrains Mono',monospace" letterSpacing="0.08em">SOURCE</text>
      <path d={SRC_WV} transform="translate(30,22)" fill="none"
        stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />

      {STEMS.map((s, i) => {
        const stemCx = s.x + s.w / 2;
        const branchPath = `M ${srcCx},84 C ${srcCx},130 ${stemCx},130 ${stemCx},${stemY}`;
        const pathLen = 120;
        return (
          <path key={s.name} d={branchPath} fill="none" stroke={s.color} strokeWidth="1"
            opacity="0.25" strokeDasharray={`${pathLen}`} strokeDashoffset={`${pathLen}`}>
            <animate attributeName="stroke-dashoffset" from={`${pathLen}`} to="0"
              dur="0.9s" begin={`${0.3 + i * 0.18}s`} fill="freeze" />
            <animate attributeName="opacity" from="0" to="0.25"
              dur="0.3s" begin={`${0.3 + i * 0.18}s`} fill="freeze" />
          </path>
        );
      })}

      {STEMS.map((s, i) => (
        <g key={s.name}>
          <rect x={s.x} y={stemY} width={s.w} height="72" rx="6" fill="#0d0d11"
            stroke={`${s.color}22`} strokeWidth="1" opacity="0">
            <animate attributeName="opacity" from="0" to="1" dur="0.5s"
              begin={`${0.8 + i * 0.15}s`} fill="freeze" />
          </rect>
          <rect x={s.x + 1} y={stemY + 1} width={s.w - 2} height="2" rx="1"
            fill={s.color} opacity="0">
            <animate attributeName="opacity" from="0" to="0.45" dur="0.5s"
              begin={`${0.85 + i * 0.15}s`} fill="freeze" />
          </rect>
          <text x={s.x + 10} y={stemY + 18} fill={s.color} fontSize="7.5"
            fontFamily="'JetBrains Mono',monospace" fontWeight="600"
            letterSpacing="0.06em" opacity="0">
            <animate attributeName="opacity" from="0" to="0.65" dur="0.4s"
              begin={`${0.9 + i * 0.15}s`} fill="freeze" />
            {s.name}
          </text>
          <path d={s.path} transform={`translate(${s.x},${stemY + 24})`}
            fill="none" stroke={s.color} strokeWidth="1.1" opacity="0">
            <animate attributeName="opacity" from="0" to="0.6" dur="0.5s"
              begin={`${0.95 + i * 0.15}s`} fill="freeze" />
          </path>
        </g>
      ))}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   03 — VOCAL CHECK: EQ spectrum + flagged zones
   ───────────────────────────────────────────────────────── */

const SPECTRUM_LINE =
  "M20,178 L45,170 L70,156 L95,138 L120,118 L145,102 L165,90 L185,82 " +
  "L205,76 L225,72 L245,70 L265,68 L285,71 L305,75 L325,80 L345,82 " +
  "L365,79 L385,75 L405,70 L420,68 L435,71 L450,75 L465,80 L480,86 " +
  "L500,93 L520,102 L545,113 L570,126 L595,140 L620,155 L645,165 L670,172 L700,178";
const SPECTRUM_FILL = SPECTRUM_LINE + " L700,192 L20,192 Z";

const DIAG_ZONES = [
  { x: 46,  w: 88,  color: "#fb923c", label: "Mud",      hz: "250Hz", fix: "−3dB cut"   },
  { x: 144, w: 76,  color: "#fbbf24", label: "Box",      hz: "430Hz", fix: "−2dB notch" },
  { x: 230, w: 62,  color: "#f87171", label: "Nasal",    hz: "800Hz", fix: "−1.5dB"     },
  { x: 404, w: 72,  color: "#cbff1e", label: "Presence", hz: "3kHz",  fix: "+2dB shelf" },
];

const FREQ_LABELS = [
  { label: "20", x: 20 }, { label: "100", x: 100 },
  { label: "500", x: 250 }, { label: "1k", x: 370 },
  { label: "5k", x: 500 }, { label: "20k", x: 680 },
];

function VocalCheckSVG() {
  return (
    <svg viewBox="0 0 720 220" className={styles.svg} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="720" height="220" rx="8" fill="#090909" />
      {FREQ_LABELS.map((f) => (
        <g key={f.label}>
          <line x1={f.x} y1="10" x2={f.x} y2="192" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
          <text x={f.x} y="207" textAnchor="middle" fill="rgba(255,255,255,0.18)"
            fontSize="7" fontFamily="'JetBrains Mono',monospace">{f.label}</text>
        </g>
      ))}
      {DIAG_ZONES.map((z, i) => (
        <g key={z.label}>
          <rect x={z.x} y="0" width={z.w} height="192" fill={z.color} opacity="0.055">
            <animate attributeName="opacity" values="0.04;0.09;0.055"
              dur={`${2.2 + i * 0.4}s`} repeatCount="indefinite" begin={`${i * 0.6}s`} />
          </rect>
          <text x={z.x + z.w / 2} y="24" textAnchor="middle" fill={z.color}
            fontSize="7.5" fontFamily="'JetBrains Mono',monospace" fontWeight="600" opacity="0.72">{z.label}</text>
          <text x={z.x + z.w / 2} y="35" textAnchor="middle" fill={z.color}
            fontSize="6.5" fontFamily="'JetBrains Mono',monospace" opacity="0.38">{z.hz}</text>
        </g>
      ))}
      <path d={SPECTRUM_FILL} fill="rgba(255,255,255,0.028)" />
      <path d={SPECTRUM_LINE} fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth="1.5" />
      <line x1="0" y1="0" x2="0" y2="192" stroke="rgba(203,255,30,0.38)" strokeWidth="1.5">
        <animateMotion dur="5.5s" repeatCount="indefinite" path="M 20,0 L 700,0" />
      </line>
      <rect x="0" y="0" width="14" height="192" fill="rgba(203,255,30,0.04)">
        <animateMotion dur="5.5s" repeatCount="indefinite" path="M 13,0 L 693,0" />
      </rect>
      {DIAG_ZONES.map((z, i) => (
        <g key={`dx-${z.label}`}>
          <rect x="528" y={44 + i * 34} width="172" height="28" rx="4"
            fill="rgba(255,255,255,0.028)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" opacity="0">
            <animate attributeName="opacity" from="0" to="1" dur="0.4s"
              begin={`${0.6 + i * 0.35}s`} fill="freeze" />
          </rect>
          <text x="538" y={55 + i * 34} fill={z.color} fontSize="7.5"
            fontFamily="'JetBrains Mono',monospace" fontWeight="600" opacity="0">
            <animate attributeName="opacity" from="0" to="0.82" dur="0.4s"
              begin={`${0.65 + i * 0.35}s`} fill="freeze" />
            {z.label} → {z.fix}
          </text>
          <text x="538" y={66 + i * 34} fill="rgba(240,240,237,0.3)"
            fontSize="6.5" fontFamily="'JetBrains Mono',monospace" opacity="0">
            <animate attributeName="opacity" from="0" to="1" dur="0.4s"
              begin={`${0.72 + i * 0.35}s`} fill="freeze" />
            {z.hz} band
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   04 — MIX SESSION: 5-channel mixing console
   ───────────────────────────────────────────────────────── */

const SESSION_CH = [
  { name: "KICK",   gain: 0.72, color: "#ff6b6b", vus: [18, 25, 14, 8],  panLabel: "C"  },
  { name: "SNARE",  gain: 0.65, color: "#fb923c", vus: [15, 10, 22, 12], panLabel: "◂L" },
  { name: "BASS",   gain: 0.78, color: "#60a5fa", vus: [22, 18, 25, 16], panLabel: "C"  },
  { name: "VOCAL",  gain: 0.92, color: "#cbff1e", vus: [25, 28, 22, 26], panLabel: "C"  },
  { name: "BG VOC", gain: 0.45, color: "#a78bfa", vus: [10, 14, 8, 12],  panLabel: "R▸" },
];

function MixSessionSVG() {
  return (
    <svg viewBox="0 0 760 210" className={styles.svg} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <pattern id="sg" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0v24" fill="none" stroke="rgba(255,255,255,0.022)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="760" height="210" rx="8" fill="#090909" />
      <rect width="760" height="210" rx="8" fill="url(#sg)" />

      {SESSION_CH.map((ch, i) => {
        const bx = 30 + i * 108;
        const isVocal = ch.name === "VOCAL";
        const trackTop = 104;
        const trackBot = 174;
        const thumbY = trackTop + (1 - ch.gain) * (trackBot - trackTop);

        return (
          <g key={ch.name}>
            {isVocal && (
              <rect x={bx - 2} y="10" width="94" height="192" rx="7"
                fill={`${ch.color}06`} stroke={`${ch.color}28`} strokeWidth="1" />
            )}

            {/* Channel name */}
            <text x={bx + 45} y="28" textAnchor="middle"
              fill={isVocal ? ch.color : "rgba(255,255,255,0.22)"}
              fontSize="7.5" fontFamily="'JetBrains Mono',monospace"
              fontWeight={isVocal ? "700" : "400"} letterSpacing="0.05em">
              {ch.name}
            </text>

            {/* VU bars (4 per channel) */}
            {ch.vus.map((h, b) => (
              <rect key={b} x={bx + 9 + b * 19} y={92 - h} width="13" height={h} rx="1.5"
                fill={ch.color} opacity="0.3">
                <animate attributeName="opacity"
                  values={`0.18;${0.4 + b * 0.09};0.22;${0.48 + b * 0.07};0.18`}
                  dur={`${0.56 + b * 0.18}s`} repeatCount="indefinite" begin={`${b * 0.12 + i * 0.07}s`} />
                <animate attributeName="height"
                  values={`${h * 0.7};${h};${h * 0.8};${h * 1.12};${h * 0.7}`}
                  dur={`${0.56 + b * 0.18}s`} repeatCount="indefinite" begin={`${b * 0.12 + i * 0.07}s`} />
                <animate attributeName="y"
                  values={`${92 - h * 0.7};${92 - h};${92 - h * 0.8};${92 - h * 1.12};${92 - h * 0.7}`}
                  dur={`${0.56 + b * 0.18}s`} repeatCount="indefinite" begin={`${b * 0.12 + i * 0.07}s`} />
              </rect>
            ))}

            {/* Fader track */}
            <line x1={bx + 45} y1={trackTop} x2={bx + 45} y2={trackBot}
              stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            {/* Unity mark */}
            <line x1={bx + 39} y1={trackTop + (trackBot - trackTop) * 0.08}
              x2={bx + 51} y2={trackTop + (trackBot - trackTop) * 0.08}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
            <text x={bx + 56} y={trackTop + (trackBot - trackTop) * 0.08 + 3}
              fill="rgba(255,255,255,0.1)" fontSize="5.5" fontFamily="'JetBrains Mono',monospace">0</text>

            {/* Fader thumb */}
            <rect x={bx + 33} y={thumbY - 5} width="24" height="10" rx="2.5"
              fill={isVocal ? ch.color : "#1c1c1c"}
              stroke={isVocal ? ch.color : "rgba(255,255,255,0.18)"}
              strokeWidth="1" />
            <line x1={bx + 35} y1={thumbY} x2={bx + 55} y2={thumbY}
              stroke={isVocal ? "#080808" : "rgba(255,255,255,0.18)"} strokeWidth="0.5" />

            {/* Pan label */}
            <text x={bx + 45} y="194" textAnchor="middle"
              fill="rgba(255,255,255,0.14)" fontSize="6.5" fontFamily="'JetBrains Mono',monospace">
              {ch.panLabel}
            </text>
          </g>
        );
      })}

      {/* Master bus */}
      <rect x="582" y="10" width="140" height="192" rx="7"
        fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      <text x="652" y="28" textAnchor="middle"
        fill="rgba(255,255,255,0.28)" fontSize="7.5" fontFamily="'JetBrains Mono',monospace" letterSpacing="0.06em">
        MASTER
      </text>

      {/* L/R VU columns */}
      {[{ x: 600, h: 52, dur: "0.88s" }, { x: 618, h: 47, dur: "1.1s" }].map((m, mi) => (
        <g key={mi}>
          <rect x={m.x} y={92 - m.h} width="12" height={m.h} rx="2" fill="#cbff1e" opacity="0.22">
            <animate attributeName="height"
              values={`${m.h * 0.8};${m.h};${m.h * 0.88};${m.h * 1.08};${m.h * 0.8}`}
              dur={m.dur} repeatCount="indefinite" />
            <animate attributeName="y"
              values={`${92 - m.h * 0.8};${92 - m.h};${92 - m.h * 0.88};${92 - m.h * 1.08};${92 - m.h * 0.8}`}
              dur={m.dur} repeatCount="indefinite" />
          </rect>
          <text x={m.x + 6} y="104" textAnchor="middle"
            fill="rgba(255,255,255,0.15)" fontSize="6" fontFamily="'JetBrains Mono',monospace">
            {mi === 0 ? "L" : "R"}
          </text>
        </g>
      ))}

      {/* Master fader */}
      <line x1="652" y1="112" x2="652" y2="174" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      <rect x="640" y="116" width="24" height="10" rx="2.5"
        fill="#1c1c1c" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
      <line x1="642" y1="121" x2="662" y2="121"
        stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" />

      {/* Output readout */}
      <rect x="600" y="150" width="84" height="18" rx="3"
        fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      <text x="642" y="163" textAnchor="middle" fill="#cbff1e"
        fontSize="9" fontFamily="'JetBrains Mono',monospace" fontWeight="600">
        −2.1 dBFS
      </text>

      {/* Ready badge */}
      <text x="652" y="196" textAnchor="middle"
        fill="rgba(203,255,30,0.45)" fontSize="7" fontFamily="'JetBrains Mono',monospace" letterSpacing="0.08em">
        READY
      </text>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   05 — LEVEL LAB: before / after waveform + scan
   ───────────────────────────────────────────────────────── */

const RAW_PATH  = wave(750, 110, 44, 0.022, 0.0);
const PROC_PATH = wave(750, 110, 20, 0.022, 0.0);

const METRICS = [
  { label: "LUFS",    val: "−12.4",  x: 68 },
  { label: "Peak",    val: "−0.8dB", x: 228 },
  { label: "RMS",     val: "↑14%",   x: 388 },
  { label: "Clarity", val: "+18pt",  x: 548 },
  { label: "Width",   val: "+6%",    x: 690 },
];

function LevelLabSVG() {
  return (
    <svg viewBox="0 0 760 220" className={styles.svg} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <clipPath id="llL"><rect x="0" y="0" width="379" height="200" /></clipPath>
        <clipPath id="llR"><rect x="381" y="0" width="379" height="200" /></clipPath>
        <linearGradient id="rawGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.0)" />
          <stop offset="15%"  stopColor="rgba(255,255,255,0.42)" />
          <stop offset="85%"  stopColor="rgba(255,255,255,0.42)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
        </linearGradient>
        <linearGradient id="procGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(203,255,30,0.0)" />
          <stop offset="15%"  stopColor="rgba(203,255,30,0.72)" />
          <stop offset="85%"  stopColor="rgba(203,255,30,0.72)" />
          <stop offset="100%" stopColor="rgba(203,255,30,0.0)" />
        </linearGradient>
      </defs>

      <rect width="760" height="220" rx="8" fill="#090909" />
      <text x="24" y="22" fill="rgba(255,255,255,0.22)" fontSize="8"
        fontFamily="'JetBrains Mono',monospace" letterSpacing="0.08em">RAW TAKE</text>
      <text x="400" y="22" fill="#cbff1e" fontSize="8"
        fontFamily="'JetBrains Mono',monospace" letterSpacing="0.08em" opacity="0.65">PROCESSED</text>

      <path clipPath="url(#llL)" d={RAW_PATH} fill="none" stroke="url(#rawGrad)" strokeWidth="1.4" />
      <path clipPath="url(#llR)" d={PROC_PATH} fill="none" stroke="url(#procGrad)" strokeWidth="1.4" />
      <line x1="380" y1="8" x2="380" y2="195" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />

      <rect x="326" y="96" width="108" height="28" rx="5"
        fill="#0d0d11" stroke="rgba(203,255,30,0.25)" strokeWidth="1" />
      <text x="380" y="115" textAnchor="middle" fill="#cbff1e"
        fontSize="11" fontFamily="'JetBrains Mono',monospace" fontWeight="700">Δ +2.3 LUFS</text>

      {METRICS.map((m) => (
        <g key={m.label}>
          <rect x={m.x - 30} y="196" width="76" height="20" rx="3"
            fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <text x={m.x + 8} y="210" textAnchor="middle" fill="rgba(240,240,237,0.42)"
            fontSize="7" fontFamily="'JetBrains Mono',monospace">{m.label} {m.val}</text>
        </g>
      ))}

      <rect x="0" y="0" width="1.5" height="195" fill="rgba(203,255,30,0.45)" rx="1">
        <animateMotion dur="5s" repeatCount="indefinite" path="M 0,0 L 758,0" />
      </rect>
      <rect x="0" y="0" width="10" height="195" fill="rgba(203,255,30,0.04)">
        <animateMotion dur="5s" repeatCount="indefinite" path="M -5,0 L 753,0" />
      </rect>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   06 — THE STASH: saved chain card grid
   ───────────────────────────────────────────────────────── */

const STASH_CHAINS = [
  { name: "Balanced & Present", genre: "Hip-Hop", steps: 4, active: true  },
  { name: "Dark Trap",          genre: "Trap",    steps: 5, active: false },
  { name: "Bright Pop",         genre: "Pop",     steps: 4, active: false },
  { name: "Lo-Fi Warmth",       genre: "Lo-Fi",   steps: 3, active: false },
  { name: "UK Drill Mix",       genre: "Drill",   steps: 5, active: false },
  { name: "Afrobeats Club",     genre: "Afro",    steps: 4, active: false },
];

function StashCard({ chain, index }: { chain: (typeof STASH_CHAINS)[0]; index: number }) {
  return (
    <motion.div
      className={`${styles.vaultCard} ${chain.active ? styles.vaultCardActive : ""}`}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55, delay: index * 0.09, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.22 } }}
    >
      <div className={styles.vaultTop}>
        <span className={styles.vaultName}>{chain.name}</span>
        {chain.active && <span className={styles.vaultDot} aria-hidden />}
      </div>
      <div className={styles.vaultMeta}>
        <span className={styles.vaultGenre}>{chain.genre}</span>
        <span className={styles.vaultSteps}>{chain.steps} steps</span>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Section wrappers — new order: Chain Lab → Stem Rip →
   Vocal Check → Collision Check → E-Val → Vault
   ───────────────────────────────────────────────────────── */

function ChainLabSection() {
  return (
    <section className={styles.story}>
      <SectionText
        tool="01 — Chain Lab"
        headline={<>Cook the chain.<br />Not the workflow.</>}
        sub="Drop the raw vocal. Pick the vibe. mimiq cooks a full mix chain — EQ, comp, saturation, reverb — built specifically around your take. No preset packs. No guesswork."
      />
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={8} ry={-14}>
          <div className={styles.svgCard}><ChainSVG /></div>
        </Tilt>
      </Rise>
    </section>
  );
}

function StemRipSection() {
  return (
    <section className={`${styles.story} ${styles.storyFlip}`}>
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={9} ry={13}>
          <div className={styles.svgCard}><StemSVG /></div>
        </Tilt>
      </Rise>
      <SectionText
        tool="02 — Stem Rip"
        headline={<>One file.<br />Four clean stems.</>}
        sub="Rip the vocal out of literally anything. Drums, bass, FX — all isolated, no bleed. Work clean and only mix what matters. No cap."
        delay={0.1}
      />
    </section>
  );
}

function VocalCheckSection() {
  return (
    <section className={styles.story}>
      <SectionText
        tool="03 — Vocal Check"
        headline={<>See the problem<br />before you hear it.</>}
        sub="Mud at 250. Box at 430. Nasal at 800. Missing presence at 3k. Flagged, labelled, and already fixed before you even touch a fader. Real talk."
      />
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={6} ry={-11}>
          <div className={styles.svgCard}><VocalCheckSVG /></div>
        </Tilt>
      </Rise>
    </section>
  );
}

function MixSessionSection() {
  return (
    <section className={`${styles.story} ${styles.storyFlip}`}>
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={7} ry={12}>
          <div className={styles.svgCard}><MixSessionSVG /></div>
        </Tilt>
      </Rise>
      <SectionText
        tool="04 — Collision Check"
        headline={<>All your tools.<br />One session.</>}
        sub="Jump in the session. Fine-tune the mix, pull up the chain, check the vocal — all in one place, all connected to the same project document."
        delay={0.1}
      />
    </section>
  );
}

function LevelLabSection() {
  return (
    <section className={styles.story}>
      <SectionText
        tool="05 — E-Val"
        headline={<>Stop guessing.<br />See the proof.</>}
        sub="Compare the raw take to the processed export. Measured deltas — LUFS, peak, RMS, clarity — so you know it actually hit harder before you call it done."
      />
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={8} ry={-13}>
          <div className={styles.svgCard}><LevelLabSVG /></div>
        </Tilt>
      </Rise>
    </section>
  );
}

function TheStashSection() {
  return (
    <section className={`${styles.story} ${styles.storyFlip}`}>
      <Rise delay={0.28} className={styles.graphicSide}>
        <Tilt rx={6} ry={10}>
          <div className={styles.vaultWrap}>
            {STASH_CHAINS.map((c, i) => <StashCard key={c.name} chain={c} index={i} />)}
          </div>
        </Tilt>
      </Rise>
      <SectionText
        tool="06 — Vault"
        headline={<>Every chain<br />that slapped.</>}
        sub="Saved, tagged, and one click away. Build a personal library of chains that sound like you — not like some preset pack everyone else is running."
        delay={0.1}
      />
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   Closing CTA
   ───────────────────────────────────────────────────────── */

function ClosingSection({ startHref }: { startHref: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useInView(ref, { once: true, margin: "-60px 0px" });
  return (
    <section className={styles.closing} ref={ref}>
      <motion.div
        className={styles.closingInner}
        initial={{ opacity: 0, y: 40 }}
        animate={v ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className={styles.closingEye}>Six tools. One session. Your sound.</p>
        <h2 className={styles.closingHead}>
          Start mixing
          <br />
          <span className={styles.closingAccent}>smarter.</span>
        </h2>
        <Link href={startHref} className={styles.closingCta} id="closing-cta">
          Try mimiq free
        </Link>
        <span className={styles.closingNote}>
          3 free analyses · No credit card · Cancel anytime
        </span>
      </motion.div>
      <div className={styles.closingGlow} aria-hidden />
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   Main export
   ───────────────────────────────────────────────────────── */

export function ToolStories({ startHref }: { startHref: string }) {
  return (
    <div className={styles.stories}>
      <ChainLabSection />
      <StemRipSection />
      <VocalCheckSection />
      <MixSessionSection />
      <LevelLabSection />
      <TheStashSection />
      <ClosingSection startHref={startHref} />
    </div>
  );
}
