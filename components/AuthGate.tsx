"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { ENTRY_AUTH_HANDOFF_KEY } from "@/lib/entryHandoff";
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
  const [ok, setOk] = useState(() => {
    return usedEntryHandoff;
  });

  useEffect(() => {
    let alive = true;

    if (usedEntryHandoff) {
      window.sessionStorage.removeItem(ENTRY_AUTH_HANDOFF_KEY);
    }

    getAuthSession().then((auth) => {
      if (!alive) return;

      if (!auth) {
        router.replace("/");
        return;
      }

      setOk(true);
    });

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
