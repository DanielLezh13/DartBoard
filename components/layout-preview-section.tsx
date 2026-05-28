import {
  FolderOpen,
  MessageSquare,
  Search,
  Clock,
  Paperclip,
  ImageIcon,
  Globe,
  Plus,
  Bookmark,
  Calendar,
  FolderClosed,
  SendHorizonal,
  Settings,
  ChevronUp,
  Brain,
  Camera,
  Copy,
  GitBranch,
  Sparkles,
  Archive,
  Hash,
  Star,
  Trash2,
  Edit3,
  MoreVertical,
} from "lucide-react"

export function LayoutPreviewSection() {
  return (
    <section className="relative px-4 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute right-0 top-1/2 -z-10 h-[600px] w-[600px] translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 blur-[150px]" />

      <div className="mx-auto max-w-6xl">
        {/* Section Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            DartBoard Chat Layout
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Three interconnected panels that work together to manage
            conversations and knowledge.
          </p>
        </div>

        {/* Layout Preview */}
        <div className="overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900/50 p-2 shadow-[0_0_60px_rgba(59,130,246,0.1)] backdrop-blur-sm">
          <div className="grid min-h-[500px] gap-2 lg:grid-cols-[280px_1fr_280px]">
            {/* Left Panel - Sessions */}
            <div className="flex rounded-xl border border-blue-500/20 bg-slate-800/30">
              {/* Left Icon Rail */}
              <div className="flex flex-col items-center gap-3 border-r border-blue-500/20 bg-slate-900/30 px-2 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20">
                  <MessageSquare className="h-4 w-4 text-blue-400" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <FolderClosed className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Star className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Archive className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <FolderClosed className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Settings className="h-4 w-4" />
                </div>
                <div className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Plus className="h-4 w-4" />
                </div>
              </div>

              {/* Sessions List */}
              <div className="flex-1 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-semibold text-white">Chats</h4>
                  <span className="rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
                    Test
                  </span>
                </div>

                {/* Active Chat */}
                <div className="mb-4 rounded-lg bg-slate-700/50 p-2">
                  <div className="text-xs text-gray-500">
                    ACTIVE CHAT
                  </div>
                  <div className="text-sm font-medium text-white">
                    Landing page integration
                  </div>
                  <div className="mt-1 h-1 w-full rounded-full bg-slate-600">
                    <div className="h-1 w-3/4 rounded-full bg-blue-400" />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">75%</div>
                </div>

                {/* Search */}
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2">
                  <Search className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-500">
                    Search chats
                  </span>
                </div>

                {/* New Chat */}
                <div className="mb-4 flex w-full items-center gap-2 rounded-lg p-2 text-sm text-gray-500">
                  <Plus className="h-4 w-4" />
                  <span>New Chat</span>
                </div>

                {/* Today Section */}
                <div className="mb-2 text-xs text-gray-500">TODAY</div>
                <div className="space-y-1 mb-4">
                  <div className="flex items-center gap-2 rounded-lg border-l-2 border-blue-400 bg-blue-400/10 p-2 text-sm">
                    <span className="text-white">Archive import cleanup</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>Memory injection test</span>
                  </div>
                </div>

                {/* 2 days ago Section */}
                <div className="mb-2 text-xs text-gray-500">2 days ago</div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>UI polish</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>API integration</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Center Panel - Chat Workspace */}
            <div className="flex flex-col rounded-xl border border-blue-500/20 bg-slate-900/30">
              {/* Header */}
              <div className="flex items-center justify-center gap-2 border-b border-blue-500/20 px-4 py-3 text-sm text-gray-500">
                <Calendar className="h-4 w-4" />
                <span>TODAY</span>
                <span className="text-white">5 PM</span>
              </div>

              {/* Chat Area */}
              <div className="flex-1 space-y-4 p-4">
                {/* User Message Bubble */}
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-tr-md bg-blue-500 px-4 py-2 text-sm text-white">
                    Attach my saved archive notes to this chat
                  </div>
                </div>

                {/* AI Response */}
                <div className="flex gap-3">
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-white">
                      Memories added. I can now use your previous project context in this session.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="rounded p-1 text-gray-500">
                        <Copy className="h-4 w-4" />
                      </div>
                      <div className="rounded p-1 text-gray-500">
                        <GitBranch className="h-4 w-4" />
                      </div>
                      <div className="rounded p-1 text-gray-500">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="rounded p-1 text-gray-500">
                        <Bookmark className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Another User Message Bubble */}
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-tr-md bg-blue-500 px-4 py-2 text-sm text-white">
                    Summarize what we worked on yesterday
                  </div>
                </div>
              </div>

              {/* Input Area */}
              <div className="border-t border-blue-500/20 p-4">
                <div className="rounded-xl border border-blue-500/20 bg-slate-800/30 p-3">
                  <div className="mb-3 text-sm text-gray-400">
                    Type a message…
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg p-2 text-gray-500">
                        <Brain className="h-4 w-4" />
                      </div>
                      <div className="h-4 w-px bg-blue-500/20" />
                      <div className="rounded-lg p-2 text-gray-500">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div className="rounded-lg p-2 text-gray-500">
                        <Paperclip className="h-4 w-4" />
                      </div>
                      <div className="rounded-lg p-2 text-gray-500">
                        <Camera className="h-4 w-4" />
                      </div>
                      <div className="rounded-lg p-2 text-gray-500">
                        <Globe className="h-4 w-4" />
                      </div>
                      <span className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white">
                        Tactical
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg p-2 text-gray-500">
                        <Search className="h-4 w-4" />
                      </div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white">
                        <ChevronUp className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel - Memories */}
            <div className="flex rounded-xl border border-blue-500/20 bg-slate-800/30">
              {/* Memories Content */}
              <div className="flex-1 p-4">
                <h4 className="mb-4 font-semibold text-white">Memories</h4>

                {/* Search */}
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-900/50 px-3 py-2">
                  <Search className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-500">
                    Search memories
                  </span>
                </div>

                {/* New Memory */}
                <div className="mb-4 flex w-full items-center gap-2 rounded-lg p-2 text-sm text-blue-400">
                  <Plus className="h-4 w-4" />
                  <span>New Memory</span>
                </div>

                {/* Memory List */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 rounded-lg border-l-2 border-blue-400 bg-blue-400/10 p-2 text-sm">
                    <span className="text-white">Landing page goals</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>Archive search rules</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>Chat mode definitions</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg p-2 text-sm text-gray-400">
                    <span>UI polish checklist</span>
                  </div>
                </div>
              </div>

              {/* Right Icon Rail */}
              <div className="flex flex-col items-center gap-3 border-l border-blue-500/20 bg-slate-900/30 px-2 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20">
                  <Clock className="h-4 w-4 text-blue-400" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <FolderClosed className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Star className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Edit3 className="h-4 w-4" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <FolderClosed className="h-4 w-4" />
                </div>
                <div className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg text-gray-500">
                  <Plus className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel Descriptions */}
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="text-center">
            <h4 className="mb-2 font-semibold">Left Panel</h4>
            <p className="text-sm text-muted-foreground">
              Chat sessions grouped into folders. Navigate between active and
              previous conversations.
            </p>
          </div>
          <div className="text-center">
            <h4 className="mb-2 font-semibold">Center Workspace</h4>
            <p className="text-sm text-muted-foreground">
              Where conversations happen. Search, upload, switch modes, set
              focus, and branch chats.
            </p>
          </div>
          <div className="text-center">
            <h4 className="mb-2 font-semibold">Right Panel</h4>
            <p className="text-sm text-muted-foreground">
              Editable memories organized in folders. Drag directly into any
              chat as context.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
