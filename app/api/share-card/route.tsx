import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const runtime = "edge";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-key"
);

// Kept local because this route runs on the edge.
const eraColors: Record<string, { accent: string; name: string }> = {
  modern_rap: { accent: "#D4A84B", name: "Modern Rap" },
  trap: { accent: "#7B5FD4", name: "Trap" },
  rnb: { accent: "#C4547A", name: "R&B" },
  pop: { accent: "#4ABCBC", name: "Pop" },
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId");

  if (!chainId) {
    return new Response("Missing chainId parameter", { status: 400 });
  }

  // Fetch the chain record from Supabase
  const { data: chain, error } = await supabase
    .from("chains")
    .select("*")
    .eq("id", chainId)
    .single();

  if (error || !chain) {
    return new Response("Chain not found", { status: 404 });
  }

  const era = eraColors[chain.era] ?? { accent: "#888884", name: chain.era };
  const accent = era.accent;

  // Compute dot position within the 96×96 XY pad
  const dotX = Math.round(chain.xy_x * 96);
  const dotY = Math.round((1 - chain.xy_y) * 96);

  // Take first 3 chain steps
  const steps = (chain.chain as { step: number; tool: string; action: string }[]).slice(0, 3);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "1200px",
          height: "630px",
          backgroundColor: "#0A0A0C",
          padding: "60px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top row: mimiq wordmark + Era pill */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          {/* Wordmark */}
          <div
            style={{
              display: "flex",
              fontSize: "32px",
              fontWeight: 800,
              letterSpacing: "-0.05em",
              color: "#F2F2F0",
            }}
          >
            mimi
            <span
              style={{
                color: "#d7ff3f",
                marginLeft: "1px",
                transform: "translateY(2px)"
              }}
            >
              q
            </span>
          </div>

          {/* Era pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: hexToRgba(accent, 0.12),
              color: accent,
              fontSize: "16px",
              padding: "6px 16px",
              borderRadius: "9999px",
            }}
          >
            {era.name}
            <div
              style={{
                display: "flex",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: accent,
              }}
            />
          </div>
        </div>

        {/* Middle content: XY pad + chain steps */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: "48px",
            marginTop: "48px",
            flex: 1,
          }}
        >
          {/* XY pad */}
          <div
            style={{
              display: "flex",
              position: "relative",
              width: "96px",
              height: "96px",
              backgroundColor: "#161618",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "4px",
              flexShrink: 0,
            }}
          >
            {/* Dot */}
            <div
              style={{
                display: "flex",
                position: "absolute",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                backgroundColor: accent,
                left: `${dotX - 5}px`,
                top: `${dotY - 5}px`,
              }}
            />
          </div>

          {/* Chain steps */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {steps.map((s) => (
              <div
                key={s.step}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  gap: "12px",
                  fontSize: "18px",
                }}
              >
                <span style={{ color: "#4A4A47", fontWeight: 500 }}>
                  {String(s.step).padStart(2, "0")}
                </span>
                <span style={{ color: "#888884" }}>
                  {s.tool} — {s.action}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom row: mimiq.app */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "14px",
              color: "#4A4A47",
            }}
          >
            mimiq.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
