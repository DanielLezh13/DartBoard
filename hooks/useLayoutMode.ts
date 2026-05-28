import { useState, useEffect, useRef } from "react";
import { panelDebug } from "@/lib/panelDebug";

const WIDE_MIN = 1280;
const MEDIUM_MIN = 860;

export function useLayoutMode() {
  const [layoutMode, setLayoutMode] = useState<"wide" | "medium" | "narrow">("wide");
  const [windowWidth, setWindowWidth] = useState(0);

  const lastResizeEdgeRef = useRef<"left" | "right" | null>(null);
  const resizeEdgeReadyRef = useRef(false);
  const resizeGestureIdRef = useRef(0);
  const resizeSessionEdgeRef = useRef<"left" | "right" | null>(null);
  const rightLockProvisionalRef = useRef(false);
  const stableNoXFramesRef = useRef(0);
  const resizeActiveRef = useRef(false);
  const gestureStartXRef = useRef(0);
  const gestureStartTsRef = useRef(0);
  const prevResizeWidthRef = useRef(0);
  const prevResizeXRef = useRef(0);
  const resizeIdleTimerRef = useRef<number | null>(null);
  const WIDTH_EPS = 0.5;
  const LEFT_CONFIRM_DX_PX = 4;
  const RIGHT_LOCK_MIN_FRAMES = 4;
  const RIGHT_LOCK_MIN_MS = 90;
  const RESIZE_IDLE_MS = 140;
  const EDGE_HOLD_AFTER_GESTURE_MS = 280;
  const clearEdgeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      const x = (typeof window.screenX === "number" ? window.screenX : (window as any).screenLeft) ?? 0;
      const prevWidth = prevResizeWidthRef.current;
      const prevX = prevResizeXRef.current;

      // Detect which edge is driving resize.
      // Uses left/right boundary movement so it stays reliable on tiny 1px resize steps.
      if (prevWidth > 0) {
        const widthDelta = width - prevWidth;
        if (Math.abs(widthDelta) >= WIDTH_EPS) {
          if (!resizeActiveRef.current) {
            resizeActiveRef.current = true;
            // New resize gesture: always start neutral so stale edge cannot leak.
            if (clearEdgeTimerRef.current != null) {
              window.clearTimeout(clearEdgeTimerRef.current);
              clearEdgeTimerRef.current = null;
            }
            lastResizeEdgeRef.current = null;
            resizeEdgeReadyRef.current = false;
            resizeGestureIdRef.current += 1;
            resizeSessionEdgeRef.current = null;
            rightLockProvisionalRef.current = false;
            stableNoXFramesRef.current = 0;
            gestureStartXRef.current = x;
            gestureStartTsRef.current = Date.now();
            panelDebug("layout", "gesture-start", {
              gestureId: resizeGestureIdRef.current,
              prevWidth,
              width,
              prevX,
              x,
              widthDelta,
            });
          }
          // Use cumulative gesture movement (not per-frame jitter) for left detection.
          // Right lock is provisional and can be overridden if left evidence appears later.
          const totalDx = x - gestureStartXRef.current;
          const leftConfirmed = Math.abs(totalDx) >= LEFT_CONFIRM_DX_PX;

          if (leftConfirmed && (resizeSessionEdgeRef.current !== "left" || rightLockProvisionalRef.current)) {
            const overridden = resizeSessionEdgeRef.current === "right" && rightLockProvisionalRef.current;
            resizeSessionEdgeRef.current = "left";
            rightLockProvisionalRef.current = false;
            resizeEdgeReadyRef.current = true;
            stableNoXFramesRef.current = 0;
            panelDebug("layout", overridden ? "edge-override" : "edge-lock", {
              gestureId: resizeGestureIdRef.current,
              edge: "left",
              totalDx,
              widthDelta,
              x,
              prevX,
            });
          } else if (!resizeSessionEdgeRef.current) {
            // No left evidence yet: only lock right after stable no-X frames and elapsed time.
            stableNoXFramesRef.current += 1;
            const elapsedMs = Date.now() - gestureStartTsRef.current;
            if (stableNoXFramesRef.current >= RIGHT_LOCK_MIN_FRAMES && elapsedMs >= RIGHT_LOCK_MIN_MS) {
              resizeSessionEdgeRef.current = "right";
              rightLockProvisionalRef.current = true;
              panelDebug("layout", "edge-lock", {
                gestureId: resizeGestureIdRef.current,
                edge: "right",
                totalDx,
                widthDelta,
                noXFrames: stableNoXFramesRef.current,
                elapsedMs,
                x,
                prevX,
                provisional: true,
              });
            }
          }

          if (resizeSessionEdgeRef.current) {
            // Keep edge stable for this resize gesture.
            lastResizeEdgeRef.current = resizeSessionEdgeRef.current;
          } else {
            // Still ambiguous; allow downstream fallback logic.
            lastResizeEdgeRef.current = null;
            resizeEdgeReadyRef.current = false;
          }
        }
      }

      if (resizeIdleTimerRef.current != null) {
        window.clearTimeout(resizeIdleTimerRef.current);
      }
      resizeIdleTimerRef.current = window.setTimeout(() => {
        const edgeAtEnd = resizeSessionEdgeRef.current;
        if (edgeAtEnd === "right" && rightLockProvisionalRef.current) {
          rightLockProvisionalRef.current = false;
          resizeEdgeReadyRef.current = true;
          panelDebug("layout", "edge-confirm", {
            gestureId: resizeGestureIdRef.current,
            edge: "right",
            reason: "gesture-end",
          });
        }
        panelDebug("layout", "gesture-end", {
          gestureId: resizeGestureIdRef.current,
          edge: edgeAtEnd,
          lastEdge: lastResizeEdgeRef.current,
          edgeReady: resizeEdgeReadyRef.current,
          width: window.innerWidth,
        });
        resizeActiveRef.current = false;
        gestureStartXRef.current = 0;
        gestureStartTsRef.current = 0;
        resizeIdleTimerRef.current = null;
        if (clearEdgeTimerRef.current != null) {
          window.clearTimeout(clearEdgeTimerRef.current);
          clearEdgeTimerRef.current = null;
        }
        clearEdgeTimerRef.current = window.setTimeout(() => {
          lastResizeEdgeRef.current = null;
          resizeSessionEdgeRef.current = null;
          rightLockProvisionalRef.current = false;
          resizeEdgeReadyRef.current = false;
          stableNoXFramesRef.current = 0;
          clearEdgeTimerRef.current = null;
        }, EDGE_HOLD_AFTER_GESTURE_MS);
      }, RESIZE_IDLE_MS);

      prevResizeWidthRef.current = width;
      prevResizeXRef.current = x;

      setWindowWidth(width);
      setLayoutMode(width >= WIDE_MIN ? "wide" : width >= MEDIUM_MIN ? "medium" : "narrow");
    };

    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (resizeIdleTimerRef.current != null) {
        window.clearTimeout(resizeIdleTimerRef.current);
        resizeIdleTimerRef.current = null;
      }
      if (clearEdgeTimerRef.current != null) {
        window.clearTimeout(clearEdgeTimerRef.current);
        clearEdgeTimerRef.current = null;
      }
    };
  }, []);

  return { layoutMode, windowWidth, lastResizeEdgeRef, resizeGestureIdRef, resizeEdgeReadyRef };
}
