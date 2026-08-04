import { describe, expect, it } from "vitest";
import { shapeProjectAnalysis } from "@/lib/serverProjectAnalysis";

describe("project analysis response shaping", () => {
  it("keeps a collision traceable to time, frequency, inputs, and version", () => {
    const result = shapeProjectAnalysis({
      analysis: {
        vocal: { lufs: -18.2, true_peak_db: -2.1 },
        beat: { lufs: -14.3 },
        frequency_collisions: [
          {
            start_seconds: 45,
            end_seconds: 70,
            frequency_low_hz: 2000,
            frequency_high_hz: 4000,
            vocal_energy_db: -18,
            beat_energy_db: -12,
            masking_delta_db: 6,
            analysis_version: "temporal_masking_v2",
          },
        ],
        recording_events: [
          {
            kind: "sibilance_spike",
            start_seconds: 12,
            end_seconds: 12.6,
            delta_db: 7,
            baseline_db: -31,
            measured_db: -24,
            frequency_low_hz: 5000,
            frequency_high_hz: 10000,
            analysis_version: "recording_events_v2",
          },
        ],
      },
      vocalCheck: null,
      inputAssetIds: ["vocal", "beat"],
      contextFingerprint: "fingerprint",
      vocalCheckError: "Pitch unavailable.",
    });
    expect(result.findings[0].evidence).toMatchObject({
      startSeconds: 45,
      endSeconds: 70,
      frequencyLowHz: 2000,
      frequencyHighHz: 4000,
      inputAssetIds: ["vocal", "beat"],
      analysisVersion: "temporal_masking_v2",
    });
    expect(result.recordingEvidence[0]).toMatchObject({
      kind: "sibilance_spike",
      startSeconds: 12,
      deltaDb: 7,
    });
    expect(result.provenance.skippedMeasurements).toContain("pitch_alignment");
    expect(result.fallback_used).toBe(true);
  });

  it("never fabricates measurements when the backend is unavailable", () => {
    const result = shapeProjectAnalysis({
      analysis: null,
      vocalCheck: null,
      inputAssetIds: ["vocal", "beat"],
      contextFingerprint: "fingerprint",
      analysisError: "offline",
      vocalCheckError: "offline",
    });
    expect(result.measurements).toEqual({
      vocal: null,
      beat: null,
      vocalCheck: null,
      recordingEvidence: [],
    });
    expect(result.recordingEvidence).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.provenance.status).toBe("error");
  });
});
