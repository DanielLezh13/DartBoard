import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getServerScope } from '@/lib/scope-server';
import { getScopeOwner, parsePositiveInt } from '@/lib/ownership';
import { enforceApiRateLimit } from '@/lib/rateLimit';

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
    const owner = getScopeOwner(scope);
    const db = getDb();
    const rateLimited = enforceApiRateLimit({
      db,
      request,
      route: { routeKey: "/api/sessions/touch", limit: 30, windowMs: 60 * 1000 },
      scope,
    });
    if (rateLimited) {
      return rateLimited;
    }
    const now = Date.now();
    const nowIso = new Date().toISOString();
    
    // Update session's mru_ts and updated_at
    const result = db.prepare(`
      UPDATE sessions 
      SET mru_ts = ?, updated_at = ?
      WHERE id = ? AND ${owner.column} = ?
    `).run(now, nowIso, parsedSessionId, owner.value);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      mru_ts: now,
      updated_at: nowIso
    });

  } catch (error) {
    console.error('Error touching session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
