import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedSession, parsePositiveInt } from "@/lib/ownership";
import { getScopePlanLimits } from "@/lib/plan";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionIdParam = searchParams.get("session_id");

    if (!sessionIdParam) {
      return NextResponse.json(
        { error: "session_id query parameter is required" },
        { status: 400 }
      );
    }

    const sessionId = parsePositiveInt(sessionIdParam);
    if (sessionId === null) {
      return NextResponse.json(
        { error: "Invalid session_id" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    const db = getDb();

    // Verify caller owns the session and it is not deleted.
    const session = getOwnedSession<{ id: number; is_deleted: number | null }>(
      db,
      sessionId,
      scope,
      "id, is_deleted"
    );

    if (!session || Number(session.is_deleted || 0) === 1) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Sum total_tokens from token_usage table for this session
    const result = db
      .prepare(
        `SELECT COALESCE(SUM(total_tokens), 0) as used_tokens
         FROM token_usage
         WHERE session_id = ?`
      )
      .get(sessionId) as { used_tokens: number } | undefined;

    const usedTokens = result?.used_tokens ?? 0;
    const { plan, limits } = getScopePlanLimits(db, scope);

    return NextResponse.json({
      session_id: sessionId,
      used_tokens: usedTokens,
      session_token_limit: limits.maxSessionTokens,
      plan,
    });
  } catch (error) {
    console.error("Error fetching session usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch session usage" },
      { status: 500 }
    );
  }
}





