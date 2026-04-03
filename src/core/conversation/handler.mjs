// DS019 — Conversation State
import { randomUUID } from 'node:crypto';
import { MRPError } from '../platform/errors.mjs';
import { logger } from '../platform/logger.mjs';
import { KBIndex } from '../kb/index.mjs';
import { SessionWorkspace } from '../kb/session-workspace.mjs';
import { normalizeDeliberationLevel } from '../engine/runtime-objects.mjs';

const MOD = 'conversation';
const SESSION_WIDE_GUIDANCE_RE = /\b(for the rest of (?:this|the) session|from now on|remember this|remember that|keep (?:this|that) (?:for|throughout) (?:this|the) session|session-wide|persist this (?:instruction|preference|rule)|make this (?:the )?default)\b/i;

function isTurnLocalGuidanceUnit(unit = {}) {
  const scopes = Array.isArray(unit.phaseScopes) ? unit.phaseScopes : [];
  return scopes.some(scope => scope && scope !== 'kb-plugin');
}

export class ConversationHandler {
  constructor(config = {}) {
    this.maxHistoryMessages = config.maxHistoryMessagesForPrompt || 20;
    this.maxHistoryChars = config.maxHistoryCharsForPrompt || 16000;
    this.ttlMinutes = config.sessionIdleTtlMinutes || 30;
    this.maxContextUnits = config.maxSessionContextUnits || 200;
    this.maxExplainabilityEntries = config.maxExplainabilityEntries || 200;
    this.maxSessions = config.maxSessions || 1000;
    this.defaultPlannerPlugin = config.defaultPlannerPlugin || 'planner-default';
    this.defaultSeedDetectorPlugin = config.defaultSeedDetectorPlugin ?? null;
    this.defaultKBPlugin = config.defaultKBPlugin ?? null;
    this.defaultGoalSolverPlugin = config.defaultGoalSolverPlugin ?? null;
    this.defaultKbId = config.defaultKbId || 'default';
    this._sessions = new Map();
    this.kbRepositoryManager = null;
    this.pluginRegistry = null;
  }

  attachKBRepositoryManager(manager) {
    this.kbRepositoryManager = manager;
  }

  attachPluginRegistry(registry) {
    this.pluginRegistry = registry;
  }

  _resolvePluginSelections({
    session = null,
    plannerPlugin = null,
    seedDetectorPlugin = null,
    kbPlugin = null,
    goalSolverPlugin = null
  } = {}) {
    const resolvedPlannerPlugin =
      plannerPlugin ||
      session?.preferredPlannerPlugin ||
      this.defaultPlannerPlugin;
    const resolvedSeedDetectorPlugin =
      seedDetectorPlugin ||
      session?.preferredSeedDetectorPlugin ||
      this.defaultSeedDetectorPlugin ||
      null;
    const resolvedKBPlugin =
      kbPlugin ||
      session?.preferredKBPlugin ||
      this.defaultKBPlugin ||
      null;
    const resolvedGoalSolverPlugin =
      goalSolverPlugin ||
      session?.preferredGoalSolverPlugin ||
      this.defaultGoalSolverPlugin ||
      null;

    return {
      plannerPlugin: resolvedPlannerPlugin,
      seedDetectorPlugin: resolvedSeedDetectorPlugin,
      kbPlugin: resolvedKBPlugin,
      goalSolverPlugin: resolvedGoalSolverPlugin
    };
  }

  async createSession(
    model,
    kbId = null,
    plannerPlugin = null,
    seedDetectorPlugin = null,
    kbPlugin = null,
    goalSolverPlugin = null,
    deliberationLevel = null
  ) {
    if (this._sessions.size >= this.maxSessions) {
      this.expireInactiveSessions();
      if (this._sessions.size >= this.maxSessions) {
        throw new MRPError('SESSION_INTERNAL_LIMIT', 'conversation', 'Max sessions reached');
      }
    }
    const resolvedSelections = this._resolvePluginSelections({
      plannerPlugin,
      seedDetectorPlugin,
      kbPlugin,
      goalSolverPlugin
    });
    const now = new Date();
    const session = {
      sessionId: `sess-${randomUUID().substring(0, 12)}`,
      createdAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMinutes * 60000).toISOString(),
      preferredModel: model || null,
      preferredPlannerPlugin: resolvedSelections.plannerPlugin,
      preferredSeedDetectorPlugin: resolvedSelections.seedDetectorPlugin,
      preferredKBPlugin: resolvedSelections.kbPlugin || null,
      preferredGoalSolverPlugin: resolvedSelections.goalSolverPlugin,
      preferredDeliberationLevel: normalizeDeliberationLevel(deliberationLevel, 0),
      messageLog: [],
      systemPrompt: null,
      sessionContextUnits: [],
      sessionIndex: new KBIndex(),
      pendingTurnContextUnits: [],
      pendingTurnIndex: new KBIndex(),
      mountedKbId: null,
      mountedKbName: null,
      workspace: null,
      explainabilityLog: []
    };
    session.workspace = new SessionWorkspace(session.sessionId, this.kbRepositoryManager?.retrievalConfig || {});
    this._sessions.set(session.sessionId, session);
    await this._notifyKBPlugins('session-created', session, {
      requestedKbId: kbId || this.defaultKbId
    });
    await this._mountRepositoryIntoSession(session, kbId || this.defaultKbId, {
      discardDraft: true,
      reason: 'session-create'
    });
    await this._persistWorkspace(session);
    return session;
  }

  getSession(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) return null;
    if (new Date(s.expiresAt) < new Date()) {
      this._sessions.delete(sessionId);
      return null;
    }
    return s;
  }

  /**
   * Get detailed session status for better error messages.
   * @param {string} sessionId
   * @returns {{ found: boolean, expired: boolean, session: object|null }}
   */
  getSessionStatus(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) {
      return { found: false, expired: false, session: null };
    }
    if (new Date(s.expiresAt) < new Date()) {
      this._sessions.delete(sessionId);
      return { found: true, expired: true, session: null };
    }
    return { found: true, expired: false, session: s };
  }

  _requireActiveSession(sessionId) {
    const status = this.getSessionStatus(sessionId);
    if (!status.session) {
      if (!status.found) {
        throw new MRPError(
          'SESSION_NOT_FOUND',
          'conversation',
          `Session ${sessionId} not found. Sessions do not persist across server restarts. Please create a new session.`
        );
      }
      throw new MRPError(
        'SESSION_EXPIRED',
        'conversation',
        `Session ${sessionId} has expired due to inactivity. Please create a new session.`
      );
    }
    return status.session;
  }

  deleteSession(sessionId) {
    this._sessions.delete(sessionId);
    this.kbRepositoryManager?.removeWorkspace(sessionId);
  }

   async prepareTurn(
    sessionId,
    messages,
    model,
    kbId = null,
    plannerPlugin = null,
    seedDetectorPlugin = null,
    kbPlugin = null,
    goalSolverPlugin = null,
    deliberationLevel = null
  ) {
    let session;
    if (sessionId) {
      const status = this.getSessionStatus(sessionId);
      if (!status.session) {
        if (!status.found) {
          // Session not in memory - likely server restarted
          throw new MRPError('SESSION_NOT_FOUND', 'conversation',
            `Session ${sessionId} not found. Sessions do not persist across server restarts. Please create a new session.`);
        } else {
          // Session found but expired
          throw new MRPError('SESSION_EXPIRED', 'conversation',
            `Session ${sessionId} has expired due to inactivity. Please create a new session.`);
        }
      }
      session = status.session;
      this._setPendingTurnContext(session, []);
      if (kbId && kbId !== session.mountedKbId) {
        if (session.workspace?.dirty) {
          throw new MRPError('WORKSPACE_DIRTY_VALIDATION', 'conversation',
            `Session ${session.sessionId} has unsaved draft changes for KB '${session.mountedKbId}'`);
        }
        await this._mountRepositoryIntoSession(session, kbId, { discardDraft: true });
      }
    } else {
      session = await this.createSession(
        model,
        kbId,
        plannerPlugin,
        seedDetectorPlugin,
        kbPlugin,
        goalSolverPlugin,
        deliberationLevel
      );
    }
    const resolvedSelections = this._resolvePluginSelections({
      session,
      plannerPlugin,
      seedDetectorPlugin,
      kbPlugin,
      goalSolverPlugin
    });
    const resolvedDeliberationLevel = normalizeDeliberationLevel(
      deliberationLevel,
      session.preferredDeliberationLevel ?? 0
    );
    session.preferredDeliberationLevel = resolvedDeliberationLevel;
    // Process new messages
    let systemPrompt = session.systemPrompt;
    let currentMessage = null;
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
        session.systemPrompt = systemPrompt;
      } else if (msg.role === 'user') {
        currentMessage = msg.content;
      }
    }
    if (!currentMessage) throw new MRPError('SERVER_VALIDATION_NO_USER_MESSAGE', 'conversation', 'No user message found');
    // Build bounded history
    const historyForPrompt = this._buildHistory(session.messageLog);
    return {
      session,
      currentMessage,
      historyForPrompt,
      systemPrompt,
      requestedModel: model || session.preferredModel,
      explicitPlannerPlugin: plannerPlugin || null,
      explicitSeedDetectorPlugin: seedDetectorPlugin || null,
      explicitKBPlugin: kbPlugin || null,
      explicitGoalSolverPlugin: goalSolverPlugin || null,
      requestedDeliberationLevel: resolvedDeliberationLevel,
      requestedPlannerPlugin: resolvedSelections.plannerPlugin,
      requestedSeedDetectorPlugin: resolvedSelections.seedDetectorPlugin,
      requestedKBPlugin: resolvedSelections.kbPlugin,
      requestedGoalSolverPlugin: resolvedSelections.goalSolverPlugin
    };
  }

  async mountRepository(sessionId, kbId, options = {}) {
    const session = this._requireActiveSession(sessionId);
    await this._mountRepositoryIntoSession(session, kbId, {
      ...options,
      reason: options.reason || 'session-api'
    });
    await this._persistWorkspace(session);
    return this.getSessionMeta(sessionId);
  }

  async stageDetectedContextUnits(session, units, options = {}) {
    if (!session) return;
    this._setPendingTurnContext(session, units || []);
    if ((session.pendingTurnContextUnits || []).length === 0) return;
    await this._notifyKBPlugins('session-kus-added', session, {
      units: session.pendingTurnContextUnits,
      scope: options.scope || 'current-turn',
      reason: options.reason || 'seed-detection'
    });
  }

  clearPendingTurnContext(session) {
    if (!session) return;
    this._setPendingTurnContext(session, []);
  }

  async stageWorkspaceSource(sessionId, name, content, units, options = {}) {
    const session = this._requireActiveSession(sessionId);
    const meta = session.workspace.stageSource(name, content, units, options);
    await this._persistWorkspace(session);
    return meta;
  }

  async importSessionContext(sessionId, units, options = {}) {
    const session = this._requireActiveSession(sessionId);

    const existingHashes = new Set(session.sessionContextUnits.map(u => u.hash).filter(Boolean));
    const toAdd = [];
    for (const unit of units || []) {
      if (session.sessionContextUnits.length + toAdd.length >= this.maxContextUnits) break;
      if (!unit.hash || !existingHashes.has(unit.hash)) {
        toAdd.push(unit);
        if (unit.hash) existingHashes.add(unit.hash);
      }
    }

    session.sessionContextUnits.push(...toAdd);
    for (const unit of toAdd) session.sessionIndex.addUnit(unit);

    const now = new Date();
    session.lastActivityAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.ttlMinutes * 60000).toISOString();

    if (toAdd.length > 0) {
      await this._notifyKBPlugins('session-kus-added', session, {
        units: toAdd,
        scope: options.scope || 'committed-session',
        reason: options.reason || 'session-context-api'
      });
    }

    return this.getSessionMeta(sessionId);
  }

  async saveWorkspace(sessionId, options = {}) {
    const session = this._requireActiveSession(sessionId);
    if (!this.kbRepositoryManager) throw new MRPError('SESSION_INTERNAL_ERROR', 'conversation', 'KB repository manager not attached');
    const savingAsFork = !!(options.fork || (session.mountedKbId === this.defaultKbId && options.name));
    const snapshot = session.workspace.toSnapshot({
      includeConversationUnits: options.includeConversationUnits ?? true,
      conversationUnits: session.sessionContextUnits
    });
    let repoMeta;
    if (options.targetKbId) {
      repoMeta = await this.kbRepositoryManager.saveSnapshotToRepository(options.targetKbId, snapshot, { name: options.name });
    } else if (savingAsFork) {
      repoMeta = await this.kbRepositoryManager.createRepositoryFromSnapshot(
        options.name || `${session.mountedKbName || session.mountedKbId} fork`,
        snapshot,
        { parentKbId: session.mountedKbId }
      );
    } else {
      repoMeta = await this.kbRepositoryManager.saveSnapshotToRepository(session.mountedKbId, snapshot, { name: options.name });
    }
    this.kbRepositoryManager.promoteWorkspacePluginArtifacts(session.sessionId, repoMeta.kbId);
    await this._mountRepositoryIntoSession(session, repoMeta.kbId, {
      discardDraft: true,
      reason: savingAsFork ? 'save-fork' : 'save'
    });
    session.workspace.markSaved(repoMeta.updatedAt, repoMeta);
    await this._persistWorkspace(session);
    await this._notifyKBPlugins(
      savingAsFork ? 'kb-forked' : 'kb-saved',
      session,
      {
        kbId: repoMeta.kbId,
        kbName: repoMeta.name,
        repositoryMeta: repoMeta,
        snapshot
      }
    );
    return this.getSessionMeta(sessionId);
  }

  async forkWorkspace(sessionId, name) {
    const session = this._requireActiveSession(sessionId);
    if (!this.kbRepositoryManager) throw new MRPError('SESSION_INTERNAL_ERROR', 'conversation', 'KB repository manager not attached');
    const snapshot = session.workspace.toSnapshot({
      includeConversationUnits: true,
      conversationUnits: session.sessionContextUnits
    });
    const repoMeta = await this.kbRepositoryManager.createRepositoryFromSnapshot(
      name || `${session.mountedKbName || session.mountedKbId} fork`,
      snapshot,
      { parentKbId: session.mountedKbId }
    );
    this.kbRepositoryManager.promoteWorkspacePluginArtifacts(session.sessionId, repoMeta.kbId);
    await this._mountRepositoryIntoSession(session, repoMeta.kbId, {
      discardDraft: true,
      reason: 'fork'
    });
    session.workspace.markSaved(repoMeta.updatedAt, repoMeta);
    await this._persistWorkspace(session);
    await this._notifyKBPlugins('kb-forked', session, {
      kbId: repoMeta.kbId,
      kbName: repoMeta.name,
      repositoryMeta: repoMeta,
      snapshot
    });
    return this.getSessionMeta(sessionId);
  }

  async commitSuccessfulTurn(
    session,
    currentUserMessage,
    assistantMarkdown,
    currentTurnContextUnits,
    selectedModel,
    selectedPlannerPlugin = null,
    selectedSeedDetectorPlugin = null,
    selectedKBPlugin = null,
    selectedGoalSolverPlugin = null,
    executionRecord = null
  ) {
    session.messageLog.push({ role: 'user', content: currentUserMessage });
    session.messageLog.push({ role: 'assistant', content: assistantMarkdown });
    // Add context units (respecting limit and deduplicating by hash)
    const existingHashes = new Set(session.sessionContextUnits.map(u => u.hash));
    const toAdd = [];
    const stagedUnits = (currentTurnContextUnits || session.pendingTurnContextUnits || []);
    for (const u of stagedUnits) {
      if (!this._shouldPersistTurnUnit(u, currentUserMessage)) continue;
      if (session.sessionContextUnits.length + toAdd.length >= this.maxContextUnits) break;
      if (!u.hash || !existingHashes.has(u.hash)) {
        toAdd.push(u);
        if (u.hash) existingHashes.add(u.hash);
      }
    }
    session.sessionContextUnits.push(...toAdd);
    if (toAdd.length > 0 && session.workspace) session.workspace.dirty = true;
    // Update session index
    for (const u of toAdd) session.sessionIndex.addUnit(u);
    // Update preferences
    if (selectedModel) session.preferredModel = selectedModel;
    if (selectedPlannerPlugin) session.preferredPlannerPlugin = selectedPlannerPlugin;
    if (selectedSeedDetectorPlugin) session.preferredSeedDetectorPlugin = selectedSeedDetectorPlugin;
    if (selectedKBPlugin) session.preferredKBPlugin = selectedKBPlugin;
    if (selectedGoalSolverPlugin) session.preferredGoalSolverPlugin = selectedGoalSolverPlugin;
    if (executionRecord?.executionTrace?.deliberationLevel != null) {
      session.preferredDeliberationLevel = normalizeDeliberationLevel(
        executionRecord.executionTrace.deliberationLevel,
        session.preferredDeliberationLevel ?? 0
      );
    }
    this._appendExplainabilityEntry(session, {
      requestId: executionRecord?.requestId || null,
      createdAt: executionRecord?.createdAt || null,
      userMessage: currentUserMessage,
      assistantPreview: assistantMarkdown,
      answerStatus: executionRecord?.answerStatus || null,
      plannerPlugin: selectedPlannerPlugin || session.preferredPlannerPlugin || null,
      seedDetectorPlugin: selectedSeedDetectorPlugin || session.preferredSeedDetectorPlugin || null,
      kbPlugin: selectedKBPlugin || session.preferredKBPlugin || null,
      goalSolverPlugin: selectedGoalSolverPlugin || session.preferredGoalSolverPlugin || null,
      deliberationLevel: session.preferredDeliberationLevel ?? 0,
      responseDocument: executionRecord?.responseDocument || null,
      executionTrace: executionRecord?.executionTrace || null
    });
    const now = new Date();
    session.lastActivityAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.ttlMinutes * 60000).toISOString();
    if (toAdd.length > 0) {
      await this._notifyKBPlugins('session-kus-added', session, {
        units: toAdd,
        scope: 'committed-session',
        reason: 'turn-commit'
      });
    }
    this.clearPendingTurnContext(session);
    await this._persistWorkspace(session);
  }

  async commitFailedTurn(
    session,
    currentUserMessage,
    selectedModel,
    selectedPlannerPlugin = null,
    selectedSeedDetectorPlugin = null,
    selectedKBPlugin = null,
    selectedGoalSolverPlugin = null,
    executionRecord = null
  ) {
    if (selectedModel) session.preferredModel = selectedModel;
    if (selectedPlannerPlugin) session.preferredPlannerPlugin = selectedPlannerPlugin;
    if (selectedSeedDetectorPlugin) session.preferredSeedDetectorPlugin = selectedSeedDetectorPlugin;
    if (selectedKBPlugin) session.preferredKBPlugin = selectedKBPlugin;
    if (selectedGoalSolverPlugin) session.preferredGoalSolverPlugin = selectedGoalSolverPlugin;
    if (executionRecord?.executionTrace?.deliberationLevel != null) {
      session.preferredDeliberationLevel = normalizeDeliberationLevel(
        executionRecord.executionTrace.deliberationLevel,
        session.preferredDeliberationLevel ?? 0
      );
    }

    this._appendExplainabilityEntry(session, {
      requestId: executionRecord?.requestId || null,
      createdAt: executionRecord?.createdAt || null,
      userMessage: currentUserMessage,
      assistantPreview:
        executionRecord?.assistantPreview ||
        executionRecord?.error?.message ||
        '',
      answerStatus: executionRecord?.answerStatus || 'failed',
      plannerPlugin: selectedPlannerPlugin || session.preferredPlannerPlugin || null,
      seedDetectorPlugin: selectedSeedDetectorPlugin || session.preferredSeedDetectorPlugin || null,
      kbPlugin: selectedKBPlugin || session.preferredKBPlugin || null,
      goalSolverPlugin: selectedGoalSolverPlugin || session.preferredGoalSolverPlugin || null,
      deliberationLevel: session.preferredDeliberationLevel ?? 0,
      responseDocument: executionRecord?.responseDocument || null,
      executionTrace: executionRecord?.executionTrace || null,
      error: executionRecord?.error || null
    });
    const now = new Date();
    session.lastActivityAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.ttlMinutes * 60000).toISOString();
  }

  expireInactiveSessions() {
    const now = new Date();
    let count = 0;
    for (const [id, s] of this._sessions) {
      if (new Date(s.expiresAt) < now) {
        this._sessions.delete(id);
        this.kbRepositoryManager?.removeWorkspace(id);
        count++;
      }
    }
    return count;
  }

  _buildHistory(messageLog) {
    const result = [];
    let totalChars = 0;
    // Take from end, up to limits
    for (let i = messageLog.length - 1; i >= 0 && result.length < this.maxHistoryMessages; i--) {
      const msg = messageLog[i];
      if (totalChars + msg.content.length > this.maxHistoryChars) break;
      totalChars += msg.content.length;
      result.unshift(msg);
    }
    return result;
  }

  getSessionMeta(sessionId) {
    const s = this.getSession(sessionId);
    if (!s) return null;
    const workspaceStats = s.workspace?.getStats() || {};
    return {
      session_id: s.sessionId,
      created_at: s.createdAt,
      last_activity_at: s.lastActivityAt,
      expires_at: s.expiresAt,
      message_count: s.messageLog.length,
      session_context_unit_count: s.sessionContextUnits.length,
      pending_turn_context_unit_count: s.pendingTurnContextUnits?.length || 0,
      planner_plugin: s.preferredPlannerPlugin,
      seed_detector_plugin: s.preferredSeedDetectorPlugin,
      kb_plugin: s.preferredKBPlugin,
      goal_solver_plugin: s.preferredGoalSolverPlugin,
      deliberation_level: s.preferredDeliberationLevel ?? 0,
      model: s.preferredModel,
      kb_id: s.mountedKbId,
      kb_name: s.mountedKbName,
      workspace_dirty: !!workspaceStats.dirty,
      workspace_source_count: workspaceStats.sourceCount || 0,
      workspace_unit_count: workspaceStats.unitCount || 0,
      workspace_last_saved_at: workspaceStats.lastSavedAt || null,
      explainability_turn_count: s.explainabilityLog?.length || 0
    };
  }

  getExplainability(sessionId) {
    const session = this._requireActiveSession(sessionId);
    return (session.explainabilityLog || []).map(entry => ({
      requestId: entry.requestId,
      turnIndex: entry.turnIndex,
      createdAt: entry.createdAt,
      userMessage: entry.userMessage,
      assistantPreview: entry.assistantPreview,
      answerStatus: entry.answerStatus,
      plannerPlugin: entry.plannerPlugin,
      seedDetectorPlugin: entry.seedDetectorPlugin,
      kbPlugin: entry.kbPlugin,
      goalSolverPlugin: entry.goalSolverPlugin,
      deliberationLevel: entry.deliberationLevel ?? 0,
      responseDocument: this._cloneExplainabilityPayload(entry.responseDocument),
      executionTrace: this._cloneExplainabilityPayload(entry.executionTrace),
      error: this._cloneExplainabilityPayload(entry.error)
    }));
  }

  async _mountRepositoryIntoSession(session, kbId, options = {}) {
    if (!this.kbRepositoryManager) throw new MRPError('SESSION_INTERNAL_ERROR', 'conversation', 'KB repository manager not attached');
    if (session.workspace?.dirty && !options.discardDraft && session.mountedKbId && session.mountedKbId !== kbId) {
      throw new MRPError('WORKSPACE_DIRTY_VALIDATION', 'conversation',
        `Session ${session.sessionId} has unsaved draft changes for KB '${session.mountedKbId}'`);
    }
    const previousKbId = session.mountedKbId || null;
    const previousKbName = session.mountedKbName || null;
    const record = this.kbRepositoryManager.getRepository(kbId);
    const snapshot = await record.kb.exportSnapshot();
    session.workspace.mountFromSnapshot(record.meta, snapshot);
    this.kbRepositoryManager.hydrateWorkspacePluginArtifacts(session.sessionId, record.meta.kbId);
    session.mountedKbId = record.meta.kbId;
    session.mountedKbName = record.meta.name;
    if (options.notify !== false) {
      await this._notifyKBPlugins('kb-loaded', session, {
        kbId: record.meta.kbId,
        kbName: record.meta.name,
        previousKbId,
        previousKbName,
        repositoryMeta: record.meta,
        snapshot,
        reason: options.reason || 'mount'
      });
    }
  }

  async _persistWorkspace(session) {
    if (!this.kbRepositoryManager?.persistWorkspace) return;
    await this.kbRepositoryManager.persistWorkspace(session);
  }

  _setPendingTurnContext(session, units = []) {
    const nextUnits = (units || []).map(unit => ({
      ...unit,
      utilityActs: [...(unit.utilityActs || [])],
      phaseScopes: [...(unit.phaseScopes || [])]
    }));
    session.pendingTurnContextUnits = nextUnits;
    session.pendingTurnIndex = new KBIndex(this.kbRepositoryManager?.retrievalConfig || {});
    session.pendingTurnIndex.rebuild(nextUnits);
  }

  _shouldPersistTurnUnit(unit = null, currentUserMessage = '') {
    if (!unit) return false;
    if (!isTurnLocalGuidanceUnit(unit)) return true;
    const scopeText = [
      currentUserMessage,
      unit.claim || '',
      unit.procedure || '',
      unit.utilityNote || ''
    ].join(' ');
    return SESSION_WIDE_GUIDANCE_RE.test(scopeText);
  }

  async _notifyKBPlugins(eventType, session, payload = {}) {
    if (!this.pluginRegistry?.listByType || !this.pluginRegistry?.get) return [];
    const descriptors = this.pluginRegistry.listByType('kb-plugin');
    const results = [];
    for (const descriptor of descriptors) {
      const plugin = this.pluginRegistry.get('kb-plugin', descriptor.id);
      if (!plugin?.onSessionEvent) continue;
      const result = await plugin.onSessionEvent({
        eventType,
        sessionId: session.sessionId,
        kbId: payload.kbId ?? session.mountedKbId ?? null,
        kbName: payload.kbName ?? session.mountedKbName ?? null,
        requestedKbId: payload.requestedKbId || null,
        previousKbId: payload.previousKbId || null,
        previousKbName: payload.previousKbName || null,
        repositoryMeta: payload.repositoryMeta || null,
        workspaceStats: session.workspace?.getStats() || {},
        snapshot: payload.snapshot || null,
        units: payload.units || [],
        scope: payload.scope || null,
        reason: payload.reason || null
      }, {
        session,
        conversation: this,
        kbRepositoryManager: this.kbRepositoryManager,
        logger,
        hookType: 'session-lifecycle',
        eventType
      });
      if (result?.status === 'error') {
        throw new MRPError(
          'KB_PLUGIN_SESSION_EVENT_FAILED',
          MOD,
          `KB plugin '${descriptor.id}' failed during '${eventType}'`
        );
      }
      results.push({ pluginId: descriptor.id, status: result?.status || 'accepted' });
    }
    return results;
  }

  _cloneExplainabilityPayload(value) {
    if (value == null) return null;
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  _appendExplainabilityEntry(session, entry = {}) {
    if (!session?.explainabilityLog) return;
    const trimmedUserMessage = String(entry.userMessage || '').trim();
    const trimmedPreview = String(entry.assistantPreview || '').trim();
    if (!trimmedUserMessage && !entry.requestId) return;

    const nextEntry = {
      requestId: entry.requestId || null,
      turnIndex: entry.turnIndex || (session.explainabilityLog.length + 1),
      createdAt: entry.createdAt || new Date().toISOString(),
      userMessage: trimmedUserMessage,
      assistantPreview: trimmedPreview,
      answerStatus: entry.answerStatus || null,
      plannerPlugin: entry.plannerPlugin || null,
      seedDetectorPlugin: entry.seedDetectorPlugin || null,
      kbPlugin: entry.kbPlugin || null,
      goalSolverPlugin: entry.goalSolverPlugin || null,
      deliberationLevel: entry.deliberationLevel ?? 0,
      responseDocument: this._cloneExplainabilityPayload(entry.responseDocument),
      executionTrace: this._cloneExplainabilityPayload(entry.executionTrace),
      error: this._cloneExplainabilityPayload(entry.error)
    };
    session.explainabilityLog.push(nextEntry);
    if (session.explainabilityLog.length > this.maxExplainabilityEntries) {
      session.explainabilityLog.splice(0, session.explainabilityLog.length - this.maxExplainabilityEntries);
    }
  }
}
