"use client"

import React, { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from "react"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import type { SidebarSession } from "@/hooks/useChatSessions"

function NeonLineBar({ progress }: { progress: number | null }) {
  // progress: null => unknown/loading (render empty track, no preview fill)
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress))

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className={
          "relative h-[8px] flex-1 min-w-0 overflow-hidden rounded-full " +
          (pct == null
            ? "bg-slate-900/60 ring-1 ring-slate-700/40"
            : "bg-slate-900/60 ring-1 ring-slate-700/40")
        }
      >
        {/* Determinate fill (slides smoothly). */}
        {pct != null && (
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{
              width: `${pct}%`,
              transition: "width 900ms cubic-bezier(0.2, 0.9, 0.2, 1)",
              background:
                "linear-gradient(90deg, rgba(56,189,248,0.85) 0%, rgba(99,102,241,0.9) 100%)",
              boxShadow:
                "0 0 10px rgba(56,189,248,0.25), 0 0 16px rgba(99,102,241,0.18)",
            }}
          />
        )}

        {/* Subtle inner sheen so the track isn't flat */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.08) 100%)",
            opacity: 0.55,
          }}
        />
      </div>

      {/* Percentage label (only when known) */}
      <div className="w-[42px] flex-shrink-0 text-right text-[10px] tabular-nums text-slate-300/80">
        {pct == null ? "" : `${pct}%`}
      </div>
    </div>
  )
}

function HeaderUsageBar({ progress }: { progress: number | null }) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress))

  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="relative h-[6px] w-[96px] overflow-hidden rounded-full bg-slate-900/60 ring-1 ring-slate-700/40">
        {pct != null && (
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{
              width: `${pct}%`,
              transition: "width 900ms cubic-bezier(0.2, 0.9, 0.2, 1)",
              background:
                "linear-gradient(90deg, rgba(56,189,248,0.85) 0%, rgba(99,102,241,0.9) 100%)",
              boxShadow:
                "0 0 10px rgba(56,189,248,0.25), 0 0 16px rgba(99,102,241,0.18)",
            }}
          />
        )}

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.08) 100%)",
            opacity: 0.55,
          }}
        />
      </div>

      <div className="w-[28px] flex-shrink-0 text-right text-[10px] tabular-nums text-slate-300/80">
        {pct == null ? "" : `${pct}%`}
      </div>
    </div>
  )
}

// Use SidebarSession type from useChatSessions instead of defining our own
type Session = SidebarSession
const SESSION_TITLE_GENERATING = "Generating..."

function SessionTitleText({ title, className = "truncate" }: { title: string; className?: string }) {
  const isGenerating = title === SESSION_TITLE_GENERATING
  const [dotCount, setDotCount] = React.useState(1)

  React.useEffect(() => {
    if (!isGenerating) return
    const timer = window.setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1)
    }, 320)
    return () => window.clearInterval(timer)
  }, [isGenerating])

  if (!isGenerating) {
    return <span className={className}>{title}</span>
  }

  return (
    <span className={className}>
      Generating{".".repeat(dotCount)}
    </span>
  )
}

interface SessionListPaneProps {
  sessions: Session[]
  selectedFolderId: number | null
  activeSessionId: number | null
  activeId: string | null
  folders: Array<{ id: number; name: string }>
  onSelectSession: (id: number) => void
  onRenameSession: (id: number, newTitle: string) => void
  onDeleteSession: (id: number) => void
  onRenameFolder: (id: number, newName: string) => void
  startRenameFolderId?: number | null
  onDeleteFolder: (id: number) => void
  runChatTest?: () => void
  sessionUsageRatio?: number
  onNewChat?: () => void
  // Optional folder-aware new chat action (preferred).
  // If provided, it will be called with the currently selected folder id (or null for Unfiled).
  onNewChatWithFolder?: (folderId: number | null) => void
  isFolderSwitching?: boolean
}

interface SortableSessionRowProps {
  session: Session
  isActive: boolean
  isDragging: boolean
  onSelect: () => void
  showUsage?: boolean
  sessionUsageRatio?: number
  isScanning?: boolean

  // Vault-style row actions
  isActionsOpen: boolean
  onOpenActions: () => void
  onCloseActions: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}

function SortableSessionRow({
  session,
  isActive,
  isDragging,
  onSelect,
  showUsage,
  sessionUsageRatio,
  isScanning,
  isActionsOpen,
  onOpenActions,
  onCloseActions,
  onDelete,
  onRename,
}: SortableSessionRowProps) {
  const sortable = useSortable({
    id: `session-${session.id}`,
  })

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isSortableDragging,
  } = sortable

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: (sortable as any).transition ?? undefined,
    opacity: isDragging || isSortableDragging ? 0.15 : 1,
    width: '100%', // Lock width during drag to prevent horizontal expansion
    overflowAnchor: "none",
  }

  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(session.title)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    // keep rename value in sync if title changes externally
    setRenameValue(session.title)
  }, [session.title])

  React.useEffect(() => {
    if (isRenaming) {
      // focus next tick
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [isRenaming])

  const commitRename = () => {
    const next = renameValue.trim()
    if (!next) {
      setRenameValue(session.title)
      setIsRenaming(false)
      return
    }
    if (next !== session.title) onRename(next)
    setIsRenaming(false)
    onCloseActions()
  }

  const cancelRename = () => {
    setRenameValue(session.title)
    setIsRenaming(false)
  }

  // Smooth usage bar mount/unmount (avoid flicky pop when switching chats)
  const [usageVisible, setUsageVisible] = React.useState(false)

  React.useEffect(() => {
    const canShow =
      !!showUsage &&
      sessionUsageRatio !== undefined &&
      sessionUsageRatio > 0

    if (canShow) {
      setUsageVisible(true)
      return
    }

    // Delay unmount slightly so the collapse animation can play
    const t = window.setTimeout(() => setUsageVisible(false), 220)
    return () => window.clearTimeout(t)
  }, [showUsage, sessionUsageRatio])

  return (
    <div
      ref={setNodeRef}
      data-session-row={`session-${session.id}`}
      style={style}
      className={`relative overflow-hidden flex w-full max-w-full rounded-md select-none transition-colors ${
        isActive ? "bg-blue-500/14" : "bg-transparent"
      }`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (isActionsOpen) {
          onCloseActions()
          return
        }
        onOpenActions()
      }}
    >
      {/* Sliding Actions Panel (Vault-style) */}
      <div
        data-chat-actions="1"
        className={`flex items-center gap-0 flex-shrink-0 transition-all duration-300 ease-in-out ${
          isActionsOpen ? "w-[84px] opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Rename */}
        <button
          type="button"
          className="w-10 h-[30px] bg-slate-700/70 border border-slate-600/50 hover:bg-slate-600/70 text-sky-200 rounded-l-md flex items-center justify-center"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation()
            onCloseActions()
            setIsRenaming(true)
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          type="button"
          className="w-10 h-[30px] bg-red-600/90 border border-red-700/70 hover:bg-red-700 text-white rounded-r-md flex items-center justify-center"
          title="Delete"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
            onCloseActions()
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Main Row */}
      <div
        {...attributes}
        {...listeners}
        className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors group ${
          isActive
            ? "text-gray-100 font-medium"
            : "text-gray-300 hover:bg-slate-700/40 hover:text-gray-100"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          if (isActionsOpen) {
            onCloseActions()
            return
          }
          onSelect()
        }}
      >
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
            isActive
              ? "h-7 opacity-100 bg-blue-400/90"
              : "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
          }`}
        />
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename()
                if (e.key === "Escape") cancelRename()
              }}
              onBlur={commitRename}
              className="w-full bg-gray-800/70 text-gray-100 text-sm px-2 py-1 rounded border border-gray-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          ) : (
            <SessionTitleText title={session.title} />
          )}
        </div>

      </div>
    </div>
  )
}

// Memoize SortableSessionRow to prevent re-renders when activeSessionId changes (only affected rows re-render)
// Note: Function props are excluded from comparison since they're recreated each render, but data props determine re-render
const MemoizedSortableSessionRow = React.memo(SortableSessionRow, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render), false if different (re-render)
  // Only compare data props; function props are excluded as they're recreated each render
  return (
    prevProps.session.id === nextProps.session.id &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.showUsage === nextProps.showUsage &&
    prevProps.sessionUsageRatio === nextProps.sessionUsageRatio &&
    prevProps.isScanning === nextProps.isScanning &&
    prevProps.isActionsOpen === nextProps.isActionsOpen &&
    prevProps.session.title === nextProps.session.title
  )
})

interface NonSortableSessionRowProps {
  session: Session
  isActive: boolean
  onSelect: () => void
  isActionsOpen: boolean
  onOpenActions: () => void
  onCloseActions: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}

function NonSortableSessionRow({
  session,
  isActive,
  onSelect,
  isActionsOpen,
  onOpenActions,
  onCloseActions,
  onDelete,
  onRename,
}: NonSortableSessionRowProps) {
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(session.title)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    setRenameValue(session.title)
  }, [session.title])

  React.useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [isRenaming])

  const commitRename = () => {
    const next = renameValue.trim()
    if (!next) {
      setRenameValue(session.title)
      setIsRenaming(false)
      return
    }
    if (next !== session.title) onRename(next)
    setIsRenaming(false)
    onCloseActions()
  }

  const cancelRename = () => {
    setRenameValue(session.title)
    setIsRenaming(false)
  }

  return (
    <div
      style={{ overflowAnchor: "none" }}
      data-session-row={`session-${session.id}`}
      className={`relative overflow-hidden flex w-full max-w-full rounded-md select-none transition-colors ${
        isActive ? "bg-blue-500/14" : "bg-transparent"
      }`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (isActionsOpen) {
          onCloseActions()
          return
        }
        onOpenActions()
      }}
    >
      <div
        data-chat-actions="1"
        className={`flex items-center gap-0 flex-shrink-0 transition-all duration-300 ease-in-out ${
          isActionsOpen ? "w-[84px] opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="w-10 h-[30px] bg-slate-700/70 border border-slate-600/50 hover:bg-slate-600/70 text-sky-200 rounded-l-md flex items-center justify-center"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation()
            onCloseActions()
            setIsRenaming(true)
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          type="button"
          className="w-10 h-[30px] bg-red-600/90 border border-red-700/70 hover:bg-red-700 text-white rounded-r-md flex items-center justify-center"
          title="Delete"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
            onCloseActions()
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div
        className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors group ${
          isActive
            ? "text-gray-100 font-medium"
            : "text-gray-300 hover:bg-slate-700/40 hover:text-gray-100"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          if (isActionsOpen) {
            onCloseActions()
            return
          }
          onSelect()
        }}
      >
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
            isActive
              ? "h-7 opacity-100 bg-blue-400/90"
              : "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
          }`}
        />
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename()
                if (e.key === "Escape") cancelRename()
              }}
              onBlur={commitRename}
              className="w-full bg-gray-800/70 text-gray-100 text-sm px-2 py-1 rounded border border-gray-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          ) : (
            <SessionTitleText title={session.title} />
          )}
        </div>
      </div>
    </div>
  )
}

// Memoize NonSortableSessionRow
// Note: Function props are excluded from comparison since they're recreated each render, but data props determine re-render
const MemoizedNonSortableSessionRow = React.memo(NonSortableSessionRow, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render), false if different (re-render)
  // Only compare data props; function props are excluded as they're recreated each render
  return (
    prevProps.session.id === nextProps.session.id &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isActionsOpen === nextProps.isActionsOpen &&
    prevProps.session.title === nextProps.session.title
  )
})

interface DraggableSessionRowProps {
  session: Session
  isActive: boolean
  isDragging: boolean
  onSelect: () => void
  isActionsOpen: boolean
  onOpenActions: () => void
  onCloseActions: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
  showUsage?: boolean
  sessionUsageRatio?: number
  isScanning?: boolean
}

function DraggableSessionRow({
  session,
  isActive,
  isDragging,
  onSelect,
  isActionsOpen,
  onOpenActions,
  onCloseActions,
  onDelete,
  onRename,
  showUsage,
  sessionUsageRatio,
  isScanning,
}: DraggableSessionRowProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `session-${session.id}`,
  })

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.15 : 1,
    width: '100%', // Lock width during drag to prevent horizontal expansion
    overflowAnchor: "none",
  }

  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(session.title)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    setRenameValue(session.title)
  }, [session.title])

  React.useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [isRenaming])

  const commitRename = () => {
    const next = renameValue.trim()
    if (!next) {
      setRenameValue(session.title)
      setIsRenaming(false)
      return
    }
    if (next !== session.title) onRename(next)
    setIsRenaming(false)
    onCloseActions()
  }

  const cancelRename = () => {
    setRenameValue(session.title)
    setIsRenaming(false)
  }

  return (
    <div
      ref={setNodeRef}
      data-session-row={`session-${session.id}`}
      style={style}
      className={`relative overflow-hidden flex w-full max-w-full rounded-md select-none transition-colors ${
        isActive ? "bg-blue-500/14" : "bg-transparent"
      }`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (isActionsOpen) {
          onCloseActions()
          return
        }
        onOpenActions()
      }}
    >
      {/* Sliding Actions Panel (Vault-style) */}
      <div
        data-chat-actions="1"
        className={`flex items-center gap-0 flex-shrink-0 transition-all duration-300 ease-in-out ${
          isActionsOpen ? "w-[84px] opacity-100" : "w-0 opacity-0 overflow-hidden"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Rename */}
        <button
          type="button"
          className="w-10 h-[30px] bg-slate-700/70 border border-slate-600/50 hover:bg-slate-600/70 text-sky-200 rounded-l-md flex items-center justify-center"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation()
            onCloseActions()
            setIsRenaming(true)
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          type="button"
          className="w-10 h-[30px] bg-red-600/90 border border-red-700/70 hover:bg-red-700 text-white rounded-r-md flex items-center justify-center"
          title="Delete"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
            onCloseActions()
          }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Main Row (draggable, but NOT sortable) */}
      <div
        {...attributes}
        {...listeners}
        className={`relative flex-1 min-w-0 px-2.5 py-1.5 cursor-pointer transition-colors group ${
          isActive
            ? "text-gray-100 font-medium"
            : "text-gray-300 hover:bg-slate-700/40 hover:text-gray-100"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          if (isActionsOpen) {
            onCloseActions()
            return
          }
          onSelect()
        }}
      >
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out ${
            isActive
              ? "h-7 opacity-100 bg-blue-400/90"
              : "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
          }`}
        />
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename()
                if (e.key === "Escape") cancelRename()
              }}
              onBlur={commitRename}
              className="w-full bg-gray-800/70 text-gray-100 text-sm px-2 py-1 rounded border border-gray-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          ) : (
            <SessionTitleText title={session.title} />
          )}
        </div>

      </div>
    </div>
  )
}

// Memoize DraggableSessionRow
// Memoize DraggableSessionRow
// Note: Function props are excluded from comparison since they're recreated each render, but data props determine re-render
const MemoizedDraggableSessionRow = React.memo(DraggableSessionRow, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render), false if different (re-render)
  // Only compare data props; function props are excluded as they're recreated each render
  return (
    prevProps.session.id === nextProps.session.id &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.showUsage === nextProps.showUsage &&
    prevProps.sessionUsageRatio === nextProps.sessionUsageRatio &&
    prevProps.isScanning === nextProps.isScanning &&
    prevProps.isActionsOpen === nextProps.isActionsOpen &&
    prevProps.session.title === nextProps.session.title
  )
})

const MS_DAY = 24 * 60 * 60 * 1000

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function clampNonNegative(n: number) {
  return n < 0 ? 0 : n
}

function getRelativeBucketLabel(isoOrDate: string | Date) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(date.getTime())) return "Unknown"

  const now = new Date()
  const today = startOfLocalDay(now)
  const thatDay = startOfLocalDay(date)

  const diffDays = clampNonNegative(Math.floor((today.getTime() - thatDay.getTime()) / MS_DAY))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays >= 2 && diffDays <= 6) return `${diffDays} days ago`

  if (diffDays <= 13) return "Last week"
  if (diffDays <= 20) return "2 weeks ago"
  if (diffDays <= 27) return "3 weeks ago"
  if (diffDays <= 34) return "4 weeks ago"

  const monthNow = now.getFullYear() * 12 + now.getMonth()
  const monthThen = date.getFullYear() * 12 + date.getMonth()
  const monthDiff = clampNonNegative(monthNow - monthThen)

  if (monthDiff === 1) return "Last month"
  if (monthDiff >= 2 && monthDiff <= 6) return `${monthDiff} months ago`

  return date.toLocaleString(undefined, { month: "long", year: "numeric" })
}

export function SessionListPane({
  sessions,
  selectedFolderId,
  activeSessionId,
  activeId,
  folders,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onRenameFolder,
  startRenameFolderId,
  onDeleteFolder,
  runChatTest,
  sessionUsageRatio,
  onNewChat,
  onNewChatWithFolder,
  isFolderSwitching = false,
}: SessionListPaneProps) {
  const [isEditingFolder, setIsEditingFolder] = useState(false)
  const [editFolderValue, setEditFolderValue] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const chatLaneRef = useRef<HTMLDivElement | null>(null)
  const prevActiveUpdatedAtRef = useRef<string | null>(null)
  const prevActivePositionRef = useRef<number | null>(null)
  const [laneReorderPulse, setLaneReorderPulse] = useState(false)

  const [usageScanSessionId, setUsageScanSessionId] = useState<number | null>(null)
  const [showEmptyState, setShowEmptyState] = useState(false)
  const [renderSessions, setRenderSessions] = useState<Session[]>([])
  const [renderSelectedFolderId, setRenderSelectedFolderId] = useState<number | null>(selectedFolderId ?? null)
  const lastNonEmptySessionsRef = React.useRef<Session[]>([])
  const scanTimerRef = useRef<number | null>(null)

  const [openSessionActionsId, setOpenSessionActionsId] = useState<number | null>(null)

  // Close any open chat actions when clicking outside
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-chat-actions="1"]')) return
      if (
        openSessionActionsId != null &&
        target.closest(`[data-session-row="session-${openSessionActionsId}"]`)
      ) {
        // Let row onClick handle close-only behavior without pre-closing here.
        return
      }
      setOpenSessionActionsId(null)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [openSessionActionsId])

  useEffect(() => {
    setOpenSessionActionsId(null)
  }, [selectedFolderId])

  useEffect(() => {
    if (searchQuery.trim()) setOpenSessionActionsId(null)
  }, [searchQuery])

  // When you select a chat, briefly show an indeterminate "scan" bar.
  // IMPORTANT: only trigger this on chat selection, not on every token/usage update.
  useEffect(() => {
    if (activeSessionId == null) {
      setUsageScanSessionId(null)
      if (scanTimerRef.current) {
        window.clearTimeout(scanTimerRef.current)
        scanTimerRef.current = null
      }
      return
    }

    // If we don't have usage info yet, don't animate.
    if (sessionUsageRatio == null) {
      setUsageScanSessionId(null)
      return
    }

    setUsageScanSessionId(activeSessionId)

    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }

    // short scan on selection
    scanTimerRef.current = window.setTimeout(() => {
      setUsageScanSessionId(null)
      scanTimerRef.current = null
    }, 650)

    return () => {
      if (scanTimerRef.current) {
        window.clearTimeout(scanTimerRef.current)
        scanTimerRef.current = null
      }
    }
  }, [activeSessionId, sessionUsageRatio])

  const effectiveSelectedFolderId = selectedFolderId !== null && folders.some((f) => f.id === selectedFolderId)
    ? selectedFolderId
    : null

  const selectedFolder = effectiveSelectedFolderId !== null
    ? folders.find((f) => f.id === effectiveSelectedFolderId)
    : null

  const activeSessionTitle = useMemo(() => {
    if (activeSessionId == null) return ""
    const s = sessions.find((x) => x.id === activeSessionId)
    return (s?.title ?? "").trim()
  }, [activeSessionId, sessions])

  // Filter sessions by selected folder
  // Unfiled = sessions with no folder assignment (null/undefined)
  const folderSessions = useMemo(() => {
    return effectiveSelectedFolderId === null
      ? sessions.filter((s) => s.inFolderId == null)
      : sessions.filter((s) => s.inFolderId === effectiveSelectedFolderId)
  }, [sessions, effectiveSelectedFolderId])

  // Ordering rules:
  // - Unfiled: preserve MRU order from hook (DO NOT RE-SORT!)
  // - Folder: sort by folderOrderTs (most recently added/reordered first)
  const orderedSessions = useMemo(() => {
    if (effectiveSelectedFolderId === null) {
      // CRITICAL: Preserve input order to eliminate flicker
      // The hook already provides MRU-sorted sessions.
      return folderSessions
    }

    return [...folderSessions].sort((a, b) => {
      const aOrder = Number(a.folderOrderTs ?? 0)
      const bOrder = Number(b.folderOrderTs ?? 0)
      if (aOrder !== bOrder) return bOrder - aOrder

      const aMru = Number(a.mru_ts || 0)
      const bMru = Number(b.mru_ts || 0)
      if (aMru !== bMru) return bMru - aMru

      const ta = new Date(a.updatedAt).getTime()
      const tb = new Date(b.updatedAt).getTime()
      if (tb !== ta) return tb - ta
      return b.id - a.id
    })
  }, [folderSessions, effectiveSelectedFolderId])

  // Search filter is applied AFTER ordering so manual drag order stays intact.
  const sortedSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return orderedSessions
    return orderedSessions.filter((s) => (s.title || "").toLowerCase().includes(q))
  }, [orderedSessions, searchQuery])

  // Keep the previous list visible during folder switches to avoid a 1-frame
  // "blank gradient" flash when next folder data settles.
  useEffect(() => {
    if (sortedSessions.length > 0) {
      lastNonEmptySessionsRef.current = sortedSessions
      setRenderSessions(sortedSessions)
      return
    }

    if (isFolderSwitching && lastNonEmptySessionsRef.current.length > 0) {
      setRenderSessions(lastNonEmptySessionsRef.current)
      return
    }

    setRenderSessions(sortedSessions)
  }, [sortedSessions, isFolderSwitching])

  // Keep left-list mode (Unfiled vs folder view) stable while switching to avoid
  // a one-frame render-mode swap flash.
  useEffect(() => {
    const nextFolderId = selectedFolderId ?? null
    if (isFolderSwitching && sortedSessions.length === 0) {
      return
    }
    setRenderSelectedFolderId(nextFolderId)
  }, [selectedFolderId, isFolderSwitching, sortedSessions.length])

  const isUnfiled = renderSelectedFolderId === null

  // Pulse animation: only trigger when active session moves from position >0 to 0 (moves to top)
  useLayoutEffect(() => {
    if (!isUnfiled) {
      prevActiveUpdatedAtRef.current = null
      prevActivePositionRef.current = null
      return
    }
    if (activeSessionId == null) {
      prevActiveUpdatedAtRef.current = null
      prevActivePositionRef.current = null
      return
    }

    const active = sessions.find((s) => s.id === activeSessionId)
    const cur = active?.updatedAt ?? null
    const prev = prevActiveUpdatedAtRef.current

    // Find current position in sorted list (for Unfiled, this is orderedSessions)
    const currentPosition = orderedSessions.findIndex((s) => s.id === activeSessionId)
    const prevPosition = prevActivePositionRef.current

    // EARLY EXIT: If position is 0 and was already 0, skip all checks (even if updatedAt changed)
    // This prevents pulse animation when the active chat is already at top and receives a new message
    if (currentPosition === 0 && prevPosition === 0) {
      prevActiveUpdatedAtRef.current = cur
      prevActivePositionRef.current = currentPosition
      return // Already at top, no visual change needed
    }

    // Only pulse if session moved from position >0 to position 0 (moved to top)
    const positionMovedToTop =
      prevPosition != null &&
      prevPosition > 0 &&
      currentPosition === 0

    if (cur && prev && cur !== prev && currentPosition !== -1) {
      if (positionMovedToTop) {
        setLaneReorderPulse(true)
        window.setTimeout(() => setLaneReorderPulse(false), 140)
      }
    }

    prevActiveUpdatedAtRef.current = cur
    prevActivePositionRef.current = currentPosition
  }, [activeSessionId, sessions, isUnfiled, orderedSessions])

  const sessionIdsArray = renderSessions.map((s) => `session-${s.id}`)

  const groupedUnfiled = useMemo(() => {
    if (!isUnfiled) return [] as Array<{ type: "header"; label: string } | { type: "session"; session: Session }>

    // CRITICAL: DO NOT RE-SORT! renderSessions is already MRU-sorted by the hook
    // Preserving input order eliminates flicker (Option A pattern)
    const sessionsInOrder = [...renderSessions]

    type Bucket = {
      label: string
      sessions: Session[]
    }

    const bucketsByLabel = new Map<string, Bucket>()

    // Group into buckets while preserving order
    for (const s of sessionsInOrder) {
      const label = getRelativeBucketLabel(s.updatedAt)
      const existing = bucketsByLabel.get(label)

      if (!existing) {
        bucketsByLabel.set(label, { label, sessions: [s] })
      } else {
        existing.sessions.push(s)
      }
    }

    // Sort sessions within each bucket by MRU
    for (const bucket of bucketsByLabel.values()) {
      bucket.sessions.sort((a, b) => {
        // Coerce to Number to ensure numeric comparison
        const aMru = Number(a.mru_ts || 0);
        const bMru = Number(b.mru_ts || 0);
        
        if (aMru !== bMru) return bMru - aMru;
        
        const ta = new Date(a.updatedAt).getTime();
        const tb = new Date(b.updatedAt).getTime();
        if (tb !== ta) return tb - ta;
        return b.id - a.id;
      });
    }

    // Sort buckets by label (Today, Yesterday, etc.) but NOT the sessions inside
    const bucketLabels = Array.from(bucketsByLabel.keys())
      .sort((a, b) => {
        // Simple custom sort to ensure Today > Yesterday > X days ago > etc.
        if (a === "Today") return -1
        if (b === "Today") return 1
        if (a === "Yesterday") return -1
        if (b === "Yesterday") return 1
        if (a.startsWith("days ago") && b.startsWith("days ago")) {
          const aDays = parseInt(a)
          const bDays = parseInt(b)
          return aDays - bDays
        }
        return a.localeCompare(b)
      })

    const out: Array<
      { type: "header"; label: string } | { type: "session"; session: Session }
    > = []

    for (const label of bucketLabels) {
      const bucket = bucketsByLabel.get(label)!
      out.push({ type: "header", label })
      for (const s of bucket.sessions) out.push({ type: "session", session: s })
    }

    return out
  }, [isUnfiled, renderSessions])

  // Start editing folder name
  const handleStartEdit = useCallback(() => {
    if (selectedFolder) {
      setEditFolderValue(selectedFolder.name)
      setIsEditingFolder(true)
    }
  }, [selectedFolder])

  // Handle external request to start renaming (from SessionFolderRail context menu)
  React.useEffect(() => {
    if (startRenameFolderId !== null && startRenameFolderId !== undefined && 
        selectedFolderId === startRenameFolderId && selectedFolder && !isEditingFolder) {
      handleStartEdit()
    }
  }, [startRenameFolderId, selectedFolderId, selectedFolder, isEditingFolder, handleStartEdit])

  // Save folder rename
  const handleSaveEdit = () => {
    if (selectedFolderId !== null && editFolderValue.trim()) {
      onRenameFolder(selectedFolderId, editFolderValue.trim())
      setIsEditingFolder(false)
    }
  }

  // Cancel edit
  const handleCancelEdit = () => {
    setIsEditingFolder(false)
    setEditFolderValue("")
  }

  // Stabilize callbacks with useCallback to prevent unnecessary re-renders
  const handleOpenSessionActions = useCallback((sessionId: number) => {
    setOpenSessionActionsId(sessionId)
  }, [])

  const handleCloseSessionActions = useCallback(() => {
    setOpenSessionActionsId(null)
  }, [])

  const handleSessionSelect = useCallback((sessionId: number) => {
    onSelectSession(sessionId)
  }, [onSelectSession])

  const handleSessionDelete = useCallback((sessionId: number) => {
    onDeleteSession(sessionId)
  }, [onDeleteSession])

  const handleSessionRename = useCallback((sessionId: number, newTitle: string) => {
    onRenameSession(sessionId, newTitle)
  }, [onRenameSession])

  const handleNewChatClick = useCallback(() => {
    // Close any open row actions to avoid UI overlap.
    setOpenSessionActionsId(null)

    // Prefer folder-aware handler if present.
    if (onNewChatWithFolder) {
      onNewChatWithFolder(effectiveSelectedFolderId)
      return
    }

    // Fallback: existing handler (no folder context).
    if (onNewChat) {
      onNewChat()
    }
  }, [onNewChat, onNewChatWithFolder, effectiveSelectedFolderId])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingFolder && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [isEditingFolder])

  // Match right-panel behavior: keep empty-state stable from rendered list.
  // Do NOT force-hide it during folder switching when we're already empty,
  // otherwise we expose the background for a frame and create a visible blink.
  useEffect(() => {
    if (renderSessions.length > 0) {
      setShowEmptyState(false)
      return
    }
    if (!isFolderSwitching) {
      setShowEmptyState(true)
    }
  }, [renderSessions.length, isFolderSwitching])

  return (
    <div
      className="w-64 flex-shrink-0 flex flex-col h-full relative overflow-hidden isolate bg-transparent"
      style={{
        contain: "paint",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative z-10 flex flex-col h-full">
        {/* Header - Folder name bar (Discord server name style) */}
        <div className="flex flex-col flex-shrink-0 border-b border-gray-700/30">
          {/* Row 1: Title and buttons */}
          <div className="h-12 px-3 flex items-center justify-between">
            {isEditingFolder && selectedFolder ? (
              <input
                ref={editInputRef}
                type="text"
                value={editFolderValue}
                onChange={(e) => setEditFolderValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveEdit()
                  } else if (e.key === "Escape") {
                    handleCancelEdit()
                  }
                }}
                onBlur={handleSaveEdit}
                className="flex-1 bg-gray-700 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
            ) : (
              <>
                <h2 className="text-base font-semibold text-gray-100 truncate flex-1 min-w-0">
                  {isUnfiled ? "Chats" : selectedFolder?.name || "Unknown"}
                </h2>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Run Chat Test button (dev only) */}
                  {process.env.NODE_ENV === "development" && runChatTest && (
                    <button
                      type="button"
                      onClick={runChatTest}
                      className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                      title="Run Chat Test"
                    >
                      Test
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Active chat info (chat title + usage bar). Keep stable (no fade-out/fade-in swaps). */}
          <div
            className={
              "overflow-hidden transition-all duration-300 ease-out " +
              (activeSessionId != null ? "max-h-[120px]" : "max-h-0")
            }
          >
            <div className="px-3 pb-2">
              {(() => {
                // Calculate progress from session tokens
                const progress = sessionUsageRatio != null
                  ? Math.min(100, Math.max(0, Math.round(sessionUsageRatio * 100)))
                  : null;

                const isScanning = usageScanSessionId === activeSessionId
                // Keep a stable box height to avoid layout shift.
                return (
                  <div
                    className={
                      "rounded-md border border-gray-700/30 bg-gray-900/20 px-2.5 py-2 " +
                      "transition-opacity duration-150 ease-out " +
                      (isScanning ? "opacity-70" : "opacity-100")
                    }
                    style={{ minHeight: 48 }}
                  >
                    <div className="text-[11px] uppercase tracking-wider text-gray-400/80">
                      Active chat
                    </div>
                    <div className="mt-1 text-[13px] font-semibold text-gray-100 truncate">
                      <SessionTitleText title={activeSessionTitle || ""} />
                    </div>
                    <div className="mt-2">
                      <HeaderUsageBar progress={progress} />
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Search (Discord-style) */}
        <div className="px-3 py-2 border-b border-gray-700/30 flex-shrink-0">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full h-8 bg-gray-800/50 text-gray-100 text-sm pl-8 pr-2 rounded-md border border-gray-700/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            <svg
              className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35m1.6-5.15a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
              />
            </svg>
          </div>
        </div>

        {/* Chat list - Discord pill style */}
        <div
          ref={chatLaneRef}
          style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
          className="chat-scroll-lane db-scroll-lane flex-1 overflow-y-auto overflow-x-hidden py-2 bg-transparent opacity-100"
        >
          {/* New Chat row (visual only; no DB creation here) */}
          <div className="border-y border-gray-700/30 bg-transparent">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleNewChatClick()
              }}
              className={
                "relative w-full flex items-center gap-2 px-3 py-2.5 text-left " +
                "text-gray-300 hover:text-gray-100 hover:bg-slate-800/35 " +
                "transition-colors group"
              }
              title={isUnfiled ? "New chat" : "New chat in this folder"}
              aria-label={isUnfiled ? "New chat" : "New chat in this folder"}
            >
              {/* Left accent bar on hover (matches session rows) */}
              <div
                className={
                  "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-200 ease-out " +
                  "h-3 opacity-0 bg-blue-400/70 group-hover:opacity-70"
                }
              />

              {/* Minimal plus + label (no icon bubble) */}
              <svg
                className="w-4 h-4 flex-shrink-0 text-gray-400 group-hover:text-gray-200 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>

              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight transition-all duration-150 group-hover:tracking-wide">
                  New Chat
                </div>
              </div>
            </button>
          </div>
          {renderSessions.length === 0 && showEmptyState ? (
            <div className="text-xs text-gray-500 italic py-4 text-center">
              {isUnfiled ? "No chats" : "Empty folder"}
            </div>
          ) : isUnfiled ? (
            <div className="space-y-0.5 px-1">
              {groupedUnfiled.map((item) => {
                if (item.type === "header") {
                  return (
                    <div key={`h-${item.label}`} className="pt-3">
                      <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500/80">
                        {item.label}
                      </div>
                      <div className="mx-0 h-px bg-gray-700/40" />
                    </div>
                  )
                }

                const sessionId = item.session.id
                return (
                  <MemoizedDraggableSessionRow
                    key={sessionId}
                    session={item.session}
                    isActive={sessionId === activeSessionId}
                    isDragging={activeId === `session-${sessionId}`}
                    onSelect={() => handleSessionSelect(sessionId)}
                    showUsage={sessionId === activeSessionId}
                    sessionUsageRatio={sessionUsageRatio}
                    isScanning={sessionId === activeSessionId && usageScanSessionId === activeSessionId}
                    isActionsOpen={openSessionActionsId === sessionId}
                    onOpenActions={() => handleOpenSessionActions(sessionId)}
                    onCloseActions={handleCloseSessionActions}
                    onDelete={() => handleSessionDelete(sessionId)}
                    onRename={(newTitle: string) => handleSessionRename(sessionId, newTitle)}
                  />
                )
              })}
            </div>
          ) : (
            <SortableContext
              items={sessionIdsArray}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5 px-1">
                {sortedSessions.map((session) => {
                  const sessionId = session.id
                  return (
                    <MemoizedSortableSessionRow
                      key={sessionId}
                      session={session}
                      isActive={sessionId === activeSessionId}
                      isDragging={activeId === `session-${sessionId}`}
                      onSelect={() => handleSessionSelect(sessionId)}
                      showUsage={sessionId === activeSessionId}
                      sessionUsageRatio={sessionUsageRatio}
                      isScanning={sessionId === activeSessionId && usageScanSessionId === activeSessionId}
                      isActionsOpen={openSessionActionsId === sessionId}
                      onOpenActions={() => handleOpenSessionActions(sessionId)}
                      onCloseActions={handleCloseSessionActions}
                      onDelete={() => handleSessionDelete(sessionId)}
                      onRename={(newTitle: string) => handleSessionRename(sessionId, newTitle)}
                    />
                  )
                })}
              </div>
            </SortableContext>
          )}
        </div>
      </div>
    </div>
  )
}
