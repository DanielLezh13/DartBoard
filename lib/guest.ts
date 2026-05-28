export const GUEST_ID_KEY = 'dartboard-guest-id'

/** SessionStorage key for stable per-tab guest id (survives refresh, tab-only). */
const GUEST_ID_SESSION_KEY = 'db:guestId'

// Store guest ID in memory only (truly ephemeral - dies on refresh)
let memoryGuestId: string | null = null

export function getGuestId(): string {
  if (typeof window === 'undefined') return ''

  // Create new guest ID if not in memory (new on page load/refresh)
  if (!memoryGuestId) {
    memoryGuestId = `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  return memoryGuestId
}

/**
 * Get or create a stable guest id in sessionStorage (per-tab, survives refresh).
 * Regenerated only when key is missing.
 */
export function getOrCreateGuestIdFromSessionStorage(): string {
  if (typeof window === 'undefined') return ''
  try {
    const stored = sessionStorage.getItem(GUEST_ID_SESSION_KEY)
    if (stored) {
      return stored
    }
    const id = `guest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    sessionStorage.setItem(GUEST_ID_SESSION_KEY, id)
    return id
  } catch {
    return getGuestId()
  }
}

export function clearGuestId(): void {
  if (typeof window === 'undefined') return
  memoryGuestId = null
}

/**
 * Remove db:guestId from sessionStorage so the next getOrCreateGuestIdFromSessionStorage()
 * will generate a fresh guest ID. Used on user→guest transition (sign-out) so we get
 * guest B (empty) instead of guest A (stale data).
 */
export function resetGuestId(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(GUEST_ID_SESSION_KEY)
  } catch {
    // ignore
  }
  memoryGuestId = null
}
