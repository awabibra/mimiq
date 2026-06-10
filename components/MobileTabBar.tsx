"use client";

import Link from "next/link";
import styles from "./MobileTabBar.module.css";

interface MobileTabBarProps {
  activePage: "sandbox" | "stem-splitter" | "vocal-diagnostics" | "vault";
}

/* ── Inline SVG icons ── */

function SandboxIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function VaultIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SplitIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6h4a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4h4" />
      <path d="M16 14l4 4-4 4" />
      <path d="M4 18h4a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4h4" />
      <path d="M16 2l4 4-4 4" />
    </svg>
  );
}

function TuneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v13" />
      <path d="M16 7l-4-4-4 4" />
      <circle cx="12" cy="18" r="3" />
      <path d="M4 12h3" />
      <path d="M17 12h3" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function MobileTabBar({ activePage }: MobileTabBarProps) {
  return (
    <nav className={styles.mobileTabBar}>
      <Link
        href="/sandbox"
        className={`${styles.mobileTab} ${
          activePage === "sandbox" ? styles.mobileTabActive : ""
        }`}
      >
        <SandboxIcon className={styles.mobileTabIcon} />
        <span>Sandbox</span>
      </Link>
      <Link
        href="/stem-splitter"
        className={`${styles.mobileTab} ${
          activePage === "stem-splitter" ? styles.mobileTabActive : ""
        }`}
      >
        <SplitIcon className={styles.mobileTabIcon} />
        <span>Stems</span>
      </Link>
      <Link
        href="/vocal-diagnostics"
        className={`${styles.mobileTab} ${
          activePage === "vocal-diagnostics" ? styles.mobileTabActive : ""
        }`}
      >
        <TuneIcon className={styles.mobileTabIcon} />
        <span>Tune</span>
      </Link>
      <Link
        href="/vault"
        className={`${styles.mobileTab} ${
          activePage === "vault" ? styles.mobileTabActive : ""
        }`}
      >
        <VaultIcon className={styles.mobileTabIcon} />
        <span>Vault</span>
      </Link>
      <button className={styles.mobileTab}>
        <SettingsIcon className={styles.mobileTabIcon} />
        <span>Settings</span>
      </button>
    </nav>
  );
}
