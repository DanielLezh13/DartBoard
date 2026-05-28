import { NextRequest, NextResponse } from "next/server";

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: "Route disabled in this build" },
    { status: 410 },
  );
}
