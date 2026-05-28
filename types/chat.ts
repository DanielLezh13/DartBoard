export type ChatMessage = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  image_urls?: string[];
  created_at?: string | null;
  is_placeholder?: boolean;
  session_id?: number | null;
  message_id?: number | null;
  meta?: {
    sources?: Array<{ title?: string; url: string; label?: string }>;
    [key: string]: unknown;
  } | null;
};

export interface Session {
  id: number;
  title: string | null;
  created_at: string;
  updated_at?: string | null;
  mode?: string | null;
}

export type DraftMemory = {
  id?: number; // Optional id for drafts (can be -1 or undefined)
  title: string;
  summary: string;
  doc_json?: unknown;
  session_id: number | null;
  message_id: number | null;
  folder_id?: number | null; // Optional folder context
  excerpt?: string | null; // Optional excerpt
  created_at?: string; // Optional created_at for UI consistency
  message_created_at?: string; // Optional message_created_at for UI consistency
  folder_name?: string | null; // Optional folder_name for compatibility
  _isTitleGenerating?: boolean; // Internal flag while async title is being generated
  _isOptimisticTitle?: boolean; // Internal flag to track optimistic titles
};

export type AnyMessage = {
  id: number | string;
  role: string;
  content: string;
  created_at?: string | null;
  createdAt?: string | null;
};

export type MessageGroup = {
  id: string;
  role: string;
  items: AnyMessage[];
  lastCreatedAt: string | null;
};

export type HourBucket = {
  hourKey: string; // e.g. "2025-12-04T09"
  label: string; // e.g. "Today • 9 AM"
  groups: MessageGroup[];
};
