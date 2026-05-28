"use client";

import { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Memory {
  id: number;
  folder_name: string | null;
  title: string | null;
  summary: string;
  excerpt?: string | null;
  created_at: string;
  tags: string | null;
  importance: number | null;
  session_id: number | null;
  message_id: number | null;
  source?: string | null;
  position?: number | null;
}

interface MemoryListProps {
  memories: Memory[];
  selectedMemoryId: number | null;
  searchQuery: string;
  selectedFolder: string | null;
  onMemorySelect: (memoryId: number) => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onClearSearch: () => void;
  onImportClick: (folderName: string | null) => void;
  onMemoryReorder: (updates: Array<{ id: number; position: number | null }>) => void;
  onDeleteMemory?: (id: number) => Promise<void> | void;
  onRenameMemory?: (id: number, newTitle: string) => Promise<void> | void;
  activeId?: string | null;
  isLoading?: boolean;
  /** Optional count hint (from folder list) to short-circuit loading for known-empty folders. */
  expectedFolderCount?: number | null;
  /** Temporarily disable hover styling to avoid double-hover flashes during list reflows. */
  suppressHover?: boolean;
}

interface NonSortableMemoryItemProps {
  memory: Memory;
  isSelected: boolean;
  formatDate: (dateString: string) => string;
  onMemorySelect: (memoryId: number) => void;
  onDeleteMemory?: (id: number) => Promise<void> | void;
  onRename?: (id: number, newTitle: string) => Promise<void> | void;
  isActionsOpen: boolean;
  onOpenActions: () => void;
  onCloseActions: () => void;
  isDragging?: boolean;
  suppressHover?: boolean;
}

function NonSortableMemoryItem({
  memory,
  isSelected,
  formatDate,
  onMemorySelect,
  onDeleteMemory,
  onRename,
  isActionsOpen,
  onOpenActions,
  onCloseActions,
  isDragging: externalIsDragging,
  suppressHover = false,
}: NonSortableMemoryItemProps) {
  const { attributes, listeners, setNodeRef: setDraggableNodeRef } = useDraggable({
    id: `memory-${memory.id}`,
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: `memory-${memory.id}`,
  })

  const isDragging = externalIsDragging || false;

  const style: React.CSSProperties = {
    // Unified memory drag contract:
    // - DragOverlay is the moving element
    // - Original row does NOT translate (prevents internal horizontal scroll / layout weirdness)
    // - Original row visually disappears while dragging
    opacity: isDragging ? 0 : 1,
    pointerEvents: isDragging ? "none" : undefined,
    width: '100%',
    overflowAnchor: "none",
  };

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(memory.title || "");

  useEffect(() => {
    setRenameValue(memory.title || "");
  }, [memory.title]);

  useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        const input = document.querySelector(`input[data-memory-rename="${memory.id}"]`) as HTMLInputElement;
        input?.focus();
        input?.select();
      });
    }
  }, [isRenaming, memory.id]);

  const commitRename = async () => {
    const next = renameValue.trim();
    if (!next) {
      setRenameValue(memory.title || "");
      setIsRenaming(false);
      return;
    }
    if (next !== memory.title && onRename) {
      await onRename(memory.id, next);
    }
    setIsRenaming(false);
    onCloseActions();
  };

  const cancelRename = () => {
    setRenameValue(memory.title || "");
    setIsRenaming(false);
    onCloseActions();
  };

  const handleDelete = async () => {
    if (!onDeleteMemory) return;
    await onDeleteMemory(memory.id);
    onCloseActions();
  };

  return (
    <div
      ref={(node) => {
        setDraggableNodeRef(node)
        setDroppableNodeRef(node)
        // Register node for measured clamping (store by draggable ID)
        if (typeof window !== "undefined" && (window as any).__memoryNodeMapRef && node) {
          const mapRef = (window as any).__memoryNodeMapRef as React.MutableRefObject<Map<string, HTMLElement>>;
          mapRef.current.set(`memory-${memory.id}`, node);
        }
      }}
      data-memory-row={`memory-${memory.id}`}
      style={style}
      className={`relative overflow-hidden flex w-full max-w-full rounded-md select-none transition-colors ${
        isSelected ? "bg-blue-500/14" : "bg-transparent"
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isActionsOpen) onOpenActions();
      }}
    >
      {/* Sliding Actions Panel (Vault-style) - slides from right */}
      <div
        data-memory-actions="1"
        className={`flex items-center gap-0 flex-shrink-0 transition-all duration-300 ease-in-out ${
          isActionsOpen ? "w-[84px] opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Rename */}
        <button
          type="button"
          className="w-10 h-[30px] bg-slate-700/70 border border-slate-600/50 hover:bg-slate-600/70 text-sky-200 rounded-l-md flex items-center justify-center"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          type="button"
          className="w-10 h-[30px] bg-red-600/90 border border-red-700/70 hover:bg-red-700 text-white rounded-r-md flex items-center justify-center"
          title="Delete"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDelete();
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Main Row (draggable) */}
      <div
        {...attributes}
        {...listeners}
        className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors group ${
          isSelected
            ? "text-gray-100 font-medium"
            : `text-gray-300${suppressHover ? "" : " hover:bg-slate-700/40 hover:text-gray-100"}`
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (isActionsOpen) onCloseActions();
          onMemorySelect(memory.id);
        }}
      >
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
            isSelected
              ? "h-7 opacity-100 bg-blue-400/90"
              : `h-3 opacity-0 bg-blue-400/70${suppressHover ? "" : " group-hover:opacity-70"}`
          }`}
        />
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              data-memory-rename={memory.id}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              onBlur={commitRename}
              className="w-full bg-gray-800/70 text-gray-100 text-sm px-2 py-1 rounded border border-gray-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          ) : (
            <span className="truncate">{memory.title || "Untitled"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface SortableMemoryItemProps {
  memory: Memory;
  isSelected: boolean;
  formatDate: (dateString: string) => string;
  onMemorySelect: (memoryId: number) => void;
  onDeleteMemory?: (id: number) => Promise<void> | void;
  onRename?: (id: number, newTitle: string) => Promise<void> | void;
  isActionsOpen: boolean;
  onOpenActions: () => void;
  onCloseActions: () => void;
  isDragging?: boolean;
  suppressHover?: boolean;
}

function SortableMemoryItem({
  memory,
  isSelected,
  formatDate,
  onMemorySelect,
  onDeleteMemory,
  onRename,
  isActionsOpen,
  onOpenActions,
  onCloseActions,
  isDragging: externalIsDragging,
  suppressHover = false,
}: SortableMemoryItemProps) {
  const sortable = useSortable({
    id: `memory-${memory.id}`,
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = sortable;

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `memory-${memory.id}`,
  });

  const isDragging = externalIsDragging || isSortableDragging;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.15 : 1, // Show placeholder at 15% opacity (matches SortableSessionRow)
    pointerEvents: isDragging ? "none" : undefined,
    width: '100%',
    overflowAnchor: "none",
  };

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(memory.title || "");

  useEffect(() => {
    setRenameValue(memory.title || "");
  }, [memory.title]);

  useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        const input = document.querySelector(`input[data-memory-rename="${memory.id}"]`) as HTMLInputElement;
        input?.focus();
        input?.select();
      });
    }
  }, [isRenaming, memory.id]);

  const commitRename = async () => {
    const next = renameValue.trim();
    if (!next) {
      setRenameValue(memory.title || "");
      setIsRenaming(false);
      return;
    }
    if (next !== memory.title && onRename) {
      await onRename(memory.id, next);
    }
    setIsRenaming(false);
    onCloseActions();
  };

  const cancelRename = () => {
    setRenameValue(memory.title || "");
    setIsRenaming(false);
    onCloseActions();
  };

  const handleDelete = async () => {
    if (!onDeleteMemory) return;
    await onDeleteMemory(memory.id);
    onCloseActions();
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDroppableRef(node);
        // Register node for measured clamping (store by draggable ID)
        if (typeof window !== "undefined" && (window as any).__memoryNodeMapRef && node) {
          const mapRef = (window as any).__memoryNodeMapRef as React.MutableRefObject<Map<string, HTMLElement>>;
          mapRef.current.set(`memory-${memory.id}`, node);
        }
      }}
      data-memory-row={`memory-${memory.id}`}
      style={style}
      className={`relative overflow-hidden flex w-full max-w-full rounded-md select-none transition-colors ${
        isSelected ? "bg-blue-500/14" : "bg-transparent"
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isActionsOpen) onOpenActions();
      }}
    >
      {/* Sliding Actions Panel (Vault-style) - slides from right */}
      <div
        data-memory-actions="1"
        className={`flex items-center gap-0 flex-shrink-0 transition-all duration-300 ease-in-out ${
          isActionsOpen ? "w-[84px] opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Rename */}
        <button
          type="button"
          className="w-10 h-[30px] bg-slate-700/70 border border-slate-600/50 hover:bg-slate-600/70 text-sky-200 rounded-l-md flex items-center justify-center"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            setIsRenaming(true);
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          type="button"
          className="w-10 h-[30px] bg-red-600/90 border border-red-700/70 hover:bg-red-700 text-white rounded-r-md flex items-center justify-center"
          title="Delete"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDelete();
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Main Row (sortable) */}
      <div
        {...attributes}
        {...listeners}
        className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors group ${
          isSelected
            ? "text-gray-100 font-medium"
            : `text-gray-300${suppressHover ? "" : " hover:bg-slate-700/40 hover:text-gray-100"}`
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (isActionsOpen) onCloseActions();
          onMemorySelect(memory.id);
        }}
      >
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
            isSelected
              ? "h-7 opacity-100 bg-blue-400/90"
              : `h-3 opacity-0 bg-blue-400/70${suppressHover ? "" : " group-hover:opacity-70"}`
          }`}
        />
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              data-memory-rename={memory.id}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              onBlur={commitRename}
              className="w-full bg-gray-800/70 text-gray-100 text-sm px-2 py-1 rounded border border-gray-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          ) : (
            <span className="truncate">{memory.title || "Untitled"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MemoryList({
  memories,
  selectedMemoryId,
  searchQuery,
  selectedFolder,
  onMemorySelect,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  onImportClick,
  onMemoryReorder,
  onDeleteMemory,
  onRenameMemory,
  activeId: parentActiveId,
  isLoading = false,
  expectedFolderCount = null,
  suppressHover = false,
}: MemoryListProps) {
  const [openMemoryActionsId, setOpenMemoryActionsId] = useState<number | null>(null);

  // Close any open memory actions when clicking outside
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      // Ignore right/middle clicks. Right-click is what opens the actions drawer, and on some
      // browsers it can also trigger a document mousedown that would immediately close it.
      if (typeof e.button === "number" && e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-memory-actions="1"]')) return;
      setOpenMemoryActionsId(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    setOpenMemoryActionsId(null);
  }, [selectedFolder]);

  useEffect(() => {
    if (searchQuery.trim()) setOpenMemoryActionsId(null);
  }, [searchQuery]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Filter memories by search query
  const filteredMemories = memories.filter((memory) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const title = (memory.title || "").toLowerCase();
    return title.includes(query);
  });

  // Sort memories by position first, then by date
  const sortedMemories = [...filteredMemories].sort((a, b) => {
    const aPos = a.position ?? null;
    const bPos = b.position ?? null;

    if (aPos !== null && bPos !== null) {
      return aPos - bPos;
    }
    if (aPos !== null) return -1;
    if (bPos !== null) return 1;

    const aDate = new Date(a.created_at).getTime();
    const bDate = new Date(b.created_at).getTime();
    return bDate - aDate;
  });

  const isUnsorted = (folderName: string | null) => {
    if (folderName == null) return true;
    const trimmed = folderName.trim();
    return trimmed === "" || trimmed === "Unsorted";
  };

  // RIGHT DnD contract: "All" === unsorted-only.
  // (Folder contents are only shown when selectedFolder is a folder name.)
  const visibleMemories = useMemo(() => {
    if (selectedFolder === null) {
      return sortedMemories.filter((m) => isUnsorted(m.folder_name));
    }
    return sortedMemories.filter((m) => (m.folder_name ?? "Unsorted") === selectedFolder);
  }, [selectedFolder, sortedMemories]);

  const renderMemories = visibleMemories;
  const treatKnownEmptyAsLoaded =
    expectedFolderCount === 0 &&
    !searchQuery.trim();
  const showLoading = isLoading && renderMemories.length === 0 && !treatKnownEmptyAsLoaded;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const marker = (window as any).__db_lastMovedMemory as { id: number; folderId: number | null; folderName: string } | undefined;
    if (!marker) return;
    delete (window as any).__db_lastMovedMemory;
  }, [memories]);

  const handleOpenMemoryActions = (memoryId: number) => {
    setOpenMemoryActionsId(memoryId);
  };

  const handleCloseMemoryActions = () => {
    setOpenMemoryActionsId(null);
  };

  return (
    <div 
      style={{ overflowAnchor: "none", scrollBehavior: "auto", touchAction: "pan-y" }}
      className="db-scroll-lane flex-1 overflow-y-auto overflow-x-hidden py-2 bg-transparent min-h-0"
    >
      {/* New Memory row (matches ChatNavigator "New Chat") */}
      <div className="border-y border-gray-700/30 bg-transparent">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onImportClick(selectedFolder);
          }}
          className={
            "relative w-full flex items-center gap-2 px-3 py-2.5 text-left " +
            "text-gray-300 hover:text-gray-100 hover:bg-slate-800/35 " +
            "transition-colors group"
          }
          title="New memory"
          aria-label="New memory"
        >
          <div
            className={
              "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out " +
              "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
            }
          />
          <svg
            className="w-4 h-4 flex-shrink-0 text-gray-400 group-hover:text-gray-200 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight transition-all duration-150 group-hover:tracking-wide">
              New Memory
            </div>
          </div>
        </button>
      </div>

      {showLoading ? (
        <div className="text-xs text-gray-500 italic py-4 text-center">
          Loading memories...
        </div>
      ) : renderMemories.length === 0 ? (
        <div className="text-xs text-gray-500 italic py-4 text-center">
          {searchQuery ? "No memories match your search." : selectedFolder === null ? "No memories" : "Empty folder"}
        </div>
      ) : (
        // Both folder and unsorted views: use SortableContext for reordering
        <SortableContext items={renderMemories.map((m) => `memory-${m.id}`)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5 px-1">
            {renderMemories.map((memory) => {
              const memoryId = memory.id;
              return (
                <SortableMemoryItem
                  key={memoryId}
                  memory={memory}
                  isSelected={memoryId === selectedMemoryId}
                  formatDate={formatDate}
                  onMemorySelect={onMemorySelect}
                  onDeleteMemory={onDeleteMemory}
                  onRename={onRenameMemory}
                  isActionsOpen={openMemoryActionsId === memoryId}
                  onOpenActions={() => handleOpenMemoryActions(memoryId)}
                  onCloseActions={handleCloseMemoryActions}
                  isDragging={parentActiveId === `memory-${memoryId}`}
                  suppressHover={suppressHover}
                />
              );
            })}
          </div>
        </SortableContext>
      )}
    </div>
  );
}
