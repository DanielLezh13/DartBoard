import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/openai";
import { getDb, logTokenUsage } from "@/lib/db";
import { 
  CONTEXT_LIMIT_TOKENS, 
} from "@/lib/tokenEstimate";
import { MAX_INPUT_CHARS, MAX_IMAGES_PER_MESSAGE } from "@/lib/limits";
import { DartzModeId } from "@/lib/modes";
import type { ChatMessage } from "@/types/chat";
import { getServerScope } from "@/lib/scope-server";
import { getScopeOwner, parsePositiveInt } from "@/lib/ownership";
import {
  getDailyUsageCount,
  getScopePlanLimits,
  incrementDailyUsage,
} from "@/lib/plan";
import { enforceApiRateLimit } from "@/lib/rateLimit";
import { readFile } from "fs/promises";
import { basename, extname, join } from "path";
import { getPrivateUploadPath, sanitizeStoredUploadName } from "@/lib/uploads";
import {
  buildChatContextAuditHeaders,
  buildChatContextAuditManifest,
  buildChatContextMetricsEvent,
} from "@/lib/context/audit";
import { assemblePromptMessages, buildSessionContextBase } from "@/lib/context/assemble";
import type {
  ChatStyleContentPart,
  ChatStyleMessage,
  HistoryPolicy,
} from "@/lib/context/types";

export const dynamic = "force-dynamic";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const TAVILY_MAX_RESULTS = 5;
const TAVILY_EXTRACT_TOP_RESULTS = 1;
const TAVILY_SNIPPET_MAX_CHARS = 300;
const TAVILY_EXTRACT_MAX_CHARS = 3500;
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_WEB_MODEL_DEFAULT = "gemini-2.5-flash";
const GEMINI_WEB_MAX_OUTPUT_TOKENS = (() => {
  const parsed = Number(process.env.GEMINI_WEB_MAX_OUTPUT_TOKENS || 2048);
  return Number.isFinite(parsed) ? parsed : 2048;
})();

const TRACKING_QUERY_PARAM_KEYS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "dclid",
  "srsltid",
]);

type LocalTimeContext = {
  timeZone: string;
  dateIso: string;
  display: string;
};

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

type TavilyExtractResult = {
  url?: string;
  title?: string;
  content?: string;
  raw_content?: string;
  text?: string;
};

type GeminiGroundingChunk = {
  web?: { uri?: string; title?: string };
};

type GeminiGenerateContentResponse = {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: GeminiGroundingChunk[] };
    grounding_metadata?: { grounding_chunks?: GeminiGroundingChunk[] };
  }>;
};

function toResponsesInput(messages: ChatStyleMessage[]) {
  return messages.map((message) => {
    const textPartType = message.role === "assistant" ? "output_text" : "input_text";

    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: [{ type: textPartType, text: message.content }],
      };
    }

    const mappedContent: Array<
      { type: string; text: string } | { type: string; image_url: string }
    > = [];
    for (const part of message.content) {
      if (part.type === "text") {
        mappedContent.push({ type: textPartType, text: part.text || "" });
        continue;
      }
      if (part.type === "image_url") {
        const url = part.image_url?.url;
        if (!url) continue;
        mappedContent.push({ type: "input_image", image_url: url });
      }
    }

    if (mappedContent.length === 0) {
      mappedContent.push({ type: textPartType, text: "" });
    }

    return {
      role: message.role,
      content: mappedContent,
    };
  });
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${baseUrl}${pathOrUrl}`;
}

function extractLocalUploadFilePath(pathOrUrl: string): string | null {
  let pathname: string | null = null;

  if (pathOrUrl.startsWith("/")) {
    pathname = pathOrUrl;
  } else if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    try {
      const parsed = new URL(pathOrUrl);
      pathname = parsed.pathname;
    } catch {
      pathname = null;
    }
  }

  if (!pathname) return null;

  if (pathname.startsWith("/api/upload/image/")) {
    const fileName = sanitizeStoredUploadName(basename(pathname));
    if (!fileName) return null;
    return getPrivateUploadPath(fileName);
  }

  if (!pathname.startsWith("/uploads/")) return null;

  // Upload route stores flat files in /public/uploads/<filename>
  const fileName = basename(pathname);
  if (!fileName) return null;
  return join(process.cwd(), "public", "uploads", fileName);
}

async function resolveImageUrlForModel(pathOrUrl: string): Promise<string> {
  const localUploadPath = extractLocalUploadFilePath(pathOrUrl);
  if (!localUploadPath) {
    return toAbsoluteUrl(pathOrUrl);
  }

  try {
    const fileBuffer = await readFile(localUploadPath);
    const mime =
      IMAGE_MIME_BY_EXT[extname(localUploadPath).toLowerCase()] || "image/png";
    return `data:${mime};base64,${fileBuffer.toString("base64")}`;
  } catch (error) {
    console.warn("[CHAT_ROUTE] Failed to read local upload for vision, falling back to URL:", {
      pathOrUrl,
      localUploadPath,
      error,
    });
    return toAbsoluteUrl(pathOrUrl);
  }
}

function resolveLocalTimeContext(
  maybeTimeZone: string | null | undefined,
  maybeNowIso: string | null | undefined
): LocalTimeContext {
  const now = (() => {
    if (!maybeNowIso) return new Date();
    const parsed = new Date(maybeNowIso);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  })();

  let timeZone = "UTC";
  if (maybeTimeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: maybeTimeZone }).format(now);
      timeZone = maybeTimeZone;
    } catch {
      timeZone = "UTC";
    }
  }

  const dateIso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const display = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(now);

  return { timeZone, dateIso, display };
}

function maybeUnwrapRedirectUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isKnownRedirectHost =
      host.endsWith("google.com") ||
      host.endsWith("googleusercontent.com") ||
      host.endsWith("vertexaisearch.cloud.google.com");
    const looksLikeRedirectPath = /redirect|\/url$/i.test(parsed.pathname);

    if (!isKnownRedirectHost && !looksLikeRedirectPath) {
      return trimmed;
    }

    const redirectKeys = ["url", "q", "target", "dest", "destination", "redirect", "redirect_url"];
    for (const key of redirectKeys) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;

      const decoded = (() => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      })();

      if (/^https?:\/\//i.test(decoded)) return decoded;
      if (/^https?:\/\//i.test(value)) return value;
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function stripTrackingParams(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING_QUERY_PARAM_KEYS.has(normalized)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function formatSourceLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return host;
    const shortPath = parts.slice(0, 2).join("/");
    const suffix = parts.length > 2 ? "/..." : "";
    const label = `${host}/${shortPath}${suffix}`;
    return label.length > 80 ? `${label.slice(0, 77)}...` : label;
  } catch {
    const compact = String(rawUrl || "").trim();
    return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  }
}

function normalizeSourceForDisplay(rawUrl: string): { raw: string; href: string; label: string } {
  const raw = String(rawUrl || "").trim();
  if (!raw) return { raw: "", href: "", label: "" };
  const unwrapped = maybeUnwrapRedirectUrl(raw);
  const href = stripTrackingParams(unwrapped);
  const label = formatSourceLabel(href);
  return { raw, href, label };
}

function stripTrailingSourcesSection(text: string): string {
  const input = String(text || "").trim();
  if (!input) return "";

  const marker = /(^|\n)\s*(?:[-*]\s*)?(?:#+\s*)?sources?\s*:/i;
  const match = marker.exec(input);
  if (!match) return input;
  if (match.index <= 0) return input;
  return input.slice(0, match.index).trim();
}

function shouldSkipWebForSmallTalk(message: string): boolean {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return true;

  // Obvious small-talk/pleasantries where web lookup is never useful.
  if (/^(hi|hey|yo|hello|sup|what'?s up|how are you|good (morning|afternoon|evening)|thanks?|thank you)[!. ]*$/i.test(text)) {
    return true;
  }

  // Keep the skip list intentionally small. If user armed Web, default should be to use it.
  if (/^(ok|okay|cool|nice|great|awesome|lol|lmao|yep|yup|sure|sounds good)[!. ]*$/i.test(text)) {
    return true;
  }

  return false;
}

async function searchWebWithTavily(query: string): Promise<{
  used: boolean;
  error?: string;
  results: Array<{ title: string; url: string; snippet: string; score: number | null }>;
}> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { used: false, error: "TAVILY_API_KEY is missing", results: [] };
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        // Tavily expects booleans for these flags; sending strings can cause HTTP 400.
        include_answer: false,
        max_results: TAVILY_MAX_RESULTS,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const detailSnippet = detail.replace(/\s+/g, " ").trim().slice(0, 200);
      return {
        used: false,
        error: `Tavily HTTP ${response.status}${detailSnippet ? `: ${detailSnippet}` : ""}`,
        results: [],
      };
    }

    const json = await response.json();
    const rawResults = (Array.isArray(json?.results) ? json.results : []) as TavilySearchResult[];
    const normalized = rawResults
      .map((result) => ({
        title: String(result?.title ?? "").trim(),
        url: String(result?.url ?? "").trim(),
        snippet: String(result?.content ?? "").replace(/\s+/g, " ").trim().slice(0, TAVILY_SNIPPET_MAX_CHARS),
        score: typeof result?.score === "number" ? result.score : null,
      }))
      .filter((result) => result.title.length > 0 && result.url.length > 0);

    if (normalized.length === 0) {
      return { used: false, error: "No web results returned", results: [] };
    }

    return { used: true, results: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Tavily error";
    return { used: false, error: message, results: [] };
  }
}

async function extractWebPagesWithTavily(urls: string[]): Promise<{
  used: boolean;
  error?: string;
  docs: Array<{ title: string; url: string; text: string }>;
}> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { used: false, error: "TAVILY_API_KEY is missing", docs: [] };
  }

  const candidateUrls = urls
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url));

  if (candidateUrls.length === 0) {
    return { used: false, error: "No URLs to extract", docs: [] };
  }

  const tryPayloads: Array<Record<string, unknown>> = [
    { api_key: apiKey, urls: candidateUrls },
    { api_key: apiKey, url: candidateUrls[0] },
  ];

  for (const payload of tryPayloads) {
    try {
      const response = await fetch(TAVILY_EXTRACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        continue;
      }

      const json = await response.json();
      const raw = Array.isArray(json?.results)
        ? json.results
        : Array.isArray(json?.data)
          ? json.data
          : json?.result
            ? [json.result]
            : [];
      const rawDocs = raw as TavilyExtractResult[];

      const docs = rawDocs
        .map((doc) => {
          const url = String(doc?.url ?? "").trim();
          const title = String(doc?.title ?? "").trim() || url;
          const baseText =
            String(doc?.raw_content ?? "").trim() ||
            String(doc?.content ?? "").trim() ||
            String(doc?.text ?? "").trim();
          const text = baseText.replace(/\s+/g, " ").trim().slice(0, TAVILY_EXTRACT_MAX_CHARS);
          return { title, url, text };
        })
        .filter((doc) => doc.url.length > 0 && doc.text.length > 0);

      if (docs.length > 0) {
        return { used: true, docs };
      }
    } catch {
      continue;
    }
  }

  return { used: false, error: "Tavily extract failed", docs: [] };
}

async function generateWithGeminiGoogleSearch(opts: {
  userText: string;
  systemInstruction: string;
  maxOutputTokens: number;
}): Promise<{
  used: boolean;
  error?: string;
  text: string;
  sources: Array<{ title: string; url: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { used: false, error: "GEMINI_API_KEY is missing", text: "", sources: [] };
  }

  const model = process.env.GEMINI_WEB_MODEL || GEMINI_WEB_MODEL_DEFAULT;
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: opts.systemInstruction }],
      },
      contents: [
        {
          parts: [{ text: opts.userText }],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: opts.maxOutputTokens,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const detailSnippet = detail.replace(/\s+/g, " ").trim().slice(0, 200);
    return {
      used: false,
      error: `Gemini HTTP ${response.status}${detailSnippet ? `: ${detailSnippet}` : ""}`,
      text: "",
      sources: [],
    };
  }

  const json = (await response.json()) as GeminiGenerateContentResponse;
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p) => String(p?.text || "")).join("").trim();

  const grounding =
    candidate?.groundingMetadata?.groundingChunks ||
    candidate?.grounding_metadata?.grounding_chunks ||
    [];

  const sources = grounding
    .map((chunk) => {
      const uri = String(chunk?.web?.uri || "").trim();
      const title = String(chunk?.web?.title || "").trim() || uri;
      return { title, url: uri };
    })
    .filter((s) => s.url.length > 0);

  if (!text) {
    return { used: false, error: "No reply from Gemini", text: "", sources: [] };
  }

  const usageMetadata = (json as any)?.usageMetadata ?? (json as any)?.usage_metadata;
  const promptTokenCount = Number(usageMetadata?.promptTokenCount ?? usageMetadata?.prompt_token_count ?? 0);
  const candidatesTokenCount = Number(usageMetadata?.candidatesTokenCount ?? usageMetadata?.candidates_token_count ?? 0);
  const totalTokenCount = Number(usageMetadata?.totalTokenCount ?? usageMetadata?.total_token_count ?? 0);

  const usage =
    Number.isFinite(promptTokenCount) && Number.isFinite(candidatesTokenCount) && Number.isFinite(totalTokenCount)
      ? {
          prompt_tokens: Math.max(0, Math.trunc(promptTokenCount)),
          completion_tokens: Math.max(0, Math.trunc(candidatesTokenCount)),
          total_tokens: Math.max(0, Math.trunc(totalTokenCount)),
        }
      : undefined;

  return { used: true, text, sources, usage };
}

function formatWebResultsForPrompt(
  localTime: LocalTimeContext,
  query: string,
  results: Array<{ title: string; url: string; snippet: string; score: number | null }>,
  docs: Array<{ title: string; url: string; text: string }>
): string {
  const extractedLines = docs.map((doc, index) => {
    return [
      `${index + 1}. ${doc.title}`,
      `URL: ${doc.url}`,
      `Extracted text: ${doc.text}`,
    ].join("\n");
  });

  const fallbackSearchLines = results.slice(0, 3).map((result, index) => {
    const scoreSuffix = result.score != null ? ` (score: ${result.score.toFixed(3)})` : "";
    return [
      `${index + 1}. ${result.title}${scoreSuffix}`,
      `URL: ${result.url}`,
      `Snippet: ${result.snippet || "(no snippet)"}`,
    ].join("\n");
  });

  return [
    "Web evidence pack (fresh external context):",
    `Query: ${query}`,
    `User local time: ${localTime.display} (${localTime.timeZone})`,
    `Treat "today" as: ${localTime.dateIso}`,
    "",
    "Primary extracted sources:",
    ...(extractedLines.length > 0 ? extractedLines : ["(none)"]),
    "",
    "Search leads:",
    ...(fallbackSearchLines.length > 0 ? fallbackSearchLines : ["(none)"]),
    "",
    "Hard rules for this response:",
    "1) Only state facts that appear in the extracted source text above.",
    "2) If the extracted text does not contain the requested fact, say exactly: Not found in sources.",
    "3) If constraints are missing (region/time/date), ask for them briefly.",
    "4) Do not output a 'Sources' section or raw URLs in the answer.",
    "5) Keep answer compact and complete (no trailing unfinished sentence).",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  try {
    // Get scope for authentication
    const scope = await getServerScope(request);
    
    const body = await request.json();
    const { 
      sessionId: rawSessionId, 
      userMessage, 
      mode, 
      memoryFolder,
      attachedMemoryIds,
      imageUrls,
      stream,
      historyPolicy,
      searchQuery,
      web,
    } = body as {
      sessionId: number | string;
      userMessage: string;
      mode?: DartzModeId;
      memoryFolder?: string | null;
      attachedMemoryIds?: number[];
      imageUrls?: string[];
      stream?: boolean;
      historyPolicy?: HistoryPolicy;
      searchQuery?: string;
      web?: boolean;
      userTimeZone?: string;
      userLocalNowIso?: string;
    };

    const normalizedUserMessage = typeof userMessage === "string" ? userMessage : "";
    const normalizedImageUrls = Array.isArray(imageUrls)
      ? imageUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [];
    const hasUserText = normalizedUserMessage.trim().length > 0;
    const hasImages = normalizedImageUrls.length > 0;
    const webRequested = Boolean(web);
    const webWouldAttempt = webRequested && !shouldSkipWebForSmallTalk(normalizedUserMessage);

    // Log incoming mode and historyPolicy
    if (!rawSessionId || (!hasUserText && !hasImages)) {
      return NextResponse.json(
        { error: "sessionId and either userMessage or imageUrls are required" },
        { status: 400 }
      );
    }

    const sessionId = parsePositiveInt(rawSessionId);
    if (sessionId === null) {
      return NextResponse.json(
        { error: "sessionId must be a positive integer" },
        { status: 400 }
      );
    }

    // Policy: guest cannot invoke chat/model calls.
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to send messages." },
        { status: 403 }
      );
    }
    const userId = scope.userId;
    const owner = getScopeOwner(scope);

    // Get database connection (used for both memories and chat history)
    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/chat", limit: 20, windowMs: 10 * 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }
    const { plan, limits } = getScopePlanLimits(db, scope);

    const maxInputChars = Number.isFinite(limits.maxInputChars)
      ? limits.maxInputChars
      : MAX_INPUT_CHARS;
    if (normalizedUserMessage.length > maxInputChars) {
      return NextResponse.json(
        { error: `Messages are limited to ${maxInputChars} characters.` },
        { status: 400 }
      );
    }

    const maxImagesPerMessage = Number.isFinite(limits.maxImagesPerMessage)
      ? limits.maxImagesPerMessage
      : MAX_IMAGES_PER_MESSAGE;
    if (normalizedImageUrls.length > maxImagesPerMessage) {
      return NextResponse.json(
        { error: `Too many images. Max ${maxImagesPerMessage} per message.` },
        { status: 400 }
      );
    }

    const localTimeContext = resolveLocalTimeContext(
      body.userTimeZone ?? request.headers.get("x-user-timezone"),
      body.userLocalNowIso
    );

    const model = limits.model;

    const sessionRow = db
      .prepare(
        `SELECT id, focus_goal, focus_enabled
         FROM sessions
         WHERE id = ? AND is_deleted = 0 AND ${owner.column} = ?`
      )
      .get(sessionId, owner.value) as
      | {
          id: number;
          focus_goal: string | null;
          focus_enabled: number | null;
        }
      | undefined;

    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Server-side anti-abuse guardrails (cannot be bypassed by client tampering).
    const turnsLastMinute = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM messages
         WHERE role = 'user'
           AND ${owner.column} = ?
           AND julianday(created_at) >= julianday('now') - (1.0 / 1440.0)`
      )
      .get(owner.value) as { count: number } | undefined;
    const perMinuteLimit = limits.chatTurnsPerMinute;
    if ((turnsLastMinute?.count ?? 0) >= perMinuteLimit) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const turnsLastDay = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM messages
         WHERE role = 'user'
           AND ${owner.column} = ?
           AND julianday(created_at) >= julianday('now') - 1.0`
      )
      .get(owner.value) as { count: number } | undefined;

    if ((turnsLastDay?.count ?? 0) >= limits.chatTurnsPerDay) {
      return NextResponse.json(
        { error: "Daily message cap reached. Please continue tomorrow." },
        { status: 429, headers: { "Retry-After": "86400" } }
      );
    }

    const dailyTokenUsage = db
      .prepare(
        `SELECT COALESCE(SUM(t.total_tokens), 0) AS used_tokens
         FROM token_usage t
         JOIN sessions s ON s.id = t.session_id
         WHERE s.user_id = ?
           AND julianday(t.created_at) >= julianday('now') - 1.0`
      )
      .get(userId) as { used_tokens: number } | undefined;

    if ((dailyTokenUsage?.used_tokens ?? 0) >= limits.dailyTokenBudget) {
      return NextResponse.json(
        { error: "Daily token budget reached. Please continue tomorrow." },
        { status: 429, headers: { "Retry-After": "86400" } }
      );
    }

    const usageRow = db
      .prepare(
        `SELECT COALESCE(SUM(total_tokens), 0) AS used_tokens
         FROM token_usage
         WHERE session_id = ?`
      )
      .get(sessionId) as { used_tokens: number } | undefined;
    if ((usageRow?.used_tokens ?? 0) >= limits.maxSessionTokens) {
      return NextResponse.json(
        { error: "This session reached the token limit. Start a new chat to continue." },
        { status: 403 }
      );
    }

    if (webWouldAttempt && !limits.webSearchEnabled) {
      return NextResponse.json(
        { error: "Web search is not available on your current plan." },
        { status: 403 }
      );
    }

    if (webWouldAttempt && Number.isFinite(limits.webSearchesPerDay)) {
      const webSearchesToday = getDailyUsageCount(db, userId, "web_search");
      if (webSearchesToday >= limits.webSearchesPerDay) {
        return NextResponse.json(
          { error: "Daily web search cap reached. Please continue tomorrow." },
          { status: 429, headers: { "Retry-After": "86400" } }
        );
      }
    }

    // Get OpenAI client (will throw if API key is missing)
    const openai = getOpenAIClient();

    const persistedFocusGoal =
      typeof sessionRow.focus_goal === "string" ? sessionRow.focus_goal.trim() : "";
    const persistedFocusEnabled =
      Number(sessionRow.focus_enabled || 0) === 1 && persistedFocusGoal.length > 0;
    const {
      attachedIds,
      pinnedIds,
      injectedMemoryIds,
      finalSystemMessageContent,
      historyMessages,
      hasWebVerifiedHistory,
    } = await buildSessionContextBase({
      db,
      sessionId,
      owner,
      userId,
      mode,
      model,
      memoryFolder,
      persistedFocusEnabled,
      persistedFocusGoal,
    });

    // Build messages array for OpenAI with system message first
    // Note: system_summary messages are already included in historyMessages as system role
    // If images are provided, format user message with image content
    let userMessageContent: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
    
    if (hasImages) {
      const modelImageUrls = await Promise.all(
        normalizedImageUrls.map((url) => resolveImageUrlForModel(url))
      );
      // Format message with images (vision-capable format)
      const contentParts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];
      if (hasUserText) {
        contentParts.push({ type: "text", text: normalizedUserMessage });
      }
      contentParts.push(
        ...modelImageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        }))
      );
      userMessageContent = contentParts;
    } else {
      userMessageContent = normalizedUserMessage;
    }

    // Save user message to database BEFORE calling OpenAI
    const userMessageText = typeof userMessageContent === "string" 
      ? userMessageContent 
      : userMessageContent.find((item) => item.type === "text")?.text || "";
    const userImagePathsJson = hasImages ? JSON.stringify(normalizedImageUrls) : null;
    
    db.prepare(
      `INSERT INTO messages (session_id, role, content, model, meta, image_paths, user_id, guest_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      "user",
      userMessageText,
      model,
      JSON.stringify({ mode: mode || "tactical" }),
      userImagePathsJson,
      userId,
      null
    );

    const userMessageId = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };

    let webContextSystemMessage: string | null = null;
    let webProvider: "none" | "gemini" | "tavily" = "none";
    const webStatus: {
      requested: boolean;
      used: boolean;
      error: string | null;
      sourceCount: number;
      skipped?: boolean;
      provider?: string;
      reason?: "small_talk" | "no_results";
    } = {
      requested: webRequested,
      used: false,
      error: null,
      sourceCount: 0,
    };

    if (webRequested) {
      const shouldSkipWeb = shouldSkipWebForSmallTalk(userMessageText);
      if (shouldSkipWeb) {
        webStatus.skipped = true;
        webStatus.provider = "skipped";
        webStatus.reason = "small_talk";
      } else {
        incrementDailyUsage(db, userId, "web_search");

        const geminiSystem = [
          "You are DartBoard Web Mode.",
          "Use Google Search grounding when relevant. Do not hallucinate.",
          `User local time: ${localTimeContext.display} (${localTimeContext.timeZone}).`,
          `Treat 'today' and relative dates as ${localTimeContext.dateIso}.`,
          "Output format:",
          "- Start with the direct answer in 3-8 concise bullets max.",
          "- If evidence is insufficient, write exactly: Not found in sources.",
          "- If needed, ask one short clarifying question (region/time/date).",
          "- Do not include a Sources section or URLs.",
          "Hard rules:",
          "1) Only state facts supported by the grounded sources you used.",
          "2) If the grounded sources do not contain the answer, say exactly: Not found in sources.",
          "3) Ask for missing constraints briefly (region/time/date) when needed.",
          "4) Do not output a 'Sources' section or raw URLs.",
          "5) Keep the response compact and complete; never end mid-sentence.",
        ].join("\n");

        try {
          const geminiResp = await generateWithGeminiGoogleSearch({
            userText: userMessageText,
            systemInstruction: geminiSystem,
            maxOutputTokens: Math.max(1024, GEMINI_WEB_MAX_OUTPUT_TOKENS),
          });

          if (geminiResp.used) {
            if ((geminiResp.sources?.length ?? 0) === 0) {
              // No grounded sources is treated as no-results so we can silently fall back.
              webStatus.reason = "no_results";
              webStatus.error = null;
            } else {
              webProvider = "gemini";
              webStatus.used = true;
              webStatus.provider = "gemini";
              webStatus.sourceCount = geminiResp.sources.length;
              webStatus.error = null;
              webStatus.reason = undefined;
              const normalizedSources = geminiResp.sources
                .map((source) => {
                  const normalized = normalizeSourceForDisplay(source.url);
                  return {
                    title: source.title,
                    url: normalized.href,
                    label: normalized.label,
                  };
                })
                .filter((source) => source.url.length > 0);
              const dedupedSources = Array.from(
                new Map(normalizedSources.map((source) => [source.url, source])).values()
              );

              const assistantReply = stripTrailingSourcesSection(geminiResp.text.trim());
              const assistantMeta = {
                mode: mode || "tactical",
                provider: "gemini",
                web_verified: true,
                sources: dedupedSources,
              };

              // Persist assistant reply (Gemini) and return early.
              const result = db
                .prepare(
                  `INSERT INTO messages (session_id, role, content, model, meta, user_id, guest_id) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                  sessionId,
                  "assistant",
                  assistantReply,
                  "gemini-web",
                  JSON.stringify(assistantMeta),
                  userId,
                  null
                );

              const assistantMessageId = result.lastInsertRowid;

	              db.prepare(`
	                UPDATE sessions 
	                SET updated_at = ?, mru_ts = ?
	                WHERE id = ? AND ${owner.column} = ?
	              `).run(new Date().toISOString(), Date.now(), sessionId, owner.value);

	              // Log Gemini usage if provided so lifetime usage bar stays accurate across refresh.
	              if (geminiResp.usage && geminiResp.usage.total_tokens > 0) {
	                logTokenUsage({
	                  session_id: sessionId,
	                  model: "gemini-web",
	                  prompt_tokens: geminiResp.usage.prompt_tokens,
	                  completion_tokens: geminiResp.usage.completion_tokens,
	                  total_tokens: geminiResp.usage.total_tokens,
	                });
	              }

	              const row = db
	                .prepare(
	                  `SELECT COALESCE(SUM(total_tokens), 0) AS used_tokens
	                   FROM token_usage
	                   WHERE session_id = ?`
	                )
	                .get(sessionId) as { used_tokens: number } | undefined;

	              return NextResponse.json({
	                reply: assistantReply,
	                meta: assistantMeta,
	                web: webStatus,
	                plan,
	                usage: geminiResp.usage ?? null,
	                session_total_tokens: row?.used_tokens ?? 0,
	                session_token_limit: limits.maxSessionTokens,
	                context_current_tokens: null,
	                context_max_tokens: CONTEXT_LIMIT_TOKENS,
	                context_usage_ratio: null,
	              });
            }
          }

          webStatus.error = geminiResp.error ?? (webStatus.reason === "no_results" ? null : "Gemini web failed");
        } catch (e) {
          webStatus.error = e instanceof Error ? e.message : "Gemini web failed";
        }

        // Silent fallback: Tavily -> OpenAI (existing path)
        const tavilyResult = await searchWebWithTavily(userMessageText);
        if (tavilyResult.used) {
          webProvider = "tavily";
          webStatus.used = true;
          webStatus.provider = "tavily";
          webStatus.sourceCount = tavilyResult.results.length;
          webStatus.error = null;
          webStatus.reason = undefined;
          const extractTargets = tavilyResult.results
            .slice(0, TAVILY_EXTRACT_TOP_RESULTS)
            .map((result) => result.url)
            .filter((url) => url.length > 0);

          const extractResult = await extractWebPagesWithTavily(extractTargets);
          if (!extractResult.used && extractResult.error) {
          }

          webContextSystemMessage = formatWebResultsForPrompt(
            localTimeContext,
            userMessageText,
            tavilyResult.results,
            extractResult.docs
          );
        } else {
          webStatus.used = false;
          webStatus.provider = "none";
          const noResults = tavilyResult.error === "No web results returned" || webStatus.reason === "no_results";
          if (noResults) {
            webStatus.reason = "no_results";
            webStatus.error = null;
          } else {
            webStatus.error = tavilyResult.error ?? webStatus.error ?? "Web search failed";
          }
        }

      }
    }

    // NOTE: updated_at is NOT updated on user messages - only on assistant replies
    // This ensures Unfiled ordering is driven by assistant reply time

    const {
      messagesForOpenAI,
      rollingSummary,
      recentHistoryCount,
      hasRollingSummary,
      contextCurrentTokens,
      contextMaxTokens,
      contextUsageRatio,
      semanticMemoryIds,
    } = await assemblePromptMessages({
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
      excludedSemanticMemoryIds: [...new Set([...attachedIds, ...injectedMemoryIds])],
    });

    // === CONTEXT ASSEMBLY AUDIT ===
    const auditManifest = buildChatContextAuditManifest({
      sessionId,
      searchQuery,
      attachedMemoryIds: attachedIds,
      injectedMemoryIds,
      semanticMemoryIds,
      clientAttachedMemoryIds: attachedMemoryIds || [],
      historyPolicy,
      recentHistoryCount,
      hasRollingSummary,
    });
    const auditHeaders = buildChatContextAuditHeaders({
      mode: auditManifest.mode,
      attachedMemoryIds: attachedIds,
      injectedMemoryIds,
      semanticMemoryIds,
      clientAttachedMemoryIds: attachedMemoryIds || [],
    });
    // Determine max_output_tokens based on mode.
    // You can override via env var DARTZ_MAX_OUTPUT_TOKENS (e.g. 4096, 8192).
    const envMax = process.env.DARTZ_MAX_OUTPUT_TOKENS
      ? Number.parseInt(process.env.DARTZ_MAX_OUTPUT_TOKENS, 10)
      : NaN;

    const defaultMaxOutputTokens =
      mode === "builder" || mode === "dissect"
        ? limits.maxOutputTokensBuilderDissect
        : limits.maxOutputTokensDefault;
    const maxOutputTokens = Number.isFinite(envMax) && envMax > 0 ? envMax : defaultMaxOutputTokens;

    // Call OpenAI API
    if (stream) {
      // Streaming version using Chat Completions API
      // Convert messages to the format expected by Chat Completions API
      const chatMessages = messagesForOpenAI.map(msg => {
        if (Array.isArray(msg.content)) {
          // For messages with images, ensure proper typing
          return {
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content as Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
          };
        }
        return {
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content as string
        };
      });
      
      const streamResponse = await openai.chat.completions.create({
        model: model,
        messages: chatMessages,
        max_completion_tokens: maxOutputTokens,
        stream: true,
      } as any);

      // Return SSE stream
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              // Send context metrics in first chunk
              const contextMetrics = buildChatContextMetricsEvent({
                contextCurrentTokens,
                contextMaxTokens,
                contextUsageRatio,
              });
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(contextMetrics)}\n\n`));
              
              for await (const chunk of streamResponse as any) {
                // Ensure we have the right format with choices[0].delta.content
                if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                  const data = `data: ${JSON.stringify(chunk)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(data));
                }
              }
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
            } catch (error) {
              console.error('Streaming error:', error);
              controller.error(error);
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...auditHeaders,
          },
        }
      );
    } else {
      // Non-streaming version (existing code)
      // Note: Using type assertion as SDK types may not be fully updated for Responses API
      
      const responseInput = toResponsesInput(messagesForOpenAI as ChatStyleMessage[]);

      const response = await (openai.responses as any).create({
        model: model,
        input: responseInput,
        max_output_tokens: maxOutputTokens,
      });

      const assistantReplyRaw = response.output_text;
      const assistantReply =
        webRequested ? stripTrailingSourcesSection(assistantReplyRaw) : assistantReplyRaw;

      if (!assistantReply) {
        return NextResponse.json(
          { error: "No reply from OpenAI" },
          { status: 500 }
        );
      }

      // Log token usage
      const usage = response.usage;
      let session_total_tokens = 0;
      if (usage) {
        logTokenUsage({
          session_id: sessionId,
          model: model,
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
        });

        // Sum tokens for this session
        const row = db
          .prepare(
            `SELECT COALESCE(SUM(total_tokens), 0) AS used_tokens
             FROM token_usage
             WHERE session_id = ?`
          )
          .get(sessionId) as { used_tokens: number } | undefined;

        session_total_tokens = row?.used_tokens ?? 0;
      }

      // Save assistant message to database with mode in meta
      const assistantMeta: { mode: string; provider?: "none" | "gemini" | "tavily"; web_verified?: boolean } = {
        mode: mode || "tactical",
      };
      if (webStatus.used) {
        assistantMeta.provider = webProvider;
        assistantMeta.web_verified = true;
      }
      const result = db
        .prepare(
          `INSERT INTO messages (session_id, role, content, model, meta, user_id, guest_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId, 
          "assistant", 
          assistantReply, 
          model,
          JSON.stringify(assistantMeta),
          userId,
          null
        );

      const assistantMessageId = result.lastInsertRowid;

      // Update session's updated_at and mru_ts when assistant responds
      db.prepare(`
        UPDATE sessions 
        SET updated_at = ?, mru_ts = ?
        WHERE id = ? AND ${owner.column} = ?
      `).run(new Date().toISOString(), Date.now(), sessionId, owner.value);

      // Return the reply with usage
      return NextResponse.json({
        reply: assistantReply,
        meta: assistantMeta,
        web: webStatus,
        plan,
        usage: usage
          ? {
              prompt_tokens: usage.input_tokens,
              completion_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
            }
          : null,
        session_total_tokens,
        session_token_limit: limits.maxSessionTokens,
        // Context window metrics (Option A)
        context_current_tokens: contextCurrentTokens,
        context_max_tokens: contextMaxTokens,
        context_usage_ratio: contextUsageRatio,
      }, {
        headers: {
          ...auditHeaders,
        }
      });
    }
  } catch (error) {
    console.error("Error in /api/chat:", error);

    if (error instanceof Error) {
      if (error.message.includes("OPENAI_API_KEY")) {
        return NextResponse.json(
          { error: "OpenAI API key is not configured. Please add OPENAI_API_KEY to .env.local" },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to get assistant reply" },
      { status: 500 }
    );
  }
}
