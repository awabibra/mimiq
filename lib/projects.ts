import { supabase } from "@/lib/supabase";
import {
  defaultGenreCategory,
  defaultGenreSubgenre,
  isGenreCategoryId,
  isGenreSubgenreId,
  type GenreCategoryId,
  type GenreSubgenreId,
} from "@/lib/genreCatalog";
import { getProjectVocalArchitecture } from "@/lib/vocalArchitecture";
import { normalizeTargetProfile } from "@/lib/projectWorkflow";
import type { AudioAssetKind, Project, ProjectPatch } from "@/lib/types";

const PROJECT_FILE_BUCKET = "project-files";
const MODERN_PROJECT_COLUMNS = [
  "genre_category",
  "genre_subgenre",
  "vocal_architecture",
  "target_profile",
  "active_analysis_run_id",
  "active_mix_plan_id",
] as const;

type ProjectMutationPayload = Record<string, unknown>;

const cleanFilename = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "audio-file";

export async function listProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("last_opened_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((project) => normalizeProjectRecord(project as Project));
}

export async function getProjectRecord(projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error) throw error;

  return normalizeProjectRecord(data as Project);
}

function normalizeProjectRecord(project: Project): Project {
  return {
    ...project,
    genre_category:
      project.genre_category && isGenreCategoryId(project.genre_category)
        ? project.genre_category
        : defaultGenreCategory,
    genre_subgenre:
      project.genre_subgenre && isGenreSubgenreId(project.genre_subgenre)
        ? project.genre_subgenre
        : defaultGenreSubgenre,
    vocal_architecture: getProjectVocalArchitecture(project),
    target_profile: normalizeTargetProfile(project.target_profile),
  };
}

function isSchemaCacheMiss(error: { code?: string } | null) {
  return error?.code === "PGRST204";
}

function withoutModernProjectColumns<T extends ProjectMutationPayload>(payload: T) {
  const next: ProjectMutationPayload = { ...payload };
  for (const column of MODERN_PROJECT_COLUMNS) {
    delete next[column];
  }
  return next;
}

export async function createProjectRecord(
  name: string,
  userId: string,
  lane?: {
    genre_category?: GenreCategoryId | string | null;
    genre_subgenre?: GenreSubgenreId | string | null;
  }
) {
  const genre_category =
    lane?.genre_category && isGenreCategoryId(lane.genre_category)
      ? lane.genre_category
      : defaultGenreCategory;
  const genre_subgenre =
    lane?.genre_subgenre && isGenreSubgenreId(lane.genre_subgenre)
      ? lane.genre_subgenre
      : defaultGenreSubgenre;

  const payload = {
    name: name.trim(),
    user_id: userId,
    genre_category,
    genre_subgenre,
    vocal_architecture: getProjectVocalArchitecture(null),
    created_at: new Date().toISOString(),
  };

  let { data, error } = await supabase
    .from("projects")
    .insert(payload)
    .select()
    .single();

  if (isSchemaCacheMiss(error)) {
    const retry = await supabase
      .from("projects")
      .insert(withoutModernProjectColumns(payload))
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error("[projects] Supabase error code:", error.code);
    console.error("[projects] Supabase error message:", error.message);
    console.error("[projects] Supabase error details:", error.details);
    console.error("[projects] Supabase error hint:", error.hint);
    throw error;
  }

  return normalizeProjectRecord(data as Project);
}

export async function touchProject(projectId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("projects")
    .update({
      last_opened_at: now,
      updated_at: now,
    })
    .eq("id", projectId)
    .select("*")
    .single();

  if (error) throw error;

  return normalizeProjectRecord(data as Project);
}

export async function saveProjectPatch(projectId: string, patch: ProjectPatch) {
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  let { data, error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId)
    .select("*")
    .single();

  if (isSchemaCacheMiss(error)) {
    const retry = await supabase
      .from("projects")
      .update(withoutModernProjectColumns(payload))
      .eq("id", projectId)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;

  return normalizeProjectRecord(data as Project);
}

export async function deleteProjectRecord(project: Project) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", project.id);

  if (error) throw error;

  const storagePaths = [
    ...(project.audio_assets ?? []).map((asset) => asset.storagePath),
    ...(project.vocal_versions ?? []).map((version) => version.url),
    project.beat_file_url,
    project.stem_split_url,
  ].filter(
    (path): path is string =>
      typeof path === "string" &&
      path.length > 0 &&
      !path.startsWith("http://") &&
      !path.startsWith("https://") &&
      !path.startsWith("/api/") &&
      !path.startsWith("blob:") &&
      !path.startsWith("data:")
  );

  if (storagePaths.length === 0) return;

  const { error: storageError } = await supabase.storage
    .from(PROJECT_FILE_BUCKET)
    .remove([...new Set(storagePaths)]);

  if (storageError) {
    console.warn("[projects] Project deleted, but some stored audio could not be removed.");
  }
}

export async function uploadProjectAudio(params: {
  userId: string;
  projectId: string;
  kind: AudioAssetKind;
  file: File;
}) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const path = `${params.userId}/${params.projectId}/${params.kind}/${id}-${cleanFilename(
    params.file.name
  )}`;

  const { error } = await supabase.storage
    .from(PROJECT_FILE_BUCKET)
    .upload(path, params.file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  return path;
}

export async function removeProjectAudio(path: string) {
  const { error } = await supabase.storage.from(PROJECT_FILE_BUCKET).remove([path]);
  if (error) throw error;
}

export async function downloadProjectAudio(path: string, filename: string) {
  const { data, error } = await supabase.storage
    .from(PROJECT_FILE_BUCKET)
    .download(path);

  if (error) throw error;

  return new File([data], filename, {
    type: data.type || "audio/mpeg",
  });
}
