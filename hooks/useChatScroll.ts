"use client";

import { useEffect, useRef, useState } from "react";

type ScrollRequest = { type: "toBottom" | "toTop" | "restore"; top?: number; reason?: string };

export function useChatScroll(opts: { isSending: boolean; isSearching: boolean | React.MutableRefObject<boolean> }) {
  const { isSending, isSearching } = opts;
  const isSearchingRef = useRef<boolean>(false);
  
  // Update ref from prop (either boolean or ref)
  // Read from ref on each render if it's a ref object, otherwise use boolean directly
  useEffect(() => {
    if (typeof isSearching === "object" && "current" in isSearching) {
      isSearchingRef.current = isSearching.current;
    } else {
      isSearchingRef.current = isSearching;
    }
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [showScrollDownFab, setShowScrollDownFab] = useState(false);
  const [scrollLockReason, setScrollLockReason] = useState<string | null>(null);

  const distToBottomRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);

  const userScrolledAwayDuringStreamRef = useRef<boolean>(false);
  const lastUserScrollAtRef = useRef<number>(0);
  const lastScrollTopRef = useRef<number>(0);

  // User intent scroll detection (for follow/detach)
  const userIntentScrollRef = useRef(false);
  const userIntentTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);

  const followAnimRef = useRef<number | null>(null);
  const followFromRef = useRef<number>(0);
  const followStartRef = useRef<number>(0);

  const [revealHeightById, setRevealHeightById] = useState<Record<string, number>>({});
  const fullHeightByIdRef = useRef<Record<string, number>>({});
  const revealMessageIdRef = useRef<number | null>(null);
  const isFollowingRevealRef = useRef(true);
  const userStoppedFollowRef = useRef(false);
  const autoFollowLatchRef = useRef<boolean>(true);

  // --- Post-reveal settle pinning window ---
  const postRevealSettleUntilRef = useRef<number>(0);
  // Throttle reveal pinning to reduce jitter
  const lastRevealPinAtRef = useRef<number>(0);
  // Throttle ResizeObserver pinning to reduce jitter during layout shifts
  const lastResizePinAtRef = useRef<number>(0);
  const lastMaxScrollRef = useRef<number>(0);

  // Scroll Governor (single scroll writer)
  const atBottomThresholdPxRef = useRef<number>(64);
  
  // Bottom tolerance for layout changes
  const BOTTOM_EPSILON = 12; // pixels

  // Keep a ref for RO callbacks (avoid stale closure)
  const isSendingRef = useRef<boolean>(isSending);
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  const requestScroll = (req: ScrollRequest) => {
    if (scrollLockReason !== null) {
      // Allow reveal-controlled scroll requests while reveal lock is active
      if (!(scrollLockReason === "reveal" && req.reason === "reveal")) {
        // If reveal lock is active, always allow toBottom requests (even without reason)
        if (!(scrollLockReason === "reveal" && req.type === "toBottom")) {
          // Allow deterministic snapping during mode-swap (enter-search / exit-search).
          // Also allow it if we're still locked as "search" (state timing) so exit-search never gets blocked.
          const allowedDuringModeSwap =
            (scrollLockReason === "mode-swap" || scrollLockReason === "search") &&
            (req.reason === "exit-search" || req.reason === "enter-search");
          if (!allowedDuringModeSwap) {
            return; // Locked, do nothing
          }
        }
      }
    }

    const container = scrollContainerRef.current;
    if (!container) return;

    let targetTop: number;
    if (req.type === "toBottom") {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      targetTop = maxScroll;
    } else if (req.type === "toTop") {
      targetTop = 0;
    } else if (req.type === "restore" && req.top !== undefined) {
      targetTop = req.top;
    } else {
      return;
    }

    programmaticScrollRef.current = true;
    const behavior: ScrollBehavior = req.reason === "reveal" ? "auto" : "auto";
    container.scrollTo({ top: targetTop, behavior });

    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  };

  const cancelFollow = () => {
    if (followAnimRef.current !== null) {
      cancelAnimationFrame(followAnimRef.current);
      followAnimRef.current = null;
    }
  };

  const smoothFollowToBottom = (container: HTMLDivElement, duration = 220) => {
    if (followAnimRef.current) cancelAnimationFrame(followAnimRef.current);

    followFromRef.current = container.scrollTop;
    followStartRef.current = performance.now();

    const tick = (now: number) => {
      // If user detached during stream, abort
      if (userScrolledAwayDuringStreamRef.current) {
        followAnimRef.current = null;
        return;
      }

      const t = Math.min(1, (now - followStartRef.current) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);

      const target = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextTop = followFromRef.current + (target - followFromRef.current) * eased;

      container.scrollTop = nextTop;

      if (t < 1) {
        followAnimRef.current = requestAnimationFrame(tick);
      } else {
        followAnimRef.current = null;
      }
    };

    followAnimRef.current = requestAnimationFrame(tick);
  };

  const startRevealHeight = (messageId: number) => {
    const id = String(messageId);
    const start = performance.now();
    let lastUiUpdate = 0;
    // Reveal speed is duration-based (not px/sec) so it scales with message height.
    const MIN_FRAME_MS = 20; // ~50fps UI updates for smoother reveal motion
    const MEASUREMENT_FAILSAFE_MS = 12_000;

    revealMessageIdRef.current = messageId;
    setScrollLockReason("reveal");
    // Force the reveal to start from 1px on the very first paint.
    // Prevents a 1-frame "flash" where revealHeight jumps to a large value.
    setRevealHeightById((prev) => ({
      ...prev,
      [id]: 1,
    }));
    // Capture whether we were attached at reveal start.
    // IMPORTANT: do NOT forcibly re-attach here; if the user scrolled up during `isSending`,
    // we must respect that and avoid auto-follow.
    const revealStartedAtBottom = isAtBottomRef.current;

    // Only enable follow if we started attached AND the user has not already detached.
    // (userStoppedFollowRef/autoFollowLatchRef can be flipped by pre-emptive user scrolling.)
    if (revealStartedAtBottom && !userStoppedFollowRef.current && autoFollowLatchRef.current) {
      isFollowingRevealRef.current = true;
      userScrolledAwayDuringStreamRef.current = false;
      // NOTE: Initial pin moved to after measurement exists to prevent scrollHeight race condition
    } else {
      // Stay detached: do not pin, do not re-enable follow.
      isFollowingRevealRef.current = false;
    }

    // Duration will be computed once we have the measured height
    let DURATION: number | null = null;
    // Track if we've done the initial pin yet (prevents premature pinning before measurement)
    let initialPinDone = false;

    const tick = (now: number) => {
      const full = fullHeightByIdRef.current[id];

      // Wait until we have a real measured height.
      // Avoid using synthetic fallback heights for timing (causes occasional "fast long message").
      if (!full || full <= 0) {
        // Failsafe: if measurement somehow never arrives, unlock reveal and show content.
        if (now - start > MEASUREMENT_FAILSAFE_MS) {
          revealMessageIdRef.current = null;
          setScrollLockReason(null);
          setRevealHeightById((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          return;
        }
        requestAnimationFrame(tick);
        return;
      }

      const fullHeight = full;

      // Skip reveal animation only for extremely tiny messages (single words/fragments)
      // Normal short messages (3 lines = ~60-90px) should animate slowly and smoothly
      if (fullHeight <= 20) {
        setRevealHeightById((prev) => ({
          ...prev,
          [id]: fullHeight,
        }));
        revealMessageIdRef.current = null;
        setScrollLockReason(null);
        // Do initial pin if needed (after setting reveal height to full)
        if (
          !initialPinDone &&
          revealStartedAtBottom &&
          !userStoppedFollowRef.current &&
          autoFollowLatchRef.current
        ) {
          initialPinDone = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestScroll({ type: "toBottom", reason: "reveal" });
            });
          });
        }
        return; // Skip animation only for extremely tiny messages
      }

      // Do initial pin here, after measurement exists (prevents "jump up then down" bounce)
      // This ensures scrollHeight is stable before we calculate maxScroll
      if (
        !initialPinDone &&
        revealStartedAtBottom &&
        !userStoppedFollowRef.current &&
        autoFollowLatchRef.current
      ) {
        initialPinDone = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestScroll({ type: "toBottom", reason: "reveal" });
          });
        });
      }

      // Compute duration based on constant px/sec speeds (only once after measurement)
      // Goal: short replies should feel intentionally paced (not a snap).
      if (DURATION === null) {
        // Baseline speed
        let pxPerSecond = 420;

        // Small blocks: slow down a lot so they don't "pop".
        // (Keep this piecewise so tuning is obvious.)
        if (fullHeight <= 140) {
          pxPerSecond = 120;
        } else if (fullHeight <= 240) {
          pxPerSecond = 160;
        } else if (fullHeight <= 420) {
          pxPerSecond = 220;
        } else if (fullHeight <= 900) {
          pxPerSecond = 360;
        } else if (fullHeight <= 1600) {
          pxPerSecond = 560;
        } else if (fullHeight <= 2600) {
          pxPerSecond = 700;
        } else {
          pxPerSecond = 820;
        }

        // Long replies: run at ~70% of current speed (user tuning).
        if (fullHeight >= 900) {
          pxPerSecond *= 0.7;
        }

        // Duration derived from px/sec, then clamped so small replies never finish too fast.
        const computed = (fullHeight / pxPerSecond) * 1000;

        // Hard floor for perceived smoothness on small-ish replies.
        // (These were snapping before because height is low.)
        const minMs = fullHeight <= 300 ? 1200 : fullHeight <= 600 ? 820 : fullHeight <= 1200 ? 620 : 460;

        DURATION = Math.max(minMs, computed);
      }

      // Duration-based reveal (uses computed DURATION above)
      const elapsedMs = now - start;
      const pLinear = Math.min(1, Math.max(0, elapsedMs / DURATION));
      // Long replies: smooth slow->medium->slow pacing with no piecewise handoff.
      // We blend linear with smoothstep to keep the middle from spiking while still
      // easing both ends.
      const p =
        fullHeight >= 900
          ? (() => {
              const t = pLinear;
              const smoothstep = t * t * (3 - 2 * t);
              const blend = 0.45;
              return t + (smoothstep - t) * blend;
            })()
          : pLinear < 0.5
            ? 4 * pLinear * pLinear * pLinear
            : 1 - Math.pow(-2 * pLinear + 2, 3) / 2;
      const revealPx = Math.min(fullHeight, Math.max(1, fullHeight * p));

      // Throttle UI state writes (avoid rerendering the entire page at 60fps)
      if (now - lastUiUpdate >= MIN_FRAME_MS || p >= 1) {
        lastUiUpdate = now;
        setRevealHeightById((prev) => ({
          ...prev,
          [id]: revealPx,
        }));
      }

      // Follow only while the user is still attached; never fight user input.
      if (
        autoFollowLatchRef.current &&
        isFollowingRevealRef.current &&
        !userStoppedFollowRef.current &&
        scrollContainerRef.current
      ) {
        // If we started attached, stay pinned for the entire reveal unless user intent detaches.
        // (The detach signal is `userStoppedFollowRef/autoFollowLatch` set by markUserIntent/scroll handling.)
        if (revealStartedAtBottom) {
          // Throttle bottom pinning during reveal (reduces jitter)
          const last = lastRevealPinAtRef.current || 0;
          if (now - last >= 24 || p >= 1) {
            lastRevealPinAtRef.current = now;
            requestScroll({ type: "toBottom", reason: "reveal" });
          }
        }
      }

      if (revealPx < fullHeight) {
        requestAnimationFrame(tick);
      } else {
        // Reveal complete
        setRevealHeightById((prev) => ({
          ...prev,
          [id]: fullHeight,
        }));
        // Keep bottom pinning alive briefly after reveal so late layout changes
        // (e.g. tool-row fade-in, font/layout settle) don't leave us slightly above bottom.
        postRevealSettleUntilRef.current = Date.now() + 900;
        // Final snap to bottom when reveal completes.
        // We do multiple passes because the UI can change height right after reveal
        // (e.g. tool row mounts / fades in), which increases scrollHeight AFTER the first snap.
        if (
          autoFollowLatchRef.current &&
          isFollowingRevealRef.current &&
          !userStoppedFollowRef.current &&
          scrollContainerRef.current
        ) {
          const snapIfNearBottom = () => {
            const c = scrollContainerRef.current;
            if (!c) return;
            // If the user scrolled away, don't steal focus back.
            if (!autoFollowLatchRef.current || userStoppedFollowRef.current) return;

            const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
            const distToBottom = maxScroll - c.scrollTop;

            // Only snap if we're already basically following (prevents jank if user stopped).
            if (distToBottom < 120) {
              programmaticScrollRef.current = true;
              c.scrollTop = maxScroll;
              isAtBottomRef.current = true;
              requestAnimationFrame(() => {
                programmaticScrollRef.current = false;
              });
            }
          };

          // Run a short "settle" loop across several frames to catch late layout changes
          // (mount + transitions). This is more reliable than a single timeout.
          let frames = 0;
          const settle = () => {
            frames += 1;
            snapIfNearBottom();
            if (frames < 12) {
              requestAnimationFrame(settle);
            }
          };
          requestAnimationFrame(settle);

          // Extra late passes for CSS transitions / layout settling.
          window.setTimeout(() => snapIfNearBottom(), 120);
          window.setTimeout(() => snapIfNearBottom(), 300);
        }
        // Unlock scroll after the post-reveal settle window so we don't stop pinning
        // before late layout changes complete.
        window.setTimeout(() => {
          setScrollLockReason(null);
        }, 950);
        revealMessageIdRef.current = null;
        // Ensure reveal follow state is reset for next message
        userStoppedFollowRef.current = false;
      }
    };

    // Reset throttle refs at start of each reveal
    lastRevealPinAtRef.current = 0;
    lastResizePinAtRef.current = 0;
    requestAnimationFrame(tick);
  };

  const resetRevealState = () => {
    setRevealHeightById({});
    revealMessageIdRef.current = null;
    isFollowingRevealRef.current = true;
    autoFollowLatchRef.current = true;
    userStoppedFollowRef.current = false;
    userScrolledAwayDuringStreamRef.current = false;
  };

  // Track scroll position to detect if user is at bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const inSearchResults = isSearchingRef.current;

    // --- User intent scroll listeners ---
    const markUserIntent = () => {
      userIntentScrollRef.current = true;

      if (userIntentTimerRef.current !== null) {
        window.clearTimeout(userIntentTimerRef.current);
      }
      userIntentTimerRef.current = window.setTimeout(() => {
        userIntentScrollRef.current = false;
        userIntentTimerRef.current = null;
      }, 180) as unknown as number;
    };

    const onWheel = (e: WheelEvent) => {
      const inFollowWindow =
        revealMessageIdRef.current !== null ||
        isSendingRef.current ||
        Date.now() < postRevealSettleUntilRef.current;

      // If a reply is revealing/sending, ANY upward wheel = detach immediately.
      if (inFollowWindow && e.deltaY < 0) {
        userScrolledAwayDuringStreamRef.current = true;
        userStoppedFollowRef.current = true;
        isFollowingRevealRef.current = false;
        autoFollowLatchRef.current = false;
        cancelFollow();
        postRevealSettleUntilRef.current = 0;
      }

      // Track wheel interaction as user intent for scroll bookkeeping.
      markUserIntent();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        markUserIntent();
      }
    };

    const onTouchStart = () => {
      markUserIntent();
    };
    const onTouchMove = () => {
      markUserIntent();
    };

    const onPointerDown = () => {
      markUserIntent();
    };

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const prevTop = lastScrollTopRef.current;
      const userScrolledUp = scrollTop < prevTop - 0.1;
      const userScrolledDown = scrollTop > prevTop + 0.1;
      const threshold = atBottomThresholdPxRef.current;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);
      const distToBottom = Math.max(0, maxScroll - scrollTop);
      const atBottom = distToBottom < threshold;
      lastMaxScrollRef.current = maxScroll;

      // Keep latest distance for UI decisions
      distToBottomRef.current = distToBottom;

      // In search results, only update scroll refs and FAB, skip follow/detach logic
      if (inSearchResults) {
        lastScrollTopRef.current = scrollTop;
        isAtBottomRef.current = atBottom;
        lastUserScrollAtRef.current = Date.now();
        const shouldShow = !atBottom && distToBottom > 140;
        setShowScrollDownFab(shouldShow);
        return;
      }

      // Ignore programmatic scrolls for detaching here.
      // We still update bookkeeping so the UI stays accurate.
      if (programmaticScrollRef.current) {
        lastScrollTopRef.current = scrollTop;
        isAtBottomRef.current = atBottom;
        lastUserScrollAtRef.current = Date.now();
        // Show the down-arrow whenever the user is meaningfully away from bottom.
        // (Not tied to detach state; this is a general "bring me down" affordance.)
        const shouldShow = !atBottom && distToBottom > 140;
        setShowScrollDownFab(shouldShow);
        return;
      }

      // Detach follow on any real user upward scroll during reveal/sending.
      // (Covers scrollbar drag / trackpad / kinetic scroll, not just wheel-up.)
      const inFollowWindow =
        revealMessageIdRef.current !== null ||
        isSendingRef.current ||
        Date.now() < postRevealSettleUntilRef.current;

      if (inFollowWindow && !programmaticScrollRef.current) {
        if (userScrolledUp) {
          userScrolledAwayDuringStreamRef.current = true;
          userStoppedFollowRef.current = true;
          isFollowingRevealRef.current = false;
          autoFollowLatchRef.current = false;
          cancelFollow();
          postRevealSettleUntilRef.current = 0;
        }
      }

      // If user scrolls back down near bottom during reveal/sending, re-arm follow.
      // This avoids requiring a click on the down-arrow FAB to reattach.
      if (inFollowWindow && userScrolledDown) {
        const nearBottomForReattach = distToBottom < Math.max(140, threshold + 80);
        if (nearBottomForReattach) {
          userStoppedFollowRef.current = false;
          isFollowingRevealRef.current = true;
          autoFollowLatchRef.current = true;
          userScrolledAwayDuringStreamRef.current = false;
        }
      }

      // Reattach rule: if atBottom is true
      if (atBottom) {
        userStoppedFollowRef.current = false;
        isFollowingRevealRef.current = true;
        autoFollowLatchRef.current = true;
        userScrolledAwayDuringStreamRef.current = false;
        setShowScrollDownFab(false);
      }

      // Always update refs at the end
      lastScrollTopRef.current = scrollTop;
      isAtBottomRef.current = atBottom;
      lastUserScrollAtRef.current = Date.now();
      // Show the down-arrow whenever the user is meaningfully away from bottom.
      // (Not tied to detach state; this is a general "bring me down" affordance.)
      const shouldShow = !atBottom && distToBottom > 140;
      setShowScrollDownFab(shouldShow);
    };

    container.addEventListener("scroll", handleScroll);
    lastMaxScrollRef.current = Math.max(0, container.scrollHeight - container.clientHeight);
    handleScroll();
    // Keep bottom-follow accurate even when scrollHeight changes without a user scroll event
    // (e.g. new assistant message mounts under the composer, images load, fonts/layout settle).
    const ro = new ResizeObserver(() => {
      // Capture pre-resize attachment state.
      // IMPORTANT: if we call `handleScroll()` first, width-driven reflow (panel open/close) can
      // temporarily push us away from bottom and we'd lose the "was attached" signal.
      const wasAtBottom = isAtBottomRef.current;
      requestAnimationFrame(() => {
        const c = scrollContainerRef.current;
        if (!c) return;
        const prevMaxScroll = lastMaxScrollRef.current;
        const prevTop = lastScrollTopRef.current;
        const prevDistToBottom = Math.max(0, prevMaxScroll - prevTop);
        const threshold = atBottomThresholdPxRef.current;
        const wasAttachedBeforeResize =
          wasAtBottom || isAtBottomRef.current || distToBottomRef.current <= threshold || prevDistToBottom <= threshold;

        // If the user was at bottom before a resize/reflow (e.g. opening a second panel),
        // preserve bottom distance continuously so reflow feels like native window resizing.
        const shouldAnchorOnResize =
          wasAttachedBeforeResize &&
          !isSearchingRef.current &&
          revealMessageIdRef.current === null &&
          autoFollowLatchRef.current &&
          !userStoppedFollowRef.current;

        if (shouldAnchorOnResize) {
          const nextMaxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
          const nextTop = Math.max(0, Math.min(nextMaxScroll, nextMaxScroll - prevDistToBottom));
          if (Math.abs(nextTop - c.scrollTop) > 0.01) {
            programmaticScrollRef.current = true;
            c.scrollTop = nextTop;
            requestAnimationFrame(() => {
              programmaticScrollRef.current = false;
            });
          }
        }

        // Update atBottom/distToBottom bookkeeping after any pin attempt.
        handleScroll();

        // Check if we need to auto-pin due to layout changes
        const roMaxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
        const roDistToBottom = Math.max(0, roMaxScroll - c.scrollTop);
        
        // Auto-pin if within epsilon tolerance (fixes long chat scroll offset)
        if (roDistToBottom <= BOTTOM_EPSILON) {
          c.scrollTop = roMaxScroll;
        }

        const withinPostRevealSettle = Date.now() < postRevealSettleUntilRef.current;

        const shouldFollow =
          (revealMessageIdRef.current !== null || isSending || withinPostRevealSettle) &&
          autoFollowLatchRef.current &&
          isFollowingRevealRef.current &&
          !userStoppedFollowRef.current;

        if (!shouldFollow) return;

        // During active reveal, RO should NOT pin at all.
        // Only the reveal loop should be the writer.
        if (revealMessageIdRef.current !== null) {
          // Still update distance refs for accurate UI state
          const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
          const distToBottom = Math.max(0, maxScroll - c.scrollTop);
          distToBottomRef.current = distToBottom;
          isAtBottomRef.current = distToBottom < atBottomThresholdPxRef.current;
          return;
        }

        // Only pin if we're already basically at the bottom.
        // This prevents the "jump up then down" when late UI (tool buttons) mounts.
        const followMaxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
        const followDistToBottom = Math.max(0, followMaxScroll - c.scrollTop);
        
        // Update distance refs even when not pinning (fixes stale values)
        distToBottomRef.current = followDistToBottom;
        isAtBottomRef.current = followDistToBottom < atBottomThresholdPxRef.current;
        
        // Auto-pin if within epsilon tolerance (fixes long chat scroll offset)
        if (followDistToBottom <= BOTTOM_EPSILON) {
          c.scrollTop = followMaxScroll;
          return;
        }

        // While actively sending (or in the short post-reveal settle window), keep following even
        // if we drift farther than the normal near-bottom threshold.
        const allowFarFollow = isSendingRef.current || withinPostRevealSettle;
        if (!allowFarFollow && followDistToBottom > 180) return;

        // Throttle RO-driven pins (layout can tick fast during transitions)
        const now = performance.now();
        const last = lastResizePinAtRef.current || 0;
        if (now - last < 28) return; // ~36fps cap
        lastResizePinAtRef.current = now;

        // Use a short smooth follow to avoid the visible "twitch" when the assistant block first mounts.
        // During active reveal we still use the reveal pin writer.
        if (revealMessageIdRef.current === null && isSendingRef.current) {
          smoothFollowToBottom(c, 220);
        } else {
          requestScroll({ type: "toBottom", reason: "reveal" });
        }
        // Keep bookkeeping consistent for the next tick.
        isAtBottomRef.current = true;
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", onWheel as any);
      container.removeEventListener("pointerdown", onPointerDown as any);
      container.removeEventListener("touchstart", onTouchStart as any);
      container.removeEventListener("touchmove", onTouchMove as any);
      window.removeEventListener("keydown", onKeyDown);
      if (userIntentTimerRef.current !== null) {
        window.clearTimeout(userIntentTimerRef.current);
        userIntentTimerRef.current = null;
      }
      userIntentScrollRef.current = false;
    };
  }, [isSending]);

  // Cleanup: cancel follow animation on unmount
  useEffect(() => {
    return () => {
      if (followAnimRef.current) cancelAnimationFrame(followAnimRef.current);
    };
  }, []);

  return {
    // main refs
    scrollContainerRef,
    distToBottomRef,
    isAtBottomRef,
    programmaticScrollRef,
    // reveal
    revealHeightById,
    setRevealHeightById,
    fullHeightByIdRef,
    revealMessageIdRef,
    startRevealHeight,
    resetRevealState,
    // follow flags (used by FAB + other callsites)
    userScrolledAwayDuringStreamRef,
    isFollowingRevealRef,
    userStoppedFollowRef,
    autoFollowLatchRef,
    // lock + writer
    scrollLockReason,
    setScrollLockReason,
    requestScroll,
    // UI
    showScrollDownFab,
    setShowScrollDownFab,
  };
}
