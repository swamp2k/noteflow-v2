# NoteFlow v2 Roadmap

## Phase 1: Real-Time Sync & Stabilization

**Goal:** Kill the F5 habit. Real-time multi-tab/device sync. Fix minor bugs. Optimize.

**Timeline:** 2-3 weeks (depends on complexity)

---

## Sprint 1: Real-Time Architecture (Week 1)

### 1.1 Design SSE Endpoint
- **Task:** Implement `/api/sync` endpoint in Worker
- **Details:**
  - Use Durable Objects for client tracking (which user/session is connected)
  - Broadcast updates to all connected clients for that user
  - Handle reconnection/backoff gracefully
- **Acceptance Criteria:**
  - Worker can accept SSE connections
  - Worker can broadcast to connected clients
  - Graceful disconnect handling
- **Estimated:** 3-4 hours
- **Blockers:** None

### 1.2 Frontend SSE Listener Hook
- **Task:** Add React hook to subscribe to SSE updates
- **Details:**
  - `useRealTimeSync()` hook
  - Auto-reconnect on disconnect
  - Dispatch updates to React state
  - Works across tabs (via broadcast channels if needed)
- **Acceptance Criteria:**
  - Hook triggers re-renders on update
  - Handles network failures gracefully
  - No memory leaks on unmount
- **Estimated:** 2-3 hours
- **Blockers:** SSE endpoint exists

### 1.3 Broadcast on Note Changes
- **Task:** Emit SSE events when notes are added/updated/deleted
- **Details:**
  - POST /api/notes → triggers SSE broadcast
  - PUT /api/notes/:id → triggers SSE broadcast
  - DELETE /api/notes/:id → triggers SSE broadcast
  - Broadcast payload includes updated note
- **Acceptance Criteria:**
  - Changes propagate to all connected clients < 100ms
  - No duplicate updates
  - Works for Tracking entries
- **Estimated:** 2-3 hours
- **Blockers:** SSE endpoint, hook exists

### 1.4 Test Multi-Tab Sync
- **Task:** Manual testing across tabs/devices
- **Details:**
  - Open NoteFlow in 2+ browser tabs
  - Add note in Tab 1 → verify Tab 2 updates immediately
  - Modify note in Tab 2 → verify Tab 1 updates
  - Test on phone/tablet if possible
  - Test with offline disconnect + reconnect
- **Acceptance Criteria:**
  - All tabs stay in sync without refresh
  - Offline clients reconnect and catch up
  - No race conditions observed
- **Estimated:** 1-2 hours (testing)
- **Blockers:** All above tasks

---

## Sprint 2: Bug Fixes & Polish (Week 2)

### 2.1 Fix Pinned Note Ordering
- **Task:** Debug & fix pinned note sort logic
- **Details:**
  - Current: new notes appear at top, pushing pinned notes down
  - Expected: pinned notes always stay at top
  - Root cause: likely client-side sort logic or D1 query
  - Fix: ensure `pinned DESC, created_at DESC` sort order
- **Acceptance Criteria:**
  - New notes don't disrupt pinned note order
  - Pinned notes visible without refresh
  - Sort order correct after add/update/delete
- **Estimated:** 1-2 hours
- **Blockers:** None (can parallel with Sprint 1)

### 2.2 Multi-User Auth Verification
- **Task:** Verify auth isolation for multi-user
- **Details:**
  - Create 2+ test users in D1
  - Verify User A cannot see User B's notes
  - Verify API respects user auth claims
  - Test with Cloudflare OAuth
- **Acceptance Criteria:**
  - Auth tokens valid and non-forgeable
  - API properly scopes to user_id
  - Session management works
- **Estimated:** 2-3 hours
- **Blockers:** None (independent)

### 2.3 Service Worker Cache Strategy
- **Task:** Optimize PWA offline behavior
- **Details:**
  - Review existing Service Worker caching
  - Ensure static assets cache-first
  - Ensure API responses update fresh (stale-while-revalidate)
  - Test offline → online transition
- **Acceptance Criteria:**
  - App loads instantly from cache
  - Recent notes available offline
  - Sync on reconnect works smoothly
- **Estimated:** 2-3 hours
- **Blockers:** None (parallel)

---

## Sprint 3: Optimization (Week 2-3)

### 3.1 Token Usage Audit
- **Task:** Review Claude Haiku prompts & output
- **Details:**
  - Profile summarization prompts (can we trim?)
  - Check for unnecessary summary regeneration
  - Batch embedding requests to Gemini
  - Cost analysis: tokens/user/month
- **Acceptance Criteria:**
  - Identify 20%+ token reduction opportunity
  - Batch embeddings where possible
  - Document cost per user
- **Estimated:** 3-4 hours (analysis)
- **Blockers:** None

### 3.2 D1 Query Performance
- **Task:** Profile and optimize D1 queries
- **Details:**
  - Check for N+1 queries (e.g., loop fetching entries)
  - Add indexes on frequently queried columns (user_id, created_at)
  - Profile list endpoints (pagination? filtering?)
  - Benchmark before/after
- **Acceptance Criteria:**
  - List queries < 200ms (cold), < 50ms (warm)
  - No N+1 patterns
  - Indexes added for hot paths
- **Estimated:** 3-4 hours
- **Blockers:** None

### 3.3 Frontend Performance
- **Task:** Optimize React rendering
- **Details:**
  - Profile Tracking UI (React DevTools Profiler)
  - Check for unnecessary re-renders
  - Lazy-load images (if implemented)
  - Memoize components as needed
- **Acceptance Criteria:**
  - Note list renders < 100ms
  - No jank on scroll/update
  - Tracking UI smooth
- **Estimated:** 2-3 hours
- **Blockers:** None

---

## Testing Checklist (End of Phase 1)

- [ ] Multi-tab sync works (3+ tabs)
- [ ] Multi-device sync works (web + PWA)
- [ ] Offline → online reconnect works
- [ ] Pinned notes always at top
- [ ] No duplicate updates via SSE
- [ ] Auth isolation verified (2+ users)
- [ ] Service Worker caching works
- [ ] Load times < 2 seconds
- [ ] No console errors
- [ ] Mobile (iOS Safari, Android Chrome) tested

---

## Phase 2: Image Support & Advanced Sync (Future)

### 2.1 UUID-Based File References
- [ ] Implement file storage (Cloudflare R2 or D1 blob)
- [ ] UUID for each file
- [ ] Link notes to files

### 2.2 OCR on Paste
- [ ] Integrate Tesseract for image → text
- [ ] Auto-extract text on image paste
- [ ] Link extracted text to image

### 2.3 Conflict Resolution
- [ ] Handle concurrent edits (User A & B edit same note)
- [ ] Last-write-wins vs. merging strategy
- [ ] Sync queue for offline writes

### 2.4 ZIP Export
- [ ] Bundle notes + images
- [ ] Export for backup/offline archival

---

## Rollback Plan

If SSE causes issues:
- [ ] Revert to polling (less efficient but simpler)
- [ ] Keep local state in sync, poll `/api/notes` every 5-10s
- [ ] Trade-off: higher latency, higher bandwidth

---

## Success Metrics (Phase 1 Complete)

| Metric | Current | Target |
|--------|---------|--------|
| Multi-tab sync delay | N/A (manual refresh) | < 100ms |
| Page load time | ~2s | < 1.5s |
| Claude API tokens/month | ? | -20% (via optimization) |
| Multi-user test | 0 users | 3+ users verified |
| Offline sync | Broken | Works without data loss |

---

## Open Questions

1. **Durable Objects cost:** Will SSE with Durable Objects exceed budget for 1-5 users?
   - **Action:** Benchmark before committing
   
2. **Multi-user schema:** Do we need per-user permissions or shared workspace?
   - **Decision:** Assume shared workspace (all users see all notes). Revisit if needed.

3. **Conflict resolution:** What's the strategy for concurrent edits?
   - **Decision:** Phase 2. For now, assume light concurrent use.

4. **Image storage:** R2 vs D1 blob vs external?
   - **Decision:** Phase 2. Defer.

---

## Dependencies

- Cloudflare Durable Objects API (for SSE)
- Wrangler CLI updated
- D1 migration system working
- GitHub Actions deployed

---

## Communication

- Post updates to this roadmap weekly
- Highlight blockers immediately
- Test on actual devices before marking "done"
