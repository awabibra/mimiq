import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { CollisionZone } from "@/lib/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

interface MixRoomRequest {
  collisions?: CollisionZone[];
  daw?: string;
  genre?: string;
}

function formatFreq(freq: number) {
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }

  return `${Math.round(freq)} Hz`;
}

function pluginForDaw(daw: string) {
  const lower = daw.toLowerCase();
  if (lower.includes("fl")) return "Fruity Parametric EQ 2";
  if (lower.includes("ableton")) return "EQ Eight";
  if (lower.includes("logic")) return "Channel EQ";
  if (lower.includes("pro tools")) return "EQ III";
  if (lower.includes("studio one")) return "Pro EQ";
  return "your stock EQ";
}

function fallbackExplanation(collisions: CollisionZone[], daw: string) {
  const first = collisions[0];
  if (!first) {
    return "The vocal and beat are not fighting in any major spot right now. Keep the vocal centered and make small EQ moves only if a word starts disappearing.";
  }

  return `The main fight is around ${formatFreq(first.centerFreq)}, where the beat and vocal are both loud. Open ${pluginForDaw(daw)} and make a small cut on the beat at ${formatFreq(first.centerFreq)} so the vocal can sit forward without turning it up.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MixRoomRequest;
    const daw = body.daw || "Logic Pro";
    const genre = body.genre || "rap";
    const topCollisions = Array.isArray(body.collisions)
      ? body.collisions.slice(0, 3)
      : [];

    if (topCollisions.length === 0) {
      return NextResponse.json({
        explanation: fallbackExplanation([], daw),
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        explanation: fallbackExplanation(topCollisions, daw),
      });
    }

    const prompt = `These are frequency collision zones between a ${genre} vocal and beat:
${JSON.stringify(topCollisions)}

In 2-3 sentences, explain to a bedroom rapper what this means and exactly what to do.
Use plain English. No jargon. Be specific about which plugin to use in ${daw}.
Return only the explanation text, no JSON.`;

    try {
      const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 220,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      });

      const firstContent = msg.content[0];
      const explanation =
        firstContent?.type === "text" ? firstContent.text.trim() : "";

      return NextResponse.json({
        explanation: explanation || fallbackExplanation(topCollisions, daw),
      });
    } catch (apiError) {
      console.warn("Mix room Claude explanation failed:", apiError);
      return NextResponse.json({
        explanation: fallbackExplanation(topCollisions, daw),
      });
    }
  } catch (error: unknown) {
    console.error("Mix room explanation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mix room failed" },
      { status: 500 }
    );
  }
}
