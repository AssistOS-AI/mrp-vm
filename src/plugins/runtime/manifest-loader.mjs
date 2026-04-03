import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeContains(value) {
  return value == null ? null : String(value);
}

export function evaluateDependencyChecks(checks = [], cwd = process.cwd()) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  if (normalizedChecks.length === 0) {
    return {
      enabled: true,
      checks: [],
      reason: null
    };
  }

  const results = normalizedChecks.map((check, index) => {
    const command = check?.command;
    const args = Array.isArray(check?.args) ? check.args : [];
    if (!command) {
      return {
        id: check?.id || `check-${index}`,
        ok: false,
        code: 'PLUGIN_DEPENDENCY_INVALID',
        message: 'Dependency check is missing a command',
        command,
        args,
        stdout: '',
        stderr: ''
      };
    }

    try {
      const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        timeout: check?.timeoutMs || 3000,
        env: process.env
      });
      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      const expectedExitCode = Number.isInteger(check?.expectExitCode)
        ? check.expectExitCode
        : 0;
      const stdoutIncludes = normalizeContains(check?.stdoutIncludes);
      const stderrIncludes = normalizeContains(check?.stderrIncludes);
      const exitOk = result.status === expectedExitCode;
      const stdoutOk = !stdoutIncludes || stdout.includes(stdoutIncludes);
      const stderrOk = !stderrIncludes || stderr.includes(stderrIncludes);
      const ok = exitOk && stdoutOk && stderrOk && !result.error;
      return {
        id: check?.id || `check-${index}`,
        ok,
        code: ok ? null : 'PLUGIN_DEPENDENCY_MISSING',
        message: ok
          ? 'ok'
          : result.error?.message ||
            `Dependency check failed for '${command}'`,
        command,
        args,
        exitCode: result.status,
        stdout,
        stderr
      };
    } catch (error) {
      return {
        id: check?.id || `check-${index}`,
        ok: false,
        code: 'PLUGIN_DEPENDENCY_MISSING',
        message: error.message,
        command,
        args,
        stdout: '',
        stderr: ''
      };
    }
  });

  const failed = results.find(result => !result.ok) || null;
  return {
    enabled: !failed,
    checks: results,
    reason: failed ? `${failed.id}: ${failed.message}` : null
  };
}

export function resolveLocalPluginPath(manifest, relativePath) {
  if (!relativePath) return null;
  return resolve(manifest.__pluginDir || process.cwd(), relativePath);
}

export function readLocalPluginText(manifest, relativePath, fallback = '') {
  const filePath = resolveLocalPluginPath(manifest, relativePath);
  if (!filePath || !existsSync(filePath)) return fallback;
  return readFileSync(filePath, 'utf-8').trim();
}

export function loadLocalPluginPrompts(manifest) {
  const promptFiles = manifest?.promptFiles || {};
  return Object.fromEntries(
    Object.entries(promptFiles).map(([key, relativePath]) => [
      key,
      readLocalPluginText(manifest, relativePath, '')
    ])
  );
}

export function loadLocalPluginManifest(moduleUrl) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const manifestPath = resolve(moduleDir, 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const activation = evaluateDependencyChecks(manifest.dependencyChecks || [], moduleDir);
  return {
    ...manifest,
    __pluginDir: moduleDir,
    __manifestPath: manifestPath,
    activation
  };
}
