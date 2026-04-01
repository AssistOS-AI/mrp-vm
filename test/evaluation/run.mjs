// DS021 — Evaluation Runner
// Default behavior uses one stable session per suite, loads reusable source
// context through /sessions/:id/context, then asks all questions through the
// same chat API. Workspace source staging remains an explicit secondary path.
// Usage:
//   node test/evaluation/run.mjs [--suite suite01] [--port 4100] [--timeout 45000]
// Optional:
//   --matrix  Expand suite pluginCombos for comparative runs.
//   --workspace-ingest  Use /sessions/:id/workspace/sources instead of
//                       loading reusable context through /sessions/:id/context.
//   --probe  Run a direct LLM bridge probe before suite execution.
//   --verbose-server  Stream server stderr while the run is active.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LLMBridge } from '../../src/core/llm/bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const EVAL_DIR = __dirname;
const DEFAULT_PORT = 4100 + Math.floor(Math.random() * 2000);
const PORT = parseInt(arg('--port') || String(DEFAULT_PORT), 10);
const SUITE_FILTER = arg('--suite');
const Q_TIMEOUT = parseInt(arg('--timeout') || '45000', 10);
const INGEST_TIMEOUT = parseInt(arg('--ingest-timeout') || '120000', 10);
const PROBE_TIMEOUT = parseInt(arg('--probe-timeout') || '8000', 10);
const MATRIX_MODE = hasFlag('--matrix');
const WORKSPACE_INGEST = hasFlag('--workspace-ingest');
const PROGRESS_INTERVAL_MS = parseInt(arg('--progress-interval') || '2000', 10);
const VERBOSE_SERVER = hasFlag('--verbose-server');
const PROBE_LLM = hasFlag('--probe') && !hasFlag('--skip-probe');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function hasFlag(name) { return process.argv.includes(name); }
function lower(s) { return (s || '').toLowerCase(); }
// Word-boundary aware matching to avoid false positives (e.g., "No" matching "technology")
function checkMention(text, terms) {
  const l = lower(text);
  return terms.filter(t => {
    const pattern = new RegExp(`\\b${lower(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return !pattern.test(l);
  });
}
function checkNotContain(text, terms) {
  const l = lower(text);
  return terms.filter(t => {
    const pattern = new RegExp(`\\b${lower(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return pattern.test(l);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function preview(text, max = 140) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1) + '…';
}
function compactSurface(surface) {
  return [
    `planner:${surface?.plannerPlugin || 'auto'}`,
    `sd:${surface?.seedDetectorPlugin || 'auto'}`,
    `kb:${surface?.kbPlugin || 'auto'}`,
    `gs:${surface?.goalSolverPlugin || 'auto'}`
  ].join(' ');
}

function evalPathLabel() {
  return WORKSPACE_INGEST
    ? '/sessions/:id/workspace/sources -> /chat/completions'
    : '/sessions/:id/context -> /chat/completions';
}

function formatServerJsonLine(line) {
  try {
    const entry = JSON.parse(line);
    if (!entry?.level || !entry?.module || !entry?.msg) return null;
    if (entry.level === 'debug') return null;
    const details = entry.details && Object.keys(entry.details).length
      ? ` ${JSON.stringify(entry.details)}`
      : '';
    const extra = Object.fromEntries(
      Object.entries(entry).filter(([key]) => !['ts', 'level', 'module', 'msg', 'details'].includes(key))
    );
    const extraText = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    return `[server] ${String(entry.level).toUpperCase()} [${entry.module}] ${entry.msg}${details}${extraText}`;
  } catch {
    return null;
  }
}

function createProgressTracker(label, prefix = '') {
  const startedAt = Date.now();
  console.log(`${prefix}${C.dim}→ ${label}${C.reset}`);
  const timer = setInterval(() => {
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`${prefix}${C.dim}… waiting: ${label} (${elapsedSec}s)${C.reset}`);
  }, PROGRESS_INTERVAL_MS);
  return {
    done(detail = '') {
      clearInterval(timer);
      const elapsedMs = Date.now() - startedAt;
      const suffix = detail ? ` ${detail}` : '';
      console.log(`${prefix}${C.dim}✓ ${label} (${elapsedMs}ms)${suffix}${C.reset}`);
    },
    fail(error) {
      clearInterval(timer);
      const elapsedMs = Date.now() - startedAt;
      console.log(`${prefix}${C.red}✗ ${label} failed after ${elapsedMs}ms: ${error.message}${C.reset}`);
    }
  };
}

async function withProgress(label, work, prefix = '') {
  const tracker = createProgressTracker(label, prefix);
  try {
    const result = await work();
    tracker.done();
    return result;
  } catch (error) {
    tracker.fail(error);
    throw error;
  }
}

async function fetchJson(base, method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${base}${path}`, opts);
  if (method === 'DELETE') return {};
  const raw = await r.text();
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${method} ${path} returned ${r.status} with non-JSON body: ${preview(raw, 240)}`);
  }
  if (!r.ok && parsed?.error) {
    return parsed;
  }
  if (!r.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${r.status}: ${preview(raw, 240)}`);
  }
  return parsed;
}

async function fetchChatCompletionStream(base, body, { onProgress } = {}) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true })
  });
  const contentType = r.headers.get('content-type') || '';
  if (!r.ok || !contentType.includes('text/event-stream')) {
    const raw = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    if (parsed?.error) throw new Error(`${parsed.error.code || 'STREAM_ERROR'}: ${parsed.error.message}`);
    throw new Error(`Streaming request failed with HTTP ${r.status}: ${preview(raw, 240)}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completedPayload = null;

  const dispatch = (rawEvent) => {
    const lines = rawEvent.split('\n');
    let eventName = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    const rawData = dataLines.join('\n');
    let payload;
    try { payload = JSON.parse(rawData); } catch { payload = { raw: rawData }; }
    if (eventName === 'progress') {
      onProgress?.(payload);
      return;
    }
    if (eventName === 'response.completed') {
      completedPayload = payload;
      return;
    }
    if (eventName === 'error') {
      throw new Error(payload.error?.message || 'Streaming failed');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) break;
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent) continue;
      dispatch(rawEvent);
    }
  }

  if (!completedPayload) {
    throw new Error('Streaming completed without response.completed payload');
  }
  return completedPayload;
}

async function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Operation timeout after ${ms}ms`)), ms); });
  try { return await Promise.race([promise, t]); } finally { clearTimeout(timer); }
}

function createIsolatedConfig(tmpDir, port) {
  const configDir = join(tmpDir, 'config');
  const dataDir = join(tmpDir, 'data', 'kb');
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
  const llm = JSON.parse(readFileSync(join(configDir, 'llm.json'), 'utf-8'));
  llm.cacheDir = join(PROJECT_ROOT, 'data', 'cache');
  mkdirSync(llm.cacheDir, { recursive: true });
  writeFileSync(join(configDir, 'llm.json'), JSON.stringify(llm, null, 2));
  return configDir;
}

function startServer(configDir) {
  return new Promise((res, rej) => {
    const child = spawn('node', [join(PROJECT_ROOT, 'src', 'server', 'index.mjs')], {
      env: {
        ...process.env,
        MRP_CONFIG_DIR: configDir,
        ...(VERBOSE_SERVER ? { LOG_VERBOSE: '1' } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: PROJECT_ROOT
    });
    let started = false;
    const stderrLines = [];
    let stderrBuffer = '';
    const rememberStderr = chunk => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      stderrLines.push(...lines);
      while (stderrLines.length > 40) stderrLines.shift();
    };
    const flushServerBuffer = text => {
      stderrBuffer += text;
      let newlineIndex = stderrBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stderrBuffer.slice(0, newlineIndex).trim();
        stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
        if (!line) {
          newlineIndex = stderrBuffer.indexOf('\n');
          continue;
        }
        const formatted = formatServerJsonLine(line);
        if (formatted) console.log(formatted);
        newlineIndex = stderrBuffer.indexOf('\n');
      }
    };
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        const tail = stderrLines.length ? `\nServer stderr tail:\n${stderrLines.join('\n')}` : '';
        rej(new Error(`Server start timeout${tail}`));
      }
    }, 30000);
    child.stderr.on('data', d => {
      rememberStderr(d);
      if (VERBOSE_SERVER) process.stderr.write(`[server] ${d}`);
      else flushServerBuffer(d.toString());
      if (d.toString().includes('Server listening') && !started) {
        started = true;
        clearTimeout(timeout);
        res(child);
      }
    });
    child.on('error', e => {
      clearTimeout(timeout);
      rej(e);
    });
    child.on('exit', code => {
      if (!started) {
        clearTimeout(timeout);
        const tail = stderrLines.length ? `\nServer stderr tail:\n${stderrLines.join('\n')}` : '';
        rej(new Error(`Server exited ${code}${tail}`));
      }
    });
  });
}

async function runLLMProbe(configDir) {
  const llmConfig = JSON.parse(readFileSync(join(configDir, 'llm.json'), 'utf-8'));
  const bridge = new LLMBridge(llmConfig);
  await bridge.init();
  if (!bridge.agent) {
    return {
      skipped: true,
      ok: false,
      reason: 'LLM bridge not available',
      model: llmConfig.defaultModel || null
    };
  }
  const nonce = randomUUID().slice(0, 8);
  const expected = `hello-${nonce}`;
  const model = llmConfig.defaultModel || 'fast';
  const startedAt = Date.now();
  const response = await bridge.call(
    'Reply with exactly the requested token and nothing else.',
    `Return exactly this token: ${expected}`,
    {
      model,
      timeout: PROBE_TIMEOUT,
      operation: 'eval-probe',
      noCache: true
    }
  );
  return {
    skipped: false,
    ok: lower(response).includes(lower(expected)),
    model,
    expected,
    response,
    durationMs: Date.now() - startedAt
  };
}

async function waitReady(base, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetchJson(base, 'GET', '/health');
      return;
    } catch {
      await sleep(300);
    }
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

function buildRequestedSurface(combo = null) {
  return {
    plannerPlugin: combo?.plannerPlugin || null,
    seedDetectorPlugin: combo?.seedDetectorPlugin || null,
    kbPlugin: combo?.kbPlugin || null,
    goalSolverPlugin: combo?.goalSolverPlugin || null
  };
}

function buildSessionBody(combo = null) {
  const body = {};
  if (combo?.plannerPlugin) body.planner_plugin = combo.plannerPlugin;
  if (combo?.seedDetectorPlugin) body.seed_detector_plugin = combo.seedDetectorPlugin;
  if (combo?.kbPlugin) body.kb_plugin = combo.kbPlugin;
  if (combo?.goalSolverPlugin) body.goal_solver_plugin = combo.goalSolverPlugin;
  return body;
}

function summarizeResults(results) {
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  const avgF1 = results.reduce((sum, r) => sum + (r.contextQuality?.f1 || 0), 0) / (results.length || 1);
  return { passed, failed, total: results.length, avgF1 };
}

async function runQuestion(q, base, sessionId, options = {}) {
  const result = {
    id: q.id,
    input: q.input,
    pass: true,
    answerPass: true,
    contextPass: true,
    failures: [],
    durationMs: 0,
    contextQuality: null,
    runtimeSurface: null,
    processingMode: null,
    retrievalProfile: null,
    assistantMessage: null,
    responseDocument: null,
    executionTrace: null
  };

  const start = Date.now();
  const messageContent = options.messageContent || q.input;
  const timeoutMs = options.timeoutMs || Q_TIMEOUT;
  const progressLabel = options.progressLabel || `question ${q.id} → /chat/completions`;
  const body = {
    session_id: sessionId,
    messages: options.messages || [{ role: 'user', content: messageContent }]
  };
  let lastProgressMessage = '';
  const r = await withProgress(
    progressLabel,
    () => withTimeout(fetchChatCompletionStream(base, body, {
      onProgress: (event) => {
        const msg = event?.message || `${event?.stage || event?.type || 'progress'} ${event?.status || event?.event || ''}`.trim();
        if (!msg || msg === lastProgressMessage) return;
        lastProgressMessage = msg;
        console.log(`    ${C.dim}[progress] ${msg}${C.reset}`);
      }
    }), timeoutMs),
    '    '
  );
  result.durationMs = Date.now() - start;
  result.runtimeSurface = {
    plannerPlugin: r.planner_plugin || null,
    seedDetectorPlugin: r.seed_detector_plugin || null,
    kbPlugin: r.kb_plugin || null,
    goalSolverPlugin: r.goal_solver_plugin || null
  };
  result.processingMode = r.processing_mode || null;
  result.retrievalProfile = r.retrieval_profile || null;
  result.assistantMessage = r.choices?.[0]?.message?.content || '';
  result.responseDocument = r.response_document || null;
  result.executionTrace = r.execution_trace || null;

  if (r.error) {
    result.pass = false;
    result.answerPass = false;
    result.contextPass = false;
    result.failures.push({ check: 'api', conclusion: `API error: ${r.error.code}: ${r.error.message}` });
    return result;
  }

  const doc = result.responseDocument;
  const exp = q.expected || {};
  const answerText = doc?.groups?.map(g => g.answerMarkdown || '').join(' ') || result.assistantMessage;
  const contextText = gatherText(doc) + ' ' + result.assistantMessage;

  for (const ei of exp.intents || []) {
    const matched = doc?.groups?.some(g =>
      !ei.intentMustMention?.length ||
      ei.intentMustMention.every(t => lower(g.intent).includes(lower(t)))
    ) || (ei.intentMustMention || []).every(t => lower(result.assistantMessage).includes(lower(t)));
    if (!matched) {
      result.answerPass = false;
      result.failures.push({
        check: 'intent',
        required: (ei.intentMustMention || []).join(', '),
        conclusion: 'no matching intent group found'
      });
    }
  }

  result.contextQuality = scoreContext(exp, doc, result.assistantMessage);

  const answerSnippet = (answerText || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const ctxSnippet = (contextText || '').replace(/\s+/g, ' ').trim().slice(0, 150);

  if (exp.contextMustMention?.length) {
    const miss = checkMention(contextText, exp.contextMustMention);
    if (miss.length) {
      result.contextPass = false;
      result.failures.push({
        check: 'ctx-recall',
        obtained: ctxSnippet,
        required: exp.contextMustMention.join(', '),
        conclusion: `missing from context: ${miss.join(', ')}`
      });
    }
  }
  if (exp.contextMustNotMention?.length) {
    const found = checkNotContain(contextText, exp.contextMustNotMention);
    if (found.length) {
      result.contextPass = false;
      result.failures.push({
        check: 'ctx-precision',
        obtained: ctxSnippet,
        required: `must NOT contain: ${exp.contextMustNotMention.join(', ')}`,
        conclusion: `unwanted in context: ${found.join(', ')}`
      });
    }
  }
  if (exp.answerMustMention?.length) {
    const miss = checkMention(answerText, exp.answerMustMention);
    if (miss.length) {
      result.answerPass = false;
      result.failures.push({
        check: 'answer',
        obtained: answerSnippet,
        required: exp.answerMustMention.join(', '),
        conclusion: `missing from answer: ${miss.join(', ')}`
      });
    }
  }
  if (exp.answerMustNotContain?.length) {
    const found = checkNotContain(answerText, exp.answerMustNotContain);
    if (found.length) {
      result.answerPass = false;
      result.failures.push({
        check: 'answer-noise',
        obtained: answerSnippet,
        required: `must NOT contain: ${exp.answerMustNotContain.join(', ')}`,
        conclusion: `unwanted in answer: ${found.join(', ')}`
      });
    }
  }

  result.pass = result.answerPass && result.contextPass;
  return result;
}

async function runScenario(base, evalData, storyContent, scenario) {
  if (!WORKSPACE_INGEST) {
    const sessionRes = await withProgress(
      `${scenario.label} → create session`,
      () => withTimeout(fetchJson(base, 'POST', '/sessions', buildSessionBody(scenario.combo)), 10000),
      '  '
    );
    if (!sessionRes.session_id) {
      throw new Error(sessionRes.error?.message || 'session create failed');
    }
    console.log(`  ${C.dim}${scenario.label} session defaults · ${compactSurface({
      plannerPlugin: sessionRes.planner_plugin,
      seedDetectorPlugin: sessionRes.seed_detector_plugin,
      kbPlugin: sessionRes.kb_plugin,
      goalSolverPlugin: sessionRes.goal_solver_plugin
    })}${C.reset}`);

    const sessionId = sessionRes.session_id;
    const results = [];
    let scenarioError = null;
    let contextLoadResult = null;
    try {
      contextLoadResult = await withProgress(
        `${scenario.label} → load session context ${evalData.storyFile || 'story.nl'}`,
        () => withTimeout(fetchJson(base, 'POST', `/sessions/${sessionId}/context`, {
          name: evalData.storyFile || 'story.nl',
          content: storyContent
        }), INGEST_TIMEOUT),
        '  '
      );
      if (contextLoadResult.error) {
        throw new Error(`${contextLoadResult.error.code}: ${contextLoadResult.error.message}`);
      }
      console.log(
        `  ${C.dim}${scenario.label} session context loaded · seed:${contextLoadResult.seed_detector_plugin || 'auto'} · units:${contextLoadResult.unitCount ?? 0}${C.reset}`
      );

      for (const q of evalData.questions) {
        try {
          const r = await runQuestion(q, base, sessionId);
          results.push(r);
          const icon = r.pass ? `${C.green}✅` : `${C.red}✗ `;
          console.log(`    ${icon}${C.reset} ${q.id} ${C.dim}(${r.durationMs}ms · ${compactSurface(r.runtimeSurface)})${C.reset}`);
          if (!r.pass) {
            for (const f of r.failures) {
              console.log(`      ${C.yellow}[${f.check}]${C.reset}`);
              if (f.obtained)   console.log(`        ${C.dim}Obtained:${C.reset}  ${C.red}${f.obtained}${f.obtained.length >= 150 ? '…' : ''}${C.reset}`);
              if (f.required)   console.log(`        ${C.dim}Required:${C.reset}  ${C.yellow}${f.required}${C.reset}`);
              if (f.conclusion) console.log(`        ${C.dim}Conclusion:${C.reset} ${C.red}${f.conclusion}${C.reset}`);
              if (f.detail)     console.log(`        ${C.red}${f.detail}${C.reset}`);
            }
          }
        } catch (error) {
          results.push({
            id: q.id,
            input: q.input,
            pass: false,
            answerPass: false,
            contextPass: false,
            failures: [{ check: 'error', expected: 'ok', got: error.message }],
            durationMs: 0,
            contextQuality: { recall: 0, precision: 0, f1: 0 },
            runtimeSurface: null,
            processingMode: null,
            retrievalProfile: null,
            assistantMessage: null,
            responseDocument: null,
            executionTrace: null
          });
          console.log(`    ${C.red}✗ ${C.reset} ${q.id} ${C.red}${error.message}${C.reset}`);
        }
      }
    } catch (error) {
      scenarioError = { message: error.message };
      results.push({
        id: `${scenario.label}::setup`,
        input: null,
        pass: false,
        answerPass: false,
        contextPass: false,
        failures: [{ check: 'setup', expected: 'session context loaded', got: error.message }],
        durationMs: 0,
        contextQuality: { recall: 0, precision: 0, f1: 0 },
        runtimeSurface: null,
        processingMode: null,
        retrievalProfile: null,
        assistantMessage: null,
        responseDocument: null,
        executionTrace: null
      });
    } finally {
      try {
        await withProgress(
          `${scenario.label} → delete session`,
          () => fetchJson(base, 'DELETE', `/sessions/${sessionId}`),
          '  '
        );
      } catch (cleanupError) {
        if (!scenarioError) scenarioError = { message: `cleanup failed: ${cleanupError.message}` };
      }
    }

    const summary = summarizeResults(results);
    return {
      label: scenario.label,
      mode: scenario.mode,
      error: scenarioError,
      deliveryPath: '/sessions/:id/context -> /chat/completions',
      setupPath: '/sessions/:id/context',
      requestedSurface: buildRequestedSurface(scenario.combo),
      sessionSurface: {
        plannerPlugin: sessionRes.planner_plugin || null,
        seedDetectorPlugin: sessionRes.seed_detector_plugin || null,
        kbPlugin: sessionRes.kb_plugin || null,
        goalSolverPlugin: sessionRes.goal_solver_plugin || null
      },
      ingestSurface: {
        seedDetectorPlugin: contextLoadResult?.seed_detector_plugin || null,
        sourceId: contextLoadResult?.sourceId || null,
        unitCount: contextLoadResult?.unitCount || null
      },
      ...summary,
      results
    };
  }

  const sessionBody = buildSessionBody(scenario.combo);
  const sessionRes = await withProgress(
    `${scenario.label} → create session`,
    () => withTimeout(fetchJson(base, 'POST', '/sessions', sessionBody), 10000),
    '  '
  );
  if (!sessionRes.session_id) {
    throw new Error(sessionRes.error?.message || 'session create failed');
  }
  console.log(`  ${C.dim}${scenario.label} session defaults · ${compactSurface({
    plannerPlugin: sessionRes.planner_plugin,
    seedDetectorPlugin: sessionRes.seed_detector_plugin,
    kbPlugin: sessionRes.kb_plugin,
    goalSolverPlugin: sessionRes.goal_solver_plugin
  })}${C.reset}`);

  const sessionId = sessionRes.session_id;
  const results = [];
  let ingestRes = null;
  let scenarioError = null;

  try {
    ingestRes = await withProgress(
      `${scenario.label} → ingest ${evalData.storyFile || 'story.nl'}`,
      () => withTimeout(fetchJson(base, 'POST', `/sessions/${sessionId}/workspace/sources`, {
        name: evalData.storyFile || 'story.nl',
        content: storyContent
      }), INGEST_TIMEOUT),
      '  '
    );
    if (ingestRes.error) {
      throw new Error(`${ingestRes.error.code}: ${ingestRes.error.message}`);
    }

    console.log(`  ${C.dim}${scenario.label} · ${compactSurface(buildRequestedSurface(scenario.combo))} · ingest:${ingestRes.seed_detector_plugin || 'auto'}${C.reset}`);

    for (const q of evalData.questions) {
      try {
        const r = await runQuestion(q, base, sessionId);
        results.push(r);
        const icon = r.pass ? `${C.green}✅` : `${C.red}✗ `;
        console.log(`    ${icon}${C.reset} ${q.id} ${C.dim}(${r.durationMs}ms · ${compactSurface(r.runtimeSurface)})${C.reset}`);
        if (!r.pass) {
          for (const f of r.failures) {
            console.log(`      ${C.yellow}[${f.check}]${C.reset}`);
            if (f.obtained)   console.log(`        ${C.dim}Obtained:${C.reset}  ${C.red}${f.obtained}${f.obtained.length >= 150 ? '…' : ''}${C.reset}`);
            if (f.required)   console.log(`        ${C.dim}Required:${C.reset}  ${C.yellow}${f.required}${C.reset}`);
            if (f.conclusion) console.log(`        ${C.dim}Conclusion:${C.reset} ${C.red}${f.conclusion}${C.reset}`);
            if (f.detail)     console.log(`        ${C.red}${f.detail}${C.reset}`);
          }
        }
        if (process.env.LOG_VERBOSE) {
          console.log(`      ${C.dim}${preview(r.assistantMessage)}${C.reset}`);
        }
      } catch (error) {
        results.push({
          id: q.id,
          input: q.input,
          pass: false,
          answerPass: false,
          contextPass: false,
          failures: [{ check: 'error', expected: 'ok', got: error.message }],
          durationMs: 0,
          contextQuality: { recall: 0, precision: 0, f1: 0 },
          runtimeSurface: null,
          processingMode: null,
          retrievalProfile: null,
          assistantMessage: null,
          responseDocument: null,
          executionTrace: null
        });
        console.log(`    ${C.red}✗ ${C.reset} ${q.id} ${C.red}${error.message}${C.reset}`);
      }
    }
  } catch (error) {
    scenarioError = { message: error.message };
    results.push({
      id: `${scenario.label}::setup`,
      input: null,
      pass: false,
      answerPass: false,
      contextPass: false,
      failures: [{ check: 'setup', expected: 'scenario ready', got: error.message }],
      durationMs: 0,
      contextQuality: { recall: 0, precision: 0, f1: 0 },
      runtimeSurface: null,
      processingMode: null,
      retrievalProfile: null,
      assistantMessage: null,
      responseDocument: null,
      executionTrace: null
    });
  } finally {
    try {
      await withProgress(
        `${scenario.label} → delete session`,
        () => fetchJson(base, 'DELETE', `/sessions/${sessionId}`),
        '  '
      );
    } catch (cleanupError) {
      if (!scenarioError) scenarioError = { message: `cleanup failed: ${cleanupError.message}` };
    }
  }

  const summary = summarizeResults(results);
  return {
    label: scenario.label,
    mode: scenario.mode,
    error: scenarioError,
    deliveryPath: '/sessions/:id/workspace/sources',
    setupPath: '/sessions/:id/workspace/sources',
    requestedSurface: buildRequestedSurface(scenario.combo),
    sessionSurface: {
      plannerPlugin: sessionRes.planner_plugin || null,
      seedDetectorPlugin: sessionRes.seed_detector_plugin || null,
      kbPlugin: sessionRes.kb_plugin || null,
      goalSolverPlugin: sessionRes.goal_solver_plugin || null
    },
    ingestSurface: {
      seedDetectorPlugin: ingestRes?.seed_detector_plugin || null,
      sourceId: ingestRes?.sourceId || null,
      unitCount: ingestRes?.unitCount || null
    },
    ...summary,
    results
  };
}

async function runSuite(suiteDir, base) {
  const evalData = JSON.parse(readFileSync(join(suiteDir, 'eval.json'), 'utf-8'));
  const storyContent = readFileSync(join(suiteDir, evalData.storyFile || 'story.nl'), 'utf-8');

  const scenarios = MATRIX_MODE && evalData.pluginCombos?.length
    ? evalData.pluginCombos.map(combo => ({
        label: combo.label || 'unnamed',
        combo,
        mode: 'matrix'
      }))
    : [{
        label: 'default',
        combo: null,
        mode: 'default'
      }];

  const scenarioRuns = [];
  for (const scenario of scenarios) {
    scenarioRuns.push(await runScenario(base, evalData, storyContent, scenario));
  }

  const totalPassed = scenarioRuns.reduce((sum, run) => sum + run.passed, 0);
  const totalFailed = scenarioRuns.reduce((sum, run) => sum + run.failed, 0);
  const avgF1 = scenarioRuns.reduce((sum, run) => sum + run.avgF1, 0) / (scenarioRuns.length || 1);
  return {
    suiteId: evalData.suiteId,
    title: evalData.title || null,
    mode: MATRIX_MODE ? 'matrix' : 'default',
    deliveryPath: evalPathLabel(),
    passed: totalPassed,
    failed: totalFailed,
    total: totalPassed + totalFailed,
    avgF1,
    runs: scenarioRuns,
    results: scenarioRuns.flatMap(run => run.results)
  };
}

async function main() {
  const tmpDir = join(tmpdir(), `mrp-eval-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmpDir, { recursive: true });
  const configDir = createIsolatedConfig(tmpDir, PORT);
  const base = `http://127.0.0.1:${PORT}`;

  const entries = readdirSync(EVAL_DIR).filter(e => {
    try {
      return statSync(join(EVAL_DIR, e)).isDirectory() && e.startsWith('suite');
    } catch {
      return false;
    }
  }).sort();
  const suites = SUITE_FILTER ? entries.filter(e => e === SUITE_FILTER) : entries;
  if (!suites.length) {
    console.error('No suites found.');
    process.exit(1);
  }

  let serverProc;
  try {
    console.log(`${C.dim}Starting isolated server on port ${PORT}...${C.reset}`);
    console.log(`${C.dim}Eval path: ${evalPathLabel()}${C.reset}`);
    console.log(`${C.dim}Scenario expansion: ${MATRIX_MODE ? 'plugin matrix' : 'default only'}${C.reset}`);
    console.log(`${C.dim}Question timeout: ${Q_TIMEOUT}ms · Context setup timeout: ${INGEST_TIMEOUT}ms${C.reset}`);
    console.log(`${C.dim}Server verbose: ${VERBOSE_SERVER ? 'on' : 'off'}${C.reset}`);
    console.log(`${C.dim}Config dir: ${configDir}${C.reset}`);
    console.log(`${C.dim}Base URL: ${base}${C.reset}`);
    serverProc = await withProgress(`start server on ${base}`, () => startServer(configDir));
    await withProgress(`wait for /health on ${base}`, () => waitReady(base));
    if (PROBE_LLM) {
      try {
        const probe = await withProgress('LLM probe (no-cache)', () => runLLMProbe(configDir));
        if (probe.skipped) {
          console.log(`${C.yellow}LLM probe skipped:${C.reset} ${probe.reason}`);
        } else {
          const status = probe.ok ? `${C.green}ok${C.reset}` : `${C.red}mismatch${C.reset}`;
          console.log(`LLM probe: ${status} model=${probe.model} duration=${probe.durationMs}ms expected=${probe.expected} response=${preview(probe.response, 120)}`);
        }
      } catch (error) {
        console.log(`${C.red}LLM probe failed:${C.reset} ${error.message}`);
      }
    }
    console.log(`${C.bold}${suites.length} suite(s)${C.reset}\n`);

    const allResults = [];
    for (const suite of suites) {
      console.log(`${C.cyan}${C.bold}── ${suite}${C.reset}`);
      const r = await runSuite(join(EVAL_DIR, suite), base);
      allResults.push(r);
      const color = r.failed === 0 ? C.green : C.red;
      console.log(`  ${color}${C.bold}${r.passed}/${r.total} passed${C.reset} F1:${r.avgF1.toFixed(2)}\n`);
    }

    const totalP = allResults.reduce((sum, r) => sum + r.passed, 0);
    const totalF = allResults.reduce((sum, r) => sum + r.failed, 0);
    const avgF1 = allResults.reduce((sum, r) => sum + r.avgF1, 0) / (allResults.length || 1);
    console.log(`${C.bold}TOTAL: ${totalP}/${totalP + totalF} passed, avg F1: ${avgF1.toFixed(2)}${C.reset}`);

    mkdirSync(join(EVAL_DIR, 'results'), { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(EVAL_DIR, 'results', `eval-${ts}.json`), JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: MATRIX_MODE ? 'matrix' : 'default',
      deliveryPath: evalPathLabel(),
      suites: allResults,
      totalPassed: totalP,
      totalFailed: totalF
    }, null, 2));
    console.log(`${C.dim}Results → test/evaluation/results/eval-${ts}.json${C.reset}`);

    process.exitCode = totalF > 0 ? 1 : 0;
  } finally {
    if (serverProc) serverProc.kill();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main();
