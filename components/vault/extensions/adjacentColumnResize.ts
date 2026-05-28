import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type ViewMutationRecord } from "@tiptap/pm/view";
import { TableMap, cellAround, pointsAtCell } from "@tiptap/pm/tables";

type DraggingState = {
  pairTotalWidth: number;
  leftCol: number;
  rightCol: number;
  columnWidths: number[];
  leftEdgeOfLeftCol: number;
  isRightEdge: boolean;
  originalTableLayout: string;
};

class ResizeState {
  activeHandle: number;
  activeRightEdge: boolean;
  dragging: DraggingState | false;

  constructor(activeHandle: number, dragging: DraggingState | false, activeRightEdge = false) {
    this.activeHandle = activeHandle;
    this.activeRightEdge = activeRightEdge;
    this.dragging = dragging;
  }

  apply(tr: Transaction): ResizeState {
    const action = tr.getMeta(adjacentColumnResizePluginKey) as
      | { setHandle?: number; setDragging?: DraggingState | false | null; setRightEdge?: boolean }
      | undefined;

    if (action && action.setHandle !== undefined) {
      return new ResizeState(action.setHandle, false, action.setRightEdge ?? false);
    }

    if (action && action.setDragging !== undefined) {
      return new ResizeState(this.activeHandle, action.setDragging || false, this.activeRightEdge);
    }

    if (this.activeHandle > -1 && tr.docChanged) {
      let handle = tr.mapping.map(this.activeHandle, -1);
      if (!pointsAtCell(tr.doc.resolve(handle))) {
        handle = -1;
      }
      return new ResizeState(handle, this.dragging, handle === -1 ? false : this.activeRightEdge);
    }

    return this;
  }
}

const adjacentColumnResizePluginKey = new PluginKey<ResizeState>("adjacentColumnResize");

type AdjacentColumnResizeOptions = {
  handleWidth: number;
  cellMinWidth: number;
  lastColumnResizable: boolean;
  rightBoundaryInsetPx: number;
};

function getScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    const overflowX = style.overflowX;
    if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function getResizeContainer(tableDom: HTMLTableElement): HTMLElement {
  const wrapper = tableDom.closest(".tableWrapper");
  if (wrapper instanceof HTMLElement) return wrapper;
  const scrollParent = getScrollParent(tableDom);
  if (scrollParent) return scrollParent;
  if (tableDom.parentElement instanceof HTMLElement) return tableDom.parentElement;
  return tableDom;
}

function domCellAround(target: EventTarget | null): HTMLElement | null {
  let current = target as HTMLElement | null;
  while (current && current.nodeName !== "TD" && current.nodeName !== "TH") {
    if (current.classList?.contains("ProseMirror")) return null;
    current = current.parentElement;
  }
  return current;
}

function edgeCell(
  view: EditorView,
  event: MouseEvent,
  side: "left" | "right",
  handleWidth: number
): number {
  const offset = side === "right" ? -handleWidth : handleWidth;
  const found = view.posAtCoords({ left: event.clientX + offset, top: event.clientY });
  if (!found) return -1;

  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;

  if (side === "right") {
    return $cell.pos;
  }

  const map = TableMap.get($cell.node(-1));
  const start = $cell.start(-1);
  const index = map.map.indexOf($cell.pos - start);
  return index % map.width === 0 ? -1 : start + map.map[index - 1];
}

function updateHandle(view: EditorView, value: number, rightEdge = false): void {
  view.dispatch(
    view.state.tr.setMeta(adjacentColumnResizePluginKey, { setHandle: value, setRightEdge: rightEdge })
  );
}

type TableContext = {
  table: any;
  map: TableMap;
  tableStart: number;
  leftCol: number;
  rightCol: number;
  tableDom: HTMLTableElement;
  colEls: HTMLCollection;
  isRightEdge: boolean;
};

function getTableContext(view: EditorView, cellPos: number): TableContext | null {
  const $cell = view.state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const leftCol = map.colCount($cell.pos - tableStart) + $cell.nodeAfter!.attrs.colspan - 1;
  const rightCol = leftCol + 1;
  if (rightCol >= map.width) return null;

  let dom: Node | null = view.domAtPos($cell.start(-1)).node;
  while (dom && (dom as HTMLElement).nodeName !== "TABLE") {
    dom = dom.parentNode;
  }
  if (!dom) return null;
  const tableDom = dom as HTMLTableElement;
  const colgroup = tableDom.querySelector("colgroup");
  if (!colgroup) return null;

  return {
    table,
    map,
    tableStart,
    leftCol,
    rightCol,
    tableDom,
    colEls: colgroup.children,
    isRightEdge: false,
  };
}

function getRightEdgeContext(view: EditorView, cellPos: number): TableContext | null {
  const $cell = view.state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const leftCol = map.colCount($cell.pos - tableStart) + $cell.nodeAfter!.attrs.colspan - 1;
  if (leftCol !== map.width - 1) return null;

  let dom: Node | null = view.domAtPos($cell.start(-1)).node;
  while (dom && (dom as HTMLElement).nodeName !== "TABLE") {
    dom = dom.parentNode;
  }
  if (!dom) return null;
  const tableDom = dom as HTMLTableElement;
  const colgroup = tableDom.querySelector("colgroup");
  if (!colgroup) return null;

  return {
    table,
    map,
    tableStart,
    leftCol,
    rightCol: leftCol,
    tableDom,
    colEls: colgroup.children,
    isRightEdge: true,
  };
}

function readColumnWidth(colEls: HTMLCollection, colIndex: number, fallback: number): number {
  const colEl = colEls.item(colIndex) as HTMLElement | null;
  if (!colEl) return fallback;
  const fromStyle = parseFloat(colEl.style.width || "");
  if (Number.isFinite(fromStyle) && fromStyle > 0) return fromStyle;
  const fromRect = colEl.getBoundingClientRect().width;
  if (Number.isFinite(fromRect) && fromRect > 0) return fromRect;
  return fallback;
}

function readRenderedColumnWidths(
  tableDom: HTMLTableElement,
  colEls: HTMLCollection,
  colCount: number,
  fallback: number
): number[] {
  const fromCols: number[] = [];
  for (let i = 0; i < colCount; i += 1) {
    const colEl = colEls.item(i) as HTMLElement | null;
    const width = colEl?.getBoundingClientRect().width || 0;
    fromCols.push(width);
  }
  const hasReliableCols =
    fromCols.length === colCount &&
    fromCols.every((value) => Number.isFinite(value) && value > 0.5);
  if (hasReliableCols) {
    return fromCols;
  }

  const measured = new Array(colCount).fill(0);
  const firstRow = tableDom.querySelector("tr");

  if (firstRow) {
    let col = 0;
    const cells = Array.from(firstRow.children).filter(
      (node) => node.nodeName === "TH" || node.nodeName === "TD"
    ) as HTMLElement[];

    for (const cell of cells) {
      if (col >= colCount) break;
      const colspan = Math.max(1, Number(cell.getAttribute("colspan") || "1"));
      const width = cell.getBoundingClientRect().width;
      const perCol = colspan > 0 ? width / colspan : width;
      for (let i = 0; i < colspan && col < colCount; i += 1, col += 1) {
        measured[col] = perCol;
      }
    }
  }

  return measured.map((value) => (Number.isFinite(value) && value > 0 ? value : fallback));
}

function setNodeColumnWidth(
  tr: Transaction,
  table: any,
  map: TableMap,
  tableStart: number,
  columnIndex: number,
  nextWidth: number
): void {
  for (let row = 0; row < map.height; row += 1) {
    const mapIndex = row * map.width + columnIndex;
    if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;

    const cellPos = map.map[mapIndex];
    const cell = table.nodeAt(cellPos);
    if (!cell) continue;

    const attrs = cell.attrs as { colspan: number; colwidth?: number[] | null };
    const startCol = map.colCount(cellPos);
    const widthIndex = attrs.colspan === 1 ? 0 : columnIndex - startCol;
    if (widthIndex < 0 || widthIndex >= attrs.colspan) continue;

    const colwidth = attrs.colwidth ? attrs.colwidth.slice() : new Array(attrs.colspan).fill(0);
    if (colwidth[widthIndex] === nextWidth) continue;

    colwidth[widthIndex] = nextWidth;
    tr.setNodeMarkup(tableStart + cellPos, undefined, {
      ...attrs,
      colwidth,
    });
  }
}

function applyColumnPairToDom(
  tableDom: HTMLTableElement,
  colEls: HTMLCollection,
  widths: number[]
): void {
  const colLen = Math.min(colEls.length, widths.length);
  if (colLen === 0) return;

  for (let i = 0; i < colLen; i += 1) {
    const colEl = colEls.item(i) as HTMLElement | null;
    if (!colEl) continue;
    colEl.style.width = `${Math.max(1, widths[i])}px`;
  }

  const total = widths.slice(0, colLen).reduce((sum, width) => sum + Math.max(1, width), 0);
  tableDom.style.width = `${total}px`;
  tableDom.style.minWidth = "";
}

function computeNextWidths(
  dragging: DraggingState,
  cursorX: number,
  containerLeft: number,
  scrollLeft: number,
  containerRight: number,
  minWidth: number
): number[] {
  const cursorInContent = cursorX - containerLeft + scrollLeft;
  let nextLeft = cursorInContent - dragging.leftEdgeOfLeftCol;

  nextLeft = Math.max(minWidth, Math.min(dragging.pairTotalWidth - minWidth, nextLeft));
  const nextRight = dragging.pairTotalWidth - nextLeft;

  const maxLeftEdge = containerRight - containerLeft - nextRight;
  const clampedLeft = Math.min(nextLeft, maxLeftEdge - dragging.leftEdgeOfLeftCol);
  const clampedRight = dragging.pairTotalWidth - clampedLeft;
  const boundedLeft = clampedRight < minWidth ? nextLeft : clampedLeft;

  const nextWidths = dragging.columnWidths.slice();
  nextWidths[dragging.leftCol] = boundedLeft;
  nextWidths[dragging.rightCol] = dragging.pairTotalWidth - boundedLeft;
  return nextWidths;
}

function computeRightEdgeWidths(
  dragging: DraggingState,
  cursorX: number,
  containerLeft: number,
  scrollLeft: number,
  containerRight: number,
  minWidth: number
): number[] {
  const cursorInContent = cursorX - containerLeft + scrollLeft;
  let nextLast = cursorInContent - dragging.leftEdgeOfLeftCol;
  nextLast = Math.max(minWidth, nextLast);
  const maxTableRight = containerRight - containerLeft;
  const maxLast = Math.max(minWidth, maxTableRight - dragging.leftEdgeOfLeftCol);
  nextLast = Math.min(nextLast, maxLast);

  const nextWidths = dragging.columnWidths.slice();
  nextWidths[dragging.leftCol] = nextLast;
  return nextWidths;
}

function handleMouseMove(
  view: EditorView,
  event: MouseEvent,
  options: AdjacentColumnResizeOptions
): void {
  if (!view.editable) return;
  const pluginState = adjacentColumnResizePluginKey.getState(view.state);
  if (!pluginState || pluginState.dragging) return;

  const target = domCellAround(event.target);
  let cell = -1;
  let rightEdge = false;

  if (target) {
    const { left, right } = target.getBoundingClientRect();
    if (event.clientX - left <= options.handleWidth) {
      cell = edgeCell(view, event, "left", options.handleWidth);
    } else if (right - event.clientX <= options.handleWidth) {
      cell = edgeCell(view, event, "right", options.handleWidth);
    }
  }

  if (cell !== -1) {
    const context = getTableContext(view, cell);
    if (context) {
      rightEdge = false;
    } else if (options.lastColumnResizable && getRightEdgeContext(view, cell)) {
      rightEdge = true;
    } else {
      cell = -1;
    }
  }

  if (cell !== pluginState.activeHandle || rightEdge !== pluginState.activeRightEdge) {
    updateHandle(view, cell, rightEdge);
  }
}

function handleMouseLeave(view: EditorView): void {
  if (!view.editable) return;
  const pluginState = adjacentColumnResizePluginKey.getState(view.state);
  if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) {
    updateHandle(view, -1);
  }
}

function handleMouseDown(
  view: EditorView,
  event: MouseEvent,
  options: AdjacentColumnResizeOptions
): boolean {
  if (!view.editable) return false;
  const pluginState = adjacentColumnResizePluginKey.getState(view.state);
  if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) return false;

  const context = pluginState.activeRightEdge
    ? getRightEdgeContext(view, pluginState.activeHandle)
    : getTableContext(view, pluginState.activeHandle);
  if (!context) return false;

  const leftStartWidth = readColumnWidth(context.colEls, context.leftCol, options.cellMinWidth);
  const rightStartWidth = context.isRightEdge
    ? 0
    : readColumnWidth(context.colEls, context.rightCol, options.cellMinWidth);
  const columnWidths = readRenderedColumnWidths(
    context.tableDom,
    context.colEls,
    context.map.width,
    options.cellMinWidth
  );
  const pairTotalWidth = context.isRightEdge
    ? Math.max(options.cellMinWidth, columnWidths[context.leftCol] || leftStartWidth)
    : Math.max(
        options.cellMinWidth * 2,
        (columnWidths[context.leftCol] || leftStartWidth) + (columnWidths[context.rightCol] || rightStartWidth)
      );
  const leftEdgeOfLeftCol = columnWidths.slice(0, context.leftCol).reduce((sum, width) => sum + width, 0);

  const draggingState: DraggingState = {
    pairTotalWidth,
    leftCol: context.leftCol,
    rightCol: context.rightCol,
    columnWidths,
    leftEdgeOfLeftCol,
    isRightEdge: context.isRightEdge,
    originalTableLayout: context.tableDom.style.tableLayout || "",
  };

  const dragTableDom = context.tableDom;
  const dragColEls = context.colEls;
  dragTableDom.style.tableLayout = "fixed";
  applyColumnPairToDom(dragTableDom, dragColEls, columnWidths);

  view.dispatch(view.state.tr.setMeta(adjacentColumnResizePluginKey, { setDragging: draggingState }));

  const win = view.dom.ownerDocument.defaultView ?? window;
  let lastClientX = event.clientX;

  const move = (moveEvent: MouseEvent) => {
    const state = adjacentColumnResizePluginKey.getState(view.state);
    if (!state?.dragging) return;
    lastClientX = moveEvent.clientX;

    const container = getResizeContainer(dragTableDom);
    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft ?? 0;
    const rightBoundary = containerRect.right - Math.max(0, options.rightBoundaryInsetPx || 0);
    const nextWidths = state.dragging.isRightEdge
      ? computeRightEdgeWidths(
          state.dragging,
          moveEvent.clientX,
          containerRect.left,
          scrollLeft,
          rightBoundary,
          options.cellMinWidth
        )
      : computeNextWidths(
          state.dragging,
          moveEvent.clientX,
          containerRect.left,
          scrollLeft,
          rightBoundary,
          options.cellMinWidth
        );
    applyColumnPairToDom(dragTableDom, dragColEls, nextWidths);
    moveEvent.preventDefault();
  };

  const finish = (upEvent: MouseEvent) => {
    win.removeEventListener("mousemove", move);
    win.removeEventListener("mouseup", finish);

    const state = adjacentColumnResizePluginKey.getState(view.state);
    if (!state?.dragging) return;

    const container = getResizeContainer(dragTableDom);
    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft ?? 0;
    const rightBoundary = containerRect.right - Math.max(0, options.rightBoundaryInsetPx || 0);
    const pointerX = Number.isFinite(upEvent.clientX) ? upEvent.clientX : lastClientX;
    const nextWidths = state.dragging.isRightEdge
      ? computeRightEdgeWidths(
          state.dragging,
          pointerX,
          containerRect.left,
          scrollLeft,
          rightBoundary,
          options.cellMinWidth
        )
      : computeNextWidths(
          state.dragging,
          pointerX,
          containerRect.left,
          scrollLeft,
          rightBoundary,
          options.cellMinWidth
        );
    applyColumnPairToDom(dragTableDom, dragColEls, nextWidths);

    const freshContext = state.dragging.isRightEdge
      ? getRightEdgeContext(view, state.activeHandle) ?? getRightEdgeContext(view, pluginState.activeHandle)
      : getTableContext(view, state.activeHandle) ?? getTableContext(view, pluginState.activeHandle);
    if (!freshContext) {
      dragTableDom.style.tableLayout = state.dragging.originalTableLayout || "";
      view.dispatch(view.state.tr.setMeta(adjacentColumnResizePluginKey, { setDragging: false }));
      return;
    }

    const tr = view.state.tr;
    for (let col = 0; col < freshContext.map.width; col += 1) {
      const targetWidth = Math.max(options.cellMinWidth, Math.round(nextWidths[col] || options.cellMinWidth));
      setNodeColumnWidth(
        tr,
        freshContext.table,
        freshContext.map,
        freshContext.tableStart,
        col,
        targetWidth
      );
    }

    if (tr.docChanged) {
      view.dispatch(tr);
    }

    dragTableDom.style.tableLayout = state.dragging.originalTableLayout || "";
    view.dispatch(view.state.tr.setMeta(adjacentColumnResizePluginKey, { setDragging: false }));
  };

  win.addEventListener("mousemove", move);
  win.addEventListener("mouseup", finish);
  event.preventDefault();
  return true;
}

function handleDecorations(
  state: EditorState,
  cellPos: number,
  isDragging: boolean,
  isRightEdge: boolean
): DecorationSet {
  const decorations: Decoration[] = [];
  const $cell = state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const col = map.colCount($cell.pos - start) + $cell.nodeAfter!.attrs.colspan - 1;

  if (col >= map.width - 1 && !isRightEdge) {
    return DecorationSet.empty;
  }

  for (let row = 0; row < map.height; row += 1) {
    const index = col + row * map.width;
    const isRightBoundaryOfCell = col === map.width - 1 || map.map[index] !== map.map[index + 1];
    const isTopBoundaryOfCell = row === 0 || map.map[index] !== map.map[index - map.width];
    if (!isRightBoundaryOfCell || !isTopBoundaryOfCell) continue;

    const cellOffset = map.map[index];
    const node = table.nodeAt(cellOffset);
    if (!node) continue;
    const pos = start + cellOffset + node.nodeSize - 1;
    const handle = document.createElement("div");
    handle.className = `column-resize-handle${isDragging ? " column-resize-handle-dragging" : ""}`;
    decorations.push(Decoration.widget(pos, handle));
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Lightweight NodeView for <table> that always renders a <colgroup>.
 * Without this, TipTap's Table extension (resizable: false) skips <colgroup>,
 * which breaks column-resize detection and width management.
 */
class SimpleTableView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLElement;
  contentDOM: HTMLElement;
  private cellMinWidth: number;

  constructor(node: any, cellMinWidth: number) {
    this.cellMinWidth = cellMinWidth;

    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";

    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.updateColumns(node);

    const tbody = this.table.appendChild(document.createElement("tbody"));
    this.contentDOM = tbody;
  }

  update(node: any): boolean {
    if (node.type.name !== "table") return false;
    this.updateColumns(node);
    return true;
  }

  updateColumns(node: any): void {
    const firstRow = node.childCount > 0 ? node.child(0) : null;
    if (!firstRow) return;

    const widths: number[] = [];
    for (let i = 0; i < firstRow.childCount; i++) {
      const cell = firstRow.child(i);
      const colspan = cell.attrs.colspan || 1;
      const colwidth: number[] | null = cell.attrs.colwidth;
      for (let j = 0; j < colspan; j++) {
        widths.push(colwidth?.[j] || 0);
      }
    }

    while (this.colgroup.children.length > widths.length) {
      this.colgroup.removeChild(this.colgroup.lastChild!);
    }
    while (this.colgroup.children.length < widths.length) {
      this.colgroup.appendChild(document.createElement("col"));
    }

    const hasExplicitWidths = widths.some((w) => w > 0);

    if (hasExplicitWidths) {
      let totalWidth = 0;
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i] || this.cellMinWidth;
        (this.colgroup.children[i] as HTMLElement).style.width = `${w}px`;
        totalWidth += w;
      }
      this.table.style.width = `${totalWidth}px`;
      this.table.style.minWidth = "";
      this.table.style.tableLayout = "fixed";
    } else {
      for (let i = 0; i < widths.length; i++) {
        (this.colgroup.children[i] as HTMLElement).style.width = "";
      }
      this.table.style.width = "";
      this.table.style.minWidth = "";
      this.table.style.tableLayout = "";
    }
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    if (record.type === "selection") {
      return false;
    }
    return (
      record.type === "attributes" &&
      (record.target === this.table ||
        record.target === this.colgroup ||
        (record.target as Node).parentNode === this.colgroup)
    );
  }
}

function createAdjacentColumnResizePlugin(options: AdjacentColumnResizeOptions): Plugin {
  return new Plugin({
    key: adjacentColumnResizePluginKey,
    state: {
      init: () => new ResizeState(-1, false, false),
      apply: (tr, prev) => prev.apply(tr),
    },
    props: {
      attributes: (state): Record<string, string> => {
        const pluginState = adjacentColumnResizePluginKey.getState(state);
        return pluginState && pluginState.activeHandle > -1 ? { class: "resize-cursor" } : {};
      },
      handleDOMEvents: {
        mousemove: (view, event) => {
          handleMouseMove(view, event, options);
          return false;
        },
        mouseleave: (view) => {
          handleMouseLeave(view);
          return false;
        },
        mousedown: (view, event) => {
          return handleMouseDown(view, event, options);
        },
      },
      decorations: (state) => {
        const pluginState = adjacentColumnResizePluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) {
          return handleDecorations(
            state,
            pluginState.activeHandle,
            !!pluginState.dragging,
            !!pluginState.activeRightEdge
          );
        }
        return null;
      },
      nodeViews: {
        table(node: any) {
          return new SimpleTableView(node, options.cellMinWidth);
        },
      },
    },
  });
}

export const AdjacentColumnResize = Extension.create<AdjacentColumnResizeOptions>({
  name: "adjacentColumnResize",

  addOptions() {
    return {
      handleWidth: 8,
      cellMinWidth: 92,
      lastColumnResizable: false,
      rightBoundaryInsetPx: 0,
    };
  },

  addProseMirrorPlugins() {
    return [createAdjacentColumnResizePlugin(this.options)];
  },
});
