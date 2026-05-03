# NoteFlow — AI Assistant Onboarding Guide

This file tells you everything you need to work on the NoteFlow codebase. Read it fully before making any changes.

---

## What This Project Is

NoteFlow is a personal PWA note-taking app for one user (Martin, martin@jeppesen.cc). It runs entirely on Cloudflare infrastructure. There is no framework, no bundler, no npm dependencies in the frontend — everything is vanilla JS, HTML, and CSS.

**Live URL:** https://notes.jeppesen.cc

---

## Repository Structure

```
noteflow/
├── worker.js              ← Cloudflare Worker (all API logic, ~972 lines)
├── wrangler.toml          ← Worker deployment config
├── service-worker.js      ← Source for the browser service worker
├── schema.sql             ← D1 schema reference (never auto-run)
└── public/                ← Cloudflare Pages (deployed as static files)
    ├── index.html         ← Main notes app
    ├── tracker.html       ← Tracker feature (standalone page)
    ├── tagcloud.html      ← Tag Cloud / Semantic / Embeddings (standalone)
    ├── nav.js             ← Shared sidebar — loaded by all three pages
    └── service-worker.js  ← Browser service worker
```

---

## Deployment

```bash
# Deploy worker
npx wrangler deploy

# Deploy frontend (all files in public/)
npx wrangler pages deploy public --project-name noteflow-frontend-dge --commit-dirty=true
```

**Never use the Cloudflare Dashboard Quick Edit** to deploy the worker. Always use wrangler CLI — the dashboard can silently corrupt module format.

---

## Cloudflare Resources

| Resource | Value |
|----------|-------|
| Account ID | `98b26d7882ddf77fcd45529f35b11202` |
| D1 database | `noteflow` / ID: `075788a4-1d08-458e-9622-e10c561ee481` |
| R2 bucket | `noteflow-attachments` |
| Worker name | `noteflow-api` |
| Pages project | `noteflow-frontend-dge` |
| CF Access team | `https://hadus.cloudflareaccess.com` |
| CF Access AUD | `3ec90fd4d44c80d81b5b2e35387ed0160410ea878adb234279738b647bba19b5` |

---

## Worker Secrets

```
TEAM_DOMAIN     = https://hadus.cloudflareaccess.com
POLICY_AUD      = 3ec90fd4...b647bba19b5  (CF Access audience tag)
ANTHROPIC_KEY   = sk-ant-...              (AI features)
VOYAGE_KEY      = pa-...                  (tag embeddings via voyage-4)
RESEND_KEY      = re_...                  (email send feature)
RESEND_FROM     = NoteFlow <noteflow@jeppesen.cc>
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
4. Worker's `verifyJWT(token, env)` validates signature using JWKS from `TEAM_DOMAIN`
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

## Worker Patterns

### Route format
```javascript
if (path === "/api/notes" && method === "GET") { ... return json({...}, 200, origin); }
```
All routes are `if` checks in a single fetch handler — no router library.

### Error helper
```javascript
return err("message", statusCode, origin);
```

### D1 patterns
- Read: `await env.DB.prepare("SELECT ...").bind(param).first()` or `.all()`
- Write: `await env.DB.prepare("INSERT ...").bind(params).run()`
- Batch: `await env.DB.batch([...prepared statements...])`

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

---

## Testing Checklist After Any Change

- [ ] Syntax-check all modified JS: `node --check worker.js` and acorn for HTML scripts
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

## File Size Reference (May 2026)

| File | Lines | Size |
|------|-------|------|
| index.html | 4,174 | 194 KB |
| tracker.html | 2,142 | 107 KB |
| tagcloud.html | 2,169 | 105 KB |
| nav.js | 292 | 14 KB |
| worker.js | 972 | 89 KB |
| service-worker.js | 192 | 6 KB |
