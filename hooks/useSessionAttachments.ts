"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { getAuthHeaders } from "@/lib/api";

export type SessionAttachment = {
  session_id: number;
  memory_id: number;
  is_enabled: number;
  is_pinned: number;
  sort_order: number;
  created_at: string;
  title: string | null;
  summary: string;
  folder_name: string;
};

export type SessionUsage = {
  currentTokens: number;
  maxTokens: number;
  usageRatio: number;
};

export function useSessionAttachments(
  activeSessionId: number | null,
  scopeResetKey?: string
) {
  const isGuestScope =
    typeof scopeResetKey === "string" && scopeResetKey.startsWith("guest:");
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<number, SessionAttachment[]>
  >({});
  const [usageBySession, setUsageBySession] = useState<
    Record<number, SessionUsage>
  >({});
  const hydratedSessionsRef = useRef<Set<number>>(new Set());
  const inFlightBySessionRef = useRef<Record<number, number>>({});
  const prevScopeResetKeyRef = useRef<string | undefined>(scopeResetKey);

  const hydrate = useCallback(async (sessionId: number) => {
    if (isGuestScope) return;
    if (hydratedSessionsRef.current.has(sessionId)) return;
    const headers = getAuthHeaders();
    const url = `/api/session-attachments?sessionId=${sessionId}`;
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error("Failed to fetch attachments");
      }
      const serverAttachments = (await response.json()) as SessionAttachment[];
      
      setAttachmentsBySession((prev) => {
        const existing = prev[sessionId] || [];
        const inFlight = inFlightBySessionRef.current[sessionId] || 0;
        
        // If no in-flight operations, replace with server truth
        if (inFlight === 0) {
          return {
            ...prev,
            [sessionId]: serverAttachments,
          };
        }
        
        // Otherwise, merge: server truth + any optimistic adds not yet on server
        const serverById = new Map(serverAttachments.map((a) => [a.memory_id, a]));
        const merged: SessionAttachment[] = [];
        
        // Keep existing optimistic attachments that aren't on server yet
        for (const existingAttach of existing) {
          const serverAttach = serverById.get(existingAttach.memory_id);
          if (serverAttach) {
            // Prefer server version for known attachments
            merged.push(serverAttach);
            serverById.delete(existingAttach.memory_id);
          } else {
            // Keep optimistic attachment not yet on server
            merged.push(existingAttach);
          }
        }
        
        // Add any remaining server attachments not in local state
        merged.push(...serverById.values());
        
        return {
          ...prev,
          [sessionId]: merged,
        };
      });
      
      hydratedSessionsRef.current.add(sessionId);
    } catch (error) {
      console.error("Error hydrating session attachments:", error);
    }
  }, [isGuestScope]);

  const refreshUsage = useCallback(async (sessionId: number) => {
    if (isGuestScope) return;
    try {
      const response = await fetch(
        `/api/session-attachments/usage?session_id=${sessionId}`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch usage");
      }
      const usage = (await response.json()) as SessionUsage;
      setUsageBySession((prev) => ({
        ...prev,
        [sessionId]: usage,
      }));
    } catch (error) {
      console.error("Error refreshing session usage:", error);
    }
  }, [isGuestScope]);

  // Auth/scope boundary: drop stale in-memory attachment state and reload for active session.
  useEffect(() => {
    if (scopeResetKey == null) return;
    if (prevScopeResetKeyRef.current === undefined) {
      prevScopeResetKeyRef.current = scopeResetKey;
      return;
    }
    if (prevScopeResetKeyRef.current === scopeResetKey) return;
    prevScopeResetKeyRef.current = scopeResetKey;

    hydratedSessionsRef.current.clear();
    inFlightBySessionRef.current = {};
    setAttachmentsBySession({});
    setUsageBySession({});

    if (activeSessionId !== null && !isGuestScope) {
      // Rehydrate immediately in the new scope so count/list stay consistent.
      void hydrate(activeSessionId);
      void refreshUsage(activeSessionId);
    }
  }, [scopeResetKey, activeSessionId, hydrate, refreshUsage, isGuestScope]);

  const attachMemoryToSession = useCallback(
    async (sessionId: number, memoryId: number) => {
      if (isGuestScope) {
        throw new Error("Sign in required to attach memories.");
      }
      // First check if already attached
      const current = attachmentsBySession[sessionId] || [];
      if (current.some((a) => a.memory_id === memoryId)) {
        // Already attached locally - throw error to trigger toast
        throw new Error("Already attached");
      }

      // Increment in-flight counter
      inFlightBySessionRef.current[sessionId] = (inFlightBySessionRef.current[sessionId] || 0) + 1;

      const headers = getAuthHeaders();
      const url = "/api/session-attachments";
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId, memoryId }),
        });
        
        if (response.status === 409 || response.status === 400) {
          // Handle both already attached and budget exceeded
          const errorData = await response.json();
          const message = errorData.error || "Failed to attach memory";
          throw new Error(message);
        }
        
        if (!response.ok) {
          throw new Error("Failed to attach memory");
        }
        
        const attachment = (await response.json()) as SessionAttachment;
        
        // Add attachment only after successful server response
        setAttachmentsBySession((prev) => {
          const current = prev[sessionId] || [];
          return {
            ...prev,
            [sessionId]: [...current, attachment],
          };
        });
        
        // Refresh usage after successful attach
        await refreshUsage(sessionId);
      } catch (error) {
        console.error("Error attaching memory:", error);
        // Re-throw to let caller handle toast
        throw error;
      } finally {
        // Decrement in-flight counter
        inFlightBySessionRef.current[sessionId] = Math.max(0, (inFlightBySessionRef.current[sessionId] || 0) - 1);
      }
    },
    [attachmentsBySession, refreshUsage, isGuestScope]
  );

  const detach = useCallback(
    async (sessionId: number, memoryId: number) => {
      if (isGuestScope) {
        throw new Error("Sign in required to modify attachments.");
      }
      // Track in-flight operation
      inFlightBySessionRef.current[sessionId] = (inFlightBySessionRef.current[sessionId] || 0) + 1;
      
      // Optimistic update
      setAttachmentsBySession((prev) => {
        const current = prev[sessionId] || [];
        return {
          ...prev,
          [sessionId]: current.filter((a) => a.memory_id !== memoryId),
        };
      });

      try {
        const response = await fetch("/api/session-attachments", {
          method: "DELETE",
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessionId, memoryId }),
        });
        if (!response.ok) {
          throw new Error("Failed to detach memory");
        }
        // Refresh usage after successful detach
        await refreshUsage(sessionId);
      } catch (error) {
        console.error("Error detaching memory:", error);
        // Re-hydrate on error to restore correct state
        hydratedSessionsRef.current.delete(sessionId);
        await hydrate(sessionId);
      } finally {
        // Decrement in-flight counter
        inFlightBySessionRef.current[sessionId] = Math.max(0, (inFlightBySessionRef.current[sessionId] || 0) - 1);
      }
    },
    [hydrate, refreshUsage, isGuestScope]
  );

  const toggleEnabled = useCallback(
    async (
      sessionId: number,
      memoryId: number,
      enabled: boolean
    ) => {
      if (isGuestScope) {
        throw new Error("Sign in required to modify attachments.");
      }
      // Optimistic update
      setAttachmentsBySession((prev) => {
        const current = prev[sessionId] || [];
        return {
          ...prev,
          [sessionId]: current.map((a) =>
            a.memory_id === memoryId
              ? { ...a, is_enabled: enabled ? 1 : 0 }
              : a
          ),
        };
      });

      try {
        const response = await fetch("/api/session-attachments", {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            sessionId,
            memoryId,
            is_enabled: enabled,
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to toggle attachment");
        }
        const attachment = (await response.json()) as SessionAttachment;
        // Update with server response
        setAttachmentsBySession((prev) => {
          const current = prev[sessionId] || [];
          return {
            ...prev,
            [sessionId]: current.map((a) =>
              a.memory_id === memoryId ? attachment : a
            ),
          };
        });
        // Refresh usage after successful toggle
        await refreshUsage(sessionId);
      } catch (error) {
        console.error("Error toggling attachment:", error);
        // Re-hydrate on error
        hydratedSessionsRef.current.delete(sessionId);
        await hydrate(sessionId);
      }
    },
    [hydrate, refreshUsage, isGuestScope]
  );

  // Auto-hydrate and refresh usage when activeSessionId changes
  useEffect(() => {
    if (activeSessionId !== null && !isGuestScope) {
      hydrate(activeSessionId);
      refreshUsage(activeSessionId);
    }
  }, [activeSessionId, hydrate, refreshUsage, isGuestScope]);

  // Get attachments for a specific session
  const getAttachments = useCallback(
    (sessionId: number | null): SessionAttachment[] => {
      if (sessionId === null) return [];
      return attachmentsBySession[sessionId] || [];
    },
    [attachmentsBySession]
  );

  // Get memory IDs for a specific session
  const getMemoryIds = useCallback(
    (sessionId: number | null): number[] => {
      return getAttachments(sessionId)
        .filter((a) => a.is_enabled === 1)
        .map((a) => a.memory_id);
    },
    [getAttachments]
  );

  // Get usage for a specific session
  const getUsage = useCallback(
    (sessionId: number | null): SessionUsage | null => {
      if (sessionId === null) return null;
      return usageBySession[sessionId] || null;
    },
    [usageBySession]
  );

  // Toggle pin state for a memory
  const togglePin = useCallback(async (sessionId: number, memoryId: number) => {
    try {
      const response = await fetch("/api/session-attachments/pin", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ sessionId, memoryId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to toggle pin state (${response.status})`;
        console.error("Pin toggle failed:", errorMessage);
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Update local state with new pin state
      setAttachmentsBySession((prev) => {
        const sessionAttachments = prev[sessionId] || [];
        const updated = sessionAttachments.map((att) =>
          att.memory_id === memoryId
            ? { ...att, is_pinned: result.is_pinned }
            : att
        );
        return { ...prev, [sessionId]: updated };
      });

      return result;
    } catch (err) {
      console.error("Error toggling pin:", err);
      throw err;
    }
  }, []);

  return {
    attachmentsBySession,
    usageBySession,
    getAttachments,
    getMemoryIds,
    getUsage,
    attach: attachMemoryToSession,
    detach,
    toggleEnabled,
    togglePin,
    hydrate,
    refreshUsage,
  };
}
