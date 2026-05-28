# Folder auth scope separation – fix summary

## 1) Folder systems map

- **Chat folders (sidebar)**
  - **Storage:** DB table `chat_folders` (user_id); guests have no DB folders. Client cache: React state in `useChatSessions` (`folders`); guest fallback in `sessionStorage` key `db:folders`.
  - **Keys:** `db:folders` (sessionStorage, guest only).
  - **Endpoints:** GET/POST/PATCH/DELETE `/api/folders`. GET uses `getServerScope(request)` (cookies for user, `x-guest-id` for guest); user gets rows by `user_id`, guest gets `[]`.
  - **Scope rules:** User = DB only. Guest = sessionStorage only; API returns `[]`.

- **Memory folders (vault/brain)**
  - **Storage:** DB table `memory_folders` (user_id / guest_id). Client cache: React state in `useChatMemories` (`memoryFolders`); guest fallback in `sessionStorage` key `db:memoryFolders`.
  - **Keys:** `db:memoryFolders` (sessionStorage, guest only).
  - **Endpoints:** GET/POST/PATCH/DELETE `/api/memory/folders`. Scope from `getServerScope(request)`; both user and guest get DB rows.
  - **Scope rules:** User = DB only. Guest = DB + sessionStorage fallback.

- **Other “folder” concepts**
  - **Session–folder mapping:** `session_folder_mapping` / `in_folder_id` on sessions; `/api/session-folder`, `/api/sessions` (inFolderId). Scope follows session scope (user/guest).
  - **Folder appearance (FolderRail/RightRail):** `localStorage` key `FOLDER_APPEARANCE_LS_KEY`; UI-only, not scope-separated by auth.

- **Guest-only keys cleared on sign-in**
  - `db:folders`, `db:memoryFolders`, `db:guestMemories` (see `lib/guest-keys.ts`).

---

## 2) Root cause for carryover

- **File/line:** `hooks/useChatSessions.ts` – `loadFoldersFromDB` (previously ~261–283).
- **What happened:** GET `/api/folders` was called **without** `getAuthHeaders()`, so for guests the server could throw (no `x-guest-id`) and the client fell back to sessionStorage. For **signed-in users**, when the API returned **empty** folders (new user or 0 folders), the same code path treated “length === 0” as “maybe guest, try sessionStorage” and **loaded guest folders from sessionStorage** into React state. So guest folders appeared in the UI after sign-in.
- **Secondary:** `loadFoldersFromDB` did not take `scope` into account, so when `scope.kind === "user"` the client still used sessionStorage for empty responses. Same pattern in `useChatMemories` `loadMemoryFolders`: empty API response led to sessionStorage restore regardless of scope.
- **No reset on auth transition:** React state for folders (and memory folders) was not cleared when switching guest↔user, and guest sessionStorage keys were not cleared on sign-in, so stale guest data could remain or reappear.

---

## 3) Minimal code diff plan

| File | Change |
|------|--------|
| **lib/guest-keys.ts** | **New.** `GUEST_SESSION_KEYS` and `clearGuestSessionStorage()` to remove `db:folders`, `db:memoryFolders`, `db:guestMemories`. |
| **hooks/useChatSessions.ts** | Accept `scope` in opts. `loadFoldersFromDB`: call `/api/folders` with `getAuthHeaders()`; when `scope?.kind === "user"` never read sessionStorage (use API result only, or clear `db:folders`). On scope kind change (guest↔user): `clearGuestSessionStorage()`, `setFolders([])`, `setSelectedFolderId(null)`, `loadSessions()`. Add `prevScopeKindRef` to detect transition. |
| **hooks/useChatMemories.ts** | Import `clearGuestSessionStorage`. `loadMemoryFolders`: when `scope?.kind === "user"` never read sessionStorage; on empty/failure for user set `[]`. On scope kind change: `clearGuestSessionStorage()`, `setMemoryFolders([])`, `loadMemoryFolders()`. Add `prevScopeKindRef`. |
| **app/chat/page.tsx** | Pass `scope` into `useChatSessions({ ..., scope })`. Signed-in folder delete: after successful DELETE call `loadSessions()` (refetch) and clear `selectedFolderId` if deleted folder was selected. `handleDeleteFolderAndChats`: use `getAuthHeaders()` on DELETE requests and `loadSessions()` after. |
| **hooks/useScope.ts** | Optional: log `[SCOPE_DEBUG] scope set kind=… id=…` when scope is set (initial, storage, auth). |
| **app/api/folders/route.ts** | GET: log scope and folder count; catch `getServerScope` and return `[]` when no scope (log x-guest-id present/absent). DELETE: log id and result.changes. |
| **docs/FOLDER_SCOPE_FIX.md** | This document. |

---

## 4) Test matrix (5–8 steps)

1. **Guest → no carryover after sign-in**
   - As guest, create 1+ chat folders (sidebar).
   - Sign in.
   - **Expect:** Sidebar folder list is empty (or only user’s folders). No guest folder names.

2. **User → no carryover after sign-out**
   - Signed in, create 1+ chat folders.
   - Sign out (or simulate guest scope).
   - **Expect:** Sidebar shows no user folders (empty or guest-only list).

3. **Guest folders in sessionStorage cleared on sign-in**
   - As guest, create a folder (so `db:folders` is in sessionStorage).
   - Sign in.
   - **Expect:** `sessionStorage.getItem("db:folders")` is null (or cleared); UI does not show guest folders.

4. **Folder list reflects current scope**
   - Sign in, create folder A. Sign out. As guest create folder B (if UI allows).
   - **Expect:** When guest, only B (or empty); when signed in again, only A.

5. **Delete folder (signed-in) then refetch**
   - Signed in, create folder F, then delete F.
   - **Expect:** Folder list updates (F gone) after delete; no stale F. Console shows refetch / [SCOPE_DEBUG] folder delete log.

6. **Memory folders: guest vs user**
   - As guest, create a memory folder. Sign in.
   - **Expect:** Memory folder list does not show guest folder; user’s memory folders only (or empty).

7. **Scope debug logs**
   - Sign in / sign out / load chat page; create or delete folder.
   - **Expect:** Console shows `[SCOPE_DEBUG]` with scope kind, id, and where folders were loaded from (api vs sessionStorage) and delete id/changes.

8. **Delete folder and chats (signed-in)**
   - Signed in, create folder, add chat to folder, then “delete folder and chats”.
   - **Expect:** Folder and its chats removed; list refetched; selection cleared if that folder was selected.
