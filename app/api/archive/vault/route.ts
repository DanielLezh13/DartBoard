import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { normalizeMemoryDocJson } from "@/lib/memoryDoc";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      archive_message_id,
      folder_name = "Unsorted",
      title,
      summary,
      doc_json,
      excerpt,
      importance = null,
    } = body;

    if (!archive_message_id) {
      return NextResponse.json(
        { error: "archive_message_id is required" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Get the archive message to ensure we have the original markdown and timestamp
    const archiveMsg = db
      .prepare(
        `SELECT text, ts FROM archive_messages
         WHERE id = ?
         AND (user_id = ? OR guest_id = ?)`
      )
      .get(archive_message_id, scopeUserId, scopeGuestId) as { text: string; ts: string } | undefined;

    if (!archiveMsg) {
      return NextResponse.json(
        { error: "Archive message not found" },
        { status: 404 }
      );
    }

    // Prefer edited summary from modal when provided.
    // Fallback to archive text only when summary is missing from caller.
    const hasProvidedSummary = typeof summary === "string";
    const providedSummary = hasProvidedSummary ? summary.trim() : "";
    const archiveFallback = (archiveMsg.text?.trim() || " ").trim() || " ";
    const finalSummary = hasProvidedSummary ? (providedSummary || " ") : archiveFallback;

    // Get or create folder
    let folderId: number | null = null;
    if (folder_name !== "Unsorted") {
      const existingFolder = db
        .prepare(
          `SELECT id FROM memory_folders
           WHERE name = ?
           AND (user_id = ? OR guest_id = ?)`
        )
        .get(folder_name, scopeUserId, scopeGuestId) as { id: number } | undefined;

      if (existingFolder) {
        folderId = existingFolder.id;
      } else {
        // Create new folder
        const result = db
          .prepare(`INSERT INTO memory_folders (name, user_id, guest_id) VALUES (?, ?, ?)`)
          .run(folder_name, scopeUserId, scopeGuestId);
        folderId = result.lastInsertRowid as number;
      }
    }

    const normalizedDocJson = normalizeMemoryDocJson(doc_json);

    // Insert into memories table
    const topPos = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

    const result = db
      .prepare(
        `INSERT INTO memories (folder_id, title, summary, doc_json, excerpt, importance, source, position, message_created_at, user_id, guest_id)
         VALUES (?, ?, ?, ?, ?, ?, 'archive', ?, ?, ?, ?)`
      )
      .run(
        folderId,
        title || null,
        finalSummary,
        normalizedDocJson,
        excerpt || null,
        importance,
        topPos,
        archiveMsg.ts || null,
        scopeUserId,
        scopeGuestId
      );

    return NextResponse.json({
      id: result.lastInsertRowid,
      message: "Saved to vault",
    });
  } catch (error) {
    console.error("Error saving to vault:", error);
    return NextResponse.json(
      { error: "Failed to save to vault" },
      { status: 500 }
    );
  }
}
