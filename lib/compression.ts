import { getDb } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openai";

/**
 * Compress context by summarizing the first 20 messages when a session has 40+ messages.
 * Saves the summary as a system_summary message and tracks which messages were summarized.
 */
export async function compressContextIfNeeded(sessionId: number | string): Promise<void> {
  const db = getDb();

  // Count total regular messages (excluding system_summary messages)
  const totalCount = db
    .prepare(
      `SELECT COUNT(*) as count 
       FROM messages 
       WHERE session_id = ? AND role != 'system_summary' AND role != 'system'`
    )
    .get(sessionId) as { count: number } | undefined;

  if (!totalCount || totalCount.count < 40) {
    return; // No compression needed
  }

  // Check if compression has already been done (if there's a system_summary message)
  const existingSummary = db
    .prepare(
      `SELECT id, meta 
       FROM messages 
       WHERE session_id = ? AND role = 'system_summary' 
       ORDER BY created_at DESC 
       LIMIT 1`
    )
    .get(sessionId) as { id: number; meta: string | null } | undefined;

  if (existingSummary && existingSummary.meta) {
    try {
      // Parse which messages were already summarized
      const meta = JSON.parse(existingSummary.meta) as { summarizedUntilId: number };
      const summarizedUntilId = meta.summarizedUntilId;

      // Get the count of messages after the last summary
      const messagesAfterSummary = db
        .prepare(
          `SELECT COUNT(*) as count 
           FROM messages 
           WHERE session_id = ? 
           AND role != 'system_summary' 
           AND role != 'system'
           AND id > ?`
        )
        .get(sessionId, summarizedUntilId) as { count: number } | undefined;

      // Only compress if we have 20+ new messages since last compression
      if (!messagesAfterSummary || messagesAfterSummary.count < 20) {
        return; // Already compressed, and not enough new messages
      }
    } catch (e) {
      // If meta parsing fails, proceed with compression
      console.warn("Failed to parse summary meta, proceeding with compression:", e);
    }
  }

  // Get the first 20 regular messages (excluding system_summary) that haven't been summarized
  let messagesToSummarize: Array<{ id: number; role: string; content: string }>;
  
  if (existingSummary && existingSummary.meta) {
    try {
      const meta = JSON.parse(existingSummary.meta) as { summarizedUntilId: number };
      messagesToSummarize = db
        .prepare(
          `SELECT id, role, content 
           FROM messages 
           WHERE session_id = ? 
           AND role != 'system_summary' 
           AND role != 'system'
           AND id > ?
           ORDER BY created_at ASC 
           LIMIT 20`
        )
        .all(sessionId, meta.summarizedUntilId) as Array<{ id: number; role: string; content: string }>;
    } catch (e) {
      // Fallback if meta parsing fails
      messagesToSummarize = db
        .prepare(
          `SELECT id, role, content 
           FROM messages 
           WHERE session_id = ? 
           AND role != 'system_summary' 
           AND role != 'system'
           ORDER BY created_at ASC 
           LIMIT 20`
        )
        .all(sessionId) as Array<{ id: number; role: string; content: string }>;
    }
  } else {
    messagesToSummarize = db
      .prepare(
        `SELECT id, role, content 
         FROM messages 
         WHERE session_id = ? 
         AND role != 'system_summary' 
         AND role != 'system'
         ORDER BY created_at ASC 
         LIMIT 20`
      )
      .all(sessionId) as Array<{ id: number; role: string; content: string }>;
  }

  if (messagesToSummarize.length < 20) {
    return; // Not enough messages to summarize
  }

  // Build conversation text for summarization
  const conversationText = messagesToSummarize
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  // Generate summary using OpenAI
  const openai = getOpenAIClient();
  const model = "gpt-4o-mini";

  const summaryPrompt = `Summarize the following conversation, preserving key information, decisions, and context that would be important for continuing the conversation:

${conversationText}

Provide a concise summary that captures the essential information:`;

  try {
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that creates concise summaries of conversations while preserving important context and information.",
        },
        {
          role: "user",
          content: summaryPrompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent summaries
    });

    const summary = completion.choices[0]?.message?.content;

    if (!summary) {
      console.error("Failed to generate summary");
      return;
    }

    // Get the last message ID that was summarized
    const lastSummarizedId = messagesToSummarize[messagesToSummarize.length - 1].id;

    // Save the summary as a system_summary message
    db.prepare(
      `INSERT INTO messages (session_id, role, content, model, meta) 
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      "system_summary",
      summary,
      model,
      JSON.stringify({ summarizedUntilId: lastSummarizedId })
    );

  } catch (error) {
    console.error("Error compressing context:", error);
    // Don't throw - compression failure shouldn't break the chat
  }
}
