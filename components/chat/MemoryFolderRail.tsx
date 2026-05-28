"use client";

import * as React from "react";
import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { devLog } from "@/lib/devLog";
import { HistoryIcon } from "@/components/icons/HistoryIcon";
import { DefaultFolderIcon } from "@/components/icons/DefaultFolderIcon";
import { UnsortedIcon } from "@/components/icons/UnsortedIcon";
import { FolderBubbleIconContent } from "@/components/chat/SessionFolderRail";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export type MemoryFolder = {
  id: number;
  name: string;
  icon?: string | null;
  importance: number | null;
  position: number | null;
  created_at: string;
  memory_count: number;
};

type MemoryFolderRailProps = {
  folders: MemoryFolder[];
  selectedFolder: string | null; // null = "All", string = folder name
  onFolderSelect: (folderName: string | null) => void;
  onToggleOverlay: () => void;
  overlayOpen: boolean;
  activeId: string | null;
  currentOverId?: string | null;
  currentInsert?: { list: "left" | "right"; index: number } | null;
  folderListContainerRef?: React.RefObject<HTMLDivElement | null>;
  onFolderReorder?: (updates: Array<{ id: number; position: number | null }>) => void;
  onCreateFolder?: () => void;
  onRenameFolder: (id: number, newName: string) => void;
  onDeleteFolder: (id: number) => void;
  onDeleteFolderAndMemories?: (id: number) => Promise<void> | void;
  onAttachAllMemories?: (folderName: string) => void;
  onSetFolderIcon?: (id: number, icon: string | null) => void;
  scopeKind?: string | null;
  /** Called when folderAppearance changes, so parent (e.g. DragOverlay) can use effective icon */
  onFolderAppearanceChange?: (appearance: Record<number, { label?: string; icon?: string; color?: string }>) => void;
  /** When true, suppress bubble enter/transition animations (signed-in initial load) */
  disableRailItemMotion?: boolean;
  /** Null/undefined = unlimited */
  maxFolders?: number | null;
};

const InsertLine = () => (
  <div
    className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-14 h-[2px] rounded-full bg-blue-400/90 z-20 -top-[5px]"
  />
);

interface SortableFolderBubbleProps {
  folder: MemoryFolder;
  isSelected: boolean;
  activeId: string | null;
  currentOverId?: string | null;
  isNew?: boolean;
  isDeleting?: boolean;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  displayLabel?: string;
  displayIcon?: string;
  displayColor?: string;
  disableMotion?: boolean;
}

function SortableFolderBubble({
  folder,
  isSelected,
  activeId,
  currentOverId = null,
  isNew = false,
  isDeleting = false,
  onSelect,
  onContextMenu,
  displayLabel,
  displayIcon,
  displayColor,
  disableMotion = false,
}: SortableFolderBubbleProps) {
  const isDraggingMemory = activeId?.startsWith("memory-");
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `memory-folder-${folder.id}`,
    disabled: isDraggingMemory,
  });

  const droppableId = `memory-folder-${folder.id}`;
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: droppableId,
  });

  // Unified hover contract: highlight ONLY when the parent DndContext reports we're truly "over" this droppable.
  const highlight = isDraggingMemory && currentOverId === droppableId;

  const verticalOnlyTransform = transform ? { ...transform, x: 0 } : null;
  const isDraggingFolder = activeId?.startsWith("memory-folder-");
  const isOverTarget = isDraggingFolder && currentOverId === droppableId && !isDragging;
  // Static insert-line: no transforms during folder drag (list stays fixed)
  const effectiveTransform = isDraggingFolder ? null : (isDraggingMemory ? transform : verticalOnlyTransform);

  const style: React.CSSProperties = {
    transform: effectiveTransform ? CSS.Transform.toString(effectiveTransform) : "none",
    transition: disableMotion ? "none" : isDraggingFolder ? "none" : (transition ?? "transform 200ms cubic-bezier(0.25, 1, 0.5, 1), opacity 200ms ease-out"),
    opacity: isDeleting ? 0 : isDragging ? 0.35 : isDraggingFolder ? 1 : 1,
    animation: undefined,
    backgroundColor: "#1F2937",
    width: "2.5rem",
    height: "2.5rem",
  };
  if (isDeleting) {
    style.transform = "scale(0.95) translateY(-2px)";
    style.transition = "opacity 200ms ease-out, transform 200ms ease-out";
  }

  const rawLabel = (displayLabel ?? folder.name ?? "").toString();
  const label = rawLabel.trim().slice(0, 3).toUpperCase();
  const labelLen = label.length;
  const hasTextLabel = labelLen > 0;
  const labelClass =
    labelLen <= 1
      ? "text-sm font-semibold"
      : labelLen === 2
      ? "text-[12px] font-semibold tracking-tight"
      : "text-[10px] font-semibold tracking-tight";

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDroppableRef(node);
      }}
      style={style}
      data-memory-bubble="true"
      data-droppable-id={droppableId}
      className={`relative overflow-hidden group w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer ${activeId ? '' : 'transition-[colors,border-color] duration-150'} select-none focus:outline-none focus-visible:outline-none border ring-0 ${
        isDraggingFolder
          ? "text-gray-200 hover:bg-gray-700/50 border-transparent"
          : isSelected
          ? "text-gray-100 border-blue-500/30"
          : highlight
          ? "text-gray-100 border-transparent"
          : "text-gray-200 hover:bg-gray-700/50 border-transparent"
      }`}
      {...(isDraggingMemory ? {} : { ...attributes, ...listeners })}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={folder.name}
    >
      {!isDraggingFolder && (isSelected || highlight || isOverTarget) && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${
            isSelected ? "bg-blue-500/10" : isOverTarget ? "bg-blue-400/5" : "bg-blue-500/15"
          }`}
        />
      )}
      {/* Single shared icon renderer — same for idle and drag (ghost + overlay) */}
      <FolderBubbleIconContent displayIcon={displayIcon} displayColor={displayColor} />
    </div>
  );
}

interface AllBubbleProps {
  isSelected: boolean;
  activeId: string | null;
  currentOverId?: string | null;
  onSelect: () => void;
}

function AllBubble({
  isSelected,
  activeId,
  currentOverId = null,
  onSelect,
}: AllBubbleProps) {
  const isDraggingMemory = activeId?.startsWith("memory-");
  
  const { setNodeRef } = useDroppable({
    id: "memory-all-bubble",
  });

  const droppableId = "memory-all-bubble";
  // Unified hover contract: highlight ONLY when the parent DndContext reports we're truly "over" this droppable.
  const highlight = isDraggingMemory && currentOverId === droppableId;

  const style: React.CSSProperties = {
    backgroundColor: "#1F2937",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative overflow-hidden group w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer ${activeId ? '' : 'transition-[colors,border-color] duration-150'} select-none focus:outline-none focus-visible:outline-none border ring-0 ${
        isSelected
          ? "text-gray-100 border-blue-500/30"
          : highlight
          ? "text-gray-100 border-transparent"
          : "text-gray-200 hover:bg-gray-700/50 border-transparent"
      }`}
      onClick={onSelect}
      title="All memories"
    >
      {(isSelected || highlight) && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${
            isSelected ? "bg-blue-500/10" : "bg-blue-500/15"
          }`}
        />
      )}
      <UnsortedIcon className="w-8 h-8" style={{ transform: 'translateY(2px) translateX(-1px)' }} />
    </div>
  );
}

export function MemoryFolderRail({
  folders,
  selectedFolder,
  onFolderSelect,
  onToggleOverlay,
  overlayOpen,
  activeId,
  currentOverId = null,
  currentInsert = null,
  folderListContainerRef,
  onFolderReorder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteFolderAndMemories,
  onAttachAllMemories,
  onSetFolderIcon,
  scopeKind = null,
  onFolderAppearanceChange,
  disableRailItemMotion = false,
  maxFolders: maxFoldersProp = null,
}: MemoryFolderRailProps) {
  const router = useRouter();
  const maxFolders =
    typeof maxFoldersProp === "number" && Number.isFinite(maxFoldersProp)
      ? Math.max(1, Math.floor(maxFoldersProp))
      : Number.POSITIVE_INFINITY;
  const atFolderLimit = Number.isFinite(maxFolders) && folders.length >= maxFolders;

  // Sort folders by position. Preserve array order (append order) when both have null position.
  const sortedFolders = [...folders].sort((a, b) => {
    const aPos = a.position ?? null;
    const bPos = b.position ?? null;
    if (aPos !== null && bPos !== null) {
      return aPos - bPos;
    }
    if (aPos !== null) return -1;
    if (bPos !== null) return 1;
    return 0;
  });

  const folderIds = sortedFolders.map((f) => `memory-folder-${f.id}`);
  
  // Scroll ref for folders area (matches SessionFolderRail)
  const foldersScrollRef = useRef<HTMLDivElement | null>(null);

  // Mirror SessionFolderRail: detect newly added folder + scroll to bottom + animate "+" position shifts.
  const [newFolderId, setNewFolderId] = useState<number | null>(null);
  const [deletingFolderIds, setDeletingFolderIds] = useState<Set<number>>(new Set());
  const prevFolderIdsRef = useRef<number[]>(folders.map((f) => f.id));
  const deleteFallbackTimeoutsRef = useRef<Map<number, number>>(new Map());
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevPlusTopRef = useRef<number | null>(null);
  const deleteInProgressRef = useRef(false);
  const allowPlusFlipRef = useRef(false);


  // Local, low-risk appearance overrides
  const FOLDER_APPEARANCE_LS_KEY = "dartboard.memoryFolderAppearance.v1";
  const isGuestScope = scopeKind === "guest";
  const folderAppearanceStorageKey =
    isGuestScope
      ? `${FOLDER_APPEARANCE_LS_KEY}:guest`
      : FOLDER_APPEARANCE_LS_KEY;

  const loadFolderAppearance = (): Record<number, { label?: string; icon?: string; color?: string }> => {
    if (typeof window === "undefined") return {};
    try {
      const storage = isGuestScope ? window.sessionStorage : window.localStorage;
      const raw = storage.getItem(folderAppearanceStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      // Ensure numeric keys (stored as strings in JSON)
      const out: Record<number, { label?: string; icon?: string; color?: string }> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (!Number.isFinite(id)) continue;
        if (v && typeof v === "object") out[id] = v as any;
      }
      return out;
    } catch {
      return {};
    }
  };

  const [folderAppearance, setFolderAppearance] = useState<Record<number, { label?: string; icon?: string; color?: string }>>(
    () => loadFolderAppearance()
  );

  // Sync folder icons from database into folderAppearance state
  useEffect(() => {
    setFolderAppearance((prev) => {
      const updatedAppearance = { ...prev };
      let hasChanges = false;

      folders.forEach((folder) => {
        // Always sync DB icon for memory folders to ensure DB is source of truth
        const dbIcon = folder.icon ?? undefined; // Convert null to undefined for consistency

        // If current appearance doesn't match DB, update it
        if (updatedAppearance[folder.id]?.icon !== dbIcon) {
          if (dbIcon === undefined) {
            // DB has no icon, remove any icon from appearance
            if (updatedAppearance[folder.id]) {
              const { icon, ...rest } = updatedAppearance[folder.id];
              if (Object.keys(rest).length > 0) {
                updatedAppearance[folder.id] = rest;
              } else {
                delete updatedAppearance[folder.id];
              }
              hasChanges = true;
            }
          } else {
            // DB has an icon, ensure it's set in appearance
            updatedAppearance[folder.id] = {
              ...updatedAppearance[folder.id],
              icon: dbIcon,
            };
            hasChanges = true;
          }
        }
      });

      return hasChanges ? updatedAppearance : prev;
    });
  }, [folders]); // Run when folders change

  useEffect(() => {
    onFolderAppearanceChange?.(folderAppearance);
  }, [folderAppearance, onFolderAppearanceChange]);

  const foldersLoadedRef = useRef(false);

  // Switch storage scope when auth mode changes (guest uses sessionStorage; user uses localStorage).
  useEffect(() => {
    setFolderAppearance(loadFolderAppearance());
    foldersLoadedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuestScope]);

  // Context menu state
  const [menu, setMenu] = useState<{ open: boolean; folderId: number | null; x: number; y: number; anchorX: number; anchorY: number }>({
    open: false,
    folderId: null,
    x: 0,
    y: 0,
    anchorX: 0,
    anchorY: 0,
  });

  const menuRef = useRef<HTMLDivElement | null>(null);

  const [subMenu, setSubMenu] = useState<{
    open: boolean;
    kind: "icons";
    folderId: number | null;
    x: number;
    y: number;
  }>({ open: false, kind: "icons", folderId: null, x: 0, y: 0 });

  const subMenuRef = useRef<HTMLDivElement | null>(null);

  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Focus and select input when entering rename mode
  useEffect(() => {
    if (renamingFolderId !== null) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [renamingFolderId]);

  const closeMenu = () => {
    setMenu({ open: false, folderId: null, x: 0, y: 0, anchorX: 0, anchorY: 0 });
    setSubMenu({ open: false, kind: "icons", folderId: null, x: 0, y: 0 });
    setRenamingFolderId(null);
    setRenameDraft("");
  };

  // Store raw click point for right-edge anchoring
  const openMenu = (folderId: number, x: number, y: number) => {
    setSubMenu({ open: false, kind: "icons", folderId: null, x: 0, y: 0 });
    setRenamingFolderId(null);
    setRenameDraft("");
    setMenu({ open: true, folderId, x: 0, y: 0, anchorX: x, anchorY: y });
  };

  const handleResetAppearance = (folderId: number) => {
    setFolderAppearance((prev) => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });
  };

  const DELETE_ANIMATION_MS = 200;
  const DELETE_FALLBACK_MS = 2500;
  const scheduleDeleteFolder = (id: number, doDelete: () => void) => {
    closeMenu();
    allowPlusFlipRef.current = true;
    deleteInProgressRef.current = true;
    setDeletingFolderIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      handleResetAppearance(id);
      doDelete();
      const existingTimeout = deleteFallbackTimeoutsRef.current.get(id);
      if (existingTimeout !== undefined) {
        window.clearTimeout(existingTimeout);
      }
      const timeoutId = window.setTimeout(() => {
        setDeletingFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        deleteFallbackTimeoutsRef.current.delete(id);
      }, DELETE_FALLBACK_MS);
      deleteFallbackTimeoutsRef.current.set(id, timeoutId);
    }, DELETE_ANIMATION_MS);
  };

  useEffect(() => {
    const folderIds = new Set(folders.map((f) => f.id));
    setDeletingFolderIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!folderIds.has(id)) {
          changed = true;
          next.delete(id);
          const timeoutId = deleteFallbackTimeoutsRef.current.get(id);
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            deleteFallbackTimeoutsRef.current.delete(id);
          }
        }
      }
      return changed ? next : prev;
    });
  }, [folders]);

  useEffect(() => {
    const fallbackTimeouts = deleteFallbackTimeoutsRef.current;
    return () => {
      for (const timeoutId of fallbackTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      fallbackTimeouts.clear();
    };
  }, []);

  // Event listeners for menu closing
  useEffect(() => {
    if (!menu.open && !subMenu.open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (subMenu.open) setSubMenu({ open: false, kind: "icons", folderId: null, x: 0, y: 0 });
        if (menu.open) closeMenu();
      }
    };

    const isInsideMenu = (target: EventTarget | null) => {
      const menuEl = menuRef.current;
      const subMenuEl = subMenuRef.current;
      return !!(
        target instanceof Node &&
        ((menuEl && menuEl.contains(target)) || (subMenuEl && subMenuEl.contains(target)))
      );
    };

    const onContextMenuAnywhere = (e: MouseEvent) => {
      if (e.target instanceof Element) {
        if (e.target.closest('[data-memory-bubble="true"]')) return;
      }
      if (menu.open && !isInsideMenu(e.target)) {
        closeMenu();
      }
    };

    const onPointerDownAnywhere = (e: PointerEvent) => {
      if (e.target instanceof Element) {
        if (e.target.closest('[data-memory-bubble="true"]')) return;
      }
      if (menu.open && !isInsideMenu(e.target)) {
        closeMenu();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("contextmenu", onContextMenuAnywhere);
    document.addEventListener("pointerdown", onPointerDownAnywhere, { capture: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("contextmenu", onContextMenuAnywhere);
      document.removeEventListener("pointerdown", onPointerDownAnywhere, { capture: true } as any);
    };
  }, [menu.open, subMenu.open]);

  // Right-edge anchor: menu's right edge aligns with cursor, expands left/down
  useLayoutEffect(() => {
    if (!menu.open) return;
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 8;

    // Calculate position: anchor to cursor's top-right (menu's right edge = cursor.x)
    let nextX = menu.anchorX - rect.width - 4;
    let nextY = menu.anchorY + 4;

    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;

    // Clamp left edge (menu extends left from cursor)
    if (nextX < pad) nextX = pad;
    // Clamp right edge (fallback: if too wide, align to right edge)
    if (nextX + rect.width > window.innerWidth - pad) nextX = Math.max(pad, maxX);
    // Clamp bottom edge
    if (nextY + rect.height > window.innerHeight - pad) nextY = Math.max(pad, maxY);
    // Clamp top edge
    if (nextY < pad) nextY = pad;

    if (nextX !== menu.x || nextY !== menu.y) {
      setMenu((prev) => ({ ...prev, x: nextX, y: nextY }));
    }
  }, [menu.open, menu.anchorX, menu.anchorY, menu.x, menu.y]);

  // MIRRORED: Submenu positioning (to left of main menu)
  useLayoutEffect(() => {
    if (!subMenu.open) return;
    const el = subMenuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 8;

    let nextX = subMenu.x;
    let nextY = subMenu.y;

    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;

    const actualTop = nextY - (rect.height / 2);

    // MIRRORED: Clamp left side (submenu extends left)
    if (rect.left < pad) nextX = pad;
    if (actualTop < pad) nextY = pad + (rect.height / 2);
    if (actualTop + rect.height > window.innerHeight - pad) nextY = window.innerHeight - pad - (rect.height / 2);
    if (rect.right > window.innerWidth - pad) nextX = Math.max(pad, maxX);

    if (nextX !== subMenu.x || nextY !== subMenu.y) {
      setSubMenu((prev) => ({ ...prev, x: nextX, y: nextY }));
    }
  }, [subMenu.open, subMenu.x, subMenu.y]);

  // Persist appearance overrides (guest -> sessionStorage, user -> localStorage)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storage = isGuestScope ? window.sessionStorage : window.localStorage;
      const serialized = JSON.stringify(folderAppearance);
      const existing = storage.getItem(folderAppearanceStorageKey);
      if (serialized !== existing) {
        storage.setItem(folderAppearanceStorageKey, serialized);
      }
    } catch {
      // ignore quota / private mode
    }
  }, [folderAppearance, isGuestScope, folderAppearanceStorageKey]);

  // Prune overrides for folders that no longer exist
  useEffect(() => {
    if (folders.length === 0) {
      if (foldersLoadedRef.current) {
        // Folders were loaded before but now empty - this is intentional (all deleted)
      } else {
        // Initial mount - folders not loaded yet, skip pruning
        return;
      }
    } else {
      foldersLoadedRef.current = true;
    }
    
    const validIds = new Set(folders.map((f) => f.id));
    
    setFolderAppearance((prev) => {
      let changed = false;
      const next: Record<number, { label?: string; icon?: string; color?: string }> = {};
      
      for (const [k, v] of Object.entries(prev)) {
        const id = Number(k);
        if (validIds.has(id)) {
          next[id] = v as any;
        } else {
          changed = true;
        }
      }
      
      return changed ? next : prev;
    });
  }, [folders, folderAppearance]);

  // Detect newly added folder (mirrors SessionFolderRail)
  // IMPORTANT: Never mark a folder as "new" during initial hydration/refresh.
  // On refresh, folders can populate in phases (empty -> cached -> API). If we set
  // `newFolderId` while `disableRailItemMotion` is true, it can "arm" the fade-in
  // and then blink once motion re-enables. So we only run the "new" animation when
  // motion is enabled and the list was already established.
  useEffect(() => {
    const currentIds = folders.map((f) => f.id);

    // During signed-in hydration/restore we suppress animations; also reset baseline so
    // we don't carry a pending `newFolderId` into the first animated frame.
    if (disableRailItemMotion) {
      setNewFolderId(null);
      prevFolderIdsRef.current = currentIds;
      return;
    }

    const prevIds = prevFolderIdsRef.current;

    // First non-hydration run: establish baseline only (no "new" folder animation)
    if (prevIds.length === 0 && currentIds.length > 0) {
      prevFolderIdsRef.current = currentIds;
      return;
    }

    const added = currentIds.filter((id) => !prevIds.includes(id));
    if (added.length > 0) {
      // Only treat as a user-create when exactly one folder was appended.
      if (added.length === 1 && prevIds.length + 1 === currentIds.length) {
        allowPlusFlipRef.current = true;
      }
      const id = added[added.length - 1];
      setNewFolderId(id);
      window.setTimeout(() => {
        setNewFolderId((cur) => (cur === id ? null : cur));
      }, 320);
    }

    prevFolderIdsRef.current = currentIds;
  }, [folders, disableRailItemMotion]);

  // Auto-scroll to bottom when a new folder is created (mirrors SessionFolderRail)
  useEffect(() => {
    if (newFolderId !== null && foldersScrollRef.current) {
      foldersScrollRef.current.scrollTo({
        top: foldersScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [newFolderId]);

  // FLIP-ish slide animation for the + button when layout shifts (mirrors SessionFolderRail).
  // Only run after explicit user events (create/delete), never during hydration/API overwrite.
  useLayoutEffect(() => {
    const btn = plusBtnRef.current;
    if (!btn) return;

    if (disableRailItemMotion) {
      prevPlusTopRef.current = btn.getBoundingClientRect().top;
      return;
    }

    if (!allowPlusFlipRef.current) {
      prevPlusTopRef.current = btn.getBoundingClientRect().top;
      return;
    }
    allowPlusFlipRef.current = false;

    if (deleteInProgressRef.current) {
      deleteInProgressRef.current = false;
      prevPlusTopRef.current = btn.getBoundingClientRect().top;
      return;
    }

    const rect = btn.getBoundingClientRect();
    const nextTop = rect.top;
    const prevTop = prevPlusTopRef.current;

    if (prevTop !== null) {
      const delta = prevTop - nextTop;
      if (Math.abs(delta) > 0.5) {
        btn.style.transition = "none";
        btn.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          btn.style.transition = "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)";
          btn.style.transform = "translateY(0px)";
        });
      }
    }

    prevPlusTopRef.current = nextTop;
  }, [folders.length, disableRailItemMotion]);

  return (
    <div 
      className="w-[72px] flex-shrink-0 flex flex-col items-center h-full py-3 px-2 relative border-l border-gray-700/50"
      style={{ background: "linear-gradient(180deg, #111827 0%, #0B1220 100%)" }}
    >
      {/* Archive button (top) */}
      <button
        type="button"
        onClick={() => router.push("/archive")}
        className="relative w-10 h-10 rounded-2xl flex items-center justify-center mb-2 select-none bg-gradient-to-b from-slate-800/80 to-slate-900/90 text-gray-200 hover:from-slate-700/70 hover:to-slate-900/90 border border-blue-500/25 hover:border-blue-400/35 transition-colors shadow-[0_0_0_1px_rgba(59,130,246,0.15)] cursor-pointer"
        title="Archive"
        aria-label="Archive"
      >
        <HistoryIcon className="h-7 w-7 text-blue-400" style={{ filter: 'drop-shadow(0 0 2px rgba(59, 130, 246, 0.8)) drop-shadow(0 0 4px rgba(59, 130, 246, 0.4))' }} />
      </button>

      {/* Divider between VaultIcon and All */}
      <div className="w-6 h-px bg-gray-700/60 my-2" />

      {/* All button */}
      <div className="relative w-full flex justify-center group">
        <div
          className={
            "pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-1 h-7 rounded-l-full bg-blue-400/80 " +
            "origin-center transform-gpu transition-[transform,opacity] duration-250 ease-out " +
            (selectedFolder === null
              ? "opacity-100 scale-y-100"
              : "opacity-0 scale-y-0 group-hover:opacity-70 group-hover:scale-y-50")
          }
        />
        <AllBubble
          isSelected={selectedFolder === null}
          activeId={activeId}
          currentOverId={currentOverId}
          onSelect={() => onFolderSelect(null)}
        />
      </div>

      {/* Divider between All and folders */}
      <div className="w-8 h-px bg-gray-700/60 my-2" />

      {/* Folders area: scroll lane + pinned plus (matches SessionFolderRail structure) */}
      <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
        {/* Scroll lane (ONLY folders) - ref used for rail-wide drop-zone tracking */}
        <div
          ref={(el) => {
            (foldersScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            if (folderListContainerRef && "current" in folderListContainerRef) {
              (folderListContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }
          }}
          className="db-scroll-lane flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full"
        >
          {/* Bubble stack (folders + + bubble) */}
          <div className="w-full flex flex-col items-center gap-2 pt-1 pb-2">
            <SortableContext items={folderIds} strategy={verticalListSortingStrategy}>
              {sortedFolders.map((folder, i) => {
                const isSelected = selectedFolder === folder.name;
                const droppableId = `memory-folder-${folder.id}`;
                const isOverTarget = activeId?.startsWith("memory-folder-") && currentOverId === droppableId;
                const isDeleting = deletingFolderIds.has(folder.id);
                const isDraggingFolder = activeId?.startsWith("memory-folder-");
                const showLineAbove = isDraggingFolder && currentInsert?.list === "right" && currentInsert?.index === i;
                return (
                  <div
                    key={`memory-folder-${folder.id}`}
                    className={`relative w-full flex justify-center group ${disableRailItemMotion ? "!transition-none !duration-0 !animate-none" : "transition-transform duration-200 ease-out"}`}
                    style={{
                      maxHeight: isDeleting ? 0 : 56,
                      overflow: isDeleting ? "hidden" : "visible",
                      opacity: isDeleting ? 0 : 1,
                      transition: disableRailItemMotion ? "none" : "max-height 200ms ease-out, opacity 200ms ease-out",
                    }}
                  >
                    {showLineAbove && <InsertLine />}
                    {/* Selection bar on the outside RIGHT edge - fully hidden during folder drag */}
                    {!isDraggingFolder && (
                      <div
                        className={
                          "pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-1 h-7 rounded-l-full bg-blue-400/80 " +
                          "origin-center transform-gpu transition-[transform,opacity] duration-250 ease-out " +
                          (isSelected ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0 group-hover:opacity-70 group-hover:scale-y-50")
                        }
                      />
                    )}
                    <SortableFolderBubble
                      folder={folder}
                      isSelected={isSelected}
                      activeId={activeId}
                      currentOverId={currentOverId}
                      isNew={newFolderId === folder.id}
                      isDeleting={isDeleting}
                      disableMotion={disableRailItemMotion}
                      displayLabel={folderAppearance[folder.id]?.label}
                      displayIcon={folderAppearance[folder.id]?.icon ?? folder.icon ?? undefined}
                      displayColor={folderAppearance[folder.id]?.color}
                      onSelect={() => onFolderSelect(folder.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openMenu(folder.id, e.clientX, e.clientY);
                      }}
                    />
                  </div>
                );
              })}
            </SortableContext>

            {/* Insertion line after last folder (slot index === len) */}
            {activeId?.startsWith("memory-folder-") && currentInsert?.list === "right" && currentInsert?.index === sortedFolders.length && (
              <div className="relative w-full flex justify-center min-h-[12px]">
                <InsertLine />
              </div>
            )}

            {/* + bubble as the last item in the scroll stack (matches left rail behavior) */}
            {onCreateFolder && !atFolderLimit && (
              <div className="relative w-full flex justify-center transition-transform duration-200 ease-out">
                <button
                  ref={plusBtnRef}
                  onClick={
                    onCreateFolder
                      ? () => {
                          allowPlusFlipRef.current = true;
                          onCreateFolder();
                        }
                      : undefined
                  }
                  disabled={atFolderLimit}
                  className="relative w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer transition-all text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  title={
                    atFolderLimit
                      ? `Folder limit reached (${maxFolders})`
                      : "Create memory folder"
                  }
                  type="button"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context menu overlay backdrop */}
      {(menu.open || subMenu.open) &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] bg-transparent pointer-events-none"
            aria-hidden="true"
          />,
          document.body
        )}

      {/* Context menu */}
      {menu.open && menu.folderId !== null &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[61] w-44 rounded-lg border border-slate-700/35 bg-[#0f1320] shadow-[0_10px_24px_rgba(0,0,0,0.38)] p-1 backdrop-blur"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            {/* Top row: folder name + inline rename */}
            {(() => {
              const id = menu.folderId!;
              const folder = sortedFolders.find((f) => f.id === id);
              const folderName = folder?.name ?? "Folder";
              const isRenaming = renamingFolderId === id;

              const commitRename = () => {
                const trimmed = renameDraft.trim();
                if (trimmed && onRenameFolder) {
                  onRenameFolder(id, trimmed);
                }
                setRenamingFolderId(null);
                setRenameDraft("");
              };

              const cancelRename = () => {
                setRenamingFolderId(null);
                setRenameDraft("");
              };

              return (
                <div className="py-1" onClick={(e) => e.stopPropagation()}>
                  {!isRenaming ? (
                    <button
                      type="button"
                      className="group w-full flex items-center text-left text-[12px] text-gray-200 hover:bg-gray-700/50 rounded-md px-2 py-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingFolderId(id);
                        setRenameDraft(folderName);
                      }}
                      title="Rename folder"
                    >
                      <span className="truncate flex-1 min-w-0">{folderName}</span>
                      {/* pencil (hover only) */}
                      <span className="flex items-center text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <path
                            d="M12 20h9"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </button>
                  ) : (
                    <div className="w-full flex items-center px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") commitRename();
                          else if (e.key === "Escape") cancelRename();
                        }}
                        className="flex-1 min-w-0 h-7 px-2 text-[12px] bg-slate-800/35 border border-slate-600/45 rounded-md text-gray-200 focus:outline-none focus:border-blue-500/50"
                        autoFocus
                      />
                      <div className="ml-1 flex items-center gap-1 shrink-0">
                        {/* Save (tiny icon only) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            commitRename();
                          }}
                          className="p-0 text-green-300 hover:text-green-200"
                          title="Save"
                          aria-label="Save"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <path
                              d="M20 6L9 17l-5-5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {/* Cancel (tiny icon only) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRename();
                          }}
                          className="p-0 text-red-300 hover:text-red-200"
                          title="Cancel"
                          aria-label="Cancel"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <path
                              d="M18 6L6 18M6 6l12 12"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Divider between rename row and Icon button */}
            <div className="my-1 h-px bg-slate-800/70" />

            <button
              className="w-full text-left px-2 py-1.5 text-[12px] text-gray-200 hover:bg-slate-800/45 rounded-md flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation();
                if (menuRef.current) {
                  const menuRect = menuRef.current.getBoundingClientRect();
                  // Toggle submenu if clicking the same button
                  const sameTarget = subMenu.open && subMenu.folderId === menu.folderId && subMenu.kind === "icons";
                  if (sameTarget) {
                    setSubMenu({ open: false, kind: "icons", folderId: null, x: 0, y: 0 });
                  } else {
                    // MIRRORED: Position to LEFT of main menu
                    setSubMenu({
                      open: true,
                      kind: "icons",
                      folderId: menu.folderId,
                      x: menuRect.left - 228 - 4, // 228px is submenu width, 4px gap
                      y: menuRect.top + (menuRect.height / 2),
                    });
                    devLog("[MEMORY_RAIL] submenu open", { menuFolderId: menu.folderId, subMenuFolderId: menu.folderId });
                  }
                }
              }}
              type="button"
            >
              <span className="text-gray-400">‹</span>
              <span>Icon</span>
            </button>

            <div className="my-1 h-px bg-slate-800/70" />

            <button
              className="w-full text-left px-2 py-1.5 text-[12px] text-gray-200 hover:bg-slate-800/45 rounded-md flex items-center gap-2"
              onClick={() => {
                const folder = sortedFolders.find(f => f.id === menu.folderId);
                if (folder && onAttachAllMemories) {
                  onAttachAllMemories(folder.name);
                }
                closeMenu();
              }}
              type="button"
            >
              <span className="text-gray-400">+</span>
              <span>Attach all memories</span>
            </button>

            <div className="my-1 h-px bg-slate-800/70" />

            <button
              className="w-full text-left px-2 py-1.5 text-[12px] text-red-300 hover:bg-red-500/15 rounded-md"
              onClick={() => {
                const id = menu.folderId!;
                scheduleDeleteFolder(id, () => onDeleteFolder(id));
              }}
              type="button"
            >
              Delete folder
            </button>

            <button
              className="w-full text-left px-2 py-1.5 text-[12px] text-red-300 hover:bg-red-500/15 rounded-md"
              onClick={() => {
                const id = menu.folderId!;
                scheduleDeleteFolder(id, () => {
                  if (onDeleteFolderAndMemories) {
                    onDeleteFolderAndMemories(id);
                  } else {
                    onDeleteFolder(id);
                  }
                });
              }}
              type="button"
            >
              Delete folder + memories
            </button>
          </div>,
          document.body
        )}

      {/* Submenu panel */}
      {subMenu.open && subMenu.folderId === menu.folderId &&
        createPortal(
          <div
            ref={subMenuRef}
            className="fixed z-[62] w-[228px] rounded-xl border border-slate-700/45 bg-[#0f1320] shadow-[0_12px_28px_rgba(0,0,0,0.45)] p-2 backdrop-blur"
            style={{ left: subMenu.x, top: subMenu.y, transform: 'translateY(-50%)' }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            {subMenu.kind === "icons" && (
              (() => {
                const currentIcon = folderAppearance[subMenu.folderId!]?.icon;

                const btnBase =
                  "w-11 h-11 rounded-lg border flex items-center justify-center transition-all " +
                  "bg-slate-900/25 border-slate-700/45 " +
                  "hover:bg-slate-800/35 hover:border-slate-600/60 " +
                  "active:scale-[0.98]";

                const btnSelected =
                  " ring-1 ring-blue-400/60 bg-slate-800/45 border-slate-600/70";

                const iconSvgStyle: React.CSSProperties = {
                  filter: "drop-shadow(0 0 2px rgba(255, 255, 255, 0.25))",
                };

                return (
                  <>
                    <div className="px-2 pt-1 pb-2">
                      <div className="text-[11px] font-medium text-gray-200">Pick an icon</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">Applies to this folder bubble</div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 px-1 pb-1">
                      {/* Folder icon (default) */}
                      <button
                        key="folder"
                        type="button"
                        aria-pressed={currentIcon == null}
                        className={btnBase + (currentIcon == null ? btnSelected : "")}
                        onClick={() => {
                          const icon: string | null = null;
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, null);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Folder"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 1200 1200"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" opacity="1.000000" stroke="none" d="M817.000000,950.995789 C854.999878,950.995239 892.499695,950.996277 929.999573,950.993408 C951.708069,950.991760 965.709473,941.704041 973.926025,921.440369 C1002.947144,849.868652 1031.886963,778.263977 1060.842651,706.665710 C1075.594360,670.189209 1090.282349,633.686951 1105.085693,597.231445 C1107.081177,592.317261 1107.393677,587.568604 1105.121704,582.771667 C1102.490601,577.216614 1098.180298,573.935791 1091.916870,573.597351 C1089.592041,573.471741 1087.255859,573.554077 1084.924805,573.554077 C866.259033,573.552917 647.593140,573.600342 428.927460,573.447815 C414.120087,573.437500 400.731354,576.547302 391.681152,588.678345 C386.546906,595.560425 383.263672,604.011108 380.089844,612.124268 C375.253204,624.487793 371.273834,637.185181 366.858185,649.715332 C360.794189,666.922974 345.771515,677.060181 328.124420,675.939453 C312.043732,674.918274 297.900269,662.894836 294.528870,646.526062 C293.481232,641.439575 292.931549,635.506104 294.518005,630.748718 C301.865875,608.714355 308.135834,586.018799 318.321350,565.294739 C340.119110,520.943970 377.185425,498.750854 426.705383,498.613281 C514.204407,498.370209 601.704529,498.543884 689.204224,498.543518 C822.037048,498.542969 954.869812,498.581299 1087.702637,498.517517 C1124.573364,498.499817 1152.667725,514.042175 1170.542236,546.232849 C1184.305054,571.018616 1185.753174,597.388184 1175.136597,623.759949 C1131.604858,731.891968 1087.756348,839.896362 1044.150513,947.998596 C1029.896851,983.334534 1005.707214,1008.427002 969.129944,1020.046021 C957.902771,1023.612305 945.701172,1025.745605 933.942078,1025.761475 C694.443420,1026.083984 454.944244,1026.035767 215.445175,1025.970703 C175.819870,1025.959961 143.722321,1010.451843 120.702980,977.827515 C106.749985,958.052612 100.957596,935.629089 100.968536,911.504211 C101.029694,776.671387 100.997757,641.838562 100.998558,507.005768 C100.998634,494.339172 100.936218,481.672089 101.024231,469.006104 C101.172462,447.674408 117.717293,430.950958 138.507233,431.007904 C159.492905,431.065430 175.952103,447.561218 175.960876,469.006958 C176.021225,616.673035 176.009354,764.339111 175.981140,912.005188 C175.978363,926.561035 180.946899,938.642212 194.021164,945.808228 C199.226944,948.661499 205.582626,949.595764 211.532700,950.840027 C214.728806,951.508423 218.174652,950.994019 221.507812,950.994019 C419.838531,950.995911 618.169250,950.995789 817.000000,950.995789 z" />
                          <path fill="currentColor" opacity="1.000000" stroke="none" d="M725.000000,300.998413 C796.485962,300.998352 867.472290,300.847687 938.457642,301.063232 C972.725281,301.167297 1001.734192,313.825287 1024.231201,339.939117 C1042.565674,361.221069 1051.116211,386.333649 1050.939575,414.335876 C1050.812378,434.516785 1033.944824,450.897522 1013.672607,450.997009 C993.443359,451.096283 976.598694,434.856903 976.006287,414.684143 C975.282410,390.033936 960.860901,376.001312 936.209595,376.000397 C812.900696,375.995728 689.591797,375.963593 566.282959,376.059418 C555.278687,376.067963 545.909424,372.772095 537.471924,365.673157 C498.098694,332.546082 458.476929,299.713837 419.177429,266.499969 C406.723358,255.974426 392.624359,251.019241 376.563995,251.012299 C322.574707,250.988968 268.585388,250.983047 214.596100,251.008453 C191.082733,251.019516 176.028763,266.222137 176.002289,289.883118 C175.988861,301.880737 176.049576,313.878632 175.985962,325.875916 C175.874969,346.810455 159.294205,363.460663 138.651093,363.445618 C117.828712,363.430420 101.095154,347.058594 101.073723,326.156219 C101.056145,309.010498 100.661629,291.785126 102.088593,274.733490 C105.921967,228.926010 141.426956,189.021790 186.556702,179.256882 C195.913177,177.232376 205.660172,176.193588 215.235641,176.137192 C266.057129,175.837814 316.891632,176.626968 367.701385,175.798767 C408.994049,175.125671 444.257263,187.856491 475.273895,215.415054 C507.621643,244.156403 541.472717,271.207825 574.783386,298.857391 C576.465271,300.253357 579.253113,300.905914 581.528320,300.911407 C629.185364,301.026642 676.842712,300.998413 725.000000,300.998413 z" />
                        </svg>
                      </button>

                      {/* Heart icon */}
                      <button
                        key="heart"
                        type="button"
                        aria-pressed={currentIcon === "heart"}
                        className={btnBase + (currentIcon === "heart" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "heart";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Heart"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M8.96173 18.9109L9.42605 18.3219L8.96173 18.9109ZM12 5.50063L11.4596 6.02073C11.463 6.02421 11.4664 6.02765 11.4698 6.03106L12 5.50063ZM15.0383 18.9109L15.5026 19.4999L15.0383 18.9109ZM13.4698 8.03034C13.7627 8.32318 14.2376 8.32309 14.5304 8.03014C14.8233 7.7372 14.8232 7.26232 14.5302 6.96948L13.4698 8.03034ZM9.42605 18.3219C7.91039 17.1271 6.25307 15.9603 4.93829 14.4798C3.64922 13.0282 2.75 11.3345 2.75 9.1371H1.25C1.25 11.8026 2.3605 13.8361 3.81672 15.4758C5.24723 17.0866 7.07077 18.3752 8.49742 19.4999L9.42605 18.3219ZM2.75 9.1371C2.75 6.98623 3.96537 5.18252 5.62436 4.42419C7.23607 3.68748 9.40166 3.88258 11.4596 6.02073L12.5404 4.98053C10.0985 2.44352 7.26409 2.02539 5.00076 3.05996C2.78471 4.07292 1.25 6.42503 1.25 9.1371H2.75ZM8.49742 19.4999C9.00965 19.9037 9.55954 20.3343 10.1168 20.6599C10.6739 20.9854 11.3096 21.25 12 21.25V19.75C11.6904 19.75 11.3261 19.6293 10.8736 19.3648C10.4213 19.1005 9.95208 18.7366 9.42605 18.3219L8.49742 19.4999ZM15.5026 19.4999C16.9292 18.3752 18.7528 17.0866 20.1833 15.4758C21.6395 13.8361 22.75 11.8026 22.75 9.1371H21.25C21.25 11.3345 20.3508 13.0282 19.0617 14.4798C17.7469 15.9603 16.0896 17.1271 14.574 18.3219L15.5026 19.4999ZM22.75 9.1371C22.75 6.42503 21.2153 4.07292 18.9992 3.05996C16.7359 2.02539 13.9015 2.44352 11.4596 4.98053L12.5404 6.02073C14.5983 3.88258 16.7639 3.68748 18.3756 4.42419C20.0346 5.18252 21.25 6.98623 21.25 9.1371H22.75ZM14.574 18.3219C14.0479 18.7366 13.5787 19.1005 13.1264 19.3648C12.6739 19.6293 12.3096 19.75 12 19.75V21.25C12.6904 21.25 13.3261 20.9854 13.8832 20.6599C14.4405 20.3343 14.9903 19.9037 15.5026 19.4999L14.574 18.3219ZM11.4698 6.03106L13.4698 8.03034L14.5302 6.96948L12.5302 4.97021L11.4698 6.03106Z" />
                        </svg>
                      </button>

                      {/* Thumbs up icon */}
                      <button
                        key="thumb"
                        type="button"
                        aria-pressed={currentIcon === "thumb"}
                        className={btnBase + (currentIcon === "thumb" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "thumb";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Thumbs Up"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 32 32"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M24,11H21V5a3,3,0,0,0-3-3h-.4a3,3,0,0,0-2.91,2.28l-2,5.5A1.84,1.84,0,0,1,11,11H3V29H24a5,5,0,0,0,5-5V16A5,5,0,0,0,24,11ZM9,27H5V13H9Zm18-3a3,3,0,0,1-3,3H11V13a3.83,3.83,0,0,0,3.61-2.55l2-5.55,0-.12a1,1,0,0,1,1-.78H18a1,1,0,0,1,1,1v8h5a3,3,0,0,1,3,3Z"/>
                        </svg>
                      </button>

                      {/* User icon */}
                      <button
                        key="user"
                        type="button"
                        aria-pressed={currentIcon === "user"}
                        className={btnBase + (currentIcon === "user" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "user";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="User"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 32 32"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M24,17H8a5,5,0,0,0-5,5v7H5V22a3,3,0,0,1,3-3H24a3,3,0,0,1,3,3v7h2V22A5,5,0,0,0,24,17Z"/>
                          <path fill="currentColor" d="M16,15a6,6,0,1,0-6-6A6,6,0,0,0,16,15ZM16,5a4,4,0,1,1-4,4A4,4,0,0,1,16,5Z"/>
                        </svg>
                      </button>

                      {/* Pin icon */}
                      <button
                        key="pin"
                        type="button"
                        aria-pressed={currentIcon === "pin"}
                        className={btnBase + (currentIcon === "pin" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "pin";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Pin"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 32 32"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M21.17,1.41l-2.29,2.3A3,3,0,0,0,18,5.83a3,3,0,0,0,.77,2L13.5,13.09l-1.38-1.38a3,3,0,0,0-4.24,0L4.59,15l5.5,5.5-7.8,7.79,1.42,1.42,7.79-7.8,5.5,5.5,3.29-3.29a3,3,0,0,0,0-4.24L18.91,18.5l5.27-5.27a3,3,0,0,0,2,.77,3,3,0,0,0,2.12-.88l2.3-2.29ZM18.88,21.29a1,1,0,0,1,0,1.42L17,24.59,7.41,15l1.88-1.88a1,1,0,0,1,1.42,0l1.38,1.38,5.41,5.41Zm-4-6.79,5.26-5.26,2.59,2.59L17.5,17.09Zm12-2.79a1,1,0,0,1-1.42,0L20.29,6.54h0a1,1,0,0,1-.29-.7,1,1,0,0,1,.29-.71l.88-.88,6.59,6.59Z"/>
                        </svg>
                      </button>

                      {/* Build/Wrench icon */}
                      <button
                        key="build"
                        type="button"
                        aria-pressed={currentIcon === "build"}
                        className={btnBase + (currentIcon === "build" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "build";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Build"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 512 512"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="32" d="M393.87,190a32.1,32.1,0,0,1-45.25,0l-26.57-26.57a32.09,32.09,0,0,1,0-45.26L382.19,58a1,1,0,0,0-.3-1.64c-38.82-16.64-89.15-8.16-121.11,23.57-30.58,30.35-32.32,76-21.12,115.84a31.93,31.93,0,0,1-9.06,32.08L64,380a48.17,48.17,0,1,0,68,68L285.86,281a31.93,31.93,0,0,1,31.6-9.13C357,282.46,402,280.47,432.18,250.68c32.49-32,39.5-88.56,23.75-120.93a1,1,0,0,0-1.6-.26Z"/>
                          <circle fill="currentColor" cx="96" cy="416" r="16"/>
                        </svg>
                      </button>

                      {/* Code icon */}
                      <button
                        key="code"
                        type="button"
                        aria-pressed={currentIcon === "code"}
                        className={btnBase + (currentIcon === "code" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "code";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Code"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 36 36"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M13.71,12.59a1,1,0,0,0-1.39-.26L5.79,16.78a1,1,0,0,0,0,1.65l6.53,4.45a1,1,0,1,0,1.13-1.65L8.13,17.61,13.45,14A1,1,0,0,0,13.71,12.59Z"/>
                          <path fill="currentColor" d="M30.21,16.78l-6.53-4.45A1,1,0,1,0,22.55,14l5.32,3.63-5.32,3.63a1,1,0,0,0,1.13,1.65l6.53-4.45a1,1,0,0,0,0-1.65Z"/>
                          <path fill="currentColor" d="M19.94,9.83a.9.9,0,0,0-1.09.66L15.41,24.29a.9.9,0,0,0,.66,1.09l.22,0a.9.9,0,0,0,.87-.68l3.44-13.81A.9.9,0,0,0,19.94,9.83Z"/>
                        </svg>
                      </button>

                      {/* Cog/Settings icon */}
                      <button
                        key="cog"
                        type="button"
                        aria-pressed={currentIcon === "cog"}
                        className={btnBase + (currentIcon === "cog" ? btnSelected : "")}
                        onClick={() => {
                          const icon = "cog";
                          devLog("[RR_ICON_CLICK]", { scopeKind: scopeKind ?? undefined, folderId: subMenu.folderId, icon, hasHandler: !!onSetFolderIcon });
                          if (onSetFolderIcon) {
                            onSetFolderIcon(subMenu.folderId!, icon);
                          }
                          // Don't update local state here - let the sync effect handle it from DB
                        }}
                        title="Settings"
                      >
                        <svg
                          className="w-6 h-6 text-gray-200"
                          viewBox="0 0 36 36"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                          style={iconSvgStyle}
                        >
                          <path fill="currentColor" d="M18.1,11c-3.9,0-7,3.1-7,7s3.1,7,7,7c3.9,0,7-3.1,7-7S22,11,18.1,11z M18.1,23c-2.8,0-5-2.2-5-5s2.2-5,5-5c2.8,0,5,2.2,5,5S20.9,23,18.1,23z"/>
                          <path fill="currentColor" d="M32.8,14.7L30,13.8l-0.6-1.5l1.4-2.6c0.3-0.6,0.2-1.4-0.3-1.9l-2.4-2.4c-0.5-0.5-1.3-0.6-1.9-0.3l-2.6,1.4l-1.5-0.6l-0.9-2.8C21,2.5,20.4,2,19.7,2h-3.4c-0.7,0-1.3,0.5-1.4,1.2L14,6c-0.6,0.1-1.1,0.3-1.6,0.6L9.8,5.2C9.2,4.9,8.4,5,7.9,5.5L5.5,7.9C5,8.4,4.9,9.2,5.2,9.8l1.3,2.5c-0.2,0.5-0.4,1.1-0.6,1.6l-2.8,0.9C2.5,15,2,15.6,2,16.3v3.4c0,0.7,0.5,1.3,1.2,1.5L6,22.1l0.6,1.5l-1.4,2.6c-0.3,0.6-0.2,1.4,0.3,1.9l2.4,2.4c0.5,0.5,1.3,0.6,1.9,0.3l2.6-1.4l1.5,0.6l0.9,2.9c0.2,0.6,0.8,1.1,1.5,1.1h3.4c0.7,0,1.3-0.5,1.5-1.1l0.9-2.9l1.5-0.6l2.6,1.4c0.6,0.3,1.4,0.2,1.9-0.3l2.4-2.4c0.5-0.5,0.6-1.3,0.3-1.9l-1.4-2.6l0.6-1.5l2.9-0.9c0.6-0.2,1.1-0.8,1.1-1.5v-3.4C34,15.6,33.5,14.9,32.8,14.7z M32,19.4l-3.6,1.1L28.3,21c-0.3,0.7-0.6,1.4-0.9,2.1l-0.3,0.5l1.8,3.3l-2,2l-3.3-1.8l-0.5,0.3c-0.7,0.4-1.4,0.7-2.1,0.9l-0.5,0.1L19.4,32h-2.8l-1.1-3.6L15,28.3c-0.7-0.3-1.4-0.6-2.1-0.9l-0.5-0.3l-3.3,1.8l-2-2l1.8-3.3l-0.3-0.5c-0.4-0.7-0.7-1.4-0.9-2.1l-0.1-0.5L4,19.4v-2.8l3.4-1l0.2-0.5c0.2-0.8,0.5-1.5,0.9-2.2l0.3-0.5L7.1,9.1l2-2l3.2,1.8l0.5-0.3c0.7-0.4,1.4-0.7,2.2-0.9l0.5-0.2L16.6,4h2.8l1.1,3.5L21,7.7c0.7,0.2,1.4,0.5,2.1,0.9l0.5,0.3l3.3-1.8l2,2l-1.8,3.3l0.3,0.5c0.4,0.7,0.7,1.4,0.9,2.1l0.1,0.5l3.6,1.1V19.4z"/>
                        </svg>
                      </button>
                    </div>
                  </>
                );
              })()
            )}
          </div>,
          document.body
        )}
      <style jsx global>{`
        @keyframes db-folder-fade-in {
          0% {
            opacity: 0;
            transform: scale(0.97);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes db-plus-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
