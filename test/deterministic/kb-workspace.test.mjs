import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KBRepositoryManager } from '../../src/kb/repository-manager.mjs';
import { ConversationHandler } from '../../src/conversation/handler.mjs';
import { TypedPluginRegistry } from '../../src/plugins/typed-registry.mjs';

const tmpRoots = [];

function makeKbConfig() {
  const root = mkdtempSync(join(tmpdir(), 'mrp-kb-workspace-'));
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

function makeSourceEntry(sourceId, name, claim, symbolic = null) {
  return {
    meta: {
      sourceId,
      name,
      addedAt: '2026-03-27T00:00:00Z',
      updatedAt: '2026-03-27T00:00:00Z',
      status: 'ready'
    },
    content: claim,
    units: [
      {
        id: `${sourceId}::chunk-000::unit-000`,
        sourceId,
        chunkId: `${sourceId}::chunk-000`,
        role: 'Explanation',
        topic: claim.split(' ').slice(0, 3).join(' '),
        claim,
        condition: null,
        procedure: null,
        utilityActs: ['explain'],
        utilityNote: null,
        hash: null,
        subject: symbolic?.subject || null,
        relation: symbolic?.relation || null,
        object: symbolic?.object || null,
        confidence: symbolic?.confidence ?? null
      }
    ]
  };
}

after(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

describe('KB repositories and session workspaces', () => {
  it('mounts the selected KB into a session workspace and saves staged sources only on explicit save', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    await manager.getDefaultRepository().kb.replaceAllSources({
      sources: [
        makeSourceEntry('src-base', 'base.txt', 'KernelX provides isolation.', {
          subject: 'KernelX',
          relation: 'provides',
          object: 'isolation',
          confidence: 0.9
        })
      ]
    });

    const conversation = new ConversationHandler({
      defaultProcessingMode: 'symbolic-only',
      defaultRetrievalProfile: 'thinkingdb'
    });
    conversation.attachKBRepositoryManager(manager);

    const session = await conversation.createSession(null, 'symbolic-only', 'thinkingdb', 'default');
    assert.equal(session.mountedKbId, 'default');
    assert.equal(session.workspace.getSources().length, 1);
    assert.equal(manager.listRepositories().length, 1);
    assert.equal(existsSync(join(kbConfig.workspaceRootDir, session.sessionId, 'workspace.json')), true);

    await conversation.stageWorkspaceSource(
      session.sessionId,
      'draft.txt',
      'Ploinky depends on KernelX.',
      makeSourceEntry('src-draft', 'draft.txt', 'Ploinky depends on KernelX.', {
        subject: 'Ploinky',
        relation: 'depends_on',
        object: 'KernelX',
        confidence: 0.9
      }).units,
      { sourceId: 'src-draft' }
    );

    assert.equal(session.workspace.dirty, true);
    assert.equal(session.workspace.getIndex().units.size, 2);
    assert.equal(manager.listRepositories().length, 1);

    const savedMeta = await conversation.saveWorkspace(session.sessionId, {
      fork: true,
      name: 'analysis fork',
      includeConversationUnits: false
    });

    assert.equal(savedMeta.kb_name, 'analysis fork');
    assert.equal(savedMeta.workspace_dirty, false);
    assert.equal(manager.listRepositories().length, 2);

    const forkKb = manager.listRepositories().find(kb => kb.kbId === savedMeta.kb_id);
    assert.ok(forkKb);
    const snapshot = await manager.exportSnapshot(savedMeta.kb_id);
    assert.equal(snapshot.sources.length, 2);
    assert.ok(snapshot.sources.some(source => source.meta.sourceId === 'src-base'));
    assert.ok(snapshot.sources.some(source => source.meta.sourceId === 'src-draft'));
    assert.equal(existsSync(join(kbConfig.workspaceRootDir, session.sessionId, 'workspace.json')), true);
  });

  it('persists conversation-derived facts into a separate journal source only when saving', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultProcessingMode: 'symbolic-only',
      defaultRetrievalProfile: 'thinkingdb'
    });
    conversation.attachKBRepositoryManager(manager);

    const session = await conversation.createSession(null, 'symbolic-only', 'thinkingdb', 'default');
    await conversation.commitSuccessfulTurn(
      session,
      'AchillesIDE uses Ploinky.',
      '# Answer',
      [
        {
          id: 'session::turn::unit-000',
          sourceId: 'session',
          chunkId: 'session::turn',
          role: 'Explanation',
          topic: 'AchillesIDE',
          claim: 'AchillesIDE uses Ploinky.',
          condition: null,
          procedure: null,
          utilityActs: ['explain'],
          utilityNote: null,
          hash: null,
          subject: 'AchillesIDE',
          relation: 'uses',
          object: 'Ploinky',
          confidence: 0.9
        }
      ],
      null
    );

    assert.equal(session.workspace.dirty, true);

    const savedMeta = await conversation.saveWorkspace(session.sessionId, {
      fork: true,
      name: 'journal fork'
    });
    const snapshot = await manager.exportSnapshot(savedMeta.kb_id);
    assert.ok(snapshot.sources.some(source => source.kind === 'conversation-journal'));
    const journalSource = snapshot.sources.find(source => source.kind === 'conversation-journal');
    assert.ok(journalSource.content.includes('AchillesIDE uses Ploinky.'));
    assert.equal(journalSource.units[0].subject, 'AchillesIDE');
  });

  it('preserves explicit and session plugin selections ahead of legacy aliases', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultProcessingMode: 'llm-assisted',
      defaultRetrievalProfile: 'balanced'
    });
    conversation.attachKBRepositoryManager(manager);

    const preparedNew = await conversation.prepareTurn(
      null,
      [{ role: 'user', content: 'Verify the current plugin selection.' }],
      null,
      null,
      null,
      'default',
      'planner-default',
      'sd-symbolic',
      'kb-thinkingdb',
      'gs-symbolic'
    );

    assert.equal(preparedNew.session.preferredSeedDetectorPlugin, 'sd-symbolic');
    assert.equal(preparedNew.session.preferredKBPlugin, 'kb-thinkingdb');
    assert.equal(preparedNew.session.preferredGoalSolverPlugin, 'gs-symbolic');
    assert.equal(preparedNew.explicitPlannerPlugin, 'planner-default');
    assert.equal(preparedNew.explicitSeedDetectorPlugin, 'sd-symbolic');
    assert.equal(preparedNew.explicitKBPlugin, 'kb-thinkingdb');
    assert.equal(preparedNew.explicitGoalSolverPlugin, 'gs-symbolic');

    const preparedExisting = await conversation.prepareTurn(
      preparedNew.session.sessionId,
      [{ role: 'user', content: 'Keep using the same plugins.' }],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    );

    assert.equal(preparedExisting.requestedSeedDetectorPlugin, 'sd-symbolic');
    assert.equal(preparedExisting.requestedKBPlugin, 'kb-thinkingdb');
    assert.equal(preparedExisting.requestedGoalSolverPlugin, 'gs-symbolic');
    assert.equal(preparedExisting.explicitPlannerPlugin, null);
    assert.equal(preparedExisting.explicitSeedDetectorPlugin, null);
    assert.equal(preparedExisting.explicitKBPlugin, null);
    assert.equal(preparedExisting.explicitGoalSolverPlugin, null);
  });

  it('derives legacy compatibility fields from current plugin selections instead of stale aliases', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultProcessingMode: 'llm-assisted',
      defaultRetrievalProfile: 'balanced'
    });
    conversation.attachKBRepositoryManager(manager);

    const session = await conversation.createSession(null, 'llm-assisted', 'balanced', 'default');
    await conversation.commitSuccessfulTurn(
      session,
      'Verify this relation.',
      '# Answer',
      [],
      null,
      'planner-default',
      'sd-symbolic',
      'kb-thinkingdb',
      'gs-symbolic'
    );

    const meta = conversation.getSessionMeta(session.sessionId);
    assert.equal(meta.processing_mode, 'symbolic-only');
    assert.equal(meta.retrieval_profile, 'thinkingdb');
  });

  it('promotes workspace plugin artifacts into the repository and rehydrates them on mount', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-thinkingdb',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);

    const session = await conversation.createSession(null, null, null, 'default');
    const workspaceArtifactPath = await manager.saveWorkspacePluginArtifact(
      session.sessionId,
      'kb-thinkingdb',
      'src-test.json',
      { note: 'workspace-artifact' }
    );
    assert.equal(existsSync(workspaceArtifactPath), true);

    const savedMeta = await conversation.saveWorkspace(session.sessionId, {
      fork: true,
      name: 'artifact fork'
    });
    const repositoryRecord = manager.getRepository(savedMeta.kb_id);
    const repositoryArtifactPath = join(repositoryRecord.rootDir, 'plugins', 'kb-thinkingdb', 'src-test.json');
    const rehydratedWorkspacePath = join(kbConfig.workspaceRootDir, session.sessionId, 'plugins', 'kb-thinkingdb', 'src-test.json');

    assert.equal(existsSync(repositoryArtifactPath), true);
    assert.equal(existsSync(rehydratedWorkspacePath), true);
    assert.equal(JSON.parse(readFileSync(repositoryArtifactPath, 'utf-8')).note, 'workspace-artifact');
  });

  it('notifies kb-plugins when turn KUs are staged and then committed into session memory', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-thinkingdb',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);

    const events = [];
    const registry = new TypedPluginRegistry();
    registry.register({
      getDescriptor() {
        return {
          id: 'kb-test-turn-kus',
          type: 'kb-plugin',
          name: 'kb-test-turn-kus',
          description: 'Turn KU lifecycle plugin',
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
        events.push({
          eventType: input.eventType,
          scope: input.scope || null,
          units: (input.units || []).length
        });
        return { status: 'accepted', error: null };
      }
    });
    conversation.attachPluginRegistry(registry);

    const session = await conversation.createSession(null, null, null, 'default');
    const detectedUnits = makeSourceEntry(
      'src-turn',
      'turn.txt',
      'Aurora Station provides thermal shielding.',
      {
        subject: 'Aurora Station',
        relation: 'provides',
        object: 'thermal shielding',
        confidence: 0.9
      }
    ).units;

    await conversation.stageDetectedContextUnits(session, detectedUnits, {
      scope: 'current-turn',
      reason: 'seed-detection'
    });
    assert.equal(session.pendingTurnContextUnits.length, 1);
    assert.equal(events[2].eventType, 'session-kus-added');
    assert.equal(events[2].scope, 'current-turn');
    assert.equal(events[2].units, 1);

    await conversation.commitSuccessfulTurn(
      session,
      'Aurora Station provides thermal shielding.',
      '# Answer',
      detectedUnits,
      null
    );
    assert.equal(session.pendingTurnContextUnits.length, 0);
    assert.equal(session.sessionContextUnits.length, 1);
    assert.equal(events[3].eventType, 'session-kus-added');
    assert.equal(events[3].scope, 'committed-session');
    assert.equal(events[3].units, 1);
  });

  it('generates cryptographically random KB ids for new repositories and lists them alongside names', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();

    const meta = await manager.createEmptyRepository('Analysis KB');
    assert.match(meta.kbId, /^kb-[a-f0-9]{16}$/);
    assert.equal(meta.name, 'Analysis KB');

    const listed = manager.listRepositories().find(kb => kb.kbId === meta.kbId);
    assert.ok(listed);
    assert.equal(listed.id, meta.kbId);
    assert.equal(listed.name, 'Analysis KB');
  });

  it('notifies all kb-plugins when sessions are created, KBs are loaded, and KBs are saved or forked', async () => {
    const kbConfig = makeKbConfig();
    const manager = new KBRepositoryManager(null, {}, kbConfig);
    await manager.boot();
    const secondary = await manager.createEmptyRepository('Secondary KB');

    const conversation = new ConversationHandler({
      defaultSeedDetectorPlugin: 'sd-symbolic',
      defaultKBPlugin: 'kb-thinkingdb',
      defaultGoalSolverPlugin: 'gs-symbolic'
    });
    conversation.attachKBRepositoryManager(manager);

    const events = [];
    const registry = new TypedPluginRegistry();
    registry.register({
      getDescriptor() {
        return {
          id: 'kb-test-lifecycle',
          type: 'kb-plugin',
          name: 'kb-test-lifecycle',
          description: 'Test lifecycle plugin',
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
        events.push({
          eventType: input.eventType,
          sessionId: input.sessionId,
          kbId: input.kbId,
          previousKbId: input.previousKbId || null,
          reason: input.reason || null
        });
        return { status: 'accepted', error: null };
      }
    });
    conversation.attachPluginRegistry(registry);

    const session = await conversation.createSession(null, null, null, 'default');
    assert.equal(events[0].eventType, 'session-created');
    assert.equal(events[1].eventType, 'kb-loaded');
    assert.equal(events[1].kbId, 'default');
    assert.equal(events[1].reason, 'session-create');

    await conversation.mountRepository(session.sessionId, secondary.kbId, {
      discardDraft: true,
      reason: 'load-api'
    });
    assert.equal(events[2].eventType, 'kb-loaded');
    assert.equal(events[2].kbId, secondary.kbId);
    assert.equal(events[2].previousKbId, 'default');
    assert.equal(events[2].reason, 'load-api');

    await conversation.stageWorkspaceSource(
      session.sessionId,
      'draft.txt',
      'Delta depends on Gamma.',
      makeSourceEntry('src-draft-lifecycle', 'draft.txt', 'Delta depends on Gamma.', {
        subject: 'Delta',
        relation: 'depends_on',
        object: 'Gamma',
        confidence: 0.9
      }).units,
      { sourceId: 'src-draft-lifecycle' }
    );

    const saveMeta = await conversation.saveWorkspace(session.sessionId, {
      name: 'Secondary KB',
      includeConversationUnits: false
    });
    assert.equal(saveMeta.kb_id, secondary.kbId);
    assert.equal(events[3].eventType, 'kb-loaded');
    assert.equal(events[3].kbId, secondary.kbId);
    assert.equal(events[3].reason, 'save');
    assert.equal(events[4].eventType, 'kb-saved');
    assert.equal(events[4].kbId, secondary.kbId);

    const forkMeta = await conversation.forkWorkspace(session.sessionId, 'Forked KB');
    assert.match(forkMeta.kb_id, /^kb-[a-f0-9]{16}$/);
    assert.equal(events[5].eventType, 'kb-loaded');
    assert.equal(events[5].kbId, forkMeta.kb_id);
    assert.equal(events[5].reason, 'fork');
    assert.equal(events[6].eventType, 'kb-forked');
    assert.equal(events[6].kbId, forkMeta.kb_id);
  });
});
