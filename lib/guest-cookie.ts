const DEFAULT_GUEST_COOKIE_SECRET = "dartboard-dev-guest-cookie-secret";

export const GUEST_COOKIE_NAME = "db_guest";
export const GUEST_COOKIE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

type GuestCookieData = {
  guestId: string;
  issuedAt: number;
};

const GUEST_ID_PATTERN = /^guest_[a-z0-9]{16,64}$/i;
const textEncoder = new TextEncoder();

function getGuestCookieSecret(): string {
  const configuredSecret =
    process.env.GUEST_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (configuredSecret && configuredSecret.trim().length >= 16) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("GUEST_COOKIE_SECRET must be set in production");
  }

  return DEFAULT_GUEST_COOKIE_SECRET;
}

function toBase64(binary: string): string {
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  const BufferCtor = (globalThis as { Buffer?: { from: (v: string, e: string) => { toString: (enc: string) => string } } }).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(binary, "binary").toString("base64");
  }
  throw new Error("Base64 encoder unavailable");
}

function fromBase64(base64: string): string {
  if (typeof atob === "function") {
    return atob(base64);
  }
  const BufferCtor = (globalThis as { Buffer?: { from: (v: string, e: string) => { toString: (enc: string) => string } } }).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(base64, "base64").toString("binary");
  }
  throw new Error("Base64 decoder unavailable");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return toBase64(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = fromBase64(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(getGuestCookieSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload: string): Promise<string> {
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyPayload(payload: string, signatureBase64Url: string): Promise<boolean> {
  try {
    const key = await getHmacKey();
    const rawSignatureBytes = base64UrlToBytes(signatureBase64Url);
    const signatureBytes = new Uint8Array(rawSignatureBytes.length);
    signatureBytes.set(rawSignatureBytes);
    return crypto.subtle.verify("HMAC", key, signatureBytes.buffer, textEncoder.encode(payload));
  } catch {
    return false;
  }
}

export function createGuestId(): string {
  return `guest_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function createSignedGuestCookieValue(guestId: string, issuedAt = Date.now()): Promise<string> {
  const payload = `${guestId}.${issuedAt}`;
  const signature = await signPayload(payload);
  return `${payload}.${signature}`;
}

export async function parseSignedGuestCookie(
  cookieValue: string | undefined | null
): Promise<GuestCookieData | null> {
  if (!cookieValue) return null;

  const firstDot = cookieValue.indexOf(".");
  const secondDot = cookieValue.indexOf(".", firstDot + 1);
  if (firstDot <= 0 || secondDot <= firstDot + 1) return null;

  const guestId = cookieValue.slice(0, firstDot);
  const issuedAtRaw = cookieValue.slice(firstDot + 1, secondDot);
  const signature = cookieValue.slice(secondDot + 1);

  if (!GUEST_ID_PATTERN.test(guestId)) return null;

  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;

  const ageMs = Date.now() - issuedAt;
  if (ageMs < 0 || ageMs > GUEST_COOKIE_TTL_SECONDS * 1000) return null;

  const payload = `${guestId}.${issuedAt}`;
  const isValid = await verifyPayload(payload, signature);
  if (!isValid) return null;

  return { guestId, issuedAt };
}
