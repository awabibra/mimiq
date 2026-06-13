import { NextResponse } from "next/server";
import type { StemSplitJobResponse } from "@/lib/types";

function withLocalStemUrls(data: StemSplitJobResponse): StemSplitJobResponse {
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
          url: `/api/split-stems/${data.job_id}/files/${key}`,
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
  _req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
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
  return NextResponse.json(withLocalStemUrls(payload));
}
