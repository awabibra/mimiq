"use client";

import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ACTIVE_PROJECT_STORAGE_KEY, useProject } from "@/lib/useProject";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  setAuth: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
  signOut: () => Promise<void>;
}

function clearProjectState() {
  useProject.getState().clearActiveProject();

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  }
}

export const useAuth = create<AuthState>()((set) => ({
  user: null,
  session: null,
  loading: true,
  setAuth: (session) =>
    set({
      session,
      user: session?.user ?? null,
      loading: false,
    }),
  setLoading: (loading) => set({ loading }),
  clearAuth: () => {
    clearProjectState();
    set({ user: null, session: null, loading: false });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    clearProjectState();
    set({ user: null, session: null, loading: false });

    if (typeof window !== "undefined") {
      window.location.assign("/auth");
    }
  },
}));
