"use client";

import { useCallback, useState } from "react";
import { eras } from "@/lib/eras";
import { useStore } from "@/lib/store";
import { createLocalProject, useProject } from "@/lib/useProject";
import {
  PageTransition,
  usePageTransition,
} from "@/components/PageTransition";
import styles from "./page.module.css";

/* ── Constants ── */

const DAWS = ["Logic Pro", "FL Studio", "Ableton Live", "Pro Tools"] as const;
type Daw = (typeof DAWS)[number];


/* ── Inner component (needs PageTransition context) ── */

function OnboardingFlow() {
  const { navigateTo } = usePageTransition();
  const { setDaw, setEra } = useStore();
  const setActiveProject = useProject((state) => state.setActiveProject);

  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState<"visible" | "exiting" | "entering">("visible");

  const [selectedDaw, setSelectedDaw] = useState<Daw | null>(null);
  const [selectedEra, setSelectedEra] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── Step transition ── */
  const advanceStep = useCallback((nextStep: number) => {
    setPhase("exiting");

    setTimeout(() => {
      setStep(nextStep);
      setPhase("entering");
      // Double rAF: let browser paint the "entering" position,
      // then transition to "visible"
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("visible");
        });
      });
    }, 320);
  }, []);

  /* ── DAW selection ── */
  const handleDawSelect = useCallback(
    (daw: Daw) => {
      setSelectedDaw(daw);
      setTimeout(() => advanceStep(2), 260);
    },
    [advanceStep]
  );

  /* ── Era selection — live-swap the CSS accent ── */
  const handleEraSelect = useCallback((eraId: string) => {
    setSelectedEra(eraId);
    const era = eras.find((e) => e.id === eraId);
    if (era) {
      document.documentElement.style.setProperty("--accent", era.accent);
    }
  }, []);

  const goSandbox = useCallback(() => {
    sessionStorage.setItem("mimiq-from-onboarding", "1");
    navigateTo("/sandbox");
  }, [navigateTo]);

  /* ── Save & navigate (uses PageTransition exit) ── */
  const handleGo = useCallback(async () => {
    if (!selectedDaw || !selectedEra || saving) return;
    setSaving(true);

    setDaw(selectedDaw);
    setEra(selectedEra);
    setActiveProject(
      createLocalProject({
        daw: selectedDaw,
        era: selectedEra,
      })
    );
    goSandbox();
  }, [
    selectedDaw,
    selectedEra,
    saving,
    goSandbox,
    setActiveProject,
    setDaw,
    setEra,
  ]);

  /* ── Phase → CSS class ── */
  const phaseClass =
    phase === "exiting"
      ? styles.stepExiting
      : phase === "entering"
        ? styles.stepEntering
        : styles.stepVisible;

  return (
    <div className={styles.wrapper}>
      {/* ── Progress dots ── */}
      <div className={styles.dots}>
        {[1, 2].map((i, index) => (
          <div
            key={i}
            className={`${styles.dot} ${i <= step ? styles.dotActive : ""}`}
            style={{ animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </div>

      {/* ── Step content ── */}
      <div className={styles.stepContainer}>
        <div className={`${styles.step} ${phaseClass}`}>
          {step === 1 ? (
            /* ── Step 1: DAW ── */
            <>
              <h1 className={styles.question}>What do you make music in?</h1>
              <p className={styles.subtext}>
                We&apos;ll format your chain for your specific software.
              </p>
              <div className={styles.dawGrid}>
                {DAWS.map((daw) => (
                  <button
                    key={daw}
                    type="button"
                    className={`${styles.dawCard} ${
                      selectedDaw === daw ? styles.dawCardSelected : ""
                    }`}
                    onClick={() => handleDawSelect(daw)}
                  >
                    <span className={styles.dawName}>{daw}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            /* ── Step 2: Era ── */
            <>
              <h1 className={styles.question}>What&apos;s your mood?</h1>
              <p className={styles.subtext}>
                This shapes the language and approach of your chain.
              </p>
              <div className={styles.eraGrid}>
                {eras.map((era) => {
                  const isSelected = selectedEra === era.id;
                  return (
                    <button
                      key={era.id}
                      type="button"
                      className={`${styles.eraCard} ${
                        isSelected ? styles.eraCardSelected : ""
                      }`}
                      style={{
                        "--card-accent": era.accent,
                      } as React.CSSProperties}
                      onClick={() => handleEraSelect(era.id)}
                    >
                      <span className={styles.eraName}>
                        {era.name}
                        {era.id === "foryou" && (
                          <span className={styles.eraCustomLabel}>(custom)</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={`${styles.goButton} ${
                  selectedEra ? styles.goButtonVisible : styles.goButtonHidden
                }`}
                onClick={handleGo}
                disabled={!selectedEra || saving}
              >
                {saving ? "Starting\u2026" : "Start creating"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Page (wraps with PageTransition) ── */

export default function OnboardingPage() {
  return (
    <PageTransition>
      <OnboardingFlow />
    </PageTransition>
  );
}
