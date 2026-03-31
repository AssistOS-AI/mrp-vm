import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { KBRepositoryManager } from '../../src/kb/repository-manager.mjs';
import { ConversationHandler } from '../../src/conversation/handler.mjs';
import { TypedPluginRegistry } from '../../src/plugins/typed-registry.mjs';
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
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
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
    await server._createSession(makeJsonReq({}), sessionRes);
    const createdSession = sessionRes.json();
    assert.equal(sessionRes.statusCode, 200);
    assert.ok(createdSession.session_id);

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
});
