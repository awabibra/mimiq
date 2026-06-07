"use client";

import { useCallback, useState } from "react";
import { eras } from "@/lib/eras";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import {
  PageTransition,
  usePageTransition,
} from "@/components/PageTransition";
import styles from "./page.module.css";

/* ── Constants ── */

const DAWS = ["Logic Pro", "FL Studio", "Ableton Live", "Pro Tools"] as const;
type Daw = (typeof DAWS)[number];

const MICS = [
  { 
    id: "Condenser", 
    name: "Condenser", 
    desc: "Crisp and detailed. Ideal for treated studio rooms.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="2" width="8" height="14" rx="4" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="16" y2="10" />
        <path d="M12 16v6M8 22h8" />
      </svg>
    )
  },
  { 
    id: "Dynamic", 
    name: "Dynamic", 
    desc: "Warm and focused. Best for rejecting background noise.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
        <line x1="8" x2="16" y1="22" y2="22" />
      </svg>
    )
  },
  { 
    id: "Other", 
    name: "USB / Built-in", 
    desc: "Plug-and-play setups and standard computer mics.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    )
  },
] as const;
type Mic = (typeof MICS)[number]["id"];

const PLUGINS = [
  { id: "waves-ess", name: "Waves Essential" },
  { id: "waves-ult", name: "Waves Ultimate" },
  { id: "antares", name: "Antares Auto-Tune" },
  { id: "soundtoys", name: "Soundtoys 5" },
  { id: "fabfilter", name: "FabFilter Total" },
  { id: "slate", name: "Slate Digital" },
  { id: "uad", name: "Universal Audio" },
  { id: "plugin-alliance", name: "Plugin Alliance" },
] as const;

/* ── Inner component (needs PageTransition context) ── */

function OnboardingFlow() {
  const { navigateTo } = usePageTransition();
  const { setDaw, setMic, setPlugins, setEra } = useStore();

  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState<"visible" | "exiting" | "entering">("visible");
  
  const [selectedDaw, setSelectedDaw] = useState<Daw | null>(null);
  const [selectedMic, setSelectedMic] = useState<Mic | null>(null);
  
  // Plugins step state
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchedPlugins, setSearchedPlugins] = useState<string[]>([]);
  
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

  /* ── Mic selection ── */
  const handleMicSelect = useCallback(
    (mic: Mic) => {
      setSelectedMic(mic);
      setTimeout(() => advanceStep(3), 260);
    },
    [advanceStep]
  );

  /* ── Plugins Selection ── */
  const togglePackage = useCallback((pkgId: string) => {
    setSelectedPackages((prev) =>
      prev.includes(pkgId) ? prev.filter((id) => id !== pkgId) : [...prev, pkgId]
    );
  }, []);

  const handleAddSearchPlugin = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim() !== "") {
      const newPlugin = searchQuery.trim();
      if (!searchedPlugins.includes(newPlugin)) {
        setSearchedPlugins((prev) => [...prev, newPlugin]);
      }
      setSearchQuery("");
    }
  }, [searchQuery, searchedPlugins]);

  const removeSearchPlugin = useCallback((plugin: string) => {
    setSearchedPlugins((prev) => prev.filter((p) => p !== plugin));
  }, []);

  const handlePluginsContinue = useCallback(() => {
    advanceStep(4);
  }, [advanceStep]);

  const handlePluginsSkip = useCallback(() => {
    setSelectedPackages([]);
    setSearchedPlugins([]);
    advanceStep(4);
  }, [advanceStep]);

  /* ── Era selection — live-swap the CSS accent ── */
  const handleEraSelect = useCallback((eraId: string) => {
    setSelectedEra(eraId);
    const era = eras.find((e) => e.id === eraId);
    if (era) {
      document.documentElement.style.setProperty("--accent", era.accent);
    }
  }, []);

  /* ── Save & navigate (uses PageTransition exit) ── */
  const handleGo = useCallback(async () => {
    if (!selectedDaw || !selectedMic || !selectedEra || saving) return;
    setSaving(true);

    // Save to global Zustand store for instantaneous Sandbox reading
    const allPlugins = [...selectedPackages, ...searchedPlugins];
    setDaw(selectedDaw);
    setMic(selectedMic);
    setPlugins(allPlugins);
    setEra(selectedEra);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        await supabase
          .from("users")
          .update({ 
            daw: selectedDaw, 
            mic: selectedMic, 
            era: selectedEra,
            plugins: allPlugins // assuming schema supports or fails silently
          })
          .eq("id", user.id);
      }
    } catch {
      // Silently continue — don't block the user
    }

    sessionStorage.setItem("mimiq-from-onboarding", "1");
    navigateTo("/sandbox");
  }, [selectedDaw, selectedMic, selectedPackages, searchedPlugins, selectedEra, saving, navigateTo, setDaw, setMic, setPlugins, setEra]);

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
        {[1, 2, 3, 4].map((i, index) => (
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
          ) : step === 2 ? (
            /* ── Step 2: Mic ── */
            <>
              <h1 className={styles.question}>What mic are you using?</h1>
              <p className={styles.subtext}>
                We&apos;ll tune the dynamics to your microphone type.
              </p>
              <div className={styles.micGrid}>
                {MICS.map((mic) => (
                  <button
                    key={mic.id}
                    type="button"
                    className={`${styles.micCard} ${
                      selectedMic === mic.id ? styles.micCardSelected : ""
                    }`}
                    onClick={() => handleMicSelect(mic.id)}
                  >
                    <div className={styles.micIcon}>{mic.icon}</div>
                    <span className={styles.micName}>{mic.name}</span>
                    <span className={styles.micDesc}>{mic.desc}</span>
                  </button>
                ))}
              </div>
            </>
          ) : step === 3 ? (
            /* ── Step 3: Plugins ── */
            <>
              <h1 className={styles.question}>What plugins do you own?</h1>
              <p className={styles.subtext}>
                We&apos;ll only use tools you actually have installed.
              </p>
              
              <div className={styles.pluginSearchWrapper}>
                <input
                  type="text"
                  placeholder="Looking for a specific plugin? Press Enter..."
                  className={styles.pluginSearchInput}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleAddSearchPlugin}
                />
                {searchedPlugins.length > 0 && (
                  <div className={styles.pluginTags}>
                    {searchedPlugins.map((plugin) => (
                      <span key={plugin} className={styles.pluginTag}>
                        {plugin}
                        <button onClick={() => removeSearchPlugin(plugin)} className={styles.pluginTagRemove}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.pluginGrid}>
                {PLUGINS.map((plugin) => {
                  const isSelected = selectedPackages.includes(plugin.id);
                  return (
                    <button
                      key={plugin.id}
                      type="button"
                      className={`${styles.pluginCard} ${isSelected ? styles.pluginCardSelected : ""}`}
                      onClick={() => togglePackage(plugin.id)}
                    >
                      <span className={styles.pluginName}>{plugin.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.pluginActions}>
                <button
                  type="button"
                  className={styles.pluginSkipButton}
                  onClick={handlePluginsSkip}
                >
                  I only use stock plugins
                </button>
                <button
                  type="button"
                  className={`${styles.goButton} ${
                    (selectedPackages.length > 0 || searchedPlugins.length > 0)
                      ? styles.goButtonVisible
                      : styles.goButtonHidden
                  }`}
                  onClick={handlePluginsContinue}
                >
                  Continue
                </button>
              </div>
            </>
          ) : (
            /* ── Step 4: Era ── */
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
                {saving ? "Saving\u2026" : "Start creating"}
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
