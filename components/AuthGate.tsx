"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import styles from "./AuthGate.module.css";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

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
  }, [router]);

  if (!ok) {
    return <div className={styles.screen}>Checking session</div>;
  }

  return children;
}
