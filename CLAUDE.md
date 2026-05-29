# NoteFlow — AI Assistant Onboarding Guide

This file tells you everything you need to work on the NoteFlow codebase. Read it fully before making any changes.

---

## Keeping This File Current

**Update CLAUDE.md as part of every change.** When you add a feature, change a data model, rename a function, update a setting key, or alter a pattern — update the relevant section here in the same commit. This file is the single source of truth for the next assistant; stale docs cause bugs.

Specifically update when:
- A new DB column is added (update the schema section and notes table docs)
- A settings key is added, renamed, or removed (update the settings keys list)
- A new route is added to a handler (update the handler's comment in the repo structure)
- A frontend pattern changes (update Key Frontend Patterns)
- A common mistake is discovered (add it to Common Mistakes)
- The service worker version is bumped (update the File Reference)
- The boot sequence changes (update Boot Sequence)

---

## What This Project Is

NoteFlow is a personal PWA note-taking app for one user (Martin, martin@jeppesen.cc). It runs entirely on Cloudflare infrastructure. There is no framework, no bundler, no npm dependencies in the frontend — everything is vanilla JS, HTML, and CSS.

**Live URL:** https://notes.jeppesen.cc

---

## Repository Structure

```
noteflow-v2/
├── worker/                    ← Cloudflare Worker (ES modules)
│   ├── index.js               ← Router only — imports handlers, orchestrates auth (74 lines)
│   ├── lib/
│   │   ├── utils.js           ← nanoid, extractTags, corsHeaders, openCors, json, jsonOpen, err, errOpen, sha256hex
│   │   ├── auth.js            ← checkPartnerPassword, resolveModel, verifyJWT, ensureUser
│   │   ├── ai.js              ← ensureTagEmbeddingsTable, buildTrackerContext, callTrackerAI, callPartnerAI, shouldIndex, indexDocument
│   │   └── notifications.js   ← runTaskNotifications(env) — per-task notification cron handler
│   └── handlers/
│       ├── notes.js           ← /api/notes, /api/notes/:id, /api/notes/:id/complete, /api/notes/version, /api/notes/tag-contexts
│       ├── tags.js            ← /api/tags, /api/tags/graph
│       ├── attachments.js     ← /api/attachments, /api/attachments/:id, /api/admin/reindex
│       ├── tracker.js         ← /api/trackers, /api/trackers/:id, etc.
│       ├── partner.js         ← /partner page, /api/partner/:token/*, /api/trackers/:id/partner-tokens
│       ├── user.js            ← /api/boot, /api/me, /api/user/settings
│       ├── search.js          ← /api/search, /api/notes/autotag
│       ├── email.js           ← /api/email/send
│       ├── push.js            ← /api/push/vapid-key (GET), /api/push/subscribe (POST, DELETE)
│       ├── project-ai.js      ← /api/project-ai (project context AI panel)
│       └── public.js          ← service-worker.js, icons, manifest, /api/public/notes/:id, /api/public/attachments/:id
├── wrangler.toml              ← Worker deployment config; includes [triggers] crons = ["0 * * * *"]
├── service-worker.js          ← Source for the browser service worker
├── schema.sql                 ← D1 schema reference (never auto-run)
└── public/                    ← Cloudflare Pages (deployed as static files)
    ├── index.html             ← Main notes app (~1800 lines, no inline JS)
    ├── tracker.html           ← Tracker feature (standalone page)
    ├── tagcloud.html          ← Tag Cloud / Semantic / Embeddings (standalone)
    ├── nav.js                 ← Shared sidebar — loaded by all three pages
    ├── service-worker.js      ← Browser service worker (v25)
    └── js/                    ← Frontend JS modules (plain <script> tags, shared global scope)
        ├── state.js           ← All global state variables (API_BASE, allMemos, settings, etc.)
        ├── api.js             ← getCFToken, authHeaders, apiGet, apiPatch, apiPost, apiDelete, uploadAttachment
        ├── utils.js           ← attachmentUrl, isImageAttachment, escHtml, fileIcon, toast, formatDate
        ├── cache.js           ← getCachedVersion, setCachedVersion, clearNotesCache, saveNotesCache, loadNotesCache, getAttachmentBlob, prefetchOfflineCache
        ├── settings.js        ← saveSettings, loadSettings, applyTheme, applyFeedWidth, applyFontFamily, syncSettingsControls, initSettingsControls
        ├── email.js           ← sendNoteByEmail
        ├── account.js         ← renderTrackerNav, loadTrackers, loadAccountInfo
        ├── composer.js        ← aiTags, addFile, renderImagePreviews, mdInsert, attachMdToolbar, setupComposer IIFE
        ├── notes.js           ← loadMemos, fetchAllMemos, getViewTitle, toggleArchive, confirmDelete, renderFeed, updateCard, removeCard
        ├── card.js            ← buildCard, makeActionBtn, openProjectPopover, openMorePopover, toggleTag, openShareModal
        ├── tasks.js           ← renderTasksFeed, openTasksOverlay, closeTasksOverlay, openTaskDetail, quickAddTask, completeTask, saveTaskFields, buildTaskCard, buildTaskRow
        ├── lightbox.js        ← openLightbox, openFilePreview, renderLightbox, closeLightbox, touch/zoom IIFE
        ├── view-nav.js        ← renderProjectsNav, initCollapsibleSections, switchView, initNavItems, infiniteObserver
        ├── offline.js         ← ensureOfflineUI, setOffline, updateQueueBadge, checkSharePending, openComposerWithContent
        ├── project-ai.js      ← project AI panel rendering (shown when viewing a project tag)
        ├── push.js            ← subscribeToPush, unsubscribeFromPush (Web Push)
        └── app.js             ← marked.use() config, initAuth(), checkPublicShare IIFE, boot sequence, SW registration
```

---

## Deployment

Both the worker and Pages frontend deploy **automatically on every push to `main`** of `github.com:swamp2k/noteflow-v2`.

**Pages build output directory is `/public`** — root-level files (`wrangler.toml`, `CLAUDE.md`, etc.) and `worker/` are NOT served publicly.

**Manual deployment (fallback only):**
```bash
# Worker
npx wrangler deploy

# Pages
npx wrangler pages deploy public --project-name noteflow-v2 --commit-dirty=true
```

**Never use the Cloudflare Dashboard Quick Edit** to deploy the worker. Always use wrangler CLI — the dashboard can silently corrupt module format.

The old Pages project `noteflow-frontend-dge` has been decommissioned — do not reference it.

---

## Cloudflare Resources

| Resource | Value |
|----------|-------|
| Account ID | `98b26d7882ddf77fcd45529f35b11202` |
| D1 database | `noteflow` / ID: `075788a4-1d08-458e-9622-e10c561ee481` |
| R2 bucket | `noteflow-attachments` |
| Worker name | `noteflow-api` |
| Pages project | `noteflow-v2` (GitHub-linked, replaces `noteflow-frontend-dge`) |
| GitHub Repository | `github.com:swamp2k/noteflow-v2` |
| CF Access team | `https://hadus.cloudflareaccess.com` |
| CF Access AUD | `3ec90fd4d44c80d81b5b2e35387ed0160410ea878adb234279738b647bba19b5` |

---

## Worker Secrets

```
TEAM_DOMAIN        = https://hadus.cloudflareaccess.com
POLICY_AUD         = 3ec90fd4d...b647bba19b5  (CF Access audience tag)
ANTHROPIC_KEY      = sk-ant-...              (AI features)
VOYAGE_KEY         = pa-...                  (tag embeddings via voyage-4)
RESEND_KEY         = re_...                  (email send feature)
RESEND_FROM        = NoteFlow <noteflow@jeppesen.cc>
VAPID_PUBLIC_KEY   = BFGSFyPT9QR...          (Web Push — set via: echo "..." | npx wrangler secret put VAPID_PUBLIC_KEY)
VAPID_PRIVATE_KEY  = ncUi3S5y...             (Web Push)
VAPID_SUBJECT      = mailto:martin@jeppesen.cc
```

---

## Architecture Rules (Critical — Do Not Break These)

### 1. D1 is the source of truth for ALL settings
Settings are stored as a JSON blob in `user_settings.data`. The browser caches ONLY `theme`, `fontFamily`, `feedMaxWidth`, and `mobileFontSize` in `localStorage` under the key `noteflow_display_prefs` — purely for instant boot-time theming. Sensitive keys and all other settings live in D1 only and are never touched by localStorage.

The `saveSettings()` function has a guard: `if (!_settingsLoaded) return;` — it refuses to save until `/api/boot` has returned, to prevent overwriting D1 with default values on boot.

### 2. No browser-side API keys
All AI calls (Anthropic tagging, tracker AI, Voyage embeddings) go through the worker. The browser never calls Anthropic or Voyage directly. The worker proxies Voyage at `POST /api/tags/voyage-embed`.

### 3. Each HTML page is standalone
`index.html`, `tracker.html`, and `tagcloud.html` are each fully self-contained — they have their own settings loading, auth, theme application, and boot sequences. They share CSS from `nav.js` but are otherwise independent. A change to tracker.html cannot break index.html.

### 4. nav.js must not override page functions
`nav.js` is loaded after the main page script. It uses non-overriding globals:
```javascript
if (!window.renderTrackerNav) { window.renderTrackerNav = function(...) {...}; }
```
This means if a page defines its own version (tracker.html does for `renderTrackerNav`), nav.js respects it.

### 5. The SW only caches the root path
The service worker intercepts navigation only for `/` and `/index.html`. Navigation to `/tracker.html` and `/tagcloud.html` must go to the network — do not change this or those pages will stop working.

---

## Auth Flow

1. User visits `notes.jeppesen.cc` — Cloudflare Access intercepts, issues `CF_Authorization` cookie (JWT)
2. Frontend reads cookie: `document.cookie.match(/CF_Authorization=([^;]+)/)`
3. Frontend sends JWT in every API call: `Authorization: Bearer <jwt>`
4. Worker's `verifyJWT(token, env)` (in `worker/lib/auth.js`) validates signature using JWKS from `TEAM_DOMAIN`
5. Worker extracts `userId` from JWT claims (email or aliased user_id)

---

## Boot Sequence

Every page makes ONE combined boot request on load:

```
GET /api/boot
→ { settings, trackers, version, projectTags }
```

This replaces 5 separate requests. It runs as `Promise.all` on the worker:
- `SELECT data FROM user_settings WHERE user_id=?`
- `SELECT * FROM tracker_subjects WHERE user_id=? ORDER BY created_at`
- `SELECT MAX(updated_at) FROM notes WHERE user_id=? AND archived=0`
- `SELECT DISTINCT tag FROM note_tags WHERE user_id=? AND tag LIKE 'project:%'`

After boot, the frontend (`app.js`):
1. Applies settings (theme, font, width)
2. Caches display prefs to localStorage
3. Checks cache version — clears offline cache if stale
4. Renders sidebar (trackers + project tags) immediately
5. Reads `?v=` URL param to restore view. If `v=tasks`, calls `renderTasksFeed()`. Otherwise calls `loadMemos()` for the notes feed.

**Critical:** Never call `loadMemos()` when the view is `tasks`. The tasks feed uses `renderTasksFeed()` (defined in `tasks.js`). `loadMemos()` fetches regular notes and calls `renderFeed()`, which produces an empty or wrong result in the tasks view.

---

## Worker Handler Pattern

Each handler module exports a single async function with this signature:

```javascript
export async function fooHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path === "/api/foo" && method === "GET") {
    // ... handle route
    return json({ ... }, 200, origin);
  }
  return null; // not matched — let the next handler try
}
```

The router in `worker/index.js` calls handlers sequentially; the first non-null response wins.

**Special case — `partnerHandler`** is called **twice**:
1. Before auth: handles the `/partner` page and `/api/partner/:token/*` public routes
2. After auth: handles `/api/trackers/:id/partner-tokens`

Inside `partnerHandler`, the guard `if (!userId) return null` prevents the auth-required partner-token routes from running pre-auth.

---

## Frontend JS Module Pattern

The `public/js/` files are loaded as plain `<script src>` tags in `index.html` (NOT ES modules). They share the global `window` scope — no `import`/`export`. Load order in `index.html` matters only for load-time execution; forward references inside function bodies are fine since all scripts load before any are called.

Script load order in `index.html` (bottom of `<body>`):
1. `state.js` — must be first (defines globals used by all others)
2. `api.js`, `utils.js`, `cache.js` — utilities
3. `settings.js`, `email.js`, `account.js` — feature modules
4. `composer.js`, `notes.js`, `card.js` — core UI
5. `tasks.js`, `lightbox.js`, `view-nav.js`, `offline.js` — UI/UX
6. `project-ai.js`, `push.js` — late feature modules
7. `app.js` — boot sequence (must be last)

---

## Key Frontend Patterns

### Settings save guard
```javascript
let _settingsLoaded = false;
function saveSettings() {
  if (!_settingsLoaded) return; // prevents overwriting D1 before boot completes
  // ...
}
```

### Targeted card updates (performance)
Do NOT call `renderFeed()` for single-note operations. Use:
```javascript
updateCard(memo)   // replaces one card DOM node
removeCard(memoId) // removes one card from DOM
```
`renderFeed()` is only for full list rebuilds (view switches, new notes, pagination).

For tasks specifically, use `buildTaskCard(task)` and replace the existing card DOM node directly. `renderTasksFeed()` is only for full task list rebuilds.

### Tag system
Tags are strings in `note_tags`. Special prefixes:
- `project:name` — assigns a note to a project
- `hidden` — hides from main feed
- `starred` — starred (UI hidden but preserved in data)

Projects sidebar derives from `DISTINCT tag WHERE tag LIKE 'project:%'` — no separate table.

### Offline cache
```javascript
const NOTES_CACHE_KEY     = 'noteflow_notes_cache';
const NOTES_CACHE_VERSION = 'noteflow_cache_version';
```
After every note save, update the version:
```javascript
saveNotesCache(allMemos, newVersion);
setCachedVersion(Math.max(getCachedVersion(), newVersion));
```

### Tasks feature state (state.js)
```javascript
let taskSortOrder    = localStorage.getItem('noteflow_task_sort') || 'priority';
let tasksOverlayOpen = false;
```
`taskSortOrder` is the one settings value stored in localStorage (not D1) because it's a transient UI preference, not a user setting.

`settings` object keys for tasks and notifications:
```
tasks_hide_from_main_feed, tasks_default_priority, tasks_show_completed, tasks_show_count_badge
notif_enabled
notif_discord_enabled, notif_discord_webhook
notif_email_enabled, notif_email_address
notif_push_enabled
```

Removed keys (no longer used): `notif_send_time`, `notif_trigger_due_today`, `notif_trigger_overdue`, `notif_trigger_due_soon` — these were replaced by per-task notification fields on the notes table.

### Task card layout (`buildTaskCard` in tasks.js)
```
[ checkbox ] [ title (first line of content)         ]
[ priority badge ] [ due date chip ] [ 🔔 notif chip ]
[ tags (optional) ]
```
- Priority badge is clickable — replaces itself with a `<select>` for inline editing.
- Due date chip and notification chip open the task detail modal on click (no inline input on the card — date inputs are too unreliable on mobile).
- No Edit/Archive action buttons on the card — click anywhere to open the detail modal.
- After `openTaskDetail` closes, a `MutationObserver` rebuilds the card from the updated `liveTask` object, so changes in the modal are immediately reflected without re-rendering the whole feed.

### Task detail modal (openTaskDetail in tasks.js)
Fields and their save behaviour:
- **Content** (textarea) — saves on blur
- **Due date** (`#td-due-date`) — saves on change
- **Priority** (`#td-priority`) — saves on change
- **Notification days** (`#td-notif-days`) + **time** (`#td-notif-time`) — both saved together on either field's change event, writing `notif_days_before` and `notif_time` to D1

A `liveTask` copy is maintained inside `openTaskDetail`. Each save handler updates `liveTask` as well as calling `saveTaskFields`. When the modal's `open` class is removed, the `MutationObserver` fires and rebuilds the task card and overlay row from `liveTask`.

### Tasks API query params (`GET /api/notes`)
- `?is_task=1` — return only tasks with `completed_at IS NULL`
- `?completed=1` — combined with `is_task=1`, return completed tasks
- `?hide_tasks=1` — exclude tasks from main notes feed (appended client-side when `settings.tasks_hide_from_main_feed` is true)
- `?sort=priority|due_date|created` — task sort order (NULLS LAST via `CASE WHEN`)

`PATCH /api/notes/:id/complete` — sets `completed_at` to current ISO timestamp or `null`. Note: `completed_at` is TEXT ISO 8601, while `created_at`/`updated_at` are INTEGER Unix seconds — intentional, documented in `schema.sql`.

### Per-task notifications (notifications.js)
The cron (`0 * * * *`) queries tasks where `notif_days_before IS NOT NULL AND notif_time IS NOT NULL`. For each, it calculates `notification_date = due_date − notif_days_before days` and fires if `notification_date == today` AND `UTC hour == notif_time hour`. Notifications go out via the channels enabled in user settings (email/Discord/push). There is no global "send at" time — timing is entirely per-task.

### D1 table: push_subscriptions
```sql
push_subscriptions (id TEXT PK, user_id TEXT, endpoint TEXT UNIQUE,
                    p256dh TEXT, auth_key TEXT, created_at INTEGER)
```
`/api/push/vapid-key` returns only `{ publicKey }` — never exposes `p256dh` or `auth_key` to the client.

### Cron trigger
`wrangler.toml` has `[triggers] crons = ["0 * * * *"]`. `worker/index.js` exports `scheduled(event, env, ctx)` which calls `runTaskNotifications(env)` from `worker/lib/notifications.js`. The handler runs every hour and fires notifications for tasks whose per-task `notif_days_before` + `notif_time` matches the current date and UTC hour.

---

## D1 Schema — notes table task columns

```sql
is_task           INTEGER NOT NULL DEFAULT 0,
due_date          TEXT,           -- ISO 8601 date "YYYY-MM-DD", nullable
priority          INTEGER,        -- 1=High, 2=Medium, 3=Low, NULL=none
completed_at      TEXT,           -- ISO 8601 datetime, NULL=incomplete
notif_days_before INTEGER,        -- days before due_date to notify (0=on day), NULL=disabled
notif_time        TEXT            -- "HH:MM" UTC, NULL=disabled
```

Both `notif_days_before` and `notif_time` must be non-null for a notification to fire. Setting either to null disables the notification for that task.

---

## nav.js Contract

Each page must:
```html
<aside id="sidebar"></aside>  <!-- empty placeholder — nav.js fills it -->
<script>window.NAV_PAGE = 'index'; /* or 'tracker' or 'tagcloud' */</script>
<script src="/nav.js"></script>
```

After boot, each page calls:
```javascript
renderTrackerNav(trackers);          // populate tracker list in sidebar
renderProjectsNav(boot.projectTags); // populate project list in sidebar
initCollapsibleSections();           // wire collapse/expand on section headers
```

On `index.html`, also call (after nav.js loads):
```javascript
initNavItems(); // wires data-view button click handlers
```
This is called automatically by nav.js via `if (typeof window.initNavItems === 'function') window.initNavItems()`.

---

## tracker.html Specifics

- `trackers` is a global `let trackers = []` — set it before calling `renderTrackerNav()`
- `switchToTracker(tr)` — loads a tracker in-page. It does NOT reference `#feed`, `#load-more`, etc. (those don't exist here). It updates the title, color dot, sidebar highlight, and URL param
- `leaveTrackerView()` — no-op in standalone mode (navigation happens via sidebar `<a>` links)
- URL param `?id=<tracker_id>` — boot reads this and calls `switchToTracker(tr)` automatically
- URL param `?new=1` — boot calls `openNewTrackerModal()` automatically

---

## tagcloud.html Specifics

- `SPECIAL_TAGS = ['hidden', 'starred']` is defined locally — never put it in a shared file
- `voyageEmbed(texts, inputType)` calls the worker proxy, NOT Voyage directly
- The tag cloud page is always visible (`display: flex !important`) — there's no toggling
- Page layout: `#tag-cloud-page` is `position: fixed; left: var(--sidebar-w); top: 0; right: 0; bottom: 0`
- Three views: `buildForceGraph()`, `buildSemanticGraph()`, embeddings via `tcIndexTags()`
- d3.js is lazy-loaded on first graph render via `loadD3()`

---

## D1 Patterns

```javascript
// Read single row
const row = await env.DB.prepare("SELECT ... FROM ... WHERE id=?").bind(id).first();

// Read multiple rows
const { results } = await env.DB.prepare("SELECT ...").bind(param).all();

// Write
await env.DB.prepare("INSERT INTO ... VALUES (?,?)").bind(a, b).run();

// Batch write
await env.DB.batch([
  env.DB.prepare("INSERT ...").bind(...),
  env.DB.prepare("UPDATE ...").bind(...),
]);
```

### Prompt caching
Anthropic calls use `anthropic-beta: prompt-caching-2024-07-31` with `cache_control: { type: "ephemeral" }` on system prompts — this saves cost on multi-turn tracker conversations.

---

## Common Mistakes to Avoid

1. **Never call `renderFeed()` inside a for loop or after every single note update.** Use `updateCard(memo)` instead.

2. **Never write to `localStorage` with settings data.** Only `noteflow_display_prefs` (the 4 display keys) goes to localStorage. Everything else stays in D1.

3. **Never reference index.html-only DOM elements from tracker.html or tagcloud.html.** Elements like `#feed`, `#load-more`, `#composer`, `#settings-page`, `main` do not exist in the standalone pages.

4. **Never let the SW intercept `/tracker.html` or `/tagcloud.html` navigation.** The SW only caches `/` and `/index.html`.

5. **Never define a function in nav.js that overrides an existing page function.** Always use the non-overriding pattern: `if (!window.fn) { window.fn = function() {...}; }`

6. **Never fire `saveSettings()` before `_settingsLoaded = true`.** The guard exists for a reason — without it, a race condition on boot wipes D1 settings with defaults.

7. **Never add a `VOYAGE_KEY` input to the settings UI.** The key is a worker secret. The settings field `voyageApiKey` still exists in the object for migration but is inert.

8. **Never add `export`/`import` to `public/js/*.js` files.** They are plain scripts sharing global scope — not ES modules. Adding module syntax will break them.

9. **When editing a worker handler, return `null` for unmatched routes** — do not return a 404 from inside a handler. The router in `worker/index.js` emits the final 404.

10. **Never remove the `tasks-overlay-open` body class toggle from `openTasksOverlay()`/`closeTasksOverlay()`.** The toast (`#toast`, fixed at `bottom: 24px`) overlaps the tasks bottom-sheet on mobile. CSS in `index.html` uses `body.tasks-overlay-open #toast` to reposition the toast to `top: 20px` when the overlay is open. Removing the toggle breaks toast visibility during task operations.

11. **Never call `loadMemos()` when the current view is `tasks`.** The tasks feed uses `renderTasksFeed()`. Calling `loadMemos()` on the tasks view fetches regular notes and `renderFeed()` renders nothing useful. The boot sequence in `app.js` already handles this — preserve the `if (currentView === 'tasks')` branch.

12. **Never add `notif_send_time` or `notif_trigger_*` settings fields back.** These were intentionally removed — per-task notification scheduling via `notif_days_before` + `notif_time` on the note replaces them entirely. The settings UI only has the channels (email/Discord/push) and the master `notif_enabled` toggle.

13. **When bumping the service worker version, update it in two places:** the comment on line 1 (`// NoteFlow Service Worker vN`) and the `CACHE_NAME` constant. Also update the version reference in this file's Repository Structure section.

---

## Testing Checklist After Any Change

- [ ] Syntax-check all modified worker JS: `node --check worker/index.js && node --check worker/lib/*.js && node --check worker/handlers/*.js`
- [ ] Settings save and persist across page reload
- [ ] Theme applies immediately on boot (no flash of wrong theme)
- [ ] Trackers load in sidebar on all three pages
- [ ] Clicking a tracker in sidebar opens it (tracker.html only — other pages link to tracker.html)
- [ ] Tag Cloud renders graph on page load
- [ ] Projects appear in sidebar without reloading
- [ ] Inline note edit preserves existing tags (including starred, hidden, project:*)
- [ ] Archive and delete remove the card without full re-render
- [ ] Service worker does not intercept tracker.html or tagcloud.html navigation
- [ ] Tasks view: F5 refresh shows tasks (not empty feed)
- [ ] Tasks view: changing priority/date/notification in modal updates the card immediately on close
- [ ] Tasks view: notification chip appears on card when notif_days_before + notif_time are set
- [ ] `npx wrangler deploy` succeeds without errors

---

## File Reference (May 2026)

| File | Role |
|------|------|
| `worker/index.js` | Router + `scheduled()` cron export |
| `worker/lib/utils.js` | Shared utilities (nanoid, CORS, JSON helpers) |
| `worker/lib/auth.js` | JWT verification + user resolution |
| `worker/lib/ai.js` | AI + embedding helpers (Anthropic, Voyage) |
| `worker/lib/notifications.js` | Per-task notification cron (fires on notif_days_before + notif_time match) |
| `worker/handlers/*.js` | 11 route handler modules |
| `schema.sql` | D1 schema reference (never auto-run) |
| `public/index.html` | Main app shell (no inline JS) |
| `public/js/state.js` | Global state (must load first) |
| `public/js/tasks.js` | Tasks feed, overlay, detail modal, card/row builders, quick-add |
| `public/js/push.js` | Web Push subscription management |
| `public/js/project-ai.js` | Project AI panel |
| `public/js/app.js` | Boot sequence (must load last) |
| `public/js/*.js` | 17 frontend modules total (plain scripts, shared scope) |
| `public/service-worker.js` | Offline queue + push notification handler (v25) |


---

## What This Project Is

NoteFlow is a personal PWA note-taking app for one user (Martin, martin@jeppesen.cc). It runs entirely on Cloudflare infrastructure. There is no framework, no bundler, no npm dependencies in the frontend — everything is vanilla JS, HTML, and CSS.

**Live URL:** https://notes.jeppesen.cc

---

## Repository Structure

```
noteflow-v2/
├── worker/                    ← Cloudflare Worker (ES modules)
│   ├── index.js               ← Router only — imports handlers, orchestrates auth (74 lines)
│   ├── lib/
│   │   ├── utils.js           ← nanoid, extractTags, corsHeaders, openCors, json, jsonOpen, err, errOpen, sha256hex
│   │   ├── auth.js            ← checkPartnerPassword, resolveModel, verifyJWT, ensureUser
│   │   ├── ai.js              ← ensureTagEmbeddingsTable, buildTrackerContext, callTrackerAI, callPartnerAI, shouldIndex, indexDocument
│   │   └── notifications.js   ← runTaskNotifications(env) — cron handler for task due-date alerts
│   └── handlers/
│       ├── notes.js           ← /api/notes, /api/notes/:id, /api/notes/:id/complete, /api/notes/version, /api/notes/tag-contexts
│       ├── tags.js            ← /api/tags, /api/tags/graph
│       ├── attachments.js     ← /api/attachments, /api/attachments/:id, /api/admin/reindex
│       ├── tracker.js         ← /api/trackers, /api/trackers/:id, etc.
│       ├── partner.js         ← /partner page, /api/partner/:token/*, /api/trackers/:id/partner-tokens
│       ├── user.js            ← /api/boot, /api/me, /api/user/settings
│       ├── search.js          ← /api/search, /api/notes/autotag
│       ├── email.js           ← /api/email/send
│       ├── push.js            ← /api/push/vapid-key (GET), /api/push/subscribe (POST, DELETE)
│       ├── project-ai.js      ← /api/project-ai (project context AI panel)
│       └── public.js          ← service-worker.js, icons, manifest, /api/public/notes/:id, /api/public/attachments/:id
├── wrangler.toml              ← Worker deployment config; includes [triggers] crons = ["0 * * * *"]
├── service-worker.js          ← Source for the browser service worker
├── schema.sql                 ← D1 schema reference (never auto-run)
└── public/                    ← Cloudflare Pages (deployed as static files)
    ├── index.html             ← Main notes app (~1539 lines, no inline JS)
    ├── tracker.html           ← Tracker feature (standalone page)
    ├── tagcloud.html          ← Tag Cloud / Semantic / Embeddings (standalone)
    ├── nav.js                 ← Shared sidebar — loaded by all three pages
    ├── service-worker.js      ← Browser service worker
    └── js/                    ← Frontend JS modules (plain <script> tags, shared global scope)
        ├── state.js           ← All global state variables (API_BASE, allMemos, settings, etc.)
        ├── api.js             ← getCFToken, authHeaders, apiGet, apiPatch, apiPost, apiDelete, uploadAttachment
        ├── utils.js           ← attachmentUrl, isImageAttachment, escHtml, fileIcon, toast, formatDate
        ├── cache.js           ← getCachedVersion, setCachedVersion, clearNotesCache, saveNotesCache, loadNotesCache, getAttachmentBlob, prefetchOfflineCache
        ├── settings.js        ← saveSettings, loadSettings, applyTheme, applyFeedWidth, applyFontFamily, syncSettingsControls, initSettingsControls
        ├── email.js           ← sendNoteByEmail
        ├── account.js         ← renderTrackerNav, loadTrackers, loadAccountInfo
        ├── composer.js        ← aiTags, addFile, renderImagePreviews, mdInsert, attachMdToolbar, setupComposer IIFE
        ├── notes.js           ← loadMemos, fetchAllMemos, getViewTitle, toggleArchive, confirmDelete, renderFeed, updateCard, removeCard
        ├── card.js            ← buildCard, makeActionBtn, openProjectPopover, openMorePopover, toggleTag, openShareModal
        ├── tasks.js           ← renderTasksFeed, openTasksOverlay, closeTasksOverlay, openTaskDetail, quickAddTask, completeTask, saveTaskFields, buildTaskCard
        ├── lightbox.js        ← openLightbox, openFilePreview, renderLightbox, closeLightbox, touch/zoom IIFE
        ├── view-nav.js        ← renderProjectsNav, initCollapsibleSections, switchView, initNavItems, infiniteObserver
        ├── offline.js         ← ensureOfflineUI, setOffline, updateQueueBadge, checkSharePending, openComposerWithContent
        ├── project-ai.js      ← project AI panel rendering (shown when viewing a project tag)
        ├── push.js            ← subscribeToPush, unsubscribeFromPush (Web Push)
        └── app.js             ← marked.use() config, initAuth(), checkPublicShare IIFE, boot sequence, SW registration
```

---

## Deployment

Both the worker and Pages frontend deploy **automatically on every push to `main`** of `github.com:swamp2k/noteflow-v2`.

**Pages build output directory is `/public`** — root-level files (`wrangler.toml`, `CLAUDE.md`, etc.) and `worker/` are NOT served publicly.

**Manual deployment (fallback only):**
```bash
# Worker
npx wrangler deploy

# Pages
npx wrangler pages deploy public --project-name noteflow-v2 --commit-dirty=true
```

**Never use the Cloudflare Dashboard Quick Edit** to deploy the worker. Always use wrangler CLI — the dashboard can silently corrupt module format.

The old Pages project `noteflow-frontend-dge` has been decommissioned — do not reference it.

---

## Cloudflare Resources

| Resource | Value |
|----------|-------|
| Account ID | `98b26d7882ddf77fcd45529f35b11202` |
| D1 database | `noteflow` / ID: `075788a4-1d08-458e-9622-e10c561ee481` |
| R2 bucket | `noteflow-attachments` |
| Worker name | `noteflow-api` |
| Pages project | `noteflow-v2` (GitHub-linked, replaces `noteflow-frontend-dge`) |
| GitHub Repository | `github.com:swamp2k/noteflow-v2` |
| CF Access team | `https://hadus.cloudflareaccess.com` |
| CF Access AUD | `3ec90fd4d44c80d81b5b2e35387ed0160410ea878adb234279738b647bba19b5` |

---

## Worker Secrets

```
TEAM_DOMAIN        = https://hadus.cloudflareaccess.com
POLICY_AUD         = 3ec90fd4d...b647bba19b5  (CF Access audience tag)
ANTHROPIC_KEY      = sk-ant-...              (AI features)
VOYAGE_KEY         = pa-...                  (tag embeddings via voyage-4)
RESEND_KEY         = re_...                  (email send feature)
RESEND_FROM        = NoteFlow <noteflow@jeppesen.cc>
VAPID_PUBLIC_KEY   = BFGSFyPT9QR...          (Web Push — set via: echo "..." | npx wrangler secret put VAPID_PUBLIC_KEY)
VAPID_PRIVATE_KEY  = ncUi3S5y...             (Web Push)
VAPID_SUBJECT      = mailto:martin@jeppesen.cc
```

---

## Architecture Rules (Critical — Do Not Break These)

### 1. D1 is the source of truth for ALL settings
Settings are stored as a JSON blob in `user_settings.data`. The browser caches ONLY `theme`, `fontFamily`, `feedMaxWidth`, and `mobileFontSize` in `localStorage` under the key `noteflow_display_prefs` — purely for instant boot-time theming. Sensitive keys and all other settings live in D1 only and are never touched by localStorage.

The `saveSettings()` function has a guard: `if (!_settingsLoaded) return;` — it refuses to save until `/api/boot` has returned, to prevent overwriting D1 with default values on boot.

### 2. No browser-side API keys
All AI calls (Anthropic tagging, tracker AI, Voyage embeddings) go through the worker. The browser never calls Anthropic or Voyage directly. The worker proxies Voyage at `POST /api/tags/voyage-embed`.

### 3. Each HTML page is standalone
`index.html`, `tracker.html`, and `tagcloud.html` are each fully self-contained — they have their own settings loading, auth, theme application, and boot sequences. They share CSS from `nav.js` but are otherwise independent. A change to tracker.html cannot break index.html.

### 4. nav.js must not override page functions
`nav.js` is loaded after the main page script. It uses non-overriding globals:
```javascript
if (!window.renderTrackerNav) { window.renderTrackerNav = function(...) {...}; }
```
This means if a page defines its own version (tracker.html does for `renderTrackerNav`), nav.js respects it.

### 5. The SW only caches the root path
The service worker intercepts navigation only for `/` and `/index.html`. Navigation to `/tracker.html` and `/tagcloud.html` must go to the network — do not change this or those pages will stop working.

---

## Auth Flow

1. User visits `notes.jeppesen.cc` — Cloudflare Access intercepts, issues `CF_Authorization` cookie (JWT)
2. Frontend reads cookie: `document.cookie.match(/CF_Authorization=([^;]+)/)`
3. Frontend sends JWT in every API call: `Authorization: Bearer <jwt>`
4. Worker's `verifyJWT(token, env)` (in `worker/lib/auth.js`) validates signature using JWKS from `TEAM_DOMAIN`
5. Worker extracts `userId` from JWT claims (email or aliased user_id)

---

## Boot Sequence

Every page makes ONE combined boot request on load:

```
GET /api/boot
→ { settings, trackers, version, projectTags }
```

This replaces 5 separate requests. It runs as `Promise.all` on the worker:
- `SELECT data FROM user_settings WHERE user_id=?`
- `SELECT * FROM tracker_subjects WHERE user_id=? ORDER BY created_at`
- `SELECT MAX(updated_at) FROM notes WHERE user_id=? AND archived=0`
- `SELECT DISTINCT tag FROM note_tags WHERE user_id=? AND tag LIKE 'project:%'`

After boot, the frontend:
1. Applies settings (theme, font, width)
2. Caches display prefs to localStorage
3. Checks cache version — clears offline cache if stale
4. Renders sidebar (trackers + project tags) immediately
5. Fires `loadMemos()` for the notes feed (index.html only)

---

## Worker Handler Pattern

Each handler module exports a single async function with this signature:

```javascript
export async function fooHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path === "/api/foo" && method === "GET") {
    // ... handle route
    return json({ ... }, 200, origin);
  }
  return null; // not matched — let the next handler try
}
```

The router in `worker/index.js` calls handlers sequentially; the first non-null response wins.

**Special case — `partnerHandler`** is called **twice**:
1. Before auth: handles the `/partner` page and `/api/partner/:token/*` public routes
2. After auth: handles `/api/trackers/:id/partner-tokens`

Inside `partnerHandler`, the guard `if (!userId) return null` prevents the auth-required partner-token routes from running pre-auth.

---

## Frontend JS Module Pattern

The `public/js/` files are loaded as plain `<script src>` tags in `index.html` (NOT ES modules). They share the global `window` scope — no `import`/`export`. Load order in `index.html` matters only for load-time execution; forward references inside function bodies are fine since all scripts load before any are called.

Script load order in `index.html` (bottom of `<body>`):
1. `state.js` — must be first (defines globals used by all others)
2. `api.js`, `utils.js`, `cache.js` — utilities
3. `settings.js`, `email.js`, `account.js` — feature modules
4. `composer.js`, `notes.js`, `card.js` — core UI
5. `tasks.js`, `lightbox.js`, `view-nav.js`, `offline.js` — UI/UX
6. `project-ai.js`, `push.js` — late feature modules
7. `app.js` — boot sequence (must be last)

---

## Key Frontend Patterns

### Settings save guard
```javascript
let _settingsLoaded = false;
function saveSettings() {
  if (!_settingsLoaded) return; // prevents overwriting D1 before boot completes
  // ...
}
```

### Targeted card updates (performance)
Do NOT call `renderFeed()` for single-note operations. Use:
```javascript
updateCard(memo)   // replaces one card DOM node
removeCard(memoId) // removes one card from DOM
```
`renderFeed()` is only for full list rebuilds (view switches, new notes, pagination).

### Tag system
Tags are strings in `note_tags`. Special prefixes:
- `project:name` — assigns a note to a project
- `hidden` — hides from main feed
- `starred` — starred (UI hidden but preserved in data)

Projects sidebar derives from `DISTINCT tag WHERE tag LIKE 'project:%'` — no separate table.

### Offline cache
```javascript
const NOTES_CACHE_KEY     = 'noteflow_notes_cache';
const NOTES_CACHE_VERSION = 'noteflow_cache_version';
```
After every note save, update the version:
```javascript
saveNotesCache(allMemos, newVersion);
setCachedVersion(Math.max(getCachedVersion(), newVersion));
```

### Tasks feature state (state.js)
```javascript
let taskSortOrder    = localStorage.getItem('noteflow_task_sort') || 'priority';
let tasksOverlayOpen = false;
```
`taskSortOrder` is the one settings value stored in localStorage (not D1) because it's a transient UI preference, not a user setting.

New `settings` object keys for tasks and notifications:
```
tasks_hide_from_main_feed, tasks_default_priority, tasks_show_completed
notif_enabled, notif_send_time, notif_discord_enabled, notif_discord_webhook
notif_email_enabled, notif_email_address, notif_push_enabled
notif_trigger_due_today, notif_trigger_overdue, notif_trigger_due_soon
```

### Tasks API query params (`GET /api/notes`)
- `?is_task=1` — return only tasks with `completed_at IS NULL`
- `?completed=1` — combined with `is_task=1`, return completed tasks
- `?hide_tasks=1` — exclude tasks from main notes feed (appended client-side when `settings.tasks_hide_from_main_feed` is true)
- `?sort=priority|due_date|created` — task sort order (NULLS LAST via `CASE WHEN`)

`PATCH /api/notes/:id/complete` — sets `completed_at` to current ISO timestamp or `null`. Note: `completed_at` is TEXT ISO 8601, while `created_at`/`updated_at` are INTEGER Unix seconds — intentional, documented in `schema.sql`.

### D1 table: push_subscriptions
```sql
push_subscriptions (id TEXT PK, user_id TEXT, endpoint TEXT UNIQUE,
                    p256dh TEXT, auth_key TEXT, created_at INTEGER)
```
`/api/push/vapid-key` returns only `{ publicKey }` — never exposes `p256dh` or `auth_key` to the client.

### Cron trigger
`wrangler.toml` has `[triggers] crons = ["0 * * * *"]`. `worker/index.js` exports `scheduled(event, env, ctx)` which calls `runTaskNotifications(env)` from `worker/lib/notifications.js`. The handler runs every hour and checks each user's `notif_send_time` setting before sending alerts.

---

## nav.js Contract

Each page must:
```html
<aside id="sidebar"></aside>  <!-- empty placeholder — nav.js fills it -->
<script>window.NAV_PAGE = 'index'; /* or 'tracker' or 'tagcloud' */</script>
<script src="/nav.js"></script>
```

After boot, each page calls:
```javascript
renderTrackerNav(trackers);          // populate tracker list in sidebar
renderProjectsNav(boot.projectTags); // populate project list in sidebar
initCollapsibleSections();           // wire collapse/expand on section headers
```

On `index.html`, also call (after nav.js loads):
```javascript
initNavItems(); // wires data-view button click handlers
```
This is called automatically by nav.js via `if (typeof window.initNavItems === 'function') window.initNavItems()`.

---

## tracker.html Specifics

- `trackers` is a global `let trackers = []` — set it before calling `renderTrackerNav()`
- `switchToTracker(tr)` — loads a tracker in-page. It does NOT reference `#feed`, `#load-more`, etc. (those don't exist here). It updates the title, color dot, sidebar highlight, and URL param
- `leaveTrackerView()` — no-op in standalone mode (navigation happens via sidebar `<a>` links)
- URL param `?id=<tracker_id>` — boot reads this and calls `switchToTracker(tr)` automatically
- URL param `?new=1` — boot calls `openNewTrackerModal()` automatically

---

## tagcloud.html Specifics

- `SPECIAL_TAGS = ['hidden', 'starred']` is defined locally — never put it in a shared file
- `voyageEmbed(texts, inputType)` calls the worker proxy, NOT Voyage directly
- The tag cloud page is always visible (`display: flex !important`) — there's no toggling
- Page layout: `#tag-cloud-page` is `position: fixed; left: var(--sidebar-w); top: 0; right: 0; bottom: 0`
- Three views: `buildForceGraph()`, `buildSemanticGraph()`, embeddings via `tcIndexTags()`
- d3.js is lazy-loaded on first graph render via `loadD3()`

---

## D1 Patterns

```javascript
// Read single row
const row = await env.DB.prepare("SELECT ... FROM ... WHERE id=?").bind(id).first();

// Read multiple rows
const { results } = await env.DB.prepare("SELECT ...").bind(param).all();

// Write
await env.DB.prepare("INSERT INTO ... VALUES (?,?)").bind(a, b).run();

// Batch write
await env.DB.batch([
  env.DB.prepare("INSERT ...").bind(...),
  env.DB.prepare("UPDATE ...").bind(...),
]);
```

### Prompt caching
Anthropic calls use `anthropic-beta: prompt-caching-2024-07-31` with `cache_control: { type: "ephemeral" }` on system prompts — this saves cost on multi-turn tracker conversations.

---

## Common Mistakes to Avoid

1. **Never call `renderFeed()` inside a for loop or after every single note update.** Use `updateCard(memo)` instead.

2. **Never write to `localStorage` with settings data.** Only `noteflow_display_prefs` (the 4 display keys) goes to localStorage. Everything else stays in D1.

3. **Never reference index.html-only DOM elements from tracker.html or tagcloud.html.** Elements like `#feed`, `#load-more`, `#composer`, `#settings-page`, `main` do not exist in the standalone pages.

4. **Never let the SW intercept `/tracker.html` or `/tagcloud.html` navigation.** The SW only caches `/` and `/index.html`.

5. **Never define a function in nav.js that overrides an existing page function.** Always use the non-overriding pattern: `if (!window.fn) { window.fn = function() {...}; }`

6. **Never fire `saveSettings()` before `_settingsLoaded = true`.** The guard exists for a reason — without it, a race condition on boot wipes D1 settings with defaults.

7. **Never add a `VOYAGE_KEY` input to the settings UI.** The key is a worker secret. The settings field `voyageApiKey` still exists in the object for migration but is inert.

8. **Never add `export`/`import` to `public/js/*.js` files.** They are plain scripts sharing global scope — not ES modules. Adding module syntax will break them.

9. **When editing a worker handler, return `null` for unmatched routes** — do not return a 404 from inside a handler. The router in `worker/index.js` emits the final 404.

10. **Never remove the `tasks-overlay-open` body class toggle from `openTasksOverlay()`/`closeTasksOverlay()`.** The toast (`#toast`, fixed at `bottom: 24px`) overlaps the tasks bottom-sheet on mobile. CSS in `index.html` uses `body.tasks-overlay-open #toast` to reposition the toast to `top: 20px` when the overlay is open. Removing the toggle breaks toast visibility during task operations.

---

## Testing Checklist After Any Change

- [ ] Syntax-check all modified worker JS: `node --check worker/index.js && node --check worker/lib/*.js && node --check worker/handlers/*.js`
- [ ] Settings save and persist across page reload
- [ ] Theme applies immediately on boot (no flash of wrong theme)
- [ ] Trackers load in sidebar on all three pages
- [ ] Clicking a tracker in sidebar opens it (tracker.html only — other pages link to tracker.html)
- [ ] Tag Cloud renders graph on page load
- [ ] Projects appear in sidebar without reloading
- [ ] Inline note edit preserves existing tags (including starred, hidden, project:*)
- [ ] Archive and delete remove the card without full re-render
- [ ] Service worker does not intercept tracker.html or tagcloud.html navigation
- [ ] `npx wrangler deploy` succeeds without errors

---

## File Reference (May 2026)

| File | Role |
|------|------|
| `worker/index.js` | Router + `scheduled()` cron export |
| `worker/lib/utils.js` | Shared utilities (nanoid, CORS, JSON helpers) |
| `worker/lib/auth.js` | JWT verification + user resolution |
| `worker/lib/ai.js` | AI + embedding helpers (Anthropic, Voyage) |
| `worker/lib/notifications.js` | Cron task notification logic |
| `worker/handlers/*.js` | 11 route handler modules |
| `schema.sql` | D1 schema reference (never auto-run) |
| `public/index.html` | Main app shell (no inline JS) |
| `public/js/state.js` | Global state (must load first) |
| `public/js/tasks.js` | Tasks overlay, feed, detail modal, quick-add |
| `public/js/push.js` | Web Push subscription management |
| `public/js/project-ai.js` | Project AI panel |
| `public/js/app.js` | Boot sequence (must load last) |
| `public/js/*.js` | 17 frontend modules total (plain scripts, shared scope) |
| `public/service-worker.js` | Offline queue + push notification handler (v24) |
