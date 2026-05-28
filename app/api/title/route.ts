import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/openai";
import { getConfig } from "@/lib/config";
import { makeAutoTitleFromAssistant } from "@/lib/chatHelpers";
import { getServerScope } from "@/lib/scope-server";
import { getDb } from "@/lib/db";
import { enforceApiRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let scope;
    try {
      scope = await getServerScope(request);
    } catch {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required for title generation" },
        { status: 403 }
      );
    }
    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/title", limit: 20, windowMs: 10 * 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const body = await request.json();
    const { assistantResponse } = body as {
      assistantResponse: string;
    };

    if (!assistantResponse) {
      return NextResponse.json(
        { error: "assistantResponse is required" },
        { status: 400 }
      );
    }

    // Get OpenAI client
    const openai = getOpenAIClient();

    // Get model from config
    const config = getConfig();
    const model = config.modelId;

    // Generate title
    const titleResponse = await (openai.responses as any).create({
      model: model,
      input: [
        {
          role: "system",
          content: "Generate a short chat title.\nConstraints: max 28 characters total (including spaces). 3–6 words. No quotes. No emoji. No trailing punctuation. Title case.\nFocus on the core subject/topic, not correctness disclaimers.\nDo not use words like incorrect, wrong, inaccurate, error, failed, cannot, unable, browsing, sources, web.\nIf you cannot fit meaningfully, output a more general 2–4 word title.\nOutput only the title text.",
        },
        {
          role: "user",
          content: `ASSISTANT RESPONSE:\n${assistantResponse}`,
        },
      ],
      max_output_tokens: 50,
    });

    const rawTitle = titleResponse.output_text || "";

    // Hard clamp + cleanup server-side (guarantees no "…")
    const MAX_CHARS = 28;
    const TRAILING_CONNECTOR_RE = /\b(and|or|but|with|to|for|of|in|on|at|by|from|about)\s*$/i;

    const stripWrappingPunctuation = (raw: string): string => {
      let value = String(raw || "").trim();
      for (let i = 0; i < 4; i += 1) {
        const next = value
          .replace(/^[\s"'“”`([{]+/, "")
          .replace(/[\s"'“”`)\]}]+$/, "")
          .trim();
        if (next === value) break;
        value = next;
      }
      return value;
    };

    const hasUnbalancedDelimiters = (raw: string): boolean => {
      const openParens = (raw.match(/\(/g) || []).length;
      const closeParens = (raw.match(/\)/g) || []).length;
      if (openParens !== closeParens) return true;
      const quoteCount = (raw.match(/"/g) || []).length + (raw.match(/[“”]/g) || []).length;
      return quoteCount % 2 !== 0;
    };

    const normalizeTitleCandidate = (raw: string): string => {
      let value = String(raw || "")
        .trim()
        .replace(/\s+/g, " ");
      value = stripWrappingPunctuation(value);
      if (value.length > MAX_CHARS) {
        value = value.slice(0, MAX_CHARS).trimEnd();
        value = value.replace(/\s+\S*$/, "").trimEnd() || value.slice(0, MAX_CHARS).trimEnd();
      }
      value = value.replace(TRAILING_CONNECTOR_RE, "").trim();
      value = value.replace(/[\s\-:;,.!?]+$/g, "").trim();
      value = stripWrappingPunctuation(value);
      if (hasUnbalancedDelimiters(value)) return "";
      return value;
    };

    let title = normalizeTitleCandidate(rawTitle);
    const bannedTitlePattern = /\b(incorrect|wrong|inaccurate|not accurate|error|failed|cannot|can't|unable|browsing|sources?|web)\b/i;
    if (!title || title.length < 3 || bannedTitlePattern.test(title)) {
      const fallback = normalizeTitleCandidate(makeAutoTitleFromAssistant(assistantResponse));
      if (fallback && !bannedTitlePattern.test(fallback)) {
        title = fallback;
      } else {
        title = "New Chat";
      }
    }

    title = normalizeTitleCandidate(title) || "New Chat";

    return NextResponse.json({
      title,
    });
  } catch (error) {
    console.error("Error in /api/title:", error);

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
      { error: "Failed to generate title" },
      { status: 500 }
    );
  }
}

