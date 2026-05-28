import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOpenAIClient } from "@/lib/openai";
import { getServerScope } from "@/lib/scope-server";
import { getOwnedSession, parsePositiveInt } from "@/lib/ownership";

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
        { error: "Sign in required for summarization" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { sessionId: rawSessionId } = body as { sessionId: number | string };

    if (!rawSessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
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

    const db = getDb();
    const session = getOwnedSession(db, sessionId, scope);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const openai = getOpenAIClient();

    // Get all messages from the session (excluding system_summary and system)
    const messages = db
      .prepare(
        `SELECT role, content 
         FROM messages 
         WHERE session_id = ? 
         AND role != 'system_summary' 
         AND role != 'system'
         ORDER BY created_at ASC`
      )
      .all(sessionId) as Array<{ role: string; content: string }>;

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "No messages to summarize" },
        { status: 400 }
      );
    }

    // Build conversation text for summarization
    const conversationText = messages
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n\n");

    // Generate summary using OpenAI
    const model = "gpt-4o-mini";

    const summaryPrompt = `Summarize the following conversation concisely (target 10-20 lines). Preserve key information, decisions, and context needed to continue the conversation:

${conversationText}

Provide a concise summary:`;

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
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content;

    if (!summary) {
      return NextResponse.json(
        { error: "Failed to generate summary" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      summary: summary,
    });
  } catch (error) {
    console.error("Error in /api/summarize:", error);

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}









