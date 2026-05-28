"use client";

import { useAuthEpoch } from "@/lib/auth-epoch-context";

/**
 * Wraps the chat page so it remounts on auth boundary (SIGNED_IN/SIGNED_OUT).
 * Key change forces React to unmount and remount the page, resetting all hook state.
 */
export function ChatRouteKeyWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const authEpoch = useAuthEpoch();
  return (
    <div key={`auth-${authEpoch}`} className="h-full w-full">
      {children}
    </div>
  );
}
