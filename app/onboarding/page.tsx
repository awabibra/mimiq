"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { getAuthSession } from "@/lib/auth";
import { useStore } from "@/lib/store";
import type { PluginBundleId, SupportedDaw } from "@/lib/types";
import {
  getUserProfile,
  isOnboardingComplete,
  PLUGIN_BUNDLES,
  saveUserOnboarding,
  SUPPORTED_DAWS,
} from "@/lib/userProfile";
import styles from "./page.module.css";

const authPath = "/auth?mode=signup&next=%2Fonboarding";

function DawMark({ name }: { name: SupportedDaw }) {
  const initials =
    name === "Logic Pro"
      ? "LP"
      : name === "FL Studio"
        ? "FL"
        : name === "Ableton Live"
          ? "AL"
          : "PT";

  return <span className={styles.dawMark}>{initials}</span>;
}

export default function OnboardingPage() {
  const router = useRouter();
  const hydrateStudioProfile = useStore(
    (state) => state.hydrateStudioProfile
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDaw, setSelectedDaw] = useState<SupportedDaw | null>(null);
  const [selectedPlugins, setSelectedPlugins] = useState<PluginBundleId[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      const auth = await getAuthSession();
      if (!alive) return;

      if (!auth) {
        router.replace(authPath);
        return;
      }

      try {
        const profile = await getUserProfile(auth.user.id);
        if (!alive) return;

        if (isOnboardingComplete(profile) && profile?.daw) {
          hydrateStudioProfile(profile.daw, profile.plugins);
          router.replace("/projects");
          return;
        }

        setUserId(auth.user.id);
      } catch (loadError) {
        setUserId(auth.user.id);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Your studio setup could not be loaded."
        );
      }

      if (alive) setReady(true);
    }

    void load();

    return () => {
      alive = false;
    };
  }, [hydrateStudioProfile, router]);

  const togglePlugin = (plugin: PluginBundleId) => {
    setError(null);
    setSelectedPlugins((current) => {
      if (current.includes(plugin)) {
        return current.filter((entry) => entry !== plugin);
      }

      if (plugin === "waves_gold") {
        return [
          ...current.filter((entry) => entry !== "waves_ultimate"),
          plugin,
        ];
      }

      if (plugin === "waves_ultimate") {
        return [
          ...current.filter((entry) => entry !== "waves_gold"),
          plugin,
        ];
      }

      return [...current, plugin];
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !selectedDaw || busy) return;

    setBusy(true);
    setError(null);

    try {
      const profile = await saveUserOnboarding({
        userId,
        daw: selectedDaw,
        plugins: selectedPlugins,
      });

      if (!profile.daw) {
        throw new Error("Choose your DAW before continuing.");
      }

      hydrateStudioProfile(profile.daw, profile.plugins);
      router.replace("/projects");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your studio setup could not be saved. Try again."
      );
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <main className={styles.loading}>
        <Logo className={styles.loadingLogo} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.noise} aria-hidden="true" />

      <header className={styles.header}>
        <Logo className={styles.logo} />
        <div className={styles.stepReadout}>
          <span>Studio setup</span>
          <strong>01 / 01</strong>
        </div>
      </header>

      <form className={styles.workspace} onSubmit={submit}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}>Personalize your instructions</span>
          <h1>Build around what you already own.</h1>
          <p>
            MimiQ will name the controls inside your DAW and prioritize the
            plugin bundles available in your studio.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="daw-title">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.sectionNumber}>01</span>
              <h2 id="daw-title">Which DAW do you work in?</h2>
            </div>
            <span className={styles.required}>Required</span>
          </div>

          <div className={styles.dawGrid}>
            {SUPPORTED_DAWS.map((daw, index) => (
              <button
                key={daw}
                type="button"
                className={`${styles.dawCard} ${
                  selectedDaw === daw ? styles.selected : ""
                }`}
                style={{ "--delay": `${index * 55}ms` } as React.CSSProperties}
                onClick={() => {
                  setSelectedDaw(daw);
                  setError(null);
                }}
                aria-pressed={selectedDaw === daw}
              >
                <DawMark name={daw} />
                <span>{daw}</span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="plugins-title">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.sectionNumber}>02</span>
              <h2 id="plugins-title">Which plugins do you own?</h2>
            </div>
            <span className={styles.optional}>Optional</span>
          </div>

          <div className={styles.stockStrip}>
            <span className={styles.stockPulse} aria-hidden="true" />
            <div>
              <strong>
                {selectedDaw ? `${selectedDaw} stock plugins` : "DAW stock plugins"}
              </strong>
              <span>Included automatically</span>
            </div>
          </div>

          <div className={styles.pluginGrid}>
            {PLUGIN_BUNDLES.map((plugin, index) => {
              const selected = selectedPlugins.includes(plugin.id);
              return (
                <button
                  key={plugin.id}
                  type="button"
                  className={`${styles.pluginCard} ${
                    selected ? styles.selected : ""
                  }`}
                  style={{
                    "--delay": `${220 + index * 45}ms`,
                  } as React.CSSProperties}
                  onClick={() => togglePlugin(plugin.id)}
                  aria-pressed={selected}
                >
                  <span className={styles.pluginCheck} aria-hidden="true">
                    {selected ? "✓" : "+"}
                  </span>
                  <span>
                    <strong>{plugin.label}</strong>
                    <em>{plugin.detail}</em>
                  </span>
                </button>
              );
            })}
          </div>

          <p className={styles.stockNote}>
            No paid plugins? Leave this empty. Your chain will use stock tools.
          </p>
        </section>

        <footer className={styles.footer}>
          <div className={styles.selectionSummary} aria-live="polite">
            <span>Current setup</span>
            <strong>
              {selectedDaw ?? "Choose a DAW"} · {selectedPlugins.length || "Stock"}
              {selectedPlugins.length === 1 ? " bundle" : selectedPlugins.length > 1 ? " bundles" : " plugins"}
            </strong>
          </div>

          <div className={styles.submitArea}>
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="submit"
              className={styles.submit}
              disabled={!selectedDaw || busy}
            >
              <span>{busy ? "Saving setup" : "Set up MimiQ"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </footer>
      </form>
    </main>
  );
}
