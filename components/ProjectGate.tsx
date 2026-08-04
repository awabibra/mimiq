"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import {
  rehydrateActiveProject,
  useProject,
} from "@/lib/useProject";
import { useAuth } from "@/lib/useAuth";
import { useStore } from "@/lib/store";
import {
  getUserProfile,
  isOnboardingComplete,
} from "@/lib/userProfile";
import { Logo } from "@/components/ui/logo";

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
      <Logo className="text-sm font-medium tracking-normal" />
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

    async function authenticateAndRehydrate() {
      const auth = await getAuthSession();
      if (!alive) return;

      if (!auth) {
        clearActiveProject();
        router.replace("/auth?mode=signin&next=%2Fprojects");
        return;
      }

      useAuth.getState().setAuth(auth.session);

      let profile;
      try {
        profile = await getUserProfile(auth.user.id);
      } catch {
        clearActiveProject();
        router.replace("/onboarding");
        return;
      }

      if (!alive) return;

      if (!isOnboardingComplete(profile) || !profile?.daw) {
        clearActiveProject();
        router.replace("/onboarding");
        return;
      }

      useStore.getState().hydrateStudioProfile(profile.daw, profile.plugins);

      try {
        await rehydrateActiveProject();
      } catch {
        clearActiveProject();
      } finally {
        if (alive) setRehydrating(false);
      }
    }

    void authenticateAndRehydrate();

    return () => {
      alive = false;
    };
  }, [clearActiveProject, router]);

  useEffect(() => {
    if (rehydrating || activeProject) return;

    let alive = true;

    getAuthSession().then((auth) => {
      if (!alive) return;

      if (!auth) return;

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
