function renderProjectsNav() {
  const list = document.getElementById('projects-nav-list');
  if (!list) return;

  // Add any project tags from currently loaded notes
  allMemos.forEach(m => (m.tags || []).filter(t => t.startsWith('project:')).forEach(t => _knownProjectTags.add(t)));

  const sorted = [..._knownProjectTags].sort();

  list.innerHTML = '';
  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:4px 12px 8px;font-size:12px;color:var(--muted)';
    empty.textContent = 'No projects yet';
    list.appendChild(empty);
    return;
  }
  sorted.forEach(tag => {
    const name = tag.replace('project:', '');
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.projectTag = tag;
    if (currentView === 'tag' && currentTag === tag) btn.classList.add('active');
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>${name}`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.nav-item[data-project-tag]').forEach(n => n.classList.remove('active'));
      btn.classList.add('active');
      currentView = 'tag';
      currentTag = tag;
      document.getElementById('header-title').textContent = getViewTitle('tag');

      // Update URL to persist tag view
      const url = new URL(location.href);
      url.searchParams.set('v', 'tag');
      url.searchParams.set('t', tag);
      url.searchParams.delete('q');
      history.replaceState(null, '', url.toString());

      allMemos = []; nextCursor = null;
      loadMemos();
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('open');
    });
    list.appendChild(btn);
  });
}

// ── Collapsible sidebar sections ──────────────────────────────────────────────
function initCollapsibleSections() {
  const STORAGE_KEY = 'noteflow_sidebar_collapsed';
  let collapsed;
  try { collapsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { collapsed = {}; }

  document.querySelectorAll('.nav-section-header[data-section]').forEach(hdr => {
    const section = hdr.dataset.section;
    const bodyId = 'nav-section-' + section + '-body';
    const body = document.getElementById(bodyId);
    if (!body) return;

    const apply = (isCollapsed) => {
      hdr.classList.toggle('collapsed', isCollapsed);
      body.classList.toggle('collapsed', isCollapsed);
    };

    apply(!!collapsed[section]);

    hdr.addEventListener('click', () => {
      const nowCollapsed = !hdr.classList.contains('collapsed');
      apply(nowCollapsed);
      collapsed[section] = nowCollapsed;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)); } catch {}
    });
  });
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────
function switchView(view) {
  currentTag = null; // clear any project tag filter
  document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
  // Also clear active state from project nav items
  document.querySelectorAll('.nav-item[data-project-tag]').forEach(n => n.classList.remove('active'));
  const item = document.querySelector('.nav-item[data-view="' + view + '"]');
  if (item) item.classList.add('active');

  const feedEl     = document.getElementById('feed');
  const settingsEl = document.getElementById('settings-page');
  const composerEl = document.getElementById('composer');
  const loadMoreEl = document.getElementById('load-more');
  const searchBar  = document.getElementById('search-bar');

  // Hide all non-feed panels first
  settingsEl.classList.remove('active');
  document.querySelector('main').style.display = '';

  if (view === 'settings') {
    feedEl.style.display = 'none';
    loadMoreEl.style.display = 'none';
    composerEl.style.display = 'none';
    if (searchBar) searchBar.classList.remove('visible');
    settingsEl.classList.add('active');
    document.getElementById('header-title').textContent = 'Settings';
    currentView = 'settings';
    loadAccountInfo(); // lazy — only fetched when user opens Settings
    return;
  }

  if (searchBar) searchBar.classList.add('visible');
  feedEl.style.display = '';
  currentView = view;

  // Update URL to persist view
  const url = new URL(location.href);
  url.searchParams.set('v', view);
  url.searchParams.delete('t');
  url.searchParams.delete('q');
  history.replaceState(null, '', url.toString());

  document.getElementById('header-title').textContent = getViewTitle(view);
  allMemos = [];
  nextCursor = null;
  if (view === 'attachments') {
    renderFeed();
    fetchAllMemos().then(all => {
      allMemos = all;
      renderFeed();
    }).catch(err => toast('Failed to load attachments: ' + err.message));
  } else if (view === 'offline') {
    allMemos = loadNotesCache();
    renderFeed();
  } else {
    loadMemos();
  }
}

function initNavItems() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('open');
    });
  });
}

// Mobile sidebar toggle
document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
});
document.getElementById('sidebar-overlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
});

// ── Load more + infinite scroll ──────────────────────────────────────────────
document.getElementById('load-more-btn').addEventListener('click', () => loadMemos(true));

// ── Search ────────────────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  searchClear.classList.toggle('visible', searchQuery.length > 0);

  // Update URL to persist search query
  const url = new URL(location.href);
  if (searchQuery) url.searchParams.set('q', searchQuery);
  else url.searchParams.delete('q');
  history.replaceState(null, '', url.toString());

  clearTimeout(_searchDebounce);
  if (!searchQuery) {
    searchResults = null;
    renderFeed();
    return;
  }
  if (searchQuery.length < 2) return;
  _searchDebounce = setTimeout(async () => {
    try {
      const r = await fetch(API_BASE + '/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ q: searchQuery }),
      });
      if (!r.ok) throw new Error('Search failed');
      const { notes } = await r.json();
      searchResults = notes || [];
      renderFeed();
    } catch (e) {
      console.error('[search]', e);
    }
  }, 300);
});
searchClear.addEventListener('click', () => {
  searchInput.value = ''; searchQuery = '';
  searchResults = null;
  searchClear.classList.remove('visible');

  // Update URL to clear search query
  const url = new URL(location.href);
  url.searchParams.delete('q');
  history.replaceState(null, '', url.toString());

  renderFeed();
});

// Hide search bar on non-feed views
const _origSwitchView = switchView;

const infiniteObserver = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && settings.infiniteScroll && nextCursor && currentView !== 'settings') {
    if (_loadingMore) return;
    _loadingMore = true;
    loadMemos(true).finally(() => { _loadingMore = false; });
  }
}, { rootMargin: '200px' });
infiniteObserver.observe(document.getElementById('infinite-sentinel'));

// ── Sidebar margin: driven by matchMedia, not CSS media query ─────────────────
// This prevents mobile Chrome's scrolling viewport resize from breaking layout.
// Debounce the change handler so brief viewport-width glitches (e.g. Android
// Chrome URL-bar collapse during infinite-scroll reflow) don't permanently
// flip the class.
function updateSidebarMargin(e) {
  clearTimeout(_sidebarMarginTimer);
  _sidebarMarginTimer = setTimeout(() => {
    document.getElementById('content').classList.toggle('sidebar-visible', e.matches);
  }, 150);
}
sidebarMQ.addEventListener('change', updateSidebarMargin);
// Apply immediately on load (no debounce needed for initial state)
document.getElementById('content').classList.toggle('sidebar-visible', sidebarMQ.matches);
