// The ONE price source (0.8.3 user price row P1; user price row gate page, 14 Oct 2026). src/cost.js and src/budget.js each used to read src/pricing.json at import; both now read it through here, and a project's
// own rows (`pricing.user.json`) are merged in by ONE call, setUserPrices(folder). Muad (14 Oct 2026, Q0): "a user can add their own price row in their project"; C&C: marked as theirs, NEVER lowering a shipped price.
//
// Contract:
//   SHIPPED_PRICES                      the parsed src/pricing.json, frozen (what cost.js's `table = PRICES` readers keep using: the "as of" line, the expiry checks, the unusable-row report stay about the SHIPPED table)
//   effectiveRow(provider, model)       -> the merged row { ...shippedRow, in, out } | { in, out, note? } | null; null when neither the shipped table nor a user row gives a USABLE price (two finite numbers; a user row's are > 0)
//   effectiveRowByKey("provider/model") the same, by the table's own key
//   priceSource(provider, model)        -> { in: 'shipped'|'user', out: 'shipped'|'user' } | null   per FIELD: with the per-field MAX rule `in` can come from the file while `out` stays the shipped figure
//   isUserPriced(provider, model)       true when ANY field of the effective price rests on the user file
//   userRowOf(provider, model)          the raw row the file holds for that key, or null (the digest of a run reads this, so a row the merge ignores is still a changed screen)
//   ignoredUserFields(provider, model)  -> ['in' | 'out'] fields where the file's figure is BELOW the shipped one and was not used
//   setUserPrices(folder)               reads <folder>/pricing.user.json once (no file = no user rows); a file that cannot be read IN FULL throws UserPriceFileError and installs NOTHING (fail closed)
//   resetUserPrices()                   forget the user rows (tests restore with it; a resume whose recorded folder differs calls setUserPrices again)
//   userPriceLines()                    the doctor / dry-run lines about user rows ("provider/model: your price row ...") or []
//   UserPriceFileError                  .message is the sentence a person reads (HELD as an E item), .file, .row, .why
// MERGE RULE (per field, both `in` and `out`): when the shipped table has a usable row for the key, the effective figure is the HIGHER of the two; a user figure below the shipped one is ignored and named by ignoredUserFields. A model the shipped
// table does not have (or whose shipped row is unusable) is priced by the user row as given. Nothing here lowers a price the package ships.
// A USER ROW is { in, out, note? }: `in` and `out` finite numbers ABOVE 0 (free is a provider, not a row), `note` an optional short string, nothing else; the key is "provider/model" with a KNOWN, non-free provider.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isFreeProvider, providerNames } from './providers.js';

const here = dirname(fileURLToPath(import.meta.url));
export const SHIPPED_PRICES = Object.freeze(JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8')));
export const USER_PRICE_FILE = 'pricing.user.json';
const MAX_FILE_BYTES = 200_000;
const MAX_ROWS = 500;
export const NOTE_MAX = 200;

const usable = row => !!row && typeof row === 'object' && Number.isFinite(row.in) && row.in >= 0 && Number.isFinite(row.out) && row.out >= 0;
const above0 = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

export class UserPriceFileError extends Error {
  constructor(file, row, why) {
    super(`${USER_PRICE_FILE}: ${row ? `${row}: ` : ''}${why}. A price file that cannot be read in full is not used at all, so nothing was started.`);
    this.name = 'UserPriceFileError'; this.file = file; this.row = row; this.why = why;
  }
}

let userRows = new Map();   // "provider/model" -> { in, out, note? }, validated
let userFile = null;

/** Validates a parsed file; returns the Map or throws UserPriceFileError. Pure (no file access). */
export function parseUserPrices(data, file = USER_PRICE_FILE) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UserPriceFileError(file, null, 'the file must be one JSON object of "provider/model" rows');
  const entries = Object.entries(data);
  if (entries.length > MAX_ROWS) throw new UserPriceFileError(file, null, `more than ${MAX_ROWS} rows`);
  const known = new Set(providerNames());
  const out = new Map();
  for (const [key, row] of entries) {
    const slash = key.indexOf('/');
    if (slash < 1 || slash === key.length - 1) throw new UserPriceFileError(file, key, 'the key must be "provider/model"');
    const provider = key.slice(0, slash);
    if (!known.has(provider)) throw new UserPriceFileError(file, key, `"${provider}" is not a provider THC knows`);
    if (isFreeProvider(provider)) throw new UserPriceFileError(file, key, `"${provider}" is a free local provider: it is always priced at zero and takes no row`);
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new UserPriceFileError(file, key, 'the row must be { "in": number, "out": number }');
    for (const k of Object.keys(row)) if (!['in', 'out', 'note'].includes(k)) throw new UserPriceFileError(file, key, `unknown field "${k}" (a row holds in, out and an optional note)`);
    if (!above0(row.in) || !above0(row.out)) throw new UserPriceFileError(file, key, '"in" and "out" must both be numbers above 0 (USD per million tokens)');
    if (row.note !== undefined && !(typeof row.note === 'string' && row.note.length <= NOTE_MAX)) throw new UserPriceFileError(file, key, `"note" must be a string of at most ${NOTE_MAX} characters`);
    out.set(key, { in: row.in, out: row.out, ...(row.note !== undefined ? { note: row.note } : {}) });
  }
  return out;
}

/** Reads <folder>/pricing.user.json once. No file: no user rows. A file that is not a plain readable JSON file within the size bound, or that fails parseUserPrices, throws and leaves the previous state untouched. */
export function setUserPrices(folder) {
  const file = join(folder, USER_PRICE_FILE);
  let text;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new UserPriceFileError(file, null, 'it is not a plain file');
    if (st.size > MAX_FILE_BYTES) throw new UserPriceFileError(file, null, `larger than ${MAX_FILE_BYTES} bytes`);
    text = readFileSync(file, 'utf8');   // fs-ok: the project's own price file, read once per process
  } catch (e) {
    if (e instanceof UserPriceFileError) throw e;
    if (e.code === 'ENOENT') { userRows = new Map(); userFile = null; return { file: null, rows: 0 }; }
    throw new UserPriceFileError(file, null, `it cannot be read (${e.code ?? e.message})`);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new UserPriceFileError(file, null, 'it is not valid JSON'); }
  const parsed = parseUserPrices(data, file);
  userRows = parsed; userFile = file;
  return { file, rows: parsed.size };
}
export function resetUserPrices() { userRows = new Map(); userFile = null; }
export const userPriceFile = () => userFile;

const shippedUsable = key => (usable(SHIPPED_PRICES[key]) && key.includes('/') ? SHIPPED_PRICES[key] : null);

export function effectiveRowByKey(key) {
  const s = shippedUsable(key);
  const u = userRows.get(key) ?? null;
  if (!s && !u) return null;
  if (!u) return s;
  if (!s) return { in: u.in, out: u.out, ...(u.note !== undefined ? { note: u.note } : {}) };
  return { ...s, in: Math.max(s.in, u.in), out: Math.max(s.out, u.out) };
}
export const effectiveRow = (provider, model) => effectiveRowByKey(`${provider}/${model}`);

export function priceSource(provider, model) {
  const key = `${provider}/${model}`; const s = shippedUsable(key); const u = userRows.get(key) ?? null;
  if (!s && !u) return null;
  if (!u) return { in: 'shipped', out: 'shipped' };
  if (!s) return { in: 'user', out: 'user' };
  return { in: u.in > s.in ? 'user' : 'shipped', out: u.out > s.out ? 'user' : 'shipped' };
}
export function isUserPriced(provider, model) { const p = priceSource(provider, model); return !!p && (p.in === 'user' || p.out === 'user'); }
export const userRowOf = (provider, model) => userRows.get(`${provider}/${model}`) ?? null;
export function ignoredUserFields(provider, model) {
  const key = `${provider}/${model}`; const s = shippedUsable(key); const u = userRows.get(key) ?? null;
  if (!s || !u) return [];
  return ['in', 'out'].filter(f => u[f] < s[f]);
}

export function userPriceLines() {
  const lines = [];
  for (const [key, u] of userRows) {
    const slash = key.indexOf('/'); const provider = key.slice(0, slash); const model = key.slice(slash + 1);
    const ignored = ignoredUserFields(provider, model);
    const e = effectiveRowByKey(key);
    lines.push(`${key}: from ${USER_PRICE_FILE} in your project folder: in ${u.in} / out ${u.out} per million tokens${ignored.length ? `; below the shipped price for ${ignored.join(' and ')}, so the shipped figure is used (in ${e.in} / out ${e.out})` : ''}.`);
  }
  return lines;
}

/**
 * PRICE ANSWER (0.8.3 M7 session channel; Muad 19 Okt 2026: the controller session finds the price of a price-refused model): adds or RAISES one row of <folder>/pricing.user.json, never lowers one. -> { before, after } | throws UserPriceFileError.
 * `before` is the effective row ({ in, out }) or null; `after` the row the file now gives. The file is read in full first (fail closed), the new file is validated by parseUserPrices and written atomically (temp file, rename).
 */
export function raiseUserPriceRow(folder, key, row) {
  const file = join(folder, USER_PRICE_FILE);
  let data = {};
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new UserPriceFileError(file, null, 'it cannot be read or is not valid JSON'); }   // fs-ok: the project's own price file
  const prev = effectiveRowByKey(key);       // the merged row as the process reads it now (setUserPrices ran at start)
  const own = data && typeof data === 'object' ? data[key] : undefined;
  const floor = { in: Math.max(prev?.in ?? 0, own?.in ?? 0), out: Math.max(prev?.out ?? 0, own?.out ?? 0) };
  if (!(row.in >= floor.in && row.out >= floor.out)) throw new UserPriceFileError(file, key, `a price is added or raised, never lowered: ${key} is priced in ${floor.in} / out ${floor.out} now`);
  const next = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), [key]: { in: row.in, out: row.out, ...(row.note !== undefined ? { note: row.note } : {}) } };
  parseUserPrices(next, file);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);   // fs-ok: the project's own price file
  renameSync(tmp, file);   // fs-ok: the project's own price file
  userRows = parseUserPrices(next, file); userFile = file;
  return { before: prev ? { in: prev.in, out: prev.out } : null, after: { in: row.in, out: row.out } };
}
