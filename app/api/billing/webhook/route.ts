import { getDb } from "@/lib/db";
import {
  getUserIdByStripeCustomerId,
  subscriptionStatusToPlan,
  updateBillingForUser,
  verifyStripeWebhookSignature,
} from "@/lib/stripeBilling";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: "Missing STRIPE_WEBHOOK_SECRET." },
      { status: 500 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  const isValid = verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const type = typeof event?.type === "string" ? event.type : "";
  const object = event?.data?.object ?? {};
  const db = getDb();

  try {
    if (type === "checkout.session.completed") {
      const userId =
        (typeof object?.metadata?.user_id === "string" && object.metadata.user_id) ||
        (typeof object?.client_reference_id === "string" && object.client_reference_id) ||
        null;
      if (userId) {
        updateBillingForUser(db, userId, {
          plan: "plus",
          stripeCustomerId:
            typeof object?.customer === "string" ? object.customer : undefined,
          stripeSubscriptionId:
            typeof object?.subscription === "string" ? object.subscription : undefined,
        });
      }
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const customerId = typeof object?.customer === "string" ? object.customer : null;
      const subscriptionId = typeof object?.id === "string" ? object.id : null;

      let userId =
        (typeof object?.metadata?.user_id === "string" && object.metadata.user_id) ||
        null;
      if (!userId && customerId) {
        userId = getUserIdByStripeCustomerId(db, customerId);
      }

      if (userId) {
        const nextPlan =
          type === "customer.subscription.deleted"
            ? "free"
            : subscriptionStatusToPlan(
                typeof object?.status === "string" ? object.status : null
              );

        updateBillingForUser(db, userId, {
          plan: nextPlan,
          stripeCustomerId: customerId ?? undefined,
          stripeSubscriptionId: subscriptionId ?? undefined,
        });
      }
    }
  } catch (error) {
    console.error("[billing.webhook] Failed to process event:", error);
    return Response.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}
