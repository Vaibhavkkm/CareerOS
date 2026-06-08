// lib/records.mjs — tracker.jsonl I/O + ONE canonical dedup/match implementation.
// tracker.jsonl is the SOURCE OF TRUTH (one JSON object per line).

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
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
  mkdirSync(dirname(path), { recursive: true }); // create parent dirs for custom paths
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  // Atomic write: serialize to a temp file in the SAME dir, then rename over the
  // target. rename(2) is atomic on POSIX, so a crash / ENOSPC / kill mid-write can
  // never leave tracker.jsonl (the source of truth) half-written — readTracker
  // throws on the first malformed line, which would otherwise brick the pipeline.
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body + (records.length ? '\n' : ''));
  renameSync(tmp, path);
}

export function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n');
}

// ---------- normalization / matching ----------
const COMPANY_NOISE = /\b(inc|llc|ltd|corp|co|gmbh|sa|plc|company|technologies|technology|labs|ai)\b/g;
export function normalizeCompany(name) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[.,&]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop generic suffixes (Inc, LLC, Labs, AI…). But if the name is ENTIRELY such
  // tokens (e.g. "AI Labs" → "" ), keep the cleaned form — otherwise two different
  // noise-only companies both collapse to '' and wrongly dedup-merge into one.
  const stripped = cleaned.replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  return stripped || cleaned;
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
  const m = str.match(/(-?\d+(?:\.\d+)?)/); // capture a leading minus so it isn't silently dropped
  if (!m) return null;
  const v = parseFloat(m[1]);
  // Scores are non-negative; a negative value is invalid input, not score 5.
  return Number.isFinite(v) && v >= 0 ? v : null;
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
    // Honor an id match ONLY if the company is compatible. An explicit/batch record
    // carrying a stray id must not overwrite a DIFFERENT company's opening that
    // happens to share that id — fall through to company+role matching instead.
    if (i !== -1) {
      const r = records[i];
      const compatible = !rec.company || !r.company ||
        normalizeCompany(r.company) === normalizeCompany(rec.company);
      if (compatible) return i;
    }
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
  // append notes if new — compare whole "; "-separated segments, not substrings,
  // so a distinct note isn't dropped just for being a substring of an existing one
  // (and a superset note doesn't duplicate content already present).
  if (rec.notes) {
    const incoming = String(rec.notes).trim();
    const segs = String(cur.notes || '').split(';').map((s) => s.trim()).filter(Boolean);
    if (incoming && !segs.includes(incoming)) {
      cur.notes = cur.notes ? `${cur.notes}; ${rec.notes}` : rec.notes;
      changed = true;
    }
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
