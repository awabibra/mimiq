"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/landing/Logo";
import styles from "./Hero.module.css";

interface HeroProps {
  signInHref: string;
  startHref: string;
}

export function Hero({ signInHref, startHref }: HeroProps) {
  return (
    <section className={styles.hero}>

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={styles.logoWrap}
      >
        <Logo variant="hero" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.44, ease: [0.4, 0, 0.2, 1] }}
        className={styles.headline}
      >
        Build the vocal.
        <br />
        Verify the change.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, delay: 0.58 }}
        className={styles.sub}
      >
        The dark studio workspace for rap vocals.
        <br className={styles.brHide} />
        {" "}Mix chains, reference targets, and E-Val checks — all in one session.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.72 }}
        className={styles.ctaRow}
      >
        <Link href={startHref} className={styles.primaryCta} id="hero-start-cta">
          <span>Start your studio</span>
          <ArrowRight className={styles.ctaIcon} strokeWidth={2} />
        </Link>

        <Link href={signInHref} className={styles.signInLink} id="hero-sign-in">
          Already have an account? Sign in
        </Link>
      </motion.div>
    </section>
  );
}
