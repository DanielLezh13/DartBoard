"use client";

import { useState, useEffect, useRef, useId, useMemo } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import Code from "@tiptap/extension-code";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { BrainUsageRing } from "@/components/chat/BrainUsageRing";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { marked } from "marked";
import TurndownService from "turndown";
import MemoryBodyPreview from "./MemoryBodyPreview";
import { AdjacentColumnResize } from "@/components/vault/extensions/adjacentColumnResize";
import {
  LineHeight,
  LINE_HEIGHT_CHOICES,
  LINE_HEIGHT_DEFAULT,
  getEditorLineHeight,
} from "@/components/vault/extensions/lineHeight";
import {
  normalizeMemoryDocJson,
  parseMemoryDocJson,
} from "@/lib/memoryDoc";

// Configure marked for synchronous parsing
marked.setOptions({
  breaks: false,
  gfm: true,
});
import { IconCopy, IconDots, IconFileDownload } from "@tabler/icons-react";

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
  message_created_at?: string | null;
}

type DraftMemory = {
  id?: number; // Optional id for drafts (can be -1 or undefined)
  title: string;
  summary: string;
  doc_json?: unknown;
  session_id: number | null;
  message_id: number | null;
  folder_id?: number | null; // Optional folder context
  excerpt?: string | null; // Optional excerpt
  created_at?: string; // Optional created_at for UI consistency
  message_created_at?: string; // Optional message_created_at for UI consistency
  folder_name?: string | null; // Optional folder_name for compatibility
  _isTitleGenerating?: boolean; // Internal flag while async title is being generated
  _isOptimisticTitle?: boolean; // Internal flag to track optimistic titles
};

interface MemoryPreviewProps {
  memory: Memory | DraftMemory | null;
  folders: string[];
  folderObjects?: Array<{ id: number; name: string }>;
  onSave: (data: {
    id: number;
    title: string;
    folder_name: string;
  }) => Promise<void> | void;
  onSaveDraft?: (draft: DraftMemory) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onDiscardDraft?: () => void;
  onFoldersChanged?: () => void | Promise<void>;
  saving?: boolean;
  deleting?: boolean;
  error?: string | null;
  forceEditMemoryId?: number | null;
  isDraft?: boolean;
  onEditHandled?: () => void;
  /**
   * When true, render without the outer "card/modal" chrome so it can live
   * inline inside the chat column like a doc page.
   */
  embedded?: boolean;
  /** Optional close handler for embedded (/chat) doc view. */
  onCloseEmbedded?: () => void;
  /**
   * Optional portal target for the TipTap formatting toolbar when embedded.
   * If provided, the toolbar will render into this element while editing.
   */
  embeddedTopBarToolbarTargetId?: string;
  /**
   * Notify parent when the embedded toolbar is visible so the TopBar can fade out dates, etc.
   */
  onEmbeddedToolbarVisibleChange?: (visible: boolean) => void;
  /** IDs of memories attached to the active session */
  attachedMemoryIds?: number[];
  /** Full attached memories array with pin state */
  attachedMemories?: Array<{ id: number; is_pinned?: number | boolean }>;
  /** Callback to attach a memory to the active session */
  onAttachMemory?: (memoryId: number) => void;
  /** Callback to detach a memory from the active session */
  onDetachMemory?: (memoryId: number) => void;
  /** Session-level usage ratio (0..1) for the brain ring progress */
  usageRatio?: number;
  /** Active session ID for refresh logic */
  activeSessionId?: number | null;
  /** Optional callback to refresh session attachments after detach */
  onRefreshSession?: () => void;
}

const TABLE_LIMITS = {
  maxRows: 20,
  maxColumns: 48,
  maxCells: 160,
  initialRows: 3,
  initialColumns: 3,
  minColumnWidthPx: 44,
} as const;
const TABLE_RIGHT_WALL_INSET_PX = 32;

function getContentBoxWidth(el: HTMLElement): number {
  const styles = window.getComputedStyle(el);
  const paddingLeft = Number.parseFloat(styles.paddingLeft || "0") || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight || "0") || 0;
  return Math.max(0, el.clientWidth - paddingLeft - paddingRight);
}

type ActiveTableContext = {
  tableNode: any;
  tablePos: number;
  tableDom: HTMLTableElement;
  wrapper: HTMLElement | null;
  columnCount: number;
};

type ColumnAddPlan = {
  canAdd: boolean;
  nextWidths: number[];
  reason: "ok" | "no-space" | "missing-table";
};

function getTableColumnCount(tableNode: any): number {
  const firstRow = tableNode?.childCount > 0 ? tableNode.child(0) : null;
  if (!firstRow || firstRow.childCount === 0) return 0;
  let count = 0;
  for (let i = 0; i < firstRow.childCount; i += 1) {
    const cell = firstRow.child(i);
    count += Math.max(1, Number(cell?.attrs?.colspan || 1));
  }
  return count;
}

function resolveActiveTableContext(editor: any): ActiveTableContext | null {
  if (!editor || editor.isDestroyed) return null;
  const { $from } = editor.state.selection;
  let tableNode: any = null;
  let tablePos: number | null = null;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    tableNode = node;
    tablePos = $from.before(depth);
    break;
  }
  if (!tableNode || tablePos == null) return null;

  let domNode: Node | null = null;
  try {
    domNode = editor.view.domAtPos(editor.state.selection.from).node;
  } catch {
    return null;
  }
  const element = domNode instanceof Element ? domNode : domNode?.parentElement ?? null;
  const tableDom = element?.closest("table");
  if (!(tableDom instanceof HTMLTableElement)) return null;

  const columnCount = getTableColumnCount(tableNode);
  if (columnCount <= 0) return null;

  const wrapper = tableDom.closest(".tableWrapper");
  return {
    tableNode,
    tablePos,
    tableDom,
    wrapper: wrapper instanceof HTMLElement ? wrapper : null,
    columnCount,
  };
}

function readNodeColumnWidths(tableNode: any, columnCount: number): number[] | null {
  const firstRow = tableNode?.childCount > 0 ? tableNode.child(0) : null;
  if (!firstRow || firstRow.childCount === 0) return null;
  const widths: number[] = [];

  for (let i = 0; i < firstRow.childCount; i += 1) {
    const cell = firstRow.child(i);
    const colspan = Math.max(1, Number(cell?.attrs?.colspan || 1));
    const raw = Array.isArray(cell?.attrs?.colwidth) ? (cell.attrs.colwidth as number[]) : [];
    if (raw.length < colspan || raw.some((value) => !Number.isFinite(value) || value <= 0)) {
      return null;
    }
    for (let c = 0; c < colspan; c += 1) widths.push(raw[c]);
  }

  if (widths.length !== columnCount) return null;
  return widths;
}

function readDomColumnWidths(tableDom: HTMLTableElement, columnCount: number): number[] {
  const colEls = Array.from(tableDom.querySelectorAll("colgroup col"));
  const fromCols = colEls
    .slice(0, columnCount)
    .map((col) => {
      const fromStyle = Number.parseFloat((col as HTMLElement).style.width || "");
      if (Number.isFinite(fromStyle) && fromStyle > 0) return fromStyle;
      const fromRect = col.getBoundingClientRect().width;
      return Number.isFinite(fromRect) && fromRect > 0 ? fromRect : 0;
    });
  if (fromCols.length === columnCount && fromCols.every((w) => w > 0)) return fromCols;

  const firstRow = tableDom.querySelector("tr");
  if (firstRow) {
    const measured = new Array(columnCount).fill(0);
    let colCursor = 0;
    const cells = Array.from(firstRow.children).filter(
      (cell) => cell.tagName === "TH" || cell.tagName === "TD"
    ) as HTMLElement[];
    for (const cell of cells) {
      if (colCursor >= columnCount) break;
      const colspan = Math.max(1, Number(cell.getAttribute("colspan") || "1"));
      const cellWidth = cell.getBoundingClientRect().width;
      const perCol = colspan > 0 ? cellWidth / colspan : cellWidth;
      for (let i = 0; i < colspan && colCursor < columnCount; i += 1, colCursor += 1) {
        measured[colCursor] = perCol;
      }
    }
    if (measured.every((w) => Number.isFinite(w) && w > 0)) return measured;
  }

  const fallback = Math.max(1, Math.floor(tableDom.getBoundingClientRect().width / Math.max(1, columnCount)));
  return new Array(columnCount).fill(fallback);
}

function shrinkWidthsEvenly(
  widths: number[],
  minWidth: number,
  requiredShrink: number
): number[] | null {
  if (requiredShrink <= 0) return widths.slice();

  const next = widths.slice();
  let remaining = requiredShrink;
  let guard = 0;
  while (remaining > 0.01 && guard < 96) {
    const donors = next
      .map((width, index) => ({ index, spare: width - minWidth }))
      .filter((item) => item.spare > 0.01);
    if (donors.length === 0) break;
    const share = remaining / donors.length;
    let took = 0;
    for (const donor of donors) {
      const take = Math.min(donor.spare, share);
      if (take <= 0) continue;
      next[donor.index] -= take;
      took += take;
    }
    if (took <= 0.001) break;
    remaining -= took;
    guard += 1;
  }

  if (remaining > 0.5) return null;
  return next.map((w) => Math.max(minWidth, w));
}

function buildColumnAddPlan(
  context: ActiveTableContext | null,
  rightBoundaryInsetPx: number,
  minWidth: number
): ColumnAddPlan {
  if (!context) {
    return { canAdd: false, nextWidths: [], reason: "missing-table" };
  }

  const widths =
    readNodeColumnWidths(context.tableNode, context.columnCount) ??
    readDomColumnWidths(context.tableDom, context.columnCount);
  const normalized = widths.map((w) => Math.max(minWidth, w));
  const currentTotal = normalized.reduce((sum, width) => sum + width, 0);
  const wallWidth = context.wrapper?.clientWidth || context.tableDom.getBoundingClientRect().width;
  const clampWidth = Math.max(1, wallWidth - Math.max(0, rightBoundaryInsetPx));
  const requiredShrink = Math.max(0, currentTotal + minWidth - clampWidth);

  const shrunken = shrinkWidthsEvenly(normalized, minWidth, requiredShrink);
  if (!shrunken) {
    return { canAdd: false, nextWidths: [], reason: "no-space" };
  }

  const rounded = shrunken.map((w) => Math.max(minWidth, Math.round(w)));
  let totalAfter = rounded.reduce((sum, width) => sum + width, 0) + minWidth;
  const clampInt = Math.floor(clampWidth);
  let overflow = Math.max(0, totalAfter - clampInt);
  if (overflow > 0) {
    let guard = 0;
    while (overflow > 0 && guard < rounded.length * 128) {
      let reducedInPass = false;
      for (let i = 0; i < rounded.length && overflow > 0; i += 1) {
        // Round-robin reductions keep collapse visually even.
        if (rounded[i] <= minWidth) continue;
        rounded[i] -= 1;
        overflow -= 1;
        reducedInPass = true;
      }
      if (!reducedInPass) break;
      guard += 1;
    }
    totalAfter = rounded.reduce((sum, width) => sum + width, 0) + minWidth;
  }

  if (totalAfter > clampInt) {
    return { canAdd: false, nextWidths: [], reason: "no-space" };
  }

  return {
    canAdd: true,
    nextWidths: [...rounded, minWidth],
    reason: "ok",
  };
}

function applyWidthsToActiveTable(editor: any, widths: number[]): boolean {
  const context = resolveActiveTableContext(editor);
  if (!context) return false;
  if (context.columnCount !== widths.length) return false;

  const tr = editor.state.tr;
  let modified = false;
  let rowOffset = 0;
  for (let r = 0; r < context.tableNode.childCount; r += 1) {
    const row = context.tableNode.child(r);
    let cellOffset = 0;
    let colCursor = 0;
    for (let c = 0; c < row.childCount; c += 1) {
      const cell = row.child(c);
      const colspan = Math.max(1, Number(cell.attrs.colspan || 1));
      const nextColwidth = new Array(colspan)
        .fill(0)
        .map((_, i) => Math.max(TABLE_LIMITS.minColumnWidthPx, Math.round(widths[colCursor + i] || 0)));
      const currentColwidth = Array.isArray(cell.attrs.colwidth) ? (cell.attrs.colwidth as number[]) : [];
      const hasSameWidths =
        currentColwidth.length === nextColwidth.length &&
        currentColwidth.every((value, idx) => Number(value) === nextColwidth[idx]);
      if (!hasSameWidths) {
        const cellPos = context.tablePos + 1 + rowOffset + 1 + cellOffset;
        tr.setNodeMarkup(cellPos, undefined, {
          ...cell.attrs,
          colwidth: nextColwidth,
        });
        modified = true;
      }
      colCursor += colspan;
      cellOffset += cell.nodeSize;
    }
    rowOffset += row.nodeSize;
  }

  if (!modified) return true;
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Walk the editor document and assign explicit `colwidth` values to any table
 * whose cells currently lack widths (e.g. markdown-hydrated tables).
 *
 * We seed widths from the rendered DOM table so tables retain a compact
 * "natural" layout by default. If that exceeds the right wall, widths are
 * shrunk proportionally while keeping per-column minimum widths.
 */
function applyMissingTableColWidths(editor: any, rightBoundaryInsetPx = 0) {
  if (!editor || editor.isDestroyed) return;

  const editorDom = editor.view.dom as HTMLElement | null;
  if (!editorDom) return;
  const editorContentWidth = getContentBoxWidth(editorDom);
  if (!editorContentWidth || editorContentWidth < 100) return;
  const wrapperEls = Array.from(editorDom.querySelectorAll<HTMLElement>(".tableWrapper"));
  const tableEls = Array.from(editorDom.querySelectorAll<HTMLTableElement>("table"));
  let wrapperIndex = 0;
  let tableIndex = 0;

  const { doc } = editor.state;
  const tr = editor.state.tr;
  let modified = false;

  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "table") return true;
    const wrapperWidth = wrapperEls[wrapperIndex]?.clientWidth || 0;
    const tableEl = tableEls[tableIndex] ?? null;
    wrapperIndex += 1;
    tableIndex += 1;

    const firstRow = node.childCount > 0 ? node.child(0) : null;
    if (!firstRow || firstRow.childCount === 0) return false;

    let colCount = 0;
    let hasWidths = false;
    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      colCount += cell.attrs.colspan || 1;
      const cw = cell.attrs.colwidth;
      if (cw && cw.some((w: number) => w > 0)) hasWidths = true;
    }
    if (hasWidths || colCount === 0) return false;

    const usableBaseWidth = wrapperWidth > 0 ? wrapperWidth : editorContentWidth;
    const clampWidth = Math.max(
      usableBaseWidth - Math.max(0, rightBoundaryInsetPx),
      TABLE_LIMITS.minColumnWidthPx * colCount
    );
    const minTableWidth = TABLE_LIMITS.minColumnWidthPx * colCount;
    const fallbackColWidth = Math.max(
      TABLE_LIMITS.minColumnWidthPx,
      Math.floor(clampWidth / colCount)
    );
    const fallbackWidths = new Array(colCount).fill(fallbackColWidth);

    const measuredWidths =
      tableEl instanceof HTMLTableElement ? readDomColumnWidths(tableEl, colCount) : null;
    let normalizedWidths =
      Array.isArray(measuredWidths) && measuredWidths.length === colCount
        ? measuredWidths.map((width) => {
            if (!Number.isFinite(width) || width <= 0) return TABLE_LIMITS.minColumnWidthPx;
            return Math.max(TABLE_LIMITS.minColumnWidthPx, width);
          })
        : fallbackWidths.slice();

    const measuredTotal = normalizedWidths.reduce((sum, width) => sum + width, 0);
    if (!Number.isFinite(measuredTotal) || measuredTotal <= 0) {
      normalizedWidths = fallbackWidths.slice();
    }

    const requiredShrink = Math.max(
      0,
      normalizedWidths.reduce((sum, width) => sum + width, 0) - clampWidth
    );
    if (requiredShrink > 0) {
      const shrunken = shrinkWidthsEvenly(
        normalizedWidths,
        TABLE_LIMITS.minColumnWidthPx,
        requiredShrink
      );
      normalizedWidths = shrunken ?? fallbackWidths.slice();
    }

    let roundedWidths = normalizedWidths.map((width) =>
      Math.max(TABLE_LIMITS.minColumnWidthPx, Math.round(width))
    );
    const clampInt = Math.floor(clampWidth);
    let roundedTotal = roundedWidths.reduce((sum, width) => sum + width, 0);
    if (roundedTotal > clampInt) {
      let overflow = roundedTotal - clampInt;
      let guard = 0;
      while (overflow > 0 && guard < roundedWidths.length * 128) {
        let reducedInPass = false;
        for (let i = 0; i < roundedWidths.length && overflow > 0; i += 1) {
          if (roundedWidths[i] <= TABLE_LIMITS.minColumnWidthPx) continue;
          roundedWidths[i] -= 1;
          overflow -= 1;
          reducedInPass = true;
        }
        if (!reducedInPass) break;
        guard += 1;
      }
      roundedTotal = roundedWidths.reduce((sum, width) => sum + width, 0);
    }

    if (roundedTotal < minTableWidth) {
      roundedWidths = fallbackWidths.slice();
    }

    let rowOff = 0;
    for (let r = 0; r < node.childCount; r++) {
      const row = node.child(r);
      let cellOff = 0;
      let colCursor = 0;
      for (let c = 0; c < row.childCount; c++) {
        const cell = row.child(c);
        const cellPos = pos + 1 + rowOff + 1 + cellOff;
        const colspan = cell.attrs.colspan || 1;
        const nextColwidth = new Array(colspan).fill(0).map((_, index) => {
          const widthIndex = Math.min(colCursor + index, roundedWidths.length - 1);
          const width = roundedWidths[widthIndex];
          if (!Number.isFinite(width) || width <= 0) return TABLE_LIMITS.minColumnWidthPx;
          return Math.max(TABLE_LIMITS.minColumnWidthPx, width);
        });
        tr.setNodeMarkup(cellPos, undefined, {
          ...cell.attrs,
          colwidth: nextColwidth,
        });
        modified = true;
        colCursor += colspan;
        cellOff += cell.nodeSize;
      }
      rowOff += row.nodeSize;
    }
    return false;
  });

  if (modified) {
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }
}

export default function MemoryPreview({
  memory,
  folders,
  folderObjects,
  onSave,
  onSaveDraft,
  onDelete,
  onDiscardDraft,
  onFoldersChanged,
  saving = false,
  deleting = false,
  error: externalError = null,
  forceEditMemoryId = null,
  isDraft = false,
  onEditHandled,
  embedded = false,
  onCloseEmbedded,
  embeddedTopBarToolbarTargetId,
  onEmbeddedToolbarVisibleChange,
  attachedMemoryIds = [],
  attachedMemories = [],
  onAttachMemory,
  onDetachMemory,
  usageRatio = 0,
  activeSessionId,
  onRefreshSession,
}: MemoryPreviewProps) {
  const chatIconGradientId = useId();
  const [editedTitle, setEditedTitle] = useState("");
  const [hasEditedTitle, setHasEditedTitle] = useState(false);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState<string | null>(null);
  const [draftFolderId, setDraftFolderId] = useState<number | null>(null);
  const [folderOptions, setFolderOptions] = useState<string[]>(folders);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedExcerpt, setEditedExcerpt] = useState("");
  const [isEditingExcerpt, setIsEditingExcerpt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPageActionsMenu, setShowPageActionsMenu] = useState(false);
  const pageActionsMenuRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTableInsertPicker, setShowTableInsertPicker] = useState(false);
  const [tablePickerHover, setTablePickerHover] = useState<{ rows: number; cols: number } | null>(null);
  const [tablePickerPosition, setTablePickerPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [toolbarTargetEl, setToolbarTargetEl] = useState<HTMLElement | null>(null);
  const [titleLoadingDots, setTitleLoadingDots] = useState(1);
  const [titleRevealVisible, setTitleRevealVisible] = useState(true);
  const [lineHeightValue, setLineHeightValue] = useState<string>(LINE_HEIGHT_DEFAULT);
  const prevTitleGeneratingRef = useRef(false);
  const memoryId = (memory as any)?.id ?? null;
  const memorySessionId = (memory as any)?.session_id ?? null;
  const memoryMessageId = (memory as any)?.message_id ?? null;
  const memoryFolderId = (memory as any)?.folder_id ?? null;
  const memoryTitle = memory?.title ?? "";
  const memorySummary = memory?.summary ?? "";
  const hasMemory = memory != null;

  const memoryKey = useMemo(() => {
    return `${memoryId}:${memorySessionId}:${memoryMessageId}`;
  }, [memoryId, memorySessionId, memoryMessageId]);

  const isDraftTitleGenerating =
    Boolean(isDraft && (memory as any)?._isTitleGenerating) &&
    !hasEditedTitle &&
    editedTitle.trim().length === 0;
  const generatingTitleLabel = `Generating title${".".repeat(titleLoadingDots)}`;
  const shouldHideGeneratedTitleText =
    !isDraftTitleGenerating &&
    !hasEditedTitle &&
    !titleRevealVisible &&
    editedTitle.trim().length > 0;
  const memoryDocJson = (memory as any)?.doc_json;
  const parsedMemoryDoc = useMemo(() => parseMemoryDocJson(memoryDocJson), [memoryDocJson]);

  // Initialize turndown service for HTML to markdown conversion
  const turndownService = useRef<TurndownService>(
    new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })
  );

  // TipTap editor instance - single stable instance for both view and edit
  // Only initialize when memory exists
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
      Heading.configure({ levels: [1, 2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Blockquote,
      CodeBlock,
      Code, // Inline code
      HorizontalRule, // Divider
      LineHeight,
      Table.configure({
        resizable: false,
        renderWrapper: true,
        handleWidth: 8,
        cellMinWidth: TABLE_LIMITS.minColumnWidthPx,
        lastColumnResizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      AdjacentColumnResize.configure({
        handleWidth: 8,
        cellMinWidth: TABLE_LIMITS.minColumnWidthPx,
        lastColumnResizable: true,
        rightBoundaryInsetPx: TABLE_RIGHT_WALL_INSET_PX,
      }),
    ],
    content: "",
    editable: false, // Start as non-editable (view mode)
    editorProps: {
      attributes: {
        class:
          "ProseMirror memory-preview-markdown prose prose-invert prose-sm max-w-none w-full min-h-[420px] px-6 py-5 leading-relaxed focus:outline-none",
      },
    },
    immediatelyRender: false,
  }, [memory?.id]);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);
  const excerptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestMemoryRef = useRef<Memory | DraftMemory | null>(memory);
  const latestFolderObjectsRef = useRef<typeof folderObjects>(folderObjects);
  const latestIsDraftRef = useRef(isDraft);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const tableInsertPickerRef = useRef<HTMLDivElement>(null);
  const tableInsertButtonRef = useRef<HTMLButtonElement>(null);
  const tableInsertPopupRef = useRef<HTMLDivElement>(null);
  const [editorContainerWidth, setEditorContainerWidth] = useState(0);
  const [tableUiTick, setTableUiTick] = useState(0);
  const [activeTableOverlay, setActiveTableOverlay] = useState<null | {
    top: number;
    left: number;
    width: number;
    height: number;
  }>(null);

  useEffect(() => {
    latestMemoryRef.current = memory;
  }, [memory]);

  useEffect(() => {
    latestFolderObjectsRef.current = folderObjects;
  }, [folderObjects]);

  useEffect(() => {
    latestIsDraftRef.current = isDraft;
  }, [isDraft]);

  const iconButtonClass =
    "inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-800/70 bg-gray-900/40 text-gray-300 hover:text-white hover:bg-gray-800/70 transition-colors disabled:opacity-50 disabled:cursor-default";

  // Title-only editing (separate from content edit)
  const handleCancelTitleEdit = () => {
    if (!memory) return;
    setEditedTitle(memory.title || "");
    setIsEditingTitle(false);
  };

  const handleSaveTitleOnly = async () => {
    if (!memory) return;
    const trimmed = editedTitle.trim();
    const prev = memory.title || "";

    if (trimmed === prev) {
      setIsEditingTitle(false);
      return;
    }

    try {
      if (!memory.id) {
        setError("Cannot save: memory has no ID");
        return;
      }
      await onSave({
        id: memory.id,
        title: trimmed,
        folder_name: memory.folder_name || "Unsorted",
      });
      setIsEditingTitle(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save title");
    }
  };

  // NOTE: "even calmer" UX: do not auto-focus/auto-select the title on enter-edit.
  // Let the user click into the title if they want to edit it.

  // Resolve portal target for the embedded TopBar toolbar (if provided)
  useEffect(() => {
    if (!embedded || !embeddedTopBarToolbarTargetId || typeof document === "undefined") {
      setToolbarTargetEl(null);
      return;
    }
    const el = document.getElementById(embeddedTopBarToolbarTargetId);
    setToolbarTargetEl(el);
  }, [embedded, embeddedTopBarToolbarTargetId]);

  const shouldShowEmbeddedToolbar = !!(embedded && isEditing && editor);

  useEffect(() => {
    if (!editor) {
      setLineHeightValue(LINE_HEIGHT_DEFAULT);
      return;
    }
    const syncLineHeight = () => setLineHeightValue(getEditorLineHeight(editor));
    syncLineHeight();
    editor.on("selectionUpdate", syncLineHeight);
    editor.on("transaction", syncLineHeight);
    return () => {
      editor.off("selectionUpdate", syncLineHeight);
      editor.off("transaction", syncLineHeight);
    };
  }, [editor]);

  // Tell parent when the embedded toolbar is active so it can hide dates, etc.
  useEffect(() => {
    if (!embedded) return;
    onEmbeddedToolbarVisibleChange?.(shouldShowEmbeddedToolbar);
  }, [embedded, shouldShowEmbeddedToolbar, onEmbeddedToolbarVisibleChange]);

  useEffect(() => {
    if (!isDraftTitleGenerating) {
      setTitleLoadingDots(1);
      return;
    }
    const timer = window.setInterval(() => {
      setTitleLoadingDots((prev) => (prev % 3) + 1);
    }, 330);
    return () => window.clearInterval(timer);
  }, [isDraftTitleGenerating]);

  useEffect(() => {
    const wasGenerating = prevTitleGeneratingRef.current;
    if (wasGenerating && !isDraftTitleGenerating && !hasEditedTitle && editedTitle.trim().length > 0) {
      setTitleRevealVisible(false);
      const timer = window.setTimeout(() => setTitleRevealVisible(true), 24);
      prevTitleGeneratingRef.current = isDraftTitleGenerating;
      return () => window.clearTimeout(timer);
    }
    if (!isDraft || hasEditedTitle || editedTitle.trim().length === 0) {
      setTitleRevealVisible(true);
    }
    prevTitleGeneratingRef.current = isDraftTitleGenerating;
  }, [isDraft, isDraftTitleGenerating, hasEditedTitle, editedTitle]);

  useEffect(() => {
    const currentMemory = latestMemoryRef.current;
    if (currentMemory) {
      setEditedTitle(currentMemory.title || "");
      setHasEditedTitle(false); // Reset edit flag when memory changes
      // Preserve empty string if excerpt is explicitly empty string (for blank custom text)
      setEditedExcerpt(currentMemory.excerpt !== null && currentMemory.excerpt !== undefined ? currentMemory.excerpt : "");

      const isDraftHydrate = !!(latestIsDraftRef.current || (currentMemory as any)?.id === -1);
      if (isDraftHydrate) {
        // For drafts, use folder_id as single source of truth
        const folderId = (currentMemory as any)?.folder_id ?? null;
        // Derive display name from folder_id lookup
        const folderLabel = folderId && latestFolderObjectsRef.current
          ? latestFolderObjectsRef.current.find((f) => f.id === folderId)?.name ?? "Unsorted"
          : "Unsorted";
        // Only initialize when opening a new draft; don't overwrite if user already chose a folder
        setDraftFolderName((prev) => prev ?? folderLabel);
        setDraftFolderId((prev) => prev ?? folderId);
      } else {
        setDraftFolderName(null);
        setDraftFolderId(null);
      }

      // Don't reset isEditing if it's a draft (drafts should stay in edit mode)
      if (!isDraftHydrate) {
        setIsEditing(false);
      }
      setIsEditingTitle(false);
      setIsEditingExcerpt(false);
      setShowFolderDropdown(false);
      setError(null);
      
      // Set edited excerpt from memory (custom-only, no mode switching)
      setEditedExcerpt(currentMemory.excerpt !== null && currentMemory.excerpt !== undefined ? currentMemory.excerpt : "");
      setCopied(false);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
      setIsPreviewOpen(false);
    }
  }, [memoryKey]);

  useEffect(() => {
    setFolderOptions(folders);

    // Validate folder_id exists; reset to null if deleted
    const folderId = (isDraft || memoryId === -1)
      ? memoryFolderId
      : null; // Memory type doesn't have folder_id

    if (folderId != null) {
      const folderExists = folderObjects?.some((f) => f.id === folderId);
      if (!folderExists) {
        // Folder was deleted - reset to null (Unsorted)
        if (isDraft || memoryId === -1) {
          setDraftFolderName("Unsorted");
        }
      }
    }
  }, [folders, isDraft, memoryId, memoryFolderId, folderObjects]);

  // Initialize draft state when draft mode is enabled
  useEffect(() => {
    if (isDraft && hasMemory) {
      const incomingTitle = memoryTitle;
      if (!hasEditedTitle || incomingTitle.length === 0) {
        setEditedTitle(incomingTitle);
      }
      // Don't override isEditing if already set by forceEditMemoryId
      if (!isEditing) {
        setIsEditing(true);
      }
    }
  }, [isDraft, hasMemory, memoryId, memoryTitle, hasEditedTitle, isEditing]);

  // NOTE: "even calmer" UX: do not auto-focus/auto-select the title on enter-edit.

  // Toggle editor editability and CSS classes based on isEditing state
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
      // Update CSS classes dynamically
      const editorDom = editor.view.dom;
      if (isEditing) {
        editorDom.classList.remove("tiptap-readonly");
        editorDom.classList.add("tiptap-editing");
      } else {
        editorDom.classList.remove("tiptap-editing");
        editorDom.classList.add("tiptap-readonly");
      }
    }
  }, [editor, isEditing]);

  useEffect(() => {
    if (isEditing) return;
    setShowTableInsertPicker(false);
    setTablePickerHover(null);
  }, [isEditing]);

  // Sync TipTap editor content from memory.summary
  useEffect(() => {
    if (!editor || !hasMemory) return;

    const parsedDoc = parseMemoryDocJson(memoryDocJson);
    if (parsedDoc) {
      editor.commands.setContent(parsedDoc, false);
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) applyMissingTableColWidths(editor, TABLE_RIGHT_WALL_INSET_PX);
      });
      return;
    }

    if (!memorySummary || memorySummary.trim() === "") {
      editor.commands.setContent("<p></p>", false); // Empty paragraph instead of empty string
      return;
    }

    Promise.resolve(marked.parse(memorySummary))
      .then((html) => {
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(typeof html === 'string' ? html : String(html), false);
          requestAnimationFrame(() => {
            if (!editor.isDestroyed) applyMissingTableColWidths(editor, TABLE_RIGHT_WALL_INSET_PX);
          });
        }
      })
      .catch((err) => {
        console.error("Error parsing markdown:", err);
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(`<p>${memorySummary.replace(/\n/g, "<br>")}</p>`, false);
        }
      });
  }, [editor, hasMemory, memoryId, memorySummary, memoryDocJson]);

  // Handle forced edit mode (e.g., when creating a new memory or opening draft)
  useEffect(() => {
    if (isDraft || (forceEditMemoryId && hasMemory && memoryId !== null && memoryId === forceEditMemoryId)) {
      setIsEditing(true);
      // Don't focus to end for drafts to prevent scroll to bottom
      if (!isDraft) {
        setTimeout(() => {
          editor?.commands.focus("end");
        }, 100);
      }
      onEditHandled?.();
    }
  }, [forceEditMemoryId, hasMemory, memoryId, isDraft, editor, onEditHandled]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(event.target as Node)) {
        setShowFolderDropdown(false);
      }
      if (pageActionsMenuRef.current && !pageActionsMenuRef.current.contains(event.target as Node)) {
        setShowPageActionsMenu(false);
      }
      const clickedTableInsertTrigger =
        tableInsertPickerRef.current?.contains(event.target as Node) ?? false;
      const clickedTableInsertPopup =
        tableInsertPopupRef.current?.contains(event.target as Node) ?? false;
      if (!clickedTableInsertTrigger && !clickedTableInsertPopup) {
        setShowTableInsertPicker(false);
      }
    };

    if (showFolderDropdown || showPageActionsMenu || showTableInsertPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFolderDropdown, showPageActionsMenu, showTableInsertPicker]);

  useEffect(() => {
    if (isEditingExcerpt && excerptTextareaRef.current) {
      excerptTextareaRef.current.focus();
    }
  }, [isEditingExcerpt]);

  // Cleanup editor only on component unmount
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    };
  }, [editor]);


  useEffect(() => {
    if (externalError) {
      setError(externalError);
    }
  }, [externalError]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    const el = editorContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setEditorContainerWidth(el.clientWidth || 0);
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEditing]);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setTableUiTick((prev) => prev + 1);
    editor.on("selectionUpdate", bump);
    editor.on("update", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("update", bump);
    };
  }, [editor]);

  const activeTableStats = useMemo(() => {
    void tableUiTick;
    if (!editor) return null as null | { rows: number; columns: number };
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "table") continue;
      const rows = node.childCount;
      const firstRow = rows > 0 ? node.child(0) : null;
      const columns = firstRow ? firstRow.childCount : 0;
      return { rows, columns };
    }
    return null;
  }, [editor, tableUiTick]);
  const activeTableContext = useMemo(() => {
    void tableUiTick;
    if (!editor || !isEditing) return null;
    return resolveActiveTableContext(editor);
  }, [editor, isEditing, tableUiTick]);
  const columnAddPlan = useMemo(
    () => buildColumnAddPlan(activeTableContext, TABLE_RIGHT_WALL_INSET_PX, TABLE_LIMITS.minColumnWidthPx),
    [activeTableContext]
  );
  const widthBasedColumnCap =
    editorContainerWidth > 0
      ? Math.max(1, Math.floor((editorContainerWidth - 8) / TABLE_LIMITS.minColumnWidthPx))
      : TABLE_LIMITS.maxColumns;
  const effectiveMaxColumns = Math.min(TABLE_LIMITS.maxColumns, widthBasedColumnCap);
  const maxInsertPickerCols = Math.max(1, Math.min(8, effectiveMaxColumns));
  const maxInsertPickerRows = Math.max(
    1,
    Math.min(8, TABLE_LIMITS.maxRows, Math.floor(TABLE_LIMITS.maxCells / maxInsertPickerCols))
  );

  useEffect(() => {
    if (!showTableInsertPicker) return;

    const updatePickerPosition = () => {
      const button = tableInsertButtonRef.current;
      if (!button || typeof window === "undefined") return;
      const estimatedGridWidth = maxInsertPickerCols * 20 + 2;
      const panelWidth = Math.max(160, estimatedGridWidth + 16);
      const margin = 8;
      const rect = button.getBoundingClientRect();
      const top = rect.bottom + 8;
      const left = Math.max(
        margin,
        Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin)
      );
      setTablePickerPosition({ top, left });
    };

    updatePickerPosition();
    window.addEventListener("resize", updatePickerPosition);
    window.addEventListener("scroll", updatePickerPosition, true);
    return () => {
      window.removeEventListener("resize", updatePickerPosition);
      window.removeEventListener("scroll", updatePickerPosition, true);
    };
  }, [showTableInsertPicker, maxInsertPickerCols]);

  const insertPickerPreview = tablePickerHover ?? {
    rows: Math.min(TABLE_LIMITS.initialRows, maxInsertPickerRows),
    cols: Math.min(TABLE_LIMITS.initialColumns, maxInsertPickerCols),
  };
  const canAddTableColumn = !!(
    activeTableStats &&
    activeTableStats.columns < TABLE_LIMITS.maxColumns &&
    activeTableStats.rows * (activeTableStats.columns + 1) <= TABLE_LIMITS.maxCells &&
    columnAddPlan.canAdd
  );
  const canAddTableRow = !!(
    activeTableStats &&
    activeTableStats.rows < TABLE_LIMITS.maxRows &&
    (activeTableStats.rows + 1) * activeTableStats.columns <= TABLE_LIMITS.maxCells
  );
  const canDeleteTableColumn = !!(activeTableStats && activeTableStats.columns > 1);
  const canDeleteTableRow = !!(activeTableStats && activeTableStats.rows > 1);

  const showTableLimitError = (message: string) => {
    setError(message);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setError((prev) => (prev === message ? null : prev));
      }, 2400);
    }
  };

  const insertTable = (
    requestedRows: number = TABLE_LIMITS.initialRows,
    requestedCols: number = TABLE_LIMITS.initialColumns
  ) => {
    if (!editor) return;
    const cols = Math.max(1, Math.min(requestedCols, effectiveMaxColumns));
    if (cols < 1) {
      showTableLimitError("Not enough width to insert a table here.");
      return;
    }
    const maxRowsFromCellBudget = Math.floor(TABLE_LIMITS.maxCells / cols);
    const rows = Math.max(1, Math.min(requestedRows, TABLE_LIMITS.maxRows, maxRowsFromCellBudget));
    if (rows * cols > TABLE_LIMITS.maxCells) {
      showTableLimitError("Table limit reached.");
      return;
    }
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setShowTableInsertPicker(false);
    setTablePickerHover(null);
  };

  const addTableColumn = () => {
    if (!editor || !activeTableStats) return;
    if (!canAddTableColumn) {
      if (activeTableStats.columns >= TABLE_LIMITS.maxColumns) {
        showTableLimitError(`Max ${TABLE_LIMITS.maxColumns} columns per table.`);
      } else {
        const nextCells = activeTableStats.rows * (activeTableStats.columns + 1);
        if (nextCells > TABLE_LIMITS.maxCells) {
          showTableLimitError(`Table max is ${TABLE_LIMITS.maxCells} cells.`);
        } else {
          showTableLimitError("No room to add another column without crossing the right wall.");
        }
      }
      return;
    }
    const widthsAfterAdd = columnAddPlan.nextWidths;
    const { $from } = editor.state.selection;
    let tableNode: any = null;
    let tablePos: number | null = null;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "table") continue;
      tableNode = node;
      tablePos = $from.before(depth);
      break;
    }

    if (tableNode && tablePos !== null) {
      const rowCount = tableNode.childCount;
      const targetRow = 0;
      const targetCol = Math.max(0, activeTableStats.columns - 1);
      if (rowCount > 0) {
        let rowPos = tablePos + 1;
        for (let r = 0; r < rowCount; r += 1) {
          const rowNode = tableNode.child(r);
          if (r !== targetRow) {
            rowPos += rowNode.nodeSize;
            continue;
          }
          let cellPos = rowPos + 1;
          for (let c = 0; c < targetCol; c += 1) {
            cellPos += rowNode.child(c).nodeSize;
          }
          const inserted = editor
            .chain()
            .focus()
            .setTextSelection(cellPos + 1)
            .addColumnAfter()
            .run();
          if (!inserted) return;
          if (widthsAfterAdd.length > 0) {
            const applied = applyWidthsToActiveTable(editor, widthsAfterAdd);
            if (!applied && typeof window !== "undefined") {
              window.requestAnimationFrame(() => {
                applyWidthsToActiveTable(editor, widthsAfterAdd);
              });
            }
          }
          return;
        }
      }
    }

    const inserted = editor.chain().focus().addColumnAfter().run();
    if (!inserted) return;
    if (widthsAfterAdd.length > 0) {
      const applied = applyWidthsToActiveTable(editor, widthsAfterAdd);
      if (!applied && typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          applyWidthsToActiveTable(editor, widthsAfterAdd);
        });
      }
    }
  };

  const addTableRow = () => {
    if (!editor || !activeTableStats) return;
    if (!canAddTableRow) {
      if (activeTableStats.rows >= TABLE_LIMITS.maxRows) {
        showTableLimitError(`Max ${TABLE_LIMITS.maxRows} rows per table.`);
      } else {
        showTableLimitError(`Table max is ${TABLE_LIMITS.maxCells} cells.`);
      }
      return;
    }
    const { $from } = editor.state.selection;
    let tableNode: any = null;
    let tablePos: number | null = null;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "table") continue;
      tableNode = node;
      tablePos = $from.before(depth);
      break;
    }

    if (tableNode && tablePos !== null) {
      const rowCount = tableNode.childCount;
      const targetRow = Math.max(0, rowCount - 1);
      if (rowCount > 0) {
        let rowPos = tablePos + 1;
        for (let r = 0; r < rowCount; r += 1) {
          const rowNode = tableNode.child(r);
          if (r !== targetRow) {
            rowPos += rowNode.nodeSize;
            continue;
          }
          const firstCellPos = rowPos + 1;
          editor.chain().focus().setTextSelection(firstCellPos + 1).addRowAfter().run();
          return;
        }
      }
    }

    editor.chain().focus().addRowAfter().run();
  };

  const deleteTableColumn = () => {
    if (!editor || !activeTableStats) return;
    if (!canDeleteTableColumn) {
      showTableLimitError("Table must keep at least 1 column.");
      return;
    }

    const { $from } = editor.state.selection;
    let tableNode: any = null;
    let tablePos: number | null = null;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "table") continue;
      tableNode = node;
      tablePos = $from.before(depth);
      break;
    }

    if (tableNode && tablePos !== null && tableNode.childCount > 0) {
      const firstRow = tableNode.child(0);
      if (firstRow.childCount > 0) {
        let cellPos = tablePos + 1 + 1;
        for (let c = 0; c < firstRow.childCount - 1; c += 1) {
          cellPos += firstRow.child(c).nodeSize;
        }
        editor.chain().focus().setTextSelection(cellPos + 1).deleteColumn().run();
        return;
      }
    }

    editor.chain().focus().deleteColumn().run();
  };

  const deleteTableRow = () => {
    if (!editor || !activeTableStats) return;
    if (!canDeleteTableRow) {
      showTableLimitError("Table must keep at least 1 row.");
      return;
    }

    const { $from } = editor.state.selection;
    let tableNode: any = null;
    let tablePos: number | null = null;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "table") continue;
      tableNode = node;
      tablePos = $from.before(depth);
      break;
    }

    if (tableNode && tablePos !== null && tableNode.childCount > 0) {
      const targetRow = tableNode.childCount - 1;
      let rowPos = tablePos + 1;
      for (let r = 0; r < targetRow; r += 1) {
        rowPos += tableNode.child(r).nodeSize;
      }
      const firstCellPos = rowPos + 1;
      editor.chain().focus().setTextSelection(firstCellPos + 1).deleteRow().run();
      return;
    }

    editor.chain().focus().deleteRow().run();
  };

  const TABLE_OVERLAY_OFFSETS = {
    addColumnX: 0,
    addColumnY: 0,
    addRowX: 0,
    addRowY: 0,
  } as const;

  useEffect(() => {
    if (!editor || !isEditing || !activeTableStats) {
      setActiveTableOverlay(null);
      return;
    }

    const container = editorContainerRef.current;
    if (!container) {
      setActiveTableOverlay(null);
      return;
    }

    let domNode: Node | null = null;
    try {
      domNode = editor.view.domAtPos(editor.state.selection.from).node;
    } catch {
      setActiveTableOverlay(null);
      return;
    }

    const element = domNode instanceof Element ? domNode : domNode?.parentElement ?? null;
    const tableElement = element?.closest("table");
    if (!(tableElement instanceof HTMLTableElement)) {
      setActiveTableOverlay(null);
      return;
    }

    let frameId = 0;
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const tableRect = tableElement.getBoundingClientRect();
      const next = {
        top: tableRect.top - containerRect.top + container.scrollTop,
        left: tableRect.left - containerRect.left + container.scrollLeft,
        width: tableRect.width,
        height: tableRect.height,
      };
      setActiveTableOverlay((prev) => {
        if (
          prev &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    };

    const scheduleMeasure = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        measure();
      });
    };

    measure();

    const handleScroll = () => scheduleMeasure();
    const handleResize = () => scheduleMeasure();

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => scheduleMeasure())
        : null;
    resizeObserver?.observe(container);
    resizeObserver?.observe(tableElement);

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => scheduleMeasure())
        : null;
    mutationObserver?.observe(tableElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style", "class"],
    });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [editor, isEditing, activeTableStats, tableUiTick]);

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

  const serializeEditorMarkdown = () => {
    if (!editor) return "";
    const html = editor.getHTML() ?? "";
    if (!html.includes("<table")) {
      return turndownService.current.turndown(html).trim();
    }

    if (typeof document === "undefined") {
      return turndownService.current.turndown(html).trim();
    }

    const container = document.createElement("div");
    container.innerHTML = html;
    const tableTokens: Array<{ token: string; markdown: string }> = [];
    const tables = Array.from(container.querySelectorAll("table"));

    tables.forEach((table, idx) => {
      const markdown = tableToMarkdown(table as HTMLTableElement);
      // Use alphanumeric-only placeholders so Turndown doesn't escape them.
      const token = `DBTABLETOKEN${idx}END`;
      tableTokens.push({ token, markdown });
      const marker = document.createElement("p");
      marker.textContent = token;
      table.replaceWith(marker);
    });

    let markdown = turndownService.current.turndown(container.innerHTML);
    for (const { token, markdown: tableMarkdown } of tableTokens) {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      markdown = markdown.replace(new RegExp(escapedToken, "g"), `\n\n${tableMarkdown}\n\n`);
    }

    return markdown.replace(/\n{3,}/g, "\n\n").trim();
  };

  const handleFolderSelect = async (folderName: string) => {
    if (!memory) return;

    const newFolder = folderName.trim() || "Unsorted";
    const oldFolder = (isDraft ? (draftFolderName ?? (memory as any)?.folder_name) : memory.folder_name) || "Unsorted";

    if (newFolder === oldFolder) {
      setShowFolderDropdown(false);
      return;
    }

    setShowFolderDropdown(false);

    if (isDraft || memory.id === -1) {
      // For drafts, find the folder_id and update the draft
      const folder = folderObjects?.find(f => f.name === newFolder);
      const folderId = folder?.id ?? null;
      
      // Update draft folder states
      setDraftFolderName(newFolder);
      setDraftFolderId(folderId);
      return;
    }

    try {
      if (!memory.id) {
        setError("Cannot save: memory has no ID");
        return;
      }
      await onSave({
        id: memory.id,
        title: memory.title || "",
        folder_name: newFolder,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save folder");
    }
  };

  const handleSaveExcerpt = async () => {
    if (!memory) return;
    
    if (!memory.id) {
      setError("Cannot save: memory has no ID");
      return;
    }
    
    try {
      // Allow empty string to be saved (for blank custom text)
      // Save trimmed text - preserve empty string if user saved blank custom text
      const trimmedExcerpt = editedExcerpt.trim();
      
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: memory.id,
          excerpt: trimmedExcerpt === "" ? "" : trimmedExcerpt,
        }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to save preview text");
      }
      
      // Update memory in parent by calling onSave with existing fields
      await onSave({
        id: memory.id,
        title: memory.title || "",
        folder_name: memory.folder_name || "Unsorted",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preview text");
    }
  };

  const handleEditMode = () => {
    if (!memory) return;
    // Unified edit mode: edit both title + body.
    setEditedTitle(memory.title || "");
    setIsEditingTitle(false); // legacy title-only mode; keep off
    setIsEditing(true);
    // Editor content will be set by the useEffect above
  };

  const handleCancelEdit = async () => {
    // If draft, discard it
    if (isDraft) {
      handleDiscardDraft();
      return;
    }
    
    if (!memory) return;
    setEditedTitle(memory.title || "");

    // Reset editor content to original memory content.
    if (editor && memory.summary !== undefined) {
      const parsedDoc = parseMemoryDocJson(memoryDocJson);
      if (parsedDoc) {
        editor.commands.setContent(parsedDoc, false);
      } else {
        const markdown = memory.summary || "";
        Promise.resolve(marked.parse(markdown))
          .then((html) => {
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(typeof html === 'string' ? html : String(html), false);
            }
          })
          .catch((err) => {
            console.error("Error parsing markdown:", err);
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(`<p>${markdown.replace(/\n/g, "<br>")}</p>`, false);
            }
          });
      }
    }
    
    // Blur editor to hide bubble menu before state change
    if (editor) {
      editor.commands.blur();
    }
    
    // Small delay to allow Tippy to clean up
    setTimeout(() => {
      setIsEditing(false);
    }, 100);
  };

  // Handle saving draft (creates new memory)
  const handleSaveDraft = async () => {
    if (!memory || !onSaveDraft) return;

    if (!editor) return;

    const contentTrimmed = serializeEditorMarkdown();
    const docJsonForSave = editor.getJSON();
    
    const trimmedTitle = editedTitle.trim();
    
    try {
      // Call onSaveDraft with folder_id as single source of truth
      const savePayload = {
        title: trimmedTitle || "Untitled",
        summary: contentTrimmed || " ",
        doc_json: docJsonForSave,
        folder_id: draftFolderId ?? (memory as any)?.folder_id ?? null,
        session_id: memory.session_id,
        message_id: memory.message_id,
      } as any;

      await onSaveDraft(savePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    }
  };

  // Handle discarding draft
  const handleDiscardDraft = () => {
    if (onDiscardDraft) {
      onDiscardDraft();
    }
    if (onCloseEmbedded) {
      onCloseEmbedded();
    }
  };

  const handleSaveChanges = async () => {
    // If draft, use draft save handler
    if (isDraft) {
      await handleSaveDraft();
      return;
    }
    
    if (!memory) return;
    
    if (!memory.id) {
      setError("Cannot save: memory has no ID");
      return;
    }

    if (!editor) return;

    const contentTrimmed = serializeEditorMarkdown();
    const docJsonForSave = editor.getJSON();
    
    const trimmedTitle = editedTitle.trim();
    const titleChanged = trimmedTitle !== (memory.title || "");
    const contentChanged = contentTrimmed !== (memory.summary || "");
    const existingDocNormalized = normalizeMemoryDocJson(memoryDocJson);
    const nextDocNormalized = normalizeMemoryDocJson(docJsonForSave);
    const docChanged = nextDocNormalized !== existingDocNormalized;

    if (!titleChanged && !contentChanged && !docChanged) {
      // Blur editor to hide bubble menu before state change
      if (editor) {
        editor.commands.blur();
      }
      // Small delay to allow Tippy to clean up
      setTimeout(() => {
        setIsEditing(false);
      }, 100);
      return;
    }

    try {
      if (contentChanged || docChanged) {
        const summaryToSave = contentTrimmed || " ";
        const response = await fetch("/api/memory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: memory.id,
            summary: summaryToSave,
            doc_json: docJsonForSave,
          }),
        });

        if (!response.ok) {
          let errorMessage = "Failed to save content";
          let errorData: any = null;
          
          try {
            errorData = await response.json();
            if (typeof errorData?.error === "string") {
              errorMessage = errorData.error;
            }
          } catch {
            // If response is not JSON, keep default message
          }
          
          // Handle overflow sessions error
          if (response.status === 409 && errorData?.error === "edit_would_overflow_sessions") {
            const overflowIds = errorData.overflow_session_ids || [];
            const sessionList = overflowIds.join(", ");
            
            const confirmed = window.confirm(
              `This edit will detach the memory from some chats\n\n` +
              `Saving would exceed the 16,384-token attached-memory cap in the chats below. Continue to save and detach?\n\n` +
              `Session IDs: ${sessionList}`
            );
            
            if (confirmed) {
              // Retry with detach flag
              const retryResponse = await fetch("/api/memory", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: memory.id,
                  summary: summaryToSave,
                  doc_json: docJsonForSave,
                  detach_overflow_sessions: true,
                }),
              });
              
              if (!retryResponse.ok) {
                throw new Error("Failed to save with detach");
              }
              
              const retryData = await retryResponse.json();
              const detachedCount = retryData.detached_session_ids?.length || 0;
              
              // Show success message with detach info
              if (detachedCount > 0) {
                setError(`Saved. Detached from ${detachedCount} chat${detachedCount > 1 ? 's' : ''} due to cap.`);
                
                // If this memory was attached to the active session and got detached, refresh
                if (attachedMemoryIds?.includes(memory.id) && 
                    retryData.detached_session_ids?.includes(activeSessionId)) {
                  onRefreshSession?.();
                }
              }
              
              // Clear error after 3 seconds
              setTimeout(() => setError(null), 3000);
            } else {
              // User cancelled, don't save
              return;
            }
          } else {
            throw new Error(errorMessage);
          }
        }
      }

      // Keep the local list in sync (title +/or content)
      await onSave({
        id: memory.id,
        title: trimmedTitle,
        folder_name: memory.folder_name || "Unsorted",
      });

      // Blur editor to hide bubble menu before state change
      if (editor) {
        editor.commands.blur();
      }

      // Small delay to allow Tippy to clean up
      setTimeout(() => {
        setIsEditing(false);
        setError(null);
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    }
  };

  const handleCopy = () => {
    if (!memory) return;
    navigator.clipboard.writeText(memory.summary);
    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 2000);
  };

  const handleDelete = async () => {
    if (!memory) return;
    if (isDraft || memory.id === -1 || memory.id === undefined) {
      onDiscardDraft?.();
      onCloseEmbedded?.();
      return;
    }
    try {
      await onDelete(memory.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleCopyRawMarkdown = () => {
    if (!memory) return;
    navigator.clipboard.writeText(memory.summary);
    setCopied(true);
    setShowPageActionsMenu(false);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 2000);
  };

  const handleExportMarkdown = () => {
    if (!memory) return;
    const blob = new Blob([memory.summary], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(memory.title || "Untitled").replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowPageActionsMenu(false);
  };

  // Compute if this memory is attached to the active session
  const isMemoryAttached = memory && memory.id !== undefined ? attachedMemoryIds.includes(memory.id) : false;
  
  // Check if this memory is injected (pinned)
  const isMemoryInjected = memory && memory.id !== undefined ? 
    attachedMemories.some(m => m.id === memory.id && m.is_pinned === 1) : false;

  const handleAttachMemory = () => {
    if (!memory || memory.id === undefined) return;
    if (isMemoryAttached) {
      // Detach
      onDetachMemory?.(memory.id);
    } else {
      // Attach
      onAttachMemory?.(memory.id);
    }
  };

  if (!memory) {
    return (
      <div className="flex-1 bg-gray-900 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-lg">Select a memory to preview</p>
        </div>
      </div>
    );
  }

  const currentFolderBase = ((isDraft || memory.id === -1) ? (draftFolderName ?? (memory as any)?.folder_name) : memory.folder_name) || "Unsorted";
  const currentFolder = (!isDraft && currentFolderBase !== "Unsorted" && !folderOptions.includes(currentFolderBase))
    ? "Unsorted"
    : currentFolderBase;
  const allFolders = ["Unsorted", ...folderOptions.filter((f) => f !== "Unsorted")];
  const createdDate = memory.created_at ? new Date(memory.created_at) : null;
  const formattedSavedDate =
    createdDate && !Number.isNaN(createdDate.getTime())
      ? createdDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  const messageDate = memory.message_created_at ? new Date(memory.message_created_at) : null;
  const formattedMessageDate =
    messageDate && !Number.isNaN(messageDate.getTime())
      ? messageDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  const isEditingIndicator = isEditing || isEditingExcerpt;

  return (
    <div className={(embedded ? "flex-1 flex flex-col h-full overflow-hidden" : "flex-1 bg-gray-950 flex flex-col h-full overflow-hidden")}>
      <div className={embedded ? "h-full" : "h-full px-4 py-4"}>
        <div
          className={
            embedded
              ? "flex flex-col h-full overflow-hidden"
              : "vault-pane-card rounded-2xl border border-slate-800/70 bg-slate-950/95 shadow-[0_0_40px_rgba(80,120,255,0.35)] flex flex-col h-full overflow-hidden"
          }
        >
          {/* Inspector Header */}
          <div className={embedded ? "px-0 py-2 flex-shrink-0 relative z-30" : "px-6 py-4 border-b border-slate-800/80 flex-shrink-0 relative z-30"}>
            <div className={embedded ? "relative flex flex-col gap-2" : "flex items-start justify-between gap-4"}>
              {/* Row 1 (embedded): back + right actions. (Non-embedded keeps the existing single-row header.) */}
              <div className={embedded ? "flex items-start justify-between gap-4" : ""}>
                {/* Left: Meta */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className={embedded ? "relative w-full h-10 flex items-center" : "flex items-center gap-3 min-w-0"}>
                  {embedded ? (
                    <>
                      {onCloseEmbedded && (
                        <button
                          type="button"
                          onClick={onCloseEmbedded}
                          className={`${iconButtonClass} hover:text-blue-300`}
                          aria-label="Back to chat"
                          title="Back to chat (Esc)"
                        >
                          <svg
                            className="w-5 h-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ transform: "translateY(1px)" }}
                          >
                            <path
                              d="M8 10H8.01"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M12 10H12.01"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M16 10H16.01"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M21 13V7C21 5.11438 21 4.17157 20.4142 3.58579C19.8284 3 18.8856 3 17 3H7C5.11438 3 4.17157 3 3.58579 3.58579C3 4.17157 3 5.11438 3 7V13C3 14.8856 3 15.8284 3.58579 16.4142C4.17157 17 5.11438 17 7 17H7.5C7.77614 17 8 17.2239 8 17.5V20V20.1499C8 20.5037 8.40137 20.7081 8.6875 20.5L13.0956 17.2941C13.3584 17.103 13.675 17 14 17H17C18.8856 17 19.8284 17 20.4142 16.4142C21 15.8284 21 14.8856 21 13Z"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </>
                  ) : !embedded && (
                    <div className="flex items-center gap-3 min-w-0">
                      {isEditing ? (
                        <div className="relative flex-1 min-w-0">
                          <input
                            ref={titleInputRef}
                            type="text"
                            value={editedTitle}
                            onChange={(e) => {
                              setEditedTitle(e.target.value);
                              setHasEditedTitle(true);
                            }}
                            className={`flex-1 w-full bg-gray-800/60 px-2 py-1 rounded-md border border-white/10 focus:outline-none focus:border-white/20 text-base font-semibold min-w-0 transition-colors duration-200 ${(isDraftTitleGenerating || shouldHideGeneratedTitleText) ? "text-transparent" : "text-gray-100"}`}
                            placeholder={isDraftTitleGenerating ? "" : "Memory title..."}
                          />
                          {isDraftTitleGenerating && (
                            <div className="pointer-events-none absolute inset-0 flex items-center px-2 text-base font-semibold text-gray-400">
                              {generatingTitleLabel}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-left text-xl font-semibold text-gray-100 min-w-0 truncate">
                            {memory.title || "Untitled"}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Editing badge is rendered in the centered title overlay for embedded mode (so it can hug the title). */}
                  {!embedded && isEditingIndicator && (
                    <span className="text-[0.65rem] uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1 py-0.5 rounded-full">
                      Edit
                    </span>
                  )}
                </div>
                  {/* Non-embedded: keep folder pill + dates in the header meta row */}
                  {!embedded && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 relative">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative inline-block" ref={folderDropdownRef}>
                        {/* TRIGGER */}
                        <button
                          type="button"
                          onClick={() => setShowFolderDropdown(!showFolderDropdown)}
                          className="inline-flex items-center gap-1 text-[0.75rem] font-medium px-2.5 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-200 hover:border-blue-400/60 hover:text-blue-100 transition-colors"
                        >
                          <span>{currentFolder}</span>
                          <svg
                            className={`w-3 h-3 text-blue-300 transition-transform ${showFolderDropdown ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

	                        {/* MENU */}
	                        {showFolderDropdown && (
	                          <div className="absolute left-0 mt-1 w-[220px] rounded-lg border border-slate-700 bg-slate-900 shadow-lg shadow-black/40 z-50 max-h-48 overflow-y-auto overflow-x-hidden">
	                            {/* Unsorted */}
	                            <button
	                              type="button"
	                              onClick={() => {
                                handleFolderSelect("Unsorted");
                                setShowFolderDropdown(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                                currentFolder === "Unsorted"
                                  ? "bg-slate-800 text-blue-300 font-semibold"
                                  : "text-slate-200 hover:bg-slate-800"
                              }`}
                            >
                              Unsorted
                            </button>

                            {/* Existing folders */}
                            {allFolders.filter((f) => f !== "Unsorted").map((folder) => (
                              <button
                                key={folder}
                                type="button"
                                onClick={() => {
                                  handleFolderSelect(folder);
                                  setShowFolderDropdown(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                                  currentFolder === folder
                                    ? "bg-slate-800 text-blue-300 font-semibold"
                                    : "text-slate-200 hover:bg-slate-800"
                                }`}
                              >
                                {folder}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {formattedSavedDate && (
                        <span className="text-[0.75rem] text-gray-500">
                          Saved: {formattedSavedDate}
                        </span>
                      )}
                      {formattedMessageDate && (
                        <span className="text-[0.75rem] text-gray-500">
                          Message: {formattedMessageDate}
                        </span>
                      )}
                      </div>
                      {/* Right side: 3-dots menu and delete button */}
                      <div className="ml-auto flex items-center gap-2">
                        {/* Three-dot page actions menu */}
                        <div className="relative" ref={pageActionsMenuRef}>
                          <button
                            onClick={() => setShowPageActionsMenu(!showPageActionsMenu)}
                            className={`${iconButtonClass} hover:text-gray-100`}
                            title="Page actions"
                          >
                            <IconDots className="w-4 h-4" />
                          </button>
                          {showPageActionsMenu && (
                            <div className="absolute top-full right-0 mt-1 bg-slate-900 text-gray-100 border border-slate-800 rounded-md shadow-lg shadow-black/40 z-50 min-w-[180px] backdrop-blur-none">
                              <button
                                onClick={handleCopyRawMarkdown}
                                className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-slate-800 transition-colors flex items-center gap-2"
                              >
                                <IconCopy className="w-3 h-3" />
                                Copy raw markdown
                              </button>
                              <button
                                onClick={handleExportMarkdown}
                                className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-slate-800 transition-colors flex items-center gap-2"
                              >
                                <IconFileDownload className="w-3 h-3" />
                                Export markdown
                              </button>
                            </div>
                          )}
                        </div>
                        {/* Delete button */}
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={deleting}
                          className={`${iconButtonClass} hover:text-red-400`}
                          title="Delete memory"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
              </div>

              {/* Right: Icon buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Brain button (only when not editing) */}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={handleAttachMemory}
                    className={`${iconButtonClass} hover:text-gray-100`}
                    aria-label="Attach to chat"
                    title="Attach to chat"
                  >
                    <BrainUsageRing
                      usageRatio={usageRatio}
                      className="w-10 h-10"
                      isAttached={isMemoryAttached}
                      variant="overlay"
                      scaleWithParent={true}
                    />
                  </button>
                )}
                {!isEditing && (
                  <button
                    onClick={handleEditMode}
                    className={`${iconButtonClass} hover:text-blue-300`}
                    title="Edit content"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M6.50959 2C4.01895 2 1.99988 4.01907 1.99988 6.50971V17.4903C1.99988 19.9809 4.01895 22 6.50959 22H11.8499C12.3191 22 12.6994 21.6197 12.6994 21.1505C12.6994 20.6813 12.3191 20.301 11.8499 20.301H6.50959C4.9573 20.301 3.69892 19.0426 3.69892 17.4903V6.50971C3.69892 4.95742 4.9573 3.69904 6.50959 3.69904H17.1902C18.7425 3.69904 20.0008 4.95742 20.0008 6.50971V12C20.0008 12.4692 20.3812 12.8495 20.8504 12.8495C21.3195 12.8495 21.6999 12.4692 21.6999 12V6.50971C21.6999 4.01907 19.6808 2 17.1902 2H6.50959ZM7.00245 11.1503C6.53327 11.1503 6.15293 11.5306 6.15293 11.9998C6.15293 12.469 6.53327 12.8493 7.00245 12.8493H10.0016C10.4708 12.8493 10.8511 12.469 10.8511 11.9998C10.8511 11.5306 10.4708 11.1503 10.0016 11.1503H7.00245ZM6.15293 8.00201C6.15293 7.53283 6.53327 7.15248 7.00245 7.15248H12.9991C13.4683 7.15248 13.8486 7.53283 13.8486 8.00201C13.8486 8.47119 13.4683 8.85153 12.9991 8.85153H7.00245C6.53327 8.85153 6.15293 8.47119 6.15293 8.00201ZM19.4325 13.2912C18.9054 12.7553 18.0508 12.7553 17.5237 13.2912L13.7673 17.1101C13.4779 17.4044 13.3355 17.8162 13.38 18.2297L13.5949 20.2252C13.6508 20.7447 14.0542 21.1549 14.5652 21.2117L16.528 21.4301C16.9348 21.4754 17.3398 21.3306 17.6292 21.0364L21.3856 17.2174C21.9126 16.6815 21.9126 15.8127 21.3856 15.2768L19.4325 13.2912ZM15.0725 18.2059L18.4781 14.7435L19.9571 16.2471L16.5515 19.7095L15.2184 19.5612L15.0725 18.2059Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                )}
                {isEditing && (
                  <>
                    <button
                      onClick={handleSaveChanges}
                      disabled={saving}
                      className={`${iconButtonClass} hover:text-emerald-300`}
                      title={isDraft ? "Save memory" : "Save changes"}
                    >
                      {saving ? (
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M5 13l4 4L19 7"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className={`${iconButtonClass} hover:text-red-400`}
                      title={isDraft ? "Discard draft" : "Cancel editing"}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                          stroke="currentColor"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>

              {/* Embedded: true centered title overlay (independent of the right-side buttons) */}
              {embedded && (
                <div
                  className="pointer-events-none absolute left-0 right-0 top-0 h-10 flex items-center justify-center"
                  aria-hidden={false}
                >
                  <div
                    className="pointer-events-auto w-[min(560px,calc(100%-220px))]"
                    style={{ maxWidth: "calc(100% - 220px)" }}
                  >
                    {isEditing ? (
                      <div className="flex items-center justify-center">
                        <div className="relative w-full">
                          {isEditingIndicator && (
                            <span className="pointer-events-none absolute right-full mr-3 top-1/2 -translate-y-1/2 text-[0.65rem] uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1 py-0.5 rounded-full">
                              Edit
                            </span>
                          )}
                          <input
                            ref={titleInputRef}
                            type="text"
                            value={editedTitle}
                            onChange={(e) => {
                              setEditedTitle(e.target.value);
                              setHasEditedTitle(true);
                            }}
                            className={`w-full bg-transparent px-2 py-1 text-2xl font-semibold text-center focus:outline-none border-b border-white/10 focus:border-white/20 transition-colors duration-200 ${(isDraftTitleGenerating || shouldHideGeneratedTitleText) ? "text-transparent" : "text-gray-100"}`}
                            placeholder={isDraftTitleGenerating ? "" : "Untitled"}
                          />
                          {isDraftTitleGenerating && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-semibold text-gray-400">
                              {generatingTitleLabel}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full flex items-center justify-center">
                        <div className="text-2xl font-semibold text-gray-100 text-center truncate">
                          {memory.title || "Untitled"}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>

              {/* Row 2 (embedded): folder pill centered under the title axis */}
              {embedded && (
                <div className="relative h-8">
                  {/* Center folder pill */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative inline-block" ref={folderDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowFolderDropdown(!showFolderDropdown)}
                        className="inline-flex items-center gap-1 text-[0.75rem] font-medium px-2.5 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-200 hover:border-blue-400/60 hover:text-blue-100 transition-colors"
                      >
                        <span>{currentFolder}</span>
                        <svg
                          className={`w-3 h-3 text-blue-300 transition-transform ${showFolderDropdown ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

	                      {showFolderDropdown && (
	                        <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-[220px] rounded-lg border border-slate-700 bg-slate-900 shadow-lg shadow-black/40 z-50 max-h-48 overflow-y-auto overflow-x-hidden">
	                          {/* Unsorted */}
	                          <button
	                            type="button"
	                            onClick={() => {
                              handleFolderSelect("Unsorted");
                              setShowFolderDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                              currentFolder === "Unsorted"
                                ? "bg-slate-800 text-blue-300 font-semibold"
                                : "text-slate-200 hover:bg-slate-800"
                            }`}
                          >
                            Unsorted
                          </button>

                          {allFolders.filter((f) => f !== "Unsorted").map((folder) => (
                            <button
                              key={folder}
                              type="button"
                              onClick={() => {
                                handleFolderSelect(folder);
                                setShowFolderDropdown(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                                currentFolder === folder
                                  ? "bg-slate-800 text-blue-300 font-semibold"
                                  : "text-slate-200 hover:bg-slate-800"
                              }`}
                            >
                              {folder}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right actions: 3-dots menu and delete button */}
                  <div className="absolute right-0 top-0 h-8 flex items-center gap-2">
                    {/* Three-dot page actions menu */}
                    <div className="relative" ref={pageActionsMenuRef}>
                      <button
                        onClick={() => setShowPageActionsMenu(!showPageActionsMenu)}
                        className={`${iconButtonClass} hover:text-gray-100`}
                        title="Page actions"
                      >
                        <IconDots className="w-4 h-4" />
                      </button>
                      {showPageActionsMenu && (
                        <div className="absolute top-full right-0 mt-1 bg-slate-900 text-gray-100 border border-slate-800 rounded-md shadow-lg shadow-black/40 z-50 min-w-[180px] backdrop-blur-none">
                          <button
                            onClick={handleCopyRawMarkdown}
                            className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-slate-800 transition-colors flex items-center gap-2"
                          >
                            <IconCopy className="w-3 h-3" />
                            Copy raw markdown
                          </button>
                          <button
                            onClick={handleExportMarkdown}
                            className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-slate-800 transition-colors flex items-center gap-2"
                          >
                            <IconFileDownload className="w-3 h-3" />
                            Export markdown
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Delete button */}
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleting}
                      className={`${iconButtonClass} hover:text-red-400`}
                      title="Delete memory"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
            {error && (
              <div className="mt-2 text-red-400 text-xs">{error}</div>
            )}
          </div>

          {/* Inspector body */}
          <div className="flex-1 overflow-hidden">
            <div className={embedded ? "h-full overflow-y-auto px-0 pb-0" : "h-full overflow-y-auto px-6 pb-6"} data-memory-scroll>
              <div className={embedded ? "max-w-none mx-0 space-y-6 pt-4" : "max-w-3xl mx-auto space-y-6 pt-6"}>
                <div className="space-y-4 relative">
                  {/* Preview text is a legacy Vault-only feature; hide it in embedded (/chat) mode */}
                  {!embedded && (
                    <div className="border-b border-slate-700/50 flex-shrink-0 bg-slate-950/80">
                      {/* Preview Header - clickable to toggle */}
                      <button
                        onClick={() => {
                          setIsPreviewOpen(!isPreviewOpen);
                          // Sync editedExcerpt when opening
                          if (!isPreviewOpen && memory) {
                            setEditedExcerpt(memory.excerpt ?? "");
                          }
                        }}
                        className="w-full px-0 py-2 flex items-center justify-between hover:bg-slate-900/30 transition-colors rounded-t"
                      >
                        <span className="uppercase tracking-wide text-[0.7rem] text-slate-500">
                          Preview text (optional)
                        </span>
                        <svg
                          className={`w-4 h-4 text-slate-400 transition-transform ${isPreviewOpen ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Collapsed Preview Snippet */}
                      {!isPreviewOpen && (
                        <div className="w-full pb-2">
                          <p className="text-xs text-slate-400">
                            Preview:{" "}
                            <span className="text-slate-300">
                              {memory?.excerpt && memory.excerpt.trim().length > 0
                                ? (memory.excerpt.length > 240
                                    ? memory.excerpt
                                        .substring(0, 240)
                                        .trim()
                                        .replace(/\s+\S*$/, "") + "…"
                                    : memory.excerpt)
                                : "(empty)"}
                            </span>
                          </p>
                        </div>
                      )}

                      {/* Expanded - just textarea, auto-saves on blur */}
                      {isPreviewOpen && (
                        <div className="pb-4 pt-1">
                          <textarea
                            ref={excerptTextareaRef}
                            value={editedExcerpt}
                            onChange={(e) => setEditedExcerpt(e.target.value)}
                            onBlur={() => {
                              // Auto-save on blur if changed
                              if (memory && editedExcerpt !== (memory.excerpt ?? "")) {
                                handleSaveExcerpt();
                              }
                            }}
                            className="w-full bg-slate-900 text-slate-100 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm resize-none"
                            placeholder="Type a short summary that will show in Vault..."
                            rows={4}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Formatting toolbar */}
                  {isEditing && editor && (() => {
                    const formatButtonClass = (active: boolean) =>
                      `shrink-0 rounded px-1.5 py-[3px] text-[11px] leading-none transition-colors ${
                        active
                          ? "bg-gray-700 text-white"
                          : "text-gray-300 hover:bg-gray-800 hover:text-white"
                      }`;
                    const tableButtonClass =
                      "shrink-0 rounded px-1.5 py-[3px] text-[11px] leading-none text-gray-300 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400";
                    const toolbarShellClass = embedded
                      ? "inline-flex min-w-max items-center gap-1 whitespace-nowrap rounded-lg border border-blue-500/25 bg-transparent px-2 py-1"
                      : "inline-flex items-center gap-2 rounded-xl border border-blue-500/25 bg-transparent px-4 py-2 flex-wrap";

                    const toolbar = (
                      <div className={embedded ? "flex h-full w-full items-center justify-center px-1" : "sticky top-0 z-10 pb-3 bg-transparent -mx-3 px-3"}>
                        <div className={embedded ? "w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex justify-center"}>
                          <div className={toolbarShellClass}>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().undo().run()}
                              disabled={!editor.can().undo()}
                              className={tableButtonClass}
                              title="Undo"
                            >
                              Undo
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().redo().run()}
                              disabled={!editor.can().redo()}
                              className={tableButtonClass}
                              title="Redo"
                            >
                              Redo
                            </button>
                            <div className="mx-0.5 h-4 w-px bg-gray-700" />
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleBold().run()}
                              className={`${formatButtonClass(editor.isActive("bold"))} ${editor.isActive("bold") ? "font-bold" : ""}`}
                              title="Bold"
                            >
                              <strong>B</strong>
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleItalic().run()}
                              className={`${formatButtonClass(editor.isActive("italic"))} ${editor.isActive("italic") ? "italic" : ""}`}
                              title="Italic"
                            >
                              <em>I</em>
                            </button>
                            <div className="mx-0.5 h-4 w-px bg-gray-700" />
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                              className={formatButtonClass(editor.isActive("heading", { level: 1 }))}
                              title="Heading 1"
                            >
                              H1
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                              className={formatButtonClass(editor.isActive("heading", { level: 2 }))}
                              title="Heading 2"
                            >
                              H2
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                              className={formatButtonClass(editor.isActive("heading", { level: 3 }))}
                              title="Heading 3"
                            >
                              H3
                            </button>
                            <select
                              value={lineHeightValue}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value === LINE_HEIGHT_DEFAULT) {
                                  editor.chain().focus().unsetLineHeight().run();
                                  return;
                                }
                                editor.chain().focus().setLineHeight(value as (typeof LINE_HEIGHT_CHOICES)[number]).run();
                              }}
                              className="h-6 shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                              title="Line spacing"
                            >
                              <option value={LINE_HEIGHT_DEFAULT}>Line</option>
                              {LINE_HEIGHT_CHOICES.map((choice) => (
                                <option key={choice} value={choice}>
                                  {choice}
                                </option>
                              ))}
                            </select>
                            <div className="mx-0.5 h-4 w-px bg-gray-700" />
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleBulletList().run()}
                              className={formatButtonClass(editor.isActive("bulletList"))}
                              title="Bullet List"
                            >
                              •
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleOrderedList().run()}
                              className={formatButtonClass(editor.isActive("orderedList"))}
                              title="Numbered List"
                            >
                              1.
                            </button>
                            <div className="mx-0.5 h-4 w-px bg-gray-700" />
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleBlockquote().run()}
                              className={formatButtonClass(editor.isActive("blockquote"))}
                              title="Quote"
                            >
                              ❝
                            </button>
                            <button
                              type="button"
                              onClick={() => editor.chain().focus().toggleCode().run()}
                              className={formatButtonClass(editor.isActive("code"))}
                              title="Inline Code"
                            >
                              {"</>"}
                            </button>
                            <div className="mx-0.5 h-4 w-px bg-gray-700" />
                            <div className="relative" ref={tableInsertPickerRef}>
                              <button
                                ref={tableInsertButtonRef}
                                type="button"
                                onClick={() => {
                                  setShowTableInsertPicker((prev) => !prev);
                                  setTablePickerHover(null);
                                }}
                                disabled={effectiveMaxColumns < 1}
                                className={`${tableButtonClass} ${showTableInsertPicker ? "bg-gray-700 text-white" : ""}`}
                                title="Insert table"
                              >
                                Table
                              </button>
                              {showTableInsertPicker &&
                                typeof document !== "undefined" &&
                                createPortal(
                                  <div
                                    ref={tableInsertPopupRef}
                                    className="fixed rounded-xl border border-slate-700 bg-slate-950 p-2 z-[140] shadow-2xl shadow-black/70 w-max"
                                    style={{
                                      top: tablePickerPosition.top,
                                      left: tablePickerPosition.left,
                                    }}
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
                                            key={`table-grid-${row}-${col}`}
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
                                      Max {effectiveMaxColumns} columns in this width.
                                    </div>
                                  </div>,
                                  document.body
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );

                    if (embedded && toolbarTargetEl) return createPortal(toolbar, toolbarTargetEl);
                    return toolbar;
                  })()}

                  <div className="space-y-2">
                    {!isEditing &&
                      (parsedMemoryDoc && editor ? (
                        <div
                          className={
                            embedded
                              ? "min-h-[420px] relative overflow-y-auto overflow-x-visible"
                              : "rounded-xl border border-gray-800 bg-gray-950/70 shadow-inner min-h-[420px] relative overflow-y-auto overflow-x-visible"
                          }
                        >
                          <div className="memory-editor">
                            <EditorContent editor={editor} />
                          </div>
                        </div>
                      ) : (
                        <MemoryBodyPreview value={memory.summary || ""} noBorder={embedded} />
                      ))}

                    {isEditing && (
                      <div
                        ref={editorContainerRef}
                        className={embedded ? "min-h-[420px] relative overflow-y-auto overflow-x-visible" : "rounded-xl border border-gray-800 bg-gray-950/70 shadow-inner min-h-[420px] relative overflow-y-auto overflow-x-visible"}
                      >
                        {editor && (
                          <div className="memory-editor">
                            <EditorContent editor={editor} />
                          </div>
                        )}
                        {activeTableOverlay && (
                          <div className="pointer-events-none absolute inset-0 z-20">
                            <div
                              className="pointer-events-auto absolute flex items-center"
                              style={{
                                top: Math.max(
                                  8,
                                  activeTableOverlay.top +
                                    activeTableOverlay.height / 2 +
                                    TABLE_OVERLAY_OFFSETS.addColumnY
                                ),
                                left: Math.max(
                                  8,
                                  activeTableOverlay.left +
                                    activeTableOverlay.width +
                                    TABLE_OVERLAY_OFFSETS.addColumnX
                                ),
                                transform: "translate(-50%, -50%)",
                              }}
                            >
                              <div className="pointer-events-auto overflow-hidden rounded-full border border-blue-400/45 bg-slate-900 text-blue-200">
                                <button
                                  type="button"
                                  onClick={addTableColumn}
                                  disabled={!canAddTableColumn}
                                  className="flex h-5 w-5 items-center justify-center border-b border-blue-400/35 text-[12px] leading-none transition-colors hover:bg-blue-600 disabled:opacity-45 disabled:cursor-not-allowed"
                                  title={
                                    canAddTableColumn
                                      ? "Add column"
                                      : "No room to add another column without crossing the right wall."
                                  }
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  onClick={deleteTableColumn}
                                  disabled={!canDeleteTableColumn}
                                  className="flex h-5 w-5 items-center justify-center text-[12px] leading-none transition-colors hover:bg-blue-600 disabled:opacity-45 disabled:cursor-not-allowed"
                                  title={canDeleteTableColumn ? "Delete column" : "Table must keep at least 1 column."}
                                >
                                  -
                                </button>
                              </div>
                            </div>
                            <div
                              className="pointer-events-auto absolute flex items-center"
                              style={{
                                top: Math.max(
                                  8,
                                  activeTableOverlay.top +
                                    activeTableOverlay.height +
                                    TABLE_OVERLAY_OFFSETS.addRowY
                                ),
                                left: Math.max(
                                  8,
                                  activeTableOverlay.left +
                                    activeTableOverlay.width / 2 +
                                    TABLE_OVERLAY_OFFSETS.addRowX
                                ),
                                transform: "translate(-50%, -50%)",
                              }}
                            >
                              <div className="pointer-events-auto flex overflow-hidden rounded-full border border-blue-400/45 bg-slate-900 text-blue-200">
                                <button
                                  type="button"
                                  onClick={addTableRow}
                                  disabled={!canAddTableRow}
                                  className="flex h-5 w-5 items-center justify-center border-r border-blue-400/35 text-[12px] leading-none transition-colors hover:bg-blue-600 disabled:opacity-45 disabled:cursor-not-allowed"
                                  title={canAddTableRow ? `Add row (max ${TABLE_LIMITS.maxRows})` : "Table row limit reached."}
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  onClick={deleteTableRow}
                                  disabled={!canDeleteTableRow}
                                  className="flex h-5 w-5 items-center justify-center text-[12px] leading-none transition-colors hover:bg-blue-600 disabled:opacity-45 disabled:cursor-not-allowed"
                                  title={canDeleteTableRow ? "Delete row" : "Table must keep at least 1 row."}
                                >
                                  -
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal (always centered, above memory overlay) */}
      {showDeleteConfirm &&
        memory &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <div
              className="bg-gray-900 border border-red-500/40 rounded-lg p-4 w-full max-w-sm shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-gray-100 mb-2">
                Delete this memory?
              </h2>
              <p className="text-xs text-gray-400 mb-4">
                &ldquo;{memory.title || "Untitled"}&rdquo; will be permanently removed from the Vault.
                This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await handleDelete();
                    setShowDeleteConfirm(false);
                  }}
                  className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
