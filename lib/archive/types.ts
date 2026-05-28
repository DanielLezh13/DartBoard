export interface ArchiveMessage {
  id: number;
  ts: string;
  role: "user" | "assistant";
  chat_id: string;
  text: string;
  source: string;
}
