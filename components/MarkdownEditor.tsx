"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import Code from "@tiptap/extension-code";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { LineHeight } from "@/components/vault/extensions/lineHeight";
import { marked } from "marked";
import { useEffect } from "react";
import { parseMemoryDocJson } from "@/lib/memoryDoc";

// Configure marked for synchronous parsing
marked.setOptions({
  breaks: false,
  gfm: true,
});

interface MarkdownEditorProps {
  value: string;
  docJsonValue?: unknown; // Optional TipTap JSON doc to preserve rich structure in preview paths
  onChange: (value: string) => void;
  onBlur?: () => void;
  minRows?: number;
  className?: string;
  editorKey?: string | number; // Key to force editor recreation
  hideEditorBorder?: boolean; // If true, remove border/background from editor content div
  noWrapper?: boolean; // If true, don't wrap in outer div (for VaultModal to avoid third bubble)
  noToolbar?: boolean; // If true, don't render toolbar (for VaultModal to render it separately)
  onEditorReady?: (editor: any) => void; // Callback to expose editor instance
  onDocJsonChange?: (docJson: unknown) => void; // Callback to expose current TipTap JSON doc
  readOnly?: boolean;
}

/**
 * Shared markdown editor component with toolbar.
 * Used in both Vault and Archive for consistent editing experience.
 */
export default function MarkdownEditor({
  value,
  docJsonValue,
  onChange,
  onBlur,
  minRows = 10,
  className = "",
  editorKey,
  hideEditorBorder = false,
  noWrapper = false,
  noToolbar = false,
  onEditorReady,
  onDocJsonChange,
  readOnly = false,
}: MarkdownEditorProps) {
  const editor = useEditor(
    {
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
        Code,
        HorizontalRule,
        LineHeight,
        Table.configure({
          resizable: true,
          renderWrapper: true,
          handleWidth: 8,
          cellMinWidth: 80,
          lastColumnResizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: "",
      editable: !readOnly,
      editorProps: {
        attributes: {
          class:
            "ProseMirror memory-preview-markdown prose prose-invert prose-sm max-w-none w-full min-h-[420px] px-6 py-5 text-sm leading-relaxed focus:outline-none bg-transparent border-0",
        },
      },
      immediatelyRender: false,
      onUpdate: ({ editor }) => {
        if (readOnly) return;
        const html = editor.getHTML();
        // Pass HTML to parent - parent will convert to markdown using TurndownService
        onChange(html);
        if (onDocJsonChange) {
          onDocJsonChange(editor.getJSON());
        }
      },
      onBlur: onBlur,
    },
    [editorKey]
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Sync editor content when value changes externally
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const parsedDoc = parseMemoryDocJson(docJsonValue);
    if (parsedDoc) {
      editor.commands.setContent(parsedDoc, false);
      return;
    }
    
    if (!value || value.trim() === "") {
      editor.commands.setContent("<p></p>", false);
      return;
    }

    // If value is already HTML, use it directly
    if (value.startsWith("<")) {
      editor.commands.setContent(value, false);
      return;
    }

    // If value is markdown, parse it to HTML
    Promise.resolve(marked.parse(value))
      .then((html) => {
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(typeof html === "string" ? html : String(html), false);
        }
      })
      .catch((err) => {
        console.error("Error parsing markdown:", err);
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(`<p>${value.replace(/\n/g, "<br>")}</p>`, false);
        }
      });
  }, [editor, value, docJsonValue, editorKey]);

  // Expose editor instance to parent if callback provided
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    };
  }, [editor]);

  if (!editor) {
    return <div className="text-gray-400 text-sm">Loading editor...</div>;
  }

  const toolbar = (
    <div className="sticky top-0 z-20 mb-3 flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/90 px-2 py-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("bold")
              ? "bg-gray-700 text-white font-bold"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("italic")
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
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("heading", { level: 1 })
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("heading", { level: 2 })
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("heading", { level: 3 })
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Heading 3"
        >
          H3
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("bulletList")
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Bullet List"
        >
          •
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("orderedList")
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
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("blockquote")
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Quote"
        >
          ❝
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            editor.isActive("code")
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-800 hover:text-white"
          }`}
          title="Inline Code"
        >
          {"</>"}
        </button>
      </div>
  );

  const editorContent = (
    <div className={hideEditorBorder ? "min-h-[420px] relative bg-transparent border-0" : "rounded-xl border border-gray-800 bg-gray-950/70 shadow-inner min-h-[420px] relative"}>
      <div className="memory-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );

  if (noWrapper) {
    return (
      <div className={`markdown-editor-root ${className || ""}`}>
        {!noToolbar && toolbar}
        {editorContent}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {!noToolbar && toolbar}
      {editorContent}
    </div>
  );
}
