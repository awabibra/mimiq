"use client";

import { useCallback } from "react";
import { usePageTransition } from "./PageTransition";

interface CTALinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Anchor that triggers the PageTransition exit animation before navigating.
 * Must be rendered inside a <PageTransition> wrapper.
 */
export function CTALink({ href, className, children }: CTALinkProps) {
  const { navigateTo } = usePageTransition();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      navigateTo(href);
    },
    [href, navigateTo]
  );

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
