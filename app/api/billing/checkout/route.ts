import { createServerClient } from "@/lib/supabase/server";
import { getDb } from "@/lib/db";
import {
  findMonthlyPriceIdForPlus,
  getAppUrl,
  getBillingRowByUserId,
  getStripePlusPriceId,
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
    const configuredPriceId = getStripePlusPriceId();
    let priceId = configuredPriceId;

    const billingRow = getBillingRowByUserId(db, user.id);
    const existingCustomerId = billingRow?.stripe_customer_id ?? null;

    const payload: Record<string, string> = {
      mode: "subscription",
      success_url: `${appUrl}/chat?billing=success`,
      cancel_url: `${appUrl}/chat?billing=cancel`,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: user.id,
      "metadata[user_id]": user.id,
      "subscription_data[metadata][user_id]": user.id,
      allow_promotion_codes: "true",
    };

    if (existingCustomerId) {
      payload.customer = existingCustomerId;
    } else if (user.email) {
      payload.customer_email = user.email;
    }

    let session: any;
    try {
      session = await stripePostForm("/v1/checkout/sessions", payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const isNoSuchPrice = /no such price/i.test(message);
      if (!isNoSuchPrice) {
        throw error;
      }

      const fallbackPriceId = await findMonthlyPriceIdForPlus(
        process.env.STRIPE_PLUS_PRODUCT_NAME || "DartBoard Plus"
      );
      if (!fallbackPriceId) {
        throw new Error(
          `No such price: '${configuredPriceId}'. Also could not auto-find a monthly price for Plus.`
        );
      }

      priceId = fallbackPriceId;
      payload["line_items[0][price]"] = priceId;
      session = await stripePostForm("/v1/checkout/sessions", payload);
    }

    if (typeof session?.customer === "string" && session.customer.length > 0) {
      updateBillingForUser(db, user.id, {
        stripeCustomerId: session.customer,
      });
    }

    if (typeof session?.url !== "string" || session.url.length === 0) {
      return Response.json(
        { error: "Stripe checkout session URL was missing." },
        { status: 502 }
      );
    }

    return Response.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start checkout.";
    return Response.json({ error: message }, { status: 500 });
  }
}
