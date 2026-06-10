import type {
  AudioMetrics,
  ChainStep,
  EvaluationIssue,
  EvaluationResult,
} from "@/lib/types";

const hasRole = (chain: ChainStep[], roles: string[]) =>
  chain.some((step) => roles.includes(step.role ?? ""));

const hasText = (chain: ChainStep[], values: string[]) => {
  const joined = chain
    .map((step) => `${step.tool} ${step.action} ${step.reason} ${step.role ?? ""}`)
    .join(" ")
    .toLowerCase();

  return values.some((value) => joined.includes(value));
};

const metric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function issue(
  severity: EvaluationIssue["severity"],
  plugin: string,
  problem: string,
  fix: string,
  why: string
): EvaluationIssue {
  return { severity, plugin, problem, fix, why };
}

export function evaluateChain(
  metrics: AudioMetrics,
  chain: ChainStep[]
): EvaluationResult {
  const issues: EvaluationIssue[] = [];
  const strengths: string[] = [];
  const flags: string[] = [];
  const lufs = metric(metrics.lufs);
  const dynamicRange = metric(metrics.dynamicRange);
  const centroid = metric(metrics.spectralCentroid);
  const truePeak = metric(metrics.truePeak);

  if (!Array.isArray(chain) || chain.length === 0) {
    return {
      overall: "MimiQ could not inspect an empty chain.",
      issues: [
        issue(
          "critical",
          "chain",
          "No chain steps were provided.",
          "Generate or restore a chain before evaluating.",
          "The audit needs plugin order and settings before it can compare them with the measured vocal."
        ),
      ],
      strengths: [],
      measured_fit: "unknown",
      flags: ["missing_chain"],
      explanation: "No deterministic chain fit can be measured until a chain is present.",
    };
  }

  const hasHighpass = hasRole(chain, ["highpass"]) || hasText(chain, ["high-pass"]);
  const hasCompression =
    hasRole(chain, [
      "compressor_primary",
      "compressor_secondary",
      "compressor_vca",
      "compressor_optical",
      "compressor_vari_mu",
    ]) || hasText(chain, ["compressor", "compression"]);
  const hasDeesser = hasRole(chain, ["deesser"]) || hasText(chain, ["deesser", "de-esser"]);
  const hasLimiter =
    hasRole(chain, ["mastering_limiter", "limiter"]) || hasText(chain, ["limiter", "ceiling"]);
  const hasEq =
    hasRole(chain, ["subtractive_eq", "additive_eq", "air_eq", "tilt_eq"]) ||
    hasText(chain, ["eq", "shelf", "boost", "cut"]);

  if (!hasHighpass) {
    flags.push("missing_highpass");
    issues.push(
      issue(
        "warning",
        "highpass",
        "No high-pass step was found.",
        "Add a high-pass before dynamics processing.",
        "Measured rap vocals usually need low-end cleanup before compression raises room tone."
      )
    );
  } else {
    strengths.push("Low-end cleanup is present before the chain gets dense.");
  }

  if (!hasCompression) {
    flags.push("missing_compression");
    issues.push(
      issue(
        dynamicRange != null && dynamicRange > 9 ? "critical" : "warning",
        "compressor_primary",
        "No main compression step was found.",
        "Add primary compression matched to the measured dynamic range.",
        "Without a dynamics stage, the chain cannot reliably control take-to-take level movement."
      )
    );
  } else {
    strengths.push("A dynamics stage is present for level control.");
  }

  if (!hasEq) {
    flags.push("missing_eq");
    issues.push(
      issue(
        "warning",
        "eq",
        "No EQ step was found.",
        "Add subtractive or additive EQ tied to the measured centroid.",
        "The chain needs a measured tone-shaping step before MimiQ can call the fit strong."
      )
    );
  } else {
    strengths.push("Tone shaping is present in the chain.");
  }

  if (!hasDeesser && centroid != null && centroid > 2600) {
    flags.push("missing_deesser");
    issues.push(
      issue(
        "warning",
        "deesser",
        "The vocal is bright enough to need a sibilance check.",
        "Add or tune a de-esser after the presence/air stage.",
        "A brighter measured centroid raises the chance that consonants will jump forward after EQ."
      )
    );
  }

  if (!hasLimiter && truePeak != null && truePeak > -1) {
    flags.push("missing_limiter_for_peak");
    issues.push(
      issue(
        "critical",
        "mastering_limiter",
        "The measured peak is too close to clipping without a limiter stage.",
        "Add a final limiter or lower the return level before saving the edit.",
        "The measured peak leaves too little headroom for a printed vocal."
      )
    );
  } else if (hasLimiter) {
    strengths.push("A final peak-control step is present.");
  }

  if (lufs != null && lufs < -24 && !hasCompression) {
    flags.push("quiet_vocal_without_leveling");
  }

  if (dynamicRange != null && dynamicRange > 11) {
    flags.push("wide_dynamic_range");
    if (hasCompression) {
      issues.push(
        issue(
          "suggestion",
          "compressor_primary",
          "The measured dynamic range is still wide.",
          "Check ratio, threshold, and gain reduction against the take.",
          "Wide measured movement usually needs the compressor to do more than a light polish."
        )
      );
    }
  }

  const inactiveCount = chain.filter((step) => step.enabled === false).length;
  if (inactiveCount > 0) {
    flags.push("disabled_steps_present");
    issues.push(
      issue(
        "suggestion",
        "chain",
        `${inactiveCount} chain step${inactiveCount === 1 ? "" : "s"} are disabled.`,
        "Confirm disabled steps are intentional before saving.",
        "Disabled stages can make the printed chain differ from the visible plan."
      )
    );
  }

  const criticalCount = issues.filter((entry) => entry.severity === "critical").length;
  const warningCount = issues.filter((entry) => entry.severity === "warning").length;
  const measured_fit =
    metric(metrics.lufs) == null || metric(metrics.dynamicRange) == null
      ? "unknown"
      : criticalCount > 0 || warningCount > 3
        ? "needs_work"
        : warningCount <= 1 && hasHighpass && hasCompression && hasEq
          ? "good"
          : "unknown";
  const overall =
    measured_fit === "good"
      ? "The edited chain fits the available measurements with only minor caveats."
      : measured_fit === "needs_work"
        ? "The edited chain has measured-risk gaps that should be fixed before saving."
        : "The edited chain has mixed or incomplete measurement support.";

  return {
    overall,
    issues,
    strengths,
    measured_fit,
    flags,
    explanation:
      issues.length > 0
        ? issues[0].why
        : "The chain contains the main measured-control stages MimiQ can verify from the current take.",
  };
}
