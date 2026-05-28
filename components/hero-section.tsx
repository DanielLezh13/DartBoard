"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ArrowRight, Sparkles } from "lucide-react"

export function HeroSection() {
  const [isEmbedded, setIsEmbedded] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setIsEmbedded(window.self !== window.top)
  }, [])

  const handleEmbeddedChat = () => {
    if (!isEmbedded || typeof window === "undefined") return
    // Contract with /chat overlay host (ChatPageLayout message listener).
    window.parent.postMessage({ type: "db-home-overlay-close" }, window.location.origin)
  }

  const handleEmbeddedArchive = () => {
    if (!isEmbedded || typeof window === "undefined") return
    // Contract with /chat overlay host (ChatPageLayout message listener).
    window.parent.postMessage({ type: "db-home-overlay-open-archive" }, window.location.origin)
  }

  return (
    <section className="relative px-4 pt-16 pb-4 md:pt-20 md:pb-6">
      <div className="mx-auto max-w-5xl text-center">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-400/10 px-4 py-2 text-sm text-blue-400">
          <Sparkles className="h-4 w-4" />
          <span>Your Personal AI Workspace</span>
        </div>

        {/* Main Title */}
        <h1 className="mb-4 text-balance text-5xl font-bold tracking-tight md:text-7xl">
          <span className="bg-gradient-to-r from-white via-white to-blue-400 bg-clip-text text-transparent">
            DartBoard
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mb-8 mx-auto max-w-2xl text-pretty text-lg text-gray-400 md:text-xl">
          A personal AI workspace for conversation, memory, and organization. Transform AI from a disposable chat tool into a persistent system for thinking.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          {isEmbedded ? (
            <Button
              size="lg"
              onClick={handleEmbeddedChat}
              className="group gap-2 bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-shadow hover:shadow-[0_0_40px_rgba(59,130,246,0.5)]"
            >
              Chat
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          ) : (
            <Button asChild size="lg" className="group gap-2 bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-shadow hover:shadow-[0_0_40px_rgba(59,130,246,0.5)]">
              <Link href="/">
                Chat
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          )}
          {isEmbedded ? (
            <Button
              size="lg"
              variant="outline"
              onClick={handleEmbeddedArchive}
              className="group gap-2 border-gray-600 bg-transparent text-white hover:bg-gray-800 hover:border-blue-400/30"
            >
              Archive
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          ) : (
            <Button asChild size="lg" variant="outline" className="border-gray-600 bg-transparent text-white hover:bg-gray-800 hover:border-blue-400/30">
              <Link href="/archive" className="group gap-2">
                Archive
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          )}
        </div>

        {/* Decorative glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]" />
      </div>
    </section>
  )
}
