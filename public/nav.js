/**
 * NoteFlow shared sidebar — nav.js
 * Set window.NAV_PAGE = 'index' | 'tracker' | 'tagcloud' before loading this script.
 * After boot, call: renderTrackerNav(trackers), renderProjectsNav(projectTags), initCollapsibleSections()
 */
(function () {
  'use strict';

  const PAGE = window.NAV_PAGE || 'index';
  const isIndex = PAGE === 'index';

  // ── SVG icons ───────────────────────────────────────────────────────────────
  const ICONS = {
    notes:       '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    hidden:      '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    archive:     '<svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    offline:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    shared:      '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    attachments: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    tagcloud:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><line x1="7" y1="11.2" x2="11" y2="12"/><line x1="13" y1="12" x2="17.2" y2="6.5"/><line x1="13" y1="12" x2="17.2" y2="17.5"/></svg>',
    folder:      '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    settings:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    tasks:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 20 6"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  };

  // ── Build a nav item ─────────────────────────────────────────────────────────
  function navBtn(icon, label, attrs) {
    // attrs: { view, href, active, id, style }
    const isLink = !isIndex || attrs.href;
    const el = document.createElement(isLink ? 'a' : 'button');
    el.className = 'nav-item' + (attrs.active ? ' active' : '');
    if (attrs.id) el.id = attrs.id;
    if (isLink && attrs.href) { el.href = attrs.href; el.style.textDecoration = 'none'; }
    if (!isLink && attrs.view) el.dataset.view = attrs.view;
    if (attrs.style) el.style.cssText += ';' + attrs.style;
    el.innerHTML = ICONS[icon] + '\n        ' + label;
    return el;
  }

  function sectionHeader(label, section, extra) {
    const hdr = document.createElement('div');
    hdr.className = 'nav-section-header' + (section === 'tracking' ? ' tracker-section-header' : '');
    hdr.dataset.section = section;
    const span = document.createElement('span');
    span.className = 'nav-section-label-text';
    span.textContent = label;
    hdr.appendChild(span);
    if (extra) { hdr.appendChild(extra); }
    else {
      const chevron = document.createElement('span');
      chevron.className = 'nav-section-chevron';
      chevron.textContent = '▾';
      hdr.appendChild(chevron);
    }
    return hdr;
  }

  function sectionBody(id) {
    const div = document.createElement('div');
    div.className = 'nav-section-body';
    div.id = 'nav-section-' + id + '-body';
    return div;
  }

  // ── Build the full sidebar ───────────────────────────────────────────────────
  function buildSidebar() {
    const aside = document.getElementById('sidebar');
    if (!aside) return;
    aside.innerHTML = '';

    // Logo
    const logo = document.createElement('div');
    logo.className = 'sidebar-logo';
    if (isIndex) {
      logo.textContent = 'noteflow';
    } else {
      const a = document.createElement('a');
      a.href = '/'; a.style.cssText = 'color:inherit;text-decoration:none';
      a.textContent = 'noteflow';
      logo.appendChild(a);
    }
    aside.appendChild(logo);

    // PWA install bar (index only)
    if (isIndex) {
      const bar = document.createElement('div');
      bar.id = 'pwa-install-bar';
      bar.style.cssText = 'display:none;padding:6px 10px';
      bar.innerHTML = '<button id="pwa-install-btn" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--accent);background:var(--accent-bg);color:var(--accent);font-size:12px;font-family:var(--font-body);cursor:pointer;font-weight:500">⬇ Install NoteFlow app</button>';
      aside.appendChild(bar);
    }

    // Nav
    const nav = document.createElement('nav');
    nav.className = 'sidebar-nav';

    // ── Notes section (index only) ──
    if (isIndex) {
      nav.appendChild(navBtn('notes', 'All notes', { view: 'all', active: true, id: 'nav-all' }));
      nav.appendChild(navBtn('tasks', 'Tasks', { view: 'tasks' }));
      nav.appendChild(navBtn('offline', 'Offline', { view: 'offline' }));
      nav.appendChild(navBtn('hidden', 'Hidden', { view: 'hidden' }));
      nav.appendChild(navBtn('archive', 'Archive', { view: 'archived' }));
      nav.appendChild(navBtn('shared', 'Shared', { view: 'shared' }));
    } else {
      nav.appendChild(navBtn('notes', 'All notes', { href: '/' }));
    }

    // ── Projects section ──
    const projBody = sectionBody('projects');
    const projList = document.createElement('div');
    projList.id = 'projects-nav-list';
    projBody.appendChild(projList);
    nav.appendChild(sectionHeader('Projects', 'projects'));
    nav.appendChild(projBody);

    // ── Library section ──
    const libBody = sectionBody('library');
    if (isIndex) {
      libBody.appendChild(navBtn('attachments', 'Attachments', { view: 'attachments' }));
    }
    libBody.appendChild(navBtn('tagcloud', 'Tag Cloud', {
      href: '/tagcloud.html',
      active: PAGE === 'tagcloud',
    }));
    nav.appendChild(sectionHeader('Library', 'library'));
    nav.appendChild(libBody);

    // ── Spacer before tracking ──
    const spacer = document.createElement('div');
    spacer.className = 'nav-spacer';
    spacer.style.cssText = 'min-height:4px;max-height:4px';
    nav.appendChild(spacer);

    // ── Tracking section ──
    const trkBody = sectionBody('tracking');
    const trkList = document.createElement('div');
    trkList.id = 'tracker-nav-list';
    trkBody.appendChild(trkList);

    // Tracking header — has + button
    const trkExtra = document.createElement('div');
    trkExtra.style.cssText = 'display:flex;align-items:center;gap:4px';
    const addBtn = document.createElement('a');
    addBtn.className = 'tracker-add-btn';
    addBtn.href = '/tracker.html?new=1';
    addBtn.title = 'New tracker';
    addBtn.style.textDecoration = 'none';
    addBtn.setAttribute('onclick', 'event.stopPropagation()');
    addBtn.textContent = '+';
    const chevron = document.createElement('span');
    chevron.className = 'nav-section-chevron';
    chevron.textContent = '▾';
    trkExtra.appendChild(addBtn);
    trkExtra.appendChild(chevron);

    nav.appendChild(sectionHeader('Tracking', 'tracking', trkExtra));
    nav.appendChild(trkBody);

    // ── Settings (index only) ──
    if (isIndex) {
      const spacer2 = document.createElement('div');
      spacer2.className = 'nav-spacer';
      nav.appendChild(spacer2);
      const divider = document.createElement('div');
      divider.style.cssText = 'border-top:1px solid var(--border);margin:0 0 4px';
      nav.appendChild(divider);
      nav.appendChild(navBtn('settings', 'Settings', { view: 'settings' }));
    }

    aside.appendChild(nav);

    // Sidebar toggle button (mobile)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'sidebar-toggle';
    toggleBtn.id = 'sidebar-toggle';
    toggleBtn.textContent = '☰';
    aside.appendChild(toggleBtn);
  }

  // ── Shared state (exposed as globals) ────────────────────────────────────────
  window._knownProjectTags = window._knownProjectTags || new Set();

  // ── Render tracker nav items ─────────────────────────────────────────────────
  // Only define if not already provided by the page's own script
  if (!window.renderTrackerNav) {
    window.renderTrackerNav = function (trackers) {
      const list = document.getElementById('tracker-nav-list');
      if (!list) return;
      list.innerHTML = '';
      (trackers || []).filter(t => !t.archived).forEach(t => {
        const el = document.createElement('a');
        el.className = 'nav-item' + (PAGE === 'tracker' && window._activeTrackerId === t.id ? ' active' : '');
        el.href = '/tracker.html?id=' + t.id;
        el.style.textDecoration = 'none';
        el.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (t.color || 'var(--accent)') + ';margin-right:6px;flex-shrink:0"></span>' + (t.name || 'Untitled');
        list.appendChild(el);
      });
    };
  }

  // ── Render project nav items ─────────────────────────────────────────────────
  if (!window.renderProjectsNav) {
    window.renderProjectsNav = function (projectTags) {
      if (projectTags) projectTags.forEach(t => window._knownProjectTags.add(t));
      const list = document.getElementById('projects-nav-list');
      if (!list) return;
      const sorted = [...window._knownProjectTags].sort();
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
        const el = isIndex ? document.createElement('button') : document.createElement('a');
        el.className = 'nav-item';
        if (isIndex) {
          el.dataset.projectTag = tag;
        } else {
          el.href = '/?tag=' + encodeURIComponent(tag);
          el.style.textDecoration = 'none';
        }
        el.innerHTML = ICONS.folder + name;
        list.appendChild(el);
      });
    };
  }

  // ── Collapsible sections ─────────────────────────────────────────────────────
  if (!window.initCollapsibleSections) {
    window.initCollapsibleSections = function () {
      const STORAGE_KEY = 'noteflow_sidebar_collapsed';
      let collapsed;
      try { collapsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { collapsed = {}; }
      document.querySelectorAll('.nav-section-header[data-section]').forEach(hdr => {
        const section = hdr.dataset.section;
        const body = document.getElementById('nav-section-' + section + '-body');
        if (!body) return;
        const apply = (isColl) => {
          hdr.classList.toggle('collapsed', isColl);
          body.classList.toggle('collapsed', isColl);
        };
        apply(!!collapsed[section]);
        hdr.addEventListener('click', () => {
          const now = !hdr.classList.contains('collapsed');
          apply(now);
          collapsed[section] = now;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)); } catch {}
        });
      });
    };
  }

  // ── Sidebar toggle (mobile) ──────────────────────────────────────────────────
  function wireSidebarToggle() {
    const hamburger = document.getElementById('mobile-hamburger');
    const overlay   = document.getElementById('sidebar-overlay');
    const sidebar   = document.getElementById('sidebar');
    const close = () => { sidebar?.classList.remove('open'); overlay?.classList.remove('open'); };
    hamburger?.addEventListener('click', () => { sidebar?.classList.toggle('open'); overlay?.classList.toggle('open'); });
    overlay?.addEventListener('click', close);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  buildSidebar();
  wireSidebarToggle();
  // Wire nav item clicks (index.html defines initNavItems for its data-view buttons)
  if (typeof window.initNavItems === 'function') window.initNavItems();

  // Re-wire the PWA install prompt if on index
  if (isIndex) {
    let _installPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      _installPrompt = e;
      const bar = document.getElementById('pwa-install-bar');
      if (bar) bar.style.display = 'block';
    });
    window.addEventListener('appinstalled', () => {
      _installPrompt = null;
      const bar = document.getElementById('pwa-install-bar');
      if (bar) bar.style.display = 'none';
    });
    document.addEventListener('click', e => {
      if (e.target.id === 'pwa-install-btn' && _installPrompt) {
        _installPrompt.prompt();
        _installPrompt.userChoice.then(() => { _installPrompt = null; });
      }
    });
  }

})();
