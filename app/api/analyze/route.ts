import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getFallbackChain } from "@/lib/fallbacks";
import { eras } from "@/lib/eras";
import type { AudioMetrics, ChainStep, XYPosition } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 1500;

/* ═══════════════════════════════════════════════════════════════
   Claude client — lazy singleton
   ═══════════════════════════════════════════════════════════════ */

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

/* ═══════════════════════════════════════════════════════════════
   Prompt builder
   ═══════════════════════════════════════════════════════════════ */

function buildEraDescription(eraId: string): string {
  const era = eras.find((e) => e.id === eraId);
  if (!era) return "General hip-hop vocal production.";

  const eraContextMap: Record<string, string> = {
    nocturnal:
      "Nocturnal R&B: late-night, dark, wet, intimate. Reference: SZA, The Weeknd early era, Frank Ocean.",
    volatile:
      "Volatile Trap: aggressive, distorted, hard-hitting, energetic. Reference: Playboi Carti, Travis Scott, Future.",
    current:
      "Current Afrobeats: rhythmic, percussive, melodic, groovy. Reference: Burna Boy, Wizkid, Tems.",
    golden:
      "Golden-era Hip-Hop: warm, punchy, soulful, analog. Reference: Nas, J. Cole, Kendrick Lamar.",
    crystalline:
      "Crystalline UK Drill: cold, sparse, precise, aggressive. Reference: Central Cee, Pop Smoke, Headie One.",
  };

  return eraContextMap[eraId] ?? `${era.name}: ${era.description}`;
}

function buildXYAdjustment(x: number, y: number): string {
  const parts: string[] = [];

  if (x < 0.35) parts.push("drier (less reverb, less delay)");
  else if (x > 0.65) parts.push("wetter (more reverb, more spatial effects)");

  if (y < 0.35) parts.push("darker (less high-end, warmer tone)");
  else if (y > 0.65) parts.push("brighter (more presence, more air)");

  if (parts.length === 0) return "";

  return `\n\nThe user has adjusted their tonal preference toward: ${parts.join(
    " and "
  )}. Adjust the processing chain accordingly — shift relevant parameters to match this preference while keeping the chain technically sound.`;
}

function buildPrompt(
  metrics: AudioMetrics,
  daw: string,
  eraId: string,
  xyX?: number,
  xyY?: number
): string {
  const eraDesc = buildEraDescription(eraId);

  const beatSection =
    metrics.beatLufs != null && metrics.collisionFrequency != null
      ? `\nBeat loudness: ${metrics.beatLufs} LUFS\nMain frequency collision zone: ${metrics.collisionFrequency} kHz`
      : "";

  const xyAdjustment =
    xyX != null && xyY != null ? buildXYAdjustment(xyX, xyY) : "";

  return `You are a professional mixing engineer specializing in hip-hop, R&B, trap, and afrobeats vocal production. A bedroom producer has uploaded their raw vocal. Here are the measured audio characteristics:

Vocal loudness: ${metrics.lufs} LUFS
Dynamic range: ${metrics.dynamicRange} dB
Spectral centroid: ${metrics.spectralCentroid} kHz (higher = brighter/harsher, lower = darker/muddier)
Low-end energy: ${metrics.lowEndEnergy} (0–1 scale, higher = more room rumble or proximity effect)
Stereo width: ${metrics.stereoWidth} (0 = mono, 1 = wide)
Estimated reverb in room: ${metrics.reverbEstimate} (0 = dry, 1 = very roomy)${beatSection}

Their DAW: ${daw}
Their target sound: ${eraDesc}${xyAdjustment}

Give them a precise, numbered vocal processing chain. Rules:
- Maximum 7 steps
- Each step must reference a real, specific plugin type available in ${daw} (use stock plugin names where possible)
- Each step must include exact parameter values (e.g. "High-pass filter: cut at 120Hz, 24dB/oct slope" not "clean up low end")
- Each step must include a one-sentence reason that references their specific measurements
- Do not be generic. Every step must be traceable to the numbers above.
- Tone: direct, technical but not condescending. Like advice from a producer friend who knows what they're doing.`;
}

/* ═══════════════════════════════════════════════════════════════
   JSON response schema — enforced via system prompt
   ═══════════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT = `You are a JSON-only API endpoint. You MUST respond with valid JSON and absolutely nothing else — no markdown, no code fences, no explanation, no preamble.

Your response MUST conform to this exact schema:

{
  "chain": [
    {
      "step": <integer, 1-indexed>,
      "tool": "<string: plugin/processor name>",
      "action": "<string: exact parameter values>",
      "reason": "<string: one sentence referencing the user's measurements>"
    }
  ],
  "summary": "<string: one sentence describing the core problem and approach>",
  "xyPosition": {
    "x": <number 0-1, 0 = dry, 1 = wet — your estimate of the resulting chain's spatial character>,
    "y": <number 0-1, 0 = dark, 1 = bright — your estimate of the resulting chain's tonal character>
  }
}

Rules:
- The "chain" array must have between 3 and 7 items.
- Every field is required. Do not omit any field.
- Do not wrap the JSON in markdown code fences or backticks.
- Do not include any text before or after the JSON object.`;

/* ═══════════════════════════════════════════════════════════════
   Response parser with retry
   ═══════════════════════════════════════════════════════════════ */

interface ClaudeChainResponse {
  chain: ChainStep[];
  summary: string;
  xyPosition: XYPosition;
}

function parseClaudeResponse(raw: string): ClaudeChainResponse | null {
  try {
    // Strip any accidental markdown fencing
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
    }

    const parsed = JSON.parse(cleaned);

    // Validate shape
    if (
      !Array.isArray(parsed.chain) ||
      parsed.chain.length === 0 ||
      typeof parsed.summary !== "string" ||
      typeof parsed.xyPosition?.x !== "number" ||
      typeof parsed.xyPosition?.y !== "number"
    ) {
      return null;
    }

    // Validate each step
    for (const step of parsed.chain) {
      if (
        typeof step.step !== "number" ||
        typeof step.tool !== "string" ||
        typeof step.action !== "string" ||
        typeof step.reason !== "string"
      ) {
        return null;
      }
    }

    return parsed as ClaudeChainResponse;
  } catch {
    return null;
  }
}

async function callClaudeWithRetry(
  prompt: string,
  eraId: string
): Promise<ClaudeChainResponse> {
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

      // First attempt failed parsing — retry
      console.warn(
        `[analyze] Claude returned malformed JSON (attempt ${attempt + 1}), retrying…`
      );
    } catch (err) {
      console.error(`[analyze] Claude API error (attempt ${attempt + 1}):`, err);
      if (attempt === 1) break;
    }
  }

  // Both attempts failed — use fallback
  console.warn(`[analyze] Falling back to generic chain for era: ${eraId}`);
  const fb = getFallbackChain(eraId);
  return { chain: fb.chain, summary: fb.summary, xyPosition: fb.xyPosition };
}

/* ═══════════════════════════════════════════════════════════════
   Audio service call
   ═══════════════════════════════════════════════════════════════ */

async function analyzeAudio(
  vocalFile: File,
  beatFile: File | null
): Promise<AudioMetrics> {
  const serviceUrl = process.env.AUDIO_SERVICE_URL;
  if (!serviceUrl) {
    throw new Error("AUDIO_SERVICE_URL is not configured");
  }

  const form = new FormData();
  form.append("vocal", vocalFile);
  if (beatFile) form.append("beat", beatFile);

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

    const daw = (formData.get("daw") as string) || "Logic Pro";
    const eraId = (formData.get("era") as string) || "golden";
    const xyXRaw = formData.get("xyX") as string | null;
    const xyYRaw = formData.get("xyY") as string | null;
    const cachedMetricsRaw = formData.get("cachedMetrics") as string | null;

    const xyX = xyXRaw != null ? parseFloat(xyXRaw) : undefined;
    const xyY = xyYRaw != null ? parseFloat(xyYRaw) : undefined;

    /* ── Cached metrics path (XY drag / era switch — no audio re-upload) ── */
    if (cachedMetricsRaw) {
      let metrics: AudioMetrics;
      try {
        metrics = JSON.parse(cachedMetricsRaw) as AudioMetrics;
      } catch {
        return NextResponse.json(
          { error: "analysis_failed", message: "Invalid cached metrics JSON." },
          { status: 400 }
        );
      }

      const prompt = buildPrompt(metrics, daw, eraId, xyX, xyY);
      const result = await callClaudeWithRetry(prompt, eraId);

      return NextResponse.json({
        chain: result.chain,
        summary: result.summary,
        xyPosition: result.xyPosition,
        metrics,
      });
    }

    /* ── Full analysis path (new file upload) ── */
    const vocalFile = formData.get("vocalFile") as File | null;
    if (!vocalFile) {
      return NextResponse.json(
        { error: "analysis_failed", message: "No vocal file provided." },
        { status: 400 }
      );
    }

    // Server-side file size guard
    if (vocalFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: "Vocal file exceeds 20 MB limit.",
        },
        { status: 413 }
      );
    }

    const beatFile = formData.get("beatFile") as File | null;
    if (beatFile && beatFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: "Beat file exceeds 20 MB limit.",
        },
        { status: 413 }
      );
    }

    /* Call Python audio analysis service */
    let metrics: AudioMetrics;
    try {
      metrics = await analyzeAudio(vocalFile, beatFile);
    } catch (err) {
      console.error("[analyze] Audio service error:", err);
      return NextResponse.json(
        {
          error: "audio_service_unavailable",
          message:
            "Audio analysis service is unreachable. You can still explore the XY pad for general guidance.",
        },
        { status: 503 }
      );
    }

    /* Build prompt and call Claude */
    const prompt = buildPrompt(metrics, daw, eraId);
    const result = await callClaudeWithRetry(prompt, eraId);

    return NextResponse.json({
      chain: result.chain,
      summary: result.summary,
      xyPosition: result.xyPosition,
      metrics,
    });
  } catch (err) {
    console.error("[analyze] Unexpected error:", err);
    return NextResponse.json(
      { error: "analysis_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
