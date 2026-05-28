export type ChatContextAuditManifest = {
  sessionId: number;
  mode: "chat" | "search";
  attachedMemoryIds: number[];
  injectedMemoryIds: number[];
  semanticMemoryIds: number[];
  clientAttachedMemoryIds: number[];
  historyPolicy?: "full" | "none";
  recentHistoryCount: number;
  hasRollingSummary: boolean;
};

type BuildChatContextAuditManifestArgs = {
  sessionId: number;
  searchQuery?: string;
  attachedMemoryIds: number[];
  injectedMemoryIds: number[];
  semanticMemoryIds: number[];
  clientAttachedMemoryIds?: number[];
  historyPolicy?: "full" | "none";
  recentHistoryCount: number;
  hasRollingSummary: boolean;
};

type BuildChatContextAuditHeadersArgs = {
  mode: ChatContextAuditManifest["mode"];
  attachedMemoryIds: number[];
  injectedMemoryIds: number[];
  semanticMemoryIds: number[];
  clientAttachedMemoryIds?: number[];
};

type BuildChatContextMetricsArgs = {
  contextCurrentTokens: number;
  contextMaxTokens: number;
  contextUsageRatio: number;
};

export function buildChatContextAuditManifest({
  sessionId,
  searchQuery,
  attachedMemoryIds,
  injectedMemoryIds,
  semanticMemoryIds,
  clientAttachedMemoryIds = [],
  historyPolicy,
  recentHistoryCount,
  hasRollingSummary,
}: BuildChatContextAuditManifestArgs): ChatContextAuditManifest {
  return {
    sessionId,
    mode: searchQuery ? "search" : "chat",
    attachedMemoryIds,
    injectedMemoryIds,
    semanticMemoryIds,
    clientAttachedMemoryIds,
    historyPolicy,
    recentHistoryCount,
    hasRollingSummary,
  };
}

export function buildChatContextAuditHeaders({
  mode,
  attachedMemoryIds,
  injectedMemoryIds,
  semanticMemoryIds,
  clientAttachedMemoryIds = [],
}: BuildChatContextAuditHeadersArgs): Record<string, string> {
  return {
    "X-CTX-attached": JSON.stringify(attachedMemoryIds.slice(0, 50)),
    "X-CTX-injected": JSON.stringify(injectedMemoryIds.slice(0, 50)),
    "X-CTX-semantic": JSON.stringify(semanticMemoryIds.slice(0, 50)),
    "X-CTX-client-attached": JSON.stringify(clientAttachedMemoryIds.slice(0, 50)),
    "X-CTX-mode": mode,
    "X-CTX-attached-count": attachedMemoryIds.length.toString(),
    "X-CTX-injected-count": injectedMemoryIds.length.toString(),
    "X-CTX-semantic-count": semanticMemoryIds.length.toString(),
  };
}

export function buildChatContextMetricsEvent({
  contextCurrentTokens,
  contextMaxTokens,
  contextUsageRatio,
}: BuildChatContextMetricsArgs) {
  return {
    type: "context_metrics" as const,
    context_current_tokens: contextCurrentTokens,
    context_max_tokens: contextMaxTokens,
    context_usage_ratio: contextUsageRatio,
  };
}
