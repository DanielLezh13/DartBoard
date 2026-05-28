-- Add sort_index column to chat_folders for persistent folder order (signed-in users)
-- SQLite (used by lib/db.ts); for Postgres/Supabase use same logic with appropriate syntax

ALTER TABLE chat_folders ADD COLUMN sort_index INTEGER;

-- Backfill existing rows: use id order as initial sort (id = creation order for autoincrement)
UPDATE chat_folders SET sort_index = id WHERE sort_index IS NULL;
