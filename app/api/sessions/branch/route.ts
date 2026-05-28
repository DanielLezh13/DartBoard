import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sourceSessionId = toPositiveInt(body?.sourceSessionId);
    const anchorMessageId = toPositiveInt(body?.anchorMessageId);
    const carryCount = Math.min(Math.max(toPositiveInt(body?.carryCount) ?? 10, 1), 20);

    if (!sourceSessionId || !anchorMessageId) {
      return NextResponse.json(
        { error: "sourceSessionId and anchorMessageId are required" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    const db = getDb();

    const sourceSession =
      scope.kind === "user"
        ? db
            .prepare(
              `SELECT id, title, mode, focus_goal, focus_enabled, user_id, guest_id
               FROM sessions
               WHERE id = ? AND is_deleted = 0 AND user_id = ?`
            )
            .get(sourceSessionId, scope.userId)
        : db
            .prepare(
              `SELECT id, title, mode, focus_goal, focus_enabled, user_id, guest_id
               FROM sessions
               WHERE id = ? AND is_deleted = 0 AND guest_id = ?`
            )
            .get(sourceSessionId, scope.guestId);

    if (!sourceSession) {
      return NextResponse.json({ error: "Source session not found" }, { status: 404 });
    }

    const anchorMessage = db
      .prepare(
        `SELECT id
         FROM messages
         WHERE id = ? AND session_id = ? AND role = 'assistant'`
      )
      .get(anchorMessageId, sourceSessionId);

    if (!anchorMessage) {
      return NextResponse.json({ error: "Branch anchor message not found" }, { status: 404 });
    }

    const rows = db
      .prepare(
        `SELECT id, role, content, created_at, model, meta, image_paths, user_id, guest_id
         FROM (
           SELECT id, role, content, created_at, model, meta, image_paths, user_id, guest_id
           FROM messages
           WHERE session_id = ?
             AND id <= ?
             AND role IN ('user', 'assistant')
           ORDER BY id DESC
           LIMIT ?
         )
         ORDER BY id ASC`
      )
      .all(sourceSessionId, anchorMessageId, carryCount) as Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      created_at: string;
      model?: string | null;
      meta?: string | null;
      image_paths?: string | null;
      user_id?: string | null;
      guest_id?: string | null;
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No branchable messages found" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const baseTitle = typeof (sourceSession as any).title === "string" ? (sourceSession as any).title.trim() : "";
    const branchTitle = baseTitle.length > 0 ? `Branch: ${baseTitle}` : "Branched Chat";

    const tx = db.transaction(() => {
      const newSessionId = db
        .prepare(
          `INSERT INTO sessions (source, title, mode, focus_goal, focus_enabled, created_at, updated_at, mru_ts, user_id, guest_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "dartz_chat",
          branchTitle,
          (sourceSession as any).mode || "tactical",
          (sourceSession as any).focus_goal ?? null,
          Number((sourceSession as any).focus_enabled || 0) === 1 ? 1 : 0,
          nowIso,
          nowIso,
          Date.now(),
          (sourceSession as any).user_id ?? null,
          (sourceSession as any).guest_id ?? null
        ).lastInsertRowid as number;

      db.prepare(
        `INSERT OR IGNORE INTO session_memory_attachments (session_id, memory_id, is_enabled, is_pinned, sort_order, created_at)
         SELECT ?, memory_id, is_enabled, is_pinned, sort_order, ?
         FROM session_memory_attachments
         WHERE session_id = ?`
      ).run(newSessionId, nowIso, sourceSessionId);

      const branchSystemNote =
        `Branch context: This session was branched from session ${sourceSessionId} at assistant message ${anchorMessageId}. ` +
        `It starts with the latest ${rows.length} messages up to that branch point.`;

      db.prepare(
        `INSERT INTO messages (session_id, role, content, created_at, model, meta, user_id, guest_id)
         VALUES (?, 'system_summary', ?, ?, ?, ?, ?, ?)`
      ).run(
        newSessionId,
        branchSystemNote,
        nowIso,
        "branch-note",
        JSON.stringify({ summarizedUntilId: 0, type: "branch_note", sourceSessionId, anchorMessageId }),
        (sourceSession as any).user_id ?? null,
        (sourceSession as any).guest_id ?? null
      );

      const insertMessage = db.prepare(
        `INSERT INTO messages (session_id, role, content, created_at, model, meta, image_paths, user_id, guest_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const row of rows) {
        insertMessage.run(
          newSessionId,
          row.role,
          row.content,
          row.created_at || nowIso,
          row.model ?? null,
          row.meta ?? null,
          row.image_paths ?? null,
          (sourceSession as any).user_id ?? null,
          (sourceSession as any).guest_id ?? null
        );
      }

      return newSessionId;
    });

    const newSessionId = tx();
    return NextResponse.json({ newSessionId, copiedMessages: rows.length });
  } catch (error) {
    console.error("Error branching session:", error);
    return NextResponse.json({ error: "Failed to branch session" }, { status: 500 });
  }
}
