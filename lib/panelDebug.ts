type PanelDebugPayload = Record<string, unknown>;

const MAX_ENTRIES = 400;

export function panelDebug(source: string, event: string, payload: PanelDebugPayload = {}) {
  if (process.env.NODE_ENV !== "development") return;
  if (typeof window === "undefined") return;

  const nowMs = Date.now();
  const entry = {
    source,
    event,
    at: new Date(nowMs).toISOString(),
    ...payload,
  };

  const debugWindow = window as any;
  if (!Array.isArray(debugWindow.__dbPanelDebug)) {
    debugWindow.__dbPanelDebug = [];
  }

  const list = debugWindow.__dbPanelDebug as Array<Record<string, unknown>>;
  list.push(entry);
  if (list.length > MAX_ENTRIES) {
    list.splice(0, list.length - MAX_ENTRIES);
  }

  // Keep logs easy to filter in DevTools console.
  console.debug("[PANEL_DEBUG]", entry);
}

