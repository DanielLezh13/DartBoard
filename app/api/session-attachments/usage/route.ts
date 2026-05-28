import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { estimateTokens } from "@/lib/tokenEstimate";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedSession, getScopeOwner, parsePositiveInt } from "@/lib/ownership";
import { getScopePlanLimits } from "@/lib/plan";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { error: "session_id is required" },
        { status: 400 }
      );
    }

    const parsedSessionId = parsePositiveInt(sessionId);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: "session_id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    const owner = getScopeOwner(scope);
    const db = getDb();
    const { limits } = getScopePlanLimits(db, scope);
    const ownedSession = getOwnedSession(db, parsedSessionId, scope);
    if (!ownedSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    
    // Load enabled attachments with their content/summary
    const attachments = db
      .prepare(
        `SELECT m.content, m.summary 
         FROM session_memory_attachments sma
         JOIN memories m ON sma.memory_id = m.id
         WHERE sma.session_id = ? AND sma.is_enabled = 1 AND m.${owner.column} = ?`
      )
      .all(parsedSessionId, owner.value) as Array<{ content: string | null; summary: string }>;

    // Estimate tokens for enabled attachments (no truncation - size enforced at save time)
    const currentTokens = attachments.reduce((total, att) => {
      // Use content if available, otherwise fall back to summary
      const textToInject = att.content || att.summary;
      return total + estimateTokens(textToInject);
    }, 0);

    const maxTokens = limits.maxAttachedMemoryTokensPerSession;
    const usageRatio = Math.min(currentTokens / maxTokens, 1);

    return NextResponse.json({
      currentTokens,
      maxTokens,
      usageRatio,
    });
  } catch (error) {
    console.error("Error fetching session attachment usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch session attachment usage" },
      { status: 500 }
    );
  }
}
