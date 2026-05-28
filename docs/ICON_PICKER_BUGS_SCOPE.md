# Icon picker bugs – read-only scope

**Rules:** READ ONLY. No fixes implemented. Root-cause hypotheses, exact file/line suspects, 3 falsifiable repro tests per bug, minimal fix options.

---

## BUG 1: Guest folder icon editing corrupts state after sign-out (left rail)

### Repro target
1. Sign in → sign out (becomes guest).
2. Create 2–3 chat folders (left rail).
3. Change icon on one folder.

**Observed:** Icon change affects multiple folders / selection weirdness.

**Goal:** Find why folder icon state is shared across items.

---

### Investigation (trace end-to-end)

- **Where folder icons are displayed (left rail):**  
  **Appearance override map**, not raw `folder.icon` alone. Display uses `folderAppearance[folder.id]?.icon ?? folder.icon` (FolderRail.tsx **854**). So left rail uses an **appearance override map** keyed by folder id, with fallback to `folder.icon`.

- **Where the appearance override map is stored:**  
  - **localStorage:** `dartboard.folderAppearance.v1` — read in `loadFolderAppearance()` (FolderRail.tsx **377–389**), written in save effect (**636–659**). Single global key, not cleared on auth.  
  - **sessionStorage:** `db:folders` (guest folder list), `db:selectedFolderId` (selected folder). Cleared in `clearGuestSessionStorage()` (guest-keys.ts **26–35**). Appearance is **not** in sessionStorage.

- **List rendering keys:**  
  Folder list uses **stable key** `key={\`folder-${folder.id}\`}` (FolderRail.tsx **838**). Not array index. Confirmed.

- **Updates per-folder:**  
  Icon picker updates a **single** key: `setFolderAppearance(prev => ({ ...prev, [subMenu.folderId!]: { ...prev[subMenu.folderId!], icon } }))` (e.g. **1196–1202**). No shared object reference mutation; each update is per `subMenu.folderId`.

**Findings:**
- **Is `dartboard.folderAppearance.v1` global across guest/user and not cleared on auth boundary?**  
  **Yes.** It is a single localStorage key. `clearGuestSessionStorage()` (guest-keys.ts **26–35**) clears only `AUTH_BOUNDARY_SESSION_KEYS` (sessionStorage). localStorage is never cleared on auth boundary.
- **Is it keyed only by numeric folder ids that can collide across guests (1,2,3) causing “all folders change” after sign-out?**  
  **Yes.** The map is `Record<number, { label?, icon?, color? }>`. New guest’s folders get numeric ids (e.g. 1, 2, 3); `loadFolderAppearance()` loads the previous guest’s map; ids 1,2,3 from the old guest apply to the new guest’s folders 1,2,3 → wrong icons / “all folders change” appearance.

---

### Trace: FolderRail → icon picker → update handler → persistence → re-render

| Step | File:lines | What happens |
|------|------------|--------------|
| 1 | FolderRail.tsx **838, 853–854** | List `key={\`folder-${folder.id}\`}`; display `folderAppearance[folder.id]?.icon ?? folder.icon`. |
| 2 | FolderRail.tsx **1155–1202** (icon grid) | `onSetFolderIcon(subMenu.folderId!, icon)` + `setFolderAppearance(prev => ({ ...prev, [subMenu.folderId!]: { ... } }))`. |
| 3 | app/chat/page.tsx **2570–2587** | `handleSetFolderIcon(id, icon)` PATCH `/api/folders`, then `setFolders(prev => prev.map(...))`. |
| 4 | FolderRail.tsx **374–396, 636–659** | Load from / save to **localStorage** `dartboard.folderAppearance.v1`. |
| 5 | lib/guest-keys.ts **26–35** | `clearGuestSessionStorage()` clears **sessionStorage** only; `dartboard.folderAppearance.v1` never cleared. |

---

### Most likely root cause (Bug 1)

**Storage map collision:** `dartboard.folderAppearance.v1` is a **single global localStorage key**, not cleared on auth boundary (lib/guest-keys.ts **26–35** only clear sessionStorage). It is keyed only by numeric folder id. After sign-out, the new guest’s folders get ids 1, 2, 3 again; `loadFolderAppearance()` (FolderRail.tsx **376–389**) loads the previous guest’s id→icon map, so new guest’s folders 1, 2, 3 show the old guest’s icons. Prune effect (FolderRail.tsx **662–722**) only removes keys for folder ids not in the current list; it does not clear by scope, so overlapping ids keep old values → “multiple folders change” / selection weirdness.

---

### Exact file/line suspects (Bug 1)

| File | Lines | Role |
|------|--------|------|
| **lib/guest-keys.ts** | **26–35** | `clearGuestSessionStorage()` clears only sessionStorage; `dartboard.folderAppearance.v1` (localStorage) never cleared. |
| **components/chat/FolderRail.tsx** | **374** | `FOLDER_APPEARANCE_LS_KEY = "dartboard.folderAppearance.v1"` (single global key). |
| **components/chat/FolderRail.tsx** | **376–389** | `loadFolderAppearance()` reads from localStorage; no scope in key. |
| **components/chat/FolderRail.tsx** | **395–396** | Initial state `useState(() => loadFolderAppearance())` — loads old guest data on new guest mount. |
| **components/chat/FolderRail.tsx** | **636–659** | Save effect: persist `folderAppearance` to same global key. |
| **components/chat/FolderRail.tsx** | **662–722** | Prune effect: removes keys not in `validIds`; does not clear on auth, so id collision keeps old values. |
| **components/chat/FolderRail.tsx** | **838, 853–854** | List key `folder-${folder.id}` (correct); display `folderAppearance[folder.id]?.icon ?? folder.icon`. |
| **hooks/useChatSessions.ts** | **132, 273, 286, 298, 320, 343, 589, 608–609, 638–639, 700** | Guest folders: `db:folders` / `db:selectedFolderId` read/written; selection restored from sessionStorage (cleared on boundary). Appearance is separate (localStorage). |

---

### Three falsifiable repro tests (Bug 1)

1. **After sign-out, localStorage still has old appearance**  
   Sign in → create left-rail folder → set icon “heart” → confirm `dartboard.folderAppearance.v1` in DevTools Application → Local Storage contains that id. Sign out (no refresh). **Falsifiable:** Key is removed or empty. If key still contains previous guest’s id→icon map, hypothesis supported.

2. **New guest folders 1/2/3 already show old guest’s icons**  
   As guest A: create two folders (ids 1, 2), set 1=heart, 2=pin. Sign out. As new guest B: create two folders (ids 1, 2). **Falsifiable:** B’s folders show default until B edits. If B’s folders 1 and 2 already show heart/pin, collision confirmed.

3. **Manual delete of key removes the bug**  
   Reproduce bug (sign out, new guest, wrong icons). Manually delete `dartboard.folderAppearance.v1` in DevTools → Application → Local Storage. Reload or re-open left rail. **Falsifiable:** Bug persists. If bug disappears after delete, storage key is the cause.

---

### Minimal fix options (Bug 1, do not implement)

- Clear `dartboard.folderAppearance.v1` on auth boundary (SIGNED_IN / SIGNED_OUT).
- Or scope appearance key by identity: `dartboard.folderAppearance.v1.<scopeKind>.<scopeId>`.
- If selection weirdness persists, also clear selection keys (e.g. `db:selectedFolderId`) on auth boundary — already in `AUTH_BOUNDARY_SESSION_KEYS` (guest-keys.ts **9**), so confirm it is actually cleared and not re-read from stale state.

---

### Recommended console logs (Bug 1)

- After sign-out (e.g. AuthBridge / clearGuestSessionStorage):  
  `console.log('[AUTH_BOUNDARY] localStorage', ['dartboard.folderAppearance.v1'].map(k => [k, !!localStorage.getItem(k)]));`
- FolderRail `loadFolderAppearance()` after parsing (e.g. after **388**):  
  `console.log('[FolderRail] loadFolderAppearance', { key: FOLDER_APPEARANCE_LS_KEY, loadedIds: Object.keys(parsed), scope: scope?.kind });`
- FolderRail save effect when writing (**655**):  
  `console.log('[FolderRail] saveFolderAppearance', { key: FOLDER_APPEARANCE_LS_KEY, ids: Object.keys(folderAppearance) });`

---

## BUG 2: Signed-in memory-folder icon picker cannot select an icon (right rail)

### Repro target
1. Sign in.
2. Open memory overlay / right rail → memory folders.
3. Try to change a memory folder icon.

**Observed:** Clicking an icon doesn’t select it; no update.

**Goal:** Find the first broken link: no click → no state → no API → no DB → no refetch.

---

### Investigation (first broken link)

- **A) Click not firing** — Main right column uses `rightDockHidden ? 'opacity-0 pointer-events-none'` (ChatPageLayout 1284). Overlay wrapper 1473 has `pointer-events-none`, inner 1482 has `pointer-events-auto`. Submenu is portaled to document.body (RightRail 1044-1052) with z-[62] (1048). If another layer covers the portal or capture-phase listener closes menu before click, click won't fire.
- **B) onSetFolderIcon missing** — RightDock passes `onSetFolderIcon` to RightRail (148). ChatPageLayout passes `handleSetMemoryFolderIcon` in main path (1312) and overlay path (1519). Both paths pass it.
- **C) Click fires but PATCH fails** — handleSetMemoryFolderIcon (page 2590-2618) returns early on !response.ok (2600-2604) or on catch (2607-2610) without calling setMemoryFolders. Any 4xx/5xx → no state update.
- **D) subMenu.folderId null/stale** — Icon buttons call onSetFolderIcon(subMenu.folderId!, icon) (RightRail 1085-1086, 1112-1113). Submenu opens with folderId: menu.folderId (975-981). If subMenu.folderId is null, handler gets null → API may 400/404.
- **E) State updates but UI doesn't re-render** — RightRail sync effect (372-407) copies folder.icon from folders prop into folderAppearance. If sync overwrites or effect deps wrong, UI could stay stale.

### Most likely root cause (Bug 2)

**First broken link to pinpoint with logs:** (A) Click not reaching handler (overlay/pointer-events or pointerdown capture closing menu before click), or (C) PATCH returning !ok so handleSetMemoryFolderIcon returns without setMemoryFolders (page 2600-2604, 2607-2610). Handler is passed in both main and overlay (ChatPageLayout 1312, 1519); PATCH route exists and expects folder_id + icon (route 326-327, 334-339). Add temporary logs to see which.

---

### Trace: UI click → handler → state update → API call → refetch → render

| Step | Location | What happens |
|------|----------|--------------|
| 1 | `RightRail.tsx` | Icon grid buttons: `onClick={() => { if (onSetFolderIcon) onSetFolderIcon(subMenu.folderId!, "heart"); }}`. No local `setFolderAppearance` (unlike FolderRail); comment says “let the sync effect handle it from DB”. |
| 2 | `app/chat/page.tsx` | `handleSetMemoryFolderIcon(id, icon)` PATCHes `/api/memory/folders` with `{ folder_id: id, icon }`, then on success calls `setMemoryFolders(prev => prev.map(...))`. |
| 3 | `RightRail.tsx` | Sync effect (from `folders` prop) copies `folder.icon` from DB into `folderAppearance[folder.id]` and calls `setFolderAppearance(updatedAppearance)`. |
| 4 | `app/api/memory/folders/route.ts` | PATCH handler updates `memory_folders SET icon = ? WHERE id = ?`; does **not** call `getServerScope` (no scope check on icon update). |

Possible break points: (A) Click never fires (pointer-events, z-index, overlay). (B) `onSetFolderIcon` undefined in the code path that renders the picker. (C) Click fires but API fails (!response.ok) so we return without `setMemoryFolders`. (D) `subMenu.folderId` null/wrong so API gets bad `folder_id`. (E) Sync effect doesn’t run or overwrites incorrectly.

---

### Root-cause hypothesis (Bug 2)

**First broken link to be confirmed by logs:** one of:

1. **Click not firing** – e.g. overlay/drawer wrapper, or another layer (z-index / pointer-events) capturing or covering the portaled submenu when in narrow/overlay mode.
2. **onSetFolderIcon undefined** – In the overlay RightDock path, `onSetFolderIcon` might not be passed or might be overwritten (inspection shows both main and overlay pass `handleSetMemoryFolderIcon`; still worth verifying at runtime).
3. **API failure** – PATCH returns 4xx (e.g. 404 if `folder_id` is wrong, or 401 if auth is required elsewhere and cookies aren’t sent). Handler returns early, so `setMemoryFolders` never runs and UI never updates.
4. **subMenu.folderId null or stale** – Icon buttons call `onSetFolderIcon(subMenu.folderId!, icon)`. If `subMenu.folderId` is null, the call might throw or send `folder_id: null` and API could 400/404.

Sync effect and list keys look correct (sync from `folders` by `folder.id`; list key `memory-folder-${folder.id}`), so the most likely first break is (1), (2), or (3).

---

### Exact file/line suspects (Bug 2)

| File | Lines | Role |
|------|--------|------|
| `components/chat/RightRail.tsx` | 1084–1090, 1112–1118, 1138–1144, … | Icon buttons: only call `onSetFolderIcon(subMenu.folderId!, icon)`; no local `setFolderAppearance`. If `onSetFolderIcon` is undefined or `subMenu.folderId` is null, nothing visible happens. |
| `components/chat/RightRail.tsx` | 499–506, 508–516 | `onPointerDownAnywhere` (capture) closes menu if target not `isInsideMenu`. If ref or portal timing is wrong, menu could close before click. |
| `components/chat/RightRail.tsx` | 1044–1052 | Submenu rendered with `createPortal(..., document.body)`; condition `subMenu.open && subMenu.folderId === menu.folderId`. Ref `subMenuRef` on this div. |
| `components/chat/ChatPageLayout.tsx` | 1284, 1409, 1473–1482 | Main right column: `rightDockHidden ? 'opacity-0 pointer-events-none'`; overlay wrapper and inner drawer use `pointer-events-none` / `pointer-events-auto`. If overlay or stacking is wrong, portaled submenu could be covered. |
| `components/chat/RightDock.tsx` | 148–149 | Passes `onSetFolderIcon={onSetFolderIcon}` to `RightRail`. If parent omits it in overlay path, it’s undefined. |
| `app/chat/page.tsx` | 2590–2618 | `handleSetMemoryFolderIcon`: on `!response.ok` returns without updating state; on catch returns without state update. So any API error yields “no update”. |
| `app/api/memory/folders/route.ts` | 324–355 | PATCH icon: no `getServerScope`; UPDATE by id only. If request fails (e.g. body/headers), 4xx would explain “no update”. |

---

### Three falsifiable repro tests (Bug 2)

1. **Click handler runs and receives valid id**  
   - Add in RightRail icon button `onClick`:  
     `console.log('[RightRail] icon click', { folderId: subMenu.folderId, icon: 'heart', hasHandler: !!onSetFolderIcon });`  
   - Sign in, open right rail, open folder context menu → Icon, click “heart”.  
   - **Falsifiable:** Log shows `folderId` number and `hasHandler: true`. If log never appears, click is not firing. If `folderId` is null or `hasHandler` false, that’s the broken link.

2. **PATCH is sent and returns 200**  
   - Open DevTools → Network, filter by “memory/folders” or “folders”.  
   - Sign in, open memory folder icon picker, click an icon.  
   - **Falsifiable:** One PATCH to `/api/memory/folders` with body `{ folder_id: <number>, icon: "<name>" }` and status 200. If no PATCH, handler wasn’t called or fetch failed earlier. If PATCH 4xx/5xx, that’s the broken link.

3. **Local state updates after PATCH success**  
   - In `handleSetMemoryFolderIcon` after `setMemoryFolders(...)`:  
     `console.log('[handleSetMemoryFolderIcon] state updated', id, icon);`  
   - **Falsifiable:** After a successful PATCH, this log appears. If PATCH 200 but log never appears, state update path is broken. If RightRail doesn’t re-render with new icon, sync effect or props are the next suspect.

---

### Minimal fix options (Bug 2)

1. **If click not firing** – Ensure the portaled submenu (z-[62]) is above any overlay/drawer and that no parent of the portal has `pointer-events: none` on the submenu’s area. Ensure only one RightRail’s menu is open when in overlay mode so the correct instance’s refs receive the click.
2. **If onSetFolderIcon undefined** – Guarantee `handleSetMemoryFolderIcon` is passed to `RightDock` (and thus `RightRail`) in both main and overlay render paths (ChatPageLayout already passes it at 1312 and 1519; add a guard in RightRail if needed: `if (!onSetFolderIcon) return;` and log when missing).
3. **If API returns error** – Add auth/scope to PATCH (e.g. `getServerScope`, validate folder belongs to user/guest) and return 200 with updated folder; ensure client sends cookies/auth headers. On client, log `response.status` and body on !response.ok to see exact failure.
4. **If subMenu.folderId null** – Guard before calling: `if (subMenu.folderId == null) return;` and ensure icon submenu is only opened when `menu.folderId` is set (already set when opening “Icon” from context menu).

---

### Temporary logs to add (Bug 2)

- **RightRail submenu open** (after setSubMenu at 975-981 or at top of icon grid 1053):  
  `console.log('[RightRail] submenu open', { menuFolderId: menu.folderId, subMenuFolderId: subMenu.folderId });`
- **API PATCH** (route.ts): after line 341 add:  
  `console.log('[PATCH /api/memory/folders] result', { folder_id, icon, changes: result.changes });`

### Recommended console logs (Bug 2)

- **RightRail icon button (first button in grid, e.g. “heart”), inside onClick, before `onSetFolderIcon`:**  
  `console.log('[RightRail] icon click', { folderId: subMenu.folderId, icon: 'heart', hasHandler: !!onSetFolderIcon });`
- **handleSetMemoryFolderIcon, start:**  
  `console.log('[handleSetMemoryFolderIcon]', { id, icon });`  
  (already present; keep it.)
- **handleSetMemoryFolderIcon, on !response.ok:**  
  `console.log('[handleSetMemoryFolderIcon] API error', response.status, await response.text());`
- **handleSetMemoryFolderIcon, after setMemoryFolders:**  
  `console.log('[handleSetMemoryFolderIcon] state updated', id, icon);`

---

## Summary (most likely root cause + exact lines)

| Bug | Most likely root cause | Exact lines |
|-----|-------------------|-------------|
| **1** | **Storage map collision** – `dartboard.folderAppearance.v1` in localStorage is not cleared (and not scoped) on auth boundary, so new guest reuses old guest’s id→icon map. | After sign-out, inspect localStorage for `dartboard.folderAppearance.v1` and confirm new guest’s folders don’t show old icons. |
| **2** | **First broken link** (confirm with logs): (A) Click not firing (overlay/pointer-events or pointerdown capture closing menu before click), or (C) PATCH returns !ok so state never updated (page 2600-2604). Handler passed in both paths (ChatPageLayout 1312, 1519); PATCH route exists (route 324-355). | **RightRail 1084-1089, 1112-1118, 499-506** (onClick vs pointerdown); **page 2590-2618** (early return on error); **route 324-355** (PATCH body + result). |

---

## 4-step repro checklist (with instrumentation)

**Step 1 — Sign out (become guest)**  
- Action: Sign in if needed, then sign out (no refresh).  
- **Logs to see:**  
  - `[AUTH_EVENT] SIGNED_OUT route= /chat` (or current route).  
  - `[AUTH_BOUNDARY] SIGNED_OUT { hasFolderAppearanceKey: true|false, appearanceIdsCount: N }`  
    - If you had left-rail folder icons before sign-out: **expect** `hasFolderAppearanceKey: true` and `appearanceIdsCount` ≥ 1 (confirms key persists across sign-out; BUG 1).  
    - If you had no folders/icons: may be `false` / 0.  
  - `[SS_KEYS] before clear` / `[SS_KEYS] after clear`.

**Step 2 — Guest: left-rail chat folders + change one icon (BUG 1)**  
- Action: As guest, create 2–3 chat folders in the left rail. Right-click one folder → Icon → pick an icon (e.g. heart).  
- **Logs to see:**  
  - `[FolderRail] loadFolderAppearance` with `{ key: "dartboard.folderAppearance.v1", loadedIdsCount: N }`  
    - On first load after sign-out: if Step 1 had `appearanceIdsCount` > 0, **expect** same or similar `loadedIdsCount` here (confirms new guest loads previous guest’s appearance by id → BUG 1).  
  - Optional: change one folder’s icon again; you may see `[FolderRail] Save effect` / save logs if present.  
- **Guest vs signed-in:** This step is **guest only**. Signed-in users use DB for chat folder icons (left rail), not this localStorage key.

**Step 3 — Sign in**  
- Action: Sign in (no refresh).  
- **Logs to see:**  
  - `[AUTH_EVENT] SIGNED_IN route= ...`  
  - `[AUTH_BOUNDARY] SIGNED_IN { hasFolderAppearanceKey: true|false, appearanceIdsCount: N }`  
    - If Step 2 wrote to localStorage: **expect** `hasFolderAppearanceKey: true` and `appearanceIdsCount` ≥ 1 (key still not cleared on sign-in; BUG 1).  
  - `[SS_KEYS] before clear` / `[SS_KEYS] after clear`.  
  - After chat remounts, `[FolderRail] loadFolderAppearance` again (for left rail); ids count may still be from previous guest if key not scoped/cleared.

**Step 4 — Signed-in: memory folders + change icon (BUG 2)**  
- Action: Open right rail (memory folders). Right-click a memory folder → Icon → click an icon (e.g. heart).  
- **Logs to see (in order):**  
  1. `[RightRail] submenu open { menuFolderId: <number>, subMenuFolderId: <number> }` — when you open the icon submenu.  
  2. `[RightRail] icon click { folderId: <number>, icon: "heart", hasHandler: true }` — when you click the heart (or other) icon.  
     - If this **never** appears → click not firing (first broken link A).  
     - If `hasHandler: false` → handler not passed (first broken link B).  
     - If `folderId` is null → wrong id (first broken link D).  
  3. `[handleSetMemoryFolderIcon] start { id: <number>, icon: "heart" }` — handler invoked.  
  4. Server: `[PATCH /api/memory/folders] Received: ...` then `[PATCH /api/memory/folders] result { folder_id, icon, changes: 1 }` — PATCH ran and updated 1 row.  
     - If you see `!response.ok` with status/body instead → API error (first broken link C).  
  5. `[handleSetMemoryFolderIcon] state updated` — after setMemoryFolders.  
- **Guest vs signed-in:** This step is **signed-in only**. Memory folder icon picker for guests may use different code path; focus on signed-in to confirm BUG 2.

**Summary**  
- **BUG 1:** After Step 1 and Step 3, if `[AUTH_BOUNDARY]` shows `hasFolderAppearanceKey: true` and `appearanceIdsCount` > 0, the localStorage key persists across auth boundary. After Step 2, if `[FolderRail] loadFolderAppearance` shows `loadedIdsCount` from a previous session, id collision is confirmed.  
- **BUG 2:** After Step 4, the first missing log in the sequence (submenu open → icon click → start → PATCH result → state updated) is the first broken link.
