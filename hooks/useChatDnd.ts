"use client";

import { useRef, useState, useCallback } from "react";
import {
  DragEndEvent,
  DragStartEvent,
  DragCancelEvent,
  DragOverEvent,
  DragMoveEvent,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

export function useChatDnd(args: {
  // state/setters owned by page/hook
  activeSessionIdRef: React.MutableRefObject<number | null>;

  activeDragId: string | null;
  setActiveDragId: (id: string | null) => void;

  setDragOverlaySessionId: (id: number | null) => void;

  // overlay state
  memoryOverlayOpen?: boolean;

  // data needed by handleDragEnd cases
  folders: Array<{ id: number }>;
  sidebarSessions: Array<{ id: number; inFolderId?: number | null }>;
  selectedFolderId: number | null;
  memoryFolders: Array<{ id: number }>;
  memories: Array<{ id: number; folder_name?: string | null; position?: number | null; created_at: string }>;
  selectedMemoryFolder: string | null;

  // setters used in cases
  setFolders: (folders: any) => void;
  setSelectedFolderId: (id: number | null) => void;
  setActiveSessionIdTraced: (id: number | null, why: string) => void;

  // callbacks used in cases
  handleChatFolderReorder?: (updates: Array<{ id: number; position: number | null }>) => void;
  handleFolderReorder?: (updates: Array<{ id: number; position: number | null }>) => void;
  handleMoveSessionToFolder: (sessionId: number, folderId: number | null) => void;
  handleReorderFolderSessions: (folderId: number, orderedIds: number[]) => void;
  handleMemoryReorder: (updates: Array<{ id: number; position: number }>) => void;
  handleMoveMemoryToFolder?: (memoryId: number, folderId: number | null) => void;

  attachMemoryToActiveSession: (memoryId: number) => Promise<void>;
  attachMemoryToLanding: (memoryId: number) => void;

  /** Refs to folder list scroll containers (for rail-wide drop-zone tracking) */
  leftFolderListRef?: React.RefObject<HTMLDivElement | null>;
  rightFolderListRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const {
    activeSessionIdRef,
    activeDragId,
    setActiveDragId,
    setDragOverlaySessionId,
    memoryOverlayOpen,
    folders,
    sidebarSessions,
    selectedFolderId,
    memoryFolders,
    memories,
    selectedMemoryFolder,
    setFolders,
    setSelectedFolderId,
    setActiveSessionIdTraced,
    handleChatFolderReorder,
    handleFolderReorder,
    handleMoveSessionToFolder,
    handleReorderFolderSessions,
    handleMemoryReorder,
    handleMoveMemoryToFolder,
    attachMemoryToActiveSession,
    attachMemoryToLanding,
    leftFolderListRef,
    rightFolderListRef,
  } = args;

  // Unified DnD hover target (single source of truth for hover styling)
  const [currentOverId, setCurrentOverId] = useState<string | null>(null);

  // Static insert-line: single index per gap (0=before first, len=after last)
  type InsertSlot = { list: "left" | "right"; index: number };
  const [currentInsert, setCurrentInsert] = useState<InsertSlot | null>(null);
  const lastInsertIndexRef = useRef<number | null>(null);
  const lastTargetIndexRef = useRef<number | null>(null);
  const HYST_PX = 4;

  // Memory drag overlay state
  const [dragOverlayMemoryId, setDragOverlayMemoryId] = useState<number | null>(null);

  // Refs for measured memory drag clamping
  const memoryNodeMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const chatDropzoneRectRef = useRef<DOMRect | null>(null);
  const memoryMinXRef = useRef<number>(-Infinity);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const collisionDetection = useCallback((args: any) => {
    const id = String(args.active?.id ?? "");
    // Use pointerWithin for all drag types: over = when pointer is inside droppable.
    // This keeps the highlight on the actual current target, not "last crossed" (closestCenter).
    if (id.startsWith("session-") || id.startsWith("memory-")) {
      const hits = pointerWithin(args);
      if (hits.length > 0) return hits;

      const pointer = args.pointerCoordinates as { x: number; y: number } | null | undefined;
      if (!pointer) return hits;

      // Vertical-only clamp for row reorders:
      // - If pointer leaves list above/below but remains horizontally inside lane,
      //   stick target to first/last row.
      // - If pointer leaves lane horizontally, keep existing behavior (no target).
      const isSessionDrag = id.startsWith("session-");
      const isMemoryDrag = id.startsWith("memory-") && !id.startsWith("memory-folder-");

      if (isSessionDrag) {
        // Do not alter unfiled session behavior; those are not reorderable.
        if (selectedFolderId == null) return hits;
        const lane = args.droppableContainers
          .filter((c: any) => /^session-\d+$/.test(String(c.id)))
          .map((c: any) => ({ id: String(c.id), container: c, rect: args.droppableRects.get(c.id) as DOMRect | undefined }))
          .filter((x: any) => !!x.rect)
          .sort((a: any, b: any) => a.rect.top - b.rect.top);
        if (lane.length === 0) return hits;

        const minX = Math.min(...lane.map((x: any) => x.rect.left));
        const maxX = Math.max(...lane.map((x: any) => x.rect.right));
        if (pointer.x < minX || pointer.x > maxX) return hits;

        const first = lane[0];
        const last = lane[lane.length - 1];
        if (pointer.y < first.rect.top) {
          return [{ id: first.id, data: { droppableContainer: first.container, value: 0 } }];
        }
        if (pointer.y > last.rect.bottom) {
          return [{ id: last.id, data: { droppableContainer: last.container, value: 0 } }];
        }
        return hits;
      }

      if (isMemoryDrag) {
        const lane = args.droppableContainers
          .filter((c: any) => /^memory-\d+$/.test(String(c.id)))
          .map((c: any) => ({ id: String(c.id), container: c, rect: args.droppableRects.get(c.id) as DOMRect | undefined }))
          .filter((x: any) => !!x.rect)
          .sort((a: any, b: any) => a.rect.top - b.rect.top);
        if (lane.length === 0) return hits;

        const minX = Math.min(...lane.map((x: any) => x.rect.left));
        const maxX = Math.max(...lane.map((x: any) => x.rect.right));
        if (pointer.x < minX || pointer.x > maxX) return hits;

        const first = lane[0];
        const last = lane[lane.length - 1];
        if (pointer.y < first.rect.top) {
          return [{ id: first.id, data: { droppableContainer: first.container, value: 0 } }];
        }
        if (pointer.y > last.rect.bottom) {
          return [{ id: last.id, data: { droppableContainer: last.container, value: 0 } }];
        }
        return hits;
      }

      return hits;
    }
    if (id.startsWith("folder-") || id.startsWith("memory-folder-")) return pointerWithin(args);
    return closestCenter(args);
  }, [selectedFolderId]);

  // Custom modifier: clamp/restrict X for session, memory, and folder drags
  const clampSessionDragX = useCallback(({ transform, active }: any) => {
    const id = String(active?.id ?? "");
    // Check folder types first (memory-folder-* matches memory-* so order matters)
    if ((id.startsWith("folder-") || id.startsWith("memory-folder-")) && transform) {
      // Folder bubbles (both rails): restrict to vertical axis only (no horizontal drift)
      return {
        ...transform,
        x: 0,
      };
    }
    if (id.startsWith("session-") && transform) {
      // Sessions drag LEFT to folders - allow negative (left), block positive (right)
      return {
        ...transform,
        x: Math.min(0, transform.x),
      };
    }
    if (id.startsWith("memory-") && transform) {
      // Memory cards: allow right freely, allow left only until chat left edge
      return {
        ...transform,
        x: Math.max(memoryMinXRef.current ?? -Infinity, transform.x),
      };
    }
    return transform;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setCurrentOverId(null);
    setCurrentInsert(null);
    lastInsertIndexRef.current = null;
    lastTargetIndexRef.current = null;

    const id = String(event.active.id);
    if (id.startsWith("session-")) {
      const sessionId = parseInt(id.replace("session-", ""));
      setDragOverlaySessionId(sessionId);
    } else if (id.startsWith("memory-")) {
      const memoryId = parseInt(id.replace("memory-", ""));
      setDragOverlayMemoryId(memoryId);

      // Measure chat dropzone rect and active memory row rect for clamping
      const chatDropzoneEl = document.querySelector('[data-chat-dropzone="true"]') as HTMLElement | null;
      chatDropzoneRectRef.current = chatDropzoneEl?.getBoundingClientRect() ?? null;

      // Look up the memory node by its draggable ID
      const activeEl = memoryNodeMapRef.current.get(id);
      const activeRect = activeEl?.getBoundingClientRect() ?? null;

      if (chatDropzoneRectRef.current && activeRect) {
        // minX is how far left we can go before the dragged item's LEFT hits chat's LEFT
        memoryMinXRef.current = chatDropzoneRectRef.current.left - activeRect.left;
      } else {
        memoryMinXRef.current = -Infinity;
      }
    }
  }, [setActiveDragId, setDragOverlaySessionId]);

  const updateFolderInsertFromEvent = useCallback((event: DragMoveEvent | DragOverEvent) => {
    const activeId = String(event.active?.id ?? "");
    if (!activeId.startsWith("folder-") && !activeId.startsWith("memory-folder-")) return;

    const rect = event.active?.rect?.current;
    const translated = rect?.translated;
    const initial = rect?.initial;
    const delta = event.delta ?? { x: 0, y: 0 };

    let centerY: number | null = null;
    if (translated) {
      centerY = translated.top + translated.height / 2;
    } else if (initial) {
      centerY = initial.top + delta.y + initial.height / 2;
    }
    if (centerY == null) return;

    const isLeftRail = activeId.startsWith("folder-") && !activeId.startsWith("memory-folder-");
    const containerRef = isLeftRail ? leftFolderListRef : rightFolderListRef;
    const prefix = isLeftRail ? "folder-" : "memory-folder-";
    const listKey: "left" | "right" = isLeftRail ? "left" : "right";

    const listEndId = isLeftRail ? "folder-list-end" : "memory-folder-list-end";
    if (!containerRef?.current) return;

    const folderEls = Array.from(containerRef.current.querySelectorAll<HTMLElement>(`[data-droppable-id^="${prefix}"]`))
      .filter((el) => {
        const id = el.getAttribute("data-droppable-id") ?? "";
        return id !== listEndId;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (folderEls.length === 0) return;

    const bubbles = folderEls.map((el, i) => {
      const r = el.getBoundingClientRect();
      return { index: i, top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 };
    });

    const first = bubbles[0];
    const last = bubbles[bubbles.length - 1];

    let target: (typeof bubbles)[0];
    const overlapping = bubbles.find((b) => centerY >= b.top && centerY <= b.bottom);
    if (overlapping) {
      target = overlapping;
    } else if (centerY < first.top) {
      target = first;
    } else if (centerY > last.bottom) {
      target = last;
    } else {
      const nearest = bubbles.reduce((best, b) => {
        const nearestY = Math.max(b.top, Math.min(b.bottom, centerY));
        const dist = Math.abs(centerY - nearestY);
        return dist < best.dist ? { bubble: b, dist } : best;
      }, { bubble: first, dist: Infinity });
      target = nearest.bubble;
    }

    const targetIndex = target.index;
    const targetMidY = target.mid;

    const prevTargetIndex = lastTargetIndexRef.current;
    const prevIdx = lastInsertIndexRef.current;

    let idx: number;
    const rawSlot = centerY < targetMidY ? targetIndex : targetIndex + 1;

    if (prevTargetIndex === targetIndex && prevIdx !== null) {
      if (centerY > targetMidY + HYST_PX) idx = targetIndex + 1;
      else if (centerY < targetMidY - HYST_PX) idx = targetIndex;
      else idx = prevIdx;
    } else {
      idx = rawSlot;
    }

    lastTargetIndexRef.current = targetIndex;

    const arr = isLeftRail ? folders : memoryFolders;
    const draggedId = parseInt(activeId.replace(prefix, ""), 10);
    const fromIndex = arr.findIndex((f) => f.id === draggedId);

    const isNoOp = (slotIndex: number): boolean => {
      if (fromIndex === -1) return false;
      const toIndex = slotIndex > fromIndex ? slotIndex - 1 : slotIndex;
      return toIndex === fromIndex;
    };

    lastInsertIndexRef.current = idx;
    const result = isNoOp(idx) ? null : { list: listKey as "left" | "right", index: idx };
    setCurrentInsert(result);
  }, [leftFolderListRef, rightFolderListRef, folders, memoryFolders]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    updateFolderInsertFromEvent(event);
  }, [updateFolderInsertFromEvent]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setCurrentOverId(overId);
  }, []);

  const removeFolderPointerListener = useCallback(() => {
    lastInsertIndexRef.current = null;
    lastTargetIndexRef.current = null;
  }, []);

  const handleDragCancel = useCallback(() => {
    removeFolderPointerListener();
    setActiveDragId(null);
    setCurrentOverId(null);
    setCurrentInsert(null);
    setDragOverlaySessionId(null);
    setDragOverlayMemoryId(null);
  }, [setActiveDragId, setDragOverlaySessionId, removeFolderPointerListener]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    removeFolderPointerListener();
    setActiveDragId(null);
    setCurrentOverId(null);
    setCurrentInsert(null);
    setDragOverlaySessionId(null);
    setDragOverlayMemoryId(null);

    const activeIdStr = String(active.id);

    // Case 1: Folder reorder (folder → folder) - chat folders (insert index)
    if (activeIdStr.startsWith("folder-") && !activeIdStr.startsWith("memory-folder-")) {
      const draggedId = parseInt(activeIdStr.replace("folder-", ""));
      const fromIndex = folders.findIndex((f) => f.id === draggedId);
      if (fromIndex === -1) return;

      let to: number;
      if (currentInsert && currentInsert.list === "left") {
        to = currentInsert.index > fromIndex ? currentInsert.index - 1 : currentInsert.index;
      } else {
        const overIdStr = over ? String(over.id) : null;
        if (!overIdStr?.startsWith("folder-") || overIdStr.startsWith("memory-folder-")) return;
        if (active.id === over?.id) return;
        const targetId = parseInt(overIdStr.replace("folder-", ""));
        const targetIndex = folders.findIndex((f) => f.id === targetId);
        if (targetIndex === -1) return;
        to = targetIndex;
      }
      if (to === fromIndex) return;
      const reordered = arrayMove(folders, fromIndex, to);
      setFolders(reordered);
      const updates: Array<{ id: number; position: number | null }> = reordered.map((folder, idx) => ({ id: folder.id, position: idx }));
      if (updates.length > 0 && handleChatFolderReorder) handleChatFolderReorder(updates);
      return;
    }

    // Case 1b: Memory folder reorder (memory-folder- → memory-folder-) (insert index)
    if (activeIdStr.startsWith("memory-folder-")) {
      const draggedId = parseInt(activeIdStr.replace("memory-folder-", ""));
      const fromIndex = memoryFolders.findIndex((f) => f.id === draggedId);
      if (fromIndex === -1) return;

      let to: number;
      if (currentInsert && currentInsert.list === "right") {
        to = currentInsert.index > fromIndex ? currentInsert.index - 1 : currentInsert.index;
      } else {
        const overIdStr = over ? String(over.id) : null;
        if (!overIdStr?.startsWith("memory-folder-")) return;
        if (active.id === over?.id) return;
        const targetId = parseInt(overIdStr.replace("memory-folder-", ""));
        const targetIndex = memoryFolders.findIndex((f) => f.id === targetId);
        if (targetIndex === -1) return;
        to = targetIndex;
      }
      if (to === fromIndex) return;
      const reordered = arrayMove(memoryFolders, fromIndex, to);
      const updates: Array<{ id: number; position: number | null }> = reordered.map((folder, idx) => ({ id: folder.id, position: idx }));
      if (updates.length > 0 && handleFolderReorder) handleFolderReorder(updates);
      return;
    }

    if (!over || active.id === over.id) return;
    const overIdStr = String(over.id);

    // Case 2: Session → folder bubble (move to folder)
    if (activeIdStr.startsWith("session-") && overIdStr.startsWith("folder-")) {
      const sessionId = parseInt(activeIdStr.replace("session-", ""));
      const folderId = parseInt(overIdStr.replace("folder-", ""));
      handleMoveSessionToFolder(sessionId, folderId);
      // Only switch folder view if the dragged session is the active chat
      if (activeSessionIdRef.current === sessionId) {
        setSelectedFolderId(folderId);
        // activeSessionId is already set, so it stays selected
      }
      return;
    }

    // Case 3: Session → unfiled bubble (move to root)
    if (activeIdStr.startsWith("session-") && overIdStr === "unfiled-bubble") {
      const sessionId = parseInt(activeIdStr.replace("session-", ""));
      handleMoveSessionToFolder(sessionId, null);
      // Mirror folder-drop behavior: only switch visible folder when moving the active chat.
      if (activeSessionIdRef.current === sessionId) {
        setSelectedFolderId(null);
        // Keep active session selected (do not force landing).
      }
      return;
    }

    // Case 4: Session reorder (session → session) - only if both in selected folder
    if (activeIdStr.startsWith("session-") && overIdStr.startsWith("session-")) {
      const draggedId = parseInt(activeIdStr.replace("session-", ""));
      const targetId = parseInt(overIdStr.replace("session-", ""));

      // Only reorder if both sessions are in the currently selected folder
      const draggedSession = sidebarSessions.find((s) => s.id === draggedId);
      const targetSession = sidebarSessions.find((s) => s.id === targetId);

      if (
        !draggedSession ||
        !targetSession ||
        draggedSession.inFolderId !== selectedFolderId ||
        targetSession.inFolderId !== selectedFolderId ||
        selectedFolderId === null // Unfiled not reorderable
      ) {
        return;
      }

      // Prefer the actual visible DOM order so drop mapping matches what the user sees.
      const sessionById = new Map(sidebarSessions.map((s) => [s.id, s]));
      const visibleFolderSessionIds =
        typeof document === "undefined"
          ? []
          : Array.from(document.querySelectorAll<HTMLElement>('[data-session-row^="session-"]'))
              .filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
              })
              .map((el) => {
                const raw = el.getAttribute("data-session-row") ?? "";
                const id = Number(raw.replace("session-", ""));
                return Number.isFinite(id) ? id : null;
              })
              .filter((id): id is number => id !== null)
              .filter((id) => sessionById.get(id)?.inFolderId === selectedFolderId);

      // Fallback: derive the same order ChatNavigator uses when DOM rows are unavailable.
      const fallbackFolderSessionIds = sidebarSessions
        .filter((s) => s.inFolderId === selectedFolderId)
        .sort((a, b) => {
          const aOrder = Number((a as any).folderOrderTs ?? 0);
          const bOrder = Number((b as any).folderOrderTs ?? 0);
          if (aOrder !== bOrder) return bOrder - aOrder;

          const aMru = Number((a as any).mru_ts ?? 0);
          const bMru = Number((b as any).mru_ts ?? 0);
          if (aMru !== bMru) return bMru - aMru;

          const aUpdated = new Date((a as any).updatedAt ?? 0).getTime();
          const bUpdated = new Date((b as any).updatedAt ?? 0).getTime();
          if (aUpdated !== bUpdated) return bUpdated - aUpdated;

          return Number((b as any).id) - Number((a as any).id);
        })
        .map((s) => s.id);

      const folderSessionIds =
        visibleFolderSessionIds.length > 0
          ? visibleFolderSessionIds
          : fallbackFolderSessionIds;

      const oldIndex = folderSessionIds.indexOf(draggedId);
      const newIndex = folderSessionIds.indexOf(targetId);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      // Reorder only within selected folder
      const orderedIds = arrayMove(folderSessionIds, oldIndex, newIndex);
      handleReorderFolderSessions(selectedFolderId, orderedIds);
      return;
    }

    // Case 4b: Memory reorder (memory → memory) - within current visible subset
    // IMPORTANT: Must exclude "memory-folder-*" and "memory-all-bubble" to avoid catching folder/bubble drops
    if (activeIdStr.startsWith("memory-") && overIdStr.startsWith("memory-") && !overIdStr.startsWith("memory-folder-") && overIdStr !== "memory-all-bubble") {
      const draggedId = parseInt(activeIdStr.replace("memory-", ""));
      const targetId = parseInt(overIdStr.replace("memory-", ""));

      // Only proceed if both IDs are valid numbers (actual memory IDs)
      if (isNaN(draggedId) || isNaN(targetId)) return;

      const draggedMem = memories.find((m) => m.id === draggedId);
      const targetMem = memories.find((m) => m.id === targetId);

      if (!draggedMem || !targetMem) return;

      const isUnsorted = (folderName: string | null) => {
        if (folderName == null) return true;
        const trimmed = folderName.trim();
        return trimmed === "" || trimmed === "Unsorted";
      };

      // Determine the reorder subset:
      // - In "All" view: reorder ONLY unsorted memories
      // - In folder view: reorder ONLY memories in that folder
      const inSubset = (m: any) => {
        if (selectedMemoryFolder == null) return isUnsorted(m.folder_name ?? null);
        return (m.folder_name ?? "Unsorted") === selectedMemoryFolder;
      };

      if (!inSubset(draggedMem) || !inSubset(targetMem)) return;

      const subsetMemories = memories
        .filter(inSubset)
        .sort((a, b) => {
          const aPos = a.position ?? null;
          const bPos = b.position ?? null;
          if (aPos !== null && bPos !== null) return aPos - bPos;
          if (aPos !== null) return -1;
          if (bPos !== null) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

      const oldIndex = subsetMemories.findIndex((m) => m.id === draggedId);
      const newIndex = subsetMemories.findIndex((m) => m.id === targetId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(subsetMemories, oldIndex, newIndex);
      const updates = reordered.map((m, idx) => ({ id: m.id, position: idx }));
      handleMemoryReorder(updates);
      return;
    }

    // Case 5: Memory → Memory Folder (move memory to folder)
    if (activeIdStr.startsWith("memory-") && overIdStr.startsWith("memory-folder-")) {
      const memoryId = parseInt(activeIdStr.replace("memory-", ""));
      const folderId = parseInt(overIdStr.replace("memory-folder-", ""));

      if (handleMoveMemoryToFolder) {
        // handleMoveMemoryToFolder already calls loadMemories internally
        handleMoveMemoryToFolder(memoryId, folderId);
      }
      return;
    }

    // Case 5b: Memory → All Bubble (move memory to unsorted)
    if (activeIdStr.startsWith("memory-") && overIdStr === "memory-all-bubble") {
      const memoryId = parseInt(activeIdStr.replace("memory-", ""));

      if (handleMoveMemoryToFolder) {
        // Move to unsorted (folderId = null)
        handleMoveMemoryToFolder(memoryId, null);
      }
      return;
    }

    // Case 6: Memory → Chat Dropzone (attach memory to active chat)
    // Only accept memory IDs, reject folders, and only when overlay is closed
    if (activeIdStr.startsWith("memory-") && overIdStr === "chat-dropzone") {
      // Block attachment when memory overlay is open
      if (memoryOverlayOpen) {
        return;
      }
      
      // Double-check it's actually a memory ID, not a folder with similar prefix
      const memoryId = parseInt(activeIdStr.replace("memory-", ""));
      if (isNaN(memoryId)) {
        console.warn("[DND] Invalid memory ID from drag:", activeIdStr);
        return;
      }
      
      // Verify this is a real memory
      const isRealMemory = memories.some(m => m.id === memoryId);
      if (!isRealMemory) {
        console.warn("[DND] Dragged ID is not a valid memory:", memoryId);
        return;
      }
      
      if (activeSessionIdRef.current) {
        // attachMemoryToActiveSession is now async
        attachMemoryToActiveSession(memoryId).catch(console.error);
      } else {
        attachMemoryToLanding(memoryId);
      }
      return;
    }
  }, [
    removeFolderPointerListener,
    currentInsert,
    setActiveDragId,
    setDragOverlaySessionId,
    folders,
    sidebarSessions,
    selectedFolderId,
    memoryFolders,
    memories,
    selectedMemoryFolder,
    setFolders,
    setSelectedFolderId,
    setActiveSessionIdTraced,
    handleChatFolderReorder,
    handleFolderReorder,
    handleMoveSessionToFolder,
    handleReorderFolderSessions,
    handleMemoryReorder,
    handleMoveMemoryToFolder,
    attachMemoryToActiveSession,
    attachMemoryToLanding,
    activeSessionIdRef,
  ]);

  return {
    sensors,
    collisionDetection,
    modifiers: [clampSessionDragX],
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    currentOverId,
    currentInsert,
    dragOverlayMemoryId,
    memoryNodeMapRef,
  };
}
