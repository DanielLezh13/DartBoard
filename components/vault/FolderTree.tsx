"use client";

import { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface FolderNode {
  name: string;
  fullPath: string;
  icon?: string | null;
  children: FolderNode[];
  memoryCount: number;
  importance: number | null;
  created_at?: string;
}

interface FolderTreeProps {
  folderTree: FolderNode[];
  selectedFolder: string | null;
  expandedFolders: Set<string>;
  folderIds: Map<string, number>;
  folderPositions: Map<string, number | null>;
  onFolderSelect: (folderPath: string) => void;
  onToggleExpand: (folderPath: string) => void;
  onCreateSubfolder: (parentPath: string, subfolderName: string) => void;
  onCreateNewFolder: (folderName: string) => void;
  onRenameFolder: (oldPath: string, newName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onFolderReorder: (updates: Array<{ id: number; position?: number | null; name?: string }>) => void;
  totalMemories: number;
}

interface SortableFolderItemProps {
  node: FolderNode;
  index: number;
  selectedFolder: string | null;
  expandedFolders: Set<string>;
  editingFolderName: string | null;
  editedFolderName: string;
  creatingSubfolder: string | null;
  newSubfolderName: string;
  onFolderSelect: (folderPath: string) => void;
  onToggleExpand: (folderPath: string) => void;
  onRenameFolder: (oldPath: string, newName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  setEditingFolderName: (path: string | null) => void;
  setEditedFolderName: (name: string) => void;
  handleCreateSubfolder: (parentPath: string, subfolderName: string) => void;
  setCreatingSubfolder: (path: string | null) => void;
  setNewSubfolderName: (name: string) => void;
  onFolderClick: (e: React.MouseEvent) => void;
  onFolderDoubleClick: (e: React.MouseEvent) => void;
  onContextMenuEdit: (folderPath: string, folderName: string) => void;
  isDeletingRef: React.MutableRefObject<boolean>;
  isContextMenuEditRef: React.MutableRefObject<boolean>;
}

function SortableFolderItem({
  node,
  index,
  selectedFolder,
  expandedFolders,
  editingFolderName,
  editedFolderName,
  creatingSubfolder,
  newSubfolderName,
  onFolderSelect,
  onToggleExpand,
  onRenameFolder,
  onDeleteFolder,
  setEditingFolderName,
  setEditedFolderName,
  handleCreateSubfolder,
  setCreatingSubfolder,
  setNewSubfolderName,
  onFolderClick,
  onFolderDoubleClick,
  onContextMenuEdit,
  isDeletingRef,
  isContextMenuEditRef,
}: SortableFolderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.fullPath,
    disabled: editingFolderName === node.fullPath, // Disable drag when editing
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isExpanded = expandedFolders.has(node.fullPath);
  const isSelected = selectedFolder === node.fullPath;
  const hasChildren = node.children.length > 0;
  const isCreatingSubfolderHere = creatingSubfolder === node.fullPath;

  // Add delete panel state and refs
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const deletePanelRef = useRef<HTMLDivElement>(null);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  // Close delete panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (deletePanelRef.current && !deletePanelRef.current.contains(event.target as Node) &&
          editPanelRef.current && !editPanelRef.current.contains(event.target as Node) &&
          itemRef.current && !itemRef.current.contains(event.target as Node)) {
        setShowDeletePanel(false);
      }
    };

    if (showDeletePanel) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDeletePanel]);

  // Close delete panel when this item becomes deselected
  const prevSelectedRef = useRef(false);
  useEffect(() => {
    const wasSelected = prevSelectedRef.current;
    prevSelectedRef.current = isSelected;
    
    if (wasSelected && !isSelected && showDeletePanel) {
      setShowDeletePanel(false);
    }
  }, [isSelected, showDeletePanel]);

  const handleDelete = async () => {
    // Close panel with animation first
    setShowDeletePanel(false);
    
    // Wait for slide-out animation, then delete
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          onDeleteFolder(node.fullPath);
        } catch (err) {
          console.error("Error deleting folder:", err);
        } finally {
          resolve();
        }
      }, 250); // Wait for slide-out animation
    });
  };

  const handleFolderClick = (e: React.MouseEvent) => {
    if (!isDragging) {
      e.stopPropagation();
      // Close delete panel if open when clicking the item
      if (showDeletePanel) {
        setShowDeletePanel(false);
      }
      onFolderSelect(node.fullPath);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Close panel first
    setShowDeletePanel(false);
    // Then trigger edit mode
    onContextMenuEdit(node.fullPath, node.name);
  };

  return (
    <div className="relative">
      {editingFolderName === node.fullPath ? (
        <div
          className="flex items-center gap-1 pl-0 pr-3 py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Save button - green checkmark */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (editedFolderName.trim() && editedFolderName.trim() !== node.name) {
                onRenameFolder(node.fullPath, editedFolderName);
              } else {
                setEditingFolderName(null);
                setEditedFolderName("");
              }
            }}
            className="flex-shrink-0 bg-green-600 hover:bg-green-700 px-2 py-1.5 flex items-center justify-center rounded-l-md shadow-lg cursor-pointer transition-colors"
            title="Save folder name"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>

          {/* Cancel button - red X */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              // Cancel edit - don't save changes
              setEditingFolderName(null);
              setEditedFolderName("");
            }}
            className="flex-shrink-0 bg-red-600 hover:bg-red-700 px-2 py-1.5 flex items-center justify-center shadow-lg cursor-pointer transition-colors"
            title="Cancel editing"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {/* Name input */}
          <input
            type="text"
            value={editedFolderName}
            onChange={(e) => setEditedFolderName(e.target.value.replace(/\//g, " "))}
            onBlur={(e) => {
              setTimeout(() => {
                if (isContextMenuEditRef.current) {
                  return;
                }
                if (isDeletingRef.current) {
                  setTimeout(() => {
                    isDeletingRef.current = false;
                  }, 50);
                  return;
                }
                // Auto-save on blur (when clicking away)
                if (editedFolderName.trim() && editedFolderName.trim() !== node.name) {
                  onRenameFolder(node.fullPath, editedFolderName);
                } else {
                  setEditingFolderName(null);
                  setEditedFolderName("");
                }
              }, 10);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setEditingFolderName(null);
                setEditedFolderName("");
              }
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 min-w-0 bg-gray-700 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ) : (
        <div ref={setNodeRef} style={style} className={`relative overflow-hidden flex rounded-md transition-colors group ${
          isSelected
            ? "bg-blue-500/10"
            : "hover:bg-gray-800/20"
        }`}>
          {/* Sliding Delete Panel - slides from left, pushes content */}
          <div
            ref={deletePanelRef}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`bg-red-600 border-r-2 border-red-700 px-2 py-1.5 flex items-center justify-center rounded-l-md shadow-lg cursor-pointer hover:bg-red-700 transition-all duration-500 ease-in-out flex-shrink-0 ${
              showDeletePanel ? "w-10 opacity-100" : "w-0 opacity-0 overflow-hidden pointer-events-none"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>

          {/* Sliding Edit Panel - blue pencil icon, slides in next to delete panel */}
          <div
            ref={editPanelRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleEditClick(e);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={`bg-blue-600 border-r-2 border-blue-700 px-2 py-1.5 flex items-center justify-center shadow-lg cursor-pointer hover:bg-blue-700 transition-all duration-500 ease-in-out flex-shrink-0 relative z-10 ${
              showDeletePanel ? "w-10 opacity-100" : "w-0 opacity-0 overflow-hidden pointer-events-none"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </div>

          <button
            ref={itemRef}
            type="button"
            {...attributes}
            {...listeners}
            onClick={handleFolderClick}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onFolderSelect(node.fullPath);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Select the folder when right-clicking to show delete panel
              onFolderSelect(node.fullPath);
              setShowDeletePanel(true);
            }}
            className={`flex-1 text-left pl-1 pr-3 py-1.5 transition-all flex items-center ${hasChildren ? 'gap-0.5' : ''} min-w-0 ${
              showDeletePanel ? 'ml-2' : ''
            } ${
              isDragging ? "opacity-50 cursor-grabbing" : "cursor-pointer"
            } ${
              isSelected
                ? "text-gray-100 font-medium"
                : "bg-transparent text-gray-300 group-hover:text-gray-200"
            }`}
          >
            {/* Expand/collapse arrow */}
            {hasChildren ? (
              <span className="w-2.5 h-2.5 flex items-center justify-center flex-shrink-0">
                <span
                  className={`text-xs ${
                    isSelected ? "text-gray-300" : "text-gray-500"
                  }`}
                >
                  {isExpanded ? "▼" : "▶"}
                </span>
              </span>
            ) : null}

            {/* Folder name - with truncation */}
            <span className="truncate flex-1 min-w-0 text-sm">{node.name}</span>

            {/* Memory count - fixed on right */}
            <span className="text-xs ml-auto flex-shrink-0 text-gray-500/60">
              {node.memoryCount}
            </span>
          </button>
        </div>
      )}

      {/* Input for creating subfolder */}
      {isCreatingSubfolderHere && (
        <div
          className="ml-6 mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border border-gray-700 rounded p-2 bg-gray-800/50 flex items-center gap-1">
            <input
              type="text"
              value={newSubfolderName}
              onChange={(e) => setNewSubfolderName(e.target.value.replace(/\//g, " "))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateSubfolder(node.fullPath, newSubfolderName);
                } else if (e.key === "Escape") {
                  setCreatingSubfolder(null);
                  setNewSubfolderName("");
                }
              }}
              autoFocus
              placeholder="Subfolder name..."
              className="flex-1 bg-gray-700 text-gray-100 text-xs px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => handleCreateSubfolder(node.fullPath, newSubfolderName)}
              className="text-xs text-blue-400 hover:text-blue-300 px-2"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingSubfolder(null);
                setNewSubfolderName("");
              }}
              className="text-xs text-gray-400 hover:text-gray-300 px-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {hasChildren && isExpanded && (
        <div className="ml-6 mt-1">
          {/* Nested children - for now keep them non-sortable */}
          {node.children.map((child) => (
            <div key={child.fullPath} className="mb-0.5">
              <div className="border border-gray-700 rounded py-0.5 px-1 bg-gray-800/50">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFolderSelect(child.fullPath);
                  }}
                  className={`w-full text-left text-sm py-0.5 ${
                    selectedFolder === child.fullPath
                      ? "text-blue-300"
                      : "text-gray-300 hover:text-gray-100"
                  }`}
                >
                  {child.name} ({child.memoryCount})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FolderTree({
  folderTree,
  selectedFolder,
  expandedFolders,
  folderIds,
  folderPositions,
  onFolderSelect,
  onToggleExpand,
  onCreateSubfolder,
  onCreateNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onFolderReorder,
  totalMemories,
}: FolderTreeProps) {
  const [creatingSubfolder, setCreatingSubfolder] = useState<string | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState("");
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderName, setEditingFolderName] = useState<string | null>(null);
  const [editedFolderName, setEditedFolderName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");
  const prevSelectedFolderRef = useRef<string | null>(selectedFolder);
  const isContextMenuEditRef = useRef(false);
  const isDeletingRef = useRef(false);
  const isClosingFolderRef = useRef(false);

  // Configure sensors with activationConstraint for click vs drag
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    })
  );

  const handleCreateSubfolder = (parentPath: string, subfolderName: string) => {
    if (!subfolderName.trim()) return;
    onCreateSubfolder(parentPath, subfolderName);
    setCreatingSubfolder(null);
    setNewSubfolderName("");
  };

  const handleCreateNewFolder = (folderName: string) => {
    if (!folderName.trim()) return;
    onCreateNewFolder(folderName);
    setCreatingNewFolder(false);
    setNewFolderName("");
  };

  const handleRenameFolder = (oldPath: string, newName: string) => {
    if (!newName.trim() || newName.trim() === oldPath) {
      setEditingFolderName(null);
      setEditedFolderName("");
      return;
    }
    onRenameFolder(oldPath, newName);
    setEditingFolderName(null);
    setEditedFolderName("");
  };

  // Handle right-click to edit folder name
  const handleContextMenuEdit = (folderPath: string, folderName: string) => {
    // Set flag to prevent useEffect from interfering
    isContextMenuEditRef.current = true;
    
    // If we're switching to a different folder, save the current edit first
    if (editingFolderName && editingFolderName !== folderPath) {
      const currentFolderBeingEdited = folderTree.find(
        (f) => f.fullPath === editingFolderName
      );
      if (currentFolderBeingEdited && editedFolderName.trim() && editedFolderName.trim() !== currentFolderBeingEdited.name) {
        // Save the previous edit before switching
        handleRenameFolder(editingFolderName, editedFolderName);
      } else {
        // No changes, just close previous edit
        setEditingFolderName(null);
        setEditedFolderName("");
      }
    }
    
    // Now open edit mode for the right-clicked folder
    setEditingFolderName(folderPath);
    setEditedFolderName(folderName);
    
    // Reset flag after a delay to allow blur handlers to see it and state to settle
    setTimeout(() => {
      isContextMenuEditRef.current = false;
    }, 300);
  };

  // Auto-save when clicking (selecting) another folder while editing
  useEffect(() => {
    // Only auto-save if:
    // 1. Selection actually changed (not just different from editing folder)
    // 2. We're not in the middle of a context menu edit
    // 3. We have an active edit
    const selectionChanged = prevSelectedFolderRef.current !== selectedFolder;
    prevSelectedFolderRef.current = selectedFolder;
    
    if (
      !isContextMenuEditRef.current &&
      selectionChanged &&
      editingFolderName && 
      editedFolderName.trim() && 
      selectedFolder && 
      selectedFolder !== editingFolderName
    ) {
      // User clicked (selected) a different folder while editing - auto-save current edit
      const currentFolderBeingEdited = folderTree.find(
        (f) => f.fullPath === editingFolderName
      );
      if (currentFolderBeingEdited && editedFolderName.trim() !== currentFolderBeingEdited.name) {
        // Name changed, save it
        handleRenameFolder(editingFolderName, editedFolderName);
      } else {
        // No change, just close edit mode
        setEditingFolderName(null);
        setEditedFolderName("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder, editingFolderName, editedFolderName, folderTree]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveId(null);
      return;
    }

    const draggedPath = active.id as string;
    const targetPath = over.id as string;

    const draggedFolderId = folderIds.get(draggedPath);
    if (!draggedFolderId) {
      setActiveId(null);
      return;
    }

    // Find the indices in the current folderTree array
    const oldIndex = folderTree.findIndex((f) => f.fullPath === draggedPath);
    const newIndex = folderTree.findIndex((f) => f.fullPath === targetPath);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      setActiveId(null);
      return;
    }

    // Calculate new positions based on the target position
    const updates: Array<{ id: number; position?: number | null }> = [];

    // Get target's current position (use index if position is null)
    const targetCurrentPos = folderPositions.get(targetPath);
    const targetPos = targetCurrentPos !== null && targetCurrentPos !== undefined 
      ? targetCurrentPos 
      : newIndex;

    // Set dragged folder's position to target position
    updates.push({ id: draggedFolderId, position: targetPos });

    // Shift other folders' positions
    folderTree.forEach((folder, idx) => {
      if (folder.fullPath === draggedPath) return;

      const folderId = folderIds.get(folder.fullPath);
      if (!folderId) return;

      const folderCurrentPos = folderPositions.get(folder.fullPath);
      const folderPos = folderCurrentPos !== null && folderCurrentPos !== undefined 
        ? folderCurrentPos 
        : idx;

      if (oldIndex < newIndex) {
        // Moving down: shift folders between old and new positions up by 1
        if (idx > oldIndex && idx <= newIndex) {
          updates.push({ id: folderId, position: folderPos - 1 });
        }
      } else {
        // Moving up: shift folders between new and old positions down by 1
        if (idx >= newIndex && idx < oldIndex) {
          updates.push({ id: folderId, position: folderPos + 1 });
        }
      }
    });

    if (updates.length > 0) {
      // Call parent to persist new positions via API
      onFolderReorder(updates);
    }

    setActiveId(null);
  };

  // Filter folders based on search query
  const filteredFolderTree = folderSearchQuery.trim()
    ? folderTree.filter((folder) =>
        folder.name.toLowerCase().includes(folderSearchQuery.toLowerCase())
      )
    : folderTree;

  // Get folder IDs for SortableContext (use filtered folders)
  const folderIdsArray = filteredFolderTree.map((folder) => folder.fullPath);

  const activeFolder = activeId
    ? filteredFolderTree.find((f) => f.fullPath === activeId)
    : null;

  return (
    <div className="w-52 border-r border-gray-700/50 flex-shrink-0 flex flex-col h-full min-h-0 relative" style={{
      background: 'linear-gradient(to bottom, rgba(23, 37, 84, 0.35) 0%, rgba(23, 37, 84, 0.348) 1%, rgba(23, 37, 85, 0.346) 2%, rgba(23, 38, 85, 0.344) 3%, rgba(23, 38, 85, 0.342) 4%, rgba(23, 38, 86, 0.34) 5%, rgba(23, 38, 86, 0.338) 6%, rgba(23, 38, 86, 0.336) 7%, rgba(23, 39, 87, 0.334) 8%, rgba(23, 39, 87, 0.332) 9%, rgba(23, 39, 88, 0.33) 10%, rgba(23, 39, 88, 0.328) 11%, rgba(23, 39, 88, 0.326) 12%, rgba(22, 39, 88, 0.324) 13%, rgba(22, 39, 87, 0.322) 14%, rgba(22, 38, 87, 0.32) 15%, rgba(22, 38, 87, 0.318) 16%, rgba(22, 38, 87, 0.316) 17%, rgba(22, 38, 87, 0.314) 18%, rgba(22, 38, 87, 0.312) 19%, rgba(22, 38, 87, 0.31) 20%, rgba(22, 38, 86, 0.308) 21%, rgba(22, 38, 86, 0.306) 22%, rgba(22, 37, 86, 0.304) 23%, rgba(22, 37, 85, 0.302) 24%, rgba(22, 37, 85, 0.3) 25%, rgba(22, 37, 85, 0.298) 26%, rgba(22, 37, 85, 0.296) 27%, rgba(22, 37, 85, 0.294) 28%, rgba(22, 37, 85, 0.292) 29%, rgba(22, 37, 85, 0.29) 30%, rgba(21, 37, 84, 0.288) 31%, rgba(21, 37, 84, 0.286) 32%, rgba(21, 36, 84, 0.284) 33%, rgba(21, 36, 83, 0.282) 34%, rgba(21, 36, 83, 0.28) 35%, rgba(21, 36, 83, 0.278) 36%, rgba(21, 35, 82, 0.276) 37%, rgba(21, 35, 82, 0.274) 38%, rgba(20, 35, 82, 0.272) 39%, rgba(20, 35, 82, 0.27) 40%, rgba(20, 34, 81, 0.268) 41%, rgba(20, 34, 81, 0.266) 42%, rgba(20, 34, 80, 0.264) 43%, rgba(20, 34, 80, 0.262) 44%, rgba(20, 34, 80, 0.26) 45%, rgba(20, 33, 79, 0.258) 46%, rgba(20, 33, 79, 0.256) 47%, rgba(19, 33, 78, 0.254) 48%, rgba(19, 33, 78, 0.252) 49%, rgba(19, 32, 77, 0.25) 50%, rgba(19, 32, 77, 0.248) 51%, rgba(19, 32, 76, 0.246) 52%, rgba(19, 32, 76, 0.244) 53%, rgba(19, 31, 75, 0.242) 54%, rgba(19, 31, 75, 0.24) 55%, rgba(18, 31, 74, 0.238) 56%, rgba(18, 31, 74, 0.236) 57%, rgba(18, 30, 73, 0.234) 58%, rgba(18, 30, 73, 0.232) 59%, rgba(18, 30, 72, 0.23) 60%, rgba(18, 29, 71, 0.228) 61%, rgba(18, 29, 71, 0.226) 62%, rgba(18, 29, 70, 0.224) 63%, rgba(18, 29, 70, 0.222) 64%, rgba(18, 29, 70, 0.22) 65%, rgba(17, 28, 69, 0.218) 66%, rgba(17, 28, 69, 0.216) 67%, rgba(17, 28, 68, 0.214) 68%, rgba(17, 28, 68, 0.212) 69%, rgba(17, 27, 67, 0.21) 70%, rgba(17, 27, 67, 0.208) 71%, rgba(17, 27, 66, 0.206) 72%, rgba(17, 27, 66, 0.204) 73%, rgba(17, 26, 65, 0.202) 74%, rgba(17, 26, 65, 0.2) 75%, rgba(17, 26, 64, 0.198) 76%, rgba(17, 26, 64, 0.196) 77%, rgba(17, 25, 62, 0.194) 78%, rgba(17, 25, 62, 0.192) 79%, rgba(17, 25, 60, 0.19) 80%, rgba(17, 24, 58, 0.188) 81%, rgba(17, 24, 58, 0.186) 82%, rgba(17, 24, 56, 0.184) 83%, rgba(17, 24, 56, 0.182) 84%, rgba(17, 24, 54, 0.18) 85%, rgba(17, 24, 54, 0.178) 86%, rgba(17, 24, 52, 0.176) 87%, rgba(17, 24, 52, 0.174) 88%, rgba(17, 24, 50, 0.172) 89%, rgba(17, 24, 50, 0.17) 90%, rgba(17, 24, 48, 0.168) 91%, rgba(17, 24, 48, 0.166) 92%, rgba(17, 24, 46, 0.164) 93%, rgba(17, 24, 46, 0.162) 94%, rgba(17, 24, 44, 0.16) 95%, rgba(17, 24, 42, 0.158) 96%, rgba(17, 24, 42, 0.156) 97%, rgba(17, 24, 40, 0.154) 98%, rgba(17, 24, 39, 0.152) 99%, rgba(17, 24, 39, 0.5) 100%)'
    }}>
      {/* Subtle noise texture overlay to break up gradient banding */}
      <div 
        className="absolute inset-0 pointer-events-none z-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'overlay'
        }}
      />
      <div className="relative z-10 flex flex-col h-full min-h-0">
      {/* Folders Header - at top, ChatGPT style */}
      <div className="px-3 py-2 flex-shrink-0 border-b border-gray-700/30">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Folders
          </h2>
          <button
            type="button"
            onPointerDown={(e) => {
              if (creatingNewFolder) {
                isClosingFolderRef.current = true;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onMouseDown={(e) => {
              if (creatingNewFolder) {
                isClosingFolderRef.current = true;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (creatingNewFolder) {
                // Close if already open
                setCreatingNewFolder(false);
                setNewFolderName("");
                setTimeout(() => {
                  isClosingFolderRef.current = false;
                }, 50);
              } else {
                // Open if closed
                setCreatingNewFolder(true);
                setNewFolderName("");
              }
            }}
            className="text-gray-400 hover:text-gray-200 text-xs px-1.5 py-0.5 rounded hover:bg-gray-700/50 transition-colors"
            title={creatingNewFolder ? "Cancel" : "Add new folder"}
          >
            {creatingNewFolder ? "−" : "+"}
          </button>
        </div>

        {/* Input for creating new folder - appears above search */}
        {creatingNewFolder && (
          <div className="mb-2 p-1.5 border border-gray-700 rounded bg-gray-800/50">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value.replace(/\//g, " "))}
                onBlur={() => {
                  setTimeout(() => {
                    if (isClosingFolderRef.current) {
                      isClosingFolderRef.current = false;
                      return;
                    }
                    // Close on blur if empty, save if not empty
                    if (newFolderName.trim()) {
                      handleCreateNewFolder(newFolderName);
                    } else {
                      setCreatingNewFolder(false);
                      setNewFolderName("");
                    }
                  }, 10);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (newFolderName.trim()) {
                      handleCreateNewFolder(newFolderName);
                    } else {
                      setCreatingNewFolder(false);
                      setNewFolderName("");
                    }
                  } else if (e.key === "Escape") {
                    setCreatingNewFolder(false);
                    setNewFolderName("");
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                placeholder="Folder name..."
                className="flex-1 bg-gray-700 text-gray-100 text-xs px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => handleCreateNewFolder(newFolderName)}
                className="text-xs text-blue-400 hover:text-blue-300 px-1.5"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingNewFolder(false);
                  setNewFolderName("");
                }}
                className="text-xs text-gray-400 hover:text-gray-300 px-1.5"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Search Input */}
        <input
          type="text"
          value={folderSearchQuery}
          onChange={(e) => setFolderSearchQuery(e.target.value)}
          placeholder="Search folders..."
          className="w-full bg-gray-800/50 text-gray-100 text-xs px-2.5 py-1.5 rounded-md border border-gray-700/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder-gray-500"
        />
      </div>

      {/* Scrollable Folder List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 border-t border-gray-700/20">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={folderIdsArray}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-0">
              <button
                type="button"
                onClick={() => onFolderSelect("")}
                className={`w-full text-left pl-4 pr-3 py-1.5 rounded-md text-sm transition-colors ${
                  selectedFolder === null
                    ? "bg-blue-500/10 text-gray-100 font-medium"
                    : "bg-transparent text-gray-300 hover:bg-gray-800/20 hover:text-gray-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>All</span>
                  <span className="text-xs text-gray-500/60">{totalMemories}</span>
                </div>
              </button>
              {filteredFolderTree.map((node, index) => (
                <SortableFolderItem
                  key={node.fullPath}
                  node={node}
                  index={index}
                  selectedFolder={selectedFolder}
                  expandedFolders={expandedFolders}
                  editingFolderName={editingFolderName}
                  editedFolderName={editedFolderName}
                  creatingSubfolder={creatingSubfolder}
                  newSubfolderName={newSubfolderName}
                  onFolderSelect={onFolderSelect}
                  onToggleExpand={onToggleExpand}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  setEditingFolderName={setEditingFolderName}
                  setEditedFolderName={setEditedFolderName}
                  handleCreateSubfolder={handleCreateSubfolder}
                  setCreatingSubfolder={setCreatingSubfolder}
                  setNewSubfolderName={setNewSubfolderName}
                  onFolderClick={(e) => {
                    e.stopPropagation();
                    onFolderSelect(node.fullPath);
                  }}
                  onFolderDoubleClick={(e) => {
                    e.stopPropagation();
                    onFolderSelect(node.fullPath);
                  }}
                  onContextMenuEdit={handleContextMenuEdit}
                  isDeletingRef={isDeletingRef}
                  isContextMenuEditRef={isContextMenuEditRef}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeFolder ? (
              <div className="bg-gray-700/80 px-2 py-1 shadow-lg">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-100 font-semibold">{activeFolder.name}</span>
                  <span className="text-xs text-gray-500/60 ml-auto">
                    {activeFolder.memoryCount}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      </div>
    </div>
  );
}
