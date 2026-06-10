import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function readServiceError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string; message?: string };
    return data.message || data.detail || "Vocal diagnostics failed.";
  } catch {
    return text || "Vocal diagnostics failed.";
  }
}

export async function POST(req: NextRequest) {
  try {
    const serviceUrl = process.env.AUDIO_SERVICE_URL;
    if (!serviceUrl) {
      return NextResponse.json(
        {
          error: "audio_service_unavailable",
          message: "Audio service is not configured for vocal diagnostics.",
        },
        { status: 503 }
      );
    }

    const formData = await req.formData();
    const vocal = formData.get("vocal") as File | null;

    if (!vocal) {
      return NextResponse.json(
        { error: "missing_audio", message: "Upload a .wav or .mp3 vocal." },
        { status: 400 }
      );
    }

    const lowerName = vocal.name.toLowerCase();
    if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".mp3")) {
      return NextResponse.json(
        { error: "unsupported_format", message: "Vocal Diagnostics accepts .wav or .mp3." },
        { status: 415 }
      );
    }

    if (vocal.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file_too_large", message: "Vocal file exceeds 50 MB." },
        { status: 413 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.append("vocal", vocal);

    const res = await fetch(`${serviceUrl}/api/diagnose-vocal`, {
      method: "POST",
      body: upstreamForm,
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "diagnostics_failed", message: await readServiceError(res) },
        { status: res.status }
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[diagnose-vocal] Unexpected error:", err);
    return NextResponse.json(
      { error: "diagnostics_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
