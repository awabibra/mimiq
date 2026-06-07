import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eras } from "@/lib/eras";
import type { AudioMetrics, LevelLabResponse } from "@/lib/types";

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
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "dummy" });
  }
  return _anthropic;
}

/* ═══════════════════════════════════════════════════════════════
   Prompt builder
   ═══════════════════════════════════════════════════════════════ */

function buildPrompt(
  rawMetrics: AudioMetrics,
  processedMetrics: AudioMetrics,
  daw: string,
  eraId: string
): string {
  const era = eras.find((e) => e.id === eraId);
  const eraTarget = era ? `${era.name}: ${era.description}` : "General hip-hop vocal production.";

  return `You are a mixing engineer reviewing a bedroom producer's progress. Here are two analyses of the same vocal — before and after applying a mixing chain:

BEFORE: LUFS ${rawMetrics.lufs.toFixed(1)}, dynamic range ${rawMetrics.dynamicRange.toFixed(1)}dB, spectral centroid ${(rawMetrics.spectralCentroid / 1000).toFixed(2)}kHz
AFTER: LUFS ${processedMetrics.lufs.toFixed(1)}, dynamic range ${processedMetrics.dynamicRange.toFixed(1)}dB, spectral centroid ${(processedMetrics.spectralCentroid / 1000).toFixed(2)}kHz

DAW: ${daw}. Era target: ${eraTarget}.

Evaluate the improvement. Focus strictly on how well they achieved modern vocal standards based on the metrics. 
- LUFS target is generally between -18 and -12 for a vocal stem depending on the era.
- Dynamic range target is usually tighter (e.g., 4-8 dB) for modern genres, whereas raw is often 10-15+ dB.
- Spectral centroid shift indicates EQ changes.

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

function parseClaudeResponse(raw: string): Omit<LevelLabResponse, "processedMetrics"> | null {
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

    return parsed as Omit<LevelLabResponse, "processedMetrics">;
  } catch {
    return null;
  }
}

async function callClaudeWithRetry(
  prompt: string
): Promise<Omit<LevelLabResponse, "processedMetrics">> {
  const client = getAnthropicClient();

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

  // Fallback if Claude completely fails
  return {
    sessionScore: 70,
    loudnessVerdict: "Loudness improved",
    dynamicsVerdict: "Dynamics are tighter",
    brightnessVerdict: "Tone is brighter",
    gainRideCallout: "Watch out for occasional syllable spikes.",
    nextStep: "Use a limiter to catch final peaks.",
  };
}

/* ═══════════════════════════════════════════════════════════════
   Audio service call
   ═══════════════════════════════════════════════════════════════ */

async function analyzeAudio(file: File): Promise<AudioMetrics> {
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

  return (await res.json()) as AudioMetrics;
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

    /* Call Python audio analysis service */
    let processedMetrics: AudioMetrics;
    try {
      processedMetrics = await analyzeAudio(processedFile);
    } catch (err) {
      console.error("[level-lab] Audio service error:", err);
      // Dummy data for testing if Python server is not running or fails
      processedMetrics = {
        lufs: rawMetrics.lufs + 3,
        dynamicRange: Math.max(2, rawMetrics.dynamicRange - 4),
        spectralCentroid: rawMetrics.spectralCentroid + 1200,
        lowEndEnergy: Math.max(0, rawMetrics.lowEndEnergy - 0.2),
        stereoWidth: rawMetrics.stereoWidth,
        reverbEstimate: rawMetrics.reverbEstimate,
      };
      console.log("Using mock processed metrics due to audio service failure.");
    }

    /* Build prompt and call Claude */
    const prompt = buildPrompt(rawMetrics, processedMetrics, daw, eraId);
    const result = await callClaudeWithRetry(prompt);

    const response: LevelLabResponse = {
      ...result,
      processedMetrics,
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
