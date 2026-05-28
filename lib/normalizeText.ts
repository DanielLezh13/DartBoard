/**
 * Normalize text content from ChatGPT exports
 * Preserves markdown structure while stripping citation tokens
 */
import { stripExportArtifacts } from "@/lib/stripExportArtifacts";

/**
 * Normalize text content from various formats
 * 
 * Preserves:
 * - Markdown structure (headings, lists, horizontal rules, blockquotes, emojis)
 * - Line breaks and paragraph structure
 * 
 * Removes:
 * - ChatGPT citation tokens like <cite:...>
 * - Trailing whitespace on lines
 * - Excessive blank lines (3+ → 2)
 */
export function normalizeText(raw: unknown, _debug = false): string {
  // Handle null/undefined
  if (raw === null || raw === undefined) return "";

  // Convert to string if needed
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    // Handle arrays: normalize each part and join with newlines to preserve structure
    const normalized = raw
      .map((part) => {
        if (typeof part === "string") {
          return normalizeText(part, false); // Recursive - normalize each string
        }
        if (typeof part === "object" && part !== null) {
          // If object has text/content fields, normalize those recursively
          if (part.text) {
            return normalizeText(part.text, false);
          }
          if (part.content) {
            return normalizeText(part.content, false);
          }
          // Skip citation objects silently (they'll be removed by <cite:...> regex)
          return "";
        }
        return "";
      })
      .filter((part) => part.length > 0) // Remove empty strings
      .join("\n\n"); // Join with double newlines to preserve paragraph structure
    
    text = normalized;
  } else if (typeof raw === "object" && raw !== null) {
    // Narrow unknown object safely
    const obj = raw as Record<string, unknown>;

    if (typeof obj.text === "string") {
      return normalizeText(obj.text, false);
    }
    if (typeof obj.content === "string") {
      return normalizeText(obj.content, false);
    }

    // Fallback: stringify and normalize
    text = JSON.stringify(obj);
  } else {
    text = String(raw);
  }

  // Normalize line endings (but preserve line breaks)
  text = text.replace(/\r\n/g, "\n");

  // Strip private-use/replacement glyph artifacts from exports.
  text = stripExportArtifacts(text);

  // Strip ChatGPT citation tokens
  // Remove <cite:...> format
  text = text.replace(/<cite:[^>]*>/g, "");
  
  // Remove entity blocks: entity["tv_show", "Physical: Asia", 0] or entity≡[...] or entity[...]
  // Match: entity + optional special chars (≡, =, etc.) + [ + content + ]
  text = text.replace(/entity[^\[]*\[[^\]]*\]/gi, "");
  
  // Remove old citation formats: cite turn0search13, citeturn0search13, etc.
  // Pattern: "cite" + optional space + "turn" + digits + word chars (search, reddit, etc.)
  text = text.replace(/\bcite\s*turn\d+\w+/gi, "");
  // Also catch no-space variant: citeturn0search24, citeturn0reddit17
  text = text.replace(/citeturn\d+\w+/gi, "");
  // Catch standalone turn patterns (remnants): turn0search13, turn0reddit17
  text = text.replace(/\bturn\d+\w+/g, "");
  
  // Remove empty cite tags: cite or cite with special characters
  // This catches standalone "cite" that might be left over
  text = text.replace(/\bcite\b/gi, "");

  // Optional: collapse 3+ newlines into 2, but never remove all breaks
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim trailing whitespace on each line (preserves line breaks)
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n");

  // Final trim (removes leading/trailing whitespace from entire string)
  text = text.trim();

  return text;
}
