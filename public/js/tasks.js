// ── Tasks module ──────────────────────────────────────────────────────────────
// Globals: renderTasksFeed, openTasksOverlay, closeTasksOverlay,
//          renderTasksOverlay, openTaskDetail, saveTaskFields,
//          quickAddTask, completeTask, buildTaskCard

// Subject/category color palette — color is derived deterministically from subject name
const SUBJECT_PALETTE = [
  { bg: '#e0e7ff', text: '#4338ca' }, { bg: '#fce7f3', text: '#be185d' },
  { bg: '#dcfce7', text: '#15803d' }, { bg: '#fff7ed', text: '#c2410c' },
  { bg: '#f0f9ff', text: '#0369a1' }, { bg: '#fef9c3', text: '#a16207' },
  { bg: '#f3e8ff', text: '#7e22ce' }, { bg: '#fee2e2', text: '#b91c1c' },
];
function subjectColor(subject) {
  if (!subject) return { bg: 'var(--surface-alt)', text: 'var(--muted)' };
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) & 0xffffffff;
  return SUBJECT_PALETTE[Math.abs(h) % SUBJECT_PALETTE.length];
}

let _alertTaskCount = 0;

function countAlertTasks(tasks) {
  const today = new Date().toISOString().slice(0, 10);
  return tasks.filter(t => t.due_date === today || (t.due_date && t.due_date < today)).length;
}

function refreshTaskBadge() {
  if (typeof updateTasksNavBadge === 'function') updateTasksNavBadge(_alertTaskCount);
}


function isOverdue(due_date) {
  if (!due_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return due_date < today;
}

function isDueToday(due_date) {
  if (!due_date) return false;
  return due_date === new Date().toISOString().slice(0, 10);
}

function relativeDue(due_date) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const [dy, dm, dd] = due_date.split('-').map(Number);
  const diff = Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff > 0) {
    if (diff === 1) return '1 day';
    if (diff <= 14) return diff + ' days';
    if (diff < 90) return Math.round(diff / 7) + ' wks';
    return Math.round(diff / 30) + ' mo';
  }
  const abs = Math.abs(diff);
  if (abs === 1) return '1 day ago';
  if (abs <= 14) return abs + ' days ago';
  if (abs < 90) return Math.round(abs / 7) + ' wks ago';
  return Math.round(abs / 30) + ' mo ago';
}

function dueDateChip(due_date) {
  if (!due_date) return null;
  const chip = document.createElement('span');
  const overdue = isOverdue(due_date);
  const today = isDueToday(due_date);
  chip.style.cssText = `font-size:11px;padding:2px 7px;border-radius:10px;font-weight:${overdue ? '700' : '400'};` +
    `background:${overdue ? '#fde8e8' : today ? '#fef3c7' : 'var(--surface-alt)'};` +
    `color:${overdue ? '#ef4444' : today ? '#d97706' : 'var(--muted)'};white-space:nowrap;flex-shrink:0`;
  chip.textContent = overdue ? 'Overdue · ' + relativeDue(due_date) : relativeDue(due_date);
  chip.title = due_date;
  return chip;
}

// ── completeTask ─────────────────────────────────────────────────────────────
async function completeTask(id, done) {
  try {
    const result = await apiPatch('/notes/' + id + '/complete', { completed: done });
    return result.note;
  } catch(e) {
    toast('Failed to update task: ' + e.message);
    return null;
  }
}

// ── saveTaskFields ────────────────────────────────────────────────────────────
async function saveTaskFields(id, patch) {
  try {
    const result = await apiPatch('/notes/' + id, patch);
    return result.note;
  } catch(e) {
    toast('Failed to save task: ' + e.message);
    return null;
  }
}

// ── quickAddTask ─────────────────────────────────────────────────────────────
async function quickAddTask(text, feedEl) {
  if (!text || !text.trim()) return;
  const content = text.trim();
  const subject = settings.tasks_default_subject || null;
  const isMainFeed = feedEl && feedEl.id === 'feed';

  const taskObj = { id: '_opt_' + Date.now(), content, is_task: 1, due_date: null, priority: subject, completed_at: null };
  const optimisticRow = isMainFeed ? buildTaskCard(taskObj) : buildTaskRow(taskObj, feedEl);
  optimisticRow.style.opacity = '0.6';

  // Insert after the quick-add row (main feed) or sort bar (overlay), not before them
  const qaRow = feedEl.querySelector('.tasks-qa-row');
  const sortBar = feedEl.querySelector('.tasks-sort-bar');
  const anchor = qaRow || sortBar;
  if (anchor) {
    anchor.after(optimisticRow);
  } else {
    feedEl.prepend(optimisticRow);
  }

  try {
    const result = await apiPost('/notes', { content, is_task: 1, priority: subject });
    const newCard = isMainFeed ? buildTaskCard(result.note) : buildTaskRow(result.note, feedEl);
    optimisticRow.replaceWith(newCard);
  } catch(e) {
    optimisticRow.remove();
    toast('Failed to create task: ' + e.message);
  }
}

// ── buildTaskRow ─────────────────────────────────────────────────────────────
// Compact row for the overlay and tasks feed
function buildTaskRow(task, feedEl) {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.dataset.taskId = task.id;
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s';
  row.addEventListener('mouseenter', () => { row.style.background = 'var(--surface-alt)'; });
  row.addEventListener('mouseleave', () => { row.style.background = ''; });

  // Checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!task.completed_at;
  cb.style.cssText = 'width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:var(--accent)';
  cb.addEventListener('click', async e => {
    e.stopPropagation();
    const done = cb.checked;
    row.style.opacity = '0.5';
    const updated = await completeTask(task.id, done);
    if (updated) {
      row.style.transition = 'opacity 0.3s';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 300);
    } else {
      cb.checked = !done;
      row.style.opacity = '1';
    }
  });

  row.appendChild(cb);

  const textEl = document.createElement('span');
  textEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;' + (task.completed_at ? 'text-decoration:line-through;color:var(--muted)' : '');
  textEl.textContent = (task.content || '').split('\n')[0].slice(0, 120);
  row.appendChild(textEl);

  const chip = dueDateChip(task.due_date);
  if (chip) row.appendChild(chip);

  // Click row (not checkbox) → open detail modal
  row.addEventListener('click', e => {
    if (e.target === cb) return;
    openTaskDetail(task.id);
  });

  return row;
}

// ── buildTaskCard ─────────────────────────────────────────────────────────────
// Full card for the Tasks feed view (in #feed)
function buildTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'memo-card task-card';
  card.dataset.memoName = task.id;
  card.style.position = 'relative';

  // Header row: checkbox + title (first line)
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!task.completed_at;
  cb.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--accent)';
  cb.addEventListener('click', async e => {
    e.stopPropagation();
    const done = cb.checked;
    card.style.opacity = '0.5';
    const updated = await completeTask(task.id, done);
    if (updated) {
      if (done) {
        const today = new Date().toISOString().slice(0, 10);
        const wasAlert = task.due_date === today || (task.due_date && task.due_date < today);
        if (wasAlert) { _alertTaskCount = Math.max(0, _alertTaskCount - 1); refreshTaskBadge(); }
      }
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    } else {
      cb.checked = !done;
      card.style.opacity = '1';
    }
  });
  header.appendChild(cb);

  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;cursor:pointer;' + (task.completed_at ? 'text-decoration:line-through;opacity:0.6' : '');
  titleEl.textContent = (task.content || '').split('\n')[0] || 'Task';
  header.appendChild(titleEl);

  card.appendChild(header);

  // Meta row: subject badge + due date chip + notif chip (display only — click card to edit in modal)
  const meta = document.createElement('div');
  meta.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap';

  // Subject badge — display only
  const c = subjectColor(task.priority);
  const subjectBadge = document.createElement('span');
  subjectBadge.style.cssText = `font-size:11px;padding:2px 8px;border-radius:10px;background:${c.bg};color:${c.text};white-space:nowrap`;
  subjectBadge.textContent = task.priority || 'No subject';
  meta.appendChild(subjectBadge);

  // Due date chip — display only
  const dateChip = dueDateChip(task.due_date);
  if (dateChip) meta.appendChild(dateChip);

  // Notification chip — display only, shown only when configured
  if (task.notif_days_before != null && task.notif_time) {
    const notifChip = document.createElement('span');
    notifChip.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:10px;background:var(--surface-alt);color:var(--muted);display:inline-flex;align-items:center;gap:3px';
    notifChip.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    notifChip.appendChild(document.createTextNode(' ' + task.notif_days_before + 'd · ' + task.notif_time));
    notifChip.title = 'Notification: ' + task.notif_days_before + ' day(s) before at ' + task.notif_time;
    meta.appendChild(notifChip);
  }

  card.appendChild(meta);

  // Tags
  const tags = Array.isArray(task.tags) ? task.tags.filter(t => !['hidden','starred'].includes(t)) : [];
  if (tags.length && settings.showTags !== false) {
    const tagRow = document.createElement('div');
    tagRow.className = 'card-tags';
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      tagRow.appendChild(chip);
    });
    card.appendChild(tagRow);
  }

  card.addEventListener('click', e => {
    if (e.target.closest('input, button, a')) return;
    openTaskDetail(task.id);
  });

  return card;
}

let _tasksFeedRefreshTimer = null;

// ── renderTasksFeed ───────────────────────────────────────────────────────────
// ── Task grouping ─────────────────────────────────────────────────────────────
function groupTasks(tasks, groupBy) {
  if (groupBy === 'none') return new Map([['', { label: '', tasks }]]);

  const today = new Date().toISOString().slice(0, 10);
  const [ty, tm, td] = today.split('-').map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td);

  function dayBucket(isoDate) {
    if (!isoDate) return { key: '__none__', label: 'No due date' };
    const [dy, dm, dd] = isoDate.split('-').map(Number);
    const diff = Math.round((Date.UTC(dy, dm - 1, dd) - todayMs) / 86400000);
    if (diff < 0) return { key: '__overdue__', label: 'Overdue' };
    if (diff === 0) return { key: '__today__', label: 'Today' };
    if (diff === 1) return { key: '__tomorrow__', label: 'Tomorrow' };
    if (diff <= 7) return { key: '__thisweek__', label: 'This week' };
    return { key: '__later__', label: 'Later' };
  }

  function tsBucket(unixSec) {
    if (!unixSec) return { key: '__none__', label: 'Unknown' };
    const d = new Date(unixSec * 1000);
    const dStr = d.toISOString().slice(0, 10);
    const [dy, dm, dd2] = dStr.split('-').map(Number);
    const diff = Math.round((todayMs - Date.UTC(dy, dm - 1, dd2)) / 86400000);
    if (diff === 0) return { key: '__today__', label: 'Today' };
    if (diff === 1) return { key: '__yesterday__', label: 'Yesterday' };
    if (diff <= 7) return { key: '__thisweek__', label: 'This week' };
    return { key: dStr.slice(0, 7), label: d.toLocaleString('default', { month: 'long', year: 'numeric' }) };
  }

  const map = new Map();
  const addTo = (key, label, task) => {
    if (!map.has(key)) map.set(key, { label, tasks: [] });
    map.get(key).tasks.push(task);
  };

  tasks.forEach(task => {
    if (groupBy === 'subject') {
      const key = task.priority || '__none__';
      const label = task.priority || 'No subject';
      addTo(key, label, task);
    } else if (groupBy === 'due_date') {
      const { key, label } = dayBucket(task.due_date);
      addTo(key, label, task);
    } else if (groupBy === 'title') {
      const first = (task.content || '').trim()[0] || '';
      const key = /[a-zA-Z]/.test(first) ? first.toUpperCase() : '#';
      addTo(key, key, task);
    } else if (groupBy === 'created') {
      const { key, label } = tsBucket(task.created_at);
      addTo(key, label, task);
    } else if (groupBy === 'modified') {
      const { key, label } = tsBucket(task.updated_at);
      addTo(key, label, task);
    }
  });

  return map;
}

// ── View-options popover ──────────────────────────────────────────────────────
function buildViewOptionsBtn(feed) {
  const SORT_OPTIONS  = [['due_date','Due Date'],['subject','Subject'],['title','Title'],['created','Created'],['modified','Modified']];
  const GROUP_OPTIONS = [['none','None'],['subject','Subject'],['due_date','Due Date'],['title','Title'],['created','Created'],['modified','Modified']];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:flex;justify-content:flex-end;margin-bottom:14px';

  const btn = document.createElement('button');
  btn.title = 'View options';
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;font-family:var(--font-body);cursor:pointer';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> View';
  wrap.appendChild(btn);

  let popover = null;

  function buildPopover() {
    const pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;top:calc(100% + 4px);right:0;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:12px 14px;min-width:220px';

    function buildSection(title, options, current, onSelect) {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:7px;' + (title === 'Sort by' ? 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);' : '');
      hdr.textContent = title;
      pop.appendChild(hdr);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
      options.forEach(([val, label]) => {
        const chip = document.createElement('button');
        const active = current === val;
        chip.style.cssText = 'padding:4px 10px;border-radius:14px;font-size:12px;font-family:var(--font-body);cursor:pointer;border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'var(--accent)' : 'var(--surface-alt)') + ';color:' + (active ? 'var(--bg)' : 'var(--text)');
        chip.textContent = label;
        chip.addEventListener('click', e => { e.stopPropagation(); onSelect(val); });
        row.appendChild(chip);
      });
      pop.appendChild(row);
    }

    buildSection('Group by', GROUP_OPTIONS, taskGroupBy, val => {
      taskGroupBy = val;
      try { localStorage.setItem('noteflow_task_group', val); } catch {}
      renderTasksFeed();
    });
    buildSection('Sort by', SORT_OPTIONS, taskSortOrder, val => {
      taskSortOrder = val;
      try { localStorage.setItem('noteflow_task_sort', val); } catch {}
      renderTasksFeed();
    });

    return pop;
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (popover) { popover.remove(); popover = null; return; }
    popover = buildPopover();
    wrap.appendChild(popover);
    setTimeout(() => document.addEventListener('click', function close() {
      popover?.remove(); popover = null;
      document.removeEventListener('click', close);
    }), 0);
  });

  return wrap;
}

async function renderTasksFeed() {
  // Reset auto-refresh timer on each render
  if (_tasksFeedRefreshTimer) { clearTimeout(_tasksFeedRefreshTimer); _tasksFeedRefreshTimer = null; }
  _tasksFeedRefreshTimer = setTimeout(() => {
    if (typeof currentView !== 'undefined' && currentView === 'tasks' && !document.hidden) renderTasksFeed();
  }, 60000);

  // Hide search bar — it doesn't apply to tasks
  const searchTasksBar = document.getElementById('search-tasks-bar');
  if (searchTasksBar) searchTasksBar.style.display = 'none';

  const feed = document.getElementById('feed');
  feed.innerHTML = '<div class="empty-state" style="padding:40px 20px">Loading tasks…</div>';

  // View options button (replaces sort bar)
  const viewOptsBtn = buildViewOptionsBtn(feed);

  // Quick add row
  const qaRow = document.createElement('div');
  qaRow.className = 'tasks-qa-row';
  qaRow.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
  const qaInput = document.createElement('input');
  qaInput.type = 'text';
  qaInput.placeholder = 'Quick add a task…';
  qaInput.style.cssText = 'flex:1;border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:13px;font-family:var(--font-body);background:var(--surface);color:var(--text);outline:none';
  const qaBtn = document.createElement('button');
  qaBtn.textContent = 'Add';
  qaBtn.style.cssText = 'padding:7px 14px;border-radius:8px;border:none;background:var(--accent);color:var(--bg);font-size:13px;font-family:var(--font-body);cursor:pointer';
  const doAdd = () => {
    const text = qaInput.value.trim();
    if (!text) return;
    qaInput.value = '';
    quickAddTask(text, feed);
  };
  qaInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  qaBtn.addEventListener('click', doAdd);
  qaRow.appendChild(qaInput);
  qaRow.appendChild(qaBtn);

  feed.innerHTML = '';
  feed.appendChild(viewOptsBtn);
  feed.appendChild(qaRow);

  try {
    const data = await apiGet('/notes?is_task=1&sort=' + taskSortOrder + '&pageSize=100');
    const tasks = data.notes || [];

    _alertTaskCount = countAlertTasks(tasks);
    refreshTaskBadge();

    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '40px 20px';
      empty.textContent = 'No active tasks. Add one above!';
      feed.appendChild(empty);
    } else {
      const groups = groupTasks(tasks, taskGroupBy);
      const collapseState = new Map(); // groupKey → collapsed bool

      groups.forEach(({ label, tasks: groupedTasks }, key) => {
        if (taskGroupBy !== 'none') {
          // Group header
          const hdr = document.createElement('div');
          hdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 2px;margin-top:6px;cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em';
          const arrow = document.createElement('span');
          arrow.style.cssText = 'font-size:10px;transition:transform 0.15s;display:inline-block';
          arrow.textContent = '▾';
          const labelEl = document.createElement('span');
          labelEl.textContent = label + ' (' + groupedTasks.length + ')';
          hdr.appendChild(arrow);
          hdr.appendChild(labelEl);
          feed.appendChild(hdr);

          const body = document.createElement('div');
          body.className = 'task-group-body';
          groupedTasks.forEach(task => body.appendChild(buildTaskCard(task)));
          feed.appendChild(body);

          hdr.addEventListener('click', () => {
            const collapsed = !collapseState.get(key);
            collapseState.set(key, collapsed);
            body.style.display = collapsed ? 'none' : '';
            arrow.style.transform = collapsed ? 'rotate(-90deg)' : '';
          });
        } else {
          groupedTasks.forEach(task => feed.appendChild(buildTaskCard(task)));
        }
      });
    }

    // "Show completed" toggle
    const completedToggle = document.createElement('div');
    completedToggle.style.cssText = 'margin-top:20px;padding:10px 14px;border-top:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px;user-select:none';
    let completedLoaded = false;
    let completedVisible = settings.tasks_show_completed;
    const updateToggleLabel = () => {
      completedToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="${completedVisible ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg> ${completedVisible ? 'Hide completed' : 'Show completed'}`;
    };
    updateToggleLabel();

    const completedSection = document.createElement('div');
    completedSection.style.display = completedVisible ? '' : 'none';

    completedToggle.addEventListener('click', async () => {
      completedVisible = !completedVisible;
      completedSection.style.display = completedVisible ? '' : 'none';
      updateToggleLabel();
      if (completedVisible && !completedLoaded) {
        completedLoaded = true;
        completedSection.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--muted)">Loading…</div>';
        try {
          const cdata = await apiGet('/notes?is_task=1&completed=1&sort=completed&pageSize=100');
          const ctasks = cdata.notes || [];
          completedSection.innerHTML = '';
          if (!ctasks.length) {
            completedSection.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--muted)">No completed tasks.</div>';
          } else {
            const divider = document.createElement('div');
            divider.style.cssText = 'padding:6px 14px;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:0.05em;border-top:1px solid var(--border)';
            divider.textContent = 'Completed';
            completedSection.appendChild(divider);
            ctasks.forEach(task => {
              const card = buildTaskCard(task);
              const reopenBtn = document.createElement('button');
              reopenBtn.className = 'card-action-btn';
              reopenBtn.style.cssText = 'color:var(--accent)';
              reopenBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg> Reopen';
              reopenBtn.addEventListener('click', async e => {
                e.stopPropagation();
                await completeTask(task.id, false);
                card.remove();
                toast('Task reopened');
                renderTasksFeed();
              });
              const actRow = card.querySelector('.card-actions');
              if (actRow) actRow.prepend(reopenBtn);
              completedSection.appendChild(card);
            });
          }
        } catch(e) { completedSection.innerHTML = '<div style="padding:10px 14px;color:var(--danger)">Failed to load</div>'; }
      }
    });

    if (completedVisible && !completedLoaded) completedToggle.click();

    feed.appendChild(completedToggle);
    feed.appendChild(completedSection);

  } catch(e) {
    const cached = loadTasksCache();
    if (cached.length) {
      const offlineNote = document.createElement('div');
      offlineNote.style.cssText = 'padding:8px 14px;background:#fff3cd;border-radius:8px;font-size:12px;color:#856404;margin-bottom:10px;border:1px solid #ffc107';
      offlineNote.textContent = '📵 Showing cached tasks — last synced when online';
      feed.appendChild(offlineNote);
      cached.forEach(task => feed.appendChild(buildTaskCard(task)));
    } else {
      feed.innerHTML = '<div class="empty-state">Failed to load tasks — no offline cache available</div>';
      toast('Failed to load tasks: ' + e.message);
    }
  }
}

// ── Bottom-sheet overlay ──────────────────────────────────────────────────────
function openTasksOverlay() {
  const overlay = document.getElementById('tasks-overlay');
  const backdrop = document.getElementById('tasks-overlay-backdrop');
  if (!overlay) return;
  overlay.classList.add('open');
  backdrop.classList.add('open');
  tasksOverlayOpen = true;
  document.body.classList.add('tasks-overlay-open');
  renderTasksOverlay();
}

function closeTasksOverlay() {
  const overlay = document.getElementById('tasks-overlay');
  const backdrop = document.getElementById('tasks-overlay-backdrop');
  if (!overlay) return;
  overlay.classList.remove('open');
  backdrop.classList.remove('open');
  tasksOverlayOpen = false;
  document.body.classList.remove('tasks-overlay-open');
}

async function renderTasksOverlay() {
  const feedEl = document.getElementById('tasks-overlay-feed');
  if (!feedEl) return;
  feedEl.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px">Loading…</div>';

  try {
    const sortParam = taskSortOrder === 'due_date' ? 'due_date' : taskSortOrder === 'created' ? 'created' : 'subject';
    const data = await apiGet('/notes?is_task=1&sort=' + sortParam + '&pageSize=100');
    const tasks = data.notes || [];
    feedEl.innerHTML = '';

    _alertTaskCount = countAlertTasks(tasks);
    refreshTaskBadge();

    if (!tasks.length) {
      feedEl.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px">No active tasks.</div>';
    } else {
      tasks.forEach(task => feedEl.appendChild(buildTaskRow(task, feedEl)));
    }

    // "Show completed" section (collapsed by default)
    const completedToggle = document.createElement('div');
    completedToggle.style.cssText = 'padding:10px 14px;font-size:13px;color:var(--muted);cursor:pointer;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;user-select:none';
    completedToggle.textContent = 'Show completed';
    let completedOpen = false;
    const completedSection = document.createElement('div');
    completedSection.style.display = 'none';
    let completedLoaded = false;

    completedToggle.addEventListener('click', async () => {
      completedOpen = !completedOpen;
      completedSection.style.display = completedOpen ? '' : 'none';
      completedToggle.textContent = completedOpen ? 'Hide completed' : 'Show completed';
      if (completedOpen && !completedLoaded) {
        completedLoaded = true;
        completedSection.innerHTML = '<div style="padding:8px 14px;font-size:13px;color:var(--muted)">Loading…</div>';
        try {
          const cdata = await apiGet('/notes?is_task=1&completed=1&sort=' + sortParam + '&pageSize=50');
          completedSection.innerHTML = '';
          (cdata.notes || []).forEach(task => {
            const row = buildTaskRow(task, feedEl);
            row.style.opacity = '0.6';
            row.querySelector('span').style.textDecoration = 'line-through';
            completedSection.appendChild(row);
          });
          if (!completedSection.children.length) completedSection.innerHTML = '<div style="padding:8px 14px;font-size:13px;color:var(--muted)">No completed tasks.</div>';
        } catch(e) { completedSection.innerHTML = '<div style="padding:8px 14px;color:var(--danger)">Failed to load</div>'; }
      }
    });
    feedEl.appendChild(completedToggle);
    feedEl.appendChild(completedSection);

  } catch(e) {
    const cached = loadTasksCache();
    if (cached.length) {
      feedEl.innerHTML = '';
      const offlineNote = document.createElement('div');
      offlineNote.style.cssText = 'padding:8px 14px;font-size:12px;color:#856404;background:#fff3cd;border-bottom:1px solid #ffc107;margin-bottom:4px';
      offlineNote.textContent = '📵 Cached tasks';
      feedEl.appendChild(offlineNote);
      cached.forEach(task => feedEl.appendChild(buildTaskRow(task, feedEl)));
    } else {
      feedEl.innerHTML = '<div style="padding:20px;color:var(--danger);font-size:13px">Failed to load tasks</div>';
    }
  }
}

// ── Task Detail modal ─────────────────────────────────────────────────────────
let _taskDetailId = null;

async function openTaskDetail(taskId) {
  _taskDetailId = taskId;
  const modal = document.getElementById('task-detail-modal');
  if (!modal) return;

  // Fetch full task data
  let task;
  try {
    const data = await apiGet('/notes/' + taskId);
    task = data.note;
  } catch(e) {
    toast('Failed to load task: ' + e.message);
    return;
  }

  // Populate fields
  document.getElementById('td-complete-cb').checked = !!task.completed_at;
  document.getElementById('td-complete-cb').dataset.taskId = taskId;

  const titleEl = document.getElementById('td-title');
  titleEl.textContent = (task.content || '').split('\n')[0].slice(0, 80) || 'Task';

  const textarea = document.getElementById('td-textarea');
  textarea.value = task.content || '';

  const dueInput = document.getElementById('td-due-date');
  dueInput.value = task.due_date || '';

  const subjectSelect = document.getElementById('td-subject');
  const subjects = settings.task_subjects || [];
  subjectSelect.innerHTML = '<option value="">None</option>' + subjects.map(s => `<option value="${s.replace(/"/g, '&quot;')}">${s.replace(/</g, '&lt;')}</option>`).join('');
  subjectSelect.value = task.priority || '';

  const completedLabel = document.getElementById('td-completed-label');
  if (completedLabel) {
    completedLabel.style.display = task.completed_at ? '' : 'none';
    if (task.completed_at) completedLabel.textContent = 'Completed ' + new Date(task.completed_at).toLocaleDateString();
  }

  // Footer button
  const footerBtn = document.getElementById('td-footer-btn');
  if (task.completed_at) {
    footerBtn.textContent = 'Reopen task';
    footerBtn.style.background = 'var(--surface-alt)';
    footerBtn.style.color = 'var(--text)';
    footerBtn.onclick = async () => {
      await completeTask(taskId, false);
      modal.classList.remove('open');
      toast('Task reopened');
      if (currentView === 'tasks') renderTasksFeed();
      if (tasksOverlayOpen) renderTasksOverlay();
    };
  } else {
    footerBtn.textContent = 'Mark complete';
    footerBtn.style.background = '#22c55e';
    footerBtn.style.color = '#fff';
    footerBtn.onclick = async () => {
      await completeTask(taskId, true);
      modal.classList.remove('open');
      toast('Task completed!');
      if (currentView === 'tasks') renderTasksFeed();
      if (tasksOverlayOpen) renderTasksOverlay();
    };
  }

  // Wire md toolbar
  const toolbar = document.getElementById('td-toolbar');
  if (toolbar && typeof attachMdToolbar === 'function') {
    attachMdToolbar(toolbar, textarea);
  }

  // Live task copy — updated as user changes fields, used to rebuild card on close
  const liveTask = { ...task };

  // Auto-save on blur
  textarea.onblur = async () => {
    const updated = await saveTaskFields(taskId, { content: textarea.value });
    if (updated) {
      liveTask.content = textarea.value;
      const firstLine = (textarea.value || '').split('\n')[0].slice(0, 80);
      if (titleEl) titleEl.textContent = firstLine || 'Task';
    }
  };

  dueInput.onchange = () => {
    liveTask.due_date = dueInput.value || null;
    saveTaskFields(taskId, { due_date: liveTask.due_date });
  };
  subjectSelect.onchange = () => {
    liveTask.priority = subjectSelect.value || null;
    saveTaskFields(taskId, { priority: liveTask.priority });
  };

  const notifDaysInput = document.getElementById('td-notif-days');
  const notifTimeInput = document.getElementById('td-notif-time');
  if (notifDaysInput) notifDaysInput.value = task.notif_days_before != null ? String(task.notif_days_before) : '';
  if (notifTimeInput) notifTimeInput.value = task.notif_time || '';
  const saveNotif = () => {
    liveTask.notif_days_before = notifDaysInput && notifDaysInput.value !== '' ? parseInt(notifDaysInput.value) : null;
    liveTask.notif_time = notifTimeInput && notifTimeInput.value ? notifTimeInput.value : null;
    saveTaskFields(taskId, { notif_days_before: liveTask.notif_days_before, notif_time: liveTask.notif_time });
  };
  if (notifDaysInput) notifDaysInput.onchange = saveNotif;
  if (notifTimeInput) notifTimeInput.onchange = saveNotif;

  // Rebuild the task card and overlay row when the modal closes
  const _obs = new MutationObserver(() => {
    if (!modal.classList.contains('open')) {
      _obs.disconnect();
      const cardEl = document.querySelector('.task-card[data-memo-name="' + taskId + '"]');
      if (cardEl) cardEl.replaceWith(buildTaskCard(liveTask));
      const rowEl = document.querySelector('.task-row[data-task-id="' + taskId + '"]');
      if (rowEl) rowEl.replaceWith(buildTaskRow(liveTask, rowEl.parentElement));
    }
  });
  _obs.observe(modal, { attributes: true, attributeFilter: ['class'] });

  // Tags section
  const tagsEl = document.getElementById('td-tags');
  if (tagsEl) {
    tagsEl.innerHTML = '';
    const tags = Array.isArray(task.tags) ? task.tags : [];
    tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.cssText = 'cursor:pointer;opacity:0.8';
      chip.textContent = t;
      chip.title = 'Remove tag';
      chip.addEventListener('click', async () => {
        const newTags = tags.filter(x => x !== t);
        await saveTaskFields(taskId, { tags: newTags });
        liveTask.tags = newTags;
        chip.remove();
      });
      tagsEl.appendChild(chip);
    });
  }

  // Attachments section
  const attList = document.getElementById('td-attachment-list');
  const tdAttachBtn = document.getElementById('td-attach-btn');
  const tdFileInput = document.getElementById('td-file-input');

  function renderTaskAttachments() {
    if (!attList) return;
    attList.innerHTML = '';
    (liveTask.attachments || []).forEach(att => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;max-width:200px';
      chip.title = att.filename;
      const iconSpan = document.createElement('span');
      iconSpan.textContent = isImageAttachment(att) ? '🖼️' : fileIcon(att.mime_type);
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px';
      nameSpan.textContent = att.filename;
      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--muted);font-size:11px;padding:0;line-height:1;flex-shrink:0';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove';
      delBtn.onclick = async ev => {
        ev.stopPropagation();
        try {
          await apiDelete('/attachments/' + att.id);
          liveTask.attachments = (liveTask.attachments || []).filter(a => a.id !== att.id);
          const idx = allMemos.findIndex(m => m.id === taskId);
          if (idx !== -1) allMemos[idx].attachments = liveTask.attachments;
          renderTaskAttachments();
        } catch(e) { toast('Delete failed: ' + e.message); }
      };
      chip.addEventListener('click', ev => {
        if (ev.target === delBtn) return;
        const url = attachmentUrl(att);
        if (isImageAttachment(att)) {
          getAttachmentBlob(att, url).then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            openLightbox(blobUrl, [blobUrl]);
          }).catch(() => window.open(API_BASE + url));
        } else {
          openFilePreview(att, att.filename, att.mime_type, API_BASE + url);
        }
      });
      chip.appendChild(iconSpan);
      chip.appendChild(nameSpan);
      chip.appendChild(delBtn);
      attList.appendChild(chip);
    });
  }

  renderTaskAttachments();

  if (tdAttachBtn && tdFileInput) {
    tdAttachBtn.onclick = () => tdFileInput.click();
    tdFileInput.value = '';
    tdFileInput.onchange = async e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      for (const file of files) {
        try {
          const result = await uploadAttachment(file, taskId);
          if (result.attachment) {
            if (!liveTask.attachments) liveTask.attachments = [];
            liveTask.attachments = [...liveTask.attachments, result.attachment];
            const idx = allMemos.findIndex(m => m.id === taskId);
            if (idx !== -1) allMemos[idx].attachments = liveTask.attachments;
            renderTaskAttachments();
          }
        } catch(err) { toast('Upload failed: ' + err.message); }
      }
    };
  }

  // Paste files/images into the task textarea
  textarea.onpaste = async e => {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter(i => i.kind === 'file');
    if (fileItems.length === 0) return;
    e.preventDefault();
    for (const item of fileItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const result = await uploadAttachment(file, taskId);
        if (result.attachment) {
          if (!liveTask.attachments) liveTask.attachments = [];
          liveTask.attachments = [...liveTask.attachments, result.attachment];
          const idx = allMemos.findIndex(m => m.id === taskId);
          if (idx !== -1) allMemos[idx].attachments = liveTask.attachments;
          renderTaskAttachments();
        }
      } catch(err) { toast('Upload failed: ' + err.message); }
    }
  };

  modal.classList.add('open');
}

// ── Task Detail modal: "Convert to note" ─────────────────────────────────────
async function convertTaskToNote(taskId) {
  await saveTaskFields(taskId, { is_task: 0, due_date: null, priority: null, completed_at: null, created_at: Math.floor(Date.now() / 1000) });
  const modal = document.getElementById('task-detail-modal');
  if (modal) modal.classList.remove('open');
  toast('Converted to note');
  if (currentView === 'tasks') renderTasksFeed();
  if (tasksOverlayOpen) renderTasksOverlay();
}

// ── Wire overlay quick-add and task-detail complete checkbox ──────────────────
(function wireTasksUI() {
  function tryWire() {
    const qa    = document.getElementById('overlay-quick-add');
    const qaBtn = document.getElementById('overlay-quick-add-btn');
    const tdCb  = document.getElementById('td-complete-cb');
    if (!qa || !qaBtn || !tdCb) { setTimeout(tryWire, 100); return; }

    const doOverlayAdd = () => {
      const text = qa.value.trim();
      if (!text) return;
      qa.value = '';
      const feedEl = document.getElementById('tasks-overlay-feed');
      quickAddTask(text, feedEl);
    };
    qa.addEventListener('keydown', e => { if (e.key === 'Enter') doOverlayAdd(); });
    qaBtn.addEventListener('click', doOverlayAdd);

    tdCb.addEventListener('change', async () => {
      const taskId = tdCb.dataset.taskId;
      if (!taskId) return;
      await completeTask(taskId, tdCb.checked);
      document.getElementById('task-detail-modal').classList.remove('open');
      if (currentView === 'tasks') renderTasksFeed();
      if (tasksOverlayOpen) renderTasksOverlay();
    });
  }
  tryWire();
})();

// ── Auto-refresh tasks when tab becomes visible ───────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && typeof currentView !== 'undefined' && currentView === 'tasks') {
    renderTasksFeed();
  }
});

// ── Init overlay swipe-to-dismiss ─────────────────────────────────────────────
(function initTasksOverlayGestures() {
  let startY = 0, isDragging = false;
  const getOverlay = () => document.getElementById('tasks-overlay');

  document.addEventListener('touchstart', e => {
    const overlay = getOverlay();
    if (!overlay || !overlay.classList.contains('open')) return;
    if (!overlay.contains(e.target)) return;
    startY = e.touches[0].clientY;
    isDragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    const overlay = getOverlay();
    if (!overlay || !overlay.classList.contains('open')) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10) { isDragging = true; overlay.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    const overlay = getOverlay();
    if (!overlay || !isDragging) return;
    const current = parseFloat(overlay.style.transform.replace('translateY(', '')) || 0;
    if (current > 80) {
      overlay.style.transform = '';
      closeTasksOverlay();
    } else {
      overlay.style.transform = '';
    }
    isDragging = false;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('task-detail-modal');
      if (modal && modal.classList.contains('open')) { modal.classList.remove('open'); return; }
      if (tasksOverlayOpen) closeTasksOverlay();
    }
  });
})();
