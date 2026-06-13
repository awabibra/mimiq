import { describe, expect, it } from "vitest";
import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import {
  buildMetricReadouts,
  formatPresenceBand,
  hasMeasuredProvenance,
  measuredFitForProvenance,
  type AnalysisProvenance,
} from "./metrics";

const metrics: AudioMetrics = {
  lufs: -17,
  dynamicRange: 8,
  spectralCentroid: 2400,
  lowEndEnergy: 0.2,
  stereoWidth: 0.1,
  reverbEstimate: 0.08,
};

const measured: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: false,
  audio_service_status: "ok",
};

const fallback: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: true,
  audio_service_status: "fallback",
};

const errorProvenance: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: false,
  audio_service_status: "error",
};

const fit = (value: EvaluationResult["measured_fit"]) => value;

describe("Chain Lab metric helpers", () => {
  it("labels measured metrics separately from fallback estimates", () => {
    const measuredReadouts = buildMetricReadouts(null, metrics, [], "golden", measured);
    const fallbackReadouts = buildMetricReadouts(null, metrics, [], "golden", fallback);
    const errorReadouts = buildMetricReadouts(null, metrics, [], "golden", errorProvenance);

    expect(measuredReadouts[0]?.source).toBe("measured");
    expect(fallbackReadouts[0]?.source).toBe("estimated");
    expect(errorReadouts[0]?.source).toBe("fallback");
  });

  it("suppresses good measured fit when provenance is not measured", () => {
    expect(hasMeasuredProvenance(measured)).toBe(true);
    expect(measuredFitForProvenance(fit("good"), measured)).toBe("good");
    expect(measuredFitForProvenance(fit("good"), fallback)).toBe("unknown");
    expect(measuredFitForProvenance(fit("good"), errorProvenance)).toBe("unknown");
    expect(measuredFitForProvenance(fit("needs_work"), fallback)).toBe("needs_work");
  });

  it("provides feedback-safe fit display for fallback provenance", () => {
    const feedbackFit = measuredFitForProvenance("good", fallback);

    expect(feedbackFit).toBe("unknown");
  });

  it("falls back to chain-derived presence when harshness is unavailable", () => {
    const chain: ChainStep[] = [
      {
        step: 1,
        tool: "Presence EQ",
        action: "Boost +2.5 dB at 3.5 kHz.",
        reason: "Lift vocal focus.",
        role: "additive_eq",
      },
    ];

    expect(formatPresenceBand(null, chain)).toBe("+2.5 dB");
    expect(buildMetricReadouts(null, metrics, chain, "golden", measured)[3]?.source).toBe("chain");
  });
});
