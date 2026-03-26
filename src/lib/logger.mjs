// JSONL logger on stderr (DS001)
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function emit(level, module, msg, details = {}, extra = {}) {
  if (LEVELS[level] > currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level, module, msg, details,
    ...extra
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  error: (mod, msg, details, extra) => emit('error', mod, msg, details, extra),
  warn:  (mod, msg, details, extra) => emit('warn', mod, msg, details, extra),
  info:  (mod, msg, details, extra) => emit('info', mod, msg, details, extra),
  debug: (mod, msg, details, extra) => emit('debug', mod, msg, details, extra),
  setLevel(lvl) { currentLevel = LEVELS[lvl] ?? LEVELS.info; }
};
