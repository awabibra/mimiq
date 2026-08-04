"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { ENTRY_AUTH_HANDOFF_KEY } from "@/lib/entryHandoff";
import { useStore } from "@/lib/store";
import {
  getUserProfile,
  isOnboardingComplete,
} from "@/lib/userProfile";
import styles from "./AuthGate.module.css";

interface AuthGateProps {
  children: ReactNode;
  allowEntryHandoff?: boolean;
}

export function AuthGate({ children, allowEntryHandoff = false }: AuthGateProps) {
  const router = useRouter();
  const [usedEntryHandoff] = useState(() => {
    if (!allowEntryHandoff || typeof window === "undefined") return false;
    return window.sessionStorage.getItem(ENTRY_AUTH_HANDOFF_KEY) === "1";
  });
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    if (usedEntryHandoff) {
      window.sessionStorage.removeItem(ENTRY_AUTH_HANDOFF_KEY);
    }

    async function authenticate() {
      const auth = await getAuthSession();
      if (!alive) return;

      if (!auth) {
        router.replace("/auth?mode=signin&next=%2Fprojects");
        return;
      }

      try {
        const profile = await getUserProfile(auth.user.id);
        if (!alive) return;

        if (!isOnboardingComplete(profile) || !profile?.daw) {
          router.replace("/onboarding");
          return;
        }

        useStore.getState().hydrateStudioProfile(profile.daw, profile.plugins);
        setOk(true);
      } catch {
        router.replace("/onboarding");
      }
    }

    void authenticate();

    return () => {
      alive = false;
    };
  }, [router, usedEntryHandoff]);

  if (!ok) {
    return (
      <div className={styles.screen}>
        {usedEntryHandoff ? null : "Checking session"}
      </div>
    );
  }

  return children;
}
