import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { evaluateChain } from "@/lib/evaluateChain";
import type {
  AudioMetrics,
  ChainStep,
  EvaluationIssue,
  EvaluationResult,
} from "@/lib/types";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 420;
const SYSTEM_PROMPT =
  "Write concise plain text for a technical vocal-chain audit. Return no JSON, markdown, or extra fields.";

let anthropic: Anthropic | null = null;

function getAnthropicClient() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return anthropic;
}

const FLAG_DETAILS: Record<string, EvaluationIssue> = {
  overloud: {
    severity: "critical",
    plugin: "chain",
    problem: "Measured loudness is above the deterministic ceiling.",
    fix: "Lower gain before compression or limiting, then print a quieter export.",
    why: "A vocal that hot can hide clipping and make later level checks unreliable.",
  },
  "over-compressed": {
    severity: "warning",
    plugin: "dynamics",
    problem: "Measured dynamic range is below the fit threshold.",
    fix: "Ease compression or parallel blend and preserve more movement.",
    why: "Too little range can flatten delivery and make syllables feel pinned.",
  },
  "harsh highs": {
    severity: "warning",
    plugin: "eq",
    problem: "Measured spectral centroid is above the brightness threshold.",
    fix: "Reduce air boosts, saturation edge, or bright reverb returns.",
    why: "Excess top-end energy can make the vocal feel sharp against the beat.",
  },
  muddy: {
    severity: "warning",
    plugin: "eq",
    problem: "Measured spectral centroid is below the clarity threshold.",
    fix: "Recheck low-mid buildup and add brightness only if the take supports it.",
    why: "A low centroid can mean the vocal needs cleaner presence before effects.",
  },
};

function buildIssues(flags: string[]) {
  return flags.map((flag) => FLAG_DETAILS[flag]).filter(Boolean);
}

function buildOverall(measuredFit: EvaluationResult["measured_fit"], flags: string[]) {
  if (measuredFit === "good") {
    return "The measured chain fit is inside the deterministic thresholds.";
  }

  return `The measured chain fit needs attention: ${flags.join(", ")}.`;
}

function buildExplanationPrompt(params: {
  chain: ChainStep[];
  metrics: AudioMetrics;
  daw: string;
  genre: string;
  explanationHint: string;
  measuredFit: EvaluationResult["measured_fit"];
  flags: string[];
}) {
  return `Explain this deterministic vocal-chain evaluation in one short paragraph.

DAW: ${params.daw}
Genre context: ${params.genre}
Measured fit: ${params.measuredFit}
Flags: ${params.flags.length ? params.flags.join(", ") : "none"}
Metrics: ${JSON.stringify(params.metrics)}
Chain: ${JSON.stringify(params.chain)}
Context: ${params.explanationHint}

The explanation may describe the measured fit and next check only. It must not invent chain settings, certainty, or parameter values.`;
}

async function explain(prompt: string) {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
}

function fallbackResult(overall: string): EvaluationResult {
  return {
    overall,
    issues: [
      {
        severity: "warning",
        plugin: "chain",
        problem: "The request did not include enough measured chain context.",
        fix: "Analyze the vocal and run Evaluate chain again.",
        why: "MimiQ needs measured metrics before it can label chain fit.",
      },
    ],
    strengths: [],
    measured_fit: "rebuild",
    flags: ["unknown"],
    explanation: "MimiQ could not evaluate the chain from the submitted request.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      chain?: ChainStep[];
      metrics?: AudioMetrics;
      genre?: string;
      daw?: string;
    };

    if (!Array.isArray(body.chain) || !body.metrics) {
      return NextResponse.json(
        fallbackResult("The evaluation request was missing measured chain data.")
      );
    }

    const deterministic = evaluateChain(
      {
        lufs: body.metrics.lufs,
        dynamic_range: body.metrics.dynamicRange,
        spectral_centroid: body.metrics.spectralCentroid,
      },
      body.chain
    );
    const issues = buildIssues(deterministic.flags);
    const strengths =
      deterministic.flags.length === 0
        ? ["Measured loudness, dynamics, and centroid are inside the fit thresholds."]
        : [];
    const overall = buildOverall(
      deterministic.measured_fit,
      deterministic.flags
    );
    let explanation = deterministic.explanation_hint;

    try {
      const text = await explain(
        buildExplanationPrompt({
          chain: body.chain,
          metrics: body.metrics,
          daw: body.daw || "Logic Pro",
          genre: body.genre || "hip hop",
          explanationHint: deterministic.explanation_hint,
          measuredFit: deterministic.measured_fit,
          flags: deterministic.flags,
        })
      );
      if (text) explanation = text;
    } catch (error) {
      console.error("[evaluate-chain] Explanation generation failed:", error);
    }

    return NextResponse.json({
      overall,
      issues,
      strengths,
      measured_fit: deterministic.measured_fit,
      flags: deterministic.flags,
      explanation,
    } satisfies EvaluationResult);
  } catch (error) {
    console.error("[evaluate-chain] Unexpected error:", error);
    return NextResponse.json(
      fallbackResult("MimiQ could not read the evaluation request.")
    );
  }
}
