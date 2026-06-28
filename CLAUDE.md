# NoteFlow â€” AI Assistant Onboarding Guide

This file tells you everything you need to work on the NoteFlow codebase. Read it fully before making any changes.

---

## Keeping This File Current

**Update CLAUDE.md as part of every change.** When you add a feature, change a data model, rename a function, update a setting key, or alter a pattern â€” update the relevant section here in the same commit. This file is the single source of truth for the next assistant; stale docs cause bugs.

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

NoteFlow is a personal PWA note-taking app for one user (Martin, martin@jeppesen.cc). It runs entirely on Cloudflare infrastructure. There is no framework, no bundler, no npm dependencies in the frontend â€” everything is vanilla JS, HTML, and CSS.

**Live URL:** https://notes.jeppesen.cc

---

## Repository Structure

```
noteflow-v2/
â”œâ”€â”€ noteflow-widget/           â† Android companion app (Expo / React Native)
â”‚   â”œâ”€â”€ app/                   â† Expo Router screens
â”‚   â”‚   â”œâ”€â”€ _layout.tsx        â† Root layout (ErrorBoundary + custom header; uses <Slot/>, NOT <Stack/> â€” Stack's SceneView crashed on boot)
â”‚   â”‚   â””â”€â”€ index.tsx          â† Setup screen (API URL + App URL + token entry, test connection)
â”‚   â”œâ”€â”€ widget/
â”‚   â”‚   â”œâ”€â”€ TasksWidget.tsx    â† Widget UI (FlexWidget/ListWidget from react-native-android-widget); deep links use the App URL; accepts textSize prop
â”‚   â”‚   â”œâ”€â”€ tasksBridge.ts     â† fetchTasks() (uses API URL), getTextSize(), formatDue()/isOverdue() (operate on Task.due ISO string, mirror PWA relativeDue: "N days"/"N wks"/"N mo"); Task.subject (not priority)
â”‚   â”‚   â””â”€â”€ widgetTaskHandler.ts â† registerWidgetTaskHandler (registered via app.json widgetTaskHandler, NOT imported in _layout)
â”‚   â”œâ”€â”€ constants/theme.ts     â† Color palette
â”‚   â”œâ”€â”€ app.json               â† Expo config (react-native-android-widget plugin; needs `widgetTaskHandler` path)
â”‚   â””â”€â”€ package.json           â† Expo SDK ~52, react-native-android-widget, AsyncStorage
â”‚
â”‚   Android widget config (AsyncStorage keys, set on the setup screen):
â”‚     â€¢ noteflow_api_url  â€” API base for fetching tasks   (https://noteflow-api.jeppesen.cc)
â”‚     â€¢ noteflow_app_url  â€” App base for task deep links   (https://notes.jeppesen.cc, the PWA)
â”‚     â€¢ noteflow_token    â€” widget token (from Settings â†’ Android Widget)
â”‚     â€¢ noteflow_url      â€” legacy single-URL key, kept in sync with api_url for back-compat
â”‚     â€¢ noteflow_text_size â€” widget font scale: 'small' | 'medium' | 'large' (default 'medium')
â”‚   The API and the PWA live on DIFFERENT subdomains. fetchTasks() uses api_url;
â”‚   widget deep links (#/task/:id, #/new-task, #/tasks) use app_url so they open the PWA.
â”‚   The /api/widget/tasks path must have a Cloudflare Access *Bypass* policy (Everyone)
â”‚   on whichever host the widget calls, or CF Access returns its HTML login page (â†’ JSON parse error).
â”‚
â”‚   Widget refresh behaviour:
â”‚     Android enforces a minimum of 30 minutes for updatePeriodMillis. The widget task handler
â”‚     is triggered by the OS on this schedule. The â†º refresh button was removed â€” Android 12+
â”‚     background process restrictions prevent reliable headless task startup from a widget tap.
â”‚     Users can pull down on the setup screen to confirm API connectivity (shows live task count).
â”‚     For the widget to refresh after completing/adding tasks, disable battery optimization:
â”‚     Settings â†’ Apps â†’ NoteFlow Widget â†’ Battery â†’ Unrestricted.
â”‚
â”‚   Alternative front-end â€” KWGT: KWGT (Kustom Widget Maker) can render the same tasks by
â”‚     fetching GET /api/widget/tasks?token=...&tzoffset=<min> directly (token in query string,
â”‚     no headers). No backend beyond that endpoint is required. Setup guide: docs/kwgt-setup.md.
â”œâ”€â”€ worker/                    â† Cloudflare Worker (ES modules)
â”‚   â”œâ”€â”€ index.js               â† Router only â€” imports handlers, orchestrates auth
â”‚   â”œâ”€â”€ lib/
â”‚   â”‚   â”œâ”€â”€ utils.js           â† nanoid, extractTags, corsHeaders, openCors, json, jsonOpen, err, errOpen, sha256hex
â”‚   â”‚   â”œâ”€â”€ auth.js            â† checkPartnerPassword, resolveModel, verifyJWT, ensureUser
â”‚   â”‚   â”œâ”€â”€ ai.js              â† ensureTagEmbeddingsTable, buildTrackerContext, callTrackerAI, callPartnerAI, shouldIndex, indexDocument
â”‚   â”‚   â””â”€â”€ notifications.js   â† runTaskNotifications(env) â€” per-task notification cron handler
â”‚   â””â”€â”€ handlers/
â”‚       â”œâ”€â”€ notes.js           â† /api/notes, /api/notes/:id, /api/notes/:id/complete, /api/notes/version, /api/notes/tag-contexts
â”‚       â”œâ”€â”€ tags.js            â† /api/tags, /api/tags/graph
â”‚       â”œâ”€â”€ attachments.js     â† /api/attachments, /api/attachments/:id, /api/admin/reindex
â”‚       â”œâ”€â”€ tracker.js         â† /api/trackers, /api/trackers/:id, etc.
â”‚       â”œâ”€â”€ partner.js         â† /partner page, /api/partner/:token/*, /api/trackers/:id/partner-tokens
â”‚       â”œâ”€â”€ widget.js          â† /api/widget/tasks (GET public), /api/widget/tasks/:id/complete (POST public, widget-token auth, for Make.com bidirectional sync), /api/widget/token (GET/POST/DELETE, auth), /api/widget/token/full (GET, auth = full token reveal); ical.js -> /api/ical/tasks.ics (public, widget-token auth, iCalendar feed of tasks with a due_date)
â”‚       â”œâ”€â”€ user.js            â† /api/boot, /api/me, /api/user/settings
â”‚       â”œâ”€â”€ search.js          â† /api/search, /api/notes/autotag
â”‚       â”œâ”€â”€ email.js           â† /api/email/send
â”‚       â”œâ”€â”€ push.js            â† /api/push/vapid-key (GET), /api/push/subscribe (POST, DELETE)
â”‚       â”œâ”€â”€ project-ai.js      â† /api/project-ai (project context AI panel)
â”‚       â”œâ”€â”€ email-inbound.js   â† handleInboundEmail() â€” Cloudflare Email Routing handler (email() export)
â”‚       â””â”€â”€ public.js          â† service-worker.js, icons, manifest, /api/public/note/:id (shared note HTML), /api/public/notes/:id (JSON), /api/public/attachments/:id
â”œâ”€â”€ wrangler.toml              â† Worker deployment config; includes [triggers] crons = ["0 * * * *"]
â”œâ”€â”€ service-worker.js          â† Source for the browser service worker
â”œâ”€â”€ schema.sql                 â† D1 schema reference (never auto-run)
â””â”€â”€ public/                    â† Cloudflare Pages (deployed as static files)
    â”œâ”€â”€ index.html             â† Main notes app (no inline JS)
    â”œâ”€â”€ tracker.html           â† Tracker feature (standalone page)
    â”œâ”€â”€ tagcloud.html          â† Tag Cloud / Semantic / Embeddings (standalone)
    â”œâ”€â”€ nav.js                 â† Shared sidebar â€” loaded by all three pages
    â”œâ”€â”€ service-worker.js      â† Browser service worker (v26)
    â””â”€â”€ js/                    â† Frontend JS modules (plain <script> tags, shared global scope)
        â”œâ”€â”€ state.js           â† All global state variables (API_BASE, SHARE_BASE, allMemos, settings, etc.)
        â”œâ”€â”€ api.js             â† getCFToken, authHeaders, apiGet, apiPatch, apiPost, apiDelete, uploadAttachment
        â”œâ”€â”€ utils.js           â† attachmentUrl, isImageAttachment, escHtml, fileIcon, toast, formatDate
        â”œâ”€â”€ cache.js           â† getCachedVersion, setCachedVersion, clearNotesCache, saveNotesCache, loadNotesCache, getAttachmentBlob, prefetchOfflineCache
        â”œâ”€â”€ settings.js        â† saveSettings, loadSettings, applyTheme, applyFeedWidth, applyFontFamily, syncSettingsControls, initSettingsControls
        â”œâ”€â”€ email.js           â† sendNoteByEmail
        â”œâ”€â”€ account.js         â† renderTrackerNav, loadTrackers, loadAccountInfo
        â”œâ”€â”€ composer.js        â† aiTags, addFile, renderImagePreviews, mdInsert, attachMdToolbar, setupComposer IIFE
        â”œâ”€â”€ notes.js           â† loadMemos, fetchAllMemos, getViewTitle, toggleArchive, confirmDelete, renderFeed, updateCard, removeCard
        â”œâ”€â”€ card.js            â† buildCard, makeActionBtn, openProjectPopover, openMorePopover, toggleTag, openShareModal
        â”œâ”€â”€ tasks.js           â† renderTasksFeed, openTasksOverlay, closeTasksOverlay, openTaskDetail, quickAddTask, completeTask, saveTaskFields, buildTaskCard, buildTaskRow
        â”œâ”€â”€ lightbox.js        â† openLightbox, openFilePreview, renderLightbox, closeLightbox, touch/zoom IIFE
        â”œâ”€â”€ view-nav.js        â† renderProjectsNav, initCollapsibleSections, switchView, initNavItems, infiniteObserver
        â”œâ”€â”€ offline.js         â† ensureOfflineUI, setOffline, updateQueueBadge, checkSharePending, openComposerWithContent
        â”œâ”€â”€ project-ai.js      â† project AI panel rendering (shown when viewing a project tag)
        â”œâ”€â”€ push.js            â† subscribeToPush, unsubscribeFromPush (Web Push)
        â””â”€â”€ app.js             â† marked.use() config, initAuth(), boot sequence, SW registration
```

---

## Deployment

Both the worker and Pages frontend deploy **automatically on every push to `main`** of `github.com:swamp2k/noteflow-v2`.

**Pages build output directory is `/public`** â€” root-level files (`wrangler.toml`, `CLAUDE.md`, etc.) and `worker/` are NOT served publicly.

**Manual deployment (fallback only):**
```bash
# Worker
npx wrangler deploy

# Pages
npx wrangler pages deploy public --project-name noteflow-v2 --commit-dirty=true
```

**Never use the Cloudflare Dashboard Quick Edit** to deploy the worker. Always use wrangler CLI â€” the dashboard can silently corrupt module format.

The old Pages project `noteflow-frontend-dge` has been decommissioned â€” do not reference it.

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
VAPID_PUBLIC_KEY   = BFGSFyPT9QR...          (Web Push â€” set via: echo "..." | npx wrangler secret put VAPID_PUBLIC_KEY)
VAPID_PRIVATE_KEY  = ncUi3S5y...             (Web Push)
VAPID_SUBJECT      = mailto:martin@jeppesen.cc
```

---

## Architecture Rules (Critical â€” Do Not Break These)

### 1. D1 is the source of truth for ALL settings
Settings are stored as a JSON blob in `user_settings.data`. The browser caches ONLY `theme`, `fontFamily`, `feedMaxWidth`, and `mobileFontSize` in `localStorage` under the key `noteflow_display_prefs` â€” purely for instant boot-time theming. Sensitive keys and all other settings live in D1 only and are never touched by localStorage.

The `saveSettings()` function has a guard: `if (!_settingsLoaded) return;` â€” it refuses to save until `/api/boot` has returned, to prevent overwriting D1 with default values on boot.

### 2. No browser-side API keys
All AI calls (Anthropic tagging, tracker AI, Voyage embeddings) go through the worker. The browser never calls Anthropic or Voyage directly. The worker proxies Voyage at `POST /api/tags/voyage-embed`.

### 3. Each HTML page is standalone
`index.html`, `tracker.html`, and `tagcloud.html` are each fully self-contained â€” they have their own settings loading, auth, theme application, and boot sequences. They share CSS from `nav.js` but are otherwise independent. A change to tracker.html cannot break index.html.

### 4. nav.js must not override page functions
`nav.js` is loaded after the main page script. It uses non-overriding globals:
```javascript
if (!window.renderTrackerNav) { window.renderTrackerNav = function(...) {...}; }
```
This means if a page defines its own version (tracker.html does for `renderTrackerNav`), nav.js respects it.

### 5. The SW only caches the root path
The service worker intercepts navigation only for `/` and `/index.html`. Navigation to `/tracker.html` and `/tagcloud.html` must go to the network â€” do not change this or those pages will stop working.

---

## Auth Flow

1. User visits `notes.jeppesen.cc` â€” Cloudflare Access intercepts, issues `CF_Authorization` cookie (JWT)
2. Frontend reads cookie: `document.cookie.match(/CF_Authorization=([^;]+)/)`
3. Frontend sends JWT in every API call: `Authorization: Bearer <jwt>`
4. Worker's `verifyJWT(token, env)` (in `worker/lib/auth.js`) validates signature using JWKS from `TEAM_DOMAIN`
5. Worker extracts `userId` from JWT claims (email or aliased user_id)

---

## Boot Sequence

Every page makes ONE combined boot request on load:

```
GET /api/boot
â†’ { settings, trackers, version, projectTags }
```

This replaces 5 separate requests. It runs as `Promise.all` on the worker:
- `SELECT data FROM user_settings WHERE user_id=?`
- `SELECT * FROM tracker_subjects WHERE user_id=? ORDER BY created_at`
- `SELECT MAX(updated_at) FROM notes WHERE user_id=? AND archived=0`
- `SELECT DISTINCT tag FROM note_tags WHERE user_id=? AND tag LIKE 'project:%'`

After boot, the frontend (`app.js`):
1. Applies settings (theme, font, width)
2. Caches display prefs to localStorage
3. Checks cache version â€” clears offline cache if stale
4. Renders sidebar (trackers + project tags) immediately
5. Checks URL hash for deep links (`#/tasks`, `#/task/<id>`, `#/new-task`, `#/new-note`) â€” these take priority over `?v=` param
6. Falls back to `?v=` URL param to restore view. If view is `tasks`, calls `renderTasksFeed()`. Otherwise calls `loadMemos()`.

**Hash deep-links** (used by Android widget and PWA shortcuts):
- `#/tasks` â†’ switches to tasks view
- `#/task/<id>` â†’ switches to tasks view, then calls `openTaskDetail(id)` after 300ms
- `#/new-task` â†’ switches to tasks view, then calls `quickAddTask()` after 300ms
- `#/new-note` â†’ stays on notes view, focuses `#composer-textarea` after 300ms

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
  return null; // not matched â€” let the next handler try
}
```

The router in `worker/index.js` calls handlers sequentially; the first non-null response wins.

**Special case â€” `partnerHandler`** is called **twice**:
1. Before auth: handles the `/partner` page and `/api/partner/:token/*` public routes
2. After auth: handles `/api/trackers/:id/partner-tokens`

Inside `partnerHandler`, the guard `if (!userId) return null` prevents the auth-required partner-token routes from running pre-auth.

**Special case â€” `widgetHandler`** is also called **twice** (same pattern):
1. Before auth: handles `GET /api/widget/tasks?token=...` â€” authenticates via widget token, not session
2. After auth: handles `GET /api/widget/token` (preview), `POST /api/widget/token` (generate), `DELETE /api/widget/token` (revoke)

---

## Frontend JS Module Pattern

The `public/js/` files are loaded as plain `<script src>` tags in `index.html` (NOT ES modules). They share the global `window` scope â€” no `import`/`export`. Load order in `index.html` matters only for load-time execution; forward references inside function bodies are fine since all scripts load before any are called.

Script load order in `index.html` (bottom of `<body>`):
1. `state.js` â€” must be first (defines globals used by all others)
2. `api.js`, `utils.js`, `cache.js` â€” utilities
3. `settings.js`, `email.js`, `account.js` â€” feature modules
4. `composer.js`, `notes.js`, `card.js` â€” core UI
5. `tasks.js`, `lightbox.js`, `view-nav.js`, `offline.js` â€” UI/UX
6. `project-ai.js`, `push.js` â€” late feature modules
7. `app.js` â€” boot sequence (must be last)

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

### Attachment paste/attach support
File and image attachments are supported in three places:

1. **Composer (new notes)** â€” paste handler in `lightbox.js` catches any `kind === 'file'` clipboard item (images, PDFs, etc.) and calls `addFile()`. Files queue in `pendingImages` (state.js) and are uploaded via `uploadAttachment()` after the note saves.

2. **Inline note editor** (`card.js`) â€” paste handler on `inlineTextarea` catches file clipboard items, pushes to `inlinePendingFiles`. Attach button opens a file picker. Both show previews via `renderInlinePreviews()` (image thumbnails + file chips in `inlinePreviewArea`). Files are uploaded on Save.

3. **Task detail modal** (`tasks.js`) â€” `openTaskDetail()` renders existing `task.attachments` as chips in `#td-attachment-list`. Attach button (`#td-attach-btn`) + file input (`#td-file-input`) for click-to-upload. Paste handler on `#td-textarea` uploads files immediately. Delete button calls `DELETE /api/attachments/:id`. Uses `.onclick`/`.onchange`/`.onpaste` assignment to prevent stacking on re-open.

### Targeted card updates (performance)
Do NOT call `renderFeed()` for single-note operations. Use:
```javascript
updateCard(memo)   // replaces one card DOM node
removeCard(memoId) // removes one card from DOM
```
`renderFeed()` is only for full list rebuilds (view switches, new notes, pagination).

For tasks specifically, use `buildTaskCard(task)` and replace the existing card DOM node directly. `renderTasksFeed()` is only for full task list rebuilds.

### Swipe left to archive (mobile gesture)
An IIFE at the bottom of `public/js/card.js` attaches `touchstart`/`touchmove`/`touchend` to `document` using event delegation on `.memo-card` elements. Works for both note cards (main feed) and task cards (tasks view).

- Threshold: 80px left swipe (horizontal movement must exceed vertical to avoid scroll conflicts)
- `touchmove` uses `{ passive: false }` and calls `e.preventDefault()` once a horizontal swipe is confirmed, to block page scroll during the gesture
- Visual feedback: card translates with finger; background turns `#fde8e8` at threshold
- On release past threshold: card flies out left + fades, then `apiPatch('/notes/:id', { archived: true })` is called
- On API error: card snaps back; on release before threshold: card snaps back
- Does NOT fire when touching `button, a, input, textarea, select, label` elements

### Note sharing
A note is made public by setting `visibility='PUBLIC'` on the notes row. The share dialog (`openShareModal` in `card.js`) generates a link using:
```javascript
const SHARE_BASE = 'https://noteflow-api.jeppesen.cc/api/public/note';
// share URL: SHARE_BASE + '/' + memo.id
```

That URL is served by `publicHandler` (before auth) at `GET /api/public/note/:id`. The route returns a **self-contained HTML page** â€” marked.js loaded from CDN, note content embedded inline, images/video/audio rendered via `<img>`/`<video>`/`<audio>` tags pointing to `/api/public/attachments/:id`. No dependency on Cloudflare Pages static assets, so CF Access never blocks the page for unauthenticated visitors.

The `/api/public/*` paths on `noteflow-api.jeppesen.cc` must have a CF Access **Bypass** policy (Everyone) â€” already configured. Do not move share links to `notes.jeppesen.cc`; CF Access there protects all static assets and would block unauthenticated JS loads.

### Tag system
Tags are strings in `note_tags`. Special prefixes:
- `project:name` â€” assigns a note to a project
- `hidden` â€” hides from main feed
- `starred` â€” starred (UI hidden but preserved in data)

Projects sidebar derives from `DISTINCT tag WHERE tag LIKE 'project:%'` â€” no separate table.

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
let taskSortOrder = localStorage.getItem('noteflow_task_sort') || 'due_date';
// 'subject' | 'due_date' | 'title' | 'created' | 'modified'
let taskGroupBy = localStorage.getItem('noteflow_task_group') || 'none';
// 'none' | 'subject' | 'due_date' | 'title' | 'created' | 'modified'
let tasksOverlayOpen = false;
```
`taskSortOrder` and `taskGroupBy` are stored in localStorage (not D1) because they are transient UI preferences, not user settings.

`settings` object keys for tasks and notifications:
```
tasks_hide_from_main_feed, task_subjects, tasks_default_subject, tasks_show_completed, tasks_show_count_badge
ical_include_completed
notif_enabled
notif_discord_enabled, notif_discord_webhook
emailTaskApprovedSenders
notif_email_enabled, notif_email_address
notif_push_enabled
```

Removed keys (no longer used): `notif_send_time`, `notif_trigger_due_today`, `notif_trigger_overdue`, `notif_trigger_due_soon` â€” these were replaced by per-task notification fields on the notes table.

### Task card layout (`buildTaskCard` in tasks.js)
```
[ checkbox ] [ title (first line of content)         ]
[ subject badge ] [ due date chip ] [ ðŸ”” notif chip ]
[ tags (optional) ]
```
- Subject badge, due date chip, and notification chip are **display only** â€” no click handlers, no inline editing on the card.
- Subject badge color is derived deterministically from the subject name via `SUBJECT_PALETTE` hash. Shows "No subject" when unset.
- Due date chip uses `dueDateChip()` (display only); only rendered when a due date is set.
- Notification chip only rendered when `notif_days_before` and `notif_time` are both set.
- Clicking or tapping **anywhere** on the card (except the checkbox) opens the task detail modal. Card handler uses `e.target.closest('input, button, a')` to exclude the checkbox (which also calls `e.stopPropagation()`).
- No Edit/Archive action buttons on the card. No inline editing â€” all edits happen in the detail modal.
- After `openTaskDetail` closes, a `MutationObserver` rebuilds the card from the updated `liveTask` object, so changes in the modal are immediately reflected without re-rendering the whole feed.

### Task detail modal (openTaskDetail in tasks.js)
Fields and their save behaviour:
- **Content** (textarea) â€” saves on blur
- **Due date** (`#td-due-date`) â€” saves on change
- **Subject** (`#td-subject`) â€” dynamically populated from `settings.task_subjects`; saves on change (stored in `priority` DB column as TEXT)
- **Notification days** (`#td-notif-days`) + **time** (`#td-notif-time`) â€” both saved together on either field's change event, writing `notif_days_before` and `notif_time` to D1

A `liveTask` copy is maintained inside `openTaskDetail`. Each save handler updates `liveTask` as well as calling `saveTaskFields`. When the modal's `open` class is removed, the `MutationObserver` fires and rebuilds the task card and overlay row from `liveTask`.

### Tasks API query params (`GET /api/notes`)
- `?is_task=1` â€” return only tasks with `completed_at IS NULL`
- `?completed=1` â€” combined with `is_task=1`, return completed tasks
- `?hide_tasks=1` â€” exclude tasks from main notes feed (appended client-side when `settings.tasks_hide_from_main_feed` is true)
- `?sort=subject` â€” alphabetical by `priority` column, NULLs last; secondary sort by due_date then created_at
- `?sort=due_date` â€” due date ASC (NULLs last), then created_at DESC
- `?sort=title` â€” alphabetical by content (first line), then created_at DESC
- `?sort=created` â€” created_at DESC (default)
- `?sort=modified` â€” updated_at DESC
- `?sort=completed` â€” completed_at DESC (used for the completed tasks list)

`PATCH /api/notes/:id/complete` â€” sets `completed_at` to current ISO timestamp or `null`. Note: `completed_at` is TEXT ISO 8601, while `created_at`/`updated_at` are INTEGER Unix seconds â€” intentional, documented in `schema.sql`.

### Per-task notifications (notifications.js)
The cron (`0 * * * *`) queries tasks where `notif_days_before IS NOT NULL AND notif_time IS NOT NULL`. For each, it calculates `notification_date = due_date âˆ’ notif_days_before days` and fires if `notification_date == today` AND `UTC hour == notif_time hour`. Notifications go out via the channels enabled in user settings (email/Discord/push). There is no global "send at" time â€” timing is entirely per-task.

### D1 table: push_subscriptions
```sql
push_subscriptions (id TEXT PK, user_id TEXT, endpoint TEXT UNIQUE,
                    p256dh TEXT, auth_key TEXT, created_at INTEGER)
```
`/api/push/vapid-key` returns only `{ publicKey }` â€” never exposes `p256dh` or `auth_key` to the client.

### D1 table: widget_tokens
```sql
widget_tokens (token TEXT PK, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)
```
One token per user. Generated via `POST /api/widget/token` (requires session auth); revoked via `DELETE /api/widget/token`. Used by `GET /api/widget/tasks?token=<token>` (public, pre-auth). The GET endpoint returns only a `preview` (first8â€¦last4) â€” the full token is shown once on generation.

`GET /api/widget/tasks` returns `{ tasks: [{ id, title, content, due, due_at, subject, due_label, overdue }] }` (max 20, incomplete + non-archived, sorted by due_date ASC). `content` is the full task text (used by Make.com to populate Google Tasks notes). `due_label`/`overdue` are server-computed display fields mirroring `formatDue()`/`isOverdue()` in `noteflow-widget/widget/tasksBridge.ts`, added for header-less clients like KWGT that can't easily do date math. They honor an optional `?tzoffset=<minutes-from-UTC>` param (default 0=UTC) so today/tomorrow/overdue align with the caller's local day. The React widget ignores `due_label`/`overdue`/`content`.

`POST /api/widget/tasks/:id/complete?token=<token>` — public, widget-token auth. Body: `{ "completed": true|false }` (defaults to `true` if omitted). Sets or clears `completed_at` on the task. Returns `{ ok: true }`. Used by Make.com to sync Google Tasks completions back to NoteFlow without requiring a session JWT.

**D1 migration required** (not auto-run):
```bash
npx wrangler d1 execute noteflow --command "CREATE TABLE IF NOT EXISTS widget_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);"
```

### Cron trigger
`wrangler.toml` has `[triggers] crons = ["0 * * * *"]`. `worker/index.js` exports `scheduled(event, env, ctx)` which calls `runTaskNotifications(env)` from `worker/lib/notifications.js`. The handler runs every hour and fires notifications for tasks whose per-task `notif_days_before` + `notif_time` matches the current date and UTC hour.

---

## D1 Schema â€” notes table task columns

```sql
is_task           INTEGER NOT NULL DEFAULT 0,
due_date          TEXT,           -- ISO 8601 date "YYYY-MM-DD", nullable
priority          TEXT,           -- subject/category label (user-defined), NULL=none; repurposed from INTEGER â€” SQLite stores TEXT here
completed_at      TEXT,           -- ISO 8601 datetime, NULL=incomplete
notif_days_before INTEGER,        -- days before due_date to notify (0=on day), NULL=disabled
notif_time        TEXT            -- "HH:MM" UTC, NULL=disabled
```

Both `notif_days_before` and `notif_time` must be non-null for a notification to fire. Setting either to null disables the notification for that task.

---

## nav.js Contract

Each page must:
```html
<aside id="sidebar"></aside>  <!-- empty placeholder â€” nav.js fills it -->
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

- `trackers` is a global `let trackers = []` â€” set it before calling `renderTrackerNav()`
- `switchToTracker(tr)` â€” loads a tracker in-page. It does NOT reference `#feed`, `#load-more`, etc. (those don't exist here). It updates the title, color dot, sidebar highlight, and URL param
- `leaveTrackerView()` â€” no-op in standalone mode (navigation happens via sidebar `<a>` links)
- URL param `?id=<tracker_id>` â€” boot reads this and calls `switchToTracker(tr)` automatically
- URL param `?new=1` â€” boot calls `openNewTrackerModal()` automatically

---

## tagcloud.html Specifics

- `SPECIAL_TAGS = ['hidden', 'starred']` is defined locally â€” never put it in a shared file
- `voyageEmbed(texts, inputType)` calls the worker proxy, NOT Voyage directly
- The tag cloud page is always visible (`display: flex !important`) â€” there's no toggling
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
Anthropic calls use `anthropic-beta: prompt-caching-2024-07-31` with `cache_control: { type: "ephemeral" }` on system prompts â€” this saves cost on multi-turn tracker conversations.

---

## Common Mistakes to Avoid

1. **Never call `renderFeed()` inside a for loop or after every single note update.** Use `updateCard(memo)` instead.

2. **Never write to `localStorage` with settings data.** Only `noteflow_display_prefs` (the 4 display keys) goes to localStorage. Everything else stays in D1.

3. **Never reference index.html-only DOM elements from tracker.html or tagcloud.html.** Elements like `#feed`, `#load-more`, `#composer`, `#settings-page`, `main` do not exist in the standalone pages.

4. **Never let the SW intercept `/tracker.html` or `/tagcloud.html` navigation.** The SW only caches `/` and `/index.html`.

5. **Never define a function in nav.js that overrides an existing page function.** Always use the non-overriding pattern: `if (!window.fn) { window.fn = function() {...}; }`

6. **Never fire `saveSettings()` before `_settingsLoaded = true`.** The guard exists for a reason â€” without it, a race condition on boot wipes D1 settings with defaults.

7. **Never add a `VOYAGE_KEY` input to the settings UI.** The key is a worker secret. The settings field `voyageApiKey` still exists in the object for migration but is inert.

8. **Never add `export`/`import` to `public/js/*.js` files.** They are plain scripts sharing global scope â€” not ES modules. Adding module syntax will break them.

9. **When editing a worker handler, return `null` for unmatched routes** â€” do not return a 404 from inside a handler. The router in `worker/index.js` emits the final 404.

10. **Never remove the `tasks-overlay-open` body class toggle from `openTasksOverlay()`/`closeTasksOverlay()`.** The toast (`#toast`, fixed at `bottom: 24px`) overlaps the tasks bottom-sheet on mobile. CSS in `index.html` uses `body.tasks-overlay-open #toast` to reposition the toast to `top: 20px` when the overlay is open. Removing the toggle breaks toast visibility during task operations.

11. **Never call `loadMemos()` when the current view is `tasks`.** The tasks feed uses `renderTasksFeed()`. Calling `loadMemos()` on the tasks view fetches regular notes and `renderFeed()` renders nothing useful. The boot sequence in `app.js` already handles this â€” preserve the `if (currentView === 'tasks')` branch.

12. **Never add `notif_send_time` or `notif_trigger_*` settings fields back.** These were intentionally removed â€” per-task notification scheduling via `notif_days_before` + `notif_time` on the note replaces them entirely. The settings UI only has the channels (email/Discord/push) and the master `notif_enabled` toggle.

13. **When bumping the service worker version, update it in two places:** the comment on line 1 (`// NoteFlow Service Worker vN`) and the `CACHE_NAME` constant. Also update the version reference in this file's Repository Structure section.

14. **Never add Cache-Control headers that allow CDN caching on `/api/ical/tasks.ics`.** The response must be `no-cache, no-store`. Calendar clients manage their own poll schedule; CDN caching would serve stale task data. The ICS feed authenticates via the existing `widget_tokens` table (`?token=...`), runs pre-auth in `index.js`, and only emits tasks that have a `due_date`. The `priority` column (a TEXT subject label here) is emitted as `CATEGORIES`, not iCal `PRIORITY`.

15. **The service worker exists as THREE copies that must be kept byte-identical:** `/service-worker.js` (repo root, marked as "source"), `/public/service-worker.js` (the one actually served by Cloudflare Pages at `notes.jeppesen.cc/service-worker.js`, since the browser registers it via the relative path `/service-worker.js`), and the `SERVICE_WORKER_JS` template string inside `worker/handlers/public.js` (served at `GET /service-worker.js` on the Worker's own domain). These had drifted out of sync before (one was 2 versions behind and missing the push-notification handlers entirely). Whenever you edit the service worker, update all three, then re-run `node --check worker/handlers/public.js` to confirm the embedded copy is still valid JS-in-a-template-string.

16. **The root-path navigation cache strategy must be network-first, not cache-first.** Cache-first (`caches.match('/').then(cached => cached || fetch(request))`) means the cached shell HTML is served forever once cached, and is only refreshed when the service worker file itself changes bytes (triggering reinstall). Since `index.html`'s markup can change on a normal deploy without `service-worker.js` changing, cache-first silently serves a stale DOM indefinitely — e.g. a stale shell missing a newly-added modal field (`#td-subject`) caused `openTaskDetail` to throw on `null.innerHTML` and the task modal would never open, until the user did a hard-refresh (which bypasses the SW). Always fetch the network first for the shell, falling back to the cache only on fetch failure (offline).

---

## Testing Checklist After Any Change

- [ ] Syntax-check all modified worker JS: `node --check worker/index.js && node --check worker/lib/*.js && node --check worker/handlers/*.js`
- [ ] Settings save and persist across page reload
- [ ] Theme applies immediately on boot (no flash of wrong theme)
- [ ] Trackers load in sidebar on all three pages
- [ ] Clicking a tracker in sidebar opens it (tracker.html only â€” other pages link to tracker.html)
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
| `worker/handlers/public.js` | Shared note HTML page, service worker JS, icons, manifest, public API routes |
| `worker/handlers/*.js` | 11 route handler modules total |
| `schema.sql` | D1 schema reference (never auto-run) |
| `public/index.html` | Main app shell (no inline JS) |
| `public/js/state.js` | Global state (must load first); defines `SHARE_BASE` |
| `public/js/tasks.js` | Tasks feed, overlay, detail modal, card/row builders, quick-add |
| `public/js/push.js` | Web Push subscription management |
| `public/js/project-ai.js` | Project AI panel |
| `public/js/app.js` | Boot sequence (must load last) |
| `public/js/*.js` | 17 frontend modules total (plain scripts, shared scope) |
| `public/service-worker.js` | Offline queue + push notification handler (v26) |
