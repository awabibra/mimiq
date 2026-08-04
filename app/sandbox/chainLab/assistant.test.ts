import { describe, expect, it } from "vitest";
import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import { buildAssistantModel, evaluationIssueToFix, findStepByRole } from "./assistant";
import type { AnalysisProvenance } from "./metrics";

const chain: ChainStep[] = [
  {
    step: 1,
    tool: "High-pass",
    action: "High-pass at 90 Hz.",
    reason: "Clean rumble.",
    role: "highpass",
  },
  {
    step: 2,
    tool: "FET Compressor",
    action: "4:1 ratio, threshold -24 dB, 4 dB GR.",
    reason: "Control level.",
    role: "compressor_primary",
  },
  {
    step: 3,
    tool: "De-esser",
    action: "Target 7 kHz, reduce 3 dB.",
    reason: "Control consonants.",
    role: "deesser",
  },
];

const metrics: AudioMetrics = {
  lufs: -18,
  dynamicRange: 10,
  spectralCentroid: 3400,
  sibilancePeak: -9,
  truePeak: -3,
  harshness: 0,
  lowMidBuildup: 0,
  noiseFloorDb: -50,
  dynamicInconsistency: 0,
  stereoWidth: 0.1,
  crestFactor: 12,
  spectralEnvelope: Array(30).fill(0),
};

const fallback: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: true,
  audio_service_status: "fallback",
};

const measured: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: false,
  audio_service_status: "ok",
};

const evaluation: EvaluationResult = {
  overall: "The chain has measured-risk gaps that should be fixed before saving.",
  issues: [
    {
      severity: "warning",
      plugin: "deesser",
      problem: "The vocal is bright or sibilant enough to need a de-esser check.",
      fix: "Add or tune a de-esser after tone shaping.",
      why: "Bright measured content can push consonants forward.",
    },
  ],
  strengths: [],
  measured_fit: "needs_work",
  flags: ["missing_deesser"],
  explanation: "Bright measured content can push consonants forward.",
};

describe("Chain Lab assistant helpers", () => {
  it("maps fallback evaluation issues without inventing measured claims", () => {
    const model = buildAssistantModel(metrics, chain, "modern_rap", fallback, evaluation);

    expect(model.issues[0]?.claim).toBe("estimated");
    expect(model.issues[0]?.label).toBe("deesser");
    expect(model.fixes[0]?.targetStep).toBe(3);
  });

  it("uses measured claims only for measured provenance", () => {
    const model = buildAssistantModel(metrics, chain, "modern_rap", measured, null);

    expect(model.issues.length).toBeGreaterThan(0);
    expect(model.issues.every((issue) => issue.claim === "measured")).toBe(true);
  });

  it("handles empty evaluations without crashing", () => {
    expect(() =>
      buildAssistantModel(metrics, chain, "modern_rap", measured, null)
    ).not.toThrow();
  });

  it("targets the closest matching chain step for evaluation fixes", () => {
    expect(findStepByRole(chain, "compressor_primary")?.step).toBe(2);
    expect(evaluationIssueToFix(evaluation.issues[0], 0, chain).targetStep).toBe(3);
  });
});
