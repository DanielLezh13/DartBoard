"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { compactTableMarkdownComponents } from "@/components/markdown/compactTableMarkdown";

interface MemoryBodyPreviewProps {
  value: string;
  className?: string;
  noBorder?: boolean; // If true, remove border/background (for VaultModal to avoid double bubble)
}

/**
 * Shared component for rendering markdown memory body.
 * Used in both Vault and Archive to ensure consistent styling.
 */
export default function MemoryBodyPreview({ value, className = "", noBorder = false }: MemoryBodyPreviewProps) {
  return (
    <div className={noBorder 
      ? `min-h-[420px] px-6 py-5 overflow-x-auto ${className}` 
      : `rounded-xl border border-gray-800 bg-gray-950/70 shadow-inner min-h-[420px] px-6 py-5 overflow-x-auto ${className}`}>
      <div className="memory-preview-markdown prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={compactTableMarkdownComponents}
        >
          {value || ""}
        </ReactMarkdown>
      </div>
    </div>
  );
}


