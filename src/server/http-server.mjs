// DS013 — Native HTTP Server & API
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MRPError, httpStatusForCode } from '../core/platform/errors.mjs';
import { logger } from '../core/platform/logger.mjs';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;
const UI_DIR = resolve(__dirname, './ui');
const MOD = 'server';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript'
};

export class MRPServer {
  constructor(engine, kbRepositoryManager, conversationHandler, llmBridge,
    pluginRegistry, llmRoleSettings, config) {
    this.engine = engine;
    this.kbRepositoryManager = kbRepositoryManager;
    this.conversation = conversationHandler;
    this.llmBridge = llmBridge;
    this.pluginRegistry = pluginRegistry;
    this.llmRoleSettings = llmRoleSettings;
    this.config = config;
    this.maxBodySize = config.maxBodySizeBytes || 2097152;
    this.corsOrigin = config.cors?.origin || '*';
    this.server = null;
  }

  start() {
    const port = this.config.port ?? 3000;
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
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      logger.debug(MOD, `${req.method} ${path}`, {}, { reqId });
      if (req.method === 'GET' && (path === '/' || path.startsWith('/ui/'))) {
        return this._serveStatic(path, res);
      }
      if (path === '/chat/completions' && req.method === 'POST') return await this._chatCompletions(req, res, reqId);
      if (path === '/sessions' && req.method === 'POST') return await this._createSession(req, res);
      if (path.match(/^\/sessions\/[^/]+$/) && req.method === 'GET') return this._getSession(path, res);
      if (path.match(/^\/sessions\/[^/]+$/) && req.method === 'DELETE') return this._deleteSession(path, res);
      if (path.match(/^\/sessions\/[^/]+\/explainability$/) && req.method === 'GET') return this._getExplainability(path, res);
      if (path === '/models' && req.method === 'GET') return this._getModels(res);
      if (path === '/plugins' && req.method === 'GET') return this._getPlugins(url, res);
      if (path === '/settings/llm-roles' && req.method === 'GET') return this._getLLMRoleSettings(res);
      if (path === '/settings/llm-roles' && req.method === 'PUT') return await this._updateLLMRoleSettings(req, res);
      if (path === '/kbs' && req.method === 'GET') return this._listKbs(res);
      if (path === '/kbs' && req.method === 'POST') return await this._createKb(req, res);
      if (path.match(/^\/sessions\/[^/]+\/kb\/load$/) && req.method === 'POST') return await this._mountKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/kb\/mount$/) && req.method === 'POST') return await this._mountKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/kb\/fork$/) && req.method === 'POST') return await this._forkKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/kb\/save$/) && req.method === 'POST') return await this._saveKb(req, res, path);
      if (path.match(/^\/sessions\/[^/]+\/context$/) && req.method === 'POST') return await this._loadSessionContext(req, res, path, reqId);
      if (path.match(/^\/sessions\/[^/]+\/workspace$/) && req.method === 'GET') return this._getWorkspace(path, res);
      if (path.match(/^\/sessions\/[^/]+\/workspace\/sources$/) && req.method === 'POST') return await this._stageWorkspaceSource(req, res, path, reqId);
      if (path === '/eval-sources' && req.method === 'GET') return this._listEvalSources(res);
      if (path === '/health' && req.method === 'GET') return this._json(res, 200, { status: 'ok' });
      if (path === '/ready' && req.method === 'GET') return this._readiness(res);
      this._json(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint', type: 'invalid_request' } });
    } catch (error) {
      this._handleError(res, error, reqId);
    }
  }

  async _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > this.maxBodySize) {
          reject(new MRPError('SERVER_VALIDATION_BODY_TOO_LARGE', MOD, 'Body too large'));
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  _validatePlugin(type, id, errorCode) {
    if (!id) return null;
    const plugin = this.pluginRegistry.get(type, id);
    if (!plugin) {
      const code = errorCode.includes('VALIDATION') ? errorCode : `${errorCode}_VALIDATION`;
      throw new MRPError(code, MOD, `Unknown ${type}: ${id}`);
    }
    return plugin;
  }

  async _chatCompletions(req, res, reqId) {
    const body = JSON.parse(await this._readBody(req));
    if (body.session_id === 'null' || body.session_id === 'undefined') body.session_id = null;
    for (const message of body.messages || []) {
      if (!['user', 'system'].includes(message.role)) {
        return this._json(res, 400, { error: { code: 'INVALID_ROLE', message: `Unsupported role: ${message.role}`, type: 'invalid_request' } });
      }
    }
    if (!(body.messages || []).some(message => message.role === 'user')) {
      return this._json(res, 400, { error: { code: 'NO_USER_MESSAGE', message: 'At least one user message required', type: 'invalid_request' } });
    }
    try {
      this._validatePlugin('mrp-plan-plugin', body.planner_plugin, 'INVALID_PLANNER_PLUGIN');
      this._validatePlugin('sd-plugin', body.seed_detector_plugin, 'INVALID_SEED_DETECTOR_PLUGIN');
      this._validatePlugin('kb-plugin', body.kb_plugin, 'INVALID_KB_PLUGIN');
      this._validatePlugin('gs-plugin', body.goal_solver_plugin, 'INVALID_GOAL_SOLVER_PLUGIN');
    } catch (error) {
      return this._handleError(res, error, reqId);
    }

    if (body.stream === true) {
      return this._streamChatCompletions(body, res, reqId);
    }

    const result = await this.engine.processChatTurn(body);
    const session = this.conversation.getSession(result.sessionId);
    this._json(res, 200, this._buildChatCompletionPayload(body, result, session, reqId));
  }

  _buildChatCompletionPayload(body, result, session, reqId) {
    return {
      id: `mrp-${reqId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      request_id: result.requestId || null,
      session_id: result.sessionId,
      planner_plugin: session?.preferredPlannerPlugin || body.planner_plugin || result.executionTrace?.plannerPluginId || null,
      seed_detector_plugin: session?.preferredSeedDetectorPlugin || body.seed_detector_plugin || null,
      kb_plugin: session?.preferredKBPlugin || body.kb_plugin || null,
      goal_solver_plugin: session?.preferredGoalSolverPlugin || body.goal_solver_plugin || null,
      expires_at: session?.expiresAt,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.responseMarkdown },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      response_document: result.responseDocument || null,
      execution_trace: result.executionTrace || null,
      kb_id: session?.mountedKbId || body.kb_id || null,
      kb_name: session?.mountedKbName || null,
      workspace_dirty: !!session?.workspace?.dirty
    };
  }

  _streamEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  _chunkResponseText(text, chunkSize = 160) {
    if (!text) return [];
    const chunks = [];
    for (let index = 0; index < text.length; index += chunkSize) {
      chunks.push(text.slice(index, index + chunkSize));
    }
    return chunks;
  }

  async _streamChatCompletions(body, res, reqId) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      if (res.writableEnded) return;
      this._streamEvent(res, event, data);
    };

    send('response.started', {
      id: `mrp-${reqId}`,
      request_id: reqId
    });

    try {
      const result = await this.engine.processChatTurn({
        ...body,
        onProgress: progress => send('progress', progress)
      });
      const session = this.conversation.getSession(result.sessionId);
      const payload = this._buildChatCompletionPayload(body, result, session, reqId);
      const content = payload.choices?.[0]?.message?.content || '';

      send('response.meta', {
        session_id: payload.session_id,
        planner_plugin: payload.planner_plugin,
        seed_detector_plugin: payload.seed_detector_plugin,
        kb_plugin: payload.kb_plugin,
        goal_solver_plugin: payload.goal_solver_plugin,
        kb_id: payload.kb_id,
        kb_name: payload.kb_name
      });

      for (const chunk of this._chunkResponseText(content)) {
        send('response.delta', { delta: chunk });
      }

      send('response.completed', payload);
      send('done', { request_id: reqId });
      res.end();
    } catch (error) {
      logger.error(MOD, error.message, { code: error.code, reqId });
      if (error instanceof MRPError) {
        error.requestId = error.requestId || reqId;
        send('error', { error: { ...error.toJSON(), type: 'processing_error' } });
      } else {
        send('error', {
          error: {
            code: 'SERVER_INTERNAL_ERROR',
            message: error.message,
            type: 'server_error'
          }
        });
      }
      res.end();
    }
  }

  async _createSession(req, res) {
    const body = JSON.parse(await this._readBody(req));
    try {
      this._validatePlugin('mrp-plan-plugin', body.planner_plugin, 'INVALID_PLANNER_PLUGIN');
      this._validatePlugin('sd-plugin', body.seed_detector_plugin, 'INVALID_SEED_DETECTOR_PLUGIN');
      this._validatePlugin('kb-plugin', body.kb_plugin, 'INVALID_KB_PLUGIN');
      this._validatePlugin('gs-plugin', body.goal_solver_plugin, 'INVALID_GOAL_SOLVER_PLUGIN');
      if (body.kb_id) this.kbRepositoryManager.getRepository(body.kb_id);
    } catch (error) {
      return this._handleError(res, error);
    }
    const session = await this.conversation.createSession(
      body.model,
      body.kb_id || null,
      body.planner_plugin || null,
      body.seed_detector_plugin || null,
      body.kb_plugin || null,
      body.goal_solver_plugin || null
    );
    const workspaceStats = session.workspace?.getStats() || {};
    this._json(res, 200, {
      session_id: session.sessionId,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      planner_plugin: session.preferredPlannerPlugin,
      seed_detector_plugin: session.preferredSeedDetectorPlugin,
      kb_plugin: session.preferredKBPlugin,
      goal_solver_plugin: session.preferredGoalSolverPlugin,
      model: session.preferredModel,
      kb_id: session.mountedKbId,
      kb_name: session.mountedKbName,
      workspace_dirty: !!workspaceStats.dirty
    });
  }

  _getSession(path, res) {
    const id = path.split('/').pop();
    try {
      const session = this.conversation._requireActiveSession(id);
      const meta = this.conversation.getSessionMeta(session.sessionId);
      this._json(res, 200, meta);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  _deleteSession(path, res) {
    const id = path.split('/').pop();
    this.conversation.deleteSession(id);
    res.writeHead(204);
    res.end();
  }

  _getExplainability(path, res) {
    const sessionId = path.split('/')[2];
    try {
      const turns = this.conversation.getExplainability(sessionId);
      this._json(res, 200, {
        session_id: sessionId,
        turn_count: turns.length,
        turns
      });
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  _getModels(res) {
    const models = this.llmBridge?.getAvailableModels() || [];
    this._json(res, 200, { models });
  }

  _getPlugins(url, res) {
    const type = url.searchParams.get('type');
    const plugins = this.pluginRegistry.list(type || null);
    this._json(res, 200, { plugins });
  }

  _getLLMRoleSettings(res) {
    this._json(res, 200, this.llmRoleSettings.getSnapshot());
  }

  async _updateLLMRoleSettings(req, res) {
    const body = JSON.parse(await this._readBody(req));
    const snapshot = this.llmRoleSettings.update(body || {});
    this._json(res, 200, snapshot);
  }

  _listKbs(res) {
    this._json(res, 200, { kbs: this.kbRepositoryManager.listRepositories() });
  }

  async _createKb(req, res) {
    const body = JSON.parse(await this._readBody(req));
    const name = String(body.name || '').trim();
    if (!name) {
      return this._json(res, 400, {
        error: {
          code: 'KB_VALIDATION_MISSING_NAME',
          message: 'name is required',
          type: 'invalid_request'
        }
      });
    }
    const meta = await this.kbRepositoryManager.createEmptyRepository(name);
    this._json(res, 200, {
      id: meta.kbId,
      kb_id: meta.kbId,
      kb_name: meta.name,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
      parent_kb_id: meta.parentKbId || null,
      is_default: !!meta.isDefault
    });
  }

  _getWorkspace(path, res) {
    const sessionId = path.split('/')[2];
    try {
      const session = this.conversation._requireActiveSession(sessionId);
      this._json(res, 200, {
        session_id: session.sessionId,
        kb_id: session.mountedKbId,
        kb_name: session.mountedKbName,
        workspace: {
          ...session.workspace.getStats(),
          sources: session.workspace.getSources()
        }
      });
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  async _mountKb(req, res, path) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    if (!body.kb_id) {
      return this._json(res, 400, { error: { code: 'KB_VALIDATION_MISSING_ID', message: 'kb_id is required', type: 'invalid_request' } });
    }
    const meta = await this.conversation.mountRepository(sessionId, body.kb_id, {
      discardDraft: !!body.discard_draft,
      reason: path.endsWith('/load') ? 'load-api' : 'mount-api'
    });
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

  async _stageWorkspaceSource(req, res, path, reqId = null) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    if (!body.name || !body.content) {
      return this._json(res, 400, { error: { code: 'INVALID_INPUT', message: 'name and content required', type: 'invalid_request' } });
    }
    let session;
    try {
      session = this.conversation._requireActiveSession(sessionId);
    } catch (error) {
      return this._handleError(res, error, reqId);
    }

    const seedDetectorPluginId = body.seed_detector_plugin || session.preferredSeedDetectorPlugin || 'sd-symbolic';
    const seedPlugin = this.pluginRegistry.get('sd-plugin', seedDetectorPluginId);
    if (!seedPlugin) {
      return this._json(res, 400, { error: { code: 'INVALID_SEED_DETECTOR_PLUGIN', message: `Unknown seed detector plugin: ${seedDetectorPluginId}`, type: 'invalid_request' } });
    }

    const sourceId = body.source_id || null;
    const effectiveSourceId = sourceId || `src-${randomUUID().substring(0, 10)}`;
    const ingestStrategy = seedPlugin.createIngestStrategy(
      { modelSettings: this.llmRoleSettings },
      body.model || null,
      session.preferredModel
    );
    logger.debug(MOD, 'Workspace source ingest started', {
      reqId,
      sessionId,
      sourceId: effectiveSourceId,
      sourceName: body.name,
      seedDetectorPlugin: seedDetectorPluginId
    });
    const ingestStartedAt = Date.now();
    const { units } = await this.kbRepositoryManager.ingestor.ingest(
      effectiveSourceId,
      body.content,
      body.name,
      ingestStrategy
    );
    logger.debug(MOD, 'Workspace source ingest completed', {
      reqId,
      sessionId,
      sourceId: effectiveSourceId,
      unitCount: units.length,
      durationMs: Date.now() - ingestStartedAt
    });
    const meta = await this.conversation.stageWorkspaceSource(
      sessionId,
      body.name,
      body.content,
      units,
      { sourceId: effectiveSourceId }
    );

    const ingestCtx = {
      requestId: `ingest-${randomUUID().substring(0, 8)}`,
      session,
      conversation: this.conversation,
      parser: this.engine?.parser || null,
      decomposer: this.engine?.decomposer || null,
      externalHelpers: this.engine?.externalPluginManager || null,
      modelSettings: this.llmRoleSettings,
      logger,
      budgets: {
        maxLLMAttemptsPerRequest: this.engine?.maxLLMAttempts ?? null,
        requestTimeoutMs: this.engine?.requestTimeout ?? null,
        maxPluginsPerStage: this.engine?.maxPluginsPerStage ?? null
      },
      kbRepositoryManager: this.kbRepositoryManager,
      hookType: 'source-text'
    };

    for (const plugin of this.pluginRegistry.listByType('kb-plugin')) {
      const instance = this.pluginRegistry.get('kb-plugin', plugin.id);
      const hookStartedAt = Date.now();
      logger.debug(MOD, 'Running kb-plugin source-text hook', {
        reqId,
        sessionId,
        sourceId: effectiveSourceId,
        pluginId: plugin.id
      });
      await instance?.onSourceText?.({
        sourceId: effectiveSourceId,
        name: body.name,
        content: body.content,
        units,
        sessionId
      }, ingestCtx);
      logger.debug(MOD, 'Completed kb-plugin source-text hook', {
        reqId,
        sessionId,
        sourceId: effectiveSourceId,
        pluginId: plugin.id,
        durationMs: Date.now() - hookStartedAt
      });
    }

    const workspace = session.workspace.getStats();
    logger.debug(MOD, 'Workspace source staged', {
      reqId,
      sessionId,
      sourceId: meta.sourceId,
      unitCount: meta.unitCount,
      workspaceDirty: workspace.dirty
    });
    this._json(res, 200, {
      sourceId: meta.sourceId,
      name: meta.name,
      unitCount: meta.unitCount,
      kb_id: session.mountedKbId,
      workspace_dirty: workspace.dirty,
      seed_detector_plugin: seedDetectorPluginId
    });
  }

  async _loadSessionContext(req, res, path, reqId = null) {
    const sessionId = path.split('/')[2];
    const body = JSON.parse(await this._readBody(req));
    if (!body.content) {
      return this._json(res, 400, { error: { code: 'INVALID_INPUT', message: 'content is required', type: 'invalid_request' } });
    }
    let session;
    try {
      session = this.conversation._requireActiveSession(sessionId);
    } catch (error) {
      return this._handleError(res, error, reqId);
    }

    const seedDetectorPluginId = body.seed_detector_plugin || session.preferredSeedDetectorPlugin || 'sd-symbolic';
    const seedPlugin = this.pluginRegistry.get('sd-plugin', seedDetectorPluginId);
    if (!seedPlugin) {
      return this._json(res, 400, { error: { code: 'INVALID_SEED_DETECTOR_PLUGIN', message: `Unknown seed detector plugin: ${seedDetectorPluginId}`, type: 'invalid_request' } });
    }
    if (!this.kbRepositoryManager?.ingestor) {
      throw new MRPError('SESSION_INTERNAL_ERROR', MOD, 'Source ingestor not available for session context load');
    }

    const sourceId = body.source_id || `ctx-${randomUUID().substring(0, 10)}`;
    const sourceName = body.name || 'session-context.txt';
    const ingestStrategy = seedPlugin.createIngestStrategy(
      { modelSettings: this.llmRoleSettings },
      body.model || null,
      session.preferredModel
    );
    logger.debug(MOD, 'Session context load started', {
      reqId,
      sessionId,
      sourceId,
      sourceName,
      seedDetectorPlugin: seedDetectorPluginId
    });
    const startedAt = Date.now();
    const { units } = await this.kbRepositoryManager.ingestor.ingest(
      sourceId,
      body.content,
      sourceName,
      ingestStrategy
    );
    const meta = await this.conversation.importSessionContext(sessionId, units, {
      reason: 'session-context-api',
      scope: 'committed-session'
    });
    logger.debug(MOD, 'Session context load completed', {
      reqId,
      sessionId,
      sourceId,
      unitCount: units.length,
      durationMs: Date.now() - startedAt
    });

    this._json(res, 200, {
      session_id: session.sessionId,
      sourceId,
      name: sourceName,
      unitCount: units.length,
      session_context_unit_count: meta.session_context_unit_count,
      kb_id: session.mountedKbId,
      kb_name: session.mountedKbName,
      workspace_dirty: !!session.workspace?.dirty,
      seed_detector_plugin: seedDetectorPluginId
    });
  }

  _listEvalSources(res) {
    const evalDir = resolve(process.cwd(), 'test/evaluation');
    const sources = [];
    try {
      for (const entry of readdirSync(evalDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const suiteDir = join(evalDir, entry.name);
        for (const f of readdirSync(suiteDir)) {
          if (!f.endsWith('.nl')) continue;
          const content = readFileSync(join(suiteDir, f), 'utf-8');
          sources.push({ suite: entry.name, file: f, name: `${entry.name}/${f}`, content });
        }
      }
    } catch { /* no eval dir */ }
    this._json(res, 200, { sources });
  }

  _readiness(res) {
    const checks = {
      config: true,
      kb: true,
      index: true,
      sessions: true,
      plugins: true
    };
    const ready = this.engine?.isReady ? this.engine.isReady() : true;
    this._json(res, ready ? 200 : 503, { ready, checks });
  }

  _serveStatic(path, res) {
    let filePath = path === '/' ? 'index.html' : path.replace(/^\/ui\//, '');
    filePath = join(UI_DIR, filePath);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
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

  _handleError(res, error, reqId) {
    logger.error(MOD, error.message, { code: error.code, reqId });
    if (error instanceof MRPError) {
      const status = httpStatusForCode(error.code);
      error.requestId = error.requestId || reqId;
      this._json(res, status, { error: { ...error.toJSON(), type: 'processing_error' } });
    } else {
      this._json(res, 500, { error: { code: 'SERVER_INTERNAL_ERROR', message: error.message, type: 'server_error' } });
    }
  }
}
