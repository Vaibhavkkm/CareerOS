#!/usr/bin/env node
// scripts/contacts.mjs — lightweight people-ledger for outreach + follow-ups.
//
// The tracker knows APPLICATIONS; this knows PEOPLE — recruiters, referrers,
// hiring managers — and links them to applications, so the followup cadence
// can cover "ping the recruiter who replied" as well as "chase the application".
// Truth lives in data/contacts.jsonl (one JSON object per line, append-friendly,
// same philosophy as tracker.jsonl). Used by the outreach/followup playbooks;
// the phone-number guardrail lives there (NEVER share the user's phone in cold
// outreach) — this script just stores facts.
//
// Usage:
//   node scripts/contacts.mjs add --name "Ada Smith" [--company Acme] [--role "Recruiter"]
//                                 [--channel linkedin|email|referral|other] [--handle <url|addr>]
//                                 [--app <tracker-id>] [--note "..."]
//   node scripts/contacts.mjs list [--company Acme] [--due] [--summary]
//   node scripts/contacts.mjs touch --id c3 [--status contacted|replied|meeting|dormant]
//                                   [--next YYYY-MM-DD] [--note "..."]
//   node scripts/contacts.mjs --self-test

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = join(ROOT, 'data', 'contacts.jsonl');
export const STATUSES = ['new', 'contacted', 'replied', 'meeting', 'dormant'];

export function parseContacts(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function nextId(contacts) {
  const max = contacts.reduce((m, c) => Math.max(m, Number((c.id || 'c0').slice(1)) || 0), 0);
  return `c${max + 1}`;
}

export function makeContact(fields, contacts, today) {
  if (!fields.name) throw new Error('--name is required');
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error(`status must be one of ${STATUSES.join('|')}`);
  return {
    id: nextId(contacts),
    name: fields.name,
    company: fields.company || null,
    role: fields.role || null,
    channel: fields.channel || 'other',
    handle: fields.handle || null,
    linked_app: fields.app || null,
    status: fields.status || 'new',
    last_contacted: null,
    next_followup: fields.next || null,
    notes: fields.note ? [`${today}: ${fields.note}`] : [],
    created: today,
    updated: today,
  };
}

export function touchContact(contact, { status, next, note }, today) {
  const c = { ...contact, updated: today };
  if (status) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join('|')}`);
    c.status = status;
  }
  c.last_contacted = today;
  if (next) c.next_followup = next;
  if (note) c.notes = [...(c.notes || []), `${today}: ${note}`];
  return c;
}

export function dueContacts(contacts, today) {
  return contacts.filter((c) => c.next_followup && c.next_followup <= today && c.status !== 'dormant');
}

const load = (file) => (existsSync(file) ? parseContacts(readFileSync(file, 'utf8')) : []);
const save = (file, contacts) => writeFileSync(file, contacts.map((c) => JSON.stringify(c)).join('\n') + (contacts.length ? '\n' : ''));

function main(args, file = DEFAULT_FILE) {
  const cmd = args[0];
  const opt = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith('--') ? v : null; };
  const today = new Date().toISOString().slice(0, 10);
  const contacts = load(file);

  if (cmd === 'add') {
    const c = makeContact({
      name: opt('--name'), company: opt('--company'), role: opt('--role'), channel: opt('--channel'),
      handle: opt('--handle'), app: opt('--app'), note: opt('--note'), next: opt('--next'), status: opt('--status'),
    }, contacts, today);
    appendFileSync(file, JSON.stringify(c) + '\n');
    console.log(JSON.stringify({ ok: true, added: c }, null, 2));
  } else if (cmd === 'touch') {
    const id = opt('--id');
    const i = contacts.findIndex((c) => c.id === id);
    if (i < 0) { console.error(JSON.stringify({ ok: false, error: `no contact ${id}` })); return 1; }
    contacts[i] = touchContact(contacts[i], { status: opt('--status'), next: opt('--next'), note: opt('--note') }, today);
    save(file, contacts);
    console.log(JSON.stringify({ ok: true, contact: contacts[i] }, null, 2));
  } else if (cmd === 'list' || !cmd) {
    let rows = contacts;
    const company = opt('--company');
    if (company) rows = rows.filter((c) => (c.company || '').toLowerCase().includes(company.toLowerCase()));
    if (args.includes('--due')) rows = dueContacts(rows, today);
    console.log(JSON.stringify({ ok: true, today, count: rows.length, contacts: rows }, null, 2));
    if (args.includes('--summary')) {
      for (const c of rows) console.error(`${c.id}  ${c.status.padEnd(9)} ${c.name}${c.company ? ` (${c.company})` : ''}${c.next_followup ? ` → follow up ${c.next_followup}` : ''}`);
    }
  } else {
    console.error(JSON.stringify({ ok: false, error: `unknown command "${cmd}" — use add | list | touch` }));
    return 1;
  }
  return 0;
}

// ---------- self-test ----------
async function selfTest() {
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) throw new Error(`check failed: ${what}`); };
  const dir = mkdtempSync(join(tmpdir(), 'contacts-'));
  const file = join(dir, 'contacts.jsonl');
  try {
    ok(main(['add', '--name', 'Ada Smith', '--company', 'Acme', '--channel', 'linkedin', '--next', '2026-01-01'], file) === 0, 'add ok');
    ok(main(['add', '--name', 'Bo Li', '--app', '12'], file) === 0, 'second add ok');
    const all = load(file);
    ok(all.length === 2 && all[0].id === 'c1' && all[1].id === 'c2', 'sequential ids');
    ok(all[1].linked_app === '12', 'app link stored');

    ok(main(['touch', '--id', 'c1', '--status', 'replied', '--note', 'pinged'], file) === 0, 'touch ok');
    const after = load(file);
    ok(after[0].status === 'replied' && after[0].last_contacted && after[0].notes.length === 1, 'touch updates status/date/notes');
    ok(after[1].status === 'new', 'other rows untouched');

    const due = dueContacts(after, '2026-06-11');
    ok(due.length === 1 && due[0].id === 'c1', 'due filter (past next_followup)');
    ok(dueContacts([{ ...after[0], status: 'dormant' }], '2026-06-11').length === 0, 'dormant never due');

    ok(main(['touch', '--id', 'c9'], file) === 1, 'unknown id is an error');
    let threw = false;
    try { makeContact({ name: 'X', status: 'bogus' }, [], '2026-06-11'); } catch { threw = true; }
    ok(threw, 'invalid status rejected');
    ok(nextId([]) === 'c1', 'first id');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`contacts self-test: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch((e) => { console.error(`contacts self-test FAILED: ${e.message}`); process.exit(1); });
  } else {
    try { process.exit(main(process.argv.slice(2))); }
    catch (e) { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); }
  }
}
