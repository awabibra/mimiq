"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import styles from "./NoDetachedTools.module.css";

interface NoDetachedToolsProps {
  startHref: string;
}

export function NoDetachedTools({ startHref }: NoDetachedToolsProps) {
  return (
    <section className={styles.section}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
        className={styles.inner}
      >
        <span className={styles.eyebrow}>No Detached Tools.</span>

        <h2 className={styles.statement}>
          Your workflow.{" "}
          <br className={styles.brTablet} />
          Your context.{" "}
          <br className={styles.brTablet} />
          Your project.
        </h2>

        <p className={styles.sub}>All in one studio environment.</p>

        <Link href={startHref} className={styles.cta} id="ndt-enter-studio">
          <span>Enter Studio</span>
          <ArrowRight className={styles.ctaIcon} strokeWidth={2} />
        </Link>
      </motion.div>
    </section>
  );
}
