import { CTALink } from "@/components/CTALink";
import { LandingTopBar } from "@/components/LandingTopBar";
import { PageTransition } from "@/components/PageTransition";
import { StartGate } from "@/components/StartGate";
import styles from "./page.module.css";
import { eras } from "@/lib/eras";
import { XYPad } from "@/components/XYPad";

/* ── Inline SVG icons (hand-drawn, outline, minimal) ── */

function UploadIcon() {
  return (
    <svg
      className={styles.stepIcon}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="16" y1="22" x2="16" y2="8" />
      <polyline points="10,13 16,7 22,13" />
      <line x1="8" y1="26" x2="24" y2="26" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg
      className={styles.stepIcon}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="16" x2="4" y2="16" />
      <line x1="8" y1="12" x2="8" y2="20" />
      <line x1="12" y1="8" x2="12" y2="24" />
      <line x1="16" y1="5" x2="16" y2="27" />
      <line x1="20" y1="10" x2="20" y2="22" />
      <line x1="24" y1="13" x2="24" y2="19" />
      <line x1="28" y1="15" x2="28" y2="17" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className={styles.stepIcon}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <line x1="13" y1="9" x2="27" y2="9" />
      <circle cx="7" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <line x1="13" y1="16" x2="27" y2="16" />
      <circle cx="7" cy="23" r="1.5" fill="currentColor" stroke="none" />
      <line x1="13" y1="23" x2="27" y2="23" />
    </svg>
  );
}

/* ── Page ── */

export default function Home() {
  return (
    <StartGate>
      <PageTransition>
        <main className={styles.main}>
          <LandingTopBar />

          {/* ═══════════════════════════════════════════
              SECTION 1 — Hero
              ═══════════════════════════════════════════ */}
          <section className={styles.hero}>
            <div className={styles.heroContent}>
              <h1 className={styles.heroHeadline}>
                Your vocal.
                <br />
                Your measured vocal chain.
              </h1>
              <p className={styles.heroSubline}>
                Upload your raw vocal. MimiQ measures it, then tells you exactly
                how to mix it&nbsp;— step by step, for your DAW.
              </p>
              <CTALink href="/onboarding" className={styles.ctaButton}>
                Analyse your vocal free
              </CTALink>
              <span className={styles.heroSmall}>
                3 free analyses. No credit card.
              </span>
            </div>

            <div className={styles.heroVisual}>
              <XYPad />
            </div>
          </section>

          {/* ═══════════════════════════════════════════
              SECTION 2 — How it works
              ═══════════════════════════════════════════ */}
          <section className={styles.howItWorks}>
            <div className={styles.steps}>
              {/* Step 1 */}
              <div className={styles.stepCard}>
                <span className={styles.stepNumber}>01</span>
                <UploadIcon />
                <h3 className={styles.stepTitle}>Upload your vocal</h3>
                <p className={styles.stepText}>
                  Drop in your raw, unprocessed vocal. 30–60&nbsp;seconds is
                  enough.
                </p>
              </div>

              {/* Step 2 */}
              <div className={styles.stepCard}>
                <span className={styles.stepNumber}>02</span>
                <WaveformIcon />
                <h3 className={styles.stepTitle}>MimiQ measures it</h3>
                <p className={styles.stepText}>
                  We analyze loudness, dynamics, frequency balance, and how your
                  vocal sits against your beat.
                </p>
              </div>

              {/* Step 3 */}
              <div className={styles.stepCard}>
                <span className={styles.stepNumber}>03</span>
                <ListIcon />
                <h3 className={styles.stepTitle}>Get your vocal chain draft</h3>
                <p className={styles.stepText}>
                  A numbered, DAW-specific mixing chain tailored to your voice.
                  Open your DAW and follow the steps.
                </p>
              </div>
            </div>
          </section>

          {/* ═══════════════════════════════════════════
              SECTION 3 — Era strip
              ═══════════════════════════════════════════ */}
          <section className={styles.eras}>
            <span className={styles.erasLabel}>Five sonic worlds. One app.</span>
            <div className={styles.eraCards}>
              {eras.map((era) => (
                <div
                  key={era.id}
                  className={styles.eraCard}
                  style={{ background: era.subtleGradient }}
                >
                  <span className={styles.eraName} style={{ color: era.accent }}>
                    {era.name}
                  </span>
                  <span className={styles.eraDesc}>
                    {era.description.split(" — ")[0]}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ═══════════════════════════════════════════
              SECTION 4 — Final CTA
              ═══════════════════════════════════════════ */}
          <section className={styles.finalCta}>
            <h2 className={styles.finalHeading}>Ready to stop guessing?</h2>
            <p className={styles.finalSubtext}>
              Join producers who&apos;ve stopped watching tutorials and started
              hearing results.
            </p>
            <CTALink href="/onboarding" className={styles.ctaButton}>
              Analyse your vocal free
            </CTALink>
          </section>
        </main>
      </PageTransition>
    </StartGate>
  );
}
