function openLightbox(src, allSrcs) {
  // Close any file preview first
  document.getElementById('lightbox-content').classList.remove('open');
  document.getElementById('lightbox-content').style.display = 'none';
  const imgEl = document.getElementById('lightbox-img');
  imgEl.style.display = '';

  lbImages = allSrcs || [src];
  lbIndex  = lbImages.indexOf(src);
  if (lbIndex === -1) lbIndex = 0;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}

async function openFilePreview(att, fname, mime, url, isPdf, isVideo, isAudio, isText, isIndexed) {
  const lb = document.getElementById('lightbox');
  const imgEl = document.getElementById('lightbox-img');
  const content = document.getElementById('lightbox-content');

  // Hide image, show content panel
  imgEl.style.display = 'none';
  document.getElementById('lightbox-prev').classList.add('hidden');
  document.getElementById('lightbox-next').classList.add('hidden');
  document.getElementById('lightbox-counter').classList.add('hidden');

  // Build content panel
  content.innerHTML = '';
  content.style.display = 'flex';
  content.classList.add('open');

  // Header with filename + download button
  const header = document.createElement('div');
  header.className = 'lb-file-header';
  header.innerHTML = fileIcon(mime) + ' <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(fname) + '</span>';
  const dlBtn = document.createElement('button');
  dlBtn.textContent = '⬇ Download';
  dlBtn.style.cssText = 'padding:4px 10px;font-size:12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);cursor:pointer;white-space:nowrap;flex-shrink:0';
  dlBtn.addEventListener('click', async () => {
    try {
      const r = await fetch(url, { credentials: 'omit', headers: authHeaders() });
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname; a.click();
    } catch(e) { toast('Download failed'); }
  });
  header.appendChild(dlBtn);
  content.appendChild(header);

  const body = document.createElement('div');
  body.className = 'lb-file-body';
  body.innerHTML = '<div class="lb-loading">Loading…</div>';
  content.appendChild(body);

  lb.classList.add('open');

  try {
    if (isPdf || isVideo || isAudio) {
      const r = await fetch(url, { credentials: 'omit', headers: authHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      body.innerHTML = '';
      if (isPdf) {
        // On mobile, iframes don't render PDFs — use OS handler instead
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          body.innerHTML = '';
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;padding:30px;text-align:center';
          wrap.innerHTML = '<div style="font-size:48px">📄</div>'
            + '<div style="font-size:15px;font-weight:500">' + escHtml(fname) + '</div>'
            + '<div style="font-size:13px;color:var(--muted)">PDF preview is not supported in the browser on mobile.</div>';
          const openBtn = document.createElement('button');
          openBtn.className = 'btn-primary';
          openBtn.textContent = '↗ Open in PDF reader';
          openBtn.addEventListener('click', () => window.open(blobUrl, '_blank'));
          wrap.appendChild(openBtn);
          body.appendChild(wrap);
        } else {
          const frame = document.createElement('iframe');
          frame.src = blobUrl;
          frame.title = fname;
          body.appendChild(frame);
        }
      } else if (isVideo) {
        const video = document.createElement('video');
        video.controls = true; video.autoplay = false; video.preload = 'metadata';
        video.src = blobUrl;
        body.appendChild(video);
      } else {
        const audio = document.createElement('audio');
        audio.controls = true; audio.preload = 'metadata';
        audio.src = blobUrl;
        body.style.cssText += 'display:flex;align-items:center;justify-content:center;padding:30px';
        body.appendChild(audio);
      }
    } else if (isText) {
      const r = await fetch(url, { credentials: 'omit', headers: authHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      body.innerHTML = '';
      const pre = document.createElement('div');
      pre.className = 'lb-text';
      pre.textContent = text;
      body.appendChild(pre);
    } else if (isIndexed) {
      const data = await apiGet('/attachments/' + att.id + '/index');
      body.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'lb-indexed';
      if (data.text) {
        div.innerHTML = '<h3>📄 Extracted content (via Claude)</h3>' + escHtml(data.text).replace(/\n/g, '<br>');
      } else if (data.pending) {
        div.innerHTML = '<h3 style="color:#bbb">⏳ Indexing in progress…</h3><p style="color:#999;font-size:13px">Claude is extracting the content of this document. Close and try again in a few seconds.</p>';
      } else {
        div.innerHTML = '<h3 style="color:#bbb">No preview available</h3><p style="color:#999;font-size:13px">This document type isn\'t supported for preview.</p>';
      }
      body.appendChild(div);
    }
  } catch(e) {
    body.innerHTML = '<div class="lb-loading" style="color:#c00">Failed to load preview</div>';
  }
}

function renderLightbox() {
  _lbResetZoom();
  const img     = document.getElementById('lightbox-img');
  const prev    = document.getElementById('lightbox-prev');
  const next    = document.getElementById('lightbox-next');
  const counter = document.getElementById('lightbox-counter');
  img.src = lbImages[lbIndex];
  prev.classList.toggle('hidden', lbImages.length <= 1 || lbIndex === 0);
  next.classList.toggle('hidden', lbImages.length <= 1 || lbIndex === lbImages.length - 1);
  if (lbImages.length > 1) {
    counter.textContent = (lbIndex + 1) + ' / ' + lbImages.length;
    counter.classList.remove('hidden');
  } else {
    counter.classList.add('hidden');
  }
}

document.getElementById('lightbox-prev').addEventListener('click', e => {
  e.stopPropagation();
  if (lbIndex > 0) { lbIndex--; renderLightbox(); }
});
document.getElementById('lightbox-next').addEventListener('click', e => {
  e.stopPropagation();
  if (lbIndex < lbImages.length - 1) { lbIndex++; renderLightbox(); }
});
function closeLightbox() {
  _lbResetZoom();
  const lb = document.getElementById('lightbox');
  lb.classList.remove('open');
  // Reset content panel and restore image element
  const content = document.getElementById('lightbox-content');
  content.classList.remove('open');
  content.style.display = 'none';
  content.innerHTML = '';
  document.getElementById('lightbox-img').style.display = '';
}
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', e => { if (e.target === e.currentTarget) closeLightbox(); });
// Keyboard navigation
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowLeft' && lbIndex > 0)                    { lbIndex--; renderLightbox(); }
  if (e.key === 'ArrowRight' && lbIndex < lbImages.length - 1) { lbIndex++; renderLightbox(); }
  if (e.key === 'Escape') closeLightbox();
});

// ── Lightbox pinch-zoom / drag / double-tap ───────────────────────────────────
function _lbResetZoom() {
  _lbScale = 1; _lbTX = 0; _lbTY = 0;
  const img = document.getElementById('lightbox-img');
  if (img) { img.style.transform = ''; img.style.cursor = 'zoom-in'; }
}
function _lbApplyZoom() {
  const img = document.getElementById('lightbox-img');
  img.style.transform = `translate(${_lbTX}px,${_lbTY}px) scale(${_lbScale})`;
  img.style.cursor = _lbScale > 1 ? 'grab' : 'zoom-in';
}

(function() {
  const el = document.getElementById('lightbox-img');
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      _lbPinching = true; _lbDragging = false;
      _lbPinchDist0 = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY);
    } else if (e.touches.length === 1) {
      _lbDragging = true;
      _lbDragOX = e.touches[0].clientX - _lbTX;
      _lbDragOY = e.touches[0].clientY - _lbTY;
      // Double-tap: toggle 2.5× zoom
      const now = Date.now();
      if (now - _lbLastTap < 280) {
        e.preventDefault();
        if (_lbScale > 1) _lbResetZoom(); else { _lbScale = 2.5; _lbApplyZoom(); }
      }
      _lbLastTap = now;
    }
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && _lbPinching) {
      const d = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY);
      _lbScale = Math.min(8, Math.max(1, _lbScale * (d / _lbPinchDist0)));
      _lbPinchDist0 = d;
      if (_lbScale <= 1) { _lbTX = 0; _lbTY = 0; }
      _lbApplyZoom();
    } else if (e.touches.length === 1 && _lbDragging && _lbScale > 1) {
      _lbTX = e.touches[0].clientX - _lbDragOX;
      _lbTY = e.touches[0].clientY - _lbDragOY;
      _lbApplyZoom();
    }
  }, { passive: false });

  el.addEventListener('touchend', e => {
    if (e.touches.length < 2) _lbPinching = false;
    if (e.touches.length === 0) _lbDragging = false;
    if (_lbScale < 1.08) _lbResetZoom(); // snap back if barely zoomed
  });
})();

// ── Image attach ──────────────────────────────────────────────────────────────
document.getElementById('attach-btn').addEventListener('click', () => document.getElementById('file-input').click());

// Composer expand/collapse handled via textarea focus/blur in setupComposer() above.
document.getElementById('file-input').addEventListener('change', async e => {
  for (const file of e.target.files) await addFile(file);
  e.target.value = '';
});
document.getElementById('composer').addEventListener('paste', async e => {
  const items = Array.from(e.clipboardData?.items || []);
  const fileItems = items.filter(i => i.kind === 'file');
  if (fileItems.length === 0) return;
  e.preventDefault();
  for (const item of fileItems) {
    const file = item.getAsFile();
    if (file) await addFile(file);
  }
});
