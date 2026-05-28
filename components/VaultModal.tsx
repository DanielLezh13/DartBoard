"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import TurndownService from "turndown";
import MarkdownEditor from "./MarkdownEditor";
import MemoryBodyPreview from "./vault/MemoryBodyPreview";
import { VaultIcon } from "./icons/VaultIcon";
import { makeAutoTitleFromAssistant, clampAutoTitle } from "@/lib/chatHelpers";
import {
  LINE_HEIGHT_CHOICES,
  LINE_HEIGHT_DEFAULT,
  getEditorLineHeight,
} from "@/components/vault/extensions/lineHeight";

interface ArchiveMessage {
  id: number;
  text: string;
  ts?: string; // timestamp
}

interface VaultModalProps {
  open: boolean;
  message: ArchiveMessage | null;
  folders: string[];
  forceUntitledTitle?: boolean;
  onClose: () => void;
  onSave: (data: {
    title: string;
    folderName: string;
    summary: string;
    doc_json?: unknown;
  }) => Promise<void>;
  saving?: boolean;
  error?: string | null;
}

const MODAL_TABLE_LIMITS = {
  maxRows: 20,
  maxColumns: 24,
  maxCells: 160,
  initialRows: 3,
  initialColumns: 3,
  pickerMaxRows: 8,
  pickerMaxCols: 8,
} as const;

const tableCellToMarkdown = (cell: Element): string => {
  const text = (cell.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.replace(/\|/g, "\\|");
};

const tableToMarkdown = (table: HTMLTableElement): string => {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.children).filter(
        (cell) => cell.tagName.toLowerCase() === "th" || cell.tagName.toLowerCase() === "td"
      )
    )
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) return "";

  const columnCount = rows.reduce((max, cells) => Math.max(max, cells.length), 0);
  if (columnCount === 0) return "";

  const normalizedRows = rows.map((cells) => {
    const values = cells.map(tableCellToMarkdown);
    while (values.length < columnCount) values.push("");
    return values;
  });

  const header = normalizedRows[0];
  const body = normalizedRows.slice(1);
  const separator = new Array(columnCount).fill("---");

  const formatRow = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const lines = [formatRow(header), formatRow(separator), ...body.map(formatRow)];

  return lines.join("\n");
};

function serializeEditorHtmlToMarkdown(html: string, turndown: TurndownService): string {
  if (!html.includes("<table") || typeof document === "undefined") {
    return turndown.turndown(html).trim();
  }

  const container = document.createElement("div");
  container.innerHTML = html;
  const tableTokens: Array<{ token: string; markdown: string }> = [];
  const tables = Array.from(container.querySelectorAll("table"));

  tables.forEach((table, idx) => {
    const markdown = tableToMarkdown(table as HTMLTableElement);
    const token = `DBTABLETOKEN${idx}END`;
    tableTokens.push({ token, markdown });
    const marker = document.createElement("p");
    marker.textContent = token;
    table.replaceWith(marker);
  });

  let markdown = turndown.turndown(container.innerHTML);
  for (const { token, markdown: tableMarkdown } of tableTokens) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    markdown = markdown.replace(new RegExp(escapedToken, "g"), `\n\n${tableMarkdown}\n\n`);
  }

  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

const VaultModal: React.FC<VaultModalProps> = React.memo(({
  open,
  message,
  folders,
  forceUntitledTitle = false,
  onClose,
  onSave,
  saving = false,
  error: externalError = null,
}) => {
  // All state is local to this component - no parent re-renders!
  const [title, setTitle] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("Unsorted");
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [dragStartedInside, setDragStartedInside] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState<string>(""); // Markdown body text (plain string)
  const [bodyHtml, setBodyHtml] = useState<string>(""); // HTML from MarkdownEditor for conversion
  const [bodyDocJson, setBodyDocJson] = useState<unknown>(null);
  const [isEditingBody, setIsEditingBody] = useState(false); // Start in preview mode
  const [isClosing, setIsClosing] = useState(false);
  const [editorInstance, setEditorInstance] = useState<any>(null); // Editor instance from MarkdownEditor
  const [isTitleGenerating, setIsTitleGenerating] = useState(false);
  const [titleLoadingDots, setTitleLoadingDots] = useState(1);
  const [titleRevealVisible, setTitleRevealVisible] = useState(true);
  const [showTableInsertPicker, setShowTableInsertPicker] = useState(false);
  const [tablePickerHover, setTablePickerHover] = useState<{ rows: number; cols: number } | null>(null);
  const [lineHeightValue, setLineHeightValue] = useState<string>(LINE_HEIGHT_DEFAULT);
  const messageId = message?.id ?? null;
  const messageText = message?.text ?? "";
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const titleManualEditRef = useRef(false);
  const autoTitleRequestRef = useRef(0);
  
  const folderDropdownRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const tableInsertPickerRef = useRef<HTMLDivElement>(null);

  // Initialize turndown service for HTML to markdown conversion (needed for MarkdownEditor)
  const turndownService = useRef<TurndownService>(
    new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })
  );

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open && messageId !== null) {
      setTitle(forceUntitledTitle ? "Untitled" : "");
      titleManualEditRef.current = false;
      setIsTitleGenerating(!forceUntitledTitle);
      setTitleLoadingDots(1);
      setTitleRevealVisible(true);
      setSelectedFolder("Unsorted");
      setShowFolderDropdown(false);
      setError(null);
      setIsEditingBody(false); // Start in preview mode
      setEditorInstance(null); // Reset editor instance
      setShowTableInsertPicker(false);
      setTablePickerHover(null);
      
      // Initialize body with message text (this is the MEMORY BODY)
      const initialBody = messageText.trim() || " ";
      setBody(initialBody);
      setBodyHtml(""); // Reset HTML state
      setBodyDocJson(null); // Reset doc json state
      
      // Focus title input after a brief delay
      setTimeout(() => {
        if (titleInputRef.current) {
          titleInputRef.current.focus();
        }
      }, 100);
    }
  }, [open, messageId, messageText, forceUntitledTitle]);

  useEffect(() => {
    if (!open || messageId === null) return;

    if (forceUntitledTitle) {
      if (!titleManualEditRef.current) {
        setTitle("Untitled");
      }
      setIsTitleGenerating(false);
      return;
    }

    const requestId = autoTitleRequestRef.current + 1;
    autoTitleRequestRef.current = requestId;
    let cancelled = false;
    const sourceText = messageText;
    const fallbackTitle = clampAutoTitle(makeAutoTitleFromAssistant(sourceText));

    void fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistantResponse: sourceText }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to generate title");
        }
        return response.json();
      })
      .then((data) => {
        if (cancelled || autoTitleRequestRef.current !== requestId) return;
        const rawCandidate = typeof data?.title === "string" ? data.title : "";
        const normalizedCandidate = clampAutoTitle(rawCandidate);
        const resolvedTitle =
          rawCandidate.trim().length > 0 && normalizedCandidate !== "New Chat"
            ? normalizedCandidate
            : fallbackTitle;
        if (!titleManualEditRef.current) {
          setTitle(resolvedTitle);
          setTitleRevealVisible(false);
          requestAnimationFrame(() => setTitleRevealVisible(true));
        }
        setIsTitleGenerating(false);
      })
      .catch(() => {
        if (cancelled || autoTitleRequestRef.current !== requestId) return;
        if (!titleManualEditRef.current) {
          setTitle(fallbackTitle);
          setTitleRevealVisible(false);
          requestAnimationFrame(() => setTitleRevealVisible(true));
        }
        setIsTitleGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, messageId, messageText, forceUntitledTitle]);

  useEffect(() => {
    if (!editorInstance || editorInstance.isDestroyed) {
      setLineHeightValue(LINE_HEIGHT_DEFAULT);
      return;
    }
    const syncLineHeight = () => setLineHeightValue(getEditorLineHeight(editorInstance));
    syncLineHeight();
    editorInstance.on("selectionUpdate", syncLineHeight);
    editorInstance.on("transaction", syncLineHeight);
    return () => {
      editorInstance.off("selectionUpdate", syncLineHeight);
      editorInstance.off("transaction", syncLineHeight);
    };
  }, [editorInstance]);

  useEffect(() => {
    if (!isTitleGenerating || titleManualEditRef.current) {
      setTitleLoadingDots(1);
      return;
    }
    const timer = window.setInterval(() => {
      setTitleLoadingDots((prev) => (prev % 3) + 1);
    }, 330);
    return () => window.clearInterval(timer);
  }, [isTitleGenerating]);

  // Defensive cleanup when modal closes
  useEffect(() => {
    if (!open) {
      setIsClosing(false);
      setIsTitleGenerating(false);
    }
  }, [open]);

  // Sync external error
  useEffect(() => {
    if (externalError) {
      setError(externalError);
    }
  }, [externalError]);



  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        folderDropdownRef.current &&
        !folderDropdownRef.current.contains(target)
      ) {
        setShowFolderDropdown(false);
      }
      if (
        tableInsertPickerRef.current &&
        !tableInsertPickerRef.current.contains(target)
      ) {
        setShowTableInsertPicker(false);
        setTablePickerHover(null);
      }
    };

    if (showFolderDropdown || showTableInsertPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFolderDropdown, showTableInsertPicker]);

  const handleSave = useCallback(async () => {
    if (!message) return;
    const folderName = selectedFolder;

    // Convert HTML from MarkdownEditor back to markdown if editing, otherwise use body directly
    let finalSummary = body;
    let finalDocJson: unknown = bodyDocJson ?? null;
    if (editorInstance && !editorInstance.isDestroyed) {
      try {
        finalDocJson = editorInstance.getJSON();
      } catch {
        // keep previous doc_json snapshot
      }
    }
    if (bodyHtml && isEditingBody) {
      // Convert HTML from editor to markdown
      finalSummary = serializeEditorHtmlToMarkdown(bodyHtml, turndownService.current) || " ";
      setBody(finalSummary);
    } else {
      // Use body markdown directly
      finalSummary = body.trim() || " ";
    }

    try {
      await onSave({
        title: title.trim(),
        folderName,
        summary: finalSummary,
        doc_json: finalDocJson,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }, [
    message,
    selectedFolder,
    body,
    bodyHtml,
    bodyDocJson,
    editorInstance,
    isEditingBody,
    onSave,
    title,
    setBody,
    setError,
    onClose,
  ]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsClosing(true);
        setTimeout(onClose, 140);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Keyboard shortcuts: Enter / Cmd+Enter to save
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        // If Cmd/Ctrl+Enter, always save
        if (e.metaKey || e.ctrlKey) {
          handleSave();
          e.preventDefault();
        } else {
          // If focused on title input, allow Enter-to-save.
          const target = e.target as Element | null;
          if (target && target instanceof HTMLInputElement && target === titleInputRef.current) {
            handleSave();
            e.preventDefault();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handleSave]);

  const maxInsertPickerCols = Math.max(
    1,
    Math.min(MODAL_TABLE_LIMITS.pickerMaxCols, MODAL_TABLE_LIMITS.maxColumns)
  );
  const maxInsertPickerRows = Math.max(
    1,
    Math.min(
      MODAL_TABLE_LIMITS.pickerMaxRows,
      MODAL_TABLE_LIMITS.maxRows,
      Math.floor(MODAL_TABLE_LIMITS.maxCells / maxInsertPickerCols)
    )
  );
  const insertPickerPreview = tablePickerHover ?? {
    rows: Math.min(MODAL_TABLE_LIMITS.initialRows, maxInsertPickerRows),
    cols: Math.min(MODAL_TABLE_LIMITS.initialColumns, maxInsertPickerCols),
  };

  const showTableLimitError = useCallback((message: string) => {
    setError(message);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setError((prev) => (prev === message ? null : prev));
      }, 2400);
    }
  }, []);

  const insertTable = useCallback(
    (
      requestedRows: number = MODAL_TABLE_LIMITS.initialRows,
      requestedCols: number = MODAL_TABLE_LIMITS.initialColumns
    ) => {
      if (!editorInstance || editorInstance.isDestroyed) return;
      const cols = Math.max(1, Math.min(requestedCols, MODAL_TABLE_LIMITS.maxColumns));
      const maxRowsFromCellBudget = Math.max(1, Math.floor(MODAL_TABLE_LIMITS.maxCells / cols));
      const rows = Math.max(
        1,
        Math.min(requestedRows, MODAL_TABLE_LIMITS.maxRows, maxRowsFromCellBudget)
      );
      if (rows * cols > MODAL_TABLE_LIMITS.maxCells) {
        showTableLimitError(`Table max is ${MODAL_TABLE_LIMITS.maxCells} cells.`);
        return;
      }
      editorInstance
        .chain()
        .focus()
        .insertTable({ rows, cols, withHeaderRow: true })
        .run();
      setShowTableInsertPicker(false);
      setTablePickerHover(null);
    },
    [editorInstance, showTableLimitError]
  );

  // Format dates
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const messageDate = message?.ts ? formatDate(message.ts) : null;
  const savedDate = formatDate(new Date().toISOString());

  if (!open || !message) return null;

  const allFolders = ["Unsorted", ...folders.filter((f) => f !== "Unsorted")];
  const iconButtonClass =
    "inline-flex items-center justify-center h-9 w-9 rounded-lg border border-[#2a5a8c] bg-[#102145] text-slate-300 hover:text-cyan-100 hover:bg-[#142a54] transition-colors disabled:opacity-50 disabled:cursor-default";
  const showGeneratingTitleOverlay = isTitleGenerating && !titleManualEditRef.current;
  const hideGeneratedTitleText =
    !showGeneratingTitleOverlay &&
    !titleManualEditRef.current &&
    !titleRevealVisible &&
    title.trim().length > 0;
  const generatingTitleLabel = `Generating title${".".repeat(titleLoadingDots)}`;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80"
      onMouseDown={(e) => {
        const card = e.currentTarget.querySelector(".vault-save-card");
        if (card && card.contains(e.target as Node)) {
          setDragStartedInside(true);
        } else {
          setDragStartedInside(false);
        }
      }}
      onMouseUp={() => {
        setTimeout(() => setDragStartedInside(false), 0);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !dragStartedInside) {
          setIsClosing(true);
          setTimeout(onClose, 140);
        }
      }}
    >
      <div className="w-full max-w-4xl px-4">
      <div
          className={`vault-save-card rounded-[22px] border-2 border-[#2a5a8c] bg-[#0d1b35] shadow-[0_24px_85px_rgba(2,8,25,0.8)] w-full max-w-4xl max-h-[calc(100vh-96px)] flex flex-col overflow-hidden${isClosing ? " animate-fadeOutScale" : " animate-fadeInScale"}`}
        onClick={(e) => e.stopPropagation()}
      >
          {/* Header - Title + Action Buttons */}
	          <div className="px-6 pt-4 pb-3 border-b border-[#244b75] flex-shrink-0 bg-[#0d1b35]">
	            <div className="flex items-center gap-3">
	              <div className="relative flex-1 min-w-0">
	                <input
	                  ref={titleInputRef}
	                  type="text"
	                  value={title}
	                  onChange={(e) => {
	                    titleManualEditRef.current = true;
	                    setTitleRevealVisible(true);
	                    setTitle(e.target.value);
	                  }}
	                  className={`flex-1 w-full bg-[#102145] px-3.5 py-2.5 rounded-xl border border-[#2a5a8c] focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-300/65 placeholder:text-slate-400 text-base font-semibold min-w-0 transition-colors duration-200 ${(showGeneratingTitleOverlay || hideGeneratedTitleText) ? "text-transparent" : "text-slate-100"}`}
	                  placeholder={showGeneratingTitleOverlay ? "" : "Memory title..."}
	                />
	                {showGeneratingTitleOverlay && (
	                  <div className="pointer-events-none absolute inset-0 flex items-center px-3.5 text-sm font-medium text-slate-400">
	                    {generatingTitleLabel}
	                  </div>
	                )}
	              </div>
	              {/* Right: Icon buttons */}
	              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-[#2a5a8c] bg-[#102145] text-cyan-100 hover:bg-[#142a54] hover:border-cyan-300/65 transition-colors disabled:opacity-50 disabled:cursor-default"
                  title="Save to Vault"
                >
                  <VaultIcon size={19} className="block scale-[1.02]" />
                </button>
                <button
                  onClick={() => {
                    setIsClosing(true);
                    setTimeout(onClose, 140);
                  }}
                  className={`${iconButtonClass} hover:text-red-300`}
                  title="Cancel"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Meta Row - Folder + Dates + Rating */}
          <div className="px-6 py-3 border-b border-[#244b75] flex-shrink-0 relative z-30 bg-[#0d1b35]">
            <div className="flex items-center justify-between gap-4 flex-wrap relative">
              {/* Left: Folder dropdown */}
              <div className="relative inline-block" ref={folderDropdownRef}>
                {/* TRIGGER */}
                  <button
                    type="button"
                    onClick={() => setShowFolderDropdown(!showFolderDropdown)}
                  className="inline-flex items-center gap-1 text-[0.75rem] font-medium px-2.5 py-1 rounded-full border border-[#2a5a8c] bg-[#102145] text-cyan-100 hover:border-cyan-300/65 hover:text-cyan-50 transition-colors"
                >
                  <span>{selectedFolder}</span>
                  <svg
                    className={`w-3 h-3 text-cyan-200 transition-transform ${showFolderDropdown ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  </button>

                {/* MENU */}
                  {showFolderDropdown && (
                  <div className="absolute left-0 mt-1 min-w-[180px] rounded-xl border border-[#2a5a8c] bg-[#102145] shadow-[0_16px_35px_rgba(0,0,0,0.55)] z-50 max-h-48 overflow-y-auto">
                    {/* Unsorted */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolder("Unsorted");
                          setShowFolderDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                        selectedFolder === "Unsorted"
                          ? "bg-[#16325e] text-cyan-100 font-semibold"
                          : "text-slate-200 hover:bg-[#16325e]"
                        }`}
                      >
                        Unsorted
                      </button>
                    
                    {/* Existing folders */}
                    {allFolders.filter(f => f !== "Unsorted").map((folder) => (
                        <button
                          key={folder}
                          type="button"
                          onClick={() => {
                            setSelectedFolder(folder);
                            setShowFolderDropdown(false);
                          }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          selectedFolder === folder
                            ? "bg-[#16325e] text-cyan-100 font-semibold"
                            : "text-slate-200 hover:bg-[#16325e]"
                          }`}
                        >
                          {folder}
                        </button>
                      ))}
                    
                  </div>
                )}
              </div>
              
              {/* Middle: Dates */}
              <div className="flex items-center gap-3 text-[0.75rem] text-slate-400 leading-none">
                {messageDate && (
                  <span className="text-[0.75rem] text-slate-400/90">
                    Date of message: {messageDate}
                  </span>
                )}
                {savedDate && (
                  <span className="text-[0.75rem] text-slate-400/90">
                    Date saved: {savedDate}
                  </span>
            )}
          </div>

            </div>
            {error && (
              <div className="mt-2 text-red-400 text-xs">{error}</div>
            )}
          </div>

          {/* Scrollable Body – this is the scroll area */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 bg-[#0d1b35]" ref={bodyScrollRef}>
            {/* MESSAGE BODY */}
            <div className="mt-4 mb-4 max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Message Body
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingBody && bodyHtml) {
                        const markdown =
                          serializeEditorHtmlToMarkdown(bodyHtml, turndownService.current) || " ";
                        setBody(markdown);
                      }
                      if (isEditingBody && editorInstance && !editorInstance.isDestroyed) {
                        try {
                          setBodyDocJson(editorInstance.getJSON());
                        } catch {
                          // ignore doc serialization errors and keep markdown fallback
                        }
                      }
                      setShowTableInsertPicker(false);
                      setTablePickerHover(null);
                      setIsEditingBody(!isEditingBody);
                    }}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                      isEditingBody
                        ? "border-cyan-300/70 bg-[#16325e] text-cyan-100"
                        : "border-[#2a5a8c] bg-[#102145] text-cyan-200 hover:text-cyan-100 hover:bg-[#142a54]"
                    }`}
                    title={isEditingBody ? "Done Editing" : "Edit"}
                  >
                    {isEditingBody ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                    )}
                  </button>
                </div>

                {isEditingBody ? (
                  <>
                    {/* Sticky toolbar sits above the bubble, pinned to scroll area */}
                    {editorInstance && (
                      <div className="sticky top-0 z-10 pb-3 bg-[#0d1b35]">
                        <div className="inline-flex items-center gap-2 rounded-xl border border-[#2a5a8c] bg-[#102145] px-4 py-2 shadow-[0_0_14px_rgba(56,189,248,0.16)]">
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance.chain().focus().undo().run()
                            }
                            disabled={!editorInstance.can().undo()}
                            className="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
                            title="Undo"
                          >
                            Undo
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance.chain().focus().redo().run()
                            }
                            disabled={!editorInstance.can().redo()}
                            className="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
                            title="Redo"
                          >
                            Redo
                          </button>
                          <div className="w-px h-4 bg-gray-700 mx-1" />
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance.chain().focus().toggleBold().run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("bold")
                                ? "bg-gray-700 text-white font-bold"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Bold"
                          >
                            <strong>B</strong>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance.chain().focus().toggleItalic().run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("italic")
                                ? "bg-gray-700 text-white italic"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Italic"
                          >
                            <em>I</em>
                          </button>
                          <div className="w-px h-4 bg-gray-700 mx-1" />
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleHeading({ level: 1 })
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("heading", { level: 1 })
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Heading 1"
                          >
                            H1
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleHeading({ level: 2 })
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("heading", { level: 2 })
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Heading 2"
                          >
                            H2
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleHeading({ level: 3 })
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("heading", { level: 3 })
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Heading 3"
                          >
                            H3
                          </button>
                          <select
                            value={lineHeightValue}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === LINE_HEIGHT_DEFAULT) {
                                editorInstance.chain().focus().unsetLineHeight().run();
                                return;
                              }
                              editorInstance
                                .chain()
                                .focus()
                                .setLineHeight(value as (typeof LINE_HEIGHT_CHOICES)[number])
                                .run();
                            }}
                            className="h-7 rounded border border-[#2a5a8c] bg-[#0f2144] px-2 text-xs text-cyan-100 focus:outline-none focus:ring-1 focus:ring-cyan-300/40"
                            title="Line spacing"
                          >
                            <option value={LINE_HEIGHT_DEFAULT}>Line</option>
                            {LINE_HEIGHT_CHOICES.map((choice) => (
                              <option key={choice} value={choice}>
                                {choice}
                              </option>
                            ))}
                          </select>
                          <div className="w-px h-4 bg-gray-700 mx-1" />
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleBulletList()
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("bulletList")
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Bullet List"
                          >
                            •
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleOrderedList()
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("orderedList")
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Numbered List"
                          >
                            1.
                          </button>
                          <div className="w-px h-4 bg-gray-700 mx-1" />
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance
                                .chain()
                                .focus()
                                .toggleBlockquote()
                                .run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("blockquote")
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Quote"
                          >
                            ❝
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              editorInstance.chain().focus().toggleCode().run()
                            }
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              editorInstance.isActive("code")
                                ? "bg-gray-700 text-white"
                                : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            }`}
                            title="Inline Code"
                          >
                            {"</>"}
                          </button>
                          <div className="w-px h-4 bg-gray-700 mx-1" />
                          <div className="relative" ref={tableInsertPickerRef}>
                            <button
                              type="button"
                              onClick={() => {
                                setShowTableInsertPicker((prev) => !prev);
                                setTablePickerHover(null);
                              }}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                showTableInsertPicker
                                  ? "bg-gray-700 text-white"
                                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
                              }`}
                              title="Insert table"
                            >
                              Tbl
                            </button>
                            {showTableInsertPicker && (
                              <div
                                className="absolute left-0 top-full mt-2 rounded-xl border border-slate-700 bg-slate-950 p-2 z-30 shadow-2xl shadow-black/70 w-max"
                                onMouseLeave={() => setTablePickerHover(null)}
                              >
                                <div className="text-[11px] text-slate-300 mb-1 w-max mx-auto text-left">
                                  {insertPickerPreview.rows} x {insertPickerPreview.cols}
                                </div>
                                <div
                                  className="grid gap-0 border border-slate-700 w-max mx-auto"
                                  style={{
                                    gridTemplateColumns: `repeat(${maxInsertPickerCols}, minmax(0, 1fr))`,
                                  }}
                                >
                                  {Array.from({
                                    length: maxInsertPickerRows * maxInsertPickerCols,
                                  }).map((_, index) => {
                                    const row = Math.floor(index / maxInsertPickerCols) + 1;
                                    const col = (index % maxInsertPickerCols) + 1;
                                    const selected =
                                      row <= insertPickerPreview.rows &&
                                      col <= insertPickerPreview.cols;
                                    return (
                                      <button
                                        key={`vault-table-grid-${row}-${col}`}
                                        type="button"
                                        className={`h-5 w-5 rounded-none border border-slate-700 transition-colors ${
                                          selected
                                            ? "bg-blue-500/60"
                                            : "bg-slate-900 hover:bg-blue-500/35"
                                        }`}
                                        onMouseEnter={() => setTablePickerHover({ rows: row, cols: col })}
                                        onFocus={() => setTablePickerHover({ rows: row, cols: col })}
                                        onClick={() => insertTable(row, col)}
                                        aria-label={`Insert ${row} by ${col} table`}
                                      />
                                    );
                                  })}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500">
                                  Max {MODAL_TABLE_LIMITS.maxRows} rows x {MODAL_TABLE_LIMITS.maxColumns} cols.
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Message bubble below the sticky toolbar */}
                    <div className="rounded-xl border border-[#2a5a8c] bg-[#102145]">
                      <div className="px-6 pb-5 pt-3">
                        <MarkdownEditor
                          value={body}
                          onChange={(html) => setBodyHtml(html)}
                          onDocJsonChange={(docJson) => setBodyDocJson(docJson)}
                          minRows={12}
                          hideEditorBorder={true}
                          noWrapper={true}
                          noToolbar={true}
                          onEditorReady={setEditorInstance}
                          className="bg-[#102145]"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  // PREVIEW MODE: bubble with content
                  <div className="rounded-xl border border-[#2a5a8c] bg-[#102145]">
                    <div className={bodyDocJson ? "" : "px-6 py-5"}>
                      {bodyDocJson ? (
                        <MarkdownEditor
                          value={body}
                          docJsonValue={bodyDocJson}
                          onChange={() => {}}
                          readOnly={true}
                          hideEditorBorder={true}
                          noWrapper={true}
                          noToolbar={true}
                          className="bg-[#102145]"
                        />
                      ) : (
                        <MemoryBodyPreview
                          value={body}
                          className="text-sm leading-relaxed"
                          noBorder={true}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
        </div>
      </div>
    </div>
  );

  // Render via portal to isolate from parent component tree
  if (typeof window !== "undefined") {
    return createPortal(modalContent, document.body);
  }
  return null;
});

VaultModal.displayName = "VaultModal";

export default VaultModal;
