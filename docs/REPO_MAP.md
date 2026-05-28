# Repo Map

This file is a quick orientation guide for reviewers.

## Top-Level Product Surfaces

- `app/page.tsx` - app entrypoint; mounts the main chat workspace.
- `app/chat/page.tsx` - primary product surface for chat, sessions, memory, and attachments.
- `app/archive/page.tsx` - archive import, search, context inspection, and vault flows.
- `app/profile/page.tsx` - account/profile/preferences surface.
- `app/home/page.tsx` - standalone marketing/landing page.

## API Route Groups

- `app/api/chat/*` and `app/api/sessions/*` - model calls, message flow, session lifecycle, branch/continue/rollover.
- `app/api/memory/*` and `app/api/session-attachments/*` - memory CRUD, foldering, attachment state, and pinning.
- `app/api/archive/*` - ChatGPT export import, search, context windows, timeline counts, and archive-to-vault flows.
- `app/api/auth/*` and `app/api/guest/*` - auth/session sync, sign-out, guest claim/wipe flows.
- `app/api/billing/*` - Stripe checkout, portal, plan sync, and webhook handling.
- `app/api/upload/image/*` - authenticated private image upload and retrieval.

## Feature Components

- `components/chat/*` - main workspace UI: rails, navigator, right dock, overlays, composer, assistant messages.
- `components/vault/*` - memory editor/list primitives and Tiptap-based document editing.
- `components/archive/*` - archive-specific UI pieces.
- `components/profile/*` - profile/settings view.
- `components/marketing/*` - public landing composition.
- `components/ui/*` - shared primitives used across surfaces.

## Core Hooks

- `hooks/useChatSessions.ts` - session list, folder linkage, restore logic, and session mutations.
- `hooks/useChatMemories.ts` - memory state, folders, guest/user transitions, and overlay support.
- `hooks/useChatDnd.ts` - drag/drop behavior across session and memory surfaces.
- `hooks/useSessionAttachments.ts` - attach/detach/pin flows plus usage hydration.
- `hooks/useScope.ts` - unified signed-in vs guest scope handling.

## Prompt And Context Pipeline

- `lib/LYNX_BOOT_SEQUENCE.ts` - canonical prompt assembly for runtime laws, mode directives, attachments, and recent messages.
- `lib/runtimeLaws.ts` - global non-negotiable behavior contract (`LYNX_KERNEL`).
- `lib/modes.ts` - mode registry and mode metadata.
- `lib/plan.ts` and `lib/planLimits.ts` - plan gating and usage limits.

## Persistence And Infra

- `lib/db.ts` - SQLite connection, schema bootstrapping, and many core DB helpers.
- `lib/rateLimit.ts` - SQLite-backed rate limiting used by middleware and APIs.
- `lib/uploads.ts` - private upload storage paths and serving helpers.
- `lib/scope-client.ts`, `lib/scope-server.ts`, `lib/scope-shared.ts` - auth/scope boundary helpers.
- `middleware.ts` - request-scope setup and rate-limit enforcement.

## Naming Notes

- The product pitch is continuity across `archive -> memory -> active chat`.
- Some internal names still use older `rightDock/rightRail/rightPanel` terminology for compatibility with existing state and layout logic.
- `LYNX_*` names are legacy internal prompt-system naming; they now refer to the canonical runtime law / prompt assembly path.

## Reviewer Shortcuts

- Start with `README.md`, then this file.
- For product depth, read `app/chat/page.tsx`, `app/archive/page.tsx`, and `lib/LYNX_BOOT_SEQUENCE.ts`.
- For operational quality, inspect `.github/workflows/ship-gate.yml`, `middleware.ts`, `lib/rateLimit.ts`, and `app/api/upload/image/route.ts`.
- For QA/behavior intent, read `docs/MANUAL_QA_SCRIPT.md`, `README-chat-invariants.md`, and `docs/AUTH_TRANSITION_TEST_MATRIX.md`.
