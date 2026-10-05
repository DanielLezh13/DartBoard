"use client";

import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";

export function ChatDropzoneTarget({
  activeDragId,
  currentOverId,
  memoryOverlayOpen,
  coveredRightPx = 0,
}: {
  activeDragId: string | null;
  currentOverId: string | null;
  memoryOverlayOpen: boolean;
  coveredRightPx?: number;
}) {
  const isMemoryDrag = !memoryOverlayOpen && /^memory-\d+$/.test(activeDragId ?? "");
  const { setNodeRef } = useDroppable({
    id: "chat-dropzone",
    disabled: memoryOverlayOpen
  });
  // The drawer has its own DndContext; use the shared hover target so both
  // desktop and drawer drags show the same feedback.
  const isOver = isMemoryDrag && currentOverId === "chat-dropzone";

  return (
    <>
      <div
        data-chat-dropzone="true"
        ref={setNodeRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 top-12 z-[35]"
        style={{ right: coveredRightPx }}
      />

      {/* Keep feedback mounted. Entering the chat only animates opacity and
          the small hint's transform, without filtering the chat underneath. */}
      <div
        data-memory-drop-feedback={isMemoryDrag ? (isOver ? "over" : "ready") : "idle"}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 top-12 z-[60]"
        style={{ right: coveredRightPx }}
      >
        <div
          className={"absolute inset-3 rounded-2xl border border-sky-400/40 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.05)] transition-opacity duration-150 motion-reduce:transition-none " +
            (isOver ? "opacity-100" : isMemoryDrag ? "opacity-25" : "opacity-0")}
        />
        <div className="absolute inset-x-0 top-6 flex justify-center px-6">
          <div
            className={"flex items-center gap-2 rounded-full border border-sky-400/30 bg-[#122036] px-3.5 py-2 text-xs font-medium text-sky-100 shadow-md transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none " +
              (isOver ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0")}
          >
            <Plus className="h-3.5 w-3.5 text-sky-300" />
            Release to add memory
          </div>
        </div>
      </div>
    </>
  );
}
