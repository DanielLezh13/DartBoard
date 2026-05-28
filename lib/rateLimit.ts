import type Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";
import type { Scope } from "@/lib/scope-server";

type RateLimitArgs = {
  actorKey: string;
  routeKey: string;
  limit: number;
  nowMs: number;
  windowMs: number;
};

type RateLimitRule = {
  routeKey: string;
  limit: number;
  windowMs: number;
};

const GLOBAL_API_RATE_LIMIT: RateLimitRule = {
  routeKey: "/api/*",
  limit: 120,
  windowMs: 60 * 1000,
};

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function getActorKey(request: NextRequest, scope?: Scope | null): string {
  if (scope?.kind === "user") return `user:${scope.userId}`;
  if (scope?.kind === "guest") return `guest:${scope.guestId}`;
  return `ip:${getClientIp(request)}`;
}

function consumeRateLimitBucket(
  db: Database.Database,
  args: RateLimitArgs
): number | null {
  const bucketStartMs = args.nowMs - (args.nowMs % args.windowMs);
  const minWindowStartMs = args.nowMs - Math.max(args.windowMs, GLOBAL_API_RATE_LIMIT.windowMs) * 4;

  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM api_rate_limits
       WHERE window_start_ms < ?`
    ).run(minWindowStartMs);

    const row = db
      .prepare(
        `SELECT count
         FROM api_rate_limits
         WHERE route_key = ? AND actor_key = ? AND window_start_ms = ?`
      )
      .get(args.routeKey, args.actorKey, bucketStartMs) as { count: number } | undefined;

    const nextCount = (row?.count ?? 0) + 1;

    if (row) {
      db.prepare(
        `UPDATE api_rate_limits
         SET count = ?
         WHERE route_key = ? AND actor_key = ? AND window_start_ms = ?`
      ).run(nextCount, args.routeKey, args.actorKey, bucketStartMs);
    } else {
      db.prepare(
        `INSERT INTO api_rate_limits (route_key, actor_key, window_start_ms, count)
         VALUES (?, ?, ?, ?)`
      ).run(args.routeKey, args.actorKey, bucketStartMs, nextCount);
    }

    if (nextCount > args.limit) {
      return Math.max(
        1,
        Math.ceil((bucketStartMs + args.windowMs - args.nowMs) / 1000)
      );
    }

    return null;
  });

  return tx();
}

function rateLimitExceededResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
      },
    }
  );
}

export function enforceApiRateLimit(args: {
  db: Database.Database;
  request: NextRequest;
  route: RateLimitRule;
  scope?: Scope | null;
}): NextResponse | null {
  const actorKey = getActorKey(args.request, args.scope);
  const nowMs = Date.now();

  const routeRetryAfter = consumeRateLimitBucket(args.db, {
    actorKey,
    routeKey: args.route.routeKey,
    limit: args.route.limit,
    nowMs,
    windowMs: args.route.windowMs,
  });
  if (routeRetryAfter !== null) {
    return rateLimitExceededResponse(routeRetryAfter);
  }

  const globalRetryAfter = consumeRateLimitBucket(args.db, {
    actorKey,
    routeKey: GLOBAL_API_RATE_LIMIT.routeKey,
    limit: GLOBAL_API_RATE_LIMIT.limit,
    nowMs,
    windowMs: GLOBAL_API_RATE_LIMIT.windowMs,
  });
  if (globalRetryAfter !== null) {
    return rateLimitExceededResponse(globalRetryAfter);
  }

  return null;
}
