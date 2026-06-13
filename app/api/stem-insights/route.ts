import { NextRequest, NextResponse } from "next/server";
import type {
  StemSplitInsightClaims,
  StemSplitJobResponse,
  StemSplitInsightResponse,
} from "@/lib/types";

interface StemInsightsRequest {
  job: StemSplitJobResponse | null;
  project?: {
    id?: string;
    name?: string;
    stem_split_url?: string | null;
  } | null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function fromSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds - minutes * 60);
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

function pushUnique(items: string[], message: string) {
  const normalized = message.trim();
  if (!normalized) return;
  items.push(normalized);
}

function buildClaims(job: StemSplitJobResponse): StemSplitInsightClaims {
  const measured: string[] = [];
  const inferred: string[] = [];
  const estimated: string[] = [];
  const unknown: string[] = [];

  const sourceDuration = job.source?.duration;
  const durationText = sourceDuration ? fromSeconds(sourceDuration) : null;
  pushUnique(measured, `Source duration: ${durationText ?? "< 1s"}.`);

  if (job.source?.sample_rate) {
    pushUnique(measured, `Source sample rate: ${job.source.sample_rate} Hz.`);
  }

  if (job.source?.channels) {
    pushUnique(measured, `Source channel count: ${job.source.channels}.`);
  }

  if (typeof job.source?.bpm === "number") {
    pushUnique(measured, `Detected BPM: ${Math.round(job.source.bpm)}.`);
  }

  const requested = job.requested_mode;
  const stemEntries = Object.entries(job.stems ?? {});
  pushUnique(measured, `Delivery stem mode: ${requested}-stem request.`);
  pushUnique(measured, `Complete stems returned: ${stemEntries.length}.`);

  stemEntries.forEach(([, stem]) => {
    if (!stem.fileMeta) {
      pushUnique(
        unknown,
        `${stem.name} metadata was not returned with the completed split.`
      );
      return;
    }

    pushUnique(
      measured,
      `${stem.name}: ${stem.fileMeta.duration_s.toFixed(2)}s, ${stem.fileMeta.sample_rate}Hz, ${
        stem.fileMeta.bit_depth == null ? "unknown bit depth" : `${stem.fileMeta.bit_depth}-bit`
      }.`
    );
  });

  if (job.fallback) {
    inferred.push(
      `Requested ${job.fallback.requested_stems.join(", ")} but only ${job.fallback.delivered_stems.length} stems were delivered.`
    );
    pushUnique(
      inferred,
      "Model fallback occurred on this run, and stem count was reduced to an available set."
    );
  }

  if (!job.stems || stemEntries.length === 0) {
    unknown.push(
      "Stem files are present in the split job, but file metadata could not be enumerated yet."
    );
  }

  estimated.push("You can compare lane durations against the source to verify segment alignment.");

  return {
    measured: measured.filter(Boolean),
    inferred: inferred.filter(Boolean),
    estimated: estimated.filter(Boolean),
    unknown: unknown.filter(Boolean),
  };
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as StemInsightsRequest;
    const job = payload?.job ?? null;

    if (!job) {
      return NextResponse.json(
        {
          status: "error" as StemSplitInsightResponse["status"],
          summary: "No split job data was provided for insight generation.",
          claims: {
            measured: [],
            inferred: [],
            estimated: [],
            unknown: ["Upload and split a source first."],
          },
        },
        { status: 400 }
      );
    }

    if (job.status !== "complete") {
      return NextResponse.json({
        status: "loading" as StemSplitInsightResponse["status"],
        summary: "Stem split has not finished yet.",
        claims: {
          measured: [],
          inferred: ["Insights will appear after split completion."],
          estimated: [],
          unknown: ["Final lane metadata and completion status are required for stable claims."],
        },
      });
    }

    const claims = buildClaims(job);
    const projectName = normalizeText(payload.project?.name);
    const summary = projectName
      ? `Stem split completed for ${projectName}.`
      : "Stem split completed.";

    return NextResponse.json({
      status: "ready" as StemSplitInsightResponse["status"],
      summary,
      claims,
    });
  } catch {
    return NextResponse.json(
      {
        status: "error" as StemSplitInsightResponse["status"],
        summary: "Could not build stem insights.",
        claims: {
          measured: [],
          inferred: [],
          estimated: [],
          unknown: [
            "Insight generation failed. Use measured file metadata and playback to review the split.",
          ],
        },
      },
      { status: 500 }
    );
  }
}
