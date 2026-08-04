import { describe, expect, it } from "vitest";
import {
  buildDeterministicMixPlan,
  deriveWorkflowStageStatuses,
  defaultTargetProfile,
} from "@/lib/projectWorkflow";
import type {
  AnalysisRun,
  PluginCatalogEntry,
  Project,
} from "@/lib/types";

const project = {
  id: "project-1",
  user_id: "user-1",
  name: "Late Nights",
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z",
  audio_assets: [
    { id: "vocal", kind: "vocal", filename: "vocal.wav", mimeType: "audio/wav", size: 1, duration: 60, storagePath: "vocal", createdAt: "2026-07-22T00:00:00.000Z", status: "ready" },
    { id: "beat", kind: "beat", filename: "beat.wav", mimeType: "audio/wav", size: 1, duration: 60, storagePath: "beat", createdAt: "2026-07-22T00:00:00.000Z", status: "ready" },
  ],
  beat_file_url: null,
  beat_filename: null,
  vocal_versions: [],
  current_vocal_index: 0,
  generated_chains: [],
  mix_room_report: null,
  level_lab_report: null,
  stem_split_url: null,
  last_opened_at: "2026-07-22T00:00:00.000Z",
  target_profile: defaultTargetProfile(),
} satisfies Project;

const run = {
  id: "run-1",
  project_id: project.id,
  run_type: "diagnosis",
  input_asset_ids: ["beat", "vocal"],
  analysis_version: "mimiq-diagnosis-v2",
  measurements: {},
  findings: [
    {
      id: "collision-1",
      kind: "collision",
      title: "Vocal and beat overlap",
      severity: "high",
      impactRank: 1,
      evidence: {
        measurementKey: "collision.1",
        source: "measured",
        analysisVersion: "temporal_masking_v2",
        inputAssetIds: ["vocal", "beat"],
        startSeconds: 45,
        endSeconds: 70,
        frequencyLowHz: 2100,
        frequencyHighHz: 2600,
      },
      vocalEnergyDb: -18,
      beatEnergyDb: -12,
      maskingDeltaDb: 6,
      whyItMatters: "The beat is louder in the vocal presence band.",
      suggestedCapability: "equalizer",
      limitations: [],
    },
  ],
  provenance: {
    source: "fastapi",
    status: "ok",
    algorithmVersion: "mimiq-diagnosis-v2",
    createdAt: "2026-07-22T00:00:00.000Z",
    skippedMeasurements: [],
    contextFingerprint: "current",
  },
  limitations: [],
  fallback_used: false,
  fallback_reason: null,
  created_at: "2026-07-22T00:00:00.000Z",
} satisfies AnalysisRun;

const eq = {
  id: "logic-channel-eq",
  name: "Channel EQ",
  manufacturer: "Apple",
  daw: "Logic Pro",
  bundle_id: null,
  capability: "equalizer",
  parameter_schema: {},
  verified_ranges: {},
  stock: true,
  coverage_status: "certified",
  catalogue_version: "stock-v1",
  verified_at: "2026-07-22T00:00:00.000Z",
  source_note: "verified",
} satisfies PluginCatalogEntry;

const currentFingerprints = {
  prepare: "current",
  main_chain: "main-current",
  buses: "buses-current",
  match_beat: "match-current",
};

describe("project workflow", () => {
  it("marks a diagnosis outdated when its context fingerprint changed", () => {
    const statuses = deriveWorkflowStageStatuses({
      project,
      activeRun: run,
      activePlan: null,
      verificationRuns: [],
      contextFingerprints: {
        ...currentFingerprints,
        prepare: "changed",
      },
    });
    expect(statuses.find((status) => status.stage === "prepare")?.state).toBe("outdated");
    expect(statuses.find((status) => status.stage === "main_chain")?.state).toBe("outdated");
  });

  it("uses a certified DAW-stock plugin and traceable values", () => {
    const plan = buildDeterministicMixPlan({
      projectId: project.id,
      run,
      target: defaultTargetProfile(),
      catalog: [eq],
      daw: "Logic Pro",
      plugins: [],
    });
    expect(plan.instructions[0]).toMatchObject({
      pluginCatalogId: "logic-channel-eq",
      certified: true,
      parameters: { frequency_hz: 2350, gain_db: -3, q: 1.4 },
    });
  });

  it("does not turn informational findings into generic EQ instructions", () => {
    const informationalRun: AnalysisRun = {
      ...run,
      findings: [
        {
          ...run.findings[0],
          id: "loudness-info",
          kind: "loudness",
          suggestedCapability: null,
        },
      ],
    };
    const plan = buildDeterministicMixPlan({
      projectId: project.id,
      run: informationalRun,
      target: defaultTargetProfile(),
      catalog: [eq],
      daw: "Logic Pro",
      plugins: [],
    });
    expect(plan.instructions).toEqual([]);
  });

  it("marks the main chain as needing a check for a partial diagnosis", () => {
    const partialRun: AnalysisRun = {
      ...run,
      provenance: {
        ...run.provenance,
        status: "fallback",
        skippedMeasurements: ["pitch_alignment"],
      },
    };
    const statuses = deriveWorkflowStageStatuses({
      project,
      activeRun: partialRun,
      activePlan: null,
      verificationRuns: [],
      contextFingerprints: currentFingerprints,
    });
    expect(statuses.find((status) => status.stage === "prepare")?.state).toBe("needs_attention");
    expect(statuses.find((status) => status.stage === "main_chain")?.state).toBe("needs_attention");
  });

  it("keeps every stage explorable before a raw vocal is uploaded", () => {
    const emptyProject: Project = { ...project, audio_assets: [] };
    const statuses = deriveWorkflowStageStatuses({
      project: emptyProject,
      activeRun: null,
      activePlan: null,
      verificationRuns: [],
      contextFingerprints: currentFingerprints,
    });

    expect(statuses.find((status) => status.stage === "setup")).toMatchObject({
      label: "Upload needed",
      blocked: false,
    });
    expect(
      statuses
        .filter((status) => status.stage !== "setup")
        .every((status) => status.state === "preview" && !status.blocked)
    ).toBe(true);
  });

  it("allows Vocal Check with a raw vocal and no beat", () => {
    const vocalOnly: Project = {
      ...project,
      audio_assets: project.audio_assets.filter((asset) => asset.kind === "vocal"),
    };
    const statuses = deriveWorkflowStageStatuses({
      project: vocalOnly,
      activeRun: null,
      activePlan: null,
      verificationRuns: [],
      contextFingerprints: currentFingerprints,
    });

    expect(statuses.find((status) => status.stage === "setup")?.state).toBe("complete");
    expect(statuses.find((status) => status.stage === "prepare")?.state).toBe("ready");
  });

  it("requires alignment before beat-aware buses", () => {
    const plan = {
      id: "plan-1",
      project_id: project.id,
      analysis_run_id: run.id,
      target_profile: defaultTargetProfile(),
      plugin_catalogue_version: "stock-v1",
      instructions: [],
      completion_state: {},
      created_at: run.created_at,
      updated_at: run.created_at,
    };
    const statuses = deriveWorkflowStageStatuses({
      project,
      activeRun: run,
      activePlan: plan,
      verificationRuns: [],
      contextFingerprints: currentFingerprints,
    });

    expect(statuses.find((status) => status.stage === "buses")?.label).toBe("Needs alignment");
  });
});
