"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type EdgeSeamsProps = {
  sidebarHidden: boolean;
  rightDockHidden: boolean;
  layoutMode: "narrow" | "medium" | "wide";
  centerPadding: number;
};

export function EdgeSeams({
  sidebarHidden,
  rightDockHidden,
  layoutMode,
  centerPadding,
}: EdgeSeamsProps) {
  const [mounted, setMounted] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    // Create/get dedicated portal root at body level
    let root = document.getElementById("edge-seams-portal");
    if (!root) {
      root = document.createElement("div");
      root.id = "edge-seams-portal";
      root.style.position = "fixed";
      root.style.top = "0";
      root.style.left = "0";
      root.style.width = "0";
      root.style.height = "0";
      root.style.pointerEvents = "none";
      root.style.zIndex = "99999";
      root.style.margin = "0";
      root.style.padding = "0";
      document.body.appendChild(root);
    }
    setPortalRoot(root);
    setMounted(true);

    return () => {
      // Cleanup: remove portal root on unmount
      if (root && root.parentNode) {
        root.parentNode.removeChild(root);
      }
    };
  }, []);

  if (!mounted || !portalRoot) {
    return null;
  }

  const isNarrow = layoutMode === "narrow";

  return createPortal(
    <>
      {/* Left seam shadow - fixed at viewport edge */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: `-${centerPadding}px`,
          top: "0px",
          height: "100vh",
          width: `${centerPadding + 24}px`,
          zIndex: 99999,
          pointerEvents: "none",
          margin: 0,
          padding: 0,
          transform: "translateX(0)",
        }}
        className={`transition-opacity duration-300 shadow-[12px_0_28px_rgba(0,0,0,0.45),4px_0_10px_rgba(0,0,0,0.35)] ring-1 ring-white/5 outline outline-2 outline-red-500 ${
          sidebarHidden && !isNarrow ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Right seam shadow - fixed at viewport edge */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          right: `-${centerPadding}px`,
          top: "0px",
          height: "100vh",
          width: `${centerPadding + 24}px`,
          zIndex: 99999,
          pointerEvents: "none",
          margin: 0,
          padding: 0,
          transform: "translateX(0)",
        }}
        className={`transition-opacity duration-300 shadow-[-12px_0_28px_rgba(0,0,0,0.45),-4px_0_10px_rgba(0,0,0,0.35)] ring-1 ring-white/5 outline outline-2 outline-red-500 ${
          rightDockHidden && !isNarrow ? "opacity-100" : "opacity-0"
        }`}
      />
    </>,
    portalRoot
  );
}

