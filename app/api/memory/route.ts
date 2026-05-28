import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { estimateTokens } from "@/lib/tokenEstimate";
import { MAX_MEMORY_SAVE_TOKENS } from "@/lib/limits";
import { getServerScope } from "@/lib/scope-server";
import { getMemoryDocPlainText, normalizeMemoryDocJson } from "@/lib/memoryDoc";
import { syncMemoryEmbeddingById } from "@/lib/memory/semantic";
import { getOpenAIClient } from "@/lib/openai";
import { getScopePlanLimits } from "@/lib/plan";
import {
  getOwnedMemory,
  getOwnedMemoryFolder,
  getScopeOwner,
  parsePositiveInt,
} from "@/lib/ownership";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const folder = searchParams.get("folder");
    const minImportance = searchParams.get("min_importance");

    const scope = await getServerScope(request);
    
    // Build WHERE clause
    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    
    if (scope) {
      if (scope.kind === "user") {
        whereClause += " AND m.user_id = ?";
        params.push(scope.userId);
      } else if (scope.kind === "guest") {
        // For guests, ONLY show memories with guest_id = ? (exclude NULL to avoid leaking user memories)
        whereClause += " AND m.guest_id = ?";
        params.push(scope.guestId);
      }
    } else {
      // No scope - return empty
      return NextResponse.json([]);
    }

    const db = getDb();
    let query = `
      SELECT m.id, m.session_id, m.message_id, m.title, m.summary, m.content, m.doc_json, m.excerpt,
             m.created_at, m.tags, m.importance, m.position, m.source, m.message_created_at,
             COALESCE(mf.name, 'Unsorted') as folder_name
      FROM memories m 
      LEFT JOIN memory_folders mf ON m.folder_id = mf.id 
      ${whereClause}
    `;

    // Search by text (q) - matches title or summary
    if (q) {
      query += ` AND (
        m.title LIKE ? OR 
        m.summary LIKE ?
      )`;
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm);
    }

    // Filter by folder name (case-insensitive match)
    if (folder) {
      query += ` AND LOWER(COALESCE(mf.name, 'Unsorted')) = LOWER(?)`;
      params.push(folder);
    }

    // Filter by minimum importance
    if (minImportance) {
      const minImp = parseInt(minImportance);
      if (!isNaN(minImp)) {
        query += ` AND (m.importance IS NOT NULL AND m.importance >= ?)`;
        params.push(minImp);
      }
    }

    query += ` ORDER BY 
      CASE WHEN m.position IS NULL THEN 1 ELSE 0 END,
      m.position ASC,
      m.created_at DESC`;

    const memories = db.prepare(query).all(...params);

    return NextResponse.json(memories);
  } catch (error) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      { error: "Failed to fetch memories" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      folder_id = null,
      folder_name = "Unsorted",
      session_id,
      message_id,
      title,
      summary,
      content,
      doc_json,
      importance = null,
      source = "dartz",
    } = body;

    if (summary === undefined && doc_json === undefined) {
      return NextResponse.json(
        { error: "summary or doc_json is required" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    
    if (!scope) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to create memories" },
        { status: 403 }
      );
    }

    const db = getDb();
    const { limits } = getScopePlanLimits(db, scope);

    if (Number.isFinite(limits.maxMemories)) {
      const memoryCount = db
        .prepare(`SELECT COUNT(*) as count FROM memories WHERE user_id = ?`)
        .get(scope.userId) as { count: number } | undefined;
      if ((memoryCount?.count ?? 0) >= limits.maxMemories) {
        return NextResponse.json(
          { error: `Memory limit reached (${limits.maxMemories}).` },
          { status: 403 }
        );
      }
    }

    let finalFolderId = null;

    const toPositiveIntOrNull = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return null;
      const int = Math.trunc(n);
      return int > 0 ? int : null;
    };

    // If folder_id is provided, use it directly
    if (folder_id !== null && folder_id !== undefined) {
      finalFolderId = toPositiveIntOrNull(folder_id);
      if (finalFolderId === null) {
        return NextResponse.json(
          { error: "folder_id must be a positive integer or null" },
          { status: 400 }
        );
      }
      const folder = getOwnedMemoryFolder(db, finalFolderId, scope);
      if (!folder) {
        return NextResponse.json(
          { error: "Folder not found" },
          { status: 404 }
        );
      }
    } else if (folder_name && folder_name !== "Unsorted") {
      // Fallback to folder_name lookup for backward compatibility
      let folderQuery = `SELECT id FROM memory_folders WHERE name = ?`;
      let folderParams: any[] = [folder_name];
      folderQuery += " AND user_id = ?";
      folderParams.push(scope.userId);
      
      let folder = db
        .prepare(folderQuery)
        .get(...folderParams);

      if (!folder) {
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

        // Create folder with scope
        let insertQuery = `INSERT INTO memory_folders (name`;
        let insertValues = `VALUES (?`;
        let insertParams: any[] = [folder_name];
        insertQuery += `, user_id)`;
        insertValues += `, ?)`;
        insertParams.push(scope.userId);
        
        const result = db
          .prepare(insertQuery + " " + insertValues)
          .run(...insertParams);
        finalFolderId = result.lastInsertRowid;
      } else {
        finalFolderId = (folder as { id: number }).id;
      }
    }

    const normalizedDocJson = normalizeMemoryDocJson(doc_json);
    const derivedSummaryFromDoc = normalizedDocJson
      ? getMemoryDocPlainText(normalizedDocJson)
      : "";
    const finalSummary =
      typeof summary === "string" && summary.trim().length > 0
        ? summary
        : (derivedSummaryFromDoc.trim() || " ");

    // Check memory size before saving
    const contentToCheck = content || finalSummary;
    const estimatedTokens = estimateTokens(contentToCheck);

    if (estimatedTokens > MAX_MEMORY_SAVE_TOKENS) {
      return NextResponse.json(
        { error: "Memory too large. Maximum allowed size is 8192 tokens." },
        { status: 400 }
      );
    }

    // Sanitize FK inputs so client-side temporary IDs don't 500 the request.
    let safeSessionId = toPositiveIntOrNull(session_id);
    let safeMessageId = toPositiveIntOrNull(message_id);

    if (safeSessionId !== null) {
      let sessionQuery = `SELECT id FROM sessions WHERE id = ?`;
      const sessionParams: any[] = [safeSessionId];
      sessionQuery += " AND user_id = ?";
      sessionParams.push(scope.userId);
      const sessionExists = db.prepare(sessionQuery).get(...sessionParams) as { id: number } | undefined;
      if (!sessionExists) {
        console.warn("[API SAVE] invalid session_id for scope; coercing to null", { session_id: safeSessionId, scope: scope.kind });
        safeSessionId = null;
      }
    }

    if (safeMessageId !== null) {
      let messageQuery = `SELECT id, session_id FROM messages WHERE id = ?`;
      const messageParams: any[] = [safeMessageId];
      messageQuery += " AND user_id = ?";
      messageParams.push(scope.userId);

      const messageRow = db.prepare(messageQuery).get(...messageParams) as { id: number; session_id: number | null } | undefined;
      if (!messageRow) {
        console.warn("[API SAVE] invalid message_id for scope; coercing to null", { message_id: safeMessageId, scope: scope.kind });
        safeMessageId = null;
      } else if (safeSessionId !== null && messageRow.session_id !== safeSessionId) {
        console.warn("[API SAVE] message_id/session_id mismatch; coercing message_id to null", {
          message_id: safeMessageId,
          message_session_id: messageRow.session_id,
          session_id: safeSessionId,
        });
        safeMessageId = null;
      } else if (safeSessionId === null && messageRow.session_id != null) {
        // Keep linkage coherent when message is valid but session wasn't supplied.
        safeSessionId = messageRow.session_id;
      }
    }

    // Insert memory (position will be set when memories are reordered)
    const result = db
      .prepare(
        `INSERT INTO memories (folder_id, session_id, message_id, title, summary, content, doc_json, tags, importance, position, source, user_id, guest_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        finalFolderId,
        safeSessionId,
        safeMessageId,
        title || null,
        finalSummary,
        content || null,
        normalizedDocJson,
        null,
        importance || null,
        source || "dartz",
        scope.userId,
        null
      );

    try {
      await syncMemoryEmbeddingById({
        db,
        openai: getOpenAIClient(),
        memoryId: Number(result.lastInsertRowid),
      });
    } catch (embeddingError) {
      console.warn("Failed to index memory embedding after create:", embeddingError);
    }

    // Fetch created memory with folder name
    const memory = db
      .prepare(
        `SELECT m.id, m.session_id, m.message_id, m.title, m.summary, m.content, m.doc_json, m.excerpt,
                m.created_at, m.tags, m.importance, m.position, m.source, m.message_created_at,
                COALESCE(mf.name, 'Unsorted') as folder_name
         FROM memories m 
         LEFT JOIN memory_folders mf ON m.folder_id = mf.id 
         WHERE m.id = ?`
      )
      .get(result.lastInsertRowid);

    return NextResponse.json(memory);
  } catch (error) {
    console.error("Error creating memory:", error);
    const detail = error instanceof Error ? error.message : null;
    return NextResponse.json(
      { error: detail || "Failed to create memory" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, title, summary, content, doc_json, excerpt, importance, folder_name } = body;

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
        { error: "Sign in required to update memories" },
        { status: 403 }
      );
    }
    const db = getDb();
    const owner = getScopeOwner(scope);
    const { limits } = getScopePlanLimits(db, scope);

    // Check if memory exists in caller scope.
    const existing = getOwnedMemory<{
      id: number;
      folder_id: number | null;
      content: string | null;
      summary: string;
    }>(db, parsedId, scope, "id, folder_id, content, summary");

    if (!existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    let folderId = null;

    // Handle folder creation/lookup if folder_name is provided
    if (folder_name !== undefined) {
      if (folder_name === null || folder_name === "" || folder_name === "Unsorted") {
        folderId = null;
      } else {
        let folder = db
          .prepare(`SELECT id FROM memory_folders WHERE name = ? AND ${owner.column} = ?`)
          .get(folder_name, owner.value);

        if (!folder) {
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

          const result = db
            .prepare(`INSERT INTO memory_folders (name, ${owner.column}) VALUES (?, ?)`)
            .run(folder_name, owner.value);
          folderId = result.lastInsertRowid;
        } else {
          folderId = (folder as { id: number }).id;
        }
      }
    } else {
      // Keep existing folder_id if folder_name not provided
      folderId = existing.folder_id;
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      values.push(title || null);
    }
    if (summary !== undefined) {
      updates.push("summary = ?");
      values.push(summary);
    }
    if (content !== undefined) {
      updates.push("content = ?");
      values.push(content || null);
    }
    if (doc_json !== undefined) {
      updates.push("doc_json = ?");
      values.push(normalizeMemoryDocJson(doc_json));
    }
    if (excerpt !== undefined) {
      updates.push("excerpt = ?");
      // Preserve empty string explicitly - only convert to null if actually null/undefined
      // Empty string "" means "blank custom text", null means "auto-generate from summary"
      values.push(excerpt === "" ? "" : (excerpt || null));
    }
    if (importance !== undefined) {
      updates.push("importance = ?");
      values.push(importance || null);
    }
    if (folder_name !== undefined) {
      updates.push("folder_id = ?");
      values.push(folderId);
    }

    // Ensure folder_id is never null when updating
    if (folderId === null && (folder_name === undefined || folder_name === null)) {
      // Only resolve if we're not already updating folder_id
      let folder = db
        .prepare(`SELECT id FROM memory_folders WHERE name = 'Unsorted' AND ${owner.column} = ?`)
        .get(owner.value);
      
      if (!folder) {
        const result = db
          .prepare(`INSERT INTO memory_folders (name, ${owner.column}) VALUES ('Unsorted', ?)`)
          .run(owner.value);
        folderId = result.lastInsertRowid;
      } else {
        folderId = (folder as { id: number }).id;
      }
      
      // If we didn't already add folder_id to updates, add it
      if (!updates.some(u => u.startsWith("folder_id"))) {
        updates.push("folder_id = ?");
        values.push(folderId);
      }
      
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // Check memory size if content, summary, or doc_json is being updated
    const docSummaryFallback =
      doc_json !== undefined ? getMemoryDocPlainText(doc_json).trim() : "";
    const newSummary =
      summary !== undefined
        ? summary
        : (docSummaryFallback || existing.summary);
    const newContent = content !== undefined ? content : existing.content;
    const contentToCheck = newContent || newSummary;
    const estimatedTokens = estimateTokens(contentToCheck);

    if (estimatedTokens > MAX_MEMORY_SAVE_TOKENS) {
      return NextResponse.json(
        { error: "Memory too large. Maximum allowed size is 8192 tokens." },
        { status: 400 }
      );
    }

    // Check for overflow in attached sessions if content or summary changed
    const { detach_overflow_sessions = false } = body;
    let overflowSessionIds: number[] = [];
    
    if ((content !== undefined || summary !== undefined || doc_json !== undefined) && detach_overflow_sessions !== true) {
      // Calculate token delta
      const oldContent = existing.content;
      const oldSummary = existing.summary;
      const oldText = oldContent || oldSummary || "";
      const oldTokens = estimateTokens(oldText);
      const delta = estimatedTokens - oldTokens;
      
      if (delta > 0) {
        // Find sessions where this memory is attached
        const attachedSessions = db
          .prepare(
            `SELECT sma.session_id
             FROM session_memory_attachments sma
             JOIN sessions s ON s.id = sma.session_id
             WHERE sma.memory_id = ? AND sma.is_enabled = 1 AND s.${owner.column} = ?`
          )
          .all(parsedId, owner.value) as Array<{ session_id: number }>;
        
        // Check each session for potential overflow
        for (const { session_id } of attachedSessions) {
          // Get all attached memories for this session
          const sessionAttachments = db
            .prepare(
              `SELECT m.content, m.summary 
               FROM session_memory_attachments sma
               JOIN memories m ON sma.memory_id = m.id
               WHERE sma.session_id = ? AND sma.is_enabled = 1`
            )
            .all(session_id) as Array<{ content: string | null; summary: string }>;
          
          // Calculate current tokens (same as usage endpoint)
          const currentTokens = sessionAttachments.reduce((total, att) => {
            const textToInject = att.content || att.summary;
            return total + estimateTokens(textToInject);
          }, 0);
          
          // Check if adding delta would exceed limit
          if (currentTokens + delta > limits.maxAttachedMemoryTokensPerSession) {
            overflowSessionIds.push(session_id);
          }
        }
      }
    }
    
    if (overflowSessionIds.length > 0 && detach_overflow_sessions !== true) {
      return NextResponse.json(
        {
          error: "edit_would_overflow_sessions",
          message: "Saving this edit would exceed the attached-memory cap in some sessions.",
          overflow_session_ids: overflowSessionIds,
        },
        { status: 409 }
      );
    }

    values.push(parsedId, owner.value);

    const updateQuery = `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND ${owner.column} = ?`;
    db.prepare(updateQuery).run(...values);

    try {
      await syncMemoryEmbeddingById({
        db,
        openai: getOpenAIClient(),
        memoryId: parsedId,
      });
    } catch (embeddingError) {
      console.warn("Failed to refresh memory embedding after update:", embeddingError);
    }

    // If overflow sessions exist and detach flag is true, detach from those sessions
    let detachedSessionIds: number[] = [];
    if (overflowSessionIds.length > 0 && detach_overflow_sessions === true) {
      const placeholders = overflowSessionIds.map(() => '?').join(',');
      const deleteQuery = `DELETE FROM session_memory_attachments 
                          WHERE memory_id = ? AND session_id IN (${placeholders})`;
      db.prepare(deleteQuery).run(parsedId, ...overflowSessionIds);
      detachedSessionIds = overflowSessionIds;
      
    }

    // Fetch updated memory with folder name
    const updated = db
      .prepare(
        `SELECT m.id, m.session_id, m.message_id, m.title, m.summary, m.content, m.doc_json, m.excerpt,
                m.created_at, m.tags, m.importance, m.position, m.source, m.message_created_at,
                COALESCE(mf.name, 'Unsorted') as folder_name
         FROM memories m 
         LEFT JOIN memory_folders mf ON m.folder_id = mf.id 
         WHERE m.id = ? AND m.${owner.column} = ?`
      )
      .get(parsedId, owner.value);

    // Return success with detach info if applicable
    const response: any = updated;
    if (detachedSessionIds.length > 0) {
      response.detached_session_ids = detachedSessionIds;
      response.overflow_session_ids = overflowSessionIds;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error updating memory:", error);
    return NextResponse.json(
      { error: "Failed to update memory" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

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
        { error: "Sign in required to delete memories" },
        { status: 403 }
      );
    }
    const db = getDb();
    const owner = getScopeOwner(scope);

    // Check if memory exists in caller scope.
    const existing = getOwnedMemory(db, parsedId, scope);

    if (!existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // Foreign keys: session_memory_attachments.memory_id references memories.id
    // Detach first, then delete the memory, in a transaction.
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM session_memory_attachments WHERE memory_id = ?`).run(parsedId);
      db.prepare(`DELETE FROM memories WHERE id = ? AND ${owner.column} = ?`).run(parsedId, owner.value);
    });
    tx();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting memory:", error);
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates } = body; // Array of { id, position } for reordering

    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: "updates must be an array" },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to reorder memories" },
        { status: 403 }
      );
    }
    const db = getDb();
    const owner = getScopeOwner(scope);

    // Batch update memory positions
    const updateStmt = db.prepare(
      `UPDATE memories SET position = ? WHERE id = ? AND ${owner.column} = ?`
    );
    const updateMany = db.transaction((updates: Array<{ id: number; position: number | null }>) => {
      for (const update of updates) {
        const parsedId = parsePositiveInt(update?.id);
        if (parsedId === null) continue;
        updateStmt.run(update.position, parsedId, owner.value);
      }
    });

    updateMany(updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating memory positions:", error);
    return NextResponse.json(
      { error: "Failed to update memory positions" },
      { status: 500 }
    );
  }
}
