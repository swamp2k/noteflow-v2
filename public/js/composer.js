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

// ── HTML → Markdown serializer (for WYSIWYG contenteditable) ─────────────────
function htmlToMarkdown(el) {
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    const kids = () => Array.from(node.childNodes).map(walk).join('');
    switch (tag) {
      case 'STRONG': case 'B': return '**' + kids() + '**';
      case 'EM':     case 'I': return '*'  + kids() + '*';
      case 'DEL': case 'S': case 'STRIKE': return '~~' + kids() + '~~';
      case 'CODE':
        return node.closest('pre') ? kids() : '`' + kids() + '`';
      case 'PRE': {
        const codeEl = node.querySelector('code');
        return '\n```\n' + (codeEl ? codeEl.textContent : node.textContent) + '\n```\n';
      }
      case 'H2': return '\n## ' + kids() + '\n';
      case 'H3': return '\n### ' + kids() + '\n';
      case 'BLOCKQUOTE':
        return '\n' + kids().split('\n').map(l => '> ' + l).join('\n') + '\n';
      case 'UL': return '\n' + Array.from(node.children).map(li => '- ' + walk(li).trim()).join('\n') + '\n';
      case 'OL': return '\n' + Array.from(node.children).map((li, i) => (i + 1) + '. ' + walk(li).trim()).join('\n') + '\n';
      case 'LI': return kids();
      case 'A': return '[' + kids() + '](' + (node.getAttribute('href') || '') + ')';
      case 'BR': return '\n';
      case 'DETAILS': return '\n' + node.outerHTML + '\n';
      case 'SUMMARY': return '';
      case 'P': case 'DIV': {
        const text = kids();
        return text.trim() ? text + '\n' : '\n';
      }
      case 'SPAN': {
        // execCommand may emit <span style="..."> instead of semantic tags
        const style = node.getAttribute('style') || '';
        let text = kids();
        if (/font-weight\s*:\s*(bold|700)/.test(style))         text = '**' + text + '**';
        if (/font-style\s*:\s*italic/.test(style))               text = '*'  + text + '*';
        if (/text-decoration[^:]*:\s*line-through/.test(style)) text = '~~' + text + '~~';
        return text;
      }
      case 'SCRIPT': case 'STYLE': return '';
      default: return kids();
    }
  }
  const raw = Array.from(el.childNodes).map(walk).join('');
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

// ── WYSIWYG toolbar actions ───────────────────────────────────────────────────
function wysiwygInsert(editor, cmd) {
  editor.focus();
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const selectedText = range ? range.toString() : '';

  switch (cmd) {
    case 'bold':   document.execCommand('bold',          false, null); break;
    case 'italic': document.execCommand('italic',        false, null); break;
    case 'strike': document.execCommand('strikeThrough', false, null); break;
    case 'ul':     document.execCommand('insertUnorderedList', false, null); break;
    case 'ol':     document.execCommand('insertOrderedList',   false, null); break;
    case 'h2':     document.execCommand('formatBlock',   false, 'h2'); break;
    case 'h3':     document.execCommand('formatBlock',   false, 'h3'); break;
    case 'quote':  document.execCommand('formatBlock',   false, 'blockquote'); break;
    case 'code': {
      if (!range) break;
      const code = document.createElement('code');
      try {
        if (selectedText) {
          range.surroundContents(code);
        } else {
          code.textContent = 'code';
          range.insertNode(code);
          const r2 = document.createRange();
          r2.selectNodeContents(code);
          sel.removeAllRanges(); sel.addRange(r2);
        }
      } catch(_) {
        document.execCommand('insertHTML', false, '<code>' + (selectedText || 'code') + '</code>');
      }
      break;
    }
    case 'link': {
      if (!range) break;
      const url = selectedText && selectedText.startsWith('http')
        ? selectedText : prompt('URL:', 'https://');
      if (!url) break;
      const label = (selectedText && !selectedText.startsWith('http')) ? selectedText : 'link text';
      document.execCommand('insertHTML', false, '<a href="' + url + '">' + label + '</a>');
      break;
    }
    case 'collapsible':
      document.execCommand('insertHTML', false,
        '<details><summary>' + (selectedText || 'Section title') + '</summary><p>content</p></details>');
      break;
    default: break;
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function attachMdToolbar(toolbar, editor) {
  toolbar.addEventListener('mousedown', e => {
    const btn = e.target.closest('.md-btn');
    if (!btn) return;
    e.preventDefault(); // preserve selection in contenteditable
    wysiwygInsert(editor, btn.dataset.md);
  });
}

// Composer setup
(function setupComposer() {
  const ta = document.getElementById('composer-textarea');
  const tb = document.getElementById('composer-toolbar');
  if (!ta || !tb) { setTimeout(setupComposer, 50); return; }
  composerEditor = ta;
  document.execCommand('defaultParagraphSeparator', false, 'div');
  attachMdToolbar(tb, ta);
  ta.addEventListener('focus', () => {
    document.getElementById('composer').classList.add('expanded');
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (!ta.textContent.trim() && !document.getElementById('composer').matches(':focus-within')) {
        document.getElementById('composer').classList.remove('expanded');
      }
    }, 200);
  });
  // Clear lone <br> that browser inserts into empty contenteditable
  ta.addEventListener('input', () => {
    if (ta.innerHTML === '<br>') ta.innerHTML = '';
  });
  // Strip HTML on paste — plain text only
  ta.addEventListener('paste', e => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  if (_pendingShareContent) {
    ta.innerHTML = marked.parse(_pendingShareContent);
    ta.focus();
    _pendingShareContent = null;
  }
})();

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!composerEditor) return;
  const content_raw = htmlToMarkdown(composerEditor);
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
      composerEditor.innerHTML = '';
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
    composerEditor.innerHTML = '';
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
