import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedMemoryFolder, getScopeOwner, parsePositiveInt } from "@/lib/ownership";
import { getScopePlanLimits } from "@/lib/plan";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    
    const scope = await getServerScope(request);
    
    if (!scope) {
      // No scope - return empty folders
      return NextResponse.json({
        folders: [],
        total_memories: 0,
        unsorted_count: 0,
      });
    }
    
    // Build WHERE clause based on scope
    let whereClause = "";
    let whereParams: any[] = [];
    
    if (scope.kind === "user") {
      whereClause = "WHERE mf.user_id = ?";
      whereParams.push(scope.userId);
    } else if (scope.kind === "guest") {
      whereClause = "WHERE mf.guest_id = ?";
      whereParams.push(scope.guestId);
    }
    
    // Get all folders with memory counts and positions
    const folders = db
      .prepare(
        `SELECT 
          mf.id,
          mf.name,
          mf.icon,
          mf.importance,
          mf.position,
          mf.created_at,
          COUNT(m.id) as memory_count
        FROM memory_folders mf
        LEFT JOIN memories m ON m.folder_id = mf.id
        ${whereClause}
        GROUP BY mf.id
        ORDER BY 
          COALESCE(mf.position, 999999) ASC,
          mf.name ASC`
      )
      .all(...whereParams) as Array<{
        id: number;
        name: string;
        icon: string | null;
        importance: number | null;
        position: number | null;
        created_at: string;
        memory_count: number;
      }>;

    // Get total memories count (filtered by scope)
    let totalMemoriesQuery = "SELECT COUNT(*) as count FROM memories";
    let totalMemoriesParams: any[] = [];
    
    if (scope.kind === "user") {
      totalMemoriesQuery += " WHERE user_id = ?";
      totalMemoriesParams.push(scope.userId);
    } else if (scope.kind === "guest") {
      totalMemoriesQuery += " WHERE guest_id = ?";
      totalMemoriesParams.push(scope.guestId);
    }
    
    const totalMemories = db
      .prepare(totalMemoriesQuery)
      .get(...totalMemoriesParams) as { count: number };

    // Get unsorted memories count (filtered by scope)
    let unsortedQuery = "SELECT COUNT(*) as count FROM memories WHERE folder_id IS NULL";
    let unsortedParams: any[] = [];
    
    if (scope.kind === "user") {
      unsortedQuery += " AND user_id = ?";
      unsortedParams.push(scope.userId);
    } else if (scope.kind === "guest") {
      unsortedQuery += " AND guest_id = ?";
      unsortedParams.push(scope.guestId);
    }
    
    const unsortedMemories = db
      .prepare(unsortedQuery)
      .get(...unsortedParams) as { count: number };

    return NextResponse.json({
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        icon: f.icon,
        importance: f.importance,
        position: f.position,
        created_at: f.created_at,
        memory_count: f.memory_count,
      })),
      total_memories: totalMemories.count,
      unsorted_count: unsortedMemories.count,
    });
  } catch (error) {
    console.error("Error fetching memory folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch memory folders" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { folder_name, importance, old_name, new_name, icon, folder_id } = body;

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update memory folders" },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);
    const db = getDb();

    // Handle folder rename
    if (old_name !== undefined && new_name !== undefined) {
      if (!old_name || !new_name || !new_name.trim()) {
        return NextResponse.json(
          { error: "old_name and new_name are required for rename" },
          { status: 400 }
        );
      }

      // Check if old folder exists
      const oldFolder = db
        .prepare(`SELECT id FROM memory_folders WHERE LOWER(name) = LOWER(?) AND ${owner.column} = ?`)
        .get(old_name.trim(), owner.value) as { id: number } | undefined;

      if (!oldFolder) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }

      // Check if new name already exists (case-insensitive, excluding current folder)
      const existing = db
        .prepare(`SELECT id FROM memory_folders WHERE LOWER(name) = LOWER(?) AND id != ? AND ${owner.column} = ?`)
        .get(new_name.trim(), oldFolder.id, owner.value) as { id: number } | undefined;

      if (existing) {
        return NextResponse.json(
          { error: "A folder with this name already exists" },
          { status: 409 }
        );
      }

      // Update folder name
      db.prepare(
        `UPDATE memory_folders SET name = ? WHERE id = ? AND ${owner.column} = ?`
      ).run(new_name.trim(), oldFolder.id, owner.value);

      // Update icon if provided
      if (icon !== undefined) {
        db.prepare(
          `UPDATE memory_folders SET icon = ? WHERE id = ? AND ${owner.column} = ?`
        ).run(icon, oldFolder.id, owner.value);
      }

      return NextResponse.json({ success: true, message: "Folder renamed" });
    }

    // Handle importance update (legacy support)
    if (folder_name && importance !== undefined) {
      const folder = db
        .prepare(`SELECT id FROM memory_folders WHERE name = ? AND ${owner.column} = ?`)
        .get(folder_name, owner.value) as { id: number } | undefined;

      if (folder) {
        db.prepare(
          `UPDATE memory_folders SET importance = ? WHERE id = ? AND ${owner.column} = ?`
        ).run(importance || null, folder.id, owner.value);
        return NextResponse.json({ success: true });
      }
    }

    // Handle icon update
    if (folder_id !== undefined && icon !== undefined) {
      const parsedFolderId = parsePositiveInt(folder_id);
      if (parsedFolderId === null) {
        return NextResponse.json(
          { error: "folder_id must be a positive integer" },
          { status: 400 }
        );
      }

      // Verify folder exists
      const folder = getOwnedMemoryFolder(db, parsedFolderId, scope);

      if (!folder) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }

      // Update icon
      db.prepare(
        `UPDATE memory_folders SET icon = ? WHERE id = ? AND ${owner.column} = ?`
      ).run(icon, parsedFolderId, owner.value);

      return NextResponse.json({ success: true, message: "Icon updated" });
    }

    return NextResponse.json(
      { error: "Invalid request parameters" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating folder:", error);
    return NextResponse.json(
      { error: "Failed to update folder" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { folder_name } = body;

    if (!folder_name || !folder_name.trim()) {
      return NextResponse.json(
        { error: "folder_name is required" },
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
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to create memory folders" },
        { status: 403 }
      );
    }

    const db = getDb();
    const { limits } = getScopePlanLimits(db, scope);

    if (Number.isFinite(limits.maxMemoryFolders)) {
      const folderCount = db
        .prepare(`SELECT COUNT(*) as count FROM memory_folders WHERE user_id = ?`)
        .get(scope.userId) as { count: number } | undefined;
      if ((folderCount?.count ?? 0) >= limits.maxMemoryFolders) {
        return NextResponse.json(
          { error: `Memory folder limit reached (${limits.maxMemoryFolders}).` },
          { status: 403 }
        );
      }
    }

    // Check if folder already exists (case-insensitive) within the same scope
    let checkQuery = `SELECT id FROM memory_folders WHERE LOWER(name) = LOWER(?)`;
    let checkParams: any[] = [folder_name.trim()];
    checkQuery += " AND user_id = ?";
    checkParams.push(scope.userId);
    
    const existing = db
      .prepare(checkQuery)
      .get(...checkParams) as { id: number } | undefined;

    if (existing) {
      return NextResponse.json(
        { error: "A folder with this name already exists" },
        { status: 409 }
      );
    }

    // Get the next position (append to bottom) within scope
    let maxPosQuery = `SELECT MAX(position) as maxPos FROM memory_folders`;
    let maxPosParams: any[] = [];
    maxPosQuery += " WHERE user_id = ?";
    maxPosParams.push(scope.userId);
    
    const maxPos = db
      .prepare(maxPosQuery)
      .get(...maxPosParams) as { maxPos: number | null } | undefined;
    const nextPosition = (maxPos?.maxPos ?? -1) + 1;

    // Create new folder with position at the end and scope
    let insertQuery = `INSERT INTO memory_folders (name, position`;
    let insertValues = `VALUES (?, ?`;
    let insertParams: any[] = [folder_name.trim(), nextPosition];
    insertQuery += `, user_id)`;
    insertValues += `, ?)`;
    insertParams.push(scope.userId);
    
    const result = db
      .prepare(insertQuery + " " + insertValues)
      .run(...insertParams);

    const id = Number(result.lastInsertRowid);
    const createdFolder = {
      id,
      name: folder_name.trim(),
      icon: null as string | null,
      importance: null as number | null,
      position: nextPosition,
      created_at: new Date().toISOString(),
      memory_count: 0,
    };

    return NextResponse.json(createdFolder);
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json(
      { error: "Failed to create folder" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates, folder_id, icon } = body;
    
    const db = getDb();
    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update memory folders" },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);
    
    // Handle single folder icon update
    if (folder_id !== undefined && icon !== undefined) {
      const parsedFolderId = parsePositiveInt(folder_id);
      if (parsedFolderId === null) {
        return NextResponse.json(
          { error: "folder_id must be a positive integer" },
          { status: 400 }
        );
      }

      const result = db.prepare(
        `UPDATE memory_folders SET icon = ? WHERE id = ? AND ${owner.column} = ?`
      ).run(icon, parsedFolderId, owner.value);
      
      if (result.changes === 0) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }
      
      // Return the updated folder
      const updatedFolder = db.prepare(
        `SELECT id, name, icon FROM memory_folders WHERE id = ? AND ${owner.column} = ?`
      ).get(parsedFolderId, owner.value) as { id: number; name: string; icon: string | null };
      
      return NextResponse.json(updatedFolder);
    }
    
    // Handle batch updates (position/name)
    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: "updates must be an array" },
        { status: 400 }
      );
    }

    const scopeClause = `${owner.column} = ?`;
    const scopeParam = owner.value;

    const transaction = db.transaction(() => {
      for (const update of updates) {
        if (update.position !== undefined) {
          db.prepare(
            `UPDATE memory_folders SET position = ? WHERE id = ? AND ${scopeClause}`
          ).run(update.position, update.id, scopeParam);
        }
        if (update.name !== undefined) {
          const existing = db
            .prepare(`SELECT id FROM memory_folders WHERE LOWER(name) = LOWER(?) AND id != ? AND ${scopeClause}`)
            .get(update.name, update.id, scopeParam) as { id: number } | undefined;
          if (existing) {
            throw new Error(`A folder with name "${update.name}" already exists`);
          }
          db.prepare(
            `UPDATE memory_folders SET name = ? WHERE id = ? AND ${scopeClause}`
          ).run(update.name, update.id, scopeParam);
        }
      }
    });

    transaction();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating folders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update folders" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const folder_name = searchParams.get("folder_name");
    const folder_id = searchParams.get("folder_id");

    if (!folder_name && !folder_id) {
      return NextResponse.json(
        { error: "folder_name or folder_id is required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to delete memory folders" },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);

    // Find folder by name or id
    let folder: { id: number } | undefined;
    if (folder_id) {
      const parsedFolderId = parsePositiveInt(folder_id);
      if (parsedFolderId === null) {
        return NextResponse.json(
          { error: "folder_id must be a positive integer" },
          { status: 400 }
        );
      }
      folder = db
        .prepare(`SELECT id FROM memory_folders WHERE id = ? AND ${owner.column} = ?`)
        .get(parsedFolderId, owner.value) as { id: number } | undefined;
    } else {
      folder = db
        .prepare(`SELECT id FROM memory_folders WHERE LOWER(name) = LOWER(?) AND ${owner.column} = ?`)
        .get(folder_name!, owner.value) as { id: number } | undefined;
    }

    if (!folder) {
      return NextResponse.json(
        { error: `Folder not found: ${folder_name || folder_id}` },
        { status: 404 }
      );
    }

    // Use transaction to DELETE memories and delete folder
    const transaction = db.transaction(() => {
      // Delete all memories in this folder (permanently remove them)
      db.prepare(
        `DELETE FROM memories WHERE folder_id = ? AND ${owner.column} = ?`
      ).run(folder!.id, owner.value);

      // Delete the folder
      db.prepare(
        `DELETE FROM memory_folders WHERE id = ? AND ${owner.column} = ?`
      ).run(folder!.id, owner.value);
    });

    transaction();

    return NextResponse.json({ success: true, message: "Folder and memories deleted" });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete folder" },
      { status: 500 }
    );
  }
}
