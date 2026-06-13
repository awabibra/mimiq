"use client";

import { Sidebar } from "@/components/Sidebar";
import { eras } from "@/lib/eras";
import type { ChainStep } from "@/lib/types";
import styles from "../sandbox/page.module.css";
import { VisualVocalChain } from "../sandbox/VisualVocalChain";

const previewChain: ChainStep[] = [
  { step: 1, tool: "Noise Gate", action: "Threshold -46 dB, attack 4 ms, release 130 ms", reason: "Clean spill", bus: "main", role: "gate" },
  { step: 2, tool: "Channel EQ", action: "High-pass at 118 Hz, 24dB/oct", reason: "Remove rumble", bus: "main", role: "subtractive_eq" },
  { step: 3, tool: "Channel EQ", action: "-2.0 dB at 350 Hz, Q 1.3; -1.0 dB at 700 Hz", reason: "Shape tone", bus: "main", role: "tone_eq" },
  { step: 4, tool: "Vintage VCA", action: "FET_1176, 3:1, attack 8 ms, release 180 ms", reason: "Primary compression", bus: "main", role: "compressor_primary" },
  { step: 5, tool: "Vintage Opto", action: "Light opto leveling, peak reduction 25, gain 30", reason: "Level tail", bus: "main", role: "compressor_secondary" },
  { step: 6, tool: "Channel EQ", action: "Boost +1.8 dB at 3 kHz; shelf +3 dB at 12 kHz", reason: "Presence", bus: "main", role: "presence_eq" },
  { step: 7, tool: "DeEsser 2", action: "Target 7.5 kHz, reduce +3.8 dB", reason: "Sibilance", bus: "main", role: "de_esser" },
  { step: 8, tool: "Tape Delay", action: "Drive 8/100, mix 7%", reason: "Short movement", bus: "main", role: "delay_insert" },
  { step: 9, tool: "ChromaVerb", action: "Intimate room, decay 1.4 s", reason: "Room return", bus: "reverb_bus", role: "reverb_return", sendPoint: "after-compressor-primary" },
  { step: 10, tool: "Compressor", action: "Sidechain duck, threshold -25 dB, ratio 4:1", reason: "Duck reverb", bus: "reverb_bus", role: "reverb_duck", sendPoint: "after-compressor-primary" },
  { step: 11, tool: "Stereo Delay", action: "1/4 note, feedback 20%, mix 17%", reason: "Throw return", bus: "delay_bus", role: "delay_return", sendPoint: "after-compressor-primary" },
  { step: 12, tool: "Vintage VCA", action: "4:1, attack 4 ms, blend 18%", reason: "Parallel density", bus: "parallel_comp_bus", role: "parallel_comp", sendPoint: "after-compressor-primary" },
  { step: 13, tool: "Chorus", action: "Microshift width, amount 29%", reason: "Width return", bus: "width_bus", role: "width_return", sendPoint: "after-compressor-primary" },
  { step: 14, tool: "Bitcrusher", action: "Subtle tape polish, mix 7%", reason: "Texture return", bus: "saturation_bus", role: "saturation_return", sendPoint: "after-compressor-primary" },
  { step: 15, tool: "Vintage VCA", action: "1.5:1, attack 30 ms, release 100 ms", reason: "Master glue", bus: "mastering_bus", role: "master_glue", sendPoint: "after-compressor-primary" },
  { step: 16, tool: "Adaptive Limiter", action: "Ceiling -0.3 dB", reason: "Peak control", bus: "mastering_bus", role: "master_limiter", sendPoint: "after-compressor-primary" },
];

export default function ChainPreviewPage() {
  return (
    <div className={styles.layout}>
      <Sidebar activePage="sandbox" savedCount={2} />
      <div className={`${styles.sandboxContent} ${styles.sandboxContentResults}`}>
        <main className={`${styles.center} ${styles.centerToolDock}`} />
        <aside className={styles.right}>
          <div className={styles.insightStrip}>
            <div className={styles.insightCard}><span className={styles.insightLabel}>Loudness</span><span className={styles.insightValue}>-15.0 LUFS</span></div>
            <div className={styles.insightCard}><span className={styles.insightLabel}>Dynamic Range</span><span className={styles.insightValue}>6.0 dB</span></div>
            <div className={styles.insightCard}><span className={styles.insightLabel}>Brightness</span><span className={styles.insightValue}>2.6 kHz</span></div>
          </div>
          <div className={styles.chainHeader}>
            <span className={styles.chainTitle}>Vocal Chain</span>
            <div className={styles.chainMeta}><span className={styles.eraBadge}>4you</span><button type="button" className={styles.saveChainButton}>Save chain</button></div>
          </div>
          <VisualVocalChain chain={previewChain} engineerNote="Your vocal is 2 dB quiet for 4you, so the primary compressor threshold was pulled lower while the limiter ceiling stays protected." />
        </aside>
      </div>
    </div>
  );
}
