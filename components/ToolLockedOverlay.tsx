"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import styles from "./ToolLockedOverlay.module.css";

interface ToolLockedOverlayProps {
  locked: boolean;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  momentKey?: string | null;
  dockDelayMs?: number;
}

export function ToolLockedOverlay({
  locked,
  children,
  className,
  action,
  momentKey,
  dockDelayMs = 2600,
}: ToolLockedOverlayProps) {
  const storageKey = momentKey ? `mimiq-upload-moment:${momentKey}` : null;
  const [docked, setDocked] = useState(
    () =>
      Boolean(
        storageKey &&
          typeof window !== "undefined" &&
          window.localStorage.getItem(storageKey) === "docked"
      )
  );

  useEffect(() => {
    if (!locked || docked || typeof window === "undefined") return;

    const timer = window.setTimeout(() => {
      setDocked(true);
      if (storageKey) {
        window.localStorage.setItem(storageKey, "docked");
      }
    }, dockDelayMs);

    return () => window.clearTimeout(timer);
  }, [dockDelayMs, docked, locked, storageKey]);

  return (
    <div
      className={`${styles.frame} ${locked ? styles.frameLocked : ""} ${
        className ?? ""
      }`}
    >
      {children}
      {locked && (
        <div
          className={`${styles.overlay} ${docked ? styles.overlayDocked : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className={`${styles.panel} ${docked ? styles.panelDocked : styles.panelIntro}`}>
            <span className={styles.pill}>Project audio required</span>
            <strong>Upload in the sidebar to unlock</strong>
            <p>
              The room is ready behind this card. Add audio to the project via the sidebar, then mimiq can use it here and in every other tool.
            </p>
            {action && <div className={styles.action}>{action}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
