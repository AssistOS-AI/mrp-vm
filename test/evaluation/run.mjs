// DS021 — Evaluation Runner
// Single isolated server (tmpdir), shared LLM cache, bare sessions like chat.
// Usage: node test/evaluation/run.mjs [--suite suite01] [--port 4100] [--timeout 45000]
import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const EVAL_DIR = __dirname;
const PORT = parseInt(arg('--port') || '4100', 10);
const SUITE_FILTER = arg('--suite');
const Q_TIMEOUT = parseInt(arg('--timeout') || '45000', 10);

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function lower(s) { return (s || '').toLowerCase(); }
function checkMention(text, terms) { const l = lower(text); return terms.filter(t => !l.includes(lower(t))); }
function checkNotContain(text, terms) { const l = lower(text); return terms.filter(t => l.includes(lower(t))); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(base, method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${base}${path}`, opts);
  if (method === 'DELETE') return {};
  return r.json();
}

async function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Question timeout')), ms); });
  try { return await Promise.race([promise, t]); } finally { clearTimeout(timer); }
}

function createIsolatedConfig(tmpDir, port) {
  const configDir = join(tmpDir, 'config');
  const dataDir = join(tmpDir, 'data', 'kb');
  cpSync(join(PROJECT_ROOT, 'config'), configDir, { recursive: true });
  // Isolated KB paths
  const kb = JSON.parse(readFileSync(join(configDir, 'kb.json'), 'utf-8'));
  for (const key of Object.keys(kb.paths)) {
    kb.paths[key] = join(dataDir, key);
    mkdirSync(kb.paths[key], { recursive: true });
  }
  writeFileSync(join(configDir, 'kb.json'), JSON.stringify(kb, null, 2));
  // Isolated port
  const srv = JSON.parse(readFileSync(join(configDir, 'server.json'), 'utf-8'));
  srv.port = port;
  writeFileSync(join(configDir, 'server.json'), JSON.stringify(srv, null, 2));
  // Shared LLM cache
  const llm = JSON.parse(readFileSync(join(configDir, 'llm.json'), 'utf-8'));
  llm.cacheDir = join(PROJECT_ROOT, 'data', 'cache');
  mkdirSync(llm.cacheDir, { recursive: true });
  writeFileSync(join(configDir, 'llm.json'), JSON.stringify(llm, null, 2));
  return configDir;
}

function startServer(configDir) {
  return new Promise((res, rej) => {
    const child = spawn('node', [join(PROJECT_ROOT, 'src', 'server', 'index.mjs')], {
      env: { ...process.env, MRP_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: PROJECT_ROOT
    });
    let started = false;
    const timeout = setTimeout(() => { if (!started) { child.kill(); rej(new Error('Server start timeout')); } }, 30000);
    child.stderr.on('data', d => {
      if (process.env.LOG_VERBOSE) process.stderr.write(d);
      if (d.toString().includes('Server listening') && !started) { started = true; clearTimeout(timeout); res(child); }
    });
    child.on('error', e => { clearTimeout(timeout); rej(e); });
    child.on('exit', code => { if (!started) { clearTimeout(timeout); rej(new Error(`Server exited ${code}`)); } });
  });
}

async function waitReady(base, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try { await fetchJson(base, 'GET', '/health'); return; } catch { await sleep(300); }
  }
  throw new Error(`Server not ready at ${base}`);
}

function gatherText(doc) {
  let text = '';
  if (!doc?.groups) return text;
  for (const g of doc.groups) {
    for (const u of g.currentTurnContext || []) text += ` ${u.claim || ''} ${u.procedure || ''} ${u.id || ''} ${u.topic || ''}`;
    for (const s of g.sessionSources || []) text += ` ${s.unitId || ''}`;
    for (const s of g.kbSources || []) text += ` ${s.unitId || ''}`;
  }
  return text;
}

function scoreContext(exp, doc, fullText) {
  const ctx = gatherText(doc) + ' ' + (fullText || '');
  const m = { recall: 1, precision: 1 };
  if (exp.contextMustMention?.length) {
    const miss = checkMention(ctx, exp.contextMustMention);
    m.recall = 1 - miss.length / exp.contextMustMention.length;
  }
  if (exp.contextMustNotMention?.length) {
    const found = checkNotContain(ctx, exp.contextMustNotMention);
    m.precision = 1 - found.length / exp.contextMustNotMention.length;
  }
  m.f1 = m.recall + m.precision > 0 ? 2 * m.recall * m.precision / (m.recall + m.precision) : 0;
  return m;
}

async function runQuestion(q, base, sessionId) {
  const result = { id: q.id, pass: true, answerPass: true, contextPass: true, failures: [], durationMs: 0, contextQuality: null };

  let r;
  const start = Date.now();
  r = await withTimeout(
    fetchJson(base, 'POST', '/chat/completions', {
      session_id: sessionId,
      messages: [{ role: 'user', content: q.input }]
    }),
    Q_TIMEOUT
  );
  result.durationMs = Date.now() - start;

  if (r.error) {
    result.pass = result.answerPass = result.contextPass = false;
    result.failures.push({ check: 'api', expected: 'ok', got: `${r.error.code}: ${r.error.message}` });
    return result;
  }

  const content = r.choices?.[0]?.message?.content || '';
  const doc = r.response_document || null;
  const exp = q.expected;
  const answerText = doc?.groups?.map(g => g.answerMarkdown || '').join(' ') || content;
  const contextText = gatherText(doc) + ' ' + content;

  for (const ei of exp.intents || []) {
    const matched = doc?.groups?.some(g => !ei.intentMustMention?.length || ei.intentMustMention.every(t => lower(g.intent).includes(lower(t))))
      || (ei.intentMustMention || []).every(t => lower(content).includes(lower(t)));
    if (!matched) { result.answerPass = false; result.failures.push({ check: 'intent', expected: (ei.intentMustMention || []).join(', '), got: 'no match' }); }
  }

  result.contextQuality = scoreContext(exp, doc, content);

  if (exp.contextMustMention?.length) {
    const miss = checkMention(contextText, exp.contextMustMention);
    if (miss.length) { result.contextPass = false; result.failures.push({ check: 'ctx-recall', expected: exp.contextMustMention.join(', '), got: `missing: ${miss.join(', ')}` }); }
  }
  if (exp.contextMustNotMention?.length) {
    const found = checkNotContain(contextText, exp.contextMustNotMention);
    if (found.length) { result.contextPass = false; result.failures.push({ check: 'ctx-precision', expected: `NOT ${exp.contextMustNotMention.join(', ')}`, got: `found: ${found.join(', ')}` }); }
  }
  if (exp.answerMustMention) {
    const miss = checkMention(answerText, exp.answerMustMention);
    if (miss.length) { result.answerPass = false; result.failures.push({ check: 'answer', expected: exp.answerMustMention.join(', '), got: `missing: ${miss.join(', ')}` }); }
  }
  if (exp.answerMustNotContain) {
    const found = checkNotContain(answerText, exp.answerMustNotContain);
    if (found.length) { result.answerPass = false; result.failures.push({ check: 'answer-noise', expected: `NOT ${exp.answerMustNotContain.join(', ')}`, got: `found: ${found.join(', ')}` }); }
  }

  result.pass = result.answerPass && result.contextPass;
  return result;
}

async function runSuite(suiteDir, base) {
  const evalData = JSON.parse(readFileSync(join(suiteDir, 'eval.json'), 'utf-8'));
  const storyContent = readFileSync(join(suiteDir, evalData.storyFile || 'story.nl'), 'utf-8');
  const ingestPayload = { name: 'eval-story.nl', content: storyContent };
  if (evalData.ingestSeedDetectorPlugin) {
    ingestPayload.seed_detector_plugin = evalData.ingestSeedDetectorPlugin;
  }

  const results = [];
  for (const q of evalData.questions) {
    process.stdout.write(`    ⏳ ${q.id}...`);
    try {
      // Fresh session per question — no history contamination
      const sessionRes = await fetchJson(base, 'POST', '/sessions', {});
      if (!sessionRes.session_id) throw new Error(sessionRes.error?.message || 'session create failed');
      if (results.length === 0) {
        console.log(`\n  ${C.dim}sd:${sessionRes.seed_detector_plugin} kb:${sessionRes.kb_plugin} gs:${sessionRes.goal_solver_plugin}${C.reset}`);
        process.stdout.write(`    ⏳ ${q.id}...`);
      }
      await fetchJson(base, 'POST', `/sessions/${sessionRes.session_id}/workspace/sources`, ingestPayload);
      const r = await runQuestion(q, base, sessionRes.session_id);
      await fetchJson(base, 'DELETE', `/sessions/${sessionRes.session_id}`);
      results.push(r);
      const icon = r.pass ? `${C.green}✅` : `${C.red}✗ `;
      process.stdout.write(`\r    ${icon}${C.reset} ${q.id} ${C.dim}(${r.durationMs}ms)${C.reset}\n`);
      for (const f of r.failures) {
        console.log(`      ${C.yellow}[${f.check}]${C.reset} expected: ${C.green}${f.expected}${C.reset} got: ${C.red}${f.got}${C.reset}`);
      }
    } catch (e) {
      results.push({ id: q.id, pass: false, failures: [{ check: 'error', expected: 'ok', got: e.message }], durationMs: 0, contextQuality: { recall: 0, precision: 0, f1: 0 } });
      process.stdout.write(`\r    ${C.red}✗ ${C.reset} ${q.id} ${C.red}${e.message}${C.reset}\n`);
    }
  }

  const passed = results.filter(r => r.pass).length;
  const avgF1 = results.reduce((s, r) => s + (r.contextQuality?.f1 || 0), 0) / (results.length || 1);
  return { suiteId: evalData.suiteId, passed, failed: results.length - passed, total: results.length, avgF1, results };
}

async function main() {
  const tmpDir = join(tmpdir(), `mrp-eval-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  const configDir = createIsolatedConfig(tmpDir, PORT);
  const base = `http://127.0.0.1:${PORT}`;

  const entries = readdirSync(EVAL_DIR).filter(e => {
    try { return statSync(join(EVAL_DIR, e)).isDirectory() && e.startsWith('suite'); } catch { return false; }
  }).sort();
  const suites = SUITE_FILTER ? entries.filter(e => e === SUITE_FILTER) : entries;
  if (!suites.length) { console.error('No suites found.'); process.exit(1); }

  let serverProc;
  try {
    console.log(`${C.dim}Starting isolated server on port ${PORT}...${C.reset}`);
    serverProc = await startServer(configDir);
    await waitReady(base);
    console.log(`${C.bold}${suites.length} suite(s) — bare sessions (engine decides)${C.reset}\n`);

    const allResults = [];
    for (const suite of suites) {
      console.log(`${C.cyan}${C.bold}── ${suite}${C.reset}`);
      const r = await runSuite(join(EVAL_DIR, suite), base);
      allResults.push(r);
      const icon = r.failed === 0 ? C.green : C.red;
      console.log(`  ${icon}${C.bold}${r.passed}/${r.total} passed${C.reset} F1:${r.avgF1.toFixed(2)}\n`);
    }

    const totalP = allResults.reduce((s, r) => s + r.passed, 0);
    const totalF = allResults.reduce((s, r) => s + r.failed, 0);
    const avgF1 = allResults.reduce((s, r) => s + r.avgF1, 0) / (allResults.length || 1);
    console.log(`${C.bold}TOTAL: ${totalP}/${totalP + totalF} passed, avg F1: ${avgF1.toFixed(2)}${C.reset}`);

    mkdirSync(join(EVAL_DIR, 'results'), { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(EVAL_DIR, 'results', `eval-${ts}.json`), JSON.stringify({
      timestamp: new Date().toISOString(),
      suites: allResults, totalPassed: totalP, totalFailed: totalF
    }, null, 2));
    console.log(`${C.dim}Results → test/evaluation/results/eval-${ts}.json${C.reset}`);

    process.exit(totalF > 0 ? 1 : 0);
  } finally {
    if (serverProc) serverProc.kill();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main();
