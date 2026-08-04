import { NextRequest, NextResponse } from "next/server";
import { eras } from "@/lib/eras";
import type {
  AudioMetrics,
  AudioServiceStatus,
  LevelLabDelta,
  LevelLabResponse,
  LevelMetrics,
} from "@/lib/types";
import {
  assetResolutionResponse,
  resolveProjectAssetFile,
} from "@/lib/serverProjectAudio";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const parseMetricNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const requiredMetric = (value: unknown, label: string) => {
  const parsed = parseMetricNumber(value);
  if (parsed == null) {
    throw new Error(`Audio service did not return ${label}.`);
  }

  return parsed;
};

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function normalizeServiceMetrics(raw: unknown): LevelMetrics {
  const data = raw as {
    vocal?: Record<string, unknown>;
  };
  const vocal = data.vocal ?? (raw as Record<string, unknown>);
  const spectralCentroid = parseMetricNumber(
    vocal.spectral_centroid ?? vocal.spectralCentroid
  );

  return {
    lufs: requiredMetric(vocal.lufs_integrated ?? vocal.lufs, "LUFS"),
    dynamicRange: requiredMetric(
      vocal.dynamic_range ?? vocal.dynamicRange,
      "dynamic range"
    ),
    truePeak: requiredMetric(
      vocal.true_peak ?? vocal.truePeak ?? vocal.peak_db,
      "true peak"
    ),
    gainRide: [],
    ...(spectralCentroid != null ? { spectralCentroid } : {}),
  };
}

function normalizeRawMetrics(metrics: Partial<AudioMetrics> | null): LevelMetrics | null {
  if (!metrics) return null;

  const lufs = parseMetricNumber(metrics.lufs);
  const dynamicRange = parseMetricNumber(metrics.dynamicRange);
  const spectralCentroid = parseMetricNumber(metrics.spectralCentroid);
  if (lufs == null || dynamicRange == null) return null;

  return {
    lufs,
    dynamicRange,
    truePeak: parseMetricNumber(metrics.truePeak) ?? -1,
    gainRide: [],
    ...(spectralCentroid != null ? { spectralCentroid } : {}),
  };
}

async function analyzeAudio(file: File): Promise<LevelMetrics> {
  const serviceUrl = process.env.AUDIO_SERVICE_URL;
  if (!serviceUrl) {
    throw new Error("AUDIO_SERVICE_URL is not configured");
  }

  const form = new FormData();
  form.append("vocal", file);

  const res = await fetch(`${serviceUrl}/analyze`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Audio service returned ${res.status}: ${await res.text()}`);
  }

  return normalizeServiceMetrics(await res.json());
}

function buildDelta(
  rawMetrics: LevelMetrics,
  processedMetrics: LevelMetrics
): LevelLabDelta {
  const brightness_delta =
    processedMetrics.spectralCentroid == null || rawMetrics.spectralCentroid == null
      ? undefined
      : round(processedMetrics.spectralCentroid - rawMetrics.spectralCentroid, 0);

  const lufs_delta = round(processedMetrics.lufs - rawMetrics.lufs);
  const dynamic_range_delta = round(
    processedMetrics.dynamicRange - rawMetrics.dynamicRange
  );
  const rawDistance =
    Math.abs(rawMetrics.lufs - -14) +
    Math.abs(rawMetrics.dynamicRange - 6) +
    Math.abs((rawMetrics.spectralCentroid ?? 2600) - 2600) / 700;
  const processedDistance =
    Math.abs(processedMetrics.lufs - -14) +
    Math.abs(processedMetrics.dynamicRange - 6) +
    Math.abs((processedMetrics.spectralCentroid ?? 2600) - 2600) / 700;

  return {
    verdict:
      processedDistance < rawDistance - 0.75
        ? "improved"
        : processedDistance > rawDistance + 0.75
          ? "regressed"
          : "unknown",
    lufs_delta,
    dynamic_range_delta,
    ...(brightness_delta != null ? { brightness_delta } : {}),
  };
}

function brightnessPhrase(delta: number | undefined) {
  if (delta == null || Math.abs(delta) < 150) return "brightness stayed about the same";
  if (delta > 0) return "the high end opened up";
  return "the high end got darker";
}

function dynamicsPhrase(delta: number) {
  if (Math.abs(delta) < 0.5) return "the dynamics barely changed";
  if (delta < 0) return "compression tightened the dynamics";
  return "the vocal moves around more dynamically";
}

function loudnessPhrase(delta: number) {
  if (Math.abs(delta) < 0.5) return "your vocal stayed about the same loudness";
  if (delta > 0) return `your vocal got ${Math.abs(delta).toFixed(1)} dB louder`;
  return `your vocal got ${Math.abs(delta).toFixed(1)} dB quieter`;
}

function buildDeltaSummary(delta: LevelLabDelta) {
  const movement = `${loudnessPhrase(delta.lufs_delta)}, ${brightnessPhrase(
    delta.brightness_delta
  )}, and ${dynamicsPhrase(delta.dynamic_range_delta)}.`;

  if (delta.verdict === "improved") {
    return `${movement} It moved closer to the target, based on the measured before/after numbers.`;
  }

  if (delta.verdict === "regressed") {
    return `${movement} It moved farther from the target, so this export needs another pass.`;
  }

  return `${movement} The overall result is mixed, so level-match it and check the vocal in the track.`;
}

function buildReview(
  rawMetrics: LevelMetrics,
  processedMetrics: LevelMetrics,
  daw: string,
  eraId: string
): Omit<LevelLabResponse, "rawMetrics" | "processedMetrics" | "delta"> {
  const era = eras.find((entry) => entry.id === eraId);
  const delta = buildDelta(rawMetrics, processedMetrics);
  const loudnessDistance = Math.abs(processedMetrics.lufs - -14);
  const dynamicsDistance = Math.abs(processedMetrics.dynamicRange - 6);
  const brightnessDistance =
    processedMetrics.spectralCentroid == null
      ? 0
      : Math.abs(processedMetrics.spectralCentroid - 2600) / 700;
  const peakPenalty = processedMetrics.truePeak > -1 ? 18 : 0;
  const regressionPenalty = delta.verdict === "regressed" ? 14 : 0;
  const sessionScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        92 -
          loudnessDistance * 4 -
          dynamicsDistance * 5 -
          brightnessDistance * 4 -
          peakPenalty -
          regressionPenalty
      )
    )
  );
  const tooQuiet = delta.lufs_delta < -0.5;
  const tooLoud = processedMetrics.lufs > -10;
  const overCompressed =
    processedMetrics.dynamicRange < 3 ||
    delta.dynamic_range_delta < -7;
  const tooLoose = processedMetrics.dynamicRange > rawMetrics.dynamicRange + 1;
  const brightnessDelta = delta.brightness_delta ?? 0;

  return {
    sessionScore,
    loudnessVerdict: tooQuiet
      ? "Processed export got quieter"
      : tooLoud
        ? "Processed vocal is too loud"
        : Math.abs(delta.lufs_delta) < 0.5
          ? "Loudness barely changed"
          : "Loudness moved forward",
    dynamicsVerdict: overCompressed
      ? "Dynamics are over-compressed"
      : tooLoose
        ? "Dynamics got less controlled"
        : delta.dynamic_range_delta < -0.5
          ? "Dynamics tightened"
          : "Dynamics barely changed",
    brightnessVerdict:
      processedMetrics.spectralCentroid == null || rawMetrics.spectralCentroid == null
        ? "Brightness was not measured"
        : brightnessDelta > 300
          ? "High end opened up"
          : brightnessDelta < -300
            ? "High end got darker"
            : "Brightness stayed close",
    gainRideCallout:
      processedMetrics.truePeak > -1
        ? "The processed export is too close to clipping."
        : delta.verdict === "regressed"
          ? "The processed export did not measure closer than the raw vocal."
          : "Peak level leaves usable headroom.",
    nextStep:
      processedMetrics.truePeak > -1
        ? `Lower the vocal trim in ${daw} before exporting again.`
        : delta.verdict === "regressed"
          ? `Level-match the raw and processed vocal in ${daw}, then ease off the move that caused the regression.`
          : `Check this against the ${era?.name ?? "selected"} target in ${daw}.`,
    deltaSummary: buildDeltaSummary(delta),
  };
}

function fileFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const daw = (formData.get("daw") as string) || "Logic Pro";
    const eraId = (formData.get("era") as string) || "modern_rap";
    const rawMetricsStr = formData.get("rawMetrics") as string | null;
    const projectId = (formData.get("projectId") as string) || null;
    const rawAssetId = (formData.get("rawAssetId") as string) || null;
    const processedAssetId = (formData.get("processedAssetId") as string) || null;
    let rawFile = fileFromForm(formData, "rawFile");
    let processedFile = fileFromForm(formData, "processedFile");

    try {
      const rawAsset = await resolveProjectAssetFile({
        req,
        projectId,
        assetId: rawAssetId,
        allowedKinds: ["vocal", "full_song"],
        label: "Raw",
      });
      const processedAsset = await resolveProjectAssetFile({
        req,
        projectId,
        assetId: processedAssetId,
        allowedKinds: ["vocal", "full_song", "stem", "reference", "processed"],
        label: "Processed",
      });

      rawFile = rawAsset?.file ?? rawFile;
      processedFile = processedAsset?.file ?? processedFile;
    } catch (error) {
      const response = assetResolutionResponse(error);
      if (response) return response;
      throw error;
    }

    if (!processedFile) {
      return NextResponse.json(
        { error: "analysis_failed", message: "Processed vocal file is required." },
        { status: 400 }
      );
    }

    if (processedFile.size > MAX_FILE_SIZE || (rawFile && rawFile.size > MAX_FILE_SIZE)) {
      return NextResponse.json(
        { error: "file_too_large", message: "E-Val supports files up to 20 MB each." },
        { status: 413 }
      );
    }

    let cachedRawMetrics: LevelMetrics | null = null;
    if (rawMetricsStr) {
      try {
        cachedRawMetrics = normalizeRawMetrics(JSON.parse(rawMetricsStr));
      } catch {
        cachedRawMetrics = null;
      }
    }

    if (!rawFile && !cachedRawMetrics) {
      return NextResponse.json(
        {
          error: "analysis_failed",
          message:
            "Raw vocal is required for E-Val. Upload or analyze the raw vocal in Sandbox first.",
        },
        { status: 400 }
      );
    }

    let rawMetrics: LevelMetrics;
    let processedMetrics: LevelMetrics;
    let audioServiceStatus: AudioServiceStatus = "ok";
    let fallbackUsed = false;
    let fallbackReason: string | null = null;

    try {
      const [nextRawMetrics, nextProcessedMetrics] = await Promise.all([
        rawFile ? analyzeAudio(rawFile) : Promise.resolve(cachedRawMetrics),
        analyzeAudio(processedFile),
      ]);

      if (!nextRawMetrics) {
        throw new Error("Raw vocal metrics were unavailable.");
      }

      rawMetrics = nextRawMetrics;
      processedMetrics = nextProcessedMetrics;
    } catch (error) {
      console.error("[level-lab] Audio service error:", error);
      audioServiceStatus = "fallback";
      fallbackUsed = true;
      fallbackReason =
        error instanceof Error ? error.message : "Audio service was unavailable.";

      return NextResponse.json({
        status: "client_only",
        audio_service_status: audioServiceStatus,
        fallback_used: fallbackUsed,
        fallback_reason: fallbackReason,
        message:
          "E-Val needs the audio backend to measure the raw and processed files. Try again when the audio service is available.",
      });
    }

    const delta = buildDelta(rawMetrics, processedMetrics);
    const review = buildReview(rawMetrics, processedMetrics, daw, eraId);

    const response: LevelLabResponse = {
      ...review,
      rawMetrics,
      processedMetrics,
      delta,
      rawAssetId,
      processedAssetId,
      audio_service_status: audioServiceStatus,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[level-lab] Unexpected error:", error);
    return NextResponse.json(
      { error: "analysis_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
