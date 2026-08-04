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

interface PageTransitionContextValue {
  navigateTo: (href: string) => void;
}

const PageTransitionContext = createContext<PageTransitionContextValue>({
  navigateTo: () => {},
});

export function usePageTransition() {
  return useContext(PageTransitionContext);
}

interface PageTransitionProps {
  children: ReactNode;
}

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
