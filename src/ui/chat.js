// DS014 — Chat UI logic
(function() {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const messagesEl = $('#messages');
  const input = $('#user-input');
  const form = $('#chat-form');
  const loading = $('#loading');
  const errorBar = $('#error-bar');
  const badge = $('#session-badge');
  const kbBadge = $('#kb-badge');
  const workspaceBadge = $('#workspace-badge');
  const plannerSelect = $('#planner-select');
  const seedSelect = $('#seed-select');
  const kbPluginSelect = $('#kb-plugin-select');
  const goalSelect = $('#goal-select');
  const settingsPanel = $('#settings-panel');
  const settingsToggle = $('#settings-toggle');
  const saveSettingsBtn = $('#save-settings-btn');
  const roleSelects = $$('#settings-panel select[data-role]');
  const kbSelect = $('#kb-select');
  const fileInput = $('#file-input');
  const loadKbBtn = $('#load-kb-btn');
  const forkKbBtn = $('#fork-kb-btn');
  const saveKbBtn = $('#save-kb-btn');

  let sessionId = null;
  let workspaceState = null;

  function esc(value) {
    return (value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function savePrefs() {
    localStorage.setItem('mrp_planner', plannerSelect.value);
    localStorage.setItem('mrp_seed', seedSelect.value);
    localStorage.setItem('mrp_kb_plugin', kbPluginSelect.value);
    localStorage.setItem('mrp_goal', goalSelect.value);
    localStorage.setItem('mrp_kb', kbSelect.value);
  }

  function loadPrefs() {
    const planner = localStorage.getItem('mrp_planner');
    const seed = localStorage.getItem('mrp_seed');
    const kbPlugin = localStorage.getItem('mrp_kb_plugin');
    const goal = localStorage.getItem('mrp_goal');
    const kb = localStorage.getItem('mrp_kb');
    if (planner) plannerSelect.value = planner;
    if (seed) seedSelect.value = seed;
    if (kbPlugin) kbPluginSelect.value = kbPlugin;
    if (goal) goalSelect.value = goal;
    if (kb && [...kbSelect.options].some(option => option.value === kb)) kbSelect.value = kb;
  }

  function showLoading(message) {
    loading.textContent = message || 'Processing...';
    loading.classList.remove('hidden');
  }

  function hideLoading() {
    loading.textContent = 'Processing...';
    loading.classList.add('hidden');
  }

  function showError(message) {
    errorBar.textContent = message;
    errorBar.classList.remove('hidden');
    setTimeout(() => errorBar.classList.add('hidden'), 8000);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 204) return {};
    return response.json();
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

  function buildContextHtml(group) {
    const items = [];
    for (const unit of group.currentTurnContext || []) items.push(esc(unit.claim || unit.procedure || unit.id));
    for (const source of group.sessionSources || []) items.push(esc(source.unit?.claim || source.unit?.procedure || source.unitId));
    for (const source of group.kbSources || []) items.push(esc(source.unit?.claim || source.unit?.procedure || source.unitId));
    if (!items.length) return '<em>none</em>';
    return '<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>';
  }

  function renderResponseTable(doc) {
    const statusClass = status => `status-badge status-${status}`;
    let html = '<table><colgroup><col class="col-act"><col class="col-intent"><col class="col-context"><col class="col-answer"></colgroup>';
    html += '<thead><tr><th>Act</th><th>Intent</th><th>Context</th><th>Answer</th></tr></thead><tbody>';
    for (const group of doc.groups) {
      const answer = group.answerMarkdown ? renderMarkdown(group.answerMarkdown) : '<em>-</em>';
      html += '<tr>';
      html += `<td class="cell-act">${esc(group.act)}<br><span class="${statusClass(group.status)}">${group.status}</span></td>`;
      html += `<td>${esc(group.intent)}</td>`;
      html += `<td class="cell-context">${buildContextHtml(group)}</td>`;
      html += `<td class="cell-answer">${answer}</td>`;
      html += '</tr>';
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

  function updateBadges() {
    badge.textContent = sessionId ? `Session: ${sessionId}` : 'No session';
    const kbName = workspaceState?.kbName || kbSelect.options[kbSelect.selectedIndex]?.textContent || 'none';
    kbBadge.textContent = `KB: ${kbName}`;
    if (!sessionId) {
      workspaceBadge.textContent = 'Draft: none';
      return;
    }
    const draftState = workspaceState?.dirty ? 'unsaved' : 'saved';
    const sourceCount = workspaceState?.sourceCount || 0;
    workspaceBadge.textContent = `Draft: ${draftState} (${sourceCount} sources)`;
  }

  function optionHtml(items, withAuto = true) {
    const prefix = withAuto ? '<option value="">auto</option>' : '';
    return prefix + items.map(item => `<option value="${item.id}">${esc(item.id)}</option>`).join('');
  }

  function applySessionMeta(meta) {
    if (!meta) return;
    sessionId = meta.session_id || sessionId;
    workspaceState = workspaceState || {};
    workspaceState.kbId = meta.kb_id || workspaceState.kbId || kbSelect.value;
    workspaceState.kbName = meta.kb_name || workspaceState.kbName || workspaceState.kbId;
    workspaceState.dirty = !!meta.workspace_dirty;
    workspaceState.sourceCount = meta.workspace_source_count ?? workspaceState.sourceCount ?? 0;
    workspaceState.unitCount = meta.workspace_unit_count ?? workspaceState.unitCount ?? 0;
    workspaceState.lastSavedAt = meta.workspace_last_saved_at || workspaceState.lastSavedAt || null;
    if (workspaceState.kbId && [...kbSelect.options].some(option => option.value === workspaceState.kbId)) {
      kbSelect.value = workspaceState.kbId;
    }
    updateBadges();
  }

  function buildRequestConfig(body) {
    if (plannerSelect.value) body.planner_plugin = plannerSelect.value;
    if (seedSelect.value) body.seed_detector_plugin = seedSelect.value;
    if (kbPluginSelect.value) body.kb_plugin = kbPluginSelect.value;
    if (goalSelect.value) body.goal_solver_plugin = goalSelect.value;
    if (kbSelect.value) body.kb_id = kbSelect.value;
  }

  async function loadKbList(selectedKbId = null) {
    const data = await fetchJson('/kbs');
    const current = selectedKbId || kbSelect.value || localStorage.getItem('mrp_kb') || '';
    kbSelect.innerHTML = (data.kbs || []).map(kb => {
      const label = `${kb.name} (${kb.kbId})`;
      return `<option value="${kb.kbId}">${esc(label)}</option>`;
    }).join('');
    if (current && [...kbSelect.options].some(option => option.value === current)) kbSelect.value = current;
    savePrefs();
  }

  async function refreshWorkspace() {
    if (!sessionId) {
      workspaceState = null;
      updateBadges();
      return null;
    }
    const data = await fetchJson(`/sessions/${sessionId}/workspace`);
    if (data.error) {
      if (data.error.code === 'SESSION_EXPIRED') {
        sessionId = null;
        workspaceState = null;
        updateBadges();
        return null;
      }
      throw new Error(data.error.message || 'Failed to load workspace');
    }
    workspaceState = {
      kbId: data.kb_id,
      kbName: data.kb_name,
      dirty: !!data.workspace?.dirty,
      sourceCount: data.workspace?.sourceCount || 0,
      unitCount: data.workspace?.unitCount || 0,
      lastSavedAt: data.workspace?.lastSavedAt || null,
      sources: data.workspace?.sources || []
    };
    if (workspaceState.kbId && [...kbSelect.options].some(option => option.value === workspaceState.kbId)) {
      kbSelect.value = workspaceState.kbId;
    }
    updateBadges();
    return data;
  }

  async function refreshSessionState() {
    if (!sessionId) {
      workspaceState = null;
      updateBadges();
      return null;
    }
    const meta = await fetchJson(`/sessions/${sessionId}`);
    if (meta.error) {
      if (meta.error.code === 'SESSION_EXPIRED') {
        sessionId = null;
        workspaceState = null;
        updateBadges();
        return null;
      }
      throw new Error(meta.error.message || 'Failed to load session');
    }
    applySessionMeta(meta);
    await refreshWorkspace();
    return meta;
  }

  async function ensureSession() {
    if (sessionId) {
      await refreshSessionState();
      return sessionId;
    }
    const body = {};
    buildRequestConfig(body);
    const data = await fetchJson('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (data.error) throw new Error(data.error.message || 'Failed to create session');
    applySessionMeta(data);
    await refreshWorkspace();
    return sessionId;
  }

  function populateRoleSelects(settings) {
    const models = settings.availableModels || [];
    const modelOptions = '<option value="">auto</option>' + models.map(model => (
      `<option value="${model.id}">${esc(model.id)}</option>`
    )).join('');
    for (const select of roleSelects) {
      const role = select.dataset.role;
      select.innerHTML = modelOptions;
      const assigned = settings.roles?.[role]?.model || '';
      select.value = assigned;
    }
  }

  async function saveRoleSettings() {
    const roles = {};
    for (const select of roleSelects) {
      roles[select.dataset.role] = { model: select.value || '' };
    }
    showLoading('Saving settings...');
    try {
      const data = await fetchJson('/settings/llm-roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles })
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to save settings');
      populateRoleSelects(data);
      addMessage('assistant', 'Saved shared LLM role settings.');
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  async function loadConfig() {
    try {
      const [plugins, settings] = await Promise.all([
        fetchJson('/plugins'),
        fetchJson('/settings/llm-roles')
      ]);
      const list = plugins.plugins || [];
      plannerSelect.innerHTML = optionHtml(list.filter(plugin => plugin.type === 'mrp-plan-plugin'));
      seedSelect.innerHTML = optionHtml(list.filter(plugin => plugin.type === 'sd-plugin'));
      kbPluginSelect.innerHTML = optionHtml(list.filter(plugin => plugin.type === 'kb-plugin'));
      goalSelect.innerHTML = optionHtml(list.filter(plugin => plugin.type === 'gs-plugin'));
      populateRoleSelects(settings);
      await loadKbList();
      loadPrefs();
      updateBadges();
    } catch (error) {
      showError(error.message || 'Failed to load UI configuration');
    }
  }

  async function sendMessage(text) {
    showLoading('Processing...');
    errorBar.classList.add('hidden');
    const body = {
      messages: [{ role: 'user', content: text }],
      stream: false
    };
    if (sessionId) body.session_id = sessionId;
    buildRequestConfig(body);
    try {
      const data = await fetchJson('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      hideLoading();
      if (data.error) {
        if (data.error.code === 'SESSION_EXPIRED') {
          sessionId = null;
          workspaceState = null;
          updateBadges();
          return sendMessage(text);
        }
        showError(data.error.message || 'Error');
        return;
      }
      sessionId = data.session_id || sessionId;
      await refreshSessionState();
      addMessage('assistant', data.choices?.[0]?.message?.content || '(empty response)', data.response_document);
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  async function mountSelectedKb() {
    if (!kbSelect.value) return;
    await ensureSession();
    if (workspaceState?.kbId === kbSelect.value) return;
    if (workspaceState?.dirty) {
      const discard = window.confirm(`Mounting KB "${kbSelect.value}" will discard the current unsaved draft for "${workspaceState.kbName || workspaceState.kbId}". Continue?`);
      if (!discard) return;
    }
    showLoading('Loading KB...');
    try {
      const data = await fetchJson(`/sessions/${sessionId}/kb/mount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kb_id: kbSelect.value, discard_draft: true })
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to mount KB');
      await refreshSessionState();
      addMessage('assistant', `Mounted KB "${workspaceState.kbName || kbSelect.value}" for the current session.`);
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  async function forkCurrentKb() {
    await ensureSession();
    const proposedName = `${workspaceState?.kbName || kbSelect.value || 'kb'}-fork`;
    const name = window.prompt('New KB name for the fork:', proposedName);
    if (!name) return false;
    showLoading('Forking KB...');
    try {
      const data = await fetchJson(`/sessions/${sessionId}/kb/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to fork KB');
      await loadKbList(data.kb_id);
      applySessionMeta(data);
      await refreshWorkspace();
      addMessage('assistant', `Forked the current draft into KB "${workspaceState.kbName || data.kb_id}" and mounted it in this session.`);
      return true;
    } catch (error) {
      hideLoading();
      showError(error.message);
      return false;
    }
  }

  async function saveCurrentKb() {
    await ensureSession();
    let payload = {};
    if (workspaceState?.kbId) {
      const overwrite = window.confirm(`Save the current draft into mounted KB "${workspaceState.kbName || workspaceState.kbId}"? Press Cancel to save it as a new fork instead.`);
      if (!overwrite) {
        const name = window.prompt('New KB name:', `${workspaceState.kbName || workspaceState.kbId}-fork`);
        if (!name) return;
        payload = { fork: true, name };
      }
    }
    showLoading('Saving KB...');
    try {
      const data = await fetchJson(`/sessions/${sessionId}/kb/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to save KB');
      await loadKbList(data.kb_id);
      applySessionMeta(data);
      await refreshWorkspace();
      addMessage('assistant', `Saved the current session draft into KB "${workspaceState.kbName || data.kb_id}".`);
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  async function stageFileInWorkspace(file, content) {
    await ensureSession();
    const useCurrentDraft = window.confirm(`Add "${file.name}" to the current session draft for KB "${workspaceState?.kbName || workspaceState?.kbId || kbSelect.value}"? Press Cancel to fork the KB first and stage the file on the fork.`);
    if (!useCurrentDraft) {
      const forked = await forkCurrentKb();
      if (!forked) return;
    }
    showLoading('Staging file in draft...');
    try {
      const body = {
        name: file.name,
        content
      };
      if (seedSelect.value) body.seed_detector_plugin = seedSelect.value;
      const data = await fetchJson(`/sessions/${sessionId}/workspace/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to stage file');
      await refreshWorkspace();
      addMessage('assistant', `Staged "${file.name}" in the current draft for KB "${workspaceState.kbName || workspaceState.kbId}". Nothing was saved to the persistent KB yet.`);
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  plannerSelect.addEventListener('change', savePrefs);
  seedSelect.addEventListener('change', savePrefs);
  kbPluginSelect.addEventListener('change', savePrefs);
  goalSelect.addEventListener('change', savePrefs);
  kbSelect.addEventListener('change', savePrefs);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    await sendMessage(text);
  });

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.ctrlKey) return;
    event.preventDefault();
    form.requestSubmit();
  });

  $('#new-session-btn').addEventListener('click', () => {
    sessionId = null;
    workspaceState = null;
    messagesEl.innerHTML = '';
    updateBadges();
  });

  $('#reset-config').addEventListener('click', () => {
    localStorage.removeItem('mrp_planner');
    localStorage.removeItem('mrp_seed');
    localStorage.removeItem('mrp_kb_plugin');
    localStorage.removeItem('mrp_goal');
    localStorage.removeItem('mrp_kb');
    loadConfig();
  });

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  saveSettingsBtn.addEventListener('click', () => saveRoleSettings());
  loadKbBtn.addEventListener('click', () => mountSelectedKb());
  forkKbBtn.addEventListener('click', () => forkCurrentKb());
  saveKbBtn.addEventListener('click', () => saveCurrentKb());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
      showError('Only .md and .txt files accepted');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await stageFileInWorkspace(file, reader.result);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  updateBadges();
  loadConfig();
})();
