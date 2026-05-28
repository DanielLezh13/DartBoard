import type Database from "better-sqlite3";
import { compressContextIfNeeded } from "@/lib/compression";
import { buildLYNXBootSequence } from "@/lib/LYNX_BOOT_SEQUENCE";
import { DartzModeId } from "@/lib/modes";
import {
  CONTEXT_LIMIT_TOKENS,
  estimateTokens,
  estimateTokensForMessages,
} from "@/lib/tokenEstimate";
import {
  buildSemanticMemoryContextBlock,
  findSemanticMemoryMatches,
} from "@/lib/memory/semantic";
import type {
  ChatStyleMessage,
  HistoryPolicy,
  SessionHistoryMessage,
} from "@/lib/context/types";

type OwnerContext = {
  column: "user_id" | "guest_id";
  value: string;
};

type BuildSessionContextBaseArgs = {
  db: Database.Database;
  sessionId: number;
  owner: OwnerContext;
  userId: string;
  mode?: DartzModeId;
  model: string;
  memoryFolder?: string | null;
  persistedFocusEnabled: boolean;
  persistedFocusGoal?: string;
};

type BuildSessionContextBaseResult = {
  attachedIds: number[];
  pinnedIds: number[];
  injectedMemoryIds: number[];
  finalSystemMessageContent: string;
  historyMessages: SessionHistoryMessage[];
  hasWebVerifiedHistory: boolean;
};

type AssemblePromptMessagesArgs = {
  db: Database.Database;
  openai: any;
  model: string;
  sessionId: number;
  owner: OwnerContext;
  finalSystemMessageContent: string;
  historyMessages: SessionHistoryMessage[];
  historyPolicy?: HistoryPolicy;
  userMessageContent: ChatStyleMessage["content"];
  webContextSystemMessage: string | null;
  hasWebVerifiedHistory: boolean;
  excludedSemanticMemoryIds?: number[];
};

type AssemblePromptMessagesResult = {
  messagesForOpenAI: ChatStyleMessage[];
  rollingSummary: string;
  recentHistoryCount: number;
  hasRollingSummary: boolean;
  contextCurrentTokens: number;
  contextMaxTokens: number;
  contextUsageRatio: number;
  semanticMemoryIds: number[];
};

function parseMessageMeta(rawMeta: string | null | undefined): Record<string, unknown> | null {
  if (!rawMeta) return null;
  try {
    const parsed = JSON.parse(rawMeta);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isWebVerifiedMeta(rawMeta: string | null | undefined): boolean {
  const parsed = parseMessageMeta(rawMeta);
  return Boolean(parsed && parsed.web_verified === true);
}

export async function buildSessionContextBase({
  db,
  sessionId,
  owner,
  userId,
  mode,
  model,
  memoryFolder,
  persistedFocusEnabled,
  persistedFocusGoal,
}: BuildSessionContextBaseArgs): Promise<BuildSessionContextBaseResult> {
  let injectedMemoryIds: number[] = [];

  const attachedIds = db
    .prepare(
      `SELECT memory_id FROM session_memory_attachments
       WHERE session_id = ? AND is_enabled = 1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(sessionId)
    .map((row) => (row as any).memory_id as number);

  const pinnedIds = db
    .prepare(
      `SELECT memory_id FROM session_memory_attachments
       WHERE session_id = ? AND is_enabled = 1 AND COALESCE(is_pinned,0)=1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(sessionId)
    .map((row) => (row as any).memory_id as number);

  const systemMessageContent = await buildLYNXBootSequence({
    mode,
    modelId: model,
    focusEnabled: persistedFocusEnabled,
    focusGoal: persistedFocusEnabled ? persistedFocusGoal : undefined,
    focusIntensity: "lockdown",
    memoryFolder,
    attachedMemoryIds: pinnedIds,
    db,
    onInjectedMemoryIds: (ids) => {
      injectedMemoryIds = ids;
    },
    userId,
    memoryOwnerColumn: owner.column,
    memoryOwnerValue: owner.value,
  });

  await compressContextIfNeeded(sessionId);

  const summaryMessages = db
    .prepare(
      `SELECT role, content
       FROM messages
       WHERE session_id = ? AND role = 'system_summary'
       ORDER BY created_at ASC`
    )
    .all(sessionId) as Array<{ role: string; content: string }>;

  let lastSummarizedId = 0;
  if (summaryMessages.length > 0) {
    const lastSummary = db
      .prepare(
        `SELECT meta
         FROM messages
         WHERE session_id = ? AND role = 'system_summary'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(sessionId) as { meta: string | null } | undefined;

    if (lastSummary?.meta) {
      try {
        const meta = JSON.parse(lastSummary.meta) as { summarizedUntilId: number };
        lastSummarizedId = meta.summarizedUntilId;
      } catch (error) {
        console.warn("Failed to parse summary meta:", error);
      }
    }
  }

  const recentMessages = db
    .prepare(
      `SELECT id, role, content, meta
       FROM messages
       WHERE session_id = ?
         AND role != 'system_summary'
         AND role != 'system'
         AND id > ?
       ORDER BY created_at ASC
       LIMIT 20`
    )
    .all(sessionId, lastSummarizedId) as Array<{
      id: number;
      role: string;
      content: string;
      meta: string | null;
    }>;

  const historyMessages: SessionHistoryMessage[] = [];
  let hasWebVerifiedHistory = false;

  for (const summary of summaryMessages) {
    historyMessages.push({
      role: "system",
      content: `[Previous conversation summary]: ${summary.content}`,
    });
  }

  for (const message of recentMessages) {
    if (message.role === "user" || message.role === "assistant") {
      const isWebVerified = message.role === "assistant" && isWebVerifiedMeta(message.meta);
      if (isWebVerified) {
        hasWebVerifiedHistory = true;
      }
      historyMessages.push({
        role: message.role as "user" | "assistant",
        content: isWebVerified ? `[WEB_VERIFIED]\n${message.content}` : message.content,
        id: message.id,
      });
    }
  }

  return {
    attachedIds,
    pinnedIds,
    injectedMemoryIds,
    finalSystemMessageContent: systemMessageContent,
    historyMessages,
    hasWebVerifiedHistory,
  };
}

export async function assemblePromptMessages({
  db,
  openai,
  model,
  sessionId,
  owner,
  finalSystemMessageContent,
  historyMessages,
  historyPolicy,
  userMessageContent,
  webContextSystemMessage,
  hasWebVerifiedHistory,
  excludedSemanticMemoryIds = [],
}: AssemblePromptMessagesArgs): Promise<AssemblePromptMessagesResult> {
  const COMPACT_TRIGGER_RATIO = 0.9;
  const COMPACT_TARGET_RATIO = 0.65;
  const SAFETY_RESERVE_TOKENS = Math.max(200, Math.floor(CONTEXT_LIMIT_TOKENS * 0.05));

  let rollingSummary = "";
  let summarizedUntilMessageId: number | null = null;

  try {
    const row = db
      .prepare(
        `SELECT rolling_summary, summarized_until_message_id
         FROM sessions
         WHERE id = ? AND ${owner.column} = ?`
      )
      .get(sessionId, owner.value) as
      | { rolling_summary?: string; summarized_until_message_id?: number }
      | undefined;
    rollingSummary = String(row?.rolling_summary ?? "");
    summarizedUntilMessageId = row?.summarized_until_message_id ?? null;
  } catch {
    rollingSummary = "";
    summarizedUntilMessageId = null;
  }

  const eligibleHistoryMessages = (() => {
    if (summarizedUntilMessageId === null) {
      return historyMessages;
    }
    const cutoffMessageId = summarizedUntilMessageId;
    return historyMessages.filter(
      (message) =>
        typeof message.id === "number" && message.id > cutoffMessageId
    );
  })();

  const webVerifiedContextRule = hasWebVerifiedHistory
    ? "Conversation rule: messages prefixed with [WEB_VERIFIED] are trusted web-grounded facts from this chat. Treat them as ground truth over model cutoff priors while they remain in context."
    : null;

  const semanticQuery =
    typeof userMessageContent === "string"
      ? userMessageContent.trim()
      : userMessageContent
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();

  let semanticMemoryIds: number[] = [];
  let semanticMemoryContextMessage: ChatStyleMessage | null = null;

  if (semanticQuery.length > 0) {
    try {
      const semanticMatches = await findSemanticMemoryMatches({
        db,
        openai,
        owner,
        query: semanticQuery,
        excludeMemoryIds: excludedSemanticMemoryIds,
      });
      semanticMemoryIds = semanticMatches.map((match) => match.id);

      if (semanticMatches.length > 0) {
        semanticMemoryContextMessage = {
          role: "system",
          content: buildSemanticMemoryContextBlock(semanticMatches),
        };
      }
    } catch (error) {
      console.warn("Semantic memory retrieval failed:", error);
      semanticMemoryIds = [];
      semanticMemoryContextMessage = null;
    }
  }

  const calculateRawHistoryBudget = (summary: string): number => {
    const fixedMessages = [
      { role: "system" as const, content: finalSystemMessageContent },
      ...(webVerifiedContextRule ? [{ role: "system" as const, content: webVerifiedContextRule }] : []),
      ...(webContextSystemMessage ? [{ role: "system" as const, content: webContextSystemMessage }] : []),
      ...(semanticMemoryContextMessage ? [semanticMemoryContextMessage] : []),
      ...(summary.trim().length > 0
        ? [
            {
              role: "system" as const,
              content: `CONVERSATION SUMMARY (auto, compressed):\n${summary.trim()}`,
            },
          ]
        : []),
      { role: "user" as const, content: userMessageContent },
    ];

    const fixedOverheadTokens = estimateTokensForMessages(
      fixedMessages
        .filter((message) => typeof message.content === "string")
        .map((message) => ({ role: message.role, content: String(message.content) }))
    );

    const rawBudget = CONTEXT_LIMIT_TOKENS - fixedOverheadTokens - SAFETY_RESERVE_TOKENS;
    return Math.max(0, rawBudget);
  };

  const selectRecentHistory = (
    messages: SessionHistoryMessage[],
    tokenBudget: number
  ): { recent: SessionHistoryMessage[]; older: SessionHistoryMessage[] } => {
    const recent: SessionHistoryMessage[] = [];
    let usedTokens = 0;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const messageTokens = estimateTokens(String(message.content || ""));

      if (usedTokens + messageTokens <= tokenBudget) {
        recent.unshift(message);
        usedTokens += messageTokens;
      } else {
        break;
      }
    }

    const older = messages.slice(0, messages.length - recent.length);
    return { recent, older };
  };

  const buildMessages = (
    summary: string,
    recentHistory: SessionHistoryMessage[]
  ): ChatStyleMessage[] => {
    const summaryMessage =
      summary.trim().length > 0
        ? {
            role: "system" as const,
            content: `CONVERSATION SUMMARY (auto, compressed):\n${summary.trim()}`,
          }
        : null;

    if (historyPolicy === "none") {
      return [
        { role: "system", content: finalSystemMessageContent },
        ...(webVerifiedContextRule ? [{ role: "system" as const, content: webVerifiedContextRule }] : []),
        ...(webContextSystemMessage ? [{ role: "system" as const, content: webContextSystemMessage }] : []),
        ...(semanticMemoryContextMessage ? [semanticMemoryContextMessage] : []),
        { role: "user", content: userMessageContent },
      ];
    }

    return [
      { role: "system", content: finalSystemMessageContent },
      ...(webVerifiedContextRule ? [{ role: "system" as const, content: webVerifiedContextRule }] : []),
      ...(webContextSystemMessage ? [{ role: "system" as const, content: webContextSystemMessage }] : []),
      ...(semanticMemoryContextMessage ? [semanticMemoryContextMessage] : []),
      ...(summaryMessage ? [summaryMessage] : []),
      ...recentHistory,
      { role: "user", content: userMessageContent },
    ];
  };

  let rawBudget = calculateRawHistoryBudget(rollingSummary);
  const historySelection = selectRecentHistory(eligibleHistoryMessages, rawBudget);
  let recentHistoryMessages = historySelection.recent;
  let olderHistoryMessages = historySelection.older;
  let messagesForOpenAI = buildMessages(rollingSummary, recentHistoryMessages);

  try {
    let compactPasses = 0;
    const maxCompactionPasses = 2;

    while (compactPasses < maxCompactionPasses) {
      const estimatedTokens = estimateTokensForMessages(
        messagesForOpenAI
          .filter((message) => typeof message.content === "string")
          .map((message) => ({ role: message.role, content: String(message.content) }))
      );

      const ratio = CONTEXT_LIMIT_TOKENS > 0 ? estimatedTokens / CONTEXT_LIMIT_TOKENS : 0;
      const shouldCompact =
        historyPolicy !== "none" &&
        ratio >= COMPACT_TRIGGER_RATIO &&
        olderHistoryMessages.length > 0 &&
        compactPasses < maxCompactionPasses;

      if (!shouldCompact) {
        if (ratio <= COMPACT_TARGET_RATIO || olderHistoryMessages.length === 0) {
          break;
        }
        if (compactPasses > 0 && ratio < COMPACT_TRIGGER_RATIO) {
          break;
        }
      }

      const compactInput = olderHistoryMessages
        .map((message) => `${String(message.role).toUpperCase()}: ${typeof message.content === "string" ? message.content : ""}`)
        .join("\n\n");

      const compactSystem =
        "You maintain a rolling conversation summary for an ongoing chat. " +
        "Update the summary using ONLY the messages provided. " +
        "Preserve: names, decisions, constraints, preferences, open tasks, and any user-specific rules. " +
        "Do not invent details. Keep it concise.";

      const compactUser =
        (rollingSummary.trim().length ? `EXISTING SUMMARY:\n${rollingSummary.trim()}\n\n` : "") +
        `NEW MESSAGES TO ABSORB INTO SUMMARY:\n${compactInput}`;

      const compactResponse = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: compactSystem },
          { role: "user", content: compactUser },
        ],
        temperature: 0.2,
      });

      const nextSummary = String(compactResponse.choices?.[0]?.message?.content ?? "").trim();

      if (nextSummary.length) {
        rollingSummary = nextSummary;

        const highestCompactedMessageId = olderHistoryMessages.reduce((highest: number | null, message) => {
          const messageId = message.id;
          if (typeof messageId === "number") {
            return highest !== null ? Math.max(highest, messageId) : messageId;
          }
          return highest;
        }, null);

        try {
          db.prepare(
            `UPDATE sessions
             SET rolling_summary = ?, summarized_until_message_id = ?
             WHERE id = ? AND ${owner.column} = ?`
          ).run(rollingSummary, highestCompactedMessageId, sessionId, owner.value);
        } catch {
          // ignore persistence failures and continue with in-memory summary
        }

        summarizedUntilMessageId = highestCompactedMessageId;

        const newEligibleHistory =
          highestCompactedMessageId !== null
            ? historyMessages.filter(
                (message) =>
                  typeof message.id === "number" && message.id > highestCompactedMessageId
              )
            : historyMessages;

        rawBudget = calculateRawHistoryBudget(rollingSummary);
        const newSelection = selectRecentHistory(newEligibleHistory, rawBudget);
        recentHistoryMessages = newSelection.recent;
        olderHistoryMessages = newSelection.older;
        messagesForOpenAI = buildMessages(rollingSummary, recentHistoryMessages);
      }

      compactPasses += 1;
    }

    let finalTokens = estimateTokensForMessages(
      messagesForOpenAI
        .filter((message) => typeof message.content === "string")
        .map((message) => ({ role: message.role, content: String(message.content) }))
    );

    let finalRatio = CONTEXT_LIMIT_TOKENS > 0 ? finalTokens / CONTEXT_LIMIT_TOKENS : 0;

    while (finalRatio > 1.0 && recentHistoryMessages.length > 0) {
      recentHistoryMessages.shift();
      messagesForOpenAI = buildMessages(rollingSummary, recentHistoryMessages);
      finalTokens = estimateTokensForMessages(
        messagesForOpenAI
          .filter((message) => typeof message.content === "string")
          .map((message) => ({ role: message.role, content: String(message.content) }))
      );
      finalRatio = CONTEXT_LIMIT_TOKENS > 0 ? finalTokens / CONTEXT_LIMIT_TOKENS : 0;
    }
  } catch {
    // Keep the current prompt assembly if compaction fails.
  }

  const messagesForEstimation = messagesForOpenAI.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
  }));

  const contextCurrentTokens = estimateTokensForMessages(messagesForEstimation);
  const contextMaxTokens = CONTEXT_LIMIT_TOKENS;
  const contextUsageRatio = Math.min(contextCurrentTokens / contextMaxTokens, 1);

  return {
    messagesForOpenAI,
    rollingSummary,
    recentHistoryCount: recentHistoryMessages.length,
    hasRollingSummary: rollingSummary.trim().length > 0,
    contextCurrentTokens,
    contextMaxTokens,
    contextUsageRatio,
    semanticMemoryIds,
  };
}
