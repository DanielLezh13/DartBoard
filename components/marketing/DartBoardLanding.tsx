import { HeroSection } from "@/components/hero-section";
import { ProblemSolutionSection } from "@/components/problem-solution-section";
import { ChatModesSection } from "@/components/chat-modes-section";
import { MemoriesSection } from "@/components/memories-section";
import { ArchiveSection } from "@/components/archive-section";
import { LayoutPreviewSection } from "@/components/layout-preview-section";
import { Footer } from "@/components/footer";

export function DartBoardLanding() {
  return (
    <main className="db-marketing-bg relative isolate min-h-screen overflow-hidden">
      <div className="db-marketing-bg-noise fixed inset-0 -z-10" />
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-blue-500/10 to-transparent" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-slate-950/80 to-transparent" />

      <HeroSection />
      <ProblemSolutionSection />
      <MemoriesSection />
      <ChatModesSection />
      <ArchiveSection />
      <LayoutPreviewSection />
      <Footer />
    </main>
  );
}
