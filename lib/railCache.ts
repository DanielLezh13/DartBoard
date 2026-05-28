/**
 * Signed-in rail cache: sessionStorage cache for instant folder bubble paint on refresh.
 * API remains source of truth; cache is for instant paint only.
 * scope.kind === "user" only. Guest unchanged.
 */

export const LAST_USER_ID_KEY = "db:lastUserId";

export function getLastUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastUserId(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(LAST_USER_ID_KEY, userId);
  } catch {
    // ignore
  }
}

export function clearLastUserId(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(LAST_USER_ID_KEY);
  } catch {
    // ignore
  }
}

export type CachedFolder = {
  id: number;
  name: string;
  icon?: string;
  position?: number | null;
  memory_count?: number | null;
};

export type CachedChatSession = {
  id: number;
  title: string;
  created_at: string;
  updatedAt: string;
  inFolderId?: number | null;
  folderOrderTs?: number | null;
  focusGoal?: string | null;
  focusEnabled?: boolean;
  mru_ts: number;
};

export function getUserChatFoldersCacheKey(userId: string): string {
  return "db:userChatFolders:" + userId;
}

export function getUserMemoryFoldersCacheKey(userId: string): string {
  return "db:userMemoryFolders:" + userId;
}

export function getUserChatSessionsCacheKey(userId: string): string {
  return "db:userChatSessions:" + userId;
}

/** Minimal memory for list rows: id, title, summary, folder_name, created_at, position */
export type CachedMemory = {
  id: number;
  title: string | null;
  summary: string;
  folder_name: string | null;
  created_at: string;
  position?: number | null;
};

export function getUserMemoriesCacheKey(userId: string, folderKey: string): string {
  return `db:userMemories:${userId}:${folderKey}`;
}

export function readMemoriesCache(key: string): CachedMemory[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMemoriesCache(key: string, memories: CachedMemory[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(memories));
  } catch {
    // ignore
  }
}

export function readCache(key: string): CachedFolder[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, folders: CachedFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(folders));
  } catch {
    // ignore quota / private mode
  }
}

export function readChatSessionsCache(key: string): CachedChatSession[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeChatSessionsCache(key: string, sessions: CachedChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(sessions));
  } catch {
    // ignore quota / private mode
  }
}

export function clearCache(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
