#!/usr/bin/env node
// scripts/style-profile.mjs — Algorithm B: turn diffs into a learnable style profile.
//
// Subcommands:
//   apply  --edit <dir> [--dir <style-dir>] [--today=YYYY-MM-DD]
//       Read <dir>/diff.json, derive rule candidates, merge into profile.json,
//       re-render profile.md, append CHANGELOG.style.md, bump edits_seen.
//   bank   --edit <dir> [--dir <style-dir>]
//       Append kept/reworded-kept units from user_final to examples.jsonl and
//       index them into idf.json.
//   --rebuild [--dir <style-dir>]
//       Wipe derived state (profile rules, examples, idf) and replay every
//       data/style/edits/*/diff.json chronologically (apply + bank).
//   --self-test
//
// Truth file: <style-dir>/profile.json. profile.md is a rendered VIEW.
// Nothing is ever DELETED — rules only status-flip
// (provisional -> active -> superseded -> retired). All changes are logged.

import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, appendFileSync,
  mkdtempSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import assert from 'node:assert/strict';

import { stem, stemTokens, jaccard, trigramCosine, unitSimilarity } from '../lib/text.mjs';
import { buildTf, emptyIdf, indexAdd } from '../lib/tfidf.mjs';
import { runOnDir as diffRunOnDir } from './style-diff.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STYLE_DIR = join(ROOT, 'data', 'style');

export const CONSTANTS = {
  PROMOTE: 2, HARD_KEEP: 4, STALE_DAYS: 120,
  DUP_SIM: 0.8, REWORD_LO: 0.45, KEEP_HI: 0.92,
};

// Per-category caps for anti-bloat (active+provisional kept; overflow -> retired).
const CATEGORY_CAPS = {
  action_verbs: 15, always_cut: 10, always_add: 10, formatting: 12,
};

// ---------- arg parsing ----------
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next != null && !next.startsWith('--')) { out.flags[key] = next; i++; }
        else out.flags[key] = true;
      }
    } else out._.push(a);
  }
  return out;
}

export function today(flags = {}) {
  const t = flags.today;
  if (t && t !== true && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- profile I/O ----------
export function emptyProfile(theToday) {
  return {
    version: 1,
    updated: theToday || today(),
    edits_seen: 0,
    constants: { ...CONSTANTS },
    rules: [],
  };
}

export function readProfile(styleDir, theToday) {
  const p = join(styleDir, 'profile.json');
  if (!existsSync(p)) return emptyProfile(theToday);
  try {
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    obj.rules = Array.isArray(obj.rules) ? obj.rules : [];
    obj.constants = { ...CONSTANTS, ...(obj.constants || {}) };
    if (obj.edits_seen == null) obj.edits_seen = 0;
    return obj;
  } catch (e) {
    throw new Error(`profile.json invalid JSON: ${e.message}`);
  }
}

export function writeProfile(styleDir, profile) {
  mkdirSync(styleDir, { recursive: true });
  writeFileSync(join(styleDir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
}

function readContext(editDir) {
  const p = join(editDir, 'context.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`context.json invalid JSON: ${e.message}`); }
}

// ---------- scope ----------
// A rule's scope: global, archetype:<x>, doc:cv, doc:cl. We default to doc:<kind>
// (the strongest evidence we always have), and tag archetype when known.
function scopeFor(diff, ctx, { preferArchetype = false } = {}) {
  if (preferArchetype && ctx && ctx.archetype) return `archetype:${String(ctx.archetype).toLowerCase()}`;
  return `doc:${diff.doc_kind}`;
}

// ---------- candidate derivation (the heart of Algorithm B) ----------
// canonKey = category|polarity|stemmed-target|scope  (the identity for merging)
export function canonKey(rule) {
  const target = rule.value != null ? String(rule.value) : '';
  const stemmed = target ? stemTokens(target, { keepStop: true }).join('-') || target.toLowerCase() : '';
  return [rule.category, rule.polarity || '', stemmed, rule.scope].join('|');
}

// Build the list of rule candidates implied by one diff.json.
export function candidatesFromDiff(diff, ctx) {
  const out = [];
  const docScope = scopeFor(diff, ctx);
  const archScope = scopeFor(diff, ctx, { preferArchetype: true });

  const push = (c) => out.push(c);

  for (const u of diff.units) {
    const d = u.deltas || {};
    const sec = u.section || '';

    // --- verb change => ban(old) + prefer(new) action_verbs ---
    if (u.op === 'reworded' && d.verb && d.verb[0] && d.verb[1] && d.verb[0] !== d.verb[1]) {
      const oldV = d.verb[0], newV = d.verb[1];
      push({
        category: 'action_verbs', polarity: 'ban', value: oldV, scope: docScope,
        directive: `Avoid opening with "${oldV}".`,
      });
      push({
        category: 'action_verbs', polarity: 'prefer', value: newV, scope: docScope,
        directive: `Prefer strong verbs like "${newV}".`,
      });
    }

    // --- added quant => quantification prefer, scoped to section ---
    if ((u.op === 'reworded' || u.op === 'added') && Array.isArray(d.added_quant) && d.added_quant.length) {
      const kinds = d.added_quant.join('/');
      push({
        category: 'quantification', polarity: 'prefer',
        value: `metric:${sec || diff.doc_kind}`, scope: docScope,
        directive: `Quantify ${sec ? `the "${sec}" section` : 'claims'} with ${kinds}.`,
      });
    }

    // --- removed filler / banned verbs => always_cut ---
    if ((u.op === 'reworded' || u.op === 'removed') && Array.isArray(d.banned_hits_before)) {
      for (const hit of d.banned_hits_before) {
        push({
          category: 'always_cut', value: hit, scope: docScope,
          directive: `Always cut "${hit}".`,
        });
      }
    }

    // --- word-count drop > 3 on a reword => sentence_length {max:newWc} ---
    if (u.op === 'reworded' && Array.isArray(d.wc) && d.wc[0] - d.wc[1] > 3) {
      push({
        category: 'sentence_length', value: d.wc[1], scope: docScope,
        directive: `Keep ${u.kind || 'lines'} tight — around ${d.wc[1]} words (was ${d.wc[0]}).`,
      });
    }

    // --- reorder => structure note ---
    if (u.reordered) {
      push({
        category: 'structure', value: `reorder:${sec || diff.doc_kind}`, scope: archScope,
        directive: `Reorder content within "${sec || diff.doc_kind}" (user moved items).`,
      });
    }

    // --- removed unit => always_cut(topic) ---
    if (u.op === 'removed') {
      const topic = topicOf(u.before);
      if (topic) push({
        category: 'always_cut', value: `topic:${topic}`, scope: docScope,
        directive: `Consider dropping content about "${topic}" (user removed it).`,
      });
    }

    // --- added unit => always_add(topic) ---
    if (u.op === 'added') {
      const topic = topicOf(u.after);
      if (topic) push({
        category: 'always_add', value: `topic:${topic}`, scope: docScope,
        directive: `Make room for content about "${topic}" (user added it).`,
      });
    }
  }
  return out;
}

// Pick the most salient 1-2 content stems of a unit as its "topic".
function topicOf(text) {
  const toks = stemTokens(text || '');
  if (!toks.length) return '';
  // frequency-rank then take the top distinct stems
  const freq = new Map();
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  return ranked.slice(0, 2).map(([t]) => t).join('-');
}

// ---------- contradiction detection ----------
// Two action_verbs rules on the SAME stemmed verb + scope but opposite polarity
// (ban vs prefer) contradict. Same idea for any polarity-bearing pair.
function contradicts(a, b) {
  if (a.category !== b.category || a.scope !== b.scope) return false;
  if (!a.polarity || !b.polarity) return false;
  if (a.polarity === b.polarity) return false;
  const sa = a.value != null ? stemTokens(String(a.value), { keepStop: true }).join('-') : '';
  const sb = b.value != null ? stemTokens(String(b.value), { keepStop: true }).join('-') : '';
  return sa && sa === sb;
}

function directiveSim(a, b) {
  const ta = new Set(stemTokens(a)), tb = new Set(stemTokens(b));
  return 0.5 * jaccard(ta, tb) + 0.5 * trigramCosine(a, b);
}

// ---------- merge one candidate into the profile ----------
// Returns a log line describing the change (or null if no-op).
function mergeCandidate(profile, cand, editId, theToday) {
  const DUP = profile.constants.DUP_SIM;
  const PROMOTE = profile.constants.PROMOTE;

  const candKey = canonKey(cand);

  // 1) exact canonKey match OR directive-similar same-category rule => reinforce
  let target = profile.rules.find(
    (r) => r.status !== 'retired' && r.status !== 'superseded' && canonKey(r) === candKey,
  );
  if (!target) {
    target = profile.rules.find(
      (r) => r.status !== 'retired' && r.status !== 'superseded' &&
        r.category === cand.category && r.scope === cand.scope &&
        (r.polarity || '') === (cand.polarity || '') &&
        directiveSim(r.directive, cand.directive) >= DUP,
    );
  }

  if (target) {
    target.confidence += 1;
    target.support += 1;
    target.last_seen = theToday;
    if (editId && !target.provenance.includes(editId)) target.provenance.push(editId);
    let log = `reinforce [${target.id}] ${target.category} "${target.value ?? ''}" conf=${target.confidence}`;
    if (target.status === 'provisional' && target.confidence >= PROMOTE) {
      target.status = 'active';
      log += ' -> PROMOTED to active';
    }
    return log;
  }

  // 2) contradiction with an existing rule => bump contradict on loser, supersede if it loses
  const opposite = profile.rules.find(
    (r) => r.status !== 'retired' && r.status !== 'superseded' && contradicts(r, cand),
  );

  // Create the new rule (provisional, confidence 1) first so it can win/lose.
  const newRule = {
    id: nextRuleId(profile),
    category: cand.category,
    polarity: cand.polarity,
    value: cand.value,
    directive: cand.directive,
    scope: cand.scope,
    confidence: 1,
    support: 1,
    contradict: 0,
    status: 'provisional',
    first_seen: theToday,
    last_seen: theToday,
    provenance: editId ? [editId] : [],
  };
  if (cand.polarity == null) delete newRule.polarity;
  if (cand.value == null) delete newRule.value;

  if (opposite) {
    // The OLD rule is the loser candidate: it gets a contradiction.
    opposite.contradict = (opposite.contradict || 0) + 1;
    newRule.support += 1; // winner gains evidence
    profile.rules.push(newRule);
    let log = `contradiction: new [${newRule.id}] ${newRule.category} "${newRule.value ?? ''}" (${newRule.polarity}) vs [${opposite.id}] (${opposite.polarity}); contradict=${opposite.contradict}`;
    // supersede the loser when contradict >= support AND the winner is newer
    if (opposite.contradict >= opposite.support && newRule.first_seen >= opposite.last_seen) {
      opposite.status = 'superseded';
      log += ` -> [${opposite.id}] SUPERSEDED`;
    }
    return log;
  }

  profile.rules.push(newRule);
  return `new [${newRule.id}] ${newRule.category} "${newRule.value ?? ''}"${newRule.polarity ? ` (${newRule.polarity})` : ''} provisional`;
}

function nextRuleId(profile) {
  let mx = 0;
  for (const r of profile.rules) {
    const n = typeof r.id === 'number' ? r.id : parseInt(String(r.id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) mx = Math.max(mx, n);
  }
  return mx + 1;
}

// ---------- anti-bloat: per-category caps ----------
// Keep top-confidence then most-recent within active+provisional; overflow -> retired.
function enforceCaps(profile, theToday) {
  const logs = [];
  for (const [category, cap] of Object.entries(CATEGORY_CAPS)) {
    const live = profile.rules.filter(
      (r) => r.category === category && (r.status === 'active' || r.status === 'provisional'),
    );
    if (live.length <= cap) continue;
    live.sort((a, b) => (b.confidence - a.confidence) || (b.last_seen < a.last_seen ? -1 : b.last_seen > a.last_seen ? 1 : 0));
    const overflow = live.slice(cap);
    for (const r of overflow) {
      r.status = 'retired';
      r.last_seen = theToday;
      logs.push(`cap(${category}): retired [${r.id}] "${r.value ?? ''}" conf=${r.confidence}`);
    }
  }
  return logs;
}

// ---------- apply ----------
export function applyDiff(profile, diff, ctx, editId, theToday) {
  const cands = candidatesFromDiff(diff, ctx);
  const logs = [];
  for (const c of cands) {
    const line = mergeCandidate(profile, c, editId, theToday);
    if (line) logs.push(line);
  }
  logs.push(...enforceCaps(profile, theToday));
  profile.edits_seen = (profile.edits_seen || 0) + 1;
  profile.updated = theToday;
  return logs;
}

// ---------- rendering: profile.md (active + provisional, grouped by category) ----------
export function renderProfileMd(profile) {
  const live = profile.rules.filter((r) => r.status === 'active' || r.status === 'provisional');
  const byCat = new Map();
  for (const r of live) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }
  const lines = [];
  lines.push('# Style profile (generated — do not edit)');
  lines.push('');
  lines.push(`_Truth lives in profile.json. Updated ${profile.updated}; ${profile.edits_seen} edit(s) learned from._`);
  lines.push('');
  if (!live.length) {
    lines.push('_No rules yet — apply some edits to teach the loop._');
    lines.push('');
  }
  for (const cat of [...byCat.keys()].sort()) {
    const rules = byCat.get(cat).sort((a, b) => b.confidence - a.confidence);
    lines.push(`## ${cat}`);
    lines.push('');
    for (const r of rules) {
      const badge = r.status === 'active' ? '' : ' _(provisional)_';
      const scope = r.scope && r.scope !== 'global' ? ` \`${r.scope}\`` : '';
      lines.push(`- ${r.directive}${scope} — confidence ${r.confidence}${badge}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function writeProfileMd(styleDir, profile) {
  mkdirSync(styleDir, { recursive: true });
  writeFileSync(join(styleDir, 'profile.md'), renderProfileMd(profile) + '\n');
}

// ---------- changelog ----------
export function appendChangelog(styleDir, editId, theToday, logs) {
  if (!logs.length) return;
  mkdirSync(styleDir, { recursive: true });
  const p = join(styleDir, 'CHANGELOG.style.md');
  const header = existsSync(p) ? '' : '# Style learning-loop changelog\n\n';
  const body = `## ${theToday} — edit ${editId}\n` + logs.map((l) => `- ${l}`).join('\n') + '\n\n';
  appendFileSync(p, header + body);
}

// ---------- example bank (sub-command: bank) ----------
// Append kept + reworded units (the user's KEPT final text) to examples.jsonl
// and index each into idf.json.
export function bankFromDiff(styleDir, diff, ctx, editId, theToday) {
  mkdirSync(styleDir, { recursive: true });
  const examplesPath = join(styleDir, 'examples.jsonl');
  const idfPath = join(styleDir, 'idf.json');

  const idf = existsSync(idfPath)
    ? JSON.parse(readFileSync(idfPath, 'utf8'))
    : emptyIdf();
  if (!idf.df) idf.df = {};
  if (idf.N == null) idf.N = 0;

  const archetype = ctx.archetype ? String(ctx.archetype).toLowerCase() : '';
  const skills = Array.isArray(ctx.required_skills) ? ctx.required_skills
    : (Array.isArray(ctx.skills) ? ctx.skills : []);

  // Near-duplicate suppression: don't bank a bullet that's essentially identical
  // to one already stored (you reuse master-CV bullets across roles). High
  // threshold so same-TOPIC-but-distinct bullets are still kept as separate shots.
  const DUP_EX = 0.93;
  const existingTexts = existsSync(examplesPath)
    ? readFileSync(examplesPath, 'utf8').split('\n').filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l).text || ''; } catch { return ''; } })
    : [];
  const acceptedTexts = [];

  let baseId = nextExampleId(examplesPath);
  const records = [];
  let skipped = 0;
  for (const u of diff.units) {
    if (u.op !== 'kept' && u.op !== 'reworded') continue;
    const text = u.after || u.before || '';
    if (!text.trim()) continue;
    const tf = buildTf(text);
    if (!Object.keys(tf).length) continue;
    if ([...existingTexts, ...acceptedTexts].some((t) => t && unitSimilarity(t, text) >= DUP_EX)) { skipped++; continue; }
    acceptedTexts.push(text);
    const rec = {
      id: `${editId}#${baseId++}`,
      text,
      latex: u.after_latex || u.before_latex || '',
      kind: u.kind || diff.doc_kind,
      section: u.section || '',
      archetype,
      skills,
      accepted_as: u.op, // 'kept' | 'reworded'
      source_edit: editId,
      // Use the edit's OWN date so a full `--rebuild` replay preserves per-edit
      // recency (retrieval weights newer examples). theToday is only a fallback for
      // edits whose context.json has no `created`.
      created: (ctx && ctx.created) || theToday,
      tf,
    };
    records.push(rec);
    indexAdd(idf, tf); // increment df by the unique terms of this doc
  }

  for (const r of records) appendFileSync(examplesPath, JSON.stringify(r) + '\n');
  writeFileSync(idfPath, JSON.stringify(idf, null, 2) + '\n');
  return { added: records.length, skipped, idfN: idf.N };
}

function nextExampleId(examplesPath) {
  if (!existsSync(examplesPath)) return 1;
  const n = readFileSync(examplesPath, 'utf8').split('\n').filter((l) => l.trim()).length;
  return n + 1;
}

// ---------- orchestration on a real edit dir ----------
function ensureDiff(editDir) {
  const diffPath = join(editDir, 'diff.json');
  if (existsSync(diffPath)) {
    try { return JSON.parse(readFileSync(diffPath, 'utf8')); }
    catch (e) { throw new Error(`diff.json invalid JSON: ${e.message}`); }
  }
  // Auto-generate if missing (lets apply/bank run straight after a draft edit).
  return diffRunOnDir(editDir, { write: true });
}

export function cmdApply(styleDir, editDir, theToday) {
  const diff = ensureDiff(editDir);
  const ctx = readContext(editDir);
  const editId = diff.edit_id || ctx.app_id || basename(editDir);
  const profile = readProfile(styleDir, theToday);
  const logs = applyDiff(profile, diff, ctx, editId, theToday);
  writeProfile(styleDir, profile);
  writeProfileMd(styleDir, profile);
  appendChangelog(styleDir, editId, theToday, logs);
  return { editId, logs, rules: profile.rules.length, edits_seen: profile.edits_seen };
}

export function cmdBank(styleDir, editDir, theToday) {
  const diff = ensureDiff(editDir);
  const ctx = readContext(editDir);
  const editId = diff.edit_id || ctx.app_id || basename(editDir);
  return bankFromDiff(styleDir, diff, ctx, editId, theToday);
}

// ---------- rebuild ----------
// Order edit dirs chronologically: by context.created, falling back to mtime.
function editDirsChronological(styleDir) {
  const editsRoot = join(styleDir, 'edits');
  if (!existsSync(editsRoot)) return [];
  const dirs = readdirSync(editsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(editsRoot, d.name));
  const keyed = dirs.map((dir) => {
    let created = '';
    const ctxPath = join(dir, 'context.json');
    if (existsSync(ctxPath)) {
      try { created = JSON.parse(readFileSync(ctxPath, 'utf8')).created || ''; } catch { /* ignore */ }
    }
    const mtime = statSync(dir).mtimeMs;
    return { dir, created, mtime, name: basename(dir) };
  });
  keyed.sort((a, b) => {
    if (a.created && b.created && a.created !== b.created) return a.created < b.created ? -1 : 1;
    if (a.mtime !== b.mtime) return a.mtime - b.mtime;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return keyed.map((k) => k.dir);
}

export function cmdRebuild(styleDir, theToday) {
  mkdirSync(styleDir, { recursive: true });
  // Wipe DERIVED state only (never touch edits/ snapshots or the changelog history).
  const profile = emptyProfile(theToday);
  writeProfile(styleDir, profile);
  writeFileSync(join(styleDir, 'examples.jsonl'), '');
  writeFileSync(join(styleDir, 'idf.json'), JSON.stringify(emptyIdf(), null, 2) + '\n');

  const dirs = editDirsChronological(styleDir);
  const summary = { replayed: 0, edits: [] };
  for (const dir of dirs) {
    // (re)derive the diff so a stale diff.json never poisons the rebuild
    diffRunOnDir(dir, { write: true });
    const a = cmdApply(styleDir, dir, theToday);
    const b = cmdBank(styleDir, dir, theToday);
    summary.replayed++;
    summary.edits.push({ edit: a.editId, rules: a.rules, banked: b.added });
  }
  const finalProfile = readProfile(styleDir, theToday);
  summary.rules = finalProfile.rules.length;
  summary.edits_seen = finalProfile.edits_seen;
  return summary;
}

// ---------- main ----------
export function main(argv = process.argv.slice(2)) {
  const { _, flags } = parseArgs(argv);
  if (flags['self-test']) return selfTest();

  const styleDir = (flags.dir && flags.dir !== true) ? flags.dir : DEFAULT_STYLE_DIR;
  const theToday = today(flags);
  const editDir = (flags.edit && flags.edit !== true) ? flags.edit : null;
  const wantJson = !flags.summary || flags.json;

  try {
    if (flags.rebuild) {
      const out = cmdRebuild(styleDir, theToday);
      if (wantJson) console.log(JSON.stringify(out, null, 2));
      else console.log(`rebuild: replayed ${out.replayed} edit(s), ${out.rules} rules, ${out.edits_seen} edits_seen`);
      process.exit(0);
    }

    const cmd = _[0];
    if (cmd === 'apply') {
      if (!editDir) throw new Error('apply requires --edit <dir>');
      const out = cmdApply(styleDir, editDir, theToday);
      if (wantJson) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`apply: edit ${out.editId} -> ${out.rules} rules (${out.edits_seen} edits_seen)`);
        for (const l of out.logs) console.log(`  ${l}`);
      }
      process.exit(0);
    }
    if (cmd === 'bank') {
      if (!editDir) throw new Error('bank requires --edit <dir>');
      const out = cmdBank(styleDir, editDir, theToday);
      if (wantJson) console.log(JSON.stringify(out, null, 2));
      else console.log(`bank: +${out.added} example(s), idf N=${out.idfN}`);
      process.exit(0);
    }

    console.error('usage: style-profile.mjs <apply|bank> --edit <dir> [--dir <style-dir>] | --rebuild | --self-test');
    process.exit(1);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

// ---------- self-test ----------
export function selfTest() {
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const styleDir = mkdtempSync(join(tmpdir(), 'aw-style-profile-'));
  const T1 = '2026-01-01', T2 = '2026-01-02', T3 = '2026-01-03';

  // Helper to synthesize a diff.json object directly (no tex parsing needed here).
  const mkVerbDiff = (oldV, newV, editId) => ({
    edit_id: editId, doc_kind: 'cv',
    summary: { kept: 0, reworded: 1, added: 0, removed: 0, reordered: 0 },
    units: [{
      op: 'reworded', section: 'Experience', kind: 'item',
      before: `${oldV} on the billing service`, after: `${newV} the billing service, cutting latency`,
      deltas: { wc: [5, 7], verb: [stem(oldV), stem(newV)], added_quant: [], removed_tokens: [], banned_hits_before: [oldV] },
    }],
  });

  try {
    // 1) ban + prefer creation from a verb change
    {
      const profile = emptyProfile(T1);
      const diff = mkVerbDiff('worked', 'built', 'e1');
      applyDiff(profile, diff, { archetype: 'platform' }, 'e1', T1);
      const ban = profile.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'ban' && r.value === stem('worked'));
      const prefer = profile.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'prefer' && r.value === stem('built'));
      ok(ban, 'verb change created an action_verbs BAN rule');
      ok(prefer, 'verb change created an action_verbs PREFER rule');
      ok(ban.status === 'provisional' && ban.confidence === 1, 'new rule is provisional conf=1');
      const cut = profile.rules.find((r) => r.category === 'always_cut' && r.value === 'worked');
      ok(cut, 'banned_hits_before created an always_cut rule');
    }

    // 2) promotion at confidence 2 (apply the same verb change twice)
    {
      const profile = emptyProfile(T1);
      applyDiff(profile, mkVerbDiff('worked', 'built', 'e1'), {}, 'e1', T1);
      applyDiff(profile, mkVerbDiff('worked', 'built', 'e2'), {}, 'e2', T2);
      const ban = profile.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'ban' && r.value === stem('worked'));
      ok(ban.confidence >= 2, `ban confidence reached ${ban.confidence}`);
      ok(ban.status === 'active', 'ban rule PROMOTED to active at confidence 2');
      ok(ban.provenance.includes('e1') && ban.provenance.includes('e2'), 'provenance recorded both edits');
      ok(profile.edits_seen === 2, 'edits_seen incremented per apply');
    }

    // 3) supersede-on-recency: an incumbent ban(manag) is contradicted by a newer
    //    prefer(manag). Once contradict >= support AND the new rule is newer,
    //    the loser is superseded (never deleted).
    {
      const profile = emptyProfile(T1);
      // First edit: verb manag -> led, creating ban(manag)+prefer(led) (support 1).
      const preferLed = {
        edit_id: 'old', doc_kind: 'cv',
        summary: {}, units: [{
          op: 'reworded', section: 'X', kind: 'item', before: 'managed teams', after: 'led teams',
          deltas: { wc: [2, 2], verb: ['manag', 'led'], added_quant: [], removed_tokens: [], banned_hits_before: [] },
        }],
      };
      applyDiff(profile, preferLed, {}, 'eA', T1); // ban(manag) support=1, prefer(led)

      // Later edit: user reverts led -> manag, so prefer(manag) contradicts ban(manag).
      const preferManaged = {
        edit_id: 'new', doc_kind: 'cv',
        summary: {}, units: [{
          op: 'reworded', section: 'X', kind: 'item', before: 'led teams', after: 'managed teams',
          deltas: { wc: [2, 2], verb: ['led', 'manag'], added_quant: [], removed_tokens: [], banned_hits_before: [] },
        }],
      };
      applyDiff(profile, preferManaged, {}, 'eC', T3);
      const banManag = profile.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'ban' && r.value === 'manag');
      const preferManag = profile.rules.find((r) => r.category === 'action_verbs' && r.polarity === 'prefer' && r.value === 'manag');
      ok(banManag, 'original ban(manag) exists');
      ok(preferManag, 'new prefer(manag) created');
      ok(banManag.contradict >= 1, 'ban(manag) recorded a contradiction');
      ok(banManag.contradict >= banManag.support, 'contradict >= support condition met');
      ok(banManag.status === 'superseded', 'older losing rule SUPERSEDED on recency');
      ok(profile.rules.includes(banManag), 'superseded rule still present (not deleted)');
    }

    // 4) per-category cap retires overflow (always_cut cap is 10)
    {
      const profile = emptyProfile(T1);
      for (let i = 0; i < 14; i++) {
        const diff = {
          edit_id: `cut${i}`, doc_kind: 'cv', summary: {},
          units: [{
            op: 'reworded', section: 'S', kind: 'item', before: `phrase${i} text`, after: 'cleaner text',
            deltas: { wc: [3, 2], verb: ['', ''], added_quant: [], removed_tokens: [], banned_hits_before: [`filler${i}`] },
          }],
        };
        applyDiff(profile, diff, {}, `cut${i}`, T1);
      }
      const liveCut = profile.rules.filter((r) => r.category === 'always_cut' && (r.status === 'active' || r.status === 'provisional'));
      const retired = profile.rules.filter((r) => r.category === 'always_cut' && r.status === 'retired');
      ok(liveCut.length === 10, `always_cut capped to 10 live (got ${liveCut.length})`);
      ok(retired.length === 4, `overflow always_cut rules retired (got ${retired.length})`);
      ok(profile.rules.filter((r) => r.category === 'always_cut').length === 14, 'no rule was deleted — only status-flipped');
    }

    // 5) bank writes examples + idf; rebuild replays from edit dirs
    {
      const sd = mkdtempSync(join(tmpdir(), 'aw-style-rebuild-'));
      try {
        const editsRoot = join(sd, 'edits');
        const ed = join(editsRoot, '20260101__app1');
        mkdirSync(ed, { recursive: true });
        const ai = '\\begin{document}\n\\section{Experience}\n\\begin{itemize}\n\\item Worked on the billing service to cut p99 latency for customers\n\\item Designed a distributed rate limiter for forty million requests\n\\end{itemize}\n\\end{document}';
        const fin = '\\begin{document}\n\\section{Experience}\n\\begin{itemize}\n\\item Rebuilt the billing service to cut p99 latency 38\\% for customers\n\\item Designed a distributed rate limiter for forty million requests\n\\end{itemize}\n\\end{document}';
        writeFileSync(join(ed, 'ai_draft.tex'), ai);
        writeFileSync(join(ed, 'user_final.tex'), fin);
        writeFileSync(join(ed, 'context.json'), JSON.stringify({ app_id: 'app1', created: '2026-01-01T10:00:00Z', doc_kind: 'cv', archetype: 'platform', required_skills: ['latency', 'billing'] }));

        const out = cmdRebuild(sd, T1);
        ok(out.replayed === 1, 'rebuild replayed the single edit dir');
        ok(existsSync(join(sd, 'examples.jsonl')), 'rebuild produced examples.jsonl');
        const exLines = readFileSync(join(sd, 'examples.jsonl'), 'utf8').split('\n').filter(Boolean);
        ok(exLines.length >= 1, `examples banked (got ${exLines.length})`);
        const ex0 = JSON.parse(exLines[0]);
        ok(ex0.archetype === 'platform' && ex0.skills.includes('billing'), 'example tagged archetype+skills from context');
        ok(ex0.tf && Object.keys(ex0.tf).length > 0, 'example has a tf bag');
        const idf = JSON.parse(readFileSync(join(sd, 'idf.json'), 'utf8'));
        ok(idf.N >= 1 && Object.keys(idf.df).length > 0, 'idf.json populated');
        const prof = readProfile(sd, T1);
        ok(prof.rules.some((r) => r.category === 'action_verbs'), 'rebuild derived action_verbs rules from the diff');
      } finally {
        rmSync(sd, { recursive: true, force: true });
      }
    }

    // 6) profile.md renders without throwing and excludes retired/superseded
    {
      const profile = emptyProfile(T1);
      applyDiff(profile, mkVerbDiff('worked', 'built', 'e1'), {}, 'e1', T1);
      const md = renderProfileMd(profile);
      ok(md.includes('action_verbs'), 'profile.md groups by category');
      ok(/provisional/.test(md), 'profile.md marks provisional rules');
    }

    console.log(`style-profile self-test: ${checks} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error(`style-profile self-test FAILED: ${e.message}\n${e.stack}`);
    process.exit(1);
  } finally {
    try { rmSync(styleDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
