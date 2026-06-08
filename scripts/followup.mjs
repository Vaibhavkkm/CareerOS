#!/usr/bin/env node
// scripts/followup.mjs — follow-up cadence engine over data/tracker.jsonl.
// Computes when each actionable application is due for a nudge and buckets by urgency.
// Usage:
//   node scripts/followup.mjs [--summary] [--json] [--overdue-only] [--today=YYYY-MM-DD]
//   node scripts/followup.mjs --self-test
// JSON is the default; --summary prints a human dashboard grouped by urgency.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { readTracker } from '../lib/records.mjs';
import { normalizeStatus, labelFor, isTerminal } from '../lib/states.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER = join(ROOT, 'data', 'tracker.jsonl');

// Days until the next nudge, keyed by canonical status id. These keys also
// define which statuses are "actionable" (everything else is dormant).
export const CADENCE = { applied: 7, responded: 1, interview: 1 };

// Past this many days since the last action a still-actionable lead is "cold".
export const COLD_DAYS = 21;

// Extracts contact email addresses from a notes string for the draft step.
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// ---------- date helpers (UTC, date-only — no TZ drift) ----------
function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const MS_PER_DAY = 86400000;
function addDays(date, n) {
  return new Date(date.getTime() + n * MS_PER_DAY);
}
function toISODate(date) {
  return date.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  // whole days from a -> b (b - a)
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// The anchor we measure cadence from: last_action if present, else date.
function anchorDate(record) {
  return parseDate(record.last_action) || parseDate(record.date);
}

// Is this record one we should still be chasing?
export function isActionable(record) {
  const id = normalizeStatus(record.status);
  if (!id) return false;
  if (isTerminal(id)) return false;
  return Object.prototype.hasOwnProperty.call(CADENCE, id);
}

// ---------- core ----------
// Next date a nudge is due (YYYY-MM-DD), or null if not actionable / undatable.
export function computeNextFollowupDate(record, cadence = CADENCE) {
  if (!isActionable(record)) return null;
  const id = normalizeStatus(record.status);
  const span = cadence[id];
  if (span == null) return null;
  const anchor = anchorDate(record);
  if (!anchor) return null;
  return toISODate(addDays(anchor, span));
}

// Urgency bucket for a record relative to `today` (a YYYY-MM-DD string or Date).
//   'urgent'   — due today
//   'overdue'  — past its due date
//   'waiting'  — due in the future
//   'cold'     — still actionable but no action in > COLD_DAYS (overrides waiting/overdue)
// Returns null for non-actionable / undatable records.
export function computeUrgency(record, today, cadence = CADENCE) {
  if (!isActionable(record)) return null;
  const now = today instanceof Date ? today : parseDate(today);
  if (!now) return null;
  const anchor = anchorDate(record);
  if (!anchor) return null;

  const sinceAction = daysBetween(anchor, now);
  if (sinceAction > COLD_DAYS) return 'cold';

  const dueStr = computeNextFollowupDate(record, cadence);
  const due = parseDate(dueStr);
  if (!due) return null;
  const delta = daysBetween(now, due); // due - today
  if (delta === 0) return 'urgent';
  if (delta < 0) return 'overdue';
  return 'waiting';
}

// Pull contact emails out of the notes field for the draft step.
export function extractContacts(record) {
  const notes = String(record.notes || '');
  const found = notes.match(EMAIL_RE) || [];
  // de-dupe, preserve order, lowercase
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

// Build the actionable view for a tracker: each item annotated with urgency,
// due date, days overdue, and contacts. `today` is a YYYY-MM-DD string.
export function buildFollowups(records, today, cadence = CADENCE) {
  const now = parseDate(today);
  const items = [];
  for (const r of records) {
    if (!isActionable(r)) continue;
    const urgency = computeUrgency(r, now, cadence);
    if (!urgency) continue;
    const due = computeNextFollowupDate(r, cadence);
    const anchor = anchorDate(r);
    const daysSince = anchor ? daysBetween(anchor, now) : null;
    const dueDate = parseDate(due);
    const daysOverdue = dueDate ? -daysBetween(now, dueDate) : null; // >0 if past due
    items.push({
      id: r.id,
      company: r.company,
      role: r.role,
      status: normalizeStatus(r.status),
      status_label: labelFor(normalizeStatus(r.status)),
      last_action: r.last_action || r.date || null,
      days_since_action: daysSince,
      next_followup: due,
      days_overdue: daysOverdue,
      follow_ups: Number(r.follow_ups) || 0,
      urgency,
      contacts: extractContacts(r),
      url: r.url || '',
    });
  }
  // Sort: most pressing first (cold, overdue, urgent, waiting), then by due date.
  const order = { cold: 0, overdue: 1, urgent: 2, waiting: 3 };
  items.sort((a, b) => {
    const o = order[a.urgency] - order[b.urgency];
    if (o !== 0) return o;
    return String(a.next_followup).localeCompare(String(b.next_followup));
  });
  return items;
}

const BUCKETS = ['cold', 'overdue', 'urgent', 'waiting'];

export function groupByUrgency(items) {
  const groups = { cold: [], overdue: [], urgent: [], waiting: [] };
  for (const it of items) (groups[it.urgency] || (groups[it.urgency] = [])).push(it);
  return groups;
}

// ---------- CLI ----------
function parseArgs(argv) {
  const out = { _: [], json: false, summary: false, overdueOnly: false, selfTest: false, today: null };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = true;
    else if (a === '--overdue-only') out.overdueOnly = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a.startsWith('--today=')) out.today = a.slice('--today='.length);
    else if (a === '--today') out.today = '__next__'; // handled below
    else if (out.today === '__next__') out.today = a;
    else out._.push(a);
  }
  return out;
}

function todayISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const ICONS = { cold: '🧊', overdue: '🔴', urgent: '🟠', waiting: '⚪' };

function renderSummary(items, today) {
  const groups = groupByUrgency(items);
  const lines = [];
  lines.push(`careeros follow-ups — as of ${today}\n`);
  const total = items.length;
  if (!total) {
    lines.push('  Nothing actionable. Inbox zero. ✅');
    return lines.join('\n');
  }
  for (const bucket of BUCKETS) {
    const rows = groups[bucket] || [];
    if (!rows.length) continue;
    lines.push(`${ICONS[bucket]} ${bucket.toUpperCase()} (${rows.length})`);
    for (const it of rows) {
      const overdue = it.days_overdue > 0 ? ` (${it.days_overdue}d overdue)` : '';
      const since = it.days_since_action != null ? `${it.days_since_action}d quiet` : '';
      const contact = it.contacts.length ? ` ✉ ${it.contacts.join(', ')}` : '';
      lines.push(`  #${it.id} ${it.company} — ${it.role} [${it.status_label}]`);
      lines.push(`      due ${it.next_followup}${overdue} · ${since} · ${it.follow_ups} nudges${contact}`);
    }
    lines.push('');
  }
  const counts = BUCKETS.filter((b) => (groups[b] || []).length)
    .map((b) => `${(groups[b] || []).length} ${b}`).join(', ');
  lines.push(`Total actionable: ${total} (${counts})`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.selfTest) return selfTest();

  const today = args.today || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    process.stderr.write(`followup: invalid --today=${today} (want YYYY-MM-DD)\n`);
    process.exit(1);
  }

  let records;
  try {
    records = readTracker(TRACKER);
  } catch (e) {
    process.stderr.write(`followup: ${e.message}\n`);
    process.exit(1);
  }

  let items = buildFollowups(records, today);
  if (args.overdueOnly) items = items.filter((it) => it.urgency === 'overdue' || it.urgency === 'cold');

  if (args.summary && !args.json) {
    console.log(renderSummary(items, today));
  } else {
    console.log(JSON.stringify({ today, total: items.length, by_urgency: groupByUrgency(items), items }, null, 2));
  }
  process.exit(0);
}

// ---------- self-test ----------
function selfTest() {
  let checks = 0;
  const T = '2026-06-07'; // fixed "today"
  const tmp = mkdtempSync(join(tmpdir(), 'aw-followup-'));
  const trackerPath = join(tmp, 'tracker.jsonl');
  try {
    // Fixtures chosen so each urgency bucket is hit exactly.
    const recs = [
      // applied, last_action exactly 7d ago -> due today -> urgent
      { id: 1, date: '2026-05-01', company: 'Acme', role: 'SWE', status: 'applied',
        last_action: '2026-05-31', follow_ups: 0, notes: 'recruiter: jane.doe@acme.io' },
      // applied, last_action 10d ago -> due 3d ago -> overdue
      { id: 2, date: '2026-05-01', company: 'Beta', role: 'Backend Engineer', status: 'applied',
        last_action: '2026-05-28', follow_ups: 1, notes: 'no contact yet' },
      // interview, last_action today -> due tomorrow -> waiting
      { id: 3, date: '2026-05-01', company: 'Gamma', role: 'Platform Engineer', status: 'interview',
        last_action: '2026-06-07', follow_ups: 0, notes: '' },
      // applied, last_action 30d ago (> COLD_DAYS) -> cold
      { id: 4, date: '2026-05-01', company: 'Delta', role: 'Data Engineer', status: 'applied',
        last_action: '2026-05-08', follow_ups: 2, notes: 'contact Bob <bob@delta.co>' },
      // terminal status -> not actionable
      { id: 5, date: '2026-05-01', company: 'Eps', role: 'SWE', status: 'rejected',
        last_action: '2026-06-06', follow_ups: 0, notes: '' },
      // evaluated (not yet applied) -> not in CADENCE -> not actionable
      { id: 6, date: '2026-06-06', company: 'Zeta', role: 'SWE', status: 'evaluated',
        last_action: null, follow_ups: 0, notes: '' },
      // responded, anchor falls back to date (no last_action), 1d ago -> due today -> urgent
      { id: 7, date: '2026-06-06', company: 'Eta', role: 'SRE', status: 'responded',
        last_action: null, follow_ups: 0, notes: 'screen scheduled, ping recruiter@eta.dev please' },
    ];
    writeFileSync(trackerPath, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

    // readTracker round-trips
    const loaded = readTracker(trackerPath);
    assert.equal(loaded.length, 7); checks++;

    // --- computeNextFollowupDate ---
    assert.equal(computeNextFollowupDate(recs[0]), '2026-06-07'); checks++; // 05-31 + 7
    assert.equal(computeNextFollowupDate(recs[1]), '2026-06-04'); checks++; // 05-28 + 7
    assert.equal(computeNextFollowupDate(recs[2]), '2026-06-08'); checks++; // 06-07 + 1
    assert.equal(computeNextFollowupDate(recs[6]), '2026-06-07'); checks++; // date 06-06 + 1
    assert.equal(computeNextFollowupDate(recs[4]), null); checks++;        // terminal
    assert.equal(computeNextFollowupDate(recs[5]), null); checks++;        // not in CADENCE

    // --- computeUrgency: each bucket ---
    assert.equal(computeUrgency(recs[0], T), 'urgent'); checks++;
    assert.equal(computeUrgency(recs[1], T), 'overdue'); checks++;
    assert.equal(computeUrgency(recs[2], T), 'waiting'); checks++;
    assert.equal(computeUrgency(recs[3], T), 'cold'); checks++;
    assert.equal(computeUrgency(recs[6], T), 'urgent'); checks++; // anchor-from-date
    // non-actionable -> null
    assert.equal(computeUrgency(recs[4], T), null); checks++;
    assert.equal(computeUrgency(recs[5], T), null); checks++;

    // cold overrides the due-date buckets: even if "due today", >21d quiet = cold
    const coldButDueToday = { id: 99, date: '2026-04-01', company: 'X', role: 'Y',
      status: 'applied', last_action: '2026-05-08', follow_ups: 0, notes: '' };
    // 05-08 -> 06-07 is 30 days > 21
    assert.equal(computeUrgency(coldButDueToday, T), 'cold'); checks++;

    // Date object accepted as `today`
    assert.equal(computeUrgency(recs[0], new Date('2026-06-07T00:00:00Z')), 'urgent'); checks++;

    // --- extractContacts ---
    assert.deepEqual(extractContacts(recs[0]), ['jane.doe@acme.io']); checks++;
    assert.deepEqual(extractContacts(recs[3]), ['bob@delta.co']); checks++;
    assert.deepEqual(extractContacts(recs[1]), []); checks++;
    assert.deepEqual(extractContacts(recs[6]), ['recruiter@eta.dev']); checks++;

    // --- buildFollowups + grouping ---
    const items = buildFollowups(loaded, T);
    assert.equal(items.length, 5); checks++; // recs 1,2,3,4,7 actionable
    const groups = groupByUrgency(items);
    assert.equal(groups.urgent.length, 2); checks++;  // recs 1, 7
    assert.equal(groups.overdue.length, 1); checks++; // rec 2
    assert.equal(groups.waiting.length, 1); checks++; // rec 3
    assert.equal(groups.cold.length, 1); checks++;    // rec 4

    // days_overdue computed correctly for the overdue item
    const beta = items.find((i) => i.id === 2);
    assert.equal(beta.days_overdue, 3); checks++; // due 06-04, today 06-07

    // sort: cold first
    assert.equal(items[0].urgency, 'cold'); checks++;

    // overdue-only filter keeps overdue + cold
    const od = items.filter((it) => it.urgency === 'overdue' || it.urgency === 'cold');
    assert.equal(od.length, 2); checks++;

    // summary renders without throwing and mentions a company
    const summary = renderSummary(items, T);
    assert.ok(summary.includes('Acme')); checks++;
    assert.ok(summary.includes('OVERDUE')); checks++;

    // empty tracker -> nothing actionable
    assert.equal(buildFollowups([], T).length, 0); checks++;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`followup self-test: ${checks} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { main(); }
