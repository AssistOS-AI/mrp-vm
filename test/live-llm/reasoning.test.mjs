// Live LLM integration tests — reasoning, multi-language, session context
// Requires AchillesAgentLib and a live LLM provider
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 3098;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path) { return (await fetch(`${BASE}${path}`)).json(); }

before(async () => {
  const { spawn } = await import('node:child_process');
  serverProc = spawn('node', ['src/server/index.mjs'], { env: { ...process.env, MRP_SERVER_PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise(r => setTimeout(r, 4000));
  const health = await get('/health');
  assert.equal(health.status, 'ok');
});

after(() => { serverProc?.kill(); });

describe('Logical reasoning — Socrates syllogism', () => {
  let sessionId;

  it('turn 1: establishes premises', async () => {
    const r = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'Socrate e om. Toti oamenii sunt muritori.' }]
    });
    assert.ok(r.session_id, 'should return session_id');
    sessionId = r.session_id;
    assert.ok(r.choices?.[0]?.message?.content, 'should have response content');
  });

  it('session stores context units from premises', async () => {
    const s = await get(`/sessions/${sessionId}`);
    assert.ok(s.session_context_unit_count > 0, `expected context units, got ${s.session_context_unit_count}`);
  });

  it('turn 2: deduces Socrates is mortal', async () => {
    const r = await post('/chat/completions', {
      session_id: sessionId,
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'Este Socrate muritor?' }]
    });
    const content = r.choices?.[0]?.message?.content || '';
    assert.ok(r.session_id === sessionId, 'should reuse session');
    // The answer should mention mortality/mortal and Socrates
    const lower = content.toLowerCase();
    assert.ok(lower.includes('mortal') || lower.includes('muritor'),
      `Expected answer about mortality, got: ${content.substring(0, 300)}`);
  });
});

describe('Multi-language input', () => {
  it('handles Romanian input', async () => {
    const r = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'Defineste ce este un algoritm de sortare.' }]
    });
    assert.ok(!r.error, `should not error: ${r.error?.message}`);
    assert.ok(r.choices?.[0]?.message?.content);
  });

  it('handles French input', async () => {
    const r = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: "Expliquez pourquoi le tri rapide est efficace." }]
    });
    assert.ok(!r.error, `should not error: ${r.error?.message}`);
    assert.ok(r.choices?.[0]?.message?.content);
  });

  it('handles input with typos', async () => {
    const r = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'Compara BM25 cu dense retireval ptr deployment pe CPU.' }]
    });
    assert.ok(!r.error, `should not error: ${r.error?.message}`);
  });
});

describe('Session context persistence', () => {
  it('facts from turn 1 are retrievable in turn 2', async () => {
    const r1 = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'We deploy on ARM servers with 4GB RAM. We use Ubuntu 22.04.' }]
    });
    const sid = r1.session_id;
    const s = await get(`/sessions/${sid}`);
    assert.ok(s.session_context_unit_count > 0, 'should extract context units');

    const r2 = await post('/chat/completions', {
      session_id: sid,
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'What hardware do we use?' }]
    });
    const content = r2.choices?.[0]?.message?.content?.toLowerCase() || '';
    assert.ok(content.includes('arm') || content.includes('4gb') || content.includes('ubuntu'),
      `Expected deployment facts in answer, got: ${content.substring(0, 300)}`);
  });
});

describe('No-context behavior', () => {
  it('returns no-context when KB is empty and no session facts', async () => {
    const r = await post('/chat/completions', {
      seed_detector_plugin: 'sd-llm-fast',
      kb_plugin: 'kb-balanced',
      goal_solver_plugin: 'gs-llm-fast',
      messages: [{ role: 'user', content: 'What is the airspeed velocity of an unladen swallow?' }]
    });
    const content = r.choices?.[0]?.message?.content || '';
    assert.ok(content.toLowerCase().includes('no-context') || content.toLowerCase().includes('not contain enough evidence'),
      `Expected no-context indication, got: ${content.substring(0, 300)}`);
  });
});
