// ── Tag Cloud / Graph View ────────────────────────────────────────────────────
// ── Fetch current user info for settings panel ────────────────────────────────
// ── Tracker sidebar nav (links to tracker.html) ──────────────────────────────
function renderTrackerNav() {
  const list = document.getElementById('tracker-nav-list');
  if (!list) return;
  list.innerHTML = '';
  trackers.filter(t => !t.archived).forEach(t => {
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = '/tracker.html?id=' + t.id;
    a.style.textDecoration = 'none';
    a.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (t.color || 'var(--accent)') + ';margin-right:6px;flex-shrink:0"></span>' + (t.name || 'Untitled');
    list.appendChild(a);
  });
}
async function loadTrackers() {
  try {
    const data = await apiGet('/trackers');
    trackers = data.trackers || [];
    renderTrackerNav();
  } catch(e) { console.warn('loadTrackers failed:', e.message); }
}

async function loadAccountInfo() {
  try {
    const data = await apiGet('/me');
    const jwtEl  = document.getElementById('account-jwt-email');
    const userEl = document.getElementById('account-user-id');
    if (jwtEl)  jwtEl.textContent  = data.jwt_email || '—';
    if (userEl) {
      const userId = data.user?.id || '—';
      userEl.textContent = userId;
      if (data.jwt_email && data.jwt_email !== userId) {
        userEl.textContent = userId + ' ← aliased';
      }
    }
  } catch(e) {
    console.warn('Could not load account info:', e.message);
  }
}
// Lazy-loaded when Settings is opened (not on boot)
