import { isStopword } from './stopwords.mjs';
import { stem } from './porter.mjs';

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
  for (let token of raw) {
    token = token.replace(/^[^\w-]+/, '').replace(/[^\w-]+$/, '');
    if (!token) continue;
    token = token.replace(/'s$/, '');
    if (!token || isStopword(token)) continue;
    if (token.includes('-') && !/^\d/.test(token)) {
      tokens.push(token);
      for (const part of token.split('-')) {
        if (part && !isStopword(part)) tokens.push(part);
      }
    } else {
      tokens.push(token);
    }
  }
  if (!isStemming()) return tokens;
  return tokens.map(token => stem(token));
}
