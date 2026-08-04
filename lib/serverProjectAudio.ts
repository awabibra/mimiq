import { createClient } from "@supabase/supabase-js";
import type { Project, ProjectAudioAsset } from "@/lib/types";
import { getProjectAudioAssets, isNonDurableAudioUrl } from "@/lib/projectAudio";

const PROJECT_FILE_BUCKET = "project-files";

export class AssetResolutionError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AssetResolutionError";
    this.code = code;
    this.status = status;
  }
}

function readBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function serviceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new AssetResolutionError(
      "server_storage_unavailable",
      "Server-side audio asset resolution is not configured.",
      503
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getRequestUserId(req: Request) {
  const token = readBearerToken(req);
  if (!token) {
    throw new AssetResolutionError(
      "auth_required",
      "Sign in before analyzing project audio.",
      401
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new AssetResolutionError(
      "auth_unavailable",
      "Supabase auth is not configured.",
      503
    );
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AssetResolutionError(
      "auth_invalid",
      "Sign in again before analyzing project audio.",
      401
    );
  }

  return data.user.id;
}

export async function assertAuthenticatedRequest(req: Request) {
  return getRequestUserId(req);
}

async function getOwnedProject(req: Request, projectId: string) {
  const userId = await getRequestUserId(req);
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !data) {
    throw new AssetResolutionError("project_not_found", "Project not found.", 404);
  }

  const project = data as Project;
  if (project.user_id !== userId) {
    throw new AssetResolutionError(
      "project_forbidden",
      "Project audio is not available for this user.",
      403
    );
  }

  return { project, supabase };
}

export async function resolveProjectAssetFile(params: {
  req: Request;
  projectId: string | null;
  assetId: string | null;
  allowedKinds?: ProjectAudioAsset["kind"][];
  label: string;
}) {
  const owned = await assertProjectAssetOwnership(params);
  if (!owned) return null;
  const { asset, supabase } = owned;

  let blob: Blob;
  if (
    asset.storagePath?.startsWith("http://") ||
    asset.storagePath?.startsWith("https://")
  ) {
    const res = await fetch(asset.storagePath);
    if (!res.ok) {
      throw new AssetResolutionError(
        "asset_download_failed",
        `${params.label} asset could not be downloaded.`,
        502
      );
    }
    blob = await res.blob();
  } else {
    const { data, error } = await supabase.storage
      .from(PROJECT_FILE_BUCKET)
      .download(asset.storagePath as string);
    if (error || !data) {
      throw new AssetResolutionError(
        "asset_download_failed",
        `${params.label} asset could not be downloaded.`,
        502
      );
    }
    blob = data;
  }

  return {
    asset,
    file: new File([blob], asset.filename, {
      type: blob.type || asset.mimeType || "audio/mpeg",
    }),
  };
}

export async function assertProjectAssetOwnership(params: {
  req: Request;
  projectId: string | null;
  assetId: string | null;
  allowedKinds?: ProjectAudioAsset["kind"][];
  label: string;
}) {
  if (!params.assetId) return null;
  if (!params.projectId) {
    throw new AssetResolutionError(
      "missing_project",
      "Project ID is required to resolve project audio.",
      400
    );
  }

  const { project, supabase } = await getOwnedProject(params.req, params.projectId);
  const asset = getProjectAudioAssets(project).find(
    (candidate) => candidate.id === params.assetId
  );

  if (!asset) {
    throw new AssetResolutionError(
      "asset_not_found",
      `${params.label} asset was not found in this project.`,
      404
    );
  }
  if (asset.status !== "ready" || !asset.storagePath) {
    throw new AssetResolutionError(
      "asset_not_ready",
      `${params.label} asset is not ready yet.`,
      409
    );
  }
  if (params.allowedKinds && !params.allowedKinds.includes(asset.kind)) {
    throw new AssetResolutionError(
      "asset_kind_mismatch",
      `${params.label} asset has the wrong type.`,
      400
    );
  }
  if (isNonDurableAudioUrl(asset.storagePath)) {
    throw new AssetResolutionError(
      "asset_not_durable",
      `${params.label} asset must be uploaded to project storage first.`,
      409
    );
  }

  return { project, asset, supabase };
}

export function assetResolutionResponse(error: unknown) {
  if (error instanceof AssetResolutionError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status }
    );
  }

  return null;
}
