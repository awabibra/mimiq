import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eras } from "@/lib/eras";
import type {
  AudioMetrics,
  LevelLabDelta,
  LevelLabResponse,
  LevelMetrics,
} from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 1000;

/* ═══════════════════════════════════════════════════════════════
   Claude client — lazy singleton
   ═══════════════════════════════════════════════════════════════ */

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

/* ═══════════════════════════════════════════════════════════════
   Prompt builder
   ═══════════════════════════════════════════════════════════════ */

function buildPrompt(
  rawMetrics: AudioMetrics,
  processedMetrics: LevelMetrics,
  daw: string,
  eraId: string
): string {
  const era = eras.find((e) => e.id === eraId);
  const eraTarget = era ? `${era.name}: ${era.description}` : "General hip-hop vocal production.";
  const afterCentroid =
    processedMetrics.spectralCentroid == null
      ? "not measured by the processed analysis"
      : `${(processedMetrics.spectralCentroid / 1000).toFixed(2)}kHz`;

  return `You are a mixing engineer reviewing a bedroom producer's progress. Here are two analyses of the same vocal — before and after applying a mixing chain:

BEFORE: LUFS ${rawMetrics.lufs.toFixed(1)}, dynamic range ${rawMetrics.dynamicRange.toFixed(1)}dB, spectral centroid ${(rawMetrics.spectralCentroid / 1000).toFixed(2)}kHz
AFTER: LUFS ${processedMetrics.lufs.toFixed(1)}, dynamic range ${processedMetrics.dynamicRange.toFixed(1)}dB, true peak ${processedMetrics.truePeak.toFixed(1)}dBFS, spectral centroid ${afterCentroid}

DAW: ${daw}. Era target: ${eraTarget}.

Evaluate the improvement. Focus strictly on how well they achieved modern vocal standards based on the metrics. 
- LUFS target is generally between -18 and -12 for a vocal stem depending on the era.
- Dynamic range target is usually tighter (e.g., 4-8 dB) for modern genres, whereas raw is often 10-15+ dB.
- True peak should usually leave at least 1dB of headroom.
- If processed spectral centroid was not measured, do not comment on brightness as if it was measured.

Respond ONLY in valid JSON conforming exactly to the requested schema.`;
}

/* ═══════════════════════════════════════════════════════════════
   JSON response schema — enforced via system prompt
   ═══════════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT = `You are a JSON-only API endpoint. You MUST respond with valid JSON and absolutely nothing else — no markdown, no code fences, no explanation, no preamble.

Your response MUST conform to this exact schema:

{
  "sessionScore": <number 0-100, representing how good the processed vocal sounds technically compared to raw>,
  "loudnessVerdict": "<string: one clause, max 10 words, evaluating the LUFS change>",
  "dynamicsVerdict": "<string: one clause, max 10 words, evaluating the dynamic range change>",
  "brightnessVerdict": "<string: one clause, max 10 words, evaluating the spectral centroid change>",
  "gainRideCallout": "<string: one sentence about amplitude consistency or peaks, max 20 words>",
  "nextStep": "<string: single most impactful remaining fix, max 20 words, DAW-specific if possible>"
}

Rules:
- Every field is required. Do not omit any field.
- Do not wrap the JSON in markdown code fences or backticks.
- Do not include any text before or after the JSON object.`;

/* ═══════════════════════════════════════════════════════════════
   Response parser with retry
   ═══════════════════════════════════════════════════════════════ */

type LevelLabReview = Omit<LevelLabResponse, "processedMetrics" | "delta">;

function parseClaudeResponse(raw: string): LevelLabReview | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
    }

    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.sessionScore !== "number" ||
      typeof parsed.loudnessVerdict !== "string" ||
      typeof parsed.dynamicsVerdict !== "string" ||
      typeof parsed.brightnessVerdict !== "string" ||
      typeof parsed.gainRideCallout !== "string" ||
      typeof parsed.nextStep !== "string"
    ) {
      return null;
    }

    return parsed as LevelLabReview;
  } catch {
    return null;
  }
}

async function callClaudeWithRetry(
  prompt: string,
  fallback: LevelLabReview
): Promise<LevelLabReview> {
  const client = getAnthropicClient();
  if (!client) return fallback;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") continue;

      const parsed = parseClaudeResponse(textBlock.text);
      if (parsed) return parsed;

      console.warn(`[level-lab] Claude returned malformed JSON (attempt ${attempt + 1}), retrying…`);
    } catch (err) {
      console.error(`[level-lab] Claude API error (attempt ${attempt + 1}):`, err);
      if (attempt === 1) break;
    }
  }

  return fallback;
}

/* ═══════════════════════════════════════════════════════════════
   Audio service call
   ═══════════════════════════════════════════════════════════════ */

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

function normalizeServiceMetrics(raw: unknown): LevelMetrics {
  const data = raw as {
    vocal?: Record<string, unknown>;
  };
  const vocal = data.vocal ?? (raw as Record<string, unknown>);
  const spectralCentroid = parseMetricNumber(
    vocal.spectral_centroid ?? vocal.spectralCentroid
  );
  const centroidHz =
    spectralCentroid != null && spectralCentroid < 100
      ? spectralCentroid * 1000
      : spectralCentroid;

  return {
    lufs: requiredMetric(vocal.lufs_integrated ?? vocal.lufs, "LUFS"),
    dynamicRange: requiredMetric(
      vocal.dynamic_range ?? vocal.dynamicRange,
      "dynamic range"
    ),
    truePeak: requiredMetric(vocal.peak_db ?? vocal.truePeak, "true peak"),
    gainRide: [],
    ...(centroidHz != null ? { spectralCentroid: centroidHz } : {}),
  };
}

function buildDeterministicReview(
  rawMetrics: AudioMetrics,
  processedMetrics: LevelMetrics,
  daw: string
): LevelLabReview {
  const loudnessDistance = Math.abs(processedMetrics.lufs - -14);
  const dynamicsDistance = Math.abs(processedMetrics.dynamicRange - 6);
  const peakPenalty = processedMetrics.truePeak > -1 ? 18 : 0;
  const sessionScore = Math.round(
    Math.max(0, Math.min(100, 92 - loudnessDistance * 4 - dynamicsDistance * 5 - peakPenalty))
  );

  return {
    sessionScore,
    loudnessVerdict:
      Math.abs(processedMetrics.lufs - rawMetrics.lufs) < 0.5
        ? "Loudness barely changed"
        : processedMetrics.lufs > -10
          ? "Processed vocal is too loud"
          : processedMetrics.lufs < -22
            ? "Processed vocal is still quiet"
            : "Loudness is controlled",
    dynamicsVerdict:
      processedMetrics.dynamicRange > 10
        ? "Dynamics still move too much"
        : processedMetrics.dynamicRange < 3
          ? "Dynamics are over-compressed"
          : "Dynamics sit in range",
    brightnessVerdict:
      processedMetrics.truePeak > -1
        ? "True peak needs headroom"
        : "True peak is controlled",
    gainRideCallout:
      processedMetrics.truePeak > -1
        ? "The export is close to clipping at the loudest point."
        : "Peak level leaves usable headroom.",
    nextStep:
      processedMetrics.truePeak > -1
        ? `Lower the vocal trim in ${daw}.`
        : `Level-match the printed vocal in ${daw}.`,
  };
}

function buildLevelDelta(
  rawMetrics: AudioMetrics,
  processedMetrics: LevelMetrics
): LevelLabDelta {
  const lufs_delta = Math.round((processedMetrics.lufs - rawMetrics.lufs) * 10) / 10;
  const dynamic_range_delta =
    Math.round((processedMetrics.dynamicRange - rawMetrics.dynamicRange) * 10) / 10;
  const rawLufsDistance = Math.abs(rawMetrics.lufs - -14);
  const processedLufsDistance = Math.abs(processedMetrics.lufs - -14);
  const rawDynamicsDistance = Math.abs(rawMetrics.dynamicRange - 6);
  const processedDynamicsDistance = Math.abs(processedMetrics.dynamicRange - 6);
  const improved =
    processedLufsDistance < rawLufsDistance - 0.5 ||
    processedDynamicsDistance < rawDynamicsDistance - 0.5;
  const regressed =
    processedLufsDistance > rawLufsDistance + 0.5 ||
    processedDynamicsDistance > rawDynamicsDistance + 0.5;

  return {
    verdict: improved && !regressed ? "improved" : regressed && !improved ? "regressed" : "unknown",
    lufs_delta,
    dynamic_range_delta,
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
  });

  if (!res.ok) {
    throw new Error(`Audio service returned ${res.status}: ${await res.text()}`);
  }

  return normalizeServiceMetrics(await res.json());
}

/* ═══════════════════════════════════════════════════════════════
   POST handler
   ═══════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const rawMetricsStr = formData.get("rawMetrics") as string | null;
    const daw = (formData.get("daw") as string) || "Logic Pro";
    const eraId = (formData.get("era") as string) || "golden";
    const processedFile = formData.get("processedFile") as File | null;

    if (!rawMetricsStr) {
      return NextResponse.json(
        { error: "analysis_failed", message: "Raw metrics are required for comparison." },
        { status: 400 }
      );
    }

    if (!processedFile) {
      return NextResponse.json(
        { error: "analysis_failed", message: "Processed vocal file is required." },
        { status: 400 }
      );
    }

    let rawMetrics: AudioMetrics;
    try {
      rawMetrics = JSON.parse(rawMetricsStr) as AudioMetrics;
    } catch {
      return NextResponse.json(
        { error: "analysis_failed", message: "Invalid raw metrics JSON." },
        { status: 400 }
      );
    }

    if (processedFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "file_too_large", message: "Processed vocal file exceeds 20 MB limit." },
        { status: 413 }
      );
    }

    let processedMetrics: LevelMetrics;
    try {
      processedMetrics = await analyzeAudio(processedFile);
    } catch (err) {
      console.error("[level-lab] Audio service error:", err);
      return NextResponse.json({
        status: "client_only",
        message: "Using browser analysis",
      });
    }

    const prompt = buildPrompt(rawMetrics, processedMetrics, daw, eraId);
    const result = await callClaudeWithRetry(
      prompt,
      buildDeterministicReview(rawMetrics, processedMetrics, daw)
    );

    const response: LevelLabResponse = {
      ...result,
      processedMetrics,
      delta: buildLevelDelta(rawMetrics, processedMetrics),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[level-lab] Unexpected error:", err);
    return NextResponse.json(
      { error: "analysis_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
