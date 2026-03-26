// DS014 — Chat UI logic
(function() {
  const $ = s => document.querySelector(s);
  const messagesEl = $('#messages');
  const input = $('#user-input');
  const form = $('#chat-form');
  const loading = $('#loading');
  const errorBar = $('#error-bar');
  const badge = $('#session-badge');
  const modeSelect = $('#mode-select');
  const profileSelect = $('#profile-select');
  const modelSelect = $('#model-select');
  const fileInput = $('#file-input');

  let sessionId = localStorage.getItem('mrp_session_id') || null;

  function savePrefs() {
    localStorage.setItem('mrp_mode', modeSelect.value);
    localStorage.setItem('mrp_profile', profileSelect.value);
    localStorage.setItem('mrp_model', modelSelect.value);
  }
  function loadPrefs() {
    const m = localStorage.getItem('mrp_mode'); if (m) modeSelect.value = m;
    const p = localStorage.getItem('mrp_profile'); if (p) profileSelect.value = p;
    const mo = localStorage.getItem('mrp_model'); if (mo) modelSelect.value = mo;
  }

  function updateBadge() {
    badge.textContent = sessionId ? `Session: ${sessionId}` : 'No session';
    if (sessionId) localStorage.setItem('mrp_session_id', sessionId);
    else localStorage.removeItem('mrp_session_id');
  }

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'assistant') {
      const html = renderMarkdown(content);
      const PREVIEW_LINES = 6;
      const lines = content.split('\n');
      if (lines.length > PREVIEW_LINES + 2) {
        const previewHtml = renderMarkdown(lines.slice(0, PREVIEW_LINES).join('\n'));
        const fullHtml = html;
        const preview = document.createElement('div');
        preview.className = 'msg-preview';
        preview.innerHTML = previewHtml;
        const full = document.createElement('div');
        full.className = 'msg-full hidden';
        full.innerHTML = fullHtml;
        const toggle = document.createElement('button');
        toggle.className = 'toggle-btn';
        toggle.textContent = 'View more';
        toggle.addEventListener('click', () => {
          const expanded = full.classList.toggle('hidden');
          preview.classList.toggle('hidden', !expanded);
          toggle.textContent = expanded ? 'View more' : 'View less';
        });
        div.appendChild(preview);
        div.appendChild(full);
        div.appendChild(toggle);
      } else {
        div.innerHTML = html;
      }
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderMarkdown(md) {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^#### (.+)$/gm, '<h5>$1</h5>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function showError(msg) { errorBar.textContent = msg; errorBar.classList.remove('hidden'); setTimeout(() => errorBar.classList.add('hidden'), 8000); }

  async function loadConfig() {
    try {
      const [strats, profiles, models] = await Promise.all([
        fetch('/v1/processing-strategies').then(r => r.json()),
        fetch('/v1/retrieval-profiles').then(r => r.json()),
        fetch('/v1/models').then(r => r.json())
      ]);
      modeSelect.innerHTML = (strats.strategies || []).map(s => `<option value="${s.id}">${s.id}</option>`).join('');
      profileSelect.innerHTML = (profiles.profiles || []).map(p => `<option value="${p.id}">${p.id}</option>`).join('');
      modelSelect.innerHTML = '<option value="">auto</option>' + (models.models || []).map(m => `<option value="${m.id}">${m.id}</option>`).join('');
      loadPrefs();
      updateModelState();
    } catch { /* ignore on load */ }
  }

  function updateModelState() {
    modelSelect.disabled = modeSelect.value === 'symbolic-only';
  }
  modeSelect.addEventListener('change', () => { updateModelState(); savePrefs(); });
  profileSelect.addEventListener('change', savePrefs);
  modelSelect.addEventListener('change', savePrefs);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    loading.classList.remove('hidden');
    errorBar.classList.add('hidden');
    const body = { messages: [{ role: 'user', content: text }], stream: false };
    if (sessionId) body.session_id = sessionId;
    if (modeSelect.value) body.processing_mode = modeSelect.value;
    if (profileSelect.value) body.retrieval_profile = profileSelect.value;
    if (modelSelect.value && modeSelect.value !== 'symbolic-only') body.model = modelSelect.value;
    try {
      const res = await fetch('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      loading.classList.add('hidden');
      if (data.error) {
        if (data.error.code === 'SESSION_EXPIRED') { sessionId = null; updateBadge(); showError('Session expired. Please start a new session.'); return; }
        showError(data.error.message || 'Error');
        return;
      }
      sessionId = data.session_id || sessionId;
      updateBadge();
      addMessage('assistant', data.choices?.[0]?.message?.content || '(empty response)');
    } catch (err) {
      loading.classList.add('hidden');
      showError(err.message);
    }
  });

  $('#new-session-btn').addEventListener('click', () => { sessionId = null; updateBadge(); messagesEl.innerHTML = ''; });

  $('#reset-config').addEventListener('click', () => {
    localStorage.removeItem('mrp_mode'); localStorage.removeItem('mrp_profile'); localStorage.removeItem('mrp_model');
    loadConfig();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) { showError('Only .md and .txt files accepted'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      loading.classList.remove('hidden');
      loading.textContent = 'Uploading…';
      try {
        const res = await fetch('/v1/kb/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content: reader.result }) });
        const data = await res.json();
        loading.classList.add('hidden');
        loading.textContent = 'Processing…';
        if (data.error) { showError(data.error.message); return; }
        addMessage('assistant', `✅ Source "${data.name || file.name}" ingested (${data.unitCount} units).`);
      } catch (err) { loading.classList.add('hidden'); loading.textContent = 'Processing…'; showError(err.message); }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  updateBadge();
  loadConfig();
})();
