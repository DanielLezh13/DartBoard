import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeText } from "@/lib/normalizeText";
import { getServerScope } from "@/lib/scope-server";
import { enforceApiRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

type ArchiveRow = {
  ts: string;      // ISO timestamp
  role: "user" | "assistant";
  chat_id: string;
  text: string;
  source: string;
};

// Helper: Normalize timestamp to ISO string (always UTC)
// Universal logic: detects milliseconds vs seconds, handles all formats
// Based on Vault Explorer logic: > 1e12 = milliseconds, <= 1e12 = seconds
function normalizeTimestamp(timestamp: string | number | Date | null | undefined): string {
  if (!timestamp) {
    return new Date().toISOString(); // Fallback to now
  }
  
  if (timestamp instanceof Date) {
    return timestamp.toISOString(); // Already a Date, convert to ISO (UTC)
  }
  
  if (typeof timestamp === 'string') {
    // Try parsing as ISO string first (handles "2024-11-20T07:37:42.800Z" format)
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString(); // toISOString() always returns UTC
    }
    
    // If string is numeric, parse it as number
    const num = Number(timestamp);
    if (!isNaN(num)) {
      // Universal detection: > 1e12 = milliseconds, <= 1e12 = seconds
      // (1e12 seconds = ~2001-09-09, so anything larger is likely milliseconds)
      const millis = num > 1e12 ? num : num * 1000;
      return new Date(millis).toISOString();
    }
    
    return new Date().toISOString(); // Fallback
  }
  
  if (typeof timestamp === 'number') {
    // Universal detection: > 1e12 = milliseconds, <= 1e12 = seconds
    const millis = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(millis).toISOString();
  }
  
  return new Date().toISOString(); // Fallback
}

// Adapter 1: Parse ChatGPT parquet file
async function parseChatGPTParquet(buffer: ArrayBuffer): Promise<ArchiveRow[]> {
  // Note: Using parquetjs for Node.js
  // If this doesn't work, we can try @dsnp/parquetjs or another library
  let ParquetReader: any;
  try {
    ParquetReader = require('parquetjs').ParquetReader;
  } catch (e) {
    // Fallback: try alternative library
    try {
      ParquetReader = require('@dsnp/parquetjs').ParquetReader;
    } catch (e2) {
      throw new Error("Parquet library not found. Install with: npm install parquetjs");
    }
  }
  
  const rows: ArchiveRow[] = [];
  
  try {
    // Read parquet file from buffer
    const reader = await ParquetReader.openBuffer(Buffer.from(buffer));
    const cursor = reader.getCursor();
    
    let record;
    while ((record = await cursor.next())) {
      // Map parquet columns to our schema
      // Adjust column names based on actual ChatGPT export format
      const ts = record.ts || record.timestamp || record.created_at || new Date().toISOString();
      const roleRaw = record.role || record.author_role || record.message?.author?.role || "user";
      const role = roleRaw === "assistant" || roleRaw === "model" ? "assistant" : "user";
      const chatId = record.chat_id || record.conversation_id || record.id || "unknown";
      const rawContent = record.text || record.content || record.message?.content?.parts || record.message?.content || "";
      
      // Normalize text to handle citation objects, arrays, and [object Object] artifacts
      const normalizedText = normalizeText(rawContent);
      
      if (normalizedText && normalizedText.trim().length > 0) {
        rows.push({
          ts: normalizeTimestamp(ts),
          role,
          chat_id: String(chatId),
          text: normalizedText,
          source: "chatgpt_parquet",
        });
      }
    }
    
    await reader.close();
  } catch (error) {
    console.error("Error parsing parquet:", error);
    throw new Error(`Failed to parse parquet file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  
  return rows;
}

// Adapter 2: Parse ChatGPT JSON export
function parseChatGPTJson(jsonText: string): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  
  try {
    const data = JSON.parse(jsonText);
    
    // Handle ChatGPT conversations.json format
    const conversations = data.conversations || data || [];
    
    for (const conversation of conversations) {
      const chatId = conversation.id || conversation.title || `chat_${Date.now()}`;
      
      // Get conversation-level timestamp (fallback if message timestamps missing)
      const convTimestamp = conversation.create_time || conversation.update_time || 
                            conversation.created_at || conversation.updated_at || null;
      
      const messages = conversation.messages || conversation.mapping || [];
      
      // Handle different JSON structures
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          // Try message-level timestamp first, fallback to conversation timestamp
          const timestamp = msg.create_time || msg.created_at || msg.update_time || 
                           msg.updated_at || msg.timestamp || convTimestamp || null;
          
          const roleRaw = msg.author?.role || msg.role || msg.message?.author?.role || "user";
          const role = roleRaw === "assistant" || roleRaw === "model" ? "assistant" : "user";
          const rawContent = msg.content?.parts || msg.content || msg.message?.content?.parts || msg.message?.content || msg.text || "";
          
          // Normalize text to handle citation objects, arrays, and [object Object] artifacts
          const normalizedText = normalizeText(rawContent);
          
          if (normalizedText && normalizedText.trim().length > 0) {
            rows.push({
              ts: normalizeTimestamp(timestamp),
              role,
              chat_id: String(chatId),
              text: normalizedText,
              source: "chatgpt_json",
            });
          }
        }
      } else if (typeof messages === 'object') {
        // Handle mapping structure (conversation.mapping is an object)
        for (const [key, value] of Object.entries(messages)) {
          const node = value as any;
          const msg = node?.message || node;
          
          if (!msg) continue;
          
          // Try message-level timestamp first, fallback to conversation timestamp
          const timestamp = msg.create_time || msg.created_at || msg.update_time || 
                           msg.updated_at || msg.timestamp || convTimestamp || null;
          
          const roleRaw = msg.author?.role || msg.role || "user";
          const role = roleRaw === "assistant" || roleRaw === "model" ? "assistant" : "user";
          const rawContent = msg.content?.parts || msg.content || msg.text || "";
          
          // Normalize text to handle citation objects, arrays, and [object Object] artifacts
          const normalizedText = normalizeText(rawContent);
          
          if (normalizedText && normalizedText.trim().length > 0) {
            rows.push({
              ts: normalizeTimestamp(timestamp),
              role,
              chat_id: String(chatId),
              text: normalizedText,
              source: "chatgpt_json",
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error parsing JSON:", error);
    throw new Error(`Failed to parse JSON file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  
  return rows;
}

/**
 * Duplicate detection: checks if (ts, role, chat_id, text) already exists
 * 
 * Note: This uses strict matching on all 4 fields including timestamp.
 * 
 * Tradeoff: If you change the timestamp parser and re-import the same file,
 * messages will be inserted as duplicates (because ts changed). This is by design
 * to prevent accidental merges of truly different messages.
 * 
 * To re-import with corrected timestamps:
 * 1. Use "Clear Archive" to delete existing messages
 * 2. Re-import the file with the new parser
 * 
 * Alternative approach (not implemented): Match on (chat_id, role, text) only
 * and update ts if different. This risks merging true duplicates with different timestamps.
 */
function isDuplicate(db: any, row: ArchiveRow, scope: any): boolean {
  const existing = db
    .prepare(
      `SELECT id FROM archive_messages 
       WHERE ts = ? AND role = ? AND chat_id = ? AND text = ? 
       AND (user_id = ? OR guest_id = ?)
       LIMIT 1`
    )
    .get(
      row.ts, 
      row.role, 
      row.chat_id, 
      row.text,
      scope.kind === "user" ? scope.userId : null,
      scope.kind === "guest" ? scope.guestId : null
    );
  
  return !!existing;
}

export async function POST(request: NextRequest) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required for archive import" },
        { status: 403 }
      );
    }
    
    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/archive/import", limit: 5, windowMs: 10 * 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const formatParam = formData.get("format") as string | null;
    
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Import file is too large. Maximum allowed size is 50 MB." },
        { status: 400 }
      );
    }
    
    // Detect format from filename or use provided format
    let format: "parquet" | "json";
    if (formatParam && (formatParam === "parquet" || formatParam === "json")) {
      format = formatParam;
    } else {
      const filename = file.name.toLowerCase();
      if (filename.endsWith(".parquet")) {
        format = "parquet";
      } else if (filename.endsWith(".json")) {
        format = "json";
      } else {
        return NextResponse.json(
          { error: "Unsupported file format. Expected .parquet or .json" },
          { status: 400 }
        );
      }
    }
    
    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Parse based on format
    let rows: ArchiveRow[];
    if (format === "parquet") {
      rows = await parseChatGPTParquet(arrayBuffer);
    } else {
      const text = new TextDecoder().decode(arrayBuffer);
      rows = parseChatGPTJson(text);
    }
    
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No messages found in file" },
        { status: 400 }
      );
    }
    
    // Insert into database with duplicate checking
    const insertStmt = db.prepare(
      `INSERT INTO archive_messages (ts, role, chat_id, text, source, user_id, guest_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    
    let inserted = 0;
    let skipped = 0;
    
    for (const row of rows) {
      if (isDuplicate(db, row, scope)) {
        skipped++;
        continue;
      }
      
      try {
        insertStmt.run(
          row.ts, 
          row.role, 
          row.chat_id, 
          row.text, 
          row.source,
          scope.userId,
          null
        );
        inserted++;
      } catch (error) {
        console.error("Error inserting row:", error);
        skipped++;
      }
    }
    
    return NextResponse.json({
      inserted,
      skipped,
      source: format === "parquet" ? "chatgpt_parquet" : "chatgpt_json",
    });
  } catch (error) {
    console.error("Error importing archive:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import archive" },
      { status: 500 }
    );
  }
}
