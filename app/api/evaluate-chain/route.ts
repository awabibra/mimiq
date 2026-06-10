import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import { evaluateChain } from "@/lib/evaluateChain";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 220;
const SYSTEM_PROMPT =
  "Return only concise explanation text. Do not return JSON, verdicts, scores, or settings.";

let anthropic: Anthropic | null = null;

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return anthropic;
}

function missingRequestResult(): EvaluationResult {
  return {
    overall: "MimiQ could not read enough measured chain data to audit the edit.",
    issues: [
      {
        severity: "warning",
        plugin: "chain",
        problem: "The evaluation request was missing chain data or measurements.",
        fix: "Analyze a vocal and evaluate a non-empty chain.",
        why: "The audit needs both the measured take and the visible chain before it can flag fit issues.",
      },
    ],
    strengths: [],
    measured_fit: "unknown",
    flags: ["missing_request"],
    explanation: "MimiQ needs measured vocal data and chain steps before it can explain the fit.",
  };
}

async function explainResult(params: {
  result: EvaluationResult;
  genre: string;
  daw: string;
}) {
  const client = getAnthropicClient();
  if (!client) return params.result.explanation;

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Explain this deterministic MimiQ chain audit in one plain sentence.
Genre: ${params.genre}
DAW: ${params.daw}
Measured fit: ${params.result.measured_fit}
Flags: ${params.result.flags.join(", ") || "none"}
Issues: ${params.result.issues.map((issue) => `${issue.plugin}: ${issue.problem}`).join("; ") || "none"}
Base explanation: ${params.result.explanation}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    return text || params.result.explanation;
  } catch (error) {
    console.error("[evaluate-chain] Explanation text failed:", error);
    return params.result.explanation;
  }
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
      return NextResponse.json(missingRequestResult());
    }

    const result = evaluateChain(body.metrics, body.chain);
    const explanation = await explainResult({
      result,
      genre: body.genre || "hip hop",
      daw: body.daw || "Logic Pro",
    });

    return NextResponse.json({
      ...result,
      explanation,
    });
  } catch (error) {
    console.error("[evaluate-chain] Unexpected error:", error);
    return NextResponse.json(missingRequestResult());
  }
}
