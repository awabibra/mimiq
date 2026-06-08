"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";

export function AuthListener() {
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        useAuth.getState().setAuth(session);
        return;
      }

      if (event === "SIGNED_OUT") {
        useAuth.getState().clearAuth();
        return;
      }

      useAuth.getState().setLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
