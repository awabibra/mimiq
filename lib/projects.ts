import { supabase } from "@/lib/supabase";
import type { AudioAssetKind, Project, ProjectPatch } from "@/lib/types";

const PROJECT_FILE_BUCKET = "project-files";

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

  return (data ?? []) as Project[];
}

export async function getProjectRecord(projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error) throw error;

  return data as Project;
}

export async function createProjectRecord(name: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: name.trim(),
      user_id: userId,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[projects] Supabase error code:", error.code);
    console.error("[projects] Supabase error message:", error.message);
    console.error("[projects] Supabase error details:", error.details);
    console.error("[projects] Supabase error hint:", error.hint);
    throw error;
  }

  return data as Project;
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

  return data as Project;
}

export async function saveProjectPatch(projectId: string, patch: ProjectPatch) {
  const { data, error } = await supabase
    .from("projects")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .select("*")
    .single();

  if (error) throw error;

  return data as Project;
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
