"use client";

import * as React from "react";
import { RightPanel } from "./RightPanel";
import { RightRail, type MemoryFolder } from "./RightRail";

const RIGHT_DOCK_W_OPEN = 329; // RIGHT_PANEL_W (256) + divider (1) + RIGHT_RAIL_W (72) = 329

type RightDockProps = {
  open: boolean;
  /**
   * When true, draw a 1px divider on the outer seam (chat ↔ right dock).
   * Keep this off in narrow overlay mode to avoid a hard border strip.
   */
  showOuterDivider?: boolean;
  onToggle: () => void;
  onToggleRightDock: () => void;
  rightPanelOpen: boolean;
  activeSessionId?: number | null;
  folders: MemoryFolder[];
  selectedFolder: string | null;
  onFolderSelect: (folderName: string | null) => void;
  onToggleOverlay: () => void;
  overlayOpen: boolean;
  currentOverId?: string | null;
  currentInsert?: { list: "left" | "right"; index: number } | null;
  folderListContainerRef?: React.RefObject<HTMLDivElement | null>;
  onFolderReorder?: (updates: Array<{ id: number; position: number | null }>) => void;
  onCreateFolder?: () => void;
  maxFolders?: number | null;
  onRenameFolder?: (id: number, newName: string) => void;
  onDeleteFolder?: (id: number) => void;
  onDeleteFolderAndMemories?: (id: number) => Promise<void> | void;
  onSetFolderIcon?: (id: number, icon: string | null) => void;
  onAttachAllMemories?: (folderName: string) => void;
  scopeKind?: string | null;
  onFolderAppearanceChange?: (appearance: Record<number, { label?: string; icon?: string; color?: string }>) => void;
  disableRailItemMotion?: boolean;
  // RightPanel props
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

export function RightDock({
  open,
  showOuterDivider = false,
  onToggle: _onToggle,
  onToggleRightDock: _onToggleRightDock,
  rightPanelOpen: _rightPanelOpen,
  activeSessionId = null,
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
  maxFolders,
  onRenameFolder,
  onDeleteFolder,
  onDeleteFolderAndMemories,
  onSetFolderIcon,
  onAttachAllMemories,
  scopeKind = null,
  onFolderAppearanceChange,
  disableRailItemMotion = false,
  memories,
  selectedMemoryId,
  searchQuery,
  onMemorySelect,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  onMemoryReorder,
  onDeleteMemory,
  onRenameMemory,
  onCreateMemory,
  loading,
  suppressMemoryHover,
}: RightDockProps) {
  return (
    <div
      className={`shrink-0 overflow-x-hidden overflow-y-hidden relative z-40 h-full min-h-0 bg-gray-900 min-w-0 ${
        open && showOuterDivider ? "border-l border-gray-700/50" : ""
      }`}
      style={{
        width: RIGHT_DOCK_W_OPEN,
      }}
    >
      <div className="h-full min-h-0 flex relative min-w-0">
        {/* RightPanel (left side of dock, slides in/out) */}
        <RightPanel
          selectedId={selectedMemoryId}
          open={open}
          activeSessionId={activeSessionId}
          folders={folders}
          memories={memories}
          selectedMemoryId={selectedMemoryId}
          searchQuery={searchQuery}
          selectedFolder={selectedFolder}
          onFolderSelect={onFolderSelect}
          onMemorySelect={onMemorySelect}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          onClearSearch={onClearSearch}
          onMemoryReorder={onMemoryReorder}
          onDeleteMemory={onDeleteMemory}
          onRenameMemory={onRenameMemory}
          onCreateMemory={onCreateMemory}
          loading={loading}
          activeId={activeId ?? null}
          suppressMemoryHover={suppressMemoryHover}
        />
        
        {/* RightRail (right side of dock, always visible at edge) */}
        <RightRail
          folders={folders}
          selectedFolder={selectedFolder}
          onFolderSelect={onFolderSelect}
          onToggleOverlay={onToggleOverlay}
          overlayOpen={overlayOpen}
          activeId={activeId ?? null}
          currentOverId={currentOverId}
          currentInsert={currentInsert}
          folderListContainerRef={folderListContainerRef}
          onFolderReorder={onFolderReorder}
          onCreateFolder={onCreateFolder}
          maxFolders={maxFolders}
          onRenameFolder={onRenameFolder || (() => {})}
          onDeleteFolder={onDeleteFolder || (() => {})}
          onDeleteFolderAndMemories={onDeleteFolderAndMemories}
  onSetFolderIcon={onSetFolderIcon}
  onAttachAllMemories={onAttachAllMemories}
  scopeKind={scopeKind}
  onFolderAppearanceChange={onFolderAppearanceChange}
          disableRailItemMotion={disableRailItemMotion}
        />
      </div>
    </div>
  );
}
