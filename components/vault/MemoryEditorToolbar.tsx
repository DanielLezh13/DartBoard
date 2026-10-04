"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold, ChevronLeft, ChevronRight, Code2, Italic, List, ListOrdered,
  Minus, Quote, Redo2, RemoveFormatting, Strikethrough, Undo2,
} from "lucide-react";
import {
  getEditorLineHeight, LINE_HEIGHT_CHOICES, LINE_HEIGHT_DEFAULT,
} from "./extensions/lineHeight";

export const memoryToolbarButtonClass =
  "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs transition-colors hover:bg-slate-700/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";

function ToolButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keep the document selection when a pointer moves from text to a tool.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`${memoryToolbarButtonClass} ${active ? "bg-blue-500/20 text-blue-200 ring-1 ring-inset ring-blue-400/30" : "text-slate-300"}`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-slate-700/70" />;
}

export default function MemoryEditorToolbar({ editor, tableControl, embedded = false }: {
  editor: Editor;
  tableControl: ReactNode;
  embedded?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      undo: current.can().undo(),
      redo: current.can().redo(),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      quote: current.isActive("blockquote"),
      code: current.isActive("code"),
      style: current.isActive("codeBlock") ? "codeBlock" :
        [1, 2, 3].find((level) => current.isActive("heading", { level }))?.toString() ?? "paragraph",
      lineHeight: getEditorLineHeight(current),
    }),
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const sync = () => setOverflow({
      left: element.scrollLeft > 1,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    });
    sync();
    element.addEventListener("scroll", sync);
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  const selectClass = "h-7 shrink-0 rounded-md border border-slate-700/60 bg-slate-900 px-1.5 text-xs text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

  return (
    <div className={embedded ? "flex h-full w-full min-w-0 items-center" : "sticky top-0 z-10 pb-3"}>
      <div className="flex w-full min-w-0 items-center rounded-lg border border-slate-700/60 bg-slate-900/80 px-1 py-1">
        {overflow.left && <ToolButton label="Scroll formatting controls left" onClick={() => scrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}><ChevronLeft size={14} /></ToolButton>}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div role="group" aria-label="Memory formatting" className="flex w-max min-w-full items-center justify-center gap-0.5 whitespace-nowrap">
            <ToolButton label="Undo" shortcut="⌘/Ctrl+Z" disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolButton>
            <ToolButton label="Redo" shortcut="⌘/Ctrl+Shift+Z" disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolButton>
            <Separator />
            <select
              aria-label="Text style"
              title="Text style"
              value={state.style}
              className={`${selectClass} w-[100px]`}
              onChange={(event) => {
                const value = event.target.value;
                const chain = editor.chain().focus();
                if (value === "paragraph") chain.setParagraph().run();
                else if (value === "codeBlock") chain.setCodeBlock().run();
                else chain.setHeading({ level: Number(value) as 1 | 2 | 3 }).run();
              }}
            >
              <option value="paragraph">Text</option>
              <option value="1">Heading 1</option>
              <option value="2">Heading 2</option>
              <option value="3">Heading 3</option>
              <option value="codeBlock">Code block</option>
            </select>
            <Separator />
            <ToolButton label="Bold" shortcut="⌘/Ctrl+B" active={state.bold} disabled={!editor.can().toggleBold()} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolButton>
            <ToolButton label="Italic" shortcut="⌘/Ctrl+I" active={state.italic} disabled={!editor.can().toggleItalic()} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolButton>
            <ToolButton label="Strikethrough" shortcut="⌘/Ctrl+Shift+S" active={state.strike} disabled={!editor.can().toggleStrike()} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></ToolButton>
            <Separator />
            <ToolButton label="Bullet list" active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolButton>
            <ToolButton label="Numbered list" active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
            <ToolButton label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolButton>
            <ToolButton label="Inline code" shortcut="⌘/Ctrl+E" active={state.code} disabled={!editor.can().toggleCode()} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 size={16} /></ToolButton>
            <Separator />
            <select
              aria-label="Line spacing"
              title={state.style === "codeBlock" ? "Code blocks use fixed line spacing" : "Line spacing"}
              value={state.lineHeight}
              disabled={state.style === "codeBlock"}
              className={selectClass}
              onChange={(event) => {
                const value = event.target.value;
                if (value === LINE_HEIGHT_DEFAULT) editor.chain().focus().unsetLineHeight().run();
                else editor.chain().focus().setLineHeight(value as (typeof LINE_HEIGHT_CHOICES)[number]).run();
              }}
            >
              <option value={LINE_HEIGHT_DEFAULT}>Spacing</option>
              {LINE_HEIGHT_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}×</option>)}
            </select>
            {tableControl}
            <ToolButton label="Insert divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={16} /></ToolButton>
            <Separator />
            <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().unsetLineHeight().run()}><RemoveFormatting size={16} /></ToolButton>
          </div>
        </div>
        {overflow.right && <ToolButton label="Scroll formatting controls right" onClick={() => scrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}><ChevronRight size={14} /></ToolButton>}
      </div>
    </div>
  );
}
