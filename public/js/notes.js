// ── Load notes ────────────────────────────────────────────────────────────────
async function loadMemos(append = false) {
  try {
    const qs = new URLSearchParams({ pageSize: PAGE_SIZE });
    if (currentView === 'archived') qs.set('filter', 'archived');
    else if (currentView === 'starred') qs.set('filter', 'starred');
    else if (currentView === 'hidden')  qs.set('filter', 'hidden');
    else if (currentView === 'shared')  qs.set('filter', 'shared');
    else if (settings.tasks_hide_from_main_feed) qs.set('hide_tasks', '1');
    if (currentView === 'tag' && currentTag) qs.set('tag', currentTag);
    if (append && nextCursor) qs.set('cursor', nextCursor);

    const data = await apiGet('/notes?' + qs);
    const fetched = data.notes || [];
    if (append) {
      const existingIds = new Set(allMemos.map(m => m.id));
      allMemos = allMemos.concat(fetched.filter(m => !existingIds.has(m.id)));
    } else {
      allMemos = fetched;
    }
    nextCursor = data.nextCursor || null;
    document.getElementById('load-more').style.display = nextCursor ? 'block' : 'none';
    renderFeed(append);
    if (!append) renderProjectsNav();
    // Trigger background prefetch of the full offline cache (debounced — only on first page load)
    if (!append && currentView === 'all') setTimeout(prefetchOfflineCache, 2000);
  } catch(err) {
    console.error(err);
    if (!append && currentView === 'all') {
      const cached = loadNotesCache();
      if (cached.length) {
        allMemos = cached;
        nextCursor = null;
        document.getElementById('load-more').style.display = 'none';
        renderFeed();
        toast('📵 Showing cached notes');
        return;
      }
    }
    toast('Failed to load notes');
  }
}

// Fetch all notes (used by Attachments view)
async function fetchAllMemos() {
  const all = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams({ pageSize: 50 });
    if (cursor) qs.set('cursor', cursor);
    const data = await apiGet('/notes?' + qs);
    all.push(...(data.notes || []));
    cursor = data.nextCursor || null;
  } while (cursor);
  return all;
}

// ── Render feed ───────────────────────────────────────────────────────────────
function getViewTitle(view) {
  if (view === 'tag' && currentTag) return currentTag.replace('project:', '');
  return { all:'All notes', tasks:'Tasks', offline:'Offline', starred:'Starred', hidden:'Hidden', archived:'Archive', shared:'Shared', attachments:'Attachments' }[view] || 'Notes';
}

// ── Archive / Delete ──────────────────────────────────────────────────────────
async function toggleArchive(memo) {
  const isArchived = memo.archived === 1;
  try {
    const result = await apiPatch('/notes/' + memo.id, { archived: !isArchived });
    const updated = result.note;
    const idx = allMemos.findIndex(m => m.id === memo.id);
    if (idx !== -1) {
      if (!isArchived) { allMemos.splice(idx, 1); removeCard(memo.id); }
      else { allMemos[idx] = updated; updateCard(updated); }
    }
    toast(isArchived ? 'Restored from archive' : 'Archived');
  } catch(err) { toast('Error: ' + err.message); }
}

async function confirmDelete(memo) {
  if (!confirm('Permanently delete this note? This cannot be undone.')) return;
  try {
    await apiDelete('/notes/' + memo.id);
    allMemos = allMemos.filter(m => m.id !== memo.id);
    removeCard(memo.id);
    toast('Deleted');
  } catch(err) { toast('Error: ' + err.message); }
}

async function deleteAllArchived() {
  const count = allMemos.length;
  if (!confirm('Permanently delete all ' + count + ' archived notes? This cannot be undone.')) return;
  toast('Deleting…');
  let deleted = 0;
  for (const memo of [...allMemos]) {
    try {
      await apiDelete('/notes/' + memo.id);
      allMemos = allMemos.filter(m => m.id !== memo.id);
      deleted++;
    } catch(e) {}
  }
  renderFeed();
  toast('Deleted ' + deleted + ' notes');
}

// Inline editing — handled per-card in buildCard

function renderFeed(appendMode = false) {
  if (currentView === 'tasks') return;
  const feed = document.getElementById('feed');

  if (!appendMode) {
    feed.innerHTML = '';

    // Hide composer on non-writing views
    const showComposer = ['all', 'starred', 'hidden'].includes(currentView);
    document.getElementById('composer').style.display = showComposer ? '' : 'none';

    // Archive view: inject "Delete all" toolbar
    const existingDeleteAll = document.getElementById('delete-all-bar');
    if (existingDeleteAll) existingDeleteAll.remove();
    if (typeof updateProjectAIVisibility === 'function') updateProjectAIVisibility();

    if (currentView === 'archived' && allMemos.length > 0) {
      const bar = document.createElement('div');
      bar.id = 'delete-all-bar';
      bar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px';
      const btn = document.createElement('button');
      btn.style.cssText = 'background:none;border:1px solid var(--danger);color:var(--danger);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:var(--font-body);transition:all 0.15s';
      btn.textContent = '🗑 Delete all archived';
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--danger)'; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.color = 'var(--danger)'; });
      btn.addEventListener('click', deleteAllArchived);
      bar.appendChild(btn);
      document.getElementById('feed').before(bar);
    }
  }

  // Server search results override the normal feed
  if (searchResults !== null) {
    feed.innerHTML = '';
    const lm = document.getElementById('load-more'); if (lm) lm.style.display = 'none';
    if (searchResults.length === 0) {
      feed.innerHTML = '<div class="empty-state">No notes found.</div>';
      return;
    }
    searchResults.forEach(memo => {
      const isHidden = (memo.tags || []).includes('hidden');
      if (isHidden) {
        // Render a scrambled placeholder — content hidden until user clicks Reveal
        const placeholder = document.createElement('div');
        placeholder.className = 'memo-card hidden-note search-hidden-card';
        placeholder.style.cssText = 'position:relative;overflow:hidden;cursor:default;user-select:none';
        const scramble = (s) => (s || '').replace(/[^\s]/g, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random()*26)]);
        const preview = scramble((memo.content || '').slice(0, 120));
        placeholder.innerHTML = `
          <div style="filter:blur(4px);pointer-events:none;color:var(--text-soft);font-size:14px;line-height:1.6;margin-bottom:28px">${preview}…</div>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">
            <span style="font-size:12px;color:var(--muted)">🔒 Hidden note</span>
            <button class="btn-secondary reveal-hidden-btn" style="font-size:12px;padding:4px 14px">Reveal</button>
          </div>`;
        placeholder.querySelector('.reveal-hidden-btn').addEventListener('click', function() {
          placeholder.replaceWith(buildCard(memo));
        });
        feed.appendChild(placeholder);
      } else {
        feed.appendChild(buildCard(memo));
      }
    });
    return;
  }

  // Deduplicate by memo name (guards against double-appends from pagination)
  const _seen = new Set();
  const _deduped = allMemos.filter(m => {
    if (_seen.has(m.id)) return false;
    _seen.add(m.id);
    return true;
  });

  let visible = _deduped.filter(m => {
    const tags = m.tags || [];
    const isHidden  = tags.includes('hidden');
    const isStarred = tags.includes('starred');
    const isShared  = m.visibility === 'PUBLIC' || m.visibility === 'PROTECTED';
    const hasAttachments = m.attachments && m.attachments.length > 0;

    if (currentView === 'all')              { if (isHidden) return false; }
    else if (currentView === 'starred')     { if (!isStarred) return false; }
    else if (currentView === 'hidden')      { if (!isHidden) return false; }
    else if (currentView === 'archived')    { /* filtered by API */ }
    else if (currentView === 'shared')      { if (!isShared) return false; }
    else if (currentView === 'attachments') { if (!hasAttachments) return false; }

    return true;
  });

  if (currentView === 'attachments') {
    renderAttachmentsGallery(feed, visible);
    const lm = document.getElementById('load-more');
    if (lm) lm.style.display = (nextCursor && !settings.infiniteScroll) ? 'block' : 'none';
    return;
  }

  if (!appendMode && visible.length === 0) {
    feed.innerHTML = '<div class="empty-state">No notes here yet.</div>';
    return;
  }

  // In append mode, only render the new cards (those not already in the DOM)
  const existingIds = new Set([...feed.querySelectorAll('[data-memo-name]')].map(el => el.dataset.memoName));
  const toRender = appendMode ? visible.filter(m => !existingIds.has(m.id)) : visible;
  toRender.forEach(memo => feed.appendChild(buildCard(memo)));

  const lm = document.getElementById('load-more');
  if (lm) lm.style.display = (nextCursor && !settings.infiniteScroll) ? 'block' : 'none';
}

// ── Apply max height to card content ─────────────────────────────────────────
function applyMaxHeight(wrap) {
  if (!settings.maxHeight || settings.maxHeight === 0) {
    wrap.style.maxHeight = '';
    wrap.classList.remove('clamped');
    const existing = wrap.parentNode?.querySelector('.read-more-btn');
    if (existing) existing.remove();
    return;
  }
  wrap.style.maxHeight = settings.maxHeight + 'px';
  requestAnimationFrame(() => {
    const inner = wrap.querySelector('.card-content');
    // Temporarily open all <details> so scrollHeight reflects full expanded content
    const detailsEls = inner ? [...inner.querySelectorAll('details')] : [];
    const wasOpen = detailsEls.map(d => d.open);
    detailsEls.forEach(d => { d.open = true; });
    const fullHeight = inner ? inner.scrollHeight : 0;
    detailsEls.forEach((d, i) => { d.open = wasOpen[i]; });
    if (inner && fullHeight > settings.maxHeight) {
      wrap.classList.add('clamped');
      if (!wrap.parentNode?.querySelector('.read-more-btn')) {
        const btn = document.createElement('button');
        btn.className = 'read-more-btn';
        btn.textContent = 'Show more';
        btn.addEventListener('click', e => {
          e.stopPropagation();
          wrap.style.maxHeight = '';
          wrap.classList.remove('clamped');
          btn.remove();
        });
        wrap.insertAdjacentElement('afterend', btn);
      }
    }
  });
}

function renderAttachmentsGallery(feed, memos) {
  if (!memos.length) {
    feed.innerHTML = '<div class="empty-state">No attachments found.</div>';
    return;
  }
  const gallery = document.createElement('div');
  gallery.className = 'att-gallery';
  // Flatten all attachments and apply per-page limit
  const _allAtts = [];
  memos.forEach(memo => { (memo.attachments || []).forEach(att => { if (att.id) _allAtts.push({ att, memo }); }); });
  const _limit = settings.attachmentsPerPage || 27;
  _allAtts.slice(0, _limit).forEach(({ att, memo }) => {
      if (!att.id) return;
      const url = attachmentUrl(att);
      const fname = att.filename || att.id || 'file';
      const mime = att.mime_type || att.type || '';
      const item = document.createElement('div');
      item.className = 'att-gallery-item';

      if (isImageAttachment(att)) {
        const img = document.createElement('img');
        img.className = 'att-gallery-img';
        img.alt = fname;
        img.style.opacity = '0.4';
        getAttachmentBlob(att, url)
          .then(blob => { img.src = URL.createObjectURL(blob); img.style.opacity = '1'; img._blobUrl = img.src; })
          .catch(() => { img.style.opacity = '0.3'; });
        img.addEventListener('click', () => { if (img._blobUrl) openLightbox(img._blobUrl, [img._blobUrl]); });
        item.appendChild(img);
      } else {
        const icon = document.createElement('div');
        icon.className = 'att-gallery-icon';
        // Show emoji icon + filename hint
        const mimeIcon = fileIcon(mime);
        icon.innerHTML = '<div style="font-size:36px">' + mimeIcon + '</div><div style="font-size:10px;color:var(--muted);margin-top:4px;padding:0 6px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">' + escHtml(fname) + '</div>';
        icon.style.cssText = 'cursor:pointer;flex-direction:column';
        icon.title = 'Download ' + fname;
        icon.addEventListener('click', async () => {
          const ext = fname.split('.').pop().toLowerCase();
          const isPdf   = mime === 'application/pdf' || ext === 'pdf';
          const isVideo = mime.startsWith('video/') || ['mp4','webm','mov','mkv'].includes(ext);
          const isAudio = mime.startsWith('audio/') || ['mp3','ogg','wav','flac','m4a'].includes(ext);
          const isText  = mime.startsWith('text/') || ['txt','md','csv','json','xml','html','js','css'].includes(ext);
          const isIndexed = ['docx','doc','xlsx','xls','odt','ods','odp'].includes(ext);
          if (isPdf || isVideo || isAudio || isText || isIndexed) {
            openFilePreview(att, fname, mime, url, isPdf, isVideo, isAudio, isText, isIndexed);
          } else {
            try {
              icon.style.opacity = '0.6';
              const r = await fetch(url, { credentials: 'omit', headers: authHeaders() });
              if (!r.ok) throw new Error('Download failed');
              const blob = await r.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl; a.download = fname; a.click();
              setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            } catch(e) { toast('Download failed: ' + e.message); }
            finally { icon.style.opacity = '1'; }
          }
        });
        item.appendChild(icon);
      }

      const meta = document.createElement('div');
      meta.className = 'att-gallery-meta';
      const name = document.createElement('div');
      name.className = 'att-gallery-name';
      name.title = fname;
      name.textContent = fname;
      meta.appendChild(name);

      // Link back to originating note
      const noteDate = formatDate(memo.created_at ? new Date(memo.created_at * 1000).toISOString() : null);
      const link = document.createElement('div');
      link.className = 'att-gallery-link';
      link.textContent = '↗ Note from ' + noteDate;
      link.addEventListener('click', e => {
        e.stopPropagation();
        // Switch to all notes view and scroll to the memo
        switchView('all');
        setTimeout(() => {
          const el = document.querySelector('[data-memo-name="' + memo.id + '"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 600);
      });
      meta.appendChild(link);
      item.appendChild(meta);
      gallery.appendChild(item);
  });
  feed.appendChild(gallery);
}

// ── Targeted card update — replace a single card without rebuilding the feed ──
function updateCard(memo) {
  const existing = document.querySelector(`.memo-card[data-memo-name="${memo.id}"]`);
  if (!existing) return false; // card not in DOM — fall back to renderFeed
  const newCard = buildCard(memo);
  existing.replaceWith(newCard);
  return true;
}

// ── Remove a card from DOM without rebuilding ─────────────────────────────────
function removeCard(memoId) {
  const existing = document.querySelector(`.memo-card[data-memo-name="${memoId}"]`);
  if (existing) existing.remove();
}
