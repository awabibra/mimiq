import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import {
  GENRE_PROFILES,
  getGenreName,
  type GenreName,
} from "@/lib/chainKnowledge";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 3600;

const SYSTEM_PROMPT =
  "You are a JSON-only API endpoint. Return only valid JSON and no markdown, prose, code fences, or extra keys.";

let anthropic: Anthropic | null = null;

function getAnthropicClient() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return anthropic;
}

function normalizeGenre(value: string): GenreName {
  if (value in GENRE_PROFILES) return value as GenreName;
  return getGenreName(value);
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanClaudeJson(raw: string) {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  return cleaned;
}

function fallbackResult(overall = "MimiQ could not complete a reliable chain audit."): EvaluationResult {
  return {
    overall,
    issues: [
      {
        severity: "warning",
        plugin: "chain",
        problem: "The chain could not be evaluated reliably by the AI response parser.",
        fix: "Make one small chain edit and run Evaluate chain again.",
        why: "The UI needs structured audit data before it can point to exact plugin fixes.",
      },
    ],
    strengths: [],
    verdict: "needs_work",
    verdict_reason: "The audit was not structured enough to validate the chain.",
  };
}

function parseEvaluation(raw: string): EvaluationResult | null {
  try {
    const parsed = JSON.parse(cleanClaudeJson(raw)) as Partial<EvaluationResult>;

    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.overall !== "string") return null;
    if (!Array.isArray(parsed.issues)) return null;
    if (!Array.isArray(parsed.strengths)) return null;
    if (
      parsed.verdict !== "needs_work" &&
      parsed.verdict !== "good" &&
      parsed.verdict !== "professional"
    ) {
      return null;
    }
    if (typeof parsed.verdict_reason !== "string") return null;

    return {
      overall: parsed.overall,
      issues: parsed.issues
        .filter((issue) => issue && typeof issue === "object")
        .map((issue) => {
          const value = issue as unknown as Record<string, unknown>;
          const severity =
            value.severity === "critical" ||
            value.severity === "warning" ||
            value.severity === "suggestion"
              ? value.severity
              : "warning";

          return {
            severity,
            plugin: typeof value.plugin === "string" ? value.plugin : "chain",
            problem:
              typeof value.problem === "string"
                ? value.problem
                : "The audit found an unspecified problem.",
            fix: typeof value.fix === "string" ? value.fix : "Recheck this plugin value.",
            why:
              typeof value.why === "string"
                ? value.why
                : "This value may not match the measured vocal.",
          };
        }),
      strengths: parsed.strengths.filter(
        (strength): strength is string => typeof strength === "string"
      ),
      verdict: parsed.verdict,
      verdict_reason: parsed.verdict_reason,
    };
  } catch {
    return null;
  }
}

function buildEvaluationPrompt(params: {
  chain: ChainStep[];
  metrics: AudioMetrics;
  genre: GenreName;
  daw: string;
  iteration: number;
}) {
  const { chain, metrics, genre, daw, iteration } = params;
  const profile = GENRE_PROFILES[genre];
  const lufs = num(metrics.lufs, -18);
  const dynamicRange = num(metrics.dynamicRange, profile.dynamic_range_target);
  const spectralCentroid = num(metrics.spectralCentroid, 2200);
  const sibilancePeak = num(metrics.sibilancePeak, -12);
  const truePeak = num(metrics.truePeak, -1.2);

  return `You are a world-class mixing engineer with 20 years of experience mixing ${genre} vocals professionally. You are doing a detailed technical audit of a vocal chain.

VOCAL MEASUREMENTS (these are facts, not estimates):
- Integrated LUFS: ${lufs} dB (${genre} professional target: ${profile.lufs_target} dB)
- Dynamic Range (LRA): ${dynamicRange} (${genre} target: ${profile.dynamic_range_target})
- Spectral Centroid: ${spectralCentroid} Hz (indicates ${spectralCentroid < 2000 ? "dark/dull vocal - needs brightness work" : spectralCentroid > 4000 ? "bright/harsh vocal - needs taming" : "balanced brightness"})
- Sibilance Peak: ${sibilancePeak} dBFS (${sibilancePeak > -12 ? "HIGH - de-essing is critical" : "controlled"})
- True Peak: ${truePeak} dBFS (${truePeak > -1 ? "CLIPPING RISK" : "safe"})

GENRE: ${genre}
DAW: ${daw}

CHAIN BEING AUDITED:
${JSON.stringify(chain, null, 2)}

PROFESSIONAL BASELINE FOR ${genre.toUpperCase()}:
${JSON.stringify(profile, null, 2)}

AUDIT INSTRUCTIONS:
Analyse every single element of this chain against the vocal measurements and genre baseline. Be specific and technical. Do not be encouraging or positive unless something is genuinely correct. Your job is to find problems.

Check all of the following:
1. Signal flow order - is every plugin in the correct position? (e.g. de-esser should come after additive EQ if brightness was boosted, not before)
2. Compression stack - are ratio, attack, release, and gain reduction appropriate for this vocal's dynamic range and this genre?
3. EQ decisions - do the cut and boost frequencies match what this specific vocal needs based on its spectral centroid?
4. De-esser - is the frequency and reduction appropriate for the sibilance peak measured?
5. Gate threshold - is it appropriate for the noise floor suggested by the LUFS measurement?
6. Saturation - is the drive level appropriate or will it add unwanted distortion?
7. Reverb bus - is decay time appropriate for ${genre}? Is the sidechain compressor present (required for ${genre})? Is mix % in the right range?
8. Delay bus - is timing appropriate for ${genre}? Is mix % correct?
9. Parallel compression bus - is blend % in the right range for ${genre}?
10. Width bus - is the amount appropriate or will it cause phase issues?
11. Mastering bus - is the limiter ceiling appropriate for streaming? Is bus compression ratio and gain reduction correct?
12. Missing elements - what should be in this chain that isn't?
13. Redundant elements - is anything duplicating the work of another plugin unnecessarily?
14. Value coherence - do the values across the chain work together as a system, or do they fight each other?

${iteration > 1 ? `This is evaluation #${iteration} in this session. The user has made changes since the last evaluation. Be specific about whether the changes improved or worsened the chain.` : ""}

Return ONLY this JSON structure, no explanation outside it:
{
  "overall": "One sentence technical summary of the chain's current state",
  "issues": [
    {
      "severity": "critical" | "warning" | "suggestion",
      "plugin": "exact plugin slot name from the chain JSON",
      "problem": "specific technical problem, reference actual values",
      "fix": "exact value change - e.g. 'Reduce ratio from 8:1 to 4:1' or 'Move de-esser to after additive_eq'",
      "why": "the mixing reason in plain English, no jargon"
    }
  ],
  "strengths": [
    "specific thing that is correctly set, reference actual value"
  ],
  "verdict": "needs_work" | "good" | "professional",
  "verdict_reason": "One sentence explaining the verdict with specific reference to the most important factor"
}

Verdict criteria:
- "needs_work": any critical issues present, or more than 3 warnings
- "good": no critical issues, 1-2 warnings or suggestions only
- "professional": no critical issues, at most 1 suggestion, all key genre characteristics present and values are appropriate for the vocal measurements

Do not return "professional" unless the chain would genuinely produce a radio-ready result for this genre.`;
}

function buildSimplifiedPrompt(params: {
  chain: ChainStep[];
  metrics: AudioMetrics;
  genre: GenreName;
  daw: string;
}) {
  return `Return only valid JSON for a technical vocal-chain audit.
Genre: ${params.genre}
DAW: ${params.daw}
Metrics: ${JSON.stringify(params.metrics)}
Chain: ${JSON.stringify(params.chain)}

Use this exact shape:
{
  "overall": "single technical sentence",
  "issues": [{"severity":"critical|warning|suggestion","plugin":"role or tool from chain","problem":"specific problem","fix":"exact change","why":"plain English reason"}],
  "strengths": ["specific correct setting"],
  "verdict": "needs_work|good|professional",
  "verdict_reason": "specific reason"
}`;
}

async function callClaude(prompt: string) {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      chain?: ChainStep[];
      metrics?: AudioMetrics;
      genre?: string;
      daw?: string;
      iteration?: number;
    };

    if (!Array.isArray(body.chain) || !body.metrics) {
      return NextResponse.json(fallbackResult("The evaluation request was missing chain data."));
    }

    const genre = normalizeGenre(body.genre || "hip hop");
    const daw = body.daw || "Logic Pro";
    const iteration = Math.max(1, Math.round(num(body.iteration, 1)));

    const prompt = buildEvaluationPrompt({
      chain: body.chain,
      metrics: body.metrics,
      genre,
      daw,
      iteration,
    });

    try {
      const firstRaw = await callClaude(prompt);
      const firstParsed = parseEvaluation(firstRaw);
      if (firstParsed) return NextResponse.json(firstParsed);

      const secondRaw = await callClaude(
        buildSimplifiedPrompt({
          chain: body.chain,
          metrics: body.metrics,
          genre,
          daw,
        })
      );
      const secondParsed = parseEvaluation(secondRaw);
      return NextResponse.json(secondParsed ?? fallbackResult());
    } catch (error) {
      console.error("[evaluate-chain] Claude evaluation failed:", error);
      return NextResponse.json(
        fallbackResult("MimiQ could not reach the evaluation engine.")
      );
    }
  } catch (error) {
    console.error("[evaluate-chain] Unexpected error:", error);
    return NextResponse.json(
      fallbackResult("MimiQ could not read the evaluation request.")
    );
  }
}
