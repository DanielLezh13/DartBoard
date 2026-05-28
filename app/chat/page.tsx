// app/chat/page.tsx
"use client";

import React from "react";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useLayoutMode } from "../../hooks/useLayoutMode";
import { usePanels } from "../../hooks/usePanels";
import { useChatScroll } from "../../hooks/useChatScroll";
import { useChatAnimationsEffects, useChatAnimationsState } from "../../hooks/useChatAnimations";
import { useChatSearch } from "../../hooks/useChatSearch";
import { useChatSessions, type SidebarSession } from "../../hooks/useChatSessions";
import { useChatMemories, type Memory, type MemoryFolder } from "../../hooks/useChatMemories";
import { useSessionAttachments, type SessionAttachment } from "../../hooks/useSessionAttachments";
import { useChatFolderHandlers } from "../../hooks/useChatFolderHandlers";
import { useScope } from "../../hooks/useScope";
import { getHeadersForScope } from "@/lib/scope-client";
import {
  LEFT_PANEL_W_CLEAN,
  LEFT_RAIL_W_CLEAN,
  RIGHT_PANEL_W_CLEAN,
  RIGHT_RAIL_W_CLEAN,
  SHOW_DEV_HUD,
  SLIDE_MS,
  SLIDE_EASE,
} from "@/lib/chatConstants";
import type { ChatMessage, Session, DraftMemory, MessageGroup, HourBucket, AnyMessage } from "@/types/chat";
import { generateTitleFromSummary, normalizeCreatedAt, formatHourLabel, makeAutoTitleFromAssistant, clampAutoTitle as clampGeneratedTitle } from "@/lib/chatHelpers";
import { getAuthHeaders } from "@/lib/api";
import { createClient } from "@/lib/supabase/browser";
import { DartzModeId } from "@/lib/modes";
import { ModeValueSlot } from "@/components/chat/ModeValueSlot";
import { ChatDropzoneGhost } from "@/components/chat/ChatDropzoneGhost";
import { DebugHUD } from "@/components/chat/DebugHUD";
import { useRouter } from "next/navigation";
import { estimateTokens, estimateTokensForMessages, CONTEXT_LIMIT_TOKENS } from "@/lib/tokenEstimate";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_MESSAGE, MAX_INPUT_CHARS } from "@/lib/limits";
import { PLAN_LIMITS } from "@/lib/planLimits";
import { getModeSpec, DARTZ_MODES } from "@/lib/modes";
import { FolderRail, type Folder as SidebarFolder } from "@/components/chat/FolderRail";
import { ChatNavigator } from "@/components/chat/ChatNavigator";
import { ChatPageLayout } from "@/components/chat/ChatPageLayout";
import { useToast } from "@/components/ui/Toast";
import { MemoryReaderOverlay } from "@/components/chat/MemoryReaderOverlay";
import { FloatingChatComposer } from "@/components/chat/FloatingChatComposer";
import { ChatDropzoneTarget } from "@/components/chat/ChatDropzoneTarget";
import { LandingInjectedMemories } from "@/components/chat/LandingInjectedMemories";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { ImageLightbox } from "@/components/chat/ImageLightbox";
import MessageErrorBoundary from "@/app/components/MessageErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import { clearGuestSessionStorage } from "@/lib/guest-keys";
import { getLastUserId } from "@/lib/railCache";
import { LoginModal } from "@/components/login-modal";
import {
  DndContext,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";

import { createPortal } from "react-dom";
import { unstable_batchedUpdates } from "react-dom";
import { useChatDnd } from "../../hooks/useChatDnd";
import { nanoid } from "nanoid";

// Bottom tolerance for scroll detection (absorbs subpixel rounding and layout settling)
const BOTTOM_EPSILON = 12; // pixels
const SENDABLE_IMAGE_MIME_PREFIX = "image/";
const MAX_SENDABLE_IMAGES_PER_TURN = MAX_IMAGES_PER_MESSAGE;
const MAX_SEARCH_TAGS = MAX_SENDABLE_IMAGES_PER_TURN;
const MAX_SENDABLE_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES;
const MAX_INPUT_CHARS_PER_MESSAGE = MAX_INPUT_CHARS;
const GUEST_PREVIEW_SESSIONS_KEY = "db:guestPreviewSessions";
const GUEST_PREVIEW_MESSAGES_KEY = "db:guestPreviewMessagesBySession";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SearchMatcher =
  | {
      kind: "none";
      testRegexes: RegExp[];
      highlightRegex: RegExp | null;
    }
  | {
      kind: "phrase" | "terms";
      testRegexes: RegExp[];
      highlightRegex: RegExp;
    };

type SearchMatchMode = "and" | "or";
type SearchRoleFilter = "all" | "user" | "assistant";
type ActiveSearchMatcher = Exclude<SearchMatcher, { kind: "none" }>;

function buildSearchMatcher(query: string): SearchMatcher {
  const trimmed = query.trim();
  if (!trimmed) {
    return { kind: "none", testRegexes: [], highlightRegex: null };
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const phrase = trimmed.slice(1, -1).trim();
    if (!phrase) return { kind: "none", testRegexes: [], highlightRegex: null };
    const escapedPhrase = escapeRegExp(phrase);
    return {
      kind: "phrase",
      testRegexes: [new RegExp(escapedPhrase, "i")],
      highlightRegex: new RegExp(`(${escapedPhrase})`, "gi"),
    };
  }

  const terms = Array.from(
    new Set(
      trimmed
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .map((term) => term.toLowerCase())
    )
  );

  if (terms.length === 0) {
    return { kind: "none", testRegexes: [], highlightRegex: null };
  }

  const wordBoundaries = terms.map((term) => `\\b${escapeRegExp(term)}\\b`);
  return {
    kind: "terms",
    testRegexes: wordBoundaries.map((expr) => new RegExp(expr, "i")),
    highlightRegex: new RegExp(`(${wordBoundaries.join("|")})`, "gi"),
  };
}

function matchesSearchText(
  text: string,
  matcher: SearchMatcher,
  matchMode: SearchMatchMode = "and"
): boolean {
  if (matcher.kind === "none") return true;
  if (matcher.kind === "phrase") return matcher.testRegexes[0].test(text);
  if (matchMode === "or") return matcher.testRegexes.some((regex) => regex.test(text));
  return matcher.testRegexes.every((regex) => regex.test(text));
}

function renderSearchHighlightedText(text: string, matcher: SearchMatcher): React.ReactNode {
  if (!text || matcher.kind === "none" || !matcher.highlightRegex) return text;
  const parts = text.split(matcher.highlightRegex);
  if (parts.length <= 1) return text;
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark
        key={`db-search-hit-${idx}`}
        className="rounded-sm bg-yellow-300 px-[1px] text-black"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={`db-search-text-${idx}`}>{part}</React.Fragment>
    )
  );
}

type GuestPreviewStoredSession = {
  id: number;
  title: string;
  created_at: string;
  updatedAt: string;
  mode: string;
  inFolderId: number | null;
  folderOrderTs: number | null;
  focusGoal: string | null;
  focusEnabled: boolean;
  mru_ts: number;
};

type AccountPlan = "free" | "plus" | null;

export default function ChatPage() {
  const { showToast, toasts } = useToast();
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [accountPlan, setAccountPlan] = useState<AccountPlan>(null);
  const resolvedPlan = accountPlan === "plus" ? "plus" : "free";
  const attachedMemoryTokenCap = PLAN_LIMITS[resolvedPlan].maxAttachedMemoryTokensPerSession;
  const attachedMemoryCountCap = PLAN_LIMITS[resolvedPlan].maxAttachedMemoriesPerSession;

  const handleSignOut = async () => {
    try {
      const currentUserId = user?.id ?? null;
      const supabase = createClient();
      await supabase.auth.signOut();
      // Defensive: force landing for this user on next sign-in even if
      // auth-boundary SIGNED_OUT callback is interrupted by refresh timing.
      if (typeof window !== "undefined" && currentUserId) {
        try {
          sessionStorage.setItem(`db:userLanding:${currentUserId}`, "1");
          sessionStorage.removeItem(`db:lastSession:${currentUserId}`);
        } catch {
          // ignore
        }
      }
      clearGuestSessionStorage();
      router.refresh();
      showToast("Signed out successfully");
    } catch (error) {
      console.error("Sign out error:", error);
      showToast("Failed to sign out");
    }
  };
  const handlePurchasePlus = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason =
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to start checkout right now.";
        showToast(reason);
        return;
      }
      if (typeof payload?.url === "string" && payload.url.length > 0) {
        window.location.href = payload.url;
        return;
      }
      showToast("Checkout URL was missing.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to start checkout right now.";
      showToast(reason);
    }
  }, [showToast]);

  const handleManageBilling = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason =
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to open billing portal right now.";
        showToast(reason);
        return;
      }
      if (typeof payload?.url === "string" && payload.url.length > 0) {
        window.location.href = payload.url;
        return;
      }
      showToast("Billing portal URL was missing.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to open billing portal right now.";
      showToast(reason);
    }
  }, [showToast]);

  const [mode, setMode] = useState<DartzModeId>("tactical");
  const [webSearchArmed, setWebSearchArmed] = useState(false);
  const [webGlowHold, setWebGlowHold] = useState(false);
  const webGlowRevealMessageIdRef = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const inputPreserveRef = useRef<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<File[]>([]);
  const [composerAttachmentResetToken, setComposerAttachmentResetToken] = useState(0);
  const [expandedUserImageUrl, setExpandedUserImageUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Prevent spam-clicking assistant action buttons (Simplify/Deeper/etc.)
  const [isRollingOver, setIsRollingOver] = useState(false);
  const composerBusy = isSending || isRollingOver;
  const [actionBusyByMessageId, setActionBusyByMessageId] = useState<Record<string, boolean>>({});
  const actionBusyByMessageIdRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    actionBusyByMessageIdRef.current = actionBusyByMessageId;
  }, [actionBusyByMessageId]);
  const [isComposerSlidingDown, setIsComposerSlidingDown] = useState(false);
  const [forceEditMemoryId, setForceEditMemoryId] = useState<number | null>(null);
  
  // Draft memory state (not saved to DB yet)
  const [draftMemory, setDraftMemory] = useState<DraftMemory | null>(null);

  // Landing-only attached memories state (ephemeral, not persisted)
  const [landingAttachedMemoryIds, setLandingAttachedMemoryIds] = useState<number[]>([]);
  // Landing-only pinned state (ephemeral, tracks which memories are pinned for injection)
  const [landingPinnedById, setLandingPinnedById] = useState<Record<number, boolean>>({});
  
  // Pending new chat folder state (locked when New Chat is clicked in a folder)
  const [pendingNewChatFolderId, setPendingNewChatFolderId] = useState<number | null>(null);

  // Temporary search state for useChatScroll dependency (will be updated after useChatSearch)
  const tempIsSearchingForScrollRef = useRef(false);

  // Context metrics state for Option A (context window pressure)
  const [contextMetricsBySessionId, setContextMetricsBySessionId] = useState<Record<number, {
    current_tokens: number;
    max_tokens: number;
    usage_ratio: number;
  }>>({});

  // Unified scope for auth/guest state
  const { scope } = useScope();
  const guestPreviewHydratedRef = useRef(false);
  const guestPreviewStorageReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || !user?.id) {
      setAccountPlan(null);
      return () => {
        cancelled = true;
      };
    }

    const planCacheKey = `db:accountPlan:${user.id}`;
    if (typeof window !== "undefined") {
      try {
        const cachedPlan = window.localStorage.getItem(planCacheKey);
        if (cachedPlan === "free" || cachedPlan === "plus") {
          setAccountPlan(cachedPlan);
        } else {
          setAccountPlan(null);
        }
      } catch {
        setAccountPlan(null);
      }
    }

    const loadPlan = async () => {
      try {
        const response = await fetch("/api/whoami", { cache: "no-store" });
        if (!response.ok) throw new Error(`whoami_failed_${response.status}`);
        const payload = await response.json();
        const nextPlan: AccountPlan = payload?.plan === "plus" ? "plus" : "free";
        if (!cancelled) {
          setAccountPlan(nextPlan);
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(planCacheKey, nextPlan);
            } catch {
              // ignore cache write failures
            }
          }
        }
      } catch {
        // Keep cached value (if any) to avoid free/plus flicker on transient failures.
      }
    };

    void loadPlan();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const billingState = url.searchParams.get("billing");
    if (!billingState) return;

    const clearBillingQuery = () => {
      url.searchParams.delete("billing");
      const query = url.searchParams.toString();
      window.history.replaceState({}, "", query ? `${url.pathname}?${query}` : url.pathname);
    };

    if (billingState === "cancel") {
      showToast("Checkout canceled.");
      clearBillingQuery();
      return;
    }

    if (billingState !== "success") {
      clearBillingQuery();
      return;
    }

    let cancelled = false;
    const syncAndRefreshPlan = async () => {
      try {
        await fetch("/api/billing/sync", { method: "POST" });
        const whoamiRes = await fetch("/api/whoami", { cache: "no-store" });
        if (whoamiRes.ok) {
          const payload = await whoamiRes.json();
          const nextPlan: AccountPlan = payload?.plan === "plus" ? "plus" : "free";
          if (!cancelled) {
            setAccountPlan(nextPlan);
            if (typeof window !== "undefined" && user?.id) {
              try {
                window.localStorage.setItem(`db:accountPlan:${user.id}`, nextPlan);
              } catch {
                // ignore cache write failures
              }
            }
            showToast(nextPlan === "plus" ? "Plus activated." : "Payment received; plan sync pending.");
          }
        } else if (!cancelled) {
          showToast("Payment successful. Refreshing plan may take a moment.");
        }
      } catch {
        if (!cancelled) {
          showToast("Payment successful. Refreshing plan may take a moment.");
        }
      } finally {
        clearBillingQuery();
      }
    };

    void syncAndRefreshPlan();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, showToast, user?.id]);

  const resetComposerAttachments = useCallback(() => {
    setPendingComposerAttachments([]);
    setComposerAttachmentResetToken((prev) => prev + 1);
  }, []);

  const parseOptionalNumber = useCallback((value: unknown): number | null => {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }, []);

  const readGuestPreviewSessionsFromStorage = useCallback((): GuestPreviewStoredSession[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(GUEST_PREVIEW_SESSIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const normalized = parsed
        .map((item: any): GuestPreviewStoredSession | null => {
          const id = Number(item?.id);
          if (!Number.isFinite(id)) return null;
          const updatedAt =
            typeof item?.updatedAt === "string" && item.updatedAt
              ? item.updatedAt
              : new Date().toISOString();
          const createdAt =
            typeof item?.created_at === "string" && item.created_at
              ? item.created_at
              : updatedAt;
          return {
            id,
            title:
              typeof item?.title === "string" && item.title.trim().length > 0
                ? item.title
                : "Preview Chat",
            created_at: createdAt,
            updatedAt,
            mode:
              typeof item?.mode === "string" && item.mode.trim().length > 0
                ? item.mode
                : "tactical",
            inFolderId: parseOptionalNumber(item?.inFolderId),
            folderOrderTs: parseOptionalNumber(item?.folderOrderTs),
            focusGoal:
              typeof item?.focusGoal === "string" && item.focusGoal.trim().length > 0
                ? item.focusGoal.trim()
                : null,
            focusEnabled:
              Boolean(item?.focusEnabled) &&
              typeof item?.focusGoal === "string" &&
              item.focusGoal.trim().length > 0,
            mru_ts: Number.isFinite(Number(item?.mru_ts))
              ? Number(item.mru_ts)
              : Date.now(),
          };
        })
        .filter((item): item is GuestPreviewStoredSession => item !== null)
        .sort((a, b) => b.mru_ts - a.mru_ts);

      return normalized;
    } catch {
      return [];
    }
  }, [parseOptionalNumber]);

  const writeGuestPreviewSessionsToStorage = useCallback(
    (nextSidebarSessions: SidebarSession[], nextSessions: any[]) => {
      if (typeof window === "undefined") return;
      try {
        const typedById = new Map<number, any>();
        (nextSessions ?? []).forEach((session: any) => {
          if (Number.isFinite(Number(session?.id))) {
            typedById.set(Number(session.id), session);
          }
        });

        const payload: GuestPreviewStoredSession[] = nextSidebarSessions.map((sidebar) => {
          const typed = typedById.get(sidebar.id);
          const updatedAt =
            typeof sidebar.updatedAt === "string" && sidebar.updatedAt
              ? sidebar.updatedAt
              : new Date().toISOString();
          const createdAt =
            typeof typed?.created_at === "string" && typed.created_at
              ? typed.created_at
              : updatedAt;
          const mode =
            typeof typed?.mode === "string" && typed.mode.trim().length > 0
              ? typed.mode
              : "tactical";
          const focusGoal =
            typeof sidebar.focusGoal === "string" && sidebar.focusGoal.trim().length > 0
              ? sidebar.focusGoal.trim()
              : typeof typed?.focusGoal === "string" && typed.focusGoal.trim().length > 0
                ? typed.focusGoal.trim()
                : null;
          const focusEnabled = Boolean(sidebar.focusEnabled ?? typed?.focusEnabled) && Boolean(focusGoal);

          return {
            id: sidebar.id,
            title:
              typeof sidebar.title === "string" && sidebar.title.trim().length > 0
                ? sidebar.title
                : "Preview Chat",
            created_at: createdAt,
            updatedAt,
            mode,
            inFolderId: sidebar.inFolderId ?? null,
            folderOrderTs: sidebar.folderOrderTs ?? null,
            focusGoal,
            focusEnabled,
            mru_ts: Number.isFinite(Number(sidebar.mru_ts)) ? Number(sidebar.mru_ts) : Date.now(),
          };
        });

        sessionStorage.setItem(GUEST_PREVIEW_SESSIONS_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    },
    []
  );

  const getGuestPreviewMessagesForSession = useCallback((sessionId: number): ChatMessage[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(GUEST_PREVIEW_MESSAGES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const key = String(sessionId);
      const rows = parsed && typeof parsed === "object" ? parsed[key] : null;
      if (!Array.isArray(rows)) return [];

      return rows
        .map((row: any): ChatMessage | null => {
          const id = Number(row?.id);
          if (!Number.isFinite(id)) return null;
          if (row?.role !== "user" && row?.role !== "assistant") return null;
          if (typeof row?.content !== "string") return null;
          return {
            id,
            role: row.role,
            content: row.content,
            created_at:
              typeof row?.created_at === "string" && row.created_at
                ? row.created_at
                : new Date().toISOString(),
            session_id:
              Number.isFinite(Number(row?.session_id)) ? Number(row.session_id) : sessionId,
            is_placeholder: Boolean(row?.is_placeholder),
            image_urls: Array.isArray(row?.image_urls)
              ? row.image_urls.filter((value: unknown): value is string => typeof value === "string")
              : undefined,
            meta:
              row?.meta && typeof row.meta === "object" ? row.meta : null,
          };
        })
        .filter((row): row is ChatMessage => row !== null);
    } catch {
      return [];
    }
  }, []);

  const appendGuestPreviewMessages = useCallback(
    (sessionId: number, newMessages: ChatMessage[]) => {
      if (typeof window === "undefined") return;
      try {
        const raw = sessionStorage.getItem(GUEST_PREVIEW_MESSAGES_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const map =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        const key = String(sessionId);
        const existing = Array.isArray(map[key]) ? map[key] : [];
        map[key] = [...existing, ...newMessages];
        sessionStorage.setItem(GUEST_PREVIEW_MESSAGES_KEY, JSON.stringify(map));
      } catch {
        // ignore
      }
    },
    []
  );

  const upsertGuestPreviewSessionInStorage = useCallback((session: GuestPreviewStoredSession) => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(GUEST_PREVIEW_SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];

      const normalizedExisting = list
        .map((item: any): GuestPreviewStoredSession | null => {
          const id = Number(item?.id);
          if (!Number.isFinite(id)) return null;
          return {
            id,
            title:
              typeof item?.title === "string" && item.title.trim().length > 0
                ? item.title
                : "Preview Chat",
            created_at:
              typeof item?.created_at === "string" && item.created_at
                ? item.created_at
                : new Date().toISOString(),
            updatedAt:
              typeof item?.updatedAt === "string" && item.updatedAt
                ? item.updatedAt
                : new Date().toISOString(),
            mode:
              typeof item?.mode === "string" && item.mode.trim().length > 0
                ? item.mode
                : "tactical",
            inFolderId: parseOptionalNumber(item?.inFolderId),
            folderOrderTs: parseOptionalNumber(item?.folderOrderTs),
            focusGoal:
              typeof item?.focusGoal === "string" && item.focusGoal.trim().length > 0
                ? item.focusGoal.trim()
                : null,
            focusEnabled:
              Boolean(item?.focusEnabled) &&
              typeof item?.focusGoal === "string" &&
              item.focusGoal.trim().length > 0,
            mru_ts: Number.isFinite(Number(item?.mru_ts))
              ? Number(item.mru_ts)
              : Date.now(),
          };
        })
        .filter((item): item is GuestPreviewStoredSession => item !== null);

      const merged = new Map<number, GuestPreviewStoredSession>();
      normalizedExisting.forEach((row) => merged.set(row.id, row));
      merged.set(session.id, session);

      const next = [...merged.values()].sort((a, b) => b.mru_ts - a.mru_ts);
      sessionStorage.setItem(GUEST_PREVIEW_SESSIONS_KEY, JSON.stringify(next));
      guestPreviewStorageReadyRef.current = true;
    } catch {
      // ignore
    }
  }, [parseOptionalNumber]);

  // Tab visibility resume: suppress transitions when switching back to tab
  const [isResuming, setIsResuming] = useState(false);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        suppressRestoreLastSessionRef.current = false;
        setIsResuming(true);
        window.setTimeout(() => setIsResuming(false), 150);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Restore last session flag: prevent landing flash while signed-in restore runs
  const [isRestoringLastSession, setIsRestoringLastSession] = useState(false);

  // Suppress restore when user intentionally clicks New chat (signed-in → landing, no DB session)
  const suppressRestoreLastSessionRef = useRef(false);
  const freshSignInResetHandledRef = useRef(false);
  
  // Guest chat is disabled; keep counter at 0 for UI compatibility.
  const [guestMessageCount, setGuestMessageCount] = useState(0);
  const GUEST_MESSAGE_LIMIT = 10;
  const GUEST_PREVIEW_SESSION_TITLE = "Preview Chat";
  const GUEST_PREVIEW_SIGN_IN_PROMPT =
    "Sign in to send messages in DartBoard. Guest mode is preview-only.";
  const SS_FRESH_SIGNED_IN_ENTRY = "db:freshSignedInEntry";
  const SS_GUEST_INFO_BANNER_BY_SESSION = "db:guestInfoBannerBySession";
  type GuestInfoBannerSessionState = { shown?: boolean; dismissed?: boolean };
  const [guestInfoBannerBySession, setGuestInfoBannerBySession] = useState<Record<string, GuestInfoBannerSessionState>>({});
  const guestInfoBannerBySessionRef = useRef<Record<string, GuestInfoBannerSessionState>>({});
  const guestInfoBannerRevealRef = useRef<{ messageId: number; sessionId: number } | null>(null);
  
  // Force guest message count to 0 in this policy mode (guest cannot send).
  useEffect(() => {
    if (scope?.kind !== "guest" || typeof window === "undefined") {
      setGuestMessageCount(0);
      return;
    }

    try {
      sessionStorage.setItem("db:guestMessageCount", "0");
    } catch {
      // ignore
    }
    setGuestMessageCount(0);
  }, [scope?.kind]);

  useEffect(() => {
    if (scope?.kind !== "guest" || typeof window === "undefined") {
      setGuestInfoBannerBySession({});
      guestInfoBannerBySessionRef.current = {};
      guestInfoBannerRevealRef.current = null;
      return;
    }

    try {
      const raw = sessionStorage.getItem(SS_GUEST_INFO_BANNER_BY_SESSION);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setGuestInfoBannerBySession(parsed as Record<string, GuestInfoBannerSessionState>);
      } else {
        setGuestInfoBannerBySession({});
      }
    } catch {
      setGuestInfoBannerBySession({});
    }
  }, [scope?.kind]);

  useEffect(() => {
    guestInfoBannerBySessionRef.current = guestInfoBannerBySession;
  }, [guestInfoBannerBySession]);

  const updateGuestInfoBannerSessionState = useCallback(
    (sessionId: number, patch: GuestInfoBannerSessionState) => {
      const sessionKey = String(sessionId);
      setGuestInfoBannerBySession((prev) => {
        const next = {
          ...prev,
          [sessionKey]: { ...(prev[sessionKey] ?? {}), ...patch },
        };
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem(SS_GUEST_INFO_BANNER_BY_SESSION, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
    },
    []
  );

  const {
    scrollContainerRef,
    distToBottomRef,
    isAtBottomRef,
    programmaticScrollRef,
    showScrollDownFab,
    setShowScrollDownFab,
    scrollLockReason,
    setScrollLockReason,
    requestScroll,
    revealHeightById,
    setRevealHeightById,
    fullHeightByIdRef,
    revealMessageIdRef,
    isFollowingRevealRef,
    userStoppedFollowRef,
    autoFollowLatchRef,
    userScrolledAwayDuringStreamRef,
    startRevealHeight,
    resetRevealState,
  } = useChatScroll({ isSending, isSearching: tempIsSearchingForScrollRef });

  // --- Search mode (inline, same screen) ---
  const {
    searchMode,
    setSearchMode,
    searchDraft,
    setSearchDraft,
    searchQuery,
    setSearchQuery,
    isModeFading,
    handleToggleSearchMode,
    handleRunSearch,
  } = useChatSearch({
    requestScroll,
    setScrollLockReason,
    scrollContainerRef,
    isAtBottomRef,
    isSending,
    revealMessageIdRef,
  });

  const isSearchingForScroll = searchMode && searchQuery.trim().toLowerCase().length > 0;
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [searchRoleFilter, setSearchRoleFilter] = useState<SearchRoleFilter>("all");
  const [searchMatchMode, setSearchMatchMode] = useState<SearchMatchMode>("and");

  const normalizeSearchTag = useCallback((value: string) => value.trim().replace(/\s+/g, " "), []);

  const applySearchTags = useCallback(
    (
      nextTags: string[],
      opts?: {
        runSearch?: boolean;
        clearDraft?: boolean;
      }
    ) => {
      const deduped: string[] = [];
      const seen = new Set<string>();
      for (const tag of nextTags) {
        const normalized = normalizeSearchTag(tag);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(normalized);
      }

      const clamped = deduped.slice(0, MAX_SEARCH_TAGS);
      const nextQuery = clamped.join(" ").trim();

      setSearchTags(clamped);
      setSearchQuery(nextQuery);
      if (opts?.clearDraft) {
        setSearchDraft("");
      }
      if (opts?.runSearch) {
        handleRunSearch(nextQuery);
      }
    },
    [handleRunSearch, normalizeSearchTag, setSearchDraft, setSearchQuery]
  );

  const handleRunTaggedSearch = useCallback(() => {
    const normalizedDraft = normalizeSearchTag(searchDraft);
    if (!normalizedDraft && searchTags.length === 0) return;

    let nextTags = searchTags;
    if (normalizedDraft) {
      const withoutExisting = searchTags.filter(
        (tag) => tag.toLowerCase() !== normalizedDraft.toLowerCase()
      );
      nextTags = [...withoutExisting, normalizedDraft];
      if (nextTags.length > MAX_SEARCH_TAGS) {
        nextTags = nextTags.slice(nextTags.length - MAX_SEARCH_TAGS);
        showToast(`Max ${MAX_SEARCH_TAGS} search tags.`);
      }
    }

    applySearchTags(nextTags, { runSearch: true, clearDraft: true });
  }, [applySearchTags, normalizeSearchTag, searchDraft, searchTags, showToast]);

  const handleRemoveSearchTag = useCallback(
    (tagToRemove: string) => {
      const idx = searchTags.findIndex(
        (tag) => tag.toLowerCase() === tagToRemove.toLowerCase()
      );
      if (idx < 0) return;
      const nextTags = searchTags.filter((_, index) => index !== idx);
      applySearchTags(nextTags, { runSearch: true, clearDraft: false });
    },
    [applySearchTags, searchTags]
  );

  const handleClearMiddleSearch = useCallback(() => {
    setSearchTags([]);
    setSearchDraft("");
    setSearchQuery("");
  }, [setSearchDraft, setSearchQuery]);
  
  useEffect(() => {
    tempIsSearchingForScrollRef.current = isSearchingForScroll;
  }, [isSearchingForScroll]);

  useEffect(() => {
    if (!searchMode) {
      setSearchTags([]);
      setSearchRoleFilter("all");
      setSearchMatchMode("and");
    }
  }, [searchMode]);

  const [composerHeight, setComposerHeight] = useState(140); // Fallback: typical composer height to prevent layout shift
  const [landingComposerBaseHeight, setLandingComposerBaseHeight] = useState<number | null>(null);
  const [windowH, setWindowH] = useState(0);
  const [landingMemoryBoxHeight, setLandingMemoryBoxHeight] = useState(0);
  const hourBucketRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatAnimations = useChatAnimationsState();
  const {
    skipNextSessionFetchRef,
    setIsChatSwitching,
    setIsChatEntering,
    setEnterOpacity,
    setChatSwapPhase,
    setSuppressLanding,
    suppressLanding,
    pendingCommitScrollToBottomRef,
    isChatSwitching,
    isChatEntering,
    enterOpacity,
    chatSwapPhase,
    // constants
    CHAT_SWITCH_MIN_MS,
    CHAT_ENTER_FADE_MS,
    CHAT_SWAP_OUT_MS,
    CHAT_SWAP_IN_MS,
    CHAT_SWITCH_DIM_OPACITY,
  } = chatAnimations;
  const [hourPillLane, setHourPillLane] = useState<"center" | "side">("center");
  const [hourPillRightPx, setHourPillRightPx] = useState<number>(16);
  const [activeHourKey, setActiveHourKey] = useState<string | null>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const timelinePopupRef = useRef<HTMLDivElement>(null);
  const ignoreOutsideClickRef = useRef(false);
  
  // Layout mode hook - single source of truth
  const { layoutMode, windowWidth, lastResizeEdgeRef, resizeGestureIdRef, resizeEdgeReadyRef } = useLayoutMode();
  
  // Panels hook - single source of truth for all panel state
  const panels = usePanels(layoutMode, lastResizeEdgeRef, scope?.kind, resizeGestureIdRef, resizeEdgeReadyRef);
  
  // Destructure for convenience (read-only)
  const {
    sidebarHidden,
    rightDockHidden,
    sidebarOpen,
    rightOverlayOpen,
    keepOverlaysVisible,
    hasHydratedPanels,
    toggleLeft,
    toggleRight,
    closeOverlays,
    setSidebarHidden,
    setRightDockHidden,
  } = panels;
  
  // Memory overlay refs (needed for session selection wrapper)
  // memoryOverlayOpenRef now comes from useChatMemories hook
  const pendingSessionSwitchRef = useRef(false);
  
  // Dev test refs (mirror state for deterministic async tests)
  const isSendingRef = useRef<boolean>(false);
  const searchModeRef = useRef<boolean>(false);
  const scrollLockReasonRef = useRef<string | null>(null);
  
  // Pristine session tracking (auto-delete if user leaves without typing)
  const pristineSessionIdRef = useRef<number | null>(null);
  const showScrollDownFabRef = useRef<boolean>(false);
  // Scroll management extracted to `useChatScroll` (refs + reveal + follow + lock + FAB).

  // ----- Message grouping + timestamps -----
  const getCreatedAt = (m: AnyMessage): string | null => {
    return (m.created_at as string | null) ?? (m.createdAt as string | null) ?? null;
  };

  const groupedMessages: MessageGroup[] = useMemo(() => {
    const input = (messages as AnyMessage[]) ?? [];
    const groups: MessageGroup[] = [];
    for (let i = 0; i < input.length; i++) {
      const msg = input[i];
      const createdAt = getCreatedAt(msg);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.role === msg.role) {
        lastGroup.items.push(msg);
        lastGroup.lastCreatedAt = createdAt ?? lastGroup.lastCreatedAt;
      } else {
        groups.push({
          id: `g-${msg.id ?? i}`,
          role: msg.role,
          items: [msg],
          lastCreatedAt: createdAt,
        });
      }
    }
    return groups;
  }, [messages]);

  // --- Sessions/Folders hook (extracted from page component) ---
  // Note: We'll wire up wrapper handlers after memory state is declared
  const sessionsHook = useChatSessions({
    onSelectSession: undefined, // Will be set after memory state
    onSessionCreated: undefined,
    onSessionDeleted: undefined,
    onSessionRenamed: undefined,
    scope,
  });

  const activeGuestBannerState =
    sessionsHook.activeSessionId != null
      ? guestInfoBannerBySession[String(sessionsHook.activeSessionId)] ?? {}
      : {};
  const guestInfoBannerVisible =
    scope?.kind === "guest" &&
    sessionsHook.activeSessionId != null &&
    !!activeGuestBannerState.shown &&
    !activeGuestBannerState.dismissed;

  // Guest messages are loaded from DB via normal APIs, no special handling needed

  // Hour buckets for sticky timeline headers


  const hourBuckets: HourBucket[] = useMemo(() => {
    const buckets: HourBucket[] = [];
    let currentBucket: HourBucket | null = null;
    for (const group of groupedMessages) {
      const last = group.lastCreatedAt;
      // Build a local-time hour key: yyyy-mm-ddThh
      let hourKey = "unknown";
      if (last) {
        const d = new Date(last);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        hourKey = `${y}-${m}-${day}T${h}`;
      }
      if (!currentBucket || currentBucket.hourKey !== hourKey) {
        currentBucket = {
          hourKey,
          label: formatHourLabel(last ?? null),
          groups: [],
        };
        buckets.push(currentBucket);
      }
      currentBucket.groups.push(group);
    }
    return buckets;
  }, [groupedMessages]);

  // --- Search projection: keep only matching messages (hide everything else) ---
  const trimmedSearchQuery = searchQuery.trim();
  const normalizedSearchTags = useMemo(
    () => searchTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    [searchTags]
  );
  const activeSearchTerms = useMemo(
    () =>
      normalizedSearchTags.length > 0
        ? normalizedSearchTags
        : trimmedSearchQuery.length > 0
        ? [trimmedSearchQuery]
        : [],
    [normalizedSearchTags, trimmedSearchQuery]
  );
  const searchMatchers = useMemo(
    () =>
      activeSearchTerms
        .map((term) => buildSearchMatcher(term))
        .filter((matcher): matcher is ActiveSearchMatcher => matcher.kind !== "none"),
    [activeSearchTerms]
  );
  const activeSearchHighlightQuery = useMemo(
    () => activeSearchTerms.join(" ").trim(),
    [activeSearchTerms]
  );
  const searchMatcher = useMemo(
    () => buildSearchMatcher(activeSearchHighlightQuery),
    [activeSearchHighlightQuery]
  );
  const isSearching = searchMode && searchMatchers.length > 0;
  const SS_RETURN_FROM_ARCHIVE = "db:returnFromArchive";

  // One-shot marker from /archive -> /chat navigation so we can boot chat
  // through the warm-restore path instead of showing cold landing first.
  const isArchiveReturnBootRef = useRef<boolean | null>(null);
  if (typeof window !== "undefined" && isArchiveReturnBootRef.current === null) {
    try {
      const isArchiveReturn = sessionStorage.getItem(SS_RETURN_FROM_ARCHIVE) === "1";
      isArchiveReturnBootRef.current = isArchiveReturn;
      if (isArchiveReturn) {
        sessionStorage.removeItem(SS_RETURN_FROM_ARCHIVE);
      }
    } catch {
      isArchiveReturnBootRef.current = false;
    }
  }
  
  // Cold landing boot detection: only treat hard reload in same tab as resumable state.
  // Any normal navigation boot ("navigate") should behave like a fresh tab.
  const isColdLandingBootRef = useRef<boolean | null>(null);
  if (typeof window !== "undefined" && isColdLandingBootRef.current === null) {
    try {
      const isArchiveReturn = isArchiveReturnBootRef.current === true;
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const isPageReload =
        navEntry?.type === "reload" || (window as any).performance?.navigation?.type === 1;
      const isWarmRestoreBoot = isPageReload || isArchiveReturn;
      const hadTabMarker = sessionStorage.getItem("db:tabInit") === "1";
      sessionStorage.setItem("db:tabInit", "1");
      isColdLandingBootRef.current = !(isWarmRestoreBoot && hadTabMarker);
    } catch {
      isColdLandingBootRef.current = true;
    }
  }
  const [isColdLandingBoot, setIsColdLandingBoot] = useState<boolean>(() => {
    // Cold landing boot = new tab (new tabs always go to landing)
    return isColdLandingBootRef.current === true;
  });
  
  // On cold boot, delay applying landing lift transform to allow slide-up animation
  const [coldBootLiftReady, setColdBootLiftReady] = useState(false);
  useEffect(() => {
    if (isColdLandingBoot && !coldBootLiftReady) {
      // After first paint, allow slide-up animation
      requestAnimationFrame(() => {
        setColdBootLiftReady(true);
      });
    }
  }, [isColdLandingBoot, coldBootLiftReady]);

  // Detect refresh vs new tab using Navigation Timing API
  const [isReload, setIsReload] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [restoreDecisionMade, setRestoreDecisionMade] = useState(false);
  
  // Use layout effect so refresh/new-tab detection is applied before first paint.
  // This prevents a 1-frame "landing" flash on refresh that can make the composer blink/collapse.
  useLayoutEffect(() => {
    const isArchiveReturn = isArchiveReturnBootRef.current === true;
    // Check if this is a page refresh
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const isPageReload = navEntry?.type === "reload" || (window as any).performance?.navigation?.type === 1;
    const isWarmRestoreBoot = isPageReload || isArchiveReturn;

    setIsReload(isWarmRestoreBoot);
    setHasMounted(true);

    // Give restoration logic time to complete
    if (isWarmRestoreBoot) {
      const timer = setTimeout(() => {
        setRestoreDecisionMade(true);
      }, 100); // Small delay to ensure restoration decision is made

      return () => clearTimeout(timer);
    } else {
      setRestoreDecisionMade(true); // New tab doesn't need to wait
    }
  }, []);

  // Landing mode: only when no active session (after initial hydration completes).
  // IMPORTANT: gate on hasHydrated to avoid a 1-frame landing flash on refresh before restore completes.
  // For cold landing boot, treat as landing from the start (before hydration completes).
  // For new tabs (not refresh), also treat as landing from start to prevent composer snap.
  // For refresh, if there's no active session after restore, stay in landing mode.
  const isLanding = sessionsHook.hasHydrated 
    ? sessionsHook.activeSessionId == null 
    : (isColdLandingBoot ? true : (!isReload ? true : false)); // Cold boot or new tab = landing, refresh waits
  const isLandingRef = useRef(false);
  useEffect(() => { isLandingRef.current = isLanding; }, [isLanding]);

  // Clear cold landing boot flag after first paint (allow transitions for real switches)
  useEffect(() => {
    if (isColdLandingBoot) {
      // Use requestAnimationFrame to ensure first paint completes
      requestAnimationFrame(() => {
        setIsColdLandingBoot(false);
        setColdBootLiftReady(false);
      });
    }
  }, [isColdLandingBoot]);

  // When restoring a session, messages start empty until fetch completes.
  // Track "has loaded messages for active session" so we can suppress landing intro during restore.
  const [hasLoadedMessagesForActiveSession, setHasLoadedMessagesForActiveSession] = useState(false);
  useEffect(() => {
    setHasLoadedMessagesForActiveSession(false);
  }, [sessionsHook.activeSessionId]);

  // Guest sessions are restored via normal sessionsHook, no special handling needed

  const setMessagesAndMarkLoaded = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs);
    setHasLoadedMessagesForActiveSession(true);
    
    // Settle pin after messages load (keeps chat at bottom for large messages)
    if (sessionsHook.activeSessionId && !revealMessageIdRef.current && !isSending) {
      scheduleSettlePinToBottom("messages-loaded");
    }
  }, [sessionsHook.activeSessionId, isSending]);

  useEffect(() => {
    if (!webGlowHold) return;
    const targetMessageId = webGlowRevealMessageIdRef.current;
    if (targetMessageId == null) return;

    const key = String(targetMessageId);
    const fullHeight = fullHeightByIdRef.current[key];
    const revealedHeight = revealHeightById[key];
    if (
      typeof fullHeight === "number" &&
      fullHeight > 0 &&
      typeof revealedHeight === "number" &&
      revealedHeight >= fullHeight - 1
    ) {
      setWebGlowHold(false);
      webGlowRevealMessageIdRef.current = null;
    }
  }, [webGlowHold, revealHeightById, fullHeightByIdRef]);

  useEffect(() => {
    const pending = guestInfoBannerRevealRef.current;
    if (!pending) return;

    const key = String(pending.messageId);
    const fullHeight = fullHeightByIdRef.current[key];
    const revealedHeight = revealHeightById[key];
    if (
      typeof fullHeight === "number" &&
      fullHeight > 0 &&
      typeof revealedHeight === "number" &&
      revealedHeight >= fullHeight - 1
    ) {
      guestInfoBannerRevealRef.current = null;
      if (scope?.kind !== "guest") return;
      const sessionKey = String(pending.sessionId);
      const currentState = guestInfoBannerBySessionRef.current[sessionKey];
      if (currentState?.dismissed) return;
      updateGuestInfoBannerSessionState(pending.sessionId, { shown: true });
    }
  }, [scope?.kind, revealHeightById, fullHeightByIdRef, updateGuestInfoBannerSessionState]);

  const handleDismissGuestInfoBanner = useCallback(() => {
    if (scope?.kind !== "guest") return;
    if (sessionsHook.activeSessionId == null) return;
    updateGuestInfoBannerSessionState(sessionsHook.activeSessionId, {
      shown: true,
      dismissed: true,
    });
  }, [scope?.kind, sessionsHook.activeSessionId, updateGuestInfoBannerSessionState]);

  // Persist draftMemory and forceEditMemoryId to sessionStorage (per-tab).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (draftMemory == null) {
        sessionStorage.removeItem("db:draftMemory");
      } else {
        sessionStorage.setItem("db:draftMemory", JSON.stringify(draftMemory));
      }
    } catch {
      // ignore
    }
  }, [draftMemory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (forceEditMemoryId == null) {
        sessionStorage.removeItem("db:forceEditMemoryId");
      } else {
        sessionStorage.setItem("db:forceEditMemoryId", String(forceEditMemoryId));
      }
    } catch {
      // ignore
    }
  }, [forceEditMemoryId]);

  // Extract isRestoringMemoryOverlay from hook (needed for suppressLandingIntro).
  // This will be defined after the hook call below, but we need it here.
  // We'll define suppressLandingIntro after the hook destructuring.
  
  // Fade out landing content when sending first message or when composer is at bottom
  const [landingFadeOut, setLandingFadeOut] = useState(false);
  const [frozenPaddingBottom, setFrozenPaddingBottom] = useState<number | null>(null);
  const [frozenLandingStage, setFrozenLandingStage] = useState<number | null>(null);
  const [landingExitActive, setLandingExitActive] = useState(false);
  
  // Reset memory box height when not on landing
  useEffect(() => {
    if (!isLanding) {
      setLandingMemoryBoxHeight(0);
    }
  }, [isLanding]);

  // Anchor landing composer growth from its top edge:
  // track the smallest composer height seen during this landing session so
  // extra rows expand downward until the docked position is reached.
  useEffect(() => {
    if (!isLanding) {
      setLandingComposerBaseHeight(null);
      return;
    }
    if (!composerHeight) return;
    setLandingComposerBaseHeight((prev) => {
      if (prev == null) return composerHeight;
      return Math.min(prev, composerHeight);
    });
  }, [isLanding, composerHeight]);

  // Landing header staged fade-in sync with composer slide transition (700ms)
  // Stage 1: logo fades in centered, Stage 2: logo slides left, Stage 3: title reveals, Stage 4: subtitle, Stage 5: mode
  const [landingStage, setLandingStage] = useState(0);
  const stageForRender = landingFadeOut ? (frozenLandingStage ?? landingStage) : landingStage;

  // IMPORTANT: useLayoutEffect prevents a 1-frame flash when returning to landing from an existing chat.
  // (useEffect runs after paint, so stage can briefly be "5" then reset to "0" causing a visible blink.)
  useLayoutEffect(() => {
    if (isLanding) {
      // Reset to stage 0, then progress through stages
      setLandingStage(0);
      const t1 = setTimeout(() => setLandingStage(1), 50);   // Logo fades in centered
      const t2 = setTimeout(() => setLandingStage(2), 300);  // Logo slides left
      const t3 = setTimeout(() => setLandingStage(3), 500);  // Title reveals (after logo in place)
      const t4 = setTimeout(() => setLandingStage(4), 600);  // Subtitle
      const t5 = setTimeout(() => setLandingStage(5), 700);  // Mode chip
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
    } else {
      // Not landing: reset stage
      setLandingStage(0);
    }
  }, [isLanding]);

  // Compute lift for landing composer (slide from bottom to ~58% vertical - shifted down)
  const landingLiftPx = useMemo(() => {
    if (!windowH || !composerHeight) return 0;
    const bottomPadding = 24; // pb-6 = 24px
    const dockedTop = windowH - composerHeight - bottomPadding;
    const baseComposerHeight = landingComposerBaseHeight ?? composerHeight;
    const targetTop = windowH * 0.56 - baseComposerHeight * 0.5;
    return Math.max(0, dockedTop - targetTop);
  }, [windowH, composerHeight, landingComposerBaseHeight]);

  // Calculate adjusted composer position based on memory box height
  // When memory box grows, composer moves down (less negative translateY)
  // Clamped to never go below resting position (translateY(0px))
  const adjustedLandingLiftPx = useMemo(() => {
    if (!isLanding) return 0;
    return Math.max(0, landingLiftPx - landingMemoryBoxHeight);
  }, [isLanding, landingLiftPx, landingMemoryBoxHeight]);

  const { filteredHourBuckets, searchHitCount } = useMemo(() => {
    if (!isSearching) {
      return { filteredHourBuckets: hourBuckets, searchHitCount: 0 };
    }

    let hits = 0;

    const nextBuckets: HourBucket[] = hourBuckets
      .map((b) => {
        const nextGroups: MessageGroup[] = b.groups
          .map((g) => {
            const nextItems = g.items.filter((it) => {
              const roleMatches =
                searchRoleFilter === "all" || String((it as AnyMessage).role ?? "") === searchRoleFilter;
              if (!roleMatches) return false;

              const c = String(it.content ?? "");
              const ok =
                searchMatchMode === "or"
                  ? searchMatchers.some((matcher) => matchesSearchText(c, matcher, "and"))
                  : searchMatchers.every((matcher) => matchesSearchText(c, matcher, "and"));
              if (ok) hits += 1;
              return ok;
            });
            if (nextItems.length === 0) return null;
            return {
              ...g,
              items: nextItems,
            } as MessageGroup;
          })
          .filter(Boolean) as MessageGroup[];

        if (nextGroups.length === 0) return null;
        return {
          ...b,
          groups: nextGroups,
        } as HourBucket;
      })
      .filter(Boolean) as HourBucket[];

    return { filteredHourBuckets: nextBuckets, searchHitCount: hits };
  }, [hourBuckets, isSearching, searchMatchers, searchRoleFilter, searchMatchMode]);
  
  const handleSimplify = async (messageId: number | string | undefined, content: string) => {
    if (!activeSessionId) return;
    if (scope?.kind === "guest") {
      showToast(GUEST_PREVIEW_SIGN_IN_PROMPT);
      return;
    }

    // Global lock: don’t allow actions while any send/stream is active
    if (isSendingRef.current) return;

    const key = String(messageId ?? "unknown");
    if (actionBusyByMessageIdRef.current[key]) return; // per-message lock

    setActionBusyByMessageId((prev) => ({ ...prev, [key]: true }));

    try {
      // Use the normal message sending pipeline with a hidden prompt
      const simplifyPrompt =
        `__DB_ACTION__:SIMPLIFY\nYou are given a single message to simplify. Your task is to translate it to lower cognitive load while preserving its core meaning and accuracy.\n\n` +
        `CRITICAL RULES:\n` +
        `1. Work ONLY with the message provided below\n` +
        `2. DO NOT reference any other messages, context, or conversation history\n` +
        `3. DO NOT say "as I mentioned earlier" or similar phrases\n` +
        `4. Translate to simpler, more concise language\n` +
        `5. Preserve accuracy, constraints, and intent\n` +
        `6. Remove unnecessary detail but keep all essential information\n` +
        `7. Do not add new information or assumptions\n\n` +
        `Message to simplify:\n${content}`;

      await handleSend(simplifyPrompt, { historyPolicy: "none" });
    } finally {
      setActionBusyByMessageId((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };
  
  const DEEPER_PREFIX = "Deeper: Expand the previous response with more depth";
  
  const handleDeeper = async (messageId: number | string | undefined, content: string) => {
    if (!activeSessionId) return;
    if (scope?.kind === "guest") {
      showToast(GUEST_PREVIEW_SIGN_IN_PROMPT);
      return;
    }

    // Global lock: don’t allow actions while any send/stream is active
    if (isSendingRef.current) return;

    const key = String(messageId ?? "unknown");
    if (actionBusyByMessageIdRef.current[key]) return; // per-message lock

    setActionBusyByMessageId((prev) => ({ ...prev, [key]: true }));

    try {
      const deeperPrompt =
        `__DB_ACTION__:DEEPER\nYou are given a single message to expand with depth. Your task is to add useful elaboration, nuance, and details without reframing the original message.\n\n` +
        `CRITICAL RULES:\n` +
        `1. Work ONLY with the message provided below\n` +
        `2. DO NOT reference any other messages, context, or conversation history\n` +
        `3. DO NOT say "as I mentioned earlier" or similar phrases\n` +
        `4. Expand depth with relevant details, examples, or explanations\n` +
        `5. Preserve the original meaning and do not reframe the core message\n` +
        `6. Add nuance and useful elaboration\n` +
        `7. Do not add fluff or tangential information\n\n` +
        `Message to expand:\n${content}`;

      await handleSend(deeperPrompt, { historyPolicy: "none" });
    } finally {
      setActionBusyByMessageId((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const messagesTree = useMemo(() => {
    const STREAM_RHYTHM_Y = 16; // px. Single vertical rhythm unit for the message stream
    const bucketsToRender = searchMode ? filteredHourBuckets : hourBuckets;
    
    // Detect if waiting for assistant response
    const lastMessageRole =
      messages.length > 0
        ? ((messages[messages.length - 1] as any)?.role as ("user" | "assistant" | undefined))
        : undefined;
    const waitingForAssistant = isSending && lastMessageRole === "user";

    const anchorToBottom = messages.length > 0 && !searchMode && !isSearching;

    return (
      <div
        className={
          "flex flex-col min-h-full transition-opacity duration-700 ease-out will-change-[opacity] " +
          (isModeFading
            ? "opacity-0"
            : "opacity-100")
        }
      >
        {messages.length > 0 && searchMode && isSearching && bucketsToRender.length === 0 && (
          <div className="h-full flex items-center justify-center text-[13px] text-gray-400">
            No matches.
          </div>
        )}

        {anchorToBottom && <div className="flex-1" />}

        {bucketsToRender.map((bucket, bucketIdx) => (
          <div
            key={bucket.hourKey}
            className="relative overflow-visible"
            ref={(el) => {
              if (!el) return;
              hourBucketRefs.current[bucket.hourKey] = el;
            }}
            style={bucketIdx > 0 ? { marginTop: STREAM_RHYTHM_Y } : undefined}
          >
            {/* All groups in this hour */}
            <div className="overflow-visible" style={{ paddingTop: bucketIdx === 0 ? 0 : 0 }}>
              <div
                className="max-w-4xl mx-auto overflow-visible"
                style={{ display: "flex", flexDirection: "column", gap: STREAM_RHYTHM_Y }}
              >
                {bucket.groups.map((group, groupIdx) => {
                  const isUser = group.role === "user";
                  const groupStamp = group.lastCreatedAt ? formatHourLabel(group.lastCreatedAt) : "";
                  return (
                    <div key={group.id}>
                      <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
                        <div
                          className={
                            isUser
                              ? "max-w-[70%] mx-1 min-w-0"
                              : "w-full mx-1"
                          }
                        >
                          {group.items.map((m, itemIdx) => {
                            if (isUser) {
                              // Check if this is a simplify or deeper request and show simplified UI
                              const isSimplifyRequest = m.content.startsWith("__DB_ACTION__:SIMPLIFY");
                              const isDeeperRequest = m.content.startsWith("__DB_ACTION__:DEEPER");

                              // v1 labels (UI-only). Canonical prompt stays hidden in content.
                              const displayContent =
                                isSimplifyRequest ? "Clarify" :
                                isDeeperRequest ? "Expand" :
                                m.content;
                              const userImageUrls = Array.isArray((m as any).image_urls)
                                ? ((m as any).image_urls as string[]).filter((url) => typeof url === "string" && url.length > 0)
                                : [];
                              const hasDisplayContent = displayContent.trim().length > 0;
                              const handleUserCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
                                const selected = window.getSelection()?.toString() ?? displayContent;
                                // Guard against accidental drag selections anchored in bubble padding.
                                // If selection starts on a blank line, strip only that leading whitespace/newlines.
                                const normalized = /^\s*\r?\n/.test(selected)
                                  ? selected.replace(/^\s+/, "")
                                  : selected;
                                e.clipboardData.setData("text/plain", normalized);
                                e.preventDefault();
                              };
                              
                              // User bubble
                              return (
                                <div key={m.id ?? itemIdx} className="min-w-0 flex flex-col items-end gap-1.5">
                                  {userImageUrls.length > 0 && (
                                    <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                                      {userImageUrls.map((imageUrl, imageIndex) => (
                                        <button
                                          key={`${m.id ?? itemIdx}-image-${imageIndex}`}
                                          type="button"
                                          onClick={() => setExpandedUserImageUrl(imageUrl)}
                                          className="block h-24 w-32 overflow-hidden rounded-lg border border-blue-400/30 bg-blue-950/40 transition hover:border-blue-300/50 sm:h-28 sm:w-36"
                                          aria-label={`Open attachment ${imageIndex + 1}`}
                                        >
                                          <img
                                            src={imageUrl}
                                            alt={`Attachment ${imageIndex + 1}`}
                                            className="block h-full w-full object-cover"
                                            loading="lazy"
                                            onLoad={() => {
                                              if (isAtBottomRef.current || distToBottomRef.current <= BOTTOM_EPSILON) {
                                                scheduleSettlePinToBottomRef.current("user-image-load");
                                              }
                                            }}
                                            onError={() => {
                                              if (isAtBottomRef.current || distToBottomRef.current <= BOTTOM_EPSILON) {
                                                scheduleSettlePinToBottomRef.current("user-image-error");
                                              }
                                            }}
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {hasDisplayContent && (
                                    <div
                                      className="inline-block max-w-full rounded-lg bg-blue-600 text-[14px] px-3 py-1.5 leading-snug text-white overflow-hidden select-none"
                                      onCopyCapture={handleUserCopy}
                                    >
                                      <span
                                        className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text"
                                        data-user-message-text="true"
                                      >
                                        {renderSearchHighlightedText(
                                          displayContent,
                                          searchMatcher
                                        )}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            // Assistant block
                            const messageId = m.id ?? itemIdx;

                            // --- Add revealPreload logic for newest assistant block ---
                            const isLastBucket = bucketIdx === bucketsToRender.length - 1;
                            const isLastGroupInBucket = groupIdx === bucket.groups.length - 1;
                            const isLastItemInGroup = itemIdx === group.items.length - 1;
                            const isNewestAssistantBlock =
                              !searchMode &&
                              !isSearching &&
                              isLastBucket &&
                              isLastGroupInBucket &&
                              isLastItemInGroup;

                            return (
                              <MessageErrorBoundary key={messageId}>
                              <AssistantMessage
                                message={{
                                  id: messageId,
                                  content: m.content as string,
                                  session_id: (m as any).session_id || null,
                                  message_id: typeof messageId === "number" ? messageId : (typeof m.id === "number" ? m.id : null),
                                  created_at: (m as any).created_at || null,
                                  meta: (m as any).meta ?? null,
                                }}
                                isFirstInGroup={itemIdx === 0}
                                  isStreaming={false}
                                  streamingContent=""
                                revealHeightPx={revealMessageIdRef.current === messageId ? revealHeightById[String(messageId)] : undefined}
                                  revealActive={revealMessageIdRef.current === messageId}
                                revealPreload={isNewestAssistantBlock && !(m as any)?.is_placeholder}
                                isPlaceholder={!!(m as any)?.is_placeholder}
                                highlightTerm={isSearching ? activeSearchHighlightQuery : ""}
                                onMeasured={(id, h) => {
                                  fullHeightByIdRef.current[id] = h;
                                  
                                  // Settle pin if this is the last message and we're at the bottom
                                  if (sessionsHook.activeSessionId && 
                                      !revealMessageIdRef.current && 
                                      !isSending &&
                                      String(id) === String(messages[messages.length - 1]?.id)) {
                                    scheduleSettlePinToBottom("last-measured");
                                  }
                                }}
                                onCopy={(_content) => {
                                  // AssistantMessage already writes rich clipboard payload.
                                  // Keep this callback as a no-op to avoid flattening to plain text.
                                }}
                                onSaveToVault={() => {}}
                                onVault={async (memoryId: number) => {
                                  // If we're on landing, hide it immediately BEFORE any other state changes
                                  if (isLandingRef.current) {
                                    setSuppressLanding(true);
                                    setIsChatEntering(true);
                                    setEnterOpacity(0);
                                  }
                                  
                                  // Reload memories to get the newly created one
                                  await loadMemories();
                                  // Set selected memory and open overlay
                                  setSelectedMemoryId(memoryId);
                                  setMemoryOverlayOpen(true);
                                  setForceEditMemoryId(memoryId);
                                }}
                                onVaultDraft={(draftPayload) => {
                                  // If we're on landing, hide it immediately
                                  if (isLandingRef.current) {
                                    setSuppressLanding(true);
                                    setIsChatEntering(true);
                                    setEnterOpacity(0);
                                  }
                                  
                                  const isGuest = scope?.kind === "guest";

                                  // For guests, don't title from message text. Start drafts as "Untitled".
                                  if (isGuest) {
                                    unstable_batchedUpdates(() => {
                                      setDraftMemory({
                                        title: "Untitled",
                                        summary: draftPayload.summary,
                                        session_id: draftPayload.session_id,
                                        message_id: draftPayload.message_id,
                                        _isTitleGenerating: false,
                                      });
                                      setMemoryOverlayOpen(true);
                                    });
                                    return;
                                  }

                                  // Signed-in flow: open draft immediately, then fill title when async generation resolves.
                                  unstable_batchedUpdates(() => {
                                    setDraftMemory({
                                      title: "",
                                      summary: draftPayload.summary,
                                      session_id: draftPayload.session_id,
                                      message_id: draftPayload.message_id,
                                      _isTitleGenerating: true,
                                    });
                                    setMemoryOverlayOpen(true);
                                  });
                                  
                                  const fallbackTitle = clampGeneratedTitle(makeAutoTitleFromAssistant(draftPayload.summary));

                                  void fetch("/api/title", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ assistantResponse: draftPayload.summary }),
                                  })
                                    .then((r) => r.json())
                                    .then(({ title }) => {
                                      const rawCandidate = typeof title === "string" ? title : "";
                                      const normalizedCandidate = clampGeneratedTitle(rawCandidate);
                                      const resolvedTitle =
                                        rawCandidate.trim().length > 0 && normalizedCandidate !== "New Chat"
                                          ? normalizedCandidate
                                          : fallbackTitle;
                                      setDraftMemory((prev) => {
                                        if (!prev || !(prev as any)._isTitleGenerating) return prev;
                                        return {
                                          ...prev,
                                          title: resolvedTitle,
                                          _isTitleGenerating: false,
                                        };
                                      });
                                    })
                                    .catch(() => {
                                      setDraftMemory((prev) => {
                                        if (!prev || !(prev as any)._isTitleGenerating) return prev;
                                        return {
                                          ...prev,
                                          title: fallbackTitle,
                                          _isTitleGenerating: false,
                                        };
                                      });
                                    });
                                }}
                                onFork={async ({ content, messageId, sessionId }) => {
                                  const sourceSessionId =
                                    (typeof sessionId === "number" ? sessionId : null) ??
                                    activeSessionIdRef.current ??
                                    null;
                                  if (!sourceSessionId) {
                                    showToast("Can't branch: no active session.");
                                    return;
                                  }

                                  let anchorMessageId =
                                    typeof messageId === "number" && Number.isFinite(messageId)
                                      ? messageId
                                      : null;

                                  // Some in-flight assistant rows still have temporary client IDs.
                                  // Resolve anchor by content against persisted messages as a fallback.
                                  if (!anchorMessageId) {
                                    try {
                                      const headers = scope ? getHeadersForScope(scope) : getAuthHeaders();
                                      const resolveRes = await fetch(`/api/messages?session_id=${sourceSessionId}`, { headers });
                                      const persisted = await resolveRes.json();
                                      if (Array.isArray(persisted)) {
                                        const needle = String(content || "").trim();
                                        for (let i = persisted.length - 1; i >= 0; i -= 1) {
                                          const row = persisted[i];
                                          if (
                                            row?.role === "assistant" &&
                                            typeof row?.content === "string" &&
                                            row.content.trim() === needle &&
                                            Number.isFinite(Number(row?.id))
                                          ) {
                                            anchorMessageId = Number(row.id);
                                            break;
                                          }
                                        }
                                      }
                                    } catch (err) {
                                      console.error("[FORK] Failed to resolve anchor message id", err);
                                    }
                                  }

                                  if (!anchorMessageId) {
                                    showToast("Fork unavailable for this message yet. Try once more in a second.");
                                    return;
                                  }

                                  try {
                                    const headers = scope ? getHeadersForScope(scope) : getAuthHeaders();
                                    const res = await fetch("/api/sessions/branch", {
                                      method: "POST",
                                      headers,
                                      body: JSON.stringify({
                                        sourceSessionId,
                                        anchorMessageId,
                                        carryCount: 10,
                                      }),
                                    });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok || typeof data?.newSessionId !== "number") {
                                      throw new Error(data?.error || `HTTP ${res.status}`);
                                    }

                                    // Branched sessions are created in Unsorted by default.
                                    // Follow the new chat by switching the left panel filter to Unsorted.
                                    setSelectedFolderId(null);
                                    setPendingNewChatFolderId(null);
                                    await loadSessions();
                                    await handleSelectSession(data.newSessionId);
                                    setInput("");
                                  } catch (err) {
                                    const message = err instanceof Error ? err.message : "Failed to branch chat";
                                    console.error("[FORK] Branch creation failed:", err);
                                    showToast(`Branch failed: ${message}`);
                                  }
                                }}
                                onSimplify={handleSimplify}
                                onDeeper={handleDeeper}
                                actionsDisabled={
                                  isSending ||
                                  revealMessageIdRef.current !== null
                                }
                                actionBusy={!!actionBusyByMessageId[String(messageId)]}
                                hideActionsWhenDisabled={true}
                              />
                              </MessageErrorBoundary>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}

      </div>
    );
  }, [
    messages,
    hourBuckets,
    filteredHourBuckets,
    searchMode,
    isSearching,
    searchQuery,
    isSending,
    revealHeightById,
    composerHeight,
    isModeFading,
    isChatEntering,
    handleSimplify,
  ]);
  
  // Extract session/folder state from hook
  const {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId: setActiveSessionIdTraced,
    sidebarSessions,
    setSidebarSessions,
    folders,
    setFolders,
    selectedFolderId,
    setSelectedFolderId,
    startRenameFolderId,
    setStartRenameFolderId,
    rightRailSelectedId,
    setRightRailSelectedId,
    rightPanelOpen,
    setRightPanelOpen,
    activeDragId,
    setActiveDragId,
    dragOverlaySessionId: dragOverlaySessionIdFromHook,
    setDragOverlaySessionId: setDragOverlaySessionIdFromHook,
    sessionKey,
    setSessionKey,
    sessionUsedTokens,
    setSessionUsedTokens,
    sessionTokenLimit,
    setSessionTokenLimit,
    hasHydrated,
    hasLoadedSessions,
    activeSessionIdRef,
    sidebarSessionsRef,
    foldersRef,
    selectedFolderIdRef,
    sessionUsedTokensRef,
    updatedAtOverridesRef,
    setUpdatedAtOverride,
    updateLastOpened,
    touchSession,
    loadSessions,
    handleSelectSession: handleSelectSessionFromHook,
    handleRenameSession: handleRenameSessionFromHook,
    handleDeleteSession: handleDeleteSessionFromHook,
    handleCreateSession: handleCreateSessionFromHook,
    handleReorderSessions,
    handleChatFolderReorder,
    addPendingDeletedChatFolder,
    removePendingDeletedChatFolder,
    loadFoldersFromDB,
    hasLoadedFoldersOnce,
    hydratedFromCacheChatFolders,
  } = sessionsHook;

  useEffect(() => {
    if (scope?.kind !== "guest") return;
    if (!guestPreviewStorageReadyRef.current) return;
    writeGuestPreviewSessionsToStorage(sidebarSessions, sessions as any[]);
  }, [scope?.kind, sidebarSessions, sessions, writeGuestPreviewSessionsToStorage]);

  useEffect(() => {
    if (scope?.kind !== "guest") {
      guestPreviewHydratedRef.current = false;
      guestPreviewStorageReadyRef.current = false;
      return;
    }
    if (!hasHydrated || !hasLoadedSessions) return;
    if (guestPreviewHydratedRef.current) return;
    guestPreviewHydratedRef.current = true;

    const stored = readGuestPreviewSessionsFromStorage();
    if (stored.length === 0) {
      guestPreviewStorageReadyRef.current = true;
      return;
    }

    const toSidebarSession = (row: GuestPreviewStoredSession): SidebarSession => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      inFolderId: row.inFolderId,
      folderOrderTs: row.folderOrderTs,
      focusGoal: row.focusGoal,
      focusEnabled: row.focusEnabled,
      mru_ts: row.mru_ts,
    });

    const toTypedSession = (row: GuestPreviewStoredSession) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updatedAt: row.updatedAt,
      mode: row.mode,
      inFolderId: row.inFolderId,
      folderOrderTs: row.folderOrderTs,
      focusGoal: row.focusGoal,
      focusEnabled: row.focusEnabled,
      mru_ts: row.mru_ts,
    });

    setSidebarSessions((prev) => {
      const merged = new Map<number, SidebarSession>();
      prev.forEach((row) => merged.set(row.id, row));
      stored.forEach((row) => {
        if (!merged.has(row.id)) {
          merged.set(row.id, toSidebarSession(row));
        }
      });
      return [...merged.values()].sort((a, b) => b.mru_ts - a.mru_ts);
    });

    setSessions((prev) => {
      const merged = new Map<number, any>();
      (prev as any[]).forEach((row: any) => merged.set(row.id, row));
      stored.forEach((row) => {
        if (!merged.has(row.id)) {
          merged.set(row.id, toTypedSession(row));
        }
      });
      return [...merged.values()].sort((a: any, b: any) => (b.mru_ts ?? 0) - (a.mru_ts ?? 0));
    });

    if (activeSessionId == null && sidebarSessions.length === 0) {
      setActiveSessionIdTraced(stored[0].id, "guest-preview-restore");
    }

    // If every restored guest preview chat is in a folder, avoid blank Unfiled rail
    // after refresh by selecting the active/fallback folder once.
    if (selectedFolderIdRef.current == null) {
      const hasUnfiledStored = stored.some((row) => row.inFolderId == null);
      if (!hasUnfiledStored) {
        const activeStored =
          activeSessionId == null ? null : stored.find((row) => row.id === activeSessionId) ?? null;
        const fallbackFolderId = activeStored?.inFolderId ?? stored[0]?.inFolderId ?? null;
        if (fallbackFolderId != null) {
          setSelectedFolderId(fallbackFolderId);
        }
      }
    }
    guestPreviewStorageReadyRef.current = true;
  }, [
    scope?.kind,
    hasHydrated,
    hasLoadedSessions,
    activeSessionId,
    sidebarSessions.length,
    readGuestPreviewSessionsFromStorage,
    setSessions,
    setSidebarSessions,
    setActiveSessionIdTraced,
    selectedFolderIdRef,
    setSelectedFolderId,
  ]);

  useEffect(() => {
    if (scope?.kind !== "guest" || typeof window === "undefined") return;
    if (!guestPreviewStorageReadyRef.current) return;
    try {
      const raw = sessionStorage.getItem(GUEST_PREVIEW_MESSAGES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const validIds = new Set(sidebarSessions.map((s) => String(s.id)));
      const next: Record<string, unknown> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (validIds.has(key) && Array.isArray(value)) {
          next[key] = value;
        }
      });
      sessionStorage.setItem(GUEST_PREVIEW_MESSAGES_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [scope?.kind, sidebarSessions]);

  // Signed-in only: persist last active session to user-specific key
  useEffect(() => {
    if (scope?.kind !== "user" || !user?.id || !activeSessionId) return;
    try {
      // On the very first signed-in frame, prevent stale pre-reset session ids
      // from being persisted before auth fresh-sign-in reset runs.
      if (
        sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1" &&
        !freshSignInResetHandledRef.current
      ) {
        return;
      }
      sessionStorage.setItem(`db:lastSession:${user.id}`, String(activeSessionId));
      sessionStorage.removeItem(`db:userLanding:${user.id}`);
    } catch {
      // ignore
    }
  }, [scope?.kind, user?.id, activeSessionId]);

  // One-shot auth-boundary reset: on first signed-in frame after auth transition,
  // force a fresh landing and closed panels, then consume marker after hydration.
  useEffect(() => {
    if (scope?.kind !== "user") {
      freshSignInResetHandledRef.current = false;
      return;
    }

    if (freshSignInResetHandledRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const freshSignedInEntry = sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1";
      if (!freshSignedInEntry) return;
    } catch {
      return;
    }
    freshSignInResetHandledRef.current = true;

    suppressRestoreLastSessionRef.current = true;
    setSelectedFolderId(null);
    setPendingNewChatFolderId(null);
    setRightRailSelectedId(null);
    setRightPanelOpen(true);
    setSidebarHidden(true);
    setRightDockHidden(true);
    setActiveSessionIdTraced(null, "auth:fresh-sign-in");
    setMessages([]);
    setInput("");
    inputPreserveRef.current = "";
    // Intentionally one-shot by marker + ref guard. Including unstable setter refs
    // in deps causes rerun loops while the marker remains present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.kind]);

  useEffect(() => {
    if (scope?.kind !== "user") return;
    if (!hasHydrated || !hasLoadedSessions || !hasHydratedPanels) return;
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) !== "1") return;
      sessionStorage.removeItem(SS_FRESH_SIGNED_IN_ENTRY);
    } catch {
      // ignore
    }
  }, [scope?.kind, hasHydrated, hasLoadedSessions, hasHydratedPanels]);

  // Helper: read guest folders from sessionStorage (single source of truth for guest).
  // Avoids stale React state causing wipe when mutating folders before hydration.
  const getGuestFoldersFromStorage = useCallback((): SidebarFolder[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem("db:folders");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((f: any) => ({ id: f.id, name: f.name, icon: f.icon || undefined }))
        : [];
    } catch {
      return [];
    }
  }, []);

  // Guest folder reorder: persist to sessionStorage then setFolders (DnD calls setFolders with array).
  const setFoldersWithGuestPersist = useCallback(
    (arg: React.SetStateAction<typeof folders>) => {
      if (Array.isArray(arg) && scope?.kind === "guest" && typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:folders", JSON.stringify(arg));
        } catch {
          // ignore
        }
      }
      setFolders(arg);
    },
    [setFolders, scope?.kind]
  );

  const attachmentScopeKey = scope
    ? scope.kind === "user"
      ? `user:${scope.userId}`
      : `guest:${scope.guestId}`
    : "loading";

  // --- Session attachments hook (relational DB persistence) ---
  const {
    getMemoryIds,
    getAttachments,
    getUsage,
    attach: attachMemoryToSession,
    detach: detachMemoryFromSession,
    refreshUsage,
    hydrate,
    togglePin,
  } = useSessionAttachments(activeSessionId, attachmentScopeKey);

  // Re-sync usage caps after plan changes (e.g. manual free -> plus flip) without requiring a full reload.
  useEffect(() => {
    if (!isAuthenticated || activeSessionId == null) return;
    let cancelled = false;

    const refreshPlanAwareUsage = async () => {
      try {
        const response = await fetch(`/api/session-usage?session_id=${activeSessionId}`, {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json();
        const used = typeof payload?.used_tokens === "number" ? payload.used_tokens : 0;
        const limit =
          typeof payload?.session_token_limit === "number" &&
          Number.isFinite(payload.session_token_limit) &&
          payload.session_token_limit > 0
            ? Math.trunc(payload.session_token_limit)
            : null;

        if (!cancelled) {
          setSessionUsedTokens((prev) => ({ ...prev, [activeSessionId]: used }));
          if (limit != null) setSessionTokenLimit(limit);
        }
      } catch {
        // best-effort refresh only
      }
      if (!cancelled) {
        void refreshUsage(activeSessionId);
      }
    };

    void refreshPlanAwareUsage();
    return () => {
      cancelled = true;
    };
  }, [
    accountPlan,
    activeSessionId,
    isAuthenticated,
    refreshUsage,
    setSessionTokenLimit,
    setSessionUsedTokens,
  ]);

  // Signed-in only: restore last session when activeSessionId is null (e.g. tab switch)
  useEffect(() => {
    if (scope?.kind !== "user" || !user?.id) return;
    if (!hasHydrated || !hasLoadedSessions) return;
    if (activeSessionId != null) return;
    if (suppressRestoreLastSessionRef.current) return;

    try {
      if (sessionStorage.getItem(`db:userLanding:${user.id}`) === "1") return;
      if (sessionStorage.getItem(SS_FRESH_SIGNED_IN_ENTRY) === "1") return;
    } catch {
      // ignore
    }

    try {
      const saved = sessionStorage.getItem(`db:lastSession:${user.id}`);
      if (!saved) return;

      const id = Number(saved);
      if (!Number.isFinite(id)) return;
      if (!sessions.some((s: Session) => s.id === id)) return;

      setIsRestoringLastSession(true);
      setActiveSessionIdTraced(id, "restore:tab-switch");
      hydrate(id).finally(() => {
        setIsRestoringLastSession(false);
      });
    } catch {
      setIsRestoringLastSession(false);
    }
  }, [scope?.kind, user?.id, hasHydrated, hasLoadedSessions, activeSessionId, sessions, setActiveSessionIdTraced, hydrate]);

  // Clear suppress flag when user selects a session (so restore can work again on future tab-resume)
  useEffect(() => {
    if (activeSessionId != null) {
      suppressRestoreLastSessionRef.current = false;
    }
  }, [activeSessionId]);

  const prevComposerSessionIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prevSessionId = prevComposerSessionIdRef.current;
    const nextSessionId = activeSessionId ?? null;
    if (prevSessionId !== nextSessionId) {
      // Prevent cross-chat / chat->landing carryover of transient composer state.
      resetComposerAttachments();
      setWebSearchArmed(false);
      setWebGlowHold(false);
      webGlowRevealMessageIdRef.current = null;
    }
    prevComposerSessionIdRef.current = nextSessionId;
  }, [activeSessionId, resetComposerAttachments]);

  // --- Memory/Vault hook (extracted from page component) ---
  const {
    memoryFolders,
    setMemoryFolders,
	    memories,
	    setMemories,
	    getMemoryById,
	    upsertMemoryInCache,
	    upsertMemoryInFolderCaches,
	    selectedMemoryFolder,
	    setSelectedMemoryFolder,
	    handleSelectMemoryFolder,
    selectedMemoryId,
    setSelectedMemoryId,
    memorySearchQuery,
    setMemorySearchQuery,
    memoryOverlayOpen,
    setMemoryOverlayOpen,
    memoryToolbarVisible,
    setMemoryToolbarVisible,
    memoryLoading,
    memoryError,
    memoryOverlayOpenRef,
    isOpeningMemory,
    isRestoringMemoryOverlay,
    restoredDraftJson,
    getGuestMemoryFoldersFromStorage,
    loadMemoryFolders,
    handleCreateMemoryFolder,
    loadMemories,
    persistGuestMemoryToDb,
    handleMemorySave,
    handleMemoryRename,
    handleMemoryDelete,
    handleMemoryReorder,
    handleFolderReorder,
    handleFolderRename,
    handleFolderDelete,
    handleFolderDeleteAndMove,
    handleMoveMemoryToFolder,
    handleRenameMemoryFolder,
    handleDeleteMemoryFolder,
    handleDeleteMemoryFolderAndMemories,
	    handleCreateMemory,
	    getAllMemoryFolderNames,
	    isFolderSwitching: isMemoryFolderSwitching,
	    suppressMemoryHover,
	    hasLoadedMemoryFoldersOnce,
	    hydratedFromCacheMemoryFolders,
	    hydratedFromCacheMemories,
	  } = useChatMemories();

  // Dev-only: log hydration state on refresh
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const lastUserId = getLastUserId();
    const scopeUserId = scope?.kind === "user" && "userId" in scope ? scope.userId : null;
    console.debug("[DB_HYDRATION]", {
      lastUserId,
      scopeUserId,
      hydratedFromCacheChatFolders,
      hydratedFromCacheMemoryFolders,
      hydratedFromCacheMemories,
    });
  }, [scope?.kind, scope && "userId" in scope ? scope.userId : null, hydratedFromCacheChatFolders, hydratedFromCacheMemoryFolders, hydratedFromCacheMemories]);

  // For guest: persist sessionStorage memory to DB first, then attach. For user: attach directly. Returns DB id.
  const ensureMemoryInDbThenAttach = useCallback(
    async (sessionId: number, memoryId: number): Promise<number> => {
      const dbId = await persistGuestMemoryToDb(memoryId);
      await attachMemoryToSession(sessionId, dbId);
      return dbId;
    },
    [persistGuestMemoryToDb, attachMemoryToSession]
  );

  // Define suppressLandingIntro after hook destructuring (needs isRestoringMemoryOverlay).
  const suppressLandingIntro =
    (sessionsHook.activeSessionId != null &&
    messages.length === 0 &&
    !hasLoadedMessagesForActiveSession) ||
    isRestoringMemoryOverlay; // Suppress landing intro when restoring memory overlay

  const showLandingHeader = (isLanding && !suppressLandingIntro) || landingExitActive;

  // dragOverlaySessionId now comes from sessionsHook
  const dragOverlaySessionId = dragOverlaySessionIdFromHook;
  const setDragOverlaySessionId = setDragOverlaySessionIdFromHook;
  
  // Landing attach bucket (ephemeral)
  // No fixed count limit - only token-based capacity

  // Attached memories helpers
  const handleAttachMemory = useCallback(
    async (memoryId: number) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      
      try {
        await attachMemoryToSession(sessionId, memoryId);
      } catch (error) {
        // Error message is already user-friendly from the server
        const message = error instanceof Error ? error.message : "Failed to attach memory";
        console.error("[ATTACH ERROR]", message);
        // Show error toast
        showToast(message);
      }
    },
    [activeSessionIdRef, attachMemoryToSession, showToast]
  );

  // Shared memory usage calculator - matches server logic exactly
  const computeMemoryUsageRatio = useCallback(async (memoryList: Array<{ content: string | null; summary: string }>) => {
    if (memoryList.length === 0) {
      return { usedTokens: 0, maxTokens: attachedMemoryTokenCap, ratio: 0 };
    }
    
    // Use the same logic as /api/session-attachments/usage
    const { estimateTokens } = await import("@/lib/tokenEstimate");
    
    const currentTokens = memoryList.reduce((total, mem) => {
      // Use content if available, otherwise fall back to summary (same as server)
      const textToInject = mem.content || mem.summary;
      return total + estimateTokens(textToInject);
    }, 0);
    
    const usageRatio = Math.min(currentTokens / attachedMemoryTokenCap, 1);
    
    return { usedTokens: currentTokens, maxTokens: attachedMemoryTokenCap, ratio: usageRatio };
  }, [attachedMemoryTokenCap]);

  // Calculate landing memory usage using the shared calculator
  const [landingMemoryBudget, setLandingMemoryBudget] = useState<{ usedTokens: number; maxTokens: number; ratio: number }>({
    usedTokens: 0,
    maxTokens: attachedMemoryTokenCap,
    ratio: 0,
  });
  
  // Update landing memory budget when attached memories change
  useEffect(() => {
    if (!activeSessionId && landingAttachedMemoryIds.length > 0) {
      const landingMemories = memories.filter(m => landingAttachedMemoryIds.includes(m.id));
      // Transform Memory objects to match server usage logic (content first, summary fallback)
      const transformedMemories = landingMemories.map(m => ({
        content: m.content ?? null,
        summary: m.summary
      }));
      computeMemoryUsageRatio(transformedMemories).then(budget => {
        setLandingMemoryBudget(budget);
      }).catch(error => {
        console.error("Error calculating landing memory usage:", error);
        setLandingMemoryBudget({ usedTokens: 0, maxTokens: attachedMemoryTokenCap, ratio: 0 });
      });
    } else if (!activeSessionId && landingAttachedMemoryIds.length === 0) {
      setLandingMemoryBudget({ usedTokens: 0, maxTokens: attachedMemoryTokenCap, ratio: 0 });
    }
  }, [landingAttachedMemoryIds, activeSessionId, memories, computeMemoryUsageRatio, attachedMemoryTokenCap]);
  
  // Estimate usage ratio for a list of memory IDs (for landing attachments) - DEPRECATED, kept only for attach validation
  const estimateUsageRatioForMemoryIds = useCallback(async (memoryIds: number[]): Promise<number> => {
    if (memoryIds.length === 0) return 0;
    
    try {
      // Fetch memories to estimate tokens
      const memoryPromises = memoryIds.map(async (id) => {
        const memory = await getMemoryById(id);
        if (!memory) return null;
        
        // Use content if available, otherwise fall back to summary
        return memory.content || memory.summary;
      });
      
      const memoryContents = await Promise.all(memoryPromises);
      
      // Estimate tokens (same logic as API route)
      const { estimateTokens } = await import("@/lib/tokenEstimate");
      const currentTokens = memoryContents.reduce((total: number, mem: string | null) => {
        if (!mem) return total;
        return total + estimateTokens(mem);
      }, 0);
      
      return Math.min(currentTokens / attachedMemoryTokenCap, 1);
    } catch (error) {
      console.error("Error estimating usage ratio for memory IDs:", error);
      return 0;
    }
  }, [getMemoryById, attachedMemoryTokenCap]);

  // Attach memory to landing (ephemeral, capped by token + count capacity)
  const attachMemoryToLanding = useCallback(async (memoryId: number) => {
    setLandingAttachedMemoryIds((prev) => {
      if (prev.includes(memoryId)) {
        showToast("This memory is already attached.");
        return prev; // Prevent duplicates
      }

      if (Number.isFinite(attachedMemoryCountCap) && prev.length >= attachedMemoryCountCap) {
        showToast(
          resolvedPlan === "free"
            ? `Free plan limit reached (${attachedMemoryCountCap} attached memories).`
            : `Attach limit reached (${attachedMemoryCountCap} memories).`
        );
        return prev;
      }
      
      // Default to pinned=true when attaching on landing
      setLandingPinnedById(pinned => ({
        ...pinned,
        [memoryId]: true
      }));
      
      // Check if adding this memory would exceed capacity
      const newIds = [...prev, memoryId];
      estimateUsageRatioForMemoryIds(newIds).then(ratio => {
        if (ratio >= 1.0) {
          // Would exceed capacity - revert the add
          setLandingAttachedMemoryIds(prevIds => 
            prevIds.filter(id => id !== memoryId)
          );
          showToast("Brain full — detach a memory to add more.");
        }
      });
      
      return newIds;
    });
  }, [estimateUsageRatioForMemoryIds, showToast, attachedMemoryCountCap, resolvedPlan]);

  const detachMemoryFromLanding = useCallback((memoryId: number) => {
    setLandingAttachedMemoryIds((prev) => prev.filter((id) => id !== memoryId));
    // Also clear pinned state
    setLandingPinnedById(prev => {
      const newPinned = { ...prev };
      delete newPinned[memoryId];
      return newPinned;
    });
  }, []);

  const detachMemoryFromActiveSession = useCallback((memoryId: number) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    detachMemoryFromSession(sessionId, memoryId);
  }, [detachMemoryFromSession]);

  const clearAttachedMemoriesForActiveSession = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    
    // Get all attached memory IDs and detach them
    const attachedIds = getMemoryIds(sessionId);
    attachedIds.forEach(id => {
      detachMemoryFromSession(sessionId, id);
    });
  }, [getMemoryIds, detachMemoryFromSession]);

  // Clear landing attached memories
  const clearLandingAttachedMemories = useCallback(() => {
    setLandingAttachedMemoryIds([]);
  }, []);
  
  // Attach all memories from a folder to active session or landing
  const handleAttachFolder = useCallback(
    async (folderName: string) => {
      const folderMemories = memories.filter(m => m.folder_name === folderName);
      
      if (activeSessionId) {
        // Attach to active session
        const currentlyAttached = new Set(getMemoryIds(activeSessionId));
        
        // Filter out already attached memories
        const memoriesToAttach = folderMemories.filter(m => !currentlyAttached.has(m.id));
        
        if (memoriesToAttach.length === 0) {
          showToast("All memories from this folder are already attached.");
          return;
        }
        
        let attachedCount = 0;
        // Attach to active session
        for (const memory of memoriesToAttach) {
          try {
            await ensureMemoryInDbThenAttach(activeSessionId, memory.id);
            attachedCount++;
          } catch (error) {
            // Show error toast but continue trying others
            const message = error instanceof Error ? error.message : "Failed to attach memory";
            showToast(message);
          }
        }
        
        // Show success message only once
        if (attachedCount > 0) {
          showToast(`Attached ${attachedCount} memory${attachedCount > 1 ? 's' : ''} from "${folderName}".`);
        }
      } else {
        // Attach to landing
        setLandingAttachedMemoryIds(prev => {
          const newIds = new Set(prev);
          const newlyAttached: number[] = [];
          let limitReached = false;
          const hasFiniteCap = Number.isFinite(attachedMemoryCountCap);
          
          folderMemories.forEach(m => {
            if (hasFiniteCap && newIds.size >= attachedMemoryCountCap) {
              limitReached = true;
              return;
            }
            if (!newIds.has(m.id)) {
              newIds.add(m.id);
              newlyAttached.push(m.id);
            }
          });
          
          if (newlyAttached.length === 0) {
            showToast(
              limitReached
                ? (resolvedPlan === "free"
                    ? `Free plan limit reached (${attachedMemoryCountCap} attached memories).`
                    : `Attach limit reached (${attachedMemoryCountCap} memories).`)
                : "All memories from this folder are already attached."
            );
          } else {
            showToast(
              limitReached
                ? `Attached ${newlyAttached.length} memory${newlyAttached.length > 1 ? 's' : ''} from "${folderName}" (limit reached).`
                : `Attached ${newlyAttached.length} memory${newlyAttached.length > 1 ? 's' : ''} from "${folderName}".`
            );
          }
          
          return Array.from(newIds);
        });
      }
    },
    [
      memories,
      activeSessionId,
      ensureMemoryInDbThenAttach,
      getMemoryIds,
      showToast,
      attachedMemoryCountCap,
      resolvedPlan,
    ]
  );

  const attachAllMemoriesFromFolder = useCallback(async (folderName: string) => {
    // Get all memories in the folder
    const folderMemories = memories.filter(m => m.folder_name === folderName);
    
    if (activeSessionId) {
      // Get currently attached memories to avoid duplicates
      const currentlyAttached = new Set(getMemoryIds(activeSessionId));
      
      // Filter out already attached memories
      const memoriesToAttach = folderMemories.filter(m => !currentlyAttached.has(m.id));
      
      if (memoriesToAttach.length === 0) {
        showToast("All memories from this folder are already attached.");
        return;
      }
      
      let attachedCount = 0;
      // Attach to active session
      for (const memory of memoriesToAttach) {
        try {
          await ensureMemoryInDbThenAttach(activeSessionId, memory.id);
          attachedCount++;
        } catch (error) {
          // Show capacity feedback to user
          const message = error instanceof Error ? error.message : "Failed to attach memory";
          if (message.includes("Brain full") || message.includes("memory_count_exceeded") || message.includes("memory_budget_exceeded")) {
            showToast("Brain full — detach a memory to add more.");
            return; // Stop trying to attach more
          }
          console.error(`Failed to attach memory ${memory.id}:`, error);
        }
      }
      
      // Show success message only once
      if (attachedCount > 0) {
        showToast(`Attached ${attachedCount} memory${attachedCount > 1 ? 's' : ''} from "${folderName}".`);
      }
    } else {
      // Attach to landing
      setLandingAttachedMemoryIds(prev => {
        const newIds = new Set(prev);
        const newlyAttached: number[] = [];
        let limitReached = false;
        const hasFiniteCap = Number.isFinite(attachedMemoryCountCap);
        
        folderMemories.forEach(m => {
          if (hasFiniteCap && newIds.size >= attachedMemoryCountCap) {
            limitReached = true;
            return;
          }
          if (!newIds.has(m.id)) {
            newIds.add(m.id);
            newlyAttached.push(m.id);
          }
        });
        
        if (newlyAttached.length === 0) {
          showToast(
            limitReached
              ? (resolvedPlan === "free"
                  ? `Free plan limit reached (${attachedMemoryCountCap} attached memories).`
                  : `Attach limit reached (${attachedMemoryCountCap} memories).`)
              : "All memories from this folder are already attached."
          );
        } else {
          showToast(
            limitReached
              ? `Attached ${newlyAttached.length} memory${newlyAttached.length > 1 ? 's' : ''} from "${folderName}" (limit reached).`
              : `Attached ${newlyAttached.length} memory${newlyAttached.length > 1 ? 's' : ''} from "${folderName}".`
          );
        }
        
        return Array.from(newIds);
      });
    }
  }, [
    memories,
    activeSessionId,
    ensureMemoryInDbThenAttach,
    getMemoryIds,
    showToast,
    attachedMemoryCountCap,
    resolvedPlan,
  ]);

  // Compute attached memories for active session (from hook)
  const attachedMemoryIdsForActiveSession = activeSessionId
    ? getMemoryIds(activeSessionId)
    : [];

  const attachedMemoriesForActiveSession = useMemo(() => {
    // Build from enabled session attachments first so count/list stay in sync.
    const enabledAttachments = (activeSessionId ? getAttachments(activeSessionId) : []).filter(
      (att: SessionAttachment) => att.is_enabled === 1
    );

    const memoriesById = new Map<number, Memory>();
    for (const memory of memories) {
      memoriesById.set(memory.id, memory);
    }

    const globalCache =
      typeof window !== "undefined" && (window as any).__memoriesByIdRef
        ? ((window as any).__memoriesByIdRef as Map<number, Memory>)
        : null;

    return enabledAttachments.map((att: SessionAttachment) => {
      const resolved = globalCache?.get(att.memory_id) ?? memoriesById.get(att.memory_id);
      if (resolved) {
        return {
          ...resolved,
          id: att.memory_id,
          is_pinned: att.is_pinned,
        };
      }

      // Last-resort fallback from attachment payload keeps popup rows visible on initial restore.
      return {
        id: att.memory_id,
        folder_name: att.folder_name ?? "Unsorted",
        title: att.title ?? null,
        summary: att.summary ?? "",
        created_at: att.created_at ?? "",
        tags: null,
        importance: null,
        session_id: att.session_id,
        message_id: null,
        is_pinned: att.is_pinned,
      } as Memory & { is_pinned?: number };
    });
  }, [memories, activeSessionId, getAttachments]);

  // Get token-based usage for active session
  const activeSessionUsage = activeSessionId ? getUsage(activeSessionId) : null;
  const activeSessionUsageRatio = activeSessionUsage?.usageRatio ?? 0;
  
  // Unified memory usage ratio for all brain rings
  // - When session exists: use server truth from session
  // - When on landing: use exact same calculation as server on landing memories
  const memoryUsageRatio = activeSessionId ? activeSessionUsageRatio : landingMemoryBudget.ratio;
  
  // Get session lifetime token usage for navigator bar
  const activeSessionTotalTokens = activeSessionId ? sessionUsedTokens[activeSessionId] ?? 0 : 0;
  const activeSessionLifetimeRatio = sessionTokenLimit > 0 ? activeSessionTotalTokens / sessionTokenLimit : 0;
  
  const getSessionFocusState = useCallback((sessionId: number | null | undefined) => {
    if (!sessionId) {
      return { goal: "", enabled: false };
    }

    const sidebarSession = sidebarSessions.find((s) => s.id === sessionId);
    const typedSession = sessions.find((s: any) => s.id === sessionId) as any;

    const rawGoal =
      typeof sidebarSession?.focusGoal === "string"
        ? sidebarSession.focusGoal
        : typeof typedSession?.focusGoal === "string"
          ? typedSession.focusGoal
          : "";

    const goal = rawGoal.trim();
    const enabled = Boolean(sidebarSession?.focusEnabled ?? typedSession?.focusEnabled) && goal.length > 0;

    return { goal, enabled };
  }, [sidebarSessions, sessions]);

  const activeSessionFocusState = useMemo(
    () => getSessionFocusState(activeSessionId),
    [activeSessionId, getSessionFocusState]
  );

  const getFocusPayloadForSession = useCallback((sessionId: number | null | undefined) => {
    const focusState = getSessionFocusState(sessionId);
    return {
      focusEnabled: focusState.enabled,
      focusGoal: focusState.enabled ? focusState.goal : null,
      focusIntensity: "lockdown" as const,
    };
  }, [getSessionFocusState]);

  const syncSessionFocusState = useCallback((sessionId: number, focusGoal: string | null, focusEnabled: boolean) => {
    const normalizedGoal = typeof focusGoal === "string" && focusGoal.trim().length > 0 ? focusGoal.trim() : null;
    const normalizedEnabled = Boolean(focusEnabled) && Boolean(normalizedGoal);

    setSessions((prev) =>
      prev.map((s: any) =>
        s.id === sessionId
          ? { ...s, focusGoal: normalizedGoal, focusEnabled: normalizedEnabled }
          : s
      )
    );
    setSidebarSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, focusGoal: normalizedGoal, focusEnabled: normalizedEnabled }
          : s
      )
    );
  }, [setSessions, setSidebarSessions]);

  const patchSessionFocus = useCallback(async (payload: { focusGoal?: string | null; enabled?: boolean; clear?: boolean }) => {
    if (!activeSessionId) {
      throw new Error("Open a chat before setting focus.");
    }

    if (scope?.kind === "guest") {
      const current = getSessionFocusState(activeSessionId);
      const nextGoal = payload.clear
        ? null
        : payload.focusGoal !== undefined
          ? (payload.focusGoal?.trim() || null)
          : (current.goal || null);
      const requestedEnabled = payload.clear
        ? false
        : payload.enabled !== undefined
          ? payload.enabled
          : current.enabled;
      syncSessionFocusState(activeSessionId, nextGoal, Boolean(requestedEnabled));
      return;
    }

    const res = await fetch("/api/sessions/focus", {
      method: "PATCH",
      headers: scope ? getHeadersForScope(scope) : getAuthHeaders(),
      body: JSON.stringify({
        sessionId: activeSessionId,
        ...payload,
      }),
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to update focus.");
    }

    syncSessionFocusState(
      activeSessionId,
      typeof data?.focusGoal === "string" ? data.focusGoal : null,
      Boolean(data?.focusEnabled)
    );
  }, [activeSessionId, scope, getSessionFocusState, syncSessionFocusState]);

  const handleFocusSave = useCallback(async (focusGoal: string) => {
    await patchSessionFocus({ focusGoal });
  }, [patchSessionFocus]);

  const handleFocusToggle = useCallback(async (enabled: boolean) => {
    await patchSessionFocus({ enabled });
  }, [patchSessionFocus]);

  const handleFocusClear = useCallback(async () => {
    await patchSessionFocus({ clear: true });
  }, [patchSessionFocus]);

  // Unified toggle attach memory that works for both landing and session states
  const toggleAttachMemory = useCallback(async (memoryId: number) => {
    if (activeSessionId) {
      // Session state: attach/detach from session
      const isAttached = attachedMemoryIdsForActiveSession.includes(memoryId);
      if (isAttached) {
        detachMemoryFromActiveSession(memoryId);
      } else {
        try {
          await ensureMemoryInDbThenAttach(activeSessionId, memoryId);
        } catch (error) {
          // Show error toast (same as handleAttachMemory)
          const message = error instanceof Error ? error.message : "Failed to attach memory";
          console.error("[ATTACH ERROR]", message);
          showToast(message);
          throw error; // Re-throw so caller knows it failed
        }
      }
    } else {
      // Landing state: attach/detach from landing
      const isAttached = landingAttachedMemoryIds.includes(memoryId);
      if (isAttached) {
        detachMemoryFromLanding(memoryId);
      } else {
        attachMemoryToLanding(memoryId);
      }
    }
  }, [
    activeSessionId,
    attachedMemoryIdsForActiveSession,
    ensureMemoryInDbThenAttach,
    detachMemoryFromActiveSession,
    landingAttachedMemoryIds,
    attachMemoryToLanding,
    detachMemoryFromLanding,
    showToast,
  ]);

  // Wrapper for DnD hook that only takes memoryId (sessionId is captured from activeSessionId)
  const attachMemoryToActiveSession = useCallback(async (memoryId: number) => {
    if (activeSessionId) {
      try {
        await ensureMemoryInDbThenAttach(activeSessionId, memoryId);
      } catch (error) {
        // Show error toast for DnD attach failures
        const message = error instanceof Error ? error.message : "Failed to attach memory";
        showToast(message);
      }
    }
  }, [activeSessionId, ensureMemoryInDbThenAttach, showToast]);

  // Toggle pin state for landing memory (only when no active session)
  const toggleLandingPin = useCallback(async (memoryId: number) => {
    setLandingPinnedById(prev => {
      return {
        ...prev,
        [memoryId]: !prev[memoryId] // Default to true (pinned) when not set
      };
    });
  }, []);

  // Landing-only derived values for the injected-memories placeholder UI
  const landingAttachedMemories = useMemo(() => {
    // Try to get memories from the global cache first to avoid folder filtering issues
    const cachedMemories: Memory[] = [];
    
    // Check if we have access to the global cache through any means
    // If not, fall back to the filtered memories array
    if (typeof window !== 'undefined' && (window as any).__memoriesByIdRef) {
      // Use the cached map if available
      const cache = (window as any).__memoriesByIdRef as Map<number, Memory>;
      landingAttachedMemoryIds.forEach(id => {
        const memory = cache.get(id);
        if (memory) cachedMemories.push(memory);
      });
      return cachedMemories;
    }
    
    // Fallback to filtered memories (this is the current behavior)
    return memories.filter((m) => landingAttachedMemoryIds.includes(m.id));
  }, [memories, landingAttachedMemoryIds]);

  // Add pinned state to landing memories
  const landingAttachedMemoriesWithPin = useMemo(() => {
    return landingAttachedMemories.map(m => ({
      ...m,
      is_pinned: landingPinnedById[m.id] !== false // Default to true (pinned)
    }));
  }, [landingAttachedMemories, landingPinnedById]);

  const landingAttachedCount = landingAttachedMemoryIds.length;
  
  // Fade out landing content when sending first message or when composer is at bottom
  useEffect(() => {
    // If composer is already at bottom (due to memories), fade immediately
    const composerAtBottom = adjustedLandingLiftPx === 0;
    const currentPaddingBottom = adjustedLandingLiftPx + composerHeight - 5;
    
    // We only want to run the exit fade while the landing header is still mounted.
    // IMPORTANT: Don't re-arm exit just because messages.length > 0 after landing is gone.
    const shouldExit = (isLanding && isSending) || landingExitActive;

    // Fade out when: sending message OR composer at bottom with memories (while landing),
    // and keep header mounted through the fade-out window.
    if (shouldExit) {
      if (isLanding && !landingExitActive) setLandingExitActive(true);

      // Freeze paddingBottom when fade-out starts
      if (!landingFadeOut && frozenPaddingBottom === null) {
        setFrozenPaddingBottom(currentPaddingBottom);
      }
      // Freeze landingStage used for layout when fade-out starts, so we don't "reverse" the intro animation
      if (!landingFadeOut && frozenLandingStage === null) {
        setFrozenLandingStage(landingStage);
      }
      
      // Add delay before starting fade-out (200ms after sending starts)
      const delayMs = isSending ? (composerAtBottom ? 0 : 200) : 0;
      const timer = setTimeout(() => {
        setLandingFadeOut(true);
      }, delayMs);

      // After fade completes, allow unmount so layout can proceed normally.
      const done = setTimeout(() => {
        setLandingExitActive(false);
      }, delayMs + 700);
      
      return () => {
        clearTimeout(timer);
        clearTimeout(done);
      };
    } else if (isLanding && messages.length === 0) {
      // Reset fade-out when back on landing with no messages
      setLandingFadeOut(false);
      setFrozenPaddingBottom(null);
      setFrozenLandingStage(null);
      setLandingExitActive(false);
    }
  }, [
    isSending,
    messages.length,
    adjustedLandingLiftPx,
    isLanding,
    composerHeight,
    landingFadeOut,
    frozenPaddingBottom,
    frozenLandingStage,
    landingStage,
    landingExitActive,
  ]);

  // Note: Session attachments are now persisted in DB via useSessionAttachments hook
  // Landing attachments remain ephemeral (in-memory only)
  
  // Helper: Open blank memory draft (like Vault button draft flow)
  const openBlankMemoryDraft = useCallback((folderName?: string | null) => {
    // Find the folder ID for the selected folder
    const currentFolder = folderName 
      ? memoryFolders.find(f => f.name === folderName)
      : memoryFolders.find(f => f.name === selectedMemoryFolder);
    const folderId = currentFolder?.id ?? null;
    
    const draft = {
      title: "Untitled",
      summary: "",
      session_id: activeSessionIdRef.current ?? null,
      message_id: null,
      folder_id: folderId, // Add folder context
    };

    setDraftMemory(draft);
    setSelectedMemoryId(null);
    setForceEditMemoryId(null);
    setMemoryOverlayOpen(true);
  }, [setMemoryOverlayOpen, setSelectedMemoryId, selectedMemoryFolder, memoryFolders]);
  
  const prevActiveSessionIdRef = useRef<number | null>(null);
  // sessionKey and sessionUsedTokens now come from sessionsHook
  
  // MRU and folder persistence now in useChatSessions hook

  // Track window height for landing composer positioning
  useEffect(() => {
    const onResize = () => setWindowH(window.innerHeight || 0);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Update dev test refs (mirror state for deterministic async tests)
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);
  
  useEffect(() => {
    searchModeRef.current = searchMode;
  }, [searchMode]);
  
  useEffect(() => {
    scrollLockReasonRef.current = scrollLockReason;
  }, [scrollLockReason]);
  
  useEffect(() => {
    showScrollDownFabRef.current = showScrollDownFab;
  }, [showScrollDownFab]);

  // Detect session changes to trigger context bar scan
  useEffect(() => {
    if (activeSessionId !== prevActiveSessionIdRef.current) {
      setSessionKey(activeSessionId); // Trigger scan on session change
      prevActiveSessionIdRef.current = activeSessionId;
    }
  }, [activeSessionId]);

  // Memory handlers now in useChatMemories hook

  // Layout mode and panel state now handled by hooks (useLayoutMode, usePanels)

  // Handle panel state on mount: closed on landing/from hub, otherwise restore from localStorage
  useEffect(() => {
    // If coming from hub: do NOT force-close panels. We want to restore the user's last state.
    const fromHub = typeof window !== "undefined" && sessionStorage.getItem("fromHub") === "true";
    
    if (fromHub) {
      // Clear the fromHub flag after using it
      sessionStorage.removeItem("fromHub");
      return;
    }

    // Otherwise: state is already initialized from localStorage in usePanels.
    // No action needed here (prevents refresh from "forgetting" open panels).
  }, []); // Only run on mount

  // Deterministic pin-to-bottom for the active chat/search scroller (direct DOM scroll).
  // Used for session swap "settle" (late markdown/image/font growth), search enter, and FAB.
  const pinToBottomNow = useCallback((reason: string) => {
    const c = scrollContainerRef.current;
    if (!c) return;
    // Do not fight active reveal/stream.
    if (isSending || revealMessageIdRef.current !== null) return;

    const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
    c.scrollTop = maxScroll;
    isAtBottomRef.current = true;
    setShowScrollDownFab(false);
  }, [isSending, revealMessageIdRef]);

  const scheduleSettlePinToBottom = useCallback((reason: string) => {
    // A few additional pins to catch late height growth (markdown layout/images/fonts).
    requestAnimationFrame(() => pinToBottomNow(`${reason}:raf1`));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => pinToBottomNow(`${reason}:raf2`));
    });

    window.setTimeout(() => pinToBottomNow(`${reason}:t0`), 0);
    window.setTimeout(() => pinToBottomNow(`${reason}:t50`), 50);
    window.setTimeout(() => pinToBottomNow(`${reason}:t150`), 150);

    // Optional: observe size changes briefly after swap to re-pin.
    const c = scrollContainerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => pinToBottomNow(`${reason}:ro`));
    ro.observe(c);
    window.setTimeout(() => ro.disconnect(), 220);
  }, [pinToBottomNow]);
  const scheduleSettlePinToBottomRef = useRef(scheduleSettlePinToBottom);
  useEffect(() => {
    scheduleSettlePinToBottomRef.current = scheduleSettlePinToBottom;
  }, [scheduleSettlePinToBottom]);

  // Resize session refs
  const isResizingRef = useRef(false);
  const resizeEndTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resizeStartWasAtBottomRef = useRef(false);
  const resizeModeRef = useRef<"pinBottom" | "anchorCommit">("pinBottom");
  const anchorSnapshotRef = useRef<{ id: string | number; offset: number } | null>(null);
  const pendingPinRafRef = useRef(false);

  // Stay pinned to bottom on resize/layout change (two-lane policy)
  useEffect(() => {
    // Skip if there's an active reveal or send
    if (revealMessageIdRef.current !== null || isSending) return;

    let widthResizeObserver: ResizeObserver | null = null;

    const handleResize = () => {
      // If not already resizing, start a new resize session
      if (!isResizingRef.current) {
        isResizingRef.current = true;
        
        // Determine resize mode based on initial position
        const wasAtBottom = distToBottomRef.current <= 24;
        resizeStartWasAtBottomRef.current = wasAtBottom;
        
        if (wasAtBottom) {
          // Lane 1: Bottom-pinned live follow
          resizeModeRef.current = "pinBottom";
          anchorSnapshotRef.current = null;
        } else {
          // Lane 2: Debounced anchor commit
          resizeModeRef.current = "anchorCommit";
          
          // Snapshot anchor once
          const container = scrollContainerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const middleY = containerRect.top + containerRect.height / 2;
            
            const messageElements = container.querySelectorAll('[data-message-id]');
            for (const el of messageElements) {
              const rect = el.getBoundingClientRect();
              if (rect.top <= middleY && rect.bottom >= middleY) {
                const anchorId = (el as HTMLElement).dataset.messageId;
                if (anchorId) {
                  anchorSnapshotRef.current = {
                    id: anchorId,
                    offset: rect.top - containerRect.top
                  };
                  break;
                }
              }
            }
          }
        }
      }

      // During resize behavior
      if (resizeModeRef.current === "pinBottom") {
        // Lane 1: Live pin to bottom (RAF-throttled)
        if (!pendingPinRafRef.current) {
          pendingPinRafRef.current = true;
          requestAnimationFrame(() => {
            pinToBottomNow("resize-live");
            pendingPinRafRef.current = false;
          });
        }
      }
      // Lane 2: Do nothing during resize

      // Clear existing timer
      if (resizeEndTimerRef.current) {
        clearTimeout(resizeEndTimerRef.current);
      }

      // Set timer for resize end
      resizeEndTimerRef.current = setTimeout(() => {
        // Resize ended
        isResizingRef.current = false;
        resizeEndTimerRef.current = null;
        pendingPinRafRef.current = false;

        // Resize end behavior
        if (resizeModeRef.current === "pinBottom") {
          // Lane 1: Final settle pin
          scheduleSettlePinToBottom("resize-end");
        } else {
          // Lane 2: Single anchor correction
          const snapshot = anchorSnapshotRef.current;
          if (snapshot) {
            const container = scrollContainerRef.current;
            if (container) {
              const anchorElement = container.querySelector(`[data-message-id="${snapshot.id}"]`);
              if (anchorElement) {
                const newAnchorRect = anchorElement.getBoundingClientRect();
                const newContainerRect = container.getBoundingClientRect();
                const newOffset = newAnchorRect.top - newContainerRect.top;
                
                // Single scroll adjustment
                const scrollTopAdjustment = newOffset - snapshot.offset;
                container.scrollTop += scrollTopAdjustment;
              }
            }
          }
        }
        
        // Clear snapshot
        anchorSnapshotRef.current = null;
      }, 150); // 150ms debounce
    };

    // Add resize listener
    window.addEventListener('resize', handleResize);

    // Mirror manual window-resize behavior for panel-driven chat width changes.
    // We only react to width deltas so height/content growth does not enter this lane.
    const observedContainer = scrollContainerRef.current;
    if (observedContainer && typeof ResizeObserver !== "undefined") {
      let lastObservedWidth = observedContainer.clientWidth;
      widthResizeObserver = new ResizeObserver(() => {
        const current = scrollContainerRef.current;
        if (!current) return;
        const nextWidth = current.clientWidth;
        if (Math.abs(nextWidth - lastObservedWidth) < 0.5) return;
        lastObservedWidth = nextWidth;
        handleResize();
      });
      widthResizeObserver.observe(observedContainer);
    }
    
    // Also trigger on layout mode change (treated like a resize)
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (widthResizeObserver) {
        widthResizeObserver.disconnect();
      }
      if (resizeEndTimerRef.current) {
        clearTimeout(resizeEndTimerRef.current);
      }
    };
  }, [windowWidth, layoutMode, isSending, scheduleSettlePinToBottom, pinToBottomNow]);

  // Pre-paint snap to bottom on chat-switch commit to avoid 1-frame top-flash.
  useLayoutEffect(() => {
    if (!pendingCommitScrollToBottomRef.current) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    // If a reveal is active, don't fight it.
    if (revealMessageIdRef.current !== null) {
      pendingCommitScrollToBottomRef.current = false;
      return;
    }

    // Force scrollTop to bottom synchronously (before paint).
    // IMPORTANT: do this for both chat AND search (same scroll container).
    programmaticScrollRef.current = true;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = maxScroll;
    isAtBottomRef.current = true;
    setShowScrollDownFab(false);
    // Catch late height growth so we end at the true bottom (long assistant messages, markdown, images).
    scheduleSettlePinToBottom("session-commit");

    // Clear flag and release programmatic marker next frame.
    pendingCommitScrollToBottomRef.current = false;
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [messages.length, activeSessionId, searchMode]);


  // Cleanup: search mode cleanup now handled in useChatSearch hook

  // Compute hour pill lane based on available side gap
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const CONTENT_MAX_WIDTH = 896; // max-w-4xl
    const MIN_SIDE_GAP = 120;      // tune: bigger = snaps to center sooner
    const EDGE_PAD = 16;           // distance from right edge

    const compute = () => {
      // Hour pills always center - removed side positioning logic
      // Scroll logic preserved, positioning always center
    };

    compute();

    const ro = new ResizeObserver(() => requestAnimationFrame(compute));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track active hour using deterministic scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || hourBuckets.length === 0) return;

    // Initialize to last bucket if none set
    if (activeHourKey === null && hourBuckets.length > 0) {
      setActiveHourKey(hourBuckets[hourBuckets.length - 1].hourKey);
    }

    const ACTIVATION_LINE_PX = 56;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;

        const scrollTop = container.scrollTop;
        const targetY = scrollTop + ACTIVATION_LINE_PX;

        let nextActive: string | null = null;

        for (const bucket of hourBuckets) {
          const el = hourBucketRefs.current[bucket.hourKey];
          if (!el) continue;

          const offsetTop = el.offsetTop;
          if (offsetTop <= targetY) {
            nextActive = bucket.hourKey;
          } else {
            break;
          }
        }

        if (nextActive && nextActive !== activeHourKey) {
          setActiveHourKey(nextActive);
        }
      });
    };

    container.addEventListener("scroll", onScroll);
    
    // Initial update
    onScroll();
    
    return () => container.removeEventListener("scroll", onScroll);
  }, [hourBuckets, activeHourKey]);

  // Handle ESC key and click outside for timeline popup
  useEffect(() => {
    if (!isTimelineOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsTimelineOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      // If we explicitly marked the next outside click to be ignored (e.g. click inside popup)
      if (ignoreOutsideClickRef.current) {
        ignoreOutsideClickRef.current = false;
        return;
      }

      const target = e.target as HTMLElement | null;

      // If the click is on the timeline toggle button (clock), do not treat it as outside.
      // (Keep the original selector, but broaden it slightly to be resilient.)
      if (target?.closest('[aria-label="Open timeline"], [aria-label*="timeline" i], [data-timeline-toggle="true"]')) {
        return;
      }

      // If click is inside the popup, do nothing.
      if (timelinePopupRef.current && target && timelinePopupRef.current.contains(target)) {
        return;
      }

      setIsTimelineOpen(false);
    };

    document.addEventListener("keydown", handleEsc);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTimelineOpen]);

  // Normalize copied user-message selections even when drag starts outside the text node.
  // This catches cases where browsers include leading blank lines from block/padding anchors.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const anchorEl =
        sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const focusEl =
        sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement;

      const inUserText =
        !!anchorEl?.closest?.('[data-user-message-text="true"]') ||
        !!focusEl?.closest?.('[data-user-message-text="true"]');

      if (!inUserText) return;

      const raw = sel.toString();
      if (!raw) return;
      const normalized = /^\s*\r?\n/.test(raw) ? raw.replace(/^\s+/, "") : raw;

      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", normalized);
        e.preventDefault();
      }
    };

    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);

  // When switching chats or when messages load, always scroll to latest message
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !activeSessionId) return;

    if (messages.length === 0) return;

    // If we're sending, don't run the generic snap — reveal/sending pinning handles it.
    // This prevents competing snaps right when the assistant block mounts.
    if (isSending) return;

    // If we already snapped pre-paint on commit, don't do the late snap (prevents jitter).
    if (pendingCommitScrollToBottomRef.current) return;

    // Early return if a reveal is active (prevent fighting reveal)
    if (revealMessageIdRef.current !== null) {
      return;
    }

    // Wait for layout (sticky headers, padding, composer) to settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestScroll({ type: "toBottom", reason: "reveal" });
        isAtBottomRef.current = true;
      });
    });
  }, [activeSessionId, messages.length]);


  // Load mode when session or sessions change
  // Only sync mode from session if there's an active session
  // On landing (activeSessionId === null), mode state is user-controlled
  useEffect(() => {
    if (activeSessionId && sessions.length > 0) {
      const session = sessions.find((s) => s.id === activeSessionId);
      if (session) {
        setMode((session.mode as DartzModeId) || "tactical");
      }
    }
  }, [activeSessionId, sessions]);

  // Real token-based context calculation
  const computeContextTokens = useMemo(() => {
    // 1. System message tokens (kernel + mode directives + user profile estimate + memory context estimate)
    // LYNX_KERNEL is approximately 1500-2000 tokens
    const kernelTokens = 1750;
    const modeSpec = getModeSpec(mode);
    const modeDirectivesTokens = estimateTokens(modeSpec.systemDirectives);
    
    // Estimate user profile tokens (~500-800 tokens typical)
    const userProfileEstimateTokens = 600;
    
    // Estimate memory context tokens (if memory folder selected, estimate ~200-500 tokens)
    // Note: We don't have access to actual memory content here, so we estimate conservatively
    const memoryContextEstimateTokens = 0; // Could be enhanced if memory folder info is available
    
    const systemMessageTokens = kernelTokens + modeDirectivesTokens + userProfileEstimateTokens + memoryContextEstimateTokens;
    
    // 2. Message history tokens
    const historyMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    const historyTokens = estimateTokensForMessages(historyMessages);
    
    // 3. Current input tokens (if user is typing)
    const currentInputTokens = estimateTokens(input);
    
    // Total = system + history + current input
    const totalTokens = systemMessageTokens + historyTokens + currentInputTokens;
    
    return {
      systemTokens: systemMessageTokens,
      historyTokens,
      inputTokens: currentInputTokens,
      totalTokens,
    };
  }, [messages, mode, input]);

  // Use Option A context window pressure metrics if available, fallback to computed estimate
  const activeContextMetrics =
    activeSessionId != null ? contextMetricsBySessionId[activeSessionId] : null;

  const hasServerMetrics = !!activeContextMetrics;

  // Use local estimate when server metrics don't exist yet
  const estimatedTokens =
    hasLoadedMessagesForActiveSession || input.trim().length > 0
      ? computeContextTokens.totalTokens
      : null;

  // Canonical → fallback → unknown
  const contextUsedTokens: number | null =
    hasServerMetrics
      ? activeContextMetrics!.current_tokens
      : estimatedTokens;

  const contextLimitTokens =
    activeContextMetrics?.max_tokens ?? CONTEXT_LIMIT_TOKENS;

  const contextIsEstimated = !hasServerMetrics && contextUsedTokens !== null;

  // Session-based composer fullness UX (90% warning, 100% full)
  const sessionFullnessRatio = activeSessionLifetimeRatio;
  const isSessionWarning = sessionFullnessRatio >= 0.90 && sessionFullnessRatio < 1.0;
  
  // Tri-state for composer full state to avoid animation jank
  const [chatFullState, setChatFullState] = useState<"unknown" | "normal" | "full">("unknown");
  
  // Update chat full state when session tokens are calculated
  useEffect(() => {
    if (sessionFullnessRatio === 0) {
      // Still calculating - keep as unknown
      return;
    }
    
    if (sessionFullnessRatio >= 1.0) {
      setChatFullState("full");
    } else {
      setChatFullState("normal");
    }
  }, [sessionFullnessRatio]);

  // Re-scroll to bottom after composer state stabilizes (fixes layout shift)
  useLayoutEffect(() => {
    if (chatFullState !== "unknown" && messages.length > 0) {
      // Composer state has stabilized, ensure we're at true bottom
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          const currentScroll = container.scrollTop;
          const distToBottom = Math.max(0, maxScroll - currentScroll);
          
          // If we're within epsilon tolerance, force scroll to exact bottom
          if (distToBottom <= BOTTOM_EPSILON) {
            container.scrollTop = maxScroll;
          }
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [chatFullState, messages.length]);

  // ResizeObserver to handle late message height changes (images, code blocks, fonts)
  useEffect(() => {
    if (!scrollContainerRef.current || messages.length === 0) return;

    const container = scrollContainerRef.current;
    let resizeObserver: ResizeObserver;

    // Only observe if ResizeObserver is available
    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { target } = entry;
          
          // Check if we're at or near the bottom
          const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
          const currentScroll = target.scrollTop;
          const distToBottom = Math.max(0, maxScroll - currentScroll);
          
          // Only auto-correct if user is already at bottom (within epsilon)
          if (distToBottom <= BOTTOM_EPSILON) {
            // Use requestAnimationFrame to ensure layout has updated
            requestAnimationFrame(() => {
              if (target === scrollContainerRef.current) {
                target.scrollTop = maxScroll;
              }
            });
          }
        }
      });

      // Observe the scroll container
      resizeObserver.observe(container);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [messages.length]); // Re-create when messages change

  const contextWarningThreshold = (contextLimitTokens || CONTEXT_LIMIT_TOKENS) * 0.85;
  const isContextNearLimit = typeof contextUsedTokens === "number" && contextUsedTokens > contextWarningThreshold;

  // loadSessions now in useChatSessions hook

  // Normalize DB created_at into a stable ISO string
  const parseMessageMeta = (rawMeta: unknown): ChatMessage["meta"] => {
    if (!rawMeta) return null;
    try {
      const parsed = typeof rawMeta === "string" ? JSON.parse(rawMeta) : rawMeta;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as ChatMessage["meta"];
    } catch {
      return null;
    }
  };

  const parseMessageImageUrls = (rawImagePaths: unknown): string[] => {
    if (!rawImagePaths) return [];
    try {
      const parsed =
        typeof rawImagePaths === "string"
          ? JSON.parse(rawImagePaths)
          : rawImagePaths;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    } catch {
      return [];
    }
  };

  // Fetch messages without state changes (pure function)
  const fetchMessages = async (sessionId: number): Promise<ChatMessage[]> => {
    if (scope?.kind === "guest") {
      const previewMessages = getGuestPreviewMessagesForSession(sessionId);
      if (previewMessages.length > 0) {
        return previewMessages;
      }
    }

    try {
      const headers = scope ? getHeadersForScope(scope) : getAuthHeaders();
      const response = await fetch(`/api/messages?session_id=${sessionId}`, { 
        headers 
      });
      const data = await response.json();
    // Map DB messages to ChatMessage format
    const chatMessages: ChatMessage[] = data
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        image_urls: parseMessageImageUrls(m.image_paths),
        created_at: normalizeCreatedAt(m.created_at),
        session_id: m.session_id || null,
        message_id: m.id || null, // message_id is the message's own id
        meta: parseMessageMeta(m.meta),
      }));
      return chatMessages;
    } catch (error) {
      console.error("Error fetching messages:", error);
      return [];
    }
  };

  // Chat switch effects (fade-out → swap while invisible → fade-in), now extracted.
  // Important: this must run AFTER `activeSessionId`, `memoryOverlayOpen`, `pendingSessionSwitchRef`,
  // and `fetchMessages` exist (avoids TDZ runtime errors).
  useChatAnimationsEffects({
    activeSessionId,
    fetchMessages,
    setMessages: setMessagesAndMarkLoaded,
    resetRevealState,
    memoryOverlayOpen,
    activeSessionIdRef,
    pendingSessionSwitchRef,
    animations: chatAnimations,
    scopeKind: scope?.kind,
    fastInitialRestore: isArchiveReturnBootRef.current === true,
  });

  // Thin wrapper for backward compatibility (sets state)
  const loadMessages = async (sessionId: number) => {
    const chatMessages = await fetchMessages(sessionId);
    setMessagesAndMarkLoaded(chatMessages);
    // Clear reveal state on load completion
    resetRevealState();
  };

  // Session switching is handled by useChatAnimationsEffects for both user and guest.
  // (A separate guest loadMessages effect was removed - it caused double-fetch and flash
  // by calling setMessages directly, bypassing the fade-out/swap/fade-in animation.)

  const createNewSession = async () => {
    try {
      skipNextSessionFetchRef.current = true;
      await handleCreateSessionFromHook(mode);
      const found = sessions.find((s: Session) => s.id === activeSessionId);
      setMode((found?.mode as DartzModeId) ?? "tactical");
      setMessages([]);
    } catch (err) {
      console.error("[chat] createNewSession error", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error creating chat session: " + String(err),
        },
      ]);
    }
  };

  const updateSessionMode = async (newMode: DartzModeId) => {
    if (!activeSessionId) {
      console.warn("Cannot update mode: no active session");
      return;
    }

    // Guest preview sessions are local-only: never write mode to server.
    if (scope?.kind === "guest") {
      setSessions((prev) =>
        prev.map((s: any) =>
          s.id === activeSessionId ? { ...s, mode: newMode } : s
        )
      );
      return;
    }

    try {
      await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeSessionId,
          mode: newMode,
        }),
      });
      // Reload sessions to get updated mode
      await loadSessions();
    } catch (error) {
      console.error("Error updating session mode:", error);
    }
  };

  const handleModeChange = (newMode: DartzModeId) => {
    setMode(newMode);
    // Only update session mode if there's an active session
    // On landing (no activeSessionId), mode state is the source of truth
    if (activeSessionId) {
      updateSessionMode(newMode);
    }
  };

  // Search mode handlers now in useChatSearch hook

  // Helper: force scroll to bottom (used for mode transitions and FAB)
  const forceScrollToBottom = useCallback(() => {
    // Skip if actively sending or revealing (don't fight streaming/reveal)
    if (isSending || revealMessageIdRef.current !== null) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestScroll({ type: "toBottom", reason: "reveal" });
        isAtBottomRef.current = true;
        setShowScrollDownFab(false);
      });
    });
  }, [isSending, requestScroll, revealMessageIdRef]);

  // Helpers: enter/exit search mode with explicit pin to bottom
  const enterSearchAndPin = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchDraft(query);
    setSearchMode(true);
    // Pin after the projected list mounts + settles.
    scheduleSettlePinToBottom("enter-search");
  }, [setSearchMode, setSearchQuery, setSearchDraft, scheduleSettlePinToBottom]);

  const exitSearchToChatAndPin = useCallback(() => {
    setSearchMode(false);
    setSearchDraft("");
    setSearchQuery("");
    // Pin to bottom after state updates
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        forceScrollToBottom();
      });
    });
  }, [setSearchMode, setSearchDraft, setSearchQuery, forceScrollToBottom]);

  // Entering search mode should start at bottom of filtered list (one-shot on enter, not continuous).
  const prevSearchModeRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevSearchModeRef.current;
    prevSearchModeRef.current = searchMode;
    if (prev || !searchMode) return; // only on false -> true
    scheduleSettlePinToBottom("enter-search");
  }, [searchMode]);

  // Hide FAB when memory overlay opens
  useEffect(() => {
    if (memoryOverlayOpen) {
      setShowScrollDownFab(false);
    }
  }, [memoryOverlayOpen]);

  // Closing memory overlay should return to chat/search at bottom (memory overlay itself stays top-on-open).
  const prevMemoryOverlayOpenRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevMemoryOverlayOpenRef.current;
    prevMemoryOverlayOpenRef.current = memoryOverlayOpen;
    if (!prev || memoryOverlayOpen) return; // only on true -> false
    if (revealMessageIdRef.current !== null) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const c = scrollContainerRef.current;
        if (!c) return;
        const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
        c.scrollTop = maxScroll;
        isAtBottomRef.current = true;
        setShowScrollDownFab(false);
      });
    });
  }, [memoryOverlayOpen]);

  // --- Scroll Down FAB handler (works in both message and search modes) ---
  const handleScrollDownFab = () => {
    const c = scrollContainerRef.current;
    if (!c) return;

    // Pure "scroll this view to bottom" (works even if useChatScroll is locked, e.g. "search")
    userStoppedFollowRef.current = false;
    isFollowingRevealRef.current = true;
    autoFollowLatchRef.current = true;
    userScrolledAwayDuringStreamRef.current = false;

    const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight);
    c.scrollTo({ top: maxScroll, behavior: "auto" });
    isAtBottomRef.current = true;
    setShowScrollDownFab(false);
    // Catch any late height growth (long assistant markdown/images) so FAB lands at true bottom.
    scheduleSettlePinToBottom("fab");
  };

  // Sidebar handlers - wrap hook handlers with animation/memory overlay logic
  const handleSelectSession = useCallback(async (id: number) => {
    // If we're on landing, hide it immediately so it can't flash behind the memory close
    // (or while waiting for the target chat to load).
    if (isLandingRef.current) {
      setSuppressLanding(true);
      setIsChatEntering(true);
      setEnterOpacity(0);
    }

    // If a memory is open, pre-hide the chat stream before closing the overlay
    // to prevent a 1-frame flash of the previous chat.
    if (memoryOverlayOpenRef.current) {
      setIsChatEntering(true);
      setEnterOpacity(0);
    }

    // Selecting a chat should always exit the memory view (chat is the primary context).
    setMemoryOverlayOpen(false);
    setSelectedMemoryId(null);
    setDraftMemory(null);

    // Track whether this close is coupled to a real session change.
    pendingSessionSwitchRef.current = activeSessionIdRef.current !== id;

    // Check if leaving a pristine (unused) session - auto-delete it
    const leavingId = pristineSessionIdRef.current;
    const currentActive = activeSessionIdRef.current;

    if (leavingId !== null && leavingId === currentActive && id !== leavingId) {
      try {
        const msgRes = await fetch(`/api/messages?session_id=${leavingId}`);
        const msgs = await msgRes.json();
        if (Array.isArray(msgs) && msgs.length === 0) {
          await fetch("/api/sessions", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: leavingId, is_deleted: 1 }),
          });
          setSessions((prev) => prev.filter((s) => s.id !== leavingId));
          setSidebarSessions((prev) => prev.filter((s) => s.id !== leavingId));
        }
      } catch (err) {
        console.error("[PRISTINE] auto-delete check failed", err);
      }
      pristineSessionIdRef.current = null;
    }

    // Call hook's handler (handles setActiveSessionId, updateLastOpened, token fetch)
    await handleSelectSessionFromHook(id);

    // Clear composer input when switching chats
    setInput("");
    inputPreserveRef.current = "";

    // Search is ephemeral across session switches:
    // always return to message mode, clear search, clear any search scroll lock, and pin to bottom.
    setSearchMode(false);
    setSearchDraft("");
    setSearchQuery("");
    setScrollLockReason(null);
    scheduleSettlePinToBottom("session-switch");
    
    // Close sidebar overlay on mobile when session is selected
    closeOverlays();
    // Note: scroll pinning handled by existing message-load / pendingCommitScrollToBottom logic
  }, [handleSelectSessionFromHook, setSuppressLanding, setIsChatEntering, setEnterOpacity, setMemoryOverlayOpen, setSelectedMemoryId, setSessions, setSidebarSessions, closeOverlays, setSearchMode, setSearchDraft, setSearchQuery, setScrollLockReason, scheduleSettlePinToBottom]);

  // Use hook handlers directly (they handle state updates)
  const handleRenameSession = handleRenameSessionFromHook;

  const handleDeleteSession = useCallback(async (id: number) => {
    await handleDeleteSessionFromHook(id);
    if (activeSessionIdRef.current === id) {
      setActiveSessionIdTraced(null, "handleDeleteSession");
      // Clear landing attached memories when deleting a chat and returning to landing
      clearLandingAttachedMemories();
    }
  }, [handleDeleteSessionFromHook, setActiveSessionIdTraced, clearLandingAttachedMemories]);

  const handleFolderSelect = useCallback((folderId: number | null) => {
    setSelectedFolderId(folderId);
    // Clear any pending new chat folder when user manually switches folders
    setPendingNewChatFolderId(null);
  }, [setSelectedFolderId]);

  const handleMoveSessionToFolder = useCallback(async (sessionId: number, folderId: number | null) => {
    const previous = sidebarSessionsRef.current.find((s) => s.id === sessionId);
    const prevFolderId = previous?.inFolderId ?? null;
    const prevFolderOrderTs = previous?.folderOrderTs ?? null;
    const nextFolderOrderTs = folderId == null ? null : Date.now();

    // Optimistic local update so source list removes immediately during drag-move.
    setSidebarSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, inFolderId: folderId ?? null, folderOrderTs: nextFolderOrderTs }
          : s
      )
    );
    setSessions((prev) =>
      prev.map((s: any) =>
        s.id === sessionId
          ? { ...s, inFolderId: folderId ?? null, folderOrderTs: nextFolderOrderTs }
          : s
      )
    );

    // Guest preview sessions are local-only.
    if (scope?.kind === "guest") {
      return;
    }

    try {
      const response = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          in_folder_id: folderId,
          folder_order_ts: nextFolderOrderTs,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update session folder (HTTP ${response.status})`);
      }
    } catch (err) {
      console.error("Failed to update session folder:", err);
      // Roll back optimistic move on failure.
      setSidebarSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, inFolderId: prevFolderId, folderOrderTs: prevFolderOrderTs }
            : s
        )
      );
      setSessions((prev) =>
        prev.map((s: any) =>
          s.id === sessionId
            ? { ...s, inFolderId: prevFolderId, folderOrderTs: prevFolderOrderTs }
            : s
        )
      );
    }
  }, [setSessions, setSidebarSessions, sidebarSessionsRef, scope?.kind]);

  const handleReorderFolderSessions = useCallback((
    folderId: number | null,
    orderedIds: number[]
  ) => {
    if (folderId == null || orderedIds.length === 0) return;

    // Recompute a descending order key so manual drag order persists inside custom folders.
    const baseTs = Date.now() + orderedIds.length;
    const orderMap = new Map<number, number>(
      orderedIds.map((id, idx) => [id, baseTs - idx])
    );

    setSidebarSessions((prev) => {
      return prev.map((s) =>
        s.inFolderId === folderId && orderMap.has(s.id)
          ? { ...s, folderOrderTs: orderMap.get(s.id)! }
          : s
      );
    });
    setSessions((prev) =>
      prev.map((s: any) =>
        s.inFolderId === folderId && orderMap.has(s.id)
          ? { ...s, folderOrderTs: orderMap.get(s.id)! }
          : s
      )
    );

    // Guest preview sessions are local-only.
    if (scope?.kind === "guest") {
      return;
    }

    // Persist in background; recover from server if any write fails.
    void (async () => {
      try {
        const responses = await Promise.all(
          orderedIds.map((id, idx) =>
            fetch("/api/sessions", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                folder_order_ts: baseTs - idx,
              }),
            })
          )
        );
        if (responses.some((res) => !res.ok)) {
          throw new Error("One or more folder reorder writes failed");
        }
      } catch (error) {
        console.error("Failed to persist folder session reorder:", error);
        void loadSessions();
      }
    })();
  }, [loadSessions, setSessions, setSidebarSessions, scope?.kind]);

  const leftFolderListRef = useRef<HTMLDivElement | null>(null);
  const rightFolderListRef = useRef<HTMLDivElement | null>(null);

  // DnD hook - all drag and drop logic extracted
  const {
    sensors,
    collisionDetection,
    modifiers,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    currentOverId,
    currentInsert,
    dragOverlayMemoryId,
    memoryNodeMapRef,
  } = useChatDnd({
    activeSessionIdRef,
    activeDragId,
    setActiveDragId,
    setDragOverlaySessionId,
    memoryOverlayOpen,
    folders,
    sidebarSessions: sidebarSessions.map(s => ({ id: s.id, inFolderId: s.inFolderId ?? null })),
    selectedFolderId,
    memoryFolders,
    memories,
    selectedMemoryFolder,
    setFolders: setFoldersWithGuestPersist,
    setSelectedFolderId,
    setActiveSessionIdTraced,
    handleChatFolderReorder,
    handleFolderReorder,
    handleMoveSessionToFolder,
    handleReorderFolderSessions,
    handleMemoryReorder,
    handleMoveMemoryToFolder,
    attachMemoryToActiveSession,
    attachMemoryToLanding,
    leftFolderListRef,
    rightFolderListRef,
  });

  // Expose memoryNodeMapRef globally so memory rows can register their nodes
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__memoryNodeMapRef = memoryNodeMapRef;
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__memoryNodeMapRef;
      }
    };
  }, [memoryNodeMapRef]);

  const handleCreateFolder = useCallback(async () => {
    if (scope?.kind === "guest") {
      const base = getGuestFoldersFromStorage();
      const newId = base.length ? Math.max(...base.map((f) => f.id)) + 1 : 1;
      const newFolder = { id: newId, name: "New Folder", icon: undefined as string | undefined };
      const updatedFolders = [...base, newFolder];
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:folders", JSON.stringify(updatedFolders));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setFolders(updatedFolders);
      return;
    }
    
    // For signed-in users, create folder in DB first
    let newFolder;
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: "New Folder" })
      });
      newFolder = await response.json();
    } catch (err) {
      console.error("Failed to create folder:", err);
      return;
    }
    
    // Add to local state
    setFolders((prev) => [
      ...prev,
      {
        id: newFolder.id,
        name: "New Folder",
        icon: newFolder.icon || undefined,
      },
    ]);
  }, [scope, getGuestFoldersFromStorage]);

  const handleRenameFolder = async (id: number, newName: string) => {
    // Clear start rename trigger after rename completes
    if (startRenameFolderId === id) {
      setStartRenameFolderId(null)
    }
    
    if (scope?.kind === "guest") {
      const base = getGuestFoldersFromStorage();
      const updated = base.map((f) => (f.id === id ? { ...f, name: newName } : f));
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:folders", JSON.stringify(updated));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setFolders(updated);
      return;
    }
    
    // For signed-in users, update in DB first
    try {
      await fetch("/api/folders", {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ id, name: newName })
      });
    } catch (err) {
      console.error("Failed to rename folder:", err);
      return;
    }
    
    // Update local state
    setFolders((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, name: newName } : f));
      return updated;
    });
  };

  const handleSetFolderIcon = async (id: number, icon: string | null) => {
    if (scope?.kind === "guest") {
      const base = getGuestFoldersFromStorage();
      const updated = base.map((f) => (f.id === id ? { ...f, icon: icon || undefined } : f));
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:folders", JSON.stringify(updated));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setFolders(updated);
      return;
    }
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ id, icon })
      });
      const resText = await res.clone().text();
      if (!res.ok) {
        console.error("Failed to update folder icon:", res.status, resText);
        return;
      }
    } catch (err) {
      console.error("Failed to update folder icon:", err);
      return;
    }
    setFolders((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, icon: icon || undefined } : f));
      return updated;
    });
  };

  const handleSetMemoryFolderIcon = async (id: number, icon: string | null) => {
    if (scope?.kind === "guest") {
      const base = getGuestMemoryFoldersFromStorage();
      const updated = base.map((f) => (f.id === id ? { ...f, icon: icon ?? undefined } : f));
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:memoryFolders", JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
      setMemoryFolders(updated);
      return;
    }

    // User: PATCH /api/memory/folders then update state
    try {
      const response = await fetch("/api/memory/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ folder_id: id, icon })
      });
      if (!response.ok) {
        const body = await response.text();
        console.error("Failed to update memory folder icon:", response.status, body);
        return;
      }
      setMemoryFolders((prev) => {
        const updated = prev.map((f) => (f.id === id ? { ...f, icon: icon || undefined } : f));
        return updated;
      });
    } catch (err) {
      console.error("[handleSetMemoryFolderIcon] catch", err);
      return;
    }
  };

  const handleDeleteFolder = async (id: number) => {
    if (scope?.kind === "guest") {
      const base = getGuestFoldersFromStorage();
      const nextFolders = base.filter((f) => f.id !== id);
      const nextSidebarSessions = sidebarSessions.map((s) => 
        s.inFolderId === id ? { ...s, inFolderId: null, folderOrderTs: null } : s
      );
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("db:folders", JSON.stringify(nextFolders));
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setSidebarSessions(nextSidebarSessions);
      setFolders(nextFolders);
      if (selectedFolderId === id) {
        setSelectedFolderId(null);
      }
      return;
    }
    
    addPendingDeletedChatFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSidebarSessions((prev) => prev.map((s) => (s.inFolderId === id ? { ...s, inFolderId: null, folderOrderTs: null } : s)));
    if (selectedFolderId === id) {
      setSelectedFolderId(null);
    }
    try {
      const res = await fetch(`/api/folders?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        removePendingDeletedChatFolder(id);
        await loadFoldersFromDB();
        return;
      }
    } catch (err) {
      removePendingDeletedChatFolder(id);
      await loadFoldersFromDB();
      return;
    }
    await loadSessions();
  };

  const handleDeleteFolderAndChats = async (id: number) => {
    const idsInFolder = sidebarSessions.filter((s) => s.inFolderId === id).map((s) => s.id);
    addPendingDeletedChatFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSidebarSessions((prev) => prev.filter((s) => s.inFolderId !== id));
    setSessions((prev) => prev.filter((s) => !idsInFolder.includes(s.id)));
    if (selectedFolderId === id) {
      setSelectedFolderId(null);
    }
    try {
      const resFolder = await fetch(`/api/folders?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!resFolder.ok) {
        removePendingDeletedChatFolder(id);
        await loadFoldersFromDB();
        await loadSessions();
        return;
      }
    } catch (err) {
      removePendingDeletedChatFolder(id);
      await loadFoldersFromDB();
      await loadSessions();
      return;
    }
    try {
      const resSessions = await fetch(`/api/sessions?folder_id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      if (!resSessions.ok) {
        // continue - folder is deleted
      }
    } catch {
      // continue
    }
    await loadSessions();
  };


  const handleCreateSession = async () => {
    // If we're already on landing (no active session) and no memory overlay is open,
    // "New Chat" should be a no-op (don't trigger any fade/exit behavior).
    if (isLandingRef.current && activeSessionIdRef.current == null && !memoryOverlayOpenRef.current) {
      return;
    }

    // If we're already on landing and only a memory overlay is open,
    // behave like "Back to chat": close overlay without resetting landing animation state.
    if (isLandingRef.current && activeSessionIdRef.current == null && memoryOverlayOpenRef.current) {
      setMemoryOverlayOpen(false);
      setSelectedMemoryId(null);
      setDraftMemory(null);
      pendingSessionSwitchRef.current = false;
      return;
    }

    suppressRestoreLastSessionRef.current = true;

    // "New Chat" should be a UI reset to the landing scene.
    // We only create a real DB session on the first user send (ensureActiveSessionForSend).

    // Hard-reset landing UI state so returning from an existing chat can't "blink" staged elements.
    setLandingFadeOut(false);
    setLandingExitActive(false);
    setFrozenPaddingBottom(null);
    setFrozenLandingStage(null);
    setLandingStage(0);

    // Hard-reset chat transition state that can temporarily hide landing (enterOpacity / isChatEntering).
    setIsChatEntering(false);
    setIsChatSwitching(false);
    setEnterOpacity(1);
    setChatSwapPhase("idle");

    // Mark landing as intentionally opened ("New Chat") for THIS TAB (sessionStorage).
    // This ensures a refresh in the same tab stays on landing until a session is selected/created.
    try {
      sessionStorage.setItem("db:openLanding", "true");
      sessionStorage.removeItem("db:lastActiveSessionId");
      if (scope?.kind === "user" && "userId" in scope) {
        sessionStorage.setItem(`db:userLanding:${scope.userId}`, "1");
      }
    } catch {}

    // If we were on a pristine/empty session, clear the pristine flag.
    pristineSessionIdRef.current = null;

    // If a memory doc is open, close it first so landing/new-chat is always reachable.
    if (memoryOverlayOpenRef.current) {
      setMemoryOverlayOpen(false);
      setSelectedMemoryId(null);
      setDraftMemory(null);
    }
    // Only mark pending session switch when we're leaving an actual active session.
    // If we're already on landing and only closing a memory overlay, this must stay false
    // or landing/memory transition effects can get stuck in a "switch pending" state.
    pendingSessionSwitchRef.current = activeSessionIdRef.current != null;
    // We are explicitly going to landing, so landing must be visible.
    setSuppressLanding(false);
    // Landing injected memories are ephemeral: always reset on "New Chat".
    clearLandingAttachedMemories();

    // Reset to landing (no active session selected)
    setActiveSessionIdTraced(null, "openLanding");
    setMessages([]);
    setInput("");
    inputPreserveRef.current = "";

    // Reset any inline modes
    setSearchMode(false);
    setSearchDraft("");
    setSearchQuery("");
    setScrollLockReason(null);

    // Close sidebar overlay (mobile)
    closeOverlays();

    // Keep landing behavior consistent (pin to bottom deterministically)
    scheduleSettlePinToBottom("new-chat");
  };
  
  // Handler for New Chat clicked in a specific folder
  const handleNewChatWithFolder = async (folderId: number | null) => {
    // Lock the folder choice
    setPendingNewChatFolderId(folderId);
    
    // Reset UI like normal New Chat
    await handleCreateSession();
  };

  // handleReorderSessions now comes from useChatSessions hook


  // --- Helpers: auto-title and ensure session ---
  
  const clampAutoTitle = (title: string) => {
    const t = (title ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "New Chat";
    const MAX = 60;
    return t.length > MAX ? t.slice(0, MAX - 1) + "…" : t;
  };

  const SESSION_TITLE_GENERATING = "Generating...";

  // Sidebar-safe title clamp for auto-generated titles (manual renames can exceed this)

  const ensureActiveSessionForSend = async (_firstUserText: string, landingMemoryIds?: number[]): Promise<{ sessionId: number; attachedMemoryIds: number[] }> => {
    if (activeSessionId) {
      // Existing session: return current attachments
      return { sessionId: activeSessionId, attachedMemoryIds: getMemoryIds(activeSessionId) };
    }

    // Create session
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: scope ? getHeadersForScope(scope) : getAuthHeaders(),
      body: JSON.stringify({ source: "dartz_chat", mode, title: SESSION_TITLE_GENERATING }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json.session_id !== "number") {
      throw new Error(json?.error || `Failed to create session (HTTP ${res.status})`);
    }

    const newId: number = json.session_id;
    const nowIso = new Date().toISOString();
    
    // Determine target folder (use pending folder if set, otherwise current selection)
    const targetFolderId = pendingNewChatFolderId ?? selectedFolderId ?? null;
    
    // Clear pending folder after using it
    if (pendingNewChatFolderId !== null) {
      setPendingNewChatFolderId(null);
    }
    
    const folderOrderTs = targetFolderId == null ? null : Date.now();

    // Set override to prevent loadSessions() from regressing this timestamp
    setUpdatedAtOverride(newId, nowIso);

    // Persist folder assignment/order for folder-targeted "New Chat" flows.
    if (targetFolderId !== null) {
      try {
        await fetch("/api/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newId,
            in_folder_id: targetFolderId,
            folder_order_ts: folderOrderTs,
          }),
        });
      } catch {
        // Keep optimistic UI; refresh will reconcile.
      }
    }

    // Transfer landing memories to the new session BEFORE returning
    let finalAttachedIds: number[] = [];
    if (landingMemoryIds && landingMemoryIds.length > 0) {
      const dbIds: number[] = [];
      for (const memoryId of landingMemoryIds) {
        const dbId = await ensureMemoryInDbThenAttach(newId, memoryId);
        dbIds.push(dbId);
      }
      finalAttachedIds = dbIds;
    }

    setActiveSessionIdTraced(newId, "ensureActiveSessionForSend");
    setSearchMode(false);
    setSearchDraft("");
    setSearchQuery("");

    // Mark new session as just opened (MRU)
    updateLastOpened(newId);

    // Insert optimistic session immediately at top (for Unfiled) or let loadSessions() handle folder positioning
    if (targetFolderId === null) {
      // Unfiled: insert at absolute top immediately
      const optimisticSessionForSessions = {
        id: newId,
        title: SESSION_TITLE_GENERATING,
        created_at: json.created_at || nowIso,
        updatedAt: nowIso,
        mode,
        focusGoal: null,
        focusEnabled: false,
        mru_ts: Date.now(),
      };
      
      const optimisticSession = {
        id: newId,
        title: SESSION_TITLE_GENERATING,
        updatedAt: nowIso,
        inFolderId: null,
        folderOrderTs: null,
        focusGoal: null,
        focusEnabled: false,
        mru_ts: Date.now(),
      };
      
      // React 18 automatically batches state updates, so no need for unstable_batchedUpdates
      setSessions((prev) => [optimisticSessionForSessions, ...prev.filter((s) => s.id !== newId)]);
      setSidebarSessions((prev) => [optimisticSession, ...prev.filter((s) => s.id !== newId)]);
    } else {
      // Folder: create optimistic entry (loadSessions will position it correctly)
      const optimisticSessionForSessions = {
        id: newId,
        title: SESSION_TITLE_GENERATING,
        created_at: json.created_at || nowIso,
        updatedAt: nowIso,
        mode,
        inFolderId: targetFolderId,
        folderOrderTs,
        focusGoal: null,
        focusEnabled: false,
        mru_ts: Date.now(),
      };
      
      const optimisticSession = {
        id: newId,
        title: SESSION_TITLE_GENERATING,
        updatedAt: nowIso,
        inFolderId: targetFolderId,
        folderOrderTs,
        focusGoal: null,
        focusEnabled: false,
        mru_ts: Date.now(),
      };
      
      // React 18 automatically batches state updates, so no need for unstable_batchedUpdates
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === newId);
        if (exists) {
            const cur = prev.find(s => s.id === newId)
            if (cur && cur.title === SESSION_TITLE_GENERATING) return prev
            return prev.map((s) => (s.id === newId ? { ...s, title: SESSION_TITLE_GENERATING, updatedAt: nowIso } : s));
        }
          return [optimisticSessionForSessions, ...prev];
      });
      setSidebarSessions((prev) => {
        const exists = prev.some((s) => s.id === newId);
        if (exists) {
            const cur = prev.find(s => s.id === newId)
            if (cur && cur.title === SESSION_TITLE_GENERATING) return prev
            return prev.map((s) => (s.id === newId ? { ...s, title: SESSION_TITLE_GENERATING, updatedAt: nowIso } : s));
        }
          return [optimisticSession, ...prev];
      });
    }

    // If session was created in a folder, the assignment is already persisted via the sessions API
    // No need for additional localStorage persistence

    // Wait a bit for DB to commit before reloading
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Refresh lists so sidebar updates (will apply MRU sort and respect override)
    await loadSessions();

    return { sessionId: newId, attachedMemoryIds: finalAttachedIds };
  };

  // Temporary handler for generating new chat when context is full
  const handleGenerateNewChat = useCallback(async () => {
    if (!sessionsHook.activeSessionId || isRollingOver) return;
    
    try {
      // Set loading state
      setIsRollingOver(true);
      
      // Add temporary "thinking" indicator
      const thinkingId = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          id: thinkingId,
          is_placeholder: true,
        },
      ]);
      
      // Call the rollover endpoint
      const res = await fetch("/api/sessions/rollover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldSessionId: sessionsHook.activeSessionId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const newSessionId = data.newSessionId;

      if (!newSessionId) {
        throw new Error("No new session ID returned");
      }

      // Get old session info for optimistic update
      const oldSession = sessions.find((s: Session) => s.id === sessionsHook.activeSessionId);
      const nowIso = new Date().toISOString();
      const newTitle = `Continued: ${oldSession?.title || 'Chat'}`;
      const newMode = oldSession?.mode || 'tactical';

      // Create optimistic session entry (same as New Chat flow)
      // Use a future timestamp to ensure it appears at top
      // Match what the server will do (max mru_ts + 1)
      const currentMaxMru = sessions.length > 0 ? Math.max(...sessions.map(s => s.mru_ts || 0)) : 0;
      const now = Date.now();
      const futureMruTs = Math.max(now, currentMaxMru + 1000); // Ensure it's higher than any existing
      const optimisticSessionForSessions = {
        id: newSessionId,
        title: newTitle,
        created_at: nowIso,
        updatedAt: nowIso,
        mode: newMode,
        mru_ts: futureMruTs,
      };
      
      const optimisticSession = {
        ...optimisticSessionForSessions,
        isNew: true,
      };

      // Insert at top of both session lists
      setSessions((prev) => [optimisticSessionForSessions, ...prev.filter((s) => s.id !== newSessionId)]);
      setSidebarSessions((prev) => [optimisticSession, ...prev.filter((s) => s.id !== newSessionId)]);

      // Mark new session as just opened (MRU)
      updateLastOpened(newSessionId);
      
      // Switch to new session
      handleSelectSession(newSessionId);
      
      // Clear any input
      setInput("");
      
      // Refresh sessions from server to ensure consistency
      await loadSessions();
      
    } catch (error) {
      console.error("Failed to rollover chat:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to continue";
      // Show error message to user
      setMessages((prev) => [
        ...prev.filter(m => !m.is_placeholder), // Remove thinking indicator
        {
          role: "assistant",
          content: `Error: ${errorMessage}`,
          created_at: new Date().toISOString(),
          id: Date.now(), // Use timestamp as temporary ID
          is_placeholder: false,
        },
      ]);
    } finally {
      // Clear loading state
      setIsRollingOver(false);
    }
  }, [sessionsHook.activeSessionId, isRollingOver, handleSelectSession, setInput, setMessages, sessions, updateLastOpened, loadSessions, touchSession]);

  const uploadImagesForTurn = useCallback(async (attachments: File[]): Promise<string[]> => {
    if (!attachments || attachments.length === 0) return [];

    const imageFiles = attachments.filter((file) => file.type.startsWith(SENDABLE_IMAGE_MIME_PREFIX));
    if (imageFiles.length === 0) return [];

    if (imageFiles.length > MAX_SENDABLE_IMAGES_PER_TURN) {
      throw new Error(`Max ${MAX_SENDABLE_IMAGES_PER_TURN} images per message.`);
    }

    for (const file of imageFiles) {
      if (file.size > MAX_SENDABLE_IMAGE_SIZE_BYTES) {
        const maxMb = Math.round(MAX_SENDABLE_IMAGE_SIZE_BYTES / (1024 * 1024));
        throw new Error(`Image too large: ${file.name} (max ${maxMb}MB)`);
      }
    }

    const uploadedUrls = await Promise.all(
      imageFiles.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);

        const uploadRes = await fetch("/api/upload/image", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || typeof uploadData?.url !== "string") {
          throw new Error(uploadData?.error || `Image upload failed (${uploadRes.status})`);
        }
        return uploadData.url as string;
      })
    );

    return uploadedUrls;
  }, []);

  const resolveTurnImageUrls = useCallback(async (attachmentsForTurn: File[]): Promise<string[] | null> => {
    const nonImageAttachmentCount = attachmentsForTurn.filter(
      (file) => !file.type.startsWith(SENDABLE_IMAGE_MIME_PREFIX)
    ).length;
    if (nonImageAttachmentCount > 0) {
      showToast("Only image attachments are sent to the model right now. Non-image files were skipped.");
    }

    try {
      return await uploadImagesForTurn(attachmentsForTurn);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload image attachments.";
      console.error("[handleSend] Image upload failed:", error);
      showToast(message);
      return null;
    }
  }, [showToast, uploadImagesForTurn]);

  const handleSend = async (overrideText?: string, options?: { historyPolicy?: "full" | "none" }) => {
    const trimmedInput = (overrideText ?? input).trim();
    const attachmentsForTurn = overrideText == null ? pendingComposerAttachments : [];
    const hasImageAttachment = attachmentsForTurn.some((file) =>
      file.type.startsWith(SENDABLE_IMAGE_MIME_PREFIX)
    );

    if (trimmedInput.length > MAX_INPUT_CHARS_PER_MESSAGE) {
      showToast(`Message too long. Max ${MAX_INPUT_CHARS_PER_MESSAGE.toLocaleString()} characters.`);
      return;
    }

    if ((!trimmedInput && !hasImageAttachment) || isSending) {
      if (!trimmedInput && attachmentsForTurn.length > 0 && !hasImageAttachment) {
        showToast("Only image attachments can be sent to the model right now.");
        if (scope?.kind === "guest") {
          resetComposerAttachments();
        }
      }
      return;
    }

    const sessionSeedText =
      trimmedInput ||
      attachmentsForTurn.find((file) => file.type.startsWith(SENDABLE_IMAGE_MIME_PREFIX))?.name ||
      "Image attachment";
    const shouldUseWebForThisTurn = webSearchArmed;
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const userLocalNowIso = new Date().toISOString();
    let uploadedImageUrls: string[] = [];

    if (webSearchArmed) {
      setWebSearchArmed(false);
    }

    // Check if user is signed in using scope
    if (!scope) {
      // If scope is loading, show loading message
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: 'Loading... Please try again.',
        created_at: new Date().toISOString(),
        session_id: sessionsHook.activeSessionId || null,
      }]);
      setInput('');
      return;
    }
    
    if (scope.kind === "guest") {
      if (isLanding) {
        setIsComposerSlidingDown(true);
        setTimeout(() => setIsComposerSlidingDown(false), 700);
      }
      setIsLoginModalOpen(true);
      setInput("");
      inputPreserveRef.current = "";
      resetComposerAttachments();
      return;
    }

    const uploadedForTurn = await resolveTurnImageUrls(attachmentsForTurn);
    if (uploadedForTurn === null) return;
    uploadedImageUrls = uploadedForTurn;

    // Don't delay the send - only delay message display
    const wasLanding = isLanding;
    if (wasLanding) {
      setIsComposerSlidingDown(true);
      // Start animation but don't wait - let message send in parallel
      setTimeout(() => {
        setIsComposerSlidingDown(false);
      }, 700);
    }

    // If no active chat, auto-create it from the first message.
    let sessionIdToUse = activeSessionId;
    
    // Transfer landing attachments to session before creating session (if sending from landing)
    const landingAttachedIds = wasLanding ? landingAttachedMemoryIds : [];
    let sessionResult: { sessionId: number; attachedMemoryIds: number[] };
    
    if (!sessionIdToUse) {
      try {
        sessionResult = await ensureActiveSessionForSend(sessionSeedText, landingAttachedIds);
        sessionIdToUse = sessionResult.sessionId;
        
        // After transferring landing memories to new session, update pin states
        if (wasLanding && landingAttachedIds.length > 0 && sessionResult.attachedMemoryIds.length > 0) {
          // Default all to pinned=true (server default), then unpin any that were unpinned on landing
          const unpinPromises: Promise<void>[] = [];
          const dbIds = sessionResult.attachedMemoryIds;
          for (let i = 0; i < landingAttachedIds.length && i < dbIds.length; i++) {
            const oldId = landingAttachedIds[i];
            const dbId = dbIds[i];
            if (!landingPinnedById[oldId]) {
              unpinPromises.push(
                fetch("/api/session-attachments/pin", {
                  method: "POST",
                  headers: getAuthHeaders(),
                  body: JSON.stringify({ sessionId: sessionIdToUse, memoryId: dbId }),
                }).then(res => {
                  if (!res.ok) {
                    console.warn(`Failed to unpin memory ${dbId} in session ${sessionIdToUse}`);
                  }
                })
              );
            }
          }
          
          // Execute all unpin operations in parallel
          await Promise.allSettled(unpinPromises);
          
          // Clear landing state
          setLandingAttachedMemoryIds([]);
          setLandingPinnedById({});
        }
      } catch (err) {
        console.error("Failed to auto-create session", err);
        // Reset flag if error occurs
        if (wasLanding) {
          setIsComposerSlidingDown(false);
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Error: could not create a new chat session.",
          },
        ]);
        return;
      }
    } else {
      // Existing session - get current attachments
      sessionResult = { sessionId: sessionIdToUse, attachedMemoryIds: getMemoryIds(sessionIdToUse) };
    }

    // Check if this is the first assistant message before inserting messages
    const wasFirstAssistant = messages.filter(m => m.role === "assistant").length === 0;
    
    // Generate stable IDs: one baseId, then userId and assistantId derived from it
    const baseId = Date.now();
    const userId = baseId;
    const assistantId = baseId + 1;
    if (shouldUseWebForThisTurn) {
      setWebGlowHold(true);
      webGlowRevealMessageIdRef.current = assistantId;
    }
    
    // Don't add messages yet - wait until after session is created
    
    // Immediately touch unfiled sessions on user send (custom folder ordering is separate).
    if (sessionIdToUse) {
      const sidebarSession = sidebarSessions.find((s) => s.id === sessionIdToUse);
      if ((sidebarSession?.inFolderId ?? null) === null) {
        void touchSession(sessionIdToUse);
      }
    }
    
    // MRU bump on user send (only for unfiled sessions)
    if (sessionIdToUse) {
      const sidebarSession = sidebarSessions.find((s) => s.id === sessionIdToUse);
      const inFolderId = sidebarSession?.inFolderId ?? null;
      const shouldBump = inFolderId === null;
      
      // NOTE: Unfiled ordering is driven by assistant replies (not user sends).
      // Keep lastOpened for UX, but do NOT bump updatedAt here.
      if (sessionIdToUse) {
        const sidebarSession = sidebarSessions.find((s) => s.id === sessionIdToUse);
        const inFolderId = sidebarSession?.inFolderId ?? null;
        if (inFolderId === null) {
          updateLastOpened(sessionIdToUse);
        }
      }
    }
    
    // Clear pristine flag - session is now used
    if (sessionIdToUse === pristineSessionIdRef.current) {
      pristineSessionIdRef.current = null;
    }
    
    // Optimistic UI update: if a new session was just created, update title immediately
    if (!activeSessionId && sessionIdToUse) {
      const pendingTitle = SESSION_TITLE_GENERATING;
      const nowIso = new Date().toISOString();
      
      // React 18 automatically batches state updates, so no need for unstable_batchedUpdates
        // Update sessions state
        setSessions((prev) => {
          const exists = prev.some((s) => s.id === sessionIdToUse);
          if (exists) {
            const cur = prev.find((s) => s.id === sessionIdToUse);
            if (cur && cur.title === pendingTitle) return prev;
            return prev.map((s) => (s.id === sessionIdToUse ? { ...s, title: pendingTitle } : s));
          }
          // New session: insert at top (simple unshift), ChatNavigator will sort by updatedAt
          const withNew = [{ id: sessionIdToUse, title: pendingTitle, created_at: nowIso, updatedAt: nowIso, mode, focusGoal: null, focusEnabled: false, mru_ts: Date.now() }, ...prev];
          return withNew;
        });
        
        // Update sidebarSessions state
        setSidebarSessions((prev) => {
          const exists = prev.some((s) => s.id === sessionIdToUse);
          if (exists) {
            const cur = prev.find(s => s.id === sessionIdToUse)
            if (cur && cur.title === pendingTitle) return prev
            return prev.map((s) => (s.id === sessionIdToUse ? { ...s, title: pendingTitle } : s));
          }
          return [
            {
              id: sessionIdToUse,
              title: pendingTitle,
              updatedAt: nowIso,
              inFolderId: null,
              focusGoal: null,
              focusEnabled: false,
              mru_ts: Date.now(),
            },
            ...prev,
          ];
        });
        
        // Bump MRU for new session
        updateLastOpened(sessionIdToUse);
    }
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestScroll({ type: "toBottom", reason: "reveal" });
        isAtBottomRef.current = true;
      });
    });
    // Keep the input text after sending so the user can reuse/edit it
    // Reset flags for the next assistant message
    userScrolledAwayDuringStreamRef.current = false;
    userStoppedFollowRef.current = false;
    isFollowingRevealRef.current = true;
    autoFollowLatchRef.current = true;
    setIsSending(true);

    try {
      // Use canonical attached memory IDs from session result
      const attachedMemoryIdsForRequest = sessionResult.attachedMemoryIds;
      const sessionFocus = getFocusPayloadForSession(sessionIdToUse);

      // Add messages after session is created and composer animation is done
      const newMessages = [
        ...(messages || []), // Use current messages as base
        {
          id: userId,
          role: "user" as const,
          content: trimmedInput,
          image_urls: uploadedImageUrls,
          created_at: new Date().toISOString(),
          session_id: sessionIdToUse,
        },
        {
          id: assistantId,
          role: "assistant" as const,
          content: "Thinking…",
          created_at: new Date().toISOString(),
          is_placeholder: true,
          session_id: sessionIdToUse,
        },
      ];
      // Set the skip flag BEFORE setting messages
      skipNextSessionFetchRef.current = true;
      
      // If we just came from landing, delay messages to match animation
      const wasLanding = isLanding; // Check the original landing state
      const messageDelay = wasLanding ? 750 : 10; // 750ms to match composer animation
      
      setTimeout(() => {
        setMessagesAndMarkLoaded(newMessages);
      }, messageDelay);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: scope ? getHeadersForScope(scope) : { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdToUse,
          userMessage: trimmedInput,
          mode: mode,
          memoryFolder: null,
          attachedMemoryIds: attachedMemoryIdsForRequest,
          focusEnabled: sessionFocus.focusEnabled,
          focusGoal: sessionFocus.focusGoal,
          focusIntensity: sessionFocus.focusIntensity,
          imageUrls: uploadedImageUrls,
          web: shouldUseWebForThisTurn,
          historyPolicy: options?.historyPolicy ?? "full",
          userTimeZone,
          userLocalNowIso,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        const errorMessage = errorData.error || `HTTP ${res.status}`;
        
        // Detect context-length errors
        if (
          errorMessage.includes("context_length_exceeded") ||
          errorMessage.includes("context_length") ||
          errorMessage.includes("token limit") ||
          errorMessage.includes("maximum context length")
        ) {
          // Context length exceeded - user will see the full composer state
        }
        
        // Replace placeholder with error message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${errorMessage}`, created_at: new Date().toISOString(), is_placeholder: false }
              : m
          )
        );
        if (shouldUseWebForThisTurn) {
          setWebGlowHold(false);
          webGlowRevealMessageIdRef.current = null;
        }
        return;
      }

      const data = await res.json();
      const reply = data.reply;
      if (
        shouldUseWebForThisTurn &&
        data?.web?.requested &&
        !data?.web?.used &&
        data?.web?.error &&
        !(data?.web as any)?.skipped
      ) {
        showToast(`Web search unavailable: ${data.web.error}`);
      }

      // Update token cache immediately if usage is returned
      if (data?.session_total_tokens != null && sessionIdToUse) {
        setSessionUsedTokens((prev) => ({
          ...prev,
          [sessionIdToUse]: data.session_total_tokens,
        }));
      }

      // Store context metrics for Option A (context window pressure)
      if (data?.context_current_tokens != null && data?.context_max_tokens != null && data?.context_usage_ratio != null && sessionIdToUse) {
        setContextMetricsBySessionId((prev) => ({
          ...prev,
          [sessionIdToUse]: {
            current_tokens: data.context_current_tokens,
            max_tokens: data.context_max_tokens,
            usage_ratio: data.context_usage_ratio,
          },
        }));
      }

      if (!reply) {
        // Replace placeholder with error message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Error: No reply in response", created_at: new Date().toISOString(), is_placeholder: false }
              : m
          )
        );
        if (shouldUseWebForThisTurn) {
          setWebGlowHold(false);
          webGlowRevealMessageIdRef.current = null;
        }
        return;
      }

      // Replace placeholder with real reply
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: reply, created_at: new Date().toISOString(), is_placeholder: false, meta: parseMessageMeta(data?.meta) }
            : m
        )
      );
      // Start reveal immediately to prevent a 1-frame flash of the full reply
      // before `revealActive`/`revealHeightPx` take effect.
      startRevealHeight(assistantId);
      
      // Note: MRU is now updated server-side in /api/chat/route.ts
      // No need for client touchSession here
      
      // bump updatedAt so Chats MRU sort moves this session to the top (only for unfiled)
      if (sessionIdToUse) {
        const sidebarSession = sidebarSessions.find((s) => s.id === sessionIdToUse);
        const inFolderId = sidebarSession?.inFolderId ?? null;
        const shouldBump = inFolderId === null;

        if (shouldBump) {
          // Check if already at top BEFORE updating state
          const unfiledSessions = sidebarSessions.filter((s) => s.inFolderId == null);
          const sortedUnfiled = [...unfiledSessions].sort((a, b) => {
            const bt = new Date(b.updatedAt).getTime();
            const at = new Date(a.updatedAt).getTime();
            if (bt !== at) return bt - at;
            return b.id - a.id;
          });
          
          const isAlreadyAtTop = sortedUnfiled[0]?.id === sessionIdToUse;
          
          // Only update state if NOT already at top (prevents unnecessary re-render)
          if (!isAlreadyAtTop) {
        const nowIso = new Date().toISOString();
        
        // React 18 automatically batches state updates, so no need for unstable_batchedUpdates
        setUpdatedAtOverride(sessionIdToUse, nowIso);

        setSessions((prev) =>
          prev.map((s) => (s.id === sessionIdToUse ? { ...s, updatedAt: nowIso } : s))
        );

        setSidebarSessions((prev) =>
          prev.map((s) => (s.id === sessionIdToUse ? { ...s, updatedAt: nowIso } : s))
        );
          } else {
            // Already at top: still set override for future loadSessions() calls, but skip state updates
            const nowIso = new Date().toISOString();
            setUpdatedAtOverride(sessionIdToUse, nowIso);
          }
        }
      }
      
      // NOTE: Don't pin here - reveal will handle pinning after measurement.
      // Premature pinning causes bounce because scrollHeight isn't stable yet.
      // The reveal animation (startRevealHeight) will pin correctly after measurement exists.

      // Generate title non-blocking for first assistant message
      if (wasFirstAssistant && sessionIdToUse) {
        void fetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assistantResponse: reply }),
        })
          .then((r) => r.json())
          .then(({ title }) => {
            if (title && sessionIdToUse) {
              const safeTitle = clampAutoTitle(title);

              // Persist title
              fetch("/api/sessions", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: sessionIdToUse, title: safeTitle }),
              }).catch(() => {});

              // Update UI immediately (sidebar + top bar) - NO-OP if title unchanged
              setSessions((prevSessions) => {
                const cur = prevSessions.find(s => s.id === sessionIdToUse)
                if (!cur || cur.title === safeTitle) return prevSessions
                return prevSessions.map((s) => (s.id === sessionIdToUse ? { ...s, title: safeTitle } : s))
              });

              setSidebarSessions((prevSidebar) => {
                const cur = prevSidebar.find(s => s.id === sessionIdToUse)
                if (!cur || cur.title === safeTitle) return prevSidebar
                return prevSidebar.map((s) => (s.id === sessionIdToUse ? { ...s, title: safeTitle } : s))
              });
            }
          })
          .catch(() => {});
      }

      // Reset follow flags for new message
      isFollowingRevealRef.current = true;
      userStoppedFollowRef.current = false;

      // Clear input after successful send
      setInput("");
      inputPreserveRef.current = "";

      // Gate: Only call loadSessions() if server-side refresh is actually needed.
      // Skip refresh when:
      // - Active chat is already index 0 in Unfiled (client bump is sufficient)
      // - No folder assignments changed (no moves/deletes happened)
      // - No new session was created (we already have optimistic UI)
      let shouldReload = false;
      
      // Check if we need server refresh:
      // 1. New session was just created (no server data yet)
      const wasNewSession = skipNextSessionFetchRef.current === true;
      // One-shot flag: only treat the *next* post-send cycle as "new session".
      // If we don't reset this, we end up calling loadSessions() after every message.
      if (wasNewSession) {
        skipNextSessionFetchRef.current = false;
      }
      
      // 2. Active session is NOT already at top in Unfiled
      if (sessionIdToUse != null) {
        const activeSession = sidebarSessions.find((s) => s.id === sessionIdToUse);
        const isUnfiled = activeSession?.inFolderId == null;
        
        if (isUnfiled) {
          // Check if already at top after optimistic bump
          const sessionUpdatedAt = updatedAtOverridesRef.current[sessionIdToUse] || 
            activeSession?.updatedAt || 
            new Date().toISOString();
          
          const unfiledSessions = sidebarSessions
            .filter((s) => s.inFolderId == null)
            .map((s) => {
              const updated = s.id === sessionIdToUse 
                ? sessionUpdatedAt 
                : (updatedAtOverridesRef.current[s.id] || s.updatedAt);
              return { ...s, updatedAt: updated };
            });
          
          const sortedUnfiled = unfiledSessions.sort((a, b) => {
            const bt = new Date(b.updatedAt).getTime();
            const at = new Date(a.updatedAt).getTime();
            if (bt !== at) return bt - at;
            return b.id - a.id;
          });
          
          const isAlreadyAtTop = sortedUnfiled[0]?.id === sessionIdToUse;
          
          // Skip reload if already at top (client bump is sufficient)
          if (!isAlreadyAtTop) {
            shouldReload = true;
          }
        } else {
          // Folder sessions: only reload if needed (usually not needed after assistant reply)
          // Folder order is stable, so skip unless there was a structural change
          shouldReload = false;
        }
      }
      
      // Always reload if new session was created (need server data)
      if (wasNewSession) {
        shouldReload = true;
      }
      
      // Skip reloading sessions after message - it causes messages to disappear
      // The MRU bump is handled server-side now
      if (shouldReload) {
        // Intentionally no-op: reloading here still causes visible message loss.
      }
      // If already at top and no new session, skip loadSessions() - client bump is sufficient
    } catch (err) {
      console.error("chat error", err);
      const errorMsg = err instanceof Error ? err.message : "Unknown error occurred";
      
      // Replace placeholder with error message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${errorMsg}`, created_at: new Date().toISOString(), is_placeholder: false }
            : m
        )
      );
      if (shouldUseWebForThisTurn) {
        setWebGlowHold(false);
        webGlowRevealMessageIdRef.current = null;
      }
    } finally {
      setIsSending(false);
    }
  };
  
  // Handle composer height changes (stable + deduped to avoid update loops under heavy refresh).
  const handleComposerHeightChange = useCallback((height: number) => {
    if (!Number.isFinite(height)) return;
    const next = Math.max(0, Math.round(height));
    setComposerHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);

  // Toggle sidebar with localStorage persistence
  // toggleSidebar() and toggleRightDock() removed - use panels.toggleLeft() and panels.toggleRight() instead

  const scrollToHour = (hourKey: string) => {
    const container = scrollContainerRef.current;
    const target = hourBucketRefs.current[hourKey];
    if (!container || !target) return;
    const { scrollToHour: scrollToHourHelper } = require("@/lib/chatHelpers");
    scrollToHourHelper(container, target);
  };

  // Layout tuning: keep the "waiting" gap, but let assistant+tools sit closer once a reply exists.
  const lastRole = (messages[messages.length - 1] as any)?.role as ("user" | "assistant" | undefined);
  const waitingForAssistant = isSending && lastRole === "user";
  const messageStreamPadBottom = waitingForAssistant ? 24 : 12; // px

  const chatNavigatorEl = useMemo(() => (
    <ChatNavigator
      sessions={sidebarSessions}
      folders={folders}
      activeSessionId={activeSessionId}
      selectedFolderId={selectedFolderId}
      activeId={activeDragId}
      isFolderSwitching={false}
      onSelectSession={handleSelectSession}
      onRenameSession={handleRenameSession}
      onDeleteSession={handleDeleteSession}
      onRenameFolder={handleRenameFolder}
      onDeleteFolder={handleDeleteFolder}
      sessionUsageRatio={activeSessionLifetimeRatio}
      onNewChatWithFolder={handleNewChatWithFolder}
    />
  ), [
    sidebarSessions,
    folders,
    activeSessionId,
    selectedFolderId,
    activeDragId,
    handleSelectSession,
    handleRenameSession,
    handleDeleteSession,
    handleRenameFolder,
    handleDeleteFolder,
    activeSessionLifetimeRatio,
    handleNewChatWithFolder
  ]);

  const disableRailItemMotion =
    scope?.kind === "user" &&
    (!sessionsHook.hasHydrated ||
      isRestoringLastSession ||
      isResuming ||
      !(hasLoadedFoldersOnce && hasLoadedMemoryFoldersOnce));

  const chatPageElement = (
    <ChatPageLayout
      hasMounted={hasMounted}
      isReload={isReload}
      hasHydrated={sessionsHook.hasHydrated}
      isResuming={isResuming}
      isRestoringLastSession={isRestoringLastSession}
      disableRailItemMotion={disableRailItemMotion}
      isRestoringMemoryOverlay={isRestoringMemoryOverlay}
      restoreDecisionMade={restoreDecisionMade}
      sidebarHidden={sidebarHidden}
      layoutMode={layoutMode}
      rightDockHidden={rightDockHidden}
            sensors={sensors}
            collisionDetection={collisionDetection}
      modifiers={modifiers}
      handleDragStart={handleDragStart}
      handleDragMove={handleDragMove}
      handleDragOver={handleDragOver}
      handleDragEnd={handleDragEnd}
      handleDragCancel={handleDragCancel}
            folders={folders}
                selectedFolderId={selectedFolderId}
      setStartRenameFolderId={setStartRenameFolderId}
      sidebarSessions={sidebarSessions}
      handleFolderSelect={handleFolderSelect}
      handleRenameFolder={handleRenameFolder}
      handleDeleteFolder={handleDeleteFolder}
      handleDeleteFolderAndChats={handleDeleteFolderAndChats}
      handleCreateFolder={handleCreateFolder}
      onSetFolderIcon={handleSetFolderIcon}
      activeDragId={activeDragId}
      leftFolderListRef={leftFolderListRef}
      rightFolderListRef={rightFolderListRef}
      dragOverlaySessionId={dragOverlaySessionId}
      sessions={sessions}
      chatNavigatorEl={chatNavigatorEl}
      activeSessionId={activeSessionId}
      memoryOverlayOpen={memoryOverlayOpen}
      memoryToolbarVisible={memoryToolbarVisible}
      selectedMemoryId={selectedMemoryId}
	      memories={memories}
	      setMemories={setMemories}
	      getMemoryById={getMemoryById}
	      upsertMemoryInCache={upsertMemoryInCache}
	      upsertMemoryInFolderCaches={upsertMemoryInFolderCaches}
	      guestMessageCount={guestMessageCount}
      GUEST_MESSAGE_LIMIT={GUEST_MESSAGE_LIMIT}
      scope={scope}
      messages={messages}
      activeHourKey={activeHourKey}
      scrollToHour={scrollToHour}
      hourBuckets={hourBuckets}
      router={router}
      toggleLeft={toggleLeft}
      handleCreateSession={handleCreateSession}
      handleModeChange={handleModeChange}
      mode={mode}
      showLandingHeader={showLandingHeader}
      suppressLanding={suppressLanding}
      isChatSwitching={isChatSwitching}
      isChatEntering={isChatEntering}
      enterOpacity={enterOpacity}
                landingFadeOut={landingFadeOut}
      frozenPaddingBottom={frozenPaddingBottom}
      adjustedLandingLiftPx={adjustedLandingLiftPx}
      composerHeight={composerHeight}
      stageForRender={stageForRender}
      landingAttachedCount={landingAttachedCount}
      landingAttachedMemories={landingAttachedMemories}
      detachMemoryFromLanding={detachMemoryFromLanding}
      clearLandingAttachedMemories={clearLandingAttachedMemories}
      setLandingMemoryBoxHeight={setLandingMemoryBoxHeight}
      scrollContainerRef={scrollContainerRef}
      isLanding={isLanding}
      isColdLandingBoot={isColdLandingBoot}
      coldBootLiftReady={coldBootLiftReady}
      messageStreamPadBottom={messageStreamPadBottom}
      isModeFading={isModeFading}
      chatSwapPhase={chatSwapPhase}
      CHAT_SWAP_OUT_MS={CHAT_SWAP_OUT_MS}
      CHAT_SWAP_IN_MS={CHAT_SWAP_IN_MS}
      CHAT_ENTER_FADE_MS={CHAT_ENTER_FADE_MS}
      CHAT_SWITCH_DIM_OPACITY={CHAT_SWITCH_DIM_OPACITY}
      messagesTree={messagesTree}
            draftMemory={draftMemory}
      setMemoryOverlayOpen={setMemoryOverlayOpen}
      setForceEditMemoryId={setForceEditMemoryId}
      setDraftMemory={setDraftMemory}
      handleMemorySave={handleMemorySave}
      loadMemories={loadMemories}
      getAllMemoryFolderNames={getAllMemoryFolderNames}
      isOpeningMemory={isOpeningMemory}
      showScrollDownFab={showScrollDownFab}
      handleScrollDownFab={handleScrollDownFab}
          searchMode={searchMode}
      searchDraft={searchDraft}
      setSearchDraft={setSearchDraft}
      input={input}
      pendingComposerAttachmentCount={pendingComposerAttachments.length}
      setInput={setInput}
      onComposerAttachmentsChange={setPendingComposerAttachments}
      composerAttachmentResetToken={composerAttachmentResetToken}
      inputPreserveRef={inputPreserveRef}
      handleSend={handleSend}
      isSending={composerBusy}
      disabled={false}
      handleComposerHeightChange={handleComposerHeightChange}
      setIsTimelineOpen={setIsTimelineOpen}
      isTimelineOpen={isTimelineOpen}
      handleToggleSearchMode={handleToggleSearchMode}
      handleRunSearch={handleRunTaggedSearch}
      webSearchArmed={webSearchArmed || webGlowHold}
      onToggleWebSearch={() => setWebSearchArmed((prev) => !prev)}
      focusEnabled={activeSessionFocusState.enabled}
      focusText={activeSessionFocusState.goal}
      onFocusSave={handleFocusSave}
      onFocusToggle={handleFocusToggle}
      onFocusClear={handleFocusClear}
      isSearching={isSearching}
      searchHitCount={searchHitCount}
      searchRoleFilter={searchRoleFilter}
      setSearchRoleFilter={setSearchRoleFilter}
      searchMatchMode={searchMatchMode}
      setSearchMatchMode={setSearchMatchMode}
      handleClearMiddleSearch={handleClearMiddleSearch}
      searchTags={searchTags}
      handleRemoveSearchTag={handleRemoveSearchTag}
      maxSearchTags={MAX_SEARCH_TAGS}
      attachedMemoryIdsForActiveSession={attachedMemoryIdsForActiveSession}
      attachedMemoriesForActiveSession={attachedMemoriesForActiveSession}
      landingAttachedMemoriesWithPin={landingAttachedMemoriesWithPin}
      activeSessionUsageRatio={memoryUsageRatio}
      activeSessionLifetimeRatio={activeSessionLifetimeRatio}
      isContextWarning={isSessionWarning}
      chatFullState={chatFullState}
      onGenerateNewChat={handleGenerateNewChat}
      togglePin={togglePin}
      toggleLandingPin={toggleLandingPin}
      detachMemoryFromActiveSession={detachMemoryFromActiveSession}
      clearAttachedMemoriesForActiveSession={clearAttachedMemoriesForActiveSession}
      attachAllMemoriesFromFolder={attachAllMemoriesFromFolder}
      refreshUsage={refreshUsage}
      hydrate={hydrate}
      timelinePopupRef={timelinePopupRef}
      ignoreOutsideClickRef={ignoreOutsideClickRef}
      toggleRight={toggleRight}
          rightPanelOpen={rightPanelOpen}
      setRightPanelOpen={setRightPanelOpen}
	      memoryFolders={memoryFolders}
	      selectedMemoryFolder={selectedMemoryFolder}
	      setSelectedMemoryFolder={handleSelectMemoryFolder}
	      setSelectedMemoryId={setSelectedMemoryId}
	      suppressMemoryHover={suppressMemoryHover}
	      handleFolderReorder={handleFolderReorder}
	      handleCreateMemoryFolder={handleCreateMemoryFolder}
	      handleRenameMemoryFolder={handleRenameMemoryFolder}
      handleDeleteMemoryFolder={handleDeleteMemoryFolder}
      handleDeleteMemoryFolderAndMemories={handleDeleteMemoryFolderAndMemories}
      handleSetMemoryFolderIcon={handleSetMemoryFolderIcon}
      handleMemoryReorder={handleMemoryReorder}
      handleMemoryDelete={handleMemoryDelete}
      handleMemoryRename={handleMemoryRename}
      openBlankMemoryDraft={openBlankMemoryDraft}
      memorySearchQuery={memorySearchQuery}
      setMemorySearchQuery={setMemorySearchQuery}
      dragOverlayMemoryId={dragOverlayMemoryId}
      currentOverId={currentOverId}
      currentInsert={currentInsert}
      keepOverlaysVisible={keepOverlaysVisible}
      sidebarOpen={sidebarOpen}
      rightOverlayOpen={rightOverlayOpen}
      closeOverlays={closeOverlays}
      memoryError={memoryError}
      setMemoryToolbarVisible={setMemoryToolbarVisible}
      forceEditMemoryId={forceEditMemoryId}
        distToBottomRef={distToBottomRef}
        isAtBottomRef={isAtBottomRef}
        scrollLockReason={scrollLockReason}
        revealMessageIdRef={revealMessageIdRef}
      memoryLoading={memoryLoading}
      isFolderSwitching={isMemoryFolderSwitching}
      toggleAttachMemory={toggleAttachMemory}
      pendingAttachedMemoryIds={landingAttachedMemoryIds}
      memoryUsageRatio={memoryUsageRatio}
      usageRatio={memoryUsageRatio}
      toasts={toasts}
      guestInfoBannerVisible={guestInfoBannerVisible && scope?.kind === "guest"}
      onDismissGuestInfoBanner={handleDismissGuestInfoBanner}
      onGuestInfoBannerSignIn={() => setIsLoginModalOpen(true)}
      // Auth props
      user={user}
      isAuthenticated={isAuthenticated}
      accountPlan={accountPlan}
      authLoading={authLoading}
      onLoginClick={() => setIsLoginModalOpen(true)}
      onSignOut={handleSignOut}
      onPurchasePlus={handlePurchasePlus}
      onManageBilling={handleManageBilling}
    />
  );
  
  return (
    <>
      {chatPageElement}
      {expandedUserImageUrl && (
        <ImageLightbox imageUrl={expandedUserImageUrl} onClose={() => setExpandedUserImageUrl(null)} />
      )}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)}
      />
    </>
  );
}
