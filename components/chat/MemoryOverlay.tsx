"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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

type MemoryOverlayProps = {
  memory: Memory | null;
  folders: string[];
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    id: number;
    title: string;
    folder_name: string;
  }) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  saving?: boolean;
  deleting?: boolean;
  error?: string | null;
};

export function MemoryOverlay({
  memory,
  folders,
  open,
  onClose,
  onSave,
  onDelete,
  saving = false,
  deleting = false,
  error = null,
}: MemoryOverlayProps) {
  const overlayRef = React.useRef<HTMLDivElement>(null);
  
  // Force scroll to top using useLayoutEffect to beat editor mount
  React.useLayoutEffect(() => {
    if (!open) return;
    
    // Double requestAnimationFrame to ensure we run after any mount effects
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollContainer = document.querySelector('[data-memory-scroll]') as HTMLElement;
        if (scrollContainer) {
          scrollContainer.scrollTop = 0;
        }
      });
    });
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !memory) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      onMouseDown={(e) => {
        // Close on backdrop click (use mouse-down to beat inner focus handlers).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dimmed chat background */}
      <div
        className="fixed inset-0 bg-gray-900/40 transition-opacity duration-300 pointer-events-none"
        style={{ opacity: 0.35 }}
      />

      {/* Memory overlay content */}
      <div
        className="relative mt-16 mb-16 w-full max-w-4xl bg-gray-900 rounded-lg shadow-2xl border border-gray-700/50 transition-all duration-300"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(-20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (explicit, avoids getting stuck) */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-300 hover:text-gray-100 hover:bg-white/5 transition"
          aria-label="Close memory"
          title="Close (Esc)"
        >
          <span className="text-xl leading-none">×</span>
        </button>
        <MemoryPreview
          memory={memory}
          folders={folders}
          onSave={onSave}
          onDelete={onDelete}
          saving={saving}
          deleting={deleting}
          error={error}
        />
      </div>
    </div>,
    document.body
  );
}

