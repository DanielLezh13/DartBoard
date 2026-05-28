"use client";

import { useState, useRef, useEffect } from "react";
import { DartzModeId } from "@/lib/modes";

interface ModeDropdownProps {
  currentMode: DartzModeId;
  onModeSelect: (mode: DartzModeId) => void;
}

const MODE_LABELS: Record<DartzModeId, string> = {
  chatgpt: "ChatGPT",
  tactical: "Tactical",
  builder: "Builder",
  simplicity: "Simple",
  chill: "Chill",
  dissect: "Dissect",
};

export function ModeDropdown({ currentMode, onModeSelect }: ModeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const modes: DartzModeId[] = ["tactical", "builder", "simplicity", "chill", "dissect"];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2 py-1 rounded-full text-[0.7rem] border transition ${
          isOpen
            ? "border-blue-400 text-blue-300 bg-blue-500/10"
            : "border-gray-700 text-gray-400 hover:border-gray-500"
        }`}
      >
        {MODE_LABELS[currentMode]}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-32 bg-gray-900 border border-gray-800 rounded-lg shadow-lg z-50">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onModeSelect(mode);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs transition ${
                currentMode === mode
                  ? "bg-blue-500/10 text-blue-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              } ${mode === modes[0] ? "rounded-t-lg" : ""} ${
                mode === modes[modes.length - 1] ? "rounded-b-lg" : ""
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
