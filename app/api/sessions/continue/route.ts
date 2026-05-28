import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOpenAIClient } from '@/lib/openai';
import { getServerScope } from '@/lib/scope-server';
import { getOwnedSession, parsePositiveInt } from '@/lib/ownership';

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    const parsedSessionId = parsePositiveInt(sessionId);
    if (parsedSessionId === null) {
      return NextResponse.json(
        { error: 'Valid sessionId is required' },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to continue sessions" },
        { status: 403 }
      );
    }
    const userId = scope.userId;
    const guestId = null;
    const db = getDb();
    const currentSession = getOwnedSession<{ mode: string | null; title: string | null }>(
      db,
      parsedSessionId,
      scope,
      "mode, title"
    );

    if (!currentSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    
    // 1. Load all messages for current session
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE session_id = ? 
      ORDER BY created_at ASC
    `).all(parsedSessionId) as any[];

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages found in session' },
        { status: 400 }
      );
    }

    // 2. Produce a summary
    const conversationText = messages
      .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const summaryPrompt = `Create a concise summary of the following conversation (target 8-12 lines). Focus on:
- Key decisions and outcomes
- Important context that needs to be preserved
- Action items or next steps
- Critical information discussed

Conversation:
${conversationText}

Summary:`;

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are creating a concise summary to continue a conversation in a new chat session. Preserve essential context only.'
        },
        {
          role: 'user',
          content: summaryPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const summary = completion.choices[0]?.message?.content;
    if (!summary) {
      return NextResponse.json(
        { error: 'Failed to generate summary' },
        { status: 500 }
      );
    }

    // 3. Create a new session
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO sessions (source, mode, title, created_at, updated_at, mru_ts, user_id, guest_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'dartz_chat',
      currentSession?.mode || 'tactical',
      `Continued: ${currentSession?.title || 'Chat'}`,
      now,
      now,
      Date.now(),
      userId,
      guestId
    );

    const newSessionId = result.lastInsertRowid as number;

    // 5. Copy attached memories from old session to new session
    const attachedMemories = db.prepare(`
      SELECT memory_id FROM session_memory_attachments
      WHERE session_id = ?
    `).all(parsedSessionId) as any[];

    if (attachedMemories && attachedMemories.length > 0) {
      // Copy attachments to new session
      const insertAttachment = db.prepare(`
        INSERT INTO session_memory_attachments (session_id, memory_id, created_at)
        VALUES (?, ?, ?)
      `);

      for (const mem of attachedMemories) {
        insertAttachment.run(newSessionId, mem.memory_id, now);
      }
    }

    // 6. Insert the summary as the first assistant message in the new session
    const summaryMessage = `[Previous conversation summary]\n\n${summary}\n\n---\n\nYou can continue the conversation from here.`;
    
    db.prepare(`
      INSERT INTO messages (session_id, role, content, created_at, user_id, guest_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newSessionId, 'assistant', summaryMessage, now, userId, guestId);

    // 7. Return the new session ID
    return NextResponse.json({
      newSessionId: newSessionId,
      summary: summary,
    });

  } catch (error) {
    console.error('Error in continue session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
