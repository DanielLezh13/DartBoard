"use client";

import type React from "react";
import { Fragment, useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Send, Clock, Search, Camera, Globe, X, Brain, Plus, Loader2, MessageSquare } from "lucide-react";
import { IconDartboard } from "@/components/ui/IconDartboard";
import { BrainUsageRing } from "./BrainUsageRing";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import { useToast } from "@/components/ui/Toast";
import type { DartzModeId } from "@/lib/modes";
import { getModeSpec, DARTZ_MODES } from "@/lib/modes";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_MESSAGE, MAX_INPUT_CHARS } from "@/lib/limits";

// Send icon component (arrow only, no circle)
function SendIconArrowUp({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M9 12.5V6M9 6L6 9M9 6L12 9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Landing tips (only shown in landing variant)
const LANDING_TIPS = [
  "Tip: Ask for a plan, then ask for the diff.",
  "Tip: Paste errors; I'll patch the file.",
  "Tip: Be specific about what you want changed.",
];

const MAX_IMAGES = MAX_IMAGES_PER_MESSAGE;
const MAX_FILES = 5;
const MAX_TOTAL_ATTACHMENTS = 8;
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_BYTES;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
const ATTACHMENT_TRAY_EXPAND_MS = 300;

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpg", "image/jpeg", "image/webp"];
const ALLOWED_FILE_TYPES = ["application/pdf", "text/plain", "text/markdown", "text/csv"];

type CollapsingGap = {
  key: string;
  height: number;
  afterId: number | null;
  phase: "prepare" | "collapse";
};

const BRAIN_BODY_MAX_HEIGHT = 240;
const BRAIN_BODY_VERTICAL_PADDING = 16; // p-2 => 8 top + 8 bottom
const BRAIN_BODY_EXPAND_MS = 260;
const BRAIN_LIST_ROW_GAP_PX = 2; // matches space-y-0.5
const BRAIN_REVEAL_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

export interface FloatingChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  disabled?: boolean;
  mode: DartzModeId;
  onModeChange: (mode: DartzModeId) => void;
  placeholder?: string;
  onHeightChange?: (height: number) => void;
  onOpenTimeline?: () => void;
  timelinePopup?: React.ReactNode;
  // Search mode props
  searchMode?: boolean;
  onToggleSearchMode?: () => void;
  onRunSearch?: () => void;
  canRunSearch?: boolean;
  hitsBadge?: number | null;
  searchRole?: "all" | "user" | "assistant";
  onSearchRoleChange?: (role: "all" | "user" | "assistant") => void;
  searchMatchMode?: "and" | "or";
  onSearchMatchModeChange?: (mode: "and" | "or") => void;
  onClearSearch?: () => void;
  searchTags?: string[];
  onRemoveSearchTag?: (tag: string) => void;
  maxSearchTags?: number;
  // Attached memories props
  attachedMemoryCount?: number;
  attachedMemories?: Array<{
    id: number;
    title: string | null;
    folder_name: string;
    is_pinned?: number;
  }>;
  activeSessionId?: number | null;
  scopeKind?: string | null;
  isContextWarning?: boolean;
  chatFullState?: "unknown" | "normal" | "full";
  // Guest mode props
  guestMessageCount?: number;
  GUEST_MESSAGE_LIMIT?: number;
  moveAttachedMemory?: (memoryId: number) => void;
  onRemoveAttachedMemory?: (memoryId: number) => void;
  onClearAttachedMemories?: () => void;
  onTogglePin?: (memoryId: number) => Promise<void> | void;
  // Token-based usage for BrainUsageRing
  usageRatio?: number;
  // Session lifetime ratio for composer state
  sessionLifetimeRatio?: number;
  // Callback for when Send is clicked in full state
  onGenerateNewChat?: () => void;
  // Drag state
  activeDragId?: string | null;
  // Layout variant
  variant?: "docked" | "landing";
  // Disable transitions (for cold landing boot)
  disableTransitions?: boolean;
  // Attachments callback
  onAttachmentsChange?: (attachments: File[]) => void;
  attachmentsResetToken?: number;
  // Focus state
  focusEnabled?: boolean;
  focusText?: string;
  onFocusSave?: (text: string) => Promise<void> | void;
  onFocusToggle?: (enabled: boolean) => Promise<void> | void;
  onFocusClear?: () => Promise<void> | void;
  // Memory reader
  onOpenAttachedMemory?: (memoryId: number) => void;
  // Search mode state
  isSearchMode?: boolean;
  // One-turn web search toggle
  webSearchArmed?: boolean;
  onToggleWebSearch?: () => void;
}

export function FloatingChatComposer({
  value,
  onChange,
  onSend,
  isSending,
  disabled = false,
  mode,
  onModeChange,
  placeholder,
  onHeightChange,
  onOpenTimeline,
  timelinePopup,
  searchMode = false,
  onToggleSearchMode,
  onRunSearch,
  canRunSearch = false,
  hitsBadge = null,
  searchRole = "all",
  onSearchRoleChange,
  searchMatchMode = "and",
  onSearchMatchModeChange,
  onClearSearch,
  searchTags = [],
  onRemoveSearchTag,
  maxSearchTags = MAX_IMAGES_PER_MESSAGE,
  attachedMemories = [],
  attachedMemoryCount = 0,
  guestMessageCount = 0,
  GUEST_MESSAGE_LIMIT = 10,
  activeSessionId,
  scopeKind = null,
  onRemoveAttachedMemory,
  onClearAttachedMemories,
  onTogglePin,
  usageRatio,
  activeDragId,
  variant = "docked",
  disableTransitions = false,
  onAttachmentsChange,
  attachmentsResetToken = 0,
  focusEnabled = false,
  focusText = "",
  onFocusSave,
  onFocusToggle,
  onOpenAttachedMemory,
  isSearchMode = false,
  webSearchArmed = false,
  onToggleWebSearch,
  isContextWarning = false,
  chatFullState = "unknown",
  sessionLifetimeRatio,
  onGenerateNewChat,
}: FloatingChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentContentVisible, setAttachmentContentVisible] = useState(false);
  const attachmentRevealTimeoutRef = useRef<number | null>(null);
  const prevAttachmentsResetTokenRef = useRef<number>(attachmentsResetToken);
  const [expandedComposerImageUrl, setExpandedComposerImageUrl] = useState<string | null>(null);
  const prevComposerContextRef = useRef<{ sessionId: number | null; variant: "docked" | "landing" } | null>(null);
  
  // Check if any memories are injected (pinned) - reactive to attachedMemories changes
  const hasInjectedMemories = useMemo(() => 
    attachedMemories.length > 0 && attachedMemories.some(m => m.is_pinned === 1), 
    [attachedMemories]
  );
  
  const { showToast } = useToast();

  const attachmentPreviewUrls = useMemo(
    () =>
      attachments.map((file) =>
        ALLOWED_IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : null
      ),
    [attachments]
  );

  useEffect(() => {
    return () => {
      for (const previewUrl of attachmentPreviewUrls) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }
    };
  }, [attachmentPreviewUrls]);

  // Composer context boundary: when switching sessions or entering landing,
  // clear transient attachment state so nothing leaks across chats.
  useEffect(() => {
    const prev = prevComposerContextRef.current;
    const next = { sessionId: activeSessionId ?? null, variant };
    if (prev && (prev.sessionId !== next.sessionId || prev.variant !== next.variant)) {
      setAttachments([]);
      setExpandedComposerImageUrl(null);
    }
    prevComposerContextRef.current = next;
  }, [activeSessionId, variant]);
  
  // Focus popover state
  const [focusPopoverOpen, setFocusPopoverOpen] = useState(false);
  const [focusInput, setFocusInput] = useState(focusText || "");
  const focusPopoverRef = useRef<HTMLDivElement>(null);
  const focusAnchorRef = useRef<HTMLButtonElement>(null);
  const [focusPopoverPos, setFocusPopoverPos] = useState<{ left: number; top: number } | null>(null);
  const [isUpdatingFocus, setIsUpdatingFocus] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const focusDriftHandledRef = useRef(false);
  const timelineAnchorRef = useRef<HTMLButtonElement>(null);
  const timelineSearchAnchorRef = useRef<HTMLButtonElement>(null);
  const timelinePopoverRef = useRef<HTMLDivElement>(null);
  const [timelinePopoverPos, setTimelinePopoverPos] = useState<{ left: number; top: number } | null>(null);
  
  // Notify parent of attachment changes
  useEffect(() => {
    onAttachmentsChange?.(attachments);
  }, [attachments, onAttachmentsChange]);

  useEffect(() => {
    return () => {
      if (attachmentRevealTimeoutRef.current) {
        window.clearTimeout(attachmentRevealTimeoutRef.current);
        attachmentRevealTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (searchMode) {
      setAttachmentContentVisible(false);
      return;
    }

    if (attachments.length === 0) {
      if (attachmentRevealTimeoutRef.current) {
        window.clearTimeout(attachmentRevealTimeoutRef.current);
        attachmentRevealTimeoutRef.current = null;
      }
      setAttachmentContentVisible(false);
      return;
    }

    if (disableTransitions) {
      setAttachmentContentVisible(true);
      return;
    }

    if (attachmentContentVisible) return;
    if (attachmentRevealTimeoutRef.current) {
      window.clearTimeout(attachmentRevealTimeoutRef.current);
    }
    attachmentRevealTimeoutRef.current = window.setTimeout(() => {
      setAttachmentContentVisible(true);
      attachmentRevealTimeoutRef.current = null;
    }, ATTACHMENT_TRAY_EXPAND_MS);
  }, [attachments.length, searchMode, disableTransitions, attachmentContentVisible]);

  useEffect(() => {
    if (prevAttachmentsResetTokenRef.current === attachmentsResetToken) return;
    prevAttachmentsResetTokenRef.current = attachmentsResetToken;
    setAttachments([]);
    setExpandedComposerImageUrl(null);
  }, [attachmentsResetToken]);
  
  // Clear attachments ONLY after a send completes.
  // NOTE: We must not key this off `value === ''` because that is also true when the
  // composer is empty and the user is merely attaching files.
  const prevIsSendingRef = useRef<boolean>(isSending);
  useEffect(() => {
    const wasSending = prevIsSendingRef.current;
    if (wasSending && !isSending) {
      // Send just completed -> clear attachments
      setAttachments([]);
      setExpandedComposerImageUrl(null);
    }
    prevIsSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    if (!expandedComposerImageUrl) return;
    if (!attachmentPreviewUrls.includes(expandedComposerImageUrl)) {
      setExpandedComposerImageUrl(null);
    }
  }, [expandedComposerImageUrl, attachmentPreviewUrls]);
  
  // Sync focus input when focusText prop changes
  useEffect(() => {
    setFocusInput(focusText || "");
  }, [focusText]);

  useEffect(() => {
    if (!focusEnabled) {
      focusDriftHandledRef.current = false;
    }
  }, [focusEnabled]);
  
  // Focus popover handlers
  const handleFocusClick = () => {
    if (isSearchMode) return;
    setFocusPopoverOpen(v => !v);
  };
  
  const handleFocusSelectToggle = async () => {
    if (!onFocusToggle) return;
    const nextFocus = focusInput.trim();
    const savedFocus = (focusText || "").trim();

    setFocusError(null);
    setIsUpdatingFocus(true);
    try {
      if (focusEnabled) {
        await onFocusToggle(false);
        return;
      }
      if (!nextFocus) {
        setFocusError("Add a focus topic first.");
        return;
      }
      if (nextFocus !== savedFocus) {
        if (!onFocusSave) {
          setFocusError("Unable to save focus topic.");
          return;
        }
        await onFocusSave(nextFocus);
      } else if (!savedFocus) {
        setFocusError("Add a focus topic first.");
        return;
      }
      await onFocusToggle(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update focus.";
      setFocusError(message);
    } finally {
      setIsUpdatingFocus(false);
    }
  };
  
  const handleFocusInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\n/g, '').slice(0, 60);
    setFocusInput(value);
    if (focusError) {
      setFocusError(null);
    }
    const normalizedNext = value.trim();
    const normalizedSaved = (focusText || "").trim();

    // If user edits away from the currently-selected focus text, auto-deselect once.
    // This avoids stale "selected" state while they are drafting a new focus.
    if (focusEnabled && normalizedNext !== normalizedSaved && !focusDriftHandledRef.current && !isUpdatingFocus) {
      focusDriftHandledRef.current = true;
      setIsUpdatingFocus(true);
      void Promise.resolve(onFocusToggle?.(false))
        .catch((error) => {
          focusDriftHandledRef.current = false;
          const message = error instanceof Error ? error.message : "Failed to update focus.";
          setFocusError(message);
        })
        .finally(() => {
          setIsUpdatingFocus(false);
        });
      return;
    }

    if (normalizedNext === normalizedSaved) {
      focusDriftHandledRef.current = false;
    }
  };
  
  const MAX_TEXTAREA_HEIGHT = 102; // ~5–6 lines
  
  // Brain popover state
  const [brainPopoverOpen, setBrainPopoverOpen] = useState(false);
  const brainPopoverRef = useRef<HTMLDivElement>(null);
  const brainAnchorRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const brainListContentRef = useRef<HTMLDivElement>(null);
  const brainRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const brainGapRemoveTimersRef = useRef<Map<string, number>>(new Map());
  const prevAttachedMemoryCountRef = useRef(attachedMemories.length);
  const [brainPopoverPos, setBrainPopoverPos] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  } | null>(null);
  const [brainAnimatedBodyHeight, setBrainAnimatedBodyHeight] = useState(0);
  const [brainCollapsingGaps, setBrainCollapsingGaps] = useState<CollapsingGap[]>([]);

  // Handle brain click in popup - toggle all memories injection state
  const handlePopupBrainClick = useCallback(async () => {
    if (attachedMemories.length === 0) {
      return;
    }

    const allInjected = attachedMemories.every(m => m.is_pinned === 1);
    
    if (allInjected) {
      // All injected - uninject all
      for (const memory of attachedMemories) {
        if (onTogglePin) {
          await onTogglePin(memory.id);
        }
      }
    } else {
      // None or mixed - inject all
      for (const memory of attachedMemories) {
        if (memory.is_pinned !== 1 && onTogglePin) {
          await onTogglePin(memory.id);
        }
      }
    }
  }, [attachedMemories, onTogglePin]);

  const clearBrainGapTimers = useCallback(() => {
    for (const timerId of brainGapRemoveTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    brainGapRemoveTimersRef.current.clear();
  }, []);

  const readBrainTargetHeight = useCallback(() => {
    const content = brainListContentRef.current;
    if (!content) return 0;
    const naturalHeight = content.offsetHeight + BRAIN_BODY_VERTICAL_PADDING;
    return Math.max(0, Math.min(naturalHeight, BRAIN_BODY_MAX_HEIGHT));
  }, []);

  const applyBrainAnimatedHeight = useCallback((nextHeight: number) => {
    const clamped = Math.max(0, Math.min(nextHeight, BRAIN_BODY_MAX_HEIGHT));
    setBrainAnimatedBodyHeight(clamped);
  }, []);

  const measureBrainBodyHeight = useCallback(() => {
    applyBrainAnimatedHeight(readBrainTargetHeight());
  }, [applyBrainAnimatedHeight, readBrainTargetHeight]);

  useLayoutEffect(() => {
    if (!brainPopoverOpen) {
      clearBrainGapTimers();
      setBrainCollapsingGaps([]);
      setBrainAnimatedBodyHeight(0);
      prevAttachedMemoryCountRef.current = attachedMemories.length;
      return;
    }

    const prevCount = prevAttachedMemoryCountRef.current;
    const nextCount = attachedMemories.length;
    prevAttachedMemoryCountRef.current = nextCount;

    if (nextCount < prevCount && brainCollapsingGaps.length > 0) {
      return;
    }

    measureBrainBodyHeight();
  }, [
    attachedMemories.length,
    brainCollapsingGaps.length,
    brainPopoverOpen,
    clearBrainGapTimers,
    measureBrainBodyHeight,
  ]);

  useEffect(() => {
    if (!brainPopoverOpen) return;
    const content = brainListContentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      if (brainCollapsingGaps.length > 0) return;
      measureBrainBodyHeight();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [brainCollapsingGaps.length, brainPopoverOpen, measureBrainBodyHeight]);

  useEffect(() => {
    return clearBrainGapTimers;
  }, [clearBrainGapTimers]);

  const handleRemoveAttachedMemoryWithAnimation = useCallback((memoryId: number) => {
    if (!onRemoveAttachedMemory) return;

    const index = attachedMemories.findIndex((memory) => memory.id === memoryId);
    if (index === -1) {
      onRemoveAttachedMemory(memoryId);
      return;
    }

    // Last row -> empty-state transition: animate directly to the empty-state height
    // instead of inserting a collapsing seam gap (prevents height overshoot flicker).
    if (attachedMemories.length === 1) {
      onRemoveAttachedMemory(memoryId);
      window.requestAnimationFrame(() => {
        measureBrainBodyHeight();
      });
      return;
    }

    const isDeletingLast = index === attachedMemories.length - 1;
    if (isDeletingLast) {
      onRemoveAttachedMemory(memoryId);
      window.requestAnimationFrame(() => {
        measureBrainBodyHeight();
      });
      return;
    }

    const afterId = index > 0 ? attachedMemories[index - 1]?.id ?? null : null;
    const rowHeight = Math.max(1, brainRowRefs.current.get(memoryId)?.offsetHeight ?? 0);
    const collapseDistance = rowHeight + BRAIN_LIST_ROW_GAP_PX;
    const content = brainListContentRef.current;
    const naturalStart = content ? content.offsetHeight + BRAIN_BODY_VERTICAL_PADDING : brainAnimatedBodyHeight;
    const naturalEnd = Math.max(0, naturalStart - collapseDistance);
    const clampedEnd = Math.max(0, Math.min(naturalEnd, BRAIN_BODY_MAX_HEIGHT));
    const gapKey = `${memoryId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setBrainCollapsingGaps((prev) => [
      ...prev,
      { key: gapKey, height: collapseDistance, afterId, phase: "prepare" },
    ]);
    onRemoveAttachedMemory(memoryId);
    applyBrainAnimatedHeight(clampedEnd);

    window.requestAnimationFrame(() => {
      setBrainCollapsingGaps((prev) =>
        prev.map((gap) => (gap.key === gapKey ? { ...gap, phase: "collapse" } : gap))
      );
    });

    const timerId = window.setTimeout(() => {
      brainGapRemoveTimersRef.current.delete(gapKey);
      setBrainCollapsingGaps((prev) => prev.filter((gap) => gap.key !== gapKey));
    }, BRAIN_BODY_EXPAND_MS);
    brainGapRemoveTimersRef.current.set(gapKey, timerId);
  }, [applyBrainAnimatedHeight, attachedMemories, brainAnimatedBodyHeight, measureBrainBodyHeight, onRemoveAttachedMemory]);

  const topBrainGaps = useMemo(
    () => brainCollapsingGaps.filter((gap) => gap.afterId == null),
    [brainCollapsingGaps]
  );

  const brainGapsByAfterId = useMemo(() => {
    const map = new Map<number, CollapsingGap[]>();
    for (const gap of brainCollapsingGaps) {
      if (gap.afterId == null) continue;
      const list = map.get(gap.afterId) ?? [];
      list.push(gap);
      map.set(gap.afterId, list);
    }
    return map;
  }, [brainCollapsingGaps]);

  // Handle brain click - open popup (composer only opens popup, landing toggles injection)
  const handleBrainClick = useCallback(() => {
    setBrainPopoverOpen(!brainPopoverOpen);
  }, [brainPopoverOpen]);

  // Click outside handler for brain popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        brainPopoverRef.current &&
        !brainPopoverRef.current.contains(event.target as Node) &&
        brainAnchorRef.current &&
        !brainAnchorRef.current.contains(event.target as Node)
      ) {
        setBrainPopoverOpen(false);
      }
    };

    if (brainPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [brainPopoverOpen]);

  // Click outside handler for focus popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        focusPopoverRef.current &&
        !focusPopoverRef.current.contains(event.target as Node) &&
        focusAnchorRef.current &&
        !focusAnchorRef.current.contains(event.target as Node)
      ) {
        setFocusPopoverOpen(false);
      }
    };

    if (focusPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [focusPopoverOpen]);
  
  // Position focus popover so it never clips (portal + fixed positioning + viewport clamp)
  useLayoutEffect(() => {
    if (!focusPopoverOpen) {
      setFocusPopoverPos(null);
      return;
    }

    const place = () => {
      const anchor = focusAnchorRef.current;
      const pop = focusPopoverRef.current;
      if (!anchor || !pop) return;

      const a = anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const padding = 12;

      // center horizontally on anchor
      let left = a.left + a.width / 2 - p.width / 2;
      left = Math.max(padding, Math.min(left, window.innerWidth - padding - p.width));

      // prefer above, else below
      let top = a.top - 12 - p.height;
      if (top < padding) top = Math.min(window.innerHeight - padding - p.height, a.bottom + 12);

      setFocusPopoverPos({ left, top });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [focusPopoverOpen]);

  // Position timeline popover so it never clips (portal + fixed positioning + viewport clamp)
  useLayoutEffect(() => {
    if (!timelinePopup) {
      setTimelinePopoverPos(null);
      return;
    }

    const place = () => {
      const anchor = isSearchMode ? timelineSearchAnchorRef.current : timelineAnchorRef.current;
      const pop = timelinePopoverRef.current;
      if (!anchor || !pop) return;

      const a = anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const padding = 12;

      // Center on anchor, then clamp within viewport.
      let left = a.left + a.width / 2 - p.width / 2;
      left = Math.max(padding, Math.min(left, window.innerWidth - padding - p.width));

      // Prefer above anchor; if insufficient space, place below.
      let top = a.top - 12 - p.height;
      if (top < padding) top = Math.min(window.innerHeight - padding - p.height, a.bottom + 12);

      setTimelinePopoverPos({ left, top });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [timelinePopup, isSearchMode]);

  // Position popover so it never clips (portal + fixed positioning + viewport clamp)
  useLayoutEffect(() => {
    if (!brainPopoverOpen) {
      setBrainPopoverPos(null);
      return;
    }

    const place = () => {
      const anchor = brainAnchorRef.current;
      const pop = brainPopoverRef.current;
      if (!anchor || !pop) return;

      const a = anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const padding = 12;
      const offset = 12;

      // Center horizontally on anchor, then clamp within viewport.
      let left = a.left + a.width / 2 - p.width / 2;
      left = Math.max(padding, Math.min(left, window.innerWidth - padding - p.width));

      // Use fixed anchor line + translateY for above placement.
      // This keeps the bottom edge visually stable while content height animates.
      const aboveTop = a.top - offset;
      const belowTop = a.bottom + offset;
      const spaceAbove = aboveTop - padding;
      const spaceBelow = window.innerHeight - belowTop - padding;
      const placement: "above" | "below" =
        spaceAbove >= p.height || spaceAbove >= spaceBelow ? "above" : "below";
      const top = placement === "above" ? aboveTop : belowTop;

      setBrainPopoverPos({ left, top, placement });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // capture scroll from containers too
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [brainPopoverOpen]);

  // Caption typewriter state
  const [captionText, setCaptionText] = useState("");
  const [captionTarget, setCaptionTarget] = useState("");
  const typewriterRef = useRef<number | null>(null);
  const rotationRef = useRef<number | null>(null);
  const rotationIndexRef = useRef(0);

  // Get current mode description from getModeSpec
  const modeSpec = getModeSpec(mode);

  // Typewriter effect
  useEffect(() => {
    if (!captionTarget) return;

    // Clear any existing typewriter
    if (typewriterRef.current) {
      window.clearInterval(typewriterRef.current);
      typewriterRef.current = null;
    }

    // Start with empty, then type after delay
    setCaptionText("");
    let charIndex = 0;

    const startTyping = () => {
      typewriterRef.current = window.setInterval(() => {
        if (charIndex < captionTarget.length) {
          setCaptionText(captionTarget.slice(0, charIndex + 1));
          charIndex++;
        } else {
          if (typewriterRef.current) {
            window.clearInterval(typewriterRef.current);
            typewriterRef.current = null;
          }
        }
      }, 22); // ~22ms per char
    };

    const delayTimer = window.setTimeout(startTyping, 400);

    return () => {
      window.clearTimeout(delayTimer);
      if (typewriterRef.current) {
        window.clearInterval(typewriterRef.current);
        typewriterRef.current = null;
      }
    };
  }, [captionTarget]);

  // Set initial caption target based on mode
  useEffect(() => {
    setCaptionTarget(modeSpec.description);
    rotationIndexRef.current = 0;
  }, [mode, modeSpec.description]);

  // Landing rotation: cycle through mode description + tips every 15s
  useEffect(() => {
    if (variant !== "landing") {
      // Docked: no rotation
      if (rotationRef.current) {
        window.clearInterval(rotationRef.current);
        rotationRef.current = null;
      }
      return;
    }

    // Build rotation list: mode description first, then tips
    const rotationList = [modeSpec.description, ...LANDING_TIPS];

    rotationRef.current = window.setInterval(() => {
      rotationIndexRef.current = (rotationIndexRef.current + 1) % rotationList.length;
      setCaptionTarget(rotationList[rotationIndexRef.current]);
    }, 15000);

    return () => {
      if (rotationRef.current) {
        window.clearInterval(rotationRef.current);
        rotationRef.current = null;
      }
    };
  }, [variant, mode, modeSpec.description]);

  // Auto-expand textarea before paint so landing lift compensation can update
  // without a visible "grow up then drop down" frame.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${newHeight}px`;
    if (onHeightChange && containerRef.current) {
      onHeightChange(containerRef.current.offsetHeight);
    }
  }, [value, onHeightChange]);

  // Track container height changes with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onHeightChange) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        onHeightChange(height);
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [onHeightChange]);

  const guestWarningThreshold = Math.max(1, Math.ceil(GUEST_MESSAGE_LIMIT * 0.8));
  const isGuestNearLimit = guestMessageCount >= guestWarningThreshold && guestMessageCount < GUEST_MESSAGE_LIMIT;
  const isGuestAtLimit = guestMessageCount >= GUEST_MESSAGE_LIMIT;
  const guestLimitBlocked = scopeKind === "guest" && isGuestAtLimit;
  const effectiveDisabled = disabled || guestLimitBlocked;
  const showSessionFullUI = chatFullState === "full" && scopeKind !== "guest";
  const composerFullState = chatFullState === "full" || (scopeKind === "guest" && isGuestAtLimit);

  // Determine if primary action is actionable
  const canPrimary =
    !effectiveDisabled &&
    (isSearchMode
      ? canRunSearch
      : showSessionFullUI
      ? Boolean(onGenerateNewChat)
      : !isSending && value.trim().length > 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (effectiveDisabled) return;
    
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (searchMode && onRunSearch && canRunSearch) {
        onRunSearch();
      } else if (!searchMode) {
        onSend();
      }
    }
  };

  const handleModeClick = () => {
    // Cycle through all modes
    const currentIndex = DARTZ_MODES.findIndex((m) => m.id === mode);
    const nextIndex = (currentIndex + 1) % DARTZ_MODES.length;
    onModeChange(DARTZ_MODES[nextIndex].id);
  };

  // File handlers
  const validateFiles = (files: File[]): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    
    // Count current attachments
    const currentImages = attachments.filter(f => ALLOWED_IMAGE_TYPES.includes(f.type)).length;
    const currentFiles = attachments.filter(f => ALLOWED_FILE_TYPES.includes(f.type)).length;
    const currentTotal = attachments.length;
    
    let newImages = 0;
    let newFiles = 0;
    let newTotalSize = attachments.reduce((sum, f) => sum + f.size, 0);
    
    for (const file of files) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const isFile = ALLOWED_FILE_TYPES.includes(file.type);
      
      // Check file type
      if (!isImage && !isFile) {
        errors.push(`Invalid file type: ${file.name}`);
        continue;
      }
      
      // Check size
      const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
      if (file.size > maxSize) {
        const maxLabel = isImage
          ? `${Math.round(MAX_IMAGE_SIZE / (1024 * 1024))}MB`
          : `${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB`;
        errors.push(`File too large: ${file.name} (max ${maxLabel})`);
        continue;
      }
      
      // Check counts
      if (isImage) {
        if (currentImages + newImages >= MAX_IMAGES) {
          errors.push(`Too many images: max ${MAX_IMAGES}`);
          break;
        }
        newImages++;
      } else {
        if (currentFiles + newFiles >= MAX_FILES) {
          errors.push(`Too many files: max ${MAX_FILES}`);
          break;
        }
        newFiles++;
      }
      
      // Check total size
      newTotalSize += file.size;
      if (newTotalSize > MAX_TOTAL_SIZE) {
        errors.push(`Total size too large: max 50MB`);
        break;
      }
      
      // Check total attachments
      if (currentTotal + valid.length + 1 > MAX_TOTAL_ATTACHMENTS) {
        errors.push(`Too many attachments: max ${MAX_TOTAL_ATTACHMENTS}`);
        break;
      }
      
      valid.push(file);
    }
    
    return { valid, errors };
  };
  
  const handleFileSelect = (files: FileList | File[] | null) => {
    if (!files) return;
    
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    const { valid, errors } = validateFiles(fileArray);
    
    if (errors.length > 0) {
      showToast(errors[0], 5000);
      return;
    }
    
    if (valid.length > 0) {
      setAttachments(prev => [...prev, ...valid]);
    }
  };

  const getAttachmentDisplayName = useCallback((file: File, isImage: boolean): string => {
    const rawName = (file.name || "").trim();
    const extMatch = rawName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : "";
    if (isImage) {
      return `image.${ext || "png"}`;
    }
    if (!rawName) {
      return ext ? `file.${ext}` : "file";
    }
    return rawName;
  }, []);

  const extractClipboardFiles = (clipboardData: DataTransfer | null): File[] => {
    if (!clipboardData) return [];
    const dedupe = (files: File[]) => {
      const seen = new Set<string>();
      const unique: File[] = [];
      for (const file of files) {
        const key = `${file.type}|${file.size}|${file.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(file);
      }
      return unique;
    };

    const fromItems: File[] = [];
    if (clipboardData.items && clipboardData.items.length > 0) {
      for (const item of Array.from(clipboardData.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) fromItems.push(file);
      }
    }

    // Prefer clipboard items. Some browsers duplicate images across items+files.
    if (fromItems.length > 0) {
      return dedupe(fromItems);
    }

    if (clipboardData.files && clipboardData.files.length > 0) {
      return dedupe(Array.from(clipboardData.files));
    }

    return [];
  };

  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // User asked for this only in active chat mode. Landing keeps default paste behavior.
    if (variant !== "docked") return;
    if (isSearchMode || effectiveDisabled || showSessionFullUI) return;

    const clipboardFiles = extractClipboardFiles(e.clipboardData);
    if (clipboardFiles.length === 0) return;

    const pastedImages = clipboardFiles.filter(
      (file) => file.type.startsWith("image/") || ALLOWED_IMAGE_TYPES.includes(file.type)
    );
    if (pastedImages.length === 0) return;

    // Prevent binary/image fallback text blobs from being pasted into the textarea.
    e.preventDefault();
    const uniquePastedImages = pastedImages.filter(
      (file, index, arr) =>
        arr.findIndex((other) => (
          other.type === file.type &&
          other.size === file.size &&
          other.name === file.name
        )) === index
    );
    handleFileSelect(uniquePastedImages);
  };

  const handlePaperclipClick = () => {
    if (isSearchMode) return;
    fileInputRef.current?.click();
  };

  const handleCameraClick = () => {
    if (isSearchMode) return;
    imageInputRef.current?.click();
  };
  
  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    // Only proceed if we actually have files
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  };

  // Helper to check if a drag event has file payload
  const hasFilePayload = (dt: DataTransfer | null) => {
    if (!dt) return false;
    // Most browsers include 'Files' in types for real file drags
    if (Array.from(dt.types || []).includes('Files')) return true;
    // Fallback: if files exist
    return !!dt.files && dt.files.length > 0;
  };

  // Allow dropping files onto the broader chat area (not just the composer).
  // IMPORTANT: Do not interfere with memory drag/drop (which uses `activeDragId`).
  useEffect(() => {
    const onDocDragOver = (e: DragEvent) => {
      // If we're dragging a memory/folder, let the memory DnD system handle it.
      if (activeDragId) return;

      const dt = e.dataTransfer;
      if (!hasFilePayload(dt)) return;

      // Enable dropping
      e.preventDefault();
    };

    const onDocDrop = (e: DragEvent) => {
      // If we're dragging a memory/folder, let the memory DnD system handle it.
      if (activeDragId) return;

      const dt = e.dataTransfer;
      if (!hasFilePayload(dt)) return;

      // Avoid the browser navigating to the dropped file
      e.preventDefault();

      const files = dt?.files;
      if (files && files.length > 0) {
        handleFileSelect(files);
      }
    };

    // Use capture so we can prevent default browser behavior reliably.
    // We guard with `activeDragId` so memory DnD remains unaffected.
    document.addEventListener('dragover', onDocDragOver, true);
    document.addEventListener('drop', onDocDrop, true);

    return () => {
      document.removeEventListener('dragover', onDocDragOver, true);
      document.removeEventListener('drop', onDocDrop, true);
    };
  }, [activeDragId]);

  // Two-button swap animation (match scroll-to-bottom FAB feel)
  const [isModeSwapAnimating, setIsModeSwapAnimating] = useState(false);
  const swapAnimTimeoutRef = useRef<number | null>(null);
  const swapAnimTimeout2Ref = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (swapAnimTimeoutRef.current) window.clearTimeout(swapAnimTimeoutRef.current);
      if (swapAnimTimeout2Ref.current) window.clearTimeout(swapAnimTimeout2Ref.current);
    };
  }, []);

  const runModeSwap = () => {
    if (!onToggleSearchMode) return;
    if (isModeSwapAnimating) return;

    setIsModeSwapAnimating(true);
    swapAnimTimeoutRef.current = window.setTimeout(() => {
      onToggleSearchMode();
      swapAnimTimeout2Ref.current = window.setTimeout(() => {
        setIsModeSwapAnimating(false);
      }, 20);
    }, 120);
  };

  const swapAnimClass = isModeSwapAnimating
    ? "opacity-0 scale-95 translate-y-1 pointer-events-none"
    : "opacity-100 scale-100 translate-y-0";
  const searchResultsCount = typeof hitsBadge === "number" ? hitsBadge : 0;
  const canClearSearch = value.trim().length > 0 || searchResultsCount > 0;
  const renderModeToggleButton = () => {
    if (!onToggleSearchMode) return null;
    return (
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          // Prevent button focus retention on click.
          e.preventDefault();
        }}
        onClick={(e) => {
          runModeSwap();
          (e.currentTarget as HTMLButtonElement).blur();
        }}
        className={
          "w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 flex items-center justify-center transition-all duration-200 ease-out outline-none " +
          swapAnimClass
        }
        aria-label={searchMode ? "Switch to chat" : "Switch to search"}
      >
        {searchMode ? (
          <SendIconArrowUp className="w-[22px] h-[22px]" />
        ) : (
          <Search className="w-4 h-4" />
        )}
      </button>
    );
  };

  const isLanding = variant === "landing";
  const isDocked = !isLanding;

  // Docked controls enter: fade/translate only (no height collapse).
  // Height collapse (max-height -> 0) was causing a visible "curtain" blink because the composer is bottom-anchored.
  const [dockedControlsVisible, setDockedControlsVisible] = useState<boolean>(() => {
    if (disableTransitions) return true;
    // Landing has no docked controls; docked will reveal them on the next frame.
    return false;
  });
  useEffect(() => {
    if (!isDocked) {
      setDockedControlsVisible(false);
      return;
    }
    if (disableTransitions) {
      setDockedControlsVisible(true);
      return;
    }
    setDockedControlsVisible(false);
    const id = requestAnimationFrame(() => setDockedControlsVisible(true));
    return () => cancelAnimationFrame(id);
  }, [isDocked, disableTransitions]);

  // Composer is now a normal block element - page wrapper owns positioning
  return (
    <div ref={containerRef} className={`w-full ${disableTransitions ? "[&_*]:!transition-none" : ""}`}>
      <div
        className={
          "relative w-full bg-gray-800 border border-gray-700/80 rounded-2xl px-4 py-3 transition-colors duration-300" +
          (composerFullState
            ? " border-red-500 bg-red-500/5"
            : "") +
          (disableTransitions ? " !transition-none" : "")
        }
        style={isLanding ? { boxShadow: '0px 10px 28px rgba(0,0,0,0.32)' } : undefined}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Top row: Textarea + Attach + Send buttons */}
        <div className="relative">
          {/* Attachment/Search Tag tray */}
          <div
            className={
              "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out " +
              ((searchMode ? searchTags.length > 0 : attachments.length > 0)
                ? "grid-rows-[1fr] opacity-100 mb-3"
                : "grid-rows-[0fr] opacity-0 mb-0 pointer-events-none")
            }
          >
            <div className="overflow-hidden space-y-2">
              {searchMode ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {searchTags.length} tag{searchTags.length === 1 ? "" : "s"}
                      {maxSearchTags > 0 ? ` (${searchTags.length}/${maxSearchTags})` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (onClearSearch) {
                          onClearSearch();
                          return;
                        }
                        onChange("");
                      }}
                      className="text-xs text-gray-400 transition-colors hover:text-gray-200"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searchTags.map((tag, index) => (
                      <div
                        key={`${tag}-${index}`}
                        className="group/search-tag relative"
                      >
                        <div className="inline-flex max-w-[220px] select-none items-center gap-1.5 rounded-full border border-gray-600/75 bg-gray-700/70 px-2.5 py-1.5 pr-2 text-xs text-gray-100 no-underline transition-all duration-200 group-hover/search-tag:border-blue-300/40 group-hover/search-tag:bg-gray-700/90 group-hover/search-tag:pr-7 hover:no-underline">
                          <span className="pointer-events-none max-w-[172px] select-none truncate leading-5 no-underline">{tag}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveSearchTag?.(tag);
                          }}
                          className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-gray-100 opacity-0 scale-75 translate-x-2 transition-all duration-200 group-hover/search-tag:opacity-100 group-hover/search-tag:scale-100 group-hover/search-tag:translate-x-0 hover:bg-black/80"
                          aria-label={`Remove tag ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className={attachmentContentVisible ? "" : "invisible pointer-events-none"}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => {
                        setAttachments([]);
                        setExpandedComposerImageUrl(null);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((file, index) => {
                      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
                      const fileUrl = attachmentPreviewUrls[index];
                      const removeAttachment = () => {
                        setAttachments((prev) => prev.filter((_, i) => i !== index));
                      };
                      
                      return (
                        <div
                          key={index}
                          className="group/attachment relative"
                        >
                          {isImage ? (
                            <button
                              type="button"
                              onClick={() => fileUrl && setExpandedComposerImageUrl(fileUrl)}
                              className="flex max-w-[180px] items-center gap-2 rounded-full border border-gray-600/75 bg-gray-700/70 px-2 py-1.5 pr-2 text-left transition-all duration-200 hover:border-blue-300/40 hover:bg-gray-700/90 group-hover/attachment:border-blue-300/40 group-hover/attachment:bg-gray-700/90 group-hover/attachment:pr-8"
                              aria-label={`Open ${file.name}`}
                            >
                              <span className="relative inline-flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-500/60 bg-gray-800">
                                {fileUrl ? (
                                  <img
                                    src={fileUrl}
                                    alt={file.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <Camera className="h-3.5 w-3.5 text-gray-300" />
                                )}
                              </span>
                              <span className="max-w-[96px] truncate text-xs text-gray-100">
                                {getAttachmentDisplayName(file, true)}
                              </span>
                            </button>
                          ) : (
                            <div className="flex max-w-[180px] items-center gap-2 rounded-full border border-gray-600/75 bg-gray-700/70 px-2 py-1.5 pr-2 transition-all duration-200 group-hover/attachment:border-blue-300/40 group-hover/attachment:bg-gray-700/90 group-hover/attachment:pr-8">
                              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-gray-500/60 bg-gray-800">
                                <Paperclip className="h-3.5 w-3.5 text-gray-300" />
                              </span>
                              <p className="max-w-[96px] truncate text-xs text-gray-200">
                                {getAttachmentDisplayName(file, false)}
                              </p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeAttachment();
                            }}
                            className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/60 text-gray-100 opacity-0 scale-75 translate-x-2 transition-all duration-200 group-hover/attachment:opacity-100 group-hover/attachment:scale-100 group-hover/attachment:translate-x-0 hover:bg-black/80"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Textarea - always rendered, value changes based on state */}
          <textarea
            ref={textareaRef}
            value={showSessionFullUI && !searchMode ? "This chat is full. Press Send to generate a summary and continue in a new chat." : value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handleComposerPaste}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            maxLength={MAX_INPUT_CHARS}
            rows={1}
            disabled={effectiveDisabled || (showSessionFullUI && !searchMode)}
            readOnly={effectiveDisabled || (showSessionFullUI && !searchMode)}
            className="w-full bg-transparent resize-none pr-20 text-[13px] text-gray-100 placeholder:text-gray-400/60 focus:outline-none overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent"
            style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
          />
          {/* Primary action button (Send in chat mode, Run search in search mode) */}
          <button
            type="button"
            tabIndex={-1}
            onClick={
              searchMode
                ? (canRunSearch && onRunSearch ? onRunSearch : undefined)
                : showSessionFullUI
                ? onGenerateNewChat
                : onSend
            }
            disabled={!canPrimary}
            className={`
              absolute right-0 bottom-0 w-8 h-8 rounded-full
              flex items-center justify-center
              transition-[transform,box-shadow] duration-[120ms] ease-out
              outline-none
              ${
                canPrimary
                  ? `bg-gradient-to-br from-slate-800 to-blue-900
                     text-white
                     shadow-[0_0_12px_rgba(59,130,246,0.25),inset_0_1px_1px_rgba(255,255,255,0.12)]
                     hover:shadow-[0_0_16px_rgba(59,130,246,0.35),inset_0_1px_1px_rgba(255,255,255,0.12)]
                     hover:border hover:border-blue-500/40
                     active:scale-[0.96] active:shadow-[0_0_8px_rgba(59,130,246,0.2),inset_0_1px_1px_rgba(255,255,255,0.12)]
                     ring-2 ring-blue-400/50 ring-offset-2 ring-offset-gray-900
                     border border-transparent`
                  : `bg-gray-700 text-gray-400 cursor-not-allowed`
              }
            ` + " " + swapAnimClass
            }
            aria-label={searchMode ? "Run search" : (showSessionFullUI ? "Continue to new chat" : "Send")}
          >
            {searchMode ? (
              <Search className="w-[18px] h-[18px]" />
            ) : (
              <SendIconArrowUp className="w-[22px] h-[22px]" />
            )}
          </button>
        </div>

        {/* ALWAYS visible divider */}
        <div className="mt-2 h-px w-full bg-gray-700/60" />

        {/* Below divider: swap content based on variant */}
        {isLanding ? (
          /* Landing: typewriter caption line */
          <div className="text-center pointer-events-none select-none py-2">
            <span className="text-[12px] text-gray-400/80 italic">
              {captionText}
              <span className="animate-pulse">|</span>
            </span>
          </div>
        ) : (
          /* Docked: tool row (fade/translate in; keep height stable to avoid vertical blink) */
          <div
            className={
              "transition-[opacity,transform] duration-300 ease-out will-change-[opacity,transform] " +
              (dockedControlsVisible
                ? "opacity-100 translate-y-0 pointer-events-auto"
                : "opacity-0 translate-y-1 pointer-events-none")
            }
          >
            <div className="relative pt-2 text-[11px]">
              <div className="relative min-h-[34px]">
                {/* Chat-mode controls layer */}
                <div
                  className={
                    "absolute inset-0 flex items-center justify-between transition-[opacity,transform] duration-200 ease-out will-change-[opacity,transform] " +
                    (searchMode
                      ? "opacity-0 -translate-y-1 pointer-events-none"
                      : "opacity-100 translate-y-0")
                  }
                >
                  {/* Left side tools + settings cluster */}
                  <div className="flex min-w-0 items-center gap-3">
              <div className="relative" ref={brainAnchorRef}>
                <BrainUsageRing
                  usageRatio={usageRatio ?? 0}
                  onClick={handleBrainClick}
                  title={attachedMemoryCount > 0 ? `${attachedMemoryCount} memory${attachedMemoryCount === 1 ? "" : "ies"} attached` : "Attach context"}
                  isAttached={attachedMemoryCount > 0}
                  isInjected={hasInjectedMemories}
                />
                {brainPopoverOpen && (
                  typeof document !== "undefined"
                    ? createPortal(
                        <div
                          className="fixed z-[1000]"
                          style={{
                            left: brainPopoverPos?.left ?? -9999,
                            top: brainPopoverPos?.top ?? -9999,
                            transform:
                              brainPopoverPos?.placement === "above" ? "translateY(-100%)" : "none",
                            visibility: brainPopoverPos ? "visible" : "hidden",
                          }}
                          ref={brainPopoverRef}
                        >
                          <div 
                            className="w-60 rounded-xl overflow-hidden relative z-50"
                            style={{
                              background: 'radial-gradient(circle at center, rgba(24, 32, 48, 0.95) 0%, rgba(30, 40, 60, 0.85) 70%, rgba(70, 80, 120, 0.3) 100%)',
                              border: '1px solid rgba(120, 170, 255, 0.18)',
                              backdropFilter: 'blur(12px)',
                              boxShadow: '0 0 0 1px rgba(120,170,255,0.08), 0 8px 30px rgba(40,90,200,0.12)'
                            }}
                          >
                            {/* Header */}
                            <div className="px-2.5 py-3.5 border-b border-white/10 relative">
                              {attachedMemoryCount === 0 ? (
                                <h3 className="text-sm font-semibold text-gray-200 tracking-wide text-center">Attach Memories</h3>
                              ) : (
                                <>
                                  {/* Brain icon - absolute left */}
                                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 -mt-2.5">
                                    <button
                                      onClick={handlePopupBrainClick}
                                      className="cursor-pointer"
                                      aria-label="Toggle all memories"
                                    >
                                      <BrainUsageRing
                                        usageRatio={usageRatio ?? 0}
                                        className="w-6 h-6"
                                        isAttached={attachedMemoryCount > 0}
                                        isInjected={hasInjectedMemories}
                                      />
                                    </button>
                                  </div>
                                  
                                  {/* Clear all button - absolute right */}
                                  {onClearAttachedMemories && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onClearAttachedMemories();
                                        setBrainPopoverOpen(false);
                                      }}
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400 transition-colors"
                                      aria-label="Clear all memories"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  )}
                                  
                                  {/* Memory count - centered */}
                                  <div className="text-sm font-semibold text-gray-200 tracking-wide text-center">
                                    {(() => {
                                      const count = attachedMemoryCount;
                                      if (count === 0) return null;
                                      return count === 1 ? "1 Memory" : `${count} Memories`;
                                    })()}
                                  </div>
                                </>
                              )}
                            </div>
                            <div
                              className="overflow-hidden transition-[height] ease-in-out"
                              style={{
                                height: brainAnimatedBodyHeight,
                                transitionDuration: `${BRAIN_BODY_EXPAND_MS}ms`,
                              }}
                            >
                              <div
                                ref={scrollContainerRef}
                                className="p-2 pr-3 overflow-y-auto db-scroll-lane"
                                style={{ maxHeight: `${BRAIN_BODY_MAX_HEIGHT}px` }}
                              >
                                <div ref={brainListContentRef} className="space-y-0">
                                  {attachedMemories.length === 0 ? (
                                    <div className="text-xs text-gray-500 py-4 text-center">
                                      No memories attached. Drag memories here to attach.
                                    </div>
                                  ) : (
                                    <>
                                      {topBrainGaps.map((gap) => (
                                        <div
                                          key={gap.key}
                                          className="pointer-events-none"
                                          style={{
                                            height: gap.phase === "collapse" ? 0 : gap.height,
                                            opacity: 0,
                                            transition: `height ${BRAIN_BODY_EXPAND_MS}ms ${BRAIN_REVEAL_EASE}`,
                                          }}
                                        />
                                      ))}
                                      {attachedMemories.map((memory, index) => {
                                        const trailingGaps = brainGapsByAfterId.get(memory.id) ?? [];
                                        const hasTrailingGap = trailingGaps.length > 0;
                                        const needsBottomSpacing =
                                          index < attachedMemories.length - 1 || hasTrailingGap;
                                        return (
                                        <Fragment key={memory.id}>
                                          <div
                                            ref={(el) => {
                                              if (el) {
                                                brainRowRefs.current.set(memory.id, el);
                                              } else {
                                                brainRowRefs.current.delete(memory.id);
                                              }
                                            }}
                                            className="group relative cursor-pointer"
                                            style={{ marginBottom: needsBottomSpacing ? `${BRAIN_LIST_ROW_GAP_PX}px` : 0 }}
                                            onClick={() => {
                                              onOpenAttachedMemory?.(memory.id);
                                              setBrainPopoverOpen(false);
                                            }}
                                          >
                                            {/* Memory card - matching landing design */}
                                            <div
                                              className="relative rounded-xl p-2 transition-all duration-200"
                                              style={{
                                                background:
                                                  "linear-gradient(180deg, rgba(70,120,255,0.08), rgba(20,30,60,0.35))",
                                                border: "1px solid rgba(120,170,255,0.18)",
                                                boxShadow:
                                                  "inset 0 0 0 1px rgba(255,255,255,0.03), 0 6px 20px rgba(0,0,0,0.35)",
                                              }}
                                            >
                                              {/* Hover overlay */}
                                              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                                              <div className="flex items-center gap-2 relative z-10">
                                                {/* Pin toggle button on the left */}
                                                {onTogglePin && (
	                                                  <button
	                                                    onClick={async (e) => {
	                                                      e.stopPropagation();
	                                                      const memoryId = memory.id;
	                                                      try {
	                                                        await onTogglePin(memoryId);
	                                                      } catch (err) {
                                                        console.error("Failed to toggle pin:", err);
                                                        // Optionally show a toast here if you have one
                                                      }
                                                    }}
                                                    className={`p-1.5 transition-opacity flex items-start justify-center w-8 h-8 flex-shrink-0 pt-1.5 -ml-2 ${
                                                      memory.is_pinned === 1
                                                        ? "text-blue-400 opacity-100"
                                                        : "opacity-0 group-hover:opacity-60 text-gray-500"
                                                    } hover:text-blue-300 hover:opacity-100 pointer-events-auto rounded`}
                                                    aria-label={
                                                      memory.is_pinned === 1 ? "Injected" : "Hidden from model"
                                                    }
                                                    title={
                                                      memory.is_pinned === 1 ? "Injected" : "Hidden from model"
                                                    }
                                                  >
                                                    <IconDartboard size={26} filled={memory.is_pinned === 1} />
                                                  </button>
                                                )}
                                                {/* Text content to the right of pin button */}
                                                <div className="flex-1 min-w-0">
                                                  <div className="text-xs text-slate-200 truncate leading-tight">
                                                    {memory.title || "Untitled"}
                                                  </div>
                                                  {memory.folder_name && (
                                                    <div
                                                      className="text-[10px] text-slate-400/70 truncate mt-0.5"
                                                      style={{ marginTop: "2px" }}
                                                    >
                                                      {memory.folder_name}
                                                    </div>
                                                  )}
                                                </div>
                                                {/* Remove button on the far right */}
                                                {onRemoveAttachedMemory && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleRemoveAttachedMemoryWithAnimation(memory.id);
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-colors pointer-events-auto flex-shrink-0"
                                                    aria-label="Remove memory"
                                                  >
                                                    <svg
                                                      className="w-4 h-4"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      viewBox="0 0 24 24"
                                                    >
                                                      <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M6 18L18 6M6 6l12 12"
                                                      />
                                                    </svg>
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                          {trailingGaps.map((gap) => (
                                            <div
                                              key={gap.key}
                                              className="pointer-events-none"
                                              style={{
                                                height: gap.phase === "collapse" ? 0 : gap.height,
                                                opacity: 0,
                                                transition: `height ${BRAIN_BODY_EXPAND_MS}ms ${BRAIN_REVEAL_EASE}`,
                                              }}
                                            />
                                          ))}
                                        </Fragment>
                                        );
                                      })}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>,
                        document.body
                      )
                    : null
                  )}
                </div>

              {/* Divider */}
              <div className="w-px h-4 bg-gray-700 mx-1" />

              {/* Mode section */}
              <div className="flex items-center">
                <button
                  onClick={chatFullState === "full" || isSearchMode ? undefined : handleModeClick}
                  disabled={chatFullState === "full" || isSearchMode}
                  className={`w-[74px] h-7 inline-flex items-center justify-center rounded-full border transition-colors ${
                    chatFullState === "full" || isSearchMode
                      ? "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed opacity-50"
                      : "border-blue-300/70 bg-gray-700 hover:bg-gray-600 text-gray-100 shadow-[0_0_6px_rgba(96,165,250,0.28)]"
                  }`}
                >
                  <span className="block max-w-full truncate whitespace-nowrap px-2 text-[11px]">
                    {modeSpec.label}
                  </span>
                </button>
              </div>

              {/* Divider */}
              <div className="w-px h-4 bg-gray-700 mx-1" />

              {/* Settings cluster */}
              <div className="flex items-center gap-2">
                {/* Target/Focus button */}
                <button 
                  ref={focusAnchorRef}
                  onClick={chatFullState === "full" ? undefined : handleFocusClick}
                  disabled={chatFullState === "full" || isSearchMode}
                  aria-disabled={chatFullState === "full" || isSearchMode}
                  className={`transition-colors p-1 relative ${
                    chatFullState === "full" || isSearchMode
                      ? "text-gray-600 cursor-not-allowed opacity-40"
                      : focusEnabled
                      ? "text-blue-300 drop-shadow-[0_0_9px_rgba(96,165,250,0.6)]"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  aria-label="Focus" 
                  title={isSearchMode ? "Focus disabled in search mode" : "Focus"}
                >
                  <svg
                    className="w-[17px] h-[17px]"
                    viewBox="0 0 32 32"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M30 15.25h-3.326c-0.385-5.319-4.605-9.539-9.889-9.922l-0.035-0.002v-3.326c0-0.414-0.336-0.75-0.75-0.75s-0.75 0.336-0.75 0.75v0 3.326c-5.319 0.385-9.539 4.605-9.922 9.889l-0.002 0.035h-3.326c-0.414 0-0.75 0.336-0.75 0.75s0.336 0.75 0.75 0.75v0h3.326c0.385 5.319 4.605 9.539 9.889 9.922l0.035 0.002v3.326c0 0.414 0.336 0.75 0.75 0.75s0.75-0.336 0.75-0.75v0-3.326c5.319-0.385 9.539-4.605 9.922-9.889l0.002-0.035h3.326c0.414 0 0.75-0.336 0.75-0.75s-0.336-0.75-0.75-0.75v0zM16 25.25c-5.109 0-9.25-4.141-9.25-9.25s4.141-9.25 9.25-9.25c5.109 0 9.25 4.141 9.25 9.25v0c-0.006 5.106-4.144 9.244-9.249 9.25h-0.001zM16 11.25c-2.623 0-4.75 2.127-4.75 4.75s2.127 4.75 4.75 4.75c2.623 0 4.75-2.127 4.75-4.75v0c-0.003-2.622-2.128-4.747-4.75-4.75h-0zM16 19.25c-1.795 0-3.25-1.455-3.25-3.25s1.455-3.25 3.25-3.25c1.795 0 3.25 1.455 3.25 3.25v0c-0.002 1.794-1.456 3.248-3.25 3.25h-0z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="1.0"
                    />
                  </svg>
                </button>
                {/* Web search icon (one-turn toggle) */}
                <button
                  onClick={
                    chatFullState === "full" || isSearchMode || !onToggleWebSearch
                      ? undefined
                      : onToggleWebSearch
                  }
                  className={`transition-colors p-1 ${
                    chatFullState === "full" || isSearchMode
                      ? "text-gray-600 cursor-not-allowed opacity-40"
                      : webSearchArmed
                      ? "text-blue-300 drop-shadow-[0_0_9px_rgba(96,165,250,0.6)]"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  aria-label="Web search"
                  disabled={chatFullState === "full" || isSearchMode || !onToggleWebSearch}
                  aria-disabled={chatFullState === "full" || isSearchMode || !onToggleWebSearch}
                  title={
                    isSearchMode
                      ? "Web search disabled in search mode"
                      : webSearchArmed
                      ? "Web search enabled for next message"
                      : "Enable web search for next message"
                  }
                >
                  <Globe className="w-4 h-4" />
                </button>
                {/* Timeline clock button (disabled in search mode) */}
                {onOpenTimeline && (
                  <div className="relative">
                    <button
                      ref={timelineAnchorRef}
                      onClick={isSearchMode ? undefined : onOpenTimeline}
                      disabled={isSearchMode}
                      aria-disabled={isSearchMode}
                      data-timeline-toggle="true"
                      aria-expanded={Boolean(timelinePopup)}
                      className={`transition-colors p-1 ${
                        isSearchMode
                          ? "text-gray-600 cursor-not-allowed opacity-40"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                      aria-label="Open timeline"
                      title={isSearchMode ? "Timeline disabled in search mode" : "Open timeline"}
                    >
                      <Clock className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Attachment button */}
                <button
                  onClick={chatFullState === "full" ? undefined : handlePaperclipClick}
                  disabled={chatFullState === "full" || isSearchMode}
                  aria-disabled={chatFullState === "full" || isSearchMode}
                  className={`transition-colors p-1 ${
                    chatFullState === "full" || isSearchMode
                      ? "text-gray-600 cursor-not-allowed opacity-40"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  aria-label="Upload"
                  title={isSearchMode ? "Upload disabled in search mode" : "Upload"}
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {/* Image upload button */}
                <button
                  onClick={chatFullState === "full" ? undefined : handleCameraClick}
                  disabled={chatFullState === "full" || isSearchMode}
                  aria-disabled={chatFullState === "full" || isSearchMode}
                  className={`transition-colors p-1 ${
                    chatFullState === "full" || isSearchMode
                      ? "text-gray-600 cursor-not-allowed opacity-40"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  aria-label="Upload image"
                  title={isSearchMode ? "Camera disabled in search mode" : "Upload image"}
                >
                  <Camera className="w-4 h-4" />
                </button>

              </div>
                  </div>

                  {renderModeToggleButton()}
                </div>

                {/* Search-mode controls layer */}
                <div
                  className={
                    "absolute inset-0 flex items-center justify-between transition-[opacity,transform] duration-200 ease-out will-change-[opacity,transform] " +
                    (searchMode
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-1 pointer-events-none")
                  }
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {onOpenTimeline && (
                      <div className="relative">
                        <button
                          ref={timelineSearchAnchorRef}
                          onClick={onOpenTimeline}
                          data-timeline-toggle="true"
                          aria-expanded={Boolean(timelinePopup)}
                          className="p-1 text-gray-300 transition-colors hover:text-gray-100"
                          aria-label="Open timeline"
                          title="Open timeline"
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    <div className="mx-1 h-4 w-px bg-gray-700/80" />

                    <div className="inline-flex items-center rounded-full border border-gray-600/80 bg-gray-900/70 p-0.5">
                      <button
                        type="button"
                        onClick={() => onSearchRoleChange?.("all")}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                          searchRole === "all"
                            ? "bg-blue-500/25 text-blue-100"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => onSearchRoleChange?.("user")}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                          searchRole === "user"
                            ? "bg-blue-500/25 text-blue-100"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        User
                      </button>
                      <button
                        type="button"
                        onClick={() => onSearchRoleChange?.("assistant")}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                          searchRole === "assistant"
                            ? "bg-blue-500/25 text-blue-100"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        Assistant
                      </button>
                    </div>

                    <div className="inline-flex items-center rounded-full border border-gray-600/80 bg-gray-900/70 p-0.5">
                      <button
                        type="button"
                        onClick={() => onSearchMatchModeChange?.("and")}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                          searchMatchMode === "and"
                            ? "bg-blue-500/25 text-blue-100"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        AND
                      </button>
                      <button
                        type="button"
                        onClick={() => onSearchMatchModeChange?.("or")}
                        className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                          searchMatchMode === "or"
                            ? "bg-blue-500/25 text-blue-100"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        OR
                      </button>
                    </div>

                    <span className="ml-1 whitespace-nowrap text-[11px] text-gray-400">
                      Results: {searchResultsCount}
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        if (!canClearSearch) return;
                        if (onClearSearch) {
                          onClearSearch();
                          return;
                        }
                        onChange("");
                      }}
                      disabled={!canClearSearch}
                      className={`ml-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                        canClearSearch
                          ? "border-gray-600 text-gray-300 hover:border-blue-400/60 hover:text-blue-200"
                          : "border-gray-700 text-gray-500 cursor-not-allowed"
                      }`}
                    >
                      Clear
                    </button>
                  </div>

                  {renderModeToggleButton()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.csv"
        onChange={(e) => {
          handleFileSelect(e.target.files);
          // Allow selecting the same file again after remove/clear.
          e.currentTarget.value = "";
        }}
        style={{ display: 'none' }}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/png,image/jpg,image/jpeg,image/webp"
        onChange={(e) => {
          handleFileSelect(e.target.files);
          // Allow selecting the same file again after remove/clear.
          e.currentTarget.value = "";
        }}
        style={{ display: 'none' }}
      />
      
      {/* Focus popover */}
      {focusPopoverOpen && (
        typeof document !== "undefined"
          ? createPortal(
              <div
                ref={focusPopoverRef}
                className="fixed z-[1000]"
                style={{
                  left: focusPopoverPos?.left ?? -9999,
                  top: focusPopoverPos?.top ?? -9999,
                  visibility: focusPopoverPos ? "visible" : "hidden",
                }}
              >
                <div className="w-80 bg-[#0f1320] rounded-xl overflow-y-auto border border-blue-400/45 shadow-[0_10px_24px_rgba(0,0,0,0.38)]">
                  <div className="p-4">
                    <h3 className="text-sm font-semibold text-gray-200 mb-3">Focus</h3>
                    <div className="relative">
                      <input
                        type="text"
                        value={focusInput}
                        onChange={handleFocusInputChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleFocusSelectToggle();
                          }
                        }}
                        placeholder="Set a focus topic…"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 pr-11 truncate"
                        maxLength={60}
                      />
                      <button
                        type="button"
                        onClick={handleFocusSelectToggle}
                        disabled={isUpdatingFocus || !onFocusToggle}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          focusEnabled
                            ? "border-blue-400/60 bg-blue-500/20 text-blue-200"
                            : "border-gray-600 bg-gray-900/60 text-gray-300 hover:border-blue-500/60 hover:text-blue-200"
                        }`}
                        title={focusEnabled ? "Deselect focus" : "Select focus"}
                      >
                        {isUpdatingFocus ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 32 32"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M30 15.25h-3.326c-0.385-5.319-4.605-9.539-9.889-9.922l-0.035-0.002v-3.326c0-0.414-0.336-0.75-0.75-0.75s-0.75 0.336-0.75 0.75v0 3.326c-5.319 0.385-9.539 4.605-9.922 9.889l-0.002 0.035h-3.326c-0.414 0-0.75 0.336-0.75 0.75s0.336 0.75 0.75 0.75v0h3.326c0.385 5.319 4.605 9.539 9.889 9.922l0.035 0.002v3.326c0 0.414 0.336 0.75 0.75 0.75s0.75-0.336 0.75-0.75v0-3.326c5.319-0.385 9.539-4.605 9.922-9.889l0.002-0.035h3.326c0.414 0 0.75-0.336 0.75-0.75s-0.336-0.75-0.75-0.75v0zM16 25.25c-5.109 0-9.25-4.141-9.25-9.25s4.141-9.25 9.25-9.25c5.109 0 9.25 4.141 9.25 9.25v0c-0.006 5.106-4.144 9.244-9.249 9.25h-0.001zM16 11.25c-2.623 0-4.75 2.127-4.75 4.75s2.127 4.75 4.75 4.75c2.623 0 4.75-2.127 4.75-4.75v0c-0.003-2.622-2.128-4.747-4.75-4.75h-0zM16 19.25c-1.795 0-3.25-1.455-3.25-3.25s1.455-3.25 3.25-3.25c1.795 0 3.25 1.455 3.25 3.25v0c-0.002 1.794-1.456 3.248-3.25 3.25h-0z"
                              fill="currentColor"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className={focusEnabled ? "text-blue-300" : "text-gray-500"}>
                        {focusEnabled ? "Selected" : "Deselected"}
                      </span>
                      <span className={focusInput.length >= 60 ? "text-red-400" : "text-gray-500"}>
                        {focusInput.length} / 60
                      </span>
                    </div>
                    {focusError && (
                      <p className="mt-2 text-xs text-red-400">{focusError}</p>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null
      )}
      {timelinePopup &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={timelinePopoverRef}
            className="fixed z-[1000]"
            style={{
              left: timelinePopoverPos?.left ?? -9999,
              top: timelinePopoverPos?.top ?? -9999,
              visibility: timelinePopoverPos ? "visible" : "hidden",
            }}
          >
            {timelinePopup}
          </div>,
          document.body
        )}
      {expandedComposerImageUrl && (
        <ImageLightbox
          imageUrl={expandedComposerImageUrl}
          alt="Composer image preview"
          onClose={() => setExpandedComposerImageUrl(null)}
        />
      )}
    </div>
  );
}
