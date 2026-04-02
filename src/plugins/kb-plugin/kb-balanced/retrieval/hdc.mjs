// HDC/VSA primitives — binary hypervectors, zero dependencies
// Dimension: 4096 bits = 128 × uint32

const DIM_BITS = 4096;
const DIM_WORDS = DIM_BITS >>> 5; // 128

// Deterministic PRNG from seed string
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function prng(seed) {
  let s = seed;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
}

// Generate a random hypervector from a string key
const _hvCache = new Map();
export function randomHV(key) {
  if (_hvCache.has(key)) return _hvCache.get(key);
  const v = new Uint32Array(DIM_WORDS);
  const rng = prng(hashSeed(key));
  for (let i = 0; i < DIM_WORDS; i++) v[i] = rng();
  _hvCache.set(key, v);
  return v;
}

// Bind (XOR)
export function bind(a, b) {
  const r = new Uint32Array(DIM_WORDS);
  for (let i = 0; i < DIM_WORDS; i++) r[i] = a[i] ^ b[i];
  return r;
}

// Bundle (majority vote)
export function bundle(vectors) {
  if (vectors.length === 0) return new Uint32Array(DIM_WORDS);
  if (vectors.length === 1) return new Uint32Array(vectors[0]);
  const counts = new Uint16Array(DIM_BITS);
  for (const v of vectors) {
    for (let w = 0; w < DIM_WORDS; w++) {
      let bits = v[w];
      const base = w << 5;
      while (bits) {
        const bit = 31 - Math.clz32(bits);
        counts[base + bit]++;
        bits ^= 1 << bit;
      }
    }
  }
  const threshold = vectors.length >>> 1;
  const r = new Uint32Array(DIM_WORDS);
  for (let i = 0; i < DIM_BITS; i++) {
    if (counts[i] > threshold) r[i >>> 5] |= 1 << (i & 31);
  }
  return r;
}

// Hamming distance
function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < DIM_WORDS; i++) {
    let x = a[i] ^ b[i];
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    d += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return d;
}

// Similarity: 1 - hamming/dim, range [0,1]
export function similarity(a, b) {
  return 1 - hamming(a, b) / DIM_BITS;
}

// Positional n-gram encoding: bind each token with its position
// This makes "neural implants" ≠ "implants neural" and captures sequence
export function encodeNgrams(tokens) {
  if (!tokens.length) return new Uint32Array(DIM_WORDS);
  const parts = [];
  // Unigrams bound to position
  for (let i = 0; i < tokens.length; i++) {
    parts.push(bind(randomHV(`__pos_${i % 16}`), randomHV(tokens[i])));
  }
  // Bigrams: bind consecutive pairs for structural matching
  for (let i = 0; i < tokens.length - 1; i++) {
    parts.push(bind(randomHV(tokens[i]), randomHV(tokens[i + 1])));
  }
  return bundle(parts);
}

// Simple bag-of-words encoding (for short fields like role, acts)
export function encodeTokens(tokens) {
  if (!tokens.length) return new Uint32Array(DIM_WORDS);
  return bundle(tokens.map(t => randomHV(t)));
}

export { DIM_BITS, DIM_WORDS };
