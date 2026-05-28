import crypto from "crypto";
import type Database from "better-sqlite3";

export type StripePlan = "free" | "plus";

type BillingRow = {
  id: number;
  user_id: string | null;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function isDuplicateColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("duplicate column");
}

export function ensureBillingColumns(db: Database.Database): void {
  try {
    db.prepare("ALTER TABLE user_profile ADD COLUMN user_id TEXT").run();
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
  }

  try {
    db.prepare("ALTER TABLE user_profile ADD COLUMN stripe_customer_id TEXT").run();
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
  }

  try {
    db.prepare("ALTER TABLE user_profile ADD COLUMN stripe_subscription_id TEXT").run();
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
  }
}

export function ensureUserProfileRow(db: Database.Database, userId: string): void {
  const existing = db
    .prepare("SELECT id FROM user_profile WHERE user_id = ? LIMIT 1")
    .get(userId) as { id: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO user_profile (user_id, plan, core_spec)
       VALUES (?, 'free', '')`
    ).run(userId);
  }
}

export function getBillingRowByUserId(
  db: Database.Database,
  userId: string
): BillingRow | null {
  ensureBillingColumns(db);
  ensureUserProfileRow(db, userId);

  const row = db
    .prepare(
      `SELECT id, user_id, plan, stripe_customer_id, stripe_subscription_id
       FROM user_profile
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(userId) as BillingRow | undefined;

  return row ?? null;
}

export function getUserIdByStripeCustomerId(
  db: Database.Database,
  customerId: string
): string | null {
  ensureBillingColumns(db);
  const row = db
    .prepare(
      `SELECT user_id
       FROM user_profile
       WHERE stripe_customer_id = ?
         AND user_id IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(customerId) as { user_id: string | null } | undefined;

  return row?.user_id ?? null;
}

export function updateBillingForUser(
  db: Database.Database,
  userId: string,
  updates: {
    plan?: StripePlan;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }
): void {
  ensureBillingColumns(db);
  ensureUserProfileRow(db, userId);

  const current = getBillingRowByUserId(db, userId);
  if (!current) return;

  const nextPlan = updates.plan ?? (current.plan === "plus" ? "plus" : "free");
  const nextCustomerId =
    updates.stripeCustomerId === undefined
      ? current.stripe_customer_id
      : updates.stripeCustomerId;
  const nextSubscriptionId =
    updates.stripeSubscriptionId === undefined
      ? current.stripe_subscription_id
      : updates.stripeSubscriptionId;

  db.prepare(
    `UPDATE user_profile
     SET plan = ?,
         stripe_customer_id = ?,
         stripe_subscription_id = ?
     WHERE id = ?`
  ).run(nextPlan, nextCustomerId, nextSubscriptionId, current.id);
}

export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }
  return key;
}

export function getStripePlusPriceId(): string {
  const rawPriceId = process.env.STRIPE_PLUS_PRICE_ID;
  if (!rawPriceId) {
    throw new Error("Missing STRIPE_PLUS_PRICE_ID.");
  }
  // Guard against accidental pasted quotes/whitespace from dashboard copy.
  const priceId = rawPriceId.trim().replace(/^['"]+|['"]+$/g, "");
  if (!priceId.startsWith("price_")) {
    throw new Error("STRIPE_PLUS_PRICE_ID must start with 'price_'.");
  }
  return priceId;
}

export function getAppUrl(originFallback: string): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return originFallback.replace(/\/+$/, "");
}

export async function stripePostForm(
  path: string,
  data: Record<string, string>
): Promise<any> {
  const secretKey = getStripeSecretKey();
  const body = new URLSearchParams(data).toString();

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : "Stripe request failed.";
    const error = new Error(message) as Error & { status?: number; payload?: any };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function stripeGet(path: string, query?: URLSearchParams): Promise<any> {
  const secretKey = getStripeSecretKey();
  const queryString = query && query.toString().length > 0 ? `?${query.toString()}` : "";

  const response = await fetch(`https://api.stripe.com${path}${queryString}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : "Stripe request failed.";
    const error = new Error(message) as Error & { status?: number; payload?: any };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function findMonthlyPriceIdForPlus(
  preferredProductName = "DartBoard Plus"
): Promise<string | null> {
  const normalizedProductName = preferredProductName.trim().toLowerCase();
  const products = await stripeGet(
    "/v1/products",
    new URLSearchParams({ active: "true", limit: "100" })
  );

  const productList = Array.isArray(products?.data) ? products.data : [];
  const matchedProduct = productList.find(
    (product: any) =>
      typeof product?.name === "string" &&
      product.name.trim().toLowerCase() === normalizedProductName
  );

  if (!matchedProduct?.id || typeof matchedProduct.id !== "string") {
    return null;
  }

  const prices = await stripeGet(
    "/v1/prices",
    new URLSearchParams({
      product: matchedProduct.id,
      active: "true",
      limit: "100",
      type: "recurring",
    })
  );

  const priceList = Array.isArray(prices?.data) ? prices.data : [];
  const monthlyUsd = priceList.find(
    (price: any) =>
      typeof price?.id === "string" &&
      price?.active === true &&
      String(price?.currency || "").toLowerCase() === "usd" &&
      String(price?.type || "").toLowerCase() === "recurring" &&
      String(price?.recurring?.interval || "").toLowerCase() === "month"
  );

  return typeof monthlyUsd?.id === "string" ? monthlyUsd.id : null;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const v1Parts = parts.filter((part) => part.startsWith("v1="));
  if (!timestampPart || v1Parts.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return v1Parts.some((entry) => timingSafeEqualHex(expected, entry.slice(3)));
}

export function subscriptionStatusToPlan(status: string | null | undefined): StripePlan {
  const value = (status ?? "").toLowerCase();
  if (value === "active" || value === "trialing" || value === "past_due") {
    return "plus";
  }
  return "free";
}
