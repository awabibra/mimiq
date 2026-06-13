"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import type { StudioTool } from "@/components/StudioShell";
import styles from "./MobileTabBar.module.css";

type MobileTool = Exclude<StudioTool, "projects">;

interface MobileTabBarProps {
  activePage: MobileTool;
}

function ChainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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

function PulseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function SplitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h4a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4h4" />
      <path d="M16 14l4 4-4 4" />
      <path d="M4 18h4a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4h4" />
      <path d="M16 2l4 4-4 4" />
    </svg>
  );
}

function TuneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13" />
      <path d="M16 7l-4-4-4 4" />
      <circle cx="12" cy="18" r="3" />
      <path d="M4 12h3" />
      <path d="M17 12h3" />
    </svg>
  );
}

function VaultIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 12 12 17 22 12" />
      <polyline points="2 17 12 22 22 17" />
    </svg>
  );
}

const tabs: Array<{
  href: string;
  key: MobileTool;
  label: string;
  Icon: ({ className }: { className?: string }) => ReactElement;
}> = [
  { href: "/sandbox",            key: "sandbox",            label: "Chain Lab", Icon: ChainIcon  },
  { href: "/stem-splitter",      key: "stem-splitter",      label: "Stem Rip",  Icon: SplitIcon  },
  { href: "/vocal-diagnostics",  key: "vocal-diagnostics",  label: "Vibe Check",Icon: TuneIcon   },
  { href: "/mix-room",           key: "mix-room",           label: "Collision Check", Icon: ChainIcon  },
  { href: "/level-lab",          key: "level-lab",          label: "E-Val",     Icon: PulseIcon  },
  { href: "/vault",              key: "vault",              label: "Vault",     Icon: VaultIcon  },
];


export function MobileTabBar({ activePage }: MobileTabBarProps) {
  return (
    <nav className={styles.mobileTabBar} aria-label="Studio tools">
      {tabs.map(({ href, key, label, Icon }) => (
        <Link
          key={key}
          href={href}
          className={`${styles.mobileTab} ${
            activePage === key ? styles.mobileTabActive : ""
          }`}
          aria-current={activePage === key ? "page" : undefined}
        >
          <Icon className={styles.mobileTabIcon} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
