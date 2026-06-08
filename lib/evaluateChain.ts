import type { ChainStep } from "@/lib/types";

export interface AnalysisMetrics {
  lufs: number;
  dynamic_range?: number;
  dynamicRange?: number;
  spectral_centroid?: number;
  spectralCentroid?: number;
}

export type ChainConfig = ChainStep[];

export interface EvaluationResult {
  measured_fit: "good" | "needs_adjustment" | "rebuild";
  flags: string[];
  explanation_hint: string;
}

const metricNumber = (...values: Array<number | undefined>) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return Number.NaN;
};

export function evaluateChain(
  metrics: AnalysisMetrics,
  chain: ChainConfig
): EvaluationResult {
  void chain;

  const flags: string[] = [];
  const dynamicRange = metricNumber(metrics.dynamic_range, metrics.dynamicRange);
  const spectralCentroid = metricNumber(
    metrics.spectral_centroid,
    metrics.spectralCentroid
  );

  if (metrics.lufs > -6) flags.push("overloud");
  if (dynamicRange < 6) flags.push("over-compressed");
  if (spectralCentroid > 8000) flags.push("harsh highs");
  if (spectralCentroid < 2000) flags.push("muddy");

  const measured_fit =
    flags.length === 0
      ? "good"
      : flags.length <= 2
        ? "needs_adjustment"
        : "rebuild";

  return {
    measured_fit,
    flags,
    explanation_hint:
      flags.length > 0
        ? `Explain these deterministic chain-fit flags only: ${flags.join(", ")}. Do not change chain parameter values from this explanation.`
        : "Explain that the measured thresholds did not raise deterministic chain-fit flags. Do not change chain parameter values from this explanation.",
  };
}
