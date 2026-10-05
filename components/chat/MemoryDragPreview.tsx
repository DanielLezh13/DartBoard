"use client";

import { Bookmark } from "lucide-react";

export function MemoryDragPreview({ title }: { title: string | null }) {
  return (
    <div
      data-memory-drag-preview="true"
      className="pointer-events-none flex w-[240px] items-center gap-2.5 rounded-lg border border-sky-400/35 bg-[#172337] px-3 py-2.5 text-gray-100 shadow-lg"
    >
      <Bookmark className="h-4 w-4 shrink-0 text-sky-300" />
      <span className="min-w-0 truncate text-sm font-medium">{title || "Untitled"}</span>
    </div>
  );
}
