import { NextRequest, NextResponse } from "next/server";
import { runProjectAnalysis } from "@/lib/serverProjectAnalysis";
import { AssetResolutionError } from "@/lib/serverProjectAudio";
import type { ProjectAnalysisFlowResponse } from "@/lib/types";

const MAX_ID_LENGTH = 160;

function invalid(message: string) {
  return NextResponse.json(
    {
      status: "error",
      inputMode: null,
      code: "invalid_request",
      stage: "preparing",
      message,
      retryable: false,
      limitations: [message, "No unmeasured result was substituted."],
      skippedMeasurements: [],
    } satisfies ProjectAnalysisFlowResponse,
    { status: 400 }
  );
}

function responseStatus(result: ProjectAnalysisFlowResponse) {
  if (result.status === "processing") return 202;
  if (result.status === "complete") return 200;
  if (result.code === "audio_service_unavailable") return 503;
  if (result.code === "invalid_request") return 400;
  return 502;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const projectId = formData.get("projectId");
    const vocalId = formData.get("vocalAssetId");
    const fullSongId = formData.get("fullSongAssetId");
    const processedId = formData.get("processedAssetId");
    const fingerprint = formData.get("contextFingerprint");
    const stemJobId = formData.get("stemJobId");
    const stemJobToken = formData.get("stemJobToken");

    if (typeof projectId !== "string" || !projectId || projectId.length > MAX_ID_LENGTH) {
      return invalid("A valid project ID is required.");
    }
    if (
      typeof fingerprint !== "string" ||
      !fingerprint ||
      fingerprint.length > 12000
    ) {
      return invalid("A valid workflow context fingerprint is required.");
    }
    if (
      typeof vocalId !== "string" &&
      typeof fullSongId !== "string" &&
      typeof processedId !== "string"
    ) {
      return invalid("Choose a dry or processed vocal input.");
    }
    if (
      Boolean(typeof stemJobId === "string" && stemJobId) !==
      Boolean(typeof stemJobToken === "string" && stemJobToken)
    ) {
      return invalid("Stem Rip job ID and token must be provided together.");
    }

    const result = await runProjectAnalysis(req, formData);
    return NextResponse.json(result, { status: responseStatus(result) });
  } catch (error) {
    if (error instanceof AssetResolutionError) {
      return NextResponse.json(
        {
          status: "error",
          inputMode: null,
          code: "invalid_request",
          stage: "preparing",
          message: error.message,
          retryable: error.status >= 500,
          limitations: [error.message, "No unmeasured result was substituted."],
          skippedMeasurements: [],
        } satisfies ProjectAnalysisFlowResponse,
        { status: error.status }
      );
    }
    console.error("[project-analysis] Failed:", error);
    return NextResponse.json(
      {
        status: "error",
        inputMode: null,
        code: "measurement_failed",
        stage: "failed",
        message: "MimiQ could not complete this analysis run.",
        retryable: true,
        limitations: ["No result was saved or substituted."],
        skippedMeasurements: [],
      },
      { status: 500 }
    );
  }
}
