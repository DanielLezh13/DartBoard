"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/browser"

function AuthCallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      const next = searchParams.get('next') ?? '/'
      const code = searchParams.get("code")

      const supabase = createClient()

      // Safety: never hang on this screen.
      const timeout = window.setTimeout(() => {
        console.warn("[CLIENT CALLBACK] Timeout - redirecting anyway", { next })
        router.replace(next)
      }, 4000)

      try {
        // In PKCE flows, the redirect includes `code=` and we must exchange it for a session.
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.error("[CLIENT CALLBACK] exchangeCodeForSession failed", exchangeError)
          }
        }

        const { data: { session }, error } = await supabase.auth.getSession()

        if (!error && session) {
          try {
            const syncResponse = await fetch('/api/auth/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accessToken: session.access_token,
                refreshToken: session.refresh_token
              })
            })

            if (!syncResponse.ok) {
              console.error('[CLIENT CALLBACK] Sync failed', { status: syncResponse.status })
            }
          } catch (syncError) {
            console.error('[CLIENT CALLBACK] Sync error:', syncError)
          }
        }
      } catch (e) {
        console.error("[CLIENT CALLBACK] Callback handler error:", e)
      } finally {
        window.clearTimeout(timeout)
        router.replace(next)
      }
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        <p className="mt-4 text-gray-600">Signing you in...</p>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  // `useSearchParams()` triggers a CSR bailout during static prerender; wrap in Suspense per Next.js.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
            <p className="mt-4 text-gray-600">Signing you in...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  )
}
