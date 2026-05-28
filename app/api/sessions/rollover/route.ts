import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOpenAIClient } from '@/lib/openai';
import { getServerScope } from '@/lib/scope-server';
import { getOwnedSession, getScopeOwner, parsePositiveInt } from '@/lib/ownership';

export const dynamic = "force-dynamic";

const KEEP_LAST_RAW_MESSAGES = 20;

export async function POST(request: NextRequest) {
  try {
    const { oldSessionId } = await request.json();

    const parsedOldSessionId = parsePositiveInt(oldSessionId);
    if (parsedOldSessionId === null) {
      return NextResponse.json(
        { error: 'Valid oldSessionId is required' },
        { status: 400 }
      );
    }

    const scope = await getServerScope(request);
    if (scope.kind !== "user") {
      return NextResponse.json(
        { error: "Sign in required to rollover sessions" },
        { status: 403 }
      );
    }
    const owner = getScopeOwner(scope);
    const userId = scope.userId;
    const guestId = null;
    const db = getDb();
    const oldSession = getOwnedSession<{
      rolling_summary?: string;
      summarized_until_message_id?: number | null;
      mode?: string | null;
      title?: string | null;
    }>(
      db,
      parsedOldSessionId,
      scope,
      "rolling_summary, summarized_until_message_id, mode, title"
    );
    if (!oldSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // 1. Load summary state from old session
    let rollingSummary = "";
    let summarizedUntilMessageId = null;
    try {
      rollingSummary = String(oldSession.rolling_summary ?? "");
      summarizedUntilMessageId = oldSession.summarized_until_message_id ?? null;
    } catch {
      rollingSummary = "";
      summarizedUntilMessageId = null;
    }

    // 2. Load messages for session digest (main sample + tail block)
    let sampledMessages: any[] = [];
    let tailBlock: any[] = [];
    try {
      const allMessages = db.prepare(`
        SELECT id, role, content, created_at 
        FROM messages 
        WHERE session_id = ? 
        ORDER BY created_at ASC
      `).all(parsedOldSessionId) as any[];

      // Filter based on compaction boundary (same logic as chat route)
      const eligibleHistoryMessages = summarizedUntilMessageId !== null
        ? allMessages.filter((msg: any) => msg.id && msg.id > summarizedUntilMessageId!)
        : allMessages;

      // ALWAYS get the last 8 messages for tail block
      tailBlock = eligibleHistoryMessages.slice(-8);
      
      // Create main sample from remaining messages (excluding tail)
      const remainingMessages = eligibleHistoryMessages.slice(0, -8);
      
      if (remainingMessages.length <= KEEP_LAST_RAW_MESSAGES) {
        // If remaining is small, use all of it
        sampledMessages = remainingMessages;
      } else {
        // Sample uniformly across the remaining messages
        const sampleSize = KEEP_LAST_RAW_MESSAGES;
        const step = Math.floor(remainingMessages.length / sampleSize);
        
        sampledMessages = [];
        for (let i = 0; i < sampleSize; i++) {
          const index = Math.min(i * step, remainingMessages.length - 1);
          sampledMessages.push(remainingMessages[index]);
        }
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }

    // 3. Generate Session Digest with mandatory tail capture
    let handoffSummary = "";
    try {
      const openai = getOpenAIClient();
      
      // Build context for digest
      const contextParts: string[] = [];
      
      // Include existing rolling summary if present
      if (rollingSummary.trim()) {
        contextParts.push(`EXISTING ROLLING SUMMARY:\n${rollingSummary}\n`);
      }
      
      // Include main sample for dominant topics
      if (sampledMessages.length > 0) {
        const mainSample = sampledMessages
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n');
        contextParts.push(`MAIN SAMPLE (for dominant topics):\n${mainSample}\n`);
      }
      
      // Include tail block (always included)
      if (tailBlock.length > 0) {
        const tailMessages = tailBlock
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n\n');
        contextParts.push(`TAIL BLOCK (last 8 messages):\n${tailMessages}`);
      }

      // Generate Session Digest
      const digestPrompt = `Create a comprehensive Session Digest from this conversation. The digest should be long-form (600-1200 words) and capture the full context for continuing in a new session.

${contextParts.join('\n\n---\n\n')}

REQUIREMENTS:
1. Produce a structured digest with these EXACT sections:
   - Overview (1 paragraph setting the context)
   - Main topics (sections with headings for each major theme)
   - Recent thread (last 8 messages) (MUST include even if different topic)
   - Open loops / next steps (optional)

2. The "Recent thread" section is MANDATORY and must:
   - Summarize the last 8 messages specifically
   - Capture any topic shifts in the tail
   - Not be omitted even if it differs from main topics

3. For "Main topics":
   - Identify dominant themes from the main sample
   - Give each topic its own heading
   - Write detailed paragraphs (not bullets)
   - Include conclusions and key insights

4. Writing style:
   - Professional but conversational
   - Include specific details and examples
   - Preserve important context and decisions
   - Note any unresolved questions

Generate the digest now:`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are creating a comprehensive Session Digest for continuing a conversation. Focus on clarity, completeness, and preserving important context.'
          },
          {
            role: 'user',
            content: digestPrompt
          }
        ],
        temperature: 0.5,
        max_tokens: 2000 // Increased for longer digest
      });

      handoffSummary = completion.choices[0]?.message?.content || '';
      
    } catch (error) {
      console.error('Error generating handoff summary:', error);
      handoffSummary = "Error generating summary. Please check the previous context.";
    }

    // 4. Create new session
    let newSessionId: number;
    try {
      const result = db.prepare(`
        INSERT INTO sessions (source, mode, title, created_at, updated_at, mru_ts, user_id, guest_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'dartz_chat',
        oldSession?.mode || 'tactical',
        `Continued: ${oldSession?.title || 'Chat'}`,
        new Date().toISOString(),
        new Date().toISOString(),
        Date.now(), // Set mru_ts to current milliseconds
        userId,
        guestId
      );
      
      newSessionId = result.lastInsertRowid as number;
    } catch (error) {
      console.error('Error creating new session:', error);
      return NextResponse.json(
        { error: 'Failed to create new session' },
        { status: 500 }
      );
    }

    // 5. Copy attached memories old → new
    try {
      const attachedMemories = db.prepare(`
        SELECT memory_id FROM session_memory_attachments
        WHERE session_id = ?
      `).all(parsedOldSessionId) as any[];

      if (attachedMemories.length > 0) {
        const insertAttachment = db.prepare(`
          INSERT INTO session_memory_attachments (session_id, memory_id, created_at)
          VALUES (?, ?, ?)
        `);

        for (const mem of attachedMemories) {
          insertAttachment.run(newSessionId, mem.memory_id, new Date().toISOString());
        }
      }
    } catch (error) {
      console.error('Error copying memories:', error);
      // Continue anyway - don't fail the operation
    }

    // 6. Seed new session with first assistant message
    try {
      // Create timestamp at end of current hour to appear at top of bucket
      const now = new Date();
      const endOfHour = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        59,
        59,
        999
      ).toISOString();
      
      db.prepare(`
        INSERT INTO messages (session_id, role, content, created_at, user_id, guest_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        newSessionId,
        'assistant',
        `Summary of previous chat:\n\n${handoffSummary}`,
        endOfHour,
        userId,
        guestId
      );
    } catch (error) {
      console.error('Error seeding new session:', error);
      // Continue anyway
    }

    // 7. FINAL TOUCH: Ensure rollover session has the highest mru_ts
    // Get the current max mru_ts from all sessions
    const maxMruResult = db.prepare(`
      SELECT MAX(mru_ts) as max_mru FROM sessions
    `).get() as { max_mru: number | null };
    
    const currentMaxMru = maxMruResult?.max_mru || 0;
    const now = Date.now();
    const finalMruTs = Math.max(now, currentMaxMru + 1);
    const finalUpdatedAt = new Date().toISOString();
    
    try {
      db.prepare(`
        UPDATE sessions 
        SET mru_ts = ?, updated_at = ?
        WHERE id = ? AND ${owner.column} = ?
      `).run(finalMruTs, finalUpdatedAt, newSessionId, owner.value);
    } catch (error) {
      console.error('Error updating final mru_ts:', error);
    }

    // 8. Return new session ID
    return NextResponse.json({
      newSessionId: newSessionId
    });

  } catch (error) {
    console.error('Error in rollover session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
