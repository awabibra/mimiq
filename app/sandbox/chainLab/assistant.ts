import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import { getGenreProfile } from "@/lib/chainKnowledge";
import { formatMetricDb, toKhz, type AnalysisProvenance } from "./metrics";

export type AssistantSeverity = "critical" | "warning" | "note";

export interface AssistantIssue {
  id: string;
  severity: AssistantSeverity;
  label: string;
  detail: string;
  claim: "measured" | "estimated" | "unknown";
  targetRole?: string;
}

export interface AssistantFix {
  id: string;
  label: string;
  detail: string;
  targetStep?: number;
  targetRole?: string;
}

export interface AssistantModel {
  vibeSummary: string;
  issues: AssistantIssue[];
  fixes: AssistantFix[];
}

export function findStepByRole(chain: ChainStep[], role: string) {
  const roleText = role.toLowerCase();
  return chain.find((step) => {
    const haystack = `${step.role ?? ""} ${step.tool} ${step.action}`.toLowerCase();
    if (roleText === "chain") return true;
    if (roleText === "eq") return /eq|shelf|boost|cut/.test(haystack);
    if (roleText === "deesser") return haystack.includes("deess") || haystack.includes("de-ess");
    if (roleText === "highpass") return haystack.includes("highpass") || haystack.includes("high-pass");
    if (roleText === "compressor") return haystack.includes("compressor") || haystack.includes("comp");
    if (roleText === "compressor_primary") return haystack.includes("compressor") || haystack.includes("comp");
    if (roleText === "mastering_limiter") return haystack.includes("limiter") || haystack.includes("ceiling");
    if (roleText === "presence") return haystack.includes("eq") || haystack.includes("presence") || haystack.includes("air");
    return haystack.includes(roleText);
  });
}

export function issueToFix(issue: AssistantIssue, chain: ChainStep[]): AssistantFix {
  const target = issue.targetRole ? findStepByRole(chain, issue.targetRole) : undefined;
  const fixLabels: Record<string, Pick<AssistantFix, "label" | "detail">> = {
    sibilance: {
      label: "De-ess around 7 kHz",
      detail: "Reduces sharp consonants while keeping the top end visible.",
    },
    low_end: {
      label: "High-pass filter",
      detail: "Cleans low-end rumble before compression raises it.",
    },
    dynamics: {
      label: "Compression leveling",
      detail: "Smooths loudness swings without promising a finished mix.",
    },
    quiet: {
      label: "Re-check gain staging",
      detail: "Keeps the chain target aligned with the selected vibe.",
    },
    bright: {
      label: "Soften presence EQ",
      detail: "Pulls the vocal away from brittle upper-mid emphasis.",
    },
    dark: {
      label: "Lift presence carefully",
      detail: "Adds clarity without treating brightness as a guaranteed fix.",
    },
  };
  const copy = fixLabels[issue.id] ?? {
    label: "Review chain stage",
    detail: "This points to the closest matching plugin in the current chain.",
  };

  return {
    id: `fix-${issue.id}`,
    ...copy,
    targetRole: issue.targetRole,
    targetStep: target?.step,
  };
}

export function evaluationIssueToAssistantIssue(
  issue: EvaluationResult["issues"][number],
  index: number,
  claim: AssistantIssue["claim"]
): AssistantIssue {
  return {
    id: `evaluation-${issue.plugin}-${index}`,
    severity: issue.severity === "critical" ? "critical" : issue.severity === "warning" ? "warning" : "note",
    label: issue.plugin === "chain" ? "Chain edit check" : issue.plugin.replace(/_/g, " "),
    detail: issue.problem,
    claim,
    targetRole: issue.plugin,
  };
}

export function evaluationIssueToFix(
  issue: EvaluationResult["issues"][number],
  index: number,
  chain: ChainStep[]
): AssistantFix {
  const target = findStepByRole(chain, issue.plugin);

  return {
    id: `fix-evaluation-${issue.plugin}-${index}`,
    label: issue.fix,
    detail: issue.why,
    targetRole: issue.plugin,
    targetStep: target?.step,
  };
}

export function buildAssistantModel(
  metrics: AudioMetrics | null,
  chain: ChainStep[],
  eraId: string,
  provenance: AnalysisProvenance | null,
  evaluationResult?: EvaluationResult | null
): AssistantModel {
  const profile = getGenreProfile(eraId);
  const issues: AssistantIssue[] = [];
  const sourceIsFallback = provenance?.fallback_used || provenance?.audio_service_status !== "ok";
  const claim = sourceIsFallback ? "estimated" : "measured";

  if (evaluationResult) {
    const evaluationIssues = evaluationResult.issues
      .slice(0, 3)
      .map((issue, index) => evaluationIssueToAssistantIssue(issue, index, claim));

    return {
      vibeSummary: evaluationResult.overall,
      issues:
        evaluationIssues.length > 0
          ? evaluationIssues
          : [
              {
                id: "evaluation-clear",
                severity: "note",
                label: "No major edit issue",
                detail: evaluationResult.explanation,
                claim,
              },
            ],
      fixes:
        evaluationResult.issues.length > 0
          ? evaluationResult.issues
              .slice(0, 3)
              .map((issue, index) => evaluationIssueToFix(issue, index, chain))
          : [
              {
                id: "fix-evaluation-keep",
                label: "Keep evaluated chain",
                detail: evaluationResult.explanation,
              },
            ],
    };
  }

  if (!metrics) {
    return {
      vibeSummary: "Upload or select a vocal to show measured guidance.",
      issues: [
        {
          id: "unknown",
          severity: "note",
          label: "No measured vocal yet",
          detail: "mimiq can show the chain, but issues stay unknown until audio is analyzed.",
          claim: "unknown",
        },
      ],
      fixes: [],
    };
  }

  if ((metrics.sibilancePeak ?? -14) > -12) {
    issues.push({
      id: "sibilance",
      severity: (metrics.sibilancePeak ?? -14) > -9 ? "critical" : "warning",
      label: "Sharp S sounds",
      detail: `Energy near the de-ess range is ${formatMetricDb(metrics.sibilancePeak ?? -12)}.`,
      claim,
      targetRole: "deesser",
    });
  }

  if ((metrics.lowEndEnergy ?? 0) > 0.36 || (metrics.lowMidBuildup ?? 0) > 0.0002) {
    issues.push({
      id: "low_end",
      severity: "warning",
      label: "Low-end rumble",
      detail: "The measured low band is high enough to check before compression.",
      claim,
      targetRole: "highpass",
    });
  }

  if (
    metrics.dynamicRange > profile.dynamic_range_target + 1 ||
    (metrics.dynamicInconsistency ?? 0) > 0.36
  ) {
    issues.push({
      id: "dynamics",
      severity: "warning",
      label: "Uneven vocal level",
      detail: `${metrics.dynamicRange.toFixed(1)} dB range is above the ${profile.dynamic_range_target} dB target.`,
      claim,
      targetRole: "compressor",
    });
  }

  if (metrics.lufs < profile.lufs_target - 2) {
    issues.push({
      id: "quiet",
      severity: "note",
      label: "Vocal sits quiet",
      detail: `${metrics.lufs.toFixed(1)} LUFS is below the selected target context.`,
      claim,
      targetRole: "compressor",
    });
  }

  if (metrics.spectralCentroid > 3000) {
    issues.push({
      id: "bright",
      severity: "warning",
      label: "Top end may feel edgy",
      detail: `Brightness measured around ${toKhz(metrics.spectralCentroid).toFixed(1)} kHz.`,
      claim,
      targetRole: "presence",
    });
  } else if (metrics.spectralCentroid < 1800) {
    issues.push({
      id: "dark",
      severity: "note",
      label: "Vocal reads dark",
      detail: `Brightness measured around ${toKhz(metrics.spectralCentroid).toFixed(1)} kHz.`,
      claim,
      targetRole: "presence",
    });
  }

  const visibleIssues = issues.slice(0, 3);
  return {
    vibeSummary: `${profile.philosophy.split(".")[0]}.`,
    issues: visibleIssues,
    fixes:
      visibleIssues.length > 0
        ? visibleIssues.map((issue) => issueToFix(issue, chain)).slice(0, 3)
        : [
            {
              id: "fix-keep-chain",
              label: "Keep measured chain",
              detail: "No major measured issue is flagged in this pass.",
            },
          ],
  };
}
