"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useScope } from "@/hooks/useScope";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { IconSettings, IconUser } from "@tabler/icons-react";
import {
  UI_THEME_PICKER_ENABLED,
  applyDocumentUiTheme,
  getStoredUiTheme,
  setStoredUiTheme,
  type UiTheme,
} from "@/lib/uiTheme";

const verbosityOptions = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
];

const settingsCardClassName =
  "group relative overflow-hidden rounded-xl border border-blue-500/30 bg-card/60 backdrop-blur-md transition-all duration-300";

interface Profile {
  id: number;
  display_name: string | null;
  style: string | null;
  preferences: string | null;
  core_spec: string;
  personal_context?: string | null;
}

let cachedUserProfile: Profile | null = null;
let profileCacheScope: string | null = null;
let profileFetchInFlight: Promise<Profile> | null = null;

type ScopeLike =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string }
  | null
  | undefined;

const toScopeCacheKey = (scope: ScopeLike): string =>
  scope
    ? scope.kind === "user"
      ? `user:${scope.userId}`
      : `guest:${scope.guestId}`
    : "none";

const fetchProfileFromApi = async (): Promise<Profile> => {
  const response = await fetch("/api/profile");
  if (!response.ok) {
    throw new Error("Failed to fetch profile");
  }
  const data = await response.json();
  return data as Profile;
};

const getProfileWithCache = async (scopeCacheKey: string): Promise<Profile> => {
  let profilePromise = profileFetchInFlight;
  if (!profilePromise) {
    profilePromise = fetchProfileFromApi();
    profileFetchInFlight = profilePromise;
  }
  try {
    const data = await profilePromise;
    cachedUserProfile = data;
    profileCacheScope = scopeCacheKey;
    return data;
  } finally {
    if (profileFetchInFlight === profilePromise) {
      profileFetchInFlight = null;
    }
  }
};

export async function prefetchProfileForScope(scope: ScopeLike): Promise<void> {
  if (!scope || scope.kind !== "user") return;
  const scopeCacheKey = toScopeCacheKey(scope);
  if (cachedUserProfile && profileCacheScope === scopeCacheKey) return;
  await getProfileWithCache(scopeCacheKey);
}

type ProfileViewProps = {
  embedded?: boolean;
  onClose?: () => void;
};

export function ProfileView({ embedded = false, onClose }: ProfileViewProps) {
  const { scope } = useScope();
  const [profile, setProfile] = useState<Profile>({
    id: 1,
    display_name: null,
    style: "balanced", // Default to balanced
    preferences: null,
    core_spec: "",
    personal_context: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiTheme, setUiTheme] = useState<UiTheme>("brand");
  const [isResponseDetailOpen, setIsResponseDetailOpen] = useState(false);
  const savedResetTimeoutRef = useRef<number | null>(null);
  const saveLockRef = useRef(false);
  const responseDetailDropdownRef = useRef<HTMLDivElement | null>(null);

  const isGuest = scope?.kind === "guest";
  const scopeCacheKey = toScopeCacheKey(scope as ScopeLike);
  const isSavedState = saved && !saving;
  const isSaveLocked = isGuest || saving || saved;
  const loadProfile = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        setError(null);
        const data = await getProfileWithCache(scopeCacheKey);
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [scopeCacheKey]
  );

  useEffect(() => {
    return () => {
      if (savedResetTimeoutRef.current != null) {
        window.clearTimeout(savedResetTimeoutRef.current);
        savedResetTimeoutRef.current = null;
      }
      saveLockRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!scope) return;
    if (scope.kind === "guest") {
      setLoading(false);
      setError(null);
      cachedUserProfile = null;
      profileCacheScope = null;
      return;
    }
    if (cachedUserProfile && profileCacheScope === scopeCacheKey) {
      setProfile(cachedUserProfile);
      setLoading(false);
      setError(null);
      void loadProfile(true);
      return;
    }
    void loadProfile(false);
  }, [loadProfile, scope, scopeCacheKey]);

  useEffect(() => {
    const storedTheme = getStoredUiTheme();
    setUiTheme(storedTheme);
    applyDocumentUiTheme(storedTheme);
  }, []);

  useEffect(() => {
    if (!isResponseDetailOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!responseDetailDropdownRef.current) return;
      if (!responseDetailDropdownRef.current.contains(event.target as Node)) {
        setIsResponseDetailOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResponseDetailOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isResponseDetailOpen]);

  const handleSave = async () => {
    if (isGuest || saveLockRef.current) return;
    saveLockRef.current = true;
    try {
      setSaving(true);
      setError(null);
      setSaved(false);

      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: profile.display_name || null,
          style: profile.style || null,
          preferences: profile.preferences || null,
          core_spec: profile.core_spec || null,
          personal_context: profile.personal_context || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save profile");
      }

      const data = await response.json();
      setProfile(data);
      cachedUserProfile = data;
      profileCacheScope = scopeCacheKey;
      setSaved(true);
      if (savedResetTimeoutRef.current != null) {
        window.clearTimeout(savedResetTimeoutRef.current);
      }
      savedResetTimeoutRef.current = window.setTimeout(() => {
        setSaved(false);
        saveLockRef.current = false;
        savedResetTimeoutRef.current = null;
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
      saveLockRef.current = false;
    } finally {
      setSaving(false);
    }
  };

  const handleThemeSelect = (theme: UiTheme) => {
    setUiTheme(theme);
    setStoredUiTheme(theme);
  };

  if (loading && !isGuest) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0d1525] via-[#0e1628] to-[#0d1525] text-gray-100 flex items-center justify-center">
        {!embedded && (
          <div className="text-center">
            <p className="text-xl text-gray-400">Loading configuration...</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#0d1525] via-[#0e1628] to-[#0d1525] text-gray-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 -top-24 h-56 bg-gradient-to-b from-blue-500/14 via-blue-500/5 to-transparent" />
        <div className="absolute -left-32 top-20 h-72 w-72 rounded-full bg-blue-500/12 blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 h-12 border-b border-blue-500/30 bg-slate-900/80 backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)]">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="w-1/3 flex items-center justify-start">
            {embedded ? (
              <button
                type="button"
                onClick={() => onClose?.()}
                className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-sm text-gray-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-white/[0.10] focus:outline-none"
              >
                ← Back to Chat
              </button>
            ) : (
              <Link
                href="/"
                className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-sm text-gray-100 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-white/[0.10] focus:outline-none"
              >
                ← Back to Chat
              </Link>
            )}
          </div>
          <div className="w-1/3 flex items-center justify-center gap-2">
            <IconSettings size={18} className="text-sky-300/90" />
            <h1 className="text-lg font-semibold leading-tight text-gray-200">Assistant Settings</h1>
          </div>
          <div className="w-1/3 flex items-center justify-end">
            {UI_THEME_PICKER_ENABLED && (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1.5 backdrop-blur-md">
                <span className="hidden md:inline text-[11px] uppercase tracking-[0.14em] text-gray-400">Theme</span>

                <button
                  type="button"
                  onClick={() => handleThemeSelect("brand")}
                  className={
                    "group relative h-7 w-7 rounded-full border transition-all duration-200 " +
                    (uiTheme === "brand"
                      ? "border-white/65 ring-2 ring-white/35 scale-105"
                      : "border-white/20 hover:border-white/40")
                  }
                  aria-label="Use Blue and Purple theme"
                  title="Blue and Purple theme"
                >
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-purple-500" />
                  <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.45),transparent_50%)] opacity-80" />
                  <span className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[conic-gradient(from_90deg_at_50%_50%,rgba(255,255,255,0.2),transparent_35%,rgba(255,255,255,0.16),transparent_70%,rgba(255,255,255,0.2))] animate-[spin_3.8s_linear_infinite]" />
                </button>

                <button
                  type="button"
                  onClick={() => handleThemeSelect("mono")}
                  className={
                    "group relative h-7 w-7 rounded-full border transition-all duration-200 " +
                    (uiTheme === "mono"
                      ? "border-white/65 ring-2 ring-white/35 scale-105"
                      : "border-white/20 hover:border-white/40")
                  }
                  aria-label="Use Black, Gray, and White theme"
                  title="Black, Gray, and White theme"
                >
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-zinc-50 via-zinc-500 to-zinc-900" />
                  <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.55),transparent_48%)] opacity-80" />
                  <span className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[conic-gradient(from_90deg_at_50%_50%,rgba(255,255,255,0.18),transparent_35%,rgba(255,255,255,0.14),transparent_70%,rgba(255,255,255,0.18))] animate-[spin_4.4s_linear_infinite]" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className={`relative z-10 mx-auto w-full max-w-[1460px] px-6 ${isGuest ? "pt-4 pb-6" : "py-8"}`}>
        {isGuest ? (
          <div className="flex flex-col items-center justify-center pt-4 pb-12">
            <div className="max-w-sm w-full mx-auto rounded-xl border border-blue-500/25 bg-slate-900/55 text-slate-200 px-4 py-3 text-sm text-center backdrop-blur-md shadow-[0_12px_26px_rgba(0,0,0,0.35)]">
              Sign in to set up your profile.
            </div>
          </div>
        ) : error ? (
          <div className="max-w-3xl mx-auto bg-red-900/20 border border-red-800/50 text-red-200 px-4 py-3 rounded-xl text-sm backdrop-blur-md">
            {error}
          </div>
        ) : null}

        {/* Two Column Layout for Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Identity Section */}
          <section className={settingsCardClassName}>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
            <IconUser size={32} className="absolute top-6 right-6 text-blue-300/90 rounded-lg z-10" />
            <div className="relative p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-6">Identity</h2>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-100">
                    Display Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={profile.display_name || ""}
                      onChange={(e) => {
                        if (!isGuest && e.target.value.length <= 32) {
                          setProfile({ ...profile, display_name: e.target.value })
                        }
                      }}
                      maxLength={32}
                      placeholder="How the assistant should address you"
                      disabled={isGuest}
                      className="w-full bg-[#101a2f]/75 text-gray-100 rounded-lg px-4 py-2 pr-16 border border-blue-400/25 focus:outline-none focus:ring-2 focus:ring-blue-400/55 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <div className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs pointer-events-none ${
                      (profile.display_name?.length || 0) >= 28 ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                      {profile.display_name?.length || 0} / 32
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Optional. Used in greetings and personalization.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-100">
                    What Dartboard should know about me
                  </label>
                  <div className="bg-[#101a2f]/75 rounded-lg border border-blue-400/25 focus-within:ring-2 focus-within:ring-blue-400/55 focus-within:border-transparent">
                    <textarea
                      value={profile.personal_context || ""}
                      onChange={(e) => {
                        if (!isGuest && e.target.value.length <= 500) {
                          setProfile({ ...profile, personal_context: e.target.value })
                        }
                      }}
                      maxLength={500}
                      placeholder="Share relevant context about yourself, your work, preferences, or background that might help the assistant better understand and serve your needs..."
                      rows={8}
                      disabled={isGuest}
                      className="w-full bg-transparent text-gray-100 rounded-t-lg px-4 py-2 border-0 focus:outline-none resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <div className="flex justify-end px-3 pb-2">
                      <span className={`text-xs ${
                        (profile.personal_context?.length || 0) >= 450 ? 'text-gray-300' : 'text-gray-500'
                      }`}>
                        {profile.personal_context?.length || 0} / 500
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Personal context helps the assistant tailor responses to you.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Behavioral Preferences Section */}
          <section className={settingsCardClassName}>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-100 transition-opacity duration-300 group-hover:opacity-100 rounded-xl pointer-events-none" />
            <svg className="absolute top-6 right-6 w-8 h-8 text-blue-300/90 rounded-lg z-10" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M300 328a60 60 0 1 0 120 0 60 60 0 1 0-120 0zM852 64H172c-17.7 0-32 14.3-32 32v660c0 17.7 14.3 32 32 32h680c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32zm-32 660H204V128h616v596zM604 328a60 60 0 1 0 120 0 60 60 0 1 0-120 0zm250.2 556H169.8c-16.5 0-29.8 14.3-29.8 32v36c0 4.4 3.3 8 7.4 8h729.1c4.1 0 7.4-3.6 7.4-8v-36c.1-17.7-13.2-32-29.7-32zM664 508H360c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 8h304c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8z"/>
            </svg>
            <div className="relative p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-6">Behavioral Preferences</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-100 mb-2">
                    Response Detail
                  </label>
                  <div className="relative" ref={responseDetailDropdownRef}>
                    <button
                      type="button"
                      onClick={() => !isGuest && setIsResponseDetailOpen((open) => !open)}
                      disabled={isGuest}
                      aria-haspopup="listbox"
                      aria-expanded={isResponseDetailOpen}
                      aria-label="Response Detail"
                      className="w-full bg-[#101a2f]/75 text-gray-100 rounded-lg px-4 py-2 pr-10 border border-blue-400/25 focus:outline-none focus:ring-2 focus:ring-blue-400/55 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed text-left"
                    >
                      {verbosityOptions.find((option) => option.value === (profile.style || "balanced"))?.label ?? "Balanced"}
                    </button>
                    <ChevronDownIcon
                      className={
                        "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-transform " +
                        (isResponseDetailOpen ? "rotate-180" : "")
                      }
                    />
                    {isResponseDetailOpen && !isGuest ? (
                      <div
                        role="listbox"
                        aria-label="Response Detail options"
                        className="absolute left-0 right-0 top-full mt-2 z-30 rounded-lg border border-slate-700/35 bg-[#0f1a31] shadow-[0_10px_24px_rgba(0,0,0,0.38)] backdrop-blur-sm overflow-hidden"
                      >
                        {verbosityOptions.map((option) => {
                          const isSelected = (profile.style || "balanced") === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setProfile({ ...profile, style: option.value });
                                setIsResponseDetailOpen(false);
                              }}
                              className={
                                "w-full text-left px-4 py-2 text-sm transition-colors " +
                                (isSelected
                                  ? "bg-blue-500/15 text-blue-100"
                                  : "text-gray-200 hover:bg-slate-700/45")
                              }
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                <p className="text-xs text-gray-400 mt-2">
                  Controls how verbose responses are.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-100 mb-2">
                  Behavioral Guidelines
                </label>
                <div className="bg-[#101a2f]/75 rounded-lg border border-blue-400/25 focus-within:ring-2 focus-within:ring-blue-400/55 focus-within:border-transparent">
                    <textarea
                      value={profile.preferences || ""}
                      onChange={(e) => {
                        if (!isGuest && e.target.value.length <= 700) {
                          setProfile({ ...profile, preferences: e.target.value })
                        }
                      }}
                      maxLength={700}
                      placeholder="Specify response patterns, domain expertise, interaction preferences, context handling rules, output formatting requirements..."
                      rows={8}
                      disabled={isGuest}
                      className="w-full bg-transparent text-gray-100 rounded-t-lg px-4 py-2 border-0 focus:outline-none resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  <div className="flex justify-end px-3 pb-2">
                    <span className={`text-xs ${
                      (profile.preferences?.length || 0) >= 630 ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                      {profile.preferences?.length || 0} / 700
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Guidelines shape the assistant&apos;s behavior. More specific = better adherence.
                </p>
              </div>
            </div>
            </div>
          </section>
        </div>

        {/* Save Button */}
        <div className="relative flex justify-center pt-8">
          <button
            onClick={handleSave}
            disabled={isGuest}
            aria-disabled={isSaveLocked}
            className={
              "group relative inline-flex h-10 scale-[1.03] items-center justify-center overflow-hidden rounded-full px-8 text-sm font-medium shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all duration-250 ease-out active:scale-[0.96] disabled:opacity-50 " +
              (isSaveLocked ? "pointer-events-none " : "") +
              (isSavedState
                ? "border border-emerald-400/45 bg-emerald-500/20 text-emerald-100"
                : "border border-blue-400/35 bg-blue-500/20 text-blue-100")
            }
          >
            <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/8 to-transparent" />
            <span className="relative z-10 inline-flex h-5 min-w-[118px] items-center justify-center">
              <span
                className={
                  "absolute transition-all duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  (saved
                    ? "opacity-0 scale-95 -translate-y-1 pointer-events-none"
                    : "opacity-100 scale-100 translate-y-0")
                }
              >
                Save Settings
              </span>
              <span
                className={
                  "absolute transition-all duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] " +
                  (saved && !saving
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-95 translate-y-1 pointer-events-none")
                }
              >
                Saved
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
