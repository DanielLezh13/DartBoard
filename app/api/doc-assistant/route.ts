import { NextResponse } from "next/server";

const DOCS_DISABLED_MESSAGE =
  "Documents assistant has been removed from this build. Use chat + memories instead.";

export async function POST() {
  return NextResponse.json({ error: DOCS_DISABLED_MESSAGE }, { status: 410 });
}
