import { marked } from "marked";

export type ClipboardPayload = {
  html: string;
  plain: string;
};

type BuildClipboardPayloadInput = {
  markdown: string;
  fallbackElement?: HTMLElement | null;
};

const INTERACTIVE_SELECTOR = 'button, [role="button"], [data-copy-exclude="true"]';
const CODE_COPY_BUTTON_SELECTOR = 'button[aria-label="Copy code"]';

function stripInteractiveNodes(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(INTERACTIVE_SELECTOR).forEach((n) => n.remove());
  clone.querySelectorAll(CODE_COPY_BUTTON_SELECTOR).forEach((n) => n.remove());
  return clone;
}

export function getPlainTextFromRenderedElement(
  el: HTMLElement | null | undefined,
  fallback: string
): string {
  if (!el) return fallback;
  const clone = stripInteractiveNodes(el);
  return (clone.innerText || clone.textContent || "").trim() || fallback;
}

function getPlainTextFromHtml(html: string, fallback: string): string {
  if (typeof document !== "undefined") {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.innerText || tmp.textContent || "").trim() || fallback;
  }
  const stripped = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return stripped || fallback;
}

export async function buildClipboardPayload({
  markdown,
  fallbackElement,
}: BuildClipboardPayloadInput): Promise<ClipboardPayload> {
  let html = "";
  try {
    const rendered = await Promise.resolve(marked.parse(markdown || ""));
    html = typeof rendered === "string" ? rendered : String(rendered);
  } catch (err) {
    console.warn("markdown->html copy conversion failed; falling back to rendered DOM", err);
  }

  if (!html && fallbackElement) {
    html = stripInteractiveNodes(fallbackElement).innerHTML;
  }

  const wrappedHtml = `<div>${html || ""}</div>`;
  const plain = getPlainTextFromHtml(wrappedHtml, markdown || "");
  return { html: wrappedHtml, plain };
}
