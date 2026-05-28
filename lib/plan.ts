import type Database from "better-sqlite3";
import type { Scope } from "@/lib/scope-server";
import { PLAN_LIMITS, type PlanLimits, type UserPlan } from "@/lib/planLimits";

export type DailyUsageMetric = "web_search" | "image_upload";

export function normalizeUserPlan(value: unknown): UserPlan {
  return value === "plus" ? "plus" : "free";
}

export function getUserPlan(db: Database.Database, userId: string): UserPlan {
  const row = db
    .prepare("SELECT plan FROM user_profile WHERE user_id = ? LIMIT 1")
    .get(userId) as { plan?: string | null } | undefined;
  return normalizeUserPlan(row?.plan);
}

export function getScopePlan(
  db: Database.Database,
  scope: Scope
): UserPlan {
  if (scope.kind !== "user") return "free";
  return getUserPlan(db, scope.userId);
}

export function getPlanLimits(plan: UserPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function getScopePlanLimits(
  db: Database.Database,
  scope: Scope
): { plan: UserPlan; limits: PlanLimits } {
  const plan = getScopePlan(db, scope);
  return { plan, limits: getPlanLimits(plan) };
}

export function getDailyUsageCount(
  db: Database.Database,
  userId: string,
  metric: DailyUsageMetric
): number {
  const row = db
    .prepare(
      `SELECT count
       FROM daily_usage
       WHERE user_id = ?
         AND usage_date = date('now')
         AND metric = ?`
    )
    .get(userId, metric) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function incrementDailyUsage(
  db: Database.Database,
  userId: string,
  metric: DailyUsageMetric,
  delta = 1
): number {
  const step = Math.max(1, Math.trunc(delta || 1));
  db.prepare(
    `INSERT INTO daily_usage (user_id, usage_date, metric, count)
     VALUES (?, date('now'), ?, ?)
     ON CONFLICT(user_id, usage_date, metric)
     DO UPDATE SET count = count + excluded.count`
  ).run(userId, metric, step);

  return getDailyUsageCount(db, userId, metric);
}

