// Tokenizer for BM25 indexing and query processing (DS009)
import { isStopword } from '../vendor/stopwords.mjs';
import { stem } from '../vendor/porter.mjs';

let stemmingEnabled = true;

function isStemming() {
  return stemmingEnabled;
}

export function configureTokenizer(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'stemming')) {
    stemmingEnabled = options.stemming !== false;
  }
}

export function tokenize(text) {
  if (!text) return [];
  const raw = text.toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = [];
  for (let t of raw) {
    // Strip edge punctuation except hyphens inside
    t = t.replace(/^[^\w-]+/, '').replace(/[^\w-]+$/, '');
    if (!t) continue;
    // Possessives
    t = t.replace(/'s$/, '');
    if (!t || isStopword(t)) continue;
    // Hyphenated: keep whole + parts
    if (t.includes('-') && !/^\d/.test(t)) {
      tokens.push(t);
      for (const part of t.split('-')) {
        if (part && !isStopword(part)) tokens.push(part);
      }
    } else {
      tokens.push(t);
    }
  }
  if (!isStemming()) return tokens;
  return tokens.map(t => stem(t));
}
