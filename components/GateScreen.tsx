"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./GateScreen.module.css";
import { useAudioStore } from "@/lib/useAudioStore";

export default function GateScreen({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mounted, setMounted] = useState(false);

  const isAnalyzed = useAudioStore((state) => (isHydrated ? state.isAnalyzed : false));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsHydrated(true);
      setMounted(true);
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  const handleGoToSandbox = () => {
    setIsNavigating(true);
    setTimeout(() => {
      router.push("/sandbox");
    }, 150);
  };

  // Wait for hydration to avoid mismatch
  if (!isHydrated) return null;

  // If already analyzed, render the actual page content
  if (isAnalyzed) {
    return (
      <div
        style={{
          opacity: isNavigating ? 0 : 1,
          transition: "opacity 150ms ease-out",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          height: "100%",
        }}
      >
        {children}
      </div>
    );
  }

  // Otherwise, render the GateScreen
  return (
    <div
      className={`${styles.container} ${mounted ? styles.mounted : ""} ${
        isNavigating ? styles.exiting : ""
      }`}
    >
      <div className={styles.content}>
        <div className={styles.iconContainer}>
          <div className={styles.outerCircle} />
          <div className={styles.innerDot} />
        </div>

        <h1 className={styles.heading}>Start in Sandbox</h1>
        
        <p className={styles.bodyText}>
          Upload your vocal once and it&apos;ll be available across all rooms.
        </p>

        <button className={styles.button} onClick={handleGoToSandbox}>
          Go to Sandbox &rarr;
        </button>
      </div>
    </div>
  );
}
