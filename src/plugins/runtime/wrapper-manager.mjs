// DS003 — Plugin System (External Interpreters)
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../../core/platform/logger.mjs';
import { buildResolvedIntentPayload } from '../../mrp-vm-sdk/synthesis/resolved-intent-payload.mjs';

const MOD = 'plugins';

export class PluginManager {
  constructor(config = {}) {
    this.allowlist = config.pluginAllowlist || [];
    this.defaultTimeout = config.pluginTimeoutMs || 30000;
    this.memoryLimit = config.pluginMemoryLimitMB || 256;
    this._plugins = new Map();
  }

  async scanWrappers(wrappersDir = 'wrappers') {
    const dir = resolve(wrappersDir);
    if (!existsSync(dir)) { logger.info(MOD, 'No wrappers directory found'); return; }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(dir, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) { logger.warn(MOD, `No manifest.json in ${entry.name}`); continue; }
      try {
        const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const manifest = {
          ...rawManifest,
          id: rawManifest.id || rawManifest.name,
          name: rawManifest.name || rawManifest.id,
          type: rawManifest.type || 'gs-plugin'
        };
        if (!manifest.id) {
          logger.warn(MOD, `Wrapper in ${entry.name} is missing both id and name`);
          continue;
        }
        if (!this.allowlist.includes(manifest.id) && !this.allowlist.includes(manifest.name)) {
          logger.warn(MOD, `Plugin ${manifest.id} not in allowlist, skipping`);
          continue;
        }
        // Sanitize command
        if (manifest.command?.includes('..') || manifest.command?.startsWith('/')) {
          logger.warn(MOD, `Plugin ${manifest.id} has unsafe command path, skipping`);
          continue;
        }
        manifest._dir = join(dir, entry.name);
        if (!manifest.protocolVersion || manifest.protocolVersion !== 1) {
          logger.warn(MOD, `Plugin ${manifest.id} has missing or unsupported protocolVersion (${manifest.protocolVersion}), skipping`);
          continue;
        }
        this._plugins.set(manifest.id, manifest);
        logger.info(MOD, `Registered plugin: ${manifest.id}`);
      } catch (e) {
        logger.warn(MOD, `Invalid manifest in ${entry.name}: ${e.message}`);
      }
    }
  }

  selectPlugin(intentGroup) {
    const candidates = [];
    for (const [, manifest] of this._plugins) {
      if (manifest.capabilities?.some(c => this._matchesCapability(c, intentGroup))) {
        candidates.push(manifest);
      }
    }
    if (candidates.length === 0) {
      // Fallback to keyword matching
      for (const [, manifest] of this._plugins) {
        if (manifest.keywords?.some(k => intentGroup.intent?.toLowerCase().includes(k))) {
          candidates.push(manifest);
        }
      }
    }
    if (candidates.length === 0) return null;
    // DS003 conflict resolution: highest priority, then alphabetical name
    candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.id || '').localeCompare(b.id || ''));
    return candidates[0];
  }

  _matchesCapability(capability, intentGroup) {
    // Simple mapping: act-based
    const capMap = {
      'logical-constraint': ['verify'],
      'sat-check': ['verify']
    };
    return capMap[capability]?.includes(intentGroup.act);
  }

  async invoke(manifest, payload) {
    const inputPayload = {
      prompt: payload?.prompt || '',
      context: Array.isArray(payload?.context) ? payload.context : []
    };
    const input = JSON.stringify(inputPayload);
    // Check input size
    const inputBytes = Buffer.byteLength(input, 'utf-8');
    if (inputBytes > (manifest.maxInputSizeBytes || 65536)) {
      return {
        intentRef: 0, pluginName: manifest.name, capabilityUsed: manifest.capabilities?.[0] || '',
        status: 'error', resultCNL: null, confidence: null, artifacts: [],
        error: { code: 'PLUGIN_INPUT_TOO_LARGE', message: `Input ${inputBytes} bytes exceeds limit` }
      };
    }
    const timeout = manifest.timeout || this.defaultTimeout;
    return new Promise((res) => {
      const proc = spawn(manifest.command, manifest.args || [], {
        cwd: manifest._dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', (code) => {
        if (code === 0) {
          const parsed = this._parseOutput(stdout, manifest.name || manifest.id);
          res(parsed);
        } else {
          res({
            intentRef: 0, pluginName: manifest.name || manifest.id, capabilityUsed: manifest.capabilities?.[0] || '',
            status: code === 3 ? 'timeout' : 'error', resultCNL: null, confidence: null, artifacts: [],
            error: { code: `PLUGIN_EXIT_${code}`, message: stderr.trim() || `Exit code ${code}` }
          });
        }
      });
      proc.on('error', (e) => {
        res({
          intentRef: 0, pluginName: manifest.name || manifest.id, capabilityUsed: manifest.capabilities?.[0] || '',
          status: 'error', resultCNL: null, confidence: null, artifacts: [],
          error: { code: 'PLUGIN_SPAWN_ERROR', message: e.message }
        });
      });
      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  async collectOutputs(resolvedIntents = []) {
    const outputs = [];
    for (const resolvedIntent of resolvedIntents) {
      const manifest = this.selectPlugin(resolvedIntent.intentGroup);
      if (!manifest) continue;
      const resolvedPayload = resolvedIntent.resolvedPayload || buildResolvedIntentPayload(resolvedIntent);
      const output = await this.invoke(manifest, resolvedPayload);
      output.intentRef = resolvedIntent.intentRef;
      output.resolvedPayload = resolvedPayload;
      outputs.push(output);
    }
    return outputs;
  }

  _parseOutput(stdout, pluginName) {
    // Parse DS016 output format
    const fields = {};
    for (const line of stdout.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0 && !line.startsWith('#')) {
        const key = line.substring(0, idx).trim();
        const val = line.substring(idx + 1).trim();
        fields[key] = val;
      }
    }
    return {
      intentRef: 0,
      pluginName: fields['Plugin'] || pluginName,
      capabilityUsed: '',
      status: (fields['Status'] || 'error').toLowerCase(),
      resultCNL: fields['Result'] || null,
      confidence: fields['Confidence']?.toLowerCase() || null,
      artifacts: [],
      error: fields['Status']?.toLowerCase() === 'error' ? { code: 'PLUGIN_ERROR', message: fields['Result'] || '' } : null
    };
  }

  getPlugins() { return [...this._plugins.values()]; }
}
