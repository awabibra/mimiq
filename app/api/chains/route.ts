import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** POST — Save a new chain to the database. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, era, daw, xyPosition, chain, summary, measurements, createdAt } = body;

    const { data, error } = await supabase
      .from("chains")
      .insert({
        user_id: userId,
        era,
        daw,
        xy_x: xyPosition.x,
        xy_y: xyPosition.y,
        chain,
        summary,
        measurements,
        created_at: createdAt,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("[POST /api/chains] Supabase error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { id: data.id, created_at: data.created_at },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/chains] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to save chain" },
      { status: 500 }
    );
  }
}

/** GET — Fetch all saved chains for a user (defaults to demo-user-001). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") ?? "demo-user-001";

    const { data, error } = await supabase
      .from("chains")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/chains] Supabase error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/chains] Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to fetch chains" },
      { status: 500 }
    );
  }
}
