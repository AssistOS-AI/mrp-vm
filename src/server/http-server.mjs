// DS013 — Native HTTP Server & API
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MRPError, httpStatusForCode } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;
const UI_DIR = resolve(__dirname, '../ui');
const MOD = 'server';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript' };

export class MRPServer {
  constructor(engine, kbRepositoryManager, conversationHandler, llmBridge, strategyRegistry, retrievalStrategyRegistry, config) {
    this.engine = engine;
    this.kbRepositoryManager = kbRepositoryManager;
    this.conversation = conversationHandler;
    this.llmBridge = llmBridge;
    this.strategyRegistry = strategyRegistry;
    this.retrievalStrategyRegistry = retrievalStrategyRegistry;
    this.config = config;
    this.maxBodySize = config.maxBodySizeBytes || 2097152;
    this.corsOrigin = config.cors?.origin || '*';
    this.server = null;
  }

  start() {
    const port = this.config.port || 3000;
    const host = this.config.host || '127.0.0.1';
    this.server = createServer((req, res) => this._handle(req, res));
    this.server.listen(port, host, () => {
      logger.info(MOD, `Server listening on ${host}:${port}`);
    });
    return this.server;
  }

  async _handle(req, res) {
    const reqId = `req-${randomUUID().substring(0, 8)}`;
    this._setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      logger.debug(MOD, `${req.method} ${path}`, {}, { reqId });
      // Static UI files
      if (req.method === 'GET' && (path === '/' || path.startsWith('/ui/'))) {
        return this._serveStatic(path, res);
      }
      // API routes
      if (path === '/chat/completions' && req.method === 'POST') return await this._chatCompletions(req, res, reqId);
      if (path === '/sessions' && req.method === 'POST') return await this._createSession(req, res);
      if (path.match(/^\/sessions\/[^/]+$/) && req.method === 'GET') return this._getSession(path, res);
      if (path.match(/^\/sessions\/[^/]+$/) && req.method === 'DELETE') return this._deleteSession(path, res);
      if (path === '/models' && req.method === 'GET') return this._getModels(res);
      if (path === '/processing-strategies' && req.method === 'GET') return this._getStrategies(res);
      if (path === '/retrieval-profiles' && req.method === 'GET') return this._getRetrievalProfiles(res);
      if (path === '/kbs' && req.method === 'GET') return this._listKbs(res);
      if (path.match(/^\/sessions\/[^/]+\/kb\/mount$/) && req.method === 'POST') return await this._mountKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/kb\/fork$/) && req.method === 'POST') return await this._forkKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/kb\/save$/) && req.method === 'POST') return await this._saveKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/workspace$/) && req.method === 'GET') return this._getWorkspace(path, res);
      if (path.match(/^\/sessions\/[^/]+\/workspace\/sources$/) && req.method === 'POST') return await this._stageWorkspaceSource(req, res, path);
      if (path === '/health' && req.method === 'GET') return this._json(res, 200, { status: 'ok' });
      if (path === '/ready' && req.method === 'GET') return this._readiness(res);
      this._json(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint', type: 'invalid_request' } });
    } catch (e) {
      this._handleError(res, e, reqId);
    }
  }

  async _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > this.maxBodySize) { reject(new MRPError('SERVER_VALIDATION_BODY_TOO_LARGE', MOD, 'Body too large')); req.destroy(); return; }
        body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  async _chatCompletions(req, res, reqId) {
    const body = JSON.parse(await this._readBody(req));
    if (body.stream === true) return this._json(res, 400, { error: { code: 'STREAM_NOT_SUPPORTED', message: 'Streaming not supported in v1', type: 'invalid_request' } });
    // Validate roles
    for (const m of body.messages || []) {
      if (!['user', 'system'].includes(m.role)) return this._json(res, 400, { error: { code: 'INVALID_ROLE', message: `Unsupported role: ${m.role}`, type: 'invalid_request' } });
    }
    if (!(body.messages || []).some(m => m.role === 'user')) return this._json(res, 400, { error: { code: 'NO_USER_MESSAGE', message: 'At least one user message required', type: 'invalid_request' } });
    // Validate model + strategy compatibility
    if (body.processing_mode === 'symbolic-only' && body.model) {
      return this._json(res, 400, { error: { code: 'STRATEGY_DOES_NOT_ACCEPT_MODEL', message: 'symbolic-only does not accept model override', type: 'invalid_request' } });
    }
    // Validate processing_mode if provided
    if (body.processing_mode && !this.strategyRegistry.get(body.processing_mode)) {
      return this._json(res, 400, { error: { code: 'INVALID_PROCESSING_MODE', message: `Unknown processing mode: ${body.processing_mode}`, type: 'invalid_request' } });
    }
    // Validate retrieval_profile if provided
    if (body.retrieval_profile && !this.retrievalStrategyRegistry.getProfile(body.retrieval_profile)) {
      return this._json(res, 400, { error: { code: 'INVALID_RETRIEVAL_PROFILE', message: `Unknown retrieval profile: ${body.retrieval_profile}`, type: 'invalid_request' } });
    }
    const result = await this.engine.processChatTurn(body);
    const session = this.conversation.getSession(result.sessionId);
    this._json(res, 200, {
      id: `mrp-${reqId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      session_id: result.sessionId,
      processing_mode: session?.preferredProcessingMode || body.processing_mode,
      retrieval_profile: session?.preferredRetrievalProfile || body.retrieval_profile,
      expires_at: session?.expiresAt,
      choices: [{ index: 0, message: { role: 'assistant', content: result.responseMarkdown }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      response_document: result.responseDocument || null,
      kb_id: session?.mountedKbId || body.kb_id || null,
      kb_name: session?.mountedKbName || null,
      workspace_dirty: !!session?.workspace?.dirty
    });
  }

  async _createSession(req, res) {
    const body = JSON.parse(await this._readBody(req));
    if (body.processing_mode === 'symbolic-only' && body.model) {
      return this._json(res, 400, { error: { code: 'STRATEGY_DOES_NOT_ACCEPT_MODEL', message: 'symbolic-only does not accept model override', type: 'invalid_request' } });
    }
    // Validate processing_mode if provided
    if (body.processing_mode && !this.strategyRegistry.get(body.processing_mode)) {
      return this._json(res, 400, { error: { code: 'INVALID_PROCESSING_MODE', message: `Unknown processing mode: ${body.processing_mode}`, type: 'invalid_request' } });
    }
    // Validate retrieval_profile if provided
    if (body.retrieval_profile && !this.retrievalStrategyRegistry.getProfile(body.retrieval_profile)) {
      return this._json(res, 400, { error: { code: 'INVALID_RETRIEVAL_PROFILE', message: `Unknown retrieval profile: ${body.retrieval_profile}`, type: 'invalid_request' } });
    }
    if (body.kb_id) {
      try { this.kbRepositoryManager.getRepository(body.kb_id); } catch (e) { return this._handleError(res, e); }
    }
    const session = await this.conversation.createSession(body.model, body.processing_mode, body.retrieval_profile, body.kb_id || null);
    const workspaceStats = session.workspace?.getStats() || {};
    this._json(res, 200, {
      session_id: session.sessionId,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      processing_mode: session.preferredProcessingMode,
      retrieval_profile: session.preferredRetrievalProfile,
      model: session.preferredModel,
      kb_id: session.mountedKbId,
      kb_name: session.mountedKbName,
      workspace_dirty: !!workspaceStats.dirty
    });
  }

  _getSession(path, res) {
    const id = path.split('/').pop();
    const meta = this.conversation.getSessionMeta(id);
    if (!meta) return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    this._json(res, 200, meta);
  }

  _deleteSession(path, res) {
    const id = path.split('/').pop();
    this.conversation.deleteSession(id);
    res.writeHead(204); res.end();
  }

  _getModels(res) {
    const models = this.llmBridge?.getAvailableModels() || [];
    this._json(res, 200, { models });
  }

  _getStrategies(res) {
    const strategies = this.strategyRegistry.list().map(s => ({
      id: s.id, uses_llm: s.usesLLM, supports_model_override: s.supportsModelOverride, capabilities: s.capabilities
    }));
    this._json(res, 200, { strategies });
  }

  _getRetrievalProfiles(res) {
    const profiles = this.retrievalStrategyRegistry.listProfiles();
    this._json(res, 200, { profiles });
  }

  _listKbs(res) {
    this._json(res, 200, {
      kbs: this.kbRepositoryManager.listRepositories()
    });
  }

  _getWorkspace(path, res) {
    const sessionId = path.split('/')[2];
    const session = this.conversation.getSession(sessionId);
    if (!session) return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    this._json(res, 200, {
      session_id: session.sessionId,
      kb_id: session.mountedKbId,
      kb_name: session.mountedKbName,
      workspace: {
        ...session.workspace.getStats(),
        sources: session.workspace.getSources()
      }
    });
  }

  async _mountKb(req, res, path) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    if (!body.kb_id) return this._json(res, 400, { error: { code: 'KB_VALIDATION_MISSING_ID', message: 'kb_id is required', type: 'invalid_request' } });
    const meta = await this.conversation.mountRepository(sessionId, body.kb_id, { discardDraft: !!body.discard_draft });
    this._json(res, 200, meta);
  }

  async _forkKb(req, res, path) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    const meta = await this.conversation.forkWorkspace(sessionId, body.name || null);
    this._json(res, 200, meta);
  }

  async _saveKb(req, res, path) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    const meta = await this.conversation.saveWorkspace(sessionId, {
      targetKbId: body.target_kb_id || null,
      name: body.name || null,
      fork: !!body.fork,
      includeConversationUnits: body.include_conversation_units !== false
    });
    this._json(res, 200, meta);
  }

  async _stageWorkspaceSource(req, res, path) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    if (!body.name || !body.content) {
      return this._json(res, 400, { error: { code: 'INVALID_INPUT', message: 'name and content required', type: 'invalid_request' } });
    }
    const defaultMode = this.config.defaultIngestMode || 'llm-assisted';
    const strategy = this.strategyRegistry.resolve(body.processing_mode || null, null, defaultMode);
    const session = this.conversation.getSession(sessionId);
    if (!session) return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    const sourceId = body.source_id || null;
    const effectiveSourceId = sourceId || `src-${randomUUID().substring(0, 10)}`;
    const { units } = await this.kbRepositoryManager.ingestor.ingest(effectiveSourceId, body.content, body.name, strategy);
    const meta = await this.conversation.stageWorkspaceSource(sessionId, body.name, body.content, units, { sourceId: effectiveSourceId });
    const workspace = session.workspace.getStats();
    this._json(res, 200, {
      sourceId: meta.sourceId,
      name: meta.name,
      unitCount: meta.unitCount,
      kb_id: session.mountedKbId,
      workspace_dirty: workspace.dirty
    });
  }

  _readiness(res) {
    const checks = {
      config: true,
      kb: true,
      index: true,
      sessions: true,
      wrappers: true
    };
    const ready = this.engine.isReady();
    this._json(res, ready ? 200 : 503, { ready, checks });
  }

  _serveStatic(path, res) {
    let filePath = path === '/' ? 'index.html' : path.replace(/^\/ui\//, '');
    filePath = join(UI_DIR, filePath);
    if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
  }

  _json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  _setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  _handleError(res, e, reqId) {
    logger.error(MOD, e.message, { code: e.code, reqId });
    if (e instanceof MRPError) {
      const status = httpStatusForCode(e.code);
      this._json(res, status, { error: { code: e.code, message: e.message, type: 'processing_error' } });
    } else {
      this._json(res, 500, { error: { code: 'SERVER_INTERNAL_ERROR', message: e.message, type: 'server_error' } });
    }
  }
}
