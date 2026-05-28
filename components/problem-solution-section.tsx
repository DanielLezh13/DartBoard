import { AlertTriangle, CheckCircle2 } from "lucide-react"

export function ProblemSolutionSection() {
  return (
    <section className="relative px-4 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Section Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            What is DartBoard?
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Understanding the problem and our solution
          </p>
        </div>

        {/* Two Column Layout */}
        <div className="grid gap-8 md:grid-cols-2">
          {/* Challenge Card */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900/50 p-8 transition-all hover:border-red-500/50">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
                  <AlertTriangle className="h-6 w-6 text-red-400" />
                </div>
                <h3 className="text-2xl font-semibold text-white">The Challenge</h3>
              </div>
              <div className="space-y-4 text-gray-400">
                <p>
                  AI conversations are temporary and fragmented. Important ideas get buried, past work is hard to find, and users must repeat context every time.
                </p>
                <p>
                  Most AI chat experiences lack long-term memory, meaningful organization, and continuity across sessions — turning conversations into disposable interactions instead of reusable knowledge.
                </p>
              </div>
            </div>
          </div>

          {/* Solution Card */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900/50 p-8 transition-all hover:border-green-500/50">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                  <CheckCircle2 className="h-6 w-6 text-green-400" />
                </div>
                <h3 className="text-2xl font-semibold text-white">The Solution</h3>
              </div>
              <div className="space-y-4 text-gray-400">
                <p>
                  DartBoard unifies chat, memory, and organization into one workspace.
                </p>
                <p>
                  Users can save and organize conversations, search old chats, and reuse important knowledge by injecting it directly into new chat sessions as context.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
