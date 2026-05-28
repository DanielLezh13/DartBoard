/**
 * SessionStorage keys cleared on every auth boundary (SIGNED_IN + SIGNED_OUT)
 * so guest state never bleeds into user and vice versa.
 */
export const AUTH_BOUNDARY_SESSION_KEYS = [
  "db:folders",
  "db:memoryFolders",
  "db:memoryFolderIdMap",
  "db:guestMemories",
  "db:guestPreviewSessions",
  "db:guestPreviewMessagesBySession",
  "db:guestMessageCount",
  "db:guestInfoBannerBySession",
  "db:guestInfoBannerShown",
  "db:guestInfoBannerDismissed",
  "db:sidebarHidden",
  "db:rightDockHidden",
  "db:sidebarOpen",
  "db:rightOverlayOpen",
  "db:keepOverlaysVisible",
  "db:selectedFolderId",
  "db:lastActiveSessionId",
  "db:openLanding",
  "db:rightRailSelectedId",
  "db:rightPanelOpen",
  "db:selectedMemoryFolder",
  "db:memoryOverlayOpen",
  "db:draftMemory",
  "db:selectedMemoryId",
  "dartboard.folderAppearance.v1:guest",
  "dartboard.memoryFolderAppearance.v1:guest",
] as const;

const FOLDER_ID_MAP_KEY = "db:memoryFolderIdMap";

/** Get the local -> DB folder id mapping for guests */
export function getFolderIdMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(FOLDER_ID_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Save a single local -> DB folder id mapping for guests */
export function setFolderIdMapping(localId: number, dbId: number): void {
  if (typeof window === "undefined") return;
  try {
    const map = getFolderIdMap();
    map[String(localId)] = dbId;
    sessionStorage.setItem(FOLDER_ID_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** @deprecated Use AUTH_BOUNDARY_SESSION_KEYS. Kept for compatibility. */
export const GUEST_SESSION_KEYS = [
  "db:folders",
  "db:memoryFolders",
  "db:memoryFolderIdMap",
  "db:guestMemories",
] as const;

export function clearGuestSessionStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of AUTH_BOUNDARY_SESSION_KEYS) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

/** @deprecated Instrumentation removed; kept for compatibility. */
export function logSessionStorageKeysPresent(_label: string): void {
}
