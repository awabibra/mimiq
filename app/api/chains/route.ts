import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "chain_writes_removed",
      message: "Chain writes now belong to the active project document.",
    },
    { status: 410 }
  );
}
