import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function readServiceError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { detail?: string; message?: string };
    return data.message || data.detail || "Stem separation failed.";
  } catch {
    return text || "Stem separation failed.";
  }
}

export async function POST(req: NextRequest) {
  try {
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

    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;

    if (!audio) {
      return NextResponse.json(
        { error: "missing_audio", message: "Upload a .wav or .mp3 file." },
        { status: 400 }
      );
    }

    const lowerName = audio.name.toLowerCase();
    if (!lowerName.endsWith(".wav") && !lowerName.endsWith(".mp3")) {
      return NextResponse.json(
        { error: "unsupported_format", message: "Stem Splitter accepts .wav or .mp3." },
        { status: 415 }
      );
    }

    if (audio.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file_too_large", message: "Audio file exceeds 50 MB." },
        { status: 413 }
      );
    }

    const upstreamForm = new FormData();
    upstreamForm.append("audio", audio);

    const res = await fetch(`${serviceUrl}/api/split-stems`, {
      method: "POST",
      body: upstreamForm,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "stem_split_failed", message: await readServiceError(res) },
        { status: res.status }
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[split-stems] Unexpected error:", err);
    return NextResponse.json(
      { error: "stem_split_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
