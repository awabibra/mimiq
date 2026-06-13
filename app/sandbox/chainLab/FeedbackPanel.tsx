"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { EvaluationIssue, EvaluationResult } from "@/lib/types";
import styles from "../VisualVocalChain.module.css";

function severityDotClass(severity: EvaluationIssue["severity"]) {
  if (severity === "critical") return styles.severityCritical;
  if (severity === "warning") return styles.severityWarning;
  return styles.severitySuggestion;
}

function formatCheckedLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function FeedbackPanel({
  result,
  isDirty,
  evaluating,
  onClose,
  onEvaluate,
  onJump,
  displayedMeasuredFit = result.measured_fit,
}: {
  result: EvaluationResult;
  displayedMeasuredFit?: EvaluationResult["measured_fit"];
  isDirty: boolean;
  evaluating: boolean;
  onClose: () => void;
  onEvaluate?: () => void;
  onJump: (issue: EvaluationIssue) => void;
}) {
  const [strengthsOpen, setStrengthsOpen] = useState(false);
  const fitClass =
    displayedMeasuredFit === "good"
      ? styles.verdict_good
      : displayedMeasuredFit === "needs_work"
        ? styles.verdict_needs_work
        : "";
  const fitLabel =
    displayedMeasuredFit === "good"
      ? "Measured fit good"
      : displayedMeasuredFit === "needs_work"
        ? "Measured fit needs work"
        : "Measured fit unknown";

  return (
    <div className={styles.feedbackPanel} aria-live="polite">
      <button
        type="button"
        className={styles.feedbackClose}
        onClick={onClose}
        aria-label="Close feedback"
        title="Close feedback"
      >
        <X aria-hidden="true" size={14} strokeWidth={2} />
      </button>

      <p className={styles.feedbackOverall}>{result.overall}</p>

      <section className={styles.feedbackSection}>
        <span className={styles.feedbackSectionTitle}>Issues</span>
        <div className={styles.issueList}>
          {result.issues.length > 0 ? (
            result.issues.map((issue) => (
              <button
                type="button"
                className={styles.issueCard}
                key={`${issue.plugin}-${issue.problem}-${issue.fix}`}
                onClick={() => onJump(issue)}
              >
                <span className={`${styles.severityDot} ${severityDotClass(issue.severity)}`} />
                <span className={styles.issuePlugin}>{issue.plugin}</span>
                <strong>{issue.problem}</strong>
                <span className={styles.issueFix}>Fix: {issue.fix}</span>
                <em>{issue.why}</em>
                <span className={styles.jumpButton}>Jump to plugin</span>
              </button>
            ))
          ) : (
            <span className={styles.noIssues}>No issues returned.</span>
          )}
        </div>
      </section>

      {result.unknowns && result.unknowns.length > 0 && (
        <section className={styles.feedbackSection}>
          <span className={styles.feedbackSectionTitle}>Unknowns</span>
          <div className={styles.strengthList}>
            {result.unknowns.map((unknown) => (
              <span key={unknown}>
                <i />
                {unknown}
              </span>
            ))}
          </div>
        </section>
      )}

      {result.checked && result.checked.length > 0 && (
        <section className={styles.feedbackSection}>
          <span className={styles.feedbackSectionTitle}>Evidence checked</span>
          <div className={styles.strengthList}>
            {result.checked.map((checked) => (
              <span key={checked}>
                <i />
                {formatCheckedLabel(checked)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className={styles.feedbackSection}>
        <button
          type="button"
          className={styles.strengthsToggle}
          onClick={() => setStrengthsOpen((open) => !open)}
        >
          Strengths {strengthsOpen ? "-" : "+"}
        </button>
        <AnimatePresence>
          {strengthsOpen && (
            <motion.div
              className={styles.strengthList}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              {result.strengths.length > 0 ? (
                result.strengths.map((strength) => (
                  <span key={strength}>
                    <i />
                    {strength}
                  </span>
                ))
              ) : (
                <span className={styles.noIssues}>No strengths called out.</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className={`${styles.verdict} ${fitClass}`}>
        <span>{fitLabel}</span>
        <p>{result.explanation}</p>
      </section>

      <button
        type="button"
        className={`${styles.reevaluateButton} ${isDirty ? styles.reevaluateButtonActive : ""}`}
        disabled={!isDirty || evaluating}
        onClick={onEvaluate}
      >
        {evaluating ? "Analysing..." : "Re-evaluate"}
      </button>
    </div>
  );
}
