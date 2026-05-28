export type HistoryPolicy = "full" | "none";

export type ChatStyleContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

export type ChatStyleMessage = {
  role: "user" | "assistant" | "system";
  content: string | ChatStyleContentPart[];
};

export type SessionHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  id?: number;
};
