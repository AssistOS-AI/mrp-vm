// DS019 — Conversation State
import { randomUUID } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { KBIndex } from '../retrieval/kb-index.mjs';
import { SessionWorkspace } from '../kb/session-workspace.mjs';

export class ConversationHandler {
  constructor(config = {}) {
    this.maxHistoryMessages = config.maxHistoryMessagesForPrompt || 20;
    this.maxHistoryChars = config.maxHistoryCharsForPrompt || 16000;
    this.ttlMinutes = config.sessionIdleTtlMinutes || 30;
    this.maxContextUnits = config.maxSessionContextUnits || 200;
    this.maxSessions = config.maxSessions || 1000;
    this.defaultProcessingMode = config.defaultProcessingMode || 'llm-assisted';
    this.defaultRetrievalProfile = config.defaultRetrievalProfile || 'balanced';
    this.defaultKbId = config.defaultKbId || 'default';
    this._sessions = new Map();
    this.kbRepositoryManager = null;
  }

  attachKBRepositoryManager(manager) {
    this.kbRepositoryManager = manager;
  }

  async createSession(model, processingMode, retrievalProfile, kbId = null) {
    if (this._sessions.size >= this.maxSessions) {
      this.expireInactiveSessions();
      if (this._sessions.size >= this.maxSessions) {
        throw new MRPError('SESSION_INTERNAL_LIMIT', 'conversation', 'Max sessions reached');
      }
    }
    const now = new Date();
    const session = {
      sessionId: `sess-${randomUUID().substring(0, 12)}`,
      createdAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMinutes * 60000).toISOString(),
      preferredModel: model || null,
      preferredProcessingMode: processingMode || this.defaultProcessingMode,
      preferredRetrievalProfile: retrievalProfile || this.defaultRetrievalProfile,
      messageLog: [],
      systemPrompt: null,
      sessionContextUnits: [],
      sessionIndex: new KBIndex(),
      mountedKbId: null,
      mountedKbName: null,
      workspace: new SessionWorkspace(`sess-${randomUUID().substring(0, 12)}`)
    };
    session.workspace = new SessionWorkspace(session.sessionId, this.kbRepositoryManager?.retrievalConfig || {});
    this._sessions.set(session.sessionId, session);
    await this._mountRepositoryIntoSession(session, kbId || this.defaultKbId, { discardDraft: true });
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

  deleteSession(sessionId) {
    this._sessions.delete(sessionId);
    this.kbRepositoryManager?.removeWorkspace(sessionId);
  }

  async prepareTurn(sessionId, messages, model, processingMode, retrievalProfile, kbId = null) {
    let session;
    if (sessionId) {
      session = this.getSession(sessionId);
      if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
      if (kbId && kbId !== session.mountedKbId) {
        if (session.workspace?.dirty) {
          throw new MRPError('WORKSPACE_DIRTY_VALIDATION', 'conversation',
            `Session ${session.sessionId} has unsaved draft changes for KB '${session.mountedKbId}'`);
        }
        await this._mountRepositoryIntoSession(session, kbId, { discardDraft: true });
      }
    } else {
      session = await this.createSession(model, processingMode, retrievalProfile, kbId);
    }
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
      requestedProcessingMode: processingMode || session.preferredProcessingMode,
      requestedRetrievalProfile: retrievalProfile || session.preferredRetrievalProfile
    };
  }

  async mountRepository(sessionId, kbId, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
    await this._mountRepositoryIntoSession(session, kbId, options);
    await this._persistWorkspace(session);
    return this.getSessionMeta(sessionId);
  }

  async stageWorkspaceSource(sessionId, name, content, units, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
    const meta = session.workspace.stageSource(name, content, units, options);
    await this._persistWorkspace(session);
    return meta;
  }

  async saveWorkspace(sessionId, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
    if (!this.kbRepositoryManager) throw new MRPError('SESSION_INTERNAL_ERROR', 'conversation', 'KB repository manager not attached');
    const snapshot = session.workspace.toSnapshot({
      includeConversationUnits: options.includeConversationUnits ?? true,
      conversationUnits: session.sessionContextUnits
    });
    let repoMeta;
    if (options.targetKbId) {
      repoMeta = await this.kbRepositoryManager.saveSnapshotToRepository(options.targetKbId, snapshot, { name: options.name });
    } else if (options.fork || session.mountedKbId === this.defaultKbId && options.name) {
      repoMeta = await this.kbRepositoryManager.createRepositoryFromSnapshot(
        options.name || `${session.mountedKbName || session.mountedKbId} fork`,
        snapshot,
        { parentKbId: session.mountedKbId }
      );
    } else {
      repoMeta = await this.kbRepositoryManager.saveSnapshotToRepository(session.mountedKbId, snapshot, { name: options.name });
    }
    await this._mountRepositoryIntoSession(session, repoMeta.kbId, { discardDraft: true });
    session.workspace.markSaved(repoMeta.updatedAt, repoMeta);
    await this._persistWorkspace(session);
    return this.getSessionMeta(sessionId);
  }

  async forkWorkspace(sessionId, name) {
    const session = this.getSession(sessionId);
    if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
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
    await this._mountRepositoryIntoSession(session, repoMeta.kbId, { discardDraft: true });
    session.workspace.markSaved(repoMeta.updatedAt, repoMeta);
    await this._persistWorkspace(session);
    return this.getSessionMeta(sessionId);
  }

  commitSuccessfulTurn(session, currentUserMessage, assistantMarkdown, currentTurnContextUnits, selectedModel, selectedProcessingMode, selectedRetrievalProfile) {
    session.messageLog.push({ role: 'user', content: currentUserMessage });
    session.messageLog.push({ role: 'assistant', content: assistantMarkdown });
    // Add context units (respecting limit and deduplicating by hash)
    const existingHashes = new Set(session.sessionContextUnits.map(u => u.hash));
    const toAdd = [];
    for (const u of (currentTurnContextUnits || [])) {
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
    if (selectedProcessingMode) session.preferredProcessingMode = selectedProcessingMode;
    if (selectedRetrievalProfile) session.preferredRetrievalProfile = selectedRetrievalProfile;
    const now = new Date();
    session.lastActivityAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.ttlMinutes * 60000).toISOString();
    void this._persistWorkspace(session);
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
      processing_mode: s.preferredProcessingMode,
      retrieval_profile: s.preferredRetrievalProfile,
      model: s.preferredModel,
      kb_id: s.mountedKbId,
      kb_name: s.mountedKbName,
      workspace_dirty: !!workspaceStats.dirty,
      workspace_source_count: workspaceStats.sourceCount || 0,
      workspace_unit_count: workspaceStats.unitCount || 0,
      workspace_last_saved_at: workspaceStats.lastSavedAt || null
    };
  }

  async _mountRepositoryIntoSession(session, kbId, options = {}) {
    if (!this.kbRepositoryManager) throw new MRPError('SESSION_INTERNAL_ERROR', 'conversation', 'KB repository manager not attached');
    if (session.workspace?.dirty && !options.discardDraft && session.mountedKbId && session.mountedKbId !== kbId) {
      throw new MRPError('WORKSPACE_DIRTY_VALIDATION', 'conversation',
        `Session ${session.sessionId} has unsaved draft changes for KB '${session.mountedKbId}'`);
    }
    const record = this.kbRepositoryManager.getRepository(kbId);
    const snapshot = await record.kb.exportSnapshot();
    session.workspace.mountFromSnapshot(record.meta, snapshot);
    session.mountedKbId = record.meta.kbId;
    session.mountedKbName = record.meta.name;
  }

  async _persistWorkspace(session) {
    if (!this.kbRepositoryManager?.persistWorkspace) return;
    await this.kbRepositoryManager.persistWorkspace(session);
  }
}
