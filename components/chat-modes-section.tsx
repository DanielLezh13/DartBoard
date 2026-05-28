import { MessageSquare, Target, Code2, Zap, Coffee, Search } from "lucide-react"

const chatModes = [
  {
    name: "ChatGPT",
    description: "Default model behavior — natural, well-rounded conversations",
    icon: MessageSquare,
  },
  {
    name: "Tactical",
    description: "Sharp, efficient problem solving for quick decisions",
    icon: Target,
  },
  {
    name: "Builder",
    description: "Code-first and solution-driven development focus",
    icon: Code2,
  },
  {
    name: "Simple",
    description: "Fast answers, no distractions — straight to the point",
    icon: Zap,
  },
  {
    name: "Chill",
    description: "Gentle, human-like guidance for relaxed thinking",
    icon: Coffee,
  },
  {
    name: "Dissect",
    description: "Deep reasoning and critical thinking analysis",
    icon: Search,
  },
]

export function ChatModesSection() {
  return (
    <section className="relative px-4 py-24">
      {/* Background accent */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[150px]" />
      
      <div className="mx-auto max-w-6xl">
        {/* Section Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Adaptive Chat Modes
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Switch between specialized AI behaviors for different tasks
          </p>
        </div>

        {/* Modes Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chatModes.map((mode) => (
            <div
              key={mode.name}
              className="group relative overflow-hidden rounded-xl border border-blue-500/30 bg-slate-900/50 p-6 transition-all hover:border-blue-400/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.1)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <mode.icon className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{mode.name}</h3>
                  <p className="text-sm text-gray-400">{mode.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
