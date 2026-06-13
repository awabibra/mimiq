import type {
  AudioMetrics,
  ChainStep,
  EvaluationIssue,
  EvaluationResult,
} from "@/lib/types";

type Stage =
  | "highpass"
  | "eq"
  | "compression"
  | "deesser"
  | "limiter"
  | "cleanup"
  | "tone";

type StageHit = {
  step: ChainStep;
  index: number;
  stage: Stage;
  mainPath: boolean;
};

const COMPRESSION_ROLES = new Set([
  "compressor_primary",
  "compressor_secondary",
  "compressor_vca",
  "compressor_optical",
  "compressor_vari_mu",
]);

const EQ_ROLES = new Set([
  "subtractive_eq",
  "additive_eq",
  "air_eq",
  "tilt_eq",
  "notch_filter",
]);

const LIMITER_ROLES = new Set(["mastering_limiter", "limiter"]);

const metric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const textOf = (step: ChainStep) =>
  `${step.tool} ${step.action} ${step.reason} ${step.note ?? ""}`.toLowerCase();

const normalizeRole = (step: ChainStep) => step.role?.trim().toLowerCase() ?? "";

const isReturnStep = (step: ChainStep) => step.sendPoint === "return";

const isMainPath = (step: ChainStep) =>
  step.enabled !== false &&
  !isReturnStep(step) &&
  (step.bus == null || step.bus === "main");

const includesAny = (text: string, values: string[]) =>
  values.some((value) => text.includes(value));

const extractHz = (step: ChainStep) => {
  const text = textOf(step);
  const hzMatch = text.match(/(\d+(?:\.\d+)?)\s*hz\b/);
  if (hzMatch) return Number(hzMatch[1]);

  const khzMatch = text.match(/(\d+(?:\.\d+)?)\s*k(?:hz)?\b/);
  if (khzMatch) return Number(khzMatch[1]) * 1000;

  return null;
};

const extractRatio = (step: ChainStep) => {
  const text = textOf(step);
  if (text.includes("all-buttons") || text.includes("all buttons")) return 12;

  const match = text.match(/(\d+(?:\.\d+)?)\s*:\s*1/);
  return match ? Number(match[1]) : null;
};

const extractDbAfter = (step: ChainStep, words: string[]) => {
  const text = textOf(step);
  for (const word of words) {
    const match = text.match(new RegExp(`${word}[^-+\\d]*([-+]?\\d+(?:\\.\\d+)?)\\s*d?b`));
    if (match) return Number(match[1]);
  }
  return null;
};

const extractGainReduction = (step: ChainStep) => {
  const text = textOf(step);
  const compactMatch = text.match(/([-+]?\d+(?:\.\d+)?)\s*d?b?\s*(?:gr|gain reduction|reduction)/);
  if (compactMatch) return Math.abs(Number(compactMatch[1]));

  const wordMatch = text.match(/(?:gr|gain reduction|reduction)[^-+\d]*([-+]?\d+(?:\.\d+)?)\s*d?b/);
  return wordMatch ? Math.abs(Number(wordMatch[1])) : null;
};

const extractLimiterCeiling = (step: ChainStep) =>
  extractDbAfter(step, ["ceiling", "output", "true peak", "tp"]);

const extractDeessReduction = (step: ChainStep) =>
  extractGainReduction(step) ?? extractDbAfter(step, ["reduce", "reduction"]);

function issue(
  severity: EvaluationIssue["severity"],
  plugin: string,
  problem: string,
  fix: string,
  why: string
): EvaluationIssue {
  return { severity, plugin, problem, fix, why };
}

function classifyStage(step: ChainStep): Stage | null {
  const role = normalizeRole(step);

  if (role === "highpass") return "highpass";
  if (EQ_ROLES.has(role)) return "eq";
  if (COMPRESSION_ROLES.has(role)) return "compression";
  if (role === "deesser") return "deesser";
  if (LIMITER_ROLES.has(role)) return "limiter";
  if (includesAny(role, ["gate", "denoise", "cleanup"])) return "cleanup";
  if (includesAny(role, ["saturation", "tone", "exciter"])) return "tone";

  if (role) return null;

  const text = textOf(step);
  if (includesAny(text, ["high-pass", "high pass", "hpf"])) return "highpass";
  if (includesAny(text, ["de-esser", "deesser", "sibilance"])) return "deesser";
  if (includesAny(text, ["limiter", "ceiling", "true peak"])) return "limiter";
  if (includesAny(text, ["compressor", "compression", "gain reduction", "ratio"])) {
    return "compression";
  }
  if (includesAny(text, [" eq", "equalizer", "shelf", "notch", "boost", "cut"])) {
    return "eq";
  }
  if (includesAny(text, ["gate", "denoise", "cleanup"])) return "cleanup";
  if (includesAny(text, ["saturation", "exciter", "tone"])) return "tone";

  return null;
}

const findStage = (hits: StageHit[], stage: Stage, mainOnly = true) =>
  hits.find((hit) => hit.stage === stage && (!mainOnly || hit.mainPath));

const hasStageOffMain = (hits: StageHit[], stage: Stage) =>
  hits.some((hit) => hit.stage === stage && !hit.mainPath && hit.step.enabled !== false);

const hasInvalidRequiredMetric = (metrics: AudioMetrics) =>
  metric(metrics.lufs) == null || metric(metrics.dynamicRange) == null;

export function evaluateChain(
  metrics: AudioMetrics,
  chain: ChainStep[]
): EvaluationResult {
  const issues: EvaluationIssue[] = [];
  const strengths: string[] = [];
  const flags: string[] = [];
  const checked: string[] = [];
  const unknowns: string[] = [];
  const lufs = metric(metrics.lufs);
  const dynamicRange = metric(metrics.dynamicRange);
  const centroid = metric(metrics.spectralCentroid);
  const truePeak = metric(metrics.truePeak ?? metrics.truePeakEstimateDb);
  const sibilancePeak = metric(metrics.sibilancePeak);
  const harshness = metric(metrics.harshness);
  const needsDeesser =
    (centroid != null && centroid > 2600) ||
    (sibilancePeak != null && sibilancePeak > -18) ||
    (harshness != null && harshness > 0.65);
  const needsLimiter = truePeak != null && truePeak > -1;

  if (!Array.isArray(chain) || chain.length === 0) {
    return {
      overall: "mimiq could not inspect an empty chain.",
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
      checked: ["chain_presence"],
      unknowns: ["No chain steps were available to inspect."],
    };
  }

  if (hasInvalidRequiredMetric(metrics)) {
    flags.push("invalid_required_metrics");
    unknowns.push("The take is missing finite LUFS or dynamic range values.");
  }

  const hits = chain
    .map((step, index) => {
      const stage = classifyStage(step);
      return stage
        ? {
            step,
            index,
            stage,
            mainPath: isMainPath(step),
          }
        : null;
    })
    .filter((hit): hit is StageHit => hit != null);

  checked.push("main_highpass");
  const highpass = findStage(hits, "highpass");
  if (!highpass) {
    flags.push("missing_highpass");
    issues.push(
      issue(
        "warning",
        "highpass",
        "No active main-path high-pass step was found.",
        "Add high-pass filtering before compression.",
        "Low-end cleanup needs to happen before dynamics processing so rumble does not drive the compressor."
      )
    );
  } else {
    const highpassHz = extractHz(highpass.step);
    strengths.push("Active low-end cleanup is present on the main chain.");
    if (highpassHz == null) {
      flags.push("unknown_highpass_frequency");
      unknowns.push("The high-pass step does not expose a frequency in its action text.");
    } else if (highpassHz < 50 || highpassHz > 180) {
      flags.push("highpass_frequency_out_of_range");
      issues.push(
        issue(
          "warning",
          "highpass",
          `The high-pass frequency appears to be ${highpassHz} Hz.`,
          "Keep the vocal high-pass in a deliberate rap-vocal range unless the take proves otherwise.",
          "A very low filter may leave rumble, while an aggressive filter can thin the body before compression."
        )
      );
    }
  }

  checked.push("main_compression");
  const compression = findStage(hits, "compression");
  if (!compression) {
    flags.push("missing_main_compression");
    issues.push(
      issue(
        dynamicRange != null && dynamicRange > 9 ? "critical" : "warning",
        "compressor_primary",
        hasStageOffMain(hits, "compression")
          ? "Compression exists only on a bus or return."
          : "No active main compression step was found.",
        "Add primary compression on the main vocal path.",
        "Bus compression can add support, but it does not replace the main level-control stage."
      )
    );
  } else {
    const ratio = extractRatio(compression.step);
    const threshold = extractDbAfter(compression.step, ["threshold", "thresh"]);
    const gainReduction = extractGainReduction(compression.step);
    strengths.push("Active main-path compression is present.");
    if (ratio == null) {
      flags.push("unknown_compressor_ratio");
      unknowns.push("The compressor step does not expose a ratio in its action text.");
    } else if (ratio < 1.2 || ratio > 20) {
      flags.push("compressor_ratio_out_of_range");
      issues.push(
        issue(
          "warning",
          "compressor_primary",
          `The compressor ratio appears to be ${ratio}:1.`,
          "Use a deliberate vocal compression ratio and verify gain reduction against the take.",
          "A ratio outside normal vocal-control ranges needs measured justification."
        )
      );
    }

    if (threshold == null && gainReduction == null) {
      flags.push("unknown_compressor_amount");
      unknowns.push("The compressor step does not expose threshold or gain-reduction detail.");
    }
  }

  checked.push("eq_stage");
  const eq = findStage(hits, "eq");
  if (!eq) {
    flags.push("missing_eq");
    issues.push(
      issue(
        "warning",
        "eq",
        "No active main-path EQ step was found.",
        "Add subtractive or tone EQ tied to the measured take.",
        "The chain needs a verifiable tone-shaping stage before mimiq can call the fit strong."
      )
    );
  } else {
    strengths.push("Active tone shaping is present on the main chain.");
  }

  checked.push("deesser_requirement");
  const deesser = findStage(hits, "deesser");
  if (needsDeesser && !deesser) {
    flags.push("missing_deesser");
    issues.push(
      issue(
        "warning",
        "deesser",
        "The vocal is bright or sibilant enough to need a de-esser check.",
        "Add or tune a de-esser after tone shaping and before final peak control.",
        "Bright measured content can push consonants forward once EQ and compression are active."
      )
    );
  } else if (deesser) {
    const targetHz = extractHz(deesser.step);
    const reduction = extractDeessReduction(deesser.step);
    strengths.push("A de-essing stage is available for sibilance control.");
    if (targetHz == null) {
      flags.push("unknown_deesser_target");
      unknowns.push("The de-esser step does not expose a target frequency.");
    } else if (targetHz < 3500 || targetHz > 12000) {
      flags.push("deesser_target_out_of_range");
      issues.push(
        issue(
          "warning",
          "deesser",
          `The de-esser target appears to be ${targetHz} Hz.`,
          "Aim the de-esser at the measured sibilance region.",
          "A target outside normal sibilance bands may miss the consonant energy."
        )
      );
    }

    if (reduction == null) {
      flags.push("unknown_deesser_reduction");
      unknowns.push("The de-esser step does not expose reduction amount.");
    } else if (reduction < 0.5 || reduction > 10) {
      flags.push("deesser_reduction_out_of_range");
      issues.push(
        issue(
          "warning",
          "deesser",
          `The de-esser reduction appears to be ${reduction} dB.`,
          "Keep reduction measured and moderate unless the take is clearly harsh.",
          "Too little reduction may not catch consonants; too much can dull the vocal."
        )
      );
    }
  }

  checked.push("limiter_requirement");
  const limiter = findStage(hits, "limiter", false);
  const activeLimiter =
    limiter && limiter.step.enabled !== false && !isReturnStep(limiter.step) ? limiter : null;
  if (needsLimiter && !activeLimiter) {
    flags.push("missing_limiter_for_peak");
    issues.push(
      issue(
        "critical",
        "mastering_limiter",
        "The measured peak is too close to clipping without final peak control.",
        "Add a final limiter or lower the return level before saving the edit.",
        "The measured peak leaves too little headroom for a printed vocal."
      )
    );
  } else if (activeLimiter) {
    const ceiling = extractLimiterCeiling(activeLimiter.step);
    strengths.push("A final peak-control step is present.");
    if (ceiling == null) {
      flags.push("unknown_limiter_ceiling");
      unknowns.push("The limiter step does not expose its ceiling.");
    } else if (ceiling > -0.1) {
      flags.push("limiter_ceiling_too_hot");
      issues.push(
        issue(
          "warning",
          "mastering_limiter",
          `The limiter ceiling appears to be ${ceiling} dB.`,
          "Set the limiter ceiling below full scale before printing.",
          "A ceiling too close to 0 dB can still leave inter-sample peak risk."
        )
      );
    }
  }

  checked.push("chain_order");
  if (highpass && compression && highpass.index > compression.index) {
    flags.push("cleanup_after_compression");
    issues.push(
      issue(
        "warning",
        "chain_order",
        "Low-end cleanup appears after compression.",
        "Move high-pass cleanup before primary compression.",
        "Cleanup should feed the compressor so low-frequency noise does not trigger level reduction."
      )
    );
  }

  const hasToneAfterLimiter =
    activeLimiter != null &&
    hits.some(
      (hit) =>
        hit.mainPath &&
        (hit.stage === "eq" || hit.stage === "tone") &&
        hit.index > activeLimiter.index
    );
  if (hasToneAfterLimiter) {
    flags.push("tone_after_limiter");
    issues.push(
      issue(
        "warning",
        "chain_order",
        "Tone shaping appears after the final limiter.",
        "Move EQ before final peak control.",
        "Tone changes after a limiter can create new peaks that the limiter no longer catches."
      )
    );
  }

  const hasDynamicsAfterLimiter =
    activeLimiter != null &&
    hits.some(
      (hit) => hit.mainPath && hit.stage === "compression" && hit.index > activeLimiter.index
    );
  if (hasDynamicsAfterLimiter) {
    flags.push("dynamics_after_limiter");
    issues.push(
      issue(
        "warning",
        "chain_order",
        "Main compression appears after the final limiter.",
        "Keep the limiter as the last peak-control stage.",
        "Dynamics after the limiter can change level and peak behavior after final control."
      )
    );
  }

  if (lufs != null && lufs < -24 && !compression) {
    flags.push("quiet_vocal_without_leveling");
  }

  if (dynamicRange != null && dynamicRange > 11) {
    flags.push("wide_dynamic_range");
    if (compression) {
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

  checked.push("disabled_steps");
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
  const suggestionCount = issues.filter((entry) => entry.severity === "suggestion").length;
  const baseStagesPresent = Boolean(highpass && compression && eq);
  const measured_fit =
    hasInvalidRequiredMetric(metrics) || unknowns.length > 0
      ? "unknown"
      : criticalCount > 0 || warningCount > 0 || suggestionCount > 0 || !baseStagesPresent
        ? "needs_work"
        : "good";
  const overall =
    measured_fit === "good"
      ? "The chain fits the available measured requirements without deterministic warnings."
      : measured_fit === "needs_work"
        ? "The chain has measured-risk gaps that should be fixed before saving."
        : "The chain cannot be given a measured fit until the missing evidence is available.";

  return {
    overall,
    issues,
    strengths,
    measured_fit,
    flags,
    explanation:
      issues.length > 0
        ? issues[0].why
        : unknowns[0] ?? "The chain contains the main measured-control stages mimiq can verify.",
    checked,
    unknowns,
  };
}
