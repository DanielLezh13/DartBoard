# DartBoard TODO Roadmap

## 0) Stabilize the foundations (no new features)

### 1. Prompt assembly proof
- [ ] Print single "assembled prompt manifest" per request showing:
  - Order + counts + token estimates for:
    1. System/mode
    2. Injected memories
    3. Rolling summary
    4. Recent window
    5. User msg
- **Done when**: Manifest is accurate and matches actual API payload

### 2. Memory injection proof
- [ ] Verify via Network -> /api/chat payload
- [ ] Confirm injected memories are present and in intended position
- **Done when**: Network inspection shows memories in correct location

### 3. Compaction / rollover proof
- [ ] Make compaction boundary visible in logs
- [ ] Show rolling summary in logs
- [ ] Show tail sampling in logs
- **Done when**: All three are visible and reproducible across refresh

## 1) Session model correctness

### 4. MRU invariants locked
- [ ] Verify MRU bumps only on 4 events:
  1. Send message
  2. Reply saved
  3. New chat create
  4. Rollover
- [ ] Test ordering stability pre/post refresh
- **Done when**: No other events trigger MRU bump and ordering is stable

### 5. Server as source of truth
- [ ] Test reload reproduces same ordering
- [ ] Test reload reproduces same timestamps
- [ ] Verify no client-only phantom MRU
- **Done when**: Refresh always yields identical state

## 2) "Brain" implementation (real behavior control)

### 6. Modes actually change model behavior
- [ ] Capture system prompt for each mode
- [ ] Capture model params for each mode
- [ ] Create diff view between modes
- **Done when**: Mode switch shows clear prompt + param delta

### 7. User profile + constraints integrated
- [ ] Identify which profile fields matter
- [ ] Inject them deterministically
- [ ] Test toggle on/off shows output changes
- **Done when**: Profile changes are visible in model output

### 8. Memory retrieval/attachment gating
- [ ] Test attached memories appear in prompt
- [ ] Test detached memories never appear
- [ ] Verify reliability across sessions
- **Done when**: Memory gating is 100% reliable

## 3) Long-context strategy (beyond 128k)

### 9. 3M stress harness
- [ ] Create script to exceed 128k tokens
- [ ] Measure latency at various points
- [ ] Measure cost at various points
- [ ] Identify degradation points
- **Done when**: Have performance curve to 3M tokens

### 10. Rolling summary quality control
- [ ] Create test cases with multiple topics
- [ ] Verify topic coverage in summaries
- [ ] Verify key decisions preserved
- [ ] Build regression test set
- **Done when**: Summaries pass all regression tests

### 11. Notebook/pagination for UI
- [ ] Implement cursor-based message loading
- [ ] Render message list without loading all
- [ ] Test performance with 10k+ messages
- [ ] Implement virtual scrolling if needed
- **Done when**: Session loads fast regardless of size

## 4) Product-grade systems

### 12. Observability panel
- [ ] Build debug panel showing per-turn:
  - Token counts per section
  - Included memory IDs
  - Summarized_until_message_id
  - Model + params
- [ ] Make panel accessible in dev mode
- **Done when**: Full visibility into each request

### 13. Regression suite
- [ ] Create fixtures for rollover multi-topic
- [ ] Create fixtures for MRU ordering
- [ ] Create fixtures for memory injection on/off
- [ ] Implement automated test runner
- **Done when**: All tests pass automatically

### 14. Export/import
- [ ] Define export format (JSON)
- [ ] Export: messages + summaries + attachments
- [ ] Import: restore exactly as exported
- [ ] Test round-trip integrity
- **Done when**: Export/import is lossless

## Notes

- Each item has concrete "Done when" criteria
- Items are ordered by dependency
- Foundation items (0) must be completed before others
- No new features until foundations are stable
