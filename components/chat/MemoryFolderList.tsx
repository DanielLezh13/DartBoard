"use client";

import * as React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";

export type MemoryFolder = {
  id: number;
  name: string;
  importance: number | null;
  position: number | null;
  created_at: string;
  memory_count: number;
};

interface MemoryFolderListProps {
  folders: MemoryFolder[];
  selectedFolder: string | null; // null = "All", string = folder name
  onFolderSelect: (folderName: string | null) => void;
  onAttachAllMemories?: (folderName: string) => void;
}

export function MemoryFolderList({
  folders,
  selectedFolder,
  onFolderSelect,
  onAttachAllMemories,
}: MemoryFolderListProps) {
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    folderName: string;
  } | null>(null);
  
  // Handle right-click on folder
  const handleContextMenu = (e: React.MouseEvent, folderName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folderName });
  };
  
  // Close context menu
  const closeContextMenu = () => setContextMenu(null);
  
  // Handle attach all memories
  const handleAttachAll = () => {
    if (contextMenu && onAttachAllMemories) {
      onAttachAllMemories(contextMenu.folderName);
    }
    closeContextMenu();
  };
  
  // Close on click outside
  React.useEffect(() => {
    if (!contextMenu) return;
    document.addEventListener('click', closeContextMenu);
    return () => document.removeEventListener('click', closeContextMenu);
  }, [contextMenu]);
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

  return (
    <>
    <div className="space-y-0.5 px-1">
      {/* "All" item (matches SessionListPane's unfiled chat behavior) */}
      <button
        type="button"
        onClick={() => onFolderSelect(null)}
        className={`relative overflow-hidden flex w-full rounded-md select-none transition-colors group ${
          selectedFolder === null ? "bg-blue-500/14" : "bg-transparent"
        }`}
      >
        <div
          className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors ${
            selectedFolder === null
              ? "text-gray-100 font-medium"
              : "text-gray-300 hover:bg-slate-700/40 hover:text-gray-100"
          }`}
        >
          <div
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
              selectedFolder === null
                ? "h-7 opacity-100 bg-blue-400/90"
                : "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
            }`}
          />
          <div className="text-sm font-medium flex items-center gap-2 min-w-0">
            <span className="truncate">All</span>
          </div>
        </div>
      </button>

      {/* Folder items */}
      {sortedFolders.map((folder) => {
        const isSelected = selectedFolder === folder.name;
        return (
          <button
            key={folder.id}
            type="button"
            onClick={() => onFolderSelect(folder.name)}
            onContextMenu={(e) => handleContextMenu(e, folder.name)}
            className={`relative overflow-hidden flex w-full rounded-md select-none transition-colors group ${
              isSelected ? "bg-blue-500/14" : "bg-transparent"
            }`}
          >
            <div
              className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors ${
                isSelected
                  ? "text-gray-100 font-medium"
                  : "text-gray-300 hover:bg-slate-700/40 hover:text-gray-100"
              }`}
            >
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
                  isSelected
                    ? "h-7 opacity-100 bg-blue-400/90"
                    : "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
                }`}
              />
              <div className="text-sm font-medium flex items-center gap-2 min-w-0">
                <span className="truncate">{folder.name}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
    
    {/* Context menu portal */}
    {contextMenu && typeof document !== 'undefined' && createPortal(
      <div
        className="fixed z-[1500] bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 min-w-[150px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
      >
        <button
          type="button"
          onClick={handleAttachAll}
          className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          Attach all memories
        </button>
      </div>,
      document.body
    )}
  </>
  );
}
