// ── CONFIG ────────────────────────────────────────────────────────────────────
const API_BASE      = 'https://noteflow-api.jeppesen.cc/api';
const SHARE_BASE    = 'https://notes.jeppesen.cc';

const PAGE_SIZE     = 20;
const SPECIAL_TAGS  = ['hidden', 'starred'];

// ── State ─────────────────────────────────────────────────────────────────────
let allMemos      = [];
let nextCursor    = null;  // NoteFlow v2 uses cursor (created_at timestamp), not pageToken
let currentView   = 'all';
let currentTag    = null;  // active tag filter (used by project nav)
let pendingImages = [];
let shareTargetMemo = null;
let editTargetMemo  = null;
let searchQuery     = '';
let searchResults   = null; // null = not in search mode; array = server search results

// ── Settings (DB-backed per account) ─────────────────────────────────────────
let settings = {
  infiniteScroll: false,
  maxHeight: 0,
  theme: 'warm',
  attachmentsPerPage: 27,
  feedMaxWidth: 700,
  mobileFontSize: 15,
  fontFamily: "'DM Sans', sans-serif",
  offlineDays: 7,
  offlineCacheAttachments: false,
  showTags: true,
  tagCategories: '',
  tagPeople: '',
  voyageApiKey:    '',  // kept for migration — no longer used (key moved to VOYAGE_KEY worker secret)
  reminderEmail:   '',
  emailMakePublic: false,
  _semanticCoords: null,
};
// Read ONLY display preferences from localStorage for instant boot theming.
// Sensitive keys (voyageApiKey etc.) live in D1 only and are never touched here.
const DISPLAY_PREF_KEYS = ['theme', 'fontFamily', 'feedMaxWidth', 'mobileFontSize'];
try {
  const _lsPrefs = JSON.parse(localStorage.getItem('noteflow_display_prefs') || '{}');
  DISPLAY_PREF_KEYS.forEach(k => { if (_lsPrefs[k] !== undefined) settings[k] = _lsPrefs[k]; });
} catch(e) {}

// Block saveSettings() from firing until loadSettings() has completed
let _settingsLoaded = false;

let _saveSettingsTimer = null;

// ── Composer ──────────────────────────────────────────────────────────────────
let composerEditor = null; // kept for API compat — points to the textarea
let _pendingShareContent = null;

// ── Offline cache ─────────────────────────────────────────────────────────────
const NOTES_CACHE_KEY     = 'noteflow_notes_cache';
const NOTES_CACHE_VERSION = 'noteflow_cache_version';
const ATT_CACHE_NAME      = 'noteflow-attachments-v1';

let _prefetchRunning = false;

// ── Projects ──────────────────────────────────────────────────────────────────
let _projectPopoverEl = null;
let _morePopoverEl = null;
let _knownProjectTags = new Set();

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
let _searchDebounce = null;

let _loadingMore = false;

// ── Lightbox ──────────────────────────────────────────────────────────────────
let lbImages = [];
let lbIndex  = 0;
let _lbScale = 1, _lbTX = 0, _lbTY = 0;
let _lbPinching = false, _lbPinchDist0 = 0;
let _lbDragging = false, _lbDragOX = 0, _lbDragOY = 0;
let _lbLastTap = 0;

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = [
  // ── Light themes ────────────────────────────────────────────────────────────
  { id: 'vercel-light', label: 'Minimal Light', bg:'#fafafa', surface:'#ffffff', surfaceAlt:'#f5f5f5', accent:'#000000', text:'#000000', border:'#eaeaea', muted:'#666666' },
  { id: 'material-light', label: 'Material Light', bg:'#fafdfc', surface:'#ffffff', surfaceAlt:'#f0f4f4', accent:'#006874', text:'#191c1d', border:'#bec8c8', muted:'#6f7979' },
  { id: 'tailwind-slate', label: 'Tailwind Slate', bg:'#f8fafc', surface:'#ffffff', surfaceAlt:'#f1f5f9', accent:'#3b82f6', text:'#0f172a', border:'#e2e8f0', muted:'#64748b' },
  { id: 'github-light', label: 'GitHub Light',  bg:'#f6f8fa', surface:'#ffffff', surfaceAlt:'#f3f4f6', accent:'#0969da', text:'#24292f', border:'#d0d7de', muted:'#57606a' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', bg:'#eff1f5', surface:'#e6e9ef', surfaceAlt:'#dce0e8', accent:'#1e66f5', text:'#4c4f69', border:'#ccd0da', muted:'#7c7f93' },
  { id: 'solarized-light', label: 'Solarized Light', bg:'#fdf6e3', surface:'#eee8d5', surfaceAlt:'#e6dfcb', accent:'#268bd2', text:'#657b83', border:'#d3cbb7', muted:'#93a1a1' },

  // ── Dark themes ─────────────────────────────────────────────────────────────
  { id: 'vercel-dark', label: 'Minimal Dark', bg:'#000000', surface:'#0a0a0a', surfaceAlt:'#111111', accent:'#ffffff', text:'#ffffff', border:'#333333', muted:'#888888' },
  { id: 'material-dark', label: 'Material Dark', bg:'#191c1d', surface:'#1e2021', surfaceAlt:'#282b2c', accent:'#4fd8eb', text:'#e1e3e3', border:'#3f4848', muted:'#899393' },
  { id: 'tailwind-zinc', label: 'Tailwind Zinc', bg:'#18181b', surface:'#27272a', surfaceAlt:'#3f3f46', accent:'#6366f1', text:'#f4f4f5', border:'#3f3f46', muted:'#a1a1aa' },
  { id: 'github-dark', label: 'GitHub Dark',   bg:'#0d1117', surface:'#161b22', surfaceAlt:'#21262d', accent:'#58a6ff', text:'#c9d1d9', border:'#30363d', muted:'#8b949e' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', bg:'#1e1e2e', surface:'#181825', surfaceAlt:'#313244', accent:'#cba6f7', text:'#cdd6f4', border:'#45475a', muted:'#a6adc8' },
  { id: 'dracula', label: 'Dracula', bg:'#282a36', surface:'#44475a', surfaceAlt:'#6272a4', accent:'#bd93f9', text:'#f8f8f2', border:'#44475a', muted:'#6272a4' },
  { id: 'solarized-dark', label: 'Solarized Dark', bg:'#002b36', surface:'#073642', surfaceAlt:'#0a4352', accent:'#268bd2', text:'#839496', border:'#0a4352', muted:'#586e75' }
];

// ── Sidebar ───────────────────────────────────────────────────────────────────
const sidebarMQ = window.matchMedia('(min-width: 701px)');
let _sidebarMarginTimer;

// ── Trackers ──────────────────────────────────────────────────────────────────
let trackers = [];

// ── Offline UI ────────────────────────────────────────────────────────────────
let _offlineBanner = null;
let _queueBadge = null;
let _isOffline = false;
