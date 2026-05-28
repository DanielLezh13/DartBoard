import { Extension } from "@tiptap/core";

export const LINE_HEIGHT_CHOICES = ["1", "1.15", "1.5", "2"] as const;
export const LINE_HEIGHT_DEFAULT = "default";

const LINE_HEIGHT_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "tableCell",
  "tableHeader",
] as const;

type LineHeightChoice = (typeof LINE_HEIGHT_CHOICES)[number];

function isLineHeightChoice(value: string): value is LineHeightChoice {
  return (LINE_HEIGHT_CHOICES as readonly string[]).includes(value);
}

interface LineHeightOptions {
  types: string[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: LineHeightChoice | null) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const LineHeight = Extension.create<LineHeightOptions>({
  name: "lineHeight",

  addOptions() {
    return {
      types: [...LINE_HEIGHT_TYPES],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => {
              const raw = (element as HTMLElement).style.lineHeight?.trim() || "";
              return isLineHeightChoice(raw) ? raw : null;
            },
            renderHTML: (attributes) => {
              const value = attributes?.lineHeight;
              if (typeof value !== "string" || !isLineHeightChoice(value)) {
                return {};
              }
              return { style: `line-height: ${value}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value) =>
        ({ commands }) =>
          this.options.types.every((type) =>
            commands.updateAttributes(type, { lineHeight: value ?? null })
          ),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.every((type) =>
            commands.updateAttributes(type, { lineHeight: null })
          ),
    };
  },
});

export function getEditorLineHeight(editor: any): typeof LINE_HEIGHT_DEFAULT | LineHeightChoice {
  if (!editor || editor.isDestroyed) return LINE_HEIGHT_DEFAULT;
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (!LINE_HEIGHT_TYPES.includes(node.type.name as (typeof LINE_HEIGHT_TYPES)[number])) {
      continue;
    }
    const value = node?.attrs?.lineHeight;
    if (typeof value === "string" && isLineHeightChoice(value)) {
      return value;
    }
    return LINE_HEIGHT_DEFAULT;
  }
  return LINE_HEIGHT_DEFAULT;
}
