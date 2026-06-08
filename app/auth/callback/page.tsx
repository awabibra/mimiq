"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

const safeNext = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/projects";
  }

  return value;
};

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Securing session");

  useEffect(() => {
    let live = true;

    async function finish() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const next = safeNext(url.searchParams.get("next"));

      if (!code) {
        const { data } = await supabase.auth.getSession();

        if (data.session) {
          router.replace(next);
          return;
        }

        if (live) setMsg("Missing auth code.");
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        if (live) setMsg(error.message);
        return;
      }

      router.replace(next);
    }

    finish();

    return () => {
      live = false;
    };
  }, [router]);

  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <span>MimiQ</span>
        <p>{msg}</p>
      </div>
    </main>
  );
}
