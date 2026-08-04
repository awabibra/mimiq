import { supabase } from "@/lib/supabase";
import type {
  AudioAssetKind,
  AudioAssetStatus,
  ProcessedVocalStage,
  Project,
  ProjectAudioAsset,
} from "@/lib/types";
import { downloadProjectAudio, uploadProjectAudio } from "@/lib/projects";

export const PROJECT_AUDIO_MAX_SIZE = 50 * 1024 * 1024;
export const PROJECT_AUDIO_EXTENSIONS = [".wav", ".mp3", ".flac", ".aif", ".aiff"];

const PLAYBACK_URL_TTL_SECONDS = 60 * 60;

const newAssetId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
};

export function isNonDurableAudioUrl(value: unknown) {
  return (
    typeof value === "string" &&
    (value.startsWith("blob:") ||
      value.startsWith("data:") ||
      value.startsWith("filesystem:"))
  );
}

function isAudioAssetStatus(value: unknown): value is AudioAssetStatus {
  return value === "local" || value === "uploading" || value === "ready" || value === "failed";
}

function isAudioAssetKind(value: unknown): value is AudioAssetKind {
  return (
    value === "full_song" ||
    value === "vocal" ||
    value === "beat" ||
    value === "stem" ||
    value === "reference" ||
    value === "processed"
  );
}

function isProcessedVocalStage(value: unknown): value is ProcessedVocalStage {
  return value === "main_chain" || value === "buses" || value === "match_beat";
}

function legacyAsset(params: {
  id?: string | null;
  kind: AudioAssetKind;
  filename?: string | null;
  storagePath?: string | null;
  createdAt?: string | null;
  mimeType?: string;
}): ProjectAudioAsset | null {
  if (!params.storagePath || isNonDurableAudioUrl(params.storagePath)) return null;

  return {
    id: params.id ?? newAssetId(),
    kind: params.kind,
    filename: params.filename || `${params.kind}.wav`,
    mimeType: params.mimeType ?? "audio/mpeg",
    size: 0,
    duration: null,
    storagePath: params.storagePath,
    createdAt: params.createdAt ?? new Date().toISOString(),
    status: "ready",
    error: null,
  };
}

export function normalizeAudioAsset(value: unknown): ProjectAudioAsset | null {
  if (!value || typeof value !== "object") return null;
  const asset = value as Partial<ProjectAudioAsset>;
  if (!isAudioAssetKind(asset.kind)) return null;
  if (!asset.id || !asset.filename) return null;
  if (asset.storagePath && isNonDurableAudioUrl(asset.storagePath)) return null;

  return {
    id: String(asset.id),
    kind: asset.kind,
    filename: String(asset.filename),
    mimeType: typeof asset.mimeType === "string" ? asset.mimeType : "audio/mpeg",
    size: typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : 0,
    duration:
      typeof asset.duration === "number" && Number.isFinite(asset.duration)
        ? asset.duration
        : null,
    storagePath: typeof asset.storagePath === "string" ? asset.storagePath : null,
    createdAt: typeof asset.createdAt === "string" ? asset.createdAt : new Date().toISOString(),
    status: isAudioAssetStatus(asset.status) ? asset.status : "ready",
    error: typeof asset.error === "string" ? asset.error : null,
    processingStage: isProcessedVocalStage(asset.processingStage)
      ? asset.processingStage
      : null,
    sourceAssetId:
      typeof asset.sourceAssetId === "string" ? asset.sourceAssetId : null,
    alignedBeatAssetId:
      typeof asset.alignedBeatAssetId === "string"
        ? asset.alignedBeatAssetId
        : null,
    timelineStartSeconds:
      typeof asset.timelineStartSeconds === "number" &&
      Number.isFinite(asset.timelineStartSeconds)
        ? Math.max(0, asset.timelineStartSeconds)
        : null,
  };
}

export function getProjectAudioAssets(project: Project | null | undefined) {
  if (!project) return [];

  const canonical = Array.isArray(project.audio_assets)
    ? project.audio_assets.map(normalizeAudioAsset).filter(Boolean)
    : [];

  if (canonical.length > 0) return canonical as ProjectAudioAsset[];

  const legacyVocals = (project.vocal_versions ?? [])
    .map((version) =>
      legacyAsset({
        id: version.id,
        kind: "vocal",
        filename: version.filename,
        storagePath: version.url,
        createdAt: version.uploaded_at,
      })
    )
    .filter(Boolean) as ProjectAudioAsset[];
  const legacyBeat = legacyAsset({
    kind: "beat",
    filename: project.beat_filename,
    storagePath: project.beat_file_url,
    createdAt: project.created_at,
  });
  const legacyStem = legacyAsset({
    kind: "stem",
    filename: "stem-split.zip",
    storagePath: project.stem_split_url,
    createdAt: project.updated_at,
    mimeType: "application/zip",
  });

  return [...legacyVocals, legacyBeat, legacyStem].filter(Boolean) as ProjectAudioAsset[];
}

export function getAssetsByKind(
  project: Project | null | undefined,
  kind: AudioAssetKind
) {
  return getProjectAudioAssets(project).filter((asset) => asset.kind === kind);
}

export function getPrimaryVocalAsset(project: Project | null | undefined) {
  return getAssetsByKind(project, "vocal").find((asset) => asset.status === "ready") ?? null;
}

export function getPrimaryBeatAsset(project: Project | null | undefined) {
  return getAssetsByKind(project, "beat").find((asset) => asset.status === "ready") ?? null;
}

export function getFullSongAsset(project: Project | null | undefined) {
  return getAssetsByKind(project, "full_song").find((asset) => asset.status === "ready") ?? null;
}

export function getProcessedVocalAsset(
  project: Project | null | undefined,
  stage?: ProcessedVocalStage
) {
  return (
    getAssetsByKind(project, "processed").find(
      (asset) =>
        asset.status === "ready" &&
        (!stage || asset.processingStage === stage)
    ) ?? null
  );
}

export function getLatestProcessedVocalAsset(
  project: Project | null | undefined
) {
  return (
    getProcessedVocalAsset(project, "match_beat") ??
    getProcessedVocalAsset(project, "buses") ??
    getProcessedVocalAsset(project, "main_chain") ??
    getProcessedVocalAsset(project)
  );
}

export function getPrimaryVocalOrFullSongAsset(project: Project | null | undefined) {
  return getPrimaryVocalAsset(project) ?? getFullSongAsset(project);
}

export function upsertProjectAudioAsset(
  assets: ProjectAudioAsset[],
  asset: ProjectAudioAsset
) {
  const next = assets.filter((item) => item.id !== asset.id);
  return [asset, ...next];
}

export function updateProjectAudioAsset(
  assets: ProjectAudioAsset[],
  assetId: string,
  patch: Partial<ProjectAudioAsset>
) {
  return assets.map((asset) =>
    asset.id === assetId ? { ...asset, ...patch } : asset
  );
}

export function createStoredAudioAsset(params: {
  kind: AudioAssetKind;
  filename: string;
  mimeType?: string;
  size?: number;
  duration?: number | null;
  storagePath: string;
  createdAt?: string;
  metadata?: Pick<
    ProjectAudioAsset,
    | "processingStage"
    | "sourceAssetId"
    | "alignedBeatAssetId"
    | "timelineStartSeconds"
  >;
}) {
  return {
    id: newAssetId(),
    kind: params.kind,
    filename: params.filename,
    mimeType: params.mimeType ?? "audio/mpeg",
    size: params.size ?? 0,
    duration: params.duration ?? null,
    storagePath: params.storagePath,
    createdAt: params.createdAt ?? new Date().toISOString(),
    status: "ready" as const,
    error: null,
    ...params.metadata,
  };
}

export async function copyAudioFile(file: File) {
  const buffer = await file.arrayBuffer();
  
  let type = file.type;
  if (!type || type === "application/octet-stream") {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".wav")) type = "audio/wav";
    else if (lower.endsWith(".mp3")) type = "audio/mpeg";
    else if (lower.endsWith(".flac")) type = "audio/flac";
    else if (lower.endsWith(".aif") || lower.endsWith(".aiff")) type = "audio/aiff";
    else type = "audio/mpeg";
  }

  return new File([buffer], file.name, {
    type,
    lastModified: file.lastModified,
  });
}

export async function readAudioDuration(file: File): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    return buffer.duration;
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export function validateProjectAudioFile(file: File) {
  const lower = file.name.toLowerCase();
  const supported = PROJECT_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
  if (!supported) return "Upload WAV, MP3, FLAC, AIFF, or AIF audio.";
  if (file.size > PROJECT_AUDIO_MAX_SIZE) return "Audio file exceeds 50 MB.";
  return null;
}

export async function prepareAudioFile(params: {
  kind: AudioAssetKind;
  file: File;
  metadata?: Pick<
    ProjectAudioAsset,
    | "processingStage"
    | "sourceAssetId"
    | "alignedBeatAssetId"
    | "timelineStartSeconds"
  >;
}) {
  const copiedFile = await copyAudioFile(params.file);
  const validationError = validateProjectAudioFile(copiedFile);
  if (validationError) throw new Error(validationError);
  const duration = await readAudioDuration(copiedFile);

  const asset: ProjectAudioAsset = {
    id: newAssetId(),
    kind: params.kind,
    filename: copiedFile.name,
    mimeType: copiedFile.type || "audio/mpeg",
    size: copiedFile.size,
    duration,
    storagePath: null,
    createdAt: new Date().toISOString(),
    status: "uploading",
    error: null,
    ...params.metadata,
  };

  return { asset, file: copiedFile };
}

export async function uploadPreparedAudioAsset(params: {
  userId: string;
  projectId: string;
  asset: ProjectAudioAsset;
  file: File;
}) {
  const storagePath = await uploadProjectAudio({
    userId: params.userId,
    projectId: params.projectId,
    kind: params.asset.kind,
    file: params.file,
  });

  return {
    ...params.asset,
    storagePath,
    status: "ready" as const,
    error: null,
  };
}

export async function getAssetPlaybackUrl(asset: ProjectAudioAsset | null | undefined) {
  if (!asset?.storagePath || isNonDurableAudioUrl(asset.storagePath)) return null;
  if (asset.storagePath.startsWith("http://") || asset.storagePath.startsWith("https://")) {
    return asset.storagePath;
  }
  if (asset.storagePath.startsWith("/api/")) return asset.storagePath;

  const { data, error } = await supabase.storage
    .from("project-files")
    .createSignedUrl(asset.storagePath, PLAYBACK_URL_TTL_SECONDS);

  if (error) return null;
  return data.signedUrl;
}

export async function resolveAssetFile(asset: ProjectAudioAsset) {
  if (!asset.storagePath || isNonDurableAudioUrl(asset.storagePath)) {
    throw new Error("Audio asset is not ready. Upload it again.");
  }

  if (asset.storagePath.startsWith("http://") || asset.storagePath.startsWith("https://")) {
    const res = await fetch(asset.storagePath);
    const blob = await res.blob();
    return new File([blob], asset.filename, {
      type: blob.type || asset.mimeType || "audio/mpeg",
    });
  }

  if (asset.storagePath.startsWith("/api/")) {
    const res = await fetch(asset.storagePath);
    const blob = await res.blob();
    return new File([blob], asset.filename, {
      type: blob.type || asset.mimeType || "audio/mpeg",
    });
  }

  return downloadProjectAudio(asset.storagePath, asset.filename);
}
