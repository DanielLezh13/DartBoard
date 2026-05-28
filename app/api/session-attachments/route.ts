import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { estimateTokens } from "@/lib/tokenEstimate";
import { getOwnedMemory, getScopeOwner, parsePositiveInt } from "@/lib/ownership";
import { getScopePlanLimits } from "@/lib/plan";

export const dynamic = "force-dynamic";

async function assertScope(request: NextRequest) {
  try {
    return await getServerScope(request);
  } catch {
    return null;
  }
}

function verifySessionOwnership(db: ReturnType<typeof getDb>, sessionId: number, scope: { kind: "user"; userId: string } | { kind: "guest"; guestId: string }): boolean {
  const row = db.prepare(`SELECT user_id, guest_id FROM sessions WHERE id = ?`).get(sessionId) as { user_id: string | null; guest_id: string | null } | undefined;
  if (!row) return false;
  if (scope.kind === "user") return row.user_id === scope.userId;
  return row.guest_id === scope.guestId;
}

export async function GET(request: NextRequest) {
  try {
    const scope = await assertScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const parsedSessionId = parsePositiveInt(sessionId);
    if (parsedSessionId === null) {
      return NextResponse.json({ error: "sessionId must be a positive integer" }, { status: 400 });
    }
    if (!verifySessionOwnership(db, parsedSessionId, scope)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const owner = getScopeOwner(scope);
    const attachments = db
      .prepare(
        `SELECT 
          sma.session_id,
          sma.memory_id,
          sma.is_enabled,
          sma.is_pinned,
          sma.sort_order,
          sma.created_at,
          m.title,
          m.summary,
          m.content,
          COALESCE(mf.name, 'Unsorted') as folder_name
        FROM session_memory_attachments sma
        JOIN memories m ON sma.memory_id = m.id
        LEFT JOIN memory_folders mf ON m.folder_id = mf.id
        WHERE sma.session_id = ? AND m.${owner.column} = ?
        ORDER BY sma.sort_order ASC, sma.created_at ASC`
      )
      .all(parsedSessionId, owner.value);

    return NextResponse.json(attachments);
  } catch (error) {
    console.error("Error fetching session attachments:", error);
    return NextResponse.json(
      { error: "Failed to fetch session attachments" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = await assertScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to attach memories" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { sessionId, memoryId } = body;

    if (!sessionId || !memoryId) {
      return NextResponse.json(
        { error: "sessionId and memoryId are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const parsedSessionId = parsePositiveInt(sessionId);
    const parsedMemoryId = parsePositiveInt(memoryId);
    if (parsedSessionId === null || parsedMemoryId === null) {
      return NextResponse.json(
        { error: "sessionId and memoryId must be positive integers" },
        { status: 400 }
      );
    }
    const owner = getScopeOwner(scope);
    const { limits } = getScopePlanLimits(db, scope);

    if (!verifySessionOwnership(db, parsedSessionId, scope)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check if attachment already exists
    const existing = db
      .prepare(
        `SELECT sort_order FROM session_memory_attachments 
         WHERE session_id = ? AND memory_id = ?`
      )
      .get(parsedSessionId, parsedMemoryId) as { sort_order: number } | undefined;

    if (existing) {
      // Already attached - return conflict status
      return NextResponse.json(
        {
          code: "already_attached",
          error: "Already attached",
        },
        { status: 409 }
      );
    } else {
      // New attachment - check limits before adding

      // 1. Check token limit (removed count check - only token-based capacity)
      // Load current enabled attachments with their content/summary
      const currentAttachments = db
        .prepare(
          `SELECT m.content, m.summary 
           FROM session_memory_attachments sma
           JOIN memories m ON sma.memory_id = m.id
           WHERE sma.session_id = ? AND sma.is_enabled = 1`
        )
        .all(parsedSessionId) as Array<{ content: string | null; summary: string }>;

      // Estimate tokens for current attachments (same logic as usage endpoint - no truncation)
      const currentTokens = currentAttachments.reduce((total, att) => {
        // Use content if available, otherwise fall back to summary
        const textToInject = att.content || att.summary;
        return total + estimateTokens(textToInject);
      }, 0);

      const attachmentCountLimit = limits.maxAttachedMemoriesPerSession;
      if (Number.isFinite(attachmentCountLimit) && currentAttachments.length >= attachmentCountLimit) {
        return NextResponse.json(
          {
            code: "memory_count_exceeded",
            error: `Attachment limit reached (${attachmentCountLimit}). Detach a memory to add another.`,
            current: currentAttachments.length,
            max: attachmentCountLimit,
          },
          { status: 400 }
        );
      }

      // Fetch new memory content/summary
      const newMemory = getOwnedMemory<{ id: number; content: string | null; summary: string }>(
        db,
        parsedMemoryId,
        scope,
        "id, content, summary"
      );

      if (!newMemory) {
        return NextResponse.json(
          { error: "Memory not found" },
          { status: 404 }
        );
      }

      // Calculate tokens for new memory (no truncation - size enforced at save time)
      const textToInject = newMemory.content || newMemory.summary;
      const newMemoryTokens = estimateTokens(textToInject);
      const attachmentTokenLimit = limits.maxAttachedMemoryTokensPerSession;

      // Check if adding would exceed token limit
      if (currentTokens + newMemoryTokens > attachmentTokenLimit) {
        return NextResponse.json(
          {
            code: "memory_budget_exceeded",
            error: `Memory budget exceeded (${attachmentTokenLimit.toLocaleString()} tokens). Detach something or reduce size.`,
            current: currentTokens,
            new: newMemoryTokens,
            max: attachmentTokenLimit,
          },
          { status: 400 }
        );
      }

      // Limits passed - proceed with insertion
      // Get max sort_order for this session
      const maxOrder = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) as max_order 
           FROM session_memory_attachments 
           WHERE session_id = ?`
        )
        .get(parseInt(sessionId)) as { max_order: number } | undefined;

      const nextSortOrder = (maxOrder?.max_order ?? -1) + 1;

      // Insert new attachment
      db.prepare(
        `INSERT INTO session_memory_attachments 
         (session_id, memory_id, is_enabled, is_pinned, sort_order, created_at)
         VALUES (?, ?, 1, 1, ?, datetime('now'))`
      ).run(parsedSessionId, parsedMemoryId, nextSortOrder);
    }

    // Fetch the attachment with memory details
    const attachment = db
      .prepare(
          `SELECT 
            sma.session_id,
            sma.memory_id,
          sma.is_enabled,
          sma.is_pinned,
          sma.sort_order,
          sma.created_at,
          m.title,
          m.summary,
          m.content,
          COALESCE(mf.name, 'Unsorted') as folder_name
          FROM session_memory_attachments sma
          JOIN memories m ON sma.memory_id = m.id
          LEFT JOIN memory_folders mf ON m.folder_id = mf.id
          WHERE sma.session_id = ? AND sma.memory_id = ? AND m.${owner.column} = ?`
      )
      .get(parsedSessionId, parsedMemoryId, owner.value);

    return NextResponse.json(attachment);
  } catch (error) {
    console.error("Error attaching memory to session:", error);
    return NextResponse.json(
      { error: "Failed to attach memory to session" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const scope = await assertScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to detach memories" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { sessionId, memoryId } = body;

    if (!sessionId || !memoryId) {
      return NextResponse.json(
        { error: "sessionId and memoryId are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const parsedSessionId = parsePositiveInt(sessionId);
    const parsedMemoryId = parsePositiveInt(memoryId);
    if (parsedSessionId === null || parsedMemoryId === null) {
      return NextResponse.json(
        { error: "sessionId and memoryId must be positive integers" },
        { status: 400 }
      );
    }
    if (!verifySessionOwnership(db, parsedSessionId, scope)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    db.prepare(
      `DELETE FROM session_memory_attachments 
       WHERE session_id = ? AND memory_id = ?`
    ).run(parsedSessionId, parsedMemoryId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error detaching memory from session:", error);
    return NextResponse.json(
      { error: "Failed to detach memory from session" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const scope = await assertScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update attachments" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { sessionId, memoryId, is_enabled, is_pinned, sort_order } = body;

    if (!sessionId || !memoryId) {
      return NextResponse.json(
        { error: "sessionId and memoryId are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const parsedSessionId = parsePositiveInt(sessionId);
    const parsedMemoryId = parsePositiveInt(memoryId);
    if (parsedSessionId === null || parsedMemoryId === null) {
      return NextResponse.json(
        { error: "sessionId and memoryId must be positive integers" },
        { status: 400 }
      );
    }
    const owner = getScopeOwner(scope);
    if (!verifySessionOwnership(db, parsedSessionId, scope)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (is_enabled !== undefined) {
      updates.push("is_enabled = ?");
      values.push(is_enabled ? 1 : 0);
    }
    if (is_pinned !== undefined) {
      updates.push("is_pinned = ?");
      values.push(is_pinned ? 1 : 0);
    }
    if (sort_order !== undefined) {
      updates.push("sort_order = ?");
      values.push(sort_order);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(parsedSessionId, parsedMemoryId);

    db.prepare(
      `UPDATE session_memory_attachments 
       SET ${updates.join(", ")} 
       WHERE session_id = ? AND memory_id = ?`
    ).run(...values);

    // Fetch updated attachment with memory details
    const attachment = db
      .prepare(
        `SELECT 
          sma.session_id,
          sma.memory_id,
          sma.is_enabled,
          sma.is_pinned,
          sma.sort_order,
          sma.created_at,
          m.title,
          m.summary,
          m.content,
          COALESCE(mf.name, 'Unsorted') as folder_name
        FROM session_memory_attachments sma
        JOIN memories m ON sma.memory_id = m.id
        LEFT JOIN memory_folders mf ON m.folder_id = mf.id
        WHERE sma.session_id = ? AND sma.memory_id = ? AND m.${owner.column} = ?`
      )
      .get(parsedSessionId, parsedMemoryId, owner.value);

    return NextResponse.json(attachment);
  } catch (error) {
    console.error("Error updating session attachment:", error);
    return NextResponse.json(
      { error: "Failed to update session attachment" },
      { status: 500 }
    );
  }
}
