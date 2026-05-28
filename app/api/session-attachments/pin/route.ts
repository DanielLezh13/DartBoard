import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedMemory, getOwnedSession, getScopeOwner, parsePositiveInt } from "@/lib/ownership";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, memoryId } = await request.json();

    if (!sessionId || !memoryId) {
      return NextResponse.json(
        { error: "sessionId and memoryId are required" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to pin attachments" },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);
    const db = getDb();
    const parsedSessionId = parsePositiveInt(sessionId);
    const parsedMemoryId = parsePositiveInt(memoryId);
    if (parsedSessionId === null || parsedMemoryId === null) {
      return NextResponse.json(
        { error: "sessionId and memoryId must be positive integers" },
        { status: 400 }
      );
    }

    const session = getOwnedSession(db, parsedSessionId, scope);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const memory = getOwnedMemory(db, parsedMemoryId, scope);
    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    // Toggle the pinned state safely
    const result = db.prepare(`
      UPDATE session_memory_attachments
      SET is_pinned = CASE WHEN COALESCE(is_pinned, 0)=1 THEN 0 ELSE 1 END
      WHERE session_id=? AND memory_id=? AND is_enabled=1
    `).run(parsedSessionId, parsedMemoryId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Attachment not found or not enabled" },
        { status: 404 }
      );
    }

    // Return the new state
    const updated = db.prepare(`
      SELECT sma.is_pinned
      FROM session_memory_attachments sma
      JOIN sessions s ON s.id = sma.session_id
      JOIN memories m ON m.id = sma.memory_id
      WHERE sma.session_id=? AND sma.memory_id=?
        AND s.${owner.column} = ?
        AND m.${owner.column} = ?
    `).get(parsedSessionId, parsedMemoryId, owner.value, owner.value) as { is_pinned: number } | undefined;

    if (!updated) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      sessionId: parsedSessionId,
      memoryId: parsedMemoryId,
      is_pinned: updated.is_pinned
    });
  } catch (error) {
    console.error("Error toggling pin state:", error);
    return NextResponse.json(
      { error: "Failed to toggle pin state" },
      { status: 500 }
    );
  }
}
