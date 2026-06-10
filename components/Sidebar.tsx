"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { eras, type Era } from "@/lib/eras";
import { useAuth } from "@/lib/useAuth";
import { useAudioStore } from "@/lib/useAudioStore";
import { useProject } from "@/lib/useProject";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  activePage: "projects" | "sandbox" | "mix-room" | "level-lab" | "vault";
  activeEra: Era;
  onEraChange: (era: Era) => void;
  savedCount: number;
  dimNavItems?: boolean;
  uploadedVocalName?: string | null;
  onVocalUpload?: (file: File) => void | Promise<void>;
  onVocalClear?: () => void;
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

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.31.57.76.57 1.24V12c0 .48-.21.93-.57 1.24Z" />
    </svg>
  );
}

function UploadWaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10V8" />
      <path d="M5 12V5" />
      <path d="M8 13V3" />
      <path d="M11 12V5" />
      <path d="M14 10V8" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4.5 6.5 11 3 7.5" />
    </svg>
  );
}

const isAcceptedVocalFile = (file: File) => {
  const name = file.name.toLowerCase();
  return name.endsWith(".wav") || name.endsWith(".mp3");
};

const truncateFileName = (name: string) =>
  name.length > 18 ? `${name.slice(0, 15)}...` : name;

export function Sidebar({
  activePage,
  activeEra,
  onEraChange,
  savedCount,
  dimNavItems = false,
  uploadedVocalName = null,
  onVocalUpload,
  onVocalClear,
}: SidebarProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [unlockStage, setUnlockStage] = useState(0);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [uploadRejected, setUploadRejected] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeIsAnalyzed = useAudioStore((state) => state.isAnalyzed);
  const isAnalyzed = isHydrated ? storeIsAnalyzed : false;
  const activeProjectName = useProject((state) => state.project?.name);
  const signOut = useAuth((state) => state.signOut);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsHydrated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(
    () => () => {
      if (rejectTimerRef.current) {
        clearTimeout(rejectTimerRef.current);
      }
    },
    []
  );

  // Trigger staggered animations via state stages when isAnalyzed flips to true
  useEffect(() => {
    if (!isHydrated) return;
    let frame: number;
    let timer: ReturnType<typeof setTimeout> | undefined;
    
    if (isAnalyzed) {
      // Small tick to ensure class flips after render if it mounted already analyzed
      frame = requestAnimationFrame(() => {
        setUnlockStage(1); // Mix Room unlocks
        timer = setTimeout(() => setUnlockStage(2), 100); // Level Lab unlocks
      });
      return () => {
        cancelAnimationFrame(frame);
        if (timer) clearTimeout(timer);
      };
    } else {
      frame = requestAnimationFrame(() => setUnlockStage(0));
      return () => cancelAnimationFrame(frame);
    }
  }, [isAnalyzed, isHydrated]);

  // Prevent rendering un-hydrated lock states completely (avoids flicker)
  if (!isHydrated) {
    return <aside className={styles.sidebar}></aside>;
  }

  const isMixRoomUnlocked = unlockStage >= 1;
  const isLevelLabUnlocked = unlockStage >= 2;
  const showGreenDot = unlockStage >= 1; // Unlocks immediately with Mix Room
  const showSidebarUpload = Boolean(onVocalUpload) && activePage !== "level-lab";
  const displayVocalName = uploadedVocalName
    ? truncateFileName(uploadedVocalName)
    : null;

  const flashRejectedUpload = () => {
    if (rejectTimerRef.current) {
      clearTimeout(rejectTimerRef.current);
    }
    setUploadRejected(true);
    rejectTimerRef.current = setTimeout(() => {
      setUploadRejected(false);
      rejectTimerRef.current = null;
    }, 300);
  };

  const handleSidebarVocalFile = (file: File) => {
    if (!isAcceptedVocalFile(file)) {
      setUploadDragOver(false);
      flashRejectedUpload();
      return;
    }

    setUploadRejected(false);
    void onVocalUpload?.(file);
  };

  const handleSidebarUploadInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      handleSidebarVocalFile(file);
    }
  };

  const handleSidebarUploadDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setUploadDragOver(true);
  };

  const handleSidebarUploadDragLeave = () => {
    setUploadDragOver(false);
  };

  const handleSidebarUploadDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setUploadDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      handleSidebarVocalFile(file);
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandRow}>
        <Link href="/projects" className={styles.homeLink} aria-label="MimiQ Projects">
          <div className={styles.audioWave}>
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
            <div className={styles.waveBar} />
          </div>
          <span className={styles.brandText}>
            <strong>MimiQ</strong>
            <em>AI mix engine</em>
          </span>
        </Link>
      </div>

      <Link
        href="/projects"
        className={`${styles.projectContext} ${dimNavItems ? styles.navDimmed : ""}`}
      >
        <span className={styles.projectContextLabel}>Project</span>
        <span className={styles.projectContextName}>
          {activeProjectName ?? "Select a project"}
        </span>
      </Link>

      <button
        type="button"
        className={`${styles.trackPill} ${dimNavItems ? styles.navDimmed : ""}`}
        aria-label="Current track"
      >
        <span />
        Lead Vocal
        <ChevronIcon className={styles.chevronIcon} />
      </button>

      <nav className={`${styles.nav} ${dimNavItems ? styles.navDimmed : ""}`}>
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
            Chain
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
          {savedCount > 0 && (
            <span className={styles.savedCountNum}>{savedCount}</span>
          )}
        </Link>

        {showSidebarUpload && (
          <div className={styles.sidebarUploadSection}>
            <AnimatePresence initial={false} mode="wait">
              {displayVocalName ? (
                <motion.div
                  key="uploaded-vocal"
                  className={styles.uploadedVocalRow}
                  initial={{ opacity: 0, height: 0, y: -4 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <CheckIcon className={styles.uploadedVocalCheck} />
                  <span className={styles.uploadedVocalName} title={uploadedVocalName ?? ""}>
                    {displayVocalName}
                  </span>
                  <button
                    type="button"
                    className={styles.uploadedVocalClear}
                    onClick={onVocalClear}
                    aria-label="Clear uploaded vocal"
                  >
                    ×
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="sidebar-upload-zone"
                  className={styles.sidebarUploadMotion}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <button
                    type="button"
                    className={`${styles.sidebarUploadZone} ${
                      uploadDragOver ? styles.sidebarUploadZoneDragging : ""
                    } ${uploadRejected ? styles.sidebarUploadZoneRejected : ""}`}
                    onClick={() => uploadInputRef.current?.click()}
                    onDragOver={handleSidebarUploadDragOver}
                    onDragLeave={handleSidebarUploadDragLeave}
                    onDrop={handleSidebarUploadDrop}
                    aria-label="Upload vocal"
                  >
                    <UploadWaveIcon className={styles.sidebarUploadIcon} />
                    <span className={styles.sidebarUploadText}>Drop vocal</span>
                    <span className={styles.sidebarUploadBrowse}>or browse</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".wav,.mp3"
              className={styles.sidebarUploadInput}
              onChange={handleSidebarUploadInput}
            />
          </div>
        )}

        <div className={styles.eraSection}>
          <div className={styles.sectionHeader}>
            <span>Vocal presets</span>
          </div>
          <div className={styles.eraPills}>
            {eras.map((era) => (
              <button
                key={era.id}
                className={`${styles.eraPill} ${
                  activeEra.id === era.id ? styles.eraPillActive : ""
                }`}
                onClick={() => onEraChange(era)}
              >
                <span className={styles.presetDot} />
                <span className={styles.eraPillText}>{era.name}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.profileChip}>
          <span className={styles.avatar}>N</span>
          <span>
            <strong>Pro Plan</strong>
            <em>Studio profile</em>
          </span>
        </div>
        <div className={styles.footerActions}>
          <button type="button" aria-label="Settings" title="Settings">
            <SettingsIcon className={styles.footerIcon} />
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOutIcon className={styles.footerIcon} />
          </button>
        </div>
      </div>
    </aside>
  );
}
