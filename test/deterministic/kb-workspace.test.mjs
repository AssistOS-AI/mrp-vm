import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KBRepositoryManager } from '../../src/kb/repository-manager.mjs';
import { ConversationHandler } from '../../src/conversation/handler.mjs';

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
    conversation.commitSuccessfulTurn(
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
      null,
      'symbolic-only',
      'thinkingdb'
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
});
