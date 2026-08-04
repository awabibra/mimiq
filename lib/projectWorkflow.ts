import {
  getLatestProcessedVocalAsset,
  getPrimaryBeatAsset,
  getPrimaryVocalAsset,
  getProcessedVocalAsset,
} from "@/lib/projectAudio";
import { saveProjectPatch } from "@/lib/projects";
import { supabase } from "@/lib/supabase";
import type {
  AnalysisRun,
  DiagnosisFinding,
  MixPlan,
  PluginBundleId,
  PluginCapability,
  PluginCatalogEntry,
  PluginInstruction,
  Project,
  ProjectTargetProfile,
  SupportedDaw,
  WorkflowStage,
  WorkflowStageStatus,
} from "@/lib/types";

export const WORKFLOW_ANALYSIS_VERSION = "mimiq-diagnosis-v2";
export const PLUGIN_CATALOGUE_VERSION = "stock-v1";

export function defaultTargetProfile(): ProjectTargetProfile {
  return {
    upfront: 0.65,
    bright: 0.5,
    atmospheric: 0.25,
    dynamic: 0.45,
    obviousTuning: 0.3,
    wideSupport: 0.4,
    directionNote: null,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeTargetProfile(value: unknown): ProjectTargetProfile {
  const fallback = defaultTargetProfile();
  if (!value || typeof value !== "object") return fallback;
  const target = value as Partial<ProjectTargetProfile>;
  const axis = (candidate: unknown, defaultValue: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(1, Math.max(0, candidate))
      : defaultValue;

  return {
    upfront: axis(target.upfront, fallback.upfront),
    bright: axis(target.bright, fallback.bright),
    atmospheric: axis(target.atmospheric, fallback.atmospheric),
    dynamic: axis(target.dynamic, fallback.dynamic),
    obviousTuning: axis(target.obviousTuning, fallback.obviousTuning),
    wideSupport: axis(target.wideSupport, fallback.wideSupport),
    directionNote:
      typeof target.directionNote === "string"
        ? target.directionNote
        : typeof (target as { inspirationLabel?: unknown }).inspirationLabel === "string"
          ? (target as { inspirationLabel: string }).inspirationLabel
          : null,
    updatedAt:
      typeof target.updatedAt === "string" ? target.updatedAt : fallback.updatedAt,
  };
}

export function workflowContextFingerprint(params: {
  project: Project;
  daw: SupportedDaw;
  plugins: PluginBundleId[];
  stage?: Exclude<WorkflowStage, "setup">;
}) {
  const stage = params.stage ?? "prepare";
  const target = normalizeTargetProfile(params.project.target_profile);
  const vocal = getPrimaryVocalAsset(params.project);
  const beat = getPrimaryBeatAsset(params.project);
  const processed = getLatestProcessedVocalAsset(params.project);
  const includesBeat = stage === "buses" || stage === "match_beat";
  const includesPlanContext = stage !== "prepare";
  return JSON.stringify({
    stage,
    vocalAssetId: vocal?.id ?? null,
    beatAssetId: includesBeat ? beat?.id ?? null : null,
    processedAssetId: stage === "match_beat" ? processed?.id ?? null : null,
    timelineStartSeconds: includesBeat ? vocal?.timelineStartSeconds ?? null : null,
    target: includesPlanContext ? target : null,
    daw: includesPlanContext ? params.daw : null,
    plugins: includesPlanContext ? [...params.plugins].sort() : [],
  });
}

export function deriveWorkflowStageStatuses(params: {
  project: Project;
  activeRun: AnalysisRun | null;
  activePlan: MixPlan | null;
  verificationRuns: AnalysisRun[];
  contextFingerprints: Record<
    Exclude<WorkflowStage, "setup">,
    string
  >;
}): WorkflowStageStatus[] {
  const vocal = getPrimaryVocalAsset(params.project);
  const beat = getPrimaryBeatAsset(params.project);
  const latestProcessed = getLatestProcessedVocalAsset(params.project);
  const busPrint = getProcessedVocalAsset(params.project, "buses");
  const setupComplete = Boolean(vocal);
  const alignmentReady = Boolean(
    vocal &&
      beat &&
      vocal.alignedBeatAssetId === beat.id &&
      typeof vocal.timelineStartSeconds === "number"
  );
  const diagnosisOutdated = Boolean(
    params.activeRun &&
      params.activeRun.provenance.contextFingerprint !==
        params.contextFingerprints.prepare
  );
  const diagnosisComplete = Boolean(
    params.activeRun &&
      !diagnosisOutdated &&
      params.activeRun.provenance.status === "ok" &&
      params.activeRun.provenance.skippedMeasurements.length === 0
  );
  const diagnosisPartial = Boolean(
    params.activeRun && !diagnosisOutdated && !diagnosisComplete
  );
  const planOutdated = Boolean(
    params.activePlan &&
      (!diagnosisComplete || params.activePlan.analysis_run_id !== params.activeRun?.id)
  );
  const planComplete = Boolean(params.activePlan) && !planOutdated;
  const verificationFor = (stage: "main_chain" | "buses" | "match_beat") =>
    params.verificationRuns.find(
      (run) => run.provenance.verificationStage === stage
    ) ??
    (stage === "match_beat"
      ? params.verificationRuns.find(
          (run) => run.provenance.verificationStage == null
        ) ?? null
      : null);
  const chainVerification = verificationFor("main_chain");
  const busVerification = verificationFor("buses");
  const matchVerification = verificationFor("match_beat");
  const verificationOutdated = Boolean(
    matchVerification &&
      (!planComplete ||
        matchVerification.provenance.contextFingerprint !==
          params.contextFingerprints.match_beat)
  );

  return [
    {
      stage: "setup",
      state: setupComplete ? "complete" : "in_progress",
      label: setupComplete ? "Complete" : "Upload needed",
      reason: setupComplete
        ? "The raw vocal is ready. Beat and direction can be changed here at any time."
        : "Add one consolidated raw vocal to run measured workflow actions.",
      blocked: false,
    },
    {
      stage: "prepare",
      state: !setupComplete
        ? "preview"
        : diagnosisOutdated
        ? "outdated"
        : diagnosisComplete
          ? "complete"
          : diagnosisPartial
            ? "needs_attention"
            : "ready",
      label: !setupComplete
        ? "Preview"
        : diagnosisOutdated
        ? "Recheck"
        : diagnosisComplete
          ? "Complete"
          : diagnosisPartial
            ? "Review"
            : "Ready",
      reason: !setupComplete
        ? "Explore what Vocal Check measures, then add a raw vocal in Setup."
        : diagnosisOutdated
        ? "The source, intent, DAW, or plugin context changed after the vocal check."
        : diagnosisComplete
          ? "The raw vocal has current measured performance evidence."
          : setupComplete
            ? "The raw vocal is ready for Vocal Check."
            : "Add a raw vocal in Setup.",
      blocked: false,
    },
    {
      stage: "main_chain",
      state: !setupComplete
        ? "preview"
        : diagnosisOutdated || planOutdated
        ? "outdated"
        : planComplete
          ? "complete"
          : diagnosisComplete
            ? "ready"
            : "needs_attention",
      label: !setupComplete
        ? "Preview"
        : diagnosisOutdated || planOutdated
        ? "Rebuild"
        : planComplete
          ? "Complete"
          : diagnosisComplete
            ? "Ready"
            : "Needs check",
      reason: diagnosisOutdated || planOutdated
        ? "The measured source changed after this main-chain plan."
        : planComplete
          ? chainVerification
            ? "The chain plan and optional processed-vocal check are saved."
            : "Every main-chain action is tied to the active vocal check."
          : "Run the vocal check before generating catalogue-backed settings.",
      blocked: false,
    },
    {
      stage: "buses",
      state: !setupComplete || !planComplete
        ? "preview"
        : !beat || !alignmentReady
          ? "needs_attention"
          : busVerification || busPrint
            ? "complete"
            : "ready",
      label: !setupComplete || !planComplete
        ? "Preview"
        : !beat
          ? "Needs beat"
          : !alignmentReady
            ? "Needs alignment"
            : busVerification || busPrint
              ? "Complete"
              : "Ready",
      reason: !planComplete
        ? "Explore the bus workflow, then build the main chain to use it."
        : !beat
          ? "Add the beat in Setup before applying beat-aware bus guidance."
          : !alignmentReady
            ? "Confirm where vocal 0:00 begins on the beat timeline."
            : "Bus choices can use the active chain and aligned beat.",
      blocked: false,
    },
    {
      stage: "match_beat",
      state: !setupComplete || !planComplete
        ? "preview"
        : !latestProcessed || !beat || !alignmentReady
          ? "needs_attention"
          : verificationOutdated
        ? "outdated"
        : matchVerification
          ? "complete"
          : "ready",
      label: !setupComplete || !planComplete
        ? "Preview"
        : !latestProcessed
          ? "Needs processed vocal"
          : !beat
            ? "Needs beat"
            : !alignmentReady
              ? "Needs alignment"
              : verificationOutdated
        ? "Outdated"
        : matchVerification
          ? "Complete"
          : "Ready",
      reason: !planComplete
        ? "Explore the final context check, then complete Vocal Chain first."
        : !latestProcessed
          ? "Upload or reuse the latest processed vocal for the final comparison."
          : !beat
            ? "Add a separate beat in Setup."
            : !alignmentReady
              ? "Align the vocal start to the beat timeline."
              : verificationOutdated
        ? "The inputs or active chain changed after the last print check."
        : matchVerification
          ? "The latest processed vocal and beat have current measured context."
          : "The processed vocal and aligned beat are ready for the final match check.",
      blocked: false,
    },
  ];
}

export async function listProjectAnalysisRuns(projectId: string) {
  const { data, error } = await supabase
    .from("project_analysis_runs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AnalysisRun[];
}

export async function listProjectMixPlans(projectId: string) {
  const { data, error } = await supabase
    .from("project_mix_plans")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MixPlan[];
}

export async function saveAnalysisRun(
  projectId: string,
  run: Omit<AnalysisRun, "id" | "project_id" | "created_at">
) {
  const { data, error } = await supabase
    .from("project_analysis_runs")
    .insert({ project_id: projectId, ...run })
    .select("*")
    .single();
  if (error) throw error;

  const saved = data as AnalysisRun;
  if (saved.run_type === "diagnosis") {
    await saveProjectPatch(projectId, { active_analysis_run_id: saved.id });
  }
  return saved;
}

export async function listCertifiedPlugins() {
  const { data, error } = await supabase
    .from("plugin_catalog")
    .select("*")
    .eq("coverage_status", "certified");
  if (error) throw error;
  return (data ?? []) as PluginCatalogEntry[];
}

function pluginForCapability(params: {
  capability: PluginCapability;
  catalog: PluginCatalogEntry[];
  daw: SupportedDaw;
  plugins: PluginBundleId[];
}) {
  const matches = params.catalog.filter(
    (entry) =>
      entry.coverage_status === "certified" && entry.capability === params.capability
  );
  return (
    matches.find(
      (entry) => entry.bundle_id && params.plugins.includes(entry.bundle_id)
    ) ?? matches.find((entry) => entry.stock && entry.daw === params.daw) ?? null
  );
}

function instructionParameters(
  finding: DiagnosisFinding,
  plugin: PluginCatalogEntry | null
): Record<string, number | string> {
  const low = finding.evidence.frequencyLowHz ?? 2000;
  const high = finding.evidence.frequencyHighHz ?? low;
  const center = Math.round((low + high) / 2);
  const gain = finding.severity === "high" ? -3 : finding.severity === "medium" ? -2 : -1.5;

  if (finding.suggestedCapability === "compressor") {
    return { threshold_db: -18, ratio: 3, attack_ms: 15, release_ms: 100 };
  }
  if (finding.suggestedCapability === "de_esser") {
    return { frequency_hz: center || 7000, reduction_db: Math.abs(gain) };
  }
  if (finding.suggestedCapability === "pitch") {
    return { mode: "starting_point_only" };
  }
  if (plugin?.id === "fl-parametric-eq-2") {
    return { frequency_hz: center, gain_db: gain, bandwidth_octaves: 1 };
  }
  return { frequency_hz: center, gain_db: gain, q: 1.4 };
}

function formatInstruction(
  plugin: PluginCatalogEntry | null,
  parameters: Record<string, number | string>
) {
  if (!plugin) return "No certified plugin path is available for this capability.";
  if (typeof parameters.frequency_hz === "number") {
    const frequency = parameters.frequency_hz >= 1000
      ? `${(parameters.frequency_hz / 1000).toFixed(1)} kHz`
      : `${parameters.frequency_hz} Hz`;
    const gain = typeof parameters.gain_db === "number" ? `, ${parameters.gain_db.toFixed(1)} dB` : "";
    const q = typeof parameters.q === "number" ? `, Q ${parameters.q.toFixed(1)}` : "";
    return `${plugin.name}: ${frequency}${gain}${q}`;
  }
  if (typeof parameters.threshold_db === "number") {
    return `${plugin.name}: threshold ${parameters.threshold_db} dB, ratio ${parameters.ratio}:1`;
  }
  return `${plugin.name}: use the bounded starting values shown below.`;
}

export function buildDeterministicMixPlan(params: {
  projectId: string;
  run: AnalysisRun;
  target: ProjectTargetProfile;
  catalog: PluginCatalogEntry[];
  daw: SupportedDaw;
  plugins: PluginBundleId[];
}): Omit<MixPlan, "id" | "created_at" | "updated_at"> {
  const ordered = params.run.findings
    .filter((finding) => finding.suggestedCapability !== null)
    .sort((a, b) => a.impactRank - b.impactRank);
  const instructions: PluginInstruction[] = ordered.map((finding, index) => {
    const capability = finding.suggestedCapability as PluginCapability;
    const plugin = pluginForCapability({
      capability,
      catalog: params.catalog,
      daw: params.daw,
      plugins: params.plugins,
    });
    const parameters = instructionParameters(finding, plugin);
    return {
      id: `${finding.id}-${capability}`,
      order: index + 1,
      findingId: finding.id,
      capability,
      pluginCatalogId: plugin?.id ?? null,
      pluginName: plugin?.name ?? null,
      manufacturer: plugin?.manufacturer ?? null,
      parameters,
      action: formatInstruction(plugin, parameters),
      why: finding.whyItMatters,
      evidence: finding.evidence,
      certified: Boolean(plugin),
      unsupportedReason: plugin
        ? null
        : `No certified ${capability.replace("_", "-")} is available for ${params.daw} or your selected bundles.`,
    };
  });

  return {
    project_id: params.projectId,
    analysis_run_id: params.run.id,
    target_profile: params.target,
    plugin_catalogue_version: PLUGIN_CATALOGUE_VERSION,
    instructions,
    completion_state: Object.fromEntries(instructions.map((instruction) => [instruction.id, false])),
  };
}

export async function saveMixPlan(
  plan: Omit<MixPlan, "id" | "created_at" | "updated_at">
) {
  const { data, error } = await supabase
    .from("project_mix_plans")
    .insert(plan)
    .select("*")
    .single();
  if (error) throw error;

  const saved = data as MixPlan;
  await saveProjectPatch(plan.project_id, { active_mix_plan_id: saved.id });
  return saved;
}

export async function updateMixPlanCompletion(
  planId: string,
  completionState: Record<string, boolean>
) {
  const { data, error } = await supabase
    .from("project_mix_plans")
    .update({ completion_state: completionState, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .select("*")
    .single();
  if (error) throw error;
  return data as MixPlan;
}
