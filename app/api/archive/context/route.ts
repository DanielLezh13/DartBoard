import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

const clampWindow = (value: number) => {
  if (Number.isNaN(value) || value < 1) return 20;
  if (value > 200) return 200;
  return value;
};

export async function GET(request: NextRequest) {
  try {
    const scope = await getServerScope(request);
    if (!scope) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const scopeUserId = scope.kind === "user" ? scope.userId : null;
    const scopeGuestId = scope.kind === "guest" ? scope.guestId : null;

    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    const windowParam = searchParams.get("window");

    if (!idParam) {
      return NextResponse.json(
        { error: "id parameter is required" },
        { status: 400 }
      );
    }

    const messageId = Number(idParam);
    if (Number.isNaN(messageId)) {
      return NextResponse.json(
        { error: "id must be a valid number" },
        { status: 400 }
      );
    }

    const windowSize = clampWindow(windowParam ? Number(windowParam) : 20);
    const db = getDb();

    const target = db
      .prepare(
        `SELECT id, ts, role, chat_id, text, source
         FROM archive_messages
         WHERE id = ?
         AND (user_id = ? OR guest_id = ?)`
      )
      .get(messageId, scopeUserId, scopeGuestId) as ArchiveMessage | undefined;

    if (!target) {
      return NextResponse.json(
        { error: "Archive message not found" },
        { status: 404 }
      );
    }

    const before = db
      .prepare(
        `SELECT id, ts, role, chat_id, text, source
         FROM archive_messages
         WHERE ((ts < ?) OR (ts = ? AND id < ?))
         AND (user_id = ? OR guest_id = ?)
         ORDER BY ts DESC, id DESC
         LIMIT ?`
      )
      .all(target.ts, target.ts, target.id, scopeUserId, scopeGuestId, windowSize) as ArchiveMessage[];

    const after = db
      .prepare(
        `SELECT id, ts, role, chat_id, text, source
         FROM archive_messages
         WHERE ((ts > ?) OR (ts = ? AND id > ?))
         AND (user_id = ? OR guest_id = ?)
         ORDER BY ts ASC, id ASC
         LIMIT ?`
      )
      .all(target.ts, target.ts, target.id, scopeUserId, scopeGuestId, windowSize) as ArchiveMessage[];

    const messages = [
      ...before.reverse(),
      target,
      ...after,
    ];

    return NextResponse.json({
      messages,
      targetId: target.id,
    });
  } catch (error) {
    console.error("Error fetching archive context:", error);
    return NextResponse.json(
      { error: "Failed to fetch archive context" },
      { status: 500 }
    );
  }
}

interface ArchiveMessage {
  id: number;
  ts: string;
  role: string;
  chat_id: string;
  text: string;
  source: string;
}
