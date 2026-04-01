// JSONL logger on stderr (DS001)
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const verbose = !!(process.env.LOG_VERBOSE || process.argv.includes('--verbose'));
let currentLevel = LEVELS[process.env.LOG_LEVEL || (verbose ? 'debug' : 'info')] ?? LEVELS.info;

const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function pad(s, n) { return s.padEnd(n); }

function formatDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const keys = Object.keys(details);
  if (!keys.length) return '';
  const parts = [];
  for (const k of keys) {
    const v = details[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      // Nested object — flatten one level
      const inner = Object.entries(v)
        .filter(([, val]) => val !== null && val !== undefined)
        .map(([ik, iv]) => `${ik}=${iv}`)
        .join(' ');
      if (inner) parts.push(`${k}: ${inner}`);
    } else if (Array.isArray(v)) {
      if (v.length) parts.push(`${k}=${v.join(', ')}`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

function emit(level, module, msg, details = {}, extra = {}) {
  if (LEVELS[level] > currentLevel) return;
  const ts = new Date().toISOString().slice(11, 23);
  const c = COLORS[level];
  const det = formatDetails(details);
  const ext = formatDetails(extra);
  process.stderr.write(`${c}${ts} ${BOLD}${pad(level.toUpperCase(), 5)}${RESET}${c} [${pad(module, 10)}] ${msg}${RESET}${DIM}${det}${ext}${RESET}\n`);
}

export const logger = {
  error: (mod, msg, details, extra) => emit('error', mod, msg, details, extra),
  warn:  (mod, msg, details, extra) => emit('warn', mod, msg, details, extra),
  info:  (mod, msg, details, extra) => emit('info', mod, msg, details, extra),
  debug: (mod, msg, details, extra) => emit('debug', mod, msg, details, extra),
  setLevel(lvl) { currentLevel = LEVELS[lvl] ?? LEVELS.info; }
};
