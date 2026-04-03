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
  const thinkingPanel = $('#thinking-panel');
  const thinkingText = $('#thinking-text');
  const plannerSelect = $('#planner-select');
  const seedSelect = $('#seed-select');
  const kbPluginSelect = $('#kb-plugin-select');
  const goalSelect = $('#goal-select');
  const deliberationSelect = $('#deliberation-select');
  const settingsPanel = $('#settings-panel');
  const settingsToggle = $('#settings-toggle');
  const explainabilityBtn = $('#explainability-btn');
  const saveSettingsBtn = $('#save-settings-btn');
  const roleSelects = $$('#settings-panel select[data-role]');
  const kbSelect = $('#kb-select');
  const fileInput = $('#file-input');
  const newKbBtn = $('#new-kb-btn');
  const loadKbBtn = $('#load-kb-btn');
  const forkKbBtn = $('#fork-kb-btn');
  const saveKbBtn = $('#save-kb-btn');

  function normalizeSessionId(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
    return normalized;
  }

  let sessionId = normalizeSessionId(sessionStorage.getItem('mrp_sessionId'));
  let workspaceState = null;
  let explainabilityCache = { sessionId: null, turns: [] };

  function persistSessionId() {
    sessionId = normalizeSessionId(sessionId);
    if (sessionId) sessionStorage.setItem('mrp_sessionId', sessionId);
    else sessionStorage.removeItem('mrp_sessionId');
  }

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
    localStorage.setItem('mrp_deliberation', deliberationSelect.value);
    localStorage.setItem('mrp_kb', kbSelect.value);
  }

  function loadPrefs() {
    const planner = localStorage.getItem('mrp_planner');
    const seed = localStorage.getItem('mrp_seed');
    const kbPlugin = localStorage.getItem('mrp_kb_plugin');
    const goal = localStorage.getItem('mrp_goal');
    const deliberation = localStorage.getItem('mrp_deliberation');
    const kb = localStorage.getItem('mrp_kb');
    if (planner) plannerSelect.value = planner;
    if (seed) seedSelect.value = seed;
    if (kbPlugin) kbPluginSelect.value = kbPlugin;
    if (goal) goalSelect.value = goal;
    if (deliberation) deliberationSelect.value = deliberation;
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

  function showThinking(message) {
    thinkingText.textContent = message || '';
    thinkingPanel.classList.remove('hidden');
  }

  function updateThinking(message) {
    if (!message) return;
    thinkingText.textContent = message;
    thinkingPanel.classList.remove('hidden');
  }

  function clearThinking() {
    thinkingText.textContent = '';
    thinkingPanel.classList.add('hidden');
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 204) return {};
    return response.json();
  }

  async function streamEvents(url, options, handlers = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const payload = contentType.includes('application/json')
        ? await response.json()
        : { error: { message: await response.text() } };
      throw new Error(payload.error?.message || `Request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatchEvent = (rawEvent) => {
      const lines = rawEvent.split('\n');
      let eventName = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) return;
      const parsed = JSON.parse(data);
      const handler = handlers[eventName];
      if (handler) handler(parsed);
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (rawEvent) dispatchEvent(rawEvent);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
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

  function stageLabel(stage) {
    const labels = {
      planner: 'Planner',
      'seed-detector': 'Seed',
      decompose: 'Decompose',
      kb: 'KB',
      'goal-solver': 'Goal',
      validation: 'Validation',
      frame: 'Frame',
      seed: 'Seed',
      plugin: 'Plugin',
      branch: 'Branch',
      result: 'Result',
      failure: 'Failure',
      policy: 'Policy',
      candidate: 'Candidate',
      comparison: 'Comparison',
      challenge: 'Challenge'
    };
    return labels[stage] || stage || 'stage';
  }

  function statusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success' || normalized === 'accepted' || normalized === 'answered' || normalized === 'succeeded' || normalized === 'settled' || normalized === 'strong') return 'success';
    if (normalized === 'insufficient' || normalized === 'no-context' || normalized === 'active' || normalized === 'exploring' || normalized === 'fallback' || normalized === 'sufficient' || normalized === 'weak') return 'warning';
    if (normalized === 'skipped-budget' || normalized === 'retry' || normalized === 'queued' || normalized === 'unknown' || normalized === 'configured' || normalized === 'single-shot' || normalized === 'idle') return 'neutral';
    return 'error';
  }

  function statusIcon(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success' || normalized === 'accepted' || normalized === 'answered' || normalized === 'succeeded') return '✅';
    if (normalized === 'insufficient' || normalized === 'sufficient') return '⚠️';
    if (normalized === 'no-context') return '🔸';
    if (normalized === 'weak') return '🟠';
    if (normalized === 'strong') return '💪';
    if (normalized === 'active') return '🟡';
    if (normalized === 'retry') return '🔄';
    if (normalized === 'queued') return '⏳';
    if (normalized === 'skipped-budget') return '⏭️';
    if (normalized === 'configured' || normalized === 'single-shot' || normalized === 'idle') return '⚙️';
    if (normalized === 'exploring') return '🧭';
    if (normalized === 'settled') return '🏁';
    if (normalized === 'fallback') return '🔎';
    return '❌';
  }

  function safeJson(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function nodeTypeLabel(type) {
    return stageLabel(type);
  }

  function edgeLabel(type) {
    const labels = {
      contains: 'contains',
      spawned_from: 'spawned from',
      uses: 'uses',
      produced: 'produces',
      failed_as: 'fails as',
      needs: 'needs',
      derived_from: 'derived from',
      compares: 'compares',
      challenges: 'challenges'
    };
    return labels[type] || type || 'relates to';
  }

  function buildTraceGraphNodes(trace) {
    const canonicalNodes = Array.isArray(trace?.graph?.nodes) ? trace.graph.nodes : [];
    const canonicalEdges = Array.isArray(trace?.graph?.edges) ? trace.graph.edges : [];
    if (canonicalNodes.length) {
      const nodeMap = new Map(canonicalNodes.map(node => [node.id, node]));
      const incoming = new Map();
      const outgoing = new Map();
      for (const edge of canonicalEdges) {
        if (!incoming.has(edge.to)) incoming.set(edge.to, []);
        if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
        incoming.get(edge.to).push(edge);
        outgoing.get(edge.from).push(edge);
      }
      const frameDepth = new Map(
        canonicalNodes
          .filter(node => node.type === 'frame')
          .map(node => [node.id, node.depth ?? 0])
      );
      const typeRank = { frame: 0, seed: 1, plugin: 2, branch: 3, result: 4, failure: 5 };
      const sorted = [...canonicalNodes].sort((left, right) => {
        const leftFrame = left.type === 'frame' ? left.id : (left.frameId || '');
        const rightFrame = right.type === 'frame' ? right.id : (right.frameId || '');
        const leftDepth = frameDepth.get(leftFrame) ?? 0;
        const rightDepth = frameDepth.get(rightFrame) ?? 0;
        if (leftDepth !== rightDepth) return leftDepth - rightDepth;
        if (leftFrame !== rightFrame) return String(leftFrame).localeCompare(String(rightFrame));
        const rankDiff = (typeRank[left.type] ?? 9) - (typeRank[right.type] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        return String(left.label || left.id).localeCompare(String(right.label || right.id));
      });

      const nodes = sorted.map((node, index) => ({
        index,
        id: node.id,
        type: node.type || 'node',
        stage: node.stage || node.type || 'stage',
        title: node.type === 'frame'
          ? `Frame ${node.depth ?? frameDepth.get(node.id) ?? 0}`
          : (node.type === 'plugin' ? (node.label || node.id || 'plugin') : (node.label || node.type || node.id || 'node')),
        pluginId: node.type === 'plugin' ? (node.label || node.id || null) : null,
        status: node.status || 'unknown',
        durationMs: node.metadata?.durationMs ?? null,
        llmCalls: node.metadata?.llmCalls ?? null,
        model: node.metadata?.model || null,
        evidenceCount: node.metadata?.seedCount ?? null,
        plannerAttempt: node.metadata?.plannerPluginId || null,
        kbPluginId: node.metadata?.kbPluginId || null,
        input: node.input || null,
        output: node.output || null,
        contextCNL: node.contextCNL || null,
        error: node.error || null,
        frameId: node.frameId || (node.type === 'frame' ? node.id : null),
        depth: node.depth ?? frameDepth.get(node.frameId) ?? 0,
        metadata: node.metadata || {},
        incoming: (incoming.get(node.id) || []).map(edge => {
          const related = nodeMap.get(edge.from);
          return {
            type: edge.type,
            label: edgeLabel(edge.type),
            relatedId: edge.from,
            relatedLabel: related?.label || related?.id || edge.from,
            relatedType: related?.type || 'node'
          };
        }),
        outgoing: (outgoing.get(node.id) || []).map(edge => {
          const related = nodeMap.get(edge.to);
          return {
            type: edge.type,
            label: edgeLabel(edge.type),
            relatedId: edge.to,
            relatedLabel: related?.label || related?.id || edge.to,
            relatedType: related?.type || 'node'
          };
        })
      }));
      return { nodes, edges: canonicalEdges, hasCanonicalGraph: true };
    }

    const nodes = [];
    const pushNode = node => {
      nodes.push({
        index: nodes.length,
        id: `node-${nodes.length}`,
        type: node.type || 'plugin',
        stage: node.stage || 'stage',
        title: node.title || node.pluginId || stageLabel(node.stage),
        pluginId: node.pluginId || null,
        status: node.status || 'unknown',
        durationMs: node.durationMs ?? null,
        llmCalls: node.llmCalls ?? null,
        model: node.model || null,
        evidenceCount: node.evidenceCount ?? null,
        plannerAttempt: node.plannerAttempt || null,
        kbPluginId: node.kbPluginId || null,
        input: node.input || null,
        output: node.output || null,
        contextCNL: node.contextCNL || null,
        error: node.error || null,
        frameId: null,
        depth: 0,
        metadata: {},
        incoming: [],
        outgoing: []
      });
    };

    if (Array.isArray(trace?.trees) && trace.trees.length) {
      const lastAttempt = trace.trees.length - 1;
      for (let attemptIndex = 0; attemptIndex < trace.trees.length; attemptIndex += 1) {
        const plan = trace.trees[attemptIndex];
        const plannerStatus =
          attemptIndex < lastAttempt
            ? 'retry'
            : (trace?.finalStatus === 'success' ? 'success' : (trace?.finalStatus || 'failed'));
        pushNode({
          type: 'plugin',
          stage: 'planner',
          pluginId: plan?.plannerPluginId || trace?.plannerPluginId || 'planner',
          title: plan?.plannerPluginId || trace?.plannerPluginId || 'planner',
          status: plannerStatus,
          plannerAttempt: attemptIndex + 1,
          input: trace?.inputMessage || null,
          output: [
            `SD: ${(plan?.seedDetectorOrder || []).join(' -> ') || 'auto'}`,
            `KB: ${(plan?.kbPluginOrder || []).join(' -> ') || 'auto'}`,
            `GS: ${(plan?.goalSolverOrder || []).join(' -> ') || 'auto'}`,
            plan?.notes?.length ? `Notes: ${plan.notes.join(', ')}` : null
          ].filter(Boolean).join('\n')
        });

        for (const child of plan?.children || []) {
          if (child?.type === 'decompose') {
            pushNode({
              type: 'plugin',
              stage: 'decompose',
              pluginId: 'decomposer',
              title: 'decomposer',
              status: 'success',
              plannerAttempt: attemptIndex + 1,
              output: safeJson({
                intents: child.intentGroups || [],
                contextProfiles: child.contextProfiles || [],
                currentTurnUnitCount: child.currentTurnUnitCount || 0
              })
            });
            continue;
          }
          if (child?.type !== 'stage') continue;
          for (const pluginNode of child.children || []) {
            pushNode({
              type: 'plugin',
              stage: child.stage || 'stage',
              pluginId: pluginNode.pluginId || null,
              title: pluginNode.pluginId || stageLabel(child.stage),
              status: pluginNode.status || 'unknown',
              durationMs: pluginNode.durationMs ?? null,
              llmCalls: pluginNode.llmCalls ?? null,
              model: pluginNode.model || null,
              evidenceCount: pluginNode.evidenceCount ?? null,
              plannerAttempt: attemptIndex + 1,
              kbPluginId: pluginNode.kbPluginId || null,
              input: pluginNode.input || null,
              output: pluginNode.output ||
                (pluginNode.resolvedIntents?.length ? safeJson(pluginNode.resolvedIntents) : null),
              contextCNL: pluginNode.contextCNL || null,
              error: pluginNode.error || null
            });
          }
        }
      }
    } else {
      for (const stageNode of trace?.stages || []) {
        pushNode({
          type: 'plugin',
          stage: stageNode.stage || 'stage',
          pluginId: stageNode.pluginId || null,
          title: stageNode.pluginId || stageLabel(stageNode.stage),
          status: stageNode.status || 'unknown',
          durationMs: stageNode.durationMs ?? null,
          llmCalls: stageNode.llmCalls ?? null,
          model: stageNode.model || null,
          plannerAttempt: stageNode.plannerPluginId || null,
          input: stageNode.inputSnippet || null,
          output: stageNode.outputSnippet || null,
          error: stageNode.error || null
        });
      }
    }

    return { nodes, edges: [], hasCanonicalGraph: false };
  }

  function normalizeNodeIndex(nodes, selectedNodeIndex, preferredId = null) {
    if (!nodes.length) return -1;
    if (selectedNodeIndex != null && selectedNodeIndex >= 0 && selectedNodeIndex < nodes.length) {
      return selectedNodeIndex;
    }
    if (preferredId) {
      const preferredIndex = nodes.findIndex(node => node.id === preferredId);
      if (preferredIndex >= 0) return preferredIndex;
    }
    const firstFrame = nodes.findIndex(node => node.type === 'frame');
    if (firstFrame >= 0) return firstFrame;
    return 0;
  }

  function truncateGraphLabel(text, max = 28) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'node';
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
  }

  function formatDurationCompact(ms) {
    if (!Number.isFinite(ms)) return '';
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  }

  function renderRelationList(relations = []) {
    if (!relations.length) return '(none)';
    return relations
      .map(relation => `${relation.label} ${relation.relatedLabel} (${nodeTypeLabel(relation.relatedType)})`)
      .join('\n');
  }

  function renderGraphNodeDetail(node) {
    if (!node) return '<div class="explainability-empty">Select a frame or plugin to inspect details.</div>';
    const metaParts = [];
    metaParts.push(`type: ${nodeTypeLabel(node.type)}`);
    if (node.frameId && node.type !== 'frame') metaParts.push(`frame: ${node.frameId}`);
    if (node.depth != null && node.type === 'frame') metaParts.push(`depth: ${node.depth}`);
    if (node.durationMs != null) metaParts.push(`duration: ${formatDurationCompact(node.durationMs)}`);
    if (node.llmCalls != null) metaParts.push(`llm: ${node.llmCalls}`);
    if (node.model) metaParts.push(`model: ${node.model}`);
    if (node.kbPluginId) metaParts.push(`kb: ${node.kbPluginId}`);
    if (node.metadata?.deliberationLevel != null) metaParts.push(`deliberation: L${node.metadata.deliberationLevel}`);
    if (node.metadata?.closureMode) metaParts.push(`closure: ${node.metadata.closureMode}`);
    if (node.metadata?.purpose && node.type === 'frame') metaParts.push(`purpose: ${node.metadata.purpose}`);
    if (node.metadata?.familySignature) metaParts.push(`family: ${node.metadata.familySignature}`);
    if (node.metadata?.strength) metaParts.push(`strength: ${node.metadata.strength}`);
    if (node.metadata?.selected != null) metaParts.push(`selected: ${node.metadata.selected ? 'yes' : 'no'}`);
    if (node.metadata?.preservesConstraints) metaParts.push(`constraints: ${node.metadata.preservesConstraints}`);
    if (node.metadata?.structuralComplete) metaParts.push(`structure: ${node.metadata.structuralComplete}`);
    if (node.metadata?.seedCount != null && node.type === 'frame') metaParts.push(`seeds: ${node.metadata.seedCount}`);
    if (node.metadata?.candidates != null && node.type === 'frame') metaParts.push(`candidates: ${node.metadata.candidates}`);

    const errorText = node.error
      ? `${node.error.code || 'ERROR'}: ${node.error.message || ''}`.trim()
      : '';

    return `
      <div class="graph-node-detail-head">
        <div>
          <strong>${esc(node.title || node.pluginId || stageLabel(node.stage))}</strong>
          <span class="graph-node-stage">${esc(nodeTypeLabel(node.type))}</span>
        </div>
        <span class="graph-node-status graph-node-status-${statusClass(node.status)}">${statusIcon(node.status)} ${esc(node.status || 'unknown')}</span>
      </div>
      <div class="graph-node-meta">${esc(metaParts.join(' · ') || 'No extra metadata')}</div>
      <div class="graph-node-io">
        <h5>Input</h5>
        <pre>${esc(node.input || '(none)')}</pre>
      </div>
      <div class="graph-node-io">
        <h5>Output</h5>
        <pre>${esc(node.output || node.contextCNL || '(none)')}</pre>
      </div>
      <div class="graph-node-io">
        <h5>Inbound</h5>
        <pre>${esc(renderRelationList(node.incoming))}</pre>
      </div>
      <div class="graph-node-io">
        <h5>Outbound</h5>
        <pre>${esc(renderRelationList(node.outgoing))}</pre>
      </div>
      ${errorText ? `
      <div class="graph-node-io graph-node-error">
        <h5>Error</h5>
        <pre>${esc(errorText)}</pre>
      </div>` : ''}
    `;
  }

  function buildGraphCanvasModel(trace, nodes, edges) {
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const frames = nodes
      .filter(node => node.type === 'frame')
      .sort((left, right) => (left.depth ?? 0) - (right.depth ?? 0) || left.id.localeCompare(right.id));
    const rootFrameId = trace?.graph?.rootFrameId || frames[0]?.id || null;
    if (!frames.length) {
      const pluginNodes = nodes
        .filter(node => node.type === 'plugin')
        .sort((left, right) => {
          const leftOrder = Number.parseInt(String(left.id).split(':').pop() || '0', 10);
          const rightOrder = Number.parseInt(String(right.id).split(':').pop() || '0', 10);
          return leftOrder - rightOrder;
        });
      const pluginWidth = 196;
      const pluginHeight = 74;
      const gap = 42;
      const margin = 32;
      return {
        width: margin * 2 + Math.max(pluginWidth, pluginNodes.length * pluginWidth + Math.max(0, pluginNodes.length - 1) * gap),
        height: 180,
        frames: [],
        plugins: pluginNodes.map((node, index) => ({
          node,
          x: margin + index * (pluginWidth + gap),
          y: 56,
          width: pluginWidth,
          height: pluginHeight
        })),
        connectors: pluginNodes.slice(1).map((node, index) => {
          const prev = pluginNodes[index];
          return {
            fromX: margin + index * (pluginWidth + gap) + pluginWidth,
            fromY: 56 + pluginHeight / 2,
            toX: margin + (index + 1) * (pluginWidth + gap),
            toY: 56 + pluginHeight / 2,
            kind: 'sequence'
          };
        }),
        rootFrameId
      };
    }

    const pluginsByFrame = new Map(frames.map(frame => [frame.id, []]));
    const auxNodesByFrame = new Map(frames.map(frame => [frame.id, []]));
    for (const node of nodes.filter(item => item.type === 'plugin')) {
      const owner = node.frameId || rootFrameId;
      if (!pluginsByFrame.has(owner)) pluginsByFrame.set(owner, []);
      pluginsByFrame.get(owner).push(node);
    }
    for (const entries of pluginsByFrame.values()) {
      entries.sort((left, right) => {
        const leftOrder = Number.parseInt(String(left.id).split(':').pop() || '0', 10);
        const rightOrder = Number.parseInt(String(right.id).split(':').pop() || '0', 10);
        return leftOrder - rightOrder || String(left.title || left.id).localeCompare(String(right.title || right.id));
      });
    }

    const childFramesByParent = new Map(frames.map(frame => [frame.id, []]));
    for (const edge of edges || []) {
      if (edge.type !== 'spawned_from') continue;
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (fromNode?.type !== 'frame' || toNode?.type !== 'frame') continue;
      if (!childFramesByParent.has(fromNode.id)) childFramesByParent.set(fromNode.id, []);
      childFramesByParent.get(fromNode.id).push(toNode.id);
    }
    for (const childIds of childFramesByParent.values()) {
      childIds.sort((leftId, rightId) => {
        const left = nodeById.get(leftId);
        const right = nodeById.get(rightId);
        return (left?.depth ?? 0) - (right?.depth ?? 0) || leftId.localeCompare(rightId);
      });
    }

    const constants = {
      frameHeaderHeight: 52,
      framePaddingX: 24,
      framePaddingY: 20,
      pluginWidth: 196,
      pluginHeight: 74,
      auxWidth: 168,
      auxHeight: 58,
      nodeGap: 38,
      auxGap: 18,
      childFrameGap: 28,
      childFrameIndent: 32,
      minFrameWidth: 280
    };
    const measures = new Map();
    const shapes = [];
    const connectors = [];

    const measureFrame = frameId => {
      if (measures.has(frameId)) return measures.get(frameId);
      const plugins = pluginsByFrame.get(frameId) || [];
      const auxNodes = auxNodesByFrame.get(frameId) || [];
      const childIds = childFramesByParent.get(frameId) || [];
      const childMeasures = childIds.map(childId => ({ frameId: childId, ...measureFrame(childId) }));
      const pluginStripWidth = plugins.length
        ? plugins.length * constants.pluginWidth + Math.max(0, plugins.length - 1) * constants.nodeGap
        : 0;
      const childWidth = childMeasures.length
        ? Math.max(...childMeasures.map(child => child.width + constants.childFrameIndent))
        : 0;
      const innerWidth = Math.max(constants.minFrameWidth, pluginStripWidth, childWidth);
      let innerHeight = 0;
      if (plugins.length) innerHeight += constants.pluginHeight + constants.childFrameGap;
      if (childMeasures.length) {
        innerHeight += childMeasures.reduce((sum, child) => sum + child.height, 0);
        innerHeight += constants.childFrameGap * Math.max(0, childMeasures.length - 1);
      }
      const measure = {
        width: innerWidth + constants.framePaddingX * 2,
        height: constants.frameHeaderHeight + constants.framePaddingY * 2 + Math.max(innerHeight, 24)
      };
      measures.set(frameId, measure);
      return measure;
    };

    const placeFrame = (frameId, x, y) => {
      const frameNode = nodeById.get(frameId);
      const measure = measureFrame(frameId);
      const plugins = pluginsByFrame.get(frameId) || [];
      const auxNodes = auxNodesByFrame.get(frameId) || [];
      const childIds = childFramesByParent.get(frameId) || [];
      shapes.push({
        kind: 'frame',
        node: frameNode,
        x,
        y,
        width: measure.width,
        height: measure.height
      });

      let cursorY = y + constants.frameHeaderHeight + constants.framePaddingY;
      let lastPluginShape = null;
      if (plugins.length) {
        const stripWidth = plugins.length * constants.pluginWidth + Math.max(0, plugins.length - 1) * constants.nodeGap;
        let cursorX = x + constants.framePaddingX + Math.max(0, (measure.width - constants.framePaddingX * 2 - stripWidth) / 2);
        for (const pluginNode of plugins) {
          const pluginShape = {
            kind: 'plugin',
            node: pluginNode,
            x: cursorX,
            y: cursorY,
            width: constants.pluginWidth,
            height: constants.pluginHeight
          };
          shapes.push(pluginShape);
          if (!lastPluginShape) {
            connectors.push({
              fromX: x + measure.width / 2,
              fromY: y + constants.frameHeaderHeight,
              toX: pluginShape.x + pluginShape.width / 2,
              toY: pluginShape.y,
              kind: 'entry'
            });
          } else {
            connectors.push({
              fromX: lastPluginShape.x + lastPluginShape.width,
              fromY: lastPluginShape.y + lastPluginShape.height / 2,
              toX: pluginShape.x,
              toY: pluginShape.y + pluginShape.height / 2,
              kind: 'sequence'
            });
          }
          lastPluginShape = pluginShape;
          cursorX += constants.pluginWidth + constants.nodeGap;
        }
        cursorY += constants.pluginHeight + constants.childFrameGap;
      }

      for (const childId of childIds) {
        const childMeasure = measureFrame(childId);
        const childX = x + constants.framePaddingX + constants.childFrameIndent;
        placeFrame(childId, childX, cursorY);
        connectors.push({
          fromX: lastPluginShape
            ? lastPluginShape.x + lastPluginShape.width / 2
            : x + measure.width / 2,
          fromY: lastPluginShape
            ? lastPluginShape.y + lastPluginShape.height
            : y + constants.frameHeaderHeight,
          toX: childX + childMeasure.width / 2,
          toY: cursorY,
          kind: 'spawn'
        });
        cursorY += childMeasure.height + constants.childFrameGap;
      }
    };

    const roots = frames.filter(frame => frame.id === rootFrameId || !frames.some(candidate => (childFramesByParent.get(candidate.id) || []).includes(frame.id)));
    let canvasY = 24;
    for (const root of roots) {
      placeFrame(root.id, 24, canvasY);
      canvasY += measureFrame(root.id).height + constants.childFrameGap;
    }

    const visibleShapeById = new Map(
      shapes
        .filter(shape => shape?.node?.id)
        .map(shape => [shape.node.id, shape])
    );
    for (const edge of edges || []) {
      if (!edge?.type || edge.type === 'contains') continue;
      const fromShape = visibleShapeById.get(edge.from);
      const toShape = visibleShapeById.get(edge.to);
      if (!fromShape || !toShape) continue;
      if (fromShape.kind === 'frame' && toShape.kind === 'frame') continue;
      connectors.push({
        fromX: fromShape.kind === 'frame' ? fromShape.x + fromShape.width / 2 : fromShape.x + fromShape.width / 2,
        fromY: fromShape.kind === 'frame' ? fromShape.y + constants.frameHeaderHeight : fromShape.y + fromShape.height / 2,
        toX: toShape.kind === 'frame' ? toShape.x + toShape.width / 2 : toShape.x + toShape.width / 2,
        toY: toShape.kind === 'frame' ? toShape.y : toShape.y + toShape.height / 2,
        kind: edge.type
      });
    }

    return {
      width: Math.max(...roots.map(root => measureFrame(root.id).width), constants.minFrameWidth) + 64,
      height: canvasY,
      frames: shapes.filter(shape => shape.kind === 'frame'),
      plugins: shapes.filter(shape => shape.kind === 'plugin'),
      auxNodes: shapes.filter(shape => shape.kind === 'aux'),
      connectors,
      rootFrameId
    };
  }

  function renderGraphLegend() {
    const items = [
      ['success', 'success'],
      ['warning', 'limited'],
      ['error', 'failed'],
      ['neutral', 'idle']
    ];
    return `
      <div class="graph-legend">
        ${items.map(([tone, label]) => `<span class="graph-legend-item"><span class="graph-legend-swatch graph-tone-${tone}"></span>${esc(label)}</span>`).join('')}
      </div>
    `;
  }

  function renderGraphSvg(trace, nodes, edges, selectedNodeIndex, zoom = 1) {
    const canvas = buildGraphCanvasModel(trace, nodes, edges);
    const selectedNode = nodes[selectedNodeIndex] || null;
    const selectedId = selectedNode?.id || null;
    const svgParts = [];

    svgParts.push(`
      <defs>
        <marker id="graph-arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 10 5 L 0 10 z" class="graph-arrowhead"></path>
        </marker>
      </defs>
    `);

    for (const connector of canvas.connectors) {
      const path = connector.kind === 'sequence'
        ? `M ${connector.fromX} ${connector.fromY} L ${connector.toX} ${connector.toY}`
        : `M ${connector.fromX} ${connector.fromY} C ${connector.fromX} ${connector.fromY + 24}, ${connector.toX} ${connector.toY - 24}, ${connector.toX} ${connector.toY}`;
      svgParts.push(`<path class="graph-edge graph-edge-${connector.kind}" d="${path}" marker-end="url(#graph-arrowhead)"></path>`);
    }

    for (const frame of canvas.frames) {
      const selected = frame.node.id === selectedId ? ' graph-svg-selected' : '';
      svgParts.push(`
        <g class="graph-svg-node graph-svg-frame graph-status-${statusClass(frame.node.status)}${selected}" data-node-index="${frame.node.index}">
          <rect class="graph-frame-rect" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="14" ry="14"></rect>
          <rect class="graph-frame-header-band" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="52" rx="14" ry="14"></rect>
          <text class="graph-frame-title-text" x="${frame.x + 18}" y="${frame.y + 24}">${esc(truncateGraphLabel(frame.node.title || frame.node.id, 36))}</text>
          <text class="graph-frame-meta-text" x="${frame.x + 18}" y="${frame.y + 42}">${esc(`status ${frame.node.status || 'unknown'} · ${nodeTypeLabel(frame.node.type)}`)}</text>
        </g>
      `);
    }

    for (const plugin of canvas.plugins) {
      const node = plugin.node;
      const selected = node.id === selectedId ? ' graph-svg-selected' : '';
      const subtitle = formatDurationCompact(node.durationMs) || 'pending';
      svgParts.push(`
        <g class="graph-svg-node graph-svg-plugin graph-status-${statusClass(node.status)}${selected}" data-node-index="${node.index}">
          <rect class="graph-plugin-rect" x="${plugin.x}" y="${plugin.y}" width="${plugin.width}" height="${plugin.height}" rx="12" ry="12"></rect>
          <text class="graph-plugin-title-text" x="${plugin.x + 14}" y="${plugin.y + 24}">${esc(truncateGraphLabel(node.title || node.pluginId || node.id, 26))}</text>
          <text class="graph-plugin-meta-text" x="${plugin.x + 14}" y="${plugin.y + 44}">${esc(subtitle || nodeTypeLabel(node.type))}</text>
          <text class="graph-plugin-status-text" x="${plugin.x + 14}" y="${plugin.y + 62}">${esc(`${statusIcon(node.status)} ${node.status || 'unknown'}`)}</text>
        </g>
      `);
    }
    const visibleNodeCount = canvas.frames.length + canvas.plugins.length;
    const visibleEdgeCount = canvas.connectors.length;

    return `
      <div class="graph-canvas-shell">
        <div class="explainability-graph-toolbar">
          <div class="explainability-graph-summary">${esc(`${visibleNodeCount} nodes · ${visibleEdgeCount} edges · root ${canvas.rootFrameId || 'n/a'} · L${trace?.deliberationLevel ?? 0}`)}</div>
          ${renderGraphLegend()}
          <div class="graph-zoom-controls">
            <button type="button" class="graph-zoom-out" aria-label="Zoom out">−</button>
            <span class="graph-zoom-readout">${esc(`${Math.round(zoom * 100)}%`)}</span>
            <button type="button" class="graph-zoom-in" aria-label="Zoom in">+</button>
            <button type="button" class="graph-zoom-reset" aria-label="Reset zoom">Reset</button>
          </div>
        </div>
        <div class="graph-canvas-scroll">
          <svg class="graph-canvas" viewBox="0 0 ${canvas.width} ${canvas.height}" style="width:${Math.round(canvas.width * zoom)}px;height:${Math.round(canvas.height * zoom)}px" role="img" aria-label="Execution graph">
            ${svgParts.join('')}
          </svg>
        </div>
      </div>
    `;
  }

  function renderExplainabilityGraph(trace, selectedNodeIndex, zoom = 1) {
    const { nodes, edges } = buildTraceGraphNodes(trace || {});
    const normalizedIndex = normalizeNodeIndex(nodes, selectedNodeIndex, trace?.graph?.rootFrameId || null);
    if (!nodes.length) {
      return {
        nodes,
        selectedNodeIndex: -1,
        html: '<div class="explainability-empty">No execution trace captured.</div>'
      };
    }
    return {
      nodes,
      selectedNodeIndex: normalizedIndex,
      html: `
        <div class="explainability-graph-wrap">
          ${renderGraphSvg(trace, nodes, edges, normalizedIndex, zoom)}
          <div class="explainability-node-detail">
            ${renderGraphNodeDetail(nodes[normalizedIndex])}
          </div>
        </div>
      `
    };
  }

  function extractAnswerText(responseDoc) {
    if (!responseDoc?.groups?.length) return null;
    const parts = [];
    for (const group of responseDoc.groups) {
      if (group.answerMarkdown) parts.push(group.answerMarkdown.trim());
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  function snipText(value, max = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max)}…`;
  }

  async function fetchExplainabilityTurns(force = false) {
    const activeSessionId = normalizeSessionId(sessionId);
    if (!activeSessionId) return [];
    if (!force && explainabilityCache.sessionId === activeSessionId) {
      return explainabilityCache.turns;
    }
    const payload = await fetchJson(`/sessions/${activeSessionId}/explainability`);
    if (payload.error) throw new Error(payload.error.message || 'Failed to load explainability');
    explainabilityCache = {
      sessionId: activeSessionId,
      turns: Array.isArray(payload.turns) ? payload.turns : []
    };
    return explainabilityCache.turns;
  }

  function showExplainabilityPanel(options = {}) {
    const activeSessionId = normalizeSessionId(sessionId);
    if (!activeSessionId) {
      showError('No active session for explainability yet.');
      return;
    }
    const existing = document.querySelector('.explainability-overlay');
    if (existing) existing.remove();

    const requestId = options.requestId || null;
    const overlay = document.createElement('div');
    overlay.className = 'explainability-overlay';
    let isFullscreen = false;
    let turns = [];
    let selectedIndex = -1;
    let selectedNodeIndex = -1;
    let graphZoom = 1;
    let loading = true;
    let errorMessage = '';

    const selectTurn = (nextIndex) => {
      if (!turns.length) {
        selectedIndex = -1;
        selectedNodeIndex = -1;
        graphZoom = 1;
        return;
      }
      const bounded = Math.max(0, Math.min(nextIndex, turns.length - 1));
      selectedIndex = bounded;
      selectedNodeIndex = -1;
      graphZoom = 1;
    };

    const selectByRequestId = (targetRequestId = null) => {
      if (!turns.length) {
        selectedIndex = -1;
        selectedNodeIndex = -1;
        graphZoom = 1;
        return;
      }
      if (!targetRequestId) {
        selectedIndex = Math.max(0, turns.length - 1);
        selectedNodeIndex = -1;
        graphZoom = 1;
        return;
      }
      const idx = turns.findIndex(turn => turn.requestId === targetRequestId);
      selectedIndex = idx >= 0 ? idx : Math.max(0, turns.length - 1);
      selectedNodeIndex = -1;
      graphZoom = 1;
    };

    const bindGraphCanvasInteractions = () => {
      const scroller = overlay.querySelector('.graph-canvas-scroll');
      if (!scroller || scroller.dataset.bound === 'true') return;
      scroller.dataset.bound = 'true';
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      scroller.addEventListener('mousedown', event => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = scroller.scrollLeft;
        originTop = scroller.scrollTop;
        scroller.classList.add('dragging');
      });
      scroller.addEventListener('mouseleave', () => {
        dragging = false;
        scroller.classList.remove('dragging');
      });
      scroller.addEventListener('mouseup', () => {
        dragging = false;
        scroller.classList.remove('dragging');
      });
      scroller.addEventListener('mousemove', event => {
        if (!dragging) return;
        scroller.scrollLeft = originLeft - (event.clientX - startX);
        scroller.scrollTop = originTop - (event.clientY - startY);
      });
    };

    const render = () => {
      const listHtml = loading
        ? '<div class="explainability-empty">Loading explainability…</div>'
        : errorMessage
          ? `<div class="explainability-empty">${esc(errorMessage)}</div>`
          : turns.length === 0
            ? '<div class="explainability-empty">No requests recorded for this session yet.</div>'
            : turns.map((turn, index) => {
              const active = index === selectedIndex ? ' active' : '';
              const when = turn.createdAt ? new Date(turn.createdAt).toLocaleString() : '';
              const summary = snipText(turn.userMessage || turn.assistantPreview || '(empty turn)', 88);
              const statusClassName = statusClass(turn.answerStatus || 'unknown');
              return `
                <button type="button" class="explainability-turn explainability-turn-${statusClassName}${active}" data-index="${index}">
                  <div class="explainability-turn-index">Turn ${turn.turnIndex || index + 1}${turn.requestId ? ` · ${esc(turn.requestId)}` : ''}</div>
                  <div class="explainability-turn-text">${esc(summary)}</div>
                  <div class="explainability-turn-meta">${esc(when)} · ${statusIcon(turn.answerStatus)} ${esc(turn.answerStatus || 'unknown')}</div>
                </button>
              `;
            }).join('');

      let detailHtml = '<div class="explainability-empty">Select a turn to inspect.</div>';
      const selectedTurn = selectedIndex >= 0 ? turns[selectedIndex] : null;
      if (selectedTurn) {
        const when = selectedTurn.createdAt ? new Date(selectedTurn.createdAt).toLocaleString() : 'n/a';
        const statusBadge = selectedTurn.answerStatus
          ? `<span class="status-badge status-${selectedTurn.answerStatus}">${esc(selectedTurn.answerStatus)}</span>`
          : '';
        const graph = renderExplainabilityGraph(selectedTurn.executionTrace || null, selectedNodeIndex, graphZoom);
        selectedNodeIndex = graph.selectedNodeIndex;
        const errorSection = selectedTurn.error
          ? `
            <div class="explainability-detail-section">
              <h4>Error</h4>
              <div class="explainability-detail-msg explainability-error-msg">${esc(`${selectedTurn.error.code || 'ERROR'}: ${selectedTurn.error.message || ''}`.trim())}</div>
            </div>
          `
          : '';

        detailHtml = `
          ${graph.html}
          <div class="explainability-detail-section explainability-turn-meta-block">
            <div class="explainability-detail-head">
              <div>
                <h3>Turn ${selectedTurn.turnIndex || selectedIndex + 1} ${statusBadge}</h3>
                <div class="explainability-detail-meta">
                  ${selectedTurn.requestId ? `request: <code>${esc(selectedTurn.requestId)}</code> · ` : ''}
                  ${esc(when)}
                </div>
              </div>
              <div class="explainability-detail-meta">
                planner: <code>${esc(selectedTurn.plannerPlugin || 'auto')}</code><br>
                sd: <code>${esc(selectedTurn.seedDetectorPlugin || 'auto')}</code> ·
                kb: <code>${esc(selectedTurn.kbPlugin || 'auto')}</code> ·
                gs: <code>${esc(selectedTurn.goalSolverPlugin || 'auto')}</code><br>
                deliberation: <code>L${esc(String(selectedTurn.deliberationLevel ?? selectedTurn.executionTrace?.deliberationLevel ?? 0))}</code>
              </div>
            </div>
          </div>
          ${errorSection}
        `;
      }

      overlay.className = `explainability-overlay${isFullscreen ? ' explainability-fs' : ''}`;
      overlay.innerHTML = `
        <div class="explainability-modal">
          <div class="explainability-header">
            <h2>Explainability — Session ${esc(activeSessionId)}</h2>
            <div class="explainability-header-actions">
              <button type="button" class="explainability-refresh" aria-label="Refresh explainability">↻</button>
              <button type="button" class="explainability-fullscreen" aria-label="Toggle fullscreen">${isFullscreen ? '⊡' : '⊞'}</button>
              <button type="button" class="explainability-close" aria-label="Close explainability">&times;</button>
            </div>
          </div>
          <div class="explainability-body">
            <div class="explainability-list">${listHtml}</div>
            <div class="explainability-detail">${detailHtml}</div>
          </div>
        </div>
      `;
      bindGraphCanvasInteractions();
    };

    const loadTurns = async (force = false) => {
      loading = true;
      errorMessage = '';
      render();
      try {
        turns = await fetchExplainabilityTurns(force);
        loading = false;
        if (selectedIndex < 0 || selectedIndex >= turns.length) selectByRequestId(requestId);
        render();
        if (selectedIndex >= 0) {
          const activeTurn = overlay.querySelector(`.explainability-turn[data-index="${selectedIndex}"]`);
          activeTurn?.scrollIntoView({ block: 'nearest' });
        }
      } catch (error) {
        loading = false;
        errorMessage = error.message || 'Failed to load explainability';
        render();
      }
    };

    const closeOverlay = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onEscKey);
    };

    const onEscKey = event => {
      if (event.key === 'Escape') closeOverlay();
    };

    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('.explainability-close')) {
        closeOverlay();
        return;
      }
      if (event.target.closest('.explainability-fullscreen')) {
        isFullscreen = !isFullscreen;
        render();
        return;
      }
      if (event.target.closest('.explainability-refresh')) {
        void loadTurns(true);
        return;
      }
      const turnButton = event.target.closest('.explainability-turn[data-index]');
      if (turnButton) {
        selectTurn(Number(turnButton.dataset.index));
        render();
        return;
      }
      if (event.target.closest('.graph-zoom-in')) {
        graphZoom = Math.min(2.25, Number((graphZoom + 0.15).toFixed(2)));
        render();
        return;
      }
      if (event.target.closest('.graph-zoom-out')) {
        graphZoom = Math.max(0.7, Number((graphZoom - 0.15).toFixed(2)));
        render();
        return;
      }
      if (event.target.closest('.graph-zoom-reset')) {
        graphZoom = 1;
        render();
        return;
      }
      const graphNode = event.target.closest('.graph-svg-node[data-node-index]');
      if (graphNode) {
        selectedNodeIndex = Number(graphNode.dataset.nodeIndex);
        render();
        return;
      }
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onEscKey);
    void loadTurns(false);
  }

  function renderAssistantMessage(div, content, responseDoc, executionTrace, requestId = null) {
    const answerText = extractAnswerText(responseDoc);
    const displayHtml = answerText
      ? `<div class="answer-text">${renderMarkdown(answerText)}</div>`
      : `<div class="answer-text">${renderMarkdown(content)}</div>`;
    const hasDetails =
      executionTrace?.graph?.nodes?.length ||
      executionTrace?.stages?.length ||
      executionTrace?.trees?.length;
    const controls = [];
    const shouldShowExplainabilityJump = requestId || hasDetails;
    if (shouldShowExplainabilityJump) controls.push('<span class="msg-explainability-btn">🧭 Explainability</span>');
    div.innerHTML = displayHtml + (controls.length ? `<div>${controls.join('')}</div>` : '');
    if (shouldShowExplainabilityJump) {
      div.querySelector('.msg-explainability-btn').addEventListener('click', () => {
        showExplainabilityPanel({ requestId: requestId || null });
      });
    }
  }

  function createAssistantDraft() {
    const div = document.createElement('div');
    div.className = 'msg assistant streaming';
    div.innerHTML = '<div class="answer-text"></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateAssistantDraft(div, content) {
    if (!div) return;
    const answerEl = div.querySelector('.answer-text');
    if (answerEl) answerEl.textContent = content || '';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function finalizeAssistantDraft(div, content, responseDoc, executionTrace, requestId = null) {
    if (!div) return;
    div.classList.remove('streaming');
    renderAssistantMessage(div, content, responseDoc, executionTrace, requestId);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, content, responseDoc, executionTrace, requestId = null) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'assistant') {
      renderAssistantMessage(div, content, responseDoc, executionTrace, requestId);
    } else {
      div.textContent = content;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function formatProgressEvent(event) {
    if (event?.message) return event.message;
    if (event?.type === 'planner') {
      return event.event === 'start'
        ? `Planning with ${event.plannerPluginId || 'planner'}`
        : `Planner ${event.plannerPluginId || 'planner'} finished`;
    }
    if (event?.type === 'stage') {
      const label = event.stage || 'stage';
      return event.event === 'start'
        ? `Running ${label}${event.pluginId ? ` via ${event.pluginId}` : ''}`
        : `${label} finished${event.status ? ` with ${event.status}` : ''}`;
    }
    if (event?.type === 'frame') return event.message || 'Opening child frame';
    if (event?.type === 'response') return 'Rendering response';
    return 'Processing...';
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
    const previousSessionId = normalizeSessionId(sessionId);
    sessionId = normalizeSessionId(meta.session_id) || sessionId;
    persistSessionId();
    if (sessionId !== previousSessionId) resetExplainabilityCache();
    workspaceState = workspaceState || {};
    workspaceState.kbId = meta.kb_id || workspaceState.kbId || kbSelect.value;
    workspaceState.kbName = meta.kb_name || workspaceState.kbName || workspaceState.kbId;
    workspaceState.dirty = !!meta.workspace_dirty;
    workspaceState.sourceCount = meta.workspace_source_count ?? workspaceState.sourceCount ?? 0;
    workspaceState.unitCount = meta.workspace_unit_count ?? workspaceState.unitCount ?? 0;
    workspaceState.lastSavedAt = meta.workspace_last_saved_at || workspaceState.lastSavedAt || null;
    if (meta.deliberation_level != null) {
      deliberationSelect.value = String(meta.deliberation_level);
    }
    if (workspaceState.kbId && [...kbSelect.options].some(option => option.value === workspaceState.kbId)) {
      kbSelect.value = workspaceState.kbId;
    }
    updateBadges();
  }

  function buildPluginRequestConfig(body) {
    if (plannerSelect.value) body.planner_plugin = plannerSelect.value;
    if (seedSelect.value) body.seed_detector_plugin = seedSelect.value;
    if (kbPluginSelect.value) body.kb_plugin = kbPluginSelect.value;
    if (goalSelect.value) body.goal_solver_plugin = goalSelect.value;
    body.deliberation_level = Number.parseInt(deliberationSelect.value || '0', 10) || 0;
  }

  function buildSessionCreateBody() {
    const body = {};
    buildPluginRequestConfig(body);
    if (kbSelect.value) body.kb_id = kbSelect.value;
    return body;
  }

  function resetExplainabilityCache() {
    explainabilityCache = { sessionId: null, turns: [] };
  }

  async function loadKbList(selectedKbId = null) {
    const data = await fetchJson('/kbs');
    const current = selectedKbId || kbSelect.value || localStorage.getItem('mrp_kb') || '';
    kbSelect.innerHTML = (data.kbs || []).map(kb => {
      const kbId = kb.id || kb.kbId;
      const label = `${kb.name} (${kbId})`;
      return `<option value="${kbId}">${esc(label)}</option>`;
    }).join('');
    if (current && [...kbSelect.options].some(option => option.value === current)) kbSelect.value = current;
    savePrefs();
  }

  async function refreshWorkspace() {
    sessionId = normalizeSessionId(sessionId);
    if (!sessionId) {
      workspaceState = null;
      updateBadges();
      return null;
    }
    const data = await fetchJson(`/sessions/${sessionId}/workspace`);
    if (data.error) {
      if (data.error.code === 'SESSION_EXPIRED' || data.error.code === 'SESSION_NOT_FOUND') {
        sessionId = null;
        persistSessionId();
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
    sessionId = normalizeSessionId(sessionId);
    if (!sessionId) {
      workspaceState = null;
      updateBadges();
      return null;
    }
    const meta = await fetchJson(`/sessions/${sessionId}`);
    if (meta.error) {
      if (meta.error.code === 'SESSION_EXPIRED' || meta.error.code === 'SESSION_NOT_FOUND') {
        sessionId = null;
        persistSessionId();
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
    sessionId = normalizeSessionId(sessionId);
    if (sessionId) {
      await refreshSessionState();
      // If refresh cleared sessionId (e.g., session expired), fall through to create new
      if (sessionId) return sessionId;
    }
    const body = buildSessionCreateBody();
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
    showThinking('Preparing execution stream...');
    let draft = null;
    try {
      await ensureSelectedKbLoaded();
      const body = {
        messages: [{ role: 'user', content: text }],
        stream: true
      };
      if (normalizeSessionId(sessionId)) body.session_id = normalizeSessionId(sessionId);
      buildPluginRequestConfig(body);
      draft = createAssistantDraft();
      let streamedText = '';
      let completedPayload = null;
      await streamEvents('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, {
        progress(event) {
          updateThinking(formatProgressEvent(event));
        },
        'response.meta'(meta) {
          applySessionMeta(meta);
        },
        'response.delta'(event) {
          streamedText += event.delta || '';
          updateAssistantDraft(draft, streamedText);
          updateThinking('Streaming final response...');
        },
        'response.completed'(payload) {
          completedPayload = payload;
        },
        error(payload) {
          throw new Error(payload.error?.message || 'Streaming failed');
        }
      });
      hideLoading();
      clearThinking();
      if (!completedPayload) {
        throw new Error('Streaming completed without a final payload');
      }
      sessionId = normalizeSessionId(completedPayload.session_id) || sessionId;
      persistSessionId();
      await refreshSessionState();
      resetExplainabilityCache();
      finalizeAssistantDraft(
        draft,
        completedPayload.choices?.[0]?.message?.content || streamedText || '(empty response)',
        completedPayload.response_document,
        completedPayload.execution_trace,
        completedPayload.request_id || null
      );
    } catch (error) {
      hideLoading();
      clearThinking();
      if (draft?.parentNode) draft.remove();
      showError(error.message);
    }
  }

  async function ensureSelectedKbLoaded() {
    await ensureSession();
    if (!kbSelect.value) return sessionId;
    if (workspaceState?.kbId === kbSelect.value) return sessionId;
    if (workspaceState?.dirty) {
      const discard = window.confirm(`Loading KB "${kbSelect.value}" will discard the current unsaved draft for "${workspaceState.kbName || workspaceState.kbId}". Continue?`);
      if (!discard) throw new Error('KB load cancelled');
    }
    const data = await fetchJson(`/sessions/${sessionId}/kb/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kb_id: kbSelect.value, discard_draft: true })
    });
    if (data.error) throw new Error(data.error.message || 'Failed to load KB');
    applySessionMeta(data);
    await refreshWorkspace();
    return sessionId;
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
      const data = await fetchJson(`/sessions/${sessionId}/kb/load`, {
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

  async function createNewKb() {
    const proposedName = `kb-${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt('Name for the new KB:', proposedName);
    if (!name) return false;
    showLoading('Creating KB...');
    try {
      const created = await fetchJson('/kbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      hideLoading();
      if (created.error) throw new Error(created.error.message || 'Failed to create KB');
      await loadKbList(created.kb_id);
      kbSelect.value = created.kb_id;
      await ensureSelectedKbLoaded();
      addMessage('assistant', `Created and loaded KB "${created.kb_name}" for the current session.`);
      return true;
    } catch (error) {
      hideLoading();
      showError(error.message);
      return false;
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
    await ensureSelectedKbLoaded();
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

  async function stageContentInWorkspace(name, content) {
    await ensureSelectedKbLoaded();
    showLoading(`Staging ${name}...`);
    try {
      const body = { name, content };
      if (seedSelect.value) body.seed_detector_plugin = seedSelect.value;
      const data = await fetchJson(`/sessions/${sessionId}/workspace/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      hideLoading();
      if (data.error) throw new Error(data.error.message || 'Failed to stage source');
      await refreshWorkspace();
      addMessage('assistant', `Staged "${name}" (${data.unitCount || 0} units) in draft for KB "${workspaceState?.kbName || ''}".`);
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  }

  plannerSelect.addEventListener('change', savePrefs);
  seedSelect.addEventListener('change', savePrefs);
  kbPluginSelect.addEventListener('change', savePrefs);
  goalSelect.addEventListener('change', savePrefs);
  deliberationSelect.addEventListener('change', savePrefs);
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
    persistSessionId();
    workspaceState = null;
    resetExplainabilityCache();
    messagesEl.innerHTML = '';
    updateBadges();
  });

  $('#reset-config').addEventListener('click', () => {
    localStorage.removeItem('mrp_planner');
    localStorage.removeItem('mrp_seed');
    localStorage.removeItem('mrp_kb_plugin');
    localStorage.removeItem('mrp_goal');
    localStorage.removeItem('mrp_deliberation');
    localStorage.removeItem('mrp_kb');
    loadConfig();
  });

  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  explainabilityBtn.addEventListener('click', () => {
    showExplainabilityPanel();
  });
  saveSettingsBtn.addEventListener('click', () => saveRoleSettings());
  newKbBtn.addEventListener('click', () => createNewKb());
  loadKbBtn.addEventListener('click', () => mountSelectedKb());
  forkKbBtn.addEventListener('click', () => forkCurrentKb());
  saveKbBtn.addEventListener('click', () => saveCurrentKb());

  const attachBtn = $('#attach-btn');
  const evalBtn = $('#eval-btn');
  const evalDropdown = $('#eval-dropdown');

  attachBtn.addEventListener('click', () => fileInput.click());

  evalBtn.addEventListener('click', async () => {
    if (!evalDropdown.classList.contains('hidden')) {
      evalDropdown.classList.add('hidden');
      return;
    }
    try {
      const data = await fetchJson('/eval-sources');
      evalDropdown.innerHTML = (data.sources || []).map(s =>
        `<button type="button" data-content="${btoa(unescape(encodeURIComponent(s.content)))}">${esc(s.name)}</button>`
      ).join('') || '<span style="padding:.4rem;color:#888">No eval suites found</span>';
    } catch { evalDropdown.innerHTML = '<span style="padding:.4rem;color:#888">Error loading</span>'; }
    evalDropdown.classList.remove('hidden');
  });

  evalDropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-content]');
    if (!btn) return;
    evalDropdown.classList.add('hidden');
    input.value = decodeURIComponent(escape(atob(btn.dataset.content)));
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#attach-menu-wrap')) evalDropdown.classList.add('hidden');
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
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
