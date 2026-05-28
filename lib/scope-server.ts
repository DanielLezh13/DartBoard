import { createServerClient } from "./supabase/server";
import { NextRequest } from "next/server";
import type { Scope } from "./scope-shared";

/**
 * Server-side: Get scope from request (cookies for user, headers for guest)
 */
export async function getServerScope(request: NextRequest): Promise<Scope> {
  // Check for authenticated user first
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (user) {
    return { kind: "user", userId: user.id }
  }

  // Fall back to trusted guest identity from middleware.
  const trustedGuestId = request.headers.get("x-db-guest-id");
  if (trustedGuestId) {
    return { kind: "guest", guestId: trustedGuestId };
  }

  throw new Error("No authenticated user or guest identity found");
}

export type { Scope } from "./scope-shared";
export { scopeToWhereClause, getHeadersForScope } from "./scope-shared";
