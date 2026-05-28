import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { panelDebug } from "@/lib/panelDebug";

const SLIDE_MS = 300;

// Signed-in only: detect tab resume (visible after having been hidden)
let signedInWasDocumentHidden = false;

export function usePanels(
  layoutMode: "wide" | "medium" | "narrow",
  lastResizeEdgeRef: React.RefObject<"left" | "right" | null>,
  scopeKind?: string | null,
  resizeGestureIdRef?: React.RefObject<number>,
  resizeEdgeReadyRef?: React.RefObject<boolean>
) {
  const SS_FRESH_SIGNED_IN_ENTRY = "db:freshSignedInEntry";
  // SSR-safe defaults: start hidden, then hydrate from localStorage after mount.
  // IMPORTANT: do NOT read storage in state initializers (prevents hydration mismatch).
  const [sidebarHidden, _setSidebarHidden] = useState(true);
  // "rightDock" is a legacy name retained for storage/state compatibility.
  // This controls visibility of the memory-side dock area.
  const [rightDockHidden, _setRightDockHidden] = useState(true);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const [keepOverlaysVisible, setKeepOverlaysVisible] = useState(false);
  const [hasHydratedPanels, setHasHydratedPanels] = useState(false);
  const [bootResolvedPanels, setBootResolvedPanels] = useState(false);

  const lastOpenedSideRef = useRef<"left" | "right" | null>(null);
  const prevLayoutModeRef = useRef(layoutMode);
  const mediumAutoCloseTimerRef = useRef<number | null>(null);
  const layoutModeRef = useRef(layoutMode);
  const sidebarHiddenRef = useRef(sidebarHidden);
  const rightDockHiddenRef = useRef(rightDockHidden);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
    sidebarHiddenRef.current = sidebarHidden;
    rightDockHiddenRef.current = rightDockHidden;
  }, [layoutMode, sidebarHidden, rightDockHidden]);

  // Signed-in only: track when document goes hidden (tab switch away)
  useEffect(() => {
    if (scopeKind !== "user") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") signedInWasDocumentHidden = true;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scopeKind]);

  const SS_TAB_INIT = "db:tabInit";

  // Check if tab init marker exists (same-tab reload) BEFORE setting it.
  // This must run synchronously on mount, before restore logic.
  const isSameTabRef = useRef<boolean | null>(null);
  if (typeof window !== "undefined" && isSameTabRef.current === null) {
    try {
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const isReload =
        navEntry?.type === "reload" || (window as any).performance?.navigation?.type === 1;
      const hadTabMarker = sessionStorage.getItem(SS_TAB_INIT) === "1";
      isSameTabRef.current = isReload && hadTabMarker;
      // Set marker immediately (for next reload).
      sessionStorage.setItem(SS_TAB_INIT, "1");
    } catch {
      isSameTabRef.current = false;
    }
  }

  // Single-writer wrappers (gated by bootResolvedPanels)
  const setSidebarHidden = (hidden: boolean) => {
    _setSidebarHidden(hidden);
    if (bootResolvedPanels) {
      try { sessionStorage.setItem("db:sidebarHidden", hidden ? "true" : "false"); } catch {}
    }
  };

  const setRightDockHidden = (hidden: boolean) => {
    _setRightDockHidden(hidden);
    if (bootResolvedPanels) {
      try { sessionStorage.setItem("db:rightDockHidden", hidden ? "true" : "false"); } catch {}
    }
  };

  // Hydrate panel state from sessionStorage after mount (SSR-safe, per-tab).
  // Only restore if same tab (db:tabInit already exists).
  // Signed-in only: skip restore when resuming from tab switch (wasDocumentHidden).
  useEffect(() => {
    if (bootResolvedPanels) return;
    if (typeof window === "undefined") return;

    // Signed-in: if we're resuming from hidden (tab switch back), skip restore
    if (scopeKind === "user" && signedInWasDocumentHidden) {
      signedInWasDocumentHidden = false;
      setBootResolvedPanels(true);
      setHasHydratedPanels(true);
      return;
    }
    
    try {
      const freshSignedInEntry = sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1";
      if (scopeKind === "user" && freshSignedInEntry) {
        _setSidebarHidden(true);
        _setRightDockHidden(true);
        setSidebarOpen(false);
        setRightOverlayOpen(false);
        setKeepOverlaysVisible(false);
        setBootResolvedPanels(true);
        setHasHydratedPanels(true);
        return;
      }

      // Check if this is a same-tab reload (db:tabInit already existed before we set it).
      const isSameTab = isSameTabRef.current === true;

      if (!isSameTab) {
        // New tab: keep defaults, mark boot resolved.
        setBootResolvedPanels(true);
        setHasHydratedPanels(true);
        return;
      }

      // Same tab reload: restore from sessionStorage.
      const left = sessionStorage.getItem("db:sidebarHidden");
      const right = sessionStorage.getItem("db:rightDockHidden");
      const sOpen = sessionStorage.getItem("db:sidebarOpen");
      const rOpen = sessionStorage.getItem("db:rightOverlayOpen");
      const keep = sessionStorage.getItem("db:keepOverlaysVisible");

      if (left != null) _setSidebarHidden(left === "true");
      if (right != null) _setRightDockHidden(right === "true");

      const restoredSidebarOpen = sOpen === "true";
      const restoredRightOverlayOpen = rOpen === "true";
      const restoredKeepOverlaysVisible = keep === "true";

      // Overlay states are only valid in narrow mode (or during a live narrow->wide transition).
      // On refresh there is no in-flight transition, so restoring stale overlay flags in wide/medium
      // can leave a full-screen click layer mounted and make rail toggles appear "dead".
      if (layoutMode === "narrow") {
        if (sOpen != null) setSidebarOpen(restoredSidebarOpen);
        if (rOpen != null) setRightOverlayOpen(restoredRightOverlayOpen);
        if (keep != null) setKeepOverlaysVisible(restoredKeepOverlaysVisible);
      } else {
        setSidebarOpen(false);
        setRightOverlayOpen(false);
        setKeepOverlaysVisible(false);
        try {
          sessionStorage.setItem("db:sidebarOpen", "false");
          sessionStorage.setItem("db:rightOverlayOpen", "false");
          sessionStorage.setItem("db:keepOverlaysVisible", "false");
        } catch {
          // ignore storage failures
        }
      }
    } catch {
      // ignore
    }
    
    // Mark boot resolved AFTER restore decision is complete.
    setBootResolvedPanels(true);
    setHasHydratedPanels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind]);

  // Persist overlay state (per-tab) ONLY after boot resolved.
  useEffect(() => {
    if (!bootResolvedPanels) return; // Gate: no persistence until restore is complete.
    try { sessionStorage.setItem("db:sidebarOpen", sidebarOpen ? "true" : "false"); } catch {}
  }, [sidebarOpen, bootResolvedPanels]);

  useEffect(() => {
    if (!bootResolvedPanels) return; // Gate: no persistence until restore is complete.
    try { sessionStorage.setItem("db:rightOverlayOpen", rightOverlayOpen ? "true" : "false"); } catch {}
  }, [rightOverlayOpen, bootResolvedPanels]);

  useEffect(() => {
    if (!bootResolvedPanels) return; // Gate: no persistence until restore is complete.
    try { sessionStorage.setItem("db:keepOverlaysVisible", keepOverlaysVisible ? "true" : "false"); } catch {}
  }, [keepOverlaysVisible, bootResolvedPanels]);

  // Close overlays on mode changes (single place)
  useLayoutEffect(() => {
    if (!bootResolvedPanels) {
      // During boot restore, only sync previous mode; do not run transitions/enforcement.
      prevLayoutModeRef.current = layoutMode;
      return;
    }

    const prev = prevLayoutModeRef.current;
    const enteringNarrow = layoutMode === "narrow" && prev !== "narrow";
    const exitingNarrow = prev === "narrow" && layoutMode !== "narrow";

    if (exitingNarrow) {
      // Capture overlay-open state before mutating anything
      const wasLeftOpen = sidebarOpen;
      const wasRightOpen = rightOverlayOpen;

      // 1) If an overlay was open, immediately open its corresponding grid panel
      // (prevents visible close-then-open beat)
      if (wasLeftOpen) setSidebarHidden(false);
      if (wasRightOpen) setRightDockHidden(false);

      // 2) Keep overlays visible during grid transition, then close after animation
      if (wasLeftOpen || wasRightOpen) {
        setKeepOverlaysVisible(true);
        // Close overlays after grid animation completes (300ms)
        setTimeout(() => {
          setSidebarOpen(false);
          setRightOverlayOpen(false);
          setKeepOverlaysVisible(false);
        }, SLIDE_MS);
      } else {
        // No overlays were open, close immediately
        setSidebarOpen(false);
        setRightOverlayOpen(false);
      }
    } else if (enteringNarrow) {
      // When entering narrow: just close overlays
      setSidebarOpen(false);
      setRightOverlayOpen(false);
    }

    prevLayoutModeRef.current = layoutMode;
  }, [layoutMode, sidebarOpen, rightOverlayOpen, bootResolvedPanels]);

  // Update panel hidden state when entering narrow (for localStorage persistence)
  // Grid handles visual closing (width 0px animates smoothly)
  useEffect(() => {
    if (!bootResolvedPanels) return;
    if (layoutMode === "narrow") {
      const timer = setTimeout(() => {
        if (!sidebarHidden) setSidebarHidden(true);
        if (!rightDockHidden) setRightDockHidden(true);
      }, SLIDE_MS);
      return () => clearTimeout(timer);
    }
  }, [layoutMode, sidebarHidden, rightDockHidden, bootResolvedPanels]);

  // Enforce rules (single place)
  useEffect(() => {
    if (!bootResolvedPanels) return;

    const AUTO_CLOSE_RETRY_MS = 40;
    const AUTO_CLOSE_MAX_RETRIES = 40;

    const clearMediumAutoCloseTimer = () => {
      if (mediumAutoCloseTimerRef.current != null) {
        window.clearTimeout(mediumAutoCloseTimerRef.current);
        mediumAutoCloseTimerRef.current = null;
      }
    };

    const resolveMediumAutoClose = (attempt: number) => {
      const gestureId = resizeGestureIdRef?.current ?? null;
      // Abort if no longer in "both open, medium" state.
      if (
        layoutModeRef.current !== "medium" ||
        sidebarHiddenRef.current ||
        rightDockHiddenRef.current
      ) {
        panelDebug("panels", "auto-close-abort", {
          attempt,
          gestureId,
          reason: "state-changed",
          layoutMode: layoutModeRef.current,
          sidebarHidden: sidebarHiddenRef.current,
          rightDockHidden: rightDockHiddenRef.current,
        });
        clearMediumAutoCloseTimer();
        return;
      }

      const edge = lastResizeEdgeRef.current ?? null;
      const edgeReady = resizeEdgeReadyRef?.current ?? edge !== null;
      panelDebug("panels", "auto-close-attempt", {
        attempt,
        gestureId,
        edge,
        edgeReady,
        layoutMode: layoutModeRef.current,
      });

      if (edgeReady && edge === "left") {
        panelDebug("panels", "auto-close-action", {
          attempt,
          gestureId,
          edge,
          close: "left",
        });
        setSidebarHidden(true);
        lastOpenedSideRef.current = "right";
        clearMediumAutoCloseTimer();
        return;
      }

      if (edgeReady && edge === "right") {
        panelDebug("panels", "auto-close-action", {
          attempt,
          gestureId,
          edge,
          close: "right",
        });
        setRightDockHidden(true);
        lastOpenedSideRef.current = "left";
        clearMediumAutoCloseTimer();
        return;
      }

      if (attempt >= AUTO_CLOSE_MAX_RETRIES) {
        // Invariant: never use historical fallback for resize-driven close.
        panelDebug("panels", "auto-close-abort", {
          attempt,
          gestureId,
          reason: "edge-unknown-timeout",
          edge,
          edgeReady,
        });
        clearMediumAutoCloseTimer();
        return;
      }

      mediumAutoCloseTimerRef.current = window.setTimeout(
        () => resolveMediumAutoClose(attempt + 1),
        AUTO_CLOSE_RETRY_MS
      );
    };

    if (layoutMode === "wide") {
      clearMediumAutoCloseTimer();
      return;
    }

    // Narrow mode: enforce overlay states (only one at a time)
    if (layoutMode === "narrow") {
      clearMediumAutoCloseTimer();
      if (sidebarOpen && rightOverlayOpen) {
        if (lastOpenedSideRef.current === "right") {
          setSidebarOpen(false);
        } else {
          setRightOverlayOpen(false);
          lastOpenedSideRef.current = "left";
        }
      }
      return;
    }

    // Medium: only one push panel can be open at a time
    const leftOpen = !sidebarHidden;
    const rightOpen = !rightDockHidden;

    if (leftOpen && rightOpen) {
      panelDebug("panels", "auto-close-schedule", {
        gestureId: resizeGestureIdRef?.current ?? null,
        edge: lastResizeEdgeRef.current ?? null,
        edgeReady: resizeEdgeReadyRef?.current ?? null,
      });
      clearMediumAutoCloseTimer();
      resolveMediumAutoClose(0);
      return;
    }

    clearMediumAutoCloseTimer();
  }, [layoutMode, sidebarHidden, rightDockHidden, sidebarOpen, rightOverlayOpen, lastResizeEdgeRef, bootResolvedPanels]);

  useEffect(() => {
    return () => {
      if (mediumAutoCloseTimerRef.current != null) {
        window.clearTimeout(mediumAutoCloseTimerRef.current);
        mediumAutoCloseTimerRef.current = null;
      }
    };
  }, []);

  // Intent methods (single entry points)
  const toggleLeft = () => {
    lastOpenedSideRef.current = "left";

    if (layoutMode === "narrow") {
      // Narrow: toggle overlay, close other
      setSidebarOpen(v => !v);
      setRightOverlayOpen(false);
      return;
    }

    // Wide/Medium: toggle push panel
    if (layoutMode === "medium" && !sidebarHidden && !rightDockHidden) {
      // Left already open, close right
      setRightDockHidden(true);
      return;
    }

    if (layoutMode === "medium" && sidebarHidden && !rightDockHidden) {
      // Left closed, right open: swap
      setRightDockHidden(true);
      setSidebarHidden(false);
      if (sidebarOpen) setSidebarOpen(false);
      return;
    }

    // Normal toggle
    setSidebarHidden(!sidebarHidden);
    if (!sidebarHidden) {
      setSidebarOpen(false);
    }
  };

  const toggleRight = () => {
    lastOpenedSideRef.current = "right";

    if (layoutMode === "narrow") {
      // Narrow: toggle overlay, close other
      setRightOverlayOpen(v => !v);
      setSidebarOpen(false);
      return;
    }

    // Wide/Medium: toggle push panel
    if (layoutMode === "medium" && !rightDockHidden && !sidebarHidden) {
      // Right already open, close left
      setSidebarHidden(true);
      return;
    }

    if (layoutMode === "medium" && rightDockHidden && !sidebarHidden) {
      // Right closed, left open: swap
      setSidebarHidden(true);
      setRightDockHidden(false);
      return;
    }

    // Normal toggle
    setRightDockHidden(!rightDockHidden);
  };

  const closeOverlays = () => {
    setSidebarOpen(false);
    setRightOverlayOpen(false);
  };

  return {
    // State (read-only outside hook)
    sidebarHidden,
    rightDockHidden,
    sidebarOpen,
    rightOverlayOpen,
    keepOverlaysVisible, // Keep overlays visible during narrow→wide transition
    hasHydratedPanels,
    // Intent methods (use these)
    toggleLeft,
    toggleRight,
    closeOverlays,
    // Direct setters (try not to use, but available for edge cases)
    setSidebarHidden,
    setRightDockHidden,
  };
}
