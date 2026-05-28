import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const configuredDbPath = process.env.DB_PATH?.trim();
const dbPath = configuredDbPath
  ? (path.isAbsolute(configuredDbPath)
      ? configuredDbPath
      : path.join(process.cwd(), configuredDbPath))
  : path.join(process.cwd(), "dartz_memory.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT,
      title TEXT,
      mode TEXT DEFAULT 'tactical',
      focus_goal TEXT,
      focus_enabled INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      rolling_summary TEXT DEFAULT '',
      summarized_until_message_id INTEGER NULL,
      user_id TEXT,
      guest_id TEXT
    );

    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      model TEXT,
      meta TEXT,
      image_paths TEXT,
      user_id TEXT,
      guest_id TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS memory_folders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      importance INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT,
      guest_id TEXT
    );

    CREATE TABLE IF NOT EXISTS memories(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER,
      session_id INTEGER,
      message_id INTEGER,
      title TEXT,
      summary TEXT NOT NULL,
      content TEXT,
      doc_json TEXT,
      excerpt TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      tags TEXT,
      importance INTEGER,
      position INTEGER,
      source TEXT DEFAULT 'dartz',
      message_created_at TEXT,
      embedding_vector TEXT,
      embedding_model TEXT,
      embedding_source_hash TEXT,
      embedding_updated_at TEXT,
      user_id TEXT,
      guest_id TEXT,
      FOREIGN KEY(folder_id) REFERENCES memory_folders(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id),
      FOREIGN KEY(message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS user_profile(
      id INTEGER PRIMARY KEY,
      display_name TEXT,
      style TEXT,
      preferences TEXT,
      core_spec TEXT DEFAULT '' NOT NULL,
      plan TEXT DEFAULT 'free' NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doc_chat_messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      doc_mode TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS people_profiles(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'met',
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS location_profiles(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'target',
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS daily_usage(
      user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      metric TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, usage_date, metric)
    );

    CREATE TABLE IF NOT EXISTS uploaded_images(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stored_name TEXT NOT NULL UNIQUE,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_rate_limits(
      route_key TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(route_key, actor_key, window_start_ms)
    );

    CREATE TABLE IF NOT EXISTS session_memory_attachments(
      session_id INTEGER NOT NULL,
      memory_id INTEGER NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      is_pinned INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(session_id, memory_id),
      FOREIGN KEY(session_id) REFERENCES sessions(id),
      FOREIGN KEY(memory_id) REFERENCES memories(id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_attachments_session_sort ON session_memory_attachments(session_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_session_attachments_memory ON session_memory_attachments(memory_id);

    CREATE TABLE IF NOT EXISTS archive_messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      role TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      user_id TEXT,
      guest_id TEXT
    );
  `);

  // Migration: add rolling_summary column if missing
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const has = cols.some((c) => c.name === "rolling_summary");
    if (!has) {
      db.prepare("ALTER TABLE sessions ADD COLUMN rolling_summary TEXT DEFAULT ''").run();
    }
  } catch {
    // ignore
  }

  // Migration: add user_id and guest_id columns to archive_messages if missing
  try {
    const archiveCols = db.prepare("PRAGMA table_info(archive_messages)").all() as Array<{ name: string }>;
    const hasUserId = archiveCols.some((c) => c.name === "user_id");
    const hasGuestId = archiveCols.some((c) => c.name === "guest_id");
    
    if (!hasUserId) {
      db.prepare("ALTER TABLE archive_messages ADD COLUMN user_id TEXT").run();
    }
    if (!hasGuestId) {
      db.prepare("ALTER TABLE archive_messages ADD COLUMN guest_id TEXT").run();
    }
  } catch {
    // ignore
  }

  // Migration: ensure user_profile.plan exists and is normalized
  try {
    db.prepare(`ALTER TABLE user_profile ADD COLUMN plan TEXT DEFAULT 'free' NOT NULL`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding plan column to user_profile (may already exist):", e);
    }
  }

  try {
    db.prepare(
      `UPDATE user_profile
       SET plan = 'free'
       WHERE plan IS NULL OR TRIM(plan) = ''`
    ).run();
  } catch (e: any) {
    console.warn("Error normalizing user_profile.plan defaults:", e);
  }

  // Migration: add summarized_until_message_id column if missing
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const has = cols.some((c) => c.name === "summarized_until_message_id");
    if (!has) {
      db.prepare("ALTER TABLE sessions ADD COLUMN summarized_until_message_id INTEGER NULL").run();
    }
  } catch {
    // ignore
  }

  // Create indexes on archive_messages for better query performance
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_archive_ts ON archive_messages(ts);
      CREATE INDEX IF NOT EXISTS idx_archive_role ON archive_messages(role);
      CREATE INDEX IF NOT EXISTS idx_archive_chat_id ON archive_messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_archive_text ON archive_messages(text);
      -- Composite index for efficient sorting and position queries
      CREATE INDEX IF NOT EXISTS idx_archive_ts_id ON archive_messages(ts, id);
      CREATE INDEX IF NOT EXISTS idx_uploaded_images_user_created_at ON uploaded_images(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start ON api_rate_limits(window_start_ms);
      CREATE INDEX IF NOT EXISTS idx_memories_user_created_at ON memories(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_guest_created_at ON memories(guest_id, created_at DESC);
    `);
  } catch (e: any) {
    console.warn("Error creating archive_messages indexes:", e);
  }

  // Migration: Add source column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN source TEXT DEFAULT 'dartz'`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding source column (may already exist):", e);
    }
  }

  // Migration: Add message_created_at column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN message_created_at TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding message_created_at column (may already exist):", e);
    }
  }

  // Migration: Add content column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN content TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding content column (may already exist):", e);
    }
  }

  // Migration: Add doc_json column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN doc_json TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding doc_json column (may already exist):", e);
    }
  }

  // Migration: Add excerpt column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN excerpt TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding excerpt column (may already exist):", e);
    }
  }

  // Migration: Add position column to memories table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN position INTEGER`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding position column to memories (may already exist):", e);
    }
  }

  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN embedding_vector TEXT`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding embedding_vector column to memories (may already exist):", e);
    }
  }

  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN embedding_model TEXT`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding embedding_model column to memories (may already exist):", e);
    }
  }

  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN embedding_source_hash TEXT`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding embedding_source_hash column to memories (may already exist):", e);
    }
  }

  try {
    db.prepare(`ALTER TABLE memories ADD COLUMN embedding_updated_at TEXT`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding embedding_updated_at column to memories (may already exist):", e);
    }
  }

  // Migration: Add image_paths column to messages table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE messages ADD COLUMN image_paths TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding image_paths column (may already exist):", e);
    }
  }

  // Migration: Add position column to memory_folders if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memory_folders ADD COLUMN position INTEGER`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding position column (may already exist):", e);
    }
  }

  // Migration: Add source column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN source TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding source column to sessions (may already exist):", e);
    }
  }

  // Migration: Add mode column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'tactical'`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding mode column to sessions (may already exist):", e);
    }
  }

  // Migration: Add focus_goal column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN focus_goal TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding focus_goal column to sessions (may already exist):", e);
    }
  }

  // Migration: Add focus_enabled column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN focus_enabled INTEGER DEFAULT 0`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding focus_enabled column to sessions (may already exist):", e);
    }
  }

  // Backfill: disable focus when no focus_goal is present
  try {
    db.prepare(`
      UPDATE sessions
      SET focus_enabled = 0
      WHERE focus_enabled IS NULL
         OR focus_goal IS NULL
         OR TRIM(focus_goal) = ''
    `).run();
  } catch (e: any) {
    console.warn("Error normalizing focus_enabled backfill:", e);
  }

  // Migration: Add updated_at column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding updated_at column to sessions (may already exist):", e);
    }
  }

  // Migration: Add icon column to memory_folders table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE memory_folders ADD COLUMN icon TEXT`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding icon column to memory_folders (may already exist):", e);
    }
  }

  // Migration: Add mru_ts column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN mru_ts INTEGER NOT NULL DEFAULT 0`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding mru_ts column (may already exist):", e);
    }
  }

  // Migration: Normalize mru_ts to milliseconds (one-time)
  try {
    // Check if we need to normalize (look for sessions with mru_ts < 1e12)
    const needsNormalization = db.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE mru_ts > 0 AND mru_ts < 1000000000000
    `).get() as { count: number };
    
    if (needsNormalization.count > 0) {
      // Update sessions with seconds-based mru_ts to milliseconds
      db.prepare(`
        UPDATE sessions 
        SET mru_ts = (
          CASE 
            WHEN mru_ts > 0 AND mru_ts < 1000000000000 
            THEN strftime('%s', updated_at) * 1000
            ELSE mru_ts
          END
        )
        WHERE mru_ts > 0
      `).run();
      
      // For any sessions that still have mru_ts = 0, set from updated_at
      db.prepare(`
        UPDATE sessions 
        SET mru_ts = strftime('%s', updated_at) * 1000
        WHERE mru_ts = 0
      `).run();
    }
  } catch (e: any) {
    console.warn("Error normalizing mru_ts:", e);
  }

  // Migration: Add in_folder_id column to sessions table if it doesn't exist
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN in_folder_id INTEGER`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding in_folder_id column (may already exist):", e);
    }
  }

  // Migration: Add folder_order_ts column to sessions table if it doesn't exist
  // Used for ordering sessions inside custom folders (newly added first + manual reorder).
  try {
    db.prepare(`ALTER TABLE sessions ADD COLUMN folder_order_ts INTEGER`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding folder_order_ts column (may already exist):", e);
    }
  }

  // Backfill folder_order_ts for existing foldered sessions (one-time)
  try {
    db.prepare(`
      UPDATE sessions
      SET folder_order_ts = COALESCE(NULLIF(mru_ts, 0), strftime('%s', updated_at) * 1000)
      WHERE in_folder_id IS NOT NULL
        AND (folder_order_ts IS NULL OR folder_order_ts = 0)
    `).run();
  } catch (e: any) {
    console.warn("Error backfilling folder_order_ts:", e);
  }

  // Create chat folders table for DB-backed folder persistence
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_folders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT,
      guest_id TEXT
    );
  `);

  // Migration: Add sort_index column to chat_folders if it doesn't exist
  try {
    db.prepare(`ALTER TABLE chat_folders ADD COLUMN sort_index INTEGER`).run();
    // Backfill existing rows with id order
    db.prepare(`UPDATE chat_folders SET sort_index = id WHERE sort_index IS NULL`).run();
  } catch (e: any) {
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding sort_index column to chat_folders (may already exist):", e);
    }
  }

  // Create session_folder mapping table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_folder_mapping(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      folder_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(folder_id) REFERENCES chat_folders(id) ON DELETE CASCADE
    );
  `);

  // Create indexes for folder queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_folder_session ON session_folder_mapping(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_folder_folder ON session_folder_mapping(folder_id);
  `);

  return db;
}

export interface UserProfile {
  id: number;
  display_name: string | null;
  style: string | null;
  preferences: string | null;
  core_spec: string;
  personal_context?: string | null;
  plan: "free" | "plus";
}

export function getUserProfile(userId?: string | null): UserProfile {
  const db = getDb();
  
  // Ensure core_spec column exists (migration for existing databases)
  try {
    db.prepare(`ALTER TABLE user_profile ADD COLUMN core_spec TEXT DEFAULT '' NOT NULL`).run();
  } catch (e) {
    // Column already exists, ignore
  }

  // Ensure personal_context column exists
  try {
    db.prepare(`ALTER TABLE user_profile ADD COLUMN personal_context TEXT`).run();
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Ensure user_id column exists for user-scoped profiles
  try {
    db.prepare(`ALTER TABLE user_profile ADD COLUMN user_id TEXT`).run();
  } catch (e) {
    // Column already exists, ignore
  }
  
  // If userId provided, get user-specific profile, otherwise get default (id=1)
  let profile;
  if (userId) {
    profile = db
      .prepare(`SELECT * FROM user_profile WHERE user_id = ?`)
      .get(userId) as UserProfile | undefined;
  } else {
    profile = db
      .prepare(`SELECT * FROM user_profile WHERE id = 1`)
      .get() as UserProfile | undefined;
  }

  if (profile) {
    // Ensure core_spec exists (handle old records)
    return {
      ...profile,
      core_spec: profile.core_spec ?? "",
      plan: profile.plan === "plus" ? "plus" : "free",
    };
  }

  // Return defaults if no profile exists
  return {
    id: 1,
    display_name: null,
    style: null,
    preferences: null,
    core_spec: "",
    personal_context: null,
    plan: "free",
  };
}

export function saveUserProfile(profile: {
  display_name: string | null;
  style: string | null;
  preferences: string | null;
  core_spec: string;
  personal_context?: string | null;
}, userId?: string | null): UserProfile {
  const db = getDb();
  
  // If userId provided, save/update user-specific profile
  if (userId) {
    // Check if profile exists for this user
    const existing = db
      .prepare(`SELECT id FROM user_profile WHERE user_id = ?`)
      .get(userId);
    
    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE user_profile 
        SET display_name = ?, style = ?, preferences = ?, core_spec = ?, personal_context = ?
        WHERE user_id = ?
      `).run(
        profile.display_name,
        profile.style,
        profile.preferences,
        profile.core_spec || "",
        profile.personal_context || null,
        userId
      );
    } else {
      // Create new
      const result = db.prepare(`
        INSERT INTO user_profile (display_name, style, preferences, core_spec, personal_context, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        profile.display_name,
        profile.style,
        profile.preferences,
        profile.core_spec || "",
        profile.personal_context || null,
        userId
      );
    }
    
    // Return the updated profile
    return getUserProfile(userId);
  } else {
    // Original behavior - update default profile (id=1)
    db.prepare(`
      UPDATE user_profile 
      SET display_name = ?, style = ?, preferences = ?, core_spec = ?, personal_context = ?
      WHERE id = 1
    `).run(
      profile.display_name,
      profile.style,
      profile.preferences,
      profile.core_spec || "",
      profile.personal_context || null
    );
    
    return getUserProfile();
  }
}

export interface Document {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function getDocuments(): Array<{
  id: number;
  title: string;
  updated_at: string;
}> {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, title, updated_at 
       FROM documents 
       ORDER BY updated_at DESC`
    )
    .all() as Array<{ id: number; title: string; updated_at: string }>;
}

export function getDocumentById(id: number): Document | null {
  const db = getDb();
  const document = db
    .prepare(`SELECT * FROM documents WHERE id = ?`)
    .get(id) as Document | undefined;

  return document || null;
}

export function createDocument(title: string = "Untitled"): Document {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO documents (title, content, created_at, updated_at) 
       VALUES (?, ?, ?, ?)`
    )
    .run(title, "", now, now);

  const document = db
    .prepare(`SELECT * FROM documents WHERE id = ?`)
    .get(result.lastInsertRowid) as Document;

  return document;
}

export function updateDocument(
  id: number,
  title: string,
  content: string
): Document {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE documents 
     SET title = ?, content = ?, updated_at = ? 
     WHERE id = ?`
  ).run(title, content, now, id);

  const document = db
    .prepare(`SELECT * FROM documents WHERE id = ?`)
    .get(id) as Document;

  return document;
}

export interface DocChatMessage {
  id: number;
  document_id: number;
  role: "user" | "assistant";
  content: string;
  doc_mode: string;
  created_at: string;
}

export function getDocChatMessages(documentId: number): DocChatMessage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM doc_chat_messages 
       WHERE document_id = ? 
       ORDER BY created_at ASC`
    )
    .all(documentId) as DocChatMessage[];
}

export function saveDocChatMessage(
  documentId: number,
  role: "user" | "assistant",
  content: string,
  docMode: string
): DocChatMessage {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO doc_chat_messages (document_id, role, content, doc_mode) 
       VALUES (?, ?, ?, ?)`
    )
    .run(documentId, role, content, docMode);

  const message = db
    .prepare(`SELECT * FROM doc_chat_messages WHERE id = ?`)
    .get(result.lastInsertRowid) as DocChatMessage;

  return message;
}

// People Profiles
export type PersonCategory = "met" | "analyzed" | "archetype";

export interface PersonProfile {
  id: number;
  name: string;
  category: PersonCategory;
  summary: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export function getPeopleProfiles(category?: PersonCategory): PersonProfile[] {
  const db = getDb();
  if (category) {
    return db
      .prepare(
        `SELECT * FROM people_profiles 
         WHERE category = ? 
         ORDER BY updated_at DESC`
      )
      .all(category) as PersonProfile[];
  } else {
    return db
      .prepare(
        `SELECT * FROM people_profiles 
         ORDER BY updated_at DESC`
      )
      .all() as PersonProfile[];
  }
}

export function createOrUpdatePerson(params: {
  id?: number;
  name: string;
  category?: PersonCategory;
  summary: string;
  tags: string;
}): PersonProfile {
  const db = getDb();
  const now = new Date().toISOString();
  const category = params.category || "met";

  // Ensure category column exists (migration for existing databases)
  try {
    db.prepare(`ALTER TABLE people_profiles ADD COLUMN category TEXT NOT NULL DEFAULT 'met'`).run();
  } catch (e: any) {
    // Column already exists, ignore error
    if (!e.message?.includes("duplicate column")) {
      console.warn("Error adding category column (may already exist):", e);
    }
  }

  if (params.id) {
    // Update existing
    db.prepare(
      `UPDATE people_profiles 
       SET name = ?, category = ?, summary = ?, tags = ?, updated_at = ? 
       WHERE id = ?`
    ).run(params.name, category, params.summary, params.tags, now, params.id);

    const person = db
      .prepare(`SELECT * FROM people_profiles WHERE id = ?`)
      .get(params.id) as PersonProfile;

    return person;
  } else {
    // Create new
    const result = db
      .prepare(
        `INSERT INTO people_profiles (name, category, summary, tags, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(params.name, category, params.summary, params.tags, now, now);

    const person = db
      .prepare(`SELECT * FROM people_profiles WHERE id = ?`)
      .get(result.lastInsertRowid) as PersonProfile;

    return person;
  }
}

export function deletePerson(id: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM people_profiles WHERE id = ?`).run(id);
}

// Location Profiles
export type LocationKind = "visited" | "target";

export interface LocationProfile {
  id: number;
  name: string;
  kind: LocationKind;
  summary: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export function getLocationProfiles(kind?: LocationKind): LocationProfile[] {
  const db = getDb();
  if (kind) {
    return db
      .prepare(
        `SELECT * FROM location_profiles 
         WHERE kind = ? 
         ORDER BY updated_at DESC`
      )
      .all(kind) as LocationProfile[];
  } else {
    return db
      .prepare(
        `SELECT * FROM location_profiles 
         ORDER BY updated_at DESC`
      )
      .all() as LocationProfile[];
  }
}

export function createOrUpdateLocation(params: {
  id?: number;
  name: string;
  kind: LocationKind;
  summary: string;
  tags: string;
}): LocationProfile {
  const db = getDb();
  const now = new Date().toISOString();

  if (params.id) {
    // Update existing
    db.prepare(
      `UPDATE location_profiles 
       SET name = ?, kind = ?, summary = ?, tags = ?, updated_at = ? 
       WHERE id = ?`
    ).run(
      params.name,
      params.kind,
      params.summary,
      params.tags,
      now,
      params.id
    );

    const location = db
      .prepare(`SELECT * FROM location_profiles WHERE id = ?`)
      .get(params.id) as LocationProfile;

    return location;
  } else {
    // Create new
    const result = db
      .prepare(
        `INSERT INTO location_profiles (name, kind, summary, tags, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.name,
        params.kind,
        params.summary,
        params.tags,
        now,
        now
      );

    const location = db
      .prepare(`SELECT * FROM location_profiles WHERE id = ?`)
      .get(result.lastInsertRowid) as LocationProfile;

    return location;
  }
}

export function deleteLocation(id: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM location_profiles WHERE id = ?`).run(id);
}

// Token Usage
export interface TokenUsage {
  id: number;
  session_id: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

export function logTokenUsage(params: {
  session_id: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): TokenUsage {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO token_usage (session_id, model, prompt_tokens, completion_tokens, total_tokens) 
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.session_id,
      params.model,
      params.prompt_tokens,
      params.completion_tokens,
      params.total_tokens
    );

  const usage = db
    .prepare(`SELECT * FROM token_usage WHERE id = ?`)
    .get(result.lastInsertRowid) as TokenUsage;

  return usage;
}

// Chat Folders - DB-backed
export interface ChatFolder {
  id: number;
  name: string;
  icon?: string | null;
  created_at: string;
  updated_at: string;
}

export function getChatFolders(): ChatFolder[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM chat_folders ORDER BY name ASC`)
    .all() as ChatFolder[];
}

export function createChatFolder(name: string, icon?: string): ChatFolder {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO chat_folders (name, icon) VALUES (?, ?)`)
    .run(name, icon || null);
  
  return db
    .prepare(`SELECT * FROM chat_folders WHERE id = ?`)
    .get(result.lastInsertRowid) as ChatFolder;
}

export function updateChatFolder(id: number, name?: string, icon?: string): ChatFolder {
  const db = getDb();
  const now = new Date().toISOString();
  
  if (name !== undefined && icon !== undefined) {
    db.prepare(`UPDATE chat_folders SET name = ?, icon = ?, updated_at = ? WHERE id = ?`)
      .run(name, icon, now, id);
  } else if (name !== undefined) {
    db.prepare(`UPDATE chat_folders SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name, now, id);
  } else if (icon !== undefined) {
    db.prepare(`UPDATE chat_folders SET icon = ?, updated_at = ? WHERE id = ?`)
      .run(icon, now, id);
  }
  
  return db
    .prepare(`SELECT * FROM chat_folders WHERE id = ?`)
    .get(id) as ChatFolder;
}

export function deleteChatFolder(id: number): void {
  const db = getDb();
  // Delete mappings first (foreign key should handle this, but being explicit)
  db.prepare(`DELETE FROM session_folder_mapping WHERE folder_id = ?`).run(id);
  // Delete folder
  db.prepare(`DELETE FROM chat_folders WHERE id = ?`).run(id);
}

// Session folder mapping
export function getSessionFolder(sessionId: number): number | null {
  const db = getDb();
  const result = db
    .prepare(`SELECT folder_id FROM session_folder_mapping WHERE session_id = ?`)
    .get(sessionId) as { folder_id: number } | undefined;
  
  return result?.folder_id || null;
}

export function setSessionFolder(sessionId: number, folderId: number | null): void {
  const db = getDb();
  
  // Remove existing mapping
  db.prepare(`DELETE FROM session_folder_mapping WHERE session_id = ?`).run(sessionId);
  
  // Add new mapping if folderId is not null
  if (folderId !== null) {
    db.prepare(`INSERT INTO session_folder_mapping (session_id, folder_id) VALUES (?, ?)`)
      .run(sessionId, folderId);
  }
}

export function getSessionsInFolder(folderId: number): number[] {
  const db = getDb();
  const results = db
    .prepare(`SELECT session_id FROM session_folder_mapping WHERE folder_id = ?`)
    .all(folderId) as { session_id: number }[];
  
  return results.map(r => r.session_id);
}
