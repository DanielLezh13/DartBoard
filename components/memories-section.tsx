import { Bookmark, ArrowRightLeft, FolderOpen, RefreshCw } from "lucide-react"

const memoryFeatures = [
  {
    title: "Save What Matters",
    description: "Turn important messages into reusable memories — ideas, notes, decisions, or knowledge worth keeping.",
    icon: Bookmark,
  },
  {
    title: "Inject Into New Chats",
    description: "Attach saved memories directly to any new conversation as context. The AI understands past work without repeating yourself.",
    icon: ArrowRightLeft,
  },
  {
    title: "Organize & Edit",
    description: "Rename, edit, and group memories into folders. Create a personal knowledge library instead of scattered chat history.",
    icon: FolderOpen,
  },
  {
    title: "Live Knowledge",
    description: "Memories evolve over time — update or refine them as projects grow and thinking changes.",
    icon: RefreshCw,
  },
]

export function MemoriesSection() {
  return (
    <section className="relative px-4 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute left-0 top-1/2 -z-10 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/20 blur-[150px]" />
      
      <div className="mx-auto max-w-6xl">
        {/* Section Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Memories & Context Control
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Save, organize, and inject knowledge into conversations
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {memoryFeatures.map((feature, index) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900/50 p-8 backdrop-blur-sm transition-all hover:border-purple-500/50 hover:shadow-[0_0_40px_rgba(168,85,247,0.1)]"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10">
                  <feature.icon className="h-6 w-6 text-purple-400" />
                </div>
                <h3 className="mb-4 text-xl font-semibold text-white">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
