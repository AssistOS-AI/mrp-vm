// DS019 — Conversation State
import { randomUUID } from 'node:crypto';
import { MRPError } from '../lib/errors.mjs';
import { KBIndex } from '../retrieval/kb-index.mjs';

export class ConversationHandler {
  constructor(config = {}) {
    this.maxHistoryMessages = config.maxHistoryMessagesForPrompt || 20;
    this.maxHistoryChars = config.maxHistoryCharsForPrompt || 16000;
    this.ttlMinutes = config.sessionIdleTtlMinutes || 30;
    this.maxContextUnits = config.maxSessionContextUnits || 200;
    this.maxSessions = config.maxSessions || 1000;
    this.defaultProcessingMode = config.defaultProcessingMode || 'llm-assisted';
    this.defaultRetrievalProfile = config.defaultRetrievalProfile || 'balanced';
    this._sessions = new Map();
  }

  createSession(model, processingMode, retrievalProfile) {
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
      sessionIndex: new KBIndex()
    };
    this._sessions.set(session.sessionId, session);
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

  deleteSession(sessionId) { this._sessions.delete(sessionId); }

  prepareTurn(sessionId, messages, model, processingMode, retrievalProfile) {
    let session;
    if (sessionId) {
      session = this.getSession(sessionId);
      if (!session) throw new MRPError('SESSION_EXPIRED', 'conversation', `Session ${sessionId} expired or not found`);
    } else {
      session = this.createSession(model, processingMode, retrievalProfile);
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

  commitSuccessfulTurn(session, currentUserMessage, assistantMarkdown, currentTurnContextUnits, selectedModel, selectedProcessingMode, selectedRetrievalProfile) {
    session.messageLog.push({ role: 'user', content: currentUserMessage });
    session.messageLog.push({ role: 'assistant', content: assistantMarkdown });
    // Add context units (respecting limit)
    const remaining = this.maxContextUnits - session.sessionContextUnits.length;
    const toAdd = (currentTurnContextUnits || []).slice(0, Math.max(0, remaining));
    session.sessionContextUnits.push(...toAdd);
    // Update session index
    for (const u of toAdd) session.sessionIndex.addUnit(u);
    // Update preferences
    if (selectedModel) session.preferredModel = selectedModel;
    if (selectedProcessingMode) session.preferredProcessingMode = selectedProcessingMode;
    if (selectedRetrievalProfile) session.preferredRetrievalProfile = selectedRetrievalProfile;
    const now = new Date();
    session.lastActivityAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + this.ttlMinutes * 60000).toISOString();
  }

  expireInactiveSessions() {
    const now = new Date();
    let count = 0;
    for (const [id, s] of this._sessions) {
      if (new Date(s.expiresAt) < now) { this._sessions.delete(id); count++; }
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
    return {
      session_id: s.sessionId,
      created_at: s.createdAt,
      last_activity_at: s.lastActivityAt,
      expires_at: s.expiresAt,
      message_count: s.messageLog.length,
      session_context_unit_count: s.sessionContextUnits.length,
      processing_mode: s.preferredProcessingMode,
      retrieval_profile: s.preferredRetrievalProfile,
      model: s.preferredModel
    };
  }
}
