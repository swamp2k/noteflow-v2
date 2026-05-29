// Configure marked to treat single newlines as <br> (matches Memos default rendering)
marked.use({ breaks: true, gfm: true });

// ── Auth ────────────────────────────────────────────────────────────────────
// Auth is handled by Cloudflare Access — CF_Authorization cookie sent automatically.
function initAuth() { return true; }

// ── Public share view ────────────────────────────────────────────────────────
// If URL is /note/:id and there's no CF token, render a read-only public view
// instead of the full app (requires CF Access Bypass policy on /note/* and
// noteflow-api.jeppesen.cc/api/public/*).
(async function checkPublicShare() {
  const m = window.location.pathname.match(/^\/note\/([^/]+)$/);
  if (!m) return;
  const noteId = m[1];
  const token = getCFToken();
  if (token) return; // authenticated — normal app flow handles it

  // Hide app shell, show share view
  document.getElementById('app').style.display = 'none';

  const wrap = document.createElement('div');
  wrap.id = 'share-view';
  wrap.innerHTML = `<style>
    #share-view{max-width:700px;margin:48px auto;padding:0 20px;font-family:var(--font-body);color:var(--text)}
    #share-view .sv-content{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px 32px;line-height:1.7}
    #share-view .sv-content img{max-width:100%;border-radius:8px}
    #share-view .sv-images{margin-top:16px;display:flex;flex-wrap:wrap;gap:8px}
    #share-view .sv-images img{max-height:240px;border-radius:8px;object-fit:cover;cursor:pointer}
    #share-view .sv-chips{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
    #share-view .sv-chip{display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:13px;color:var(--text);text-decoration:none;cursor:pointer}
    #share-view .sv-chip:hover{background:var(--hover)}
    #share-view .sv-footer{margin-top:28px;text-align:center;font-size:12px;color:var(--muted)}
    #share-view .sv-footer a{color:var(--accent);text-decoration:none}
    #share-view .sv-error{text-align:center;padding:60px 0;color:var(--muted)}
  </style><div class="sv-content" id="sv-body"><em style="color:var(--muted)">Loading…</em></div>
  <div class="sv-footer">Shared via <a href="index.html">NoteFlow</a></div>`;
  document.body.appendChild(wrap);

  try {
    const r = await fetch(API_BASE + '/public/notes/' + noteId);
    if (!r.ok) throw new Error(r.status);
    const note = await r.json();
    const body = document.getElementById('sv-body');
    const displayContent = (note.content || '')
      .replace(/<!-- tags -->[\s\S]*?<\/details>/gi, '')
      .replace(/<!-- ocr -->\n/g, '')
      .trim();
    body.innerHTML = marked.parse(displayContent);
    // Render all attachments
    if ((note.attachments || []).length) {
      const imgRow = document.createElement('div');
      imgRow.className = 'sv-images';
      const chipRow = document.createElement('div');
      chipRow.className = 'sv-chips';
      const svImgs = [];

      note.attachments.forEach(att => {
        const mime = att.mime_type || '';
        const fname = att.filename || att.id || 'file';
        const ext = fname.split('.').pop().toLowerCase();
        const pubUrl = API_BASE + '/public/attachments/' + att.id;

        const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/.test(fname.toLowerCase());
        const isVideo = mime.startsWith('video/') || ['mp4','webm','mov','mkv'].includes(ext);
        const isAudio = mime.startsWith('audio/') || ['mp3','ogg','wav','flac','m4a'].includes(ext);

        if (isImage) {
          const img = document.createElement('img');
          img.alt = fname;
          img.loading = 'lazy';
          fetch(pubUrl, { credentials: 'omit' })
            .then(r => r.ok ? r.blob() : Promise.reject(r.status))
            .then(blob => {
              img.src = URL.createObjectURL(blob);
              img._blobUrl = img.src;
              img.addEventListener('click', () => {
                const all = svImgs.map(i => i._blobUrl).filter(Boolean);
                openLightbox(img._blobUrl, all);
              });
            })
            .catch(() => {});
          svImgs.push(img);
          imgRow.appendChild(img);
        } else if (isVideo) {
          const video = document.createElement('video');
          video.controls = true;
          video.style.cssText = 'max-width:100%;border-radius:8px;margin-top:8px;';
          fetch(pubUrl, { credentials: 'omit' })
            .then(r => r.ok ? r.blob() : Promise.reject(r.status))
            .then(blob => { video.src = URL.createObjectURL(blob); })
            .catch(() => {});
          imgRow.appendChild(video);
        } else if (isAudio) {
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.style.cssText = 'width:100%;margin-top:8px;';
          fetch(pubUrl, { credentials: 'omit' })
            .then(r => r.ok ? r.blob() : Promise.reject(r.status))
            .then(blob => { audio.src = URL.createObjectURL(blob); })
            .catch(() => {});
          imgRow.appendChild(audio);
        } else {
          // PDF, office docs, text, and everything else — download chip
          const chip = document.createElement('a');
          chip.className = 'sv-chip';
          chip.textContent = fileIcon(mime) + ' ' + fname;
          chip.href = '#';
          chip.addEventListener('click', async e => {
            e.preventDefault();
            chip.style.opacity = '0.6';
            try {
              const r = await fetch(pubUrl, { credentials: 'omit' });
              if (!r.ok) throw new Error(r.status);
              const blob = await r.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = fname;
              a.click();
            } catch(err) { alert('Download failed'); }
            chip.style.opacity = '1';
          });
          chipRow.appendChild(chip);
        }
      });

      if (imgRow.children.length) body.appendChild(imgRow);
      if (chipRow.children.length) body.appendChild(chipRow);
    }
  } catch(e) {
    document.getElementById('sv-body').innerHTML =
      '<div class="sv-error">Note not found or no longer public.</div>';
  }
})();

// ── Boot ──────────────────────────────────────────────────────────────────────
initSettingsControls();
initCollapsibleSections();
initNavItems();
initProjectAI();
if (initAuth()) {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const v = params.get('v');
  const t = params.get('t');

  (async () => {
    try {
      const boot = await apiGet('/boot');
      // Apply settings
      if (boot.settings && typeof boot.settings === 'object') {
        Object.assign(settings, boot.settings);
        try {
          const prefs = {};
          DISPLAY_PREF_KEYS.forEach(k => { prefs[k] = settings[k]; });
          localStorage.setItem('noteflow_display_prefs', JSON.stringify(prefs));
        } catch(e) {}
      }
      _settingsLoaded = true;
      applyFeedWidth(); applyFontFamily(); applyTheme(settings.theme);
      applyMobileFontSize(); applyShowTags(); syncSettingsControls();

      // Apply cache version check
      const serverVersion = boot.version || 0;
      const localVersion = getCachedVersion();
      if (serverVersion !== localVersion) {
        clearNotesCache();
        setCachedVersion(serverVersion);
      }

      // Apply trackers
      trackers = boot.trackers || [];
      renderTrackerNav();

      // Seed project tags from boot — sidebar populates instantly
      if (Array.isArray(boot.projectTags)) {
        boot.projectTags.forEach(t2 => _knownProjectTags.add(t2));
        renderProjectsNav();
      }

      // Show alert task count badge on Tasks nav item
      if (typeof updateTasksNavBadge === 'function') updateTasksNavBadge(boot.taskAlertCount || 0);

      // Restore state from URL
      if (q) {
        searchInput.value = q;
        searchQuery = q;
        if (searchClear) searchClear.classList.add('visible');
        const r = await fetch(API_BASE + '/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ q: q }),
        });
        if (r.ok) {
          const { notes } = await r.json();
          searchResults = notes || [];
          renderFeed();
        } else {
          loadMemos();
        }
      } else {
        if (v) {
          currentView = v;
          if (v === 'tag' && t) currentTag = t;
          document.getElementById('header-title').textContent = getViewTitle(currentView);
          // Highlight active nav item
          document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
          const selector = v === 'tag' ? `.nav-item[data-project-tag="${t}"]` : `.nav-item[data-view="${v}"]`;
          const item = document.querySelector(selector);
          if (item) item.classList.add('active');
        }
        if (currentView === 'tasks') {
          // Tasks view needs its own renderer, not the notes feed
          document.getElementById('composer').style.display = 'none';
          document.getElementById('load-more').style.display = 'none';
          renderTasksFeed();
        } else {
          loadMemos();
          // Load project AI conversation if landing directly on a project URL
          if (currentView === 'tag' && currentTag && currentTag.startsWith('project:')) {
            if (typeof loadProjectConversation === 'function') loadProjectConversation(currentTag);
          }
        }
      }
    } catch(e) {
      console.error('Boot failed, falling back to individual calls:', e);
      _settingsLoaded = true;
      loadSettings();
      checkCacheVersion();
      loadTrackers();
      loadMemos();
    }
  })();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', {
      scope: '/'
    }).then(reg => {
    console.log('SW registered');

    // Listen for messages from SW (queue updates)
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, size, synced } = event.data || {};
      if (type === 'QUEUE_SIZE') updateQueueBadge(size);
      if (type === 'QUEUE_FLUSHED') {
        updateQueueBadge(remaining || 0);
        if (synced > 0) {
          toast(`✓ Synced ${synced} offline note${synced > 1 ? 's' : ''}`);
          loadMemos(); // Refresh feed so shared note appears
        }
      }
      // SW asking for JWT so it can call the API
      if (type === 'GET_JWT' && event.ports?.[0]) {
        const jwt = document.cookie.split(';')
          .map(c => c.trim())
          .find(c => c.startsWith('CF_Authorization='))
          ?.split('=')?.[1] || null;
        event.ports[0].postMessage({ jwt });
      }
    });

    // Ask SW for current queue size on load (only if controller is ready)
    navigator.serviceWorker.ready.then(() => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_SIZE' });
      }
    });
  }).catch(err => console.warn('SW registration failed:', err));
}
