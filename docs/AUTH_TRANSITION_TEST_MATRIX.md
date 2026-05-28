# Auth transition test matrix (5 steps)

Use this to verify sign-out updates UI immediately and guest state never bleeds into signed-in state.

1. **Sign-out updates UI without refresh**
   - Be signed in. Click sign out.
   - **Expect:** UI shows guest/landing immediately. No manual refresh.
   - **Console:** `[AUTH_EVENT] SIGNED_OUT` then `[SCOPE] guest id=...` and `[SS_KEYS] before clear` / `after clear`.

2. **Guest folders never appear when signed in**
   - As guest, create 1–2 left-rail (session) folders.
   - Sign in.
   - **Expect:** Left rail shows no guest folders (empty or only user folders). Console shows `[SS_KEYS] after clear` with cleared keys.

3. **Guest memory never appears when signed in**
   - As guest, create a memory (vault/brain).
   - Sign in.
   - **Expect:** That memory is not visible (user’s memory list or empty). No ghost guest memory.

4. **Sign out → guest starts clean**
   - Sign out (from signed-in state).
   - **Expect:** Guest UI; no leftover user session/folder selection. Console shows `[AUTH_EVENT] SIGNED_OUT` and scope/SS_KEYS logs.

5. **Hard clear sessionStorage + refresh**
   - As guest, create a memory. Sign in (memory disappears). Sign out.
   - In DevTools: Application → Session Storage → Clear all. Refresh page.
   - **Expect:** Guest state stays clean; no ghost memory. If a “guest memory” still appears after this, it is DB-backed and API scope must be audited.
