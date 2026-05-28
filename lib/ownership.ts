import type Database from "better-sqlite3";
import type { Scope } from "@/lib/scope-server";

export type ScopeOwner = {
  column: "user_id" | "guest_id";
  value: string;
};

export function getScopeOwner(scope: Scope): ScopeOwner {
  if (scope.kind === "user") {
    return { column: "user_id", value: scope.userId };
  }
  return { column: "guest_id", value: scope.guestId };
}

export function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const int = Math.trunc(n);
  return int > 0 ? int : null;
}

export function getOwnedSession<T = { id: number }>(
  db: Database.Database,
  sessionId: number,
  scope: Scope,
  columns = "id"
): T | undefined {
  const owner = getScopeOwner(scope);
  return db
    .prepare(`SELECT ${columns} FROM sessions WHERE id = ? AND ${owner.column} = ?`)
    .get(sessionId, owner.value) as T | undefined;
}

export function getOwnedChatFolder<T = { id: number }>(
  db: Database.Database,
  folderId: number,
  scope: Scope,
  columns = "id"
): T | undefined {
  const owner = getScopeOwner(scope);
  return db
    .prepare(`SELECT ${columns} FROM chat_folders WHERE id = ? AND ${owner.column} = ?`)
    .get(folderId, owner.value) as T | undefined;
}

export function getOwnedMemoryFolder<T = { id: number }>(
  db: Database.Database,
  folderId: number,
  scope: Scope,
  columns = "id"
): T | undefined {
  const owner = getScopeOwner(scope);
  return db
    .prepare(`SELECT ${columns} FROM memory_folders WHERE id = ? AND ${owner.column} = ?`)
    .get(folderId, owner.value) as T | undefined;
}

export function getOwnedMemory<T = { id: number }>(
  db: Database.Database,
  memoryId: number,
  scope: Scope,
  columns = "id"
): T | undefined {
  const owner = getScopeOwner(scope);
  return db
    .prepare(`SELECT ${columns} FROM memories WHERE id = ? AND ${owner.column} = ?`)
    .get(memoryId, owner.value) as T | undefined;
}
