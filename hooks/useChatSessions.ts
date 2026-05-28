"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { getAuthHeaders } from "@/lib/api";
import type { Scope } from "@/lib/scope-client";
import { clearGuestSessionStorage } from "@/lib/guest-keys";
import {
  type CachedChatSession,
  getLastUserId,
  getUserChatFoldersCacheKey,
  getUserChatSessionsCacheKey,
  readChatSessionsCache,
  readCache,
  writeChatSessionsCache,
  writeCache,
} from "@/lib/railCache";

export type SidebarFolder = {
  id: number;
  name: string;
  icon?: string;
};

export type SidebarSession = {
  id: number;
  title: string;
  updatedAt: string;
  inFolderId?: number | null;
  folderOrderTs?: number | null;
  focusGoal?: string | null;
  focusEnabled?: boolean;
  mru_ts: number; // MRU timestamp in ms epoch - single source of truth for ordering
};

export type Session = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at?: string | null;
  mode?: string | null;
  inFolderId?: number | null;
  folderOrderTs?: number | null;
  focusGoal?: string | null;
  focusEnabled?: boolean;
  mru_ts: number; // MRU timestamp in ms epoch - single source of truth for ordering
};

export function useChatSessions(opts: {
  // External dependencies (for handlers that need to interact with other state)
  onSelectSession?: (id: number | null) => void;
  onSessionCreated?: (id: number) => void;
  onSessionDeleted?: (id: number) => void;
  onSessionRenamed?: (id: number, newTitle: string) => void;
  /** Current auth scope; when it changes (guest↔user), folder/session caches are reset. */
  scope?: Scope | null;
}) {
  const { onSelectSession, onSessionCreated, onSessionDeleted, onSessionRenamed, scope } = opts;

  // Ref to track if actively sending (to gate loadSessions updates)
  const isSendingRef = useRef<boolean>(false);

  // Session state
  const [sessions, setSessions] = useState<Session[]>([]);
  // IMPORTANT: SSR-safe initializer. Do NOT read localStorage here (prevents hydration mismatch).
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarSessions, setSidebarSessions] = useState<SidebarSession[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);
  const [bootResolved, setBootResolved] = useState(false);
  
  // Folder state
  const [folders, setFolders] = useState<SidebarFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [startRenameFolderId, setStartRenameFolderId] = useState<number | null>(null);
  const [rightRailSelectedId, setRightRailSelectedId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  
  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragOverlaySessionId, setDragOverlaySessionId] = useState<number | null>(null);
  
  // Session metadata
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionUsedTokens, setSessionUsedTokens] = useState<Record<number, number>>({});
  const [sessionTokenLimit, setSessionTokenLimit] = useState<number>(3_000_000);

  // Refs for stable callbacks
  const activeSessionIdRef = useRef<number | null>(null);
  const sidebarSessionsRef = useRef<SidebarSession[]>([]);
  const foldersRef = useRef<SidebarFolder[]>([]);
  const selectedFolderIdRef = useRef<number | null>(null);
  const sessionUsedTokensRef = useRef<Record<number, number>>({});
  const updatedAtOverridesRef = useRef<Record<number, string>>({});
  const prevActiveSessionIdRef = useRef<number | null>(null);
  const prevScopeKindRef = useRef<string | undefined>(undefined);
  const scopeRef = useRef<Scope | null | undefined>(scope);
  const loadSessionsInFlightRef = useRef(false);
  const lastLoadSessionsAtRef = useRef(0);
  const hasHydratedRef = useRef(false);
  const pendingDeletedChatFolderIdsRef = useRef<Set<number>>(new Set());
  const hasLoadedFoldersOnceRef = useRef(false);
  const [hasLoadedFoldersOnce, setHasLoadedFoldersOnce] = useState(false);
  const hasHydratedFromCacheRef = useRef(false);
  const [hydratedFromCacheChatFolders, setHydratedFromCacheChatFolders] = useState(false);
  const hasHydratedSessionsFromCacheRef = useRef(false);

  // Sync refs
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  useEffect(() => {
    hasHydratedRef.current = hasHydrated;
  }, [hasHydrated]);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    sidebarSessionsRef.current = sidebarSessions;
  }, [sidebarSessions]);
  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);
  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);
  useEffect(() => {
    sessionUsedTokensRef.current = sessionUsedTokens;
  }, [sessionUsedTokens]);

  // Track session changes for context bar scan
  useEffect(() => {
    if (activeSessionId !== prevActiveSessionIdRef.current) {
      setSessionKey(activeSessionId); // Trigger scan on session change
      prevActiveSessionIdRef.current = activeSessionId;
    }
  }, [activeSessionId]);

  // Fetch session usage on mount/refresh when activeSessionId is available
  useEffect(() => {
    if (scopeRef.current?.kind === "guest") return;
    // Only fetch if we have an active session and haven't cached its tokens yet
    if (activeSessionId != null && sessionUsedTokensRef.current[activeSessionId] === undefined) {
      const fetchSessionUsage = async () => {
        try {
          const res = await fetch(`/api/session-usage?session_id=${activeSessionId}`);
          const json = await res.json();
          const used = typeof json?.used_tokens === "number" ? json.used_tokens : 0;
          const limit =
            typeof json?.session_token_limit === "number" &&
            Number.isFinite(json.session_token_limit) &&
            json.session_token_limit > 0
              ? Math.trunc(json.session_token_limit)
              : null;
          setSessionUsedTokens((prev) => ({ ...prev, [activeSessionId]: used }));
          if (limit != null) {
            setSessionTokenLimit(limit);
          }
        } catch {
          setSessionUsedTokens((prev) => ({ ...prev, [activeSessionId]: 0 }));
        }
      };
      
      fetchSessionUsage();
    }
  }, [activeSessionId]);

  // ─── MRU (Most Recently Used) tracking ───
  // Per-tab restore/persist (sessionStorage only)
  const SS_LAST_ACTIVE_SESSION_ID = "db:lastActiveSessionId";
  const SS_OPEN_LANDING = "db:openLanding";
  const SS_SELECTED_FOLDER_ID = "db:selectedFolderId";
  const SS_RIGHT_RAIL_SELECTED_ID = "db:rightRailSelectedId";
  const SS_RIGHT_PANEL_OPEN = "db:rightPanelOpen";
  const SS_TAB_INIT = "db:tabInit";
  const SS_FRESH_SIGNED_IN_ENTRY = "db:freshSignedInEntry";

  // Check if tab init marker exists (same-tab reload) BEFORE setting it.
  // This must run synchronously on mount, before restore logic.
  const isSameTabRef = useRef<boolean | null>(null);
  if (typeof window !== "undefined" && isSameTabRef.current === null) {
    try {
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const isReload =
        navEntry?.type === "reload" || (window as any).performance?.navigation?.type === 1;
      const hadTabMarker = sessionStorage.getItem(SS_TAB_INIT) === "1";
      isSameTabRef.current = isReload && hadTabMarker;
      // Set marker immediately (for next reload).
      sessionStorage.setItem(SS_TAB_INIT, "1");
    } catch {
      isSameTabRef.current = false;
    }
  }

  // Restore selected folder before first paint on same-tab reload.
  // Without this, left panel can briefly render "Unsorted" before switching.
  const didPrerestoreSelectedFolderRef = useRef(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (didPrerestoreSelectedFolderRef.current) return;
    didPrerestoreSelectedFolderRef.current = true;
    try {
      if (sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1") return;
    } catch {
      // ignore
    }
    if (isSameTabRef.current !== true) return;
    try {
      const storedFolderId = sessionStorage.getItem(SS_SELECTED_FOLDER_ID);
      if (storedFolderId === "null") {
        setSelectedFolderId(null);
      } else if (storedFolderId !== null) {
        const folderId = Number(storedFolderId);
        if (Number.isFinite(folderId)) setSelectedFolderId(folderId);
      }
    } catch {
      // ignore
    }
  }, []);

  const getLastOpenedMap = (): Record<number, number> => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem("chat:lastOpenedMap");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  };

  const updateLastOpened = useCallback((sessionId: number) => {
    if (typeof window === "undefined") return;
    try {
      const map = getLastOpenedMap();
      map[sessionId] = Date.now();
      localStorage.setItem("chat:lastOpenedMap", JSON.stringify(map));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const sortSessionsByMRU = useCallback(<T extends Session | SidebarSession>(sessionsList: T[]): T[] => {
    // Sort by mru_ts descending (newest first) - single source of truth
    return [...sessionsList].sort((a, b) => b.mru_ts - a.mru_ts);
  }, []);

  const touchSession = useCallback(async (sessionId: number) => {
    const now = Date.now();
    const nowIso = new Date().toISOString();
    
    // Optimistic update immediately for responsive UI
    setSessions((prev) => {
      const updated = prev.map((s) => 
        s.id === sessionId ? { ...s, mru_ts: now, updatedAt: nowIso } : s
      );
      return updated.sort((a, b) => b.mru_ts - a.mru_ts);
    });
    
    setSidebarSessions((prev) => {
      const updated = prev.map((s) => 
        s.id === sessionId ? { ...s, mru_ts: now, updatedAt: nowIso } : s
      );
      return updated.sort((a, b) => b.mru_ts - a.mru_ts);
    });
    
    // Update server
    try {
      const res = await fetch("/api/sessions/touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      
      if (res.ok) {
        const data = await res.json();
        // Sync with server values
        const serverMru = data.mru_ts;
        const serverUpdatedAt = data.updated_at;
        
        setSessions((prev) => {
          const updated = prev.map((s) => 
            s.id === sessionId ? { ...s, mru_ts: serverMru, updatedAt: serverUpdatedAt } : s
          );
          return updated.sort((a, b) => b.mru_ts - a.mru_ts);
        });
        
        setSidebarSessions((prev) => {
          const updated = prev.map((s) => 
            s.id === sessionId ? { ...s, mru_ts: serverMru, updatedAt: serverUpdatedAt } : s
          );
          return updated.sort((a, b) => b.mru_ts - a.mru_ts);
        });
      } else {
        console.error("Failed to touch session on server");
      }
    } catch (error) {
      console.error("Error touching session:", error);
    }
  }, []);

  const sortFoldersByChildMRU = useCallback((foldersList: SidebarFolder[], sessionsList: SidebarSession[]): SidebarFolder[] => {
    const lastOpenedMap = getLastOpenedMap();
    return [...foldersList].sort((a, b) => {
      const aChildren = sessionsList.filter(s => s.inFolderId === a.id);
      const bChildren = sessionsList.filter(s => s.inFolderId === b.id);
      
      const aMaxMRU = aChildren.length > 0 
        ? Math.max(...aChildren.map(s => lastOpenedMap[s.id] || 0))
        : 0;
      const bMaxMRU = bChildren.length > 0 
        ? Math.max(...bChildren.map(s => lastOpenedMap[s.id] || 0))
        : 0;
      
      // Folders with children and MRU come first, empty folders last
      return bMaxMRU - aMaxMRU;
    });
  }, []);

  const hydrateSessionsFromCache = useCallback((cached: CachedChatSession[]) => {
    const createdAtById = new Map<number, string>();
    cached.forEach((s) => {
      const id = Number(s.id);
      if (Number.isFinite(id)) {
        createdAtById.set(
          id,
          typeof s.created_at === "string" && s.created_at
            ? s.created_at
            : typeof s.updatedAt === "string" && s.updatedAt
              ? s.updatedAt
              : new Date().toISOString()
        );
      }
    });

    const normalizedSidebar: SidebarSession[] = cached
      .map((s) => {
        const mru = Number.isFinite(Number(s.mru_ts)) ? Number(s.mru_ts) : 0;
        return {
          id: Number(s.id),
          title: typeof s.title === "string" && s.title.trim().length > 0 ? s.title : "Untitled chat",
          updatedAt:
            typeof s.updatedAt === "string" && s.updatedAt
              ? s.updatedAt
              : new Date().toISOString(),
          inFolderId:
            typeof s.inFolderId === "number"
              ? s.inFolderId
              : s.inFolderId === null
                ? null
                : null,
          folderOrderTs:
            typeof s.folderOrderTs === "number" && Number.isFinite(s.folderOrderTs)
              ? s.folderOrderTs
              : null,
          focusGoal: typeof s.focusGoal === "string" ? s.focusGoal : null,
          focusEnabled: Boolean(s.focusEnabled),
          mru_ts: mru,
        };
      })
      .filter((s) => Number.isFinite(s.id));

    const normalizedSessions: Session[] = normalizedSidebar.map((s) => ({
      id: s.id,
      title: s.title,
      created_at: createdAtById.get(s.id) || s.updatedAt || new Date().toISOString(),
      updated_at: s.updatedAt,
      mode: null,
      inFolderId: s.inFolderId ?? null,
      folderOrderTs: s.folderOrderTs ?? null,
      focusGoal: s.focusGoal ?? null,
      focusEnabled: Boolean(s.focusEnabled) && Boolean(s.focusGoal),
      mru_ts: s.mru_ts,
    }));

    setSidebarSessions(sortSessionsByMRU(normalizedSidebar));
    setSessions(sortSessionsByMRU(normalizedSessions));
  }, [sortSessionsByMRU]);

  // ─── Folder persistence (DB-backed) ───
  // Note: localStorage folder persistence removed - now using DB
  // Scope rule: when scope.kind === "user", never read guest sessionStorage (db:folders).

  const getGuestFoldersFromStorage = useCallback((): SidebarFolder[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem("db:folders");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((f: any) => ({ id: f.id, name: f.name, icon: f.icon || undefined }))
        : [];
    } catch {
      return [];
    }
  }, []);

  // Guest hydration: hydrate folders from sessionStorage immediately when scope is guest.
  // Runs independent of loadSessions/loadFoldersFromDB (no gates/cooldown).
  useEffect(() => {
    if (scope?.kind !== "guest") return;
    const stored = getGuestFoldersFromStorage();
    setFolders(stored);
  }, [scope?.kind, getGuestFoldersFromStorage]);

  // Early hydration from cache (before scope resolves) — runs before first paint
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasHydratedFromCacheRef.current) return;
    if (folders.length > 0) return;
    const last = getLastUserId();
    if (!last) return;
    const cached = readCache(getUserChatFoldersCacheKey(last));
    if (!cached?.length) return;
    hasHydratedFromCacheRef.current = true;
    setFolders(cached.map((f) => ({ id: f.id, name: f.name, icon: f.icon })));
    setHydratedFromCacheChatFolders(true);
  }, []);

  // Early hydration for chat sessions list (before scope resolves) — runs before first paint.
  // Keeps left navigator populated immediately on refresh/navigation while API catches up.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasHydratedSessionsFromCacheRef.current) return;
    if (sidebarSessions.length > 0) return;
    const last = getLastUserId();
    if (!last) return;
    const cacheKey = getUserChatSessionsCacheKey(last);
    const cached = readChatSessionsCache(cacheKey);
    if (!cached?.length) return;
    hasHydratedSessionsFromCacheRef.current = true;
    hydrateSessionsFromCache(cached);
  }, [sidebarSessions.length, hydrateSessionsFromCache]);

  // Signed-in only: hydrate from cache when scope resolves (fallback if early hydration didn't run)
  // If scope.userId !== lastUserId, clear (security: different user)
  useEffect(() => {
    if (scope?.kind !== "user" || !("userId" in scope)) return;
    const last = getLastUserId();
    if (last !== null && scope.userId !== last) {
      setFolders([]);
      setSessions([]);
      setSidebarSessions([]);
      hasHydratedFromCacheRef.current = false;
      hasHydratedSessionsFromCacheRef.current = false;
      setHydratedFromCacheChatFolders(false);
      return;
    }

    if (
      !hasHydratedFromCacheRef.current &&
      !hasLoadedFoldersOnceRef.current &&
      folders.length === 0
    ) {
      const key = getUserChatFoldersCacheKey(scope.userId);
      const cached = readCache(key);
      if (cached && cached.length > 0) {
        hasHydratedFromCacheRef.current = true;
        setHydratedFromCacheChatFolders(true);
        const sidebar: SidebarFolder[] = cached.map((f) => ({
          id: f.id,
          name: f.name,
          icon: f.icon,
        }));
        setFolders(sidebar);
      }
    }

    if (!hasHydratedSessionsFromCacheRef.current && sidebarSessions.length === 0) {
      const key = getUserChatSessionsCacheKey(scope.userId);
      const cachedSessions = readChatSessionsCache(key);
      if (cachedSessions && cachedSessions.length > 0) {
        hasHydratedSessionsFromCacheRef.current = true;
        hydrateSessionsFromCache(cachedSessions);
      }
    }
  }, [
    scope?.kind,
    scope && "userId" in scope ? scope.userId : null,
    folders.length,
    sidebarSessions.length,
    hydrateSessionsFromCache,
  ]);

  // Load folders: guest = sessionStorage only at top (no API); user = /api/folders only.
  // Guest must never be overwritten by API or setFolders([]). Use scopeRef.current for current scope.
  const loadFoldersFromDB = useCallback(async () => {
    // Guest first: single source of truth is sessionStorage; no API, no clearing. Return before any user/API code.
    if (scopeRef.current?.kind === "guest") {
      if (typeof window === "undefined") return;
      try {
        const stored = sessionStorage.getItem("db:folders");
        const parsed = stored ? JSON.parse(stored) : null;
        const list = Array.isArray(parsed) ? parsed : [];
        const sidebarFolders: SidebarFolder[] = list.map((f: any) => ({ id: f.id, name: f.name, icon: f.icon || undefined }));
        setFolders(sidebarFolders);
        if (!hasLoadedFoldersOnceRef.current) {
          hasLoadedFoldersOnceRef.current = true;
          setHasLoadedFoldersOnce(true);
        }
      } catch {
        // Do not setFolders([]); leave folders as-is for guest.
      }
      return;
    }

    const currentScope = scopeRef.current;
    if (!currentScope) return;

    // User only: call /api/folders.
    try {
      const response = await fetch("/api/folders", { headers: getAuthHeaders() });
      const raw = await response.json().catch(() => null);
      const foldersArray = Array.isArray(raw) ? raw : null;

      if (!response.ok) return;
      if (foldersArray === null) return;

      const sidebarFolders: SidebarFolder[] = foldersArray
        .map((f: any) => ({
          id: f.id,
          name: f.name,
          icon: f.icon || undefined,
        }))
        .filter((f) => !pendingDeletedChatFolderIdsRef.current.has(f.id));

      const cacheKey = getUserChatFoldersCacheKey(currentScope.userId);
      writeCache(cacheKey, sidebarFolders.map((f) => ({ id: f.id, name: f.name, icon: f.icon })));
      setFolders(sidebarFolders);
      if (!hasLoadedFoldersOnceRef.current) {
        hasLoadedFoldersOnceRef.current = true;
        setHasLoadedFoldersOnce(true);
      }
      if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem("db:folders");
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error("Error loading folders from DB:", err);
    }
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId]);

  // Apply persisted folder assignments to sessions
  const applyFolderAssignments = (
    sessionsData: SidebarSession[],
    folderMap: Record<number, number | null>,
    validFolderIds: Set<number>
  ): SidebarSession[] => {
    return sessionsData.map((s) => {
      const folderId = folderMap[s.id];
      // Only apply if folder still exists
      if (folderId !== undefined && (folderId === null || validFolderIds.has(folderId))) {
        return { ...s, inFolderId: folderId };
      }
      return s;
    });
  };

  const setUpdatedAtOverride = useCallback((id: number, iso: string) => {
    updatedAtOverridesRef.current[id] = iso;
  }, []);

  // Tracing wrapper for setActiveSessionId
  const setActiveSessionIdTraced = useCallback((next: number | null, why: string) => {
    const prev = activeSessionIdRef.current;
    // Critical: prevents deselect/reselect blink when setting same value
    if (prev === next) return;
    setActiveSessionId(next);
    activeSessionIdRef.current = next;
    
    // Save to sessionStorage for persistence across navigation
    if (typeof window !== "undefined") {
      try {
        if (next === null) {
          sessionStorage.removeItem(SS_LAST_ACTIVE_SESSION_ID);
        } else {
          sessionStorage.setItem(SS_LAST_ACTIVE_SESSION_ID, String(next));
        }
      } catch {
        // Ignore sessionStorage errors
      }
    }
  }, []);

  // Repair active session ONLY if it truly disappears from the current sidebarSessions state.
  useEffect(() => {
    const active = activeSessionIdRef.current;
    if (active == null) return;

    const exists = sidebarSessions.some((s) => s.id === active);
    if (exists) return;

    const nextId = sidebarSessions[0]?.id ?? null;
    if (nextId == null || nextId === active) return;

    setActiveSessionIdTraced(nextId, "nav-repair-missing-active");
  }, [sidebarSessions, setActiveSessionIdTraced]);

  // Normalize DB created_at into a stable ISO string
  const normalizeCreatedAt = (raw: any): string | null => {
    if (!raw) return null;
    if (typeof raw !== "string") return null;
    // If it's already ISO-like (has a "T"), trust it
    if (raw.includes("T")) {
      return raw;
    }
    // Common SQLite/SQL style: "YYYY-MM-DD HH:MM:SS"
    // Treat it as UTC by appending "Z" so Date parses consistently
    const trimmed = raw.trim();
    return trimmed.replace(" ", "T") + "Z";
  };

  const loadSessions = useCallback(async () => {
    // Skip loading if actively sending to prevent sidebar flicker
    if (isSendingRef.current) {
      return;
    }

    // Guard: prevent infinite fetch loop from effect/dep cycles
    if (loadSessionsInFlightRef.current) {
      console.warn("[LOAD_GUARD] skip loadSessions", {
        reason: "inFlight",
        scopeKind: scopeRef.current?.kind,
        activeSessionId: activeSessionIdRef.current,
      });
      return;
    }
    const now = Date.now();
    if (now - lastLoadSessionsAtRef.current < 1000) {
      console.warn("[LOAD_GUARD] skip loadSessions", {
        reason: "cooldown",
        scopeKind: scopeRef.current?.kind,
        activeSessionId: activeSessionIdRef.current,
      });
      return;
    }
    loadSessionsInFlightRef.current = true;
    lastLoadSessionsAtRef.current = now;

    try {
      const response = await fetch("/api/sessions", {
        headers: getAuthHeaders()
      });
      const json = await response.json();
      
      // Safely extract the array
      const list = Array.isArray(json)
        ? json
        : Array.isArray(json.sessions)
        ? json.sessions
        : [];
      
      // Build local mru_ts map from current state
      const localMruMap = new Map<number, number>();
      sessions.forEach(s => localMruMap.set(s.id, s.mru_ts || 0));
      sidebarSessions.forEach(s => localMruMap.set(s.id, s.mru_ts || 0));
      
      // Convert server sessions to include mru_ts (merge with local, never lower)
      const sessionsWithMru = list.map((s: any) => {
        const serverMru =
          typeof s.mru_ts === "number" && s.mru_ts > 0
            ? s.mru_ts
            : s.updated_at
              ? new Date(s.updated_at).getTime()
              : s.created_at
                ? new Date(s.created_at).getTime()
                : 0;

        const localMru = localMruMap.get(s.id) || 0;
        // Ensure both are Numbers and take the max
        const mru_ts = Math.max(Number(localMru), Number(serverMru));
        
        return {
          ...s,
          mru_ts,
        };
      });
      
      // Sort by mru_ts descending
      const sortedSessions = sessionsWithMru.sort((a: any, b: any) => b.mru_ts - a.mru_ts);

      setSessions(sortedSessions);
      
      // Folders are now loaded from DB via /api/sessions response (inFolderId)
      // No localStorage folder persistence needed
      setSidebarSessions((prev) => {
        // Helper to pick newest timestamp (newest-wins logic)
        const toMs = (v?: string | null) => {
          if (!v) return 0;
          const t = new Date(v).getTime();
          return Number.isNaN(t) ? 0 : t;
        };

        const newest = (a?: string | null, b?: string | null, c?: string | null) => {
          const candidates = [a, b, c].filter(Boolean) as string[];
          let best = "";
          let bestMs = 0;
          for (const s of candidates) {
            const ms = toMs(s);
            if (ms >= bestMs) {
              bestMs = ms;
              best = s;
            }
          }
          return best;
        };
        
        // Convert server sessions to include mru_ts (merge with local, never lower)
        const sessionsWithMru: SidebarSession[] = list.map((s: any) => {
          const serverMru =
            typeof s.mru_ts === "number" && s.mru_ts > 0
              ? s.mru_ts
              : s.updated_at
                ? new Date(s.updated_at).getTime()
                : s.created_at
                  ? new Date(s.created_at).getTime()
                  : 0;
          const localMru = localMruMap.get(s.id) || 0;
          const finalMru = Math.max(serverMru, localMru);
          
          const finalUpdatedAt = newest(s.updated_at, s.created_at);
          
          return {
            id: s.id,
            title: s.title || "Untitled chat",
            updatedAt: finalUpdatedAt,
            inFolderId: s.inFolderId || null, // Use inFolderId from DB
            focusGoal:
              typeof s.focusGoal === "string"
                ? s.focusGoal
                : typeof s.focus_goal === "string"
                  ? s.focus_goal
                  : null,
            focusEnabled:
              Boolean(s.focusEnabled ?? s.focus_enabled) &&
              (
                (typeof s.focusGoal === "string" && s.focusGoal.trim().length > 0) ||
                (typeof s.focus_goal === "string" && s.focus_goal.trim().length > 0)
              ),
            folderOrderTs:
              typeof s.folderOrderTs === "number"
                ? s.folderOrderTs
                : typeof s.folder_order_ts === "number"
                  ? s.folder_order_ts
                  : null,
            mru_ts: finalMru, // Always include mru_ts, default to 0
          };
        });

        // Sort by MRU
        const sortedSessions = sortSessionsByMRU(sessionsWithMru);
        
        return sortedSessions;
      });
    } catch (error) {
      console.error("Error loading sessions:", error);
      setSessions([]); // Ensure sessions is always an array even on error
    } finally {
      setHasLoadedSessions(true);
      // Load folders: for user only when auth is ready (hasHydrated); for guest run after sessions load.
      const scopeKind = scopeRef.current?.kind;
      if (scopeKind === "guest" || hasHydratedRef.current) {
        loadFoldersFromDB();
      }
      loadSessionsInFlightRef.current = false;
    }
  }, [sortSessionsByMRU, loadFoldersFromDB]);

  // Only load sessions (and folders) when scope is resolved; re-run when scope kind or id changes.
  // When transitioning TO user only: clear guest caches and folders. Never setFolders([]) when scope is guest.
  useEffect(() => {
    if (!scope) return;
    void (async () => {
      if (prevScopeKindRef.current !== undefined && prevScopeKindRef.current !== scope.kind) {
        if (scope.kind === "guest") {
          hasHydratedFromCacheRef.current = false;
        } else if (scope.kind === "user") {
          clearGuestSessionStorage();
          setFolders([]);
          setSelectedFolderId(null);
        }
      }

      prevScopeKindRef.current = scope.kind;
      loadSessions();
    })();
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, loadSessions, setActiveSessionIdTraced]);

  // For signed-in user: load folders only after auth/session is ready so GET /api/folders runs with valid auth.
  useEffect(() => {
    if (scope?.kind !== "user" || !hasHydrated || !hasLoadedSessions) return;
    loadFoldersFromDB();
  }, [scope?.kind, hasHydrated, hasLoadedSessions, loadFoldersFromDB]);

  // Signed-in only: keep cache in sync on create/delete/reorder (any folders state change).
  useEffect(() => {
    if (scope?.kind !== "user" || !("userId" in scope)) return;
    if (folders.length === 0) return;
    const key = getUserChatFoldersCacheKey(scope.userId);
    writeCache(
      key,
      folders.map((f) => ({ id: f.id, name: f.name, icon: f.icon }))
    );
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : null, folders]);

  // Signed-in only: keep chat sessions cache in sync for instant left-panel paint.
  useEffect(() => {
    if (scope?.kind !== "user" || !("userId" in scope)) return;
    const key = getUserChatSessionsCacheKey(scope.userId);
    const createdAtById = new Map<number, string>();
    sessions.forEach((s) => {
      if (!Number.isFinite(Number(s.id))) return;
      const createdAt =
        typeof s.created_at === "string" && s.created_at
          ? s.created_at
          : typeof s.updated_at === "string" && s.updated_at
            ? s.updated_at
            : new Date().toISOString();
      createdAtById.set(s.id, createdAt);
    });
    const payload: CachedChatSession[] = sidebarSessions.map((s) => ({
      id: s.id,
      title: typeof s.title === "string" && s.title.trim().length > 0 ? s.title : "Untitled chat",
      created_at: createdAtById.get(s.id) || s.updatedAt || new Date().toISOString(),
      updatedAt: s.updatedAt,
      inFolderId: s.inFolderId ?? null,
      folderOrderTs: s.folderOrderTs ?? null,
      focusGoal: s.focusGoal ?? null,
      focusEnabled: Boolean(s.focusEnabled),
      mru_ts: Number.isFinite(Number(s.mru_ts)) ? Number(s.mru_ts) : 0,
    }));
    writeChatSessionsCache(key, payload);
  }, [
    scope?.kind,
    scope && "userId" in scope ? scope.userId : null,
    sessions,
    sidebarSessions,
  ]);

  // Initial restore AFTER mount (SSR-safe).
  // - Guest: full restore behavior (session/folder/right-panel keys).
  // - Signed-in: restore ONLY selectedFolderId on same-tab reload (parity with right memory folder UX).
  useEffect(() => {
    if (bootResolved) return;
    if (!hasLoadedSessions) return; // Wait for sessions to load before restoring.
    if (typeof window === "undefined") return;

    if (scope == null) {
      return;
    }

    // Signed-in: keep current active-session behavior, but restore folder selection on same-tab refresh.
    if (scope.kind !== "guest") {
      try {
        if (sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1") {
          setSelectedFolderId(null);
          setBootResolved(true);
          setHasHydrated(true);
          return;
        }

        const isSameTab = isSameTabRef.current === true;
        if (isSameTab) {
          const storedFolderId = sessionStorage.getItem(SS_SELECTED_FOLDER_ID);
          if (storedFolderId === "null") {
            setSelectedFolderId(null);
          } else if (storedFolderId !== null) {
            const folderId = Number(storedFolderId);
            if (Number.isFinite(folderId)) setSelectedFolderId(folderId);
          }
        }
      } catch {
        // ignore
      }
      setBootResolved(true);
      setHasHydrated(true);
      return;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const urlSession = params.get("session_id");

      // Deep link (?session_id=) only: restore session; folder/panel only from storage when guest.
      if (urlSession) {
        const id = Number(urlSession);
        if (Number.isFinite(id) && sessions.some((s) => s.id === id)) {
          setActiveSessionIdTraced(id, "restore:url");
          if (scope?.kind === "guest") {
            const storedFolderId = sessionStorage.getItem(SS_SELECTED_FOLDER_ID);
            if (storedFolderId !== null) {
              if (storedFolderId === "null") {
                setSelectedFolderId(null);
              } else {
                const fid = Number(storedFolderId);
                if (Number.isFinite(fid)) setSelectedFolderId(fid);
              }
            }
          }
        }
        setBootResolved(true);
        setHasHydrated(true);
        return;
      }

      const isSameTab = isSameTabRef.current === true;

      if (!isSameTab) {
        const lastActiveId = sessionStorage.getItem(SS_LAST_ACTIVE_SESSION_ID);
        const storedFolderId = sessionStorage.getItem(SS_SELECTED_FOLDER_ID);

        if (lastActiveId !== null) {
          const id = Number(lastActiveId);
          if (Number.isFinite(id) && sessions.some((s) => s.id === id)) {
            setActiveSessionIdTraced(id, "restore:navigation");
            if (storedFolderId !== null) {
              if (storedFolderId === "null") setSelectedFolderId(null);
              else {
                const folderId = Number(storedFolderId);
                if (Number.isFinite(folderId)) setSelectedFolderId(folderId);
              }
            }
          } else {
            setActiveSessionIdTraced(null, "restore:navigation-missing");
            setSelectedFolderId(null);
          }
        } else {
          setActiveSessionIdTraced(null, "restore:navigation-empty");
          setSelectedFolderId(null);
        }

        setRightRailSelectedId(null);
        setRightPanelOpen(true);
        setBootResolved(true);
        setHasHydrated(true);
        return;
      }

      const lastActiveId = sessionStorage.getItem(SS_LAST_ACTIVE_SESSION_ID);
      const storedFolderId = sessionStorage.getItem(SS_SELECTED_FOLDER_ID);

      if (lastActiveId !== null) {
        const id = Number(lastActiveId);
        if (Number.isFinite(id) && sessions.some((s) => s.id === id)) {
          setActiveSessionIdTraced(id, "restore:same-tab");
          if (storedFolderId !== null) {
            if (storedFolderId === "null") setSelectedFolderId(null);
            else {
              const folderId = Number(storedFolderId);
              if (Number.isFinite(folderId)) setSelectedFolderId(folderId);
              else setSelectedFolderId(null);
            }
          } else setSelectedFolderId(null);
        } else {
          setActiveSessionIdTraced(null, "restore:same-tab-missing");
          setSelectedFolderId(null);
        }
      } else {
        setActiveSessionIdTraced(null, "restore:same-tab-no-session");
        setSelectedFolderId(null);
      }

      const storedRightRail = sessionStorage.getItem(SS_RIGHT_RAIL_SELECTED_ID);
      if (storedRightRail !== null) {
        setRightRailSelectedId(storedRightRail === "null" ? null : storedRightRail);
      }
      const storedRightPanel = sessionStorage.getItem(SS_RIGHT_PANEL_OPEN);
      if (storedRightPanel !== null) {
        setRightPanelOpen(storedRightPanel === "true");
      }
    } catch {
      // ignore
    }

    setBootResolved(true);
    setHasHydrated(true);
  }, [bootResolved, hasLoadedSessions, sessions, setActiveSessionIdTraced, scope?.kind, scope]);

  // Persist activeSessionId to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolved) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      if (activeSessionId == null) {
        sessionStorage.setItem(SS_OPEN_LANDING, "true");
        sessionStorage.removeItem(SS_LAST_ACTIVE_SESSION_ID);
      } else {
        sessionStorage.setItem(SS_OPEN_LANDING, "false");
        sessionStorage.setItem(SS_LAST_ACTIVE_SESSION_ID, String(activeSessionId));
      }
    } catch {
      // ignore
    }
  }, [activeSessionId, bootResolved]);

  // Persist selectedFolderId to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolved) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SS_SELECTED_FOLDER_ID, selectedFolderId == null ? "null" : String(selectedFolderId));
    } catch {
      // ignore
    }
  }, [selectedFolderId, bootResolved]);

  // Guest safety: if selected folder no longer exists after restore, fall back to Unfiled.
  // IMPORTANT: wait for folder hydration to complete; otherwise a transient empty
  // folders array during boot can incorrectly clear a valid selection.
  useEffect(() => {
    if (scope?.kind !== "guest") return;
    if (selectedFolderId == null) return;
    if (!hasLoadedFoldersOnce) return;
    const exists = folders.some((folder) => folder.id === selectedFolderId);
    if (!exists) {
      setSelectedFolderId(null);
    }
  }, [scope?.kind, selectedFolderId, folders, hasLoadedFoldersOnce]);

  // Persist rightRailSelectedId to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolved) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SS_RIGHT_RAIL_SELECTED_ID, rightRailSelectedId == null ? "null" : String(rightRailSelectedId));
    } catch {
      // ignore
    }
  }, [rightRailSelectedId, bootResolved]);

  // Persist rightPanelOpen to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolved) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SS_RIGHT_PANEL_OPEN, rightPanelOpen ? "true" : "false");
    } catch {
      // ignore
    }
  }, [rightPanelOpen, bootResolved]);

  const handleSelectSession = useCallback(async (id: number) => {
    // Call external handler if provided
    if (onSelectSession) {
      onSelectSession(id);
    }

    setActiveSessionIdTraced(id, "handleSelectSession");
    
    // Update localStorage only (for UX), NOT server MRU
    updateLastOpened(id);
    
    // Fetch token usage if not cached
    if (id != null && sessionUsedTokensRef.current[id] === undefined) {
      try {
        const res = await fetch(`/api/session-usage?session_id=${id}`);
        const json = await res.json();
        const used = typeof json?.used_tokens === "number" ? json.used_tokens : 0;
        setSessionUsedTokens((prev) => ({ ...prev, [id]: used }));
      } catch {
        setSessionUsedTokens((prev) => ({ ...prev, [id]: 0 }));
      }
    }
  }, [onSelectSession, setActiveSessionIdTraced, updateLastOpened]);

  const handleRenameSession = useCallback(async (id: number, newTitle: string) => {
    // Update local sidebar state - NO-OP if title unchanged
    setSidebarSessions((prev) => {
      const cur = prev.find((s) => s.id === id);
      if (!cur || cur.title === newTitle) return prev;
      return prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s));
    });

    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: newTitle }),
    });

    setSessions((prev) => {
      const cur = prev.find((s) => s.id === id);
      if (!cur || cur.title === newTitle) return prev;
      return prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s));
    });

    if (onSessionRenamed) {
      onSessionRenamed(id, newTitle);
    }
  }, [onSessionRenamed]);

  const handleDeleteSession = useCallback(async (id: number) => {
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_deleted: 1 }),
    });

    setSidebarSessions((prev) => prev.filter((s) => s.id !== id));
    setSessions((prev) => prev.filter((s) => s.id !== id));

    if (onSessionDeleted) {
      onSessionDeleted(id);
    }
  }, [onSessionDeleted]);

  const addPendingDeletedChatFolder = useCallback((id: number) => {
    pendingDeletedChatFolderIdsRef.current.add(id);
  }, []);
  const removePendingDeletedChatFolder = useCallback((id: number) => {
    pendingDeletedChatFolderIdsRef.current.delete(id);
  }, []);

  const handleChatFolderReorder = useCallback(async (updates: Array<{ id: number; position: number | null }>) => {
    if (scopeRef.current?.kind !== "user") return;
    try {
      const payload = updates.map((u) => ({ id: u.id, sort_index: u.position ?? 0 }));
      const response = await fetch("/api/folders/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ updates: payload }),
      });
      if (!response.ok) {
        loadFoldersFromDB();
      }
    } catch {
      loadFoldersFromDB();
    }
  }, [loadFoldersFromDB]);

  const handleCreateSession = useCallback(async (mode: string) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          source: "dartz_chat",
          mode,
        }),
      });

      const json = await res.json();

      if (!res.ok || typeof json.session_id !== "number") {
        throw new Error("Failed to create session");
      }

      const newId = json.session_id;
      const nowIso = new Date().toISOString();
      
      // Get the highest current MRU to ensure monotonic ordering
      const currentMaxMru = sessions.length > 0 ? Math.max(...sessions.map(s => s.mru_ts || 0)) : 0;
      const now = Date.now();
      const monotonicMru = now > currentMaxMru ? now : currentMaxMru + 1;
      
      // Optimistic insert at top of both session lists
      const optimisticSession = {
        id: newId,
        title: "New Chat",
        created_at: nowIso,
        updatedAt: nowIso,
        mode,
        focusGoal: null,
        focusEnabled: false,
        mru_ts: monotonicMru,
      };
      
      const optimisticSidebarSession = {
        ...optimisticSession,
        inFolderId: null,
        folderOrderTs: null,
      };
      
      setSessions((prev) => [optimisticSession, ...prev]);
      setSidebarSessions((prev) => [optimisticSidebarSession, ...prev]);
      
      // Touch the session on server to persist the MRU
      try {
        await fetch("/api/sessions/touch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: newId }),
        });
      } catch (error) {
        console.error("Failed to touch new session:", error);
        // Continue anyway - optimistic update already applied
      }
      
      setActiveSessionIdTraced(newId, "createdNewSession");

      if (onSessionCreated) {
        onSessionCreated(newId);
      }
      
      // Reload sessions to ensure consistency with server
      await loadSessions();
    } catch (err) {
      console.error("[chat] createNewSession error", err);
      throw err;
    }
  }, [sessions, loadSessions, setActiveSessionIdTraced, onSessionCreated]);

  const handleReorderSessions = useCallback((orderedIds: number[]) => {
    // Note: Manual reordering is preserved, but MRU will still apply on next selection
    setSessions((prev) =>
      [...prev].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
    );
    // Also update sidebarSessions to match
    setSidebarSessions((prev) =>
      [...prev].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
    );
    // TODO later: persist order to DB (session_positions table etc.)
  }, []);

  // Wrapper for setSelectedFolderId that saves to sessionStorage
  const setSelectedFolderIdWithPersist = useCallback((next: number | null) => {
    setSelectedFolderId(next);
    
    // Save to sessionStorage for persistence across navigation
    if (typeof window !== "undefined") {
      try {
        if (next === null) {
          sessionStorage.setItem(SS_SELECTED_FOLDER_ID, "null");
        } else {
          sessionStorage.setItem(SS_SELECTED_FOLDER_ID, String(next));
        }
      } catch {
        // Ignore sessionStorage errors
      }
    }
  }, []);

  return {
    // State
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId: setActiveSessionIdTraced,
    hasHydrated,
    hasLoadedSessions,
    hasLoadedFoldersOnce,
    hydratedFromCacheChatFolders,
    sidebarSessions,
    setSidebarSessions,
    folders,
    setFolders,
    selectedFolderId,
    setSelectedFolderId: setSelectedFolderIdWithPersist,
    startRenameFolderId,
    setStartRenameFolderId,
    rightRailSelectedId,
    setRightRailSelectedId,
    rightPanelOpen,
    setRightPanelOpen,
    activeDragId,
    setActiveDragId,
    dragOverlaySessionId,
    setDragOverlaySessionId,
    sessionKey,
    setSessionKey,
    sessionUsedTokens,
    setSessionUsedTokens,
    sessionTokenLimit,
    setSessionTokenLimit,
    
    // Refs
    activeSessionIdRef,
    sidebarSessionsRef,
    foldersRef,
    selectedFolderIdRef,
    sessionUsedTokensRef,
    updatedAtOverridesRef,
    isSendingRef,
    setUpdatedAtOverride,
    
    // MRU
    updateLastOpened,
    touchSession,
    sortSessionsByMRU,
    sortFoldersByChildMRU,
    
    // Handlers
    loadSessions,
    handleSelectSession,
    handleRenameSession,
    handleDeleteSession,
    handleCreateSession,
    handleReorderSessions,
    handleChatFolderReorder,
    addPendingDeletedChatFolder,
    removePendingDeletedChatFolder,
    loadFoldersFromDB,
  };
}
