import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy", // fallback so it doesn't crash if env missing during build
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { vocalSpectrum, beatSpectrum, daw, era } = body;

    // We don't have real spectral data in the mock so we'll pass generic text based on if beat is present
    const hasBeat = !!beatSpectrum;

    if (!hasBeat) {
      return NextResponse.json({
        collisions: [
          {
            frequencyRange: "All Frequencies",
            severity: "MED",
            instruction: "Upload a beat in the Sandbox to analyze frequency collisions between your vocal and the instrumental.",
          },
        ],
        matchScore: 0,
        summary: "Waiting for beat context to analyze collisions."
      });
    }

    const systemPrompt = `You are a mixing engineer. A bedroom producer has uploaded a vocal and beat.
Respond ONLY in valid JSON with this structure: { "collisions": [{ "frequencyRange": "string", "severity": "HIGH" | "MED" | "LOW", "instruction": "string" }], "matchScore": number, "summary": "string" }`;

    const userMessage = `Here is the frequency analysis:
Vocal spectral centroid: ~2.5 kHz
Beat low-end energy: High
Estimated collision zones: 200-500Hz, 3-5kHz
DAW: ${daw || "FL Studio"}
Era: ${era || "2010s"}

Identify up to 4 specific frequency collision problems. For each, give:
- frequencyRange: string (e.g. '200-500 Hz')
- severity: 'HIGH' | 'MED' | 'LOW'  
- instruction: one sentence, specific dB values and frequency targets, DAW-specific plugin name.`;

    // Try calling Anthropic API. If it fails (e.g., missing API key), fallback to dummy data
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("No API Key");
      }
      
      const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = (msg.content[0] as any).text;
      
      // Clean up potential markdown formatting
      const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      
      return NextResponse.json(parsed);

    } catch (apiError) {
      console.warn("Anthropic API failed or missing key, using fallback data", apiError);
      return NextResponse.json({
        collisions: [
          {
            frequencyRange: "200–500 Hz",
            severity: "HIGH",
            instruction: `Your beat's low-mid frequencies are masking your vocal warmth. Apply a −2dB cut at 350Hz on your beat track using ${daw === "Ableton" ? "EQ Eight" : "Fruity Parametric EQ 2"} while the vocal plays.`,
          },
          {
            frequencyRange: "3–5 kHz",
            severity: "MED",
            instruction: "Vocal presence is clashing with hi-hats. Try a dynamic EQ cut of -1.5dB around 4kHz on the instrumental.",
          }
        ],
        matchScore: 65,
        summary: "Two frequency clashes are pulling your vocal back."
      });
    }

  } catch (error: any) {
    console.error("Mix room API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
