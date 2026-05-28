import { getOrCreateGuestIdFromSessionStorage } from "@/lib/guest";

export function getAuthHeaders(): HeadersInit {
  let guestId: string | null = null;
  if (typeof window !== "undefined") {
    try {
      guestId = getOrCreateGuestIdFromSessionStorage();
    } catch {
      guestId = null;
    }
  }

  return {
    "Content-Type": "application/json",
    ...(guestId ? { "x-guest-id": guestId } : {}),
  };
}
