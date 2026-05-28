import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { accessToken, refreshToken } = await request.json()
    
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 400 })
    }

    const supabase = createServerClient()
    
    // Set the session using the tokens
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || ''
    })

    if (error) {
      console.error('[SYNC] Failed to set session:', error)
      return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[SYNC] Error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
