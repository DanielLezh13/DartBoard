# API Guard Contract

This file defines the non-negotiable API auth/ownership behavior for DartBoard routes.

## Response rules

1. Return `401` when caller has no valid auth scope.
2. Return `400` when an ID/shape is invalid (example: `session_id=abc`).
3. Return `404` for not-owned or missing resources.

Rule #3 is intentional anti-enumeration: do not expose whether an ID exists for another account.

## Required guard flow for mutation routes

1. Parse and validate route params/body IDs.
2. Resolve scope from request.
3. Require ownership for target resource(s).
4. Execute SQL mutation only after ownership passes.
5. Re-query with same scope where needed before returning.

## Canonical helper set

Primary helpers are in:

- `/Users/daniel/dev/DartBoard-main/lib/api-guards.ts`
- `/Users/daniel/dev/DartBoard-main/lib/ownership.ts`

Use these instead of per-route ad hoc checks.

## Canonical route pattern

Example pattern (session mutation):

```ts
const idResult = parsePositiveIntField(body.id, "id");
if (!idResult.ok) return idResult.response;

const scopeResult = await requireScope(request);
if (!scopeResult.ok) return scopeResult.response;

const owned = requireOwnedSession(db, scopeResult.value, idResult.value);
if (!owned.ok) return owned.response;

// Safe to mutate here.
```

## Adoption notes

When adding a new route:

1. Use `requireScope(...)` first.
2. Use `parsePositiveIntField(...)` for external IDs.
3. Use `requireOwned*` helpers before any write.
4. Preserve `401/400/404` semantics above.
