import type { ChatMessage } from "@/types/chat";

export function generateTitleFromSummary(summary: string): string {
  const lines = summary.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      // Strip markdown headers, bold, italic, links, etc.
      let title = trimmed
        .replace(/^#+\s*/, "") // Remove leading # headers
        .replace(/\*\*/g, "") // Remove bold
        .replace(/\*/g, "") // Remove italic
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Convert links to text
        .replace(/`([^`]+)`/g, "$1") // Remove inline code
        .trim();
      
      // Clamp to 48 chars
      if (title.length > 48) {
        title = title.substring(0, 45) + "...";
      }
      
      return title || "Untitled";
    }
  }
  return "Untitled";
}

export function normalizeCreatedAt(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw !== "string") return null;
  // If it's already ISO-like (has a "T"), trust it
  if (raw.includes("T")) {
    return raw;
  }
  // Common SQLite/SQL style: "YYYY-MM-DD HH:MM:SS"
  // Treat it as UTC by appending "Z" so Date parses consistently
  // and formatHourLabel will convert to local time for display.
  const trimmed = raw.trim();
  // Safe guard: expect "YYYY-MM-DD HH:MM:SS" or similar
  return trimmed.replace(" ", "T") + "Z";
}

export function formatHourLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const dayLabel = sameDay
    ? "Today"
    : isYesterday
    ? "Yesterday"
    : d.toLocaleDateString();
  const hourLabel = d.toLocaleTimeString([], {
    hour: "numeric",
  });
  return `${dayLabel} • ${hourLabel}`;
}

export function scrollToHour(
  container: HTMLDivElement,
  target: HTMLDivElement
) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const currentTop = container.scrollTop;
  const offset = targetRect.top - containerRect.top;
  // Adjust for sticky header / padding (tweak if needed)
  const PADDING_ABOVE = 48;
  container.scrollTo({
    top: currentTop + offset - PADDING_ABOVE,
    behavior: "smooth",
  });
}

const AUTO_TITLE_MAX_CHARS = 30;

export function clampAutoTitle(raw: string): string {
  const s = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "New Chat";

  // If already ≤30 chars, just clean trailing punctuation and return
  if (s.length <= AUTO_TITLE_MAX_CHARS) {
    const cleaned = s.replace(/[\s\-:;,.!?]+$/g, "");
    return cleaned || "New Chat";
  }

  // Drop trailing words until it fits
  const words = s.split(" ");
  let result = words.join(" ");
  
  while (result.length > AUTO_TITLE_MAX_CHARS && words.length > 1) {
    words.pop();
    result = words.join(" ");
  }

  // If still too long after dropping all words except one, hard-slice to 30
  if (result.length > AUTO_TITLE_MAX_CHARS) {
    result = result.slice(0, AUTO_TITLE_MAX_CHARS).trimEnd();
  }

  // Strip trailing punctuation/spaces (never append "…")
  const cleaned = result.replace(/[\s\-:;,.!?]+$/g, "");
  return cleaned || "New Chat";
}

export function makeAutoTitle(text: string): string {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!cleaned) return "New Chat";

  // Take first ~6 words, then clamp (clampAutoTitle enforces the hard max).
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return clampAutoTitle(words);
}

export function makeAutoTitleFromAssistant(text: string): string {
  let cleaned = String(text || "").trim();
  if (!cleaned) return "New Chat";

  // Remove code blocks (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  
  // Strip markdown: headers (#), bold/italic (*, _), links [text](url), images ![alt](url)
  cleaned = cleaned
    .replace(/^#{1,6}\s+/gm, "") // Remove markdown headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Remove bold
    .replace(/\*([^*]+)\*/g, "$1") // Remove italic
    .replace(/__([^_]+)__/g, "$1") // Remove bold (underscore)
    .replace(/_([^_]+)_/g, "$1") // Remove italic (underscore)
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Remove links, keep text
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "") // Remove images
    .replace(/`([^`]+)`/g, "$1") // Remove inline code
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/[\r\n]+/g, " ") // Replace newlines with space
    .trim();

  if (!cleaned) return "New Chat";

  // Take first 6-10 meaningful words (filter out very short words)
  const words = cleaned.split(" ").filter(w => w.length > 2).slice(0, 10);
  if (words.length === 0) {
    // Fallback: use any words if all were too short
    const allWords = cleaned.split(" ").slice(0, 10);
    const joined = allWords.join(" ");
    return clampAutoTitle(joined);
  }

  const joined = words.join(" ");
  return clampAutoTitle(joined);
}

