# API Route Map

This is a high-signal map of the main route groups used in DartBoard.

## Chat and Sessions

- `/api/chat` - main model call path, session context assembly, usage checks.
- `/api/messages` - fetch/persist chat messages.
- `/api/sessions` - list/create/update/delete sessions.
- `/api/sessions/focus` - session focus state updates.
- `/api/sessions/continue`, `/api/sessions/rollover`, `/api/sessions/branch` - session lifecycle helpers.

## Memory System

- `/api/memory` - CRUD for memories.
- `/api/memory/folders` - CRUD for memory folders.
- `/api/session-attachments` - attach/detach/reorder per-session memory attachments.
- `/api/session-attachments/pin` - pin/unpin attachments (controls injection).
- `/api/session-attachments/usage` - token usage for attached memories.

## Archive

- `/api/archive/import` - ChatGPT import (`.json` / `.parquet`).
- `/api/archive/search` - filtered archive + live chat search.
- `/api/archive/context` - before/after context around a selected archive message.
- `/api/archive/monthly-counts` - histogram data for archive timeline.
- `/api/archive/vault` - save archive content into memories.
- `/api/archive/clear` - clear archive rows for current scope.

## Uploads and Utility

- `/api/upload/image` - authenticated image upload with byte-signature validation and private file serving.
- `/api/title` - title generation.
- `/api/summarize` - summarization helper.

## Auth, Billing, and Profile

- `/api/profile` - user profile read/write.
- `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/sync`, `/api/billing/webhook` - Stripe billing flows.
- `/api/auth/*` - auth/session sync helpers.

## Deprecated/Disabled

- `/api/documents/*`, `/api/doc-assistant`, `/api/doc-chat-messages` currently return `410` in this build.
- `/api/chat-debug` is disabled in this build.
