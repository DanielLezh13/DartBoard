import { Upload, Search, Star, Database } from "lucide-react"

const archiveFeatures = [
  {
    title: "Import Past Conversations",
    description: "Upload your ChatGPT export and turn years of chat history into a structured archive.",
    icon: Upload,
  },
  {
    title: "Search & Discover",
    description: "Find old conversations by keyword or date instead of scrolling endlessly through past sessions.",
    icon: Search,
  },
  {
    title: "Reuse What Matters",
    description: "Select important messages from the archive and turn them into memories you can inject into new chats.",
    icon: Star,
  },
  {
    title: "From History to Knowledge",
    description: "Your past AI conversations become a searchable, reusable knowledge base — not lost context.",
    icon: Database,
  },
]

export function ArchiveSection() {
  return (
    <section className="relative px-4 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[150px]" />
      
      <div className="mx-auto max-w-6xl">
        {/* Section Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Archive: Your AI History, Organized
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Import, search, and transform your past AI conversations into actionable knowledge.
          </p>
        </div>

        {/* Features Row */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {archiveFeatures.map((feature) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-xl border border-blue-500/30 bg-slate-900/50 p-6 text-center transition-all hover:border-blue-400/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.1)]"
            >
              <div className="mb-4 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
                  <feature.icon className="h-6 w-6 text-blue-400" />
                </div>
              </div>
              <h3 className="mb-2 font-semibold text-white">{feature.title}</h3>
              <p className="text-sm text-gray-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
