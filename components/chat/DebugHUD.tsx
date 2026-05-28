"use client";

import { useState, useEffect } from "react";

export function DebugHUD({
  messagesLength,
  scrollContainerRef,
  distToBottomRef,
  isAtBottomRef,
  activeSessionId,
  searchMode,
  isModeFading,
  scrollLockReason,
  revealMessageIdRef,
  isSending,
  sessionUsedTokens,
}: {
  messagesLength: number;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  distToBottomRef: React.MutableRefObject<number>;
  isAtBottomRef: React.MutableRefObject<boolean>;
  activeSessionId: number | null;
  searchMode: boolean;
  isModeFading: boolean;
  scrollLockReason: string | null;
  revealMessageIdRef: React.MutableRefObject<number | null>;
  isSending: boolean;
  sessionUsedTokens?: number;
}) {
  const [debugInfo, setDebugInfo] = useState({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    distToBottom: 0,
    atBottom: false,
    activeSessionId: null as number | null,
    searchMode: false,
    isModeFading: false,
    scrollLockReason: null as string | null,
    revealActive: false,
    isSending: false,
  });

  useEffect(() => {
    const updateDebugInfo = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      setDebugInfo({
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        distToBottom: distToBottomRef.current,
        atBottom: isAtBottomRef.current,
        activeSessionId,
        searchMode,
        isModeFading,
        scrollLockReason,
        revealActive: revealMessageIdRef.current !== null,
        isSending,
      });
    };

    updateDebugInfo();
    const interval = setInterval(updateDebugInfo, 250);
    return () => clearInterval(interval);
  }, [scrollContainerRef, distToBottomRef, isAtBottomRef, activeSessionId, searchMode, isModeFading, scrollLockReason, revealMessageIdRef, isSending]);

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50 bg-black/90 text-white text-[10px] font-mono p-2 rounded border border-gray-700 pointer-events-none">
      <div className="space-y-0.5">
        <div>msgs: {messagesLength}</div>
        <div>scroll: {debugInfo.scrollTop.toFixed(0)} / {debugInfo.scrollHeight.toFixed(0)} / {debugInfo.clientHeight.toFixed(0)}</div>
        <div>distToBottom: {debugInfo.distToBottom.toFixed(0)}px</div>
        <div>atBottom: {debugInfo.atBottom ? "✓" : "✗"}</div>
        <div>session: {debugInfo.activeSessionId ?? "null"}</div>
        <div>tokens: {sessionUsedTokens ?? 0}</div>
        <div>searchMode: {debugInfo.searchMode ? "✓" : "✗"}</div>
        <div>isModeFading: {debugInfo.isModeFading ? "✓" : "✗"}</div>
        <div>scrollLock: {debugInfo.scrollLockReason ?? "none"}</div>
        <div>reveal: {debugInfo.revealActive ? "✓" : "✗"}</div>
        <div>isSending: {debugInfo.isSending ? "✓" : "✗"}</div>
      </div>
    </div>
  );
}






