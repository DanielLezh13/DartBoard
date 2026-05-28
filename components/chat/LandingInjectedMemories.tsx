"use client";

import type React from "react";
import { Fragment, useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from "react";
import { BrainUsageRing } from "@/components/chat/BrainUsageRing";
import { IconDartboard } from "@/components/ui/IconDartboard";

export type LandingInjectedMemory = {
  id: number;
  title: string | null;
  folder_name?: string | null;
  is_pinned?: boolean; // Add pinned state for landing
};

type CollapsingGap = {
  key: string;
  height: number;
  afterId: number | null;
  phase: "prepare" | "collapse";
};

export function LandingInjectedMemories({
  attachedCount,
  attachedMemories,
  onDetachOne,
  onClearAll,
  onCollapseStart,
  landingStage,
  onHeightChange,
  landingFadeOut,
  usageRatio,
  onOpenAttachedMemory,
  onTogglePin, // Add pin toggle callback
}: {
  attachedCount: number;
  attachedMemories: LandingInjectedMemory[];
  onDetachOne: (memoryId: number) => void;
  onClearAll?: () => void;
  onCollapseStart?: () => void;
  landingStage: number;
  onHeightChange?: (height: number) => void;
  landingFadeOut?: boolean;
  usageRatio?: number;
  onOpenAttachedMemory?: (memoryId: number) => void;
  onTogglePin?: (memoryId: number) => void;
}) {
  const isVisible = landingStage >= 5;
  const BODY_MAX_HEIGHT = 240;
  const BODY_VERTICAL_PADDING = 16; // p-2 => 8 top + 8 bottom
  const BODY_EXPAND_MS = 700;
  const LIST_ROW_GAP_PX = 2; // matches `space-y-0.5`
  // Match composer transform easing (`ease-in-out`) so both move in lockstep.
  const REVEAL_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const gapRemoveTimersRef = useRef<Map<string, number>>(new Map());
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<number>>(new Set());
  const [collapsingGaps, setCollapsingGaps] = useState<CollapsingGap[]>([]);
  const prevMemoryIdsForScrollRef = useRef<Set<number>>(new Set());
  const prevMemoryIdsForFadeRef = useRef<Set<number>>(new Set());
  const prevAttachedCountRef = useRef(attachedCount);
  const [animatedBodyHeight, setAnimatedBodyHeight] = useState(0);
  const clearAnimationTimers = useCallback(() => {
    for (const timerId of gapRemoveTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    gapRemoveTimersRef.current.clear();
  }, []);

  const readTargetHeight = useCallback(() => {
    const content = listContentRef.current;
    if (!content) {
      return 0;
    }
    const naturalHeight = content.offsetHeight + BODY_VERTICAL_PADDING;
    // `maxHeight` is border-box in Tailwind preflight, so cap at BODY_MAX_HEIGHT (not + padding).
    return Math.min(naturalHeight, BODY_MAX_HEIGHT);
  }, [BODY_MAX_HEIGHT, BODY_VERTICAL_PADDING]);

  const applyAnimatedHeight = useCallback((nextHeight: number, notifyParent = true) => {
    const clamped = Math.max(0, Math.min(nextHeight, BODY_MAX_HEIGHT));
    setAnimatedBodyHeight(clamped);
    if (notifyParent) {
      onHeightChange?.(clamped);
    }
  }, [BODY_MAX_HEIGHT, onHeightChange]);

  const measureBodyHeight = useCallback((notifyParent = true) => {
    const clamped = readTargetHeight();
    applyAnimatedHeight(clamped, notifyParent);
  }, [applyAnimatedHeight, readTargetHeight]);

  useLayoutEffect(() => {
    const prevCount = prevAttachedCountRef.current;
    const nextCount = attachedCount;
    prevAttachedCountRef.current = nextCount;
    const target = nextCount === 0 ? 0 : readTargetHeight();

    if (nextCount < prevCount) {
      // During row-gap collapse, let ResizeObserver drive height so the seam stays at delete row.
      if (collapsingGaps.length > 0) {
        measureBodyHeight(false);
        return;
      }
      // On removals, set target immediately so collapse starts with the same interaction beat.
      applyAnimatedHeight(target);
      return;
    }

    measureBodyHeight();
  }, [attachedCount, attachedMemories.length, applyAnimatedHeight, collapsingGaps.length, measureBodyHeight, readTargetHeight]);

  useEffect(() => {
    const content = listContentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      // During seam collapse, keep container in sync locally but avoid spamming parent/composer.
      measureBodyHeight(collapsingGaps.length === 0);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [collapsingGaps.length, measureBodyHeight]);

  useEffect(() => {
    return clearAnimationTimers;
  }, [clearAnimationTimers]);

  // Auto-scroll to bottom when new memory is attached
  useEffect(() => {
    if (scrollContainerRef.current && attachedMemories.length > 0) {
      const currentIds = new Set(attachedMemories.map(m => m.id));
      const prevIds = prevMemoryIdsForScrollRef.current;
      
      // Check if a new memory was added (not removed)
      let hasNewMemory = false;
      currentIds.forEach(id => {
        if (!prevIds.has(id)) {
          hasNewMemory = true;
        }
      });
      
      if (hasNewMemory) {
        // Scroll to bottom smoothly
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
      
      prevMemoryIdsForScrollRef.current = currentIds;
    }
  }, [attachedMemories]);
  
  // Track newly added memories for fade-in animation
  useEffect(() => {
    const currentIds = new Set(attachedMemories.map(m => m.id));
    const prevIds = prevMemoryIdsForFadeRef.current;
    
    // Find newly added memories
    const newIds = new Set<number>();
    currentIds.forEach(id => {
      if (!prevIds.has(id)) {
        newIds.add(id);
      }
    });
    
    if (newIds.size > 0) {
      setNewlyAddedIds(newIds);
      prevMemoryIdsForFadeRef.current = currentIds;
      // Clear the "new" flag after animation completes
      const timer = setTimeout(() => {
        setNewlyAddedIds(new Set());
      }, 280);
      return () => clearTimeout(timer);
    }
    
    prevMemoryIdsForFadeRef.current = currentIds;
  }, [attachedMemories]);
  
  // Handle brain click - toggle all memories injection state
  const handleBrainClick = useCallback(async () => {
    if (attachedMemories.length === 0) {
      return;
    }

    const allInjected = attachedMemories.every(m => m.is_pinned !== false);
    
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
        if (memory.is_pinned === false && onTogglePin) {
          await onTogglePin(memory.id);
        }
      }
    }
  }, [attachedMemories, onTogglePin]);

  const handleDetachWithAnimation = useCallback((memoryId: number) => {
    const index = attachedMemories.findIndex((memory) => memory.id === memoryId);
    if (index === -1) {
      onDetachOne(memoryId);
      return;
    }

    const afterId = index > 0 ? attachedMemories[index - 1]?.id ?? null : null;
    const rowHeight = Math.max(1, rowRefs.current.get(memoryId)?.offsetHeight ?? 0);
    const gapKey = `${memoryId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = listContentRef.current;
    const naturalStart = content ? content.offsetHeight + BODY_VERTICAL_PADDING : animatedBodyHeight;
    const naturalEnd = Math.max(0, naturalStart - rowHeight - LIST_ROW_GAP_PX);
    const clampedEnd = Math.min(naturalEnd, BODY_MAX_HEIGHT);

    // Ensure parent can enable transform animation before we push new height.
    onCollapseStart?.();

    // Start composer motion immediately from the same geometry used for this delete.
    onHeightChange?.(clampedEnd);

    setCollapsingGaps((prev) => [...prev, { key: gapKey, height: rowHeight, afterId, phase: "prepare" }]);
    onDetachOne(memoryId);
    measureBodyHeight(false);
    window.requestAnimationFrame(() => {
      setCollapsingGaps((prev) =>
        prev.map((gap) => (gap.key === gapKey ? { ...gap, phase: "collapse" } : gap))
      );
    });

    const timerId = window.setTimeout(() => {
      gapRemoveTimersRef.current.delete(gapKey);
      setCollapsingGaps((prev) => prev.filter((gap) => gap.key !== gapKey));
    }, BODY_EXPAND_MS);
    gapRemoveTimersRef.current.set(gapKey, timerId);
  }, [BODY_EXPAND_MS, BODY_MAX_HEIGHT, BODY_VERTICAL_PADDING, LIST_ROW_GAP_PX, animatedBodyHeight, attachedMemories, measureBodyHeight, onCollapseStart, onDetachOne, onHeightChange]);

  const handleClearAllWithAnimation = useCallback(() => {
    if (!onClearAll) return;
    onCollapseStart?.();
    clearAnimationTimers();
    setCollapsingGaps([]);
    applyAnimatedHeight(0);
    onClearAll();
  }, [applyAnimatedHeight, clearAnimationTimers, onClearAll, onCollapseStart]);

  // Check if any memories are injected (pinned) - reactive to attachedMemories changes
  const hasInjectedMemories = useMemo(() => 
    attachedMemories.length > 0 && attachedMemories.some(m => m.is_pinned !== false), 
    [attachedMemories]
  );
  const topGaps = useMemo(() => collapsingGaps.filter((gap) => gap.afterId == null), [collapsingGaps]);
  const gapsByAfterId = useMemo(() => {
    const map = new Map<number, CollapsingGap[]>();
    for (const gap of collapsingGaps) {
      if (gap.afterId == null) continue;
      const list = map.get(gap.afterId) ?? [];
      list.push(gap);
      map.set(gap.afterId, list);
    }
    return map;
  }, [collapsingGaps]);
  
  return (
    <div
      className={
        "mt-8 flex justify-center relative z-50 " +
        (landingFadeOut 
          ? ""  // Inherit opacity from parent when fading out
          : `transition-opacity duration-300 ${isVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`)
      }
    >
      <div
        className="w-60 rounded-xl overflow-hidden relative z-50"
        style={{
          background: 'rgb(24, 32, 48)',
          border: '1px solid rgba(120, 170, 255, 0.18)',
          boxShadow: '0px 8px 22px rgba(0,0,0,0.30)',
        }}
      >
        {/* Header */}
        <div className="px-2.5 py-3.5 border-b border-white/10 relative">
          {/* Brain icon */}
          {attachedCount > 0 && (
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 mt-0 sm:-mt-2.5 transition-opacity duration-200 opacity-100">
              <BrainUsageRing
                onClick={handleBrainClick}
                aria-label="Toggle all memories"
                usageRatio={usageRatio ?? 0}
                className="w-6 h-6"
                isAttached={attachedCount > 0}
                isInjected={hasInjectedMemories}
              />
            </div>
          )}
          
          {/* Clear all button - keep mounted and fade in/out */}
          {onClearAll && (
            <button
              type="button"
              onClick={handleClearAllWithAnimation}
              className={
                "absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400 transition-all duration-200 " +
                (attachedCount > 0 ? "opacity-100" : "opacity-0 pointer-events-none")
              }
              aria-label="Clear all memories"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          
          {/* Centered title with reserved side space */}
          <h3 className="text-sm font-semibold text-gray-200 tracking-wide text-center px-10">
            {attachedCount === 0 ? "Attach Memories" : attachedCount === 1 ? "1 Memory" : `${attachedCount} Memories`}
          </h3>
        </div>

        {/* Memory list body - always mounted, smooth height expansion */}
        <div
          className="overflow-hidden transition-[height] ease-in-out"
          style={{
            height: animatedBodyHeight,
            transitionDuration: collapsingGaps.length > 0 ? "0ms" : `${BODY_EXPAND_MS}ms`,
          }}
        >
          <div ref={scrollContainerRef} className="overflow-y-auto db-scroll-lane p-2 pr-3" style={{ maxHeight: `${BODY_MAX_HEIGHT}px` }}>
            <div ref={listContentRef} className="space-y-0.5">
              {topGaps.map((gap) => (
                <div
                  key={gap.key}
                  className="pointer-events-none"
                  style={{
                    height: gap.phase === "collapse" ? 0 : gap.height,
                    opacity: 0,
                    transition: `height ${BODY_EXPAND_MS}ms ${REVEAL_EASE}`,
                  }}
                />
              ))}
              {attachedMemories.map((memory) => {
                const isNew = newlyAddedIds.has(memory.id);
                return (
                  <Fragment key={memory.id}>
                    <div
                      ref={(el) => {
                        if (el) {
                          rowRefs.current.set(memory.id, el);
                        } else {
                          rowRefs.current.delete(memory.id);
                        }
                      }}
                      className="group relative rounded-xl py-1 px-3 transition-all cursor-pointer border border-blue-400/30 hover:shadow-[0_8px_20px_rgba(10,22,48,0.45)] pointer-events-auto overflow-hidden"
                      style={{
                        animationDelay: isNew ? "90ms" : undefined,
                        background: 'linear-gradient(180deg, rgba(70,120,255,0.08), rgba(20,30,60,0.35))',
                        border: '1px solid rgba(120,170,255,0.18)',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.35)'
                      }}
                      onClick={() => onOpenAttachedMemory?.(memory.id)}
                    >
                      {/* Hover overlay - matches MODE pill idle background */}
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      
                      <div className="flex items-center gap-2 relative z-10">
                        {/* Pin toggle button on the left */}
                        {onTogglePin && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await onTogglePin(memory.id);
                              } catch (err) {
                                console.error("Failed to toggle pin:", err);
                                // Optionally show a toast here if you have one
                              }
                            }}
                            className={`p-1.5 transition-opacity flex items-start justify-center w-8 h-8 flex-shrink-0 pt-1.5 -ml-2 ${
                              memory.is_pinned !== false 
                                ? "text-blue-400 opacity-100" 
                                : "opacity-0 group-hover:opacity-60 text-gray-500"
                            } hover:text-blue-300 hover:opacity-100 pointer-events-auto rounded`}
                            aria-label={memory.is_pinned !== false ? "Injected" : "Hidden from model"}
                            title={memory.is_pinned !== false ? "Injected" : "Hidden from model"}
                          >
                            <IconDartboard size={26} filled={memory.is_pinned !== false} />
                          </button>
                        )}
                        {/* Text content to the right of pin button */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-200 truncate leading-tight">
                            {memory.title || "Untitled"}
                          </div>
                          {memory.folder_name && (
                            <div className="text-[10px] text-slate-400/70 truncate mt-0.5" style={{marginTop: '2px'}}>
                              {memory.folder_name}
                            </div>
                          )}
                        </div>
                        {/* Remove button on the far right */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDetachWithAnimation(memory.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-colors pointer-events-auto flex-shrink-0"
                          aria-label="Remove memory"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {gapsByAfterId.get(memory.id)?.map((gap) => (
                      <div
                        key={gap.key}
                        className="pointer-events-none"
                        style={{
                          height: gap.phase === "collapse" ? 0 : gap.height,
                          opacity: 0,
                          transition: `height ${BODY_EXPAND_MS}ms ${REVEAL_EASE}`,
                        }}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
