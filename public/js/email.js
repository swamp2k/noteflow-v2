async function sendNoteByEmail(memo) {
  if (!settings.reminderEmail) {
    toast('Add a recipient address in Settings → Email first');
    return;
  }
  const btn = document.querySelector(`.memo-card[data-memo-name="${memo.id}"] .card-actions button[title="Email note"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Optionally make public first
    if (settings.emailMakePublic && memo.visibility !== 'PUBLIC') {
      const r = await apiPatch('/notes/' + memo.id, { visibility: 'PUBLIC' });
      memo.visibility = 'PUBLIC';
      const idx = allMemos.findIndex(m => m.id === memo.id);
      if (idx !== -1) allMemos[idx].visibility = 'PUBLIC';
    }
    await apiPost('/email/send', {
      note_id:         memo.id,
      to:              settings.reminderEmail,
      make_public:     settings.emailMakePublic,
    });
    toast('Email sent ✓');
  } catch(e) {
    toast('Email failed: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;pointer-events:none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
    }
  }
}
