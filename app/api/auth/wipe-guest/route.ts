import { createServerClient } from '@/lib/supabase/server'
import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { wipeGuestDataByGuestId } from '@/lib/guest-data'
import { GUEST_COOKIE_NAME, parseSignedGuestCookie } from '@/lib/guest-cookie'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let guestId = request.headers.get("x-db-guest-id")?.trim() || null

    // Legacy fallback while old cookie-based guests age out.
    if (!guestId) {
      const cookieValue = request.cookies.get(GUEST_COOKIE_NAME)?.value ?? null
      const parsedGuest = await parseSignedGuestCookie(cookieValue)
      guestId = parsedGuest?.guestId ?? null
    }

    if (!guestId) {
      return NextResponse.json({ error: 'No active guest session found' }, { status: 400 })
    }

    const db = getDb()

    const results = wipeGuestDataByGuestId(db, guestId)
    const wipedCount = Object.values(results).reduce((sum, value) => sum + value, 0)

    return NextResponse.json({ success: true, wiped: wipedCount > 0, results })
  } catch (error) {
    console.error('[WIPE GUEST] Error:', error)
    return NextResponse.json({ error: 'Failed to wipe' }, { status: 500 })
  }
}
