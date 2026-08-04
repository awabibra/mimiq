import { describe, expect, it } from "vitest";
import type { GeneratedChain, Project } from "@/lib/types";
import {
  getGeneratedChainForRole,
  getProjectVocalArchitecture,
  setActiveVocalRole,
  upsertVocalRoleChain,
} from "@/lib/vocalArchitecture";

const now = "2026-06-14T20:00:00.000Z";

function chain(id: string, role?: GeneratedChain["chain_data"]["vocal_role_id"]): GeneratedChain {
  return {
    id,
    chain_data: {
      chain: [{ step: 1, tool: "EQ", action: "High-pass", reason: "Clean rumble" }],
      summary: "Measured mimiq vocal chain.",
      measurements: {
        lufs: -16,
        dynamicRange: 7,
        spectralCentroid: 2400,
        truePeak: -2,
        harshness: 0.2,
        lowMidBuildup: 0.1,
        noiseFloorDb: -58,
        sibilancePeak: -13,
        dynamicInconsistency: 0.2,
        crestFactor: 9,
        spectralEnvelope: [],
      },
      audio_service_status: "ok",
      fallback_used: false,
      ...(role ? { vocal_role_id: role, role_source: "lead_derived" as const } : {}),
    },
    genre: "modern_rap",
    daw: "Logic Pro",
    created_at: now,
    sandbox_settings: {
      era: "modern_rap",
    },
  };
}

function project(generated_chains: GeneratedChain[] = []): Project {
  return {
    id: "project_1",
    user_id: "user_1",
    name: "Session",
    created_at: now,
    updated_at: now,
    audio_assets: [],
    beat_file_url: null,
    beat_filename: null,
    vocal_versions: [],
    current_vocal_index: 0,
    generated_chains,
    vocal_architecture: null,
    mix_room_report: null,
    level_lab_report: null,
    stem_split_url: null,
    last_opened_at: now,
  };
}

describe("vocal architecture helpers", () => {
  it("creates Lead by default and leaves supporting roles uncreated", () => {
    const architecture = getProjectVocalArchitecture(project());

    expect(architecture.active_role_id).toBe("lead");
    expect(architecture.roles.lead.status).toBe("created");
    expect(architecture.roles.tight_double.status).toBe("uncreated");
    expect(architecture.roles.vocal_bus.evidence_source).toBe("unknown");
  });

  it("treats legacy untagged chains as Lead chains", () => {
    const legacyProject = project([chain("legacy_chain")]);
    const architecture = getProjectVocalArchitecture(legacyProject);

    expect(architecture.roles.lead.chain_id).toBe("legacy_chain");
    expect(architecture.roles.lead.evidence_source).toBe("measured_role");
    expect(getGeneratedChainForRole(legacyProject, "lead")?.id).toBe("legacy_chain");
  });

  it("discovers role-stamped chains when architecture json is missing", () => {
    const wideProject = project([chain("wide_chain", "wide_double")]);
    const architecture = getProjectVocalArchitecture(wideProject);

    expect(architecture.roles.wide_double.status).toBe("created");
    expect(architecture.roles.wide_double.chain_id).toBe("wide_chain");
    expect(getGeneratedChainForRole(wideProject, "wide_double")?.id).toBe("wide_chain");
  });

  it("upserts role chains and active role without mutating the project", () => {
    const baseProject = project([chain("lead_chain")]);
    const next = upsertVocalRoleChain(baseProject, "tight_double", "tight_chain", "lead_derived", {
      sourceAssetId: "asset_1",
      derivedFromChainId: "lead_chain",
      now,
    });

    expect(next.active_role_id).toBe("tight_double");
    expect(next.roles.tight_double.status).toBe("created");
    expect(next.roles.tight_double.source_asset_id).toBe("asset_1");
    expect(next.roles.tight_double.derived_from_chain_id).toBe("lead_chain");
    expect(baseProject.vocal_architecture).toBeNull();
  });

  it("sets the active role while preserving existing role state", () => {
    const baseProject = project([chain("lead_chain")]);
    const architecture = upsertVocalRoleChain(baseProject, "tight_double", "tight_chain", "lead_derived", {
      now,
    });
    const nextProject = { ...baseProject, vocal_architecture: architecture };

    expect(setActiveVocalRole(nextProject, "lead").roles.tight_double.chain_id).toBe("tight_chain");
  });
});
