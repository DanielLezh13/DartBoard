"use client";

import { useEffect, useState } from "react";
import { AuthBridge } from "./AuthBridge";
import { AuthEpochProvider } from "@/lib/auth-epoch-context";
import { UI_THEME_CHANGE_EVENT, UI_THEME_STORAGE_KEY, applyDocumentUiTheme, getStoredUiTheme, resolveUiTheme } from "@/lib/uiTheme";

export function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authEpoch, setAuthEpoch] = useState(0);

  useEffect(() => {
    applyDocumentUiTheme(getStoredUiTheme());

    const onStorage = (event: StorageEvent) => {
      if (event.key !== UI_THEME_STORAGE_KEY) return;
      applyDocumentUiTheme(resolveUiTheme(event.newValue));
    };

    const onThemeChange = (event: Event) => {
      const custom = event as CustomEvent<string>;
      applyDocumentUiTheme(resolveUiTheme(custom.detail));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(UI_THEME_CHANGE_EVENT, onThemeChange as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UI_THEME_CHANGE_EVENT, onThemeChange as EventListener);
    };
  }, []);

  return (
    <AuthEpochProvider value={authEpoch}>
      <div id="db-theme-root" className="min-h-screen bg-background">
        <AuthBridge onAuthBoundary={() => setAuthEpoch((e) => e + 1)} />
        {children}
      </div>
    </AuthEpochProvider>
  );
}
