import { describe, expect, it } from "vitest";
import type { AudioMetrics, EvaluationResult } from "@/lib/types";
import {
  buildMetricReadouts,
  hasMeasuredProvenance,
  measuredFitForProvenance,
  type AnalysisProvenance,
} from "./metrics";

const metrics: AudioMetrics = {
  lufs: -17,
  dynamicRange: 8,
  spectralCentroid: 2400,
  truePeak: -3,
  harshness: 0,
  lowMidBuildup: 0,
  noiseFloorDb: -50,
  sibilancePeak: -20,
  dynamicInconsistency: 0,
  stereoWidth: 0.1,
  crestFactor: 12,
  spectralEnvelope: Array(30).fill(0),
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
    const measuredReadouts = buildMetricReadouts(null, metrics, [], "modern_rap", measured);
    const fallbackReadouts = buildMetricReadouts(null, metrics, [], "modern_rap", fallback);
    const errorReadouts = buildMetricReadouts(null, metrics, [], "modern_rap", errorProvenance);

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

});
