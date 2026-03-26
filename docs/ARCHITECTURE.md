# NoteFlow v2 Architecture

## Overview

NoteFlow v2 is a web-first, real-time, multi-user AI-assisted note-taking app built on Cloudflare's serverless stack.

**Design principles:**
- Web is primary interface (PWA with offline support)
- Multi-user ready (auth, isolation, eventual sync)
- Real-time collaboration (SSE multi-tab/device sync)
- Token-efficient (batch requests, optimized prompts)
- Scalable to 1-5 users initially

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React SPA)                    │
│              Cloudflare Pages (jeppesen.cc/noteflow)         │
│                                                               │
│  - React 18 components                                       │
│  - Service Workers (offline + caching)                       │
│  - IndexedDB (local state backup)                            │
│  - SSE listener (real-time updates)                          │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTPS REST + SSE
┌──────────────▼──────────────────────────────────────────────┐
│              Backend (Cloudflare Workers)                    │
│                 API endpoints + SSE server                   │
│                                                               │
│  - User auth (Cloudflare OAuth)                             │
│  - Note CRUD (with real-time broadcast)                     │
│  - Tracking system (Claude Haiku integration)               │
│  - Search (Gemini embeddings + cosine similarity)           │
│  - File uploads (if implemented: Cloudflare R2)             │
│  - Durable Objects (SSE connection tracking)                │
└──────────────┬──────────────────────────────────────────────┘
               │ SQL queries
┌──────────────▼──────────────────────────────────────────────┐
│                   D1 Database (SQLite)                       │
│                                                               │
│  - users, sessions                                           │
│  - tracking, tracking_entries, tracking_summaries           │
│  - search_metadata                                           │
│  - embeddings (stored as JSON)                              │
└──────────────────────────────────────────────────────────────┘

External APIs:
  - Claude API (Anthropic) — summaries
  - Gemini API (Google) — embeddings
  - Google OAuth — user auth
```

---

## Component Breakdown

### 1. Frontend (React SPA)

**Location:** `/src/frontend`

**Key Components:**
- `<NoteList />` — displays user's notes
- `<NoteEditor />` — create/edit notes
- `<TrackingView />` — journal entries + summaries
- `<SearchBar />` — semantic + omni-search
- `<SettingsPanel />` — connectors (Google Drive, Gmail)

**Hooks:**
- `useRealTimeSync()` — listens to SSE, updates state
- `useNotes()` — CRUD operations
- `useTracking()` — tracking entries & summaries
- `useSearch()` — search with caching

**State Management:**
- React Context (lightweight, no Redux needed for 1-5 users)
- Optional: Zustand if state complexity grows

**Offline Support:**
- Service Worker caches:
  - Static assets (JS, CSS) — cache-first
  - API responses (GET /api/notes) — stale-while-revalidate
- IndexedDB stores:
  - User's notes (local mirror)
  - Pending writes (sync queue)
- On reconnect:
  - Sync pending writes to server
  - Fetch fresh notes

---

### 2. Backend (Cloudflare Workers)

**Location:** `/src/workers`

**Architecture:**
- Single Worker entry point (`src/index.ts`)
- Router for API paths
- Durable Objects for SSE connection management

**Key Routes:**

```
/api/auth
  GET /login — OAuth redirect
  GET /callback — OAuth callback, set session
  POST /logout — clear session

/api/notes
  GET — list user's notes (with pagination)
  POST — create note, broadcast SSE
  GET /:id — get single note
  PUT /:id — update note, broadcast SSE
  DELETE /:id — delete note, broadcast SSE

/api/tracking
  GET — list tracking entries
  POST — create entry, trigger Haiku summarization
  GET /:id/summary — get AI summary

/api/search
  GET ?q=term — semantic search (Gemini embeddings)
  GET /omni?q=term — search Google Drive + Gmail

/api/sync
  GET — SSE endpoint, open connection to Durable Object
         receives broadcasts when notes change

/api/settings
  GET /connectors — list user's OAuth connectors
  POST /connectors — add new connector (Google, etc.)
  DELETE /connectors/:id — remove connector
```

**Request Flow (Note Creation):**

```
1. Frontend: POST /api/notes { content, tracking_id }
2. Worker:
   a. Authenticate user (check session)
   b. Validate input
   c. Insert into D1: INSERT INTO notes (user_id, content, ...)
   d. Get all connected SSE clients for this user
   e. Broadcast { type: 'note_created', data: note } to all clients
   f. Return { success: true, note }
3. Frontend (all connected clients):
   a. Receive SSE update
   b. useRealTimeSync hook triggers
   c. React re-renders note list
   d. New note appears without refresh
```

**Authentication:**
- Cloudflare OAuth for user login
- Session token stored as cookie
- Validated on every API request
- `ctx.user` available in handlers

**Rate Limiting:**
- TBD per API endpoint
- Claude API: track usage, alert if approaching limits
- Gemini API: batch requests, respect rate limits

---

### 3. Database Schema (D1)

**Key Tables:**

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notes (generic)
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_created (user_id, created_at DESC),
  INDEX idx_pinned (user_id, pinned DESC, created_at DESC)
);

-- Tracking (AI journal entries)
CREATE TABLE tracking (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id)
);

CREATE TABLE tracking_entries (
  id TEXT PRIMARY KEY,
  tracking_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT, -- JSON array of floats (Gemini)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tracking_id) REFERENCES tracking(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_tracking (tracking_id, created_at DESC)
);

CREATE TABLE tracking_summaries (
  id TEXT PRIMARY KEY,
  tracking_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  summary_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tracking_id) REFERENCES tracking(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_tracking (tracking_id)
);

-- OAuth Connectors (Google Drive, Gmail, etc.)
CREATE TABLE oauth_connectors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'google_drive', 'gmail', etc.
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_provider (user_id, provider)
);

-- Search metadata (last sync times)
CREATE TABLE search_metadata (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  last_sync DATETIME,
  status TEXT, -- 'syncing', 'idle', 'error'
  error_msg TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (connector_id) REFERENCES oauth_connectors(id)
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_token (token),
  INDEX idx_user (user_id)
);
```

**Indexes:**
- `notes`: `(user_id, pinned DESC, created_at DESC)` — main list query
- `tracking_entries`: `(tracking_id, created_at DESC)` — fetch entries
- `oauth_connectors`: `(user_id, provider)` — lookup connectors
- `sessions`: `(token)` — validate sessions

---

### 4. SSE (Server-Sent Events) Architecture

**Why SSE vs. WebSockets?**
- Simpler to implement on Cloudflare Workers
- Works through proxies / firewalls
- Built-in HTTP (no protocol upgrade needed)
- Sufficient for 1-5 users (not a bottleneck)

**Implementation:**

```javascript
// Worker: SSE endpoint
async function handleSSE(request, env) {
  const user = request.user; // from auth middleware
  
  // Get or create Durable Object for this user
  const stub = env.SSE_MANAGER.get(user.id);
  
  // Pass request to Durable Object
  return stub.handleSSE(request);
}

// Durable Object: connection manager
export class SSEManager {
  constructor(state, env) {
    this.state = state;
    this.clients = new Set(); // connected clients
  }
  
  async handleSSE(request) {
    // Create Response with SSE headers
    const response = new Response(new ReadableStream({
      start: async controller => {
        // Store this controller to broadcast later
        this.clients.add(controller);
        
        // Send heartbeat every 30s
        const heartbeat = setInterval(() => {
          controller.enqueue(':\n\n'); // SSE comment/ping
        }, 30000);
        
        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          this.clients.delete(controller);
          clearInterval(heartbeat);
        });
      }
    }), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
    return response;
  }
  
  broadcast(message) {
    // Called when note is created/updated/deleted
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const controller of this.clients) {
      try {
        controller.enqueue(data);
      } catch (err) {
        this.clients.delete(controller); // client disconnected
      }
    }
  }
}
```

**Frontend Listener:**

```javascript
// React hook
function useRealTimeSync(userId) {
  const [updates, setUpdates] = useReducer(reducer, {});
  
  useEffect(() => {
    const eventSource = new EventSource(`/api/sync?user=${userId}`);
    
    eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setUpdates(message); // triggers re-render
    };
    
    return () => eventSource.close();
  }, [userId]);
  
  return updates;
}
```

---

## Data Flow Diagram

**Note Creation (with SSE broadcast):**

```
User A (Tab 1)                     User B (Tab 2, same browser)
     │                                   │
     └──> POST /api/notes ────────────────┤
          (content, tracking_id)         │
                │                         │
                └──> Worker ──────────────┤
                     1. Auth check        │
                     2. Insert to D1      │
                     3. Get Durable Obj   │
                     4. Broadcast         │
                          │              │
                          └──> SSE ──────┼──> User B's browser
                               stream    │    updates note list
                                        │
                          Returns ──────┤
                          { note }      │
                          │             │
     Tab 1 updates ──────────────┘   (via SSE)
     note list
```

---

## Deployment

**Stack:**
- **Frontend:** Cloudflare Pages (auto-deploy on `git push`)
- **Backend:** Cloudflare Workers (deployed with wrangler)
- **Database:** D1 (auto-created with `wrangler.toml`)
- **Auth:** Cloudflare OAuth

**CI/CD:**
- GitHub Actions triggers on push to `main`
- Runs `npm install`, `npm test`, `wrangler deploy`
- Pages auto-deploys frontend
- Workers auto-deploys backend

---

## Performance Considerations

1. **D1 Query Performance**
   - Indexes on frequently queried columns
   - Pagination for large result sets (limit 50, offset X)
   - Avoid N+1 queries (fetch all notes in single query)

2. **Gemini Embedding Costs**
   - Batch requests where possible
   - Cache embeddings in D1
   - Re-use embeddings for search

3. **Claude Haiku Costs**
   - Summarize periodically, not on every entry
   - Optimize prompts (fewer tokens = lower cost)
   - Monitor usage in Worker logs

4. **Frontend Caching**
   - Service Worker: cache static assets (1 year)
   - API responses: stale-while-revalidate (24 hours)
   - IndexedDB: local backup of notes (never expires, user can clear)

5. **SSE Scalability**
   - Durable Objects: 1 per user (no concurrency issues)
   - Heartbeat every 30s (keep connection alive)
   - Auto-cleanup on disconnect
   - Max ~5 users = max 5 Durable Objects (very cheap)

---

## Security

1. **Authentication**
   - Cloudflare OAuth only
   - Session tokens validated on every request
   - HTTPS only (enforced by Cloudflare)

2. **Authorization**
   - All queries scoped to `user_id`
   - Worker validates auth before responding
   - Cannot access other users' notes

3. **External APIs**
   - Claude API key stored in Cloudflare secrets
   - Gemini API key stored in Cloudflare secrets
   - Google OAuth tokens in D1 (encrypted at rest)
   - Never exposed to frontend

4. **Data Privacy**
   - No analytics / user tracking
   - D1 backups: Cloudflare-managed
   - User can request data export (future feature)

---

## Error Handling

1. **Database Errors**
   - Retry failed queries (exponential backoff)
   - Fall back to cached data if available
   - Log errors, alert user

2. **API Errors**
   - 400: invalid input
   - 401: not authenticated
   - 403: not authorized
   - 500: server error (retry)

3. **SSE Errors**
   - Auto-reconnect on disconnect
   - Exponential backoff (1s, 2s, 4s, 8s...)
   - Max 10 retries, then notify user

---

## Future Considerations

1. **Image Support**
   - UUID-based file references
   - Cloudflare R2 or D1 blob storage
   - OCR via Tesseract

2. **Advanced Sync**
   - Conflict resolution for concurrent edits
   - Sync queue for offline writes
   - Version history / undo

3. **Scaling**
   - If > 10 users: evaluate relational database (Postgres via Hyperdrive)
   - If > 100 users: CDN caching strategy, API rate limiting

4. **Monetization** (if applicable)
   - Usage-based pricing (per API call)
   - Premium features (advanced search, export)
   - Subscription model

---

## Glossary

- **D1** — Cloudflare's serverless SQLite database
- **Durable Objects** — long-lived Worker instances for state management
- **SSE** — Server-Sent Events (simple HTTP push)
- **PWA** — Progressive Web App (works offline)
- **Haiku** — Claude Haiku model (fast, cheap summaries)
- **Embedding** — vector representation of text (for semantic search)
