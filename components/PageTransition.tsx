"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./PageTransition.module.css";

/* ── Context ── */

interface PageTransitionContextValue {
  /** Animate the page out, then navigate to `href`. */
  navigateTo: (href: string) => void;
}

const PageTransitionContext = createContext<PageTransitionContextValue>({
  navigateTo: () => {},
});

/**
 * Hook for any descendant component to trigger a page exit transition.
 *
 * ```tsx
 * const { navigateTo } = usePageTransition();
 * navigateTo("/onboarding");
 * ```
 */
export function usePageTransition() {
  return useContext(PageTransitionContext);
}

/* ── Wrapper ── */

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Wrap every page's content with this component.
 *
 * - On mount: content fades in from below (300ms ease-out).
 * - On `navigateTo`: content fades out upward (250ms ease-out), then navigates.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const navigateTo = useCallback(
    (href: string) => {
      router.prefetch(href);

      const el = ref.current;
      if (el) {
        el.style.transition =
          "opacity 320ms cubic-bezier(0.16, 1, 0.3, 1), transform 320ms cubic-bezier(0.16, 1, 0.3, 1)";
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px)";
      }

      setTimeout(() => {
        router.push(href);
      }, 320);
    },
    [router]
  );

  return (
    <PageTransitionContext.Provider value={{ navigateTo }}>
      <div ref={ref} className={styles.wrapper}>
        {children}
      </div>
    </PageTransitionContext.Provider>
  );
}
