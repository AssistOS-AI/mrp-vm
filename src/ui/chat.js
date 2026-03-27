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

  let sessionId = null;

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
  }

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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

  function buildContextHtml(group) {
    const items = [];
    for (const u of group.currentTurnContext || []) items.push(esc(u.claim || u.procedure || u.id));
    for (const s of group.sessionSources || []) items.push(esc(s.unit?.claim || s.unit?.procedure || s.unitId));
    for (const s of group.kbSources || []) items.push(esc(s.unit?.claim || s.unit?.procedure || s.unitId));
    if (!items.length) return '<em>none</em>';
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  }

  function renderResponseTable(doc) {
    const statusClass = s => `status-badge status-${s}`;
    let html = '<table><colgroup><col class="col-act"><col class="col-intent"><col class="col-context"><col class="col-answer"></colgroup>';
    html += '<thead><tr><th>Act</th><th>Intent</th><th>Context</th><th>Answer</th></tr></thead><tbody>';
    for (const g of doc.groups) {
      const answer = g.answerMarkdown ? renderMarkdown(g.answerMarkdown) : '<em>—</em>';
      html += `<tr>`;
      html += `<td class="cell-act">${esc(g.act)}<br><span class="${statusClass(g.status)}">${g.status}</span></td>`;
      html += `<td>${esc(g.intent)}</td>`;
      html += `<td class="cell-context">${buildContextHtml(g)}</td>`;
      html += `<td class="cell-answer">${answer}</td>`;
      html += `</tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  function addMessage(role, content, responseDoc) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'assistant' && responseDoc?.groups?.length) {
      div.innerHTML = renderResponseTable(responseDoc);
    } else if (role === 'assistant') {
      div.innerHTML = `<div class="fallback-md">${renderMarkdown(content)}</div>`;
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
    sendMessage(text);
  });

  async function sendMessage(text) {
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
        if (data.error.code === 'SESSION_EXPIRED') { sessionId = null; updateBadge(); return sendMessage(text); }
        showError(data.error.message || 'Error');
        return;
      }
      sessionId = data.session_id || sessionId;
      updateBadge();
      addMessage('assistant', data.choices?.[0]?.message?.content || '(empty response)', data.response_document);
    } catch (err) {
      loading.classList.add('hidden');
      showError(err.message);
    }
  }

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
