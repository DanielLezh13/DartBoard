import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

const MAX_FOCUS_CHARS = 60;

function normalizeFocusGoal(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function validateFocusGoal(raw: string): { ok: true } | { ok: false; error: string } {
  const goal = normalizeFocusGoal(raw);
  if (!goal) {
    return { ok: false, error: "Focus cannot be empty." };
  }
  if (goal.length > MAX_FOCUS_CHARS) {
    return { ok: false, error: `Focus must be ${MAX_FOCUS_CHARS} characters or less.` };
  }

  const blockedPatterns: RegExp[] = [
    /\b(nazi|white\s+power|racial\s+suprem\w*|ethnic\s+cleansing|genocide|hate\s*speech)\b/i,
    /\b(porn|pornography|erotic|fetish|nsfw|sexual\s+roleplay|rape|molest)\b/i,
    /\b(kill|eliminate|harm|attack)\b[\s\S]{0,32}\b(people|men|women|jews?|muslims?|blacks?|whites?|gays?|trans(?:gender)?|immigrants?|asians?|latinos?|christians?)\b/i,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(goal))) {
    return { ok: false, error: "Focus violates safety policy. Please rephrase." };
  }

  return { ok: true };
}

export async function PATCH(request: NextRequest) {
  try {
    const scope = await getServerScope(request);
    const body = await request.json();
    const { sessionId, focusGoal, enabled, clear } = body as {
      sessionId?: number | string;
      focusGoal?: string | null;
      enabled?: boolean;
      clear?: boolean;
    };

    const parsedSessionId = Number(sessionId);
    if (!Number.isFinite(parsedSessionId) || parsedSessionId <= 0) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const db = getDb();
    const session = db
      .prepare(`SELECT id, user_id, guest_id, focus_goal, focus_enabled FROM sessions WHERE id = ? AND is_deleted = 0`)
      .get(parsedSessionId) as
      | {
          id: number;
          user_id: string | null;
          guest_id: string | null;
          focus_goal: string | null;
          focus_enabled: number | null;
        }
      | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const ownsSession =
      scope.kind === "user" ? session.user_id === scope.userId : session.guest_id === scope.guestId;

    if (!ownsSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let nextGoal = typeof session.focus_goal === "string" ? session.focus_goal : null;
    let nextEnabled = Number(session.focus_enabled || 0) === 1;

    if (clear === true) {
      nextGoal = null;
      nextEnabled = false;
    }

    if (focusGoal !== undefined) {
      if (focusGoal == null || normalizeFocusGoal(focusGoal).length === 0) {
        nextGoal = null;
        nextEnabled = false;
      } else {
        const safety = validateFocusGoal(focusGoal);
        if (!safety.ok) {
          return NextResponse.json({ error: safety.error }, { status: 400 });
        }
        nextGoal = normalizeFocusGoal(focusGoal);
      }
    }

    if (enabled !== undefined) {
      nextEnabled = Boolean(enabled);
    }

    if (nextEnabled) {
      if (!nextGoal) {
        return NextResponse.json({ error: "Save a focus topic before enabling." }, { status: 400 });
      }
      const safety = validateFocusGoal(nextGoal);
      if (!safety.ok) {
        return NextResponse.json({ error: safety.error }, { status: 400 });
      }
    }

    if (!nextGoal) {
      nextEnabled = false;
    }

    db.prepare(
      `UPDATE sessions
       SET focus_goal = ?, focus_enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextGoal, nextEnabled ? 1 : 0, new Date().toISOString(), parsedSessionId);

    return NextResponse.json({
      session_id: parsedSessionId,
      focusGoal: nextGoal,
      focusEnabled: nextEnabled,
      focusIntensity: "lockdown",
    });
  } catch (error) {
    console.error("Error updating session focus:", error);
    return NextResponse.json({ error: "Failed to update focus" }, { status: 500 });
  }
}
