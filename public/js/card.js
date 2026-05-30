function buildCard(memo) {
  const tags     = memo.tags || [];
  const isStarred = tags.includes('starred');
  const isHidden  = tags.includes('hidden');
  const isPinned  = memo.pinned;
  const isShared  = memo.visibility === 'PUBLIC';

  const card = document.createElement('div');
  card.className = 'memo-card' +
    (isStarred ? ' starred' : '') +
    (isHidden  ? ' hidden-note' : '') +
    (isPinned  ? ' pinned' : '');
  card.dataset.memoName = memo.id;

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const date = document.createElement('span');
  date.className = 'card-date';
  date.textContent = formatDate(memo.created_at ? new Date(memo.created_at * 1000).toISOString() : null);
  meta.appendChild(date);

  const badges = document.createElement('div');
  badges.className = 'card-badges';
  if (isPinned) badges.innerHTML += '<span class="badge badge-pinned">📌</span>';
  if (isShared) badges.innerHTML += '<span class="badge badge-pinned">🔗</span>';
  meta.appendChild(badges);
  header.appendChild(meta);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  // Project filing button (replaces star)
  const projectBtn = makeActionBtn(
    '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    'Add to project'
  );
  const currentProjects = (memo.tags || []).filter(t => t.startsWith('project:'));
  if (currentProjects.length > 0) projectBtn.classList.add('star-active');
  projectBtn.addEventListener('click', e => { e.stopPropagation(); openProjectPopover(memo, projectBtn); });
  actions.appendChild(projectBtn);

  // Pin
  const pinBtn = makeActionBtn(
    '<svg viewBox="0 0 24 24"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
    isPinned ? 'Unpin' : 'Pin to top'
  );
  if (isPinned) pinBtn.classList.add('star-active');
  pinBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const updated = await apiPatch('/notes/' + memo.id, { pinned: !memo.pinned });
      const idx = allMemos.findIndex(m => m.id === memo.id);
      if (idx !== -1) allMemos[idx] = { ...allMemos[idx], ...updated.note };
      renderFeed();
    } catch(err) { toast('Failed to update pin'); }
  });
  actions.appendChild(pinBtn);

  // Hide
  const hideBtn = makeActionBtn(
    isHidden
      ? '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    isHidden ? 'Unhide' : 'Hide'
  );
  hideBtn.addEventListener('click', e => { e.stopPropagation(); toggleTag(memo, 'hidden'); });
  actions.appendChild(hideBtn);

  // More menu (Share, Email, Keep Offline)
  const moreBtn = makeActionBtn(
    '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;pointer-events:none"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    'More'
  );
  moreBtn.addEventListener('click', e => { e.stopPropagation(); openMorePopover(memo, moreBtn); });
  actions.appendChild(moreBtn);

  if (currentView === 'archived') {
    // In archive view: show Unarchive + Delete
    const unarchiveBtn = makeActionBtn('<svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>', 'Restore');
    unarchiveBtn.addEventListener('click', e => { e.stopPropagation(); toggleArchive(memo); });
    actions.appendChild(unarchiveBtn);

    const deleteBtn = makeActionBtn('<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>', 'Delete permanently');
    deleteBtn.classList.add('danger');
    deleteBtn.addEventListener('click', e => { e.stopPropagation(); confirmDelete(memo); });
    actions.appendChild(deleteBtn);
  } else {
    // Normal views: archive only
    const archiveBtn = makeActionBtn('<svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>', 'Archive');
    archiveBtn.addEventListener('click', e => { e.stopPropagation(); toggleArchive(memo); });
    actions.appendChild(archiveBtn);
  }

  header.appendChild(actions);
  card.appendChild(header);

  // ── Inline editor (native markdown) ──────────────────────────────────────
  const inlineWrap = document.createElement('div');
  inlineWrap.className = 'inline-editor-wrap';

  // Toolbar
  const inlineMdWrap = document.createElement('div');
  inlineMdWrap.className = 'inline-md-wrap';

  const inlineTb = document.createElement('div');
  inlineTb.className = 'md-toolbar';
  inlineTb.innerHTML = '<button class="md-btn" data-md="bold" title="Bold"><b>B</b></button>'
    + '<button class="md-btn" data-md="italic" title="Italic"><i>I</i></button>'
    + '<button class="md-btn" data-md="strike" title="Strike"><s>S</s></button>'
    + '<div class="md-sep"></div>'
    + '<button class="md-btn" data-md="h2" title="Heading">H2</button>'
    + '<button class="md-btn" data-md="h3" title="Subheading">H3</button>'
    + '<div class="md-sep"></div>'
    + '<button class="md-btn" data-md="ul" title="Bullet"><svg viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg></button>'
    + '<button class="md-btn" data-md="collapsible" title="Collapsible section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 15 11"/><line x1="3" y1="8" x2="21" y2="8"/></svg></button>'
    + '<button class="md-btn" data-md="quote" title="Quote"><svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg></button>'
    + '<button class="md-btn" data-md="code" title="Code"><svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>'
    + '<div class="md-sep"></div>'
    + '<button class="md-btn md-preview-btn" title="Preview"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>';

  const inlineTextarea = document.createElement('textarea');
  inlineTextarea.className = 'md-textarea';

  // Preview div (hidden until toggled)
  const inlinePreview = document.createElement('div');
  inlinePreview.className = 'md-preview';
  inlinePreview.style.display = 'none';
  inlinePreview.title = 'Click to edit';
  inlinePreview.addEventListener('click', () => {
    inlinePreview.style.display = 'none';
    inlineTextarea.style.display = '';
    inlineTextarea.focus();
    inlinePreviewBtn.innerHTML = SVG_EYE;
    inlinePreviewBtn.title = 'Preview';
  });

  const inlinePreviewBtn = inlineTb.querySelector ? inlineTb.querySelector('[data-md="preview"]') : null;

  function inlineTogglePreview() {
    if (inlinePreview.style.display === 'none') {
      inlinePreview.innerHTML = marked.parse(inlineTextarea.value || '');
      inlinePreview.style.display = 'block';
      inlineTextarea.style.display = 'none';
    } else {
      inlinePreview.style.display = 'none';
      inlineTextarea.style.display = '';
      inlineTextarea.focus();
    }
  }

  attachMdToolbar(inlineTb, inlineTextarea);
  inlineTb.querySelector('.md-preview-btn').addEventListener('mousedown', e => {
    e.preventDefault();
    inlineTogglePreview();
  });
  inlineTextarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 320) + 'px';
  });
  inlineTextarea.addEventListener('blur', () => {
    setTimeout(() => {
      if (card.classList.contains('card-editing') && inlineTextarea.value.trim()) {
        inlinePreview.innerHTML = marked.parse(inlineTextarea.value || '');
        inlinePreview.style.display = 'block';
        inlineTextarea.style.display = 'none';
      }
    }, 200);
  });
  inlineMdWrap.appendChild(inlineTb);
  inlineMdWrap.appendChild(inlineTextarea);
  inlineMdWrap.appendChild(inlinePreview);
  inlineWrap.appendChild(inlineMdWrap);

  // Footer: attach + cancel + save
  const inlineFooter = document.createElement('div');
  inlineFooter.className = 'inline-edit-footer';

  const inlineLeft = document.createElement('div');
  inlineLeft.style.cssText = 'display:flex;gap:6px;align-items:center';
  const inlineAttachBtn = document.createElement('button');
  inlineAttachBtn.className = 'attach-btn';
  inlineAttachBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;pointer-events:none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Attach';
  const inlineFileInput = document.createElement('input');
  inlineFileInput.type = 'file'; inlineFileInput.accept = '*/*'; inlineFileInput.multiple = true;
  inlineFileInput.style.display = 'none';
  inlineAttachBtn.addEventListener('click', () => inlineFileInput.click());
  let inlinePendingFiles = [];
  inlineFileInput.addEventListener('change', async e => {
    for (const f of e.target.files) inlinePendingFiles.push(f);
    inlineAttachBtn.textContent = '📎 ' + inlinePendingFiles.length + ' file(s)';
  });

  inlineLeft.appendChild(inlineAttachBtn);
  inlineLeft.appendChild(inlineFileInput);

  const inlineRight = document.createElement('div');
  inlineRight.style.cssText = 'display:flex;gap:6px';

  const inlineCancelBtn = document.createElement('button');
  inlineCancelBtn.className = 'btn-ghost';
  inlineCancelBtn.style.fontSize = '12px';
  inlineCancelBtn.textContent = 'Cancel';
  inlineCancelBtn.addEventListener('click', e => {
    e.stopPropagation();
    card.classList.remove('card-editing');
    inlinePendingFiles = [];
  });

  const inlineSaveBtn = document.createElement('button');
  inlineSaveBtn.className = 'btn-primary';
  inlineSaveBtn.style.fontSize = '12px';
  inlineSaveBtn.textContent = 'Save';
  inlineSaveBtn.addEventListener('click', async e => {
    e.stopPropagation();
    inlineSaveBtn.disabled = true; inlineSaveBtn.textContent = 'Saving…';
    try {
      const content = inlineTextarea.value;
      const newAtts = [];
      for (const f of inlinePendingFiles) {
        try {
          const a = await uploadAttachment(f, memo.id);
          if (a.attachment) newAtts.push(a.attachment);
        } catch(err) { console.warn('Attachment upload failed:', err); }
      }
      const result = await apiPatch('/notes/' + memo.id, { content, tags: memo.tags || [] });
      const updated = result.note || result;
      const idx = allMemos.findIndex(m => m.id === memo.id);
      if (idx !== -1) {
        const existingAtts = allMemos[idx].attachments || [];
        allMemos[idx] = { ...updated, attachments: [...existingAtts, ...newAtts] };
        // Keep searchResults in sync if we're in search mode
        if (searchResults !== null) {
          const si = searchResults.findIndex(m => m.id === memo.id);
          if (si !== -1) searchResults[si] = allMemos[idx];
        }
        const newVersion = updated.updated_at || Math.floor(Date.now() / 1000);
        saveNotesCache(allMemos, newVersion);
        setCachedVersion(Math.max(getCachedVersion(), newVersion));
      }
      card.classList.remove('card-editing');
      inlinePendingFiles = [];
      const savedMemo = allMemos.find(m => m.id === memo.id) || memo;
      updateCard(savedMemo);
      toast('Saved ✓');
      // Run AI tagging in background after inline edit
      (async () => {
        try {
          const aiTagList = await aiTags(content);
          if (aiTagList.length > 0) {
            const existingTags = (allMemos.find(m => m.id === memo.id)?.tags || []);
            const merged = [...new Set([...existingTags, ...aiTagList])];
            await apiPatch('/notes/' + memo.id, { tags: merged });
            const i2 = allMemos.findIndex(m => m.id === memo.id);
            if (i2 !== -1) { allMemos[i2].tags = merged; updateCard(allMemos[i2]); }
          }
        } catch(e) { console.error('AI tagging failed (inline):', e.message); }
      })();
    } catch(err) { toast('Error: ' + err.message); }
    inlineSaveBtn.disabled = false; inlineSaveBtn.textContent = 'Save';
  });

  inlineRight.appendChild(inlineCancelBtn);
  inlineRight.appendChild(inlineSaveBtn);
  inlineFooter.appendChild(inlineLeft);
  inlineFooter.appendChild(inlineRight);
  inlineWrap.appendChild(inlineFooter);
  card.appendChild(inlineWrap);

  // Double-click/double-tap to enter edit mode
  card.addEventListener('dblclick', e => {
    if (e.target.closest('.card-action-btn') || e.target.closest('.tag-pill')) return;
    if (card.classList.contains('card-editing')) return;
    const _ec = (memo.content || '')
      .replace(/<!-- tags -->[\s\S]*?<\/details>/gi, '')
      .replace(/<!-- ocr -->[\s\S]*?<\/details>/gi, '')
      .trim();
    inlinePendingFiles = [];
    inlineAttachBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;pointer-events:none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Attach';
    inlineTextarea.value = _ec;
    // Reset preview state so edit mode starts with raw textarea
    inlinePreview.style.display = 'none';
    inlineTextarea.style.display = '';
    card.classList.add('card-editing');
    setTimeout(() => {
      inlineTextarea.focus();
      inlineTextarea.setSelectionRange(_ec.length, _ec.length);
      inlineTextarea.style.height = 'auto';
      inlineTextarea.style.height = Math.min(inlineTextarea.scrollHeight, 320) + 'px';
    }, 30);
  });

  // Content
  const displayContent = (memo.content || '')
    .replace(/<!-- tags -->[\s\S]*?<\/details>/gi, '')  // strip hidden tag metadata
    // OCR block: keep as collapsible <details> but remove the HTML comment marker
    .replace(/<!-- ocr -->\n/g, '')
    .trim();

  const contentWrap = document.createElement('div');
  contentWrap.className = 'card-content-wrap';
  const content = document.createElement('div');
  content.className = 'card-content';
  content.innerHTML = marked.parse(displayContent);
  contentWrap.appendChild(content);
  applyMaxHeight(contentWrap);
  card.appendChild(contentWrap);

  // Attachments
  if (memo.attachments && memo.attachments.length) {
    const attRow = document.createElement('div');
    attRow.className = 'card-images';
    // Images first
    memo.attachments.forEach(att => {
      if (!att.id || !isImageAttachment(att)) return;
      const url = attachmentUrl(att);
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.style.opacity = '0.4';
      // Fetch with auth token (checks offline cache first)
      getAttachmentBlob(att, url)
        .then(blob => {
          img.src = URL.createObjectURL(blob);
          img.style.opacity = '1';
          img._blobUrl = img.src; // store for lightbox
        })
        .catch(() => { img.alt = att.filename || 'image'; img.style.opacity = '0.3'; });
      img.addEventListener('click', () => {
        if (!img._blobUrl) return;
        // Collect all loaded blob URLs from this card's image row
        const allUrls = Array.from(attRow.querySelectorAll('img'))
          .map(i => i._blobUrl).filter(Boolean);
        openLightbox(img._blobUrl, allUrls);
      });
      attRow.appendChild(img);
    });
    // Non-image file chips after
    memo.attachments.forEach(att => {
      if (!att.id || isImageAttachment(att)) return;
      const url = attachmentUrl(att);
      const mime = att.mime_type || att.type || '';
      const fname = att.filename || att.id || 'file';
      const ext = fname.split('.').pop().toLowerCase();
      const isPdf     = mime === 'application/pdf' || ext === 'pdf';
      const isVideo   = mime.startsWith('video/') || ['mp4','webm','mov','mkv'].includes(ext);
      const isAudio   = mime.startsWith('audio/') || ['mp3','ogg','wav','flac','m4a'].includes(ext);
      const isText    = mime.startsWith('text/') || ['txt','md','csv','json','xml','html','js','css'].includes(ext);
      const isIndexed = ['docx','doc','xlsx','xls','odt','ods','odp'].includes(ext);
      const canPreview = isPdf || isVideo || isAudio || isText || isIndexed;

      const chip = document.createElement('button');
      chip.className = 'file-chip' + (canPreview ? ' file-chip-preview' : '');
      const isIndexing = att._indexing === true;
      chip.innerHTML = fileIcon(mime) + ' <span>' + escHtml(fname) + '</span>' + (isIndexing ? ' <small style="opacity:0.6;font-size:10px">⏳</small>' : (canPreview ? ' <small style="opacity:0.5;font-size:10px">▶</small>' : ''));
      chip.title = isIndexing ? 'Indexing for preview…' : (canPreview ? 'Preview ' + fname : 'Download ' + fname);

      chip.addEventListener('click', async () => {
        if (canPreview) {
          openFilePreview(att, fname, mime, url, isPdf, isVideo, isAudio, isText, isIndexed);
        } else {
          chip.style.opacity = '0.6';
          try {
            const r = await fetch(url, { credentials: 'omit', headers: authHeaders() });
            if (!r.ok) throw new Error('Download failed: ' + r.status);
            const blob = await r.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = fname; a.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
          } catch(e) { toast('Download failed: ' + e.message); }
          chip.style.opacity = '1';
        }
      });
      attRow.appendChild(chip);
    });
    if (attRow.children.length) card.appendChild(attRow);
  }

  // Tags (visible only)
  const visibleTags = tags.filter(t => !SPECIAL_TAGS.includes(t));
  if (visibleTags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'card-tags';
    visibleTags.forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = '#' + t;
      tagRow.appendChild(pill);
    });
    card.appendChild(tagRow);
  }

  return card;
}

function makeActionBtn(svgHtml, title) {
  const btn = document.createElement('button');
  btn.className = 'card-action-btn';
  btn.title = title;
  btn.innerHTML = svgHtml;
  return btn;
}

// ── Projects ──────────────────────────────────────────────────────────────────
function closeProjectPopover() {
  if (_projectPopoverEl) { _projectPopoverEl.remove(); _projectPopoverEl = null; }
}

function openProjectPopover(memo, anchorBtn) {
  closeProjectPopover();
  closeMorePopover();
  document.removeEventListener('click', closeProjectPopover);
  document.removeEventListener('click', closeMorePopover);

  const currentProjects = (memo.tags || []).filter(t => t.startsWith('project:'));
  const allProjectTags = [..._knownProjectTags].sort();

  const pop = document.createElement('div');
  pop.className = 'project-popover';
  pop.addEventListener('click', e => e.stopPropagation());

  // Existing projects
  if (allProjectTags.length > 0) {
    allProjectTags.forEach(tag => {
      const name = tag.replace('project:', '');
      const btn = document.createElement('button');
      btn.className = 'project-popover-item' + (currentProjects.includes(tag) ? ' active-project' : '');
      btn.textContent = (currentProjects.includes(tag) ? '✓ ' : '') + name;
      btn.addEventListener('click', async () => {
        closeProjectPopover();
        await toggleTag(memo, tag);
        renderProjectsNav();
      });
      pop.appendChild(btn);
    });
    const div = document.createElement('div');
    div.className = 'project-popover-divider';
    pop.appendChild(div);
  }

  // New project input
  const newRow = document.createElement('div');
  newRow.className = 'project-popover-new';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New project…';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';
  const doAdd = async () => {
    const raw = input.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-æøå]/g, '');
    if (!raw) return;
    closeProjectPopover();
    await toggleTag(memo, 'project:' + raw);
    renderProjectsNav();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  addBtn.addEventListener('click', doAdd);
  newRow.appendChild(input);
  newRow.appendChild(addBtn);
  pop.appendChild(newRow);

  // Position below anchor
  document.body.appendChild(pop);
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
  _projectPopoverEl = pop;
  setTimeout(() => input.focus(), 50);
  setTimeout(() => document.addEventListener('click', closeProjectPopover, { once: true }), 10);
}

function closeMorePopover() {
  if (_morePopoverEl) { _morePopoverEl.remove(); _morePopoverEl = null; }
}
function openMorePopover(memo, anchorBtn) {
  closeMorePopover();
  closeProjectPopover();
  document.removeEventListener('click', closeMorePopover);
  document.removeEventListener('click', closeProjectPopover);

  const pop = document.createElement('div');
  pop.className = 'project-popover';
  pop.style.minWidth = '140px';
  pop.addEventListener('click', e => e.stopPropagation());

  // Share
  const shareBtn = document.createElement('button');
  shareBtn.className = 'project-popover-item';
  shareBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share';
  shareBtn.addEventListener('click', () => { closeMorePopover(); openShareModal(memo); });
  pop.appendChild(shareBtn);

  // Email
  const emailBtn = document.createElement('button');
  emailBtn.className = 'project-popover-item';
  emailBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email';
  emailBtn.addEventListener('click', () => { closeMorePopover(); sendNoteByEmail(memo); });
  pop.appendChild(emailBtn);

  const div = document.createElement('div');
  div.className = 'project-popover-divider';
  pop.appendChild(div);

  // Keep Offline
  const isKept = (memo.tags || []).includes('keep-offline');
  const offlineBtn = document.createElement('button');
  offlineBtn.className = 'project-popover-item' + (isKept ? ' active-project' : '');
  offlineBtn.innerHTML = (isKept ? '✓ ' : '') + '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg> Keep offline';
  offlineBtn.addEventListener('click', async () => {
    closeMorePopover();
    await toggleTag(memo, 'keep-offline');
  });
  pop.appendChild(offlineBtn);

  // Convert to task (notes only)
  if (!memo.is_task) {
    const div2 = document.createElement('div');
    div2.className = 'project-popover-divider';
    pop.appendChild(div2);

    const toTaskBtn = document.createElement('button');
    toTaskBtn.className = 'project-popover-item';
    toTaskBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"><polyline points="9 11 12 14 20 6"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg> Convert to task';
    toTaskBtn.addEventListener('click', async () => {
      closeMorePopover();
      try {
        await apiPatch('/notes/' + memo.id, { is_task: 1, priority: null, due_date: null });
        const idx = allMemos.findIndex(m => m.id === memo.id);
        if (idx !== -1) allMemos.splice(idx, 1);
        removeCard(memo.id);
        toast('Converted to task');
      } catch(e) { toast('Error: ' + e.message); }
    });
    pop.appendChild(toTaskBtn);
  }

  // Position below anchor
  document.body.appendChild(pop);
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
  _morePopoverEl = pop;
  setTimeout(() => document.addEventListener('click', closeMorePopover, { once: true }), 10);
}

// ── Toggle tag via API ────────────────────────────────────────────────────────
async function toggleTag(memo, tag) {
  const currentTags = Array.isArray(memo.tags) ? memo.tags : [];
  const hasTag = currentTags.includes(tag);
  const newTags = hasTag
    ? currentTags.filter(t => t !== tag)
    : [...currentTags, tag];

  try {
    const result = await apiPatch('/notes/' + memo.id, { tags: newTags });
    const updated = result.note || result;
    const idx = allMemos.findIndex(m => m.id === memo.id);
    if (idx !== -1) { allMemos[idx] = updated; updateCard(updated); }
    if (searchResults) {
      const si = searchResults.findIndex(m => m.id === memo.id);
      if (si !== -1) { searchResults[si] = updated; updateCard(updated); }
    }
    toast(hasTag ? tag + ' removed' : '⭐ ' + tag);
  } catch(err) {
    toast('Error: ' + err.message);
  }
}

// ── Share modal ───────────────────────────────────────────────────────────────
function openShareModal(memo) {
  shareTargetMemo = memo;
  const vis = memo.visibility || 'PRIVATE';
  document.getElementById('share-vis').value = vis;
  document.getElementById('share-current-vis').textContent =
    'Current: ' + { PRIVATE: 'Private', PUBLIC: 'Public' }[vis] || 'Private';

  const linkWrap = document.getElementById('share-link-wrap');
  if (vis !== 'PRIVATE') {
    linkWrap.style.display = 'block';
    document.getElementById('share-link-input').value = SHARE_BASE + '/note/' + memo.id;
  } else {
    linkWrap.style.display = 'none';
  }
  document.getElementById('share-modal').classList.add('open');
}

document.getElementById('share-vis').addEventListener('change', function() {
  const linkWrap = document.getElementById('share-link-wrap');
  if (this.value !== 'PRIVATE' && shareTargetMemo) {
    linkWrap.style.display = 'block';
    document.getElementById('share-link-input').value = SHARE_BASE + '/note/' + shareTargetMemo.id;
  } else {
    linkWrap.style.display = 'none';
  }
});

document.getElementById('share-cancel').addEventListener('click', () => {
  document.getElementById('share-modal').classList.remove('open');
});

document.getElementById('share-save').addEventListener('click', async () => {
  if (!shareTargetMemo) return;
  const vis = document.getElementById('share-vis').value;
  try {
    const result = await apiPatch('/notes/' + shareTargetMemo.id, { visibility: vis });
    const updated = result.note || result;
    const idx = allMemos.findIndex(m => m.id === shareTargetMemo.id);
    if (idx !== -1) allMemos[idx] = updated;
    document.getElementById('share-modal').classList.remove('open');
    renderFeed();
    toast('Visibility updated');
  } catch(err) { toast('Error: ' + err.message); }
});

document.getElementById('copy-link-btn').addEventListener('click', () => {
  const input = document.getElementById('share-link-input');
  navigator.clipboard.writeText(input.value).then(() => toast('Link copied!')).catch(() => {
    input.select(); document.execCommand('copy'); toast('Link copied!');
  });
});

// ── Swipe left to archive (mobile gesture) ───────────────────────────────────
(function() {
  let startX = 0, startY = 0, activeCard = null, isSwiping = false;

  function getCard(el) {
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('memo-card')) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    const card = getCard(e.target);
    if (!card) return;
    if (e.target.closest('button, a, input, textarea, select, label')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    activeCard = card;
    isSwiping = false;
    card.style.transition = '';
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!activeCard) return;
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);

    if (!isSwiping) {
      if (Math.abs(dx) < 8 && dy < 8) return;
      if (dy > Math.abs(dx) || dx > 0) { activeCard = null; return; }
      isSwiping = true;
    }

    e.preventDefault();
    const clamped = Math.max(dx, -activeCard.offsetWidth);
    activeCard.style.transform = 'translateX(' + clamped + 'px)';
    activeCard.style.background = Math.abs(clamped) >= 80 ? '#fde8e8' : '';
  }, { passive: false });

  document.addEventListener('touchend', function(e) {
    if (!activeCard || !isSwiping) { activeCard = null; isSwiping = false; return; }
    const dx = e.changedTouches[0].clientX - startX;
    const card = activeCard;
    activeCard = null;
    isSwiping = false;

    if (dx < -80) {
      const id = card.dataset.memoName;
      card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      card.style.transform = 'translateX(-110%)';
      card.style.opacity = '0';
      apiPatch('/notes/' + id, { archived: true }).then(() => {
        const idx = allMemos.findIndex(function(m) { return m.id === id; });
        if (idx !== -1) allMemos.splice(idx, 1);
        setTimeout(function() { if (card.parentElement) card.remove(); }, 260);
        toast('Archived');
      }).catch(function(err) {
        card.style.transition = 'transform 0.3s ease, opacity 0.3s ease, background 0.2s';
        card.style.transform = '';
        card.style.opacity = '';
        card.style.background = '';
        toast('Error: ' + err.message);
      });
    } else {
      card.style.transition = 'transform 0.3s ease, background 0.2s';
      card.style.transform = '';
      card.style.background = '';
    }
  }, { passive: true });
})();
