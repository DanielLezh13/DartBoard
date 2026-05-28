import { createServerClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import {
  getAppUrl,
  getBillingRowByUserId,
  stripeGet,
  stripePostForm,
  updateBillingForUser,
} from "@/lib/stripeBilling";

export async function POST(request: Request) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const db = getDb();
    const appUrl = getAppUrl(new URL(request.url).origin);
    const billingRow = getBillingRowByUserId(db, user.id);
    let customerId = billingRow?.stripe_customer_id ?? null;

    if (!customerId && user.email) {
      const query = new URLSearchParams({
        email: user.email,
        limit: "1",
      });
      const customerList = await stripeGet("/v1/customers", query);
      const candidate = Array.isArray(customerList?.data) ? customerList.data[0] : null;
      if (candidate && typeof candidate.id === "string") {
        customerId = candidate.id;
        updateBillingForUser(db, user.id, { stripeCustomerId: customerId });
      }
    }

    if (!customerId) {
      return Response.json(
        { error: "No Stripe customer found for this account yet." },
        { status: 400 }
      );
    }

    const portalSession = await stripePostForm("/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: `${appUrl}/chat`,
    });

    if (typeof portalSession?.url !== "string" || portalSession.url.length === 0) {
      return Response.json(
        { error: "Stripe portal session URL was missing." },
        { status: 502 }
      );
    }

    return Response.json({ url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open billing portal.";
    return Response.json({ error: message }, { status: 500 });
  }
}
