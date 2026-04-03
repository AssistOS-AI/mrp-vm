function needsQuotes(value) {
  return !/^[A-Za-z0-9_:.\/+-]+$/.test(String(value || ''));
}

export function quoteSOPString(value) {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

export function renderSOPScalar(value, options = {}) {
  if (value == null) return null;
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (options.forceQuoted || needsQuotes(text)) return quoteSOPString(text);
  return text;
}

export function renderSOPList(values = []) {
  const items = (values || [])
    .map(value => renderSOPScalar(value))
    .filter(Boolean);
  return `[${items.join(' ')}]`;
}

export function renderSOPValue(value, options = {}) {
  if (Array.isArray(value)) return renderSOPList(value);
  return renderSOPScalar(value, options);
}

export function sopRef(objectId) {
  return `$${String(objectId || '').replace(/^[@$]/, '')}`;
}

export function createSOPBuilder() {
  const counters = new Map();
  const lines = [];

  const nextId = (prefix = 'x') => {
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    return `${prefix}${next}`;
  };

  const push = (statementId, command, ...args) => {
    lines.push(`@${statementId} ${command} ${args.filter(arg => arg != null && arg !== '').join(' ')}`.trim());
    return statementId;
  };

  return {
    nextId,
    push,
    toString() {
      return lines.join('\n');
    }
  };
}
