# NoteFlow — Complete Project Documentation

**Version:** 1.4  
**Last updated:** May 2026  
**Owner:** Martin Jeppesen (martin@jeppesen.cc / swamp2k)  
**Live URL:** https://notes.jeppesen.cc

---

## 1. What NoteFlow Is

NoteFlow is a personal PWA note-taking app built entirely on Cloudflare's infrastructure. It is a single-user tool for capturing notes, tracking progress on personal subjects (health, projects, journaling), visualising tag relationships, and attaching files — all with AI assistance.

There is no SaaS dependency. Every piece of infrastructure is owned and controlled by Martin.

---

## 2. Infrastructure Overview

```
Browser (PWA)
  │
  ├─ notes.jeppesen.cc          ← Cloudflare Pages (static frontend)
  │    ├─ public/index.html     ← Main notes app
  │    ├─ public/tracker.html   ← Tracker feature (standalone page)
  │    ├─ public/tagcloud.html  ← Tag Cloud / Semantic / Embeddings
  │    ├─ public/nav.js         ← Shared sidebar (loaded by all pages)
  │    └─ public/service-worker.js ← PWA offline support
  │
  └─ noteflow-api.jeppesen.cc   ← Cloudflare Worker (API + public assets)
       ├─ D1 database: noteflow
       ├─ R2 bucket: noteflow-attachments
       └─ Anthropic API (server-side, via ANTHROPIC_KEY secret)
```

### Authentication

Cloudflare Access protects `notes.jeppesen.cc`. The browser receives a `CF_Authorization` JWT cookie. The worker verifies this JWT on every API call using `TEAM_DOMAIN` and `POLICY_AUD` secrets — no session state is stored anywhere.

The worker at `noteflow-api.jeppesen.cc` has no CF Access policy. It handles its own auth by verifying the JWT included in the `Authorization: Bearer` header sent by the frontend.

---

## 3. Cloudflare Account Details

| Resource | ID / Value |
|----------|-----------|
| Account ID | `98b26d7882ddf77fcd45529f35b11202` |
| CF Access Team Domain | `https://hadus.cloudflareaccess.com` |
| CF Access Policy AUD | `3ec90fd4d44c80d81b5b2e35387ed0160410ea878adb234279738b647bba19b5` |
| D1 Database | `noteflow` / `075788a4-1d08-458e-9622-e10c561ee481` |
| R2 Bucket | `noteflow-attachments` |
| Worker | `noteflow-api` |
| Pages Project | `noteflow-frontend-dge` |

---

## 4. Worker Secrets

All secrets are set via `npx wrangler secret put <NAME>`.

| Secret | Purpose |
|--------|---------|
| `TEAM_DOMAIN` | `https://hadus.cloudflareaccess.com` — CF Access JWT verification |
| `POLICY_AUD` | CF Access application audience tag |
| `ANTHROPIC_KEY` | Anthropic API key — AI tagging, tracker AI, semantic map |
| `VOYAGE_KEY` | Voyage AI key (`pa-...`) — tag embeddings (voyage-4 model) |
| `RESEND_KEY` | Resend API key — email send feature |
| `RESEND_FROM` | From address, e.g. `NoteFlow <noteflow@jeppesen.cc>` |

**Important:** The Voyage AI key is a worker secret — it is NOT stored in D1 or anywhere in the browser. All Voyage API calls are proxied through the worker.

---

## 5. File Structure

```
noteflow/
├── worker.js              ← Cloudflare Worker — all API logic
├── wrangler.toml          ← Worker deployment config
├── service-worker.js      ← Source reference for the browser SW
│                            (also embedded in worker.js as a route)
├── schema.sql             ← D1 schema reference (never auto-run)
└── public/                ← Cloudflare Pages deployment root
    ├── index.html         ← Main notes app (4,174 lines)
    ├── tracker.html       ← Standalone tracker page (2,142 lines)
    ├── tagcloud.html      ← Standalone tag cloud page (2,169 lines)
    ├── nav.js             ← Shared sidebar builder (292 lines)
    └── service-worker.js  ← Browser service worker
```

### Deployment Commands

```bash
# Deploy the worker (API)
npx wrangler deploy

# Deploy the Pages frontend
npx wrangler pages deploy public --project-name noteflow-frontend-dge --commit-dirty=true
```

---

## 6. Architecture Decisions

### Single-user by design
NoteFlow is built for one user (Martin). Multi-user support was never a goal. `user_id` is derived from the CF Access JWT email on every request.

### D1 is the source of truth for all settings
Settings are stored as JSON in `user_settings.data`. The browser caches only display preferences (`theme`, `fontFamily`, `feedMaxWidth`, `mobileFontSize`) in `localStorage` under the key `noteflow_display_prefs` — purely for instant boot-time theming. All other settings, including sensitive keys, live in D1 only.

### No browser-side AI calls
All AI calls (Anthropic for tagging/tracker AI, Voyage for embeddings) go through the worker. The browser never holds API keys.

### Standalone page architecture
Each major feature is a separate HTML page. They share CSS and JS via `nav.js` but are otherwise fully self-contained with their own auth, settings loading, and boot sequences.

| Page | Purpose |
|------|---------|
| `index.html` | Notes feed, search, compose, settings, projects |
| `tracker.html` | Tracker entries, AI conversation, partner view |
| `tagcloud.html` | Tag graph, semantic map, embeddings view |

### nav.js — Shared Sidebar
Every page sets `window.NAV_PAGE` before loading `nav.js`:
```html
<script>window.NAV_PAGE = 'index';</script>
<script src="/nav.js"></script>
```
`nav.js` builds the full sidebar HTML into `<aside id="sidebar">` and exposes shared functions. On `index.html` it calls `window.initNavItems()` after building the sidebar so `data-view` click handlers are wired. The page's own functions take precedence over nav.js's defaults (non-overriding pattern).

### Projects are tags
Projects are not a separate entity. A note belongs to a project by having a tag in the format `project:name`. The sidebar lists all distinct `project:*` tags. No new database tables are required.

### Starred notes
The star feature is hidden from the UI (button removed, nav item removed) but the `starred` tag is preserved on any notes that have it. It can be re-enabled by adding the nav item and card button back.

---

## 7. Boot Sequence

Every page makes two parallel requests on load:

1. `GET /api/boot` — returns `{ settings, trackers, version, projectTags }` in one request
2. `GET /api/notes?pageSize=20` — first page of notes (index.html only)

The `/api/boot` endpoint combines what used to be 5 separate requests (settings, trackers, cache version, me, project tags) into a single `Promise.all` D1 call.

After boot:
- Settings are applied immediately
- Display prefs are cached to `localStorage` for next boot
- Cache version is compared — stale offline cache is cleared if server is newer
- Trackers are rendered in sidebar
- Project tags seed `_knownProjectTags` so the sidebar populates without waiting for notes

---

## 8. D1 Database Schema

### Core Tables

**`notes`** — the main note store
```sql
id TEXT PRIMARY KEY, user_id TEXT, content TEXT,
visibility TEXT DEFAULT 'PRIVATE',  -- PRIVATE | PUBLIC
pinned INTEGER DEFAULT 0,
archived INTEGER DEFAULT 0,
created_at INTEGER, updated_at INTEGER
```

**`note_tags`** — tags for notes (many-to-many)
```sql
note_id TEXT, tag TEXT, user_id TEXT
PRIMARY KEY (note_id, tag)
```
Special tag prefixes:
- `project:name` — assigns note to a project
- `hidden` — hides note from main feed
- `starred` — starred (UI hidden but preserved)

**`attachments`** — file attachments linked to notes
```sql
id TEXT, note_id TEXT, user_id TEXT,
filename TEXT, mime_type TEXT, size_bytes INTEGER,
r2_key TEXT UNIQUE,  -- key in R2 bucket
created_at INTEGER
```

**`document_index`** — OCR/text content of attachments (for search)
```sql
attachment_id TEXT, text_content TEXT, indexed_at INTEGER
```

**`users`** — created on first login
```sql
id TEXT PRIMARY KEY,  -- the CF Access email
display_name TEXT, created_at INTEGER
```

**`user_settings`** — all settings as JSON blob
```sql
user_id TEXT PRIMARY KEY, data TEXT DEFAULT '{}'
```

**`identity_aliases`** — allows a different email to map to the same user_id
```sql
jwt_email TEXT PRIMARY KEY, user_id TEXT
```

### Tracker Tables

**`tracker_subjects`** — a tracker (e.g. "Mental Health", "Balder")
```sql
id TEXT, user_id TEXT, name TEXT, instructions TEXT,
ai_model TEXT DEFAULT 'claude',  -- 'sonnet' | 'haiku'
color TEXT, archived INTEGER DEFAULT 0,
context_summary TEXT,  -- AI-generated rolling summary
created_at INTEGER, updated_at INTEGER
```

**`tracker_notes`** — entries within a tracker
```sql
id TEXT, tracker_id TEXT, user_id TEXT,
content TEXT, created_at INTEGER, updated_at INTEGER
```

**`tracker_conversations`** — AI conversation history per tracker
```sql
id TEXT, tracker_id TEXT, role TEXT, content TEXT, created_at INTEGER
```

**`tracker_share_tokens`** — partner view access tokens
```sql
id TEXT, tracker_id TEXT, token TEXT UNIQUE,
partner_name TEXT, partner_instructions TEXT,
partner_language TEXT DEFAULT 'da',
password_hash TEXT,  -- bcrypt, optional
created_at INTEGER, last_used_at INTEGER
```

**`tracker_partner_conversations`** — partner's AI conversation history
```sql
id TEXT, token_id TEXT, role TEXT, content TEXT, created_at INTEGER
```

### Embedding Table

**`tag_embeddings`** — Voyage AI embeddings for tags
```sql
user_id TEXT, tag TEXT,
vector TEXT,  -- JSON array of floats (1024 dimensions, voyage-4)
created_at INTEGER,
PRIMARY KEY (user_id, tag)
```

### Indexes

```sql
idx_notes_user                   ON notes(user_id)
idx_notes_archived               ON notes(archived)
idx_note_tags_user               ON note_tags(user_id, tag)
idx_note_tags_tag                ON note_tags(tag)
idx_attachments_note             ON attachments(note_id)
idx_attachments_user             ON attachments(user_id)
idx_tracker_notes_tracker        ON tracker_notes(tracker_id, user_id)
idx_tracker_conversations_tracker ON tracker_conversations(tracker_id)
idx_tracker_share_tokens_token   ON tracker_share_tokens(token)
```

---

## 9. Worker API Routes

All routes under `/api/*` require a valid CF Access JWT in the `Authorization: Bearer` header except for public routes.

### Public Routes (no auth)

| Route | Description |
|-------|-------------|
| `GET /service-worker.js` | Browser service worker (embedded in worker) |
| `GET /icon-192.png` | PWA icon (base64 embedded) |
| `GET /icon-512.png` | PWA icon (base64 embedded) |
| `GET /pwa/manifest.json` | PWA manifest |
| `GET /partner` | Partner view page (public tracker sharing) |

### Authenticated Routes

#### Boot & Identity
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/boot` | Settings + trackers + cache version + project tags in one call |
| GET | `/api/me` | Current user info (lazy — only called when Settings opens) |
| GET/PUT | `/api/user/settings` | Read/write settings JSON blob |

#### Notes
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/notes` | Paginated notes. Query params: `pageSize`, `cursor`, `filter` (archived/hidden/shared), `tag`, `search` |
| POST | `/api/notes` | Create note. Body: `{ content, visibility?, tags? }` |
| PATCH | `/api/notes/:id` | Update note. Body: any subset of `{ content, tags, visibility, archived, pinned }` |
| DELETE | `/api/notes/:id` | Delete note and all attachments |
| GET | `/api/notes/version` | `MAX(updated_at)` — used for cache staleness check |
| POST | `/api/notes/autotag` | AI tag suggestion via Anthropic |

#### Attachments
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/attachments` | List attachments. Query: `note_id` |
| POST | `/api/attachments` | Upload file → R2. Returns attachment record |
| DELETE | `/api/attachments/:id` | Delete from R2 and D1 |
| GET | `/api/attachments/:id/view` | Stream file from R2 |

#### Tags
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/tags` | All distinct tags for user |
| GET | `/api/tags/graph` | Tag graph data `{ tags, edges }` for force graph |
| POST | `/api/tags/contexts` | AI-powered tag context summaries |
| POST | `/api/tags/voyage-embed` | Proxy to Voyage AI embeddings API. Body: `{ texts, input_type }` |
| GET | `/api/tags/embeddings` | All stored tag vectors |
| PUT | `/api/tags/embeddings` | Batch upsert tag vectors |
| DELETE | `/api/tags/embeddings` | Clear all tag vectors |
| GET | `/api/tags/embeddings/status` | Index status (total vs indexed count) |
| GET/POST | `/api/tags/semantic-map` | Semantic coordinate generation/retrieval |

#### Trackers
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/trackers` | List all trackers for user |
| POST | `/api/trackers` | Create tracker |
| PATCH | `/api/trackers/:id` | Update tracker settings |
| DELETE | `/api/trackers/:id` | Delete tracker and all data |
| GET | `/api/trackers/:id/notes` | Paginated tracker entries |
| POST | `/api/trackers/:id/notes` | Add entry |
| PATCH | `/api/trackers/:id/notes/:noteId` | Edit entry |
| DELETE | `/api/trackers/:id/notes/:noteId` | Delete entry |
| POST | `/api/trackers/:id/ai` | Send message to tracker AI |
| GET | `/api/trackers/:id/conversation` | Get AI conversation history |
| DELETE | `/api/trackers/:id/conversation` | Clear AI conversation |
| GET | `/api/trackers/:id/export` | Export all entries as structured data |
| GET/POST/DELETE | `/api/trackers/:id/share-tokens` | Partner view token management |

#### Email
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/email/send` | Send note or tracker by email via Resend. Body: `{ note_id? | tracker_id?, to, make_public? }` |

---

## 10. Frontend Features

### index.html

**Notes Feed**
- Paginated, cursor-based (20 notes/page)
- Infinite scroll or "Load more" button
- Card max-height with expand toggle
- Inline edit (double-click) — preserves tags, triggers AI tagging in background
- Compose (top of page) — draft saved as tags are added

**Note Actions (card buttons)**
- 📁 File to project (popover with existing projects + new project input)
- 📎 Attachments (upload, view, OCR text extraction)
- 👁 Share / make public (generates share URL)
- 📧 Email (sends to `reminderEmail` in settings)
- 🗄 Archive / restore
- 🗑 Delete

**Search**
- Full-text search via `/api/search`
- Results update `searchResults` array, inline save syncs both `allMemos` and `searchResults`

**Projects**
- Tags in `project:name` format
- Sidebar "Projects" section (collapsible) lists all distinct project tags
- Clicking a project filters the feed to notes with that tag
- URL param: `/?tag=project:name`

**Settings Panel** (switchView('settings'))
- Theme (15 themes)
- Font, feed width, mobile font size
- Offline cache (days, include attachments)
- Tag categories / people hints for AI
- Email (reminder address, make-public toggle)
- Voyage AI key note (key is now a worker secret)
- Account info (lazy-loaded on open)

**Offline Support**
- Service worker caches the shell (`/`)
- Notes cached in `localStorage` under `noteflow_notes_cache`
- Cache version checked on boot via `noteflow_cache_version`
- If server version differs, cache is cleared and fresh data is fetched
- Offline queue (IndexedDB) for notes composed while offline
- Share target — Android share sheet saves links/text as notes

### tracker.html

- URL: `/tracker.html?id=<tracker_id>` or `/tracker.html?new=1`
- Sidebar shows all trackers with click-to-switch navigation
- Each tracker has: entries list, AI chat panel, settings modal
- AI uses Anthropic with prompt caching; model selectable (Sonnet/Haiku)
- Partner view: generate a shareable token URL for a second person to journal alongside you
- Export: `.md`, `.html`, or email
- Archive: hides tracker from sidebar (data preserved)

### tagcloud.html

Three views selectable via mode buttons:

**Network (Graph)** — d3.js force graph of tag relationships. Node size = note count. Edge thickness = co-occurrence. Click a node to see an ego subgraph.

**Semantic** — 2D scatter plot positioning tags by semantic similarity. Uses stored Voyage embeddings + coordinate generation via Anthropic.

**Embeddings** — Index all tags via Voyage AI. Semantic search across tags using cosine similarity.

All Voyage calls go through `POST /api/tags/voyage-embed` on the worker.

---

## 11. Settings Object (D1 Stored)

```javascript
{
  infiniteScroll: false,          // auto-load next page on scroll
  maxHeight: 0,                   // px cap on card height (0 = no cap)
  theme: 'warm',                  // one of 15 theme IDs
  attachmentsPerPage: 27,         // attachments view page size
  feedMaxWidth: 700,              // px
  mobileFontSize: 15,             // px
  fontFamily: "'DM Sans', sans-serif",
  offlineDays: 7,                 // days of notes to prefetch for offline
  offlineCacheAttachments: false, // also cache images offline
  showTags: true,                 // show tag chips on cards
  tagCategories: '',              // comma-separated hints for AI tagging
  tagPeople: '',                  // comma-separated people names for AI tagging
  voyageApiKey: '',               // DEPRECATED — now a worker secret (VOYAGE_KEY)
  reminderEmail: '',              // recipient for email sends
  emailMakePublic: false,         // auto-make-public when emailing a note
  _semanticCoords: null,          // cached semantic map coordinates
}
```

Display preferences also cached in `localStorage.noteflow_display_prefs`:
`{ theme, fontFamily, feedMaxWidth, mobileFontSize }`

---

## 12. Themes

15 themes available. Each defines 7 CSS variables:

```
--bg, --surface, --surface-alt, --accent, --text, --border, --muted
```

Theme IDs: `warm`, `arctic`, `forest`, `rose`, `lavender`, `sepia`, `stone`,
`midnight`, `obsidian`, `ink`, `charcoal`, `forest-dk`, `ember`, `nord`, `rose-dk`

---

## 13. Service Worker

Served from `GET /service-worker.js` on the worker (not from Pages, to avoid CF Access blocking).

Version: **v23**

Responsibilities:
- Cache the shell (`/` and `/index.html`) for offline fallback
- Intercept Android share target POST — save shared content as a note or queue it if offline
- Offline queue in IndexedDB: `QUEUE_MEMO`, `GET_QUEUE_SIZE`, `SYNC_QUEUE` messages
- JWT for offline API calls fetched from the page via `MessageChannel` (`GET_JWT` message)
- Does NOT intercept navigation to `/tracker.html` or `/tagcloud.html` — those hit the network

---

## 14. nav.js

Loaded by every page. Set `window.NAV_PAGE` before loading:

```html
<script>window.NAV_PAGE = 'index';    </script>  <!-- or 'tracker' or 'tagcloud' -->
<script src="/nav.js"></script>
```

**Builds:** full `<aside id="sidebar">` contents including logo, all nav items, section headers, tracker list placeholder, project list placeholder.

**Exposes (non-overriding globals):**
- `renderTrackerNav(trackers[])` — renders tracker list into `#tracker-nav-list`
- `renderProjectsNav(projectTags[])` — renders project list into `#projects-nav-list`
- `initCollapsibleSections()` — wires collapsible `data-section` headers, persists to `localStorage.noteflow_sidebar_collapsed`

**Calls after build:**
- `wireSidebarToggle()` — hamburger + overlay for mobile
- `window.initNavItems()` — if defined by the page (index.html defines this to wire `data-view` click handlers)

**Index-only extras:**
- PWA install bar below logo
- `beforeinstallprompt` event handling
- Notes-specific nav buttons (Hidden, Archive, Shared) as `<button data-view>`

---

## 15. Known Limitations / Backlog

- `voyageApiKey` field remains in the `settings` object for migration compatibility but is otherwise inert
- `ai_providers` and `user_ai_providers` tables exist from an earlier multi-provider experiment but are unused
- Tag Cloud CSS (~90 rules) remains in `index.html` as dead CSS — harmless, cosmetic cleanup only
- Partner page HTML is embedded in `worker.js` as a template literal — could move to R2
- Icons (192px, 512px) are base64-embedded in `worker.js` — could move to R2

---

## 16. Secrets Restoration Reference

If secrets are ever lost from the worker:

```bash
npx wrangler secret put TEAM_DOMAIN
# value: https://hadus.cloudflareaccess.com

npx wrangler secret put POLICY_AUD
# value: 3ec90fd4d44c80d81b5b2e35387ed0160410ea878adb234279738b647bba19b5

npx wrangler secret put ANTHROPIC_KEY
# value: sk-ant-...

npx wrangler secret put VOYAGE_KEY
# value: pa-...

npx wrangler secret put RESEND_KEY
# value: re_...

npx wrangler secret put RESEND_FROM
# value: NoteFlow <noteflow@jeppesen.cc>
```

The `POLICY_AUD` and `TEAM_DOMAIN` can always be recovered by decoding the `CF_Authorization` cookie from any authenticated browser session — the JWT payload contains `iss` (= TEAM_DOMAIN) and `aud` (= POLICY_AUD array).
