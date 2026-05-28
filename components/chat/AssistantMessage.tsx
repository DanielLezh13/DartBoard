import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { VaultIcon } from "../icons/VaultIcon";
import { CopyIcon } from "../icons/CopyIcon";
import { CheckIcon } from "../icons/CheckIcon";
import { ForkIcon } from "../icons/ForkIcon";
import { DeeperIcon } from "@/components/icons/DeeperIcon";
import { CubesIcon } from "@/components/icons/CubesIcon";
import { WebIcon } from "@/components/icons/WebIcon";
import { buildClipboardPayload, getPlainTextFromRenderedElement } from "@/lib/chat/clipboard";
import { compactTableMarkdownComponents } from "@/components/markdown/compactTableMarkdown";

export interface AssistantMessageProps {
  message: {
    id?: number | string;
    content: string;
    session_id?: number | null;
    message_id?: number | null;
    created_at?: string | null;
    meta?: {
      sources?: Array<{ title?: string; url: string; label?: string }>;
      [key: string]: unknown;
    } | null;
  };
  isFirstInGroup: boolean;
  isStreaming: boolean;
  streamingContent: string;
  onCopy: (content: string) => void;
  onSaveToVault: (content: string) => void;
  onVault?: (memoryId: number) => void;
  onVaultDraft?: (draftPayload: { summary: string; session_id: number | null; message_id: number | null }) => void;
  onFork?: (payload: {
    content: string;
    messageId: number | null;
    sessionId: number | null;
    createdAt: string | null;
  }) => void;
  onSimplify?: (messageId: number | string | undefined, content: string) => void;
  onDeeper?: (messageId: number | string | undefined, content: string) => void;
  revealHeightPx?: number;
  fadeBandPx?: number;
  revealActive?: boolean;
  revealPreload?: boolean;
  isPlaceholder?: boolean;
  onMeasured?: (id: string, fullHeightPx: number) => void;
  actionsDisabled?: boolean;
  actionBusy?: boolean;
  hideActionsWhenDisabled?: boolean;
  highlightTerm?: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHighlightRegex(query: string): RegExp | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const phrase = trimmed.slice(1, -1).trim();
    if (!phrase) return null;
    return new RegExp(`(${escapeRegExp(phrase)})`, "gi");
  }

  const terms = Array.from(
    new Set(
      trimmed
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .map((term) => term.toLowerCase())
    )
  );
  if (terms.length === 0) return null;

  const body = terms.map((term) => `\\b${escapeRegExp(term)}\\b`).join("|");
  return new RegExp(`(${body})`, "gi");
}

function AssistantMessageInner(props: AssistantMessageProps) {
  const {
    message,
    isFirstInGroup,
    isStreaming,
    streamingContent,
    onCopy,
    onSaveToVault,
    onVault,
    onVaultDraft,
    onFork,
    onSimplify,
    onDeeper,
    revealHeightPx,
    fadeBandPx,
    revealActive = false,
    revealPreload = false,
    isPlaceholder = false,
    onMeasured,
    actionsDisabled = false,
    actionBusy = false,
    hideActionsWhenDisabled = false,
    highlightTerm = "",
  } = props;
  const hasDivider = !isFirstInGroup;

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const measuredRef = React.useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = React.useState<number>(0);
  const [isSimplifying, setIsSimplifying] = React.useState(false);
  const [isDeepening, setIsDeepening] = React.useState(false);
  const sourceLinks = React.useMemo(() => {
    const sources = Array.isArray(message.meta?.sources) ? message.meta?.sources : [];
    return sources
      .filter((source): source is { title?: string; url: string; label?: string } => {
        return !!source && typeof source.url === "string" && source.url.trim().length > 0;
      })
      .slice(0, 3);
  }, [message.meta?.sources]);
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const sourcesPopoverRef = React.useRef<HTMLDivElement>(null);
  const [copyJustCopied, setCopyJustCopied] = React.useState(false);
  const copyFeedbackTimeoutRef = React.useRef<number | null>(null);

  const triggerCopyFeedback = React.useCallback(() => {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
    setCopyJustCopied(true);
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyJustCopied(false);
      copyFeedbackTimeoutRef.current = null;
    }, 1850);
  }, []);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!sourcesOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sourcesPopoverRef.current?.contains(target)) return;
      setSourcesOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [sourcesOpen]);

  // Always render full message content
  const markdownText = message.content;
  const highlightRegex = React.useMemo(() => buildHighlightRegex(highlightTerm), [highlightTerm]);
  const renderHighlightedChildren = React.useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (!highlightRegex) return children;
      if (typeof children === "string") {
        const parts = children.split(highlightRegex);
        if (parts.length <= 1) return children;
        return parts.map((part, idx) =>
          idx % 2 === 1 ? (
            <mark
              key={`db-assistant-search-hit-${idx}`}
              className="rounded-sm bg-yellow-300 px-[1px] text-black"
            >
              {part}
            </mark>
          ) : (
            <React.Fragment key={`db-assistant-search-text-${idx}`}>{part}</React.Fragment>
          )
        );
      }
      if (Array.isArray(children)) {
        return children.map((child, idx) => (
          <React.Fragment key={`db-assistant-search-child-${idx}`}>
            {renderHighlightedChildren(child)}
          </React.Fragment>
        ));
      }
      if (React.isValidElement(children)) {
        const element = children as React.ReactElement<{ children?: React.ReactNode }>;
        if (typeof element.type === "string" && (element.type === "code" || element.type === "pre")) {
          return element;
        }
        return React.cloneElement(
          element,
          undefined,
          renderHighlightedChildren(element.props?.children)
        );
      }
      return children;
    },
    [highlightRegex]
  );

  // Measure full height and report to parent
  React.useLayoutEffect(() => {
    const el = measuredRef.current;
    if (!el) return;
    const h = el.scrollHeight || Math.round(el.getBoundingClientRect().height) || 0;
    setMeasuredHeight(h);

    const id = message.id;
    if (onMeasured && id !== undefined && id !== null) {
      onMeasured(String(id), h);
    }
  }, [markdownText, message.id, onMeasured]);

  // Compute reveal window height (container grows over time)
  const fullH = measuredHeight;
  const isMeasured = fullH > 0;
  const r = typeof revealHeightPx === "number" ? Math.max(1, revealHeightPx) : fullH;

  // Clamp reveal height to full height when measured
  // IMPORTANT: Before measurement, use 0 height to prevent shrink-flash
  // This ensures reveal only grows (monotonic), never shrinks
  const revealH = isMeasured ? Math.min(r, fullH) : 0;

  // Only arm preload BEFORE we have measurement.
  // If it's already measured and not revealing, it must not stay dim.
  const preRevealArming =
    revealPreload &&
    !revealActive &&
    typeof revealHeightPx !== "number" &&
    !isMeasured;

  const shouldReveal =
    !!revealActive || typeof revealHeightPx === "number" || preRevealArming;

  // Optional fade trail at bottom while revealing
  const band = fadeBandPx ?? 48;
  const shouldFade = shouldReveal && fullH > 0 && revealH < fullH && band > 0;

  // Only show the bottom tool-row once the reveal is complete.
  // This prevents the "text is spawning from the buttons" look.
  const revealComplete = !shouldReveal || (fullH > 0 && revealH >= fullH - 1);

  // Tool row visibility based on actual reveal progress, not a latch.
  // Compute reveal progress directly from measured height and revealHeightPx.
  const revealPx = typeof revealHeightPx === "number" ? revealHeightPx : null;

  const revealFinished =
    !!isMeasured &&
    !revealActive &&
    (revealPx === null || revealPx >= fullH - 1);

  const effectivePreload = revealPreload && !revealFinished;
  const showTools = !isPlaceholder && isFirstInGroup && revealFinished && !effectivePreload;

  React.useEffect(() => {
    if (!showTools && sourcesOpen) {
      setSourcesOpen(false);
    }
  }, [showTools, sourcesOpen]);

  // Settle animation: keep text fully solid; only bottom reveal band should fade.
  // We still keep a slight Y-settle so the reveal has motion without washing out text.
  const progressRaw = fullH > 0 ? (revealH / fullH) : 0;
  const progress = Math.max(0, Math.min(1, progressRaw));
  const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic

  // Historical: measured, not revealing, no reveal height => fully visible
  const willNeverReveal =
    !revealActive &&
    typeof revealHeightPx !== "number" &&
    !!isMeasured;

  const settleOpacity = 1;
  const settleY = willNeverReveal ? 0 : (1 - (preRevealArming ? 0 : ease)) * 6;

  const copyRenderedMessage = async (e?: React.MouseEvent) => {
    const el = measuredRef.current;

    // Reliable universal copy: copies only the visible rendered text (no markdown symbols).
    // This will NOT preserve tables/formatting; it is the compatibility fallback.
    const copyPlainOnly = async () => {
      const plainText = getPlainTextFromRenderedElement(el, message.content);
      await navigator.clipboard.writeText(plainText || message.content);
    };

    // ALT/Option-click = force plain-text copy (works in Google Docs / Apple Notes, but loses formatting)
    if (e?.altKey) {
      try {
        await copyPlainOnly();
        triggerCopyFeedback();
        onCopy(message.content);
      } catch (err) {
        console.error("plain copy failed", err);
      }
      return;
    }

    // Try a *native* selection copy first (best compatibility with Google Docs + Apple Notes).
    // Key: do NOT override clipboardData; let the browser produce the rich formats it wants.
    const nativeSelectionCopy = (html: string) => {
      try {
        const container = document.createElement("div");
        container.setAttribute("contenteditable", "true");
        container.style.position = "fixed";
        container.style.left = "-9999px";
        container.style.top = "0";
        container.style.width = "1px";
        container.style.height = "1px";
        container.style.opacity = "0";
        container.style.pointerEvents = "none";
        // Important: provide a real root element; many paste targets behave better.
        container.innerHTML = `<!doctype html><html><head><meta charset=\"utf-8\" /></head><body>${html}</body></html>`;
        document.body.appendChild(container);

        // Select the *body* contents (not the full document wrapper text)
        // by selecting the container's contents.
        const range = document.createRange();
        range.selectNodeContents(container);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);

        // Focus helps some targets treat this as a user-gesture copy.
        if (typeof (container as any).focus === "function") {
          (container as any).focus();
        }

        const ok = document.execCommand("copy");

        sel?.removeAllRanges();
        document.body.removeChild(container);

        return ok;
      } catch {
        return false;
      }
    };

    // Build semantic HTML + plain text from markdown source.
    // This gives Google Docs cleaner structure than copying presentation DOM.
    const { html, plain } = await buildClipboardPayload({
      markdown: message.content,
      fallbackElement: el,
    });

    // 1) Prefer *native* selection copy (best for Google Docs + Apple Notes)
    const ok = nativeSelectionCopy(html);

    // 2) Also attempt ClipboardItem for modern targets (Notion, etc.)
    // This is best-effort; failures should not block.
    try {
      const hasClipboardWrite = typeof navigator.clipboard?.write === "function";
      const hasClipboardItem = typeof window !== "undefined" && "ClipboardItem" in window;
      if (hasClipboardWrite && hasClipboardItem) {
        const htmlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
        const plainBlob = new Blob([plain || ""], { type: "text/plain;charset=utf-8" });
        // @ts-ignore
        const item = new ClipboardItem({
          "text/html": Promise.resolve(htmlBlob),
          "text/plain": Promise.resolve(plainBlob),
        });
        await navigator.clipboard.write([item]);
      } else if (!ok) {
        // If rich copy failed and ClipboardItem isn't available, at least copy plain
        await navigator.clipboard.writeText(plain);
      }
    } catch {
      if (!ok) {
        try {
          await navigator.clipboard.writeText(plain);
        } catch (e) {
          console.error("copy fallback failed", e);
        }
      }
    }

    // Toast/UX callback
    triggerCopyFeedback();
    onCopy(plain);
  };

  const handleFork = () => {
    if (onFork) {
      onFork({
        content: message.content,
        messageId: message.message_id || (typeof message.id === "number" ? message.id : null),
        sessionId: message.session_id || null,
        createdAt: message.created_at || null,
      });
    }
  };

  const handleSimplify = async () => {
    if (!onSimplify) return;
    await onSimplify(message.id, message.content);
  };
  
  const handleDeeper = async () => {
    if (!onDeeper) return;
    await onDeeper(message.id, message.content);
  };

  const handleVault = () => {
    // Use draft flow if available, otherwise fall back to old behavior
    if (onVaultDraft) {
      onVaultDraft({
        summary: message.content,
        session_id: message.session_id || null,
        message_id: message.message_id || (typeof message.id === "number" ? message.id : null),
      });
    } else if (onVault) {
      // Fallback to old create-then-open flow for backwards compatibility
      onSaveToVault(message.content);
    }
  };

  return (
    <div ref={wrapperRef} className={`group relative w-full ${hasDivider ? "mt-3" : ""}`} data-message-id={message.id}>
      {/* Outer reveal window - grows in height over time */}
      <div
        style={
          shouldReveal
            ? isMeasured
              ? {
                  height: Math.max(1, revealH),
                  overflow: "hidden",
                  maskImage: shouldFade
                    ? `linear-gradient(to bottom, black 0px, black calc(100% - ${band}px), transparent 100%)`
                    : undefined,
                  WebkitMaskImage: shouldFade
                    ? `linear-gradient(to bottom, black 0px, black calc(100% - ${band}px), transparent 100%)`
                    : undefined,
                }
              : {
                  height: 1, // 1px avoids 0→N scrollHeight jump / flash on short messages
                  overflow: "hidden",
                }
            : undefined
        }
      >
        <div
          ref={measuredRef}
          style={{
            opacity: settleOpacity,
            transform: `translateY(${settleY}px)`,
            willChange: shouldReveal ? "transform, opacity" : "auto",
            transition: "none",
          }}
          className="w-full break-words [overflow-wrap:anywhere] text-[14px] leading-relaxed text-gray-100 px-1 [&>*:last-child]:mb-0 pb-8"
        >
          {isPlaceholder ? (
            <div className="w-full flex items-center justify-center">
              {/* Fixed box => stable measured height; centered in chat column */}
              <div className="w-[120px] h-[28px] overflow-hidden opacity-90">
                <div
                  className="w-full h-full scale-[2.0] origin-center transform-gpu"
                >
                  <DotLottieReact
                    src="https://lottie.host/99bea97e-b406-41c9-a855-2ea09615f68c/REnhRSQkTU.lottie"
                    loop
                    autoplay
                    style={{ width: "100%", height: "100%" }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
              ...compactTableMarkdownComponents,
              th: ({ node, children, ...props }) => (
                <th className="db-compact-table-th" {...props}>
                  {renderHighlightedChildren(children)}
                </th>
              ),
              td: ({ node, children, ...props }) => (
                <td className="db-compact-table-td" {...props}>
                  {renderHighlightedChildren(children)}
                </td>
              ),
              p: ({ node, children, ...props }) => (
                <p
                  className="mt-0 mb-3 last:mb-0 text-[14px] leading-relaxed text-slate-100"
                  {...props}
                >
                  {renderHighlightedChildren(children)}
                </p>
              ),
              h1: ({ node, children, ...props }) => (
                <h1 className="text-2xl font-bold text-gray-100 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h1>
              ),
              h2: ({ node, children, ...props }) => (
                <h2 className="text-xl font-semibold text-gray-100 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h2>
              ),
              h3: ({ node, children, ...props }) => (
                <h3 className="text-lg font-semibold text-gray-200 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h3>
              ),
              h4: ({ node, children, ...props }) => (
                <h4 className="text-base font-medium text-gray-300 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h4>
              ),
              h5: ({ node, children, ...props }) => (
                <h5 className="text-sm font-medium text-gray-300 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h5>
              ),
              h6: ({ node, children, ...props }) => (
                <h6 className="text-xs font-medium text-gray-400 mb-3 last:mb-0" {...props}>
                  {renderHighlightedChildren(children)}
                </h6>
              ),
              ul: ({ node, ...props }) => (
                <ul
                  className="mt-0 mb-3 last:mb-0 ml-5 space-y-1.5 text-[14px] leading-relaxed text-slate-100 list-disc"
                  {...props}
                />
              ),
              ol: ({ node, ...props }) => (
                <ol
                  className="mt-0 mb-3 last:mb-0 ml-5 space-y-1.5 text-[14px] leading-relaxed text-slate-100 list-decimal"
                  {...props}
                />
              ),
              li: ({ node, children, ...props }) => (
                <li className="mt-0" {...props}>
                  {renderHighlightedChildren(children)}
                </li>
              ),
              code: (props) => {
                const isInline = !props.className;
                const text = String(props.children ?? "");

                if (isInline) {
                  return (
                    <code className="px-1 py-[1px] rounded-md bg-slate-800/80 text-[12px]" {...props} />
                  );
                }

                // block code renderer
                return (
                  <div className="relative mt-0 mb-3 last:mb-0">
                    <button
                      type="button"
                      aria-label="Copy code"
                      data-copy-exclude="true"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(text);
                        } catch (err) {
                          console.error("code copy failed", err);
                        }
                      }}
                      className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent opacity-70 hover:opacity-100 hover:bg-white/5 transition p-0 leading-none"
                    >
                      <CopyIcon size={20} className="block scale-[1.05]" />
                    </button>

                    <pre className="w-full rounded-xl bg-slate-950/90 border border-slate-700/25 p-3 overflow-x-auto text-[12px] font-mono leading-relaxed">
                      <code className="!bg-transparent" {...props} />
                    </pre>
                  </div>
                );
              },
              hr: () => (
                <hr className="my-4 border-0 border-t border-white/10" />
              ),
              blockquote: ({ node, children, ...props }) => (
                <blockquote
                  className="mt-0 mb-3 last:mb-0 border-l-2 border-slate-600 pl-3 text-[14px] leading-relaxed text-slate-200/90"
                  {...props}
                >
                  {renderHighlightedChildren(children)}
                </blockquote>
              ),
              a: ({ node, children, ...props }) => (
                <a
                  className="text-blue-400 hover:text-blue-300 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {renderHighlightedChildren(children)}
                </a>
              ),
              }}
            >
              {markdownText}
            </ReactMarkdown>
          )}
        </div>
      </div>

      {/* Tool buttons overlay - absolutely positioned to never affect layout */}
      {isFirstInGroup && (
        <div
          className={
            "absolute left-0 bottom-0 flex items-center gap-0 scale-[0.9] origin-left transition-opacity duration-200 " +
            (showTools ? "opacity-100" : "opacity-0 pointer-events-none")
          }
          aria-hidden={!showTools}
        >
          {/* Copy */}
          <button
            type="button"
            onClick={(e) => copyRenderedMessage(e)}
            title="Copy (Option/Alt = plain text)"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition-colors duration-300 ease-out p-0 leading-none"
            tabIndex={showTools ? 0 : -1}
          >
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                copyJustCopied
                  ? "opacity-0 scale-75 -translate-y-1 blur-[0.5px]"
                  : "opacity-100 scale-100 translate-y-0 blur-0"
              }`}
            >
              <CopyIcon size={20} className="block scale-[1.05]" />
            </span>
            <span
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                copyJustCopied
                  ? "opacity-100 scale-100 translate-y-0 blur-0"
                  : "opacity-0 scale-75 translate-y-1 blur-[0.5px]"
              }`}
            >
              <CheckIcon size={20} className="block scale-[1.05]" />
            </span>
          </button>

          {/* Deeper / Analyze */}
          <button
            type="button"
            onClick={handleDeeper}
            disabled={actionsDisabled || actionBusy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
            tabIndex={showTools && !actionsDisabled && !actionBusy ? 0 : -1}
          >
            <DeeperIcon size={20} className="block scale-[1.05]" />
          </button>

          {/* Simplify / Babify */}
          <button
            type="button"
            onClick={handleSimplify}
            disabled={actionsDisabled || actionBusy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
            tabIndex={showTools && !actionsDisabled && !actionBusy ? 0 : -1}
          >
            <CubesIcon size={18} className="block" />
          </button>

          {/* Fork */}
          <button
            type="button"
            onClick={handleFork}
            disabled={actionsDisabled || actionBusy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
            tabIndex={showTools && !actionsDisabled && !actionBusy ? 0 : -1}
          >
            <ForkIcon size={20} className="block scale-[1.05]" />
          </button>

          {/* Vault */}
          <button
            type="button"
            onClick={handleVault}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
            tabIndex={showTools ? 0 : -1}
          >
            <VaultIcon size={20} className="block scale-[1.05]" />
          </button>

          {sourceLinks.length > 0 && (
            <div ref={sourcesPopoverRef} className="relative">
              <button
                type="button"
                onClick={() => setSourcesOpen((prev) => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent hover:bg-white/5 transition p-0 leading-none"
                tabIndex={showTools ? 0 : -1}
                aria-label="Sources"
                title="Sources"
              >
                <WebIcon size={20} className="block scale-[1.05]" />
              </button>
              {sourcesOpen && showTools && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-9 z-20 w-max max-w-[22rem] rounded-xl overflow-hidden bg-[#0f1320] border border-blue-400/45 shadow-[0_10px_24px_rgba(0,0,0,0.38)]">
                  <div className="p-2 space-y-1">
                    {sourceLinks.map((source, idx) => (
                      <a
                        key={`${source.url}-${idx}`}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg px-2.5 py-2 text-[13px] leading-tight text-gray-100 break-words bg-gray-800 border border-blue-400/45 hover:border-blue-400 transition-colors"
                        title={source.url}
                        onClick={() => setSourcesOpen(false)}
                      >
                        {source.title || source.label || source.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const AssistantMessage = React.memo(
  AssistantMessageInner,
  (prev, next) => {
    // Re-render only when something visible changes.
    if (prev.isFirstInGroup !== next.isFirstInGroup) return false;
    if (prev.revealHeightPx !== next.revealHeightPx) return false;
    if (prev.revealActive !== next.revealActive) return false;
    if (prev.revealPreload !== next.revealPreload) return false;
    if (prev.isPlaceholder !== next.isPlaceholder) return false;
    if (prev.highlightTerm !== next.highlightTerm) return false;
    // Message identity/content changes should always re-render.
    if (prev.message.id !== next.message.id) return false;
    return prev.message.content === next.message.content;
  }
);
