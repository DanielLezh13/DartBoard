"use client";

import { useDroppable } from "@dnd-kit/core";

export function ChatDropzoneTarget({ 
  activeDragId, 
  memoryOverlayOpen 
}: { 
  activeDragId: string | null;
  memoryOverlayOpen: boolean;
}) {
  // Disable dropzone when memory overlay is open
  const dropDisabled = memoryOverlayOpen;
  
  const { setNodeRef, isOver } = useDroppable({ 
    id: "chat-dropzone",
    disabled: dropDisabled
  });

  // Strict check: only accept memory- prefixed IDs when overlay is closed
  const isMemoryDrag = !dropDisabled && activeDragId?.startsWith("memory-") && !activeDragId?.includes("folder");

  return (
    <>
      {/* Dedicated chat dropzone overlay - positioned below top bar */}
      <div
        data-chat-dropzone="true"
        ref={setNodeRef}
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: "48px",
          pointerEvents: isMemoryDrag ? "auto" : "none",
          zIndex: 35, // Above scroll container (z-30) but below overlays (z-40+)
        }}
      />

      {/* Drop overlay when dragging memory - constrained to chat viewport */}
      {!dropDisabled && isMemoryDrag && (
        <div className="absolute left-0 right-0 bottom-0 z-[60] pointer-events-none" style={{ top: "48px" }}>
          <div className={`absolute inset-0 bg-blue-500/10 border-2 border-blue-400/50 border-dashed rounded-lg flex items-center justify-center transition-[opacity,backdrop-filter] duration-200 ${
            isOver ? "backdrop-blur-sm opacity-100" : "backdrop-blur-none opacity-0"
          }`}>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 border-2 border-blue-400/50 flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-medium text-blue-300">Drop to attach memory</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


