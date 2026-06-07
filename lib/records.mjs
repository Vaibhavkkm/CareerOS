// lib/records.mjs — tracker.jsonl I/O + ONE canonical dedup/match implementation.
// tracker.jsonl is the SOURCE OF TRUTH (one JSON object per line).

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { jaccard, stem, words } from './text.mjs';
import { normalizeStatus, rankFor } from './states.mjs';

// ---------- I/O ----------
export function readTracker(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch { throw new Error(`tracker.jsonl: invalid JSON on line ${i + 1}`); }
    });
}

export function writeTracker(path, records) {
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(path, body + (records.length ? '\n' : ''));
}

export function appendJsonl(path, record) {
  appendFileSync(path, JSON.stringify(record) + '\n');
}

// ---------- normalization / matching ----------
const COMPANY_NOISE = /\b(inc|llc|ltd|corp|co|gmbh|sa|plc|company|technologies|technology|labs|ai)\b/g;
export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(COMPANY_NOISE, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common, low-information role words — overlap on these alone is NOT a match.
const BASELINE_ROLE_TOKENS = new Set(
  ['senior', 'sr', 'staff', 'lead', 'principal', 'junior', 'jr', 'mid',
   'software', 'engineer', 'engineering', 'developer', 'dev', 'swe',
   'i', 'ii', 'iii', 'iv'].map(stem),
);
function roleTokens(role) {
  return [...new Set(words(role).map(stem))];
}

// Two roles "the same opening"? Guards against merging
// "Staff SWE, API" with "Staff SWE, K8s" (overlap only on baseline tokens).
export function roleFuzzyMatch(a, b) {
  const ta = roleTokens(a), tb = roleTokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t));
  const nonBaseline = overlap.filter((t) => !BASELINE_ROLE_TOKENS.has(t));
  const jac = jaccard(new Set(ta), setB);
  return overlap.length >= 2 && nonBaseline.length >= 1 && jac >= 0.34;
}

export function sameOpening(a, b) {
  return normalizeCompany(a.company) === normalizeCompany(b.company) && roleFuzzyMatch(a.role, b.role);
}

// ---------- scores ----------
export function parseScore(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const str = String(s).trim();
  if (/^n\/?a$/i.test(str)) return null;
  const m = str.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

// ---------- ids ----------
export function nextId(records) {
  return records.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0) + 1;
}

// ---------- dedup precedence: report# -> id -> company+fuzzy-role ----------
export function findMatchIndex(records, rec) {
  if (rec.report) {
    const i = records.findIndex((r) => r.report && r.report === rec.report);
    if (i !== -1) return i;
  }
  if (rec.id != null) {
    const i = records.findIndex((r) => r.id === rec.id);
    if (i !== -1) return i;
  }
  return records.findIndex((r) => sameOpening(r, rec));
}

// Merge `rec` into the matched record or append. Returns { records, action, index }.
export function upsert(records, recIn) {
  const rec = { ...recIn };
  if (rec.status) rec.status = normalizeStatus(rec.status) || rec.status;
  const idx = findMatchIndex(records, rec);

  if (idx === -1) {
    if (rec.id == null) rec.id = nextId(records);
    if (rec.follow_ups == null) rec.follow_ups = 0;
    records.push(rec);
    return { records, action: 'added', index: records.length - 1 };
  }

  const cur = records[idx];
  let changed = false;
  // status: only advance (higher rank wins); never silently regress
  if (rec.status && rankFor(rec.status) > rankFor(cur.status)) { cur.status = rec.status; changed = true; }
  // score: keep the higher
  const sNew = parseScore(rec.score), sCur = parseScore(cur.score);
  if (sNew != null && (sCur == null || sNew > sCur)) { cur.score = sNew; changed = true; }
  // fill missing scalar fields
  for (const k of ['url', 'report', 'cv_pdf', 'cl_pdf', 'archetype', 'legitimacy', 'last_action']) {
    if ((cur[k] == null || cur[k] === '') && rec[k] != null && rec[k] !== '') { cur[k] = rec[k]; changed = true; }
  }
  // append notes if new
  if (rec.notes && !(cur.notes || '').includes(rec.notes)) {
    cur.notes = cur.notes ? `${cur.notes}; ${rec.notes}` : rec.notes;
    changed = true;
  }
  return { records, action: changed ? 'updated' : 'skipped', index: idx };
}

export function stats(records) {
  const byStatus = {};
  let scored = 0, scoreSum = 0, withPdf = 0, withReport = 0;
  for (const r of records) {
    const id = normalizeStatus(r.status) || 'unknown';
    byStatus[id] = (byStatus[id] || 0) + 1;
    const sc = parseScore(r.score);
    if (sc != null) { scored++; scoreSum += sc; }
    if (r.cv_pdf) withPdf++;
    if (r.report) withReport++;
  }
  return {
    total: records.length,
    byStatus,
    avgScore: scored ? +(scoreSum / scored).toFixed(2) : null,
    pctPdf: records.length ? Math.round((withPdf / records.length) * 100) : 0,
    pctReport: records.length ? Math.round((withReport / records.length) * 100) : 0,
  };
}
