import { isStopword } from './stopwords.mjs';

export const SYMBOLIC_RELATIONS = [
  'uses',
  'provides',
  'has_capability',
  'depends_on',
  'part_of',
  'instance_of',
  'relevant_for',
  'supports',
  'mentions',
  'about',
  'causes'
];

const SENTENCE_RELATION_PATTERNS = [
  { relation: 'uses', re: /^(.+?)\s+uses\s+(.+)$/i },
  { relation: 'provides', re: /^(.+?)\s+provides\s+(.+)$/i },
  { relation: 'has_capability', re: /^(.+?)\s+has(?:\s+the)?\s+capability(?:\s+of)?\s+(.+)$/i },
  { relation: 'depends_on', re: /^(.+?)\s+depends\s+on\s+(.+)$/i },
  { relation: 'part_of', re: /^(.+?)\s+is\s+part\s+of\s+(.+)$/i },
  { relation: 'instance_of', re: /^(.+?)\s+is\s+an?\s+instance\s+of\s+(.+)$/i },
  { relation: 'relevant_for', re: /^(.+?)\s+is\s+relevant\s+for\s+(.+)$/i },
  { relation: 'relevant_for', re: /^(.+?)\s+helps\s+with\s+(.+)$/i },
  { relation: 'relevant_for', re: /^(.+?)\s+is\s+useful\s+for\s+(.+)$/i },
  { relation: 'supports', re: /^(.+?)\s+supports\s+(.+)$/i },
  { relation: 'supports', re: /^(.+?)\s+enables\s+(.+)$/i },
  { relation: 'mentions', re: /^(.+?)\s+mentions\s+(.+)$/i },
  { relation: 'about', re: /^(.+?)\s+is\s+about\s+(.+)$/i },
  { relation: 'causes', re: /^(.+?)\s+causes\s+(.+)$/i },
  { relation: 'causes', re: /^(.+?)\s+triggered\s+(.+)$/i },
  { relation: 'causes', re: /^(.+?)\s+leads\s+to\s+(.+)$/i }
];

export function canonicalizeSymbol(text) {
  return (text || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeSymbolKey(text) {
  return canonicalizeSymbol(text)
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSymbolText(text) {
  const normalized = normalizeSymbolKey(text).replace(/[_-]+/g, ' ');
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token && !isStopword(token));
}

export function buildFactKey(subject, relation, object) {
  return `${canonicalizeSymbol(subject)}|${relation}|${canonicalizeSymbol(object)}`;
}

function cleanFactPart(text) {
  return canonicalizeSymbol(text)
    .replace(/[.?!]+$/g, '')
    .replace(/^(?:that|the fact that)\s+/i, '')
    .trim();
}

export function extractSymbolicFact(text) {
  const sentence = (text || '').trim().replace(/[.?!]+$/g, '');
  if (!sentence) return null;
  for (const pattern of SENTENCE_RELATION_PATTERNS) {
    const match = sentence.match(pattern.re);
    if (!match) continue;
    const subject = cleanFactPart(match[1]);
    const object = cleanFactPart(match[2]);
    if (!subject || !object || subject === object) continue;
    return {
      subject,
      relation: pattern.relation,
      object,
      confidence: 0.9
    };
  }
  return null;
}
