# Left-rail (session) folder carryover fix

## 1) Left-rail data source

- **File:** `components/chat/FolderRail.tsx`
- **Component:** `FolderRail`
- **Variable used to render folders:** prop `folders` (e.g. `folders.map((folder) => ...)` around line 805).
- **Data flow backward:**
  - `FolderRail` receives `folders` from `ChatPageLayout` (props).
  - `ChatPageLayout` receives `folders` from `app/chat/page.tsx` (props).
  - `app/chat/page.tsx` gets `folders` from `sessionsHook.folders` (destructured from `useChatSessions()`).
  - `useChatSessions` holds `folders` in React state (`useState<SidebarFolder[]>([])`) and fills it in `loadFoldersFromDB()`.
  - `loadFoldersFromDB` is called from `loadSessions()` in its `finally` block. It fetches `/api/folders` and either sets folders from the API or (for **guest** only) from `sessionStorage` key `db:folders`.

So the source of truth for left-rail folders is **`useChatSessions` state**, populated by **`loadFoldersFromDB`** (API + guest fallback to `db:folders`).

---

## 2) Root cause (file + line)

- **File:** `hooks/useChatSessions.ts`
- **Issue:** `loadFoldersFromDB` used the **closure** value of `scope`. When the user signed in, a `loadSessions()` that had **started while scope was still "guest"** could **finish after** sign-in. Its `finally` then called `loadFoldersFromDB` with the **old** closure (`scope === "guest"`). The API was called with **current** auth (user), returned `[]` (user has no folders yet). The code then took the “guest + empty API” path and **restored from `sessionStorage` (`db:folders`)**, repopulating state with **guest folders** and showing them in the left rail for a signed-in user.
- **Relevant logic:** Any branch that does “no folders from API → try sessionStorage” must use the **current** scope at **run time**, not the scope from when the callback was created.

---

## 3) Folder-related storage keys (who reads them)

| Key | Storage | Where read / purpose |
|-----|---------|----------------------|
| `db:folders` | sessionStorage | `useChatSessions.loadFoldersFromDB` – guest chat folder list (left rail). |
| `db:memoryFolders` | sessionStorage | `useChatMemories.loadMemoryFolders` – guest memory folder list. |
| `db:guestMemories` | sessionStorage | `useChatMemories`, `ChatPageLayout` – guest memories. |
| `db:selectedFolderId` | sessionStorage | `useChatSessions` – selected left-rail folder. |
| `db:lastActiveSessionId` | sessionStorage | `useChatSessions` – last active chat. |
| `db:openLanding` | sessionStorage | `useChatSessions` – open landing flag. |
| `db:tabInit` | sessionStorage | `useChatSessions`, `useChatMemories`, `usePanels` – same-tab marker. |
| `db:sidebarHidden` | sessionStorage | `usePanels` – left sidebar hidden. |
| `db:rightDockHidden` | sessionStorage | `usePanels` – right dock hidden. |
| `db:sidebarOpen` / `db:rightOverlayOpen` / `db:keepOverlaysVisible` | sessionStorage | `usePanels` – panel state. |
| `chat:lastOpenedMap` | localStorage | `useChatSessions` – MRU ordering. |
| `dartboard.folderAppearance.v1` | localStorage | `FolderRail` – left-rail folder appearance (icon/label/color). |
| `dartboard.memoryFolderAppearance.v1` | localStorage | `RightRail` – memory folder appearance. |

No other `sessionStorage`/`localStorage` keys are used specifically for the **left-rail folder list**; the only one that can carry guest folders into the UI is `db:folders` when read while scope is user.

---

## 4) Fix applied (minimal diff)

**A) Use current scope inside `loadFoldersFromDB` (hooks/useChatSessions.ts)**

- Added `scopeRef = useRef(scope)` and `useEffect` to keep `scopeRef.current = scope`.
- In `loadFoldersFromDB`, use `scopeRef.current` instead of `scope` for all scope checks (e.g. `scopeKind`, `scopeId`, and every “user vs guest” branch).
- So when an in-flight `loadSessions()` completes after sign-in, `loadFoldersFromDB` sees **current** user scope and **never** falls back to `sessionStorage` for the left-rail list.

**B) Key left rail by scope (components/chat/ChatPageLayout.tsx)**

- On every `FolderRail`, set `key={scope ? \`${scope.kind}:${scope.userId ?? scope.guestId}\` : "scope-loading"}`.
- When scope changes (guest → user or user → guest), the sidebar remounts; together with the scope-change effect that clears folders and refetches, the left rail cannot show stale guest folders for a signed-in user.

**C) Debug log (components/chat/FolderRail.tsx)**

- Optional prop `scope` added to `FolderRail`.
- Right where the left rail maps folders, log:
  - `[LEFT_RAIL_SOURCE]` with `scope`, `foldersSourceName`, `foldersCount`, `first3FolderNames`, and which of `db:folders` / `db:memoryFolders` / `db:guestMemories` / `db:selectedFolderId` (and selected localStorage keys) are present.

**D) ChatPageLayout**

- Pass `scope` and the new `key` into all `FolderRail` usages.

---

## 5) 6-step repro test (guest folders never appear when signed in)

1. **Guest: create left-rail folders**  
   Sign out (or use incognito). As guest, create 1–2 chat folders in the left rail (sidebar). Confirm they appear and their names.

2. **Sign in**  
   Sign in with a real account (same tab).

3. **Left rail must not show guest folders**  
   The left rail must **not** show the folders you created as guest. It may be empty or show only folders created while signed in. If any guest folder name appears, the bug is still present.

4. **No delete of “ghost” folders**  
   You must **not** see guest-created folders that you cannot delete or that fail to delete (e.g. “can’t delete when signed in”). If you do, that’s the same carryover bug.

5. **User folders only**  
   As the signed-in user, create a new folder. It should appear and be deletable. After refresh, only user folders (or empty) should appear, never the old guest folder names.

6. **Sign out: no user folders as guest**  
   Sign out. The left rail should **not** show the folders you created while signed in (empty or guest-only). Then sign back in and confirm again only user folders appear.

Passing all six steps means guest and user left-rail folders are fully separated and the fix is verified.
