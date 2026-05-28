"use client";

import { useEffect, useState, useRef } from "react";
import { CONTEXT_LIMIT_TOKENS, SESSION_TOKEN_LIMIT } from "@/lib/tokenEstimate";

export interface ContextLimitBarProps {
  usedTokens: number | null;   // was number
  limitTokens?: number;
  sessionKey: number | null;
  isEstimated?: boolean;
  isSessionBased?: boolean; // New prop to indicate session-based usage
}

export function ContextLimitBar({ 
  usedTokens,
  limitTokens = CONTEXT_LIMIT_TOKENS,
  sessionKey,
  isEstimated = false,
  isSessionBased = false,
}: ContextLimitBarProps) {
  // Use session limit if session-based, otherwise use context limit
  const actualLimit = isSessionBased ? SESSION_TOKEN_LIMIT : limitTokens;
  const initialTokens =
    typeof usedTokens === "number" && Number.isFinite(usedTokens)
      ? Math.min(Math.max(usedTokens, 0), actualLimit)
      : null;

  const [isScanning, setIsScanning] = useState(false);
  const [displayTokens, setDisplayTokens] = useState<number | null>(initialTokens);
  const prevSessionKeyRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokensRef = useRef<number | null>(usedTokens);

  const SCAN_DURATION_MS = 200; // Quick scan animation

  // Keep tokensRef in sync
  useEffect(() => {
    tokensRef.current = usedTokens;
  }, [usedTokens]);

  // Trigger scan only when sessionKey changes
  useEffect(() => {
    if (sessionKey == null) return;

    if (sessionKey === prevSessionKeyRef.current) return;

    prevSessionKeyRef.current = sessionKey;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setIsScanning(true);
    // setDisplayTokens(null);  // remove this line

    timeoutRef.current = setTimeout(() => {
      setIsScanning(false);

      const t = tokensRef.current;
      if (typeof t !== "number" || !Number.isFinite(t)) {
        setDisplayTokens(null);
        return;
      }

      const clamped = Math.min(Math.max(t, 0), actualLimit);
      setDisplayTokens(clamped);
    }, SCAN_DURATION_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [sessionKey, actualLimit]);

  // When tokens change but we are NOT scanning, update with debounce
  useEffect(() => {
    if (isScanning) return;

    const timeoutId = setTimeout(() => {
      const t = usedTokens;
      if (typeof t !== "number" || !Number.isFinite(t)) {
        setDisplayTokens(null);
        return;
      }
      const clamped = Math.min(Math.max(t, 0), actualLimit);
      setDisplayTokens(clamped);
    }, 200); // Debounce updates

    return () => clearTimeout(timeoutId);
  }, [usedTokens, actualLimit, isScanning]);

  const effectiveTokens = isScanning ? null : displayTokens;

  const percent =
    effectiveTokens !== null
      ? Math.min(100, Math.max(0, (effectiveTokens / actualLimit) * 100))
      : null;

  const percentLabel = percent === null ? "—" : `${Math.round(percent)}%`;

  // Color based on usage
  const getBarColor = () => {
    if (percent === null) return "bg-gray-600";
    if (percent < 60) return "bg-gray-500";
    if (percent < 85) return "bg-amber-500";
    return "bg-red-500";
  };

  const formattedLimit = actualLimit.toLocaleString();

  const tooltipText = isScanning
    ? "Scanning..."
    : effectiveTokens === null
      ? `${isSessionBased ? "Session" : "Context"}: — / ${formattedLimit} tokens${isEstimated ? " (estimated)" : ""}` 
      : `${isSessionBased ? "Session" : "Context"}: ${effectiveTokens.toLocaleString()} / ${formattedLimit} tokens (${Math.round(percent ?? 0)}%)${isEstimated ? " (estimated)" : ""}`;

  return (
    <div className="flex items-center gap-2" title={tooltipText}>
      <div className="relative w-14 h-1 bg-gray-800/60 border border-gray-700/50 rounded-full overflow-hidden">
        {effectiveTokens !== null ? (
          <div
            className={`absolute left-0 top-0 h-full ${getBarColor()} transition-all duration-200 ease-out rounded-full`}
            style={{
              width: percent !== null ? `${percent}%` : 0,
            }}
          />
        ) : (
          <div
            className="absolute left-0 top-0 h-full w-1/3 bg-gray-600 transition-all duration-200 ease-out rounded-full"
            style={{
              animation: "scan 0.2s ease-in-out",
            }}
          />
        )}
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums">
        {percentLabel}
      </span>
      <style jsx>{`
        @keyframes scan {
          0% {
            left: -25%;
          }
          50% {
            left: 125%;
          }
          100% {
            left: -25%;
          }
        }
      `}</style>
    </div>
  );
}


