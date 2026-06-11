// lib/tfidf.mjs — embedding-free TF-IDF. Pure arithmetic, no model, no API key.
// Powers the example-bank retrieval (style-retrieve.mjs).

import { stemTokens } from './text.mjs';

// term -> raw count. Prototype-less object: with a plain {}, a document containing
// the literal word "constructor" reads Object.prototype.constructor (a function),
// "increments" it into a string, NaNs the vector norm downstream, and — because
// `NaN || 1` skips L2 normalization — yields cosines > 1 and bogus top scores.
export function buildTf(textOrTokens) {
  const toks = Array.isArray(textOrTokens) ? textOrTokens : stemTokens(textOrTokens);
  const tf = Object.create(null);
  for (const t of toks) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

export function emptyIdf() {
  return { N: 0, df: Object.create(null) };
}

// Increment document frequency for the UNIQUE terms of one document.
export function indexAdd(idf, textOrTokens) {
  const tf = typeof textOrTokens === 'object' && !Array.isArray(textOrTokens)
    ? textOrTokens
    : buildTf(textOrTokens);
  idf.N = (idf.N || 0) + 1;
  for (const term of Object.keys(tf)) {
    idf.df[term] = (Object.prototype.hasOwnProperty.call(idf.df, term) ? idf.df[term] : 0) + 1;
  }
  return idf;
}

export function idfWeight(idf, term) {
  const N = idf.N || 0;
  // hasOwnProperty guard: an idf loaded from JSON (data/style/idf.json) has a
  // normal prototype, so df["constructor"] would otherwise be a function.
  const df = Object.prototype.hasOwnProperty.call(idf.df, term) ? idf.df[term] : 0;
  // Smooth IDF (sklearn-style): the +1 floor keeps weights positive even when a
  // term appears in every document (df == N), so query<->example overlap still
  // discriminates on a small/homogeneous example bank instead of collapsing to 0.
  return Math.log((N + 1) / (df + 1)) + 1;
}

// L2-normalized TF-IDF vector as a Map(term -> weight).
export function tfidfVec(tf, idf) {
  const vec = new Map();
  let norm = 0;
  for (const [term, f] of Object.entries(tf)) {
    const w = (1 + Math.log(f)) * idfWeight(idf, term);
    vec.set(term, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

export function cosine(u, v) {
  // iterate the smaller map
  const [a, b] = u.size <= v.size ? [u, v] : [v, u];
  let dot = 0;
  for (const [t, w] of a) if (b.has(t)) dot += w * b.get(t);
  return dot; // both are already L2-normalized
}
