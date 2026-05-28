"use client"

import React, { useState, useEffect } from "react"
import { SignInCard } from "./sign-in-card"
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/browser"

interface LoginModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const supabase = createClient()

    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      if (session?.user) {
        onSuccess?.()
        onClose()
      }
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        onSuccess?.()
        onClose()
      }
    })

    return () => subscription.unsubscribe()
  }, [isOpen, onClose, onSuccess])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal content */}
      <div className="relative z-[3001] w-full max-w-md p-4">
        <div className="relative transition-all duration-300 ease-out">
          <SignInCard />
        </div>
      </div>
    </div>
  )
}
