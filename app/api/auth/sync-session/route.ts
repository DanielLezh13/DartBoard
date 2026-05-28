import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Read the session from the Authorization header (sent from client)
    const authHeader = request.headers.get('authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No session' }, { status: 401 })
    }

    const token = authHeader.split(' ')[1]
    
    // Create a temporary client with the token to get the user
    const tempSupabase = createServerClient()
    
    // Get the user using the token
    const { data: { user }, error } = await tempSupabase.auth.getUser(token)
    
    if (error || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Now create a new session using the server client
    // This will set the proper cookies
    const { error: signInError } = await tempSupabase.auth.setSession({
      access_token: token,
      refresh_token: request.headers.get('x-refresh-token') || ''
    })

    if (signInError) {
      return NextResponse.json({ error: 'Failed to sync' }, { status: 500 })
    }

    return NextResponse.json({ success: true, userId: user.id })
  } catch (error) {
    console.error('[SYNC SESSION] Error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
