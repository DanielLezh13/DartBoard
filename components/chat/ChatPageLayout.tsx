"use client";

import React, { useCallback, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  LEFT_PANEL_W_CLEAN,
  LEFT_RAIL_W_CLEAN,
  RIGHT_PANEL_W_CLEAN,
  RIGHT_RAIL_W_CLEAN,
  SHOW_DEV_HUD,
  SLIDE_MS,
  SLIDE_EASE,
} from "@/lib/chatConstants";
import type { ChatMessage, DraftMemory, HourBucket } from "@/types/chat";
import { ModeValueSlot } from "@/components/chat/ModeValueSlot";
import { ChatDropzoneGhost } from "@/components/chat/ChatDropzoneGhost";
import { BrandHeading } from "@/components/ui/BrandHeading";
import { DebugHUD } from "@/components/chat/DebugHUD";
import { FancyGlowingModeButton } from "@/components/chat/FancyGlowingModeButton";
import { getModeSpec, DARTZ_MODES } from "@/lib/modes";
import { FolderRail, FolderBubbleIconContent } from "@/components/chat/FolderRail";
import { DefaultFolderIcon } from "@/components/icons/DefaultFolderIcon";
import { ChatNavigator } from "@/components/chat/ChatNavigator";
import { RightDock } from "@/components/chat/RightDock";
import { MemoryReaderOverlay } from "@/components/chat/MemoryReaderOverlay";
import { FloatingChatComposer } from "@/components/chat/FloatingChatComposer";
import { ChatDropzoneTarget } from "@/components/chat/ChatDropzoneTarget";
import { LandingInjectedMemories } from "@/components/chat/LandingInjectedMemories";
import { ToastContainer } from "@/components/ui/Toast";
import { PricingModal } from "@/components/chat/PricingModal";
import type { Memory } from "@/hooks/useChatMemories";
import { getLastUserId } from "@/lib/railCache";
import { PLAN_LIMITS } from "@/lib/planLimits";

type ChatPageLayoutProps = Record<string, any>;

const DND_AUTO_SCROLL_OPTIONS = {
  // Default threshold is 0.2; tighten Y so edge-scroll starts closer to top/bottom.
  threshold: { x: 0.2, y: 0.08 },
};

const LazyProfileView: any = dynamic(
  () => import("@/components/profile/ProfileView").then((mod: any) => mod.ProfileView),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 text-gray-100 flex items-center justify-center">
        <p className="text-base text-gray-400">Loading profile...</p>
      </div>
    ),
  }
);

// Extract the JSX return statement from page.tsx (lines 2258-3541)
// This component accepts all variables used in the JSX as props
export function ChatPageLayout(props: ChatPageLayoutProps) {
  // Destructure all props
  const {
    hasMounted,
    isReload,
    hasHydrated,
    isResuming,
    isRestoringLastSession,
    disableRailItemMotion = false,
    isRestoringMemoryOverlay,
    restoreDecisionMade,
    sidebarHidden,
    layoutMode,
    rightDockHidden,
    guestMessageCount,
    GUEST_MESSAGE_LIMIT,
    scope,
    sensors,
    collisionDetection,
    modifiers,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    folders,
    selectedFolderId,
    setStartRenameFolderId,
    sidebarSessions,
    handleFolderSelect,
    handleRenameFolder,
    handleDeleteFolder,
    handleDeleteFolderAndChats,
    handleCreateFolder,
    onSetFolderIcon,
    activeDragId,
    leftFolderListRef,
    rightFolderListRef,
    dragOverlaySessionId,
    sessions,
    chatNavigatorEl,
    activeSessionId,
    memoryOverlayOpen,
    memoryToolbarVisible,
    selectedMemoryId,
    memories,
    setMemories,
    getMemoryById,
    upsertMemoryInCache,
    upsertMemoryInFolderCaches,
    messages,
    activeHourKey,
    scrollToHour,
    hourBuckets,
    router,
    toggleLeft,
    handleCreateSession,
    handleModeChange,
    mode,
    showLandingHeader,
    suppressLanding,
    isChatSwitching,
    isChatEntering,
    enterOpacity,
    landingFadeOut,
    frozenPaddingBottom,
    adjustedLandingLiftPx,
    composerHeight,
    stageForRender,
    landingAttachedCount,
    landingAttachedMemories,
    detachMemoryFromLanding,
    clearLandingAttachedMemories,
    setLandingMemoryBoxHeight,
    scrollContainerRef,
    isLanding,
    isColdLandingBoot,
    coldBootLiftReady,
    messageStreamPadBottom,
    isModeFading,
    chatSwapPhase,
    CHAT_SWAP_OUT_MS,
    CHAT_SWAP_IN_MS,
    CHAT_ENTER_FADE_MS,
    CHAT_SWITCH_DIM_OPACITY,
    messagesTree,
    draftMemory,
    setMemoryOverlayOpen,
    setForceEditMemoryId,
    setDraftMemory,
    handleMemorySave,
    loadMemories,
    loadMemoryFolders,
    getAllMemoryFolderNames,
    isOpeningMemory,
    showScrollDownFab,
    handleScrollDownFab,
    searchMode,
    searchDraft,
    setSearchDraft,
    input,
    pendingComposerAttachmentCount = 0,
    setInput,
    onComposerAttachmentsChange,
    composerAttachmentResetToken,
    inputPreserveRef,
    handleSend,
    isSending,
    disabled,
    handleComposerHeightChange,
    setIsTimelineOpen,
    isTimelineOpen,
    handleToggleSearchMode,
    handleRunSearch,
    webSearchArmed,
    focusEnabled,
    focusText,
    onFocusSave,
    onFocusToggle,
    onFocusClear,
    onToggleWebSearch,
    isSearching,
    searchHitCount,
    searchRoleFilter,
    setSearchRoleFilter,
    searchMatchMode,
    setSearchMatchMode,
    handleClearMiddleSearch,
    searchTags,
    handleRemoveSearchTag,
    maxSearchTags,
    attachedMemoryIdsForActiveSession,
    attachedMemoriesForActiveSession,
    landingAttachedMemoriesWithPin,
    activeSessionUsageRatio,
    activeSessionLifetimeRatio,
    isContextWarning,
    chatFullState,
    onGenerateNewChat,
    togglePin,
    toggleLandingPin,
    detachMemoryFromActiveSession,
    clearAttachedMemoriesForActiveSession,
    attachAllMemoriesFromFolder,
    refreshUsage,
    hydrate,
    timelinePopupRef,
    ignoreOutsideClickRef,
    toggleRight,
    rightPanelOpen,
    setRightPanelOpen,
    memoryFolders,
    selectedMemoryFolder,
    setSelectedMemoryFolder,
    setSelectedMemoryId,
    suppressMemoryHover,
    handleFolderReorder,
    handleCreateMemoryFolder,
    handleRenameMemoryFolder,
    handleDeleteMemoryFolder,
    handleDeleteMemoryFolderAndMemories,
    handleSetMemoryFolderIcon,
    handleMemoryReorder,
    handleMemoryDelete,
    handleMemoryRename,
    openBlankMemoryDraft,
    memorySearchQuery,
    setMemorySearchQuery,
    dragOverlayMemoryId,
    currentOverId,
    currentInsert,
    keepOverlaysVisible,
    sidebarOpen,
    rightOverlayOpen,
    closeOverlays,
    contextUsedTokens,
    contextLimitTokens,
    memoryError,
    setMemoryToolbarVisible,
    forceEditMemoryId,
    distToBottomRef,
    isAtBottomRef,
    scrollLockReason,
    revealMessageIdRef,
    memoryLoading,
    isFolderSwitching,
    toggleAttachMemory,
    pendingAttachedMemoryIds,
    memoryUsageRatio,
    usageRatio,
    toasts = [],
    guestInfoBannerVisible = false,
    onDismissGuestInfoBanner,
    onGuestInfoBannerSignIn,
    // Auth props
    user,
    isAuthenticated,
    accountPlan,
    authLoading = false,
    onLoginClick,
    onSignOut,
    onPurchasePlus,
    onManageBilling,
  } = props;

  // Folder appearance overrides (from FolderRail) for left-rail DragOverlay icon
  const [leftFolderAppearance, setLeftFolderAppearance] = useState<Record<number, { label?: string; icon?: string; color?: string }>>({});
  // Folder appearance overrides (from RightRail) for right-rail memory folder DragOverlay icon
  const [rightFolderAppearance, setRightFolderAppearance] = useState<Record<number, { label?: string; icon?: string; color?: string }>>({});
  const guestWarningThreshold = Math.max(1, Math.ceil(GUEST_MESSAGE_LIMIT * 0.8));
  const isGuestNearLimit =
    scope?.kind === "guest" &&
    guestMessageCount >= guestWarningThreshold &&
    guestMessageCount < GUEST_MESSAGE_LIMIT;
  const isGuestAtLimit = scope?.kind === "guest" && guestMessageCount >= GUEST_MESSAGE_LIMIT;
  const composerIsContextWarning = isContextWarning || isGuestNearLimit;
  const normalizedAccountPlan =
    accountPlan === "plus" ? "plus" : accountPlan === "free" ? "free" : null;
  const planPillLabel = normalizedAccountPlan === "plus" ? "Plus" : "Free";
  const signedInFolderLimit = isAuthenticated && normalizedAccountPlan === "free" ? 15 : null;
  const composerChatFullState = isGuestAtLimit ? "full" : chatFullState;
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [guestInfoBannerEntered, setGuestInfoBannerEntered] = useState(false);
  const userMetadata = ((user as any)?.user_metadata ?? {}) as Record<string, any>;
  const identities = (user as any)?.identities;
  const googleIdentityData =
    (Array.isArray(identities)
      ? identities.find((entry: any) => entry?.provider === "google")?.identity_data
      : null) ?? {};
  const avatarUrl =
    (userMetadata.avatar_url as string | undefined) ||
    (userMetadata.picture as string | undefined) ||
    (googleIdentityData.avatar_url as string | undefined) ||
    (googleIdentityData.picture as string | undefined);
  const fullName = (userMetadata.full_name as string | undefined) || (userMetadata.name as string | undefined) || "";
  const userInitial = (fullName.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "U");
  const [loadedAvatarUrl, setLoadedAvatarUrl] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const canRenderAvatarImage = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl;
  const isAvatarImageLoaded = Boolean(avatarUrl) && loadedAvatarUrl === avatarUrl;

  const handlePurchasePlus = useCallback(async () => {
    if (!onPurchasePlus) return;
    try {
      setBillingActionLoading(true);
      await onPurchasePlus();
    } finally {
      setBillingActionLoading(false);
    }
  }, [onPurchasePlus]);

  const handleManageBilling = useCallback(async () => {
    if (!onManageBilling) return;
    try {
      setBillingActionLoading(true);
      await onManageBilling();
    } finally {
      setBillingActionLoading(false);
    }
  }, [onManageBilling]);

  // Create a wrapper for togglePin that includes sessionId
  const handleTogglePin = useCallback(async (memoryId: number) => {
    if (!activeSessionId) {
      console.error("[TOGGLE_PIN] No active session");
      return;
    }
    await togglePin(activeSessionId, memoryId);
  }, [activeSessionId, togglePin]);
  
  // Handler to open memory reader overlay for a specific memory
  const openMemoryReaderOverlay = (memoryId: number) => {
    if (draftMemory) {
      setDraftMemory(null);
    }
    setSelectedMemoryId(memoryId);
    setMemoryOverlayOpen(true);
  };
  
  const overlayActuallyOpen = !!(memoryOverlayOpen && (selectedMemoryId != null || !!draftMemory));

  // On reload, `activeSessionId` starts null before restoration effects run.
  // If we likely have a session to restore (based on per-tab keys), do NOT force landing,
  // otherwise the UI will briefly show landing and then "pop" into the active chat.
  const suppressForceLandingOnReloadRef = React.useRef<boolean | null>(null);
  if (typeof window !== "undefined" && suppressForceLandingOnReloadRef.current === null) {
    let suppress = false;
    try {
      if (isReload) {
        const openLanding = sessionStorage.getItem("db:openLanding") === "true";
        if (!openLanding) {
          const guestLast = sessionStorage.getItem("db:lastActiveSessionId");
          if (guestLast) {
            suppress = true;
          } else {
            const lastUserId = getLastUserId();
            if (lastUserId) {
              const userLanding = sessionStorage.getItem(`db:userLanding:${lastUserId}`) === "1";
              if (!userLanding) {
                const lastSession = sessionStorage.getItem(`db:lastSession:${lastUserId}`);
                if (lastSession) suppress = true;
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
    suppressForceLandingOnReloadRef.current = suppress;
  }

  const forceLanding =
    !activeSessionId &&
    !overlayActuallyOpen &&
    !(isRestoringLastSession ?? false) &&
    !(isReload && suppressForceLandingOnReloadRef.current === true);
  const effectiveIsLanding = forceLanding ? true : isLanding;
  const effectiveStageForRender = forceLanding ? (stageForRender ?? 0) : stageForRender;
  const shouldMountLanding = forceLanding || (showLandingHeader && !suppressLanding);
  const landingLogoShiftPx = (effectiveStageForRender ?? 0) >= 2 ? 228 : 0;

  // Hydration gate: disable animations during initial render and on tab resume
  const [uiHydrating, setUiHydrating] = React.useState(true);
  const [userDropdownOpen, setUserDropdownOpen] = React.useState(false);
  const [homeOverlayMounted, setHomeOverlayMounted] = React.useState(false);
  const [homeOverlayVisible, setHomeOverlayVisible] = React.useState(false);
  const [homeIframeLoaded, setHomeIframeLoaded] = React.useState(false);
  const homeOverlayWarmRef = React.useRef(false);
  const [profileOverlayOpen, setProfileOverlayOpen] = React.useState(false);
  const [profileOverlayVisible, setProfileOverlayVisible] = React.useState(false);
  const profileOverlayCloseTimerRef = React.useRef<number | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const disableMotion = uiHydrating || (isResuming ?? false);
  // Controls the max-width morph (narrow -> wide). Default to narrow so refresh-in-chat doesn't "shrink then expand".
  const [composerWide, setComposerWide] = React.useState<boolean>(false);
  const [animateLandingComposerTransform, setAnimateLandingComposerTransform] = React.useState(false);
  const landingTransformTimerRef = React.useRef<number | null>(null);
  const prevLandingAttachedCountRef = React.useRef<number>(landingAttachedCount);
  const startLandingComposerTransformFollow = React.useCallback(() => {
    setAnimateLandingComposerTransform(true);
    if (landingTransformTimerRef.current != null) {
      window.clearTimeout(landingTransformTimerRef.current);
    }
    landingTransformTimerRef.current = window.setTimeout(() => {
      setAnimateLandingComposerTransform(false);
      landingTransformTimerRef.current = null;
    }, 740);
  }, []);

  React.useEffect(() => {
    if (!guestInfoBannerVisible) {
      setGuestInfoBannerEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => setGuestInfoBannerEntered(true));
    return () => cancelAnimationFrame(id);
  }, [guestInfoBannerVisible]);

  React.useEffect(() => {
    setUiHydrating(false);
  }, []);

  React.useEffect(() => {
    if (!effectiveIsLanding) {
      prevLandingAttachedCountRef.current = landingAttachedCount;
      setAnimateLandingComposerTransform(false);
      if (landingTransformTimerRef.current != null) {
        window.clearTimeout(landingTransformTimerRef.current);
        landingTransformTimerRef.current = null;
      }
      return;
    }

    const prevCount = prevLandingAttachedCountRef.current;
    if (prevCount !== landingAttachedCount) {
      startLandingComposerTransformFollow();
    }
    prevLandingAttachedCountRef.current = landingAttachedCount;
  }, [effectiveIsLanding, landingAttachedCount, startLandingComposerTransformFollow]);

  React.useEffect(() => {
    return () => {
      if (landingTransformTimerRef.current != null) {
        window.clearTimeout(landingTransformTimerRef.current);
        landingTransformTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const warmProfileChunk = async () => {
      const profileModule = await import("@/components/profile/ProfileView");
      if (cancelled) return;
      if (scope?.kind === "user" && typeof profileModule.prefetchProfileForScope === "function") {
        void profileModule.prefetchProfileForScope(scope as any);
      }
    };
    if ("requestIdleCallback" in window) {
      const idleId = (window as any).requestIdleCallback(warmProfileChunk, { timeout: 1400 });
      return () => {
        cancelled = true;
        if ("cancelIdleCallback" in window) (window as any).cancelIdleCallback(idleId);
      };
    }
    const timer = setTimeout(warmProfileChunk, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope?.kind, (scope as any)?.userId]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (homeOverlayWarmRef.current) return;

    let cancelled = false;
    let stageTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const warmHomeOverlay = () => {
      if (cancelled || homeOverlayWarmRef.current) return;
      try {
        if (router && typeof (router as any).prefetch === "function") {
          (router as any).prefetch("/home");
        } else {
          void fetch("/home", { method: "GET", credentials: "same-origin" });
        }
      } catch {
        // ignore warmup failures
      }
      // Keep the iframe mounted (hidden) after warmup to avoid first-open jank.
      setHomeOverlayMounted(true);
      homeOverlayWarmRef.current = true;
    };

    // Stagger home warmup behind profile warmup to keep startup responsive.
    stageTimer = setTimeout(() => {
      if (cancelled) return;
      if ("requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(warmHomeOverlay, { timeout: 2600 });
        return;
      }
      fallbackTimer = setTimeout(warmHomeOverlay, 1200);
    }, 700);

    return () => {
      cancelled = true;
      if (stageTimer != null) clearTimeout(stageTimer);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
      if (idleId != null && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [router]);

  const openHomeOverlay = React.useCallback(() => {
    setHomeOverlayMounted(true);
    requestAnimationFrame(() => setHomeOverlayVisible(true));
  }, []);

  const closeHomeOverlay = React.useCallback(() => {
    setHomeOverlayVisible(false);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = (event.data as { type?: string } | null)?.type;
      if (type === "db-home-overlay-close") {
        closeHomeOverlay();
        return;
      }
      if (type === "db-home-overlay-open-archive") {
        router.push("/archive");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [closeHomeOverlay, router]);

  const openProfileOverlay = React.useCallback(() => {
    if (profileOverlayCloseTimerRef.current != null) {
      window.clearTimeout(profileOverlayCloseTimerRef.current);
      profileOverlayCloseTimerRef.current = null;
    }
    setProfileOverlayOpen(true);
    requestAnimationFrame(() => setProfileOverlayVisible(true));
  }, []);

  const closeProfileOverlay = React.useCallback(() => {
    setProfileOverlayVisible(false);
    if (profileOverlayCloseTimerRef.current != null) {
      window.clearTimeout(profileOverlayCloseTimerRef.current);
      profileOverlayCloseTimerRef.current = null;
    }
    profileOverlayCloseTimerRef.current = window.setTimeout(() => {
      setProfileOverlayOpen(false);
      profileOverlayCloseTimerRef.current = null;
    }, 220);
  }, []);

  React.useEffect(() => {
    return () => {
      if (profileOverlayCloseTimerRef.current != null) {
        window.clearTimeout(profileOverlayCloseTimerRef.current);
        profileOverlayCloseTimerRef.current = null;
      }
    };
  }, []);

  // Horizontal "morph" into the docked composer width:
  // - Landing stays narrow.
  // - Docked animates from narrow -> wide on refresh or when transitioning into an active chat.
  React.useEffect(() => {
    // Don't run this on "resume" (tab switch) - keep the current width stable.
    if (isResuming) return;
    // During initial hydration, we want docked refresh to start narrow, then expand once.
    if (uiHydrating) return;
    if (effectiveIsLanding) {
      setComposerWide(false);
      return;
    }
    // Start narrow for 1 paint, then expand so max-width transitions.
    setComposerWide(false);
    const id = requestAnimationFrame(() => setComposerWide(true));
    return () => cancelAnimationFrame(id);
  }, [disableMotion, effectiveIsLanding]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!userDropdownOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userDropdownOpen]);

  return (
      <div
        data-hydrating={disableMotion ? "true" : "false"}
        className={
          "flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden" +
          (disableMotion ? " [&_*]:!transition-none [&_*]:!animate-none" : "")
        }
      >
        {/* Content area with sidebar - 5-column grid */}
        {(() => {
          // Compute rail widths based on layout mode
          const leftRailW = layoutMode === "narrow" ? 4 : layoutMode === "medium" ? 4 : LEFT_RAIL_W_CLEAN;
          const rightRailW = layoutMode === "narrow" ? 4 : layoutMode === "medium" ? 4 : RIGHT_RAIL_W_CLEAN;
        
          // In narrow mode, panels are overlays (not in grid)
          const isNarrow = layoutMode === "narrow";
          // Keep 16px sliver when closed so shadow always has a surface to cast from
          const leftPanelW = isNarrow ? 0 : (sidebarHidden ? 16 : LEFT_PANEL_W_CLEAN);
          const rightPanelW = isNarrow ? 0 : (rightDockHidden ? 16 : RIGHT_PANEL_W_CLEAN);
        
          const bothPanelsClosed = sidebarHidden && rightDockHidden;
          const centerPadding = isNarrow ? 12 : bothPanelsClosed ? 56 : 16;
        
          return (
            <div 
              className="h-full w-full grid bg-gray-900 overflow-x-hidden overflow-y-hidden"
              style={{
                gridTemplateColumns: `${leftPanelW}px ${leftRailW}px minmax(0, 1fr) ${rightRailW}px ${rightPanelW}px`,
                transition: disableMotion ? "none" : `grid-template-columns ${SLIDE_MS}ms ${SLIDE_EASE}`,
                willChange: "grid-template-columns",
              }}
            >

          {/* Column 1: LeftPanel (sidebar) */}
          <div className="min-w-0 overflow-x-hidden overflow-y-hidden md:block">
            {/* Always render drawer wrapper, animate width/opacity */}
              <div className="h-full">
                {/* Desktop sidebar */}
                <div className="overflow-visible relative h-full min-h-0">
            <DndContext
              sensors={sensors}
              autoScroll={DND_AUTO_SCROLL_OPTIONS}
              collisionDetection={collisionDetection}
              modifiers={modifiers}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              {/* Drawer wrapper: keep mounted; animate width like RightDock for smoother parity */}
              <div
                className={
                  "flex h-full overflow-x-hidden overflow-y-hidden relative z-40 bg-gray-900 min-w-0 " +
                  (!sidebarHidden && layoutMode !== "narrow" ? "border-r border-gray-700/50" : "")
                }
                style={{
                  width: sidebarHidden ? 16 : LEFT_PANEL_W_CLEAN,
                  transition: disableMotion ? "none" : "width 300ms ease-in-out, opacity 300ms ease-in-out",
                  willChange: "width, opacity",
                }}
              >
                <div
                  className={
                    "flex h-full w-full min-w-0 " +
                    (sidebarHidden ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto")
                  }
                  style={{
                    transition: "opacity 220ms ease-in-out",
                    background:
                      "linear-gradient(180deg, rgba(23, 37, 84, 0.35) 0%, rgba(17, 24, 39, 0.5) 100%)",
                  }}
                  aria-hidden={sidebarHidden}
                >
                <FolderRail
                  key={scope ? `${scope.kind}:${"userId" in scope ? scope.userId : scope.guestId}` : "scope-loading"}
              folders={folders}
                  selectedFolderId={selectedFolderId}
                  sessions={sidebarSessions}
                  onFolderSelect={handleFolderSelect}
                  onRenameFolder={handleRenameFolder}
                  onStartRenameFolder={setStartRenameFolderId}
                  onDeleteFolder={handleDeleteFolder}
                  onDeleteFolderAndChats={handleDeleteFolderAndChats}
                  onCreateFolder={handleCreateFolder}
                  onSetFolderIcon={onSetFolderIcon}
                  activeId={activeDragId}
                  currentOverId={currentOverId}
                  currentInsert={currentInsert}
                  folderListContainerRef={leftFolderListRef}
                  onOpenHomeOverlay={openHomeOverlay}
                  onResetToLanding={handleCreateSession}
                  scope={scope}
                  onFolderAppearanceChange={setLeftFolderAppearance}
                  disableRailItemMotion={disableRailItemMotion}
                  maxFolders={signedInFolderLimit}
                />
                {chatNavigatorEl}
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {dragOverlaySessionId != null ? (
                  (() => {
                    const s =
                      sidebarSessions.find((x: any) => x.id === dragOverlaySessionId) ||
                      sessions.find((x: any) => x.id === dragOverlaySessionId)
                    if (!s) return null
                    const title = (s as any).title || "Untitled chat"
                    return (
                      <div className="w-56 max-w-[240px] rounded-md px-2.5 py-1.5 bg-slate-800/95 border border-slate-600/50 shadow-xl"
                           style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-[3px] h-7 rounded-full bg-blue-400/90 flex-shrink-0" />
                          <div className="text-sm font-medium text-gray-100 truncate min-w-0">{title}</div>
                        </div>
                      </div>
                    )
                  })()
                ) : activeDragId?.startsWith("folder-") && !activeDragId.startsWith("memory-folder-") ? (
                  (() => {
                    const folderId = parseInt(activeDragId.replace("folder-", ""));
                    const folder = folders.find((f: any) => f.id === folderId);
                    if (!folder) return null;
                    const effectiveIcon = leftFolderAppearance[folderId]?.icon ?? folder.icon;
                    const effectiveColor = leftFolderAppearance[folderId]?.color;
                    return (
                      <div
                        className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#1F2937] border border-blue-400/30 shadow-[0_8px_24px_rgba(0,0,0,0.4)] text-gray-100"
                        style={{ opacity: 0.95, transform: "scale(1.03)" }}
                      >
                        <FolderBubbleIconContent displayIcon={effectiveIcon} displayColor={effectiveColor} />
                      </div>
                    );
                  })()
                ) : null}
              </DragOverlay>
            </DndContext>
                </div>
              </div>
            </div>

          {/* Column 2: LeftRail */}
          <div className="block bg-transparent pointer-events-none" aria-hidden="true">
            {/* Rail is structural only - no buttons */}
          </div>

          {/* DND CONTEXT (memory drags must share context with chat dropzone) */}
          <DndContext
            sensors={sensors}
            autoScroll={DND_AUTO_SCROLL_OPTIONS}
            collisionDetection={collisionDetection}
            modifiers={modifiers}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
          {/* Column 3: Chat */}
          <div className="min-w-0 relative h-full min-h-0 overflow-x-visible overflow-y-hidden">
            <div className="h-full flex flex-col bg-gray-900 relative overflow-x-visible overflow-y-hidden">
            <ToastContainer
              toasts={toasts}
              containerClassName="absolute top-[56px] right-3 z-[120] space-y-2 max-w-[min(360px,calc(100%-0.75rem))]"
            />
            {guestInfoBannerVisible && !memoryOverlayOpen && (
              <div
                className="pointer-events-none absolute inset-x-0 top-[56px] z-[116] flex justify-center"
                style={{
                  paddingLeft: centerPadding,
                  paddingRight: centerPadding,
                }}
              >
                <div
                  className={
                    "pointer-events-auto relative w-full mx-auto overflow-hidden rounded-2xl bg-[#0b1733] shadow-[0_8px_22px_rgba(0,0,0,0.36),inset_0_0_0_1px_rgba(96,165,250,0.10)] transition-all duration-300 ease-out " +
                    (guestInfoBannerEntered ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-1 scale-[0.99]")
                  }
                  style={{
                    maxWidth: effectiveIsLanding ? 672 : composerWide ? 896 : 672,
                  }}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sky-400/4 to-transparent" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-sky-400/4 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/35 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-200/35 to-transparent" />
                  <div className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                    <span
                      className={
                        "inline-flex shrink-0 items-center rounded-full border border-sky-300/40 bg-sky-400/12 px-2.5 py-1 text-[10px] font-semibold text-sky-100 " +
                        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]"
                      }
                    >
                      <span className="uppercase tracking-[0.08em]">Guest</span>
                      <span className="mx-1.5 h-3.5 w-px bg-sky-200/35" />
                      <span className="text-amber-100">Sign-in required</span>
                    </span>
                    <p className="min-w-0 flex-1 text-center text-[13.5px] leading-5 text-slate-100/92 lg:whitespace-nowrap lg:overflow-hidden lg:text-ellipsis">
                      Sign in to send messages and use AI features.
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onGuestInfoBannerSignIn?.()}
                        className="rounded-lg border border-sky-300/35 bg-sky-400/12 px-3 py-1.5 text-xs font-medium text-sky-100 transition-all duration-200 hover:bg-sky-400/22 hover:border-sky-300/45 hover:text-sky-50 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.22),0_4px_14px_rgba(14,116,144,0.22)]"
                      >
                        Log In
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissGuestInfoBanner?.()}
                        className="inline-flex h-7 w-7 items-center justify-center text-slate-300/90 hover:text-red-300 transition-colors"
                        aria-label="Dismiss guest mode notice"
                        title="Dismiss"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* TopBar */}
            <div
              className="absolute inset-x-0 top-0 h-[48px] z-40 flex items-center justify-between border-b border-white/10 bg-gray-900/50 backdrop-blur shadow-[0_4px_12px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)]"
              style={{ 
                paddingLeft: leftRailW, 
                paddingRight: rightRailW 
              }}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleLeft()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.03] active:translate-y-0 active:scale-100"
                  aria-label="Toggle sidebar"
                  title="Toggle sidebar"
                >
                  <svg
                    className="w-5 h-5 block"
                    viewBox="-5.0 -10.0 110.0 135.0"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ transform: 'translateY(2px) scale(1.8)' }}
                  >
                    <defs>
                      <linearGradient id="sidebarIconGradientTopBar" x1="0" y1="0" x2="110" y2="135" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>
                    {sidebarHidden ? (
                      <path
                        d="m81 16.082h-62c-5.8906 0-10.668 4.7773-10.668 10.668v46.5c0 2.8281 1.125 5.543 3.125 7.543s4.7148 3.125 7.543 3.125h62c5.8906 0 10.668-4.7773 10.668-10.668v-46.5c0-5.8906-4.7773-10.668-10.668-10.668zm-66.832 57.168v-46.5c0-2.668 2.1641-4.832 4.832-4.832h20.332v56.164h-20.332c-2.668 0-4.832-2.1641-4.832-4.832zm71.668 0h-0.003907c0 2.668-2.1641 4.832-4.832 4.832h-35.832v-56.164h35.832c1.2812 0 2.5117 0.50781 3.418 1.4141s1.4141 2.1367 1.4141 3.418zm-13.625-24.668h-0.003907c0.625 0.84375 0.625 1.9922 0 2.8359l-9.707 13.082c-0.64844 0.69141-1.6406 0.9375-2.5391 0.63281-0.89844-0.30469-1.5352-1.1055-1.6289-2.0508v-26.207c0.074219-0.95703 0.71484-1.7773 1.625-2.0781 0.91406-0.30078 1.9141-0.023437 2.543 0.70312z"
                        fill="url(#sidebarIconGradientTopBar)"
                      />
                    ) : (
                      <path
                        d="m81 16.082h-62c-5.8906 0-10.668 4.7773-10.668 10.668v46.5c0 2.8281 1.125 5.543 3.125 7.543s4.7148 3.125 7.543 3.125h62c5.8906 0 10.668-4.7773 10.668-10.668v-46.5c0-5.8906-4.7773-10.668-10.668-10.668zm-66.832 57.168v-46.5c0-2.668 2.1641-4.832 4.832-4.832h20.332v56.164h-20.332c-2.668 0-4.832-2.1641-4.832-4.832zm71.668 0h-0.003907c0 2.668-2.1641 4.832-4.832 4.832h-35.832v-56.164h35.832c1.2812 0 2.5117 0.50781 3.418 1.4141s1.4141 2.1367 1.4141 3.418zm-13.168-36.332v26.168-0.003907c-0.058594 0.96484-0.69141 1.8008-1.6094 2.1133-0.91406 0.30859-1.9258 0.035157-2.5586-0.69531l-9.543-13.082c-0.58594-0.85547-0.58594-1.9805 0-2.8359l9.375-13.082c0.59766-0.87109 1.6953-1.2422 2.6992-0.91406 1.0039 0.32812 1.668 1.2773 1.6367 2.332z"
                        fill="url(#sidebarIconGradientTopBar)"
                      />
                    )}
                  </svg>
                </button>

              <button
                type="button"
                onClick={() => handleCreateSession()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.03] active:translate-y-0 active:scale-100"
                aria-label="New Chat"
                title="New Chat"
              >
                <svg
                  className="h-[29px] w-[29px] block overflow-visible"
                  viewBox="-0.8 -0.8 17.6 21.6"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ transform: "translate(1px, 1px)" }}
                >
                  <defs>
                    <linearGradient
                      id="newChatIconGradientTopBar"
                      x1="0"
                      y1="0"
                      x2="16"
                      y2="20"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                  {/* From noun-new-chat-1516472.svg (text removed) */}
                  <path
                    d="M2.5,16c-0.071,0-0.142-0.015-0.209-0.046C2.114,15.873,2,15.695,2,15.5V13c-1.103,0-2-0.897-2-2V5c0-1.103,0.897-2,2-2h4.5C6.776,3,7,3.224,7,3.5S6.776,4,6.5,4H2C1.449,4,1,4.449,1,5v6c0,0.552,0.449,1,1,1h0.5C2.776,12,3,12.224,3,12.5v1.913l2.675-2.293C5.765,12.043,5.881,12,6,12h5c0.552,0,1-0.448,1-1V9.5C12,9.224,12.224,9,12.5,9S13,9.224,13,9.5V11c0,1.103-0.897,2-2,2H6.185l-3.36,2.88C2.733,15.959,2.617,16,2.5,16z"
                    fill="url(#newChatIconGradientTopBar)"
                    stroke="url(#newChatIconGradientTopBar)"
                    strokeWidth="0.4"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12,8C9.794,8,8,6.206,8,4s1.794-4,4-4s4,1.794,4,4S14.206,8,12,8zM12,1c-1.654,0-3,1.346-3,3s1.346,3,3,3s3-1.346,3-3S13.654,1,12,1z"
                    fill="url(#newChatIconGradientTopBar)"
                    stroke="url(#newChatIconGradientTopBar)"
                    strokeWidth="0.6"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12,6c-0.276,0-0.5-0.224-0.5-0.5v-3C11.5,2.224,11.724,2,12,2s0.5,0.224,0.5,0.5v3C12.5,5.776,12.276,6,12,6z"
                    fill="url(#newChatIconGradientTopBar)"
                    stroke="url(#newChatIconGradientTopBar)"
                    strokeWidth="0.6"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path
                    d="M13.5,4.5h-3C10.224,4.5,10,4.276,10,4s0.224-0.5,0.5-0.5h3C13.776,3.5,14,3.724,14,4S13.776,4.5,13.5,4.5z"
                    fill="url(#newChatIconGradientTopBar)"
                    stroke="url(#newChatIconGradientTopBar)"
                    strokeWidth="0.6"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              {isAuthenticated && normalizedAccountPlan === "free" && (
                <button
                  type="button"
                  onClick={() => setUpgradeModalOpen(true)}
                  className="inline-flex h-7 items-center rounded-full border border-blue-400/30 px-3 text-[11px] font-semibold uppercase tracking-wide text-blue-100 transition-all duration-300 ease-out hover:scale-105 hover:border-blue-400/45 hover:text-blue-50 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  style={{
                    background:
                      "linear-gradient(to right, rgba(37, 99, 235, 0.24), rgba(59, 130, 246, 0.2)), rgb(30, 36, 56)",
                    boxShadow: "0px 6px 18px rgba(0,0,0,0.28)",
                  }}
                  title="Current plan: Free. Click to compare plans."
                >
                  Free
                </button>
              )}
              {isAuthenticated && normalizedAccountPlan === "plus" && (
                <button
                  type="button"
                  onClick={() => setUpgradeModalOpen(true)}
                  className="inline-flex h-7 items-center rounded-full border border-blue-400/30 px-3 text-[11px] font-semibold uppercase tracking-wide text-blue-100 transition-all duration-300 ease-out hover:scale-105 hover:border-blue-400/45 hover:text-blue-50 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  style={{
                    background:
                      "linear-gradient(to right, rgba(37, 99, 235, 0.24), rgba(99, 102, 241, 0.22), rgba(139, 92, 246, 0.2)), rgb(30, 36, 56)",
                    boxShadow: "0px 6px 18px rgba(0,0,0,0.28)",
                  }}
                  title="Current plan: Plus. Click to view plan details and billing."
                >
                  {planPillLabel}
                </button>
              )}
              </div>

              {/* Center: memory dates (and an overlay slot for the editor toolbar) OR hour pill */}
              {memoryOverlayOpen ? (
                <div className="relative min-w-0 flex-1 flex items-center justify-center">
                  {/* Portal target for MemoryPreview's formatting toolbar (shown only while editing) */}
                  <div
                    id="db-memory-topbar-toolbar"
                    className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-1"
                    style={{
                      opacity: memoryToolbarVisible ? 1 : 0,
                      pointerEvents: memoryToolbarVisible ? "auto" : "none",
                      transition: "opacity 140ms ease-out",
                    }}
                  />

                  <div
                    className="min-w-0 flex items-center gap-3 text-[12px] text-gray-400/80"
                    style={{
                      opacity: memoryToolbarVisible ? 0 : 1,
                      pointerEvents: memoryToolbarVisible ? "none" : "auto",
                      transition: "opacity 140ms ease-out",
                    }}
                  >
                    {(() => {
                      const m: any = selectedMemoryId ? (memories.find((x: any) => x.id === selectedMemoryId) as any) : null;
                      const saved = m?.created_at ? new Date(m.created_at) : null;
                      const msg = m?.message_created_at ? new Date(m.message_created_at) : null;
                      const fmt = (d: Date | null) =>
                        d && !Number.isNaN(d.getTime())
                          ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                          : null;
                      const savedLabel = fmt(saved);
                      const msgLabel = fmt(msg);
                      return (
                        <>
                          {savedLabel && <span className="truncate">Saved: {savedLabel}</span>}
                          {msgLabel && <span className="truncate">Message: {msgLabel}</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                activeSessionId && messages.length > 0 && (
              <button
                type="button"
                    onClick={() => {
                      if (activeHourKey) scrollToHour(activeHourKey);
                    }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-blue-400/30 text-[11px] uppercase tracking-wide text-gray-300 transition-all duration-300 ease-out hover:scale-105 hover:border-blue-400/45 hover:text-blue-50 hover:bg-slate-700/60 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  title="Jump to current time bucket"
                >
                  {(() => {
                      const b = activeHourKey ? hourBuckets.find((x: any) => x.hourKey === activeHourKey) : null;
                    return b?.label ?? "";
                  })()}
                </button>
                )
              )}

              <div className="flex items-center gap-2">
                {(isAuthenticated || authLoading) ? (
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isAuthenticated) {
                          setUserDropdownOpen(!userDropdownOpen);
                        }
                      }}
                      className={`inline-flex h-7 w-7 translate-y-[3px] items-center justify-center rounded-full overflow-hidden transition-all duration-200 ${
                        isAuthenticated
                          ? "bg-gradient-to-br from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                          : "bg-slate-700/60 border border-slate-500/35 animate-pulse"
                      }`}
                      aria-label="User menu"
                      title="User menu"
                      disabled={!isAuthenticated}
                    >
                      <span className="relative block h-7 w-7">
                        {isAuthenticated && canRenderAvatarImage && (
                          <img
                            src={avatarUrl}
                            alt="Profile"
                            className={`absolute inset-0 block h-full w-full rounded-full object-cover transition-opacity duration-150 ${
                              isAvatarImageLoaded ? "opacity-100" : "opacity-0"
                            }`}
                            style={{ objectPosition: "center 58%" }}
                            referrerPolicy="no-referrer"
                            decoding="async"
                            loading="eager"
                            onLoad={() => setLoadedAvatarUrl(avatarUrl || null)}
                            onError={() => setFailedAvatarUrl(avatarUrl || null)}
                          />
                        )}
                        {(isAuthenticated && canRenderAvatarImage) || authLoading ? (
                          <span
                            className={`absolute inset-0 inline-flex items-center justify-center rounded-full bg-slate-700/60 border border-slate-500/35 transition-opacity duration-150 ${
                              isAuthenticated && isAvatarImageLoaded ? "opacity-0" : "opacity-100"
                            }`}
                            aria-hidden
                          />
                        ) : (
                          <span className="absolute inset-0 inline-flex items-center justify-center text-sm font-medium text-white">
                            {userInitial}
                          </span>
                        )}
                      </span>
                    </button>

	                    {isAuthenticated && userDropdownOpen && (
	                      <div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-slate-800 border border-blue-500/20 shadow-lg backdrop-blur-sm z-50">
                        <div className="p-3 border-b border-blue-500/10">
                          <p className="text-sm font-medium text-white truncate">
                            {user?.email || 'Unknown user'}
                          </p>
                          <p className="text-xs text-gray-400">
                            Signed in
                          </p>
                        </div>
                        <div className="p-1">
                          <button
                            type="button"
                            onClick={() => {
                              onSignOut();
                              setUserDropdownOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                          >
                            Sign out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
	                ) : (
                  <button
                    type="button"
                    onClick={onLoginClick}
                    className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-blue-400 transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.02] active:translate-y-0 active:scale-100"
                    aria-label="Log In"
                    title="Log In"
                  >
                    Log In
                  </button>
                )}
                <button
                  type="button"
                  onClick={openProfileOverlay}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.03] active:translate-y-0 active:scale-100"
                  aria-label="Profile"
                  title="Profile"
                >
                  <svg
                    className="w-6 h-6 block"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                    style={{ transform: "translateY(1px)" }}
                  >
                    <defs>
                      <linearGradient id="profileCogIconGradientTopBar" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.066 2.572c1.756.427 1.756 2.925 0 3.352a1.724 1.724 0 0 0-1.066 2.572c.94 1.543-.827 3.31-2.37 2.37a1.724 1.724 0 0 0-2.573 1.067c-.426 1.755-2.924 1.755-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.827-2.37-2.37a1.724 1.724 0 0 0-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.827-3.31 2.37-2.37.996.607 2.296.07 2.573-1.066Z"
                      stroke="url(#profileCogIconGradientTopBar)"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3.15" stroke="url(#profileCogIconGradientTopBar)" strokeWidth="1.9" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => toggleRight()}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.03] active:translate-y-0 active:scale-100 ${
                    rightDockHidden ? "" : "drop-shadow-[0_0_12px_rgba(99,102,241,0.7),0_0_20px_rgba(99,102,241,0.4)]"
                  }`}
                  aria-label="Toggle right dock"
                  title="Toggle right dock"
                >
                  <svg
                    className="w-5 h-5 block"
                  viewBox="-5.0 -10.0 110.0 135.0"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                    style={{ transform: "scaleX(-1) scale(1.8) translateY(2px)" }}
                >
                  <defs>
                      <linearGradient id="rightPanelIconGradientTopBar" x1="110" y1="0" x2="0" y2="135" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                    {rightDockHidden ? (
                    <path
                      d="m81 16.082h-62c-5.8906 0-10.668 4.7773-10.668 10.668v46.5c0 2.8281 1.125 5.543 3.125 7.543s4.7148 3.125 7.543 3.125h62c5.8906 0 10.668-4.7773 10.668-10.668v-46.5c0-5.8906-4.7773-10.668-10.668-10.668zm-66.832 57.168v-46.5c0-2.668 2.1641-4.832 4.832-4.832h20.332v56.164h-20.332c-2.668 0-4.832-2.1641-4.832-4.832zm71.668 0h-0.003907c0 2.668-2.1641 4.832-4.832 4.832h-35.832v-56.164h35.832c1.2812 0 2.5117 0.50781 3.418 1.4141s1.4141 2.1367 1.4141 3.418zm-13.625-24.668h-0.003907c0.625 0.84375 0.625 1.9922 0 2.8359l-9.707 13.082c-0.64844 0.69141-1.6406 0.9375-2.5391 0.63281-0.89844-0.30469-1.5352-1.1055-1.6289-2.0508v-26.207c0.074219-0.95703 0.71484-1.7773 1.625-2.0781 0.91406-0.30078 1.9141-0.023437 2.543 0.70312z"
                        fill="url(#rightPanelIconGradientTopBar)"
                    />
                  ) : (
                    <path
                      d="m81 16.082h-62c-5.8906 0-10.668 4.7773-10.668 10.668v46.5c0 2.8281 1.125 5.543 3.125 7.543s4.7148 3.125 7.543 3.125h62c5.8906 0 10.668-4.7773 10.668-10.668v-46.5c0-5.8906-4.7773-10.668-10.668-10.668zm-66.832 57.168v-46.5c0-2.668 2.1641-4.832 4.832-4.832h20.332v56.164h-20.332c-2.668 0-4.832-2.1641-4.832-4.832zm71.668 0h-0.003907c0 2.668-2.1641 4.832-4.832 4.832h-35.832v-56.164h35.832c1.2812 0 2.5117 0.50781 3.418 1.4141s1.4141 2.1367 1.4141 3.418zm-13.168-36.332v26.168-0.003907c-0.058594 0.96484-0.69141 1.8008-1.6094 2.1133-0.91406 0.30859-1.9258 0.035157-2.5586-0.69531l-9.543-13.082c-0.58594-0.85547-0.58594-1.9805 0-2.8359l9.375-13.082c0.59766-0.87109 1.6953-1.2422 2.6992-0.91406 1.0039 0.32812 1.668 1.2773 1.6367 2.332z"
                        fill="url(#rightPanelIconGradientTopBar)"
                    />
                  )}
                </svg>
              </button>
            </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 top-[48px] h-4 bg-gradient-to-b from-black/30 via-black/12 to-transparent"
                style={{ zIndex: 35 }}
              />
          </div>
          <PricingModal
            isOpen={upgradeModalOpen}
            currentPlan={normalizedAccountPlan ?? "free"}
            freeLimits={PLAN_LIMITS.free}
            plusLimits={PLAN_LIMITS.plus}
            billingActionLoading={billingActionLoading}
            onClose={() => {
              if (!billingActionLoading) setUpgradeModalOpen(false);
            }}
            onPurchasePlus={() => {
              void handlePurchasePlus();
            }}
            onManageBilling={() => {
              void handleManageBilling();
            }}
          />
            {/* Landing welcome header (staged fade-in sync with composer slide) */}
            {shouldMountLanding && (
            <div
              className={
                "absolute inset-0 flex flex-col items-center justify-start px-6 transition-opacity duration-700 ease-out z-30 " +
                (forceLanding
                  ? "opacity-100 pointer-events-auto"
                  : overlayActuallyOpen
                  ? "opacity-0 pointer-events-none"
                  : isChatSwitching || isChatEntering || enterOpacity === 0 || landingFadeOut
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100 pointer-events-auto")
              }
              style={{ 
                paddingBottom: frozenPaddingBottom ?? (adjustedLandingLiftPx + composerHeight + 200), // Much much larger value
                paddingTop: '20vh',  // Increased top padding to move entire content down
                transform: 'translateY(0)',  // Ensure uniform positioning
                transitionDuration: overlayActuallyOpen ? "160ms" : undefined,
              }}
            >
              {/* Logo centered initially, then slides left; Title fades in after */}
              <div className={`relative w-full max-w-2xl mb-2 flex justify-center items-center ${landingFadeOut && !forceLanding ? 'pointer-events-none' : ''}`}>
                {/* Logo - starts at true center, slides left to final position */}
                <div
                  className={
                    landingFadeOut && !forceLanding
                      ? "absolute left-1/2 top-1/2" // freeze position; inherit opacity from parent
                      : "absolute left-1/2 top-1/2 transition-all duration-500 ease-out " +
                        (effectiveStageForRender >= 1 ? "opacity-100" : "opacity-0")
                  }
                  style={{
                    transform: `translate(calc(-50% - ${landingLogoShiftPx}px), -50%)`,
                    ...(landingFadeOut && !forceLanding ? { transition: "none", willChange: "auto" } : undefined),
                  }}
                >
                  <img
                    src="/dartz-icon.png"
                    alt="DartBoard"
                    className="w-[60px] h-[60px] -translate-x-[10px] -translate-y-[1px]"
                  />
                </div>
                {/* Title - fades in at center after logo slides */}
                <BrandHeading
                  as="h1"
                  className={
                    "text-center whitespace-nowrap " +
                    (landingFadeOut && !forceLanding ? "" : `transition-opacity duration-300 ${effectiveStageForRender >= 3 ? "opacity-100" : "opacity-0"}`)
                  }
                >
                  Welcome to DartBoard
                </BrandHeading>
              </div>
            
              {/* Subtitle + Mode group - sits closer to composer */}
              <div className="mt-0">
                <p
                  className={
                    "text-gray-400 text-base max-w-md text-center mb-2 " +
                    (landingFadeOut && !forceLanding ? "" : `transition-opacity duration-300 ${effectiveStageForRender >= 4 ? "opacity-100" : "opacity-0"}`)
                  }
                >
                  Your personal AI assistant. Start a conversation below.
                </p>
              
                {/* Mode selector */}
                <div
                  className={
                    "flex items-center justify-center gap-2 " +
                    (landingFadeOut && !forceLanding ? "" : `transition-opacity duration-300 ${effectiveStageForRender >= 5 ? "opacity-100" : "opacity-0"}`)
                  }
                >
                  <span className="text-xs text-gray-500 uppercase tracking-[0.18em]">MODE</span>
                  <FancyGlowingModeButton
                    onClick={() => {
                      const currentIndex = DARTZ_MODES.findIndex((m) => m.id === mode);
                      // If mode is somehow unknown (older DB value / stale state), still advance predictably.
                      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
                      const nextIndex = (safeIndex + 1) % DARTZ_MODES.length;
                      const nextMode = DARTZ_MODES[nextIndex]?.id ?? "tactical";
                      handleModeChange(nextMode);
                    }}
                  >
                    <ModeValueSlot value={getModeSpec(mode).label} />
                  </FancyGlowingModeButton>
                </div>
              </div>
            
              {/* Landing injected memories UI */}
              {/* Requirements:
                  - Brain icon is always visible on landing
                  - Brain sits OUTSIDE the big box (left)
                  - Big box shows dashed placeholder when empty, otherwise a 3x2 grid (max 6; last tile becomes +N more)
                  - X at top-right clears landing injected memories immediately
               */}
              <LandingInjectedMemories
                attachedCount={landingAttachedCount}
                attachedMemories={landingAttachedMemoriesWithPin}
                onDetachOne={detachMemoryFromLanding}
                onClearAll={clearLandingAttachedMemories}
                onCollapseStart={startLandingComposerTransformFollow}
                landingStage={effectiveStageForRender}
                onHeightChange={setLandingMemoryBoxHeight}
                landingFadeOut={landingFadeOut}
                usageRatio={memoryUsageRatio}
                onOpenAttachedMemory={openMemoryReaderOverlay}
                onTogglePin={toggleLandingPin}
              />
            </div>
            )}

            {/* Chat dropzone wrapper */}
            <div className="relative h-full w-full min-h-0">
              <ChatDropzoneTarget activeDragId={activeDragId} memoryOverlayOpen={memoryOverlayOpen} />

            {/* Messages scroll container (hidden when landing) */}
            <div
                ref={(node) => {
                  if (node && scrollContainerRef) {
                    // scrollContainerRef is managed by useChatScroll hook
                    if ('current' in scrollContainerRef) {
                      (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
                    }
                  }
                }}
              className={
                      `db-scroll-lane absolute top-0 overflow-y-auto overflow-x-hidden flex flex-col transition-opacity ease-in-out bg-gray-900 left-0 right-0 z-20 ${
                        effectiveIsLanding || overlayActuallyOpen ? "opacity-0 pointer-events-none duration-200" : ""
                }`
              }
              style={{
                paddingLeft: centerPadding,
                paddingRight: centerPadding,
                paddingTop: 64,
                bottom: composerHeight + 20,
                paddingBottom: messageStreamPadBottom,
                // Prevent browser scroll anchoring + prevent layout props (bottom/padding) from animating.
                overflowAnchor: "none",
                transitionProperty: "opacity",
                opacity: effectiveIsLanding || overlayActuallyOpen
                  ? 0
                  : chatSwapPhase !== "idle"
                  ? enterOpacity
                  : isChatSwitching
                  ? Math.min(CHAT_SWITCH_DIM_OPACITY, enterOpacity)
                  : enterOpacity,
                // Opacity-only chat switching (no translate, avoids "tiny scroll up" feel)
                transform: 'translateY(0)',
                transitionDuration: isOpeningMemory
                  ? "140ms"
                  : effectiveIsLanding
                  ? "500ms"
                  : chatSwapPhase === "out"
                  ? `${CHAT_SWAP_OUT_MS}ms`
                  : chatSwapPhase === "in"
                  ? `${CHAT_SWAP_IN_MS}ms`
                  : `${CHAT_ENTER_FADE_MS}ms`,
              }}
            >
              {/* Floating hour pill overlay removed - TopBar pill only */}
            
              {/* Flex spacer to push messages to bottom when content is short */}
              <div className="flex-1" aria-hidden />
            
              <div
                className={
                  "transition-[opacity,transform] ease-out will-change-[opacity,transform] " +
                  (isModeFading
                    ? "opacity-0 translate-y-0"
                    : "opacity-100 translate-y-0")
                }
                style={{
                  transitionDuration:
                    chatSwapPhase === "out"
                      ? `${CHAT_SWAP_OUT_MS}ms`
                      : chatSwapPhase === "in"
                      ? `${CHAT_SWAP_IN_MS}ms`
                      : "700ms",
                }}
              >
                {messagesTree}
              </div>
              <div aria-hidden style={{ height: 4 }} />
            </div>
            </div>

            {/* Memory reader overlay (keeps chat mounted, fades chat out, reveals top→bottom) */}
            <MemoryReaderOverlay
              open={memoryOverlayOpen}
              openDelayMs={140}
              // IMPORTANT: resolve the open memory from an unfiltered cache so folder changes don't blank the overlay.
              memory={
                draftMemory
                  ? null
                  : (() => {
                      const selId =
                        selectedMemoryId == null ? null : Number(selectedMemoryId);
                      if (selId == null || !Number.isFinite(selId)) return null;
                      const fromCache = getMemoryById ? getMemoryById(selId) : null;
                      if (fromCache) return fromCache;
                      // Fallback to state list (important right after creating a memory, before ref caches sync).
                      return (
                        (memories || []).find((m: Memory) => Number((m as any).id) === selId) ??
                        null
                      );
                    })()
              }
              draftMemory={draftMemory}
              folders={memoryFolders.map((f: any) => f.name)}
              folderObjects={memoryFolders}
              onFoldersChanged={loadMemoryFolders}
              centerPaddingPx={centerPadding}
              onClose={() => {
                setMemoryOverlayOpen(false);
                setForceEditMemoryId(null);
                setDraftMemory(null);
              }}
              onSave={handleMemorySave}
              onSaveDraft={async (draft: DraftMemory) => {
		                // Check if user is guest
		                if (scope?.kind === "guest") {
	                  const topPos = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
	                  // Resolve folder_name from folder_id (MemoryPreview passes folder_id)
	                  const folderId = (draft as any)?.folder_id ?? null;
	                  const folderName =
	                    folderId != null && memoryFolders?.length
	                      ? (memoryFolders.find((f: any) => f.id === folderId)?.name ?? "Unsorted")
	                      : (draft.folder_name || "Unsorted");

	                  const newMemory = {
	                    id: Date.now(),
	                    title: draft.title,
	                    summary: draft.summary,
	                    doc_json: (draft as any)?.doc_json ?? null,
	                    folder_name: folderName,
		                    created_at: new Date().toISOString(),
		                    session_id: draft.session_id || null,
	                    message_id: draft.message_id || null,
	                  };
	                  const normalizedId = upsertMemoryInCache?.(newMemory as any) ?? Number((newMemory as any).id);
	                  if (!Number.isFinite(normalizedId)) {
	                    throw new Error("Failed to resolve saved memory id");
	                  }

	                  const optimisticNew = { ...(newMemory as any), id: normalizedId, position: topPos };
	                  upsertMemoryInFolderCaches?.(optimisticNew as any);

	                  // Insert at top immediately (no refresh, and keeps it pinned to the top).
	                  setMemories((prev: any[]) => [
	                    optimisticNew,
	                    ...prev.filter((m: any) => Number(m?.id) !== normalizedId),
	                  ]);

	                  // Save to sessionStorage
	                  if (typeof window !== "undefined") {
	                    try {
	                      const stored = sessionStorage.getItem("db:guestMemories");
	                      const memories = stored ? JSON.parse(stored) : [];
	                      const next = [
	                        optimisticNew,
	                        ...(memories as any[]).filter((m: any) => Number(m?.id) !== normalizedId),
	                      ];
	                      sessionStorage.setItem("db:guestMemories", JSON.stringify(next));
	                    } catch {
	                      // Ignore sessionStorage errors
	                    }
	                  }

                  // Swap overlay from draft -> saved memory; exit edit mode -> preview
                  setSelectedMemoryFolder(folderName === "Unsorted" ? null : folderName);
                  setSelectedMemoryId(normalizedId);
                  setDraftMemory(null);
                  setForceEditMemoryId(null);
                  return;
                }

	                const payload = {
	                  title: draft.title,
	                  summary: draft.summary,
	                  doc_json: (draft as any)?.doc_json ?? null,
	                  session_id: draft.session_id || null,
	                  message_id: draft.message_id || null,
		                  folder_id: (draft as any)?.folder_id ?? null,
                };

		                try {
		                  const response = await fetch("/api/memory", {
	                    method: "POST",
	                    headers: { "Content-Type": "application/json" },
	                    body: JSON.stringify(payload),
	                  });

                  if (!response.ok) {
                    let errorMessage = "Failed to create memory";
                    try {
                      const errorData = await response.json();
                      if (typeof errorData?.error === "string") {
                        errorMessage = errorData.error;
                      }
                    } catch {
                      // If response is not JSON, keep default message
                    }
                    console.error("[DRAFT SAVE] Server error:", errorMessage);
		                    throw new Error(errorMessage);
		                  }

		                  const newMemory = await response.json();
		                  const topPos = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
		                  const normalizedId = upsertMemoryInCache?.(newMemory as any) ?? Number((newMemory as any)?.id);
		                  if (!Number.isFinite(normalizedId)) {
	                    throw new Error("Failed to resolve saved memory id");
	                  }

	                  const optimisticNew = { ...(newMemory as any), id: normalizedId, position: topPos };
	                  upsertMemoryInCache?.(optimisticNew as any);
	                  upsertMemoryInFolderCaches?.(optimisticNew as any);
	                  setMemories((prev: any[]) => [
	                    optimisticNew,
	                    ...prev.filter((m: any) => Number(m?.id) !== normalizedId),
	                  ]);

	                  // Persist top position so the next fetch preserves ordering.
	                  try {
	                    await fetch("/api/memory", {
	                      method: "PATCH",
	                      headers: { "Content-Type": "application/json" },
	                      body: JSON.stringify({ updates: [{ id: normalizedId, position: topPos }] }),
	                    });
	                  } catch {
	                    // ignore (UI already reflects top placement)
	                  }

	                  // Swap overlay from draft -> saved memory; exit edit -> preview
	                  setSelectedMemoryFolder(newMemory?.folder_name === "Unsorted" ? null : (newMemory?.folder_name ?? null));
	                  setSelectedMemoryId(normalizedId);
	                  setDraftMemory(null);
                  setForceEditMemoryId(null);
                  // Refresh folder counts in the background (keeps right-rail counts accurate).
                  void loadMemoryFolders?.();
                } catch (err) {
                  console.error("Error saving draft:", err);
                  throw err;
                }
              }}
              onDelete={async (id: number) => {
                await handleMemoryDelete(id);
                // Clear forceEditMemoryId if the deleted memory was being force-edited
                if (forceEditMemoryId === id) {
                  setForceEditMemoryId(null);
                }
              }}
              onDiscardDraft={() => {
                setMemoryOverlayOpen(false);
                setDraftMemory(null);
                setForceEditMemoryId(null);
              }}
              error={memoryError}
              onToolbarVisibleChange={setMemoryToolbarVisible}
              forceEditMemoryId={forceEditMemoryId}
              attachedMemoryIds={activeSessionId ? attachedMemoryIdsForActiveSession : (pendingAttachedMemoryIds || [])}
              attachedMemories={activeSessionId ? attachedMemoriesForActiveSession : []}
              onAttachMemory={async (memoryId: number) => {
                // Use unified toggle that works for both session and pending states
                if (toggleAttachMemory) {
                  try {
                    await toggleAttachMemory(memoryId);
                  } catch (e: any) {
                    // Error is already handled and shown as toast in toggleAttachMemory
                    // Just swallow to prevent unhandled rejection
                  }
                }
              }}
              onDetachMemory={async (memoryId: number) => {
                // Use unified toggle that works for both session and pending states
                if (toggleAttachMemory) {
                  try {
                    await toggleAttachMemory(memoryId);
                  } catch (e: any) {
                    // Error is already handled and shown as toast in toggleAttachMemory
                    // Just swallow to prevent unhandled rejection
                  }
                }
              }}
              usageRatio={memoryUsageRatio}
              activeSessionId={activeSessionId}
              onRefreshSession={() => {
                if (activeSessionId) {
                  refreshUsage(activeSessionId);
                  hydrate(activeSessionId);
                }
              }}
            />

            {/* Bottom fade over messages (hidden when landing) */}
            <div
              className={
                "pointer-events-none absolute inset-x-0 bg-gray-900/10 transition-opacity duration-300 " +
                (effectiveIsLanding ? "opacity-0" : "opacity-100")
              }
              style={{ height: 24, bottom: composerHeight + 8 }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top," +
                    " rgba(17,24,39,0.98) 0%," +
                    " rgba(17,24,39,0.96) 18%," +
                    " rgba(17,24,39,0.92) 36%," +
                    " rgba(17,24,39,0.88) 52%," +
                    " rgba(17,24,39,0.70) 68%," +
                    " rgba(17,24,39,0.40) 80%," +
                    " rgba(17,24,39,0.18) 90%," +
                    " rgba(17,24,39,0.00) 100%)",
                }}
              />
            </div>

            {/* Scroll-to-bottom FAB (hidden when landing or memory overlay open) */}
            <button
              type="button"
              aria-label="Scroll to bottom"
              onClick={handleScrollDownFab}
              className={
                `absolute z-40 left-1/2 -translate-x-1/2 ` +
                (showScrollDownFab && !effectiveIsLanding && !memoryOverlayOpen
                  ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                  : "opacity-0 scale-95 translate-y-1 pointer-events-none") +
                " transition-all duration-200 ease-out"
              }
              style={{ bottom: composerHeight + 52 }}
            >
              <div className="h-8 w-8 rounded-full bg-slate-800/80 border border-slate-700/45 backdrop-blur flex items-center justify-center shadow-[0_8px_18px_rgba(0,0,0,0.35)]">
                <svg
                  className="w-5 h-5 text-gray-200"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v9" />
                  <path d="M7 10l5 5 5-5" />
                </svg>
              </div>
            </button>

            {/* Floating Chat Composer (single instance, slides between landing/docked) */}
	            <div
	              className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-4 sm:pb-5 md:pb-6 ${
                  effectiveIsLanding && (input.trim().length > 0 || pendingComposerAttachmentCount > 0) && !animateLandingComposerTransform
                    ? "transition-opacity duration-200 ease-out"
                    : "transition-transform transition-opacity duration-700 ease-in-out"
                } ${
	                memoryOverlayOpen ? "opacity-0" : "opacity-100"
	              }`}
	              style={{
                paddingLeft: centerPadding,
                paddingRight: centerPadding,
                transform: (isLanding && (coldBootLiftReady || !isColdLandingBoot)) ? `translateY(-${adjustedLandingLiftPx}px)` : `translateY(0px)`,
                transitionDuration: isOpeningMemory ? "140ms" : undefined,
	              }}
	            >
	              <div
	                className={
	                  "w-full mx-auto pointer-events-auto transition-[max-width] duration-300 ease-out will-change-[max-width]" +
	                  (memoryOverlayOpen ? " pointer-events-none" : "") +
	                  (isColdLandingBoot ? " transition-none" : "")
	                }
	                style={{
	                  // Tailwind defaults: max-w-2xl = 42rem (672px), max-w-4xl = 56rem (896px)
	                  maxWidth: effectiveIsLanding ? 672 : composerWide ? 896 : 672,
	                }}
	              >
	          <FloatingChatComposer
	                  variant={effectiveIsLanding ? "landing" : "docked"}
	                  disableTransitions={isColdLandingBoot}
	                  guestMessageCount={guestMessageCount}
                  GUEST_MESSAGE_LIMIT={GUEST_MESSAGE_LIMIT}
                  value={searchMode ? searchDraft : input}
            onChange={(val) => {
              if (searchMode) {
                setSearchDraft(val);
                return;
              }
              setInput(val);
              inputPreserveRef.current = val;
            }}
            onSend={() => {
              if (searchMode) return;
              handleSend();
            }}
            onAttachmentsChange={onComposerAttachmentsChange}
            attachmentsResetToken={composerAttachmentResetToken}
            isSending={searchMode ? false : isSending}
            disabled={disabled}
            mode={mode}
            onModeChange={handleModeChange}
            placeholder={
              searchMode
                ? "Search this chat…"
                : scope?.kind === "guest"
                ? "Sign in to start chatting..."
                : !effectiveIsLanding
                ? "Type a message…"
                : "Create a new chat to start..."
            }
            onHeightChange={handleComposerHeightChange}
            onOpenTimeline={() => {
              setIsTimelineOpen((v: any) => !v);
            }}
            usageRatio={memoryUsageRatio}
            searchMode={searchMode}
            isSearchMode={searchMode}
            onToggleSearchMode={handleToggleSearchMode}
            onRunSearch={handleRunSearch}
            searchRole={searchRoleFilter}
            onSearchRoleChange={setSearchRoleFilter}
            searchMatchMode={searchMatchMode}
            onSearchMatchModeChange={setSearchMatchMode}
            onClearSearch={handleClearMiddleSearch}
            searchTags={searchTags}
            onRemoveSearchTag={handleRemoveSearchTag}
            maxSearchTags={maxSearchTags}
            webSearchArmed={webSearchArmed}
            focusEnabled={focusEnabled}
            focusText={focusText}
            onFocusSave={onFocusSave}
            onFocusToggle={onFocusToggle}
            onFocusClear={onFocusClear}
            onToggleWebSearch={onToggleWebSearch}
            canRunSearch={searchDraft.trim().length > 0 || (Array.isArray(searchTags) && searchTags.length > 0)}
            hitsBadge={isSearching ? searchHitCount : null}
            attachedMemoryCount={effectiveIsLanding ? landingAttachedCount : attachedMemoryIdsForActiveSession.length}
            attachedMemories={effectiveIsLanding ? landingAttachedMemoriesWithPin : attachedMemoriesForActiveSession.map((m: any) => ({
              id: m.id,
              title: m.title,
              folder_name: m.folder_name,
              is_pinned: m.is_pinned,
            }))}
            activeSessionId={activeSessionId}
            scopeKind={scope?.kind}
            sessionLifetimeRatio={activeSessionLifetimeRatio}
            isContextWarning={composerIsContextWarning}
            chatFullState={composerChatFullState}
            onGenerateNewChat={onGenerateNewChat}
            onRemoveAttachedMemory={effectiveIsLanding ? ((id: number) => detachMemoryFromLanding(id)) : detachMemoryFromActiveSession}
            onClearAttachedMemories={effectiveIsLanding ? clearLandingAttachedMemories : clearAttachedMemoriesForActiveSession}
            onTogglePin={effectiveIsLanding ? toggleLandingPin : handleTogglePin}
            activeDragId={activeDragId}
            onOpenAttachedMemory={openMemoryReaderOverlay}
            timelinePopup={
              isTimelineOpen ? (
                <div
                  ref={timelinePopupRef}
                  onMouseDownCapture={() => {
                    ignoreOutsideClickRef.current = true;
                  }}
                  className="w-48 bg-[#0f1320] rounded-xl z-50 overflow-y-auto max-h-[200px] border border-blue-400/45 shadow-[0_10px_24px_rgba(0,0,0,0.38)]"
                >
                  <div className="px-2.5 py-2 border-b border-slate-800/60">
                    <h3 className="text-[12px] font-semibold text-gray-200 tracking-wide">Timeline</h3>
                  </div>
                  <div className="divide-y divide-slate-800/70">
                    {hourBuckets.map((bucket: any) => {
                      const count = bucket.groups.reduce((sum: any, g: any) => sum + g.items.length, 0);
                      return (
                        <div
                          key={bucket.hourKey}
                          className="px-2.5 py-2 hover:bg-slate-800/45 cursor-pointer transition-colors"
                          onClick={() => scrollToHour(bucket.hourKey)}
                        >
                          <div className="min-w-0">
                            <div className="text-[12px] text-gray-200 font-medium truncate leading-tight">
                              {bucket.label}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0">
                              {count} {count === 1 ? "message" : "messages"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : undefined
            }
          />
              </div>
            </div>
            </div>
          </div>

          {/* Column 4: RightRail */}
          <div className="block bg-transparent pointer-events-none" aria-hidden="true">
            {/* Rail is structural only - no buttons */}
          </div>

          {/* Column 5: RightPanel */}
          <div className="min-w-0 overflow-x-hidden overflow-y-hidden lg:block">
            {/* Always render drawer wrapper, animate width/opacity */}
              <div className="h-full">
              <div
                className="flex h-full overflow-x-hidden overflow-y-hidden relative z-40 bg-gray-900 min-w-0"
                style={{
                  width: rightDockHidden ? 16 : RIGHT_PANEL_W_CLEAN,
                  transition: disableMotion ? "none" : "width 300ms ease-in-out, opacity 300ms ease-in-out",
                  willChange: "width, opacity",
                }}
              >
              <div
                className={
                  "flex h-full w-full min-w-0 justify-end " +
                  (rightDockHidden ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto")
                }
                style={{ transition: "opacity 220ms ease-in-out" }}
                aria-hidden={rightDockHidden}
              >
            <RightDock
            open={!rightDockHidden}
            showOuterDivider={layoutMode !== "narrow"}
            onToggle={() => setRightPanelOpen((v: any) => !v)}
            onToggleRightDock={toggleRight}
            rightPanelOpen={rightPanelOpen}
            activeSessionId={activeSessionId}
            folderListContainerRef={rightFolderListRef}
            folders={memoryFolders}
            disableRailItemMotion={disableRailItemMotion}
            selectedFolder={selectedMemoryFolder}
            suppressMemoryHover={suppressMemoryHover}
            onFolderSelect={(folderName) => {
              setSelectedMemoryFolder(folderName);
            }}
            onToggleOverlay={() => {
              if (memoryOverlayOpen) {
                setMemoryOverlayOpen(false);
              } else if (selectedMemoryId) {
                setMemoryOverlayOpen(true);
              }
            }}
            overlayOpen={memoryOverlayOpen}
            activeId={activeDragId}
            currentOverId={currentOverId}
            currentInsert={currentInsert}
            onFolderReorder={handleFolderReorder}
            onCreateFolder={handleCreateMemoryFolder}
            maxFolders={signedInFolderLimit}
            onRenameFolder={handleRenameMemoryFolder}
            onDeleteFolder={handleDeleteMemoryFolder}
            onDeleteFolderAndMemories={handleDeleteMemoryFolderAndMemories}
            onSetFolderIcon={handleSetMemoryFolderIcon}
            onAttachAllMemories={attachAllMemoriesFromFolder}
            scopeKind={scope?.kind}
            onFolderAppearanceChange={setRightFolderAppearance}
            memories={memories}
            selectedMemoryId={selectedMemoryId}
            searchQuery={memorySearchQuery}
            onMemorySelect={(id) => {
              if (draftMemory) {
                setDraftMemory(null);
              }
              setSelectedMemoryId(id);
              setMemoryOverlayOpen(true);
            }}
            onSearchChange={setMemorySearchQuery}
            onSearchSubmit={(query) => {
              setMemorySearchQuery(query);
            }}
            onClearSearch={() => {
              setMemorySearchQuery("");
            }}
            onMemoryReorder={handleMemoryReorder}
            onDeleteMemory={async (id: number) => {
              await handleMemoryDelete(id);
              // If this memory was attached to the active session, ensure it's removed from the
              // attachments UI state as well (server already detaches on delete).
              try {
                detachMemoryFromActiveSession?.(id);
              } catch {
                // ignore
              }
            }}
            onRenameMemory={handleMemoryRename}
            onCreateMemory={openBlankMemoryDraft}
            loading={memoryLoading}
          />
          {/* Memory + memory-folder drag overlay (same approach as left rail; no createPortal) */}
          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeDragId?.startsWith("memory-folder-") ? (
              (() => {
                const folderId = parseInt(activeDragId.replace("memory-folder-", ""));
                const folder = memoryFolders.find((f: any) => f.id === folderId);
                if (!folder) return null;
                const effectiveIcon = rightFolderAppearance[folderId]?.icon ?? folder.icon;
                const effectiveColor = rightFolderAppearance[folderId]?.color;
                return (
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#1F2937] border border-blue-400/30 shadow-[0_8px_24px_rgba(0,0,0,0.4)] text-gray-100"
                    style={{ opacity: 0.95, transform: "scale(1.03)", pointerEvents: "none" }}
                  >
                    <FolderBubbleIconContent displayIcon={effectiveIcon} displayColor={effectiveColor} />
                  </div>
                );
              })()
	            ) : dragOverlayMemoryId != null ? (
	              (() => {
	                const memory = memories.find((m: any) => m.id === dragOverlayMemoryId);
	                if (!memory) return null;
	                const title = memory.title || "Untitled";
                return (
                  <div style={{ width: "240px", pointerEvents: "none" }}>
                    <div className="rounded-md px-2.5 py-1.5 bg-slate-800/95 border border-slate-600/50 shadow-xl"
                         style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-[3px] h-7 rounded-full bg-blue-400/90 flex-shrink-0" />
                        <div className="text-sm font-medium text-gray-100 truncate min-w-0">{title}</div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : null}
          </DragOverlay>
              </div>
                </div>
              </div>
            </div>
          </DndContext>
            </div>
          );
        })()}

        {/* Narrow mode overlays (fixed position, outside grid) */}
        {/* Keep overlays visible during narrow→wide transition to prevent visual gap */}
        {(layoutMode === "narrow" || keepOverlaysVisible) && (
          <>
            {/* Backdrop - always rendered, fades in/out */}
            <div
              className="fixed inset-0 bg-transparent z-40"
              style={{
                opacity: (sidebarOpen || rightOverlayOpen) ? 1 : 0,
                transition: `opacity ${SLIDE_MS}ms ${SLIDE_EASE}`,
                pointerEvents: (sidebarOpen || rightOverlayOpen) ? 'auto' : 'none',
              }}
              onClick={() => {
                closeOverlays();
              }}
            />

            {/* Left panel overlay - slides in from left */}
            <div
              className="fixed top-0 left-0 z-50 h-full w-[329px] pointer-events-none"
              style={{
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                opacity: 1,
                transition: layoutMode === "narrow" ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}` : 'none',
                willChange: "transform",
              }}
            >
                {/* Drawer content */}
                <div
                  className="h-full w-[329px] bg-gray-900 pointer-events-auto overflow-x-hidden overflow-y-hidden shadow-[12px_0_28px_rgba(0,0,0,0.45),4px_0_10px_rgba(0,0,0,0.35)] ring-1 ring-white/5"
                  style={{
                    backgroundImage:
                      "linear-gradient(180deg, rgba(23, 37, 84, 0.35) 0%, rgba(17, 24, 39, 0.5) 100%)",
                  }}
                >
                  <DndContext
                    sensors={sensors}
                    autoScroll={DND_AUTO_SCROLL_OPTIONS}
                    collisionDetection={collisionDetection}
                    modifiers={modifiers}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                  >
                    <div className="flex h-full w-[329px] [&>*]:border-r-0">
                      <FolderRail
                        key={scope ? `${scope.kind}:${"userId" in scope ? scope.userId : scope.guestId}` : "scope-loading"}
                        folders={folders}
                        selectedFolderId={selectedFolderId}
                        sessions={sidebarSessions}
                        onFolderSelect={handleFolderSelect}
                        onRenameFolder={handleRenameFolder}
                        onStartRenameFolder={setStartRenameFolderId}
                        onDeleteFolder={handleDeleteFolder}
                        onDeleteFolderAndChats={handleDeleteFolderAndChats}
                        onCreateFolder={handleCreateFolder}
                        onSetFolderIcon={onSetFolderIcon}
                        activeId={activeDragId}
                        currentOverId={currentOverId}
                        currentInsert={currentInsert}
                        folderListContainerRef={leftFolderListRef}
                        onOpenHomeOverlay={openHomeOverlay}
                        onResetToLanding={handleCreateSession}
                        scope={scope}
                        disableRailItemMotion={disableRailItemMotion}
                        maxFolders={signedInFolderLimit}
                      />
                      {chatNavigatorEl}
                    </div>
                    <DragOverlay>
                      {dragOverlaySessionId != null ? (
                        (() => {
                          const s =
                            sidebarSessions.find((x: any) => x.id === dragOverlaySessionId) ||
                            sessions.find((x: any) => x.id === dragOverlaySessionId)
                          if (!s) return null
                          const title = (s as any).title || "Untitled chat"
                          return (
                            <div className="w-56 max-w-[240px] rounded-md px-2.5 py-1.5 bg-slate-800/95 border border-slate-600/50 shadow-xl"
                                 style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-[3px] h-7 rounded-full bg-blue-400/90 flex-shrink-0" />
                                <div className="text-sm font-medium text-gray-100 truncate min-w-0">{title}</div>
                              </div>
                            </div>
                          )
                        })()
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </div>
            </div>

            {/* Right panel overlay - slides in from right */}
            <div
              className="fixed top-0 right-0 z-50 h-full w-[329px] pointer-events-none"
              style={{
                transform: rightOverlayOpen ? 'translateX(0)' : 'translateX(100%)',
                opacity: 1,
                transition: layoutMode === "narrow" ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}` : 'none',
                willChange: "transform",
              }}
            >
                {/* Drawer content */}
                <div className="h-full w-[329px] bg-gray-900 pointer-events-auto overflow-x-hidden overflow-y-hidden shadow-[-12px_0_28px_rgba(0,0,0,0.45),-4px_0_10px_rgba(0,0,0,0.35)] ring-1 ring-white/5">
                  <DndContext
                    sensors={sensors}
                    autoScroll={DND_AUTO_SCROLL_OPTIONS}
                    collisionDetection={collisionDetection}
                    modifiers={modifiers}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                  >
                    <ChatDropzoneGhost enabled={Boolean(activeDragId?.startsWith("memory-") && !activeDragId?.includes("folder"))} />
                    <RightDock
                      open={true}
                      showOuterDivider={false}
                      onToggle={() => setRightPanelOpen((v: any) => !v)}
                      onToggleRightDock={() => closeOverlays()}
                      rightPanelOpen={rightPanelOpen}
                      activeSessionId={activeSessionId}
                      folderListContainerRef={rightFolderListRef}
                      folders={memoryFolders}
                      disableRailItemMotion={disableRailItemMotion}
                      selectedFolder={selectedMemoryFolder}
                      suppressMemoryHover={suppressMemoryHover}
                      onFolderSelect={(folderName) => {
                        setSelectedMemoryFolder(folderName);
                      }}
                      onToggleOverlay={() => {
                        if (memoryOverlayOpen) {
                          setMemoryOverlayOpen(false);
                        } else if (selectedMemoryId) {
                          setMemoryOverlayOpen(true);
                        }
                      }}
                      overlayOpen={memoryOverlayOpen}
                      activeId={activeDragId}
                      currentOverId={currentOverId}
            currentInsert={currentInsert}
                      onFolderReorder={handleFolderReorder}
                      onCreateFolder={handleCreateMemoryFolder}
                      maxFolders={signedInFolderLimit}
                      onRenameFolder={handleRenameMemoryFolder}
                      onDeleteFolder={handleDeleteMemoryFolder}
                      onDeleteFolderAndMemories={handleDeleteMemoryFolderAndMemories}
                      onSetFolderIcon={handleSetMemoryFolderIcon}
                      onAttachAllMemories={attachAllMemoriesFromFolder}
                      scopeKind={scope?.kind}
                      onFolderAppearanceChange={setRightFolderAppearance}
                      memories={memories}
                      selectedMemoryId={selectedMemoryId}
                      searchQuery={memorySearchQuery}
                      onMemorySelect={(id) => {
                        // If a draft is open, discard it before switching memories
                        if (draftMemory) {
                          setDraftMemory(null);
                        }
                        setSelectedMemoryId(id);
                        setMemoryOverlayOpen(true);
                      }}
                      onSearchChange={setMemorySearchQuery}
                      onSearchSubmit={(query) => {
                        setMemorySearchQuery(query);
                      }}
                      onClearSearch={() => {
                        setMemorySearchQuery("");
                      }}
                      onMemoryReorder={handleMemoryReorder}
                      onDeleteMemory={async (id: number) => {
                        await handleMemoryDelete(id);
                        // If this memory was attached to the active session, ensure it's removed from the
                        // attachments UI state as well (server already detaches on delete).
                        try {
                          detachMemoryFromActiveSession?.(id);
                        } catch {
                          // ignore
                        }
                      }}
                      onRenameMemory={handleMemoryRename}
                      onCreateMemory={openBlankMemoryDraft}
                      loading={memoryLoading}
                    />
                    {/* Portal the narrow-right DragOverlay to body so transformed drawer wrapper cannot offset cursor anchoring. */}
                    {typeof document !== "undefined"
                      ? createPortal(
                          <DragOverlay adjustScale={false} dropAnimation={null}>
                            {activeDragId?.startsWith("memory-folder-") ? (
                              (() => {
                                const folderId = parseInt(activeDragId.replace("memory-folder-", ""));
                                const folder = memoryFolders.find((f: any) => f.id === folderId);
                                if (!folder) return null;
                                const effectiveIcon = rightFolderAppearance[folderId]?.icon ?? folder.icon;
                                const effectiveColor = rightFolderAppearance[folderId]?.color;
                                return (
                                  <div
                                    className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#1F2937] border border-blue-400/30 shadow-[0_8px_24px_rgba(0,0,0,0.4)] text-gray-100"
                                    style={{ opacity: 0.95, transform: "scale(1.03)", pointerEvents: "none" }}
                                  >
                                    <FolderBubbleIconContent displayIcon={effectiveIcon} displayColor={effectiveColor} />
                                  </div>
                                );
                              })()
	                            ) : dragOverlayMemoryId != null ? (
	                              (() => {
	                                const memory = memories.find((m: any) => m.id === dragOverlayMemoryId);
	                                if (!memory) return null;
	                                const title = memory.title || "Untitled";
                                return (
                                  <div style={{ width: "240px", pointerEvents: "none" }}>
                                    <div className="rounded-md px-2.5 py-1.5 bg-slate-800/95 border border-slate-600/50 shadow-xl"
                                         style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-[3px] h-7 rounded-full bg-blue-400/90 flex-shrink-0" />
                                        <div className="text-sm font-medium text-gray-100 truncate min-w-0">{title}</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()
                            ) : null}
                          </DragOverlay>,
                          document.body
                        )
                      : null}
                  </DndContext>
                
                </div>
            </div>
          </>
        )}

        {/* Mobile sidebar overlay (opens from LEFT, under the header) - NOT for narrow mode */}
        {sidebarOpen && layoutMode !== "narrow" && (
          <div
            className="md:hidden fixed left-0 right-0 bottom-0 z-50 flex"
            style={{ top: 0 }}
          >
            {/* Sidebar panel (left) */}
            <div
              className="w-[329px] max-w-[85vw] h-full overflow-visible relative z-50 shadow-[12px_0_24px_rgba(0,0,0,0.4),4px_0_10px_rgba(0,0,0,0.3)] ring-1 ring-white/5"
              style={{
                background:
                  "linear-gradient(180deg, rgba(23, 37, 84, 0.35) 0%, rgba(17, 24, 39, 0.5) 100%)",
              }}
            >
              {/* Subtle noise texture overlay */}
              <div 
                className="absolute inset-0 pointer-events-none z-0 opacity-[0.03]"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                  mixBlendMode: 'overlay'
                }}
              />
              <div className="relative z-10 h-full overflow-hidden">
                <DndContext
                  sensors={sensors}
                  autoScroll={DND_AUTO_SCROLL_OPTIONS}
                  collisionDetection={collisionDetection}
                  modifiers={modifiers}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex h-full w-full">
                    <FolderRail
                      key={scope ? `${scope.kind}:${"userId" in scope ? scope.userId : scope.guestId}` : "scope-loading"}
                      folders={folders}
                      selectedFolderId={selectedFolderId}
                      sessions={sidebarSessions}
                      onFolderSelect={handleFolderSelect}
                      onRenameFolder={handleRenameFolder}
                      onStartRenameFolder={setStartRenameFolderId}
                      onDeleteFolder={handleDeleteFolder}
                      onDeleteFolderAndChats={handleDeleteFolderAndChats}
                      onCreateFolder={handleCreateFolder}
                      onSetFolderIcon={onSetFolderIcon}
                      activeId={activeDragId}
                      currentOverId={currentOverId}
                      currentInsert={currentInsert}
                      folderListContainerRef={leftFolderListRef}
                      onOpenHomeOverlay={openHomeOverlay}
                      onResetToLanding={handleCreateSession}
	                      scope={scope}
	                      disableRailItemMotion={disableRailItemMotion}
	                      maxFolders={signedInFolderLimit}
	                    />
	                    {chatNavigatorEl}
	                  </div>
                  <DragOverlay>
                    {dragOverlaySessionId != null ? (
                      (() => {
                        const s =
                          sidebarSessions.find((x: any) => x.id === dragOverlaySessionId) ||
                          sessions.find((x: any) => x.id === dragOverlaySessionId)
                        if (!s) return null
                        const title = (s as any).title || "Untitled chat"
                        return (
                          <div className="w-56 max-w-[240px] rounded-md px-2.5 py-1.5 bg-slate-800/95 border border-slate-600/50 shadow-xl"
                               style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-[3px] h-7 rounded-full bg-blue-400/90 flex-shrink-0" />
                              <div className="text-sm font-medium text-gray-100 truncate min-w-0">{title}</div>
                            </div>
                          </div>
                        )
                      })()
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>
            </div>

            {/* Backdrop (right) */}
            <div
              className="flex-1 bg-black/50"
              onClick={() => closeOverlays()}
              aria-hidden="true"
            />
          </div>
        )}

        {profileOverlayOpen && (
          <div className="fixed inset-0 z-[130]">
            <div
              className={`absolute inset-0 bg-slate-950/80 backdrop-blur-[2px] transition-opacity duration-200 ${
                profileOverlayVisible ? "opacity-100" : "opacity-0"
              }`}
              onClick={closeProfileOverlay}
            />
            <div
              className={`absolute inset-0 transition-[opacity,transform] duration-200 ease-out ${
                profileOverlayVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
              }`}
            >
              <LazyProfileView embedded onClose={closeProfileOverlay} />
            </div>
          </div>
        )}

        {homeOverlayMounted && (
          <div className={`fixed inset-0 z-[125] ${homeOverlayVisible ? "pointer-events-auto" : "pointer-events-none"}`}>
            <div
              className="absolute inset-0 bg-slate-950 transition-opacity duration-280"
              style={{ opacity: homeOverlayVisible ? (homeIframeLoaded ? 0.88 : 0.34) : 0 }}
              onClick={closeHomeOverlay}
            />
            <div
              className={`absolute inset-0 transition-opacity duration-240 ease-out ${
                homeOverlayVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              {homeOverlayVisible && !homeIframeLoaded && (
                <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-300/80">
                  Loading Home...
                </div>
              )}
              <iframe
                src="/home"
                title="Home"
                className="h-full w-full border-0 bg-[#0a0b10]"
                onLoad={() => setHomeIframeLoaded(true)}
                style={{ opacity: homeIframeLoaded ? 1 : 0, transition: "opacity 240ms ease-out" }}
              />
            </div>
          </div>
        )}
      
        {/* Debug HUD (dev-only) */}
        {SHOW_DEV_HUD && process.env.NODE_ENV !== "production" && <DebugHUD
          messagesLength={messages.length}
          scrollContainerRef={scrollContainerRef}
          distToBottomRef={distToBottomRef}
          isAtBottomRef={isAtBottomRef}
          activeSessionId={activeSessionId}
          searchMode={searchMode}
          isModeFading={isModeFading}
          scrollLockReason={scrollLockReason}
          revealMessageIdRef={revealMessageIdRef}
          isSending={isSending}
          sessionUsedTokens={contextUsedTokens}
        />}
      </div>

  );
}
