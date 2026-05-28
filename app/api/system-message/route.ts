import { NextRequest, NextResponse } from "next/server";
import { buildLYNXBootSequence } from "@/lib/LYNX_BOOT_SEQUENCE";
import { DartzModeId } from "@/lib/modes";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to inspect the system message" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") as DartzModeId | null;

    const systemMessage = await buildLYNXBootSequence({ mode: mode || undefined });

    return NextResponse.json({ systemMessage });
  } catch (error) {
    console.error("Error getting system message:", error);
    return NextResponse.json(
      { error: "Failed to get system message" },
      { status: 500 }
    );
  }
}
