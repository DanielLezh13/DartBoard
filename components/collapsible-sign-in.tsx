"use client"

import React, { useState } from "react"
import { SignInCard } from "./sign-in-card"

export function CollapsibleSignIn() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="w-full max-w-md transition-all duration-300 ease-in-out">
      {!isExpanded ? (
        /* Collapsed state */
        <div className="text-center">
          <p className="mb-4 text-sm text-gray-400">
            Sign in to save your conversations and access your memories.
          </p>
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center justify-center rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 px-6 py-2 text-sm font-medium text-white transition-all duration-200"
          >
            Sign In
          </button>
        </div>
      ) : (
        /* Expanded state */
        <div className="transition-all duration-300 ease-in-out opacity-100">
          <SignInCard />
        </div>
      )}
    </div>
  )
}
