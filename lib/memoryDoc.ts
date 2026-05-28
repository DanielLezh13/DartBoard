export type MemoryDocNode = {
  type?: string;
  text?: string;
  content?: MemoryDocNode[];
  [key: string]: unknown;
};

export type MemoryDoc = {
  type?: string;
  content?: MemoryDocNode[];
  [key: string]: unknown;
};

export function parseMemoryDocJson(input: unknown): MemoryDoc | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? (parsed as MemoryDoc) : null;
    } catch {
      return null;
    }
  }
  if (typeof input === "object") {
    return input as MemoryDoc;
  }
  return null;
}

export function normalizeMemoryDocJson(input: unknown): string | null {
  const doc = parseMemoryDocJson(input);
  if (!doc) return null;
  try {
    return JSON.stringify(doc);
  } catch {
    return null;
  }
}

const TABLE_NODE_TYPES = new Set(["table", "tableRow", "tableCell", "tableHeader"]);

function walkNode(node: unknown, visitor: (node: MemoryDocNode) => void): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  visitor(obj as MemoryDocNode);
  const content = obj.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      walkNode(child, visitor);
    }
  }
}

export function hasTableInMemoryDoc(input: unknown): boolean {
  const doc = parseMemoryDocJson(input);
  if (!doc) return false;
  let found = false;
  walkNode(doc, (node) => {
    if (found) return;
    if (typeof node.type === "string" && TABLE_NODE_TYPES.has(node.type)) {
      found = true;
    }
  });
  return found;
}

export function getMemoryDocPlainText(input: unknown): string {
  const doc = parseMemoryDocJson(input);
  if (!doc) return "";
  const chunks: string[] = [];
  walkNode(doc, (node) => {
    if (typeof node.text === "string" && node.text.length > 0) {
      chunks.push(node.text);
    }
  });
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
