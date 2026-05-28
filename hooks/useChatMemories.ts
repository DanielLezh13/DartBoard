"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { getAuthHeaders } from "@/lib/api";
import { clearGuestSessionStorage } from "@/lib/guest-keys";
import {
  getLastUserId,
  getUserMemoryFoldersCacheKey,
  getUserMemoriesCacheKey,
  readCache,
  readMemoriesCache,
  clearCache,
  writeCache,
  writeMemoriesCache,
} from "@/lib/railCache";
import { useScope } from "./useScope";

export type MemoryFolder = {
  id: number;
  name: string;
  icon?: string | null;
  importance: number | null;
  position: number | null;
  created_at: string;
  memory_count: number;
};

export type Memory = {
  id: number;
  folder_name: string | null;
  title: string | null;
  summary: string;
  content?: string | null;
  doc_json?: string | null;
  excerpt?: string | null;
  created_at: string;
  tags: string | null;
  importance: number | null;
  session_id: number | null;
  message_id: number | null;
  source?: string | null;
  position?: number | null;
};

const compareMemoriesForDisplay = (a: Memory, b: Memory) => {
  const aPos = a.position ?? null;
  const bPos = b.position ?? null;

  if (aPos !== null && bPos !== null) {
    return aPos - bPos;
  }
  if (aPos !== null) return -1;
  if (bPos !== null) return 1;

  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
};

const sortMemoriesForDisplay = (list: Memory[]) => {
  return [...list].sort(compareMemoriesForDisplay);
};

const moveMemoriesToTopOfUnsorted = (list: Memory[]) => {
  const base = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  return sortMemoriesForDisplay(list).map((memory, index) => ({
    ...memory,
    folder_name: "Unsorted",
    position: base + index,
  }));
};

const normalizeFolderKey = (folderName: string | null) => {
  if (folderName == null) return "__ALL__";
  const trimmed = folderName.trim();
  if (!trimmed || trimmed === "Unsorted") return "__ALL__";
  return trimmed;
};

export function useChatMemories() {
  // Get authentication scope
  const { scope, loading: scopeLoading } = useScope();
  
  // Memory state
  const [memoryFolders, setMemoryFolders] = useState<MemoryFolder[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  // Keep an unfiltered cache of memories by id so folder filtering can't break the open overlay.
  const memoriesByIdRef = useRef<Map<number, Memory>>(new Map());
  // Folder-level cache so folder switching can be instant (like left panel).
  // Keyed by folderName (null => "__ALL__") and only used for empty searchQuery.
  const memoriesByFolderKeyRef = useRef<Map<string, Memory[]>>(new Map());
  const [selectedMemoryFolder, setSelectedMemoryFolder] = useState<string | null>(null); // null = "All", string = folder name
  const [selectedMemoryId, setSelectedMemoryId] = useState<number | null>(null);
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [memoryOverlayOpen, setMemoryOverlayOpen] = useState(false);
  const [memoryToolbarVisible, setMemoryToolbarVisible] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isFolderSwitching, setIsFolderSwitching] = useState(false);
  const [suppressMemoryHover, setSuppressMemoryHover] = useState(false);
  const [hasHydratedMemories, setHasHydratedMemories] = useState(false);
  const [bootResolvedMemories, setBootResolvedMemories] = useState(false);
  const [isRestoringMemoryOverlay, setIsRestoringMemoryOverlay] = useState(false);
  const [restoredDraftJson, setRestoredDraftJson] = useState<string | null>(null);
  const suppressMemoryHoverTimeoutRef = useRef<number | null>(null);

  const suppressMemoryHoverFor = useCallback((ms: number = 350) => {
    setSuppressMemoryHover(true);
    if (typeof window === "undefined") return;
    if (suppressMemoryHoverTimeoutRef.current != null) {
      window.clearTimeout(suppressMemoryHoverTimeoutRef.current);
    }
    suppressMemoryHoverTimeoutRef.current = window.setTimeout(() => {
      suppressMemoryHoverTimeoutRef.current = null;
      setSuppressMemoryHover(false);
    }, ms);
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (suppressMemoryHoverTimeoutRef.current != null) {
        window.clearTimeout(suppressMemoryHoverTimeoutRef.current);
        suppressMemoryHoverTimeoutRef.current = null;
      }
    };
  }, []);

  // Per-tab restore/persist (sessionStorage only)
  const SS_SELECTED_MEMORY_FOLDER = "db:selectedMemoryFolder";
  const SS_MEMORY_OVERLAY_OPEN = "db:memoryOverlayOpen";
  const SS_SELECTED_MEMORY_ID = "db:selectedMemoryId";
  const SS_TAB_INIT = "db:tabInit";

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

  // Restore folder selection before first paint on same-tab reload.
  // Without this, we can hydrate the correct folder's cached memories but still filter them out
  // for 1 paint because `selectedMemoryFolder` is still null.
  const didPrerestoreSelectedFolderRef = useRef(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (didPrerestoreSelectedFolderRef.current) return;
    didPrerestoreSelectedFolderRef.current = true;
    if (isSameTabRef.current !== true) return;
    try {
      const storedFolder = sessionStorage.getItem(SS_SELECTED_MEMORY_FOLDER);
      if (storedFolder !== null) {
        setSelectedMemoryFolder(storedFolder === "null" ? null : storedFolder);
      }
    } catch {
      // ignore
    }
  }, []);

  // Refs
  const memoryOverlayOpenRef = useRef(false);
  const prevMemoryOverlayOpenRef = useRef(false);
  const prevScopeKindRef = useRef<string | undefined>(undefined);
  const loadMemoriesRequestIdRef = useRef(0);
  const loadMemoriesAbortRef = useRef<AbortController | null>(null);
  const loadMemoryFoldersInFlightRef = useRef(false);
  const lastLoadMemoryFoldersAtRef = useRef(0);
  const scopeRef = useRef(scope);
  const pendingDeletedMemoryFolderIdsRef = useRef<Set<number>>(new Set());
  const hasLoadedMemoryFoldersOnceRef = useRef(false);
  const [hasLoadedMemoryFoldersOnce, setHasLoadedMemoryFoldersOnce] = useState(false);
  const hasHydratedFromCacheRef = useRef(false);
  const hasHydratedMemoriesFromCacheRef = useRef(false);
  const didInitialMountRef = useRef(false);
  const memoriesRef = useRef<Memory[]>([]);
  const [hydratedFromCacheMemoryFolders, setHydratedFromCacheMemoryFolders] = useState(false);
  const [hydratedFromCacheMemories, setHydratedFromCacheMemories] = useState(false);

  const clearFolderMemoriesCaches = useCallback((folderName: string | null) => {
    const key = normalizeFolderKey(folderName);
    memoriesByFolderKeyRef.current.delete(key);
    const scopeNow = scopeRef.current;
    const userId =
      scopeNow?.kind === "user" && "userId" in scopeNow ? scopeNow.userId : getLastUserId();
    if (userId) {
      clearCache(getUserMemoriesCacheKey(userId, key));
    }
  }, []);

  // Sync refs
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  useEffect(() => {
    memoryOverlayOpenRef.current = memoryOverlayOpen;
  }, [memoryOverlayOpen]);

  useEffect(() => {
    prevMemoryOverlayOpenRef.current = memoryOverlayOpen;
  }, [memoryOverlayOpen]);

  const isOpeningMemory = memoryOverlayOpen && !prevMemoryOverlayOpenRef.current;

  // If the memory overlay closes, ensure we drop any "toolbar overlaying dates" state.
  useEffect(() => {
    if (!memoryOverlayOpen) setMemoryToolbarVisible(false);
  }, [memoryOverlayOpen]);

  const getGuestMemoryFoldersFromStorage = useCallback((): MemoryFolder[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem("db:memoryFolders");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  // Guest hydration: hydrate memory folders from sessionStorage when scope is guest.
  useEffect(() => {
    if (scope?.kind !== "guest") return;
    const stored = getGuestMemoryFoldersFromStorage();
    setMemoryFolders(stored);
  }, [scope?.kind, getGuestMemoryFoldersFromStorage]);

  // Early hydration from cache (before scope resolves) — runs before first paint
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasHydratedFromCacheRef.current) return;
    if (hasLoadedMemoryFoldersOnceRef.current) return;
    if (memoryFolders.length > 0) return;
    const last = getLastUserId();
    if (!last) return;
    const cached = readCache(getUserMemoryFoldersCacheKey(last));
    if (!cached?.length) return;
    hasHydratedFromCacheRef.current = true;
    setHydratedFromCacheMemoryFolders(true);
    setMemoryFolders(
      cached.map((f) => ({
        id: f.id,
        name: f.name,
        icon: f.icon ?? null,
        importance: null,
        position: f.position ?? null,
        created_at: "",
        memory_count: typeof f.memory_count === "number" ? f.memory_count : 0,
      }))
    );
  }, []);

  // Early hydration for memories list (before scope resolves) — runs before first paint
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasHydratedMemoriesFromCacheRef.current) return;
    if (memories.length > 0) return;
    const last = getLastUserId();
    if (!last) return;
    const storedFolder = sessionStorage.getItem("db:selectedMemoryFolder");
    const folderKey = storedFolder === null || storedFolder === "null" ? "__ALL__" : storedFolder;
    const cacheKey = getUserMemoriesCacheKey(last, folderKey);
    const cached = readMemoriesCache(cacheKey);
    if (!cached?.length) return;
    hasHydratedMemoriesFromCacheRef.current = true;
    setHydratedFromCacheMemories(true);
    const restored: Memory[] = cached.map((m) => ({
      id: m.id,
      folder_name: m.folder_name,
      title: m.title,
      summary: m.summary,
      created_at: m.created_at,
      position: typeof (m as any).position === "number" ? (m as any).position : null,
      tags: null,
      importance: null,
      session_id: null,
      message_id: null,
    }));
    setMemories(restored);
    // Keep refs/caches coherent immediately (effects run after paint).
    memoriesRef.current = restored;
    for (const m of restored) {
      if (m && typeof m.id === "number") memoriesByIdRef.current.set(m.id, m);
    }
    // Seed folder-level cache so folder switching is instant immediately after refresh.
    memoriesByFolderKeyRef.current.set(folderKey, restored);
  }, []);

  // Signed-in only: hydrate from cache when scope resolves (fallback) + validate userId
  useEffect(() => {
    if (scope?.kind !== "user" || !("userId" in scope)) return;
    const last = getLastUserId();
    if (last !== null && scope.userId !== last) {
      setMemoryFolders([]);
      setMemories([]);
      hasHydratedFromCacheRef.current = false;
      hasHydratedMemoriesFromCacheRef.current = false;
      didInitialMountRef.current = false;
      setHydratedFromCacheMemoryFolders(false);
      setHydratedFromCacheMemories(false);
      return;
    }
    if (hasHydratedFromCacheRef.current) return;
    if (hasLoadedMemoryFoldersOnceRef.current) return;
    if (memoryFolders.length > 0) return;
    const key = getUserMemoryFoldersCacheKey(scope.userId);
    const cached = readCache(key);
    if (cached && cached.length > 0) {
      hasHydratedFromCacheRef.current = true;
      setHydratedFromCacheMemoryFolders(true);
      setMemoryFolders(
        cached.map((f) => ({
          id: f.id,
          name: f.name,
          icon: f.icon ?? null,
          importance: null,
          position: f.position ?? null,
          created_at: "",
          memory_count: typeof f.memory_count === "number" ? f.memory_count : 0,
        }))
      );
    }
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : null, memoryFolders.length]);

  // Load memory folders: guest = sessionStorage only (no API); user = /api/memory/folders only.
  const loadMemoryFolders = useCallback(async () => {
    if (scopeRef.current?.kind === "guest") {
      if (typeof window === "undefined") return;
      const stored = getGuestMemoryFoldersFromStorage();
      setMemoryFolders(stored);
      if (!hasLoadedMemoryFoldersOnceRef.current) {
        hasLoadedMemoryFoldersOnceRef.current = true;
        setHasLoadedMemoryFoldersOnce(true);
      }
      return;
    }
    if (loadMemoryFoldersInFlightRef.current) return;
    const now = Date.now();
    if (now - lastLoadMemoryFoldersAtRef.current < 1000) return;
    loadMemoryFoldersInFlightRef.current = true;
    lastLoadMemoryFoldersAtRef.current = now;

    const scopeKind = scopeRef.current?.kind;
    try {
      const response = await fetch(`/api/memory/folders?ts=${Date.now()}`, {
        cache: "no-store",
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        setMemoryFolders([]);
        setMemoryError("Failed to fetch folders");
        return;
      }
      const data = await response.json();
      const folders = (data.folders || []).filter(
        (f: { id: number }) => !pendingDeletedMemoryFolderIdsRef.current.has(f.id)
      );
      if (scopeRef.current?.kind === "user" && "userId" in scopeRef.current) {
        const cacheKey = getUserMemoryFoldersCacheKey(scopeRef.current.userId);
        writeCache(
          cacheKey,
          folders.map((f: MemoryFolder) => ({
            id: f.id,
            name: f.name,
            icon: f.icon ?? undefined,
            position: f.position ?? null,
          }))
        );
      }
      setMemoryFolders(folders);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem("db:memoryFolders");
        } catch {
          // ignore
        }
      }
      setMemoryError(null);
    } catch (err) {
      console.error("Error loading memory folders:", err);
      setMemoryFolders([]);
      setMemoryError(err instanceof Error ? err.message : "Failed to load folders");
    } finally {
      if (!hasLoadedMemoryFoldersOnceRef.current) {
        hasLoadedMemoryFoldersOnceRef.current = true;
        setHasLoadedMemoryFoldersOnce(true);
      }
      loadMemoryFoldersInFlightRef.current = false;
    }
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, getGuestMemoryFoldersFromStorage]);

  // On auth transition (guest↔user): clear guest caches and refetch memory folders
  useEffect(() => {
    if (scopeLoading || scope == null) return;
    const kind = scope.kind;
    if (prevScopeKindRef.current === undefined) {
      prevScopeKindRef.current = kind;
      return;
    }
    if (prevScopeKindRef.current === kind) return;
    prevScopeKindRef.current = kind;
    if (kind === "guest") {
      hasHydratedFromCacheRef.current = false;
    }
    clearGuestSessionStorage();
    setMemoryFolders([]);
    loadMemoryFolders();
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, scopeLoading, loadMemoryFolders]);

  /**
   * For guest: persists a sessionStorage-only memory to DB and returns the DB id.
   * If already in DB (id looks like DB autoincrement), returns as-is.
   * Replaces old local id with db id everywhere (state, sessionStorage, memoriesByIdRef).
   * For user: returns the same id (user memories are already in DB).
   */
  const persistGuestMemoryToDb = useCallback(
    async (memoryId: number): Promise<number> => {
      if (scope?.kind !== "guest") return memoryId;
      const memory =
        memories.find((m) => m.id === memoryId) ?? memoriesByIdRef.current.get(memoryId);
      if (!memory) throw new Error("Memory not found");
      // Heuristic: ids >= 1e9 are client-generated (Date.now()); smaller ids are likely from DB
      const likelyInDb = memoryId < 1e9;
      if (likelyInDb) return memoryId;

      const res = await fetch("/api/memory", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: memory.title ?? null,
          summary: memory.summary,
          content: memory.content ?? null,
          doc_json: memory.doc_json ?? null,
          folder_name: memory.folder_name || "Unsorted",
        }),
      });
      if (!res.ok) throw new Error("Failed to persist memory");
      const created = (await res.json()) as Memory;
      const oldId = memoryId;
      const dbId = created.id;
      setMemories((prev) =>
        prev.map((m) => (m.id === oldId ? created : m))
      );
      memoriesByIdRef.current.delete(oldId);
      memoriesByIdRef.current.set(dbId, created);
      if (typeof window !== "undefined") {
        try {
          const stored = sessionStorage.getItem("db:guestMemories");
          const list = stored ? JSON.parse(stored) : [];
          const updated = list.map((m: Memory) =>
            m.id === oldId ? created : m
          );
          sessionStorage.setItem("db:guestMemories", JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
      return dbId;
    },
    [scope?.kind, memories]
  );

  const handleCreateMemoryFolder = useCallback(async () => {
    if (scope?.kind === "guest") {
      const baseFolders = getGuestMemoryFoldersFromStorage();
      const existing = new Set(baseFolders.map((f) => String(f?.name ?? "").toLowerCase()));
      let folder_name = "New Folder";
      let i = 2;
      while (existing.has(folder_name.toLowerCase())) {
        folder_name = `New Folder ${i++}`;
      }
      const newId = baseFolders.length ? Math.max(...baseFolders.map((f) => f.id)) + 1 : 1;
      const newFolder: MemoryFolder = {
        id: newId,
        name: folder_name,
        icon: null,
        importance: null,
        position: null,
        created_at: new Date().toISOString(),
        memory_count: 0,
      };
      const updatedFolders = [...baseFolders, newFolder];
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updatedFolders));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setMemoryFolders(updatedFolders);
      return;
    }
    
    // For signed-in users, create in database
    if (!scope) return;
    
    try {
      // Avoid 409s by picking a unique default name (case-insensitive)
      const base = "New Folder";
      const existing = new Set(
        (memoryFolders ?? []).map((f: any) => String(f?.name ?? "").toLowerCase())
      );

      let folder_name = base;
      let i = 2;
      while (existing.has(folder_name.toLowerCase())) {
        folder_name = `${base} ${i++}`;
      }

      const response = await fetch("/api/memory/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ folder_name: folder_name }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to create folder" }));
        throw new Error(error.error || "Failed to create folder");
      }

      const created = (await response.json()) as MemoryFolder;
      clearFolderMemoriesCaches(created.name);
      setMemoryFolders((prev) => [...prev, created]);
    } catch (err) {
      console.error("Error creating memory folder:", err);
    }
  }, [getGuestMemoryFoldersFromStorage, memoryFolders, scope, clearFolderMemoriesCaches]);

  // Load memories
  const loadMemories = useCallback(async (_query?: string, folder?: string | null) => {
    const requestId = ++loadMemoriesRequestIdRef.current;
    try {
      loadMemoriesAbortRef.current?.abort();
    } catch {
      // ignore
    }
    const controller = new AbortController();
    loadMemoriesAbortRef.current = controller;

    // Don't load if scope is loading or invalid
    if (scopeLoading || !scope) {
      setMemories([]);
      if (requestId === loadMemoriesRequestIdRef.current) {
        setMemoryLoading(false);
        setIsFolderSwitching(false);
      }
      return;
    }

    // For guests, try to load from sessionStorage first
    if (scope.kind === "guest") {
      try {
        if (typeof window !== "undefined") {
          try {
            const stored = sessionStorage.getItem("db:guestMemories");
            if (stored) {
              const memories = JSON.parse(stored);
              setMemories(memories);
              return;
            }
          } catch {
            // Ignore errors
          }
        }
        setMemories([]);
      } finally {
        if (requestId === loadMemoriesRequestIdRef.current) {
          setIsFolderSwitching(false);
          setMemoryLoading(false);
        }
      }
      return;
    }

    // For signed-in users, load from database
    try {
      const skipLoadingState =
        scope?.kind === "user" &&
        hasHydratedMemoriesFromCacheRef.current &&
        memoriesRef.current.length > 0;
      if (!skipLoadingState) {
        setMemoryLoading(true);
      }
      setMemoryError(null);
      const params = new URLSearchParams();
      if (folder && folder !== "All") {
        params.set("folder", folder);
      }
      const url = `/api/memory${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { headers: getAuthHeaders(), signal: controller.signal });
      if (!response.ok) throw new Error("Failed to fetch memories");
      const data = await response.json();
      if (requestId !== loadMemoriesRequestIdRef.current) return;
      setMemories(data);
      // Update folder cache for non-search views.
      try {
        const key = normalizeFolderKey(folder ?? null);
        memoriesByFolderKeyRef.current.set(key, data);
        // Prime per-folder caches when loading "All" so first folder open is instant.
        if (key === "__ALL__") {
          const grouped = new Map<string, Memory[]>();
          for (const memory of data as Memory[]) {
            const folderKey = normalizeFolderKey(memory.folder_name ?? null);
            const existing = grouped.get(folderKey);
            if (existing) {
              existing.push(memory);
            } else {
              grouped.set(folderKey, [memory]);
            }
          }
          for (const [folderKey, list] of grouped.entries()) {
            memoriesByFolderKeyRef.current.set(folderKey, sortMemoriesForDisplay(list));
          }
        }
        if (scopeRef.current?.kind === "user" && "userId" in scopeRef.current) {
          const cacheKey = getUserMemoriesCacheKey(scopeRef.current.userId, key);
          writeMemoriesCache(
            cacheKey,
            (data as Memory[]).map((m) => ({
              id: m.id,
              title: m.title,
              summary: m.summary,
              folder_name: m.folder_name,
              created_at: m.created_at,
              position: typeof (m as any).position === "number" ? (m as any).position : null,
            }))
          );
        }
      } catch {
        // ignore cache errors
      }
      // Clear folder switching flag after memories are loaded
      setIsFolderSwitching(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (requestId !== loadMemoriesRequestIdRef.current) return;
      console.error("Error loading memories:", err);
      setMemoryError(err instanceof Error ? err.message : "Failed to load memories");
      setIsFolderSwitching(false);
    } finally {
      if (requestId === loadMemoriesRequestIdRef.current) {
        setMemoryLoading(false);
      }
    }
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, scopeLoading]);

  // Folder selection handler: serve from cache immediately (if available) to avoid flicker.
  const handleSelectMemoryFolder = useCallback(
    (folderName: string | null) => {
      const q = memorySearchQuery.trim();
      if (!q) {
        const key = normalizeFolderKey(folderName);
        let cached = memoriesByFolderKeyRef.current.get(key);

        // If this is the first folder click after a refresh, the in-memory cache map is empty.
        // Fall back to sessionStorage cache (signed-in only) for instant paint.
        if (!cached) {
          const scopeNow = scopeRef.current;
          const userId =
            scopeNow?.kind === "user" && "userId" in scopeNow ? scopeNow.userId : getLastUserId();
          if (userId) {
            const raw = readMemoriesCache(getUserMemoriesCacheKey(userId, key));
            if (raw && raw.length > 0) {
              cached = raw.map((m) => ({
                id: m.id,
                folder_name: m.folder_name,
                title: m.title,
                summary: m.summary,
                created_at: m.created_at,
                position: typeof (m as any).position === "number" ? (m as any).position : null,
                tags: null,
                importance: null,
                session_id: null,
                message_id: null,
              }));
              memoriesByFolderKeyRef.current.set(key, cached);
            }
          }
        }

        // Final fallback: derive from currently loaded data instead of clearing.
        if (!cached) {
          const source = memoriesRef.current;
          if (source.length > 0) {
            const derived =
              key === "__ALL__"
                ? source
                : source.filter((m) => normalizeFolderKey(m.folder_name ?? null) === key);
            if (derived.length > 0) {
              cached = sortMemoriesForDisplay(derived);
              memoriesByFolderKeyRef.current.set(key, cached);
            }
          }
        }

        if (cached) {
          setMemories(cached);
          // Merge into the unfiltered cache as well.
          try {
            for (const m of cached) {
              if (m && typeof m.id === "number") memoriesByIdRef.current.set(m.id, m);
            }
          } catch {
            // ignore
          }
        }
      }
      setIsFolderSwitching(true);
      setSelectedMemoryFolder(folderName);
    },
    [memorySearchQuery]
  );

  // Keep cache in sync for other code paths that mutate `memories` directly.
  useEffect(() => {
    memoriesRef.current = memories;
    for (const m of memories) {
      memoriesByIdRef.current.set(m.id, m);
    }
    // Expose the cache globally for other components to use
    if (typeof window !== 'undefined') {
      (window as any).__memoriesByIdRef = memoriesByIdRef.current;
    }
  }, [memories]);

  const getMemoryById = useCallback((id: number | null) => {
    if (id == null) return null;
    const normalizedId = Number(id);
    if (!Number.isFinite(normalizedId)) return null;
    return memoriesByIdRef.current.get(normalizedId) ?? null;
  }, []);

  // Imperative cache write so UI handoffs (draft -> saved memory) can't be broken by in-flight loads.
  const upsertMemoryInCache = useCallback((memory: Memory | null | undefined) => {
    if (!memory) return null;
    const normalizedId = Number((memory as any).id);
    if (!Number.isFinite(normalizedId)) return null;
    memoriesByIdRef.current.set(normalizedId, { ...(memory as any), id: normalizedId } as Memory);
    return normalizedId;
  }, []);

  // Keep folder-level caches coherent for instant folder switching. Only used for non-search views.
  const upsertMemoryInFolderCaches = useCallback(
    (memory: Memory | null | undefined) => {
      if (!memory) return;
      if (memorySearchQuery.trim()) return;
      const normalizedId = Number((memory as any).id);
      if (!Number.isFinite(normalizedId)) return;
      const normalized = { ...(memory as any), id: normalizedId } as Memory;

      const removeFromList = (list: Memory[]) => list.filter((m) => m.id !== normalizedId);
      const upsertToTop = (list: Memory[]) => [normalized, ...removeFromList(list)];

      const allCached = memoriesByFolderKeyRef.current.get("__ALL__");
      memoriesByFolderKeyRef.current.set("__ALL__", allCached ? upsertToTop(allCached) : [normalized]);

      const folderName = (normalized.folder_name ?? "Unsorted").trim();
      if (folderName && folderName !== "Unsorted") {
        const folderCached = memoriesByFolderKeyRef.current.get(folderName);
        memoriesByFolderKeyRef.current.set(folderName, folderCached ? upsertToTop(folderCached) : [normalized]);
      }
    },
    [memorySearchQuery]
  );

  // Load memory folders on mount and when scope changes
  useEffect(() => {
    if (scopeLoading || scope == null) return;
    const prevKind = prevScopeKindRef.current;
    const kind = scope.kind;

    // Reset didInitialMount when scope kind changes (guest↔user)
    if (prevKind !== undefined && prevKind !== kind) {
      didInitialMountRef.current = false;
    }

    // On initial signed-in mount with cache: skip clearing so memories stay visible
    if (
      kind === "user" &&
      !didInitialMountRef.current &&
      hasHydratedMemoriesFromCacheRef.current
    ) {
      didInitialMountRef.current = true;
      loadMemoryFolders();
      return;
    }

    setMemories([]);
    setSelectedMemoryFolder(null);
    setSelectedMemoryId(null);
    setMemoryOverlayOpen(false);
    setMemorySearchQuery("");
    if (prevKind !== undefined && prevKind !== kind) {
      setMemoryFolders([]);
    }
    loadMemoryFolders();
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, scopeLoading, loadMemoryFolders]);

  // Signed-in only: keep cache in sync on create/delete/reorder (any memoryFolders state change).
  useEffect(() => {
    if (scope?.kind !== "user" || !("userId" in scope)) return;
    if (memoryFolders.length === 0) return;
    const key = getUserMemoryFoldersCacheKey(scope.userId);
    writeCache(
      key,
      memoryFolders.map((f) => ({
        id: f.id,
        name: f.name,
        icon: f.icon ?? undefined,
        position: f.position ?? null,
        memory_count: typeof f.memory_count === "number" ? f.memory_count : null,
      }))
    );
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : null, memoryFolders]);

  // Restore selectedMemoryFolder and overlay state on mount (guest + signed-in same-tab reload).
  useEffect(() => {
    if (bootResolvedMemories) return;
    if (typeof window === "undefined") return;
    if (scope == null) {
      return;
    }
    try {
      const isSameTab = isSameTabRef.current === true;
      if (isSameTab) {
        // Same tab reload: restore folder selection immediately (guest + signed-in).
        const storedFolder = sessionStorage.getItem(SS_SELECTED_MEMORY_FOLDER);
        if (storedFolder !== null) {
          setSelectedMemoryFolder(storedFolder === "null" ? null : storedFolder);
        }

        // Restore overlay state when guest (signed-in overlay restore handled elsewhere if needed).
        const storedOverlayOpen = sessionStorage.getItem(SS_MEMORY_OVERLAY_OPEN);
        if (scope.kind === "guest" && storedOverlayOpen === "1") {
          // Overlay was open: restore it.
          setIsRestoringMemoryOverlay(true);
          
          // Check for draft memory first (draft takes precedence).
          const storedDraftMemory = sessionStorage.getItem("db:draftMemory");
          const storedMemoryId = sessionStorage.getItem(SS_SELECTED_MEMORY_ID);
          
          if (storedDraftMemory !== null) {
            // Draft exists: expose draft JSON to page.tsx for restoration.
            try {
              // Validate JSON before storing
              JSON.parse(storedDraftMemory);
              setRestoredDraftJson(storedDraftMemory);
              setMemoryOverlayOpen(true);
              setSelectedMemoryId(null);
            } catch {
              // Invalid JSON: treat as no draft, fall through to memory ID restore
              setRestoredDraftJson(null);
              // Fall through to restore memory ID instead
              if (storedMemoryId !== null) {
                const memoryId = Number(storedMemoryId);
                if (Number.isFinite(memoryId)) {
                  setSelectedMemoryId(memoryId);
                  setMemoryOverlayOpen(true);
                } else {
                  setMemoryOverlayOpen(false);
                  setSelectedMemoryId(null);
                }
              } else {
                setMemoryOverlayOpen(false);
                setSelectedMemoryId(null);
              }
            }
          } else if (storedMemoryId !== null) {
            // No draft, but memory ID exists: restore selected memory ID.
            const memoryId = Number(storedMemoryId);
            if (Number.isFinite(memoryId)) {
              // Restore immediately; will reconcile when memories load.
              setSelectedMemoryId(memoryId);
              setMemoryOverlayOpen(true);
            } else {
              setMemoryOverlayOpen(false);
              setSelectedMemoryId(null);
            }
          } else {
            // No draft and no memory ID: close overlay.
            setMemoryOverlayOpen(false);
            setSelectedMemoryId(null);
          }
          
          // Clear restoring flag after a brief delay to allow overlay to open.
          setTimeout(() => {
            setIsRestoringMemoryOverlay(false);
          }, 100);
        }
      }

      // Mark boot resolved AFTER restore (allows persistence to start).
      setBootResolvedMemories(true);
    } catch {
      // ignore
      setBootResolvedMemories(true);
    }
  }, [bootResolvedMemories, scope?.kind, scope]);

  // Reconcile selectedMemoryId when memories load (validate that restored ID exists).
  useEffect(() => {
    if (!bootResolvedMemories) return;
    if (!hasHydratedMemories) return;
    if (typeof window === "undefined") return;
    if (!memoryOverlayOpen) return; // Only reconcile if overlay is open.
    if (selectedMemoryId == null) return; // Only reconcile if we have a selected ID.
    
    // Check existence against the unfiltered cache (folder changes must NOT invalidate the open overlay).
    const memoryExists = memoriesByIdRef.current.has(selectedMemoryId);
    if (!memoryExists) {
      // Memory doesn't exist: close overlay and clear selection.
      setMemoryOverlayOpen(false);
      setSelectedMemoryId(null);
    }
  }, [bootResolvedMemories, hasHydratedMemories, memories, memoryOverlayOpen, selectedMemoryId]);

  // Persist selectedMemoryFolder to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolvedMemories) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SS_SELECTED_MEMORY_FOLDER, selectedMemoryFolder == null ? "null" : selectedMemoryFolder);
    } catch {
      // ignore
    }
  }, [selectedMemoryFolder, bootResolvedMemories]);

  // Persist memoryOverlayOpen to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolvedMemories) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(SS_MEMORY_OVERLAY_OPEN, memoryOverlayOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [memoryOverlayOpen, bootResolvedMemories]);

  // Persist selectedMemoryId to sessionStorage (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolvedMemories) return; // Gate: no persistence until restore is complete.
    if (typeof window === "undefined") return;
    try {
      if (selectedMemoryId == null) {
        sessionStorage.removeItem(SS_SELECTED_MEMORY_ID);
      } else {
        sessionStorage.setItem(SS_SELECTED_MEMORY_ID, String(selectedMemoryId));
      }
    } catch {
      // ignore
    }
  }, [selectedMemoryId, bootResolvedMemories]);

  // Track folder switching to prevent empty state flash
  const prevSelectedMemoryFolderRef = useRef<string | null>(selectedMemoryFolder);
  useLayoutEffect(() => {
    const prev = prevSelectedMemoryFolderRef.current;
    if (prev !== selectedMemoryFolder) {
      setIsFolderSwitching(true);
    }
    prevSelectedMemoryFolderRef.current = selectedMemoryFolder;
  }, [selectedMemoryFolder]);

  // Load memories when folder changes (search is local-only in the UI).
  useEffect(() => {
    // Don't load if scope is loading or invalid
    if (scopeLoading || !scope) return;
    
    loadMemories(undefined, selectedMemoryFolder);
  }, [selectedMemoryFolder, loadMemories, scope?.kind, scope && "userId" in scope ? scope.userId : scope?.guestId, scopeLoading]);

  // Memory CRUD handlers
  const handleMemorySave = useCallback(async (data: {
    id: number;
    title: string;
    folder_name: string;
  }) => {
    // Check if user is guest
    if (scope?.kind === "guest") {
      // For guests, update memory locally only
      setMemories((prev) => {
        const updated = prev.map((m) => 
          m.id === data.id 
            ? { ...m, title: data.title || null, folder_name: data.folder_name || "Unsorted" }
            : m
        );
        
        // Save to sessionStorage
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("db:guestMemories", JSON.stringify(updated));
          } catch {
            // Ignore sessionStorage errors
          }
        }
        
        return updated;
      });
      return;
    }
    
    // For signed-in users, update in database
    if (!scope) return;
    
    try {
      const updateData: any = {
        id: data.id,
        title: data.title || null,
        folder_name: data.folder_name || "Unsorted",
      };

      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        throw new Error("Failed to update memory");
      }

      const updated = await response.json();
      // IMPORTANT: also update the unfiltered cache immediately so the open overlay never "loses" the memory
      // when it is moved out of the currently selected folder list.
      try {
        if (updated && typeof updated.id === "number") {
          memoriesByIdRef.current.set(updated.id, updated as Memory);
        }
      } catch {
        // ignore
      }
      setMemories((prev: Memory[]) =>
        prev.map((m: Memory) => (m.id === data.id ? updated : m))
      );
    } catch (err) {
      console.error("Error saving memory:", err);
      throw err;
    }
  }, [scope]);

  const handleMemoryRename = useCallback(async (id: number, newTitle: string) => {
    if (!scope) return;

    const scopeKind = scope.kind;

    try {
      const memory = memories.find((m) => m.id === id) ?? memoriesByIdRef.current.get(id);
      if (!memory) return;

      // For guest: persist to DB first (sessionStorage-only memories don't exist in DB)
      const dbId = await persistGuestMemoryToDb(id);

      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          id: dbId,
          title: newTitle || null,
          folder_name: memory.folder_name || "Unsorted",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename memory");
      }

      const updated = (await response.json()) as Memory;
      setMemories((prev: Memory[]) =>
        prev.map((m: Memory) => (m.id === dbId ? updated : m))
      );
      memoriesByIdRef.current.set(dbId, updated);

      // For guest: update sessionStorage so it persists
      if (scopeKind === "guest" && typeof window !== "undefined") {
        try {
          const stored = sessionStorage.getItem("db:guestMemories");
          const list = stored ? JSON.parse(stored) : [];
          const updatedList = list.map((m: Memory) => (m.id === dbId ? updated : m));
          sessionStorage.setItem("db:guestMemories", JSON.stringify(updatedList));
        } catch {
          // ignore
        }
      }

      await loadMemories(memorySearchQuery, selectedMemoryFolder);
    } catch (err) {
      console.error("Error renaming memory:", err);
      throw err;
    }
  }, [memories, memorySearchQuery, selectedMemoryFolder, loadMemories, scope, persistGuestMemoryToDb]);

  const handleMemoryDelete = useCallback(async (id: number) => {
    // Allow deleting memories in guest mode (they will be ephemeral)
    if (!scope) return;
    
    // Optimistically remove from state
    setMemories((prev: Memory[]) => prev.filter((m: Memory) => m.id !== id));
    if (selectedMemoryId === id) {
      setSelectedMemoryId(null);
      setMemoryOverlayOpen(false);
    }

    try {
      const response = await fetch(`/api/memory?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error("Failed to delete memory");
      }

      if (scope.kind === "guest") {
        await loadMemories(memorySearchQuery, selectedMemoryFolder);
      } else {
        await loadMemories(memorySearchQuery, selectedMemoryFolder);
        await loadMemoryFolders();
      }
    } catch (err) {
      console.error("Error deleting memory:", err);
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
      throw err;
    }
  }, [selectedMemoryId, memorySearchQuery, selectedMemoryFolder, loadMemories, loadMemoryFolders, scope]);

  const handleMemoryReorder = useCallback(async (updates: Array<{ id: number; position: number | null }>) => {
    // Allow reordering memories in guest mode (they will be ephemeral)
    if (!scope) return;

    if (updates.length === 0) return;

    const positionById = new Map(
      updates.map((update) => [update.id, update.position ?? null])
    );

    const patchPositions = <T extends { id: number; position?: number | null }>(list: T[]) =>
      list.map((item) =>
        positionById.has(item.id)
          ? { ...item, position: positionById.get(item.id) ?? null }
          : item
      );

    setMemories((prev) => patchPositions(prev));

    // Guest reorder is local/sessionStorage only in this phase.
    if (scope.kind === "guest") {
      if (typeof window !== "undefined") {
        try {
          const raw = sessionStorage.getItem("db:guestMemories");
          const list = raw ? JSON.parse(raw) : [];
          if (Array.isArray(list)) {
            sessionStorage.setItem("db:guestMemories", JSON.stringify(patchPositions(list)));
          }
        } catch {
          // ignore guest cache write errors
        }
      }
      return;
    }

    try {
      if (!memorySearchQuery.trim()) {
        const allCached = memoriesByFolderKeyRef.current.get("__ALL__");
        if (allCached) {
          memoriesByFolderKeyRef.current.set("__ALL__", patchPositions(allCached));
        }

        const folderKey = selectedMemoryFolder == null ? "__ALL__" : selectedMemoryFolder;
        if (folderKey !== "__ALL__") {
          const folderCached = memoriesByFolderKeyRef.current.get(folderKey);
          if (folderCached) {
            memoriesByFolderKeyRef.current.set(folderKey, patchPositions(folderCached));
          }
        }

        // Signed-in: also patch persisted memory caches so refresh doesn't flash stale order.
        const userId =
          scopeRef.current?.kind === "user" && "userId" in scopeRef.current
            ? scopeRef.current.userId
            : getLastUserId();
        if (userId) {
          const patchStored = (key: string) => {
            try {
              const stored = readMemoriesCache(getUserMemoriesCacheKey(userId, key));
              if (!stored || stored.length === 0) return;
              writeMemoriesCache(
                getUserMemoriesCacheKey(userId, key),
                patchPositions(stored)
              );
            } catch {
              // ignore cache patch errors
            }
          };

          patchStored("__ALL__");
          if (folderKey !== "__ALL__") {
            patchStored(folderKey);
          }
        }
      }
    } catch {
      // ignore cache patch errors
    }

    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ updates }),
      });

      if (!response.ok) {
        throw new Error("Failed to reorder memories");
      }
    } catch (err) {
      console.error("Error reordering memories:", err);
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
    }
  }, [memorySearchQuery, selectedMemoryFolder, loadMemories, scope]);

  const handleFolderReorder = useCallback(async (updates: Array<{ id: number; position: number | null }>) => {
    if (!scope) return;
    if (scope.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const orderMap = new Map(updates.map((u, idx) => [u.id, idx]));
      const sorted = [...base].sort((a, b) => {
        const posA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999;
        const posB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999;
        return posA - posB;
      });
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(sorted));
        } catch {
          // Ignore
        }
      }
      setMemoryFolders(sorted);
      return;
    }
    const orderMap = new Map(updates.map((u, idx) => [u.id, idx]));
    const reordered = [...memoryFolders]
      .sort((a, b) => {
        const posA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999;
        const posB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999;
        return posA - posB;
      })
      .map((f, i) => ({ ...f, position: i }));
    setMemoryFolders(reordered);
    try {
      const response = await fetch("/api/memory/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          updates: reordered.map((f) => ({ id: f.id, position: f.position })),
        }),
      });
      if (!response.ok) {
        await loadMemoryFolders();
        throw new Error("Failed to reorder folders");
      }
    } catch (err) {
      await loadMemoryFolders();
    }
  }, [getGuestMemoryFoldersFromStorage, loadMemoryFolders, memoryFolders, scope]);

  const handleFolderRename = useCallback(async (id: number, newName: string) => {
    // Allow renaming folders in guest mode (they will be ephemeral)
    if (!scope) return;
    
    try {
      const folder = memoryFolders.find((f) => f.id === id);
      if (!folder) return;

      const response = await fetch("/api/memory/folders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ id, name: newName }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename folder");
      }

      await loadMemoryFolders();
    } catch (err) {
      console.error("Error renaming folder:", err);
    }
  }, [memoryFolders, loadMemoryFolders, scope]);

  const handleFolderDelete = useCallback(async (id: number) => {
    if (!scope) return;
    if (scope.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const folder = base.find((f) => f.id === id);
      if (!folder) return;
      const updatedFolders = base.filter((f) => f.id !== id);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updatedFolders));
        } catch {
          // Ignore
        }
      }
      setMemoryFolders(updatedFolders);
      setMemories((prev) =>
        prev.map((m) => (m.folder_name === folder.name ? { ...m, folder_name: "Unsorted" } : m))
      );
      if (typeof window !== "undefined") {
        try {
          const stored = sessionStorage.getItem("db:guestMemories");
          const list = stored ? JSON.parse(stored) : [];
          const updatedList = list.map((m: Memory) =>
            m.folder_name === folder.name ? { ...m, folder_name: "Unsorted" } : m
          );
          sessionStorage.setItem("db:guestMemories", JSON.stringify(updatedList));
        } catch {
          // Ignore
        }
      }
      return;
    }
    try {
      const folder = memoryFolders.find((f) => f.id === id);
      if (!folder) return;
      const response = await fetch("/api/memory/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Failed to delete folder");
      await loadMemoryFolders();
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
    } catch (err) {
      console.error("Error deleting folder:", err);
    }
  }, [getGuestMemoryFoldersFromStorage, memoryFolders, memorySearchQuery, selectedMemoryFolder, loadMemoryFolders, loadMemories, scope]);

  const handleFolderDeleteAndMove = useCallback(async (id: number, targetFolderId: number | null) => {
    if (!scope) return;
    if (scope.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const folder = base.find((f) => f.id === id);
      if (!folder) return;
      const targetFolderName = targetFolderId === null ? "Unsorted" : base.find((f) => f.id === targetFolderId)?.name || "Unsorted";
      const updatedFolders = base.filter((f) => f.id !== id);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updatedFolders));
        } catch {
          // Ignore
        }
      }
      setMemoryFolders(updatedFolders);
      setMemories((prev) =>
        prev.map((m) => (m.folder_name === folder.name ? { ...m, folder_name: targetFolderName } : m))
      );
      if (typeof window !== "undefined") {
        try {
          const stored = sessionStorage.getItem("db:guestMemories");
          const list = stored ? JSON.parse(stored) : [];
          const updatedList = list.map((m: Memory) =>
            m.folder_name === folder.name ? { ...m, folder_name: targetFolderName } : m
          );
          sessionStorage.setItem("db:guestMemories", JSON.stringify(updatedList));
        } catch {
          // Ignore
        }
      }
      return;
    }
    try {
      const folderName = selectedMemoryFolder === "All" ? "Unsorted" : (selectedMemoryFolder || "Unsorted");
      const targetFolderName = targetFolderId === null ? "Unsorted" : memoryFolders.find((f) => f.id === targetFolderId)?.name || "Unsorted";
      const response = await fetch("/api/memory/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ id, move_to_folder: targetFolderName }),
      });
      if (!response.ok) throw new Error("Failed to delete folder");
      await loadMemoryFolders();
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
    } catch (err) {
      console.error("Error deleting folder:", err);
    }
  }, [getGuestMemoryFoldersFromStorage, selectedMemoryFolder, memoryFolders, memorySearchQuery, loadMemoryFolders, loadMemories, scope]);

  const handleMoveMemoryToFolder = useCallback(async (memoryId: number, folderId: number | null) => {
    if (!scope) return;

    const scopeKind = scope.kind;

    try {
      const memory = memories.find((m) => m.id === memoryId) ?? memoriesByIdRef.current.get(memoryId);
      if (!memory) return;
      const prevFolderName = memory.folder_name || "Unsorted";

      const folderName = folderId === null ? "Unsorted" : memoryFolders.find((f) => f.id === folderId)?.name || "Unsorted";
      // Absolute-top placement: use a unique "very small" position so it always sorts first,
      // even if the destination folder already has other memories at -1 (ties break by created_at).
      const topPos = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

      if (scopeKind === "guest") {
        const movedMemory: Memory = {
          ...(memory as any),
          id: memoryId,
          folder_name: folderName,
          position: topPos,
        };

        const moveInList = (list: Memory[]) => {
          const withoutMoved = list.filter((m) => m.id !== memoryId);
          return sortMemoriesForDisplay([movedMemory, ...withoutMoved]);
        };

        setMemories((prev) => moveInList(prev));

        if (typeof window !== "undefined") {
          try {
            const stored = sessionStorage.getItem("db:guestMemories");
            const list = stored ? (JSON.parse(stored) as Memory[]) : [];
            sessionStorage.setItem("db:guestMemories", JSON.stringify(moveInList(list)));
          } catch {
            // ignore guest cache write errors
          }
        }

        memoriesByIdRef.current.set(memoryId, movedMemory);
        memoriesByFolderKeyRef.current.delete("__ALL__");
        memoriesByFolderKeyRef.current.delete(prevFolderName);
        memoriesByFolderKeyRef.current.delete(folderName);
        return;
      }

      const dbMemoryId = await persistGuestMemoryToDb(memoryId);

      const idsToMatch = new Set<number>([memoryId, dbMemoryId]);
      const optimisticMoved: Memory = { ...(memory as any), id: dbMemoryId, folder_name: folderName, position: topPos };

      // In-place update: match by dbId OR old id (React may not have flushed persist replacement yet)
      setMemories((prev) =>
        prev.map((m) =>
          idsToMatch.has(m.id)
            ? { ...m, id: dbMemoryId, folder_name: folderName, position: topPos }
            : m
        )
      );
      // Keep overlay-safe cache coherent immediately (so switching folders can't "lose" the moved memory).
      try {
        memoriesByIdRef.current.set(dbMemoryId, optimisticMoved);
      } catch {
        // ignore
      }

      // Keep folder-level caches coherent so the destination folder shows the memory immediately (no stale cache).
      // Only applies when not searching (folder caches are for non-search views).
      try {
        const q = (memorySearchQuery ?? "").trim();
        if (!q) {
          const removeFromList = (list: Memory[]) => list.filter((m) => !idsToMatch.has(m.id));
          const upsertToTop = (list: Memory[]) => [optimisticMoved, ...removeFromList(list)];

          // "__ALL__" cache (unfiltered list used by "All"/unsorted view and refresh hydration).
          const allKey = "__ALL__";
          const allCached = memoriesByFolderKeyRef.current.get(allKey);
          if (allCached && allCached.length) {
            memoriesByFolderKeyRef.current.set(
              allKey,
              allCached.map((m) => (idsToMatch.has(m.id) ? optimisticMoved : m))
            );
          }

          // Source folder cache.
          if (prevFolderName && prevFolderName !== "Unsorted") {
            const prevCached = memoriesByFolderKeyRef.current.get(prevFolderName);
            if (prevCached) {
              memoriesByFolderKeyRef.current.set(prevFolderName, removeFromList(prevCached));
            }
          }

          // Destination folder cache.
          if (folderName && folderName !== "Unsorted") {
            const nextCached = memoriesByFolderKeyRef.current.get(folderName);
            if (nextCached) {
              memoriesByFolderKeyRef.current.set(folderName, upsertToTop(nextCached));
            }
          }

          // Signed-in: also patch the sessionStorage caches so a refresh doesn't resurrect stale folder contents.
          const scopeNow = scopeRef.current;
          const userId =
            scopeNow?.kind === "user" && "userId" in scopeNow ? scopeNow.userId : getLastUserId();
          if (userId) {
            const minimal = {
              id: dbMemoryId,
              title: optimisticMoved.title,
              summary: optimisticMoved.summary,
              folder_name: folderName,
              created_at: optimisticMoved.created_at,
              position: topPos,
            };
            const patchStored = (key: string, patch: (list: any[]) => any[]) => {
              try {
                const stored = readMemoriesCache(getUserMemoriesCacheKey(userId, key));
                if (!stored || !stored.length) return;
                const next = patch(stored);
                writeMemoriesCache(getUserMemoriesCacheKey(userId, key), next);
              } catch {
                // ignore
              }
            };

            patchStored("__ALL__", (list) =>
              list.map((m) => (idsToMatch.has(m.id) ? { ...m, id: dbMemoryId, folder_name: folderName, position: topPos } : m))
            );
            if (prevFolderName && prevFolderName !== "Unsorted") {
              patchStored(prevFolderName, (list) => list.filter((m) => !idsToMatch.has(m.id)));
            }
            if (folderName && folderName !== "Unsorted") {
              patchStored(folderName, (list) => [minimal, ...list.filter((m) => !idsToMatch.has(m.id))]);
            }
          }
        }
      } catch {
        // ignore
      }

      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          id: dbMemoryId,
          title: memory.title,
          folder_name: folderName,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to move memory");
      }

      const updatedMemory = (await response.json()) as Memory;
      // Keep id-cache up to date for signed-in flows too.
      try {
        memoriesByIdRef.current.set(dbMemoryId, { ...(updatedMemory as any), id: dbMemoryId, position: topPos });
      } catch {
        // ignore
      }

      // After moving, set position to -1 to put it at the top of the destination folder
      try {
        await fetch("/api/memory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            updates: [{ id: dbMemoryId, position: topPos }],
          }),
        });
      } catch (posErr) {
        console.error("Error setting moved memory position:", posErr);
      }

      // Refresh folder counts; avoid reloading the current folder list here because
      // it can block an immediate folder switch fetch and make the destination look "stale" until the next toggle.
      await loadMemoryFolders();
    } catch (err) {
      console.error("Error moving memory:", err);
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
      await loadMemoryFolders();
    }
  }, [memories, memoryFolders, memorySearchQuery, selectedMemoryFolder, loadMemories, loadMemoryFolders, scope, persistGuestMemoryToDb]);

  const handleRenameMemoryFolder = useCallback(async (id: number, newName: string) => {
    if (scope?.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const updated = base.map((f) => (f.id === id ? { ...f, name: newName } : f));
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updated));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setMemoryFolders(updated);
      return;
    }
    
    // For signed-in users, update in database
    if (!scope) return;
    
    try {
      const folder = memoryFolders.find((f) => f.id === id);
      if (!folder) return;
      const oldName = folder.name;

      const response = await fetch("/api/memory/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ updates: [{ id, name: newName }] }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename folder");
      }

      // Reload folders to get updated data
      await loadMemoryFolders();
      clearFolderMemoriesCaches(oldName);
      clearFolderMemoriesCaches(newName);
    } catch (err) {
      console.error("Error renaming memory folder:", err);
      throw err;
    }
  }, [memoryFolders, loadMemoryFolders, scope, clearFolderMemoriesCaches]);

  const handleDeleteMemoryFolder = useCallback(async (id: number) => {
    // Check if user is guest
    if (scope?.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const folder = base.find((f) => f.id === id);
      if (!folder) return;

      const selectedDeletedFolder = selectedMemoryFolder === folder.name;
      const updatedFolders = base.filter((f) => f.id !== id);
      const stored = typeof window !== "undefined" ? sessionStorage.getItem("db:guestMemories") : null;
      const list = stored ? (JSON.parse(stored) as Memory[]) : [];
      const moved = moveMemoriesToTopOfUnsorted(
        list.filter((m) => (m.folder_name ?? "Unsorted") === folder.name)
      );
      const movedIds = new Set(moved.map((m) => m.id));
      const unsortedRest = list
        .filter((m) => (m.folder_name ?? "Unsorted") === "Unsorted")
        .filter((m) => !movedIds.has(m.id));
      const nonDeletedFolderRest = list.filter((m) => (m.folder_name ?? "Unsorted") !== folder.name && (m.folder_name ?? "Unsorted") !== "Unsorted");
      const nextGuestMemories = [...moved, ...unsortedRest, ...nonDeletedFolderRest];

      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updatedFolders));
          sessionStorage.setItem("db:guestMemories", JSON.stringify(nextGuestMemories));
        } catch {
          // Ignore sessionStorage errors
        }
      }

      setMemoryFolders(updatedFolders);
      if (selectedDeletedFolder) {
        suppressMemoryHoverFor(450);
        setSelectedMemoryFolder(null);
      }
      setMemories(nextGuestMemories);
      return;
    }

    if (!scope) return;
    const folder = memoryFolders.find((f) => f.id === id);
    if (!folder) return;
    clearFolderMemoriesCaches(folder.name);

    const selectedDeletedFolder = selectedMemoryFolder === folder.name;
    pendingDeletedMemoryFolderIdsRef.current.add(id);
    setMemoryFolders((prev) => prev.filter((f) => f.id !== id));
    if (selectedDeletedFolder) {
      suppressMemoryHoverFor(450);
      setSelectedMemoryFolder(null);
    }

    // Immediate UI update: move currently-known memories from this folder to the top of Unsorted.
    setMemories((prev) => {
      const source = prev.filter((m) => (m.folder_name ?? "Unsorted") === folder.name);
      if (source.length === 0) return prev;
      const moved = moveMemoriesToTopOfUnsorted(source);
      const movedIds = new Set(moved.map((m) => m.id));
      const remaining = prev.filter((m) => !movedIds.has(m.id) && (m.folder_name ?? "Unsorted") !== folder.name);
      return [...moved, ...remaining];
    });

    try {
      let folderMemories: Memory[] = [];
      try {
        const response = await fetch(`/api/memory?folder=${encodeURIComponent(folder.name)}`, {
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          folderMemories = (await response.json()) as Memory[];
        }
      } catch {
        // fallback below
      }

      if (folderMemories.length === 0) {
        folderMemories = memories.filter((m) => (m.folder_name ?? "Unsorted") === folder.name);
      }

      const movedMemories = moveMemoriesToTopOfUnsorted(folderMemories);

      // Keep caches coherent so switching folders does not resurrect stale rows.
      try {
        if (!memorySearchQuery.trim()) {
          const movedIds = new Set(movedMemories.map((m) => m.id));
          const allCached = memoriesByFolderKeyRef.current.get("__ALL__");
          if (allCached) {
            const allWithoutMoved = allCached.filter((m) => !movedIds.has(m.id));
            memoriesByFolderKeyRef.current.set("__ALL__", [...movedMemories, ...allWithoutMoved]);
          }
          memoriesByFolderKeyRef.current.delete(folder.name);
        }
      } catch {
        // ignore cache patch errors
      }

      if (movedMemories.length > 0) {
        const moveResults = await Promise.all(
          movedMemories.map((memory) =>
            fetch("/api/memory", {
              method: "PUT",
              headers: { "Content-Type": "application/json", ...getAuthHeaders() },
              body: JSON.stringify({
                id: memory.id,
                folder_name: "Unsorted",
              }),
            })
          )
        );
        if (moveResults.some((response) => !response.ok)) {
          throw new Error("Failed to move memories");
        }

        const positionResponse = await fetch("/api/memory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            updates: movedMemories.map((memory) => ({
              id: memory.id,
              position: memory.position ?? null,
            })),
          }),
        });
        if (!positionResponse.ok) {
          throw new Error("Failed to set moved memory positions");
        }
      }

      const deleteResponse = await fetch(`/api/memory/folders?folder_id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!deleteResponse.ok) throw new Error("Failed to delete folder");
    } catch (err) {
      pendingDeletedMemoryFolderIdsRef.current.delete(id);
      await loadMemoryFolders();
      await loadMemories(memorySearchQuery, selectedDeletedFolder ? null : selectedMemoryFolder);
      throw err;
    }

    await loadMemoryFolders();
    if (selectedDeletedFolder) {
      await loadMemories(memorySearchQuery, null);
      suppressMemoryHoverFor(450);
    }
  }, [getGuestMemoryFoldersFromStorage, memoryFolders, memories, memorySearchQuery, selectedMemoryFolder, loadMemoryFolders, loadMemories, scope, suppressMemoryHoverFor]);

  const handleDeleteMemoryFolderAndMemories = useCallback(async (id: number) => {
    if (!scope) return;
    if (scope.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const folder = base.find((f) => f.id === id);
      if (!folder) return;
      const updatedFolders = base.filter((f) => f.id !== id);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updatedFolders));
        } catch {
          // Ignore
        }
      }
      setMemoryFolders(updatedFolders);
      const stored = typeof window !== "undefined" ? sessionStorage.getItem("db:guestMemories") : null;
      const list = stored ? JSON.parse(stored) : [];
      const filtered = list.filter((m: Memory) => m.folder_name !== folder.name);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:guestMemories", JSON.stringify(filtered));
        } catch {
          // Ignore
        }
      }
      setMemories(filtered);
      return;
    }
    const folder = memoryFolders.find((f) => f.id === id);
    if (!folder) return;
    pendingDeletedMemoryFolderIdsRef.current.add(id);
    setMemoryFolders((prev) => prev.filter((f) => f.id !== id));
    setMemories((prev) => prev.filter((m) => m.folder_name !== folder.name));
    try {
      const response = await fetch(`/api/memory/folders?folder_id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to delete folder and memories");
    } catch (err) {
      pendingDeletedMemoryFolderIdsRef.current.delete(id);
      await loadMemoryFolders();
      await loadMemories(memorySearchQuery, selectedMemoryFolder);
      throw err;
    }
    await loadMemoryFolders();
    await loadMemories(memorySearchQuery, selectedMemoryFolder);
  }, [getGuestMemoryFoldersFromStorage, memoryFolders, memorySearchQuery, selectedMemoryFolder, loadMemoryFolders, loadMemories, scope]);

  const handleCreateMemory = useCallback(async () => {
    // Allow creating memories in guest mode (they will be ephemeral)
    if (!scope) return;
    
    try {
      const folderName = selectedMemoryFolder === "All" ? "Unsorted" : (selectedMemoryFolder || "Unsorted");
      const topPos = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          folder_name: folderName,
          title: "",
          summary: " ",
          importance: 3,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to create memory";
        try {
          const errorData = await response.json();
          if (typeof errorData?.error === "string") {
            errorMessage = errorData.error;
          }
        } catch {
          // If response is not JSON, keep default message
        }
        throw new Error(errorMessage);
      }

      const newMemory = (await response.json()) as Memory;
      const optimisticNew: Memory = { ...(newMemory as any), position: topPos };
      setMemories((prev: Memory[]) => [optimisticNew, ...prev]);
      try {
        memoriesByIdRef.current.set(optimisticNew.id, optimisticNew);
      } catch {
        // ignore
      }

      // Put it at the top of its folder immediately (positioned items sort ahead of nulls).
      try {
        await fetch("/api/memory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ updates: [{ id: optimisticNew.id, position: topPos }] }),
        });
      } catch {
        // ignore - UI already reflects top placement
      }

      // Patch folder caches (non-search only) so switching folders doesn't lose the new memory.
      try {
        if (!memorySearchQuery.trim()) {
          const removeFromList = (list: Memory[]) => list.filter((m) => m.id !== optimisticNew.id);
          const upsertToTop = (list: Memory[]) => [optimisticNew, ...removeFromList(list)];

          const allKey = "__ALL__";
          const allCached = memoriesByFolderKeyRef.current.get(allKey);
          if (allCached) {
            memoriesByFolderKeyRef.current.set(allKey, upsertToTop(allCached));
          }

          if (folderName && folderName !== "Unsorted") {
            const folderCached = memoriesByFolderKeyRef.current.get(folderName);
            if (folderCached) {
              memoriesByFolderKeyRef.current.set(folderName, upsertToTop(folderCached));
            }
          }

          const scopeNow = scopeRef.current;
          const userId =
            scopeNow?.kind === "user" && "userId" in scopeNow ? scopeNow.userId : getLastUserId();
          if (userId) {
            const minimal = {
              id: optimisticNew.id,
              title: optimisticNew.title,
              summary: optimisticNew.summary,
              folder_name: optimisticNew.folder_name,
              created_at: optimisticNew.created_at,
              position: topPos,
            };
            const patchStored = (key: string) => {
              try {
                const stored = readMemoriesCache(getUserMemoriesCacheKey(userId, key));
                if (!stored) return;
                writeMemoriesCache(
                  getUserMemoriesCacheKey(userId, key),
                  [minimal, ...stored.filter((m) => m.id !== optimisticNew.id)]
                );
              } catch {
                // ignore
              }
            };
            patchStored("__ALL__");
            if (folderName && folderName !== "Unsorted") patchStored(folderName);
          }
        }
      } catch {
        // ignore
      }

      setSelectedMemoryId(optimisticNew.id);
      setMemoryOverlayOpen(true);
      await loadMemoryFolders();
    } catch (err) {
      console.error("Error creating memory:", err);
    }
  }, [selectedMemoryFolder, loadMemoryFolders, scope, memorySearchQuery]);

  // Get all folder names for MemoryPreview
  const getAllMemoryFolderNames = useCallback((): string[] => {
    const folderSet = new Set<string>();
    memories.forEach((m) => {
      if (m.folder_name) {
        folderSet.add(m.folder_name);
      }
    });
    memoryFolders.forEach((f) => {
      folderSet.add(f.name);
    });
    return Array.from(folderSet).sort();
  }, [memories, memoryFolders]);

  return {
    // State
    memoryFolders,
    setMemoryFolders,
    memories,
    setMemories,
    getMemoryById,
    upsertMemoryInCache,
    upsertMemoryInFolderCaches,
    selectedMemoryFolder,
    setSelectedMemoryFolder,
    handleSelectMemoryFolder,
    selectedMemoryId,
    setSelectedMemoryId,
    memorySearchQuery,
    setMemorySearchQuery,
    memoryOverlayOpen,
    setMemoryOverlayOpen,
    memoryToolbarVisible,
    setMemoryToolbarVisible,
    memoryLoading,
    memoryError,
    isFolderSwitching,
    suppressMemoryHover,

    bootResolvedMemories,
    hasLoadedMemoryFoldersOnce,
    hydratedFromCacheMemoryFolders,
    hydratedFromCacheMemories,
    
    // Refs
    memoryOverlayOpenRef,
    isOpeningMemory,
    isRestoringMemoryOverlay,
    clearRestoringMemoryOverlay: () => setIsRestoringMemoryOverlay(false),
    restoredDraftJson,
    
    getGuestMemoryFoldersFromStorage,
    loadMemoryFolders,
    handleCreateMemoryFolder,
    loadMemories,
    persistGuestMemoryToDb,
    handleMemorySave,
    handleMemoryRename,
    handleMemoryDelete,
    handleMemoryReorder,
    handleFolderReorder,
    handleFolderRename,
    handleFolderDelete,
    handleFolderDeleteAndMove,
    handleMoveMemoryToFolder,
    handleRenameMemoryFolder,
    handleDeleteMemoryFolder,
    handleDeleteMemoryFolderAndMemories,
    handleCreateMemory,
    getAllMemoryFolderNames,
  };
}
