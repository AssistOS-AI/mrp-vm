// JSONL logger on stderr (DS001)
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const verbose = !!(process.env.LOG_VERBOSE || process.argv.includes('--verbose'));
let currentLevel = LEVELS[process.env.LOG_LEVEL || (verbose ? 'debug' : 'info')] ?? LEVELS.info;

const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pad(s, n) { return s.padEnd(n); }

function emit(level, module, msg, details = {}, extra = {}) {
  if (LEVELS[level] > currentLevel) return;
  if (verbose) {
    const ts = new Date().toISOString().slice(11, 23);
    const c = COLORS[level];
    const det = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    const ext = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    process.stderr.write(`${c}${ts} ${BOLD}${pad(level.toUpperCase(), 5)}${RESET}${c} [${pad(module, 10)}] ${msg}${det}${ext}${RESET}\n`);
  } else {
    const entry = { ts: new Date().toISOString(), level, module, msg, details, ...extra };
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
}

export const logger = {
  error: (mod, msg, details, extra) => emit('error', mod, msg, details, extra),
  warn:  (mod, msg, details, extra) => emit('warn', mod, msg, details, extra),
  info:  (mod, msg, details, extra) => emit('info', mod, msg, details, extra),
  debug: (mod, msg, details, extra) => emit('debug', mod, msg, details, extra),
  setLevel(lvl) { currentLevel = LEVELS[lvl] ?? LEVELS.info; }
};
