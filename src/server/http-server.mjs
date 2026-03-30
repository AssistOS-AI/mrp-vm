// DS013 — Native HTTP Server & API
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MRPError, httpStatusForCode } from '../lib/errors.mjs';
import { logger } from '../lib/logger.mjs';
import {
  LEGACY_PROCESSING_MODE_ALIASES,
  LEGACY_RETRIEVAL_PROFILE_ALIASES,
  mapLegacyProcessingMode,
  mapLegacyRetrievalProfile,
  deriveLegacyProcessingMode,
  deriveLegacyRetrievalProfile
} from '../plugins/aliases.mjs';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;
const UI_DIR = resolve(__dirname, '../ui');
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
      if (path === '/models' && req.method === 'GET') return this._getModels(res);
      if (path === '/plugins' && req.method === 'GET') return this._getPlugins(url, res);
      if (path === '/settings/llm-roles' && req.method === 'GET') return this._getLLMRoleSettings(res);
      if (path === '/settings/llm-roles' && req.method === 'PUT') return await this._updateLLMRoleSettings(req, res);
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

  _isValidLegacyProcessingMode(mode) {
    if (!mode) return true;
    const mapping = mapLegacyProcessingMode(mode);
    return !!(mapping.seedDetectorPlugin || mapping.goalSolverPlugin);
  }

  _isValidLegacyRetrievalProfile(profile) {
    if (!profile) return true;
    return !!mapLegacyRetrievalProfile(profile);
  }

  async _chatCompletions(req, res, reqId) {
    const body = JSON.parse(await this._readBody(req));
    if (body.stream === true) {
      return this._json(res, 400, { error: { code: 'STREAM_NOT_SUPPORTED', message: 'Streaming not supported in v1', type: 'invalid_request' } });
    }
    for (const message of body.messages || []) {
      if (!['user', 'system'].includes(message.role)) {
        return this._json(res, 400, { error: { code: 'INVALID_ROLE', message: `Unsupported role: ${message.role}`, type: 'invalid_request' } });
      }
    }
    if (!(body.messages || []).some(message => message.role === 'user')) {
      return this._json(res, 400, { error: { code: 'NO_USER_MESSAGE', message: 'At least one user message required', type: 'invalid_request' } });
    }
    if (!this._isValidLegacyProcessingMode(body.processing_mode)) {
      return this._json(res, 400, { error: { code: 'INVALID_PROCESSING_MODE', message: `Unknown processing mode: ${body.processing_mode}`, type: 'invalid_request' } });
    }
    if (!this._isValidLegacyRetrievalProfile(body.retrieval_profile)) {
      return this._json(res, 400, { error: { code: 'INVALID_RETRIEVAL_PROFILE', message: `Unknown retrieval profile: ${body.retrieval_profile}`, type: 'invalid_request' } });
    }
    try {
      this._validatePlugin('mrp-plan-plugin', body.planner_plugin, 'INVALID_PLANNER_PLUGIN');
      this._validatePlugin('sd-plugin', body.seed_detector_plugin, 'INVALID_SEED_DETECTOR_PLUGIN');
      this._validatePlugin('kb-plugin', body.kb_plugin, 'INVALID_KB_PLUGIN');
      this._validatePlugin('gs-plugin', body.goal_solver_plugin, 'INVALID_GOAL_SOLVER_PLUGIN');
    } catch (error) {
      return this._handleError(res, error, reqId);
    }

    const result = await this.engine.processChatTurn(body);
    const session = this.conversation.getSession(result.sessionId);
    this._json(res, 200, {
      id: `mrp-${reqId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      session_id: result.sessionId,
      processing_mode:
        deriveLegacyProcessingMode(session?.preferredSeedDetectorPlugin, session?.preferredGoalSolverPlugin) ||
        body.processing_mode ||
        null,
      retrieval_profile:
        deriveLegacyRetrievalProfile(session?.preferredKBPlugin) ||
        body.retrieval_profile ||
        null,
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
    });
  }

  async _createSession(req, res) {
    const body = JSON.parse(await this._readBody(req));
    if (!this._isValidLegacyProcessingMode(body.processing_mode)) {
      return this._json(res, 400, { error: { code: 'INVALID_PROCESSING_MODE', message: `Unknown processing mode: ${body.processing_mode}`, type: 'invalid_request' } });
    }
    if (!this._isValidLegacyRetrievalProfile(body.retrieval_profile)) {
      return this._json(res, 400, { error: { code: 'INVALID_RETRIEVAL_PROFILE', message: `Unknown retrieval profile: ${body.retrieval_profile}`, type: 'invalid_request' } });
    }
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
      body.processing_mode,
      body.retrieval_profile,
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
      processing_mode: deriveLegacyProcessingMode(session.preferredSeedDetectorPlugin, session.preferredGoalSolverPlugin),
      retrieval_profile: deriveLegacyRetrievalProfile(session.preferredKBPlugin),
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
    const meta = this.conversation.getSessionMeta(id);
    if (!meta) {
      return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    }
    this._json(res, 200, meta);
  }

  _deleteSession(path, res) {
    const id = path.split('/').pop();
    this.conversation.deleteSession(id);
    res.writeHead(204);
    res.end();
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

  _getStrategies(res) {
    const strategies = Object.entries(LEGACY_PROCESSING_MODE_ALIASES).map(([id, mapping]) => {
      const seedDescriptor = this.pluginRegistry.get('sd-plugin', mapping.seedDetectorPlugin)?.getDescriptor?.() || {};
      const goalDescriptor = this.pluginRegistry.get('gs-plugin', mapping.goalSolverPlugin)?.getDescriptor?.() || {};
      return {
        id,
        seed_detector_plugin: mapping.seedDetectorPlugin,
        goal_solver_plugin: mapping.goalSolverPlugin,
        uses_llm: !!(seedDescriptor.usesLLM || goalDescriptor.usesLLM),
        supports_model_override: !!(seedDescriptor.usesLLM || goalDescriptor.usesLLM),
        capabilities: [...new Set([
          ...(seedDescriptor.provides || []),
          ...(goalDescriptor.provides || [])
        ])]
      };
    });
    this._json(res, 200, { strategies });
  }

  _getRetrievalProfiles(res) {
    const profiles = Object.entries(LEGACY_RETRIEVAL_PROFILE_ALIASES).map(([id, pluginId]) => ({
      id,
      kb_plugin: pluginId
    }));
    this._json(res, 200, { profiles });
  }

  _listKbs(res) {
    this._json(res, 200, { kbs: this.kbRepositoryManager.listRepositories() });
  }

  _getWorkspace(path, res) {
    const sessionId = path.split('/')[2];
    const session = this.conversation.getSession(sessionId);
    if (!session) {
      return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    }
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
    if (!body.kb_id) {
      return this._json(res, 400, { error: { code: 'KB_VALIDATION_MISSING_ID', message: 'kb_id is required', type: 'invalid_request' } });
    }
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
    const session = this.conversation.getSession(sessionId);
    if (!session) {
      return this._json(res, 410, { error: { code: 'SESSION_EXPIRED', message: 'Session not found or expired', type: 'processing_error' } });
    }

    const legacySeed = mapLegacyProcessingMode(body.processing_mode).seedDetectorPlugin;
    const seedDetectorPluginId = body.seed_detector_plugin || session.preferredSeedDetectorPlugin || legacySeed || 'sd-symbolic';
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
    const { units } = await this.kbRepositoryManager.ingestor.ingest(
      effectiveSourceId,
      body.content,
      body.name,
      ingestStrategy
    );
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
      parser: null,
      decomposer: null,
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
      await instance?.onSourceText?.({
        sourceId: effectiveSourceId,
        name: body.name,
        content: body.content,
        units,
        sessionId
      }, ingestCtx);
    }

    const workspace = session.workspace.getStats();
    this._json(res, 200, {
      sourceId: meta.sourceId,
      name: meta.name,
      unitCount: meta.unitCount,
      kb_id: session.mountedKbId,
      workspace_dirty: workspace.dirty,
      seed_detector_plugin: seedDetectorPluginId
    });
  }

  _readiness(res) {
    const checks = {
      config: true,
      kb: true,
      index: true,
      sessions: true,
      plugins: true
    };
    const ready = this.engine.isReady();
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
