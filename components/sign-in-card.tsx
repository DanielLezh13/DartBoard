"use client"

import React, { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/browser"

export function SignInCard() {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setIsLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/`,
          queryParams: {
            prompt: 'select_account'
          }
        }
      })
      if (error) {
        console.error('Google sign in error:', error)
      }
    } catch (error) {
      console.error('Google sign in error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full rounded-xl p-6 bg-slate-900/60 backdrop-blur-md border border-blue-500/20 shadow-[0_10px_40px_rgba(0,0,0,0.25)] relative isolate overflow-hidden">
      {/* Top edge highlight */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-blue-400/5 to-transparent [mask-image:linear-gradient(to_bottom,black_40%,transparent)]"></div>
      {/* Inner shadow */}
      <div className="absolute inset-0 rounded-xl shadow-inner [box-shadow:inset_0_1px_0_rgba(255,255,255,0.04)] pointer-events-none"></div>
      
      <div className={`relative z-10 transition-all duration-300 ${isLoaded ? 'opacity-100 blur-0' : 'opacity-0 blur-md'}`}>
        <div className="text-center mb-6 relative">
          <h1 className="text-lg font-semibold text-white/90 tracking-tight">Sign in to DartBoard</h1>
          <p className="text-white/60 text-sm mt-2">Save your chats, sync memories, and access your archive anywhere.</p>
        </div>


      <button
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        className="w-full py-3 px-4 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg font-medium
          text-white hover:border-blue-400/40 active:bg-blue-500/40 transition-all duration-200
          flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {isLoading ? 'Signing in...' : 'Continue with Google'}
      </button>

      <p className="text-center text-xs text-white/50 mt-3">
        Your first sign-in automatically creates an account.
      </p>
      </div>
    </div>
  )
}
