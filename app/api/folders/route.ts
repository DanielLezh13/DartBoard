import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedChatFolder, parsePositiveInt } from "@/lib/ownership";
import { getScopePlanLimits } from "@/lib/plan";

export const dynamic = "force-dynamic";

// GET - Fetch all folders
export async function GET(request: NextRequest) {
  try {
    let scope: Awaited<ReturnType<typeof getServerScope>>;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json([]);
    }
    if (!scope) {
      return NextResponse.json([]);
    }
    const db = getDb();
    let folders: any[] = [];
    if (scope.kind === "user") {
      folders = db
        .prepare(`SELECT * FROM chat_folders WHERE user_id = ? ORDER BY COALESCE(sort_index, 999999) ASC, name ASC`)
        .all(scope.userId);
    } else {
      folders = [];
    }
    return NextResponse.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}

// POST - Create a new folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, icon } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    
    if (!scope) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Guests cannot create folders
    if (scope.kind === "guest") {
      return NextResponse.json(
        { error: "Folders are only available for signed-in users" },
        { status: 403 }
      );
    }

    const db = getDb();
    const { limits } = getScopePlanLimits(db, scope);

    if (Number.isFinite(limits.maxChatSessionFolders)) {
      const folderCount = db
        .prepare(`SELECT COUNT(*) as count FROM chat_folders WHERE user_id = ?`)
        .get(scope.userId) as { count: number } | undefined;
      if ((folderCount?.count ?? 0) >= limits.maxChatSessionFolders) {
        return NextResponse.json(
          { error: `Chat folder limit reached (${limits.maxChatSessionFolders}).` },
          { status: 403 }
        );
      }
    }

    const maxRow = db.prepare(`SELECT MAX(COALESCE(sort_index, 0)) as maxIdx FROM chat_folders WHERE user_id = ?`).get(scope.userId) as { maxIdx: number | null };
    const nextSortIndex = (maxRow?.maxIdx ?? 0) + 1;
    const result = db
      .prepare(
        `INSERT INTO chat_folders (name, icon, user_id, guest_id, sort_index) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        name, 
        icon || null, 
        scope.userId,
        null,
        nextSortIndex
      );
    
    return NextResponse.json({ id: result.lastInsertRowid, name, icon });
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}

// PATCH - Update a folder (supports partial updates: name and/or icon)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, icon } = body;

    const parsedId = parsePositiveInt(id);
    if (parsedId === null) {
      return NextResponse.json(
        { error: "Folder id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Folders are only available for signed-in users" },
        { status: 403 }
      );
    }

    const db = getDb();
    const existing = getOwnedChatFolder<{ id: number; name: string; icon: string | null }>(
      db,
      parsedId,
      scope,
      "id, name, icon"
    );
    if (!existing) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 }
      );
    }

    const newName = name !== undefined ? name : existing.name;
    const newIcon = icon !== undefined ? (icon || null) : existing.icon;

    db.prepare(`UPDATE chat_folders SET name = ?, icon = ? WHERE id = ? AND user_id = ?`)
      .run(newName, newIcon, parsedId, scope.userId);

    const folder = db
      .prepare(`SELECT * FROM chat_folders WHERE id = ? AND user_id = ?`)
      .get(parsedId, scope.userId);
    
    return NextResponse.json(folder);
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a folder
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const parsedId = parsePositiveInt(id);
    if (parsedId === null) {
      return NextResponse.json(
        { error: "Folder id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Folders are only available for signed-in users" },
        { status: 403 }
      );
    }

    const db = getDb();
    const existing = getOwnedChatFolder(db, parsedId, scope);
    if (!existing) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 }
      );
    }
    
    const tx = db.transaction(() => {
      // Primary folder linkage lives on sessions.in_folder_id.
      // Clear it first so sessions remain visible in Unfiled after folder deletion.
      db.prepare(
        `UPDATE sessions
         SET in_folder_id = NULL,
             folder_order_ts = NULL
         WHERE user_id = ?
           AND in_folder_id = ?`
      ).run(scope.userId, parsedId);

      // Delete mappings for this owner's sessions first.
      db.prepare(
        `DELETE FROM session_folder_mapping
         WHERE folder_id = ?
           AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)`
      ).run(parsedId, scope.userId);

      db.prepare(`DELETE FROM chat_folders WHERE id = ? AND user_id = ?`).run(parsedId, scope.userId);
    });
    tx();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: "Failed to delete folder" },
      { status: 500 }
    );
  }
}
