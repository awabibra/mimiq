"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProjectAudioAssets } from "@/lib/projectAudio";
import { useAuth } from "@/lib/useAuth";
import { useProject } from "@/lib/useProject";
import { ProjectAudioUploadWidget } from "@/components/ProjectAudioUpload";
import { Logo } from "@/components/ui/logo";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  activePage: "projects" | "sandbox" | "mix-room" | "level-lab" | "stem-splitter" | "vocal-diagnostics" | "vault";
  savedCount: number;
  dimNavItems?: boolean;
}

// ... skipping icons for brevity ...
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

function SplitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h4a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4h4" />
      <path d="M16 14l4 4-4 4" />
      <path d="M4 18h4a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4h4" />
      <path d="M16 2l4 4-4 4" />
    </svg>
  );
}

function TuneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13" />
      <path d="M16 7l-4-4-4 4" />
      <circle cx="12" cy="18" r="3" />
      <path d="M4 12h3" />
      <path d="M17 12h3" />
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

export function Sidebar({
  activePage,
  savedCount,
  dimNavItems = false,
}: SidebarProps) {
  const [isHydrated, setIsHydrated] = useState(false);

  const project = useProject((state) => state.project);
  const activeProjectName = project?.name;
  const signOut = useAuth((state) => state.signOut);
  const audioAssets = getProjectAudioAssets(project);
  const readyAssets = audioAssets.filter((asset) => asset.status === "ready");

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsHydrated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!isHydrated) {
    return <aside className={styles.sidebar}></aside>;
  }

  const showGreenDot = readyAssets.length > 0;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandRow}>
        <Link href="/projects" className={styles.homeLink} aria-label="mimiq Projects">
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
            <Logo className="text-sm text-white" />
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
            Chain Lab
          </div>
        </Link>

        <Link
          href="/stem-splitter"
          className={`${styles.navItem} ${
            activePage === "stem-splitter" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "stem-splitter" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <SplitIcon className={styles.navIcon} />
            Stem Rip
          </div>
        </Link>

        <Link
          href="/vocal-diagnostics"
          className={`${styles.navItem} ${
            activePage === "vocal-diagnostics" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "vocal-diagnostics" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <TuneIcon className={styles.navIcon} />
            Vocal Check
          </div>
        </Link>

        <Link
          href="/mix-room"
          className={`${styles.navItem} ${
            activePage === "mix-room" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "mix-room" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <MixIcon className={styles.navIcon} />
            Collision Check
          </div>
        </Link>

        <Link
          href="/level-lab"
          className={`${styles.navItem} ${
            activePage === "level-lab" ? styles.navItemActive : ""
          }`}
          aria-current={activePage === "level-lab" ? "page" : undefined}
        >
          <div className={styles.navItemLeft}>
            <ActivityIcon className={styles.navIcon} />
            E-Val
          </div>
        </Link>

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

        <div className={styles.sidebarUploadWrapper}>
          <ProjectAudioUploadWidget />
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
