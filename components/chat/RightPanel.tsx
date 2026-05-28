"use client";

import * as React from "react";
import { useState } from "react";
import MemoryList from "@/components/vault/MemoryList";
import { type MemoryFolder } from "@/components/chat/MemoryFolderList";
import type { Memory } from "@/hooks/useChatMemories";

type RightPanelProps = {
  selectedId: number | null;
  open: boolean;
  activeSessionId?: number | null;
  folders: MemoryFolder[];
  memories: Array<{
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
  }>;
  selectedMemoryId: number | null;
  searchQuery: string;
  selectedFolder: string | null;
  onFolderSelect: (folderName: string | null) => void;
  onMemorySelect: (memoryId: number) => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onClearSearch: () => void;
  onMemoryReorder: (updates: Array<{ id: number; position: number | null }>) => void;
  onDeleteMemory?: (id: number) => Promise<void> | void;
  onRenameMemory?: (id: number, newTitle: string) => Promise<void> | void;
  onCreateMemory?: (folderName?: string | null) => void;
  loading?: boolean;
  activeId?: string | null;
  suppressMemoryHover?: boolean;
};

interface RightPanelContextProps {
  memories: Memory[];
  selectedMemoryId: number | null;
  searchQuery: string;
  selectedFolder: string | null;
  onMemorySelect: (id: number) => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
  onClearSearch: () => void;
  onImportClick: () => void;
  onMemoryReorder: (updates: Array<{ id: number; position: number | null }>) => void;
  onDeleteMemory?: (id: number) => Promise<void> | void;
  onRenameMemory?: (id: number, newTitle: string) => Promise<void> | void;
  loading?: boolean;
  activeId?: string | null;
};

export function RightPanel({
  selectedId,
  open,
  activeSessionId = null,
  folders,
  memories,
  selectedMemoryId,
  searchQuery,
  selectedFolder,
  onFolderSelect,
  onMemorySelect,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  onMemoryReorder,
  onDeleteMemory,
  onRenameMemory,
  onCreateMemory,
  loading,
  activeId,
  suppressMemoryHover,
}: RightPanelProps) {
  const [localSearchInput, setLocalSearchInput] = useState("");
  const [statsExpanded, setStatsExpanded] = React.useState(false);
  const pendingRestoreStatsAnimationRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Only animate the stats card on same-tab refresh restore when right dock was open.
      pendingRestoreStatsAnimationRef.current =
        sessionStorage.getItem("db:rightDockHidden") === "false";
    } catch {
      pendingRestoreStatsAnimationRef.current = false;
    }
  }, []);

  const activeFolder =
    selectedFolder != null ? folders.find((f) => f.name === selectedFolder) ?? null : null;

  const isUnsorted = (folderName: string | null | undefined) => {
    if (folderName == null) return true;
    const trimmed = folderName.trim();
    return trimmed === "" || trimmed === "Unsorted";
  };

  const unsortedCount = React.useMemo(() => {
    return memories.filter((m) => isUnsorted(m.folder_name)).length;
  }, [memories]);

  const selectedFolderCount = React.useMemo(() => {
    if (selectedFolder === null) {
      return unsortedCount;
    }
    return memories.filter((m) => (m.folder_name ?? "Unsorted") === selectedFolder).length;
  }, [memories, selectedFolder, unsortedCount]);

  const activeFolderCard =
    selectedFolder === null
      ? { label: "Unsorted", count: unsortedCount }
      : activeFolder
        ? { label: activeFolder.name, count: selectedFolderCount }
        : null;

  const cardExists = !!activeFolderCard;
  const countReady =
    selectedFolder === null
      ? true
      : typeof activeFolderCard?.count === "number";

  const showStatsCard = cardExists && countReady;

  React.useEffect(() => {
    if (!showStatsCard) {
      setStatsExpanded(false);
      return;
    }

    if (pendingRestoreStatsAnimationRef.current) {
      // Wait for both dock visibility and session restore (matches left-card timing).
      if (!open || activeSessionId == null) {
        setStatsExpanded(false);
        return;
      }
      pendingRestoreStatsAnimationRef.current = false;
      setStatsExpanded(false);
      const id = requestAnimationFrame(() => setStatsExpanded(true));
      return () => cancelAnimationFrame(id);
    }

    // Default/manual path: keep card expanded so list does not get pushed on panel toggle.
    setStatsExpanded(true);
  }, [showStatsCard, open, activeSessionId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit(localSearchInput);
  };

  const handleClearSearch = () => {
    setLocalSearchInput("");
    onClearSearch();
  };

  return (
    <div
      className={
        "relative h-full w-64 flex-shrink-0 overflow-x-hidden overflow-y-hidden min-w-0"
      }
      style={{
        background:
          "linear-gradient(180deg, rgba(23, 37, 84, 0.35) 0%, rgba(17, 24, 39, 0.5) 100%)",
      }}
      aria-hidden={!open}
    >
      {/* Subtle noise texture overlay */}
      <div 
        className="absolute inset-0 pointer-events-none z-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E")`,
          mixBlendMode: "overlay",
        }}
      />
      <div className="relative z-10 h-full min-h-0 w-64 flex flex-col" style={{ touchAction: "pan-y" }}>
        {/* Header - Memories bar (matches ChatNavigator style) */}
        <div className="flex flex-col flex-shrink-0 border-b border-gray-700/30">
          {/* Row 1: Title */}
          <div className="h-12 px-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100 truncate flex-1 min-w-0">
              Memories
            </h2>
          </div>

          {/* Active folder info (mirrors ChatNavigator "Active chat") */}
          <div
            className={
              "overflow-hidden transition-all duration-300 ease-out " +
              (statsExpanded ? "max-h-[96px]" : "max-h-0")
            }
          >
            <div className="px-3 pb-2">
              <div
                className="rounded-md border border-gray-700/30 bg-gray-900/20 px-2.5 py-2"
                style={{ minHeight: 48 }}
              >
                <div className="text-[11px] uppercase tracking-wider text-gray-400/80">
                  Active folder
                </div>
                <div className="mt-1 text-[13px] font-semibold text-gray-100 truncate">
                  {activeFolderCard?.label ?? ""}
                </div>
                {typeof activeFolderCard?.count === "number" && (
                  <div className="mt-1 text-[12px] text-gray-400/80">
                    {activeFolderCard.count} memories
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Search memories (matches ChatNavigator search chats) */}
        <div className="px-3 py-2 border-b border-gray-700/30 flex-shrink-0">
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <input
                type="text"
                value={localSearchInput}
                onChange={(e) => {
                  setLocalSearchInput(e.target.value);
                  onSearchChange(e.target.value);
                }}
                placeholder="Search memories"
                className="w-full h-8 bg-gray-800/50 text-gray-100 text-sm pl-8 pr-2 rounded-md border border-gray-700/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              <svg
                className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35m1.6-5.15a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
                />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </form>
        </div>
        
        {/* Always show MemoryList (memories grouped by folder when "All" selected) */}
        <div className="flex-1 min-h-0 flex flex-col">
          <MemoryList
            memories={memories}
            selectedMemoryId={selectedMemoryId}
            searchQuery={searchQuery}
            selectedFolder={selectedFolder}
            onMemorySelect={onMemorySelect}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
            onClearSearch={onClearSearch}
            onImportClick={onCreateMemory ? (folder: string | null) => onCreateMemory(folder) : () => {}}
            onMemoryReorder={onMemoryReorder}
            onDeleteMemory={onDeleteMemory}
            onRenameMemory={onRenameMemory}
            activeId={activeId}
            isLoading={loading}
            suppressHover={Boolean(suppressMemoryHover)}
            expectedFolderCount={
              searchQuery.trim()
                ? null
                : selectedFolder === null
                  ? unsortedCount
                  : (activeFolder?.memory_count ?? null)
            }
          />
        </div>
      </div>
    </div>
  );
}
