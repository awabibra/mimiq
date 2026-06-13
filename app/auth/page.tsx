"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/ui/logo";
import styles from "./page.module.css";

type Mode = "signin" | "signup";

const safeMode = (value: string | null): Mode => {
  return value === "signup" ? "signup" : "signin";
};

const safeNext = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/projects";
  }

  return value;
};

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const nextPath = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return safeNext(params.get("next"));
  }, []);

  const callbackUrl = useCallback(() => {
    const next = encodeURIComponent(nextPath());
    return `${window.location.origin}/auth/callback?next=${next}`;
  }, [nextPath]);

  const cameFromOnboarding = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return safeMode(params.get("mode")) === "signup";
  }, []);

  useEffect(() => {
    let live = true;

    getAuthSession().then((auth) => {
      if (!live) return;

      if (auth) {
        router.replace(nextPath());
        return;
      }

      const params = new URLSearchParams(window.location.search);
      setMode(safeMode(params.get("mode")));
      setReady(true);
    });

    return () => {
      live = false;
    };
  }, [nextPath, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email || !pass || busy) {
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: pass,
        });

        if (error) throw error;

        router.replace(nextPath());
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          emailRedirectTo: callbackUrl(),
        },
      });

      if (error) throw error;

      if (data.session) {
        router.replace(nextPath());
        return;
      }

      setMsg("Check your email to finish sign up.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const continueGoogle = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setMsg(null);

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
      setMsg(error.message);
      setBusy(false);
    }
  };

  if (!ready) {
    return <main className={styles.page} />;
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-label="mimiq authentication">
        <div className={styles.context}>
          <div className={styles.brand}>
            <Logo className={styles.mark} />
            <span className={styles.rule} />
          </div>

          <div className={styles.readout}>
            <span>Project window</span>
            <strong>Persist your vocal chain, analysis history, and project state.</strong>
          </div>

          <div className={styles.meta}>
            <span>Auth</span>
            <span>Supabase</span>
          </div>
        </div>

        <div className={styles.formWrap}>
          <div className={styles.head}>
            <h1>{mode === "signin" ? "Sign in" : "Sign up"}</h1>
            <div className={styles.switcher} aria-label="Authentication mode">
              <button
                type="button"
                className={mode === "signin" ? styles.active : ""}
                onClick={() => setMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? styles.active : ""}
                onClick={() => {
                  if (cameFromOnboarding()) {
                    setMode("signup");
                    return;
                  }

                  router.push("/onboarding");
                }}
              >
                Sign up
              </button>
            </div>
          </div>

          <button
            type="button"
            className={styles.google}
            onClick={continueGoogle}
            disabled={busy}
          >
            <span>G</span>
            Continue with Google
          </button>

          <div className={styles.cut}>
            <span />
            <em>Email</em>
            <span />
          </div>

          <form className={styles.form} onSubmit={submit}>
            <label className={styles.field}>
              <span>Email address</span>
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

            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? "Working" : mode === "signin" ? "Enter projects" : "Create account"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
