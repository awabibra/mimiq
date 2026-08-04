import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthenticatedRequest,
  assetResolutionResponse,
  resolveProjectAssetFile,
} from "@/lib/serverProjectAudio";
import { issueStemJobToken } from "@/lib/serverStemJob";
import type { StemSplitJobResponse } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".wav", ".mp3", ".flac"];
const DEFAULT_MODEL = "htdemucs";

function parseMode(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  if (parsed === 2 || parsed === 4 || parsed === 6) return parsed;
  return 4;
}

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
    const projectId = (formData.get("projectId") as string) || null;
    const sourceAssetId = (formData.get("sourceAssetId") as string) || null;
    let audio = formData.get("audio") as File | null;
    let tokenProjectId = "";
    let tokenSourceAssetId = "";
    const mode = parseMode(formData.get("mode"));
    const model =
      typeof formData.get("model") === "string"
        ? (formData.get("model") as string).trim() || DEFAULT_MODEL
        : DEFAULT_MODEL;

    try {
      if (sourceAssetId) {
        const asset = await resolveProjectAssetFile({
          req,
          projectId,
          assetId: sourceAssetId,
          allowedKinds: ["full_song", "beat", "stem"],
          label: "Stem source",
        });
        audio = asset?.file ?? audio;
        tokenProjectId = projectId ?? "";
        tokenSourceAssetId = sourceAssetId;
      } else {
        const userId = await assertAuthenticatedRequest(req);
        tokenProjectId = `user:${userId}`;
        tokenSourceAssetId = "raw-upload";
      }
    } catch (error) {
      const response = assetResolutionResponse(error);
      if (response) return response;
      throw error;
    }

    if (!audio) {
      return NextResponse.json(
        { error: "missing_audio", message: "Upload a .wav, .mp3, or .flac file." },
        { status: 400 }
      );
    }

    const lowerName = audio.name.toLowerCase();
    const isAllowed = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));

    if (!isAllowed) {
      return NextResponse.json(
        {
          error: "unsupported_format",
          message: "Stem Splitter accepts .wav, .mp3, or .flac.",
        },
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
    upstreamForm.append("mode", String(mode));
    upstreamForm.append("model", model);

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

    const payload = await res.json() as StemSplitJobResponse;
    return NextResponse.json({
      ...payload,
      job_token: issueStemJobToken({
        jobId: payload.job_id,
        projectId: tokenProjectId,
        sourceAssetId: tokenSourceAssetId,
      }),
    });
  } catch (err) {
    console.error("[split-stems] Unexpected error:", err);
    return NextResponse.json(
      { error: "stem_split_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
