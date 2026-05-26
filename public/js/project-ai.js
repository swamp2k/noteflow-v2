function initProjectAI() {
  document.getElementById('project-ai-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('project-ai-body');
    const chevron = document.getElementById('project-ai-chevron');
    const isOpen = body.classList.toggle('open');
    if (chevron) chevron.textContent = isOpen ? '▲' : '▼';
  });

  document.getElementById('project-ai-send')?.addEventListener('click', () => {
    const input = document.getElementById('project-ai-input');
    sendProjectAI(input?.value || '');
  });

  document.getElementById('project-ai-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendProjectAI(document.getElementById('project-ai-input')?.value || '');
    }
  });

  document.getElementById('project-ai-input')?.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  document.querySelectorAll('.project-ai-quick button').forEach(btn => {
    btn.addEventListener('click', () => sendProjectAI(btn.dataset.prompt || ''));
  });
}

function updateProjectAIVisibility() {
  const panel = document.getElementById('project-ai-panel');
  if (!panel) return;
  const isProject = currentView === 'tag' && currentTag && currentTag.startsWith('project:');
  panel.classList.toggle('visible', !!isProject);
}

async function loadProjectConversation(tag) {
  const msgs = document.getElementById('project-ai-messages');
  if (!msgs) return;
  msgs.innerHTML = '';
  // Reset panel to collapsed state for fresh project
  const body = document.getElementById('project-ai-body');
  const chevron = document.getElementById('project-ai-chevron');
  body?.classList.remove('open');
  if (chevron) chevron.textContent = '▼';
  try {
    const data = await apiGet('/projects/ai/conversation?tag=' + encodeURIComponent(tag));
    (data.conversation || []).forEach(msg => addProjectAIMessage(msg.role, msg.content));
    if (msgs.children.length > 0) {
      msgs.scrollTop = msgs.scrollHeight;
      body?.classList.add('open');
      if (chevron) chevron.textContent = '▲';
    }
  } catch(e) {
    console.error('[project-ai] load:', e);
  }
}

async function sendProjectAI(message) {
  if (!message.trim() || !currentTag) return;
  const input = document.getElementById('project-ai-input');
  const sendBtn = document.getElementById('project-ai-send');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  if (sendBtn) sendBtn.disabled = true;

  // Open panel if collapsed
  document.getElementById('project-ai-body')?.classList.add('open');
  const chevron = document.getElementById('project-ai-chevron');
  if (chevron) chevron.textContent = '▲';

  addProjectAIMessage('user', message.trim());
  const thinkingEl = addProjectAIMessage('thinking', 'Thinking…');

  try {
    const data = await apiPost('/projects/ai', { tag: currentTag, message: message.trim() });
    thinkingEl?.remove();
    addProjectAIMessage('assistant', data.reply || '');
  } catch(e) {
    thinkingEl?.remove();
    addProjectAIMessage('assistant', 'Sorry, something went wrong. Please try again.');
    console.error('[project-ai] send:', e);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

function addProjectAIMessage(role, content) {
  const msgs = document.getElementById('project-ai-messages');
  if (!msgs) return null;
  const el = document.createElement('div');
  el.className = 'ai-msg ' + role;
  if (role === 'assistant' && typeof marked !== 'undefined') {
    el.innerHTML = marked.parse(content);
  } else {
    el.textContent = content;
  }
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}
