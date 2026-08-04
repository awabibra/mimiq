import { describe, expect, it } from "vitest";
import { evaluateChain } from "./evaluateChain";
import type { AudioMetrics, ChainStep } from "./types";

const baseMetrics: AudioMetrics = {
  lufs: -12,
  dynamicRange: 5,
  spectralCentroid: 2200,
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

const step = (overrides: Partial<ChainStep>): ChainStep => ({
  step: overrides.step ?? 1,
  tool: overrides.tool ?? "Plugin",
  action: overrides.action ?? "Set for measured vocal control.",
  reason: overrides.reason ?? "Keeps the chain tied to the take.",
  bus: overrides.bus ?? "main",
  role: overrides.role,
  sendPoint: overrides.sendPoint,
  enabled: overrides.enabled,
});

const completeChain = (): ChainStep[] => [
  step({
    step: 1,
    tool: "Noise Gate",
    role: "cleanup",
    action: "Light gate before cleanup.",
  }),
  step({
    step: 2,
    tool: "High-pass",
    role: "highpass",
    action: "High-pass at 100 Hz, 24 dB/oct.",
  }),
  step({
    step: 3,
    tool: "Subtractive EQ",
    role: "subtractive_eq",
    action: "Cut -3 dB at 350 Hz, Q 1.4.",
  }),
  step({
    step: 4,
    tool: "FET Compressor",
    role: "compressor_primary",
    action: "Use 4:1 ratio, threshold -24 dB, 4 dB GR.",
  }),
  step({
    step: 5,
    tool: "Air EQ",
    role: "additive_eq",
    action: "Shelf +1.5 dB at 9 kHz.",
  }),
  step({
    step: 6,
    tool: "De-esser",
    role: "deesser",
    action: "Target 6.5 kHz and reduce 3 dB.",
  }),
  step({
    step: 7,
    tool: "Limiter",
    role: "mastering_limiter",
    bus: "mastering_bus",
    action: "Final limiter ceiling -0.3 dB.",
  }),
];

describe("evaluateChain", () => {
  it("returns unknown for an empty chain", () => {
    const result = evaluateChain(baseMetrics, []);

    expect(result.measured_fit).toBe("unknown");
    expect(result.flags).toContain("missing_chain");
    expect(result.issues[0]?.severity).toBe("critical");
  });

  it("returns good for a complete measured chain", () => {
    const result = evaluateChain(baseMetrics, completeChain());

    expect(result.measured_fit).toBe("good");
    expect(result.issues).toHaveLength(0);
    expect(result.unknowns).toEqual([]);
    expect(result.checked).toEqual(
      expect.arrayContaining(["main_highpass", "main_compression", "eq_stage"])
    );
  });

  it("warns and avoids good fit when high-pass is missing", () => {
    const chain = completeChain().filter((entry) => entry.role !== "highpass");
    const result = evaluateChain(baseMetrics, chain);

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("missing_highpass");
    expect(result.issues.some((entry) => entry.plugin === "highpass")).toBe(true);
  });

  it("does not count bus compression as main compression", () => {
    const chain = completeChain().map((entry) =>
      entry.role === "compressor_primary"
        ? { ...entry, bus: "parallel_comp_bus" as const, sendPoint: "return" as const }
        : entry
    );
    const result = evaluateChain(baseMetrics, chain);

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("missing_main_compression");
    expect(result.issues.some((entry) => entry.problem.includes("bus or return"))).toBe(true);
  });

  it("warns when a bright vocal has no de-esser", () => {
    const chain = completeChain().filter((entry) => entry.role !== "deesser");
    const result = evaluateChain(
      {
        ...baseMetrics,
        spectralCentroid: 3100,
      },
      chain
    );

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("missing_deesser");
  });

  it("marks near-clipping peaks without a limiter as critical", () => {
    const chain = completeChain().filter((entry) => entry.role !== "mastering_limiter");
    const result = evaluateChain(
      {
        ...baseMetrics,
        truePeak: -0.3,
      },
      chain
    );

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("missing_limiter_for_peak");
    expect(result.issues.some((entry) => entry.severity === "critical")).toBe(true);
  });

  it("reduces confidence when steps are disabled", () => {
    const chain = completeChain().map((entry) =>
      entry.role === "additive_eq" ? { ...entry, enabled: false } : entry
    );
    const result = evaluateChain(baseMetrics, chain);

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("disabled_steps_present");
  });

  it("flags bad cleanup and limiter ordering", () => {
    const chain = completeChain();
    const compressionIndex = chain.findIndex((entry) => entry.role === "compressor_primary");
    const highpassIndex = chain.findIndex((entry) => entry.role === "highpass");
    const limiterIndex = chain.findIndex((entry) => entry.role === "mastering_limiter");
    const airEqIndex = chain.findIndex((entry) => entry.role === "additive_eq");
    const reordered = [...chain];
    [reordered[compressionIndex], reordered[highpassIndex]] = [
      reordered[highpassIndex],
      reordered[compressionIndex],
    ];
    [reordered[limiterIndex], reordered[airEqIndex]] = [
      reordered[airEqIndex],
      reordered[limiterIndex],
    ];
    const result = evaluateChain(baseMetrics, reordered);

    expect(result.measured_fit).toBe("needs_work");
    expect(result.flags).toContain("cleanup_after_compression");
    expect(result.flags).toContain("tone_after_limiter");
  });

  it("returns unknown when required metric fields are invalid", () => {
    const result = evaluateChain(
      {
        ...baseMetrics,
        lufs: Number.NaN,
      },
      completeChain()
    );

    expect(result.measured_fit).toBe("unknown");
    expect(result.flags).toContain("invalid_required_metrics");
    expect(result.unknowns).toContain("The take is missing finite LUFS or dynamic range values.");
  });
});
