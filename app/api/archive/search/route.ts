import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getScopePlan } from "@/lib/plan";
import { getServerScope } from "@/lib/scope-server";
import { enforceApiRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const ARCHIVE_SEARCH_DEFAULT_LIMIT = 50;
const ARCHIVE_SEARCH_MAX_LIMIT = 100;
const ARCHIVE_SEARCH_MAX_OFFSET = 1_000_000;
const ARCHIVE_SEARCH_MAX_QUERY_CHARS = 400;
const ARCHIVE_SEARCH_MAX_CHIP_TERMS = 12;
const ARCHIVE_SEARCH_MAX_CHIP_TERM_CHARS = 64;
// Allow up to one full-year selection from the timeline UI.
const ARCHIVE_SEARCH_MAX_DATE_FILTERS = 366;

function parseBoundedIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeDateInput(value: string, isEnd = false): string {
  if (!value) return "";
  if (value.includes("T")) {
    // Already has time component, return as-is (assume it's already UTC ISO)
    return value;
  }
  // YYYY-MM-DD format: treat as local date, convert to UTC
  // Parse the date components
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
  const day = parseInt(parts[2], 10);
  
  if (isNaN(year) || isNaN(month) || isNaN(day)) return value;
  
  // Create date in local timezone, then convert to UTC ISO string
  // For start of day: use 00:00:00 local, convert to UTC
  // For end of day: use 23:59:59 local, convert to UTC
  const localDate = new Date(year, month, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0);
  return localDate.toISOString();
}

function tokenizeWholeWordQuery(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(/\s+/).filter(Boolean)));
}

function buildSqlWholeWordTextExpr(textCol: string): string {
  let expr = `lower(${textCol})`;

  // Replace whitespace-ish chars and common separators with spaces so word boundaries are detectable.
  const charCodes = [9, 10, 13, 39, 92]; // tab, LF, CR, apostrophe, backslash
  for (const code of charCodes) {
    expr = `replace(${expr}, char(${code}), ' ')`;
  }

  const separators = [
    ".",
    ",",
    "!",
    "?",
    ":",
    ";",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    '"',
    "/",
    "-",
    "|",
    "@",
    "#",
    "$",
    "%",
    "^",
    "&",
    "*",
    "+",
    "=",
    "<",
    ">",
    "~",
    "`",
  ];
  for (const separator of separators) {
    const escaped = separator.replace(/'/g, "''");
    expr = `replace(${expr}, '${escaped}', ' ')`;
  }

  return `' ' || ${expr} || ' '`;
}

function buildWholeWordClauseForTerm(
  normalizedTextExpr: string,
  rawTerm: string
): { clause: string; params: string[] } | null {
  const tokens = tokenizeWholeWordQuery(rawTerm);
  if (tokens.length === 0) return null;

  return {
    clause: tokens
      .map(() => `INSTR(${normalizedTextExpr}, ' ' || ? || ' ') > 0`)
      .join(" AND "),
    params: tokens,
  };
}

function applyWholeWordFilters(opts: {
  clause: string;
  params: any[];
  textCol: string;
  q: string;
  chipTerms: string[];
  chipMode: "AND" | "OR";
}): { clause: string; params: any[] } {
  let nextClause = opts.clause;
  const nextParams = [...opts.params];
  const normalizedTextExpr = buildSqlWholeWordTextExpr(opts.textCol);

  const queryClause = buildWholeWordClauseForTerm(normalizedTextExpr, opts.q);
  if (queryClause) {
    nextClause += ` AND (${queryClause.clause})`;
    nextParams.push(...queryClause.params);
  }

  const chipClauses = opts.chipTerms
    .map((term) => buildWholeWordClauseForTerm(normalizedTextExpr, term))
    .filter((item): item is { clause: string; params: string[] } => item !== null);

  if (chipClauses.length > 0) {
    if (opts.chipMode === "OR") {
      nextClause += ` AND (${chipClauses.map((item) => `(${item.clause})`).join(" OR ")})`;
      for (const chip of chipClauses) {
        nextParams.push(...chip.params);
      }
    } else {
      for (const chip of chipClauses) {
        nextClause += ` AND (${chip.clause})`;
        nextParams.push(...chip.params);
      }
    }
  }

  return { clause: nextClause, params: nextParams };
}

export async function GET(request: NextRequest) {
  try {
    // Get scope for authentication
    const scope = await getServerScope(request);
    
    if (!scope) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const role = searchParams.get("role") || "";
    const source = searchParams.get("source") || "";
    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    const datesParam = searchParams.get("dates") || ""; // Comma-separated list of dates
    const startTs = searchParams.get("start_ts") || "";
    const endTs = searchParams.get("end_ts") || "";
    const chipTerms = searchParams
      .getAll("chip_term")
      .map((term) => term.trim())
      .filter(Boolean);
    const chipMode = (searchParams.get("chip_mode") || "AND").toUpperCase() === "OR" ? "OR" : "AND";
    const statsOnly = searchParams.get("stats") || "";
    const findPosition = searchParams.get("find_position"); // Message ID to find position for
    const offset = parseBoundedIntParam(
      searchParams.get("offset"),
      0,
      0,
      ARCHIVE_SEARCH_MAX_OFFSET
    );
    const limit = parseBoundedIntParam(
      searchParams.get("limit"),
      ARCHIVE_SEARCH_DEFAULT_LIMIT,
      1,
      ARCHIVE_SEARCH_MAX_LIMIT
    );
    const dateFilters = datesParam
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    if (source && source !== "chatgpt" && source !== "dartboard") {
      return NextResponse.json({ error: "Invalid source filter" }, { status: 400 });
    }
    if (q.length > ARCHIVE_SEARCH_MAX_QUERY_CHARS) {
      return NextResponse.json(
        { error: `Search query too long. Max ${ARCHIVE_SEARCH_MAX_QUERY_CHARS} characters.` },
        { status: 400 }
      );
    }
    if (chipTerms.length > ARCHIVE_SEARCH_MAX_CHIP_TERMS) {
      return NextResponse.json(
        { error: `Too many chip terms. Max ${ARCHIVE_SEARCH_MAX_CHIP_TERMS}.` },
        { status: 400 }
      );
    }
    if (chipTerms.some((term) => term.length > ARCHIVE_SEARCH_MAX_CHIP_TERM_CHARS)) {
      return NextResponse.json(
        { error: `Chip term too long. Max ${ARCHIVE_SEARCH_MAX_CHIP_TERM_CHARS} characters per chip.` },
        { status: 400 }
      );
    }
    if (dateFilters.length > ARCHIVE_SEARCH_MAX_DATE_FILTERS) {
      return NextResponse.json(
        { error: `Too many date filters. Max ${ARCHIVE_SEARCH_MAX_DATE_FILTERS}.` },
        { status: 400 }
      );
    }

    const db = getDb();
    const plan = getScopePlan(db, scope);
    if (plan !== "plus") {
      const rateLimited = enforceApiRateLimit({
        db,
        request,
        route: { routeKey: "/api/archive/search", limit: 40, windowMs: 60 * 1000 },
        scope,
      });
      if (rateLimited) {
        return rateLimited;
      }
    }

    if (statsOnly) {
      const statsQuery = `
        SELECT 
          MIN(ts) as ts_min, 
          MAX(ts) as ts_max, 
          COUNT(*) as total,
          SUM(CASE WHEN source = 'chatgpt' THEN 1 ELSE 0 END) as chatgpt_count,
          SUM(CASE WHEN source = 'live_chat' THEN 1 ELSE 0 END) as dartboard_count
        FROM (
          SELECT ts, 'chatgpt' as source FROM archive_messages WHERE (user_id = ? OR guest_id = ?)
          UNION ALL
          SELECT created_at as ts, 'live_chat' as source FROM messages WHERE (user_id = ? OR guest_id = ?) AND role IN ('user', 'assistant')
        )
      `;
      const stats = db
        .prepare(statsQuery)
        .get(
          scope.kind === "user" ? scope.userId : null,
          scope.kind === "guest" ? scope.guestId : null,
          scope.kind === "user" ? scope.userId : null,
          scope.kind === "guest" ? scope.guestId : null
        ) as { 
          ts_min: string | null; 
          ts_max: string | null; 
          total: number;
          chatgpt_count: number;
          dartboard_count: number;
        } | undefined;

      return NextResponse.json(
        stats || { ts_min: null, ts_max: null, total: 0, chatgpt_count: 0, dartboard_count: 0 }
      );
    }

    // Position query: find the position of a specific message ID with current filters
    if (findPosition) {
      if (source === "dartboard") {
        return NextResponse.json(
          { error: "find_position is only supported for archive_messages" },
          { status: 400 }
        );
      }
      const messageId = parseInt(findPosition, 10);
      if (isNaN(messageId)) {
        return NextResponse.json(
          { error: "find_position must be a valid message ID" },
          { status: 400 }
        );
      }

      const scopeUserId = scope.kind === "user" ? scope.userId : null;
      const scopeGuestId = scope.kind === "guest" ? scope.guestId : null;

      // Get the target message
      const target = db
        .prepare(
          `SELECT id, ts FROM archive_messages
           WHERE id = ?
           AND (user_id = ? OR guest_id = ?)`
        )
        .get(messageId, scopeUserId, scopeGuestId) as { id: number; ts: string } | undefined;

      if (!target) {
        return NextResponse.json(
          { error: "Message not found" },
          { status: 404 }
        );
      }

      // Build WHERE clause with same filters as search
      let whereClause = `WHERE (user_id = ? OR guest_id = ?)`;
      let params: any[] = [scopeUserId, scopeGuestId];

      // Whole-word filtering for query + chips (no inside-word substring matches).
      const positionSearchFilters = applyWholeWordFilters({
        clause: whereClause,
        params,
        textCol: "text",
        q,
        chipTerms,
        chipMode,
      });
      whereClause = positionSearchFilters.clause;
      params = positionSearchFilters.params;

      if (role && (role === "user" || role === "assistant")) {
        whereClause += ` AND role = ?`;
        params.push(role);
      }

      // Date filtering
      if (startTs && endTs) {
        whereClause += ` AND ts >= ? AND ts <= ?`;
        params.push(startTs);
        params.push(endTs);
      } else if (dateFilters.length > 0) {
        const dateConditions: string[] = [];
        for (const dateStr of dateFilters) {
          const normalizedStart = normalizeDateInput(dateStr, false);
          const normalizedEnd = normalizeDateInput(dateStr, true);
          if (normalizedStart && normalizedEnd) {
            dateConditions.push(`(ts >= ? AND ts <= ?)`);
            params.push(normalizedStart);
            params.push(normalizedEnd);
          }
        }
        if (dateConditions.length > 0) {
          whereClause += ` AND (${dateConditions.join(" OR ")})`;
        }
      } else {
        const normalizedStart = normalizeDateInput(startDate);
        const normalizedEnd = normalizeDateInput(endDate, true);
        if (normalizedStart) {
          whereClause += ` AND ts >= ?`;
          params.push(normalizedStart);
        }
        if (normalizedEnd) {
          whereClause += ` AND ts <= ?`;
          params.push(normalizedEnd);
        }
      }
      
      // Count messages that come before the target message (same order as main query: ts ASC, then id ASC)
      // Messages before: ts < target.ts OR (ts = target.ts AND id < target.id)
      const positionQuery = `
        SELECT COUNT(*) as position
        FROM archive_messages
        ${whereClause}
        AND (ts < ? OR (ts = ? AND id < ?))
      `;
      const positionParams = [...params, target.ts, target.ts, target.id];
      
      const positionResult = db
        .prepare(positionQuery)
        .get(...positionParams) as { position: number } | undefined;

      const position = positionResult?.position ?? 0;

      // Get total count for this filter set
      const countQuery = `SELECT COUNT(*) as total FROM archive_messages ${whereClause}`;
      const countResult = db.prepare(countQuery).get(...params) as { total: number } | undefined;
      const total = countResult?.total ?? 0;

      return NextResponse.json({
        position: position + 1, // 1-indexed position
        total,
      });
    }

    // Build WHERE clause builders for both tables
    // archive_messages uses: ts, text, chat_id, user_id, guest_id
    // messages uses: created_at (as ts), content (as text), session_id (as chat_id), user_id, guest_id
    const buildWhereClause = (tsCol: string, textCol: string, isMessagesTable: boolean = false) => {
      let clause = `WHERE 1=1`;
      let clauseParams: any[] = [];
      
      // Add scope filtering for both archive_messages and messages to prevent cross-user bleed.
      if (isMessagesTable) {
        clause += ` AND (user_id = ? OR guest_id = ?)`;
        clauseParams.push(
          scope.kind === "user" ? scope.userId : null,
          scope.kind === "guest" ? scope.guestId : null
        );
      } else {
        clause += ` AND (user_id = ? OR guest_id = ?)`;
        clauseParams.push(
          scope.kind === "user" ? scope.userId : null,
          scope.kind === "guest" ? scope.guestId : null
        );
      }

      // Source filter:
      // - source=chatgpt => only archive_messages (exclude messages table)
      // - source=dartboard => only messages table (exclude archive_messages)
      if (source) {
        if (source !== "chatgpt" && source !== "dartboard") {
          throw new Error("Invalid source filter");
        }
        const includeThisTable =
          source === "chatgpt" ? !isMessagesTable : isMessagesTable;
        if (!includeThisTable) {
          clause += ` AND 0`;
        }
      }

      // Filter messages table to only include user/assistant roles (live chat messages)
      if (isMessagesTable) {
        clause += ` AND role IN ('user', 'assistant')`;
      }

      // Whole-word filtering for query + chips (no inside-word substring matches).
      const wholeWordFilters = applyWholeWordFilters({
        clause,
        params: clauseParams,
        textCol,
        q,
        chipTerms,
        chipMode,
      });
      clause = wholeWordFilters.clause;
      clauseParams = wholeWordFilters.params;

      // Filter by role
      if (role && (role === "user" || role === "assistant")) {
        clause += ` AND role = ?`;
        clauseParams.push(role);
      }

      // Time-of-day filtering (start_ts/end_ts) takes priority over date range
      if (startTs && endTs) {
        clause += ` AND ${tsCol} >= ? AND ${tsCol} <= ?`;
        clauseParams.push(startTs);
        clauseParams.push(endTs);
      } else if (dateFilters.length > 0) {
        const dateConditions: string[] = [];
        for (const dateStr of dateFilters) {
          const normalizedStart = normalizeDateInput(dateStr, false);
          const normalizedEnd = normalizeDateInput(dateStr, true);
          if (normalizedStart && normalizedEnd) {
            dateConditions.push(`(${tsCol} >= ? AND ${tsCol} <= ?)`);
            clauseParams.push(normalizedStart);
            clauseParams.push(normalizedEnd);
          }
        }
        if (dateConditions.length > 0) {
          clause += ` AND (${dateConditions.join(" OR ")})`;
        }
      } else {
        const normalizedStart = normalizeDateInput(startDate);
        const normalizedEnd = normalizeDateInput(endDate, true);
        if (normalizedStart) {
          clause += ` AND ${tsCol} >= ?`;
          clauseParams.push(normalizedStart);
        }
        if (normalizedEnd) {
          clause += ` AND ${tsCol} <= ?`;
          clauseParams.push(normalizedEnd);
        }
      }

      return { clause, params: clauseParams };
    };

    // Build WHERE clauses for both tables
    const archiveWhere = buildWhereClause("ts", "text", false);
    const messagesWhere = buildWhereClause("created_at", "content", true);

    // Get total count from both tables
    const archiveCountQuery = `SELECT COUNT(*) as total FROM archive_messages ${archiveWhere.clause}`;
    const archiveCountResult = db.prepare(archiveCountQuery).get(...archiveWhere.params) as { total: number } | undefined;
    const archiveTotal = archiveCountResult?.total || 0;

    const messagesCountQuery = `SELECT COUNT(*) as total FROM messages ${messagesWhere.clause}`;
    const messagesCountResult = db.prepare(messagesCountQuery).get(...messagesWhere.params) as { total: number } | undefined;
    const messagesTotal = messagesCountResult?.total || 0;

    const total = archiveTotal + messagesTotal;

    // Build UNION ALL query
    // Both SELECTs must return same columns in same order: id, ts, role, chat_id, text, source
    const unionQuery = `
      SELECT id, ts, role, chat_id, text, source
      FROM archive_messages
      ${archiveWhere.clause}
      UNION ALL
      SELECT id, created_at as ts, role, CAST(session_id AS TEXT) as chat_id, content as text, 'live_chat' as source
      FROM messages
      ${messagesWhere.clause}
      ORDER BY ts ASC
      LIMIT ? OFFSET ?
    `;
    const unionParams = [...archiveWhere.params, ...messagesWhere.params, limit, offset];

    const results = db.prepare(unionQuery).all(...unionParams);

    return NextResponse.json({
      results,
      total,
      offset,
      limit,
      hasMore: offset + results.length < total,
    });
  } catch (error) {
    console.error("Error searching archive:", error);
    return NextResponse.json(
      { error: "Failed to search archive" },
      { status: 500 }
    );
  }
}
