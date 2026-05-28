import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/openai";
import { getDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
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
        { error: "Sign in required for objective generation" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { sessionId: rawSessionId } = body as {
      sessionId: number | string;
    };

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
    const config = getConfig();
    const model = config.modelId;

    // Load recent conversation messages (last 20 user/assistant pairs)
    const recentMessages = db
      .prepare(
        `SELECT role, content 
         FROM messages 
         WHERE session_id = ? 
         AND role IN ('user', 'assistant')
         ORDER BY created_at DESC 
         LIMIT 20`
      )
      .all(sessionId) as Array<{ role: string; content: string }>;

    // Reverse to get chronological order
    const conversationHistory = recentMessages.reverse();

    if (conversationHistory.length === 0) {
      return NextResponse.json(
        { error: "No conversation history found" },
        { status: 400 }
      );
    }

    // Build system message for objective analysis
    const systemMessage = `You are analyzing a conversation to extract a clear, actionable objective for Focus Mode.

Your task:
1. Analyze the conversation history below
2. Identify the main goal or objective the user is working toward
3. If the objective is unclear, ask 1-2 clarifying questions
4. Synthesize a concise, actionable objective statement (max 60 characters)

The objective should be:
- Specific and actionable
- Focused on what the user wants to achieve
- Clear enough to guide future conversation

Return your response in this format:
- If objective is clear: Just return the objective statement directly (no prefix, no explanation)
- If clarification needed: Start with "CLARIFY:" followed by 1-2 questions

Keep it concise and direct.`;

    // Format conversation for analysis
    const conversationText = conversationHistory
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n\n");

    const messagesForOpenAI = [
      { role: "system" as const, content: systemMessage },
      {
        role: "user" as const,
        content: `Analyze this conversation and extract the objective:\n\n${conversationText}`,
      },
    ];

    // Call OpenAI
    const response = await (openai.responses as any).create({
      model: model,
      input: messagesForOpenAI,
      max_output_tokens: 256,
    });

    const objectiveText = response.output_text?.trim();

    if (!objectiveText) {
      return NextResponse.json(
        { error: "No objective generated" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      objective: objectiveText,
    });
  } catch (error) {
    console.error("Error in /api/objective:", error);

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate objective" },
      { status: 500 }
    );
  }
}
