"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo } from "@/components/landing/Logo";
import { DemoPanel } from "@/components/landing/DemoPanel";
import { ToolStories } from "@/components/landing/ToolStories";
import styles from "./page.module.css";

const signInHref = "/auth?mode=signin&next=%2Fprojects";
const startHref  = "/onboarding";

export default function Home() {
  return (
    <main className={styles.root}>

      {/* ── Fixed chrome ───────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className={styles.chrome}
      >
        <Link href="/" className={styles.logoLink} aria-label="mimiq home">
          <Logo variant="nav" />
        </Link>
        <Link href={signInHref} className={styles.signIn} id="nav-sign-in">
          Sign in
        </Link>
      </motion.div>

      {/* ── Hero — first viewport ───────────────────── */}
      <section className={styles.hero} aria-label="mimiq studio">
        <div className={styles.copy}>
          <motion.h1
            className={styles.headline}
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            Your vocal.
            <br />
            Your measured chain.
          </motion.h1>

          <motion.p
            className={styles.sub}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.44 }}
          >
            Upload your raw vocal. mimiq measures it, then maps a
            focused mixing path — step by step, for your DAW.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.62 }}
            className={styles.ctaGroup}
          >
            <Link href={startHref} className={styles.cta} id="hero-cta">
              Analyse your vocal free
            </Link>
            <span className={styles.ctaNote}>3 free analyses. No credit card.</span>
          </motion.div>
        </div>

        <motion.div
          className={styles.demoWrap}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <DemoPanel />
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          className={styles.scrollHint}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          aria-hidden
        >
          <span className={styles.scrollLine} />
        </motion.div>
      </section>

      {/* ── Tool storytelling sections ──────────────── */}
      <ToolStories startHref={startHref} />

    </main>
  );
}
