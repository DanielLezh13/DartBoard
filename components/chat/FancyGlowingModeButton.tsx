"use client";

import { ReactNode } from "react";

interface FancyGlowingModeButtonProps {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}

export function FancyGlowingModeButton({ children, onClick, className = "" }: FancyGlowingModeButtonProps) {
  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className={`
          group relative inline-flex h-10 items-center rounded-full
          border border-blue-400/30
          px-4 text-sm font-medium
          text-blue-300
          transition-all duration-300 ease-out
          hover:scale-105 hover:border-blue-400/45
          hover:text-blue-200
          active:scale-95
          focus:outline-none focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-blue-400/50
        `}
        style={{
          background: 'linear-gradient(to right, rgba(37, 99, 235, 0.2), rgba(147, 51, 234, 0.2)), rgb(30, 36, 56)',
          boxShadow: '0px 6px 18px rgba(0,0,0,0.28)',
        }}
      >
        <span className="relative z-10">{children}</span>
      </button>
    </div>
  );
}
