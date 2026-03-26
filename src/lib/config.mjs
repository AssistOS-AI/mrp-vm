// Config loader (DS001): JSON files + env overrides
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '../../config');

const cache = {};

export function loadConfig(name) {
  if (cache[name]) return cache[name];
  const filePath = resolve(CONFIG_DIR, `${name}.json`);
  if (!existsSync(filePath)) throw new Error(`Config file not found: ${filePath}`);
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  const section = name.replace(/-/g, '_').toUpperCase();
  // Env overrides: MRP_<SECTION>_<KEY>
  for (const key of Object.keys(raw)) {
    const envKey = `MRP_${section}_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      const v = process.env[envKey];
      if (typeof raw[key] === 'number') raw[key] = Number(v);
      else if (typeof raw[key] === 'boolean') raw[key] = v === 'true';
      else raw[key] = v;
    }
  }
  cache[name] = raw;
  return raw;
}

export function clearConfigCache() {
  for (const k of Object.keys(cache)) delete cache[k];
}
