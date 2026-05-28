"use client";

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";

export type ChatSwapPhase = "idle" | "out" | "in";

export function useChatAnimationsState() {
  // Chat switching state (smooth transitions without empty flash)
  const [isChatSwitching, setIsChatSwitching] = useState(false);
  const switchSeqRef = useRef<number>(0);
  const skipNextSessionFetchRef = useRef<boolean>(false);

  // One-shot enter animation when the NEW chat commits
  const [isChatEntering, setIsChatEntering] = useState(false);

  // When we commit a newly-switched chat, force-scroll to bottom BEFORE paint
  // to prevent a 1-frame flash of the top-most user bubble.
  const pendingCommitScrollToBottomRef = useRef(false);

  // Chat switch animation timing (time-based, not message-length-based)
  const CHAT_SWITCH_MIN_MS = 260; // prevents instant snap on fast fetch
  const CHAT_ENTER_FADE_MS = 520; // new chat fade-in duration
  // Chat-to-chat swap: quick fade-out, then swap, then fade-in (avoid "drop-in" feel)
  const CHAT_SWAP_OUT_MS = 140;
  const CHAT_SWAP_IN_MS = 320;
  const CHAT_SWITCH_DIM_OPACITY = 0.55;

  const [enterOpacity, setEnterOpacity] = useState(1); // 0 or 1
  const [chatSwapPhase, setChatSwapPhase] = useState<ChatSwapPhase>("idle");

  // Prevent the landing overlay ("Welcome to DartBoard") from flashing during transitions
  // (e.g. landing → open memory → click chat; memory closes and landing peeks through).
  const [suppressLanding, setSuppressLanding] = useState(false);

  return {
    // state
    isChatSwitching,
    setIsChatSwitching,
    isChatEntering,
    setIsChatEntering,
    enterOpacity,
    setEnterOpacity,
    chatSwapPhase,
    setChatSwapPhase,
    suppressLanding,
    setSuppressLanding,
    // refs
    switchSeqRef,
    skipNextSessionFetchRef,
    pendingCommitScrollToBottomRef,
    // constants
    CHAT_SWITCH_MIN_MS,
    CHAT_ENTER_FADE_MS,
    CHAT_SWAP_OUT_MS,
    CHAT_SWAP_IN_MS,
    CHAT_SWITCH_DIM_OPACITY,
  };
}

export function useChatAnimationsEffects<TMessage>(args: {
  activeSessionId: number | null;
  fetchMessages: (sessionId: number) => Promise<TMessage[]>;
  setMessages: (msgs: TMessage[]) => void;
  resetRevealState: () => void;
  memoryOverlayOpen: boolean;
  activeSessionIdRef: MutableRefObject<number | null>;
  pendingSessionSwitchRef: MutableRefObject<boolean>;
  animations: ReturnType<typeof useChatAnimationsState>;
  scopeKind?: string | null;
  fastInitialRestore?: boolean;
}) {
  const {
    activeSessionId,
    fetchMessages,
    setMessages,
    resetRevealState,
    memoryOverlayOpen,
    activeSessionIdRef,
    pendingSessionSwitchRef,
    animations,
    scopeKind,
    fastInitialRestore = false,
  } = args;

  const prevSessionIdRef = useRef<number | null>(null);
  const consumedFastInitialRestoreRef = useRef(false);

  const {
    switchSeqRef,
    skipNextSessionFetchRef,
    pendingCommitScrollToBottomRef,
    setIsChatSwitching,
    setIsChatEntering,
    setEnterOpacity,
    setChatSwapPhase,
    setSuppressLanding,
    CHAT_SWITCH_MIN_MS,
    CHAT_SWAP_OUT_MS,
    CHAT_SWAP_IN_MS,
  } = animations;

  // Keep latest callbacks in refs so the session-swap effect only keys off `activeSessionId`
  // (preserves current behavior and avoids dependency churn).
  const fetchMessagesRef = useRef(fetchMessages);
  const setMessagesRef = useRef(setMessages);
  const resetRevealStateRef = useRef(resetRevealState);
  useEffect(() => {
    fetchMessagesRef.current = fetchMessages;
    setMessagesRef.current = setMessages;
    resetRevealStateRef.current = resetRevealState;
  });

  // Load messages when session changes (smooth switching without empty flash)
  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current;
    const to = activeSessionId;
    prevSessionIdRef.current = to;

    resetRevealStateRef.current();

    if (activeSessionId) {
      // Check skip flag BEFORE doing anything else
      if (skipNextSessionFetchRef.current) {
        skipNextSessionFetchRef.current = false;
        setIsChatSwitching(false);
        setIsChatEntering(false);
        setEnterOpacity(1);
        setSuppressLanding(false);
        pendingSessionSwitchRef.current = false;
        return;
      }

      const currentSeq = ++switchSeqRef.current;
      const switchStartedAt = performance.now();
      const isFastInitialRestore =
        fastInitialRestore &&
        !consumedFastInitialRestoreRef.current &&
        prevSessionId == null;
      if (isFastInitialRestore) {
        consumedFastInitialRestoreRef.current = true;
      }

      setIsChatSwitching(true);
      setChatSwapPhase("idle");

      fetchMessagesRef.current(activeSessionId).then((chatMessages) => {
        if (switchSeqRef.current !== currentSeq) return;

        if (isFastInitialRestore) {
          setMessagesRef.current(chatMessages);
          pendingCommitScrollToBottomRef.current = true;
          resetRevealStateRef.current();
          setIsChatSwitching(false);
          setIsChatEntering(false);
          setEnterOpacity(1);
          setChatSwapPhase("idle");
          setSuppressLanding(false);
          pendingSessionSwitchRef.current = false;
          return;
        }

        const elapsed = performance.now() - switchStartedAt;
        const remaining = Math.max(0, CHAT_SWITCH_MIN_MS - elapsed);

        window.setTimeout(() => {
          if (switchSeqRef.current !== currentSeq) return;

          setChatSwapPhase("out");
          setEnterOpacity(0);

          window.setTimeout(() => {
            if (switchSeqRef.current !== currentSeq) return;

            setMessagesRef.current(chatMessages);
            pendingCommitScrollToBottomRef.current = true;
            resetRevealStateRef.current();

            setChatSwapPhase("in");
            setIsChatEntering(true);
            requestAnimationFrame(() => {
              if (switchSeqRef.current !== currentSeq) return;
              setEnterOpacity(1);
              setIsChatSwitching(false);
              setSuppressLanding(false);
              pendingSessionSwitchRef.current = false;

              window.setTimeout(() => {
                if (switchSeqRef.current !== currentSeq) return;
                setIsChatEntering(false);
                setChatSwapPhase("idle");
              }, CHAT_SWAP_IN_MS);
            });
          }, CHAT_SWAP_OUT_MS);
        }, remaining);
      });
    } else {
      // Invalidate any in-flight switch timers from the previous session.
      // Without this, a late timeout can fire after "New Chat" and cause a brief blink/double-fade.
      switchSeqRef.current += 1;

      setMessagesRef.current([]);
      setIsChatSwitching(false);
      setIsChatEntering(false);
      setEnterOpacity(1);
      setChatSwapPhase("idle");
      setSuppressLanding(false);
      pendingSessionSwitchRef.current = false;
    }
  }, [activeSessionId]);

  // If we close a memory without changing sessions, ensure the chat stream becomes visible again.
  useEffect(() => {
    if (memoryOverlayOpen) return;
    if (pendingSessionSwitchRef.current) return;
    if (activeSessionIdRef.current == null) return;
    setIsChatEntering(false);
    setIsChatSwitching(false);
    setEnterOpacity(1);
  }, [memoryOverlayOpen]);
}
