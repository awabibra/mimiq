import { NextResponse } from "next/server";

async function readServiceError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string; message?: string };
    return data.message || data.detail || "Stem ZIP package is unavailable.";
  } catch {
    return text || "Stem ZIP package is unavailable.";
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

  const res = await fetch(`${serviceUrl}/api/split-stems/${jobId}/zip`, {
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    const message = await readServiceError(res);
    return NextResponse.json(
      { error: "stem_zip_unavailable", message },
      { status: res.status }
    );
  }

  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/zip");
  headers.set(
    "content-disposition",
    res.headers.get("content-disposition") || `attachment; filename="stem-${jobId}.zip"`
  );

  return new NextResponse(res.body, {
    status: 200,
    headers,
  });
}
