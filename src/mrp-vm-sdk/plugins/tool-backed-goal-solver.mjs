import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildResponseDocument } from '../synthesis/response-document.mjs';

const DEFAULT_CAPABILITY_PROMPT = [
  'You are a runtime-routing classifier for MRP-VM.',
  'Decide if the described tool-backed runtime is a good fit for the given intents and evidence.',
  'Reply with JSON only: {"verdict":"supported"|"unsupported","reason":"...","approach":"..."}.'
].join(' ');

const DEFAULT_PROGRAM_PROMPT = [
  'You generate one self-contained program for a trusted external runtime.',
  'Reply with JSON only: {"fileName":"...","code":"..."}.',
  'The program must read UTF-8 JSON from stdin and write UTF-8 JSON to stdout with schema',
  '{"status":"success"|"no-context"|"error","intents":[{"intentRef":number,"status":"answered"|"no-context"|"plugin-error","answer":"...","sourcesUsed":["..."],"notes":["..."]}],"artifacts":[]}.',
  'Do not use network access. Keep dependencies limited to the declared runtime/tooling.'
].join(' ');

function stripFences(text = '') {
  return String(text || '')
    .replace(/^```(?:json|javascript|js|python|prolog)?\s*\n?/gim, '')
    .replace(/\n?```\s*$/gim, '')
    .trim();
}

function extractJSONObject(text) {
  const normalized = stripFences(text);
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Expected a JSON object in LLM output');
  }
  return JSON.parse(match[0]);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildUnitPayload(entry, store) {
  const unit = entry?.unit || entry || {};
  const unitId = entry?.unitId || unit.id || unit.title || unit.topic || null;
  return {
    store,
    unitId,
    title: unit.title || unit.topic || unitId,
    role: unit.role || null,
    topic: unit.topic || null,
    claim: unit.claim || null,
    procedure: unit.procedure || null,
    condition: unit.condition || null,
    sourceId: unit.sourceId || null,
    sourceLink: unit.sourceName || unit.sourceId || store,
    text: unit.claim || unit.procedure || unit.condition || unit.textBody || unit.topic || ''
  };
}

function buildToolInput(resolvedIntents = [], guidanceUnits = []) {
  return {
    intents: resolvedIntents.map(resolvedIntent => ({
      intentRef: resolvedIntent.intentRef,
      act: resolvedIntent.decomposed?.act || null,
      intent: resolvedIntent.decomposed?.intent || null,
      context: resolvedIntent.decomposed?.context || null,
      criterion: resolvedIntent.decomposed?.criterion || null,
      output: resolvedIntent.decomposed?.output || null,
      evidence: [
        ...(resolvedIntent.currentTurnContextUnits || []).map(unit => buildUnitPayload(unit, 'current-turn')),
        ...(resolvedIntent.sessionUnits || []).map(entry => buildUnitPayload(entry, 'session')),
        ...(resolvedIntent.kbUnits || []).map(entry => buildUnitPayload(entry, 'kb'))
      ]
    })),
    guidance: (guidanceUnits || []).map(entry => buildUnitPayload(entry, entry?.store || 'guidance'))
  };
}

function normalizeRuntimeManifest(runtime = {}) {
  return {
    language: runtime.language || 'text',
    command: runtime.command || 'node',
    args: Array.isArray(runtime.args) ? runtime.args : ['{scriptPath}'],
    fileName: runtime.fileName || 'solver.txt',
    timeoutMs: runtime.timeoutMs || 5000,
    description: runtime.description || runtime.language || runtime.command || 'runtime'
  };
}

function buildMarkdownResponse(sessionId, resolvedIntents = [], resultByIntentRef = {}) {
  let markdown = `# MRP Response\nSession: ${sessionId}\n\n`;
  const answersByIntentRef = {};
  const statusByIntentRef = {};

  for (const resolvedIntent of resolvedIntents) {
    const runtimeResult = resultByIntentRef[resolvedIntent.intentRef] || {};
    const status = runtimeResult.status || 'no-context';
    const answer = runtimeResult.answer || runtimeResult.reason || 'The selected tool-backed solver did not return an answer.';
    const sourcesUsed = unique(runtimeResult.sourcesUsed || []).map(source => `- ${source}`).join('\n') || '- (none)';
    answersByIntentRef[resolvedIntent.intentRef] = answer;
    statusByIntentRef[resolvedIntent.intentRef] = status;
    markdown += [
      `## Intent Group ${resolvedIntent.intentRef}`,
      `Act: ${resolvedIntent.decomposed?.act || '(unknown)'}`,
      `Intent: ${resolvedIntent.decomposed?.intent || '(unknown)'}`,
      `Status: ${status}`,
      '',
      '### Answer',
      answer,
      '',
      '### Sources Used',
      sourcesUsed,
      ''
    ].join('\n');
  }

  return {
    responseMarkdown: markdown.trim(),
    responseDocument: buildResponseDocument(
      sessionId,
      resolvedIntents,
      [],
      answersByIntentRef,
      statusByIntentRef
    )
  };
}

async function runProgram(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      child.kill('SIGKILL');
      finished = true;
      reject(new Error(`Runtime execution timed out after ${options.timeoutMs || 5000}ms`));
    }, options.timeoutMs || 5000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Runtime exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export class ToolBackedGoalSolverPlugin {
  constructor(manifest, llmBridge, options = {}) {
    this.manifest = manifest;
    this.id = manifest.id;
    this.name = manifest.name || manifest.id;
    this.description = manifest.description || '';
    this.costClass = manifest.costClass || 'expensive';
    this.modelRole = options.modelRole || manifest.modelRole || 'goal-deep';
    this.plannerHints = options.plannerHints || manifest.plannerHints || null;
    this.prompts = options.prompts || {};
    this.llmBridge = llmBridge;
    this.runtime = normalizeRuntimeManifest(manifest.runtime || {});
    this.activation = manifest.activation || { enabled: true, checks: [], reason: null };
  }

  getDescriptor() {
    return {
      id: this.id,
      type: 'gs-plugin',
      name: this.name,
      version: this.manifest.version || '1.0.0',
      description: this.description,
      costClass: this.costClass,
      usesLLM: true,
      modelRoles: [this.modelRole],
      maxLLMCalls: 2,
      tags: ['builtin', 'tool-backed', this.runtime.language].filter(Boolean),
      timeoutMs: this.runtime.timeoutMs,
      provides: ['solve-goal', 'external-runtime'],
      accepts: ['chat-turn'],
      plannerHints: this.plannerHints
    };
  }

  async _callJSONPrompt(prompt, userMessage, options) {
    const raw = await this.llmBridge.callWithRetry(prompt, userMessage, options);
    return extractJSONObject(raw);
  }

  _buildCapabilityMessage(input, toolInput) {
    return [
      `Plugin: ${this.id}`,
      `Runtime: ${this.runtime.description}`,
      this.activation?.checks?.length
        ? `Dependency checks: ${this.activation.checks.map(check => `${check.id}=${check.ok ? 'ok' : 'missing'}`).join(', ')}`
        : 'Dependency checks: none',
      '',
      'Intent bundle:',
      JSON.stringify(toolInput, null, 2),
      '',
      'Decide whether this runtime should solve the intents directly.'
    ].join('\n');
  }

  _buildProgramMessage(toolInput, capability) {
    return [
      `Plugin: ${this.id}`,
      `Runtime command: ${this.runtime.command}`,
      `Runtime language: ${this.runtime.language}`,
      `Runtime file name: ${this.runtime.fileName}`,
      '',
      'Capability decision:',
      JSON.stringify(capability, null, 2),
      '',
      'Program input JSON schema example:',
      JSON.stringify(toolInput, null, 2),
      '',
      'Generate exactly one source file.'
    ].join('\n');
  }

  async _executeProgram(toolInput, programSpec) {
    const workspace = await mkdtemp(join(tmpdir(), `mrp-${this.id}-`));
    try {
      const fileName = programSpec.fileName || this.runtime.fileName;
      const code = programSpec.code;
      if (!code || typeof code !== 'string') {
        throw new Error('Generated program did not include source code');
      }
      const scriptPath = join(workspace, fileName);
      await writeFile(scriptPath, code, 'utf-8');
      const args = this.runtime.args.map(arg => arg.replaceAll('{scriptPath}', scriptPath));
      const execution = await runProgram(this.runtime.command, args, toolInput, {
        cwd: workspace,
        timeoutMs: this.runtime.timeoutMs
      });
      return extractJSONObject(execution.stdout);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async solve(input, ctx) {
    if (!this.llmBridge) {
      return {
        status: 'error',
        responseMarkdown: null,
        responseDocument: null,
        metadata: { llmCalls: 0, model: null },
        error: { code: 'LLM_NOT_AVAILABLE', message: 'Tool-backed solver requires an LLM bridge' }
      };
    }
    if (!this.activation?.enabled) {
      return {
        status: 'error',
        responseMarkdown: null,
        responseDocument: null,
        metadata: { llmCalls: 0, model: null },
        error: { code: 'PLUGIN_DEPENDENCY_MISSING', message: this.activation.reason || 'Required runtime is not installed' }
      };
    }

    const model = ctx.modelSettings.resolveModel({
      pluginId: this.id,
      role: this.modelRole,
      requestedModel: input.requestedModel || null,
      sessionModel: input.sessionModel || null
    });

    const toolInput = buildToolInput(input.resolvedIntents || [], input.guidanceUnits || []);
    const llmOptions = { model, operation: `${this.id}-tool-backed` };

    try {
      const capability = await this._callJSONPrompt(
        this.prompts.capabilityCheck || DEFAULT_CAPABILITY_PROMPT,
        this._buildCapabilityMessage(input, toolInput),
        { ...llmOptions, operation: `${this.id}-capability-check` }
      );

      if (capability.verdict !== 'supported') {
        const resultByIntentRef = Object.fromEntries(
          (input.resolvedIntents || []).map(resolvedIntent => [
            resolvedIntent.intentRef,
            {
              status: 'no-context',
              answer: capability.reason || 'The tool-backed runtime is not a suitable fit for this request.',
              sourcesUsed: []
            }
          ])
        );
        const rendered = buildMarkdownResponse(input.sessionId, input.resolvedIntents || [], resultByIntentRef);
        return {
          status: 'no-context',
          responseMarkdown: rendered.responseMarkdown,
          responseDocument: rendered.responseDocument,
          metadata: {
            llmCalls: 1,
            model,
            runtime: this.runtime.command,
            capability
          },
          error: null
        };
      }

      const programSpec = await this._callJSONPrompt(
        this.prompts.generateProgram || DEFAULT_PROGRAM_PROMPT,
        this._buildProgramMessage(toolInput, capability),
        { ...llmOptions, operation: `${this.id}-program-generation` }
      );

      const execution = await this._executeProgram(toolInput, programSpec);
      const runtimeIntents = Array.isArray(execution.intents) ? execution.intents : [];
      const resultByIntentRef = Object.fromEntries(
        runtimeIntents.map(item => [
          item.intentRef,
          {
            status: item.status || 'answered',
            answer: item.answer || item.reason || execution.summary || 'The runtime completed without a textual answer.',
            sourcesUsed: unique(item.sourcesUsed || []),
            notes: item.notes || []
          }
        ])
      );
      for (const resolvedIntent of input.resolvedIntents || []) {
        if (!resultByIntentRef[resolvedIntent.intentRef]) {
          resultByIntentRef[resolvedIntent.intentRef] = {
            status: execution.status === 'error' ? 'plugin-error' : 'no-context',
            answer: execution.summary || 'The runtime did not return a result for this intent.',
            sourcesUsed: []
          };
        }
      }
      const rendered = buildMarkdownResponse(input.sessionId, input.resolvedIntents || [], resultByIntentRef);
      const statuses = Object.values(resultByIntentRef).map(item => item.status);
      const overallStatus = statuses.every(status => status === 'no-context')
        ? 'no-context'
        : execution.status === 'error'
          ? 'error'
          : 'success';
      return {
        status: overallStatus,
        responseMarkdown: rendered.responseMarkdown,
        responseDocument: rendered.responseDocument,
        metadata: {
          llmCalls: 2,
          model,
          runtime: this.runtime.command,
          capability,
          artifacts: execution.artifacts || []
        },
        error: overallStatus === 'error'
          ? { code: 'TOOL_BACKED_RUNTIME_ERROR', message: execution.summary || 'Runtime execution failed' }
          : null
      };
    } catch (error) {
      return {
        status: 'error',
        responseMarkdown: null,
        responseDocument: null,
        metadata: {
          llmCalls: 2,
          model,
          runtime: this.runtime.command
        },
        error: { code: 'TOOL_BACKED_SOLVER_FAILED', message: error.message }
      };
    }
  }
}
