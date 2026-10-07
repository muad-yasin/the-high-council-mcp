// The $0 lint of a contract draft (0.8.2 item 6d, plan M8; persistence register P16).
//
// A draft is what a model wrote: JSON of the shape { "obligations": [ { "id", "text", "criterion"?, "check"? } ] }. It is INPUT. Nothing about the record's identity comes from it: the contract's id,
// version, hashes, timestamps, the run it belongs to and its approval are written by the harness (src/contract-record.js) and by nothing else. So the lint refuses, before anything is written:
//   - a draft that is not an object of exactly that shape (unknown keys are refused, never dropped: a draft that says more than the lint understands is not accepted as if it said less);
//   - ANY key, at any depth, named like an identity field (version, schema, sha256, hash, digest, supersedes, run, gate, approval, signature, a timestamp, a contract or record id, ...), in any case or
//     spelling (camelCase, snake_case, kebab-case, with a prefix such as contract_ or obligation_). The one exemption is the `id` of an obligation, which must be there: obligation ids are the
//     names an amendment request points at;
//   - an empty list, more than MAX_OBLIGATIONS obligations, a duplicate id (also when only the case differs), an id that is not a short plain name;
//   - a `check` that is not one line (a line break in it could fake a heading of the rendered contract);
//   - a text that is empty, over MAX_TEXT_CHARS, or holds hidden characters (tag characters, bidi controls, zero-width characters): the person approves what they can read;
//   - a `criterion` that is not C<n>, or (when the run's criteria are known) names a criterion the run does not have.
// Pure, no file, no model. Returns { ok, problems[], obligations[] }: obligations are normalized copies holding only id, text, criterion and check.
import { hiddenCharacterReport } from './return-path.js';

export const MAX_OBLIGATIONS = 40; // a handoff of 40 acceptance items is already past what one builder session holds in view; the lint refuses more rather than letting a draft grow unread
export const MAX_TEXT_CHARS = 2000; // about 300 words: one obligation is one thing to build or keep true, not a section
export const MAX_CHECK_CHARS = 500; // one command line or one sentence naming how the obligation is checked
export const MAX_ID_CHARS = 32;
export const OBLIGATION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;
const CRITERION = /^C[1-9][0-9]{0,3}$/;
const OBLIGATION_KEYS = ['id', 'text', 'criterion', 'check'];

// A key is identity-named when, with case, underscores, hyphens and spaces removed, it is one of the words below (alone or behind contract/record/draft/obligation/amendment), or it contains
// sha256/hash/digest. "run" and "gate" are in the list because they name the run and the approval the record belongs to. Tested on both sides in test/contract-record.test.js.
const IDENTITY_WORDS = ['id', 'version', 'schema', 'sha', 'sha256', 'sha1', 'hash', 'digest', 'supersedes', 'run', 'runid', 'gate', 'gateid', 'approval', 'approved', 'approvedby', 'signature', 'signed', 'signedby',
  'timestamp', 'ts', 'time', 'date', 'createdat', 'lockedat', 'signedat', 'approvedat', 'created', 'locked', 'at'];
const IDENTITY_PREFIX = /^(contract|record|draft|obligation|amendment|lock|source)/;
export function identityNamed(key) {
  const k = String(key).toLowerCase().replace(/[\s_-]+/g, '');
  if (/(sha256|hash|digest)/.test(k)) return true;
  if (IDENTITY_WORDS.includes(k)) return true;
  const stripped = k.replace(IDENTITY_PREFIX, '');
  return stripped !== k && IDENTITY_WORDS.includes(stripped);
}

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Every key at every depth. The objects directly inside the top-level `obligations` list are the obligations: their `id` is allowed.
function walk(value, path, exemptId, found) {
  if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, path === 'obligations', found)); return; }
  if (!plain(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const here = path ? `${path}.${k}` : k;
    if (!(exemptId && k === 'id') && identityNamed(k)) found.push(here);
    walk(v, here, false, found);
  }
}

const hidden = text => { const h = hiddenCharacterReport(text); return h.tag_characters + h.bidi_controls + (h.invisible_characters || 0); };

/** Lints a parsed draft. `criteriaIds` (an array of 'C1'...) is optional: when given, a `criterion` must be one of them. */
export function lintContractDraft(draft, { criteriaIds = null } = {}) {
  const problems = [];
  if (!plain(draft)) return { ok: false, problems: ['the draft must be a JSON object: { "obligations": [ ... ] }'], obligations: [] };
  // Identity-named keys first: said once, naming where, whatever else is wrong.
  const unique = [];
  walk(draft, '', false, unique);
  for (const where of unique) problems.push(`${where}: a field named like an identity field (id, version, hash, run, gate, approval, a timestamp ...) is written by the harness, never by a draft`);
  for (const k of Object.keys(draft)) if (k !== 'obligations' && !unique.includes(k)) problems.push(`${k}: not a field of a draft (only "obligations")`);
  const list = draft.obligations;
  if (!Array.isArray(list) || !list.length) { problems.push('obligations must be a non-empty list'); return { ok: false, problems, obligations: [] }; }
  if (list.length > MAX_OBLIGATIONS) problems.push(`obligations: ${list.length} given, at most ${MAX_OBLIGATIONS}`);
  const seen = new Map();
  const obligations = [];
  list.forEach((o, i) => {
    const at = `obligations[${i}]`;
    if (!plain(o)) { problems.push(`${at}: must be an object`); return; }
    for (const k of Object.keys(o)) if (!OBLIGATION_KEYS.includes(k) && !unique.includes(`${at}.${k}`)) problems.push(`${at}.${k}: not a field of an obligation (id, text, criterion, check)`);
    const { id, text, criterion, check } = o;
    if (typeof id !== 'string' || !OBLIGATION_ID.test(id)) problems.push(`${at}.id: must be a short plain name (a letter, then letters, digits, "_", "." or "-"; at most ${MAX_ID_CHARS} characters)`);
    else {
      const key = id.toLowerCase();
      if (seen.has(key)) problems.push(`${at}.id: "${id}" repeats ${seen.get(key) === id ? 'an earlier id' : `"${seen.get(key)}" (ids are compared without regard to case)`}`);
      else seen.set(key, id);
    }
    if (typeof text !== 'string' || !text.trim()) problems.push(`${at}.text: must be a non-empty string`);
    else {
      if (text.length > MAX_TEXT_CHARS) problems.push(`${at}.text: ${text.length} characters, at most ${MAX_TEXT_CHARS}`);
      if (hidden(text)) problems.push(`${at}.text: holds hidden characters (tag, bidi or zero-width): the person approves what they can read`);
      if (!text.isWellFormed()) problems.push(`${at}.text: holds a lone surrogate (not well-formed UTF-16): it would be saved as a replacement character and the contract would never check (never normalised silently)`); // audit fix cnc-contract F2
    }
    if (criterion !== undefined && criterion !== null) {
      if (typeof criterion !== 'string' || !CRITERION.test(criterion)) problems.push(`${at}.criterion: must look like C1`);
      else if (Array.isArray(criteriaIds) && !criteriaIds.includes(criterion)) problems.push(`${at}.criterion: the run has no criterion ${criterion}`);
    }
    if (check !== undefined && check !== null) {
      if (typeof check !== 'string' || !check.trim()) problems.push(`${at}.check: must be a non-empty string when given`);
      else {
        if (check.length > MAX_CHECK_CHARS) problems.push(`${at}.check: ${check.length} characters, at most ${MAX_CHECK_CHARS}`);
        if (/[\r\n]/.test(check)) problems.push(`${at}.check: must be one line (a command or a sentence): a line break could start a heading of the contract text a person approves`);
        if (hidden(check)) problems.push(`${at}.check: holds hidden characters`);
        if (!check.isWellFormed()) problems.push(`${at}.check: holds a lone surrogate (not well-formed UTF-16)`); // audit fix cnc-contract F2
      }
    }
    if (typeof id === 'string' && typeof text === 'string') {
      obligations.push({ id, text, ...(typeof criterion === 'string' ? { criterion } : {}), ...(typeof check === 'string' ? { check } : {}) });
    }
  });
  return { ok: problems.length === 0, problems, obligations: problems.length ? [] : obligations };
}
