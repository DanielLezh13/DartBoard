"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { ContextIcon } from "@/components/icons/ContextIcon";
import { CopyIcon } from "@/components/icons/CopyIcon";
import { VaultIcon } from "@/components/icons/VaultIcon";
import type { ArchiveMessage } from "@/lib/archive/types";

const archiveMessageCardBase =
  "group relative isolate overflow-hidden rounded-xl border border-blue-500/30 bg-card/60 p-6 shadow-none backdrop-blur-md transition-[border-color,box-shadow] duration-200";
const markdownRemarkPlugins = [remarkGfm];
const markdownRehypePlugins = [rehypeHighlight];

type ArchiveMessageCardProps = {
  message: ArchiveMessage;
  variant: "search" | "context";
  isHighlighted: boolean;
  isCopied: boolean;
  displayText: string;
  markdownComponents: any;
  enableSyntaxHighlight?: boolean;
  highlightedRef?: React.Ref<HTMLDivElement>;
  onCopy: () => void;
  onViewContext?: () => void;
  onCenter?: () => void;
  onGoToMessage?: () => void;
  onVault?: () => void;
};

const ArchiveMessageCard = React.memo(function ArchiveMessageCard({
  message,
  variant,
  isHighlighted,
  isCopied,
  displayText,
  markdownComponents,
  enableSyntaxHighlight = false,
  highlightedRef,
  onCopy,
  onViewContext,
  onCenter,
  onGoToMessage,
  onVault,
}: ArchiveMessageCardProps) {
  const elementId =
    variant === "search" ? `message-${message.id}` : `context-message-${message.id}`;
  const isUser = message.role === "user";
  const rolePillClass = isUser
    ? "border border-cyan-300/35 bg-cyan-500/20 text-cyan-100"
    : "border border-indigo-300/35 bg-indigo-500/20 text-indigo-100";
  const sourceLabel =
    message.role === "assistant"
      ? message.source === "live_chat"
        ? "DartBoard"
        : "ChatGPT"
      : "User";

  return (
    <div
      id={elementId}
      ref={isHighlighted && variant === "context" ? highlightedRef : undefined}
      className={`${archiveMessageCardBase} ${
        isHighlighted ? "border-blue-500 shadow-lg shadow-blue-500/30" : ""
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {isHighlighted && variant === "context" && (
              <span className="px-2 py-1 rounded font-semibold bg-blue-600 text-white animate-pulse">
                Selected
              </span>
            )}
            <span className={`px-2 py-1 rounded-md text-[11px] font-semibold ${rolePillClass}`}>
              {sourceLabel}
            </span>
            <span className="text-gray-400/90">{new Date(message.ts).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-0">
            <button
              type="button"
              onClick={onCopy}
              className={
                "relative inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition-colors duration-300 ease-out p-0 leading-none " +
                (isCopied ? "bg-white/5" : "")
              }
              title={isCopied ? "Copied" : "Copy"}
            >
              <span
                className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isCopied
                    ? "opacity-0 scale-75 -translate-y-1 blur-[0.5px]"
                    : "opacity-100 scale-100 translate-y-0 blur-0"
                }`}
              >
                <CopyIcon size={20} className="block scale-[1.05]" />
              </span>
              <span
                className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isCopied
                    ? "opacity-100 scale-100 translate-y-0 blur-0"
                    : "opacity-0 scale-75 translate-y-1 blur-[0.5px]"
                }`}
              >
                <CheckIcon size={20} className="block scale-[1.05]" />
              </span>
            </button>

            {variant === "search" && onViewContext && (
              <button
                type="button"
                onClick={onViewContext}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
                title="View context (±8 messages)"
              >
                <ContextIcon size={22} className="block scale-[1.12] translate-x-[2px]" />
              </button>
            )}
            {isHighlighted && variant === "context" && onCenter && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCenter();
                }}
                className="text-gray-400 hover:text-blue-300 transition-colors"
                title="Center this message"
              >
                Center
              </button>
            )}
            {variant === "context" && onGoToMessage && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onGoToMessage();
                }}
                className="text-gray-400 hover:text-blue-300 transition-colors"
                title="Go to message in search results"
              >
                Go to message
              </button>
            )}
            {variant === "search" && onVault && (
              <button
                type="button"
                onClick={onVault}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
                title="Vault"
              >
                <VaultIcon size={20} className="block scale-[1.05]" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 prose prose-invert prose-sm max-w-none text-sm text-gray-200/95">
          <ReactMarkdown
            remarkPlugins={markdownRemarkPlugins}
            rehypePlugins={enableSyntaxHighlight ? markdownRehypePlugins : undefined}
            components={markdownComponents}
          >
            {displayText}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});

ArchiveMessageCard.displayName = "ArchiveMessageCard";

export default ArchiveMessageCard;
