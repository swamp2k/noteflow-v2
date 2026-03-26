# NoteFlow v2

Real-time, multi-user AI-assisted note-taking and journaling app.

**Status:** Phase 1 — Real-time sync & optimization  
**Stack:** Cloudflare (Pages + Workers + D1)  
**Primary:** Web-first PWA. Native apps optional future.

---

## Quick Start

```bash
# Install
npm install

# Local dev (with Workers emulator)
wrangler dev

# Deploy (auto via GitHub Actions on push)
git push origin main
```

---

## Features

- 📝 **Tracking System** — AI-powered journal entries with Claude Haiku summaries
- 🔍 **Semantic Search** — Gemini embeddings + cosine similarity
- 🌐 **Omni-Search** — Google Drive & Gmail integration
- 👥 **Multi-User** — Auth via Cloudflare, 1-5 user support
- ⚡ **Real-Time Sync** — (Phase 1) SSE-based multi-tab/device updates
- 📱 **PWA** — Offline-capable with Service Workers + IndexedDB

---

## Project Structure

```
noteflow-v2/
├── README.md                 # This file
├── docs/
│   ├── ARCHITECTURE.md       # Tech stack & design decisions
│   ├── ROADMAP.md            # Phase 1 priorities & timeline
│   ├── DATABASE.md           # D1 schema & migrations
│   └── API.md                # Worker endpoint reference
├── migrations/               # D1 SQL migrations
├── src/
│   ├── frontend/             # React SPA (Cloudflare Pages)
│   ├── workers/              # Cloudflare Workers (API)
│   └── shared/               # Shared utilities, types
├── wrangler.toml             # Cloudflare config
├── package.json
└── .github/
    └── workflows/
        └── deploy.yml        # Auto-deploy on push
```

---

## Phase 1: Real-Time & Optimization

### Priority 1: SSE Multi-Tab/Device Sync
- [ ] Implement SSE endpoint in Worker
- [ ] Add real-time listener hook in React
- [ ] Test multi-tab auto-refresh
- [ ] Test multi-device sync (web + PWA)

### Priority 2: Fix Pinned Note Ordering
- [ ] Debug pinned note sort logic
- [ ] Ensure UI respects pinned flag on new entries
- [ ] Test across refresh

### Priority 3: Token & Speed Optimization
- [ ] Profile Haiku prompt (reduce output tokens?)
- [ ] Batch Gemini embedding requests
- [ ] Review D1 query patterns
- [ ] Lazy-load images

### Priority 4: Multi-User Testing
- [ ] Set up test users in D1
- [ ] Verify auth isolation
- [ ] Test concurrent edits

---

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | React 18, Service Workers, IndexedDB |
| **Backend** | Cloudflare Workers |
| **Database** | D1 (SQLite) |
| **Auth** | Cloudflare OAuth |
| **AI** | Claude Haiku (Anthropic), Gemini (Google) |
| **Hosting** | Cloudflare Pages |
| **Deployment** | GitHub Actions |

---

## Getting Started with Development

### Set up Cloudflare Tools
```bash
npm install -g wrangler
npm install -g @cloudflare/wrangler
```

### Configure wrangler.toml
```toml
name = "noteflow-v2"
type = "service-worker"
account_id = "YOUR_ACCOUNT_ID"
workers_dev = true

[env.production]
routes = [{ pattern = "*.jeppesen.cc/*", zone_id = "YOUR_ZONE_ID" }]

[[d1_databases]]
binding = "DB"
database_name = "noteflow"
```

### Run Locally
```bash
# Starts local Pages + Workers dev server
wrangler dev
```

### Deploy
```bash
# Automatic via GitHub Actions on push to main
# Or manual:
wrangler deploy
```

---

## API Endpoints (Worker)

See `/docs/API.md` for full reference. Key routes:

```
GET  /api/notes              # List user's notes
POST /api/notes              # Create note
GET  /api/notes/:id          # Get note
PUT  /api/notes/:id          # Update note
DELETE /api/notes/:id        # Delete note

GET  /api/tracking           # Get tracking entries
POST /api/tracking           # Create entry

GET  /api/search?q=term      # Search (semantic)
GET  /api/sync               # SSE: subscribe to updates
```

---

## Database

See `/docs/DATABASE.md` for full schema.

**Key tables:**
- `users` — user accounts
- `tracking` — journal collections
- `tracking_entries` — individual entries (with embeddings)
- `tracking_summaries` — AI summaries
- `search_metadata` — connector state (Google Drive, Gmail)

### Run Migrations
```bash
wrangler d1 migrations create noteflow init
wrangler d1 migrations apply noteflow
```

---

## Deployment

**Automatic:** Push to `main` → GitHub Actions builds & deploys to Cloudflare.

**Manual:**
```bash
wrangler deploy
```

**Preview:** `https://noteflow-v2.YOUR_DOMAIN.workers.dev`

---

## Environment Variables

Set in Cloudflare:
```
CLAUDE_API_KEY=sk-...
GEMINI_API_KEY=...
GOOGLE_OAUTH_ID=...
GOOGLE_OAUTH_SECRET=...
```

---

## Contributing / Development Notes

- Always test multi-tab sync when modifying note state
- Profile D1 queries — Cloudflare has limits
- Batch API calls to external services (Claude, Gemini)
- PWA offline: test with DevTools > Application > Service Workers

---

## Resources

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Docs](https://developers.cloudflare.com/d1/)
- [Anthropic Claude API](https://anthropic.com/api)
- [Google Gemini API](https://ai.google.dev/)

---

## License

Private project.
