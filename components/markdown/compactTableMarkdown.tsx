import type { Components } from "react-markdown";

type TableComponents = Pick<Components, "table" | "thead" | "th" | "td">;

export const compactTableMarkdownComponents: TableComponents = {
  table: ({ node, ...props }: any) => (
    <div className="mt-0 mb-3 last:mb-0">
      <div className="db-table-shell">
        <table className="db-compact-table" {...props} />
      </div>
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="db-compact-table-head" {...props} />,
  th: ({ node, ...props }: any) => <th className="db-compact-table-th" {...props} />,
  td: ({ node, ...props }: any) => <td className="db-compact-table-td" {...props} />,
};
