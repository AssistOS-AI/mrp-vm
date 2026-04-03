import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { KBRepositoryManager } from '../../src/core/kb/repository-manager.mjs';
import { ConversationHandler } from '../../src/core/conversation/handler.mjs';
import { TypedPluginRegistry } from '../../src/plugins/runtime/typed-registry.mjs';
import { MRPServer } from '../../src/server/http-server.mjs';

const tmpRoots = [];

function makeKbConfig() {
  const root = mkdtempSync(join(tmpdir(), 'mrp-server-kb-api-'));
  tmpRoots.push(root);
  return {
    maxSourceSizeBytes: 1048576,
    maxSources: 500,
    maxUnitsPerSource: 500,
    maxTotalUnits: 10000,
    paths: {
      sources: join(root, 'kb', 'sources'),
      cnl: join(root, 'kb', 'cnl'),
      meta: join(root, 'kb', 'meta'),
      index: join(root, 'kb', 'index'),
      quarantine: join(root, 'kb', 'quarantine')
    },
    workspaceRootDir: join(root, 'workspaces')
  };
}

function makeJsonReq(body) {
  return Readable.from([JSON.stringify(body || {})]);
}

function makeResCapture() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    setHeader(name, value) {
      this.headers = this.headers || {};
      this.headers[name] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...(this.headers || {}), ...headers };
    },
    write(chunk = '') {
      this.body += chunk;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : {};
    }
  };
}

after(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

describe('HTTP KB session APIs', () => {
  it('lists KBs, creates named KBs with random ids, and loads them into a session through dedicated APIs', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-thinkingdb',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);

    const lifecycleEvents = [];
    const registry = new TypedPluginRegistry();
    registry.register({
      getDescriptor() {
        return {
          id: 'kb-test-http',
          type: 'kb-plugin',
          name: 'kb-test-http',
          description: 'HTTP KB API lifecycle test plugin',
          maxLLMCalls: 0,
          provides: ['retrieve-context', 'session-lifecycle']
        };
      },
      async retrieve() {
        return {
          status: 'insufficient',
          resolvedIntents: [],
          sufficient: false,
          retrievalTrace: {},
          error: null
        };
      },
      async onSessionEvent(input) {
        lifecycleEvents.push({
          eventType: input.eventType,
          sessionId: input.sessionId,
          kbId: input.kbId,
          reason: input.reason || null
        });
        return { status: 'accepted', error: null };
      }
    });
    conversation.attachPluginRegistry(registry);

    const server = new MRPServer(
      {
        processChatTurn: async () => {
          throw new Error('not used in this test');
        },
        isReady: () => true,
        parser: null,
        decomposer: null,
        externalPluginManager: null,
        maxLLMAttempts: 5,
        requestTimeout: 1000,
        maxPluginsPerStage: 4
      },
      manager,
      conversation,
      { getAvailableModels: () => [] },
      registry,
      {
        getSnapshot: () => ({ roles: {}, availableModels: [] }),
        update: body => body,
        resolveModel: () => null
      },
      { port: 3000, host: '127.0.0.1', cors: { origin: '*' } }
    );

    const listRes = makeResCapture();
    server._listKbs(listRes);
    const listPayload = listRes.json();
    assert.equal(listRes.statusCode, 200);
    assert.ok((listPayload.kbs || []).some(kb => kb.kbId === 'default'));

    const createRes = makeResCapture();
    await server._createKb(makeJsonReq({ name: 'API KB' }), createRes);
    const createdKb = createRes.json();
    assert.equal(createRes.statusCode, 200);
    assert.equal(createdKb.kb_name, 'API KB');
    assert.match(createdKb.kb_id, /^kb-[a-f0-9]{16}$/);

    const sessionRes = makeResCapture();
    await server._createSession(makeJsonReq({ deliberation_level: 2 }), sessionRes);
    const createdSession = sessionRes.json();
    assert.equal(sessionRes.statusCode, 200);
    assert.ok(createdSession.session_id);
    assert.equal(createdSession.deliberation_level, 2);

    const loadRes = makeResCapture();
    await server._mountKb(
      makeJsonReq({ kb_id: createdKb.kb_id, discard_draft: true }),
      loadRes,
      `/sessions/${createdSession.session_id}/kb/load`
    );
    const loadedSession = loadRes.json();
    assert.equal(loadRes.statusCode, 200);
    assert.equal(loadedSession.kb_id, createdKb.kb_id);
    assert.equal(loadedSession.kb_name, 'API KB');

    assert.ok(lifecycleEvents.some(event => event.eventType === 'session-created' && event.sessionId === createdSession.session_id));
    assert.ok(lifecycleEvents.some(event =>
      event.eventType === 'kb-loaded' &&
      event.kbId === createdKb.kb_id &&
      event.reason === 'load-api'
    ));
  });

  it('loads reusable session context through a dedicated session API and notifies kb-plugins', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-context-http',
      defaultKBPlugin: 'kb-thinkingdb',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);

    const lifecycleEvents = [];
    const ingestCalls = [];
    manager.ingestor = {
      async ingest(sourceId, content, name, strategy) {
        ingestCalls.push({
          sourceId,
          content,
          name,
          usesLLM: strategy?.usesLLM?.() ?? null
        });
        return {
          units: [
            {
              id: 'ctx-ku-1',
              hash: 'ctx-hash-1',
              role: 'Statement',
              topic: 'Aurora Station',
              claim: 'Aurora Station stores emergency water reserves.'
            }
          ]
        };
      }
    };

    const registry = new TypedPluginRegistry();
    registry.register({
      getDescriptor() {
        return {
          id: 'sd-context-http',
          type: 'sd-plugin',
          name: 'sd-context-http',
          description: 'Session context ingest test plugin',
          maxLLMCalls: 0,
          provides: ['detect-seeds', 'ingest-normalization']
        };
      },
      createIngestStrategy(ctx, requestedModel = null, sessionModel = null) {
        return {
          usesLLM: () => false,
          requestedModel,
          sessionModel,
          modelSettingsAvailable: !!ctx?.modelSettings
        };
      }
    });
    registry.register({
      getDescriptor() {
        return {
          id: 'kb-test-context-http',
          type: 'kb-plugin',
          name: 'kb-test-context-http',
          description: 'HTTP session context lifecycle test plugin',
          maxLLMCalls: 0,
          provides: ['retrieve-context', 'session-lifecycle']
        };
      },
      async retrieve() {
        return {
          status: 'insufficient',
          resolvedIntents: [],
          sufficient: false,
          retrievalTrace: {},
          error: null
        };
      },
      async onSessionEvent(input) {
        lifecycleEvents.push({
          eventType: input.eventType,
          scope: input.scope || null,
          units: (input.units || []).length,
          reason: input.reason || null
        });
        return { status: 'accepted', error: null };
      }
    });
    conversation.attachPluginRegistry(registry);

    const server = new MRPServer(
      {
        processChatTurn: async () => {
          throw new Error('not used in this test');
        },
        isReady: () => true,
        parser: null,
        decomposer: null,
        externalPluginManager: null,
        maxLLMAttempts: 5,
        requestTimeout: 1000,
        maxPluginsPerStage: 4
      },
      manager,
      conversation,
      { getAvailableModels: () => [] },
      registry,
      {
        getSnapshot: () => ({ roles: {}, availableModels: [] }),
        update: body => body,
        resolveModel: () => null
      },
      { port: 3000, host: '127.0.0.1', cors: { origin: '*' } }
    );

    const sessionRes = makeResCapture();
    await server._createSession(makeJsonReq({
      model: 'session-model',
      seed_detector_plugin: 'sd-context-http'
    }), sessionRes);
    const createdSession = sessionRes.json();
    assert.equal(sessionRes.statusCode, 200);
    assert.ok(createdSession.session_id);

    const loadRes = makeResCapture();
    await server._loadSessionContext(
      makeJsonReq({
        name: 'story.nl',
        content: 'Aurora Station stores emergency water reserves.',
        model: 'request-model'
      }),
      loadRes,
      `/sessions/${createdSession.session_id}/context`
    );
    const loaded = loadRes.json();
    assert.equal(loadRes.statusCode, 200);
    assert.equal(loaded.session_id, createdSession.session_id);
    assert.equal(loaded.name, 'story.nl');
    assert.equal(loaded.unitCount, 1);
    assert.equal(loaded.session_context_unit_count, 1);
    assert.equal(loaded.workspace_dirty, false);
    assert.equal(loaded.seed_detector_plugin, 'sd-context-http');
    assert.match(loaded.sourceId, /^ctx-/);

    const sessionMeta = conversation.getSessionMeta(createdSession.session_id);
    assert.equal(sessionMeta.message_count, 0);
    assert.equal(sessionMeta.session_context_unit_count, 1);
    assert.equal(sessionMeta.workspace_dirty, false);

    assert.equal(ingestCalls.length, 1);
    assert.equal(ingestCalls[0].name, 'story.nl');
    assert.equal(ingestCalls[0].content, 'Aurora Station stores emergency water reserves.');
    assert.equal(ingestCalls[0].usesLLM, false);

    assert.ok(lifecycleEvents.some(event =>
      event.eventType === 'session-kus-added' &&
      event.scope === 'committed-session' &&
      event.units === 1 &&
      event.reason === 'session-context-api'
    ));
  });

  it('streams progress updates and response deltas over SSE for chat completions', async () => {
    const res = makeResCapture();
    const server = new MRPServer(
      {
        processChatTurn: async (body) => {
          body.onProgress?.({
            type: 'stage',
            event: 'start',
            stage: 'seed-detector',
            pluginId: 'sd-symbolic',
            message: 'Running seed detector sd-symbolic'
          });
          body.onProgress?.({
            type: 'stage',
            event: 'finish',
            stage: 'goal-solver',
            pluginId: 'gs-symbolic',
            status: 'success',
            message: 'goal-solver gs-symbolic finished with success'
          });
          return {
            sessionId: 'sess-stream',
            responseMarkdown: '# Streamed answer',
            responseDocument: { sessionId: 'sess-stream', groups: [] },
            executionTrace: { stages: [{ stage: 'goal-solver', pluginId: 'gs-symbolic', status: 'success' }] }
          };
        }
      },
      { listRepositories: () => [] },
      {
        getSession: () => ({
          preferredPlannerPlugin: 'planner-default',
          preferredSeedDetectorPlugin: 'sd-symbolic',
          preferredKBPlugin: 'kb-fast',
          preferredGoalSolverPlugin: 'gs-symbolic',
          expiresAt: null,
          mountedKbId: 'default',
          mountedKbName: 'Default KB',
          workspace: { dirty: false }
        })
      },
      { getAvailableModels: () => [] },
      {
        get: () => null,
        list: () => [],
        listByType: () => []
      },
      {
        getSnapshot: () => ({ roles: {}, availableModels: [] }),
        update: body => body,
        resolveModel: () => null
      },
      { port: 3000, host: '127.0.0.1', cors: { origin: '*' } }
    );

    await server._chatCompletions(
      makeJsonReq({
        stream: true,
        messages: [{ role: 'user', content: 'Explain streaming.' }]
      }),
      res,
      'req-stream'
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.match(res.body, /event: progress/);
    assert.match(res.body, /event: response\.delta/);
    assert.match(res.body, /event: response\.completed/);
    assert.match(res.body, /Running seed detector sd-symbolic/);
    assert.match(res.body, /# Streamed answer/);
    assert.match(res.body, /"request_id":"req-stream"/);
    assert.match(res.body, /"deliberation_level":0/);
  });

  it('returns session explainability registry with execution trace and response document', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-fast',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);
    const session = await conversation.createSession(null, 'default', 'planner-default', 'sd-symbolic', 'kb-fast', 'gs-symbolic', 2);
    await conversation.commitSuccessfulTurn(
      session,
      'Explain Aurora.',
      '# Aurora answer',
      [],
      null,
      'planner-default',
      'sd-symbolic',
      'kb-fast',
      'gs-symbolic',
      {
        requestId: 'req-explain',
        createdAt: '2026-04-02T12:00:00.000Z',
        answerStatus: 'answered',
        responseDocument: {
          sessionId: session.sessionId,
          groups: [{ intent: 'Explain Aurora', answerMarkdown: 'Aurora details.' }]
        },
        executionTrace: {
          requestId: 'req-explain',
          stages: [{ stage: 'goal-solver', pluginId: 'gs-symbolic', status: 'success' }]
        }
      }
    );

    const server = new MRPServer(
      {
        processChatTurn: async () => {
          throw new Error('not used in this test');
        },
        isReady: () => true
      },
      manager,
      conversation,
      { getAvailableModels: () => [] },
      { get: () => null, list: () => [], listByType: () => [] },
      {
        getSnapshot: () => ({ roles: {}, availableModels: [] }),
        update: body => body,
        resolveModel: () => null
      },
      { port: 3000, host: '127.0.0.1', cors: { origin: '*' } }
    );

    const res = makeResCapture();
    server._getExplainability(`/sessions/${session.sessionId}/explainability`, res);
    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.session_id, session.sessionId);
    assert.equal(payload.turn_count, 1);
    assert.equal(payload.turns[0].requestId, 'req-explain');
    assert.equal(payload.turns[0].turnIndex, 1);
    assert.equal(payload.turns[0].plannerPlugin, 'planner-default');
    assert.equal(payload.turns[0].seedDetectorPlugin, 'sd-symbolic');
    assert.equal(payload.turns[0].kbPlugin, 'kb-fast');
    assert.equal(payload.turns[0].goalSolverPlugin, 'gs-symbolic');
    assert.equal(payload.turns[0].deliberationLevel, 2);
    assert.equal(payload.turns[0].executionTrace.stages[0].pluginId, 'gs-symbolic');
    assert.equal(payload.turns[0].responseDocument.groups[0].answerMarkdown, 'Aurora details.');
  });

  it('stores failed turns in session explainability', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-fast',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);
    const session = await conversation.createSession(null, 'default', 'planner-default', 'sd-symbolic', 'kb-fast', 'gs-symbolic', 1);
    await conversation.commitFailedTurn(
      session,
      'What failed?',
      null,
      'planner-default',
      'sd-symbolic',
      'kb-fast',
      'gs-symbolic',
      {
        requestId: 'req-failed',
        createdAt: '2026-04-02T12:10:00.000Z',
        answerStatus: 'failed',
        assistantPreview: 'Validation rejected.',
        executionTrace: {
          requestId: 'req-failed',
          finalStatus: 'failed',
          stages: [{ stage: 'validation', pluginId: 'val-symbolic', status: 'rejected' }]
        },
        error: {
          code: 'VALIDATION_REJECTED',
          message: 'Validation rejected: fabricated claim'
        }
      }
    );

    const server = new MRPServer(
      {
        processChatTurn: async () => {
          throw new Error('not used in this test');
        },
        isReady: () => true
      },
      manager,
      conversation,
      { getAvailableModels: () => [] },
      { get: () => null, list: () => [], listByType: () => [] },
      {
        getSnapshot: () => ({ roles: {}, availableModels: [] }),
        update: body => body,
        resolveModel: () => null
      },
      { port: 3000, host: '127.0.0.1', cors: { origin: '*' } }
    );

    const res = makeResCapture();
    server._getExplainability(`/sessions/${session.sessionId}/explainability`, res);
    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.turn_count, 1);
    assert.equal(payload.turns[0].requestId, 'req-failed');
    assert.equal(payload.turns[0].answerStatus, 'failed');
    assert.equal(payload.turns[0].deliberationLevel, 1);
    assert.equal(payload.turns[0].executionTrace.finalStatus, 'failed');
    assert.equal(payload.turns[0].error.code, 'VALIDATION_REJECTED');
  });
});
