"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useChatSearch(opts: {
  requestScroll: (req: { type: "toTop" | "toBottom" | "restore"; top?: number; reason?: string }) => void;
  setScrollLockReason: (reason: string | null) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  isAtBottomRef: React.MutableRefObject<boolean>;
  isSending: boolean;
  revealMessageIdRef: React.MutableRefObject<number | null>;
}) {
  const { requestScroll, setScrollLockReason, scrollContainerRef, isAtBottomRef, isSending, revealMessageIdRef } = opts;

  const [searchMode, setSearchMode] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModeFading, setIsModeFading] = useState(false);
  const fadeTimerRef = useRef<number | null>(null);
  const scrollTopBeforeSearchRef = useRef<number>(0);

  const handleToggleSearchMode = useCallback(() => {
    // Option 1: lock mode toggle while a reply is generating/revealing.
    const replyActive = isSending || revealMessageIdRef.current !== null;

    if (replyActive) return;

    // Lock scroll during mode swap
    setScrollLockReason("mode-swap");

    // Start fade-out
    setIsModeFading(true);

    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    // After a short fade-out, do the toggle work, then fade back in.
    fadeTimerRef.current = window.setTimeout(() => {
      const next = !searchMode;

      if (next) {
        // entering search
        scrollTopBeforeSearchRef.current = scrollContainerRef.current?.scrollTop ?? 0;
        setSearchDraft("");
        setSearchQuery("");
        setSearchMode(true);

        // Deterministically snap to bottom on entry too (same behavior as exit).
        // Keep lock as `mode-swap` while snapping; switch to `search` after the snap.
        const snapEnterSearch = () => {
          requestScroll({ type: "toBottom", reason: "enter-search" });
          isAtBottomRef.current = true;
        };

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            snapEnterSearch();
            // A couple extra passes to catch layout settle
            window.setTimeout(() => snapEnterSearch(), 80);
            window.setTimeout(() => snapEnterSearch(), 160);

            // Now hold the lock during search
            setScrollLockReason("search");
          });
        });
      } else {
        // exiting search
        setSearchMode(false);
        setSearchDraft("");
        setSearchQuery("");
        // Exit-search must deterministically go to bottom.
        // Do multiple passes because scrollHeight can change right after the first snap
        // (composer/tool-row/layout settle), which otherwise leaves a partial offset.
        const snapExitSearch = () => {
          requestScroll({ type: "toBottom", reason: "exit-search" });
          isAtBottomRef.current = true;
        };

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Frame settle loop
            let frames = 0;
            const settle = () => {
              frames += 1;
              snapExitSearch();
              if (frames < 10) requestAnimationFrame(settle);
            };
            settle();

            // Late passes for any CSS/layout settling
            window.setTimeout(() => snapExitSearch(), 120);
            window.setTimeout(() => snapExitSearch(), 300);

            // Unlock after the settle passes
            window.setTimeout(() => {
              setScrollLockReason(null);
            }, 340);
          });
        });
      }

      // Fade back in on next frame so DOM has the new tree.
      requestAnimationFrame(() => {
        setIsModeFading(false);
      });
    }, 120) as unknown as number;
  }, [searchMode, requestScroll, setScrollLockReason, scrollContainerRef, isAtBottomRef, isSending, revealMessageIdRef]);

  const handleRunSearch = useCallback((queryOverride?: string) => {
    // Start fade-out
    setIsModeFading(true);

    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    // After fade-out, commit search and settle at the bottom of filtered results,
    // then fade back in so positioning feels intentional and stable.
    fadeTimerRef.current = window.setTimeout(() => {
      const committedQuery = queryOverride ?? searchDraft;
      setSearchQuery(committedQuery);
      setScrollLockReason("search");

      const snapToBottom = () => {
        requestScroll({ type: "toBottom", reason: "run-search" });
        const container = scrollContainerRef.current;
        if (container) {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          container.scrollTop = maxScroll;
        }
        isAtBottomRef.current = true;
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          snapToBottom();
          // Follow-up passes for any late markdown/layout height settling.
          window.setTimeout(() => snapToBottom(), 80);
          window.setTimeout(() => snapToBottom(), 180);
          // Fade back in after the first settle pass.
          window.setTimeout(() => setIsModeFading(false), 120);
        });
      });
    }, 120) as unknown as number;
  }, [searchDraft, requestScroll, setScrollLockReason, scrollContainerRef, isAtBottomRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  return {
    searchMode,
    setSearchMode,
    searchDraft,
    setSearchDraft,
    searchQuery,
    setSearchQuery,
    isModeFading,
    handleToggleSearchMode,
    handleRunSearch,
  };
}








