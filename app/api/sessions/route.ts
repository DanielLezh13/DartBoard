import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope, scopeToWhereClause } from "@/lib/scope-server";
import { getScopePlanLimits } from "@/lib/plan";
import {
  getOwnedChatFolder,
  getOwnedSession,
  getScopeOwner,
  parsePositiveInt,
} from "@/lib/ownership";

export const dynamic = "force-dynamic";

const MAX_SESSION_SEARCH_QUERY_CHARS = 200;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (q && q.length > MAX_SESSION_SEARCH_QUERY_CHARS) {
      return NextResponse.json(
        { error: `Search query too long. Max ${MAX_SESSION_SEARCH_QUERY_CHARS} characters.` },
        { status: 400 }
      );
    }

    // Get unified scope
    const scope = await getServerScope(request);
    
    const db = getDb();
    let sessions;
    
    // Build WHERE clause using scope
    const { clause: scopeClause, params: scopeParams } = scopeToWhereClause(scope);
    let whereClause = `WHERE is_deleted = 0 AND ${scopeClause}`;
    let params = scopeParams;

    if (q) {
      // Search sessions by title or message content
	      sessions = db
	        .prepare(
	          `SELECT s.id, s.title, s.created_at, s.updated_at, s.mode, s.in_folder_id, s.mru_ts, s.folder_order_ts, s.focus_goal, s.focus_enabled
	           FROM sessions s
	           LEFT JOIN messages m ON s.id = m.session_id
	           ${whereClause}
	           AND (
             s.title LIKE ? OR
             m.content LIKE ?
           )
           GROUP BY s.id
           ORDER BY s.mru_ts DESC, s.updated_at DESC, s.id DESC`
        )
        .all(...params, `%${q}%`, `%${q}%`);
    } else {
	      sessions = db
	        .prepare(
	          `SELECT id, title, created_at, updated_at, mode, in_folder_id, mru_ts, folder_order_ts, focus_goal, focus_enabled
	           FROM sessions 
	           ${whereClause}
	           ORDER BY mru_ts DESC, updated_at DESC, id DESC`
	        )
        .all(...params);
    }

    // Convert in_folder_id to inFolderId for frontend compatibility
	    const sessionsWithFolders = sessions.map((session: any) => ({
	      ...session,
	      inFolderId: session.in_folder_id,
	      focusGoal: typeof session.focus_goal === "string" ? session.focus_goal : null,
	      focusEnabled:
	        Number(session.focus_enabled || 0) === 1 &&
	        typeof session.focus_goal === "string" &&
	        session.focus_goal.trim().length > 0,
	      folderOrderTs: session.folder_order_ts ?? null,
	      in_folder_id: undefined // Remove the DB column name
	    }));

    return NextResponse.json(sessionsWithFolders);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, mode, source } = body;

    // Get unified scope
    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to create sessions" },
        { status: 403 }
      );
    }
    
    const db = getDb();
    const { limits } = getScopePlanLimits(db, scope);

    if (Number.isFinite(limits.maxSessions)) {
      const sessionCount = db
        .prepare(
          `SELECT COUNT(*) as count
           FROM sessions
           WHERE user_id = ? AND COALESCE(is_deleted, 0) = 0`
        )
        .get(scope.userId) as { count: number } | undefined;
      if ((sessionCount?.count ?? 0) >= limits.maxSessions) {
        return NextResponse.json(
          { error: `Session limit reached (${limits.maxSessions}).` },
          { status: 403 }
        );
      }
    }

    const now = new Date().toISOString();
    
    // Set ownership based on scope
    const userId = scope.userId;
    const guestId = null;
    
    const newId = db
      .prepare(
        `INSERT INTO sessions (source, title, mode, created_at, updated_at, mru_ts, user_id, guest_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source || "dartz_assistant", 
        title || null, 
        mode || "tactical",
        now,
        now,
        Date.now(), // Set mru_ts to current milliseconds
        userId,
        guestId
      ).lastInsertRowid;

    const row = db
      .prepare(
        `SELECT id, created_at, updated_at FROM sessions WHERE id = ?`
      )
      .get(newId) as any;

    return NextResponse.json({
      session_id: newId,
      created_at: row?.created_at ?? null,
      updated_at: row?.updated_at ?? null,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, title, mode, is_deleted, in_folder_id, folder_order_ts } = body;

    const parsedId = parsePositiveInt(id);
    if (parsedId === null) {
      return NextResponse.json(
        { error: "id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to update sessions" },
        { status: 403 }
      );
    }
    const db = getDb();
    const owner = getScopeOwner(scope);

    const existingSession = getOwnedSession(db, parsedId, scope);
    if (!existingSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    let parsedFolderId: number | null | undefined;
    if (in_folder_id !== undefined) {
      if (in_folder_id === null || in_folder_id === "") {
        parsedFolderId = null;
      } else {
        parsedFolderId = parsePositiveInt(in_folder_id);
        if (parsedFolderId === null) {
          return NextResponse.json(
            { error: "in_folder_id must be a positive integer or null" },
            { status: 400 }
          );
        }
      }

      if (parsedFolderId !== null) {
        if (scope.kind !== "user") {
          return NextResponse.json(
            { error: "Folders are only available for signed-in users" },
            { status: 403 }
          );
        }
        const folder = getOwnedChatFolder(db, parsedFolderId, scope);
        if (!folder) {
          return NextResponse.json(
            { error: "Folder not found" },
            { status: 404 }
          );
        }
      }
    }
    
    // Update title if provided
    if (title !== undefined) {
      db.prepare(`UPDATE sessions SET title = ? WHERE id = ? AND ${owner.column} = ?`).run(
        title || null,
        parsedId,
        owner.value
      );
    }
    
    // Update mode if provided
    if (mode !== undefined) {
      db.prepare(`UPDATE sessions SET mode = ? WHERE id = ? AND ${owner.column} = ?`).run(
        mode,
        parsedId,
        owner.value
      );
    }
    
    // Update is_deleted if provided
    if (is_deleted !== undefined) {
      db.prepare(`UPDATE sessions SET is_deleted = ? WHERE id = ? AND ${owner.column} = ?`).run(
        is_deleted ? 1 : 0,
        parsedId,
        owner.value
      );
    }
    
    // Update in_folder_id if provided
    if (parsedFolderId !== undefined) {
      db.prepare(`UPDATE sessions SET in_folder_id = ? WHERE id = ? AND ${owner.column} = ?`).run(
        parsedFolderId,
        parsedId,
        owner.value
      );
    }

    // Update folder_order_ts if provided; otherwise derive on folder move.
    if (folder_order_ts !== undefined) {
      const parsed =
        folder_order_ts == null
          ? null
          : Number.isFinite(Number(folder_order_ts))
            ? Math.trunc(Number(folder_order_ts))
            : null;
      db.prepare(`UPDATE sessions SET folder_order_ts = ? WHERE id = ? AND ${owner.column} = ?`).run(
        parsed,
        parsedId,
        owner.value
      );
    } else if (parsedFolderId !== undefined) {
      const nextOrderTs = parsedFolderId ? Date.now() : null;
      db.prepare(`UPDATE sessions SET folder_order_ts = ? WHERE id = ? AND ${owner.column} = ?`).run(
        nextOrderTs,
        parsedId,
        owner.value
      );
    }

    // Return updated session
	    const session = db
	      .prepare(`SELECT id, title, created_at, updated_at, mode, in_folder_id, folder_order_ts, focus_goal, focus_enabled FROM sessions WHERE id = ? AND ${owner.column} = ?`)
	      .get(parsedId, owner.value) as any;

	    return NextResponse.json({
	      ...session,
	      inFolderId: session?.in_folder_id,
	      focusGoal: typeof session?.focus_goal === "string" ? session.focus_goal : null,
	      focusEnabled:
	        Number(session?.focus_enabled || 0) === 1 &&
	        typeof session?.focus_goal === "string" &&
	        session.focus_goal.trim().length > 0,
	    });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");

    const parsedSessionId = parsePositiveInt(sessionId);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: "session_id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to delete sessions" },
        { status: 403 }
      );
    }
    const db = getDb();
    const owner = getScopeOwner(scope);
    const result = db
      .prepare(`UPDATE sessions SET is_deleted = 1 WHERE id = ? AND ${owner.column} = ?`)
      .run(parsedSessionId, owner.value);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
