import { NextResponse } from "next/server";

const DOCS_DISABLED_MESSAGE =
  "Documents has been removed from this build. Use Memories instead.";

export async function GET() {
  return NextResponse.json({ error: DOCS_DISABLED_MESSAGE }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: DOCS_DISABLED_MESSAGE }, { status: 410 });
}
