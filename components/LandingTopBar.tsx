"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthModal } from "@/components/AuthModal";
import styles from "./LandingTopBar.module.css";

export function LandingTopBar() {
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
      <header className={styles.bar}>
        <span className={styles.wordmark}>MimiQ</span>
        <button
          type="button"
          className={styles.signIn}
          onClick={() => setAuthOpen(true)}
        >
          Sign in
        </button>
      </header>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={() => {
          setAuthOpen(false);
          router.push("/projects");
        }}
        initialMode="signin"
        title="Sign in"
        text="Return to your projects, saved chains, and session history."
        nextPath="/projects"
      />
    </>
  );
}
