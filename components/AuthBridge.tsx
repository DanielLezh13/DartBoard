"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  clearGuestSessionStorage,
  logSessionStorageKeysPresent,
} from "@/lib/guest-keys";
import {
  resetGuestId,
  getOrCreateGuestIdFromSessionStorage,
} from "@/lib/guest";

export function AuthBridge({
  onAuthBoundary,
}: {
  onAuthBoundary?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const prevSessionRef = useRef<Session | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const prevSession = prevSessionRef.current;
      prevSessionRef.current = session;

      if (event === "TOKEN_REFRESHED") {
        return;
      }

      if (event === "INITIAL_SESSION") {
        return;
      }

      if (event === "SIGNED_OUT") {
        // Ignore bootstrap SIGNED_OUT noise when there was never a signed-in session.
        if (prevSession === undefined) {
          return;
        }
        const hadSession = prevSession != null && prevSession.user != null;
        if (!hadSession) {
          return;
        }
        const prevUserId = prevSession?.user?.id ?? null;
        const appearanceKey = "dartboard.folderAppearance.v1";
        resetGuestId();
        clearGuestSessionStorage();
        // Ensure next sign-in starts on landing even if SIGNED_IN boundary
        // callback is skipped (e.g., OAuth/redirect bootstrap INITIAL_SESSION path).
        try {
          if (typeof window !== "undefined" && prevUserId) {
            sessionStorage.setItem(`db:userLanding:${prevUserId}`, "1");
            sessionStorage.removeItem(`db:lastSession:${prevUserId}`);
          }
        } catch {
          // ignore
        }
        try {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(appearanceKey);
          }
        } catch {
          // ignore
        }
        getOrCreateGuestIdFromSessionStorage();
        onAuthBoundary?.();
        router.refresh();
        return;
      }

      if (event === "SIGNED_IN") {
        // Some clients emit SIGNED_IN as an initial bootstrap event on mount.
        // Treat only explicit auth-boundary transitions (prev known and no prior session)
        // as "fresh sign-in" so refreshes don't repeatedly force reset state.
        if (prevSession === undefined) {
          return;
        }
        const hadSession = prevSession != null && prevSession.user != null;
        if (hadSession) {
          return;
        }
        try {
          if (typeof window !== "undefined" && session?.user?.id) {
            sessionStorage.setItem("db:freshSignedInEntry", "1");
            sessionStorage.setItem(`db:userLanding:${session.user.id}`, "1");
            sessionStorage.removeItem(`db:lastSession:${session.user.id}`);
          }
        } catch {
          // ignore
        }
        const appearanceKey = "dartboard.folderAppearance.v1";
        logSessionStorageKeysPresent("before clear");
        clearGuestSessionStorage();
        logSessionStorageKeysPresent("after clear");
        let appearanceIdsCount = 0;
        try {
          const raw = typeof window !== "undefined" ? window.localStorage.getItem(appearanceKey) : null;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") appearanceIdsCount = Object.keys(parsed).length;
          }
        } catch {
          // ignore
        }
        onAuthBoundary?.();
        router.refresh();
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [router, pathname, onAuthBoundary]);

  return null;
}
