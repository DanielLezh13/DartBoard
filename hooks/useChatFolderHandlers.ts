"use client";

import { useCallback } from "react";

export function useChatFolderHandlers(args: {
  folders: Array<{ id: number; name: string }>;
  sidebarSessions: Array<{ id: number; inFolderId?: number | null }>;
  sessions: Array<{ id: number }>;
  selectedFolderId: number | null;
  setFolders: (folders: any) => void;
  setSidebarSessions: (sessions: any) => void;
  setSessions: (sessions: any) => void;
  setSelectedFolderId: (id: number | null) => void;
  setStartRenameFolderId: (id: number | null) => void;
  startRenameFolderId: number | null;
  saveFolderPersist: (folders: any, sidebarSessions: any) => void;
}) {
  const {
    folders,
    sidebarSessions,
    sessions,
    selectedFolderId,
    setFolders,
    setSidebarSessions,
    setSessions,
    setSelectedFolderId,
    setStartRenameFolderId,
    startRenameFolderId,
    saveFolderPersist,
  } = args;

  const handleCreateFolder = useCallback(() => {
    setFolders((prev: Array<{ id: number; name: string }>) => {
      const nextId = prev.length ? Math.max(...prev.map((f) => f.id)) + 1 : 1;
      const updated = [
        ...prev,
        {
          id: nextId,
          name: "New Folder",
        },
      ];
      // Persist to localStorage
      saveFolderPersist(updated, sidebarSessions);
      return updated;
    });
  }, [setFolders, sidebarSessions, saveFolderPersist]);

  const handleRenameFolder = useCallback((id: number, newName: string) => {
    // Clear start rename trigger after rename completes
    if (startRenameFolderId === id) {
      setStartRenameFolderId(null);
    }
    setFolders((prev: Array<{ id: number; name: string }>) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, name: newName } : f));
      // Persist to localStorage
      saveFolderPersist(updated, sidebarSessions);
      return updated;
    });
  }, [setFolders, sidebarSessions, saveFolderPersist, startRenameFolderId, setStartRenameFolderId]);

  const handleDeleteFolder = useCallback((id: number) => {
    // Compute next state values first (avoid nested setState + stale state)
    const nextSidebarSessions = sidebarSessions.map((s) => 
      s.inFolderId === id ? { ...s, inFolderId: null } : s
    );
    const nextFolders = folders.filter((f) => f.id !== id);

    // Set all states
    setSidebarSessions(nextSidebarSessions);
    setFolders(nextFolders);

    // Persist once with computed values
    saveFolderPersist(nextFolders, nextSidebarSessions);

    // If deleted folder was selected, switch to Unfiled
    if (selectedFolderId === id) {
      setSelectedFolderId(null);
    }
  }, [folders, sidebarSessions, selectedFolderId, setFolders, setSidebarSessions, setSelectedFolderId, saveFolderPersist]);

  const handleDeleteFolderAndChats = useCallback((id: number) => {
    // Compute next state values first (avoid nested setState + stale state)
    // Remove sessions that are inside the folder from both sessions and sidebarSessions
    const folderSessionIds = sidebarSessions
      .filter((s) => s.inFolderId === id)
      .map((s) => s.id);
    
    const nextSidebarSessions = sidebarSessions.filter((s) => s.inFolderId !== id);
    const nextSessions = sessions.filter((s) => !folderSessionIds.includes(s.id));
    const nextFolders = folders.filter((f) => f.id !== id);

    // Set all states
    setSidebarSessions(nextSidebarSessions);
    setSessions(nextSessions);
    setFolders(nextFolders);

    // Persist once with computed values
    saveFolderPersist(nextFolders, nextSidebarSessions);

    // If deleted folder was selected, switch to Unfiled
    if (selectedFolderId === id) {
      setSelectedFolderId(null);
    }
  }, [folders, sidebarSessions, sessions, selectedFolderId, setFolders, setSidebarSessions, setSessions, setSelectedFolderId, saveFolderPersist]);

  return {
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleDeleteFolderAndChats,
  };
}






