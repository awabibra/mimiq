import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface AuthSession {
  session: Session;
  user: User;
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const { data: userData, error } = await supabase.auth.getUser();

  if (error || !userData.user) {
    return null;
  }

  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    return null;
  }

  return {
    session: data.session,
    user: userData.user,
  };
}

export async function signIn(email: string, pass: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });

  if (error) {
    throw error;
  }

  return getAuthSession();
}

export async function signUp(email: string, pass: string, redirectTo: string) {
  const { error } = await supabase.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    throw error;
  }

  return getAuthSession();
}
