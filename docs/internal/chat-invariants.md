# Chat Substrate Invariants

These rules must hold at all times.
Any change that violates them is a regression.

---

## A1. Single Scroll Writer
- Scroll position is written only via `requestScroll(...)`.
- No component may call `scrollTop`, `scrollIntoView`, or equivalent directly.
- All scroll intent must declare a reason (toBottom, restore, toHit, etc.).

---

## A2. Bottom Anchor Semantics
- New assistant content appears to grow upward from the composer.
- Auto-scroll happens only if:
  - user is already at bottom (within threshold), OR
  - reveal-lock is active for the current streaming message.
- User scrolling always overrides auto-follow.

---

## A3. Renderer Idempotency
- Historical messages render immediately and fully.
- Reveal / streaming effects must never gate visibility of old messages.
- Reveal clamping applies only to the actively streaming assistant message.

---

## A4. Mode Switch Stability
- Search ↔ chat toggle must not remount the message list.
- Message keys must remain stable across mode switches.
- Mode switches do not write scroll position except:
  - deterministic scroll-to-bottom on exit-search.

---

## Manual Regression Checklist (2 minutes)

1. New chat -> send message -> pinned at bottom.
2. Long list reply -> pinned to true bottom.
3. Scroll up during reveal -> detaches (no fighting).
4. Reattach action -> snaps cleanly to bottom.
5. Enter search -> exit search -> deterministic bottom, no jump.
