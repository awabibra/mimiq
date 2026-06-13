import { NextResponse } from "next/server";

async function readServiceError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string; message?: string };
    return data.message || data.detail || "Stem file is unavailable.";
  } catch {
    return text || "Stem file is unavailable.";
  }
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ jobId: string; stem: string }> }
) {
  const { jobId, stem } = await context.params;
  const normalizedStem = stem.toLowerCase();
  const allowed = new Set(["vocals", "drums", "bass", "other", "guitar", "piano"]);

  if (!allowed.has(normalizedStem)) {
    return NextResponse.json(
      { error: "stem_not_supported", message: "Requested stem is not supported." },
      { status: 404 }
    );
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

  const res = await fetch(
    `${serviceUrl}/api/split-stems/${jobId}/files/${normalizedStem}`,
    {
      cache: "no-store",
    }
  );

  if (!res.ok || !res.body) {
    return NextResponse.json(
      { error: "stem_file_unavailable", message: await readServiceError(res) },
      { status: res.status }
    );
  }

  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "audio/wav");
  headers.set(
    "content-disposition",
    res.headers.get("content-disposition") || `attachment; filename="${stem}.wav"`
  );

  return new NextResponse(res.body, {
    status: 200,
    headers,
  });
}
