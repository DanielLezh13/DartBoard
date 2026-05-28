import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerScope } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

const ARCHIVE_SEARCH_MAX_QUERY_CHARS = 400;
const ARCHIVE_SEARCH_MAX_CHIP_TERMS = 12;
const ARCHIVE_SEARCH_MAX_CHIP_TERM_CHARS = 64;

function normalizeDateInput(value: string, isEnd = false): string {
  if (!value) return "";
  if (value.includes("T")) return value;
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return value;
  const localDate = new Date(year, month, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0);
  return localDate.toISOString();
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

export type MonthlyCountsResponse = { [K in (typeof MONTH_KEYS)[number]]: number };

export async function GET(request: NextRequest) {
  try {
    const scope = await getServerScope(request);
    if (!scope) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const q = (searchParams.get("q") || "").trim();
    const role = searchParams.get("role") || "";
    const source = searchParams.get("source") || "";
    const chipTerms = searchParams.getAll("chip_term").map((t) => t.trim()).filter(Boolean);
    const chipMode = (searchParams.get("chip_mode") || "AND").toUpperCase() === "OR" ? "OR" : "AND";

    const year = yearParam ? parseInt(yearParam, 10) : NaN;
    if (isNaN(year) || year < 1970 || year > 2100) {
      return NextResponse.json({ error: "Valid year required" }, { status: 400 });
    }
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

    const yearStart = normalizeDateInput(`${year}-01-01`);
    const yearEnd = normalizeDateInput(`${year}-12-31`, true);
    if (!yearStart || !yearEnd) {
      return NextResponse.json({ error: "Invalid year bounds" }, { status: 400 });
    }

    const db = getDb();

    // Build WHERE for archive_messages: same filters as search + year bounds
    const buildArchiveWhere = () => {
      let clause = `WHERE (user_id = ? OR guest_id = ?)`;
      const params: (string | null)[] = [
        scope.kind === "user" ? scope.userId : null,
        scope.kind === "guest" ? scope.guestId : null,
      ];

      if (source === "dartboard") {
        clause += ` AND 0`;
        return { clause, params };
      }
      if (source === "chatgpt") {
        // include archive only
      }

      if (q) {
        clause += ` AND text LIKE ?`;
        params.push(`%${q}%`);
      }
      if (chipTerms.length > 0) {
        if (chipMode === "OR") {
          const orConditions = chipTerms.map(() => `text LIKE ?`).join(" OR ");
          clause += ` AND (${orConditions})`;
          chipTerms.forEach((term) => params.push(`%${term}%`));
        } else {
          chipTerms.forEach((term) => {
            clause += ` AND text LIKE ?`;
            params.push(`%${term}%`);
          });
        }
      }
      if (role && (role === "user" || role === "assistant")) {
        clause += ` AND role = ?`;
        params.push(role);
      }

      clause += ` AND ts >= ? AND ts <= ?`;
      params.push(yearStart, yearEnd);
      return { clause, params };
    };

    // Build WHERE for messages (created_at, content, same filters + scope isolation)
    const buildMessagesWhere = () => {
      let clause = `WHERE (user_id = ? OR guest_id = ?) AND role IN ('user', 'assistant')`;
      const params: (string | null)[] = [
        scope.kind === "user" ? scope.userId : null,
        scope.kind === "guest" ? scope.guestId : null,
      ];

      if (source === "chatgpt") {
        clause += ` AND 0`;
        return { clause, params };
      }
      if (source === "dartboard") {
        // include messages only
      }

      if (q) {
        clause += ` AND content LIKE ?`;
        params.push(`%${q}%`);
      }
      if (chipTerms.length > 0) {
        if (chipMode === "OR") {
          const orConditions = chipTerms.map(() => `content LIKE ?`).join(" OR ");
          clause += ` AND (${orConditions})`;
          chipTerms.forEach((term) => params.push(`%${term}%`));
        } else {
          chipTerms.forEach((term) => {
            clause += ` AND content LIKE ?`;
            params.push(`%${term}%`);
          });
        }
      }
      if (role && (role === "user" || role === "assistant")) {
        clause += ` AND role = ?`;
        params.push(role);
      }

      clause += ` AND created_at >= ? AND created_at <= ?`;
      params.push(yearStart, yearEnd);
      return { clause, params };
    };

    const archiveWhere = buildArchiveWhere();
    const messagesWhere = buildMessagesWhere();

    // SQLite: strftime('%m', ts) returns '01'..'12'; CAST to INTEGER gives 1-12
    const archiveQuery = `
      SELECT CAST(strftime('%m', ts) AS INTEGER) as month, COUNT(*) as c
      FROM archive_messages
      ${archiveWhere.clause}
      GROUP BY month
    `;
    const messagesQuery = `
      SELECT CAST(strftime('%m', created_at) AS INTEGER) as month, COUNT(*) as c
      FROM messages
      ${messagesWhere.clause}
      GROUP BY month
    `;

    const archiveRows = db.prepare(archiveQuery).all(...archiveWhere.params) as { month: number; c: number }[];
    const messagesRows = db.prepare(messagesQuery).all(...messagesWhere.params) as { month: number; c: number }[];

    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const row of archiveRows) {
      if (row.month >= 1 && row.month <= 12) counts[row.month - 1] += row.c;
    }
    for (const row of messagesRows) {
      if (row.month >= 1 && row.month <= 12) counts[row.month - 1] += row.c;
    }

    const body: MonthlyCountsResponse = {
      jan: counts[0],
      feb: counts[1],
      mar: counts[2],
      apr: counts[3],
      may: counts[4],
      jun: counts[5],
      jul: counts[6],
      aug: counts[7],
      sep: counts[8],
      oct: counts[9],
      nov: counts[10],
      dec: counts[11],
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error("Error fetching monthly counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch monthly counts" },
      { status: 500 }
    );
  }
}
