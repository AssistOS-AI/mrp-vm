// DS021 — Evaluation Runner (matrix: mode × profile, context precision)
// Usage: node test/evaluation/run.mjs [--suite suite01] [--port 4000] [--mode llm-assisted] [--profile balanced]
import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const EVAL_DIR = __dirname;
const BASE_PORT = parseInt(arg('--port') || '4000', 10);
const SUITE_FILTER = arg('--suite');
const MODE_FILTER = arg('--mode');
const PROFILE_FILTER = arg('--profile');
const DELAY_MS = parseInt(arg('--delay') || '2000', 10);

const ALL_MODES = ['llm-assisted', 'symbolic-only'];
const ALL_PROFILES = ['fast', 'balanced', 'wide-recall'];

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m'
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

function createIsolatedConfig(tmpDir, port) {
  const configDir = join(tmpDir, 'config');
  const dataDir = join(tmpDir, 'data', 'kb');
  const cacheDir = join(tmpDir, 'data', 'cache');
  cpSync(join(PROJECT_ROOT, 'config'), configDir, { recursive: true });
  const kb = JSON.parse(readFileSync(join(configDir, 'kb.json'), 'utf-8'));
  for (const key of Object.keys(kb.paths)) {
    kb.paths[key] = join(dataDir, key);
    mkdirSync(kb.paths[key], { recursive: true });
  }
  writeFileSync(join(configDir, 'kb.json'), JSON.stringify(kb, null, 2));
  const srv = JSON.parse(readFileSync(join(configDir, 'server.json'), 'utf-8'));
  srv.port = port;
  writeFileSync(join(configDir, 'server.json'), JSON.stringify(srv, null, 2));
  // Point LLM cache to shared project cache (survives across runs)
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

// ── Context quality ──

function gatherContextText(doc) {
  let text = '';
  if (!doc?.groups) return text;
  for (const g of doc.groups) {
    for (const u of g.currentTurnContext || []) text += ` ${u.claim || ''} ${u.procedure || ''} ${u.id || ''} ${u.topic || ''}`;
    for (const s of g.sessionSources || []) text += ` ${s.unitId || ''}`;
    for (const s of g.kbSources || []) text += ` ${s.unitId || ''}`;
  }
  return text;
}

function scoreContextQuality(exp, doc, fullText) {
  const ctx = gatherContextText(doc) + ' ' + (fullText || '');
  const metrics = { recall: 1, precision: 1, details: [] };
  if (exp.contextMustMention?.length) {
    const missing = checkMention(ctx, exp.contextMustMention);
    metrics.recall = 1 - missing.length / exp.contextMustMention.length;
    if (missing.length) metrics.details.push(`recall miss: ${missing.join(', ')}`);
  }
  if (exp.contextMustNotMention?.length) {
    const found = checkNotContain(ctx, exp.contextMustNotMention);
    metrics.precision = 1 - found.length / exp.contextMustNotMention.length;
    if (found.length) metrics.details.push(`precision leak: ${found.join(', ')}`);
  }
  metrics.f1 = metrics.recall + metrics.precision > 0
    ? 2 * metrics.recall * metrics.precision / (metrics.recall + metrics.precision) : 0;
  return metrics;
}

// ── Intent matching ──

function matchIntents(expectedIntents, responseDoc, fullText) {
  const failures = [];
  if (!expectedIntents?.length) return failures;
  const actual = responseDoc?.groups || [];
  for (const ei of expectedIntents) {
    let matched = false;
    for (const ag of actual) {
      if (!ei.intentMustMention?.length || ei.intentMustMention.every(t => lower(ag.intent).includes(lower(t)))) { matched = true; break; }
    }
    if (!matched && fullText) matched = !ei.intentMustMention?.length || ei.intentMustMention.every(t => lower(fullText).includes(lower(t)));
    if (!matched) failures.push(`No intent matched [${(ei.intentMustMention || []).join(', ')}]`);
  }
  return failures;
}

// ── Question evaluation ──

async function runQuestion(q, base, mode, profile) {
  const result = { id: q.id, pass: true, answerPass: true, contextPass: true, failures: [], durationMs: 0, contextQuality: null };
  const start = Date.now();
  const r = await fetchJson(base, 'POST', '/v1/chat/completions', {
    processing_mode: mode, retrieval_profile: profile,
    messages: [{ role: 'user', content: q.input }]
  });
  result.durationMs = Date.now() - start;
  if (r.error) {
    result.pass = result.answerPass = result.contextPass = false;
    result.failures.push({ check: 'api', expected: 'successful response', got: `${r.error.code}: ${r.error.message}` });
    return result;
  }

  const content = r.choices?.[0]?.message?.content || '';
  const doc = r.response_document || null;
  const exp = q.expected;
  const answerText = doc?.groups?.map(g => g.answerMarkdown || '').join(' ') || content;
  const contextText = gatherContextText(doc) + ' ' + content;
  const answerSnippet = answerText.slice(0, 200).replace(/\n/g, ' ');

  // Intent matching — counts as answer fail
  const intentFails = matchIntents(exp.intents, doc, content);
  if (intentFails.length) {
    result.answerPass = false;
    const actualIntents = doc?.groups?.map(g => `"${g.intent}"`).join(', ') || '(none)';
    result.failures.push({ check: 'intent', expected: `intent mentioning [${exp.intents.map(e => (e.intentMustMention||[]).join(', ')).join('; ')}]`, got: actualIntents });
  }

  // Context quality
  result.contextQuality = scoreContextQuality(exp, doc, content);

  // Context recall — retrieval fail
  if (exp.contextMustMention?.length) {
    const missing = checkMention(contextText, exp.contextMustMention);
    if (missing.length) {
      result.contextPass = false;
      result.failures.push({ check: 'context recall', expected: `context to mention [${exp.contextMustMention.join(', ')}]`, got: `missing: [${missing.join(', ')}]` });
    }
  }

  // Context precision — retrieval fail
  if (exp.contextMustNotMention?.length) {
    const found = checkNotContain(contextText, exp.contextMustNotMention);
    if (found.length) {
      result.contextPass = false;
      result.failures.push({ check: 'context precision', expected: `context to NOT mention [${exp.contextMustNotMention.join(', ')}]`, got: `found unwanted: [${found.join(', ')}]` });
    }
  }

  // Answer must mention — answer fail
  if (exp.answerMustMention) {
    const missing = checkMention(answerText, exp.answerMustMention);
    if (missing.length) {
      result.answerPass = false;
      result.failures.push({ check: 'answer content', expected: `answer to contain [${exp.answerMustMention.join(', ')}]`, got: `missing [${missing.join(', ')}] — answer: "${answerSnippet}"` });
    }
  }

  // Answer must not contain — answer fail
  if (exp.answerMustNotContain) {
    const found = checkNotContain(answerText, exp.answerMustNotContain);
    if (found.length) {
      result.answerPass = false;
      result.failures.push({ check: 'answer noise', expected: `answer to NOT contain [${exp.answerMustNotContain.join(', ')}]`, got: `found unwanted [${found.join(', ')}] — answer: "${answerSnippet}"` });
    }
  }

  result.pass = result.answerPass && result.contextPass;
  return result;
}

// ── Suite runner: ONE server per suite, iterate profiles and modes on it ──

async function runSuite(suiteDir, port) {
  const evalData = JSON.parse(readFileSync(join(suiteDir, 'eval.json'), 'utf-8'));
  const storyContent = readFileSync(join(suiteDir, evalData.storyFile || 'story.nl'), 'utf-8');
  const base = `http://127.0.0.1:${port}`;
  const tmpDir = join(tmpdir(), `mrp-eval-${evalData.suiteId}-${randomUUID().slice(0, 6)}`);
  mkdirSync(tmpDir, { recursive: true });
  const configDir = createIsolatedConfig(tmpDir, port);

  const modes = MODE_FILTER ? [MODE_FILTER] : ALL_MODES;
  const profiles = PROFILE_FILTER ? [PROFILE_FILTER] : ALL_PROFILES;
  const comboResults = [];

  let serverProc;
  try {
    serverProc = await startServer(configDir);
    await waitReady(base);

    // Ingest story once with llm-assisted
    const ingestRes = await fetchJson(base, 'POST', '/v1/kb/sources', {
      name: `${evalData.suiteId}-story`, content: storyContent, processing_mode: 'llm-assisted'
    });
    if (!ingestRes.sourceId) {
      console.log(`  ${C.red}Ingest failed: ${ingestRes.error?.message}${C.reset}`);
      for (const m of modes) for (const p of profiles) {
        comboResults.push({ mode: m, profile: p, suiteId: evalData.suiteId, passed: 0,
          failed: evalData.questions.length, results: [], error: 'ingest failed', avgContextF1: 0 });
      }
      return comboResults;
    }
    console.log(`  ${C.dim}Story ingested: ${ingestRes.unitCount} units${C.reset}`);

    // Run all mode×profile combos on the same server
    for (const mode of modes) {
      for (const profile of profiles) {
        const label = `${C.dim}${mode}${C.reset}+${C.dim}${profile}${C.reset}`;
        process.stdout.write(`    ⏳ ${label}...`);

        let passed = 0, failed = 0, totalF1 = 0;
        let ansPassed = 0, ctxPassed = 0;
        const results = [];
        let comboError = null;

        for (const q of evalData.questions) {
          try {
            const result = await runQuestion(q, base, mode, profile);
            results.push(result);
            if (result.pass) passed++; else failed++;
            if (result.answerPass) ansPassed++;
            if (result.contextPass) ctxPassed++;
            totalF1 += result.contextQuality?.f1 || 0;
          } catch (e) {
            results.push({ id: q.id, pass: false, failures: [e.message], durationMs: 0, contextQuality: { recall: 0, precision: 0, f1: 0, details: [] } });
            failed++;
            comboError = e.message;
          }
        }

        const avgF1 = totalF1 / evalData.questions.length;
        const combo = { mode, profile, suiteId: evalData.suiteId, passed, failed, ansPassed, ctxPassed, total: evalData.questions.length, results, avgContextF1: avgF1, error: comboError };
        comboResults.push(combo);

        const icon = failed === 0 ? `${C.green}✅` : passed > 0 ? `${C.yellow}${passed}/${passed + failed}` : `${C.red}✗ `;
        process.stdout.write(`\r    ${icon}${C.reset} ${label} F1:${colorScore(avgF1)}\n`);
        for (const qr of results) {
          if (!qr.pass) {
            const tags = [];
            if (!qr.answerPass) tags.push(`${C.red}ANS${C.reset}`);
            if (!qr.contextPass) tags.push(`${C.yellow}CTX${C.reset}`);
            console.log(`      ${C.red}✗ ${qr.id}${C.reset} [${tags.join('+')}] ${C.dim}(${qr.durationMs}ms)${C.reset}`);
            for (const f of qr.failures) {
              if (typeof f === 'object') {
                console.log(`        ${C.yellow}[${f.check}]${C.reset} expected: ${C.green}${f.expected}${C.reset}`);
                console.log(`        ${' '.repeat(f.check.length + 2)} got:      ${C.red}${f.got}${C.reset}`);
              } else {
                console.log(`        ${C.red}${f}${C.reset}`);
              }
            }
          }
        }

        await sleep(DELAY_MS);
      }
    }
  } finally {
    if (serverProc) serverProc.kill();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  return comboResults;
}

// ── Pretty printing ──

function colorScore(score) {
  if (score >= 0.9) return `${C.green}${score.toFixed(2)}${C.reset}`;
  if (score >= 0.6) return `${C.yellow}${score.toFixed(2)}${C.reset}`;
  return `${C.red}${score.toFixed(2)}${C.reset}`;
}

function colorPass(p, f) {
  const total = p + f;
  const rate = total > 0 ? p / total : 0;
  const pct = `${(rate * 100).toFixed(0)}%`;
  if (rate >= 0.9) return `${C.green}${C.bold}${p}/${total} ${pct}${C.reset}`;
  if (rate >= 0.5) return `${C.yellow}${C.bold}${p}/${total} ${pct}${C.reset}`;
  return `${C.red}${C.bold}${p}/${total} ${pct}${C.reset}`;
}

function printMatrix(allResults) {
  const suites = [...new Set(allResults.map(r => r.suiteId))];

  for (const suite of suites) {
    const sr = allResults.filter(r => r.suiteId === suite);
    console.log(`\n${C.bold}${C.cyan}═══ ${suite} ═══${C.reset}`);
    console.log(`  ${C.bold}${'Mode'.padEnd(16)}${'Profile'.padEnd(14)}${'All'.padEnd(12)}${'Ans'.padEnd(12)}${'Ctx'.padEnd(12)}${'Recall'.padEnd(10)}${'Prec'.padEnd(10)}${'F1'.padEnd(10)}${'ms'}${C.reset}`);
    console.log(`  ${'─'.repeat(96)}`);

    for (const r of sr) {
      if (r.error && !r.results.length) {
        console.log(`  ${r.mode.padEnd(16)}${r.profile.padEnd(14)}${C.red}ERROR: ${r.error.slice(0, 50)}${C.reset}`);
        continue;
      }
      const n = r.total || r.results.length;
      const avgRecall = r.results.reduce((s, x) => s + (x.contextQuality?.recall || 0), 0) / r.results.length;
      const avgPrec = r.results.reduce((s, x) => s + (x.contextQuality?.precision || 0), 0) / r.results.length;
      const avgMs = Math.round(r.results.reduce((s, x) => s + x.durationMs, 0) / r.results.length);
      const allP = colorPass(r.passed, r.failed);
      const ansP = colorPass(r.ansPassed ?? r.passed, n - (r.ansPassed ?? r.passed));
      const ctxP = colorPass(r.ctxPassed ?? n, n - (r.ctxPassed ?? n));
      console.log(`  ${r.mode.padEnd(16)}${r.profile.padEnd(14)}${allP.padEnd(24)}${ansP.padEnd(24)}${ctxP.padEnd(24)}${colorScore(avgRecall).padEnd(21)}${colorScore(avgPrec).padEnd(21)}${colorScore(r.avgContextF1).padEnd(21)}${C.dim}${avgMs}${C.reset}`);
    }
  }

  // Aggregate
  console.log(`\n${C.bold}${C.magenta}═══ AGGREGATE ═══${C.reset}`);
  const valid = allResults.filter(r => r.results.length > 0);
  const totalQ = valid.reduce((s, r) => s + r.passed + r.failed, 0);
  const totalP = valid.reduce((s, r) => s + r.passed, 0);
  const avgF1 = valid.length ? valid.reduce((s, r) => s + r.avgContextF1, 0) / valid.length : 0;
  console.log(`  Questions: ${totalQ} across ${valid.length} combos`);
  console.log(`  Pass: ${colorPass(totalP, totalQ - totalP)}`);
  console.log(`  Avg context F1: ${colorScore(avgF1)}`);

  const sorted = [...valid].sort((a, b) => b.avgContextF1 - a.avgContextF1);
  if (sorted.length >= 2) {
    const best = sorted[0], worst = sorted[sorted.length - 1];
    console.log(`  ${C.green}Best:${C.reset}  ${best.mode}+${best.profile} (F1: ${best.avgContextF1.toFixed(2)}, pass: ${best.passed}/${best.passed + best.failed})`);
    console.log(`  ${C.red}Worst:${C.reset} ${worst.mode}+${worst.profile} (F1: ${worst.avgContextF1.toFixed(2)}, pass: ${worst.passed}/${worst.passed + worst.failed})`);
  }
}

// ── Main ──

async function main() {
  const entries = readdirSync(EVAL_DIR).filter(e => {
    try { return statSync(join(EVAL_DIR, e)).isDirectory() && e.startsWith('suite'); } catch { return false; }
  }).sort();
  const suites = SUITE_FILTER ? entries.filter(e => e === SUITE_FILTER) : entries;
  if (!suites.length) { console.error('No suites found.'); process.exit(1); }

  const modes = MODE_FILTER ? [MODE_FILTER] : ALL_MODES;
  const profiles = PROFILE_FILTER ? [PROFILE_FILTER] : ALL_PROFILES;
  const combos = modes.length * profiles.length;

  console.log(`${C.bold}${suites.length} suite(s) × ${combos} combos (${modes.join(',')} × ${profiles.join(',')})${C.reset}\n`);

  let portCounter = BASE_PORT;
  const allResults = [];

  for (const suite of suites) {
    const port = portCounter++;
    console.log(`${C.cyan}${C.bold}── ${suite}${C.reset} ${C.dim}(port ${port})${C.reset}`);
    const results = await runSuite(join(EVAL_DIR, suite), port);
    allResults.push(...results);
  }

  printMatrix(allResults);

  mkdirSync(join(EVAL_DIR, 'results'), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(EVAL_DIR, 'results', `eval-${ts}.json`), JSON.stringify({
    timestamp: new Date().toISOString(), combos, suites: suites.length,
    totalPassed: allResults.reduce((s, r) => s + r.passed, 0),
    totalFailed: allResults.reduce((s, r) => s + r.failed, 0),
    results: allResults
  }, null, 2));
  console.log(`\n${C.dim}Results → test/evaluation/results/eval-${ts}.json${C.reset}`);

  process.exit(allResults.some(r => r.failed > 0 || r.error) ? 1 : 0);
}

main();
