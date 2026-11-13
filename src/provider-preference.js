// The project's own HOST PREFERENCE (0.8.4 PRICES unit 3; C&C ruling 1 Nov 2026; design note Review/084/prices/Unit3_Design_2026-11-01.md). `provider-preference.json` in the project folder names, per OpenRouter model, the hosts to try
// FIRST, by their endpoint tags exactly as OpenRouter's endpoints answer writes them ("azure/us", "wafer/mxfp4", "sail-research/fp4"). It is read like pricing.user.json (src/price-table.js): once per process, FAILS CLOSED (a file that cannot be read
// in full installs nothing and the command that sends says why), and it can never lower a price or touch the price limit: it changes the ORDER OpenRouter tries hosts in, nothing the spend cap counts. The shipped package names no host.
//
// File: { "openrouter/<model id>": { "prefer": ["<endpoint tag>", ...] } }   the key order of `prefer` is the preference order. Nothing else is allowed in a row.
// Contract:
//   parsePreference(data, file)     validates a parsed file, returns Map("openrouter/<model>" -> [tag]) or throws PreferenceFileError. Pure.
//   setProviderPreference(folder)   reads <folder>/provider-preference.json once. No file: no preferences. An unreadable or invalid file throws and leaves the previous state untouched.
//   resetProviderPreference()       forget the preferences (tests; a resume whose recorded folder differs calls setProviderPreference again).
//   preferenceOf(provider, model)   -> [tag] | null    the tags to try first, in order, or null when the file names none for that seat.
//   preferenceRows(seats)           -> [{ key, prefer }] sorted by key, for the models of the given seats that have a row: what the start scope digests.
//   orderFor(seat)                  -> [tag] | null     preferenceOf with the seat's own `extra.provider.ignore` applied (a host the chain bans is never preferred; a base slug removes every endpoint under it).
// A tag is a plain slug (lower case letters, digits, . _ - and / between segments). A BASE slug such as "azure" matches every region and variant of that provider at OpenRouter ("Base Slug Matching", provider-selection docs read
// 2026-11-01): the file is meant for FULL tags, and the README says so; nothing here can tell the two apart.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PREFERENCE_FILE = 'provider-preference.json';
const MAX_FILE_BYTES = 200_000;
const MAX_ROWS = 200;
const MAX_TAGS = 200;
const TAG = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

export class PreferenceFileError extends Error {
  constructor(file, row, why) {
    super(`${PREFERENCE_FILE}: ${row ? `${row}: ` : ''}${why}. A preference file that cannot be read in full is not used at all, so nothing was started.`);
    this.name = 'PreferenceFileError'; this.file = file; this.row = row; this.why = why;
  }
}

let rows = new Map();

export function parsePreference(data, file = PREFERENCE_FILE) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PreferenceFileError(file, null, 'the file must be one JSON object of "openrouter/<model>" rows');
  const entries = Object.entries(data);
  if (entries.length > MAX_ROWS) throw new PreferenceFileError(file, null, `it has more than ${MAX_ROWS} rows`);
  const out = new Map();
  for (const [key, row] of entries) {
    if (!key.startsWith('openrouter/') || key.length === 'openrouter/'.length) throw new PreferenceFileError(file, key, 'the key must be "openrouter/<model id>" (only OpenRouter routes by host)');
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new PreferenceFileError(file, key, 'the row must be { "prefer": ["<endpoint tag>", ...] }');
    for (const k of Object.keys(row)) if (k !== 'prefer') throw new PreferenceFileError(file, key, `unknown field "${k}" (a row holds only "prefer")`);
    if (!Array.isArray(row.prefer) || !row.prefer.length || row.prefer.length > MAX_TAGS) throw new PreferenceFileError(file, key, `"prefer" must be a list of 1 to ${MAX_TAGS} endpoint tags`);
    for (const t of row.prefer) if (typeof t !== 'string' || t.length > 80 || !TAG.test(t)) throw new PreferenceFileError(file, key, `"${typeof t === 'string' ? t.slice(0, 40) : String(t)}" is not an endpoint tag (like azure/us or wafer/mxfp4)`);
    if (new Set(row.prefer).size !== row.prefer.length) throw new PreferenceFileError(file, key, '"prefer" names a tag twice');
    out.set(key, [...row.prefer]);
  }
  return out;
}

export function setProviderPreference(folder) {
  const file = join(folder, PREFERENCE_FILE);
  let text;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new PreferenceFileError(file, null, 'it is not a plain file');
    if (st.size > MAX_FILE_BYTES) throw new PreferenceFileError(file, null, `it is larger than ${MAX_FILE_BYTES} bytes`);
    text = readFileSync(file, 'utf8');   // fs-ok: the project's own preference file, read once per process
  } catch (e) {
    if (e instanceof PreferenceFileError) throw e;
    if (e.code === 'ENOENT') { rows = new Map(); return { file: null, rows: 0 }; }
    throw new PreferenceFileError(file, null, `it cannot be read (${e.code ?? e.message})`);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new PreferenceFileError(file, null, 'it is not valid JSON'); }
  const parsed = parsePreference(data, file);
  rows = parsed;
  return { file, rows: parsed.size };
}
export function resetProviderPreference() { rows = new Map(); }

export const preferenceOf = (provider, model) => (provider === 'openrouter' ? rows.get(`${provider}/${model}`) ?? null : null);

export function preferenceRows(seats) {
  const keys = new Set();
  for (const s of seats || []) if (s && s.provider === 'openrouter' && typeof s.model === 'string' && rows.has(`openrouter/${s.model}`)) keys.add(`openrouter/${s.model}`);
  return [...keys].sort().map(key => ({ key, prefer: [...rows.get(key)] }));
}

export function orderFor(seat) {
  const prefer = preferenceOf(seat?.provider, seat?.model);
  if (!prefer) return null;
  const ignore = Array.isArray(seat?.extra?.provider?.ignore) ? seat.extra.provider.ignore.filter(x => typeof x === 'string') : [];
  const kept = prefer.filter(t => !ignore.some(g => t === g || t.startsWith(`${g}/`)));
  return kept.length ? kept : null;
}
