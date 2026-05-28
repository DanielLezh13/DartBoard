"use client";

import React, { Suspense, useState, useRef, useMemo, useEffect, useCallback, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { Upload, ChevronDown, ChevronUp, Search, X, Calendar, MessageSquare, Zap, Archive, Clock, Filter, Plus, FolderOpen, Tag, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { CopyIcon } from "@/components/icons/CopyIcon";
import { DefaultFolderIcon } from "@/components/icons/DefaultFolderIcon";
import VaultModal from "@/components/VaultModal";
import ArchiveMessageCard from "@/components/archive/ArchiveMessageCard";
import ArchivePaginationControls from "@/components/archive/ArchivePaginationControls";
import TagChips from "@/components/archive/TagChips";
import DateCalendar from "@/components/archive/DateCalendar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { buildClipboardPayload } from "@/lib/chat/clipboard";
import { getAuthHeaders } from "@/lib/api";
import {
  getSafeArchivePageIndex,
} from "@/lib/archive/pagination";
import type { ArchiveMessage } from "@/lib/archive/types";
import { stripExportArtifacts } from "@/lib/stripExportArtifacts";
import { useScope } from "../../hooks/useScope";

// Enhanced glass-morphism card styles matching v2 mockup exactly
const archiveCardStyles = {
  base: "group relative isolate overflow-hidden rounded-xl border border-blue-500/30 bg-card/60 p-6 shadow-none backdrop-blur-md transition-all duration-300",
  inner: "bg-card/40 border border-blue-500/20 rounded-lg backdrop-blur-sm",
  warning: "bg-warning/10 border border-warning/50 rounded-xl p-3 backdrop-blur-sm",
  button: "inline-flex items-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 hover:border-blue-400/40 rounded-lg font-medium text-blue-400 hover:text-blue-300 transition-all duration-200",
  destructive: "px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-400/40 text-red-400 hover:text-red-300 rounded transition-colors",
};

const ARCHIVE_RESULTS_PAGE_SIZE = 75;

function cleanMessageText(text: string) {
  return stripExportArtifacts(text || "");
}

function getMsgText(m: any) {
  return typeof m?.text === "string"
    ? m.text
    : typeof m?.content === "string"
    ? m.content
    : "";
}

function getMsgTs(m: any) {
  return typeof m?.ts === "string"
    ? m.ts
    : typeof m?.created_at === "string"
    ? m.created_at
    : "";
}

function getMsgChatId(m: any) {
  return typeof m?.chat_id === "string"
    ? m.chat_id
    : typeof m?.session_id !== "undefined"
    ? String(m.session_id)
    : "";
}

interface SavedChip {
  id: string;
  label: string;
  query: string;
  role: string;
  startDate: string;
  endDate: string;
  tags?: string[];
  tagMode?: "AND" | "OR";
}

interface DateStats {
  ts_min: string | null;
  ts_max: string | null;
  total: number;
  chatgpt_count: number;
  dartboard_count: number;
}

const SAVED_PINS_STORAGE_KEY = "vaultExplorerSavedPins";
const SS_RETURN_FROM_ARCHIVE = "db:returnFromArchive";

const formatDateForInput = (value: string) => {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value.split("T")[0] || value;
    }
    return date.toISOString().split("T")[0];
  } catch {
    return value.split("T")[0] || value;
  }
};

function ArchivePageInner() {
  const { scope } = useScope();
  const chatIconGradientId = React.useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [lastAppliedQuery, setLastAppliedQuery] = useState(""); // Track last applied search query
  const [searchTags, setSearchTags] = useState<string[]>([]);
  type TagMatchMode = "AND" | "OR";
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>("AND");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<"" | "chatgpt" | "dartboard">("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]); // Array of YYYY-MM-DD strings
  const [datesDirty, setDatesDirty] = useState(false);
  const [results, setResults] = useState<ArchiveMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [initialArchiveBootLoading, setInitialArchiveBootLoading] = useState(true);
  const [showStatsReveal, setShowStatsReveal] = useState(false);
  const [showSearchReveal, setShowSearchReveal] = useState(false);
  const [showLowerReveal, setShowLowerReveal] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const deferredWindowPage = useDeferredValue(currentPage);
  const [totalResults, setTotalResults] = useState(0);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Vault modal state - simplified
  const [vaultingMessage, setVaultingMessage] = useState<ArchiveMessage | null>(null);
  const [memoryFolders, setMemoryFolders] = useState<string[]>([]);
  const [savingMessageId, setSavingMessageId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPins, setSavedPins] = useState<SavedChip[]>([]);
  const [pinFilter, setPinFilter] = useState("");
  const [dateStats, setDateStats] = useState<DateStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [contextResults, setContextResults] = useState<ArchiveMessage[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [contextWindow, setContextWindow] = useState(8); // Number of messages before/after
  const searchAbortRef = useRef<AbortController | null>(null);
  const monthlyCountsAbortRef = useRef<AbortController | null>(null);
  const lastMonthlyCountsYearRef = useRef<number | null>(null);
  
  // Dropdown toggle states
  // (Role filter uses a pill toggle now; no dropdown state)
  
  // Refs for click-outside detection
  
  // Zoom state for hierarchical navigation
  const [zoomLevel, setZoomLevel] = useState<"year" | "month" | "day">("year");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set()); // Set of "YYYY-MM" strings for multi-month selection
  const [lastClickedMonth, setLastClickedMonth] = useState<{ year: number; month: number } | null>(null);
  const [activeMonth, setActiveMonth] = useState<{ year: number; month: number } | null>(null);
  const [zoomStart, setZoomStart] = useState<string | null>(null);
  const [zoomEnd, setZoomEnd] = useState<string | null>(null);
  
  // Drag selection state for days
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);
  const dayDragMonthKeyRef = useRef<string | null>(null);
  
  // Month pill drag state (matches day calendar pattern)
  const [isMonthDragging, setIsMonthDragging] = useState(false);
  const [monthDragMode, setMonthDragMode] = useState<"select" | "deselect" | null>(null);
  const isMonthDraggingRef = useRef(false);
  const monthDragStartRef = useRef<{ year: number; month: number } | null>(null);
  
  // Monthly counts from API for histogram (selected year + current filters)
  const [monthlyCounts, setMonthlyCounts] = useState<{
    jan: number; feb: number; mar: number; apr: number; may: number; jun: number;
    jul: number; aug: number; sep: number; oct: number; nov: number; dec: number;
  } | null>(null);
  const [loadingMonthlyCounts, setLoadingMonthlyCounts] = useState(false);
  
  // Date view mode: 'months' = month pills only, 'days' = show calendars
  const [dateViewMode, setDateViewMode] = useState<"months" | "days">("months");
  
  // Time-of-day filter state
  type TimeBand = "all" | "morning" | "afternoon" | "evening" | "night";
  const [timeBand, setTimeBand] = useState<TimeBand>("all");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const ARCHIVE_BOOT_MAX_WAIT_MS = 1200;
  const ARCHIVE_BOOT_MIN_VISIBLE_MS = 1600;

  const getRequestHeaders = useCallback(
    (includeJsonContentType = true): HeadersInit => {
      const headers = { ...(getAuthHeaders() as Record<string, string>) };
      if (!includeJsonContentType) {
        delete headers["Content-Type"];
      }
      return headers;
    },
    []
  );

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      monthlyCountsAbortRef.current?.abort();
    };
  }, []);

  // Ensure Archive -> Chat fast-restore marker is set even when leaving via
  // browser back/history (not just the in-app back button).
  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem(SS_RETURN_FROM_ARCHIVE, "1");
      } catch {
        // ignore sessionStorage errors
      }
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalResults / ARCHIVE_RESULTS_PAGE_SIZE));
  const activePageIndex = getSafeArchivePageIndex(currentPage, totalPages);
  const deferredWindowPageIndex = getSafeArchivePageIndex(deferredWindowPage, totalPages);
  const messagesOnPage = results;

  const getEntranceStyle = (
    isVisible: boolean,
    delayMs = 0,
    startY = -12
  ): React.CSSProperties => ({
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? "none" : `translateY(${startY}px)`,
    transition: `opacity 360ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms, transform 460ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms`,
    willChange: isVisible ? undefined : "opacity, transform",
  });

  // Clamp currentPage when totalPages changes (e.g., after filter change)
  useEffect(() => {
    if (totalPages > 0 && currentPage >= totalPages) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage]);

  const persistPins = (chips: SavedChip[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SAVED_PINS_STORAGE_KEY, JSON.stringify(chips));
    } catch (error) {
      console.warn("Failed to save pins to storage:", error);
    }
  };


  const loadSavedPinsFromStorage = () => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(SAVED_PINS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SavedChip[];
        setSavedPins(parsed);
      }
    } catch (error) {
      console.warn("Failed to load saved pins:", error);
    }
  };

  const fetchDateStats = async (applyDefaults = false) => {
    setLoadingStats(true);
    setStatsError(null);
    try {
      const response = await fetch("/api/archive/search?stats=1", {
        headers: getRequestHeaders(false),
      });
      if (!response.ok) {
        throw new Error("Failed to fetch archive stats");
      }
      const data = (await response.json()) as DateStats;
      setDateStats(data);
    } catch (error) {
      console.error("Error loading archive stats:", error);
      setStatsError("Unable to load archive date range");
    } finally {
      setLoadingStats(false);
    }
  };

  // Day grid helpers
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  // Format year/month/day to YYYY-MM-DD string (date-only, no timezone conversion)
  const formatYMD = (year: number, month: number, day: number) => {
    // Return pure YYYY-MM-DD string without timezone conversion
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${monthStr}-${dayStr}`;
  };

  // Format year/month to YYYY-MM string for month key
  const formatYM = (year: number, month: number) => {
    const monthStr = String(month + 1).padStart(2, '0');
    return `${year}-${monthStr}`;
  };

  // Parse YYYY-MM-DD string to local Date (treats as local date, not UTC)
  const parseLocalDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    return new Date(year, month, day);
  };

  // Time band helper
  const getTimeBandBounds = (dateStr: string, band: TimeBand) => {
    if (!dateStr) return { start_ts: null as string | null, end_ts: null as string | null };
    const [year, month, day] = dateStr.split("-").map((v) => Number(v));
    if (!year || !month || !day) return { start_ts: null, end_ts: null };

    // Interpret band in local time, then to ISO (browser will convert to local tz;
    // backend stores UTC; it's fine as long as we are consistent.)
    let startHour = 0;
    let endHour = 23;

    switch (band) {
      case "morning":
        startHour = 6;
        endHour = 11;
        break;
      case "afternoon":
        startHour = 12;
        endHour = 17;
        break;
      case "evening":
        startHour = 18;
        endHour = 22;
        break;
      case "night":
        // Night: 23:00–05:59 -> we'll treat as 23:00–23:59 for now to keep it single-day
        startHour = 23;
        endHour = 23;
        break;
      case "all":
      default:
        startHour = 0;
        endHour = 23;
    }

    const start = new Date(year, month - 1, day, startHour, 0, 0);
    const end = new Date(year, month - 1, day, endHour, 59, 59);

    return {
      start_ts: start.toISOString(),
      end_ts: end.toISOString(),
    };
  };

  // Helper: Get all dates in a range (inclusive)
  const getDatesInRange = (start: string, endStr: string): string[] => {
    const dates: string[] = [];
    const startDate = parseLocalDate(start);
    const endDate = parseLocalDate(endStr);
    if (!startDate || !endDate) return dates;
    
    const current = new Date(startDate);
    const endTime = new Date(endDate);
    
    while (current <= endTime) {
      dates.push(formatYMD(current.getFullYear(), current.getMonth(), current.getDate()));
      current.setDate(current.getDate() + 1);
    }
    
    return dates;
  };

  // Helper: get all dates in a given month (YYYY-MM format -> array of YYYY-MM-DD)
  const getAllDatesInMonth = (year: number, month: number): string[] => {
    const days = getDaysInMonth(year, month);
    const dates: string[] = [];
    for (let day = 1; day <= days; day++) {
      dates.push(formatYMD(year, month, day));
    }
    return dates;
  };

  // Helper: get all dates in a given year (array of YYYY-MM-DD)
  const getAllDatesInYear = (year: number): string[] => {
    const dates: string[] = [];
    // Loop through all 12 months
    for (let month = 0; month < 12; month++) {
      const monthDates = getAllDatesInMonth(year, month);
      dates.push(...monthDates);
    }
    return dates;
  };

  // Helper functions for date selection (used by drag and click)
  const selectDate = (ymd: string) => {
    if (!selectedDates.includes(ymd)) {
      const newDates = [...selectedDates, ymd].sort();
      setSelectedDates(newDates);
      setDatesDirty(true);
    }
  };

  const deselectDate = (ymd: string) => {
    if (selectedDates.includes(ymd)) {
      const newDates = selectedDates.filter((d) => d !== ymd);
      setSelectedDates(newDates);
      setDatesDirty(true);
    }
  };

  // Handle day drag start
  const handleDayDragStart = (ymd: string) => {
    setIsDragging(true);
    const mode = selectedDates.includes(ymd) ? "deselect" : "select";
    setDragMode(mode);
    dayDragMonthKeyRef.current = ymd.slice(0, 7);
    
    // Apply to the first day
    if (mode === "select") {
      selectDate(ymd);
    } else {
      deselectDate(ymd);
    }
  };

  // Handle day drag (apply selection/deselection during drag)
  const handleDayDrag = (ymd: string) => {
    if (!isDragging || !dragMode) return;
    if (dayDragMonthKeyRef.current && !ymd.startsWith(dayDragMonthKeyRef.current)) return;
    
    if (dragMode === "select") {
      selectDate(ymd);
    } else if (dragMode === "deselect") {
      deselectDate(ymd);
    }
  };

  // Handle day drag end
  const handleDayDragEnd = () => {
    if (isDragging) {
      setDatesDirty(true);
      setIsDragging(false);
      setDragMode(null);
      dayDragMonthKeyRef.current = null;
    }
  };

  // Helper functions for month selection (used by drag and click)
  const selectMonth = (year: number, month: number) => {
    const monthKey = formatYM(year, month);
    if (!selectedMonths.has(monthKey)) {
    const nextSelectedMonths = new Set(selectedMonths);
      nextSelectedMonths.add(monthKey);
    setSelectedMonths(nextSelectedMonths);
    
    // Update selectedDates based on new selection
      const monthDates = Array.from(nextSelectedMonths)
        .flatMap((key) => {
          const [yStr, mStr] = key.split("-");
          const monthYear = parseInt(yStr, 10);
          const monthIndex = parseInt(mStr, 10) - 1;
          return getAllDatesInMonth(monthYear, monthIndex);
        })
        .sort();
      setSelectedDates(monthDates);
      setTimeBand("all");
      setDatesDirty(true);
    }
  };

  const deselectMonth = (year: number, month: number) => {
    const monthKey = formatYM(year, month);
    if (selectedMonths.has(monthKey)) {
    const nextSelectedMonths = new Set(selectedMonths);
      nextSelectedMonths.delete(monthKey);
    setSelectedMonths(nextSelectedMonths);
    
    // Update selectedDates based on new selection
    if (nextSelectedMonths.size > 0) {
      const monthDates = Array.from(nextSelectedMonths)
        .flatMap((key) => {
          const [yStr, mStr] = key.split("-");
          const monthYear = parseInt(yStr, 10);
          const monthIndex = parseInt(mStr, 10) - 1;
          return getAllDatesInMonth(monthYear, monthIndex);
        })
        .sort();
      setSelectedDates(monthDates);
      setTimeBand("all");
      setDatesDirty(true);
    } else {
      setSelectedDates([]);
      setTimeBand("all");
      setDatesDirty(true);
    }
    }
  };

  // Handle month drag start (matches day calendar pattern)
  const handleMonthDragStart = (year: number, month: number) => {
    setIsMonthDragging(true);
    isMonthDraggingRef.current = true;
    monthDragStartRef.current = { year, month };
    const monthKey = formatYM(year, month);
    const mode = selectedMonths.has(monthKey) ? "deselect" : "select";
    setMonthDragMode(mode);
    
    // Apply to the first month immediately
    if (mode === "select") {
      selectMonth(year, month);
    } else {
      deselectMonth(year, month);
    }
    
    setActiveMonth({ year, month });
    setLastClickedMonth({ year, month });
  };

  // Handle month drag (apply selection/deselection during drag)
  const handleMonthDrag = (year: number, month: number) => {
    if (!isMonthDragging || !monthDragMode) return;
    
    // If we moved to a different pill, mark that we actually dragged
    if (monthDragStartRef.current && 
        (monthDragStartRef.current.year !== year || monthDragStartRef.current.month !== month)) {
      // This confirms it was a drag, not just a click
    }
    
    if (monthDragMode === "select") {
      selectMonth(year, month);
    } else if (monthDragMode === "deselect") {
      deselectMonth(year, month);
    }
    
    setActiveMonth({ year, month });
  };

  // Handle month drag end
  const handleMonthDragEnd = () => {
    if (isMonthDragging) {
      setDatesDirty(true);
      setIsMonthDragging(false);
      setMonthDragMode(null);
      // Reset ref after click handler has a chance to run
      setTimeout(() => {
        isMonthDraggingRef.current = false;
        monthDragStartRef.current = null;
      }, 0);
    }
  };

  // Global mouseup handler for drag end (when mouse leaves calendar area)
  useEffect(() => {
    if (!isDragging) return;
    
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setDatesDirty(true);
        setIsDragging(false);
        setDragMode(null);
        dayDragMonthKeyRef.current = null;
      }
    };
    
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging]);

  // Global mouseup handler for month drag end (when mouse leaves month pill area)
  useEffect(() => {
    if (!isMonthDragging) return;
    
    const handleGlobalMouseUp = () => {
      if (isMonthDragging) {
        setDatesDirty(true);
        setIsMonthDragging(false);
        setMonthDragMode(null);
        // Reset ref after click handler has a chance to run
        setTimeout(() => {
          isMonthDraggingRef.current = false;
          monthDragStartRef.current = null;
        }, 0);
      }
    };
    
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isMonthDragging]);

  // Handle day click: toggle single day or range selection (only if not dragging)
  const handleDayClick = (ymd: string, event: React.MouseEvent) => {
    // Don't handle click if we're in the middle of a drag
    if (isDragging) return;
    
    // Calculate new dates BEFORE updating state to avoid stale state
    let newDates: string[];
    if (event.shiftKey && selectedDates.length > 0) {
      // Range selection: select all dates between last selected and clicked date
      const lastSelected = selectedDates[selectedDates.length - 1];
      const range = getDatesInRange(lastSelected, ymd);
      newDates = [...new Set([...selectedDates, ...range])].sort();
      // Reset time band if multiple days will be selected
      if (newDates.length > 1) {
        setTimeBand("all");
      }
    } else {
      // Toggle single day
      const willBeSelected = !selectedDates.includes(ymd);
      newDates = willBeSelected 
        ? [...selectedDates, ymd].sort()
        : selectedDates.filter((d) => d !== ymd);
      
      // Reset time band if multiple days selected or if deselecting
      if (newDates.length !== 1) {
        setTimeBand("all");
      }
    }
    
    // Update state
    setSelectedDates(newDates);
    setDatesDirty(true);
  };

  // Clear all selected dates
  const handleClearSelection = () => {
    setSelectedDates([]);
    setTimeBand("all");
    setDatesDirty(true);
  };

  // Select all dates in a specific month
  const handleSelectAllInMonth = (year: number, month: number) => {
    const allDatesInMonth = getAllDatesInMonth(year, month);
    const newDates = [...new Set([...selectedDates, ...allDatesInMonth])].sort();
    setSelectedDates(newDates);
    setTimeBand("all");
    setDatesDirty(true);
  };

  // Clear all dates in a specific month
  const handleClearMonth = (year: number, month: number) => {
    const monthDates = getAllDatesInMonth(year, month);
    const newDates = selectedDates.filter(d => !monthDates.includes(d));
    setSelectedDates(newDates);
    setTimeBand("all");
    setDatesDirty(true);
  };

  // Select all dates in the current month view (backward compatibility)
  const handleSelectAll = () => {
    if (activeMonth) {
      handleSelectAllInMonth(activeMonth.year, activeMonth.month);
    }
  };

  // Tag (multi-term) helpers
  const normalizeTag = (value: string) => {
    let chip = value.trim();
    if (chip.startsWith('"') && chip.endsWith('"') && chip.length >= 2) {
      chip = chip.slice(1, -1).trim();
    }
    return chip;
  };

  // Tag-first search flow: Enter/search adds a term chip, empty submit reruns current filters.
  const handleSubmitArchiveSearch = () => {
    const normalized = normalizeTag(searchQuery);
    if (!normalized) {
      setLastAppliedQuery("");
      void runSearch({ queryOverride: "", resetPage: true });
      return;
    }

    if (searchTags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
      setSearchQuery("");
      setLastAppliedQuery("");
      void runSearch({ queryOverride: "", resetPage: true });
      return;
    }

    const newTags = [...searchTags, normalized];
    setSearchTags(newTags);
    setSearchQuery("");
    setLastAppliedQuery("");
    void runSearch({ tagOverride: newTags, queryOverride: "", resetPage: true });
  };

  const handleRemoveSearchTag = (chip: string) => {
    const newTags = searchTags.filter((c) => c !== chip);
    setSearchTags(newTags);
    setLastAppliedQuery("");
    void runSearch({ tagOverride: newTags, queryOverride: "", resetPage: true });
  };

  const handleClearSearchFilters = () => {
    setSearchQuery("");
    setLastAppliedQuery("");
    setSearchTags([]);
    setTagMatchMode("AND");
    setSourceFilter("");
    setRoleFilter("");
    void runSearch({
      tagOverride: [],
      tagModeOverride: "AND",
      queryOverride: "",
      resetPage: true,
    });
  };

  // Optimize search query input handler to prevent lag
  const handleSearchQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  // Zoom navigation functions
  const zoomToYear = (year: number) => {
    if (!dateStats?.ts_min || !dateStats?.ts_max) return;
    
    // Clear old histogram data immediately so year switches don't show stale bars.
    setMonthlyCounts(null);
    setLoadingMonthlyCounts(true);

    // Calculate year bounds in local timezone
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    
    // Clamp to actual archive bounds for zoom window (slider range)
    const archiveMin = new Date(dateStats.ts_min);
    const archiveMax = new Date(dateStats.ts_max);
    const clampedStart = new Date(Math.max(archiveMin.getTime(), yearStart.getTime()));
    const clampedEnd = new Date(Math.min(archiveMax.getTime(), yearEnd.getTime()));
    
    setSelectedYear(year);
    setZoomLevel("month");
    setActiveMonth({ year, month: 0 });
    setZoomStart(clampedStart.toISOString());
    setZoomEnd(clampedEnd.toISOString());
    
    // Pre-select all months that have messages
    const monthsWithMessages = new Set<string>();
    const allMonthDates: string[] = [];
    
    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);
      
      // Check if month intersects with archive range
      if (!(monthEnd < archiveMin || monthStart > archiveMax)) {
        const monthKey = formatYM(year, month);
        monthsWithMessages.add(monthKey);
        
        // Add all dates in this month
        const monthDates = getAllDatesInMonth(year, month);
        allMonthDates.push(...monthDates);
      }
    }
    
    setSelectedMonths(monthsWithMessages);
    setSelectedDates(allMonthDates.sort());
    setTimeBand("all");
    setDatesDirty(true);
  };

  // Handle month pill click (only if not dragging)
  const handleMonthClick = (year: number, month: number, event?: React.MouseEvent) => {
    // Don't handle click if we're in the middle of a drag (use ref for synchronous check)
    if (isMonthDraggingRef.current) {
      // If we clicked on the same pill we started on, it was a click (not drag)
      // The pill was already toggled on mousedown, so don't toggle again
      if (monthDragStartRef.current &&
          monthDragStartRef.current.year === year &&
          monthDragStartRef.current.month === month) {
        // This was a click on the same pill - already toggled on mousedown, so do nothing
        return;
      }
      // Otherwise it was part of a drag, so don't handle click
      return;
    }
    
    const monthKey = formatYM(year, month);
    let nextSelectedMonths = new Set(selectedMonths);
    
    if (event?.shiftKey && lastClickedMonth && lastClickedMonth.year === year) {
      // Range selection
      const startMonth = Math.min(lastClickedMonth.month, month);
      const endMonth = Math.max(lastClickedMonth.month, month);
      for (let m = startMonth; m <= endMonth; m++) {
        nextSelectedMonths.add(formatYM(year, m));
      }
    } else {
      // Toggle single month
      if (nextSelectedMonths.has(monthKey)) {
        nextSelectedMonths.delete(monthKey);
      } else {
        nextSelectedMonths.add(monthKey);
      }
    }
    
    setSelectedMonths(nextSelectedMonths);
    setActiveMonth({ year, month });
    setLastClickedMonth({ year, month });
    
    // Update selected dates based on selected months
    if (nextSelectedMonths.size > 0) {
      const monthDates = Array.from(nextSelectedMonths)
        .flatMap((key) => {
          const [yStr, mStr] = key.split("-");
          const monthYear = parseInt(yStr, 10);
          const monthIndex = parseInt(mStr, 10) - 1;
          return getAllDatesInMonth(monthYear, monthIndex);
        })
        .sort();
      setSelectedDates(monthDates);
      setTimeBand("all");
      setDatesDirty(true);
    } else {
      setSelectedDates([]);
      setTimeBand("all");
      setDatesDirty(true);
    }
  };

  const zoomOut = () => {
    if (zoomLevel === "month" && selectedYear !== null) {
      setZoomLevel("year");
      setSelectedYear(null);
      setSelectedMonths(new Set());
      setActiveMonth(null);
      setSelectedDates([]);
      setTimeBand("all");
      setZoomStart(null);
      setZoomEnd(null);
      setResults([]);
      setTotalResults(0);
      setCurrentPage(0);
      setMonthlyCounts(null);
      setDatesDirty(true);
    }
  };

  const handleApplyDates = () => {
    void runSearch({ selectedDatesOverride: selectedDates, queryOverride: lastAppliedQuery, resetPage: true });
  };

  // Get available years from archive
  const getAvailableYears = (): number[] => {
    if (!dateStats?.ts_min || !dateStats?.ts_max) return [];
    const minYear = new Date(dateStats.ts_min).getFullYear();
    const maxYear = new Date(dateStats.ts_max).getFullYear();
    const years: number[] = [];
    for (let year = minYear; year <= maxYear; year++) {
      years.push(year);
    }
    return years;
  };

  // Get available months in a year (that have messages)
  const getAvailableMonths = (year: number): number[] => {
    if (!dateStats?.ts_min || !dateStats?.ts_max) return [];
    // For now, return all months - could be optimized with backend query
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  };

  // Per-month counts and normalized activity (0–1) for histogram — from API monthlyCounts only
  const { monthCounts, monthActivity } = useMemo(() => {
    const counts = [
      monthlyCounts?.jan ?? 0, monthlyCounts?.feb ?? 0, monthlyCounts?.mar ?? 0, monthlyCounts?.apr ?? 0,
      monthlyCounts?.may ?? 0, monthlyCounts?.jun ?? 0, monthlyCounts?.jul ?? 0, monthlyCounts?.aug ?? 0,
      monthlyCounts?.sep ?? 0, monthlyCounts?.oct ?? 0, monthlyCounts?.nov ?? 0, monthlyCounts?.dec ?? 0,
    ];
    const max = Math.max(1, ...counts);
    const activity = counts.map((c) => c / max);
    return { monthCounts: counts, monthActivity: activity };
  }, [monthlyCounts]);

  // Fetch monthly counts when year is selected or filters change (same filters as message list)
  useEffect(() => {
    if (selectedYear === null) {
      setMonthlyCounts(null);
      setLoadingMonthlyCounts(false);
      monthlyCountsAbortRef.current?.abort();
      monthlyCountsAbortRef.current = null;
      lastMonthlyCountsYearRef.current = null;
      return;
    }

    monthlyCountsAbortRef.current?.abort();
    const controller = new AbortController();
    monthlyCountsAbortRef.current = controller;
    let cancelled = false;

    const yearChanged = lastMonthlyCountsYearRef.current !== selectedYear;
    lastMonthlyCountsYearRef.current = selectedYear;
    if (yearChanged) {
      setMonthlyCounts(null);
    }

    setLoadingMonthlyCounts(true);
    const params = new URLSearchParams();
    params.set("year", String(selectedYear));
    if (lastAppliedQuery) params.set("q", lastAppliedQuery);
    if (roleFilter) params.set("role", roleFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    searchTags.forEach((t) => params.append("chip_term", t));
    params.set("chip_mode", tagMatchMode);
    fetch(`/api/archive/monthly-counts?${params.toString()}`, {
      headers: getRequestHeaders(false),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to fetch"))))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!cancelled) setMonthlyCounts(data);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") {
          return;
        }
        if (!cancelled) setMonthlyCounts(null);
      })
      .finally(() => {
        if (!cancelled && monthlyCountsAbortRef.current === controller) {
          setLoadingMonthlyCounts(false);
          monthlyCountsAbortRef.current = null;
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedYear, lastAppliedQuery, roleFilter, sourceFilter, searchTags, tagMatchMode, getRequestHeaders]);


  const handleRemovePin = (chipId: string) => {
    setSavedPins((prev) => {
      const next = prev.filter((chip) => chip.id !== chipId);
      persistPins(next);
      return next;
    });
  };

  const handleApplyPin = (pin: SavedChip) => {
    setSearchQuery(pin.query);
    setLastAppliedQuery(pin.query); // Update last applied query so Select All works correctly
    setRoleFilter(pin.role);
    // Convert startDate/endDate back to selectedDates array
    const restoredDates =
      pin.startDate && pin.endDate ? getDatesInRange(pin.startDate, pin.endDate) : [];
    setSelectedDates(restoredDates);
    const restoredTags = pin.tags ?? [];
    setSearchTags(restoredTags);
    const restoredMode: TagMatchMode = pin.tagMode ?? "AND";
    setTagMatchMode(restoredMode);
    setTimeout(() => {
      void runSearch({
        selectedDatesOverride: restoredDates,
        tagOverride: restoredTags,
        tagModeOverride: restoredMode,
        queryOverride: pin.query, // Use pin's query
        resetPage: true,
      });
    }, 0);
  };

  // Auto-center highlighted message when context loads or expands
  useEffect(() => {
    if (contextResults.length > 0 && highlightId && !contextLoading) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        centerHighlightedMessage();
      }, 50);
    }
  }, [contextResults, highlightId, contextLoading]);

  useEffect(() => {
    let cancelled = false;
    let bootSettled = false;
    let minVisibleTimer: number | null = null;
    const bootStartedAt = Date.now();

    const finishInitialBoot = () => {
      if (bootSettled || cancelled) return;
      bootSettled = true;

      const elapsedMs = Date.now() - bootStartedAt;
      const remainingVisibleMs = Math.max(
        0,
        ARCHIVE_BOOT_MIN_VISIBLE_MS - elapsedMs
      );

      if (remainingVisibleMs === 0) {
        setInitialArchiveBootLoading(false);
        return;
      }

      minVisibleTimer = window.setTimeout(() => {
        if (!cancelled) {
          setInitialArchiveBootLoading(false);
        }
      }, remainingVisibleMs);
    };

    setInitialArchiveBootLoading(true);
    loadSavedPinsFromStorage();

    // Never let initial boot hang: reveal empty state quickly, continue loading in background.
    const maxWaitTimer = window.setTimeout(() => {
      finishInitialBoot();
    }, ARCHIVE_BOOT_MAX_WAIT_MS);

    void fetchDateStats(true).finally(() => {
      if (!cancelled) {
        window.clearTimeout(maxWaitTimer);
        finishInitialBoot();
      }
    });

    // Not critical for first paint.
    void loadMemoryFolders();
    // Removed: handleSearch(); - user must click Search button
    
    return () => {
      cancelled = true;
      window.clearTimeout(maxWaitTimer);
      if (minVisibleTimer !== null) {
        window.clearTimeout(minVisibleTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hasArchiveData = (dateStats?.total ?? 0) > 0;
    if (initialArchiveBootLoading || !hasArchiveData) {
      setShowStatsReveal(false);
      setShowSearchReveal(false);
      setShowLowerReveal(false);
      return;
    }

    const statsTimer = window.setTimeout(() => setShowStatsReveal(true), 40);
    const searchTimer = window.setTimeout(() => setShowSearchReveal(true), 180);
    const lowerTimer = window.setTimeout(() => setShowLowerReveal(true), 320);

    return () => {
      window.clearTimeout(statsTimer);
      window.clearTimeout(searchTimer);
      window.clearTimeout(lowerTimer);
    };
  }, [initialArchiveBootLoading, dateStats?.total]);

  // (Role filter dropdown removed)

  const loadMemoryFolders = async () => {
    try {
      const response = await fetch("/api/memory/folders", {
        headers: getRequestHeaders(false),
      });
      if (response.ok) {
        const data = await response.json();
        // Extract just the folder names from the response object
        // API returns { folders: [{ name: string, ... }], total_memories, unsorted_count }
        const folderNames = data.folders ? data.folders.map((f: { name: string }) => f.name) : [];
        setMemoryFolders(folderNames);
      } else {
        setMemoryFolders([]);
      }
    } catch (error) {
      console.error("Error loading memory folders:", error);
      setMemoryFolders([]);
    }
  };

  // Core search function that can use overrides (for day clicks / time bands)
  const runSearch = async (options?: {
    selectedDatesOverride?: string[];
    tagOverride?: string[];
    tagModeOverride?: TagMatchMode;
    timeBandOverride?: TimeBand;
    queryOverride?: string;
    page?: number; // Optional 0-based page override
    resetPage?: boolean;
  }) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setLoading(true);
    setError(null);
    setSearchWarning(null);

    try {
      const effectiveDates = options?.selectedDatesOverride ?? selectedDates;
      const effectiveTags = options?.tagOverride ?? searchTags;
      const effectiveTagMode = options?.tagModeOverride ?? tagMatchMode;
      const effectiveBand = options?.timeBandOverride ?? timeBand;
      const effectiveQuery = options?.queryOverride ?? lastAppliedQuery;
      const targetPageIndex = options?.resetPage
        ? 0
        : getSafeArchivePageIndex(options?.page ?? currentPage, totalPages);

      setCurrentPage(targetPageIndex);

      // If no dates are selected, don't search - clear results instead
      if (effectiveDates.length === 0) {
        setResults([]);
        setTotalResults(0);
        setCurrentPage(0);
        setSearchWarning(null);
        return; // Exit early, don't make API call
      }

      const params = new URLSearchParams();
      if (effectiveQuery) params.set("q", effectiveQuery);
      if (roleFilter) params.set("role", roleFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      
      // Handle selected dates
      if (effectiveDates.length === 1) {
        // Single day: use start_date/end_date (simpler and more efficient)
        params.set("start_date", effectiveDates[0]);
        params.set("end_date", effectiveDates[0]);
      } else if (effectiveDates.length > 1) {
        // Multiple days: use dates parameter with OR logic
        params.set("dates", effectiveDates.join(","));
      }
      
      if (effectiveTags.length > 0) {
        effectiveTags.forEach((chip) => {
          params.append("chip_term", chip);
        });
        params.set("chip_mode", effectiveTagMode);
      }

      // Time-of-day filter only when a single day is selected
      if (
        effectiveDates.length === 1 &&
        effectiveBand &&
        effectiveBand !== "all"
      ) {
        const { start_ts, end_ts } = getTimeBandBounds(effectiveDates[0], effectiveBand);
        if (start_ts && end_ts) {
          params.set("start_ts", start_ts);
          params.set("end_ts", end_ts);
        }
      }
      params.set("offset", String(targetPageIndex * ARCHIVE_RESULTS_PAGE_SIZE));
      params.set("limit", String(ARCHIVE_RESULTS_PAGE_SIZE));

      const response = await fetch(`/api/archive/search?${params.toString()}`, {
        headers: getRequestHeaders(false),
        signal: controller.signal,
      });
      if (!response.ok) {
        let errorMessage = "Failed to search archive";
        try {
          const errJson = await response.json() as { error?: string };
          if (errJson?.error) errorMessage = errJson.error;
        } catch {
          // ignore parse failures, keep generic message
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (controller.signal.aborted) {
        return;
      }
      if (data?.error) {
        throw new Error(data.error);
      }

      if (Array.isArray(data)) {
        setResults(data);
        setTotalResults(data.length);
        setSearchWarning(null);
        setDatesDirty(false);
        return;
      }

      if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
        console.warn("Unexpected API response format:", data);
        setResults([]);
        setTotalResults(0);
        setSearchWarning(null);
        setDatesDirty(false);
        return;
      }

      setSearchWarning(null);
      setDatesDirty(false);
      setResults(data.results as ArchiveMessage[]);
      setTotalResults(typeof data.total === "number" ? data.total : (data.results as ArchiveMessage[]).length);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") {
        return;
      }
      setSearchWarning(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setLoading(false);
      }
    }
  };

  // Public "use current filters" version (button / Enter key)
  const handleSearch = () => {
    if (selectedDates.length === 0) {
      setResults([]);
      setTotalResults(0);
      setCurrentPage(0);
      return;
    }

    setLastAppliedQuery("");
    void runSearch({
      selectedDatesOverride: selectedDates,
      queryOverride: "",
      tagOverride: searchTags,
      resetPage: true,
    });
  };

  const handlePageChange = (pageIndex: number) => {
    const safePageIndex = getSafeArchivePageIndex(pageIndex, totalPages);
    if (loading || safePageIndex === currentPage) {
      return;
    }

    void runSearch({ page: safePageIndex, resetPage: false });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (scope?.kind === "guest") {
      setImportError("Sign in required to import archive files.");
      if (e.target) {
        e.target.value = "";
      }
      return;
    }
    
    setImporting(true);
    setImportError(null);
    setImportStatus(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/archive/import", {
        method: "POST",
        headers: getRequestHeaders(false),
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Import failed");
      }
      
      const data = await response.json();
      setImportStatus(
        `Imported ${data.inserted} messages, skipped ${data.skipped} duplicates (${data.source})`
      );
      
      // Optionally trigger search to show new messages
      if (data.inserted > 0) {
        setTimeout(() => {
          handleSearch();
        }, 500);
        fetchDateStats();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      // Reset file input
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  const closeVaultModal = () => {
    setVaultingMessage(null);
    setSaveError(null);
    setSavingMessageId(null);
  };

  const handleVaultMessage = (message: ArchiveMessage) => {
    setVaultingMessage({
      ...message,
      text: cleanMessageText(getMsgText(message)),
    });
    setSaveError(null);
  };

  const handleClearArchive = async () => {
    if (!confirm("Delete ALL archive messages? This cannot be undone. You'll need to re-import your file.")) {
      return;
    }
    
    if (!confirm("Are you absolutely sure? This will delete all " + (dateStats?.total || 0) + " messages.")) {
      return;
    }
    
    try {
      const response = await fetch("/api/archive/clear", {
        method: "POST",
        headers: getRequestHeaders(false),
      });
      
      if (!response.ok) {
        throw new Error("Failed to clear archive");
      }
      
      const data = await response.json();
      const successMessage = data.message || "Archive cleared.";

      // Reset ALL archive UI state
      resetArchiveUI();
      setImportStatus(successMessage);
      setImportError(null);
    } catch (error) {
      setImportError(`Clear failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Comprehensive reset function for all archive UI state
  const resetArchiveUI = () => {
    // Core data state
    setResults([]);
    setDateStats(null);
    
    // Search and filter state
    setSearchQuery("");
    setLastAppliedQuery("");
    setSearchTags([]);
    setTagMatchMode("AND");
    setRoleFilter("");
    setSourceFilter("");
    setSelectedDates([]);
    setSearchWarning(null);
    
    // Pagination state
    setCurrentPage(0);
    setTotalResults(0);
    
    // Import state
    setImporting(false);
    setImportStatus(null);
    setImportError(null);
    
    // Vault modal state
    setVaultingMessage(null);
    setMemoryFolders([]);
    setSavingMessageId(null);
    setSaveError(null);
    setSavedPins([]);
    setPinFilter("");
    
    // Context state
    setContextResults([]);
    setContextLoading(false);
    setContextError(null);
    setHighlightId(null);
    setCopiedMessageId(null);
    
    // Zoom and date navigation state
    setZoomLevel("year");
    setSelectedYear(null);
    setSelectedMonths(new Set());
    setLastClickedMonth(null);
    setActiveMonth(null);
    setZoomStart(null);
    setZoomEnd(null);
    
    // Drag selection state
    setIsDragging(false);
    setDragMode(null);
    setIsMonthDragging(false);
    setMonthDragMode(null);
    
    // View modes
    setDateViewMode("months");
    setTimeBand("all");
    
    // Loading and error state
    setLoading(false);
    setError(null);
    setLoadingStats(false);
    setStatsError(null);
    
    // Refresh date stats after reset
    fetchDateStats();
  };


  // Base markdown components matching AssistantMessage styling
  const baseMarkdownComponents = useMemo(() => ({
    p: ({ node, ...props }: any) => (
      <p className="mt-0 mb-3 last:mb-0 text-[14px] leading-relaxed text-slate-100" {...props} />
    ),
    h1: ({ node, ...props }: any) => (
      <h1 className="text-2xl font-bold text-gray-100 mb-3 last:mb-0" {...props} />
    ),
    h2: ({ node, ...props }: any) => (
      <h2 className="text-xl font-semibold text-gray-100 mb-3 last:mb-0" {...props} />
    ),
    h3: ({ node, ...props }: any) => (
      <h3 className="text-lg font-semibold text-gray-200 mb-3 last:mb-0" {...props} />
    ),
    h4: ({ node, ...props }: any) => (
      <h4 className="text-base font-medium text-gray-300 mb-3 last:mb-0" {...props} />
    ),
    h5: ({ node, ...props }: any) => (
      <h5 className="text-sm font-medium text-gray-300 mb-3 last:mb-0" {...props} />
    ),
    h6: ({ node, ...props }: any) => (
      <h6 className="text-xs font-medium text-gray-400 mb-3 last:mb-0" {...props} />
    ),
    ul: ({ node, ...props }: any) => (
      <ul
        className="mt-0 mb-3 last:mb-0 ml-5 space-y-1.5 text-[14px] leading-relaxed text-slate-100 list-disc"
        {...props}
      />
    ),
    ol: ({ node, ...props }: any) => (
      <ol
        className="mt-0 mb-3 last:mb-0 ml-5 space-y-1.5 text-[14px] leading-relaxed text-slate-100 list-decimal"
        {...props}
      />
    ),
    li: ({ node, ...props }: any) => <li className="mt-0" {...props} />,
    table: ({ node, ...props }: any) => (
      <div className="mt-0 mb-3 last:mb-0">
        <div className="border border-slate-700/25 rounded-xl overflow-hidden overflow-x-auto">
          <table
            className="w-full border-collapse text-[14px] leading-relaxed"
            {...props}
          />
        </div>
      </div>
    ),
    thead: ({ node, ...props }: any) => (
      <thead className="bg-slate-900/80" {...props} />
    ),
    th: ({ node, ...props }: any) => (
      <th
        className="border border-slate-700/20 px-3 py-1 text-left text-[11px] font-semibold text-gray-200"
        {...props}
      />
    ),
    td: ({ node, ...props }: any) => (
      <td
        className="border border-slate-700/20 px-3 py-1 align-top text-gray-100"
        {...props}
      />
    ),
    code: (props: any) => {
      const isInline = !props.className;
      const text = String(props.children ?? "");

      if (isInline) {
        return (
          <code
            className="px-1 py-[1px] rounded-md bg-slate-800/80 text-[12px]"
            {...props}
          />
        );
      }

      // block code renderer
      return (
        <div className="relative mt-0 mb-3 last:mb-0">
          <button
            type="button"
            aria-label="Copy code"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
              } catch (err) {
                console.error("code copy failed", err);
              }
            }}
            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent border-transparent opacity-70 hover:opacity-100 hover:bg-white/5 transition p-0 leading-none"
          >
            <CopyIcon size={20} className="block scale-[1.05]" />
          </button>

          <pre className="w-full rounded-xl bg-slate-950/90 border border-slate-700/25 p-3 overflow-x-auto text-[12px] font-mono leading-relaxed">
            <code className="!bg-transparent" {...props} />
          </pre>
        </div>
      );
    },
    hr: () => <hr className="mt-0 mb-3 last:mb-0 border-transparent" />,
    blockquote: ({ node, ...props }: any) => (
      <blockquote className="mt-0 mb-3 last:mb-0 border-l-2 border-slate-600 pl-3 text-[14px] leading-relaxed text-slate-200/90" {...props} />
    ),
    a: ({ node, ...props }: any) => (
      <a className="text-blue-400 hover:text-blue-300 underline" {...props} />
    ),
  }), []);

  // Create ReactMarkdown components that highlight text nodes AFTER parsing
  // This prevents breaking markdown syntax (headers, lists, etc.)
  const createHighlightComponents = useCallback((query: string, tags: string[]) => {
    const termsToHighlight: string[] = [];
    
    // Collect terms from search query
    if (query.trim()) {
      const searchQuery = query.trim();
      if (searchQuery.startsWith('"') && searchQuery.endsWith('"') && searchQuery.length >= 2) {
        termsToHighlight.push(searchQuery.slice(1, -1).trim());
      } else {
        const words = searchQuery.split(/\s+/).filter(w => w.length > 2);
        termsToHighlight.push(...words);
      }
    }
    
    // Add tag terms
    if (tags.length > 0) {
      tags.forEach(tag => {
        if (tag.trim()) {
          termsToHighlight.push(tag.trim());
        }
      });
    }
    
    // Remove duplicates and sort by length (longest first)
    const uniqueTerms = Array.from(
      new Set(termsToHighlight.map(t => t.toLowerCase()))
    ).map(lower => {
      return termsToHighlight.find(t => t.toLowerCase() === lower) || lower;
    });
    
    uniqueTerms.sort((a, b) => b.length - a.length);
    
    // Function to highlight text content in React nodes
    const highlightTextContent = (node: React.ReactNode): React.ReactNode => {
      if (uniqueTerms.length === 0) return node;
      
      // If it's a string, highlight it
      if (typeof node === 'string') {
        let result: React.ReactNode[] = [];
        let currentIndex = 0;
        const text = node;
        
        // Find all matches
        const matches: Array<{ start: number; end: number }> = [];
        uniqueTerms.forEach(term => {
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(${escaped})`, 'gi');
          let match;
          while ((match = regex.exec(text)) !== null) {
            matches.push({
              start: match.index,
              end: match.index + match[0].length
            });
          }
        });
        
        // Sort and remove overlaps (keep longest)
        matches.sort((a, b) => a.start - b.start);
        const nonOverlapping: typeof matches = [];
        for (const match of matches) {
          const overlaps = nonOverlapping.some(m => 
            (match.start >= m.start && match.start < m.end) ||
            (match.end > m.start && match.end <= m.end)
          );
          if (!overlaps) {
            nonOverlapping.push(match);
          }
        }
        
        // Build highlighted result
        nonOverlapping.forEach((match, idx) => {
          if (match.start > currentIndex) {
            result.push(text.substring(currentIndex, match.start));
          }
          result.push(
            <mark key={`highlight-${match.start}-${idx}`} className="bg-yellow-200 text-gray-800 px-0.5 rounded">
              {text.substring(match.start, match.end)}
            </mark>
          );
          currentIndex = match.end;
        });
        
        if (currentIndex < text.length) {
          result.push(text.substring(currentIndex));
        }
        
        return result.length > 0 ? <>{result}</> : text;
      }
      
      // If it's an array, process each element
      if (Array.isArray(node)) {
        return node.map((child, idx) => (
          <React.Fragment key={idx}>{highlightTextContent(child)}</React.Fragment>
        ));
      }
      
      // Otherwise return as-is
      return node;
    };
    
    // Return components that wrap base components with highlighting
    return {
      // Handle text nodes (most common case) - highlight inline text
      text: ({ children }: any) => {
        return highlightTextContent(children);
      },
      // Wrap base components, applying highlighting to their children
      p: ({ children, ...props }: any) => {
        const BaseP = baseMarkdownComponents.p;
        return <BaseP {...props}>{highlightTextContent(children)}</BaseP>;
      },
      h1: ({ children, ...props }: any) => {
        const BaseH1 = baseMarkdownComponents.h1;
        return <BaseH1 {...props}>{highlightTextContent(children)}</BaseH1>;
      },
      h2: ({ children, ...props }: any) => {
        const BaseH2 = baseMarkdownComponents.h2;
        return <BaseH2 {...props}>{highlightTextContent(children)}</BaseH2>;
      },
      h3: ({ children, ...props }: any) => {
        const BaseH3 = baseMarkdownComponents.h3;
        return <BaseH3 {...props}>{highlightTextContent(children)}</BaseH3>;
      },
      h4: ({ children, ...props }: any) => {
        const BaseH4 = baseMarkdownComponents.h4;
        return <BaseH4 {...props}>{highlightTextContent(children)}</BaseH4>;
      },
      h5: ({ children, ...props }: any) => {
        const BaseH5 = baseMarkdownComponents.h5;
        return <BaseH5 {...props}>{highlightTextContent(children)}</BaseH5>;
      },
      h6: ({ children, ...props }: any) => {
        const BaseH6 = baseMarkdownComponents.h6;
        return <BaseH6 {...props}>{highlightTextContent(children)}</BaseH6>;
      },
      ul: ({ children, ...props }: any) => {
        const BaseUl = baseMarkdownComponents.ul;
        return <BaseUl {...props}>{highlightTextContent(children)}</BaseUl>;
      },
      ol: ({ children, ...props }: any) => {
        const BaseOl = baseMarkdownComponents.ol;
        return <BaseOl {...props}>{highlightTextContent(children)}</BaseOl>;
      },
      li: ({ children, ...props }: any) => {
        const BaseLi = baseMarkdownComponents.li;
        return <BaseLi {...props}>{highlightTextContent(children)}</BaseLi>;
      },
      table: ({ children, ...props }: any) => {
        const BaseTable = baseMarkdownComponents.table;
        return <BaseTable {...props}>{children}</BaseTable>;
      },
      thead: ({ children, ...props }: any) => {
        const BaseThead = baseMarkdownComponents.thead;
        return <BaseThead {...props}>{children}</BaseThead>;
      },
      th: ({ children, ...props }: any) => {
        const BaseTh = baseMarkdownComponents.th;
        return <BaseTh {...props}>{highlightTextContent(children)}</BaseTh>;
      },
      td: ({ children, ...props }: any) => {
        const BaseTd = baseMarkdownComponents.td;
        return <BaseTd {...props}>{highlightTextContent(children)}</BaseTd>;
      },
      code: (props: any) => {
        // For code blocks, we preserve the base component (no highlighting inside code)
        // For inline code, we preserve the base component (no highlighting inside code)
        return baseMarkdownComponents.code(props);
      },
      hr: () => baseMarkdownComponents.hr(),
      blockquote: ({ children, ...props }: any) => {
        const BaseBlockquote = baseMarkdownComponents.blockquote;
        return <BaseBlockquote {...props}>{highlightTextContent(children)}</BaseBlockquote>;
      },
      a: ({ children, ...props }: any) => {
        const BaseA = baseMarkdownComponents.a;
        return <BaseA {...props}>{highlightTextContent(children)}</BaseA>;
      },
      // Handle bold text (**text**)
      strong: ({ children, ...props }: any) => {
        return <strong {...props}>{highlightTextContent(children)}</strong>;
      },
      // Handle italic text (_text_)
      em: ({ children, ...props }: any) => {
        return <em {...props}>{highlightTextContent(children)}</em>;
      },
    };
  }, [baseMarkdownComponents]);

  const hasActiveSearchResultFilters = Boolean(lastAppliedQuery.trim() || searchTags.length > 0);
  const searchResultMarkdownComponents = useMemo(
    () =>
      hasActiveSearchResultFilters
        ? createHighlightComponents(lastAppliedQuery, searchTags)
        : baseMarkdownComponents,
    [baseMarkdownComponents, createHighlightComponents, hasActiveSearchResultFilters, lastAppliedQuery, searchTags]
  );

  // Load context for a message (shows ±N messages around it)
  const loadContext = async (messageId: number, window: number = 8) => {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await fetch(`/api/archive/context?id=${messageId}&window=${window}`, {
        headers: getRequestHeaders(false),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to load context");
      }

      const data = (await response.json()) as {
        messages: ArchiveMessage[];
        targetId: number;
      };

      setContextResults(data.messages);
      setHighlightId(data.targetId);
      setContextWindow(window);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : "Failed to load context");
      setContextResults([]);
    } finally {
      setContextLoading(false);
    }
  };

  // Refs for context scrolling
  const contextScrollRef = useRef<HTMLDivElement>(null);
  const highlightedMessageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleViewContext = (messageId: number) => {
    if (highlightId === messageId && contextResults.length > 0) {
      // If already showing this message's context, just center it
      centerHighlightedMessage();
      return;
    }
    void loadContext(messageId, 8); // Start with ±8 messages
  };

  const clearContext = () => {
    setContextResults([]);
    setHighlightId(null);
    setContextError(null);
    setContextWindow(8);
  };

  const expandContext = () => {
    if (!highlightId || contextLoading) return;
    const newWindow = contextWindow * 2; // Double the window (8 → 16, 16 → 32, etc.)
    void loadContext(highlightId, newWindow);
  };

  const centerHighlightedMessage = useCallback(() => {
    if (highlightedMessageRef.current) {
      highlightedMessageRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, []);

  // Scroll to message in main search results (optimized with position query)
  const scrollToMessage = async (message: ArchiveMessage) => {
    // Close context overlay
    clearContext();
    
    // Extract date from message timestamp (YYYY-MM-DD)
    const messageDate = new Date(getMsgTs(message)).toISOString().split('T')[0];
    
    try {
      // Use position query instead of loading 300 messages
      const params = new URLSearchParams();
      params.set("find_position", String(message.id));
      params.set("start_date", messageDate);
      params.set("end_date", messageDate);
      
      const response = await fetch(`/api/archive/search?${params.toString()}`, {
        headers: getRequestHeaders(false),
      });
      if (!response.ok) {
        throw new Error("Failed to find message position");
      }
      
      const data = await response.json() as {
        position: number;
        total: number;
      };
      
      // Calculate which 0-based page it belongs to.
      const pageIndex = Math.floor((data.position - 1) / ARCHIVE_RESULTS_PAGE_SIZE);
      
      // Navigate to that date and page
      setSelectedDates([messageDate]);
      await runSearch({ page: pageIndex, queryOverride: "", resetPage: false });
      
      // Scroll to message after results load
      setTimeout(() => {
        const element = document.getElementById(`message-${message.id}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          // Briefly highlight it
          element.classList.add("ring-2", "ring-blue-500", "ring-offset-2");
          setTimeout(() => {
            element.classList.remove("ring-2", "ring-blue-500", "ring-offset-2");
          }, 2000);
        }
      }, 500);
    } catch (error) {
      console.error("Error scrolling to message:", error);
      // Fallback: just navigate to the date
      setSelectedDates([messageDate]);
      await runSearch({ page: 0, queryOverride: "", resetPage: true });
    }
  };

  // Copy message text to clipboard with rich text + plain text fallbacks
  const handleCopyMessage = async (message: ArchiveMessage) => {
    const markdownToCopy = cleanMessageText(getMsgText(message));

    const nativeSelectionCopy = (html: string) => {
      try {
        const container = document.createElement("div");
        container.setAttribute("contenteditable", "true");
        container.style.position = "fixed";
        container.style.left = "-9999px";
        container.style.top = "0";
        container.style.width = "1px";
        container.style.height = "1px";
        container.style.opacity = "0";
        container.style.pointerEvents = "none";
        container.innerHTML = `<!doctype html><html><head><meta charset=\"utf-8\" /></head><body>${html}</body></html>`;
        document.body.appendChild(container);

        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        if (typeof (container as any).focus === "function") {
          (container as any).focus();
        }

        const ok = document.execCommand("copy");
        selection?.removeAllRanges();
        document.body.removeChild(container);
        return ok;
      } catch {
        return false;
      }
    };

    try {
      const { html, plain } = await buildClipboardPayload({
        markdown: markdownToCopy,
      });

      const ok = nativeSelectionCopy(html);

      try {
        const hasClipboardWrite = typeof navigator.clipboard?.write === "function";
        const hasClipboardItem = typeof window !== "undefined" && "ClipboardItem" in window;

        if (hasClipboardWrite && hasClipboardItem) {
          const htmlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
          const plainBlob = new Blob([plain || ""], { type: "text/plain;charset=utf-8" });
          // @ts-ignore
          const item = new ClipboardItem({
            "text/html": Promise.resolve(htmlBlob),
            "text/plain": Promise.resolve(plainBlob),
          });
          await navigator.clipboard.write([item]);
        } else if (!ok) {
          await navigator.clipboard.writeText(plain || markdownToCopy);
        }
      } catch {
        if (!ok) {
          await navigator.clipboard.writeText(plain || markdownToCopy);
        }
      }

      setCopiedMessageId(message.id);
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch (error) {
      console.error("Error copying message:", error);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = markdownToCopy;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopiedMessageId(message.id);
        setTimeout(() => {
          setCopiedMessageId(null);
        }, 2000);
      } catch (err) {
        console.error("Fallback copy failed:", err);
      }
      document.body.removeChild(textArea);
    }
  };

  const filteredPins = pinFilter
    ? savedPins.filter((chip) =>
        `${chip.label} ${chip.query}`.toLowerCase().includes(pinFilter.toLowerCase())
      )
    : savedPins;

  const hasArchiveData = Boolean(dateStats && dateStats.total > 0);
  const showArchiveContent = hasArchiveData && !initialArchiveBootLoading;
  const hasResolvedArchiveStats = Boolean(dateStats) || Boolean(statsError);
  const showEmptyArchiveState =
    !initialArchiveBootLoading &&
    !!dateStats &&
    dateStats.total === 0 &&
    !statsError;
  const showArchiveErrorState = !initialArchiveBootLoading && !!statsError;
  const statusCardMode: "loading" | "empty" | "error" | null = (initialArchiveBootLoading || !hasResolvedArchiveStats)
    ? "loading"
    : showArchiveErrorState
      ? "error"
      : showEmptyArchiveState
        ? "empty"
        : null;

  const handleVaultSave = async (data: {
    title: string;
    folderName: string;
    summary: string;
    doc_json?: unknown;
  }) => {
    if (!vaultingMessage) return;

    setSavingMessageId(vaultingMessage.id);
    setSaveError(null);

    // Use the summary from the modal (edited TipTap content)
    // Ensure summary is never empty (API rejects empty summaries)
    const summary = data.summary.trim() || " ";

    try {
      const response = await fetch("/api/archive/vault", {
        method: "POST",
        headers: {
          ...getRequestHeaders(false),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          archive_message_id: vaultingMessage.id,
          title: data.title || null,
          summary,
          doc_json: data.doc_json ?? null,
          folder_name: data.folderName,
          importance: null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save memory");
      }

      // Invalidate signed-in memory caches so Chat right panel reflects archive-vault saves immediately.
      if (typeof window !== "undefined") {
        try {
          const keysToRemove: string[] = [];
          for (let index = 0; index < sessionStorage.length; index++) {
            const key = sessionStorage.key(index);
            if (!key) continue;
            if (key.startsWith("db:userMemoryFolders:") || key.startsWith("db:userMemories:")) {
              keysToRemove.push(key);
            }
          }
          for (const key of keysToRemove) {
            sessionStorage.removeItem(key);
          }
        } catch {
          // ignore cache cleanup errors
        }
      }

      await loadMemoryFolders();
      closeVaultModal();
      setTimeout(() => {
        setSavingMessageId(null);
      }, 1000);
    } catch (error) {
      console.error("Error saving message to vault:", error);
      setSaveError(`Failed to vault: ${error instanceof Error ? error.message : "Unknown error"}`);
      setSavingMessageId(null);
      setTimeout(() => setSaveError(null), 3000);
      throw error; // Re-throw so modal can handle it
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0d1525] via-[#0e1628] to-[#0d1525]">
        {/* Top bar (match v2 mockup styling) */}
        <div className="sticky top-0 z-30 h-12 flex-shrink-0 border-b border-blue-500/30 bg-slate-900/80 backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)]">
          <div className="h-full px-3 flex items-center justify-between w-full">
            {/* Left column - Back to Chat button */}
            <div className="w-1/3 flex items-center justify-start">
              <Link
                href="/"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-transform duration-200 ease-out hover:-translate-y-[1px] hover:scale-[1.03] active:translate-y-0 active:scale-100"
                aria-label="Back to Chat"
                title="Back to Chat"
                onClick={() => {
                  try {
                    sessionStorage.setItem(SS_RETURN_FROM_ARCHIVE, "1");
                  } catch {
                    // ignore
                  }
                }}
              >
                <svg
                  className="w-5 h-5 block"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient
                      id={chatIconGradientId}
                      x1="3"
                      y1="3"
                      x2="21"
                      y2="21"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                  <path d="M8 10H8.01" stroke={`url(#${chatIconGradientId})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 10H12.01" stroke={`url(#${chatIconGradientId})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 10H16.01" stroke={`url(#${chatIconGradientId})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 13V7C21 5.11438 21 4.17157 20.4142 3.58579C19.8284 3 18.8856 3 17 3H7C5.11438 3 4.17157 3 3.58579 3.58579C3 4.17157 3 5.11438 3 7V13C3 14.8856 3 15.8284 3.58579 16.4142C4.17157 17 5.11438 17 7 17H7.5C7.77614 17 8 17.2239 8 17.5V20V20.1499C8 20.5037 8.40137 20.7081 8.6875 20.5L13.0956 17.2941C13.3584 17.103 13.675 17 14 17H17C18.8856 17 19.8284 17 20.4142 16.4142C21 15.8284 21 14.8856 21 13Z" stroke={`url(#${chatIconGradientId})`} strokeWidth="2" strokeLinejoin="round"/>
                </svg>
              </Link>
            </div>
            
            {/* Center column - Archive text */}
            <div className="w-1/3 flex items-center justify-center h-full">
              <h1 className="text-lg font-semibold text-gray-200">Archive</h1>
            </div>
            
            {/* Right column - DartBoard logo (display only) */}
            <div className="w-1/3 flex items-center justify-end">
              <div className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-gray-200">
                <img
                  src="/dartz-icon.png"
                  alt="DartBoard"
                  className="h-5 w-5"
                />
                <span className="text-sm font-semibold">DartBoard</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="mx-auto max-w-[1100px] px-6 py-8">
            <div className="space-y-6">
        {/* Import Section - matching v2 ImportCard design exactly */}
        <div className={`${archiveCardStyles.base} group relative`}>
          {/* Subtle glow effect on hover - positioned behind content */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none -z-10" />
          
          {showArchiveContent && hasArchiveData && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                handleClearArchive();
              }}
              className="absolute right-4 top-4 border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
              title="Delete all archive messages"
            >
              Clear Archive
            </Button>
          )}

          <div className="mb-4">
            <h2 className="text-xl font-semibold text-foreground">
              Import ChatGPT Archive
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload your ChatGPT export (.json or .parquet) to build your
              searchable archive.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.parquet"
              onChange={handleImport}
              disabled={importing || scope?.kind === "guest"}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || scope?.kind === "guest"}
              className="bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors gap-2 inline-flex items-center"
            >
              <Upload className="h-4 w-4" />
              {scope?.kind === "guest" ? "Sign In to Import" : "Choose File"}
            </button>
            {importStatus && (
              <span className="text-sm text-muted-foreground">Archive loaded successfully</span>
            )}
            {importError && (
              <span className="text-sm text-red-300">{importError}</span>
            )}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-yellow-900/20 border border-yellow-700/50 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-200/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-sm text-yellow-200/90">
              Some formatting may not convert perfectly from ChatGPT exports.
            </p>
          </div>
        </div>

        {statusCardMode && (
          <div
            className={`${archiveCardStyles.base} group relative overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              statusCardMode === "loading" ? "h-[176px]" : "h-[108px]"
            }`}
          >
            <div
              className={`absolute inset-0 rounded-xl pointer-events-none -z-10 ${
                statusCardMode === "error"
                  ? "bg-gradient-to-br from-red-500/10 to-transparent"
                  : "bg-gradient-to-br from-blue-500/10 to-transparent"
              }`}
            />

            <div className="relative h-full">
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-3 text-center transition-all duration-350 ease-out ${
                  statusCardMode === "loading"
                    ? "opacity-100 translate-y-0"
                    : "pointer-events-none opacity-0 -translate-y-3"
                }`}
              >
                <div className="w-[120px] h-[28px] overflow-hidden opacity-90">
                  <div className="w-full h-full scale-[2.0] origin-center transform-gpu">
                    <DotLottieReact
                      src="https://lottie.host/99bea97e-b406-41c9-a855-2ea09615f68c/REnhRSQkTU.lottie"
                      loop
                      autoplay
                      style={{ width: "100%", height: "100%" }}
                    />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-200">Preparing archive...</p>
                <p className="text-xs text-gray-400">
                  Loading stats and timeline before revealing search controls.
                </p>
              </div>

              <div
                className={`absolute inset-0 flex flex-col justify-center gap-1 text-left transition-all duration-350 ease-out ${
                  statusCardMode === "empty"
                    ? "opacity-100 translate-y-0 delay-75"
                    : "pointer-events-none opacity-0 translate-y-3"
                }`}
              >
                <p className="text-sm font-medium text-gray-200">No archive data yet</p>
                <p className="text-xs text-gray-400">
                  Import a ChatGPT export to populate Archive search and timeline.
                </p>
              </div>

              <div
                className={`absolute inset-0 flex flex-col justify-center gap-1 text-left transition-all duration-350 ease-out ${
                  statusCardMode === "error"
                    ? "opacity-100 translate-y-0 delay-75"
                    : "pointer-events-none opacity-0 translate-y-3"
                }`}
              >
                <p className="text-sm font-medium text-red-200">Archive unavailable right now</p>
                <p className="text-xs text-red-300/90">{statsError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Stat Tiles - matching v2 mockup */}
        {dateStats && showArchiveContent && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* Total Messages */}
            <div className={`${archiveCardStyles.base} group relative`} style={getEntranceStyle(showStatsReveal, 0)}>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
              <div className="relative">
                <div className="mb-3 inline-flex rounded-lg p-2.5 bg-blue-500/10">
                  <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total Messages
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {dateStats.total.toLocaleString()}
                </p>
              </div>
            </div>

            {/* ChatGPT Messages */}
            <div className={`${archiveCardStyles.base} group relative`} style={getEntranceStyle(showStatsReveal, 90)}>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
              <div className="relative">
                <div className="mb-3 inline-flex rounded-lg p-2.5 bg-emerald-500/10">
<svg className="h-5 w-5 text-emerald-400" viewBox="0 0 512 512" fill="currentColor">
  <path d="M 274.953,511.596 C 274.637,511.280 273.661,511.140 270.462,510.954 C 268.214,510.822 265.137,510.497 263.625,510.230 C 262.113,509.964 260.524,509.747 260.094,509.748 C 259.664,509.749 258.858,509.589 258.302,509.394 C 257.747,509.197 256.748,508.966 256.083,508.880 C 255.004,508.741 253.786,508.466 250,507.505 C 249.381,507.348 248.201,507.049 247.378,506.841 C 246.555,506.633 245.767,506.369 245.628,506.254 C 245.489,506.139 244.925,505.972 244.375,505.882 C 243.825,505.793 242.869,505.517 242.250,505.269 C 240.661,504.632 239.548,504.243 238.250,503.871 C 237.631,503.694 236.787,503.370 236.375,503.151 C 235.963,502.932 235.456,502.752 235.250,502.750 C 235.044,502.748 234.537,502.523 234.125,502.250 C 233.713,501.977 233.219,501.753 233.028,501.752 C 232.679,501.750 232.074,501.489 228.375,499.745 C 224.167,497.760 223.071,497.214 221.375,496.254 C 220.412,495.709 219.231,495.051 218.750,494.792 C 216.863,493.776 216.495,493.554 213.750,491.769 C 212.994,491.277 212.181,490.762 211.945,490.625 C 211.101,490.134 208.346,488.206 206.660,486.927 C 199.745,481.680 194.721,477.261 189.988,472.265 C 188.156,470.332 186.474,468.750 186.250,468.750 C 186.025,468.750 185.005,468.972 183.983,469.244 C 182.961,469.516 181.731,469.740 181.250,469.742 C 180.769,469.744 179.250,469.965 177.875,470.233 C 176.500,470.502 173.744,470.850 171.750,471.007 C 169.756,471.164 167,471.389 165.625,471.507 C 162.555,471.771 156.155,471.771 153.125,471.507 C 151.887,471.400 149.244,471.179 147.250,471.017 C 145.256,470.854 142.500,470.502 141.125,470.233 C 139.750,469.965 138.231,469.744 137.750,469.742 C 137.269,469.740 136.039,469.516 135.017,469.244 C 133.995,468.972 132.839,468.750 132.448,468.750 C 132.058,468.750 131.097,468.525 130.315,468.250 C 129.532,467.975 128.607,467.750 128.259,467.750 C 127.910,467.750 126.950,467.535 126.125,467.272 C 125.300,467.010 123.894,466.560 123,466.272 C 122.106,465.985 121.206,465.746 121,465.741 C 120.794,465.737 120.175,465.516 119.625,465.250 C 119.075,464.984 118.400,464.759 118.125,464.750 C 117.850,464.741 117.175,464.516 116.625,464.250 C 116.075,463.984 115.400,463.762 115.125,463.757 C 114.850,463.751 114.287,463.523 113.875,463.250 C 113.463,462.977 112.928,462.753 112.686,462.752 C 112.445,462.751 111.828,462.525 111.315,462.250 C 110.802,461.975 110.234,461.750 110.053,461.750 C 109.872,461.750 109.308,461.539 108.799,461.281 C 108.291,461.022 107.312,460.555 106.625,460.243 C 105.938,459.932 105.206,459.579 105,459.462 C 104.794,459.344 104.456,459.178 104.250,459.093 C 103.276,458.693 98.290,456.168 97.625,455.738 C 97.213,455.471 96.425,455.029 95.875,454.755 C 94.746,454.192 94.457,454.019 92.430,452.695 C 91.635,452.175 90.928,451.750 90.859,451.750 C 90.790,451.750 89.943,451.216 88.977,450.562 C 88.010,449.909 86.861,449.159 86.422,448.895 C 85.984,448.630 84.871,447.815 83.951,447.082 C 83.030,446.349 82.207,445.750 82.123,445.750 C 82.038,445.750 80.289,444.391 78.236,442.730 C 70.439,436.423 61.669,427.171 55.581,418.832 C 53.692,416.243 51.716,413.349 51.101,412.269 C 50.900,411.915 50.519,411.288 50.255,410.875 C 49.991,410.462 49.291,409.297 48.700,408.284 C 48.109,407.272 47.377,406.034 47.075,405.534 C 46.772,405.034 46.462,404.485 46.387,404.312 C 46.312,404.140 46.188,403.860 46.113,403.688 C 46.038,403.515 45.703,402.925 45.368,402.375 C 45.033,401.825 44.633,401.094 44.478,400.750 C 44.324,400.406 43.759,399.244 43.224,398.167 C 42.688,397.091 42.250,396.096 42.250,395.957 C 42.250,395.818 42.025,395.418 41.750,395.068 C 41.475,394.719 41.250,394.263 41.250,394.056 C 41.250,393.849 41.013,393.161 40.723,392.527 C 39.447,389.738 39.587,390.084 38.492,387 C 38.322,386.519 37.989,385.619 37.753,385 C 36.954,382.908 36.458,381.379 36.250,380.375 C 36.136,379.825 35.875,378.869 35.669,378.250 C 34.561,374.920 34.250,373.810 34.250,373.181 C 34.250,372.800 34.025,371.848 33.750,371.065 C 33.475,370.283 33.250,369.305 33.250,368.892 C 33.250,368.479 33.035,367.238 32.771,366.133 C 32.508,365.029 32.175,363.225 32.033,362.125 C 31.891,361.025 31.662,359.337 31.523,358.375 C 30.283,349.750 30.283,335.605 31.524,327.125 C 31.665,326.163 31.893,324.419 32.032,323.250 C 32.170,322.081 32.446,320.548 32.645,319.844 C 32.843,319.139 33.111,317.789 33.240,316.844 C 33.369,315.899 33.644,314.675 33.852,314.125 C 34.059,313.575 34.231,312.844 34.236,312.500 C 34.239,312.156 34.477,311.087 34.764,310.125 C 35.050,309.163 35.518,307.587 35.804,306.625 C 36.089,305.663 36.495,304.347 36.706,303.702 C 36.706,303.702 37.089,302.529 37.089,302.529 C 37.089,302.529 36.159,301.452 36.159,301.452 C 34.093,299.057 28.105,291.454 27.250,290.140 C 27.044,289.824 26.087,288.397 25.125,286.969 C 23.230,284.160 23.154,284.043 22.303,282.596 C 21.989,282.062 21.459,281.175 21.128,280.625 C 20.534,279.641 20.458,279.498 20.137,278.750 C 20.049,278.544 19.708,277.925 19.381,277.375 C 19.053,276.825 18.207,275.194 17.500,273.750 C 16.793,272.306 15.998,270.709 15.732,270.200 C 15.467,269.692 15.250,269.147 15.250,268.990 C 15.250,268.833 15.025,268.418 14.750,268.068 C 14.475,267.719 14.250,267.263 14.250,267.056 C 14.250,266.849 14.025,266.189 13.750,265.590 C 13.475,264.990 13.025,264.010 12.750,263.410 C 12.475,262.811 12.246,262.164 12.242,261.973 C 12.237,261.781 12.016,261.175 11.750,260.625 C 11.484,260.075 11.263,259.423 11.258,259.178 C 11.254,258.932 11.025,258.289 10.750,257.750 C 10.475,257.211 10.250,256.536 10.250,256.250 C 10.250,255.964 10.041,255.313 9.785,254.803 C 9.530,254.292 9.249,253.412 9.162,252.845 C 9.076,252.279 8.835,251.492 8.629,251.095 C 8.422,250.699 8.252,250.090 8.252,249.741 C 8.251,249.393 8.025,248.468 7.750,247.685 C 7.475,246.903 7.250,245.993 7.250,245.664 C 7.250,245.334 7.025,244.361 6.750,243.500 C 6.475,242.639 6.250,241.599 6.250,241.189 C 6.250,240.779 6.035,239.528 5.773,238.409 C 5.511,237.291 5.222,235.447 5.131,234.314 C 5.040,233.180 4.855,231.886 4.719,231.439 C 4.583,230.991 4.304,227.588 4.100,223.875 C 3.654,215.770 3.954,205.136 4.768,200.210 C 5.033,198.606 5.250,196.806 5.250,196.209 C 5.250,195.612 5.475,194.337 5.750,193.375 C 6.025,192.413 6.250,191.229 6.250,190.742 C 6.250,190.256 6.475,189.218 6.750,188.435 C 7.025,187.653 7.250,186.708 7.250,186.337 C 7.250,185.965 7.484,184.865 7.769,183.893 C 8.055,182.921 8.515,181.338 8.792,180.375 C 9.069,179.412 9.410,178.287 9.550,177.875 C 9.690,177.463 9.918,176.675 10.057,176.125 C 10.197,175.575 10.506,174.619 10.746,174 C 11.170,172.905 11.457,172.107 12.027,170.438 C 12.180,169.991 12.517,169.209 12.777,168.701 C 13.037,168.192 13.250,167.630 13.249,167.451 C 13.249,167.272 13.490,166.619 13.786,166 C 14.081,165.381 14.521,164.425 14.764,163.875 C 15.505,162.194 19.511,154.203 20.279,152.875 C 20.676,152.188 21.116,151.400 21.256,151.125 C 21.395,150.850 21.841,150.119 22.246,149.500 C 22.650,148.881 23.157,148.037 23.372,147.625 C 23.844,146.720 24.155,146.216 25.130,144.773 C 25.540,144.167 26.044,143.410 26.250,143.092 C 27.460,141.225 28.814,139.354 30.425,137.322 C 31.429,136.056 32.250,134.946 32.250,134.855 C 32.250,134.765 33.124,133.720 34.192,132.533 C 35.261,131.346 36.654,129.756 37.287,129 C 38.747,127.258 43.347,122.632 45.770,120.469 C 49.338,117.282 51.695,115.272 52.533,114.701 C 52.997,114.384 54.186,113.478 55.175,112.688 C 56.164,111.897 57.039,111.250 57.119,111.250 C 57.199,111.250 57.834,110.800 58.530,110.250 C 59.225,109.700 59.887,109.250 60,109.250 C 60.113,109.250 60.775,108.800 61.470,108.250 C 62.166,107.700 62.901,107.250 63.103,107.250 C 63.305,107.250 63.543,107.133 63.631,106.990 C 63.782,106.746 65.255,105.735 66.375,105.108 C 66.650,104.954 67.269,104.592 67.750,104.305 C 68.600,103.798 70.957,102.520 73.250,101.325 C 73.869,101.002 74.544,100.645 74.750,100.531 C 74.956,100.417 75.631,100.093 76.250,99.810 C 76.869,99.527 78.340,98.835 79.519,98.273 C 80.698,97.710 81.823,97.249 82.019,97.248 C 82.215,97.247 82.713,97.023 83.125,96.750 C 83.537,96.477 84.046,96.253 84.254,96.252 C 84.462,96.251 85.052,96.025 85.565,95.750 C 86.078,95.475 86.697,95.250 86.940,95.250 C 87.183,95.250 87.802,95.025 88.315,94.750 C 88.828,94.475 89.471,94.250 89.743,94.250 C 90.014,94.250 90.718,94.039 91.306,93.780 C 91.894,93.522 93.219,93.064 94.250,92.761 C 95.281,92.460 96.631,92.042 97.250,91.834 C 97.869,91.626 98.938,91.358 99.625,91.240 C 100.312,91.121 101.325,90.855 101.875,90.648 C 102.425,90.441 103.244,90.267 103.695,90.261 C 105.624,90.235 106.778,89.233 107.236,87.188 C 107.371,86.586 107.653,85.763 107.864,85.359 C 108.075,84.956 108.248,84.454 108.249,84.246 C 108.249,84.038 108.475,83.448 108.750,82.935 C 109.025,82.422 109.250,81.822 109.250,81.602 C 109.250,81.382 109.409,80.903 109.602,80.538 C 110.223,79.368 111.250,77.082 111.250,76.871 C 111.250,76.613 115.469,68.182 116.703,65.975 C 117.210,65.067 117.837,63.942 118.096,63.475 C 118.620,62.530 119.829,60.619 121.287,58.430 C 121.817,57.635 122.250,56.919 122.250,56.839 C 122.250,56.760 122.700,56.157 123.250,55.500 C 123.800,54.843 124.250,54.234 124.250,54.148 C 124.250,53.859 128.707,48.115 131.174,45.225 C 133.792,42.157 140.929,34.910 143.375,32.834 C 144.200,32.135 145.801,30.765 146.933,29.790 C 148.065,28.815 149.302,27.822 149.683,27.583 C 150.064,27.343 150.881,26.738 151.500,26.237 C 153.589,24.545 159.101,20.819 162.375,18.884 C 163.200,18.396 164.325,17.718 164.875,17.375 C 165.813,16.792 166.351,16.511 167.250,16.134 C 167.456,16.047 168.075,15.707 168.625,15.378 C 170.205,14.433 175.894,11.701 178.500,10.636 C 179.394,10.271 180.423,9.809 180.788,9.611 C 181.154,9.412 181.660,9.249 181.913,9.248 C 182.167,9.247 182.713,9.023 183.125,8.750 C 183.537,8.477 184.125,8.253 184.431,8.252 C 184.737,8.251 185.468,8.039 186.056,7.782 C 187.456,7.168 188.644,6.753 189.875,6.447 C 190.425,6.310 191.438,5.994 192.125,5.746 C 192.812,5.497 193.792,5.223 194.302,5.138 C 194.812,5.051 195.543,4.817 195.927,4.617 C 196.311,4.417 196.920,4.252 197.280,4.252 C 197.640,4.251 198.639,4.025 199.500,3.750 C 200.361,3.475 201.356,3.250 201.712,3.250 C 202.068,3.250 203.262,3.036 204.367,2.774 C 205.471,2.512 207.219,2.181 208.250,2.038 C 209.281,1.895 210.856,1.662 211.750,1.522 C 212.644,1.381 215.165,1.151 217.353,1.010 C 220.114,0.832 221.508,0.638 221.907,0.377 C 222.792,-0.203 236.243,-0.180 237.132,0.403 C 237.583,0.698 238.798,0.868 241.686,1.040 C 243.852,1.169 246.863,1.495 248.375,1.764 C 249.887,2.032 251.470,2.252 251.893,2.251 C 252.315,2.251 253.159,2.418 253.768,2.623 C 254.377,2.829 255.550,3.096 256.375,3.218 C 258.190,3.486 260.844,4.120 262.875,4.770 C 263.700,5.034 264.656,5.254 265,5.258 C 265.344,5.263 266.075,5.484 266.625,5.750 C 267.175,6.016 267.883,6.237 268.197,6.242 C 268.512,6.246 269.211,6.475 269.750,6.750 C 270.289,7.025 270.960,7.250 271.241,7.250 C 271.522,7.250 272.172,7.475 272.685,7.750 C 273.198,8.025 273.817,8.250 274.060,8.250 C 274.303,8.250 274.922,8.475 275.435,8.750 C 275.948,9.025 276.538,9.251 276.746,9.252 C 276.954,9.253 277.462,9.477 277.875,9.750 C 278.288,10.023 278.828,10.247 279.075,10.248 C 279.323,10.249 279.942,10.461 280.450,10.720 C 280.959,10.978 281.881,11.421 282.500,11.704 C 285.264,12.971 289.047,14.873 290.461,15.561 C 290.752,15.852 293.353,17.369 294.751,18.064 C 296.075,18.722 303.915,23.947 305.433,25.183 C 306.154,25.770 306.806,26.250 306.884,26.250 C 307.051,26.250 310.516,29.030 312.606,30.841 C 316.027,33.807 320.049,37.642 322.582,40.353 C 324.432,42.333 325.460,43.250 325.832,43.250 C 326.132,43.250 327.163,43.025 328.125,42.750 C 329.087,42.475 330.267,42.250 330.749,42.250 C 331.231,42.251 332.806,42.028 334.250,41.757 C 335.694,41.485 338.450,41.134 340.375,40.977 C 342.300,40.820 345,40.598 346.375,40.484 C 349.479,40.228 355.882,40.233 358.875,40.493 C 360.113,40.600 362.756,40.821 364.750,40.983 C 366.744,41.146 369.500,41.498 370.875,41.767 C 372.250,42.035 373.769,42.256 374.250,42.258 C 374.731,42.260 375.961,42.484 376.983,42.756 C 378.005,43.028 379.161,43.250 379.552,43.250 C 379.942,43.250 380.902,43.475 381.685,43.750 C 382.467,44.025 383.449,44.251 383.866,44.252 C 384.284,44.252 384.949,44.422 385.346,44.629 C 385.742,44.836 386.529,45.076 387.096,45.163 C 387.662,45.250 388.663,45.530 389.322,45.785 C 389.980,46.041 390.711,46.254 390.947,46.258 C 391.182,46.263 391.825,46.484 392.375,46.750 C 392.925,47.016 393.600,47.241 393.875,47.250 C 394.150,47.259 394.825,47.484 395.375,47.750 C 395.925,48.016 396.546,48.237 396.754,48.242 C 396.962,48.246 397.552,48.475 398.065,48.750 C 398.578,49.025 399.168,49.250 399.375,49.250 C 399.582,49.250 400.172,49.475 400.685,49.750 C 401.198,50.025 401.766,50.250 401.947,50.250 C 402.128,50.250 402.692,50.466 403.200,50.731 C 403.709,50.995 405.137,51.679 406.375,52.251 C 409.915,53.885 414.106,56.035 416.375,57.381 C 416.925,57.707 417.622,58.087 417.924,58.226 C 418.226,58.364 419.040,58.876 419.734,59.364 C 420.427,59.851 421.057,60.250 421.132,60.250 C 421.208,60.250 421.575,60.460 421.948,60.716 C 422.320,60.973 423.244,61.587 424,62.082 C 433.337,68.188 444.217,77.997 451.361,86.750 C 453.650,89.555 457.221,94.228 457.875,95.275 C 458.012,95.495 458.460,96.170 458.870,96.775 C 459.280,97.380 459.730,98.062 459.870,98.290 C 460.010,98.519 460.468,99.194 460.887,99.790 C 461.306,100.387 461.733,101.044 461.836,101.250 C 461.940,101.456 462.296,102.075 462.627,102.625 C 464.700,106.058 465.901,108.243 467.505,111.500 C 468.216,112.944 468.900,114.294 469.026,114.500 C 469.151,114.706 469.381,115.156 469.536,115.500 C 470.078,116.697 470.826,118.382 471.257,119.375 C 471.495,119.925 471.929,120.912 472.220,121.569 C 472.512,122.226 472.754,122.901 472.759,123.069 C 472.763,123.237 472.984,123.825 473.250,124.375 C 473.516,124.925 473.737,125.576 473.741,125.823 C 473.746,126.069 473.975,126.711 474.250,127.250 C 474.525,127.789 474.750,128.391 474.750,128.588 C 474.750,128.785 474.973,129.436 475.245,130.035 C 475.517,130.635 475.745,131.406 475.753,131.750 C 475.761,132.094 475.984,132.825 476.250,133.375 C 476.516,133.925 476.737,134.592 476.741,134.857 C 476.746,135.123 476.964,136.079 477.226,136.982 C 477.982,139.588 478.549,142.012 478.749,143.500 C 478.851,144.256 479.108,145.550 479.321,146.375 C 479.533,147.200 479.824,148.831 479.967,150 C 480.110,151.169 480.344,152.969 480.485,154 C 480.893,156.964 481.506,166.344 481.499,169.500 C 481.495,171.081 481.378,173.725 481.238,175.375 C 481.098,177.025 480.882,179.950 480.756,181.875 C 480.631,183.800 480.414,185.769 480.275,186.250 C 480.135,186.731 479.912,188.214 479.778,189.546 C 479.645,190.877 479.411,192.200 479.258,192.485 C 479.106,192.770 478.913,193.762 478.830,194.689 C 478.747,195.616 478.470,196.913 478.214,197.572 C 477.959,198.230 477.750,199.078 477.750,199.456 C 477.750,199.833 477.525,200.782 477.250,201.565 C 476.975,202.347 476.746,203.244 476.741,203.556 C 476.737,203.869 476.516,204.575 476.250,205.125 C 475.984,205.675 475.762,206.406 475.757,206.750 C 475.752,207.094 475.579,207.697 475.373,208.091 C 474.793,209.204 474.904,209.559 476.331,211.145 C 478.051,213.057 483.703,220.250 484.750,221.859 C 484.956,222.177 485.913,223.603 486.875,225.030 C 488.769,227.840 488.846,227.957 489.697,229.404 C 490.011,229.938 490.541,230.825 490.873,231.375 C 491.204,231.925 491.538,232.516 491.613,232.688 C 491.688,232.859 491.812,233.141 491.887,233.312 C 491.962,233.484 492.292,234.075 492.619,234.625 C 492.947,235.175 493.796,236.806 494.506,238.250 C 495.216,239.694 496.236,241.756 496.774,242.833 C 497.310,243.910 497.750,244.910 497.750,245.055 C 497.750,245.201 497.960,245.782 498.216,246.347 C 499.474,249.118 499.751,249.787 499.759,250.069 C 499.763,250.238 499.984,250.825 500.250,251.375 C 500.516,251.925 500.737,252.577 500.741,252.822 C 500.746,253.069 500.975,253.711 501.250,254.250 C 501.525,254.789 501.750,255.464 501.750,255.750 C 501.750,256.036 501.959,256.687 502.215,257.197 C 502.471,257.708 502.751,258.588 502.837,259.154 C 502.924,259.721 503.164,260.508 503.371,260.904 C 503.578,261.301 503.748,261.899 503.748,262.233 C 503.749,262.567 503.963,263.523 504.223,264.358 C 504.483,265.192 504.818,266.494 504.968,267.250 C 505.118,268.006 505.348,269.075 505.478,269.625 C 506,271.834 506.588,275.230 506.763,277.047 C 506.865,278.104 507.127,279.961 507.346,281.172 C 508,284.796 508.245,295.929 507.846,303.875 C 507.659,307.587 507.341,311.413 507.137,312.375 C 506.935,313.337 506.762,314.688 506.753,315.375 C 506.745,316.062 506.516,317.461 506.244,318.483 C 505.972,319.505 505.750,320.747 505.750,321.242 C 505.750,321.737 505.525,322.783 505.250,323.565 C 504.975,324.348 504.750,325.324 504.750,325.735 C 504.750,326.145 504.525,327.052 504.250,327.750 C 503.975,328.448 503.750,329.267 503.750,329.572 C 503.750,330.055 503.366,331.394 502.445,334.125 C 502.305,334.538 502.023,335.494 501.816,336.250 C 501.610,337.006 501.285,337.847 501.095,338.118 C 500.905,338.389 500.750,338.868 500.750,339.182 C 500.750,339.495 500.525,340.172 500.250,340.685 C 499.975,341.198 499.750,341.776 499.750,341.969 C 499.750,342.162 499.538,342.783 499.280,343.348 C 499.022,343.913 498.560,344.994 498.254,345.750 C 496.767,349.428 492.753,357.494 490.791,360.750 C 490.500,361.231 490.032,362.019 489.750,362.500 C 489.468,362.981 489.015,363.741 488.743,364.188 C 488.472,364.634 488.053,365.332 487.812,365.737 C 486.945,367.199 483.452,372.228 483.105,372.516 C 482.910,372.678 482.750,372.916 482.750,373.043 C 482.750,373.308 478.392,378.779 476.137,381.345 C 472.658,385.303 469.260,388.770 466.250,391.430 C 465.631,391.977 464.038,393.398 462.709,394.587 C 461.380,395.777 460.209,396.750 460.105,396.750 C 460.002,396.750 459.739,396.921 459.521,397.130 C 458.925,397.701 455.994,399.982 455,400.648 C 454.519,400.971 453.562,401.636 452.875,402.127 C 450.446,403.860 449.070,404.750 448.817,404.750 C 448.676,404.750 448.411,404.930 448.228,405.151 C 448.046,405.372 447.666,405.655 447.385,405.781 C 447.104,405.907 446.369,406.336 445.750,406.734 C 445.131,407.132 444.006,407.776 443.250,408.166 C 442.494,408.555 441.516,409.112 441.077,409.404 C 440.301,409.918 437.829,411.148 434,412.925 C 432.969,413.404 431.709,414.010 431.200,414.272 C 430.692,414.535 430.142,414.750 429.978,414.750 C 429.697,414.750 429.281,414.924 426.473,416.219 C 425.839,416.511 425.164,416.754 424.973,416.759 C 424.781,416.763 424.175,416.984 423.625,417.250 C 423.075,417.516 422.423,417.737 422.178,417.741 C 421.932,417.746 421.289,417.975 420.750,418.250 C 420.211,418.525 419.568,418.750 419.322,418.750 C 418.916,418.750 417.649,419.123 414.500,420.168 C 413.881,420.374 412.790,420.646 412.075,420.772 C 411.360,420.899 410.459,421.125 410.075,421.274 C 409.690,421.424 408.700,421.642 407.875,421.760 C 406.623,421.938 406.262,422.108 405.689,422.788 C 405.312,423.236 404.933,424.001 404.847,424.488 C 404.761,424.976 404.540,425.712 404.356,426.125 C 404.044,426.827 403.830,427.391 402.867,430.062 C 402.656,430.647 402.335,431.462 402.153,431.875 C 401.971,432.288 401.602,433.131 401.333,433.750 C 400.016,436.778 396.613,443.700 395.618,445.375 C 395.291,445.925 394.954,446.544 394.869,446.750 C 394.784,446.956 394.614,447.294 394.492,447.500 C 394.370,447.706 393.876,448.561 393.394,449.399 C 392.913,450.238 392.345,451.067 392.134,451.243 C 391.923,451.418 391.750,451.678 391.750,451.822 C 391.750,452.147 388.598,456.857 388.109,457.263 C 387.911,457.427 387.750,457.655 387.750,457.769 C 387.750,458.130 383.788,463.244 380.793,466.750 C 375.821,472.568 367.054,480.966 362.620,484.158 C 362.021,484.588 361.046,485.334 360.454,485.816 C 359.163,486.863 356.200,488.955 354.709,489.870 C 354.481,490.010 353.772,490.491 353.135,490.938 C 352.497,491.384 351.923,491.750 351.860,491.750 C 351.797,491.750 351.192,492.139 350.515,492.614 C 349.839,493.089 348.912,493.651 348.455,493.863 C 347.999,494.075 347.231,494.490 346.750,494.787 C 345.627,495.478 342.561,497.155 341.750,497.521 C 341.406,497.676 340.956,497.905 340.750,498.029 C 340.377,498.252 340.153,498.358 338,499.324 C 337.381,499.601 336.706,499.924 336.500,500.041 C 336.294,500.158 335.844,500.375 335.500,500.522 C 335.156,500.671 334.459,501.007 333.950,501.271 C 333.442,501.534 332.897,501.750 332.738,501.750 C 332.580,501.750 332.096,501.914 331.663,502.114 C 331.229,502.314 330.369,502.661 329.750,502.885 C 327,503.882 326.581,504.043 325.837,504.386 C 325.404,504.586 324.900,504.750 324.717,504.750 C 324.534,504.750 323.820,504.961 323.130,505.218 C 320.897,506.050 318.636,506.750 318.181,506.750 C 317.937,506.750 317.098,506.975 316.315,507.250 C 315.533,507.525 314.632,507.750 314.315,507.750 C 313.998,507.750 313.098,507.975 312.315,508.250 C 311.533,508.525 310.611,508.750 310.267,508.750 C 309.923,508.750 308.738,508.964 307.633,509.226 C 306.529,509.488 304.781,509.819 303.750,509.962 C 302.719,510.106 301.144,510.338 300.250,510.478 C 299.356,510.619 296.839,510.849 294.656,510.989 C 292.080,511.155 290.421,511.377 289.930,511.623 C 289.310,511.932 287.926,512 282.265,512 C 276.239,512 275.305,511.949 274.953,511.596M 287.750,478.752 C 288.919,478.618 291.450,478.394 293.375,478.254 C 295.300,478.114 297.427,477.830 298.102,477.625 C 298.777,477.418 299.752,477.250 300.267,477.250 C 300.784,477.250 301.919,477.026 302.790,476.753 C 303.662,476.480 304.680,476.255 305.053,476.253 C 305.426,476.252 306.326,476.036 307.053,475.773 C 307.780,475.511 308.792,475.226 309.302,475.139 C 309.812,475.052 310.543,474.817 310.927,474.617 C 311.311,474.417 311.883,474.252 312.197,474.252 C 312.512,474.251 313.211,474.025 313.750,473.750 C 314.289,473.475 314.919,473.250 315.150,473.250 C 315.381,473.250 316.033,473.038 316.598,472.780 C 317.163,472.522 318.244,472.057 319,471.748 C 323.442,469.933 331.002,466.103 331.394,465.469 C 331.468,465.349 331.702,465.250 331.913,465.250 C 332.123,465.250 332.595,465.014 332.961,464.726 C 333.326,464.438 334.514,463.622 335.600,462.913 C 336.687,462.205 337.832,461.456 338.145,461.250 C 343.922,457.446 354.427,447.442 358.620,441.750 C 358.974,441.269 359.739,440.232 360.320,439.446 C 362.037,437.121 364.987,432.724 365.325,431.985 C 365.415,431.787 365.773,431.175 366.120,430.625 C 366.466,430.075 366.973,429.175 367.247,428.625 C 367.520,428.075 367.840,427.456 367.958,427.250 C 368.552,426.211 369.922,423.447 370.623,421.875 C 371.899,419.012 372.250,418.155 372.250,417.904 C 372.250,417.746 372.475,417.198 372.750,416.685 C 373.025,416.172 373.250,415.577 373.250,415.363 C 373.250,415.150 373.438,414.615 373.667,414.175 C 373.897,413.735 374.169,412.981 374.273,412.500 C 374.376,412.019 374.628,411.119 374.833,410.500 C 375.954,407.113 376.250,406.065 376.250,405.491 C 376.250,405.143 376.475,404.217 376.750,403.435 C 377.025,402.652 377.250,401.577 377.250,401.046 C 377.250,400.514 377.420,399.527 377.627,398.852 C 377.834,398.177 378.116,396.275 378.255,394.625 C 378.393,392.975 378.636,391.006 378.793,390.250 C 379.003,389.245 379.105,372.038 379.174,326.218 C 379.174,326.218 379.269,263.560 379.269,263.560 C 379.269,263.560 378.612,262.780 378.612,262.780 C 378.067,262.132 376.605,261.154 374.500,260.029 C 373.582,259.538 370.082,257.512 368.534,256.575 C 368.034,256.272 367.456,255.943 367.250,255.844 C 366.671,255.566 362.546,253.179 361.794,252.687 C 361.426,252.446 360.788,252.081 360.375,251.875 C 359.962,251.669 359.175,251.218 358.625,250.874 C 358.075,250.529 357.288,250.071 356.875,249.856 C 356.462,249.642 355.675,249.193 355.125,248.859 C 354.575,248.526 353.788,248.080 353.375,247.868 C 352.962,247.655 352.119,247.152 351.500,246.750 C 350.881,246.348 350.038,245.848 349.625,245.639 C 349.212,245.430 348.650,245.127 348.375,244.965 C 348.100,244.804 347.706,244.580 347.500,244.469 C 346.861,244.124 343.678,242.259 342.625,241.613 C 342.075,241.276 341.288,240.830 340.875,240.623 C 340.462,240.416 339.675,239.972 339.125,239.636 C 338.575,239.300 337.844,238.900 337.500,238.745 C 337.157,238.591 336.689,238.296 336.460,238.089 C 336.231,237.882 335.725,237.749 335.334,237.794 C 335.334,237.794 334.625,237.875 334.625,237.875 C 334.625,237.875 334.485,310.625 334.485,310.625 C 334.329,391.641 334.492,384.930 332.594,388.671 C 331.010,391.792 328.450,394.269 324.596,396.413 C 323.892,396.805 322.449,397.631 321.388,398.250 C 320.327,398.869 319.103,399.576 318.667,399.821 C 318.231,400.066 317.425,400.536 316.875,400.866 C 316.325,401.196 315.538,401.642 315.125,401.857 C 314.712,402.073 314.038,402.474 313.625,402.750 C 313.212,403.026 312.538,403.420 312.125,403.625 C 311.712,403.831 310.925,404.282 310.375,404.627 C 309.825,404.971 309.038,405.429 308.625,405.644 C 308.212,405.858 307.425,406.307 306.875,406.640 C 306.325,406.974 305.538,407.424 305.125,407.640 C 304.712,407.857 303.925,408.303 303.375,408.633 C 302.825,408.962 301.981,409.465 301.500,409.750 C 301.019,410.035 300.175,410.538 299.625,410.867 C 299.075,411.197 298.288,411.642 297.875,411.857 C 297.462,412.073 296.788,412.474 296.375,412.748 C 295.962,413.023 295.175,413.474 294.625,413.752 C 294.075,414.030 293.175,414.529 292.625,414.861 C 292.075,415.194 291.288,415.642 290.875,415.857 C 290.462,416.073 289.788,416.474 289.375,416.750 C 288.962,417.026 288.288,417.427 287.875,417.643 C 287.462,417.858 286.675,418.304 286.125,418.634 C 285.575,418.964 284.764,419.434 284.322,419.679 C 283.021,420.402 278.907,422.747 278.500,422.998 C 278.294,423.125 276.905,423.937 275.414,424.802 C 273.923,425.667 272.292,426.623 271.789,426.925 C 271.286,427.228 270.706,427.557 270.500,427.656 C 270.021,427.885 267.728,429.206 266.539,429.938 C 266.036,430.247 265.288,430.669 264.875,430.875 C 264.462,431.080 263.788,431.471 263.375,431.743 C 262.606,432.250 261.451,432.922 260.125,433.632 C 259.712,433.853 258.966,434.280 258.466,434.580 C 257.392,435.224 254.064,437.162 253.438,437.508 C 253.197,437.641 252.803,437.859 252.562,437.992 C 252.322,438.125 251.300,438.715 250.292,439.304 C 249.284,439.893 248.103,440.576 247.667,440.821 C 247.232,441.066 246.425,441.536 245.875,441.866 C 245.325,442.196 244.537,442.642 244.125,442.857 C 243.713,443.073 243.037,443.474 242.625,443.750 C 242.213,444.026 241.537,444.420 241.125,444.625 C 240.713,444.831 239.962,445.253 239.457,445.562 C 238.255,446.299 234.231,448.613 233.750,448.844 C 233.544,448.943 232.966,449.272 232.466,449.575 C 231.479,450.172 228.145,452.117 227.438,452.508 C 227.197,452.641 226.803,452.858 226.562,452.990 C 221.516,455.756 220.683,456.551 222.062,457.280 C 222.372,457.443 223.300,458.151 224.125,458.851 C 224.950,459.552 225.804,460.238 226.024,460.375 C 226.243,460.512 227.874,461.594 229.649,462.777 C 231.423,463.962 233.213,465.119 233.625,465.350 C 234.037,465.581 234.825,466.041 235.375,466.373 C 235.925,466.705 236.544,467.046 236.750,467.131 C 236.956,467.216 237.294,467.385 237.500,467.507 C 238.022,467.813 242.910,470.197 244.125,470.738 C 244.675,470.982 245.519,471.363 246,471.583 C 246.962,472.024 248.136,472.454 251.875,473.739 C 252.562,473.975 253.519,474.312 254,474.487 C 254.481,474.662 255.325,474.914 255.875,475.048 C 256.425,475.181 257.212,475.408 257.625,475.550 C 258.038,475.693 258.938,475.916 259.625,476.045 C 260.312,476.174 261.401,476.443 262.044,476.644 C 262.688,476.844 264.038,477.113 265.044,477.241 C 266.051,477.369 267.606,477.647 268.500,477.858 C 269.394,478.070 270.856,478.255 271.750,478.270 C 272.644,478.285 274.556,478.439 276,478.613 C 279.266,479.007 284.938,479.075 287.750,478.752M 166.750,438.490 C 169.019,438.342 171.550,438.119 172.375,437.994 C 176.701,437.337 177.505,437.197 179,436.834 C 179.894,436.617 181.188,436.351 181.875,436.242 C 182.562,436.134 183.543,435.866 184.054,435.647 C 184.566,435.429 185.297,435.246 185.679,435.241 C 186.062,435.237 186.825,435.016 187.375,434.750 C 187.925,434.484 188.658,434.263 189.004,434.259 C 189.350,434.254 190.052,434.025 190.565,433.750 C 191.078,433.475 191.697,433.250 191.940,433.250 C 192.184,433.250 192.802,433.025 193.315,432.750 C 193.828,432.475 194.445,432.249 194.686,432.248 C 194.928,432.247 195.463,432.023 195.875,431.750 C 196.287,431.477 196.781,431.253 196.972,431.252 C 197.164,431.251 197.782,431.036 198.347,430.776 C 200.790,429.648 204.758,427.646 206.375,426.726 C 207.338,426.178 208.463,425.558 208.875,425.348 C 209.287,425.137 210.034,424.720 210.534,424.420 C 211.691,423.726 215.007,421.798 215.500,421.531 C 215.706,421.420 216.100,421.204 216.375,421.050 C 217.094,420.649 222.130,417.724 223.211,417.080 C 223.714,416.780 224.463,416.358 224.875,416.144 C 225.287,415.929 226.075,415.471 226.625,415.127 C 227.175,414.782 227.963,414.333 228.375,414.130 C 228.787,413.926 229.350,413.618 229.625,413.445 C 231.645,412.174 232.727,411.518 233.375,411.171 C 233.787,410.949 234.463,410.587 234.875,410.367 C 235.287,410.146 236.034,409.720 236.534,409.420 C 237.691,408.726 241.007,406.798 241.500,406.531 C 242.598,405.939 245.927,404.002 247.375,403.113 C 247.925,402.776 248.713,402.331 249.125,402.125 C 249.537,401.920 250.213,401.529 250.625,401.259 C 251.037,400.988 251.769,400.552 252.250,400.291 C 253.187,399.781 254.076,399.275 255.544,398.414 C 256.050,398.118 257.512,397.281 258.794,396.554 C 260.076,395.828 261.294,395.128 261.500,395 C 261.706,394.872 262.703,394.285 263.716,393.696 C 264.728,393.107 265.966,392.380 266.466,392.080 C 266.966,391.780 267.712,391.357 268.125,391.140 C 268.538,390.924 269.325,390.474 269.875,390.140 C 270.425,389.807 271.212,389.358 271.625,389.143 C 272.038,388.928 272.712,388.543 273.125,388.286 C 274.939,387.158 275.673,386.723 276.375,386.357 C 276.788,386.142 277.575,385.693 278.125,385.360 C 278.675,385.026 279.462,384.576 279.875,384.360 C 280.288,384.143 281.039,383.720 281.544,383.420 C 283.204,382.435 286.867,380.340 287.250,380.156 C 287.456,380.057 288.075,379.704 288.625,379.373 C 289.175,379.041 290.019,378.535 290.500,378.250 C 290.981,377.965 291.825,377.462 292.375,377.133 C 292.925,376.803 293.712,376.357 294.125,376.140 C 294.538,375.924 295.325,375.474 295.875,375.140 C 296.425,374.807 297.212,374.358 297.625,374.143 C 298.038,373.927 298.712,373.526 299.125,373.250 C 299.538,372.974 300.212,372.573 300.625,372.357 C 301.038,372.142 301.787,371.720 302.290,371.420 C 303.831,370.502 305.854,369.345 306.250,369.156 C 306.456,369.057 307.075,368.704 307.625,368.373 C 308.175,368.041 309.033,367.544 309.531,367.270 C 310.719,366.617 311.695,365.433 311.873,364.430 C 311.952,363.988 311.985,352.712 311.946,339.375 C 311.946,339.375 311.875,315.125 311.875,315.125 C 311.875,315.125 311.347,315.050 311.347,315.050 C 311.056,315.008 310.269,315.313 309.597,315.728 C 308.925,316.143 308.038,316.655 307.625,316.866 C 307.212,317.077 306.538,317.474 306.125,317.748 C 305.712,318.023 304.925,318.474 304.375,318.750 C 303.825,319.026 303.038,319.477 302.625,319.752 C 302.212,320.026 301.538,320.420 301.125,320.625 C 300.712,320.831 299.962,321.253 299.457,321.562 C 298.255,322.299 294.231,324.613 293.750,324.844 C 293.544,324.943 292.966,325.272 292.466,325.575 C 291.414,326.212 288.052,328.171 287.500,328.469 C 286.572,328.969 283.235,330.900 281.534,331.920 C 281.034,332.220 280.288,332.643 279.875,332.860 C 279.462,333.076 278.675,333.523 278.125,333.853 C 277.575,334.183 276.815,334.632 276.438,334.851 C 276.060,335.071 275.440,335.429 275.062,335.649 C 274.685,335.868 273.961,336.289 273.456,336.586 C 272.950,336.882 271.488,337.719 270.206,338.446 C 268.924,339.172 267.706,339.870 267.500,339.998 C 267.294,340.125 265.916,340.918 264.438,341.762 C 262.961,342.605 261.689,343.397 261.611,343.522 C 261.534,343.647 261.307,343.750 261.108,343.750 C 260.908,343.750 260.192,344.139 259.515,344.614 C 258.839,345.089 257.912,345.656 257.455,345.874 C 256.432,346.361 255.118,347.103 254.125,347.753 C 253.713,348.024 253.094,348.385 252.750,348.558 C 252.406,348.729 251.756,349.116 251.305,349.416 C 250.855,349.716 250.011,350.207 249.430,350.507 C 248.850,350.806 247.961,351.293 247.456,351.588 C 246.950,351.884 245.488,352.719 244.206,353.446 C 242.924,354.172 241.706,354.872 241.500,355 C 240.985,355.321 237.637,357.275 236.667,357.821 C 236.232,358.066 235.425,358.536 234.875,358.866 C 234.325,359.196 233.537,359.642 233.125,359.857 C 232.713,360.073 232.037,360.474 231.625,360.750 C 231.213,361.026 230.537,361.420 230.125,361.625 C 229.713,361.831 228.925,362.282 228.375,362.627 C 227.825,362.971 227.037,363.429 226.625,363.644 C 226.213,363.858 225.425,364.307 224.875,364.640 C 224.325,364.974 223.537,365.424 223.125,365.640 C 222.713,365.857 221.966,366.280 221.466,366.580 C 220.392,367.224 217.064,369.162 216.438,369.508 C 216.197,369.641 215.803,369.859 215.562,369.992 C 214.745,370.443 211.629,372.271 210.625,372.887 C 210.075,373.224 209.287,373.670 208.875,373.877 C 208.463,374.084 207.675,374.523 207.125,374.853 C 206.575,375.183 205.816,375.632 205.438,375.851 C 205.059,376.071 204.441,376.429 204.062,376.649 C 203.684,376.868 202.961,377.289 202.456,377.586 C 200.395,378.794 197.101,380.675 196.750,380.844 C 196.544,380.943 195.966,381.272 195.466,381.575 C 194.966,381.877 193.703,382.610 192.659,383.202 C 191.616,383.794 190.696,384.385 190.616,384.514 C 190.536,384.644 190.313,384.750 190.121,384.750 C 189.929,384.750 189.380,385.016 188.901,385.341 C 187.658,386.185 184.650,387.590 182.750,388.216 C 180.489,388.959 176.802,388.963 174.375,388.225 C 172.190,387.560 172.001,387.479 170.312,386.495 C 170.072,386.355 169.537,386.066 169.125,385.853 C 168.713,385.640 167.966,385.220 167.466,384.920 C 166.392,384.276 163.064,382.338 162.438,381.992 C 162.197,381.859 161.803,381.641 161.562,381.508 C 160.936,381.162 157.608,379.224 156.534,378.580 C 156.034,378.280 155.287,377.859 154.875,377.644 C 153.502,376.929 150.814,375.379 150.467,375.101 C 150.279,374.951 149.956,374.756 149.750,374.669 C 149.544,374.582 148.925,374.226 148.375,373.879 C 147.825,373.531 147.037,373.071 146.625,372.856 C 146.213,372.642 145.425,372.193 144.875,371.860 C 144.325,371.526 143.537,371.076 143.125,370.860 C 142.713,370.643 141.925,370.197 141.375,369.867 C 140.825,369.538 139.981,369.035 139.500,368.750 C 139.019,368.465 138.175,367.959 137.625,367.627 C 137.075,367.296 136.456,366.943 136.250,366.844 C 135.867,366.660 132.204,364.565 130.544,363.580 C 130.039,363.280 129.287,362.858 128.875,362.643 C 128.463,362.427 127.787,362.026 127.375,361.750 C 126.963,361.474 126.287,361.080 125.875,360.875 C 125.463,360.669 124.675,360.218 124.125,359.873 C 123.575,359.529 122.787,359.075 122.375,358.865 C 121.963,358.654 121.006,358.097 120.250,357.626 C 119.494,357.155 118.752,356.765 118.601,356.760 C 118.451,356.755 118.124,356.525 117.875,356.250 C 117.626,355.975 117.222,355.750 116.976,355.750 C 116.731,355.750 116.464,355.644 116.384,355.514 C 116.303,355.385 115.384,354.794 114.341,354.202 C 113.297,353.610 112.034,352.884 111.534,352.588 C 111.034,352.293 110.150,351.806 109.570,351.507 C 108.989,351.207 108.145,350.716 107.695,350.416 C 107.244,350.116 106.594,349.729 106.250,349.558 C 105.906,349.385 105.287,349.021 104.875,348.747 C 104.463,348.473 103.787,348.080 103.375,347.875 C 102.963,347.669 102.175,347.218 101.625,346.873 C 101.075,346.529 100.278,346.085 99.855,345.888 C 99.431,345.690 98.940,345.354 97.389,344.522 C 97.311,344.397 96.039,343.605 94.561,342.762 C 93.084,341.918 91.706,341.125 91.500,340.998 C 91.294,340.870 90.076,340.172 88.794,339.446 C 87.512,338.719 86.050,337.880 85.544,337.580 C 85.039,337.280 84.287,336.860 83.875,336.647 C 83.463,336.434 82.956,336.149 82.750,336.014 C 82.544,335.878 81.718,335.398 80.914,334.946 C 80.111,334.495 79.042,333.870 78.539,333.557 C 78.037,333.245 77.456,332.913 77.250,332.819 C 77.044,332.726 76.506,332.399 76.055,332.094 C 75.605,331.788 74.761,331.293 74.180,330.993 C 73.600,330.694 72.716,330.207 72.216,329.912 C 70.387,328.832 67.413,327.111 66.432,326.563 C 65.241,325.899 64.752,326.126 64.746,327.343 C 64.744,327.773 64.575,328.800 64.370,329.625 C 63.406,333.514 63.404,351.755 64.368,355.625 C 64.574,356.450 64.744,357.577 64.746,358.130 C 64.748,358.683 64.975,359.947 65.250,360.939 C 65.525,361.932 65.749,362.998 65.746,363.309 C 65.745,363.620 65.959,364.606 66.224,365.500 C 66.489,366.394 66.816,367.575 66.950,368.125 C 67.085,368.675 67.308,369.462 67.446,369.875 C 67.585,370.288 67.886,371.188 68.116,371.875 C 68.346,372.562 68.642,373.562 68.775,374.095 C 68.909,374.628 69.182,375.300 69.383,375.588 C 69.585,375.876 69.751,376.339 69.752,376.618 C 69.753,376.897 69.977,377.462 70.250,377.875 C 70.523,378.288 70.747,378.828 70.748,379.075 C 70.749,379.323 70.961,379.942 71.219,380.450 C 71.478,380.959 71.945,381.938 72.257,382.625 C 72.569,383.312 72.921,384.044 73.039,384.250 C 73.157,384.456 73.377,384.906 73.528,385.250 C 73.680,385.594 73.902,386.044 74.022,386.250 C 74.142,386.456 74.522,387.188 74.865,387.875 C 75.209,388.562 75.741,389.519 76.047,390 C 76.575,390.829 76.826,391.252 77.569,392.562 C 77.745,392.872 78.222,393.619 78.632,394.223 C 79.040,394.827 79.487,395.508 79.625,395.735 C 81.761,399.271 87.385,406.131 91.617,410.363 C 94.839,413.585 102.609,420.250 103.142,420.250 C 103.232,420.250 103.828,420.681 104.465,421.208 C 105.103,421.735 105.794,422.243 106,422.337 C 106.206,422.431 106.881,422.839 107.500,423.243 C 108.517,423.907 110.175,424.916 112.712,426.414 C 113.214,426.711 114.412,427.360 115.375,427.857 C 116.338,428.354 117.294,428.853 117.500,428.966 C 117.844,429.154 118.591,429.497 121.375,430.743 C 124.255,432.032 124.789,432.251 125.069,432.259 C 125.237,432.263 125.825,432.484 126.375,432.750 C 126.925,433.016 127.576,433.237 127.823,433.241 C 128.069,433.246 128.711,433.475 129.250,433.750 C 129.789,434.025 130.488,434.254 130.803,434.259 C 131.117,434.263 131.825,434.484 132.375,434.750 C 132.925,435.016 133.611,435.237 133.898,435.241 C 134.186,435.246 135.076,435.475 135.875,435.750 C 136.674,436.025 137.634,436.250 138.008,436.250 C 138.381,436.250 139.167,436.420 139.755,436.627 C 140.342,436.834 141.812,437.115 143.022,437.252 C 144.232,437.389 145.538,437.622 145.923,437.769 C 146.309,437.917 148.425,438.144 150.625,438.275 C 152.825,438.406 154.794,438.553 155,438.602 C 155.854,438.807 162.910,438.739 166.750,438.490M 414.125,385.750 C 414.538,385.477 415.031,385.253 415.223,385.252 C 415.414,385.251 416.089,385.013 416.723,384.723 C 417.356,384.433 418.381,383.966 419,383.686 C 419.619,383.406 420.294,383.079 420.500,382.961 C 420.706,382.843 421.156,382.623 421.500,382.471 C 421.844,382.320 422.294,382.095 422.500,381.971 C 422.867,381.751 423.501,381.447 424.250,381.134 C 424.456,381.047 425.075,380.704 425.625,380.373 C 426.175,380.041 427.062,379.511 427.596,379.197 C 428.995,378.373 429.751,377.895 432.875,375.856 C 433.975,375.138 435.550,374.039 436.375,373.413 C 437.200,372.787 438.142,372.072 438.470,371.825 C 442.609,368.694 452.210,359.079 454.895,355.375 C 455.094,355.100 455.678,354.309 456.191,353.618 C 456.705,352.926 457.359,352.026 457.645,351.618 C 457.932,351.209 458.565,350.304 459.053,349.607 C 459.542,348.909 460.127,348.009 460.353,347.607 C 460.580,347.204 460.959,346.575 461.195,346.209 C 461.432,345.844 461.995,344.887 462.446,344.084 C 462.898,343.282 463.377,342.456 463.512,342.250 C 463.646,342.044 463.978,341.425 464.250,340.875 C 464.522,340.325 464.844,339.706 464.966,339.500 C 465.175,339.148 466.521,336.323 467.719,333.723 C 468.011,333.089 468.251,332.414 468.252,332.223 C 468.253,332.031 468.477,331.538 468.750,331.125 C 469.023,330.712 469.247,330.167 469.248,329.913 C 469.249,329.659 469.412,329.096 469.610,328.663 C 470.168,327.440 471.250,324.136 471.250,323.656 C 471.250,323.419 471.426,322.884 471.642,322.466 C 471.858,322.049 472.146,321.018 472.281,320.175 C 472.417,319.332 472.635,318.514 472.766,318.356 C 472.897,318.199 473.113,317.207 473.247,316.153 C 473.380,315.099 473.609,314.014 473.755,313.741 C 473.900,313.469 474.127,312.094 474.258,310.685 C 474.389,309.277 474.623,307.675 474.777,307.125 C 475.174,305.714 475.369,290.245 475.027,287.375 C 474.504,282.995 473.649,277.728 473.019,275 C 472.461,272.582 472.184,271.527 471.838,270.500 C 471.629,269.881 471.365,268.869 471.251,268.250 C 471.137,267.631 470.865,266.788 470.648,266.375 C 470.431,265.962 470.252,265.423 470.252,265.178 C 470.251,264.932 470.025,264.289 469.750,263.750 C 469.475,263.211 469.249,262.568 469.248,262.322 C 469.247,262.077 469.023,261.538 468.750,261.125 C 468.477,260.712 468.253,260.219 468.252,260.027 C 468.251,259.836 468.013,259.161 467.723,258.527 C 467.433,257.894 466.993,256.925 466.745,256.375 C 466.075,254.889 464.765,252.179 464.510,251.750 C 464.387,251.544 464.216,251.206 464.131,251 C 464.046,250.794 463.701,250.175 463.365,249.625 C 463.029,249.075 462.576,248.287 462.360,247.875 C 461.901,247.003 461.050,245.585 460.468,244.726 C 459.966,243.983 457.716,240.577 457.375,240.042 C 457.238,239.827 455.841,238.028 454.271,236.045 C 448.494,228.749 439.502,220.498 432.290,215.875 C 432.075,215.738 431.354,215.254 430.686,214.801 C 430.019,214.348 429.226,213.868 428.924,213.734 C 428.622,213.600 427.869,213.157 427.250,212.750 C 426.631,212.343 425.900,211.889 425.625,211.742 C 425.350,211.595 424.675,211.200 424.125,210.864 C 423.575,210.528 422.788,210.084 422.375,209.877 C 421.962,209.670 421.175,209.218 420.625,208.874 C 420.075,208.529 419.279,208.085 418.855,207.888 C 418.432,207.690 417.940,207.354 416.389,206.522 C 416.311,206.397 415.039,205.605 413.562,204.762 C 412.084,203.918 410.706,203.125 410.500,202.998 C 410.294,202.870 409.076,202.172 407.794,201.446 C 406.512,200.719 405.050,199.880 404.544,199.580 C 404.039,199.280 403.288,198.857 402.875,198.641 C 402.462,198.424 401.675,197.974 401.125,197.641 C 400.575,197.307 399.788,196.858 399.375,196.643 C 398.962,196.427 398.288,196.025 397.875,195.750 C 397.462,195.475 396.788,195.077 396.375,194.866 C 395.962,194.655 395.006,194.097 394.250,193.626 C 393.494,193.155 392.752,192.765 391.076,191.750 C 390.886,191.750 390.425,191.549 390.052,191.303 C 389.310,190.812 389.174,190.731 386.625,189.250 C 385.663,188.691 384.706,188.129 384.500,188 C 384.294,187.872 383.468,187.398 382.665,186.946 C 381.862,186.494 380.793,185.880 380.290,185.580 C 379.787,185.280 379.038,184.858 378.625,184.644 C 378.212,184.429 377.425,183.971 376.875,183.626 C 376.325,183.282 375.538,182.832 375.125,182.626 C 374.712,182.421 374.038,182.042 373.625,181.786 C 371.922,180.727 371.092,180.238 370.500,179.942 C 370.156,179.770 369.506,179.384 369.055,179.084 C 368.605,178.784 367.761,178.293 367.180,177.993 C 366.600,177.694 365.714,177.207 365.211,176.912 C 362.536,175.341 358.505,173.019 357.116,172.250 C 356.248,171.769 355.445,171.281 355.331,171.166 C 355.218,171.050 354.788,170.796 354.375,170.601 C 353.962,170.406 353.175,169.972 352.625,169.636 C 352.075,169.300 351.400,168.910 351.125,168.767 C 350.850,168.625 350.175,168.225 349.625,167.878 C 349.075,167.531 348.279,167.085 347.855,166.888 C 347.432,166.690 346.940,166.354 346.762,166.139 C 346.584,165.925 346.279,165.750 346.084,165.750 C 345.889,165.750 345.425,165.549 345.052,165.303 C 344.310,164.812 344.174,164.731 341.625,163.250 C 339.818,162.201 339.145,161.817 338.500,161.469 C 337.948,161.171 334.586,159.212 333.534,158.575 C 333.034,158.272 332.456,157.943 332.250,157.844 C 331.909,157.680 328.844,155.931 326.544,154.588 C 324.833,153.589 323.594,153 323.202,153 C 322.846,153 322.082,153.400 319.538,154.920 C 319.036,155.220 318.288,155.642 317.875,155.857 C 317.462,156.073 316.788,156.475 316.375,156.750 C 315.962,157.025 315.288,157.427 314.875,157.643 C 314.462,157.858 313.675,158.304 313.125,158.634 C 312.575,158.964 311.764,159.434 311.322,159.679 C 310.021,160.402 305.907,162.747 305.500,162.998 C 305.294,163.125 303.916,163.918 302.438,164.762 C 300.961,165.605 299.689,166.397 298.205,167.165 C 297.695,167.628 297.103,167.989 295.625,168.743 C 295.075,169.023 294.288,169.477 293.875,169.752 C 293.462,170.026 292.788,170.427 292.375,170.643 C 291.962,170.858 291.175,171.307 290.625,171.641 C 290.075,171.974 289.288,172.424 288.875,172.641 C 288.462,172.857 287.675,173.304 287.125,173.634 C 286.575,173.964 285.764,174.434 285.324,174.679 C 281.569,176.770 279.500,178.083 279.500,178.377 C 279.500,178.716 280.983,179.834 282.250,180.451 C 282.594,180.618 283.212,180.976 283.625,181.246 C 284.478,181.805 285.775,182.551 286.875,183.115 C 287.288,183.327 288.075,183.776 288.625,184.113 C 289.678,184.759 292.861,186.624 293.500,186.969 C 294.490,187.503 297.958,189.513 299.466,190.425 C 299.966,190.728 300.544,191.057 300.750,191.156 C 301.258,191.400 305.317,193.738 306.457,194.443 C 306.962,194.755 307.544,195.087 307.750,195.181 C 307.956,195.274 308.494,195.601 308.945,195.906 C 309.395,196.212 310.239,196.707 310.820,197.007 C 311.400,197.306 312.286,197.793 312.789,198.088 C 314.343,199 319.098,201.756 319.625,202.050 C 319.900,202.203 320.294,202.420 320.500,202.531 C 320.993,202.798 324.309,204.726 325.466,205.420 C 325.966,205.720 326.712,206.141 327.125,206.355 C 328.702,207.175 330.640,208.314 331,208.633 C 331.207,208.815 331.657,209.091 332,209.245 C 332.344,209.400 333.075,209.799 333.625,210.134 C 334.175,210.469 335.075,210.970 335.625,211.248 C 336.175,211.525 336.962,211.974 337.375,212.245 C 337.788,212.516 338.481,212.937 338.917,213.181 C 339.828,213.691 343.125,215.616 344.466,216.420 C 344.966,216.720 345.712,217.140 346.125,217.353 C 346.538,217.566 347.044,217.851 347.250,217.986 C 347.456,218.122 348.282,218.602 349.085,219.054 C 349.888,219.506 350.957,220.123 351.460,220.425 C 351.963,220.727 352.600,221.098 352.875,221.250 C 353.150,221.402 353.825,221.799 354.375,222.134 C 354.925,222.469 355.825,222.970 356.375,223.248 C 356.925,223.525 357.712,223.974 358.125,224.245 C 358.538,224.516 359.231,224.937 359.667,225.181 C 360.103,225.425 361.284,226.107 362.292,226.696 C 364.144,227.778 364.817,228.163 365.500,228.531 C 365.853,228.721 368.511,230.262 370.409,231.375 C 370.878,231.650 371.962,232.253 372.818,232.715 C 373.674,233.178 374.862,233.883 375.457,234.283 C 376.053,234.683 376.896,235.176 377.332,235.380 C 377.768,235.583 378.425,235.946 378.791,236.187 C 379.548,236.685 381.937,238.075 382.500,238.345 C 382.706,238.443 383.286,238.772 383.789,239.075 C 384.292,239.377 385.923,240.333 387.414,241.198 C 388.905,242.064 390.294,242.875 390.500,243.002 C 390.706,243.130 391.924,243.828 393.206,244.554 C 394.488,245.281 395.950,246.120 396.456,246.420 C 396.961,246.720 397.712,247.142 398.125,247.357 C 398.538,247.573 399.212,247.975 399.625,248.250 C 400.038,248.525 400.712,248.929 401.125,249.147 C 407.017,252.259 409.447,254.935 411.211,260.250 C 411.211,260.250 411.750,261.875 411.750,261.875 C 411.750,261.875 411.750,323.762 411.750,323.762 C 411.750,371.564 411.818,385.718 412.050,385.950 C 412.490,386.390 413.273,386.314 414.125,385.750M 190.196,358.366 C 190.844,358.017 191.825,357.461 192.375,357.129 C 192.925,356.797 193.600,356.409 193.875,356.267 C 194.150,356.125 194.825,355.729 195.375,355.386 C 195.925,355.044 196.769,354.555 197.250,354.299 C 198.303,353.740 199.851,352.849 200.875,352.214 C 201.287,351.957 201.963,351.589 202.375,351.396 C 202.787,351.202 203.218,350.950 203.331,350.834 C 203.445,350.719 204.246,350.231 205.111,349.750 C 206.742,348.844 209.882,347.030 211.466,346.080 C 211.966,345.780 212.713,345.359 213.125,345.144 C 214.666,344.342 217.220,342.868 217.419,342.666 C 217.532,342.550 217.963,342.296 218.375,342.101 C 218.787,341.906 219.575,341.472 220.125,341.136 C 220.675,340.800 221.350,340.402 221.625,340.250 C 221.900,340.098 222.575,339.700 223.125,339.364 C 223.675,339.028 224.463,338.576 224.875,338.360 C 225.287,338.143 226.034,337.720 226.534,337.420 C 228.075,336.496 231.259,334.642 231.896,334.299 C 233.120,333.638 232.660,333.183 228.066,330.511 C 227.346,330.092 226.661,329.750 226.542,329.750 C 226.424,329.750 226.124,329.525 225.875,329.250 C 225.626,328.975 225.221,328.750 224.976,328.750 C 224.731,328.750 224.466,328.647 224.389,328.522 C 224.260,328.314 221.104,326.460 217.116,324.250 C 216.248,323.769 215.445,323.281 215.331,323.166 C 215.218,323.050 214.787,322.796 214.375,322.601 C 213.963,322.406 213.175,321.972 212.625,321.636 C 212.075,321.300 211.400,320.902 211.125,320.750 C 210.850,320.598 210.175,320.200 209.625,319.864 C 209.075,319.528 208.279,319.091 207.855,318.891 C 207.431,318.692 206.940,318.354 206.762,318.139 C 206.584,317.925 206.279,317.750 206.084,317.750 C 205.889,317.750 205.425,317.548 205.053,317.303 C 204.680,317.056 204.150,316.723 203.875,316.561 C 202.754,315.901 199.846,314.217 199.438,313.992 C 199.197,313.859 198.803,313.641 198.562,313.508 C 197.936,313.162 194.608,311.224 193.534,310.580 C 193.034,310.280 192.287,309.857 191.875,309.640 C 191.463,309.424 190.675,308.974 190.125,308.640 C 189.575,308.307 188.787,307.858 188.375,307.643 C 187.963,307.427 187.287,307.027 186.875,306.753 C 186.463,306.479 185.844,306.115 185.500,305.942 C 185.156,305.771 184.506,305.384 184.055,305.084 C 183.605,304.784 182.761,304.293 182.180,303.993 C 181.600,303.694 180.716,303.207 180.216,302.912 C 179.716,302.616 178.438,301.869 177.375,301.250 C 176.312,300.631 175.034,299.877 174.534,299.575 C 174.034,299.272 173.456,298.954 173.250,298.869 C 173.044,298.784 172.706,298.613 172.500,298.490 C 172.294,298.367 171.338,297.808 170.375,297.247 C 169.412,296.686 168.175,295.951 167.625,295.613 C 167.075,295.276 166.287,294.830 165.875,294.623 C 165.463,294.416 164.675,293.974 164.125,293.640 C 163.575,293.307 162.787,292.858 162.375,292.643 C 161.963,292.427 161.287,292.026 160.875,291.750 C 160.463,291.474 159.787,291.073 159.375,290.857 C 158.963,290.642 158.175,290.193 157.625,289.860 C 157.075,289.526 156.279,289.091 155.855,288.891 C 155.431,288.692 154.940,288.354 153.384,287.514 C 153.304,287.385 152.384,286.794 151.341,286.202 C 150.297,285.610 149.034,284.877 148.534,284.575 C 148.034,284.272 147.456,283.943 147.250,283.844 C 146.845,283.649 143.039,281.469 141.544,280.575 C 141.039,280.273 140.400,279.909 140.125,279.767 C 139.850,279.625 139.175,279.225 138.625,278.878 C 138.075,278.531 137.287,278.079 136.875,277.873 C 136.463,277.668 135.675,277.218 135.125,276.873 C 134.575,276.529 133.787,276.075 133.375,275.865 C 132.963,275.654 132.006,275.097 131.250,274.626 C 130.494,274.155 129.752,273.765 129.601,273.760 C 129.451,273.755 129.124,273.525 128.875,273.250 C 128.626,272.975 128.221,272.750 127.976,272.750 C 127.731,272.750 127.464,272.644 127.384,272.514 C 127.303,272.385 126.384,271.794 125.341,271.202 C 124.297,270.610 123.034,269.877 122.534,269.575 C 122.034,269.272 121.456,268.943 121.250,268.844 C 120.769,268.613 116.745,266.299 115.543,265.562 C 115.038,265.253 114.287,264.831 113.875,264.625 C 113.463,264.420 112.787,264.026 112.375,263.750 C 111.963,263.474 111.287,263.071 110.875,262.853 C 108.276,261.480 106.868,260.537 105.286,259.112 C 103.576,257.572 101.695,254.788 101.239,253.125 C 101.126,252.713 100.862,251.925 100.653,251.375 C 100.316,250.489 100.271,243.297 100.261,188.363 C 100.252,140.476 100.182,126.282 99.950,126.050 C 99.510,125.610 98.727,125.686 97.875,126.250 C 97.463,126.523 96.969,126.747 96.778,126.748 C 96.586,126.749 95.911,126.987 95.278,127.277 C 94.644,127.567 93.619,128.034 93,128.314 C 91.767,128.873 91.287,129.103 90.438,129.539 C 90.128,129.698 89.678,129.923 87.750,130.869 C 87.544,130.954 86.966,131.272 86.466,131.575 C 85.966,131.877 84.728,132.607 83.716,133.196 C 81.274,134.616 81.106,134.722 79.582,135.812 C 78.861,136.328 78.201,136.750 78.115,136.750 C 78.029,136.750 77.477,137.145 76.888,137.628 C 76.298,138.111 75.358,138.815 74.797,139.191 C 72.992,140.404 68.175,144.635 65.033,147.768 C 62.052,150.741 57.586,155.745 56.794,157 C 56.577,157.344 55.880,158.300 55.246,159.125 C 54.292,160.364 51.845,164.037 50.576,166.131 C 49.903,167.242 47.834,170.918 47.554,171.500 C 47.389,171.844 47.154,172.294 47.032,172.500 C 46.825,172.853 45.466,175.706 44.281,178.278 C 43.989,178.911 43.749,179.586 43.748,179.778 C 43.747,179.969 43.523,180.463 43.250,180.875 C 42.977,181.287 42.749,181.850 42.743,182.125 C 42.738,182.400 42.516,183.075 42.250,183.625 C 41.984,184.175 41.763,184.810 41.758,185.035 C 41.754,185.261 41.528,185.936 41.255,186.535 C 40.983,187.135 40.758,187.866 40.755,188.160 C 40.752,188.454 40.528,189.186 40.255,189.785 C 39.983,190.385 39.758,191.237 39.755,191.678 C 39.752,192.120 39.525,193.052 39.250,193.750 C 38.975,194.448 38.750,195.450 38.750,195.978 C 38.750,196.505 38.575,197.429 38.361,198.031 C 38.148,198.633 37.875,200.194 37.756,201.500 C 37.636,202.806 37.389,204.494 37.207,205.250 C 36.962,206.264 36.875,209.022 36.875,215.750 C 36.875,223.457 36.943,225.208 37.312,227.019 C 37.553,228.199 37.750,229.613 37.750,230.161 C 37.750,230.710 37.972,231.995 38.244,233.017 C 38.516,234.039 38.741,235.204 38.744,235.607 C 38.747,236.010 38.966,237.079 39.230,237.982 C 39.493,238.886 39.831,240.103 39.980,240.688 C 40.778,243.826 40.879,244.158 41.936,247.125 C 42.083,247.537 42.341,248.269 42.511,248.750 C 44.002,252.993 46.674,258.801 49.066,263 C 50.608,265.706 50.694,265.851 51.747,267.500 C 52.230,268.256 52.737,269.062 52.875,269.289 C 53.318,270.024 57.550,275.812 58.148,276.500 C 60.421,279.120 63.460,282.430 65.065,284.034 C 67.544,286.514 72.121,290.659 72.982,291.204 C 73.336,291.428 74.356,292.183 75.250,292.882 C 77.265,294.457 81.765,297.529 83.125,298.258 C 83.400,298.405 84.034,298.773 84.534,299.075 C 85.034,299.377 86.272,300.107 87.284,300.696 C 88.297,301.285 89.294,301.872 89.500,302 C 89.706,302.128 90.924,302.828 92.206,303.554 C 93.488,304.281 94.950,305.120 95.456,305.420 C 95.961,305.720 96.713,306.142 97.125,306.357 C 97.537,306.573 98.213,306.974 98.625,307.248 C 99.037,307.523 99.825,307.974 100.375,308.250 C 100.925,308.526 101.713,308.960 102.125,309.216 C 103.951,310.346 108.135,312.795 109.500,313.531 C 109.993,313.798 113.309,315.726 114.466,316.420 C 114.966,316.720 115.713,317.141 116.125,317.356 C 117.665,318.156 119.637,319.311 120,319.625 C 120.206,319.804 120.769,320.130 121.250,320.349 C 121.731,320.569 122.424,320.946 122.790,321.187 C 123.156,321.428 124.113,321.995 124.915,322.446 C 125.718,322.898 126.544,323.378 126.750,323.514 C 126.956,323.649 127.463,323.934 127.875,324.147 C 128.287,324.360 129.075,324.803 129.625,325.133 C 130.175,325.462 131.019,325.965 131.500,326.250 C 131.981,326.535 132.825,327.041 133.375,327.373 C 133.925,327.704 134.544,328.057 134.750,328.156 C 135.101,328.325 138.395,330.206 140.456,331.414 C 140.961,331.711 141.684,332.132 142.062,332.351 C 142.441,332.571 143.059,332.929 143.438,333.149 C 143.816,333.368 144.575,333.817 145.125,334.147 C 145.675,334.477 146.463,334.924 146.875,335.140 C 147.287,335.357 148.034,335.780 148.534,336.080 C 150.235,337.100 153.572,339.031 154.500,339.531 C 154.894,339.744 157.919,341.499 159.466,342.412 C 159.966,342.707 160.850,343.194 161.430,343.493 C 162.011,343.793 162.855,344.284 163.305,344.584 C 163.756,344.884 164.406,345.270 164.750,345.442 C 165.094,345.613 165.741,345.978 166.188,346.252 C 166.634,346.526 167.366,346.975 167.812,347.249 C 168.259,347.524 169.075,347.978 169.625,348.258 C 171.101,349.009 171.694,349.372 173.611,350.478 C 173.689,350.603 174.961,351.395 176.439,352.238 C 177.916,353.082 179.294,353.875 179.500,354.002 C 179.907,354.253 184.021,356.598 185.322,357.321 C 185.764,357.566 186.575,358.032 187.125,358.357 C 188.427,359.125 188.782,359.126 190.196,358.366M 257.068,319.750 C 257.418,319.475 257.877,319.250 258.087,319.250 C 258.298,319.250 258.536,319.144 258.616,319.014 C 258.697,318.885 259.575,318.318 260.568,317.756 C 262.567,316.625 263.060,316.331 264.038,315.688 C 264.403,315.447 264.868,315.250 265.070,315.250 C 265.273,315.250 265.584,315.075 265.762,314.861 C 265.940,314.646 266.432,314.309 266.855,314.111 C 267.279,313.913 267.962,313.526 268.375,313.250 C 268.788,312.974 269.462,312.580 269.875,312.375 C 270.288,312.169 271.038,311.747 271.543,311.438 C 272.745,310.701 276.769,308.387 277.250,308.156 C 277.456,308.057 278.034,307.728 278.534,307.425 C 279.034,307.123 280.312,306.369 281.375,305.750 C 282.438,305.131 283.716,304.380 284.216,304.080 C 284.716,303.780 285.462,303.357 285.875,303.140 C 286.288,302.924 287.075,302.474 287.625,302.140 C 288.175,301.807 288.977,301.370 289.407,301.168 C 289.837,300.966 290.265,300.677 291.772,299.849 C 291.954,299.628 292.334,299.341 292.615,299.211 C 292.896,299.081 293.575,298.700 294.125,298.364 C 294.675,298.028 295.462,297.576 295.875,297.360 C 296.288,297.143 297.034,296.720 297.534,296.420 C 298.034,296.120 299.272,295.393 300.284,294.804 C 301.297,294.215 302.294,293.633 302.500,293.510 C 302.706,293.387 303.044,293.216 303.250,293.131 C 303.456,293.046 304.075,292.704 304.625,292.373 C 305.175,292.041 306.019,291.535 306.500,291.250 C 306.981,290.965 307.825,290.462 308.375,290.133 C 308.925,289.803 309.722,289.372 310.146,289.173 C 310.569,288.974 311.160,288.500 311.458,288.122 C 311.458,288.122 312,287.433 312,287.433 C 312,287.433 312,256 312,256 C 312,256 312,224.567 312,224.567 C 312,224.567 311.458,223.879 311.458,223.879 C 311.160,223.500 310.569,223.026 310.146,222.827 C 309.722,222.629 308.925,222.196 308.375,221.867 C 307.825,221.538 306.981,221.035 306.500,220.750 C 306.019,220.465 305.175,219.959 304.625,219.627 C 304.075,219.296 303.456,218.954 303.250,218.869 C 303.044,218.784 302.706,218.613 302.500,218.490 C 302.294,218.367 301.297,217.785 300.284,217.196 C 299.272,216.607 298.034,215.880 297.534,215.580 C 297.034,215.280 296.288,214.857 295.875,214.641 C 295.462,214.424 294.675,213.972 294.125,213.636 C 293.575,213.300 292.896,212.919 292.615,212.789 C 292.334,212.659 291.954,212.371 291.772,212.151 C 291.223,211.842 289.649,211.092 289.415,210.855 C 289.118,210.765 288.706,210.548 288.500,210.374 C 288.294,210.200 287.454,209.702 286.634,209.268 C 285.813,208.835 284.961,208.316 283.384,207.514 C 283.303,207.385 282.384,206.794 281.341,206.202 C 280.297,205.609 279.034,204.883 278.534,204.588 C 278.034,204.293 277.150,203.806 276.570,203.507 C 275.989,203.207 275.145,202.716 274.695,202.416 C 274.244,202.116 273.594,201.730 273.250,201.559 C 272.906,201.387 272.175,200.966 271.625,200.623 C 271.075,200.280 270.288,199.831 269.875,199.625 C 269.462,199.419 268.788,199.025 268.375,198.750 C 267.962,198.475 267.279,198.087 266.855,197.889 C 266.432,197.691 265.940,197.354 265.762,197.139 C 265.584,196.925 265.279,196.750 265.084,196.750 C 264.889,196.750 264.425,196.549 264.052,196.303 C 263.229,195.759 262.877,195.551 260.568,194.244 C 259.575,193.682 258.697,193.115 258.616,192.986 C 258.536,192.856 258.269,192.750 258.024,192.750 C 257.779,192.750 257.374,192.525 257.125,192.250 C 256.564,191.630 255.753,191.611 254.971,192.197 C 254.643,192.444 254.094,192.781 253.750,192.949 C 252.649,193.484 249.794,195.118 249.581,195.334 C 249.468,195.450 249.037,195.703 248.625,195.897 C 248.213,196.090 247.576,196.446 247.209,196.687 C 246.844,196.928 245.887,197.494 245.084,197.946 C 244.282,198.398 243.456,198.878 243.250,199.014 C 243.044,199.149 242.537,199.434 242.125,199.647 C 241.713,199.860 240.966,200.280 240.466,200.580 C 239.392,201.224 236.064,203.162 235.438,203.508 C 235.197,203.641 234.803,203.859 234.562,203.992 C 233.936,204.338 230.608,206.276 229.534,206.920 C 229.034,207.220 228.287,207.643 227.875,207.859 C 227.463,208.076 226.675,208.526 226.125,208.859 C 225.575,209.193 224.787,209.642 224.375,209.857 C 223.963,210.073 223.287,210.475 222.875,210.750 C 222.463,211.025 221.787,211.427 221.375,211.643 C 220.963,211.858 220.175,212.307 219.625,212.641 C 219.075,212.974 218.287,213.424 217.875,213.641 C 217.463,213.857 216.675,214.304 216.125,214.634 C 215.575,214.964 214.768,215.434 214.333,215.679 C 213.897,215.924 212.716,216.607 211.708,217.196 C 209.856,218.278 209.183,218.663 208.500,219.031 C 208.045,219.277 204.793,221.166 203.534,221.917 C 203.034,222.215 202.256,222.651 201.806,222.886 C 201.355,223.121 200.764,223.596 200.493,223.940 C 200.008,224.557 200,225.090 200,256.020 C 200,256.020 200,287.472 200,287.472 C 200,287.472 200.562,288.097 200.562,288.097 C 200.872,288.441 201.480,288.925 201.914,289.174 C 203.329,289.983 208.115,292.766 208.500,293.002 C 208.706,293.130 209.924,293.828 211.206,294.554 C 212.488,295.281 213.950,296.120 214.456,296.420 C 214.961,296.720 215.713,297.147 216.125,297.368 C 217.119,297.901 218.399,298.631 219.625,299.366 C 220.175,299.696 220.963,300.142 221.375,300.357 C 221.787,300.573 222.463,300.969 222.875,301.237 C 223.287,301.505 224.412,302.184 225.375,302.746 C 226.338,303.307 227.294,303.867 227.500,303.990 C 227.706,304.113 228.044,304.284 228.250,304.369 C 228.456,304.454 229.034,304.772 229.534,305.075 C 230.034,305.377 231.272,306.107 232.284,306.696 C 233.297,307.285 234.294,307.872 234.500,308 C 234.706,308.128 235.924,308.828 237.206,309.554 C 238.488,310.281 239.950,311.120 240.456,311.420 C 240.961,311.720 241.713,312.140 242.125,312.353 C 242.537,312.566 243.044,312.851 243.250,312.986 C 243.456,313.122 244.282,313.602 245.084,314.054 C 245.887,314.505 246.844,315.072 247.209,315.313 C 247.576,315.554 248.213,315.910 248.625,316.103 C 249.037,316.297 249.468,316.550 249.581,316.666 C 249.827,316.916 252.804,318.604 253.895,319.112 C 254.319,319.310 254.810,319.646 254.988,319.861 C 255.432,320.395 256.307,320.349 257.068,319.750M 177.043,274.086 C 177.484,273.687 177.500,271.110 177.500,201.739 C 177.500,131.682 177.513,129.744 177.982,127.465 C 178.247,126.178 178.640,124.787 178.855,124.375 C 179.071,123.963 179.248,123.546 179.249,123.450 C 179.252,123.039 180.932,120.764 182.225,119.418 C 183.645,117.939 185.089,116.872 187.409,115.587 C 188.723,114.859 193.569,112.059 195.211,111.080 C 195.714,110.780 196.463,110.357 196.875,110.141 C 197.287,109.924 198.075,109.477 198.625,109.147 C 199.919,108.371 200.913,107.800 202,107.210 C 202.481,106.948 203.213,106.516 203.625,106.248 C 204.409,105.741 205.602,105.050 206.875,104.368 C 207.287,104.147 208.034,103.720 208.534,103.420 C 209.608,102.776 212.936,100.838 213.562,100.492 C 213.803,100.359 214.197,100.135 214.438,99.995 C 214.678,99.855 215.213,99.569 215.625,99.361 C 216.037,99.152 216.881,98.652 217.500,98.250 C 218.119,97.848 218.963,97.345 219.375,97.132 C 219.787,96.920 220.575,96.478 221.125,96.149 C 221.675,95.820 222.600,95.306 223.180,95.007 C 223.761,94.707 224.605,94.212 225.055,93.906 C 225.506,93.601 226.044,93.266 226.250,93.163 C 226.456,93.061 227.039,92.728 227.544,92.425 C 229.011,91.547 232.839,89.353 233.250,89.156 C 233.456,89.057 234.034,88.728 234.534,88.425 C 235.521,87.828 238.855,85.883 239.562,85.492 C 239.803,85.359 240.197,85.141 240.438,85.008 C 241.255,84.556 244.371,82.730 245.375,82.113 C 245.925,81.776 246.713,81.331 247.125,81.125 C 247.537,80.919 248.213,80.525 248.625,80.250 C 249.037,79.975 249.713,79.573 250.125,79.357 C 250.537,79.142 251.325,78.696 251.875,78.366 C 252.425,78.037 253.236,77.566 253.678,77.321 C 254.979,76.598 259.093,74.253 259.500,74.002 C 259.706,73.876 261.095,73.064 262.586,72.198 C 264.077,71.333 265.708,70.380 266.211,70.080 C 266.714,69.780 267.462,69.357 267.875,69.141 C 268.288,68.924 269.075,68.472 269.625,68.136 C 270.175,67.800 270.850,67.409 271.125,67.267 C 271.400,67.125 272.036,66.754 272.539,66.442 C 273.042,66.130 274.111,65.505 274.914,65.054 C 275.718,64.602 276.544,64.122 276.750,63.986 C 276.956,63.851 277.462,63.566 277.875,63.353 C 278.288,63.140 279.034,62.720 279.534,62.420 C 280.608,61.776 283.936,59.838 284.562,59.492 C 284.803,59.359 285.197,59.142 285.438,59.010 C 289.405,56.835 290.500,56.084 290.500,55.535 C 290.500,55.278 289.413,54.291 287.812,53.094 C 284.735,50.792 280.595,47.969 278.500,46.743 C 278.019,46.462 277.175,45.959 276.625,45.627 C 276.075,45.295 275.456,44.954 275.250,44.869 C 275.044,44.784 274.706,44.613 274.500,44.490 C 274.294,44.368 273.394,43.915 272.500,43.484 C 271.606,43.054 270.706,42.599 270.500,42.474 C 270.294,42.349 269.844,42.124 269.500,41.974 C 268.632,41.595 267.088,40.902 265.723,40.277 C 265.089,39.987 264.426,39.750 264.250,39.750 C 264.074,39.750 263.467,39.541 262.902,39.285 C 261.914,38.837 261.032,38.505 259.562,38.026 C 256.269,36.953 255.562,36.750 255.125,36.748 C 254.850,36.748 254.297,36.576 253.895,36.367 C 253.494,36.157 252.482,35.887 251.645,35.766 C 250.809,35.645 249.787,35.415 249.375,35.255 C 248.963,35.094 247.838,34.867 246.875,34.749 C 245.912,34.632 244.338,34.361 243.375,34.147 C 242.412,33.934 240.950,33.753 240.125,33.746 C 239.300,33.740 237.275,33.572 235.625,33.373 C 232.131,32.951 227.029,32.898 224,33.252 C 222.831,33.389 220.309,33.614 218.394,33.754 C 216.480,33.892 214.350,34.174 213.661,34.378 C 212.973,34.583 211.990,34.750 211.477,34.750 C 210.964,34.750 209.832,34.974 208.960,35.247 C 208.088,35.520 207.094,35.745 206.750,35.747 C 206.406,35.748 205.422,35.975 204.562,36.250 C 203.703,36.525 202.297,36.975 201.438,37.250 C 200.578,37.525 199.706,37.754 199.500,37.758 C 199.294,37.763 198.675,37.984 198.125,38.250 C 197.575,38.516 196.928,38.737 196.686,38.742 C 196.445,38.746 195.828,38.975 195.315,39.250 C 194.802,39.525 194.254,39.750 194.096,39.750 C 193.845,39.750 192.905,40.135 190.125,41.378 C 187.301,42.641 181.228,45.782 180.500,46.357 C 180.294,46.520 179.844,46.792 179.500,46.962 C 178.629,47.391 178.066,47.742 176.625,48.750 C 175.938,49.231 175.194,49.737 174.973,49.875 C 172.760,51.252 166.704,56.044 164.472,58.184 C 163.701,58.924 162.844,59.687 162.568,59.880 C 161.431,60.676 153.955,69.108 152.154,71.625 C 149.131,75.848 148.149,77.314 146.722,79.587 C 146.586,79.883 146.203,80.575 145.872,81.125 C 145.541,81.675 145.062,82.519 144.808,83 C 144.383,83.802 144.005,84.510 143.470,85.500 C 143.180,86.037 141.787,88.946 141.255,90.125 C 141.007,90.675 140.567,91.644 140.277,92.278 C 139.987,92.911 139.749,93.586 139.748,93.778 C 139.747,93.969 139.523,94.463 139.250,94.875 C 138.977,95.287 138.752,95.850 138.750,96.125 C 138.748,96.400 138.575,96.955 138.364,97.359 C 138.154,97.762 137.881,98.493 137.758,98.984 C 137.635,99.474 137.368,100.381 137.164,101 C 136.014,104.502 135.750,105.436 135.750,106.009 C 135.750,106.357 135.525,107.282 135.250,108.065 C 134.975,108.847 134.747,109.856 134.744,110.306 C 134.741,110.757 134.516,111.961 134.244,112.983 C 133.972,114.005 133.748,115.468 133.745,116.233 C 133.742,116.999 133.552,118.525 133.321,119.625 C 132.937,121.460 132.895,126.874 132.821,185.106 C 132.821,185.106 132.739,248.586 132.739,248.586 C 132.739,248.586 133.432,249.313 133.432,249.313 C 134.015,249.925 135.353,250.799 137.562,252.010 C 137.803,252.142 138.197,252.359 138.438,252.492 C 139.064,252.838 142.392,254.776 143.466,255.420 C 143.966,255.720 144.713,256.147 145.125,256.368 C 146.440,257.072 147.603,257.748 148.375,258.255 C 148.787,258.526 149.575,258.974 150.125,259.250 C 150.675,259.526 151.424,259.949 151.791,260.189 C 153.073,261.030 155.244,262.250 155.458,262.250 C 155.576,262.250 155.876,262.475 156.125,262.750 C 156.374,263.025 156.779,263.250 157.024,263.250 C 157.269,263.250 157.534,263.353 157.611,263.478 C 157.689,263.603 158.961,264.395 160.439,265.238 C 161.916,266.082 163.294,266.875 163.500,267.002 C 163.706,267.130 164.924,267.828 166.206,268.554 C 167.488,269.281 168.950,270.120 169.456,270.420 C 169.961,270.720 170.713,271.142 171.125,271.357 C 171.537,271.573 172.213,271.973 172.625,272.247 C 173.037,272.521 173.656,272.885 174,273.058 C 174.344,273.229 175.006,273.625 175.472,273.935 C 176.485,274.610 176.466,274.608 177.043,274.086M 203.041,195.959 C 204.049,195.387 205.053,194.768 205.270,194.584 C 205.718,194.555 207.587,193.278 207.542,193.250 C 207.757,193.250 209.947,192.018 211.209,191.187 C 211.576,190.946 212.213,190.573 212.625,190.357 C 213.037,190.142 213.825,189.693 214.375,189.359 C 214.925,189.026 215.713,188.576 216.125,188.359 C 216.537,188.143 217.325,187.696 217.875,187.366 C 218.425,187.036 219.232,186.566 219.667,186.321 C 220.103,186.076 221.284,185.393 222.292,184.804 C 223.300,184.215 224.294,183.643 224.500,183.531 C 225.428,183.030 228.765,181.100 230.466,180.080 C 230.966,179.780 231.713,179.358 232.125,179.143 C 232.537,178.927 233.213,178.529 233.625,178.257 C 234.470,177.700 235.759,176.958 236.875,176.385 C 237.287,176.173 238.038,175.747 238.543,175.438 C 239.745,174.701 243.769,172.387 244.250,172.156 C 244.456,172.057 245.034,171.728 245.534,171.425 C 246.034,171.123 247.312,170.369 248.375,169.750 C 249.438,169.131 250.716,168.377 251.216,168.075 C 251.716,167.772 252.294,167.443 252.500,167.345 C 252.979,167.115 255.272,165.794 256.461,165.062 C 256.964,164.753 257.712,164.331 258.125,164.125 C 258.538,163.919 259.212,163.525 259.625,163.250 C 260.038,162.975 260.712,162.573 261.125,162.357 C 261.538,162.142 262.325,161.696 262.875,161.366 C 263.425,161.036 264.231,160.566 264.667,160.321 C 265.103,160.076 266.284,159.393 267.292,158.804 C 268.300,158.215 269.322,157.625 269.562,157.492 C 269.803,157.359 270.197,157.141 270.438,157.008 C 271.064,156.662 274.392,154.724 275.466,154.080 C 275.966,153.780 276.712,153.357 277.125,153.141 C 277.538,152.924 278.325,152.474 278.875,152.141 C 279.425,151.807 280.212,151.358 280.625,151.143 C 281.038,150.927 281.712,150.529 282.125,150.257 C 282.538,149.985 283.236,149.563 283.678,149.319 C 284.119,149.075 285.469,148.304 286.678,147.606 C 287.886,146.907 289.044,146.255 289.250,146.156 C 289.456,146.057 290.034,145.728 290.534,145.425 C 291.521,144.828 294.855,142.883 295.562,142.492 C 295.803,142.359 296.197,142.141 296.438,142.008 C 296.678,141.875 297.700,141.285 298.708,140.696 C 299.716,140.107 300.897,139.424 301.333,139.179 C 301.769,138.934 302.575,138.464 303.125,138.134 C 303.675,137.804 304.462,137.358 304.875,137.143 C 305.288,136.927 305.962,136.525 306.375,136.250 C 306.788,135.975 307.462,135.573 307.875,135.357 C 308.288,135.142 309.039,134.720 309.544,134.420 C 310.050,134.120 311.512,133.281 312.794,132.554 C 314.076,131.828 315.294,131.130 315.500,131.002 C 315.706,130.875 317.095,130.064 318.586,129.198 C 320.077,128.333 321.682,127.400 322.154,127.125 C 323.211,126.508 325.618,125.191 326.625,124.677 C 329.572,123.172 334.371,122.781 337.625,123.780 C 338.587,124.075 340.050,124.644 340.875,125.046 C 342.300,125.738 342.944,126.099 344.812,127.251 C 345.259,127.527 345.962,127.928 346.375,128.143 C 346.788,128.358 347.575,128.807 348.125,129.141 C 348.675,129.474 349.462,129.924 349.875,130.141 C 350.288,130.357 351.034,130.780 351.534,131.080 C 352.034,131.380 353.272,132.107 354.284,132.696 C 355.297,133.285 356.294,133.871 356.500,134 C 356.706,134.129 357.924,134.828 359.206,135.554 C 360.488,136.281 361.950,137.123 362.456,137.425 C 362.961,137.728 363.544,138.057 363.750,138.155 C 364.305,138.421 366.694,139.810 367.459,140.311 C 367.825,140.551 368.575,140.974 369.125,141.250 C 369.675,141.526 370.462,141.977 370.875,142.252 C 371.288,142.526 371.999,142.924 372.455,143.137 C 372.912,143.349 373.839,143.911 374.515,144.386 C 375.192,144.861 375.908,145.250 376.108,145.250 C 376.307,145.250 376.536,145.356 376.616,145.486 C 376.697,145.615 377.616,146.206 378.659,146.798 C 379.703,147.391 380.966,148.123 381.466,148.425 C 381.966,148.728 382.544,149.057 382.750,149.156 C 383.101,149.325 386.396,151.206 388.456,152.414 C 388.961,152.710 389.712,153.147 390.125,153.383 C 391.092,153.936 391.885,154.403 393.125,155.147 C 393.675,155.476 394.462,155.924 394.875,156.141 C 395.288,156.357 396.034,156.780 396.534,157.080 C 397.034,157.380 398.272,158.107 399.284,158.696 C 400.297,159.285 401.294,159.867 401.500,159.990 C 401.706,160.113 402.044,160.284 402.250,160.369 C 402.456,160.454 403.075,160.796 403.625,161.127 C 404.175,161.459 405.019,161.965 405.500,162.250 C 405.981,162.535 406.825,163.038 407.375,163.367 C 407.925,163.696 408.712,164.143 409.125,164.359 C 409.538,164.576 410.325,165.026 410.875,165.359 C 411.425,165.693 412.212,166.142 412.625,166.356 C 413.038,166.571 413.825,167.029 414.375,167.374 C 414.925,167.718 415.712,168.169 416.125,168.375 C 416.538,168.581 417.212,168.974 417.625,169.248 C 418.038,169.523 418.825,169.974 419.375,170.250 C 419.925,170.525 420.741,170.976 421.188,171.251 C 422.867,172.283 426.417,174.375 427.562,175.008 C 427.803,175.141 428.197,175.359 428.438,175.492 C 429.064,175.838 432.392,177.776 433.466,178.420 C 433.966,178.720 434.712,179.141 435.125,179.355 C 436.702,180.175 438.640,181.314 439,181.633 C 439.207,181.815 439.657,182.091 440,182.245 C 440.344,182.400 441.075,182.797 441.625,183.129 C 443.274,184.123 444.315,184.731 445.496,185.393 C 446.545,185.980 446.637,185.992 446.933,185.587 C 447.108,185.349 447.250,184.851 447.250,184.479 C 447.250,184.107 447.447,182.919 447.688,181.839 C 448.065,180.142 448.125,178.466 448.125,169.500 C 448.125,161.981 448.039,158.801 447.812,157.949 C 447.639,157.303 447.390,155.723 447.257,154.439 C 447.123,153.155 446.842,151.617 446.632,151.020 C 446.422,150.425 446.250,149.594 446.250,149.174 C 446.250,148.754 446.034,147.671 445.770,146.768 C 445.507,145.864 445.181,144.675 445.048,144.125 C 444.914,143.575 444.692,142.787 444.554,142.375 C 444.416,141.963 444.114,141.062 443.884,140.375 C 443.654,139.688 443.357,138.689 443.224,138.155 C 443.091,137.621 442.818,136.950 442.616,136.662 C 442.415,136.374 442.250,135.939 442.250,135.694 C 442.250,135.448 442.025,134.828 441.750,134.315 C 441.475,133.802 441.250,133.234 441.250,133.053 C 441.250,132.872 441.035,132.308 440.772,131.799 C 440.509,131.291 439.990,130.200 439.618,129.375 C 438.365,126.589 438.133,126.131 436.690,123.576 C 435.898,122.174 435.250,120.960 435.250,120.878 C 435.250,120.796 435.040,120.425 434.784,120.052 C 434.253,119.282 432.501,116.585 432.125,115.960 C 431.988,115.731 431.529,115.056 431.105,114.460 C 430.682,113.863 430.063,112.981 429.730,112.499 C 429.008,111.454 426.421,108.181 425.483,107.125 C 422.783,104.088 420.056,101.264 417.785,99.154 C 415.142,96.700 409.175,91.750 408.860,91.750 C 408.769,91.750 408.157,91.300 407.500,90.750 C 406.843,90.200 406.236,89.750 406.150,89.750 C 406.065,89.750 405.462,89.377 404.810,88.921 C 403.190,87.788 395.505,83.385 394.250,82.871 C 394.044,82.787 393.397,82.500 392.812,82.234 C 392.228,81.968 391.272,81.538 390.688,81.280 C 390.103,81.021 389.087,80.571 388.431,80.280 C 387.774,79.988 387.099,79.746 386.931,79.742 C 386.762,79.737 386.175,79.516 385.625,79.250 C 385.075,78.984 384.423,78.763 384.178,78.758 C 383.932,78.754 383.289,78.525 382.750,78.250 C 382.211,77.975 381.512,77.749 381.197,77.749 C 380.883,77.748 380.288,77.569 379.875,77.352 C 379.462,77.135 378.619,76.859 378,76.740 C 376.805,76.510 374.467,75.934 372.322,75.341 C 371.604,75.142 370.142,74.876 369.072,74.750 C 368.001,74.623 366.731,74.398 366.250,74.249 C 365.221,73.932 360.288,73.546 354.503,73.330 C 349.526,73.144 341.868,73.582 338.235,74.258 C 336.783,74.529 335.246,74.750 334.820,74.750 C 334.394,74.750 333.331,74.974 332.460,75.247 C 331.588,75.520 330.567,75.745 330.190,75.747 C 329.813,75.749 328.913,75.975 328.190,76.250 C 327.467,76.525 326.594,76.754 326.250,76.758 C 325.906,76.763 325.175,76.984 324.625,77.250 C 324.075,77.516 323.342,77.737 322.996,77.742 C 322.651,77.746 321.948,77.975 321.435,78.250 C 320.922,78.525 320.303,78.750 320.060,78.750 C 319.817,78.750 319.198,78.975 318.685,79.250 C 318.172,79.525 317.555,79.751 317.313,79.752 C 317.072,79.753 316.538,79.977 316.125,80.250 C 315.712,80.523 315.220,80.747 315.030,80.748 C 314.731,80.750 310.799,82.530 309.375,83.309 C 309.100,83.460 308.144,83.967 307.250,84.436 C 306.356,84.904 305.175,85.555 304.625,85.882 C 304.075,86.209 303.456,86.546 303.250,86.631 C 303.044,86.716 302.706,86.887 302.500,87.010 C 302.294,87.133 301.297,87.715 300.284,88.304 C 299.272,88.893 298.034,89.620 297.534,89.920 C 297.034,90.220 296.288,90.643 295.875,90.859 C 295.462,91.076 294.675,91.528 294.125,91.864 C 293.575,92.200 292.900,92.598 292.625,92.750 C 292.350,92.902 291.675,93.300 291.125,93.636 C 290.575,93.972 289.788,94.406 289.375,94.601 C 288.962,94.796 288.532,95.050 288.419,95.165 C 288.220,95.368 285.666,96.842 284.125,97.644 C 283.712,97.859 282.966,98.280 282.466,98.580 C 280.765,99.600 277.428,101.531 276.500,102.031 C 276.294,102.142 275.300,102.715 274.292,103.304 C 273.284,103.893 272.103,104.575 271.667,104.819 C 271.231,105.063 270.538,105.484 270.125,105.755 C 269.712,106.026 268.925,106.474 268.375,106.750 C 267.825,107.026 267.038,107.477 266.625,107.752 C 266.212,108.026 265.538,108.419 265.125,108.625 C 264.712,108.831 263.962,109.253 263.457,109.562 C 262.255,110.299 258.231,112.613 257.750,112.844 C 257.544,112.943 256.966,113.272 256.466,113.575 C 255.414,114.212 252.052,116.171 251.500,116.469 C 250.572,116.969 247.235,118.900 245.534,119.920 C 245.034,120.220 244.287,120.643 243.875,120.859 C 243.463,121.076 242.675,121.526 242.125,121.859 C 241.575,122.193 240.787,122.642 240.375,122.857 C 239.963,123.073 239.287,123.475 238.875,123.750 C 238.463,124.025 237.787,124.410 237.375,124.603 C 236.963,124.797 236.532,125.050 236.419,125.165 C 236.220,125.368 233.666,126.842 232.125,127.644 C 231.713,127.859 230.966,128.280 230.466,128.580 C 229.309,129.274 225.993,131.202 225.500,131.469 C 224.572,131.970 221.235,133.900 219.534,134.920 C 219.034,135.220 218.287,135.647 217.875,135.868 C 216.549,136.578 215.394,137.250 214.625,137.757 C 214.213,138.029 213.537,138.419 213.125,138.625 C 212.713,138.831 211.964,139.253 211.461,139.562 C 210.958,139.872 209.889,140.494 209.086,140.946 C 208.282,141.398 207.456,141.878 207.250,142.014 C 207.044,142.149 206.537,142.434 206.125,142.647 C 205.713,142.860 204.925,143.304 204.375,143.633 C 203.825,143.962 202.981,144.450 202.500,144.716 C 201.410,145.320 200.614,146.163 200.267,147.079 C 199.863,148.143 199.896,196.296 200.300,196.700 C 200.762,197.162 201.066,197.079 203.041,195.959" />

                  
                  </svg>
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  ChatGPT Messages
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {dateStats.chatgpt_count.toLocaleString()}
                </p>
              </div>
            </div>

            {/* DartBoard Messages */}
            <div className={`${archiveCardStyles.base} group relative`} style={getEntranceStyle(showStatsReveal, 180)}>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
              <div className="relative">
                <div className="mb-3 inline-flex rounded-lg p-2.5 bg-blue-500/10">
                  <svg viewBox="0 0 459.428 459.428" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-5 w-5 text-blue-400">
                    <g>
                      <path d="M349.792,157.708l-19.856,19.856c9.316,17.136,14.62,36.652,14.62,57.459c0,66.232-53.924,120.156-120.156,120.156 s-120.156-53.924-120.156-120.156c0-66.232,53.924-120.156,120.156-120.156c20.808,0,40.324,5.304,57.459,14.62l19.856-19.856 c-22.508-13.94-48.96-21.964-77.316-21.964c-81.26,0-147.356,66.096-147.356,147.356S143.14,382.38,224.4,382.38 s147.356-66.096,147.356-147.355C371.756,206.669,363.731,180.217,349.792,157.708z M294.644,212.925l-23.868,23.801 c-0.884,24.887-21.283,44.742-46.375,44.742c-25.636,0-46.444-20.807-46.444-46.443c0-25.092,19.856-45.492,44.744-46.375 l23.868-23.8c-7.004-2.244-14.416-3.468-22.167-3.468c-40.596,0-73.644,33.048-73.644,73.644s33.048,73.645,73.644,73.645 s73.644-33.049,73.644-73.645C298.044,227.34,296.888,219.861,294.644,212.925z M416.771,119.629l-19.855,19.856 c15.708,28.288,24.684,60.86,24.684,95.54c0,108.732-88.468,197.201-197.2,197.201S27.2,343.757,27.2,235.024 c0-108.732,88.468-197.2,197.2-197.2c34.68,0,67.251,8.976,95.54,24.684l19.856-19.856C306.067,22.321,266.56,10.625,224.4,10.625 C100.64,10.625,0,111.265,0,235.024s100.64,224.4,224.4,224.4s224.4-100.641,224.4-224.4 C448.8,192.865,437.104,153.357,416.771,119.629z M387.301,120.207l-25.963-2.883L233.431,245.226 c-5.311,5.311-13.92,5.311-19.231,0c-5.311-5.312-5.311-13.92,0-19.231L342.101,98.093l-2.883-25.962l72.128-72.128l9.615,38.468 l38.467,9.615L387.301,120.207z" fill="currentColor"></path>
                    </g>
                  </svg>
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  DartBoard Messages
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {dateStats.dartboard_count.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Archive Timeline */}
            <div className={`${archiveCardStyles.base} group relative`} style={getEntranceStyle(showStatsReveal, 270)}>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
              <div className="relative">
                <div className="mb-3 inline-flex rounded-lg p-2.5 bg-rose-500/10">
                  <svg className="h-5 w-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Archive Timeline
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {dateStats.ts_min && dateStats.ts_max ? (
                    `${new Date(dateStats.ts_min).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })} → ${new Date(dateStats.ts_max).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}`
                  ) : (
                    "No data"
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Search Input Card - enhanced glass-morphism */}
        {showArchiveContent && (
        <div
          className={`${archiveCardStyles.base} group relative`}
          style={getEntranceStyle(showSearchReveal, 0, -16)}
        >
          {/* Subtle glow effect on hover - positioned behind content */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none -z-10" />
          <div className="flex flex-col gap-4">
            {/* Search row with relative positioning for overlay helper panels */}
            <div className="relative py-3">
              {/* Top row: Search input + Search button */}
              <div className="flex items-center gap-3 mb-4">
                {/* Search input with magnifying glass icon */}
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={handleSearchQueryChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSubmitArchiveSearch();
                      }
                    }}
                    placeholder="Add term and press Enter (tags are always on)"
                    className="w-full bg-gray-700 text-gray-100 pl-10 pr-4 py-2 rounded-lg border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
                  />
                </div>

                {/* Action button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmitArchiveSearch();
                  }}
                  disabled={loading}
                  className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg transition-colors whitespace-nowrap flex items-center gap-2"
                >
                  <Search className="h-4 w-4" />
                  {loading ? "Searching..." : "Search"}
                </button>
              </div>

              {/* Bottom controls row */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] p-0.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md">
                  {[
                    { id: "", label: "All" },
                    { id: "chatgpt", label: "ChatGPT" },
                    { id: "dartboard", label: "DartBoard" },
                  ].map((option) => (
                    <button
                      key={option.id || "all-source"}
                      type="button"
                      onClick={() => setSourceFilter(option.id as "" | "chatgpt" | "dartboard")}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        sourceFilter === option.id
                          ? "bg-blue-600 text-white shadow-md"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] p-0.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md">
                  {[
                    { id: "", label: "All" },
                    { id: "user", label: "User" },
                    { id: "assistant", label: "Assistant" },
                  ].map((option) => (
                    <button
                      key={option.id || "all-role"}
                      type="button"
                      onClick={() => setRoleFilter(option.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        roleFilter === option.id
                          ? "bg-blue-600 text-white shadow-md"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] p-0.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => {
                      setTagMatchMode("OR");
                      void runSearch({ tagModeOverride: "OR", queryOverride: "", resetPage: true });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      tagMatchMode === "OR"
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    OR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTagMatchMode("AND");
                      void runSearch({ tagModeOverride: "AND", queryOverride: "", resetPage: true });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      tagMatchMode === "AND"
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    AND
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleClearSearchFilters}
                  className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-xs font-medium text-gray-300 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
              <div>
                {loading
                  ? "Searching…"
                  : `Search results: ${totalResults.toLocaleString()}`}
              </div>
              {searchWarning && !loading && (
                <div className="text-xs text-amber-300/90">{searchWarning}</div>
              )}
            </div>

            {/* Tag chips - only show when tags exist */}
            {searchTags.length > 0 && (
              <div className="mt-1">
                <TagChips tags={searchTags} onRemove={handleRemoveSearchTag} />
              </div>
            )}
          </div>
        </div>
        )}

        {/* Timeline Navigator Card - enhanced glass-morphism */}
        {showArchiveContent && dateStats && dateStats.ts_min && dateStats.ts_max && (
          <div
            className={`${archiveCardStyles.base} group relative`}
            style={getEntranceStyle(showLowerReveal, 0)}
          >
            {/* Subtle glow effect on hover - positioned behind content */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none -z-10" />
            <div className="flex flex-col gap-4">
              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Timeline Navigator</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApplyDates}
                    disabled={loading || !datesDirty}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      loading || !datesDirty
                        ? "cursor-not-allowed border border-gray-700 bg-gray-800/70 text-gray-500"
                        : "border border-blue-400/50 bg-blue-600 text-white shadow-md hover:bg-blue-500"
                    }`}
                  >
                    {loading ? "Applying..." : "Apply Dates"}
                  </button>
                  <button
                    onClick={() => setDateViewMode(dateViewMode === "months" ? "days" : "months")}
                    className={`rounded-full px-3 py-1.5 gap-2 text-xs font-medium transition-all ${
                      dateViewMode === "days" 
                        ? "bg-blue-600 text-white shadow-md" 
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full inline-block ${
                      dateViewMode === "days" ? "bg-white" : "bg-gray-500"
                    }`} />
                    View by {dateViewMode === "months" ? "days" : "months"}
                  </button>
                </div>
              </div>

              {/* Zoom Navigation: always show all year pills; selected year highlighted */}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-gray-400 uppercase tracking-wider font-medium">Zoom:</span>
                <div className="flex flex-wrap gap-2">
                  {getAvailableYears().map((year) => {
                    const isActive = selectedYear === year;
                    return (
                      <button
                        key={year}
                        type="button"
                        onClick={() => zoomToYear(year)}
                        className={`px-3 py-1.5 rounded-lg border font-medium text-sm backdrop-blur-sm transition-all duration-200 ${
                          isActive
                            ? "border-blue-400 bg-blue-500/30 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                            : "border-blue-500/20 bg-slate-700/50 text-gray-200 hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300"
                        }`}
                      >
                        {year}
                      </button>
                    );
                  })}
                </div>
                {selectedYear !== null && (
                  <button
                    type="button"
                    onClick={zoomOut}
                    className="px-3 py-1.5 rounded-lg border font-medium text-sm backdrop-blur-sm transition-all duration-200 border-blue-500/20 bg-slate-700/50 text-gray-200 hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300"
                  >
                    Back
                  </button>
                )}
              </div>

              {/* Histogram: only show after selecting a year */}
              {selectedYear !== null && (
                <div
                  className="w-full"
                  onMouseUp={handleMonthDragEnd}
                  onMouseLeave={handleMonthDragEnd}
                >
                  {(() => {
                    const displayYear = selectedYear;
                    const months = getAvailableMonths(displayYear);
                    return (
                      <>
                        {/* Row 1: Count labels */}
                        <div className="relative mb-0.5 h-4">
                          {loadingMonthlyCounts ? (
                            <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] text-blue-200/80">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Loading month bars...</span>
                            </div>
                          ) : (
                            <div className="flex h-full items-center">
                              {months.map((month, index) => (
                                <div key={month} className="flex flex-1 justify-center">
                                  <span className="text-[10px] tabular-nums text-muted-foreground/60">
                                    {monthCounts[index]}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Row 2: Bars — true histogram (0 count => 0px height) */}
                        <div className={`flex h-10 items-end transition-opacity ${loadingMonthlyCounts ? "opacity-75" : "opacity-100"}`}>
                          {months.map((month, index) => {
                            const maxHeight = 40;
                            const activity = monthActivity[index] ?? 0;
                            const rawHeight = activity * maxHeight;
                            const barHeight = Number.isFinite(rawHeight)
                              ? Math.max(0, Math.min(maxHeight, rawHeight))
                              : 0;

                            const monthKey = formatYM(displayYear, month);
                            const isSelected = selectedMonths.has(monthKey);
                            return (
                              <div key={month} className="flex flex-1 items-end justify-center">
                                <div
                                  className={`w-[70%] rounded-t-sm transition-all duration-300 ease-out ${
                                    isSelected ? "bg-blue-500" : "bg-blue-500/50"
                                  } ${loadingMonthlyCounts ? "animate-pulse opacity-50" : "opacity-100"}`}
                                  style={{ height: `${barHeight}px` }}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Row 3: Month pills */}
                        <div className="flex">
                          {months.map((month) => {
                            const monthName = new Date(displayYear, month, 1).toLocaleDateString("en-US", { month: "short" });
                            const monthKey = formatYM(displayYear, month);

                            let hasMessages = true;
                            if (dateStats?.ts_min && dateStats?.ts_max) {
                              const archiveMin = new Date(dateStats.ts_min);
                              const archiveMax = new Date(dateStats.ts_max);
                              const monthStart = new Date(displayYear, month, 1);
                              const monthEnd = new Date(displayYear, month + 1, 0, 23, 59, 59);
                              if (monthEnd < archiveMin || monthStart > archiveMax) hasMessages = false;
                            }

                            const isSelected = selectedMonths.has(monthKey);
                            const isDisabled = !hasMessages || loadingMonthlyCounts;
                            const baseClasses = [
                              "flex-1 py-2 text-xs font-medium first:rounded-l-md last:rounded-r-md border border-gray-600/80 transition-colors",
                              isSelected && hasMessages ? "bg-blue-600 border-blue-500 text-white shadow-sm" : "",
                              !isSelected && hasMessages ? "text-gray-300 hover:border-blue-500 hover:text-blue-300 hover:bg-blue-500/10" : "",
                              isDisabled ? "text-gray-500 opacity-60 cursor-default border-gray-800" : "",
                            ].filter(Boolean).join(" ");

                            return (
                              <button
                                key={month}
                                type="button"
                                onMouseDown={(e) => {
                                  if (isDisabled) return;
                                  e.preventDefault();
                                  handleMonthDragStart(displayYear, month);
                                }}
                                onMouseEnter={() => {
                                  if (isDisabled) return;
                                  if (isMonthDragging && monthDragMode) handleMonthDrag(displayYear, month);
                                }}
                                onClick={(e) => {
                                  if (isDisabled) return;
                                  if (!isMonthDraggingRef.current) handleMonthClick(displayYear, month, e);
                                }}
                                disabled={isDisabled}
                                className={baseClasses}
                                title={loadingMonthlyCounts ? "Loading month activity..." : hasMessages ? `Click to toggle ${monthName} ${displayYear}. Shift+Click for range. Drag to select multiple.` : "No messages in this month"}
                              >
                                {monthName}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* View by days section + calendars: only when a year is selected */}
              {selectedYear !== null && (
                <>
                    {/* Show calendars only in DAY mode */}
                    {dateViewMode === "days" && selectedMonths.size > 0 && (
                      <div
                        className="flex flex-col gap-0.5"
                        onMouseUp={handleDayDragEnd}
                        onMouseLeave={handleDayDragEnd}
                      >
                        {Array.from(selectedMonths)
                          .sort() // Sort chronologically (YYYY-MM format sorts naturally)
                          .map((monthKey) => {
                            const [yearStr, monthStr] = monthKey.split('-');
                            const year = parseInt(yearStr, 10);
                            const month = parseInt(monthStr, 10) - 1; // Convert back to 0-indexed

                            return (
                              <div
                                key={monthKey}
                                className="w-full first:mt-0 -mt-px"
                              >
                                <DateCalendar
                                  year={year}
                                  month={month}
                                  selectedDates={selectedDates}
                                  onDayClick={handleDayClick}
                                  formatYMD={formatYMD}
                                  getDaysInMonth={getDaysInMonth}
                                  onSelectAll={handleSelectAllInMonth}
                                  onClearMonth={handleClearMonth}
                                  isDragging={isDragging}
                                  dragMode={dragMode}
                                  onDayDragStart={handleDayDragStart}
                                  onDayDrag={handleDayDrag}
                                />
                              </div>
                            );
                          })}
                      </div>
                    )}
                    
                    {/* Show hint when in DAY mode but no months selected */}
                    {dateViewMode === "days" && selectedMonths.size === 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        Select a month above to see its days.
                      </p>
                    )}
                </>
              )}

              {/* Selected Dates Display - only show when zoomed to day level */}
              {zoomLevel === "day" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm text-gray-300">
                      Selected Dates
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectAll();
                        }}
                        className="text-xs text-gray-400 hover:text-blue-300 transition-colors"
                      >
                        Select All
                      </button>
                      {selectedDates.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleClearSelection();
                          }}
                          className="text-xs text-gray-400 hover:text-red-300 transition-colors"
                        >
                          Clear ({selectedDates.length})
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedDates.length > 0 ? (
                    <div className="text-sm text-gray-400">
                      {selectedDates.length} day{selectedDates.length !== 1 ? "s" : ""} selected
                      {selectedDates.length <= 5 && (
                        <span className="ml-2 text-xs text-gray-500">
                          ({selectedDates.map(d => new Date(d).toLocaleDateString()).join(", ")})
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      Click days in the calendar to select. Hold Shift and click to select a range.
                    </p>
                  )}
                </div>
              )}

              {/* Time-of-day filter - only show when single day is selected */}
              {zoomLevel === "day" && selectedDates.length === 1 && (
                <div className="mt-3">
                  <label className="block text-sm text-gray-300 mb-1">
                    Time of day
                  </label>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {[
                      { id: "all", label: "All day" },
                      { id: "morning", label: "Morning (6–11)" },
                      { id: "afternoon", label: "Afternoon (12–17)" },
                      { id: "evening", label: "Evening (18–22)" },
                      { id: "night", label: "Night (23:00)" },
                    ].map((band) => (
                      <button
                        key={band.id}
                        onClick={() => {
                          const newBand = band.id as TimeBand;
                          setTimeBand(newBand);
                          // Use current day + newBand explicitly
                          // Reset to page 1 when changing time band
                          void runSearch({ timeBandOverride: newBand, queryOverride: lastAppliedQuery, resetPage: true });
                        }}
                        className={[
                          "px-3 py-1.5 rounded-full border text-xs transition-colors",
                          timeBand === band.id
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-200 hover:border-blue-500 hover:text-blue-300",
                        ].join(" ")}
                      >
                        {band.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showArchiveContent && savedPins.length > 0 && (
          <div
            className={`${archiveCardStyles.base} p-6 mb-6 space-y-3`}
            style={getEntranceStyle(showLowerReveal, 90)}
          >
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <h3 className="text-sm font-semibold text-gray-200">Pinned searches</h3>
              <input
                type="text"
                value={pinFilter}
                onChange={(e) => setPinFilter(e.target.value)}
                placeholder="Search pinned filters..."
                className="bg-gray-700 text-gray-100 px-3 py-1.5 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm min-w-[200px]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {filteredPins.length === 0 && (
                <span className="text-xs text-gray-500">No pins match that filter.</span>
              )}
              {filteredPins.map((chip) => (
                <div
                  key={chip.id}
                  className="flex items-center gap-1 bg-gray-700 border border-gray-600 rounded-full px-2 py-1 text-xs text-gray-100"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleApplyPin(chip);
                    }}
                    className="flex items-center gap-2 text-left"
                  >
                    <span className="font-semibold">{chip.label}</span>
                    {chip.query && (
                      <span className="text-gray-400 italic">&ldquo;{chip.query}&rdquo;</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemovePin(chip.id);
                    }}
                    className="text-gray-400 hover:text-red-300 transition-colors"
                    title="Remove saved filter"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {showArchiveContent && error && (
          <div
            className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-2 text-red-200 mb-4"
            style={getEntranceStyle(showLowerReveal, 140)}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {showArchiveContent && (
        <div className="space-y-4 isolate" style={getEntranceStyle(showLowerReveal, 180)}>
          <ArchivePaginationControls
            placement="top"
            totalPages={totalPages}
            selectedPageIndex={activePageIndex}
            windowPageIndex={deferredWindowPageIndex}
            totalResults={totalResults}
            loading={loading}
            onPageChange={handlePageChange}
          />

          {loading && results.length === 0 && (
            <div className="min-h-[88px] rounded-xl border border-blue-500/20 bg-card/40 backdrop-blur-sm flex items-center justify-center px-4">
              <div className="flex items-center gap-3 text-center">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-blue-400/30 bg-blue-500/10">
                  <Loader2 className="h-4.5 w-4.5 animate-spin text-blue-300" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-100">Searching archive...</p>
                  <p className="text-xs text-blue-100/55">Loading results</p>
                </div>
              </div>
            </div>
          )}

          {results.length === 0 && !loading && (
            <div className="text-center text-gray-500 py-12">
              {searchQuery || searchTags.length > 0 || roleFilter || sourceFilter || selectedDates.length > 0
                ? "No results found. Try adjusting your filters."
                : "Add a term and click Search to find archived messages."}
            </div>
          )}

          {Array.isArray(messagesOnPage) && messagesOnPage.length > 0 && messagesOnPage.map((message) => {
            const displayText = cleanMessageText(getMsgText(message));
            return (
              <ArchiveMessageCard
                key={message.id}
                message={message}
                variant="search"
                isHighlighted={false}
                isCopied={copiedMessageId === message.id}
                displayText={displayText}
                markdownComponents={searchResultMarkdownComponents}
                enableSyntaxHighlight={displayText.includes("```")}
                onCopy={() => handleCopyMessage(message)}
                onViewContext={() => handleViewContext(message.id)}
                onVault={() => handleVaultMessage(message)}
              />
            );
          })}
          
          {/* Context Overlay - Floating box at top */}
          {(contextResults.length > 0 || contextLoading || contextError) && typeof window !== "undefined" && createPortal(
            <>
              {/* Backdrop */}
              <div
                className="fixed bg-black/50 z-[9999]"
                style={{ 
                  top: 0, 
                  left: 0, 
                  right: 0, 
                  bottom: 0,
                  margin: 0, 
                  padding: 0,
                  width: '100vw',
                  height: '100vh'
                }}
                onClick={clearContext}
              />
              {/* Context Box */}
              <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[10000] w-full max-w-5xl px-4">
              <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-100">Context</h3>
                    {highlightId && (
                      <span className="text-xs text-gray-500">
                        Message #{highlightId} (±{contextWindow} messages)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {contextLoading && (
                      <span className="text-xs text-gray-400">Loading…</span>
                    )}
                    {contextResults.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          expandContext();
                        }}
                        className="text-xs text-gray-400 hover:text-blue-300 transition-colors px-2 py-1"
                        disabled={contextLoading}
                        title="Expand context (double the window)"
                      >
                        Expand
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clearContext();
                      }}
                      className="text-gray-400 hover:text-gray-200 transition-colors text-sm"
                      disabled={contextLoading}
                      title="Close context"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {contextError && (
                  <div className="text-red-400 text-sm p-4 border-b border-gray-700">
                    {contextError}
                  </div>
                )}

                <div 
                  ref={contextScrollRef}
                  className="overflow-y-auto flex-1 p-4 space-y-3"
                >
                  {contextLoading && contextResults.length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-8">
                      Loading context...
                    </div>
                  )}

                  {!contextLoading && contextResults.length === 0 && !contextError && (
                    <div className="text-sm text-gray-500 text-center py-8">
                      No context available
                    </div>
                  )}

                  {contextResults.map((message) => {
                    const displayText = cleanMessageText(getMsgText(message));
                    return (
                      <ArchiveMessageCard
                        key={message.id}
                        message={message}
                        variant="context"
                        isHighlighted={highlightId === message.id}
                        isCopied={copiedMessageId === message.id}
                        displayText={displayText}
                        markdownComponents={searchResultMarkdownComponents}
                        enableSyntaxHighlight={displayText.includes("```")}
                        highlightedRef={highlightedMessageRef}
                        onCopy={() => handleCopyMessage(message)}
                        onCenter={centerHighlightedMessage}
                        onGoToMessage={() => scrollToMessage(message)}
                      />
                    );
                  })}
                </div>
              </div>
              </div>
            </>,
            document.body
          )}
          
          <ArchivePaginationControls
            placement="bottom"
            totalPages={totalPages}
            selectedPageIndex={activePageIndex}
            windowPageIndex={deferredWindowPageIndex}
            totalResults={totalResults}
            loading={loading}
            onPageChange={handlePageChange}
          />
        </div>
        )}

        {/* Vault Modal */}
        <VaultModal
          open={vaultingMessage !== null}
          message={vaultingMessage}
          folders={memoryFolders}
          forceUntitledTitle={scope?.kind === "guest"}
          onClose={closeVaultModal}
          onSave={handleVaultSave}
          saving={savingMessageId === vaultingMessage?.id}
          error={saveError}
        />
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default function ArchivePage() {
  // `useSearchParams()` triggers a CSR bailout during static prerender; wrap in Suspense per Next.js.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
          <div className="text-sm text-gray-400">Loading archive...</div>
        </div>
      }
    >
      <ArchivePageInner />
    </Suspense>
  );
}
