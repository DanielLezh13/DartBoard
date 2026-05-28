import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const scope = await getServerScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (scope.kind !== "user") {
      return NextResponse.json({ error: "Reorder is only available for signed-in users" }, { status: 403 });
    }

    const body = await request.json();
    const updates = body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "updates must be a non-empty array" }, { status: 400 });
    }

    const db = getDb();
    const transaction = db.transaction(() => {
      for (const u of updates) {
        const id = u.id;
        const sortIndex = u.sort_index;
        if (id == null || typeof sortIndex !== "number") continue;
        db.prepare(
          `UPDATE chat_folders SET sort_index = ? WHERE id = ? AND user_id = ?`
        ).run(sortIndex, id, scope.userId);
      }
    });
    transaction();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering chat folders:", error);
    return NextResponse.json(
      { error: "Failed to reorder folders" },
      { status: 500 }
    );
  }
}
