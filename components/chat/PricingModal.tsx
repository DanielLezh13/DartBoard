"use client";

import { Check, X } from "lucide-react";
import type { PlanLimits, UserPlan } from "@/lib/planLimits";

type PricingModalProps = {
  isOpen: boolean;
  currentPlan: UserPlan;
  freeLimits: PlanLimits;
  plusLimits: PlanLimits;
  billingActionLoading?: boolean;
  onClose: () => void;
  onPurchasePlus?: () => void;
  onManageBilling?: () => void;
};

type DisplayableLimitKey =
  | "model"
  | "dailyTokenBudget"
  | "maxSessionTokens"
  | "maxSessions"
  | "maxMemories"
  | "maxChatSessionFolders"
  | "maxMemoryFolders"
  | "maxImageUploadsPerDay"
  | "maxAttachedMemoriesPerSession"
  | "maxAttachedMemoryTokensPerSession"
  | "webSearchesPerDay";

type FeatureRow = {
  label: string;
  key: DisplayableLimitKey;
  suffix?: string;
};

const FEATURE_ROWS: FeatureRow[] = [
  { label: "Model", key: "model" },
  { label: "Daily tokens", key: "dailyTokenBudget" },
  { label: "Session token cap", key: "maxSessionTokens" },
  { label: "Sessions", key: "maxSessions" },
  { label: "Memories", key: "maxMemories" },
  { label: "Chat folders", key: "maxChatSessionFolders" },
  { label: "Memory folders", key: "maxMemoryFolders" },
  { label: "Image uploads/day", key: "maxImageUploadsPerDay" },
  { label: "Attached memories/session", key: "maxAttachedMemoriesPerSession" },
  { label: "Attached memory budget", key: "maxAttachedMemoryTokensPerSession", suffix: " tokens" },
  { label: "Web searches/day", key: "webSearchesPerDay" },
];
const PLUS_PRICE_LABEL = "$12/mo";

function formatLimitValue(value: string | number) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Unlimited";
    return value.toLocaleString();
  }
  return value;
}

export function PricingModal({
  isOpen,
  currentPlan,
  freeLimits,
  plusLimits,
  billingActionLoading = false,
  onClose,
  onPurchasePlus,
  onManageBilling,
}: PricingModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto overscroll-contain touch-pan-y bg-black/60 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4 sm:items-center sm:p-6">
      <div className="relative my-4 w-full max-w-4xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden sm:my-0">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500" />

        <button
          type="button"
          onClick={onClose}
          className="absolute top-6 right-6 z-10 text-slate-400 hover:text-white transition-colors"
          aria-label="Close pricing modal"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="p-8 md:p-10">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Upgrade to Plus
            </h2>
            <p className="text-slate-400 text-base">Compare plans and unlock higher limits.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-2xl font-bold text-white">Free</h3>
                <div className="px-3 py-1 bg-slate-700/50 rounded-full text-sm text-slate-300">
                  {currentPlan === "free" ? "Current Plan" : "Available"}
                </div>
              </div>

              <div className="space-y-3">
                {FEATURE_ROWS.map((feature) => {
                  const value = freeLimits[feature.key];
                  return (
                    <div key={feature.key} className="flex justify-between items-start gap-3">
                      <span className="text-slate-400 text-sm">{feature.label}:</span>
                      <span className="text-white text-sm font-medium text-right">
                        {formatLimitValue(value)}
                        {feature.suffix ?? ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative bg-gradient-to-br from-blue-600/20 to-purple-600/20 rounded-xl p-6 border border-blue-500/50 backdrop-blur-sm shadow-xl shadow-blue-500/20">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <h3 className="text-2xl font-bold text-white">Plus</h3>
                  <div className="text-sm font-semibold text-blue-200/90">{PLUS_PRICE_LABEL}</div>
                </div>
                <div className="px-3 py-1 bg-blue-500/20 rounded-full text-sm text-blue-300 border border-blue-500/30">
                  {currentPlan === "plus" ? "Current Plan" : "Recommended"}
                </div>
              </div>

              <div className="space-y-3">
                {FEATURE_ROWS.map((feature) => {
                  const value = plusLimits[feature.key];
                  const isUnlimited = typeof value === "number" && !Number.isFinite(value);
                  return (
                    <div key={feature.key} className="flex justify-between items-start gap-3">
                      <span className="text-slate-300 text-sm">{feature.label}:</span>
                      <div className="flex items-center gap-1.5">
                        {isUnlimited ? <Check className="w-4 h-4 text-green-400" /> : null}
                        <span className="text-white text-sm font-medium text-right">
                          {formatLimitValue(value)}
                          {feature.suffix ?? ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            {currentPlan === "plus" && onManageBilling ? (
              <button
                type="button"
                onClick={onManageBilling}
                disabled={billingActionLoading}
                className="group relative inline-flex h-11 items-center rounded-full border border-blue-400/30 px-8 text-sm font-semibold text-blue-200 transition-all duration-300 ease-out hover:scale-105 hover:border-blue-400/45 hover:text-blue-100 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{
                  background:
                    "linear-gradient(to right, rgba(37, 99, 235, 0.24), rgba(99, 102, 241, 0.22), rgba(139, 92, 246, 0.2)), rgb(30, 36, 56)",
                  boxShadow: "0px 6px 18px rgba(0,0,0,0.28)",
                }}
              >
                <span className="relative z-10">{billingActionLoading ? "Opening billing..." : "Manage Billing"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPurchasePlus}
                disabled={billingActionLoading || !onPurchasePlus}
                className="group relative inline-flex h-11 items-center rounded-full border border-blue-400/30 px-8 text-sm font-semibold text-blue-200 transition-all duration-300 ease-out hover:scale-105 hover:border-blue-400/45 hover:text-blue-100 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{
                  background:
                    "linear-gradient(to right, rgba(37, 99, 235, 0.24), rgba(99, 102, 241, 0.22), rgba(139, 92, 246, 0.2)), rgb(30, 36, 56)",
                  boxShadow: "0px 6px 18px rgba(0,0,0,0.28)",
                }}
              >
                <span className="relative z-10">
                  {billingActionLoading ? "Starting checkout..." : `Purchase Plus - ${PLUS_PRICE_LABEL}`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
