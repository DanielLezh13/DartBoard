import { Target } from "lucide-react"

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/30 px-4 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">DartBoard</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Transform AI into a persistent system for thinking, note-taking, and long-term projects.
          </p>
        </div>
      </div>
    </footer>
  )
}
