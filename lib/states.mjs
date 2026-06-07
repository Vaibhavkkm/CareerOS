// lib/states.mjs — canonical application-status machine.
// Loads templates/states.yml ONCE and is the single source for status logic.
// Consumed by tracker / merge / verify / analyze — no duplicated alias maps.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATES_PATH = join(__dirname, '..', 'templates', 'states.yml');

const doc = yaml.load(readFileSync(STATES_PATH, 'utf8'));
export const STATES = doc.states;

// id -> state object
export const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]));
// alias/label/id (lowercased) -> id
const ALIAS_TO_ID = new Map();
for (const s of STATES) {
  ALIAS_TO_ID.set(s.id.toLowerCase(), s.id);
  ALIAS_TO_ID.set(s.label.toLowerCase(), s.id);
  for (const a of s.aliases || []) ALIAS_TO_ID.set(String(a).toLowerCase(), s.id);
}

export const STATUS_RANK = Object.fromEntries(STATES.map((s) => [s.id, s.rank]));

const slug = (x) => String(x || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

// Map any free-form status string to a canonical id (or null if unknown).
export function normalizeStatus(input) {
  if (!input) return null;
  const direct = ALIAS_TO_ID.get(String(input).trim().toLowerCase());
  if (direct) return direct;
  return ALIAS_TO_ID.get(slug(input)) || null;
}

export function isValidStatus(input) {
  return normalizeStatus(input) != null;
}

export function labelFor(id) {
  return STATE_BY_ID.get(id)?.label || id;
}

export function rankFor(input) {
  const id = normalizeStatus(input);
  return id ? STATUS_RANK[id] : -1;
}

export function isTerminal(input) {
  const id = normalizeStatus(input);
  return id ? !!STATE_BY_ID.get(id).terminal : false;
}

export function groupFor(input) {
  const id = normalizeStatus(input);
  return id ? STATE_BY_ID.get(id).group : 'unknown';
}

// Canonical id list ordered by rank descending (further-along first).
export const STATUSES_BY_RANK = [...STATES].sort((a, b) => b.rank - a.rank).map((s) => s.id);
