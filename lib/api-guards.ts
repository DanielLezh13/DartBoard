import { NextRequest, NextResponse } from "next/server";
import { getServerScope, type Scope } from "@/lib/scope-server";
import {
  getOwnedChatFolder,
  getOwnedMemory,
  getOwnedMemoryFolder,
  getOwnedSession,
  getScopeOwner,
  parsePositiveInt,
} from "@/lib/ownership";
import type Database from "better-sqlite3";

type GuardOk<T> = { ok: true; value: T };
type GuardErr = { ok: false; response: NextResponse };
export type GuardResult<T> = GuardOk<T> | GuardErr;

export async function requireScope(request: NextRequest): Promise<GuardResult<Scope>> {
  try {
    const scope = await getServerScope(request);
    return { ok: true, value: scope };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }
}

export function parsePositiveIntField(
  value: unknown,
  field: string
): GuardResult<number> {
  const parsed = parsePositiveInt(value);
  if (parsed === null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${field} must be a positive integer` },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: parsed };
}

export function requireOwnedSession(
  db: Database.Database,
  scope: Scope,
  sessionId: number,
  columns = "id"
): GuardResult<any> {
  const row = getOwnedSession(db, sessionId, scope, columns);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session not found" }, { status: 404 }),
    };
  }
  return { ok: true, value: row };
}

export function requireOwnedMemory(
  db: Database.Database,
  scope: Scope,
  memoryId: number,
  columns = "id"
): GuardResult<any> {
  const row = getOwnedMemory(db, memoryId, scope, columns);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Memory not found" }, { status: 404 }),
    };
  }
  return { ok: true, value: row };
}

export function requireOwnedChatFolder(
  db: Database.Database,
  scope: Scope,
  folderId: number,
  columns = "id"
): GuardResult<any> {
  const row = getOwnedChatFolder(db, folderId, scope, columns);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Folder not found" }, { status: 404 }),
    };
  }
  return { ok: true, value: row };
}

export function requireOwnedMemoryFolder(
  db: Database.Database,
  scope: Scope,
  folderId: number,
  columns = "id"
): GuardResult<any> {
  const row = getOwnedMemoryFolder(db, folderId, scope, columns);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Folder not found" }, { status: 404 }),
    };
  }
  return { ok: true, value: row };
}

export function scopeSql(scope: Scope): { ownerColumn: "user_id" | "guest_id"; ownerValue: string } {
  const owner = getScopeOwner(scope);
  return { ownerColumn: owner.column, ownerValue: owner.value };
}
