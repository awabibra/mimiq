import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { AudioMetrics, ChainStep, EvaluationResult } from "@/lib/types";
import { evaluateChain } from "@/lib/evaluateChain";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 220;
const MAX_CHAIN_STEPS = 64;
const MAX_TOOL_LENGTH = 120;
const MAX_ACTION_LENGTH = 500;
const MAX_REASON_LENGTH = 700;
const MAX_ROLE_LENGTH = 80;
const MAX_NOTE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 80;
const SYSTEM_PROMPT =
  "Return only concise explanation text. Do not return JSON, verdicts, scores, or settings.";

const VALID_BUSES = new Set<NonNullable<ChainStep["bus"]>>([
  "main",
  "reverb_bus",
  "delay_bus",
  "parallel_comp_bus",
  "width_bus",
  "saturation_bus",
  "distortion_bus",
  "mastering_bus",
]);

const VALID_SEND_POINTS = new Set<NonNullable<ChainStep["sendPoint"]>>([
  "after-compressor-primary",
  "post-chain",
  "return",
]);

const NUMERIC_METRIC_FIELDS = [
  "lufs",
  "dynamicRange",
  "spectralCentroid",
  "truePeak",
  "harshness",
  "lowMidBuildup",
  "noiseFloorDb",
  "sibilancePeak",
  "dynamicInconsistency",
  "stereoWidth",
  "crestFactor",
  "beatLufs",
  "collisionFrequency",
] satisfies Array<keyof AudioMetrics>;

let anthropic: Anthropic | null = null;

type EvaluateChainRequestBody = {
  chain?: ChainStep[];
  metrics?: AudioMetrics;
  genre?: string;
  daw?: string;
};

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return anthropic;
}

function readBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function requireRequestUser(req: Request) {
  const token = readBearerToken(req);
  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "auth_required", message: "Sign in before evaluating a chain." },
        { status: 401 }
      ),
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "auth_unavailable", message: "Supabase auth is not configured." },
        { status: 503 }
      ),
    };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "auth_invalid", message: "Sign in again before evaluating a chain." },
        { status: 401 }
      ),
    };
  }

  return { ok: true as const };
}

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

const boundedString = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength;

function validateChainStep(value: unknown): value is ChainStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<ChainStep>;

  return (
    finiteNumber(step.step) &&
    boundedString(step.tool, MAX_TOOL_LENGTH) &&
    boundedString(step.action, MAX_ACTION_LENGTH) &&
    boundedString(step.reason, MAX_REASON_LENGTH) &&
    (step.role == null || boundedString(step.role, MAX_ROLE_LENGTH)) &&
    (step.note == null || boundedString(step.note, MAX_NOTE_LENGTH)) &&
    (step.bus == null || VALID_BUSES.has(step.bus)) &&
    (step.sendPoint == null || VALID_SEND_POINTS.has(step.sendPoint)) &&
    (step.enabled == null || typeof step.enabled === "boolean")
  );
}

function validateMetrics(value: unknown): value is AudioMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Partial<AudioMetrics>;

  return (
    finiteNumber(metrics.lufs) &&
    finiteNumber(metrics.dynamicRange) &&
    finiteNumber(metrics.spectralCentroid) &&
    NUMERIC_METRIC_FIELDS.every((field) => {
      const metricValue = metrics[field];
      return metricValue == null || finiteNumber(metricValue);
    })
  );
}

function validateContextString(value: unknown) {
  return value == null || boundedString(value, MAX_CONTEXT_LENGTH);
}

function invalidRequest(message: string) {
  return NextResponse.json(
    { error: "invalid_request", message },
    { status: 400 }
  );
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
          content: `Explain this deterministic mimiq chain audit in one plain sentence.
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
    const auth = await requireRequestUser(req);
    if (!auth.ok) return auth.response;

    let body: EvaluateChainRequestBody;
    try {
      body = (await req.json()) as EvaluateChainRequestBody;
    } catch {
      return invalidRequest("Request body must be valid JSON.");
    }

    if (!Array.isArray(body.chain) || body.chain.length === 0) {
      return invalidRequest("A non-empty chain is required.");
    }

    if (body.chain.length > MAX_CHAIN_STEPS) {
      return invalidRequest("Chain payload is too large.");
    }

    if (!body.chain.every(validateChainStep)) {
      return invalidRequest("Chain payload contains invalid steps.");
    }

    if (!validateMetrics(body.metrics)) {
      return invalidRequest("Finite vocal metrics are required.");
    }

    if (!validateContextString(body.genre) || !validateContextString(body.daw)) {
      return invalidRequest("Genre and DAW context must be bounded strings.");
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
    return NextResponse.json(
      {
        error: "evaluation_failed",
        message: "mimiq could not complete this chain evaluation.",
      },
      { status: 500 }
    );
  }
}
