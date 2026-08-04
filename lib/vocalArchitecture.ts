import type {
  GeneratedChain,
  Project,
  ProjectVocalArchitecture,
  ProjectVocalRole,
  VocalRoleEvidenceSource,
  VocalRoleId,
} from "@/lib/types";

export const VOCAL_ARCHITECTURE_VERSION = 1;

export const vocalRoles = [
  {
    id: "lead",
    label: "Lead",
    shortLabel: "Lead",
    description: "Main performance. Center, forward, and the anchor for every other vocal layer.",
    createLabel: "Lead is ready",
  },
  {
    id: "tight_double",
    label: "Tight Double",
    shortLabel: "Tight",
    description: "Separate take under the lead for glue. Low-passed around 8 kHz and felt more than heard.",
    createLabel: "Create tight double",
  },
  {
    id: "wide_double",
    label: "Wide Double",
    shortLabel: "Wide",
    description: "Separate take for size. Wider pan, heavier filtering, and almost no tonal footprint.",
    createLabel: "Create wide double",
  },
  {
    id: "harmonies",
    label: "Harmonies",
    shortLabel: "Harm",
    description: "Filtered 3rds or 5ths for emotional weight, with aggressive de-essing for stacked consonants.",
    createLabel: "Create harmonies",
  },
  {
    id: "adlibs",
    label: "Adlibs",
    shortLabel: "Adlib",
    description: "Character layer with its own effects pocket, shorter reverb, and higher-energy movement.",
    createLabel: "Create adlibs",
  },
  {
    id: "backing_bus",
    label: "Backing Bus",
    shortLabel: "Back Bus",
    description: "Glue bus for doubles, harmonies, and adlibs so the stack can move as one unit.",
    createLabel: "Create backing bus",
  },
  {
    id: "vocal_bus",
    label: "Vocal Bus",
    shortLabel: "Vox Bus",
    description: "Final vocal glue where Lead and Backing Bus become one cohesive vocal element.",
    createLabel: "Create vocal bus",
  },
] as const satisfies readonly {
  id: VocalRoleId;
  label: string;
  shortLabel: string;
  description: string;
  createLabel: string;
}[];

export const vocalRoleIds = vocalRoles.map((role) => role.id) as VocalRoleId[];
export const defaultVocalRoleId: VocalRoleId = "lead";

export function isVocalRoleId(value: unknown): value is VocalRoleId {
  return typeof value === "string" && vocalRoleIds.includes(value as VocalRoleId);
}

export function getVocalRoleMeta(roleId: VocalRoleId) {
  return vocalRoles.find((role) => role.id === roleId) ?? vocalRoles[0];
}

function isGeneratedChain(entry: unknown): entry is GeneratedChain {
  return Boolean(
    entry &&
      typeof entry === "object" &&
      "chain_data" in entry &&
      Array.isArray((entry as GeneratedChain).chain_data?.chain)
  );
}

function emptyRole(roleId: VocalRoleId): ProjectVocalRole {
  return {
    id: roleId,
    status: roleId === "lead" ? "created" : "uncreated",
    chain_id: null,
    source_asset_id: null,
    evidence_source: roleId === "lead" ? "saved_project_data" : "unknown",
    created_at: null,
    updated_at: null,
    derived_from_chain_id: null,
  };
}

function readRole(value: unknown, roleId: VocalRoleId): ProjectVocalRole {
  if (!value || typeof value !== "object") return emptyRole(roleId);
  const role = value as Partial<ProjectVocalRole>;

  return {
    ...emptyRole(roleId),
    id: roleId,
    status: role.status === "created" || role.status === "uncreated" ? role.status : emptyRole(roleId).status,
    chain_id: typeof role.chain_id === "string" ? role.chain_id : null,
    source_asset_id: typeof role.source_asset_id === "string" ? role.source_asset_id : null,
    evidence_source: isEvidenceSource(role.evidence_source)
      ? role.evidence_source
      : emptyRole(roleId).evidence_source,
    created_at: typeof role.created_at === "string" ? role.created_at : null,
    updated_at: typeof role.updated_at === "string" ? role.updated_at : null,
    derived_from_chain_id:
      typeof role.derived_from_chain_id === "string" ? role.derived_from_chain_id : null,
  };
}

function isEvidenceSource(value: unknown): value is VocalRoleEvidenceSource {
  return (
    value === "measured_role" ||
    value === "lead_derived" ||
    value === "saved_project_data" ||
    value === "unknown"
  );
}

function legacyLeadChain(project: Project | null | undefined) {
  return (
    project?.generated_chains
      ?.filter(isGeneratedChain)
      .find((chain) => !chain.chain_data.vocal_role_id || chain.chain_data.vocal_role_id === "lead") ??
    null
  );
}

export function getProjectVocalArchitecture(
  project: Project | null | undefined
): ProjectVocalArchitecture {
  const raw = project?.vocal_architecture;
  const legacyLead = legacyLeadChain(project);
  const roles = vocalRoleIds.reduce(
    (next, roleId) => {
      const rawRole =
        raw && typeof raw === "object" && "roles" in raw
          ? (raw.roles as Partial<Record<VocalRoleId, unknown>> | undefined)?.[roleId]
          : null;
      next[roleId] = readRole(rawRole, roleId);
      return next;
    },
    {} as Record<VocalRoleId, ProjectVocalRole>
  );

  if (!roles.lead.chain_id && legacyLead) {
    roles.lead = {
      ...roles.lead,
      status: "created",
      chain_id: legacyLead.id,
      source_asset_id: legacyLead.chain_data.sourceAssetId ?? null,
      evidence_source: legacyLead.chain_data.audio_service_status === "ok" ? "measured_role" : "saved_project_data",
      created_at: legacyLead.created_at,
      updated_at: legacyLead.created_at,
    };
  }

  const chains = project?.generated_chains?.filter(isGeneratedChain) ?? [];
  for (const roleId of vocalRoleIds) {
    if (roles[roleId].chain_id) continue;
    const roleChain = chains.find((chain) => chain.chain_data.vocal_role_id === roleId);
    if (!roleChain) continue;

    roles[roleId] = {
      ...roles[roleId],
      status: "created",
      chain_id: roleChain.id,
      source_asset_id: roleChain.chain_data.sourceAssetId ?? null,
      evidence_source: roleChain.chain_data.role_source ?? roles[roleId].evidence_source,
      created_at: roleChain.created_at,
      updated_at: roleChain.created_at,
      derived_from_chain_id: roleChain.chain_data.derived_from_chain_id ?? null,
    };
  }

  const activeRoleId =
    raw && typeof raw === "object" && isVocalRoleId(raw.active_role_id)
      ? raw.active_role_id
      : defaultVocalRoleId;

  return {
    version: VOCAL_ARCHITECTURE_VERSION,
    active_role_id: activeRoleId,
    roles,
  };
}

export function getVocalRole(
  project: Project | null | undefined,
  roleId: VocalRoleId
) {
  return getProjectVocalArchitecture(project).roles[roleId];
}

export function getGeneratedChainForRole(
  project: Project | null | undefined,
  roleId: VocalRoleId
) {
  const role = getVocalRole(project, roleId);
  const chains = project?.generated_chains?.filter(isGeneratedChain) ?? [];

  return (
    chains.find((chain) => chain.id === role.chain_id) ??
    chains.find((chain) => chain.chain_data.vocal_role_id === roleId) ??
    (roleId === "lead" ? legacyLeadChain(project) : null)
  );
}

export function upsertVocalRoleChain(
  project: Project | null | undefined,
  roleId: VocalRoleId,
  chainId: string,
  evidence: VocalRoleEvidenceSource,
  params?: {
    sourceAssetId?: string | null;
    derivedFromChainId?: string | null;
    now?: string;
  }
) {
  const now = params?.now ?? new Date().toISOString();
  const architecture = getProjectVocalArchitecture(project);

  return {
    ...architecture,
    active_role_id: roleId,
    roles: {
      ...architecture.roles,
      [roleId]: {
        ...architecture.roles[roleId],
        status: "created",
        chain_id: chainId,
        source_asset_id: params?.sourceAssetId ?? architecture.roles[roleId].source_asset_id,
        evidence_source: evidence,
        created_at: architecture.roles[roleId].created_at ?? now,
        updated_at: now,
        derived_from_chain_id:
          params?.derivedFromChainId ?? architecture.roles[roleId].derived_from_chain_id,
      },
    },
  } satisfies ProjectVocalArchitecture;
}

export function setActiveVocalRole(
  project: Project | null | undefined,
  roleId: VocalRoleId
) {
  return {
    ...getProjectVocalArchitecture(project),
    active_role_id: roleId,
  } satisfies ProjectVocalArchitecture;
}
