"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  rehydrateActiveProject,
  useProject,
} from "@/lib/useProject";

function LoadingScreen() {
  return (
    <div
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        background: "var(--bg-base, #050505)",
        color: "var(--text-primary, #f5f5f7)",
      }}
    >
      <span
        style={{
          fontSize: "14px",
          fontWeight: 500,
          letterSpacing: 0,
        }}
      >
        MimiQ
      </span>
    </div>
  );
}

export function ProjectGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const activeProject = useProject((state) => state.project);
  const clearActiveProject = useProject((state) => state.clearActiveProject);
  const setPrompt = useProject((state) => state.setPrompt);
  const [rehydrating, setRehydrating] = useState(true);

  useEffect(() => {
    let alive = true;

    const stored = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    if (!stored) {
      const frame = requestAnimationFrame(() => {
        if (alive) setRehydrating(false);
      });

      return () => {
        alive = false;
        cancelAnimationFrame(frame);
      };
    }

    rehydrateActiveProject()
      .catch(() => {
        clearActiveProject();
      })
      .finally(() => {
        if (alive) setRehydrating(false);
      });

    return () => {
      alive = false;
    };
  }, [clearActiveProject]);

  useEffect(() => {
    if (rehydrating || activeProject) return;

    let alive = true;

    getAuthSession().then((auth) => {
      if (!alive) return;

      if (!auth) {
        router.replace("/");
        return;
      }

      setPrompt("Select or create a project to continue.");
      router.replace("/projects?prompt=select-project");
    });

    return () => {
      alive = false;
    };
  }, [activeProject, rehydrating, router, setPrompt]);

  if (rehydrating || !activeProject) {
    return <LoadingScreen />;
  }

  return children;
}
