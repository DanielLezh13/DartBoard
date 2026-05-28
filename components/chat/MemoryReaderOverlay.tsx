"use client";

import * as React from "react";
import MemoryPreview from "@/components/vault/MemoryPreview";

interface Memory {
  id: number;
  folder_name: string | null;
  title: string | null;
  summary: string;
  doc_json?: string | null;
  excerpt?: string | null;
  created_at: string;
  tags: string | null;
  importance: number | null;
  session_id: number | null;
  message_id: number | null;
  source?: string | null;
}

type DraftMemory = {
  id?: number; // Optional id for drafts (can be -1 or undefined)
  title: string;
  summary: string;
  doc_json?: unknown;
  session_id: number | null;
  message_id: number | null;
  folder_id?: number | null; // Optional folder context
  excerpt?: string | null; // Optional excerpt
  created_at?: string; // Optional created_at for UI consistency
  message_created_at?: string; // Optional message_created_at for UI consistency
  folder_name?: string | null; // Optional folder_name for compatibility
  _isTitleGenerating?: boolean; // Internal flag while async title is being generated
  _isOptimisticTitle?: boolean; // Internal flag to track optimistic titles
};

type MemoryReaderOverlayProps = {
  open: boolean;
  memory: Memory | null;
  draftMemory?: DraftMemory | null;
  folders: string[];
  folderObjects?: Array<{ id: number; name: string }>;
  onFoldersChanged?: () => void | Promise<void>;
  centerPaddingPx: number;
  openDelayMs?: number;
  onClose: () => void;
  onSave: (data: { id: number; title: string; folder_name: string }) => Promise<void> | void;
  onSaveDraft?: (draft: DraftMemory) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onDiscardDraft?: () => void;
  saving?: boolean;
  deleting?: boolean;
  error?: string | null;
  onToolbarVisibleChange?: (visible: boolean) => void;
  forceEditMemoryId?: number | null;
  /** IDs of memories attached to the active session */
  attachedMemoryIds?: number[];
  /** Full attached memories array with pin state */
  attachedMemories?: Array<{ id: number; is_pinned?: number | boolean }>;
  /** Callback to attach a memory to the active session */
  onAttachMemory?: (memoryId: number) => void;
  /** Callback to detach a memory from the active session */
  onDetachMemory?: (memoryId: number) => void;
  /** Session-level usage ratio (0..1) for the brain ring progress */
  usageRatio?: number;
  /** Active session ID for refresh logic */
  activeSessionId?: number | null;
  /** Optional callback to refresh session attachments after detach */
  onRefreshSession?: () => void;
};

/**
 * In-chat-column memory viewer:
 * - Keeps chat mounted (we just fade/disable chat behind it)
 * - Uses fixed positioning within the chat column (NOT a portal modal)
  * - Reveals top→bottom via scaleY + opacity (avoids clip-path "slap" on mount)
 */
export function MemoryReaderOverlay({
  open,
  memory,
  draftMemory = null,
  folders,
  folderObjects,
  onFoldersChanged,
  centerPaddingPx,
  openDelayMs = 0,
  onClose,
  onSave,
  onSaveDraft,
  onDelete,
  onDiscardDraft,
  saving = false,
  deleting = false,
  error = null,
  onToolbarVisibleChange,
  forceEditMemoryId = null,
  attachedMemoryIds = [],
  attachedMemories = [],
  onAttachMemory,
  onDetachMemory,
  usageRatio = 0,
  activeSessionId,
  onRefreshSession,
}: MemoryReaderOverlayProps) {
  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [displayedMemory, setDisplayedMemory] = React.useState<Memory | null>(null);
  const [displayedDraft, setDisplayedDraft] = React.useState<DraftMemory | null>(null);
  const [contentVisible, setContentVisible] = React.useState(true);
  const swapTimerRef = React.useRef<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Only animate on open/close. Swapping `memory` or `draftMemory` should not collapse/expand the overlay.
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      // Always update displayed memory/draft when opening, even if prop is temporarily null
      // This ensures we don't get stuck with stale state from previous memory
      if (memory) {
        setDisplayedMemory(memory);
        setDisplayedDraft(null);
      } else if (draftMemory) {
        setDisplayedDraft(draftMemory);
        setDisplayedMemory(null);
      }
      setContentVisible(true);
      // Pre-position scroll before we fade in (prevents "jump" on mount).
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
      const t = window.setTimeout(() => {
        requestAnimationFrame(() => setVisible(true));
      }, openDelayMs);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 240);
    return () => window.clearTimeout(t);
  }, [open, openDelayMs]);

  // Swap-only crossfade: when open and memory/draft changes, fade out content briefly, swap, then fade in.
  React.useEffect(() => {
    if (!open || !mounted) return; // Only swap when overlay is open and mounted

    // If draft mode ended (save/discard) but we still have a displayed draft, drop it immediately.
    // Otherwise we can get stuck showing the draft UI while the saved memory resolves.
    if (!draftMemory && displayedDraft) {
      setDisplayedDraft(null);
      setContentVisible(true);
      // Continue: if `memory` is now available, the saved-memory logic below will pick it up.
    }
    
    // Handle draft memory (no id-based comparison)
    if (draftMemory) {
      if (!displayedDraft) {
        setDisplayedDraft(draftMemory);
        setDisplayedMemory(null);
        setContentVisible(true);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
        return;
      }
      // Draft changed - swap it (only if content changes, not title)
      if (displayedDraft.summary !== draftMemory.summary) {
        onToolbarVisibleChange?.(false);
        if (swapTimerRef.current != null) {
          window.clearTimeout(swapTimerRef.current);
          swapTimerRef.current = null;
        }
        const FADE_OUT_MS = 120;
        setContentVisible(false);
        swapTimerRef.current = window.setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
          setDisplayedDraft(draftMemory);
          requestAnimationFrame(() => setContentVisible(true));
          swapTimerRef.current = null;
        }, FADE_OUT_MS);
        return () => {
          if (swapTimerRef.current != null) {
            window.clearTimeout(swapTimerRef.current);
            swapTimerRef.current = null;
          }
        };
      }
      return;
    }

    // Handle saved memory
    if (!memory) {
      // If we're switching out of draft mode but the saved memory hasn't resolved yet,
      // keep the overlay mounted but do NOT keep showing the old draft UI.
      if (displayedDraft) setDisplayedDraft(null);
      return;
    }

    // If we don't have a displayed memory yet (first open), just set it.
    if (!displayedMemory) {
      setDisplayedMemory(memory);
      setDisplayedDraft(null);
      setContentVisible(true);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
      return;
    }

    // If same memory id but the object changed (e.g. folder_name updated),
    // update in-place WITHOUT collapsing/expanding or resetting scroll.
    if (displayedMemory.id === memory.id) {
      const needsUpdate =
        displayedMemory.folder_name !== memory.folder_name ||
        displayedMemory.title !== memory.title ||
        displayedMemory.summary !== memory.summary ||
        displayedMemory.doc_json !== memory.doc_json ||
        (displayedMemory.excerpt ?? null) !== (memory.excerpt ?? null) ||
        displayedMemory.tags !== memory.tags ||
        displayedMemory.importance !== memory.importance;

      if (needsUpdate) {
        setDisplayedMemory(memory);
      }
      return;
    }

    // Hide any topbar toolbar during swap (prevents stale toolbar from lingering).
    onToolbarVisibleChange?.(false);

    // Cancel any in-flight swap.
    if (swapTimerRef.current != null) {
      window.clearTimeout(swapTimerRef.current);
      swapTimerRef.current = null;
    }

    const FADE_OUT_MS = 120;
    setContentVisible(false);

    swapTimerRef.current = window.setTimeout(() => {
      // Reset scroll while invisible (prevents "scroll up then down" snap on swap).
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setDisplayedMemory(memory);
      setDisplayedDraft(null);
      requestAnimationFrame(() => setContentVisible(true));
      swapTimerRef.current = null;
    }, FADE_OUT_MS);

    return () => {
      if (swapTimerRef.current != null) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
    };
  }, [
    open,
    mounted,
    memory?.id,
    memory?.folder_name,
    memory?.title,
    memory?.summary,
    memory?.excerpt,
    memory?.tags,
    memory?.importance,
    displayedMemory?.id,
    draftMemory,
    displayedDraft,
    onToolbarVisibleChange,
  ]);

  // Update displayedDraft title without animation when only title changes
  React.useEffect(() => {
    if (!open || !mounted || !draftMemory || !displayedDraft) return;
    
    // Only update if title is different and content is the same
    if (displayedDraft.summary === draftMemory.summary && displayedDraft.title !== draftMemory.title) {
      setDisplayedDraft(draftMemory);
    }
  }, [draftMemory?.title, open, mounted, displayedDraft?.summary, displayedDraft?.title]);

  // Cleanup displayed memory/draft on unmount end (so close animation can run even if props clear early).
  React.useEffect(() => {
    if (mounted) return;
    setDisplayedMemory(null);
    setDisplayedDraft(null);
  }, [mounted]);

  React.useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If there's a draft, discard it; otherwise just close
        if (displayedDraft && onDiscardDraft) {
          onDiscardDraft();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, onClose, displayedDraft, onDiscardDraft]);

  if (!mounted) return null;

  return (
    <div
      className="absolute left-0 right-0 bottom-0 top-[48px] z-50"
      style={{
        opacity: visible ? 1 : 0,
        // Match chat transition rules: opacity-only (avoid motion that reads as "jump").
        transform: "translateY(0px)",
        transition: "opacity 180ms ease-out",
        willChange: "opacity",
        pointerEvents: visible ? "auto" : "none",
        background: "transparent",
      }}
      aria-hidden={!visible}
    >
      {/* Content */}
      <div
        ref={scrollRef}
        className="db-scroll-lane h-full overflow-y-auto"
        style={{
          paddingLeft: centerPaddingPx,
          paddingRight: centerPaddingPx,
          // Prevent browser scroll anchoring from producing a micro-jump as content mounts/swaps.
          overflowAnchor: "none",
        }}
      >
        <div className="w-full max-w-4xl mx-auto py-4">
          {!displayedMemory && !displayedDraft ? (
            <div className="py-10">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 text-xs text-gray-500 italic text-center">
                Loading memory...
              </div>
            </div>
          ) : (
            /* Swap-only crossfade wrapper (keeps open/close animation unchanged). */
            <div
              style={{
                opacity: contentVisible ? 1 : 0,
                transform: "translateY(0px)",
                transition: "opacity 180ms ease-out",
                willChange: "opacity",
                pointerEvents: contentVisible ? "auto" : "none",
              }}
            >
              {/* Flat "doc" surface: no outer card, no rounded container. */}
              <MemoryPreview
                memory={displayedMemory || (displayedDraft ? {
                  id: -1, // Temporary ID for draft
                  folder_id: (displayedDraft as any)?.folder_id ?? null,
                  folder_name: (displayedDraft as any)?.folder_name ?? "Unsorted",
                  title: displayedDraft.title,
                  _isTitleGenerating: (displayedDraft as any)?._isTitleGenerating ?? false,
                  summary: displayedDraft.summary,
                  created_at: new Date().toISOString(),
                  tags: null,
                  importance: null,
                  session_id: displayedDraft.session_id,
                  message_id: displayedDraft.message_id,
                  source: "dartz",
                } : null)}
                folders={folders}
                folderObjects={folderObjects}
                onFoldersChanged={onFoldersChanged}
                onSave={onSave}
                onSaveDraft={onSaveDraft}
                onDelete={onDelete}
                onDiscardDraft={onDiscardDraft}
                saving={saving}
                deleting={deleting}
                error={error}
                embedded
                onCloseEmbedded={onClose}
                embeddedTopBarToolbarTargetId="db-memory-topbar-toolbar"
                onEmbeddedToolbarVisibleChange={onToolbarVisibleChange}
                forceEditMemoryId={forceEditMemoryId || (displayedDraft ? -1 : null)}
                isDraft={!!displayedDraft}
                onEditHandled={() => {
                  // Clear forceEditMemoryId after edit mode is entered
                  if (forceEditMemoryId && displayedMemory?.id === forceEditMemoryId) {
                    // This will be handled by parent clearing the state
                  }
                }}
                attachedMemoryIds={attachedMemoryIds}
                attachedMemories={attachedMemories}
                onAttachMemory={onAttachMemory}
                onDetachMemory={onDetachMemory}
                usageRatio={usageRatio}
                activeSessionId={activeSessionId}
                onRefreshSession={onRefreshSession}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
