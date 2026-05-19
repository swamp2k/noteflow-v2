// ── AI helpers ────────────────────────────────────────────────────────────────
// Unified entry point used by save flow and bulk tagger.
// Calls the worker which uses the server-side Anthropic key.
async function aiTags(content) {
  const stripped = (content || '').replace(/#[\wÀ-ɏ-]+/g, '').replace(/<[^>]+>/g, '').trim();
  if (stripped.length < 15) return [];
  const categories = (settings.tagCategories || '').split(',').map(s => s.trim()).filter(Boolean);
  const people     = (settings.tagPeople     || '').split(',').map(s => s.trim()).filter(Boolean);
  const data = await apiPost('/notes/autotag', { content: stripped.slice(0, 2000), categories, people });
  return Array.isArray(data.tags) ? data.tags : [];
}

// ── Image handling ────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onloadend = () => res({ base64: reader.result.split(',')[1], mediaType: file.type || 'image/jpeg' });
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function addFile(file) {
  const { base64, mediaType } = await fileToBase64(file);
  const entry = { file, base64, mediaType, ocrText: null, ocrLoading: false };
  if (mediaType.startsWith('image/')) {
    entry.ocrLoading = true;
    pendingImages.push(entry);
    renderImagePreviews();
    try {
      entry.ocrText = await claudeVision(base64, mediaType) || null;
    } catch(e) { entry.ocrText = null; }
    entry.ocrLoading = false;
    renderImagePreviews();
  } else {
    pendingImages.push(entry);
    renderImagePreviews();
  }
}

function renderImagePreviews() {
  const area = document.getElementById('image-preview-area');
  area.innerHTML = '';
  pendingImages.forEach((img, i) => {
    const wrap = document.createElement('div');
    const isImage = img.mediaType.startsWith('image/');
    if (isImage) {
      wrap.className = 'img-preview-wrap';
      const el = document.createElement('img');
      el.src = 'data:' + img.mediaType + ';base64,' + img.base64;
      wrap.appendChild(el);
      const badge = document.createElement('div');
      badge.className = 'ocr-badge';
      badge.textContent = img.ocrLoading ? '…' : (img.ocrText ? '✓' : '');
      if (img.ocrLoading || img.ocrText) wrap.appendChild(badge);
    } else {
      wrap.className = 'img-preview-wrap';
      wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;width:auto;height:auto;padding:6px 10px;gap:6px;font-size:13px;max-width:180px';
      const icon = document.createElement('span');
      icon.textContent = fileIcon(img.mediaType);
      const name = document.createElement('span');
      name.textContent = img.file.name;
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px';
      wrap.appendChild(icon);
      wrap.appendChild(name);
    }
    const rm = document.createElement('button');
    rm.className = 'img-remove'; rm.textContent = '✕';
    rm.onclick = () => { pendingImages.splice(i, 1); renderImagePreviews(); };
    wrap.appendChild(rm);
    area.appendChild(wrap);
  });
}

// ── Markdown toolbar ──────────────────────────────────────────────────────────
function mdInsert(ta, cmd) {
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const lineStart = before.lastIndexOf('\n') + 1;
  const linePrefix = before.slice(lineStart);

  let newText, cursorOffset, selOffset;
  switch (cmd) {
    case 'bold':    newText = '**' + (sel || 'bold text') + '**'; cursorOffset = sel ? newText.length : 2; selOffset = sel ? 0 : newText.length - 4; break;
    case 'italic':  newText = '*' + (sel || 'italic text') + '*'; cursorOffset = sel ? newText.length : 1; selOffset = sel ? 0 : newText.length - 2; break;
    case 'strike':  newText = '~~' + (sel || 'text') + '~~'; cursorOffset = sel ? newText.length : 2; selOffset = sel ? 0 : newText.length - 4; break;
    case 'code':    newText = '`' + (sel || 'code') + '`'; cursorOffset = sel ? newText.length : 1; selOffset = sel ? 0 : newText.length - 2; break;
    case 'link': {
      const url = sel && sel.startsWith('http') ? sel : 'https://';
      const label = sel && !sel.startsWith('http') ? sel : 'link text';
      newText = '[' + label + '](' + url + ')';
      cursorOffset = 1; selOffset = label.length; break;
    }
    case 'h2':    newText = (linePrefix ? '\n' : '') + '## ' + (sel || 'Heading'); cursorOffset = newText.length; selOffset = 0; break;
    case 'h3':    newText = (linePrefix ? '\n' : '') + '### ' + (sel || 'Heading'); cursorOffset = newText.length; selOffset = 0; break;
    case 'quote': newText = (linePrefix ? '\n' : '') + '> ' + (sel || 'quote'); cursorOffset = newText.length; selOffset = 0; break;
    case 'ul':    newText = (linePrefix ? '\n' : '') + '- ' + (sel || 'item'); cursorOffset = newText.length; selOffset = 0; break;
    case 'ol':    newText = (linePrefix ? '\n' : '') + '1. ' + (sel || 'item'); cursorOffset = newText.length; selOffset = 0; break;
    case 'collapsible': {
      const title = sel || 'Section title';
      newText = (linePrefix ? '\n' : '') + '<details>\n<summary>' + title + '</summary>\n\ncontent\n\n</details>';
      cursorOffset = newText.indexOf('content'); selOffset = 'content'.length; break;
    }
    default: return;
  }

  ta.value = before + newText + after;
  if (selOffset > 0) {
    ta.selectionStart = start + cursorOffset;
    ta.selectionEnd = start + cursorOffset + selOffset;
  } else {
    ta.selectionStart = ta.selectionEnd = start + cursorOffset;
  }
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function attachMdToolbar(toolbar, textarea) {
  toolbar.addEventListener('mousedown', e => {
    const btn = e.target.closest('.md-btn');
    if (!btn) return;
    e.preventDefault(); // prevent blur on textarea
    mdInsert(textarea, btn.dataset.md);
  });
}

// ── Preview toggle (composer) ─────────────────────────────────────────────────
function composerShowPreview() {
  const ta      = composerEditor;
  const preview = document.getElementById('composer-preview');
  const btn     = document.getElementById('composer-preview-btn');
  if (!ta || !preview) return;
  preview.innerHTML = marked.parse(ta.value || '');
  ta.style.display      = 'none';
  preview.style.display = 'block';
  btn.title = 'Edit';
  btn.innerHTML = SVG_EDIT;
}

function composerShowEdit() {
  const ta      = composerEditor;
  const preview = document.getElementById('composer-preview');
  const btn     = document.getElementById('composer-preview-btn');
  if (!ta || !preview) return;
  ta.style.display      = '';
  preview.style.display = 'none';
  btn.title = 'Preview';
  btn.innerHTML = SVG_EYE;
  ta.focus();
}

// SVG icons for the toggle button
const SVG_EYE  = '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_EDIT = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

// Composer setup
(function setupComposer() {
  const ta = document.getElementById('composer-textarea');
  const tb = document.getElementById('composer-toolbar');
  if (!ta || !tb) { setTimeout(setupComposer, 50); return; }
  composerEditor = ta;
  attachMdToolbar(tb, ta);

  ta.addEventListener('focus', () => {
    document.getElementById('composer').classList.add('expanded');
    composerShowEdit();
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      const composer = document.getElementById('composer');
      if (!composer.matches(':focus-within')) {
        if (!ta.value.trim()) {
          composer.classList.remove('expanded');
        } else {
          composerShowPreview();
        }
      }
    }, 200);
  });

  // Auto-grow
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 280) + 'px';
  });

  // Preview button toggle
  const previewBtn = document.getElementById('composer-preview-btn');
  if (previewBtn) {
    previewBtn.innerHTML = SVG_EYE;
    previewBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      const preview = document.getElementById('composer-preview');
      if (preview && preview.style.display !== 'none') {
        composerShowEdit();
      } else {
        composerShowPreview();
      }
    });
  }

  // Click on preview → back to edit
  const preview = document.getElementById('composer-preview');
  if (preview) {
    preview.addEventListener('click', () => composerShowEdit());
  }

  if (_pendingShareContent) {
    ta.value = _pendingShareContent;
    ta.focus();
    _pendingShareContent = null;
  }
})();

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!composerEditor) return;
  // Make sure we read from the textarea, not the preview
  composerShowEdit();
  const content_raw = composerEditor.value.trim();
  if (!content_raw) return;

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span>';

  // Offline: queue note and return early
  if (!navigator.onLine) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'QUEUE_MEMO',
        payload: { content: content_raw, token: getCFToken() }
      });
      composerEditor.value = '';
      composerEditor.style.height = 'auto';
      pendingImages = [];
      renderImagePreviews();
      toast('📥 Saved offline — will sync when reconnected');
    } else {
      toast('You\'re offline — note could not be saved');
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    return;
  }

  try {
    let content = content_raw;

    // Extract inline hashtags and view tags synchronously
    const inlineHashtags = (content.match(/#[\wÀ-ɏ-]+/g) || [])
      .map(t => t.slice(1).toLowerCase()).filter(t => !SPECIAL_TAGS.includes(t));
    const viewTags = [];
    if (currentView === 'starred') viewTags.push('starred');
    if (currentView === 'hidden')  viewTags.push('hidden');
    const initialTags = [...new Set([...inlineHashtags, ...viewTags])];

    // Save immediately — don't wait for AI tags
    const result = await apiPost('/notes', { content: content.trim(), visibility: 'PRIVATE', tags: initialTags });
    const newMemo = result.note;

    // Update UI right away so user can continue
    allMemos.unshift(newMemo);
    saveNotesCache(allMemos);  // keep offline cache in sync
    const snapshotImages = [...pendingImages];
    composerEditor.value = '';
    composerEditor.style.height = 'auto';
    pendingImages = [];
    renderImagePreviews();
    renderFeed();
    toast('Saved ✓');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';

    // Attachments + AI tagging run in background
    (async () => {
      for (const img of snapshotImages) {
        try {
          const attResult = await uploadAttachment(img.file || img, newMemo.id);
          if (attResult.attachment) {
            if (!newMemo.attachments) newMemo.attachments = [];
            attResult.attachment._indexed = attResult.indexed;
            newMemo.attachments.push(attResult.attachment);
          }
        } catch(e) { console.warn('Upload failed:', e); }
      }
      if (snapshotImages.length > 0 && !document.querySelector('.card-editing')) renderFeed();
      try {
        const aiTagList = await aiTags(content);
        if (aiTagList.length > 0) {
          const merged = [...new Set([...initialTags, ...aiTagList])];
          await apiPatch('/notes/' + newMemo.id, { tags: merged });
          const idx = allMemos.findIndex(m => m.id === newMemo.id);
          if (idx !== -1) { allMemos[idx].tags = merged; updateCard(allMemos[idx]); }
        }
      } catch(e) { console.error('AI tagging failed (compose):', e.message); }
    })();
    return;
  } catch(err) {
    console.error(err);
    toast('Error: ' + err.message);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';
});
