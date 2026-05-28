import { createServerClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import { getPlanLimits, getUserPlan } from "@/lib/plan";

export async function GET() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({
      userId: null,
      email: null,
      plan: null,
      limits: null,
    });
  }

  const db = getDb();
  const plan = getUserPlan(db, user.id);
  const limits = getPlanLimits(plan);

  const jsonSafeLimits = Object.fromEntries(
    Object.entries(limits).map(([key, value]) => [
      key,
      typeof value === "number" && !Number.isFinite(value) ? null : value,
    ])
  );
  
  return Response.json({ 
    userId: user.id,
    email: user.email ?? null,
    plan,
    limits: jsonSafeLimits,
  });
}
