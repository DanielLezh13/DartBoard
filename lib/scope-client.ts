import { getOrCreateGuestIdFromSessionStorage } from './guest'
import { createClient } from './supabase/browser'
import {
  getHeadersForScope,
  scopeToWhereClause,
  type Scope,
} from "./scope-shared";

export { getHeadersForScope, scopeToWhereClause, type Scope } from "./scope-shared";

/**
 * Client-side: Get scope from localStorage (user) or memory (guest)
 */
export async function getClientScope(): Promise<Scope> {
  if (typeof window === 'undefined') {
    throw new Error('getClientScope can only be used on client')
  }
  
  // Check if we have a user session using Supabase client
  try {
    const supabase = createClient()
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) {
      return { kind: "user", userId: data.user.id }
    }
  } catch {
    // Failed to get user, fall back to guest
  }
  
  // Guest mode - stable per-tab id from sessionStorage
  return { kind: "guest", guestId: getOrCreateGuestIdFromSessionStorage() }
}
