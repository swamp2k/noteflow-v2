// ── Tasks module ──────────────────────────────────────────────────────────────
// Globals: renderTasksFeed, openTasksOverlay, closeTasksOverlay,
//          renderTasksOverlay, openTaskDetail, saveTaskFields,
//          quickAddTask, completeTask, buildTaskCard

// Priority configuration
const PRIORITY_COLORS = { 1: '#ef4444', 2: '#f59e0b', 3: '#22c55e', null: '#9ca3af' };
const PRIORITY_LABELS = { 1: 'High', 2: 'Medium', 3: 'Low', null: 'None' };

function priorityDot(priority) {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS[null];
  const d = document.createElement('span');
  d.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;margin-right:6px`;
  d.title = 'Priority: ' + (PRIORITY_LABELS[priority] || 'None');
  return d;
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

function dueDateChip(due_date) {
  if (!due_date) return null;
  const chip = document.createElement('span');
  const overdue = isOverdue(due_date);
  const today = isDueToday(due_date);
  chip.style.cssText = `font-size:11px;padding:2px 7px;border-radius:10px;font-weight:${overdue ? '700' : '400'};` +
    `background:${overdue ? '#fde8e8' : today ? '#fef3c7' : 'var(--surface-alt)'};` +
    `color:${overdue ? '#ef4444' : today ? '#d97706' : 'var(--muted)'};white-space:nowrap;flex-shrink:0`;
  chip.textContent = overdue ? 'Overdue · ' + due_date : due_date;
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
  const priority = settings.tasks_default_priority || null;

  // Optimistic prepend — track the row so we can roll back on failure
  const optimisticRow = buildTaskRow({ id: '_opt_' + Date.now(), content, is_task: 1, due_date: null, priority, completed_at: null }, feedEl);
  optimisticRow.style.opacity = '0.6';
  if (feedEl.firstChild && feedEl.firstChild.classList && feedEl.firstChild.classList.contains('tasks-sort-bar')) {
    feedEl.firstChild.after(optimisticRow);
  } else {
    feedEl.prepend(optimisticRow);
  }

  try {
    const result = await apiPost('/notes', { content, is_task: 1, priority });
    optimisticRow.replaceWith(buildTaskRow(result.note, feedEl));
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
  row.appendChild(priorityDot(task.priority));

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

  // Header row: checkbox + priority dot + date chip
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
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    } else {
      cb.checked = !done;
      card.style.opacity = '1';
    }
  });
  header.appendChild(cb);
  header.appendChild(priorityDot(task.priority));

  const chip = dueDateChip(task.due_date);
  if (chip) { chip.style.marginLeft = 'auto'; header.appendChild(chip); }

  card.appendChild(header);

  // Content
  const contentWrap = document.createElement('div');
  contentWrap.className = 'card-content-wrap';
  const contentEl = document.createElement('div');
  contentEl.className = 'card-content';
  if (task.completed_at) contentEl.style.cssText = 'text-decoration:line-through;opacity:0.6';
  contentEl.innerHTML = marked.parse(task.content || '');
  contentWrap.appendChild(contentEl);
  card.appendChild(contentWrap);

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

  // Action row: Edit, Archive
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'card-action-btn';
  editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit';
  editBtn.title = 'Edit task';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openTaskDetail(task.id); });
  actions.appendChild(editBtn);

  const archBtn = document.createElement('button');
  archBtn.className = 'card-action-btn';
  archBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> Archive';
  archBtn.title = 'Archive task';
  archBtn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      await apiPatch('/notes/' + task.id, { archived: true });
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
      toast('Task archived');
    } catch(e) { toast('Error: ' + e.message); }
  });
  actions.appendChild(archBtn);

  card.appendChild(actions);

  card.addEventListener('click', e => {
    if (e.target.closest('.card-action-btn') || e.target === cb) return;
    openTaskDetail(task.id);
  });

  return card;
}

// ── renderTasksFeed ───────────────────────────────────────────────────────────
async function renderTasksFeed() {
  const feed = document.getElementById('feed');
  feed.innerHTML = '<div class="empty-state" style="padding:40px 20px">Loading tasks…</div>';

  // Sort controls bar
  const sortBar = document.createElement('div');
  sortBar.className = 'tasks-sort-bar';
  sortBar.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap';
  [['priority','Priority'],['due_date','Due Date'],['created','Newest']].forEach(([val,label]) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:5px 12px;border-radius:16px;font-size:12px;font-family:var(--font-body);cursor:pointer;border:1px solid var(--border);transition:all 0.15s;background:' + (taskSortOrder===val?'var(--accent)':'var(--surface)') + ';color:' + (taskSortOrder===val?'var(--bg)':'var(--text)');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      taskSortOrder = val;
      try { localStorage.setItem('noteflow_task_sort', val); } catch {}
      renderTasksFeed();
    });
    sortBar.appendChild(btn);
  });

  // Quick add row
  const qaRow = document.createElement('div');
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
  feed.appendChild(sortBar);
  feed.appendChild(qaRow);

  try {
    const sortParam = taskSortOrder === 'due_date' ? 'due_date' : taskSortOrder === 'created' ? 'created' : 'priority';
    const data = await apiGet('/notes?is_task=1&sort=' + sortParam + '&pageSize=100');
    const tasks = data.notes || [];

    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '40px 20px';
      empty.textContent = 'No active tasks. Add one above!';
      feed.appendChild(empty);
    } else {
      tasks.forEach(task => feed.appendChild(buildTaskCard(task)));
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
          const cdata = await apiGet('/notes?is_task=1&completed=1&sort=' + sortParam + '&pageSize=100');
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
              // Add reopen button for completed tasks
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
    feed.innerHTML = '<div class="empty-state">Failed to load tasks</div>';
    toast('Failed to load tasks: ' + e.message);
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
    const sortParam = taskSortOrder === 'due_date' ? 'due_date' : taskSortOrder === 'created' ? 'created' : 'priority';
    const data = await apiGet('/notes?is_task=1&sort=' + sortParam + '&pageSize=100');
    const tasks = data.notes || [];
    feedEl.innerHTML = '';

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
    feedEl.innerHTML = '<div style="padding:20px;color:var(--danger);font-size:13px">Failed to load tasks</div>';
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

  const prioSelect = document.getElementById('td-priority');
  prioSelect.value = task.priority != null ? String(task.priority) : '';

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

  // Auto-save on blur
  textarea.onblur = async () => {
    const updated = await saveTaskFields(taskId, { content: textarea.value });
    if (updated) {
      const firstLine = (textarea.value || '').split('\n')[0].slice(0, 80);
      if (titleEl) titleEl.textContent = firstLine || 'Task';
    }
  };

  dueInput.onchange = () => saveTaskFields(taskId, { due_date: dueInput.value || null });
  prioSelect.onchange = () => saveTaskFields(taskId, { priority: prioSelect.value !== '' ? parseInt(prioSelect.value) : null });

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
        chip.remove();
      });
      tagsEl.appendChild(chip);
    });
  }

  modal.classList.add('open');
}

// ── Task Detail modal: "Convert to note" ─────────────────────────────────────
async function convertTaskToNote(taskId) {
  await saveTaskFields(taskId, { is_task: 0, due_date: null, priority: null, completed_at: null });
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
