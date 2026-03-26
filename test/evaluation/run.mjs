// DS021 — Evaluation Runner
// Usage: node test/evaluation/run.mjs [--filter category] [--port 3097]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = __dirname;
const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '3097';
const FILTER = process.argv.includes('--filter') ? process.argv[process.argv.indexOf('--filter') + 1] : null;
const BASE = `http://127.0.0.1:${PORT}`;
const MODE = 'llm-assisted';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path) { return (await fetch(`${BASE}${path}`)).json(); }
async function del(path) { await fetch(`${BASE}${path}`, { method: 'DELETE' }); }

function checkMention(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter(t => !lower.includes(t.toLowerCase()));
}
function checkNotContain(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter(t => lower.includes(t.toLowerCase()));
}

async function runCase(c) {
  const result = { id: c.id, category: c.category, description: c.description, pass: true, failures: [], durationMs: 0 };
  const start = Date.now();
  try {
    // Setup KB sources
    const sourceIds = [];
    if (c.kbSources) {
      for (const src of c.kbSources) {
        const r = await post('/v1/kb/sources', { name: src.name, content: src.content, processing_mode: MODE });
        if (r.sourceId) sourceIds.push(r.sourceId);
      }
    }
    if (c.kbUpdates) {
      for (const upd of c.kbUpdates) {
        const sources = (await get('/v1/kb/sources')).sources || [];
        const existing = sources.find(s => s.name === upd.name);
        if (existing) await post(`/v1/kb/sources/${existing.sourceId}`, { content: upd.content, processing_mode: MODE });
      }
    }
    if (c.kbDeletes) {
      for (const name of c.kbDeletes) {
        const sources = (await get('/v1/kb/sources')).sources || [];
        const existing = sources.find(s => s.name === name);
        if (existing) await del(`/v1/kb/sources/${existing.sourceId}`);
      }
    }

    // Handle raw request cases (error testing)
    if (c.rawRequest) {
      const r = await post('/v1/chat/completions', { processing_mode: MODE, ...c.rawRequest });
      if (c.expected.errorCode) {
        if (r.error?.code !== c.expected.errorCode) {
          result.pass = false;
          result.failures.push(`Expected error ${c.expected.errorCode}, got ${r.error?.code || 'no error'}`);
        }
      }
      result.durationMs = Date.now() - start;
      // Cleanup KB
      for (const id of sourceIds) await del(`/v1/kb/sources/${id}`);
      return result;
    }
    if (c.generateLongInput) {
      const r = await post('/v1/chat/completions', {
        processing_mode: MODE,
        messages: [{ role: 'user', content: 'x'.repeat(c.generateLongInput) }]
      });
      if (c.expected.errorCode && r.error?.code !== c.expected.errorCode) {
        result.pass = false;
        result.failures.push(`Expected error ${c.expected.errorCode}, got ${r.error?.code || 'no error'}`);
      }
      result.durationMs = Date.now() - start;
      for (const id of sourceIds) await del(`/v1/kb/sources/${id}`);
      return result;
    }

    // Run turns
    let sessionId = null;
    if (c.createSessionFirst) {
      const s = await post('/v1/sessions', { processing_mode: c.processingMode || MODE, retrieval_profile: c.retrievalProfile });
      sessionId = s.session_id;
    }
    let lastContent = '';
    const turns = c.turns || [];
    for (let i = 0; i < turns.length; i++) {
      const body = {
        processing_mode: c.processingMode || MODE,
        messages: [turns[i]]
      };
      if (c.retrievalProfile) body.retrieval_profile = c.retrievalProfile;
      if (c.systemPrompt && i === 0) body.messages.unshift({ role: 'system', content: c.systemPrompt });
      if (sessionId) body.session_id = sessionId;
      const r = await post('/v1/chat/completions', body);
      if (r.error) {
        result.pass = false;
        result.failures.push(`Turn ${i + 1} error: ${r.error.code} ${r.error.message}`);
        break;
      }
      sessionId = r.session_id;
      lastContent = r.choices?.[0]?.message?.content || '';
    }

    // Check expectations on last turn
    const exp = c.expected;
    const turnNum = turns.length;
    const statusKey = `turn${turnNum}_status`;
    const mentionKey = `turn${turnNum}_mustMention`;
    const notContainKey = `turn${turnNum}_mustNotContain`;
    const sourceKey = `turn${turnNum}_mustUseSources`;

    if (exp[statusKey]) {
      const lower = lastContent.toLowerCase();
      if (exp[statusKey] === 'no-context' && !lower.includes('no-context') && !lower.includes('not contain enough evidence')) {
        result.pass = false;
        result.failures.push(`Expected no-context, got: ${lastContent.substring(0, 200)}`);
      }
      if (exp[statusKey] === 'answered' && (lower.includes('not contain enough evidence') && !lower.includes('answered'))) {
        result.pass = false;
        result.failures.push(`Expected answered, got no-context`);
      }
    }
    if (exp[mentionKey]) {
      const missing = checkMention(lastContent, exp[mentionKey]);
      if (missing.length > 0) { result.pass = false; result.failures.push(`Missing mentions: ${missing.join(', ')}`); }
    }
    if (exp[notContainKey]) {
      const found = checkNotContain(lastContent, exp[notContainKey]);
      if (found.length > 0) { result.pass = false; result.failures.push(`Should not contain: ${found.join(', ')}`); }
    }
    if (exp[sourceKey]) {
      const missing = exp[sourceKey].filter(p => !lastContent.includes(p));
      if (missing.length > 0) { result.pass = false; result.failures.push(`Missing source patterns: ${missing.join(', ')}`); }
    }
    if (exp.turn1_context_units_min) {
      const s = await get(`/v1/sessions/${sessionId}`);
      if ((s.session_context_unit_count || 0) < exp.turn1_context_units_min) {
        result.pass = false;
        result.failures.push(`Expected >= ${exp.turn1_context_units_min} context units, got ${s.session_context_unit_count}`);
      }
    }
    if (exp.sessionProcessingMode && sessionId) {
      const s = await get(`/v1/sessions/${sessionId}`);
      if (s.processing_mode !== exp.sessionProcessingMode) {
        result.pass = false;
        result.failures.push(`Expected mode ${exp.sessionProcessingMode}, got ${s.processing_mode}`);
      }
    }
    if (exp.sessionRetrievalProfile && sessionId) {
      const s = await get(`/v1/sessions/${sessionId}`);
      if (s.retrieval_profile !== exp.sessionRetrievalProfile) {
        result.pass = false;
        result.failures.push(`Expected profile ${exp.sessionRetrievalProfile}, got ${s.retrieval_profile}`);
      }
    }

    // New session isolation test
    if (c.newSessionTurns) {
      const r = await post('/v1/chat/completions', {
        processing_mode: MODE,
        messages: c.newSessionTurns.map(t => ({ role: 'user', content: t.content }))
      });
      const nc = r.choices?.[0]?.message?.content || '';
      if (exp.newSession_status === 'no-context') {
        if (!nc.toLowerCase().includes('no-context') && !nc.toLowerCase().includes('not contain enough evidence')) {
          result.pass = false;
          result.failures.push('New session should be no-context');
        }
      }
      if (exp.newSession_mustNotContain) {
        const found = checkNotContain(nc, exp.newSession_mustNotContain);
        if (found.length > 0) { result.pass = false; result.failures.push(`New session should not contain: ${found.join(', ')}`); }
      }
    }

    // Cleanup KB
    for (const id of sourceIds) {
      try { await del(`/v1/kb/sources/${id}`); } catch {}
    }
  } catch (e) {
    result.pass = false;
    result.failures.push(`Exception: ${e.message}`);
  }
  result.durationMs = Date.now() - start;
  return result;
}

async function main() {
  // Check server is up
  try { await get('/health'); } catch {
    console.error(`Server not reachable at ${BASE}. Start with: MRP_SERVER_PORT=${PORT} npm run server`);
    process.exit(1);
  }

  // Load all evaluation files
  const files = readdirSync(EVAL_DIR).filter(f => f.endsWith('.json')).sort();
  let allCases = [];
  for (const f of files) {
    const cases = JSON.parse(readFileSync(resolve(EVAL_DIR, f), 'utf-8'));
    allCases.push(...cases);
  }
  if (FILTER) allCases = allCases.filter(c => c.category === FILTER);

  console.log(`Running ${allCases.length} evaluation cases against ${BASE} (mode: ${MODE})\n`);

  const results = [];
  let passed = 0, failed = 0;
  for (const c of allCases) {
    const r = await runCase(c);
    results.push(r);
    const icon = r.pass ? '✅' : '❌';
    const dur = `${r.durationMs}ms`;
    console.log(`${icon} ${r.id} — ${r.description} (${dur})`);
    if (!r.pass) {
      for (const f of r.failures) console.log(`   ↳ ${f}`);
      failed++;
    } else {
      passed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${allCases.length} | Passed: ${passed} | Failed: ${failed} | Pass rate: ${(passed / allCases.length * 100).toFixed(1)}%`);
  console.log(`Total duration: ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);

  // Save results
  mkdirSync(resolve(EVAL_DIR, 'results'), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(resolve(EVAL_DIR, 'results', `eval-${ts}.json`), JSON.stringify({ timestamp: new Date().toISOString(), mode: MODE, total: allCases.length, passed, failed, results }, null, 2));
  console.log(`\nResults saved to test/evaluation/results/eval-${ts}.json`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
