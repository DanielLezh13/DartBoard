import { HeroSection } from "@/components/hero-section";
import { ProblemSolutionSection } from "@/components/problem-solution-section";
import { ChatModesSection } from "@/components/chat-modes-section";
import { MemoriesSection } from "@/components/memories-section";
import { ArchiveSection } from "@/components/archive-section";
import { LayoutPreviewSection } from "@/components/layout-preview-section";
import { Footer } from "@/components/footer";

export function DartBoardLanding() {
  return (
    <div className="db-scroll-page db-marketing-bg">
      <div className="db-page-scroll" role="region" aria-label="About DartBoard" tabIndex={0}>
        <main className="relative isolate min-h-full">
          <HeroSection />
          <ProblemSolutionSection />
          <MemoriesSection />
          <ChatModesSection />
          <ArchiveSection />
          <LayoutPreviewSection />
          <Footer />
        </main>
      </div>
    </div>
  );
}
