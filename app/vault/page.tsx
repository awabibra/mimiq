"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { defaultEra, type Era, getEraById } from "@/lib/eras";
import type { GeneratedChain } from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ProjectGate } from "@/components/ProjectGate";
import { isGeneratedChain, useProject } from "@/lib/useProject";
import styles from "./page.module.css";

/* ═══════════════════════════════════════════════════════════════
   Inline SVG icons
   ═══════════════════════════════════════════════════════════════ */

function ChainLinkIcon({ className }: { className?: string }) {
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="8" x2="13" y2="8" />
      <polyline points="9,4 13,8 9,12" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8v5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8" />
      <polyline points="4.5,5 8,1.5 11.5,5" />
      <line x1="8" y1="1.5" x2="8" y2="10" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

/** Format ISO date string to "Jun 3" style */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Build the first-step summary line: "Tool — Action" */
function firstStepSummary(chain: GeneratedChain): string {
  const steps = chain.chain_data.chain;
  if (!steps || steps.length === 0) return "No steps";
  const step = steps[0];
  return `${step.tool} — ${step.action}`;
}

/* ═══════════════════════════════════════════════════════════════
   Page component
   ═══════════════════════════════════════════════════════════════ */

export default function VaultPage() {
  const router = useRouter();
  const project = useProject((state) => state.project);

  /* ── State ── */
  const chains = project?.generated_chains.filter(isGeneratedChain) ?? [];
  const loading = false;
  const [activeEra, setActiveEra] = useState<Era>(defaultEra);
  const [toast, setToast] = useState<string | null>(null);

  /* ── Era switching updates CSS variable ── */
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", activeEra.accent);
  }, [activeEra]);

  /* ── Handle era change ── */
  const handleEraChange = useCallback((era: Era) => {
    setActiveEra(era);
  }, []);

  /* ── Show toast helper ── */
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  /* ── Share handler ── */
  const handleShare = useCallback(
    async (e: React.MouseEvent, chain: GeneratedChain) => {
      e.stopPropagation(); /* Don't trigger card click */
      const shareUrl = `https://mimiq.app/chain/${chain.id}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Link copied");
      } catch {
        showToast("Couldn't copy link");
      }
    },
    [showToast]
  );

  /* ── Open handler (navigate to sandbox with chain context) ── */
  const handleOpen = useCallback(
    (e: React.MouseEvent, chain: GeneratedChain) => {
      e.stopPropagation();
      router.push(`/sandbox?chainId=${chain.id}`);
    },
    [router]
  );

  /* ── Card click (same as Open) ── */
  const handleCardClick = useCallback(
    (chain: GeneratedChain) => {
      router.push(`/sandbox?chainId=${chain.id}`);
    },
    [router]
  );

  /* ── Resolve era for a chain ── */
  const getChainEra = (chain: GeneratedChain): Era => {
    return getEraById(chain.genre) ?? defaultEra;
  };

  /* ═══════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════ */

  return (
    <ProjectGate>
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <Sidebar
        activePage="vault"
        activeEra={activeEra}
        onEraChange={handleEraChange}
        savedCount={chains.length}
      />

      {/* ── Main content ── */}
      <main className={styles.main}>
        {/* Header row */}
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>Your chains</h1>
          {!loading && chains.length > 0 && (
            <span className={styles.headerBadge}>
              {chains.length} saved
            </span>
          )}
        </div>

        {/* ── Loading state ── */}
        {loading && (
          <div className={styles.loadingGrid}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={styles.skeletonCard}>
                <div className={styles.skeletonLineShort} />
                <div className={styles.skeletonLineFull} />
                <div className={styles.skeletonLineMedium} />
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && chains.length === 0 && (
          <div className={styles.emptyState}>
            <ChainLinkIcon className={styles.emptyIcon} />
            <span className={styles.emptyTitle}>No chains saved yet</span>
            <span className={styles.emptySub}>
              Analyze a vocal in the Sandbox and save your chain.
            </span>
            <Link href="/sandbox" className={styles.emptyBtn}>
              Go to Sandbox
            </Link>
          </div>
        )}

        {/* ── Chain card grid ── */}
        {!loading && chains.length > 0 && (
          <div className={styles.grid}>
            {chains.map((chain) => {
              const era = getChainEra(chain);
              return (
                <div
                  key={chain.id}
                  className={styles.card}
                  onClick={() => handleCardClick(chain)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCardClick(chain);
                  }}
                >
                  {/* Top row: era pill + date */}
                  <div className={styles.cardTop}>
                    <span
                      className={styles.eraPill}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${era.accent} 12%, transparent)`,
                        color: era.accent,
                      }}
                    >
                      {era.name}
                    </span>
                    <div className={styles.cardTopMeta}>
                      {chain.chain_data.validated && (
                        <span className={styles.validatedBadge} title="Validated chain">
                          ✓
                        </span>
                      )}
                      <span className={styles.cardDate}>
                        {formatDate(chain.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Step summary */}
                  <span className={styles.cardStepSummary}>
                    {firstStepSummary(chain)}
                  </span>

                  {/* Analysis summary */}
                  <span className={styles.cardAnalysis}>
                    {chain.chain_data.summary || "No summary available"}
                  </span>

                  {/* Bottom row: XY mini + icon buttons */}
                  <div className={styles.cardBottom}>
                    {/* XY mini-display */}
                    <div className={styles.xyMini}>
                      <div
                        className={styles.xyMiniDot}
                        style={{
                          left: `${(chain.chain_data.xyPosition?.x ?? 0.5) * 100}%`,
                          top: `${(1 - (chain.chain_data.xyPosition?.y ?? 0.5)) * 100}%`,
                          backgroundColor: era.accent,
                        }}
                      />
                    </div>

                    {/* Icon buttons */}
                    <div className={styles.cardActions}>
                      <button
                        className={styles.iconBtn}
                        onClick={(e) => handleOpen(e, chain)}
                        aria-label="Open chain in Sandbox"
                        title="Open"
                      >
                        <ArrowRightIcon className={styles.iconBtnSvg} />
                      </button>
                      <button
                        className={styles.iconBtn}
                        onClick={(e) => handleShare(e, chain)}
                        aria-label="Share chain"
                        title="Share"
                      >
                        <ShareIcon className={styles.iconBtnSvg} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Mobile tab bar ── */}
      <MobileTabBar activePage="vault" />

      {/* ── Toast ── */}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
    </ProjectGate>
  );
}
