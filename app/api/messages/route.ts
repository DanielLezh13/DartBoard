import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedSession, getScopeOwner, parsePositiveInt } from "@/lib/ownership";

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

    // Get unified scope
    const scope = await getServerScope(request);

    const db = getDb();
    const session = getOwnedSession(db, parsedSessionId, scope);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const messages = db
      .prepare(
        `SELECT id, role, content, created_at, model, meta, image_paths 
         FROM messages 
         WHERE session_id = ? 
         ORDER BY created_at ASC`
      )
      .all(parsedSessionId);

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, role, content, model, meta, image_paths } = body;

    if (!session_id || !role || !content) {
      return NextResponse.json(
        { error: "session_id, role, and content are required" },
        { status: 400 }
      );
    }

    const parsedSessionId = parsePositiveInt(session_id);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: "session_id must be a positive integer" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind === "guest") {
      return NextResponse.json(
        { error: "Sign in required to create messages." },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);
    
    const userId = scope.userId;
    const guestId = null;

    const db = getDb();
    const session = getOwnedSession<{ id: number; title: string | null }>(
      db,
      parsedSessionId,
      scope,
      "id, title"
    );
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    
    // If this is the first user message in the session, auto-generate a title
    if (role === "user") {
      const existingMessages = db
        .prepare(
          `SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND role = 'user'`
        )
        .get(parsedSessionId) as { count: number } | undefined;
      
      // If this is the first user message (count will be 0 before insert)
      if (existingMessages && existingMessages.count === 0) {
        // Only auto-generate if title is null
        if (!session.title) {
          // Generate title from first ~50 chars of user message
          const title = content.trim().substring(0, 50).trim();
          // If content was truncated, add ellipsis
          const finalTitle = content.length > 50 ? `${title}...` : title;
          
          // Fallback to timestamp if title is empty
          if (!finalTitle) {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            const hours = String(now.getHours()).padStart(2, "0");
            const minutes = String(now.getMinutes()).padStart(2, "0");
            const timestamp = `${year}-${month}-${day} ${hours}:${minutes}`;
            db.prepare(`UPDATE sessions SET title = ? WHERE id = ? AND ${owner.column} = ?`).run(
              `Chat – ${timestamp}`,
              parsedSessionId,
              owner.value
            );
          } else {
            db.prepare(`UPDATE sessions SET title = ? WHERE id = ? AND ${owner.column} = ?`).run(
              finalTitle,
              parsedSessionId,
              owner.value
            );
          }
        }
      }
    }
    
    // Store image_paths as JSON array string
    const imagePathsJson = image_paths && Array.isArray(image_paths) 
      ? JSON.stringify(image_paths) 
      : null;
    
    const result = db
      .prepare(
        `INSERT INTO messages (session_id, role, content, model, meta, image_paths, user_id, guest_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        parsedSessionId,
        role,
        content,
        model || null,
        meta ? JSON.stringify(meta) : null,
        imagePathsJson,
        userId,
        guestId
      );

    // Update session's updated_at timestamp only when assistant message is inserted
    // (Unfiled ordering is driven by assistant reply time, not user send time)
    if (role === "assistant") {
      db.prepare(`UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND ${owner.column} = ?`).run(
        parsedSessionId,
        owner.value
      );
    }

    const message = db
      .prepare(`SELECT * FROM messages WHERE id = ? AND session_id = ?`)
      .get(result.lastInsertRowid, parsedSessionId);

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error creating message:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}
