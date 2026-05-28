# Soft Launch Checklist (Single-Server)

Use this as the preflight checklist before making DartBoard public.

## Latest Verified Run (February 26, 2026)

- Commit: `7219313`
- Release gate:
  - [x] `npm run typecheck` passes.
  - [x] `npm run lint` passes with accepted warnings.
  - [x] `npm run build` passes with accepted warnings.
- Live smoke (critical flows):
  - [x] New chat + memory attach.
  - [x] Delete chat/session behavior.
  - [x] Folder create/delete on both rails.
  - [x] Billing plan sync check: `/api/whoami` returned `plan: "plus"` for user `99a5a550-2df0-4484-9542-cccd2d376265`.

Accepted warnings from latest gates:
- Existing `react-hooks/exhaustive-deps` warnings.
- Existing `@next/next/no-img-element` warnings.
- Build warning: `@dsnp/parquetjs` unresolved in archive import route (non-blocking in current deployment).
- Build-time dynamic server usage warnings for API routes that rely on `cookies` / `request.url`.

## Security and Abuse Controls

- [ ] Archive query guards are active (`limit`/`offset` bounds + shape caps).
- [ ] Archive search route-specific rate limit is active.
- [ ] Upload endpoint accepts only real image bytes (jpg/png/webp/gif).
- [ ] Chat route blocks guest model calls.
- [ ] Sensitive prompt/memory debug logs are removed from launch paths.

## Stability

- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes (or warnings are consciously accepted).
- [ ] `npm run build` passes.
- [ ] Chat send/edit/archive flows work after server restart.

## Product Hygiene

- [ ] No visible stub actions in core UI paths.
- [ ] README reflects actual architecture and constraints.
- [ ] Manual QA script completed once on latest commit.

## Operational Readiness (Single Node)

- [ ] Deployment host has persistent disk for `dartz_memory.db`.
- [ ] Restart procedure documented and tested.
- [ ] Database backup/restore procedure documented and tested.
- [ ] Required env vars are set in deployment environment.
