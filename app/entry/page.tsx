"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listProjects } from "@/lib/projects";
import { supabase } from "@/lib/supabase";
import {
  ENTRY_AUTH_HANDOFF_KEY,
  ENTRY_VISUAL_HANDOFF_KEY,
  writeEntryProjectsCache,
} from "@/lib/entryHandoff";
import styles from "./page.module.css";

const CINEMATIC_DURATION_MS = 8_180;

function EntryTransitionOverlay() {
  return (
    <div className={styles.cinematicOverlay}>
      <div className={styles.cinematicContent}>
        <div className={styles.cinematicTextContainer}>
          <span className={styles.cinematicTextMain}>
            creat
            <span className={styles.cinematicLetterE}>e</span>
            <span className={styles.cinematicLetterIng}>ing</span>
            {" what you thought isnt possible"}
          </span>
          <span className={styles.cinematicTextDot}>.</span>
        </div>
        <div className={styles.cinematicLoadingBarContainer}>
          <div className={styles.cinematicLoadingBarFill} />
        </div>
      </div>
    </div>
  );
}

export default function EntryPage() {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  const [transitionComplete, setTransitionComplete] = useState(false);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;

      const hasSession = Boolean(data.session);
      const nextDestination = hasSession ? "/projects" : "/onboarding";
      router.prefetch(nextDestination);
      setDestination(nextDestination);

      if (!hasSession) return;

      try {
        const projects = await listProjects();
        if (alive) writeEntryProjectsCache(projects);
      } catch {
        // Projects can still load normally after the transition if warming fails.
      }
    });

    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTransitionComplete(true);
    }, CINEMATIC_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!destination || !transitionComplete) return;
    if (destination === "/projects") {
      window.sessionStorage.setItem(ENTRY_AUTH_HANDOFF_KEY, "1");
      window.sessionStorage.setItem(ENTRY_VISUAL_HANDOFF_KEY, "1");
    }
    router.replace(destination);
  }, [destination, router, transitionComplete]);

  return (
    <main className={styles.layout} aria-label="Entering MimiQ">
      <EntryTransitionOverlay />
    </main>
  );
}
