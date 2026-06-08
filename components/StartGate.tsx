"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

export function StartGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    getAuthSession().then((auth) => {
      if (!alive) return;

      if (auth) {
        router.replace("/projects");
        return;
      }

      setReady(true);
    });

    return () => {
      alive = false;
    };
  }, [router]);

  if (!ready) {
    return null;
  }

  return children;
}
