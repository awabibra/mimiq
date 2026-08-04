import { NextResponse } from "next/server";
import type { StemSplitJobResponse } from "@/lib/types";
import {
  assertAuthenticatedRequest,
  assertProjectAssetOwnership,
  assetResolutionResponse,
} from "@/lib/serverProjectAudio";
import { readStemJobToken } from "@/lib/serverStemJob";

function withLocalStemUrls(
  data: StemSplitJobResponse,
  jobToken: string
): StemSplitJobResponse {
  if (!data.stems) {
    return data;
  }

  return {
    ...data,
    stems: Object.fromEntries(
      Object.entries(data.stems).map(([key, stem]) => [
        key,
        {
          ...stem,
          url: `/api/split-stems/${data.job_id}/files/${key}?jobToken=${encodeURIComponent(jobToken)}`,
        },
      ])
    ),
  };
}

async function readServiceError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string; message?: string };
    return data.message || data.detail || "Stem split job is unavailable.";
  } catch {
    return text || "Stem split job is unavailable.";
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const url = new URL(req.url);
  const jobToken = url.searchParams.get("jobToken") ?? "";
  const claims = readStemJobToken(jobToken);
  if (!claims || claims.jobId !== jobId) {
    return NextResponse.json(
      { error: "stem_job_forbidden", message: "Stem split job access is invalid." },
      { status: 403 }
    );
  }

  try {
    const userId = await assertAuthenticatedRequest(req);
    if (claims.projectId.startsWith("user:")) {
      if (claims.projectId !== `user:${userId}`) {
        return NextResponse.json(
          { error: "stem_job_forbidden", message: "Stem split job belongs to another user." },
          { status: 403 }
        );
      }
    } else {
      await assertProjectAssetOwnership({
        req,
        projectId: claims.projectId,
        assetId: claims.sourceAssetId,
        allowedKinds: ["full_song", "beat", "stem"],
        label: "Stem source",
      });
    }
  } catch (error) {
    const response = assetResolutionResponse(error);
    if (response) return response;
    throw error;
  }
  const serviceUrl = process.env.AUDIO_SERVICE_URL;

  if (!serviceUrl) {
    return NextResponse.json(
      {
        error: "audio_service_unavailable",
        message: "Audio service is not configured for stem splitting.",
      },
      { status: 503 }
    );
  }

  const res = await fetch(`${serviceUrl}/api/split-stems/${jobId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "stem_job_unavailable", message: await readServiceError(res) },
      { status: res.status }
    );
  }

  const payload = (await res.json()) as StemSplitJobResponse;
  return NextResponse.json(withLocalStemUrls(payload, jobToken));
}
