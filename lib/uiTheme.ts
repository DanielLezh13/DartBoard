export type UiTheme = "brand" | "mono";

export const UI_THEME_STORAGE_KEY = "db:uiTheme";
export const UI_THEME_CHANGE_EVENT = "db:ui-theme-change";
export const DEFAULT_UI_THEME: UiTheme = "brand";
export const UI_THEME_PICKER_ENABLED = process.env.NEXT_PUBLIC_ENABLE_UI_THEME_PICKER === "1";

export const isUiTheme = (value: unknown): value is UiTheme =>
  value === "brand" || value === "mono";

export const resolveUiTheme = (value: unknown): UiTheme => {
  const candidate = isUiTheme(value) ? value : DEFAULT_UI_THEME;
  return UI_THEME_PICKER_ENABLED ? candidate : DEFAULT_UI_THEME;
};

export const applyDocumentUiTheme = (theme: UiTheme) => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-ui-theme", theme);
  if (document.body) {
    document.body.setAttribute("data-ui-theme", theme);
  }
};

export const getStoredUiTheme = (): UiTheme => {
  if (typeof window === "undefined") return DEFAULT_UI_THEME;
  try {
    return resolveUiTheme(window.localStorage.getItem(UI_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_THEME;
  }
};

export const setStoredUiTheme = (theme: UiTheme) => {
  const resolvedTheme = resolveUiTheme(theme);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(UI_THEME_STORAGE_KEY, resolvedTheme);
    } catch {
      // ignore storage failures
    }
    window.dispatchEvent(new CustomEvent(UI_THEME_CHANGE_EVENT, { detail: resolvedTheme }));
  }
  applyDocumentUiTheme(resolvedTheme);
};
