"use client";

import React from "react";

interface TagChipsProps {
  tags: string[];
  onRemove: (tag: string) => void;
}

export default function TagChips({ tags, onRemove }: TagChipsProps) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {tags.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(chip);
          }}
          className="flex items-center gap-1 bg-gray-700 border border-gray-600 rounded-full px-3 py-1 text-gray-100 hover:border-red-400 hover:text-red-200 transition-colors"
          title="Remove filter"
        >
          <span>✕</span>
          <span>{chip}</span>
        </button>
      ))}
    </div>
  );
}

