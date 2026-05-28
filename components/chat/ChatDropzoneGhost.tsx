"use client";

import { useState, useLayoutEffect, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";

export function ChatDropzoneGhost({ enabled }: { enabled: boolean }) {
  const { setNodeRef } = useDroppable({ id: "chat-dropzone" });
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (typeof document === "undefined") return;
    const el = document.querySelector('[data-chat-dropzone="true"]') as HTMLElement | null;
    const r = el?.getBoundingClientRect() ?? null;
    setRect(r);
  }, []);

  useLayoutEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }

    measure();
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [enabled, measure]);

  if (!enabled || !rect) return null;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        background: "transparent",
      }}
    />
  );
}






