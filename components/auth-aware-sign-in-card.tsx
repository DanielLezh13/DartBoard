"use client"

import React, { useState, useEffect } from "react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/browser"
import { useRouter } from "next/navigation"
import { clearGuestSessionStorage } from "@/lib/guest-keys"
import { SignInCard } from "./sign-in-card"

export function AuthAwareSignInCard() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearGuestSessionStorage()
    router.refresh()
  }

  if (loading) {
    return <div className="w-full max-w-md"><SignInCard /></div>
  }

  if (user) {
    return (
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center py-10">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-4">
              {user.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external avatar URLs come from auth provider metadata
                <img
                  src={user.user_metadata.avatar_url as string}
                  alt="Profile"
                  className="h-12 w-12 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-muted" />
              )}

              <div className="min-w-0">
                <div className="truncate text-foreground">
                  {(user.user_metadata?.full_name as string) ||
                    (user.user_metadata?.name as string) ||
                    "Signed in"}
                </div>
                <div className="truncate text-sm text-muted-foreground">{user.email}</div>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="mt-6 w-full rounded-lg bg-muted px-4 py-2 text-foreground hover:bg-muted/80"
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <SignInCard />
}
