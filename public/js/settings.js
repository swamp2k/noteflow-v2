function saveSettings() {
  if (!_settingsLoaded) return; // don't overwrite D1 with defaults before loadSettings completes
  // Cache only non-sensitive display prefs to localStorage for boot theming
  try {
    const prefs = {};
    DISPLAY_PREF_KEYS.forEach(k => { prefs[k] = settings[k]; });
    localStorage.setItem('noteflow_display_prefs', JSON.stringify(prefs));
  } catch(e) {}
  clearTimeout(_saveSettingsTimer);
  _saveSettingsTimer = setTimeout(async () => {
    try {
      await fetch(API_BASE + '/user/settings', {
        method: 'PUT', credentials: 'omit',
        headers: authHeaders(),
        body: JSON.stringify(settings)
      });
    } catch(e) { console.warn('Settings save failed:', e.message); }
  }, 800);
}
function saveSettingsNow() {
  if (!_settingsLoaded) return Promise.resolve();
  try {
    const prefs = {};
    DISPLAY_PREF_KEYS.forEach(k => { prefs[k] = settings[k]; });
    localStorage.setItem('noteflow_display_prefs', JSON.stringify(prefs));
  } catch(e) {}
  clearTimeout(_saveSettingsTimer);
  return fetch(API_BASE + '/user/settings', {
    method: 'PUT', credentials: 'omit',
    headers: authHeaders(),
    body: JSON.stringify(settings)
  }).catch(e => console.warn('Settings save failed:', e.message));
}

async function loadSettings() {
  try {
    const data = await apiGet('/user/settings');
    if (data && typeof data === 'object') {
      Object.assign(settings, data);
      // Keep display prefs cache fresh
      try {
        const prefs = {};
        DISPLAY_PREF_KEYS.forEach(k => { prefs[k] = settings[k]; });
        localStorage.setItem('noteflow_display_prefs', JSON.stringify(prefs));
      } catch(e) {}
    }
  } catch(e) { /* use defaults */ }
  _settingsLoaded = true; // now safe to save
  applyFeedWidth();
  applyFontFamily();
  applyTheme(settings.theme);
  applyMobileFontSize();
  applyShowTags();
  syncSettingsControls();
}

function applyMobileFontSize() {
  document.documentElement.style.setProperty('--mobile-font-size', (settings.mobileFontSize || 15) + 'px');
}
function applyFeedWidth() {
  document.documentElement.style.setProperty('--feed-max-width', (settings.feedMaxWidth || 700) + 'px');
}
function applyFontFamily() {
  document.documentElement.style.setProperty('--font-body', settings.fontFamily || "'DM Sans', sans-serif");
}

function applyTheme(themeId) {
  const t = THEMES.find(t => t.id === themeId) || THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--bg', t.bg);
  root.style.setProperty('--surface', t.surface);
  root.style.setProperty('--surface-alt', t.surfaceAlt);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--border', t.border);
  root.style.setProperty('--muted', t.muted);
  root.style.setProperty('--accent-bg', t.accent + '20');
  // Derive text-soft from text (60% opacity approximation)
  root.style.setProperty('--text-soft', t.muted);
  // Header background: semi-transparent version of bg
  const hex = t.bg.replace('#', '');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  root.style.setProperty('--header-bg', `rgba(${r},${g},${b},0.95)`);
  // Hidden note colours adapt to theme — light purple on light themes, muted on dark
  const isDark = (parseInt(hex.slice(0,2),16) + parseInt(hex.slice(2,4),16) + parseInt(hex.slice(4,6),16)) < 300;
  root.style.setProperty('--hidden-bg',     isDark ? 'rgba(124,111,158,0.15)' : '#f0edf8');
  root.style.setProperty('--hidden-border', isDark ? 'rgba(124,111,158,0.35)' : '#c4b8e8');
}

function buildThemeGrid() {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  THEMES.forEach(t => {
    const swatch = document.createElement('div');
    swatch.className = 'theme-swatch' + (settings.theme === t.id ? ' active' : '');
    swatch.title = t.label;
    swatch.style.background = 'linear-gradient(135deg, ' + t.surface + ' 50%, ' + t.accent + ' 50%)';
    swatch.style.border = '2px solid ' + t.border;
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      settings.theme = t.id;
      saveSettings();
      applyTheme(t.id);
    });
    grid.appendChild(swatch);
  });
}

// ── Bulk auto-tagger ──────────────────────────────────────────────────────────
async function bulkTagUntagged(onProgress) {
  // Fetch ALL notes (paginate through everything)
  let cursor = null;
  const allNotes = [];
  do {
    const url = '/notes?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const data = await apiGet(url);
    allNotes.push(...(data.notes || []));
    cursor = data.nextCursor || null;
  } while (cursor);

  const untagged = allNotes.filter(n => !n.tags || n.tags.length === 0);
  if (untagged.length === 0) return { done: 0, skipped: 0 };

  // Pre-fetch combined content + OCR text for all untagged notes in batches of 100
  const contextMap = {};
  const CTX_BATCH = 90;
  for (let i = 0; i < untagged.length; i += CTX_BATCH) {
    const ids = untagged.slice(i, i + CTX_BATCH).map(n => n.id);
    try {
      const r = await fetch(API_BASE + '/notes/tag-contexts', {
        method: 'POST', credentials: 'omit',
        headers: authHeaders(),
        body: JSON.stringify({ ids })
      });
      if (r.ok) Object.assign(contextMap, await r.json());
    } catch(e) { /* fall back to note.content */ }
  }

  let done = 0, skipped = 0, failed = 0;
  for (let i = 0; i < untagged.length; i++) {
    const note = untagged[i];
    try {
      const context = contextMap[note.id] || note.content || '';
      const tags = await aiTags(context);
      if (tags.length > 0) {
        await apiPatch('/notes/' + note.id, { tags });
        const idx = allMemos.findIndex(m => m.id === note.id);
        if (idx !== -1) allMemos[idx] = { ...allMemos[idx], tags };
        done++;
      } else {
        skipped++;
      }
    } catch(e) {
      console.warn('Tag failed for', note.id, e.message);
      failed++;
    }
    onProgress(done, failed, untagged.length);
    // 1.2s between notes keeps well under Anthropic's rate limits
    if (i < untagged.length - 1) await new Promise(r => setTimeout(r, 1200));
  }
  return { done, skipped, failed, total: untagged.length };
}

// ── Show/hide tags ────────────────────────────────────────────────────────────
function applyShowTags() {
  document.body.classList.toggle('hide-tags', !settings.showTags);
}

// ── Sync all control values from settings (called after async DB load) ────────
function syncSettingsControls() {
  const el = id => document.getElementById(id);
  const s = settings;

  const infiniteToggle = el('setting-infinite-scroll');
  const maxHeightSlider = el('setting-max-height');
  const maxHeightVal    = el('setting-max-height-val');
  if (infiniteToggle)   infiniteToggle.checked = s.infiniteScroll;
  if (maxHeightSlider)  maxHeightSlider.value  = s.maxHeight;
  if (maxHeightVal)     maxHeightVal.textContent = s.maxHeight === 0 ? 'Off' : s.maxHeight + 'px';

  const mobileFontSlider = el('setting-mobile-font');
  const mobileFontVal    = el('setting-mobile-font-val');
  if (mobileFontSlider) mobileFontSlider.value = s.mobileFontSize || 15;
  if (mobileFontVal)    mobileFontVal.textContent = (s.mobileFontSize || 15) + 'px';

  const fontSelect = el('setting-font-family');
  if (fontSelect) fontSelect.value = s.fontFamily || "'DM Sans', sans-serif";

  const attPerPageSlider = el('setting-att-per-page');
  const attPerPageVal    = el('setting-att-per-page-val');
  if (attPerPageSlider) attPerPageSlider.value = s.attachmentsPerPage || 27;
  if (attPerPageVal)    attPerPageVal.textContent = s.attachmentsPerPage || 27;

  const feedWidthSlider = el('setting-feed-width');
  const feedWidthVal    = el('setting-feed-width-val');
  if (feedWidthSlider) feedWidthSlider.value = s.feedMaxWidth || 700;
  if (feedWidthVal)    feedWidthVal.textContent = (s.feedMaxWidth || 700) + 'px';

  const offlineDaysSelect = el('setting-offline-days');
  const offlineAttToggle  = el('setting-offline-attachments');
  if (offlineDaysSelect)  offlineDaysSelect.value = s.offlineDays !== undefined ? s.offlineDays : 0;
  if (offlineAttToggle)   offlineAttToggle.checked = s.offlineCacheAttachments;

  // voyageKeyInput removed — key now stored as VOYAGE_KEY worker secret
  const reminderEmailInput = el('setting-reminder-email');
  const emailMakePublicCb  = el('setting-email-make-public');
  if (reminderEmailInput)  reminderEmailInput.value    = s.reminderEmail   || '';
  if (emailMakePublicCb)   emailMakePublicCb.checked   = !!s.emailMakePublic;

  const showTagsToggle     = el('setting-show-tags');
  const tagCategoriesInput = el('setting-tag-categories');
  const tagPeopleInput     = el('setting-tag-people');
  if (showTagsToggle)       showTagsToggle.checked   = s.showTags !== false;
  if (tagCategoriesInput)   tagCategoriesInput.value = s.tagCategories || '';
  if (tagPeopleInput)       tagPeopleInput.value     = s.tagPeople     || '';

  // Update active theme swatch
  document.querySelectorAll('.theme-swatch').forEach((sw, i) => {
    sw.classList.toggle('active', THEMES[i]?.id === s.theme);
  });

  // Task settings
  const taskHideCb    = el('setting-tasks-hide-from-feed');
  const taskBadgeCb   = el('setting-tasks-show-count-badge');
  if (taskHideCb)  taskHideCb.checked  = !!s.tasks_hide_from_main_feed;
  if (taskBadgeCb) taskBadgeCb.checked = s.tasks_show_count_badge !== false;

  const taskSubjectsInput = el('setting-task-subjects');
  if (taskSubjectsInput) taskSubjectsInput.value = (s.task_subjects || []).join(', ');
  refreshSubjectDefaultSelect();

  const icalCheck = el('setting-ical-include-completed');
  if (icalCheck) icalCheck.checked = !!s.ical_include_completed;

  // Notification settings
  const notifEnabledCb     = el('setting-notif-enabled');
  const notifDiscordCb     = el('setting-notif-discord');
  const notifDiscordInput  = el('setting-notif-discord-webhook');
  const notifEmailCb       = el('setting-notif-email');
  const notifEmailInput    = el('setting-notif-email-address');
  const notifPushCb        = el('setting-notif-push');
  const notifChannels      = el('notif-channels-section');

  if (notifEnabledCb)     notifEnabledCb.checked     = !!s.notif_enabled;
  if (notifDiscordCb)     notifDiscordCb.checked      = !!s.notif_discord_enabled;
  if (notifDiscordInput)  notifDiscordInput.value     = s.notif_discord_webhook || '';
  if (notifEmailCb)       notifEmailCb.checked        = !!s.notif_email_enabled;
  if (notifEmailInput)    notifEmailInput.value       = s.notif_email_address || '';
  if (notifPushCb)        notifPushCb.checked         = !!s.notif_push_enabled;
  if (notifChannels)      notifChannels.style.display = s.notif_enabled ? '' : 'none';
  // Show/hide discord webhook input based on discord toggle
  const discordWebhookRow = el('notif-discord-webhook-row');
  if (discordWebhookRow) discordWebhookRow.style.display = s.notif_discord_enabled ? '' : 'none';
  const emailAddressRow = el('notif-email-address-row');
  if (emailAddressRow) emailAddressRow.style.display = s.notif_email_enabled ? '' : 'none';

  const emailTaskSenders = el('email-task-senders');
  if (emailTaskSenders) emailTaskSenders.value = s.emailTaskApprovedSenders || '';
}

function refreshSubjectDefaultSelect() {
  const sel = document.getElementById('setting-tasks-default-subject');
  if (!sel) return;
  const subjects = settings.task_subjects || [];
  sel.innerHTML = '<option value="">None</option>' + subjects.map(s => {
    const escaped = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const selected = settings.tasks_default_subject === s ? ' selected' : '';
    return `<option value="${escaped}"${selected}>${escaped}</option>`;
  }).join('');
}

// ── Settings page controls ────────────────────────────────────────────────────
function initSettingsControls() {
  const infiniteToggle  = document.getElementById('setting-infinite-scroll');
  const maxHeightSlider = document.getElementById('setting-max-height');
  const maxHeightVal    = document.getElementById('setting-max-height-val');
  const mobileFontSlider = document.getElementById('setting-mobile-font');
  const mobileFontVal    = document.getElementById('setting-mobile-font-val');
  const fontSelect       = document.getElementById('setting-font-family');
  const attPerPageSlider = document.getElementById('setting-att-per-page');
  const attPerPageVal    = document.getElementById('setting-att-per-page-val');
  const feedWidthSlider  = document.getElementById('setting-feed-width');
  const feedWidthVal     = document.getElementById('setting-feed-width-val');
  const offlineDaysSelect = document.getElementById('setting-offline-days');
  const offlineAttToggle  = document.getElementById('setting-offline-attachments');
  const offlineCacheBtn   = document.getElementById('btn-refresh-offline-cache');
  const offlineCacheStatus = document.getElementById('offline-cache-status');
  const reminderEmailInput = document.getElementById('setting-reminder-email');
  const emailMakePublicCb  = document.getElementById('setting-email-make-public');
  const showTagsToggle    = document.getElementById('setting-show-tags');
  const tagCategoriesInput = document.getElementById('setting-tag-categories');
  const tagPeopleInput    = document.getElementById('setting-tag-people');
  const tagAllBtn         = document.getElementById('btn-tag-all-untagged');
  const tagAllStatus      = document.getElementById('tag-all-status');

  // Populate with current values
  syncSettingsControls();
  buildThemeGrid();

  // Show current cache size on settings open
  const cached = loadNotesCache();
  if (cached.length) offlineCacheStatus.textContent = `Currently cached: ${cached.length} notes`;

  // ── Event listeners ───────────────────────────────────────────────────────
  infiniteToggle.addEventListener('change', () => {
    settings.infiniteScroll = infiniteToggle.checked;
    saveSettings();
    document.getElementById('load-more').style.display =
      (settings.infiniteScroll || !nextCursor) ? 'none' : 'block';
  });

  maxHeightSlider.addEventListener('input', () => {
    settings.maxHeight = parseInt(maxHeightSlider.value);
    maxHeightVal.textContent = settings.maxHeight === 0 ? 'Off' : settings.maxHeight + 'px';
  });
  maxHeightSlider.addEventListener('change', () => { saveSettings(); renderFeed(); });

  mobileFontSlider.addEventListener('input', () => {
    settings.mobileFontSize = parseInt(mobileFontSlider.value);
    mobileFontVal.textContent = settings.mobileFontSize + 'px';
    applyMobileFontSize();
    saveSettings();
  });

  fontSelect.addEventListener('change', () => {
    settings.fontFamily = fontSelect.value;
    applyFontFamily();
    saveSettings();
  });

  attPerPageSlider.addEventListener('input', () => {
    settings.attachmentsPerPage = parseInt(attPerPageSlider.value);
    attPerPageVal.textContent = settings.attachmentsPerPage;
    saveSettings();
    if (currentView === 'attachments') renderFeed();
  });

  feedWidthSlider.addEventListener('input', () => {
    settings.feedMaxWidth = parseInt(feedWidthSlider.value);
    feedWidthVal.textContent = settings.feedMaxWidth + 'px';
    applyFeedWidth();
    saveSettings();
  });

  offlineDaysSelect.addEventListener('change', () => {
    settings.offlineDays = parseInt(offlineDaysSelect.value);
    saveSettings();
  });
  offlineAttToggle.addEventListener('change', () => {
    settings.offlineCacheAttachments = offlineAttToggle.checked;
    saveSettings();
  });
  offlineCacheBtn.addEventListener('click', async () => {
    if (!navigator.onLine) { toast('Cannot refresh — you\'re offline'); return; }
    if (!settings.offlineDays) { toast('Enable offline caching in settings first'); return; }
    offlineCacheBtn.disabled = true;
    offlineCacheBtn.textContent = 'Refreshing…';
    offlineCacheStatus.textContent = '';
    _prefetchRunning = false;
    try {
      await prefetchOfflineCache();
      const cached = loadNotesCache();
      offlineCacheStatus.textContent = cached.length
        ? `✓ Cached ${cached.length} notes`
        : 'Completed but no notes found — check console for errors';
    } catch(e) {
      offlineCacheStatus.textContent = 'Failed: ' + e.message;
      console.error('Offline cache refresh failed:', e);
    }
    offlineCacheBtn.disabled = false;
    offlineCacheBtn.textContent = 'Refresh offline cache now';
  });

  // voyageKeyInput listener removed — key is now a worker secret
  if (reminderEmailInput) reminderEmailInput.addEventListener('input', () => { settings.reminderEmail = reminderEmailInput.value.trim(); saveSettings(); });
  if (emailMakePublicCb)  emailMakePublicCb.addEventListener('change', () => { settings.emailMakePublic = emailMakePublicCb.checked; saveSettings(); });

  showTagsToggle.addEventListener('change', () => {
    settings.showTags = showTagsToggle.checked;
    applyShowTags();
    saveSettings();
  });
  tagCategoriesInput.addEventListener('input', () => { settings.tagCategories = tagCategoriesInput.value; saveSettings(); });
  tagPeopleInput.addEventListener('input',     () => { settings.tagPeople     = tagPeopleInput.value;     saveSettings(); });

  // ── Task settings ─────────────────────────────────────────────────────────
  const taskHideCb  = document.getElementById('setting-tasks-hide-from-feed');
  if (taskHideCb) taskHideCb.addEventListener('change', () => {
    settings.tasks_hide_from_main_feed = taskHideCb.checked;
    saveSettings();
    if (currentView === 'all') loadMemos();
  });
  const taskSubjectsInput = document.getElementById('setting-task-subjects');
  if (taskSubjectsInput) taskSubjectsInput.addEventListener('input', () => {
    settings.task_subjects = taskSubjectsInput.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
    saveSettings();
    refreshSubjectDefaultSelect();
  });
  const taskDefaultSubjectSel = document.getElementById('setting-tasks-default-subject');
  if (taskDefaultSubjectSel) taskDefaultSubjectSel.addEventListener('change', () => {
    settings.tasks_default_subject = taskDefaultSubjectSel.value || null;
    saveSettings();
  });
  const taskBadgeCb = document.getElementById('setting-tasks-show-count-badge');
  if (taskBadgeCb) taskBadgeCb.addEventListener('change', () => {
    settings.tasks_show_count_badge = taskBadgeCb.checked;
    saveSettings();
    if (typeof updateTasksNavBadge === 'function') updateTasksNavBadge(_alertTaskCount);
  });

  // ── Notification settings ──────────────────────────────────────────────────
  const notifEnabledCb     = document.getElementById('setting-notif-enabled');
  const notifDiscordCb     = document.getElementById('setting-notif-discord');
  const notifDiscordInput  = document.getElementById('setting-notif-discord-webhook');
  const notifEmailCb       = document.getElementById('setting-notif-email');
  const notifEmailInput    = document.getElementById('setting-notif-email-address');
  const notifPushCb        = document.getElementById('setting-notif-push');
  const notifChannels      = document.getElementById('notif-channels-section');
  const discordWebhookRow  = document.getElementById('notif-discord-webhook-row');
  const emailAddressRow    = document.getElementById('notif-email-address-row');

  if (notifEnabledCb) notifEnabledCb.addEventListener('change', () => {
    settings.notif_enabled = notifEnabledCb.checked;
    if (notifChannels) notifChannels.style.display = notifEnabledCb.checked ? '' : 'none';
    saveSettings();
  });
  if (notifDiscordCb) notifDiscordCb.addEventListener('change', () => {
    settings.notif_discord_enabled = notifDiscordCb.checked;
    if (discordWebhookRow) discordWebhookRow.style.display = notifDiscordCb.checked ? '' : 'none';
    saveSettings();
  });
  if (notifDiscordInput) notifDiscordInput.addEventListener('input', () => {
    settings.notif_discord_webhook = notifDiscordInput.value.trim();
    saveSettings();
  });
  if (notifEmailCb) notifEmailCb.addEventListener('change', () => {
    settings.notif_email_enabled = notifEmailCb.checked;
    if (emailAddressRow) emailAddressRow.style.display = notifEmailCb.checked ? '' : 'none';
    saveSettings();
  });
  if (notifEmailInput) notifEmailInput.addEventListener('input', () => {
    settings.notif_email_address = notifEmailInput.value.trim();
    saveSettings();
  });
  if (notifPushCb) notifPushCb.addEventListener('change', async () => {
    if (notifPushCb.checked) {
      if (typeof subscribeToPush === 'function') {
        const ok = await subscribeToPush();
        if (!ok) { notifPushCb.checked = false; return; }
      }
    } else {
      if (typeof unsubscribeFromPush === 'function') await unsubscribeFromPush();
    }
    settings.notif_push_enabled = notifPushCb.checked;
    saveSettings();
  });

  tagAllBtn.addEventListener('click', async () => {
    if (tagAllBtn.disabled) return;
    tagAllBtn.disabled = true;
    tagAllStatus.textContent = 'Fetching notes…';
    try {
      const result = await bulkTagUntagged((done, failed, total) => {
        tagAllStatus.textContent = `${done + failed}/${total} — ${done} tagged${failed ? `, ${failed} errors` : ''}…`;
      });
      if (!result.total) {
        tagAllStatus.textContent = 'All notes already have tags.';
      } else {
        tagAllStatus.textContent = `Done — ${result.done} tagged, ${result.skipped} no tags, ${result.failed} errors.`;
        if (result.done > 0) await loadMemos();
      }
    } catch(e) {
      tagAllStatus.textContent = 'Error: ' + e.message;
    }
    tagAllBtn.disabled = false;
  });

  // ── Android Widget token ─────────────────────────────────────────────────
  const widgetTokenDisplay  = document.getElementById('widget-token-display');
  const btnCopyWidgetToken  = document.getElementById('btn-copy-widget-token');
  const btnGenWidgetToken   = document.getElementById('btn-generate-widget-token');
  const btnRevokeWidgetToken = document.getElementById('btn-revoke-widget-token');

  async function loadWidgetTokenStatus() {
    try {
      const data = await apiGet('/widget/token');
      if (widgetTokenDisplay) {
        widgetTokenDisplay.value = data.exists ? data.preview : '';
        widgetTokenDisplay.placeholder = data.exists ? '' : 'No token generated';
      }
    } catch(e) { /* non-fatal */ }
  }
  loadWidgetTokenStatus();

  if (btnGenWidgetToken) btnGenWidgetToken.addEventListener('click', async () => {
    btnGenWidgetToken.disabled = true;
    btnGenWidgetToken.textContent = 'Generating…';
    try {
      const r = await fetch(API_BASE + '/widget/token', { method: 'POST', credentials: 'omit', headers: authHeaders() });
      if (!r.ok) throw new Error(r.status);
      const { token } = await r.json();
      if (widgetTokenDisplay) { widgetTokenDisplay.value = token; widgetTokenDisplay.placeholder = ''; }
      toast('Token generated — copy it now, it won\'t be shown again');
    } catch(e) {
      toast('Failed to generate token');
    }
    btnGenWidgetToken.disabled = false;
    btnGenWidgetToken.textContent = 'Generate Token';
  });

  if (btnRevokeWidgetToken) btnRevokeWidgetToken.addEventListener('click', async () => {
    if (!confirm('Revoke widget token? The Android app will stop working until you generate a new one.')) return;
    try {
      await fetch(API_BASE + '/widget/token', { method: 'DELETE', credentials: 'omit', headers: authHeaders() });
      if (widgetTokenDisplay) { widgetTokenDisplay.value = ''; widgetTokenDisplay.placeholder = 'No token generated'; }
      toast('Widget token revoked');
    } catch(e) {
      toast('Failed to revoke token');
    }
  });

  if (btnCopyWidgetToken) btnCopyWidgetToken.addEventListener('click', async () => {
    // The display only shows a masked preview after a reload, so always fetch the
    // full token from the worker for the copy.
    let val = '';
    try {
      const res = await apiGet('/widget/token/full');
      val = res && res.token ? res.token : '';
    } catch(e) { /* fall through to "no token" */ }
    if (!val) { toast('No token — generate one first'); return; }
    navigator.clipboard.writeText(val).then(() => toast('Token copied')).catch(() => toast('Copy failed'));
  });

  // ── Calendar feed (ICS) ───────────────────────────────────────────────────
  const icalIncludeCompleted = document.getElementById('setting-ical-include-completed');
  if (icalIncludeCompleted) icalIncludeCompleted.addEventListener('change', function () {
    settings.ical_include_completed = this.checked;
    saveSettings();
  });

  const btnCopyIcalLink = document.getElementById('copy-ical-link-btn');
  if (btnCopyIcalLink) btnCopyIcalLink.addEventListener('click', async () => {
    const noTokenHint = document.getElementById('ical-no-token-hint');
    const feedback    = document.getElementById('ical-link-feedback');
    let token = '';
    try {
      const res = await apiGet('/widget/token/full');
      token = res && res.token ? res.token : '';
    } catch(e) { /* fall through */ }
    if (!token) {
      if (noTokenHint) noTokenHint.style.display = 'block';
      return;
    }
    if (noTokenHint) noTokenHint.style.display = 'none';
    // API_BASE (state.js) already ends in /api
    const icsUrl = `${API_BASE}/ical/tasks.ics?token=${token}`;
    navigator.clipboard.writeText(icsUrl).then(() => {
      if (feedback) { feedback.style.display = 'inline'; setTimeout(() => { feedback.style.display = 'none'; }, 2000); }
    }).catch(() => toast('Copy failed'));
  });

  // ── Activity log ──────────────────────────────────────────────────────────
  const logBtn = document.getElementById('btn-view-logs');
  if (logBtn) {
    logBtn.addEventListener('click', () => {
      _logUnreadCount = 0;
      _updateLogBadge();
      const container = document.getElementById('log-modal-entries');
      container.innerHTML = '';
      if (!_activityLog.length) {
        container.innerHTML = '<span style="color:var(--muted)">No log entries yet.</span>';
      } else {
        [..._activityLog].reverse().forEach(entry => {
          const row = document.createElement('div');
          row.style.cssText = 'padding:4px 6px;border-radius:4px;background:var(--surface-alt);word-break:break-word;line-height:1.4';
          const time = entry.ts.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
          const date = entry.ts.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
          row.innerHTML = `<span style="color:var(--muted)">[${date} ${time}]</span> ${escHtml(entry.msg)}`;
          container.appendChild(row);
        });
      }
      document.getElementById('log-modal').classList.add('open');
    });
  }
  const logClearBtn = document.getElementById('btn-log-clear');
  if (logClearBtn) {
    logClearBtn.addEventListener('click', () => {
      _activityLog = [];
      _logUnreadCount = 0;
      _updateLogBadge();
      document.getElementById('log-modal-entries').innerHTML = '<span style="color:var(--muted)">Log cleared.</span>';
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Apply defaults immediately for fast render, then load from DB
applyFeedWidth();
applyFontFamily();
applyTheme(settings.theme);
applyMobileFontSize();
applyShowTags();
