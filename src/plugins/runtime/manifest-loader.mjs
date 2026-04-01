import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadLocalPluginManifest(moduleUrl) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return JSON.parse(readFileSync(resolve(moduleDir, 'plugin.json'), 'utf-8'));
}

