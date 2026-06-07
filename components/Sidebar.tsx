"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { eras, type Era } from "@/lib/eras";
import { useAudioStore } from "@/lib/useAudioStore";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  activePage: "sandbox" | "mix-room" | "level-lab" | "vault";
  activeEra: Era;
  onEraChange: (era: Era) => void;
  savedCount: number;
}

function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function MixIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function Sidebar({
  activePage,
  activeEra,
  onEraChange,
  savedCount,
}: SidebarProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [unlockStage, setUnlockStage] = useState(0);

  const storeIsAnalyzed = useAudioStore((state) => state.isAnalyzed);
  const isAnalyzed = isHydrated ? storeIsAnalyzed : false;

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Trigger staggered animations via state stages when isAnalyzed flips to true
  useEffect(() => {
    if (!isHydrated) return;
    
    if (isAnalyzed) {
      // Small tick to ensure class flips after render if it mounted already analyzed
      setUnlockStage(1); // Mix Room unlocks
      const t = setTimeout(() => setUnlockStage(2), 100); // Level Lab unlocks
      return () => clearTimeout(t);
    } else {
      setUnlockStage(0);
    }
  }, [isAnalyzed, isHydrated]);

  // Prevent rendering un-hydrated lock states completely (avoids flicker)
  if (!isHydrated) {
    return <aside className={styles.sidebar}></aside>;
  }

  const isMixRoomUnlocked = unlockStage >= 1;
  const isLevelLabUnlocked = unlockStage >= 2;
  const showGreenDot = unlockStage >= 1; // Unlocks immediately with Mix Room

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandRow}>
        <Link href="/" className={styles.homeLink} aria-label="MimiQ Home">
          <div className={styles.audioWave}>
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
          </div>
        </Link>
      </div>

      <nav className={styles.nav}>
        <Link
          href="/sandbox"
          className={`${styles.navItem} ${
            activePage === "sandbox" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "sandbox" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <div className={`${styles.sandboxDot} ${showGreenDot ? styles.sandboxDotActive : ""}`} />
            <SlidersIcon className={styles.navIcon} />
            Sandbox
          </div>
        </Link>

        <div className={styles.navItemWrapper}>
          <Link
            href="/mix-room"
            className={`${styles.navItem} ${styles.gatedItem} ${
              isMixRoomUnlocked ? styles.unlocked : styles.locked
            } ${activePage === "mix-room" ? styles.navItemActive : ""}`}
            aria-current={activePage === "mix-room" ? "page" : undefined}
          >
            <div className={styles.navItemLeft}>
              <MixIcon className={styles.navIcon} />
              Mix Room
            </div>
            <LockIcon className={`${styles.lockIcon} ${isMixRoomUnlocked ? styles.lockIconHidden : ""}`} />
          </Link>
          {!isMixRoomUnlocked && (
            <div className={styles.tooltip}>Upload a vocal in Sandbox first</div>
          )}
        </div>

        <div className={styles.navItemWrapper}>
          <Link
            href="/level-lab"
            className={`${styles.navItem} ${styles.gatedItem} ${
              isLevelLabUnlocked ? styles.unlocked : styles.locked
            } ${activePage === "level-lab" ? styles.navItemActive : ""}`}
            aria-current={activePage === "level-lab" ? "page" : undefined}
          >
            <div className={styles.navItemLeft}>
              <ActivityIcon className={styles.navIcon} />
              Level Lab
            </div>
            <LockIcon className={`${styles.lockIcon} ${isLevelLabUnlocked ? styles.lockIconHidden : ""}`} />
          </Link>
          {!isLevelLabUnlocked && (
            <div className={styles.tooltip}>Upload a vocal in Sandbox first</div>
          )}
        </div>

        <Link
          href="/vault"
          className={`${styles.navItem} ${
            activePage === "vault" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "vault" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <LayersIcon className={styles.navIcon} />
            Vault
          </div>
        </Link>

        <div style={{ height: "32px", flexShrink: 0 }} />

        {/* Era switcher */}
        <div className={styles.eraSection}>
          <div className={styles.eraPills}>
            {eras.map((era) => (
              <button
                key={era.id}
                className={`${styles.eraPill} ${
                  activeEra.id === era.id ? styles.eraPillActive : ""
                }`}
                style={{
                  "--accent": era.accent,
                  ...(activeEra.id === era.id && {
                    color: era.accent,
                  }),
                } as React.CSSProperties}
                onClick={() => onEraChange(era)}
              >
                <span className={styles.eraPillText}>{era.name}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
}

