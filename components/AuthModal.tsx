"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { signIn, signUp } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import styles from "./AuthModal.module.css";

interface AuthModalProps {
  open: boolean;
  onAuthed: (user: User) => void | Promise<void>;
  onClose?: () => void;
  initialMode?: Mode;
  title?: string;
  text?: string;
  subtext?: string;
  nextPath?: string;
  pendingAuthKey?: string;
}

type Mode = "signin" | "signup";

export function AuthModal({
  open,
  onAuthed,
  onClose,
  initialMode = "signin",
  title = "Save this project",
  text = "Sign in or create an account so MimiQ can keep your setup and send you to your projects.",
  subtext,
  nextPath = "/projects",
  pendingAuthKey,
}: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      setMode(initialMode);
      setMsg(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [initialMode, open]);

  useEffect(() => {
    if (!open || !onClose) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) {
    return null;
  }

  const callbackUrl = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  const continueGoogle = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setMsg(null);

    if (pendingAuthKey) {
      sessionStorage.setItem(pendingAuthKey, "1");
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(),
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) {
      if (pendingAuthKey) {
        sessionStorage.removeItem(pendingAuthKey);
      }
      setMsg(error.message);
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email || !pass || busy) {
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const redirectTo = callbackUrl();
      const auth =
        mode === "signin"
          ? await signIn(email, pass)
          : await signUp(email, pass, redirectTo);

      if (auth?.user) {
        await onAuthed(auth.user);
        onClose?.();
        return;
      }

      setMsg("Check your email to finish sign up.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.wrap}
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose && !busy) {
          onClose();
        }
      }}
    >
      <form
        className={styles.panel}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {onClose && (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close authentication"
            disabled={busy}
          >
            x
          </button>
        )}

        <div className={styles.copy}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.text}>{text}</p>
        </div>

        <div className={styles.tabs} aria-label="Authentication mode">
          <button
            type="button"
            className={`${styles.tab} ${mode === "signin" ? styles.active : ""}`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`${styles.tab} ${mode === "signup" ? styles.active : ""}`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <button
          type="button"
          className={styles.google}
          onClick={continueGoogle}
          disabled={busy}
        >
          <span>G</span>
          {mode === "signin" ? "Sign in with Google" : "Sign up with Google"}
        </button>

        <div className={styles.cut}>
          <span />
          <em>Email</em>
          <span />
        </div>

        <label className={styles.field}>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className={styles.field}>
          <span>Password</span>
          <input
            type="password"
            value={pass}
            onChange={(event) => setPass(event.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </label>

        {msg && <p className={styles.msg}>{msg}</p>}

        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? "Working" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>

        {subtext && <p className={styles.subtext}>{subtext}</p>}
      </form>
    </div>
  );
}
