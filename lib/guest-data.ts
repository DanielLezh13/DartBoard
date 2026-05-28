import type Database from "better-sqlite3";

export type ClaimGuestDataResult = {
  sessions: number;
  messages: number;
  memories: number;
  memoryFolders: number;
  chatFolders: number;
  archiveMessages: number;
};

export type WipeGuestDataResult = {
  sessions: number;
  messages: number;
  memories: number;
  memoryFolders: number;
  chatFolders: number;
  archiveMessages: number;
  sessionAttachments: number;
  sessionFolderMappings: number;
  tokenUsage: number;
};

function getGuestSessionIds(db: Database.Database, guestId: string): number[] {
  const rows = db
    .prepare(`SELECT id FROM sessions WHERE guest_id = ?`)
    .all(guestId) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

function getGuestMemoryIds(db: Database.Database, guestId: string): number[] {
  const rows = db
    .prepare(`SELECT id FROM memories WHERE guest_id = ?`)
    .all(guestId) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

function deleteByIds(
  db: Database.Database,
  sqlPrefix: string,
  ids: number[]
): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(`${sqlPrefix} (${placeholders})`).run(...ids);
  return result.changes;
}

export function claimGuestDataToUser(
  db: Database.Database,
  guestId: string,
  userId: string
): ClaimGuestDataResult {
  const tx = db.transaction((): ClaimGuestDataResult => {
    const sessions = db
      .prepare(
        `UPDATE sessions
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    const messages = db
      .prepare(
        `UPDATE messages
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    const memories = db
      .prepare(
        `UPDATE memories
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    const memoryFolders = db
      .prepare(
        `UPDATE memory_folders
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    const chatFolders = db
      .prepare(
        `UPDATE chat_folders
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    const archiveMessages = db
      .prepare(
        `UPDATE archive_messages
         SET user_id = ?, guest_id = NULL
         WHERE guest_id = ? AND (user_id IS NULL OR user_id = '')`
      )
      .run(userId, guestId).changes;

    return {
      sessions,
      messages,
      memories,
      memoryFolders,
      chatFolders,
      archiveMessages,
    };
  });

  return tx();
}

export function wipeGuestDataByGuestId(
  db: Database.Database,
  guestId: string
): WipeGuestDataResult {
  const tx = db.transaction((): WipeGuestDataResult => {
    const sessionIds = getGuestSessionIds(db, guestId);
    const memoryIds = getGuestMemoryIds(db, guestId);

    const sessionAttachmentsBySession = deleteByIds(
      db,
      "DELETE FROM session_memory_attachments WHERE session_id IN",
      sessionIds
    );
    const sessionAttachmentsByMemory = deleteByIds(
      db,
      "DELETE FROM session_memory_attachments WHERE memory_id IN",
      memoryIds
    );
    const sessionFolderMappings = deleteByIds(
      db,
      "DELETE FROM session_folder_mapping WHERE session_id IN",
      sessionIds
    );
    const tokenUsage = deleteByIds(
      db,
      "DELETE FROM token_usage WHERE session_id IN",
      sessionIds
    );

    const archiveMessages = db
      .prepare(`DELETE FROM archive_messages WHERE guest_id = ?`)
      .run(guestId).changes;

    const memories = db
      .prepare(`DELETE FROM memories WHERE guest_id = ?`)
      .run(guestId).changes;

    const messages = db
      .prepare(`DELETE FROM messages WHERE guest_id = ?`)
      .run(guestId).changes;

    const memoryFolders = db
      .prepare(`DELETE FROM memory_folders WHERE guest_id = ?`)
      .run(guestId).changes;

    const chatFolders = db
      .prepare(`DELETE FROM chat_folders WHERE guest_id = ?`)
      .run(guestId).changes;

    const sessions = db
      .prepare(`DELETE FROM sessions WHERE guest_id = ?`)
      .run(guestId).changes;

    return {
      sessions,
      messages,
      memories,
      memoryFolders,
      chatFolders,
      archiveMessages,
      sessionAttachments: sessionAttachmentsBySession + sessionAttachmentsByMemory,
      sessionFolderMappings,
      tokenUsage,
    };
  });

  return tx();
}
