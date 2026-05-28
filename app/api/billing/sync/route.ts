import { createServerClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import {
  getBillingRowByUserId,
  stripeGet,
  subscriptionStatusToPlan,
  updateBillingForUser,
} from "@/lib/stripeBilling";

export async function POST() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const db = getDb();
    const billingRow = getBillingRowByUserId(db, user.id);
    let customerId = billingRow?.stripe_customer_id ?? null;

    if (!customerId && user.email) {
      const customerList = await stripeGet(
        "/v1/customers",
        new URLSearchParams({ email: user.email, limit: "1" })
      );
      const candidate = Array.isArray(customerList?.data) ? customerList.data[0] : null;
      if (candidate && typeof candidate.id === "string") {
        customerId = candidate.id;
      }
    }

    if (!customerId) {
      updateBillingForUser(db, user.id, { plan: "free" });
      return Response.json({ plan: "free", customerId: null, subscriptionId: null });
    }

    const subscriptions = await stripeGet(
      "/v1/subscriptions",
      new URLSearchParams({ customer: customerId, status: "all", limit: "100" })
    );
    const list = Array.isArray(subscriptions?.data) ? subscriptions.data : [];

    const activeish = list.find((sub: any) => {
      const status = String(sub?.status || "").toLowerCase();
      return status === "active" || status === "trialing" || status === "past_due";
    });

    const best = activeish ?? list[0] ?? null;
    const status = typeof best?.status === "string" ? best.status : null;
    const plan = subscriptionStatusToPlan(status);
    const subscriptionId = typeof best?.id === "string" ? best.id : null;

    updateBillingForUser(db, user.id, {
      plan,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });

    return Response.json({ plan, customerId, subscriptionId, status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync billing status.";
    return Response.json({ error: message }, { status: 500 });
  }
}

