#!/usr/bin/env node
// scripts/interviews.mjs — interview scheduler + calendar (zero tokens).
//
// The tracker (tracker.jsonl) records WHERE an application stands; this records the
// interview ROUNDS within it — each round's date/time, type, interviewers, and
// joining link — and turns them into:
//   • an upcoming-interviews view (next N days, sorted),
//   • an ICS calendar file you can import into Google/Apple/Outlook,
//   • a follow-up signal (a round that has happened but has no thank-you logged),
//     which feeds the existing `followup` cadence.
//
// Truth lives in data/interviews.jsonl (one JSON object per line), mirroring the
// tracker's truth/view split. The agent never auto-sends anything; it drafts and
// the human acts (same guardrail as the rest of CareerOS).
//
// Usage:
//   node scripts/interviews.mjs add --company Acme --role "Data Eng" \
//        --when 2026-06-12T14:00 --type technical --duration 60 \
//        --with "Jane Roe,Bob Lee" --link https://meet.example/abc --round 2 --tracker 5
//   node scripts/interviews.mjs list [--days 14] [--summary]
//   node scripts/interviews.mjs ics [--out data/interviews.ics]    # export a calendar
//   node scripts/interviews.mjs followups [--summary]              # rounds needing a thank-you
//   node scripts/interviews.mjs --self-test

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { readTracker, appendJsonl, nextId } from '../lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'data', 'interviews.jsonl');
const ICS_OUT = join(ROOT, 'data', 'interviews.ics');

// ─── pure helpers (exported for --self-test) ──────────────────────────

// A Date → the RFC 5545 UTC stamp "YYYYMMDDTHHMMSSZ".
export function toIcsStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Fold long lines + escape per RFC 5545 (commas, semicolons, newlines).
export function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// One interview record → minutes of duration (default 45).
export function endOf(startIso, durationMin) {
  const start = new Date(startIso);
  const mins = Number(durationMin) > 0 ? Number(durationMin) : 45;
  return new Date(start.getTime() + mins * 60_000);
}

export function summaryLine(rec) {
  const t = rec.type ? ` (${rec.type})` : '';
  const rd = rec.round ? ` R${rec.round}` : '';
  return `Interview — ${rec.company || '?'}${t}${rd}`;
}

// Build an ICS calendar string from interview records. `dtstamp` (a Date) is
// injected so the output is deterministic for tests.
export function buildIcs(records, dtstamp) {
  const stamp = toIcsStamp(dtstamp);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CareerOS//Interview Scheduler//EN', 'CALSCALE:GREGORIAN',
  ];
  for (const r of records) {
    if (!r.when) continue;
    const start = new Date(r.when);
    if (Number.isNaN(start.getTime())) continue;
    const end = endOf(r.when, r.duration);
    const descParts = [];
    if (r.role) descParts.push(`Role: ${r.role}`);
    if (r.interviewers) descParts.push(`With: ${r.interviewers}`);
    if (r.link) descParts.push(`Link: ${r.link}`);
    if (r.notes) descParts.push(r.notes);
    lines.push(
      'BEGIN:VEVENT',
      `UID:careeros-interview-${r.id}@careeros`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsStamp(start)}`,
      `DTEND:${toIcsStamp(end)}`,
      `SUMMARY:${icsEscape(summaryLine(r))}`,
    );
    if (descParts.length) lines.push(`DESCRIPTION:${icsEscape(descParts.join(' \\n '))}`);
    if (r.link || r.location) lines.push(`LOCATION:${icsEscape(r.link || r.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 wants CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

// Interviews coming up within `days` of `now`, soonest first.
export function upcoming(records, now, days = 14) {
  const horizon = new Date(now).getTime() + days * 86_400_000;
  return records
    .filter((r) => r.when && !Number.isNaN(new Date(r.when).getTime()))
    .filter((r) => { const t = new Date(r.when).getTime(); return t >= new Date(now).getTime() && t <= horizon; })
    .sort((a, b) => new Date(a.when) - new Date(b.when));
}

// Rounds that have already HAPPENED but have no thank-you/follow-up logged → a
// follow-up is due. `now` injected for determinism.
export function followupsDue(records, now) {
  const t0 = new Date(now).getTime();
  return records
    .filter((r) => r.when && !Number.isNaN(new Date(r.when).getTime()))
    .filter((r) => new Date(r.when).getTime() < t0 && !r.thanked && r.status !== 'cancelled')
    .sort((a, b) => new Date(b.when) - new Date(a.when));
}

// ─── I/O ──────────────────────────────────────────────────────────────
function readStore() {
  try { return readTracker(STORE); } catch { return []; }
}

function addInterview(args) {
  if (!args.company) return { ok: false, error: '--company required' };
  if (!args.when || Number.isNaN(new Date(args.when).getTime())) {
    return { ok: false, error: '--when <ISO datetime> required (e.g. 2026-06-12T14:00)' };
  }
  const records = readStore();
  const rec = {
    id: nextId(records),
    company: args.company,
    role: args.role || '',
    tracker_id: args.tracker != null ? Number(args.tracker) : null,
    round: args.round != null ? Number(args.round) : null,
    type: args.type || '',
    when: new Date(args.when).toISOString(),
    duration: args.duration != null ? Number(args.duration) : 45,
    interviewers: args.with || '',
    link: args.link || '',
    location: args.location || '',
    notes: args.notes || '',
    status: 'scheduled',
    thanked: false,
  };
  appendJsonl(STORE, rec);
  return { ok: true, added: rec };
}

// ─── CLI ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { cmd: null, json: true, days: 14, out: null };
  const flags = ['company', 'role', 'when', 'type', 'duration', 'with', 'link', 'location', 'notes', 'round', 'tracker', 'days', 'out'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    if (a === '--self-test') out.cmd = 'self-test';
    else if (a === '--summary') out.json = false;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--') && !out.cmd) out.cmd = a;
    else {
      for (const f of flags) {
        if (a === `--${f}`) { out[f] = val(); break; }
        if (a.startsWith(`--${f}=`)) { out[f] = a.slice(f.length + 3); break; }
      }
    }
  }
  return out;
}

const USAGE = `interviews — schedule interview rounds, export a calendar, time follow-ups.
Usage:
  node scripts/interviews.mjs add --company <c> --when <ISO> [--role --type --duration --with --link --round --tracker --notes]
  node scripts/interviews.mjs list [--days N] [--summary]
  node scripts/interviews.mjs ics [--out <file>]
  node scripts/interviews.mjs followups [--summary]
  node scripts/interviews.mjs --self-test`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const args = parseArgs(argv);
  if (args.cmd === 'self-test') return selfTest();
  const now = new Date().toISOString();

  if (args.cmd === 'add') {
    const r = addInterview(args);
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? `added: ${summaryLine(r.added)} @ ${r.added.when}` : `error: ${r.error}`);
    process.exit(r.ok ? 0 : 2);
  }

  if (args.cmd === 'ics') {
    const records = readStore();
    const ics = buildIcs(records, new Date());
    const outPath = args.out || ICS_OUT;
    writeFileSync(outPath, ics);
    if (args.json) console.log(JSON.stringify({ ok: true, events: records.filter((r) => r.when).length, out: outPath }, null, 2));
    else console.log(`wrote ${records.filter((r) => r.when).length} event(s) → ${outPath}\n  import this into Google/Apple/Outlook calendar.`);
    process.exit(0);
  }

  if (args.cmd === 'followups') {
    const due = followupsDue(readStore(), now);
    if (args.json) console.log(JSON.stringify({ ok: true, due }, null, 2));
    else {
      console.log(`CareerOS — interview follow-ups due (${due.length})\n`);
      for (const r of due) console.log(`  · ${r.company} — ${summaryLine(r)} on ${r.when.slice(0, 10)} — send a thank-you`);
      if (!due.length) console.log('  None outstanding.');
    }
    process.exit(0);
  }

  // default: list upcoming
  const up = upcoming(readStore(), now, Number(args.days) || 14);
  if (args.json) console.log(JSON.stringify({ ok: true, days: Number(args.days) || 14, upcoming: up }, null, 2));
  else {
    console.log(`CareerOS — upcoming interviews (next ${Number(args.days) || 14} days)\n`);
    for (const r of up) {
      const when = r.when.replace('T', ' ').slice(0, 16);
      console.log(`  ${when}  ${summaryLine(r)} — ${r.role || ''}`);
      if (r.link) console.log(`               ${r.link}`);
    }
    if (!up.length) console.log('  Nothing scheduled. Add one: interviews add --company <c> --when <ISO>');
  }
  process.exit(0);
}

// ─── self-test ───────────────────────────────────────────────────────
export function selfTest() {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

  // toIcsStamp formats UTC
  eq(toIcsStamp(new Date('2026-06-10T14:05:00Z')), '20260610T140500Z', 'toIcsStamp UTC format');

  // endOf adds duration (default 45)
  eq(endOf('2026-06-10T14:00:00Z', 60).toISOString(), '2026-06-10T15:00:00.000Z', 'endOf +60min');
  eq(endOf('2026-06-10T14:00:00Z').toISOString(), '2026-06-10T14:45:00.000Z', 'endOf default 45min');

  // icsEscape
  eq(icsEscape('a, b; c'), 'a\\, b\\; c', 'icsEscape commas + semicolons');

  // summaryLine
  eq(summaryLine({ company: 'Acme', type: 'technical', round: 2 }), 'Interview — Acme (technical) R2', 'summaryLine');

  // buildIcs produces a valid VEVENT with deterministic dtstamp
  const recs = [
    { id: 1, company: 'Acme', role: 'Data Eng', type: 'technical', round: 1, when: '2026-06-12T14:00:00Z', duration: 60, interviewers: 'Jane, Bob', link: 'https://meet/abc' },
    { id: 2, company: 'Globex', when: 'not-a-date' }, // skipped
  ];
  const ics = buildIcs(recs, new Date('2026-06-09T09:00:00Z'));
  ok(ics.includes('BEGIN:VCALENDAR') && ics.includes('END:VCALENDAR'), 'ICS envelope');
  ok(ics.includes('BEGIN:VEVENT') && ics.includes('UID:careeros-interview-1@careeros'), 'ICS event UID');
  ok(ics.includes('DTSTART:20260612T140000Z') && ics.includes('DTEND:20260612T150000Z'), 'ICS start/end');
  ok(ics.includes('DTSTAMP:20260609T090000Z'), 'ICS deterministic dtstamp');
  ok(ics.includes('SUMMARY:Interview — Acme (technical) R1'), 'ICS summary');
  ok((ics.match(/BEGIN:VEVENT/g) || []).length === 1, 'ICS skips the unparseable-date record');
  ok(ics.includes('\r\n'), 'ICS uses CRLF');

  // upcoming: within window, sorted, excludes past + far-future
  const now = '2026-06-09T12:00:00Z';
  const set = [
    { id: 1, company: 'A', when: '2026-06-10T10:00:00Z' },
    { id: 2, company: 'B', when: '2026-06-08T10:00:00Z' }, // past
    { id: 3, company: 'C', when: '2026-06-30T10:00:00Z' }, // beyond 14d
    { id: 4, company: 'D', when: '2026-06-12T10:00:00Z' },
  ];
  const up = upcoming(set, now, 14);
  eq(up.length, 2, 'upcoming keeps only the 2 within-window future events');
  eq(up[0].company, 'A', 'upcoming sorted soonest-first');
  ok(!up.some((r) => r.company === 'B' || r.company === 'C'), 'upcoming excludes past + far-future');

  // followupsDue: past + not thanked
  const fu = followupsDue([
    { id: 1, company: 'A', when: '2026-06-08T10:00:00Z', thanked: false },
    { id: 2, company: 'B', when: '2026-06-08T10:00:00Z', thanked: true },
    { id: 3, company: 'C', when: '2026-06-08T10:00:00Z', status: 'cancelled' },
    { id: 4, company: 'D', when: '2026-06-20T10:00:00Z' }, // future
  ], now);
  eq(fu.length, 1, 'followupsDue: only the past, un-thanked, non-cancelled round');
  eq(fu[0].company, 'A', 'followupsDue picks the right record');

  console.log(`interviews self-test: ${n} checks passed`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.slice(2).includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error(`interviews self-test FAILED: ${e.message}\n${e.stack}`); process.exit(1); }
  } else {
    main();
  }
}
