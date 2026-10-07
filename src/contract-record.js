// The contract record (0.8.2 item 6d = Slice A of the 0.8.1 plan, M8 and DR-12; persistence register P16; owner 7 Oct 2026: "we go with the full one").
//
// What it is. After a run finished, a person can lock a CONTRACT: a short list of obligations (an id and the words) that a builder session works against. A model drafts the list
// (`council contract draft`, src/contract-cli.js; the draft is only input, src/contract-lint.js), a person approves the exact text through the approval gate (src/gate.js), and the harness
// writes the record. Later, a builder who thinks an obligation is wrong or impossible does not edit it: it files an amendment REQUEST (`contract_amend`, which decides nothing), and a person
// decides it at a terminal (`council contract amend --decide`), which writes a NEW version. This module is the only writer of the record and of the contract's ledger events.
//
// Contract.
//   Owned state, all inside the run folder:
//     contract/v<n>.json     the record of version n (schema contract/1). Written atomically (temp, sync, link), never edited, never replaced: an amendment is v<n+1> naming v<n>.
//     contract/CONTRACT.md   the builder-facing view of the CURRENT version (rewritten atomically when a version is added; `contract check` compares it with a fresh rendering).
//     contract/proposal-<sha12>.md and contract/amend-r<seq>.md   the exact texts a person approved (the gate's text files; named by hash / by request, never rewritten with other bytes).
//     the run's ledger file   three events: contract_locked (version 1), amend_requested (a request), amend_decided (approved: a new version; declined: a recorded refusal).
//   The LEDGER is the authority, the files are what it points at. The current version is the last `contract_locked`/approved `amend_decided` line; a vN.json with no such line is an ORPHAN (a crash between
//   the file and the line) and has no authority: `check` fails on it. Order of writing, under the ledger lock (src/gate.js recordUse): gate checks, then the record file (temp, sync, link: atomic and exclusive),
//   then the ledger line, then (after it) CONTRACT.md: the view never leads the ledger.
//   What is derived, never stored: the current version, each obligation's state (in force, or an amendment requested for it) and each request's status (open, approved, declined, stale, invalid).
//   Identity fields (schema, version, supersedes, run, locked_at, source hashes, obligation hashes, approval, the record hash) are written HERE and nowhere else; a draft's words only fill id, text, criterion, check.
//
// Tamper-evident, not tamper-proof (the same posture as the criteria lock and the gate ledger, decided rule 9): anything that can write the run folder can rewrite the whole record and the whole ledger.
// `check` catches an edit of one without the other and any edit before the last ledger line; it does not claim more.
//   Functions: renderContractText, renderAmendmentText, renderContractMd, buildRecord, textOfRecord, contractState, loadVersion, loadCurrent, prepareLock, prepareAmendment, ensureGate,
//              commitLock, commitAmendment, declineAmendment, requestAmendment, checkContract, showContract, amendedLine.
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, basename } from 'node:path';
import { sha256Of, canonicalJson, recordHash } from './thin-contract.js';
import { requestGate, readGateAnswer, listGates, recordUse, recordDeclined, readLedger, appendEvent, textSha256 } from './gate.js';
import { readRunFile, readRunJson } from './run-files.js';
import { lintContractDraft, MAX_TEXT_CHARS, OBLIGATION_ID } from './contract-lint.js';
import { hiddenCharacterReport } from './return-path.js';

export const CONTRACT_SCHEMA = 'contract/1';
export const CONTRACT_DIR = 'contract';
export const GATE_KIND_LOCK = 'contract_lock';
export const GATE_KIND_AMEND = 'contract_amend';
// A contract gate records an approval; nothing is sent and nothing is spent. An hour (the advice gate lives ten minutes, the life of its quote) lets a person read the whole text and answer in
// another terminal; the approval is used once, by the lock or the decision that follows it.
export const CONTRACT_GATE_TTL_MS = 60 * 60_000;
export const REASON_MAX_CHARS = 500; // a reason is a few sentences; the person reads it beside the exact current and proposed words
// Open requests are read by a person one by one; past twenty a requester is flooding rather than asking, and `contract_amend` says so instead of storing more.
export const MAX_OPEN_REQUESTS = 20;

const refuse = (code, message) => ({ ok: false, code, message });
const hiddenCount = t => { const h = hiddenCharacterReport(t); return h.tag_characters + h.bidi_controls + (h.invisible_characters || 0); };
const indent = t => String(t).replace(/\r\n?/g, '\n').split('\n').map(l => `    ${l}`).join('\n');
const HEX64 = /^[0-9a-f]{64}$/;

// ---- the texts a person reads -------------------------------------------------------------------------------------------------------------------------------------------------------------

const hashLine = (label, h) => `${label}: ${typeof h === 'string' && HEX64.test(h) ? h : 'not recorded'}`;

/**
 * The text of a contract version, written by the harness from the record's content (the same words, in the same order, every time: its sha256 is what a person approves for version 1 and what
 * `check` recomputes). Obligation text is indented four spaces so that a line of a model's words can never look like one of this file's own headings.
 */
export function renderContractText({ run, version, supersedes = null, source, obligations, amendment = null }) {
  const L = [];
  L.push(`# Contract v${version} - run ${run}${amendment ? ` (amended after lock, v${version} from v${supersedes})` : ''}`);
  L.push('', 'Written by the harness from a draft. The obligations are words a model drafted; they are the contract only because a person approved this exact text.', '');
  L.push(`Run: ${run}`, hashLine('Task sha256', source?.task_sha256), hashLine('Criteria sha256', source?.criteria_sha256), hashLine('Signed text sha256', source?.signed_text_sha256), hashLine('Thin contract record sha256', source?.thin_contract_sha256));
  if (amendment) {
    L.push('', `## Amendment`, '', `Version ${version} replaces version ${supersedes}. A person approved an amendment request (ledger line ${amendment.request_seq}): obligation ${amendment.obligation_id} changed; every other obligation is the same as in version ${supersedes}.`, 'The requester\'s reason, in its own words:', indent(amendment.reason));
  }
  L.push('', '## Obligations');
  for (const o of obligations) {
    L.push('', `### ${o.id}`, indent(o.text));
    if (o.criterion) L.push('', `Criterion: ${o.criterion}`);
    if (o.check) L.push(`Check: ${o.check}`);
  }
  L.push('', '## For the builder', '',
    'If an obligation looks wrong or impossible, stop. Ask for an amendment (the contract_amend tool, naming the version and the obligation id, with your reason and the words you propose) and do not edit tests or this contract to make an obligation pass.',
    'Only a person decides an amendment, at a terminal (council contract amend --decide). Until then the obligation stands as written.');
  return `${L.join('\n')}\n`;
}

/**
 * The text a person reads before deciding an amendment: the EXACT current words and the EXACT proposed words of the obligation (never only a hash), the requester's reason, and the version
 * the approval would write. `request` is { seq, version, obligation_id, reason, proposed_text }; `prior` is the record the request names.
 */
export function renderAmendmentText({ run, request, prior }) {
  const o = prior.obligations.find(x => x.id === request.obligation_id);
  const L = [];
  L.push(`# Amendment request ${request.seq} to contract v${prior.version} - run ${run}`, '',
    `A request (ledger line ${request.seq}) asks to change obligation ${request.obligation_id} of contract version ${prior.version}. The request is the words of whoever filed it (an agent or a person); it decided nothing.`,
    `If you approve, the contract becomes version ${prior.version + 1}, which replaces the text of ${request.obligation_id} and keeps every other obligation as it is. If you decline, the contract stays as it is and your refusal is recorded.`,
    '', `## Obligation ${request.obligation_id}, current text (version ${prior.version})`, indent(o ? o.text : '(this version has no such obligation)'),
    '', `## Obligation ${request.obligation_id}, proposed text`, indent(request.proposed_text),
    '', '## Reason given', indent(request.reason));
  return `${L.join('\n')}\n`;
}

/** The record's own text, as the lock approves it (version 1) and as CONTRACT.md opens. */
export const textOfRecord = r => renderContractText({ run: r.run, version: r.version, supersedes: r.supersedes, source: r.source, obligations: r.obligations, amendment: r.amendment });

/** CONTRACT.md: the version's text, then one harness line that names the record, so a builder holds the hash. */
export function renderContractMd(record) {
  return `${textOfRecord(record)}\n---\nContract record: ${CONTRACT_DIR}/v${record.version}.json, sha256 ${record.sha256}${record.supersedes ? ` (amended after lock, v${record.version} from v${record.supersedes})` : ''}.\n`;
}

/** "amended after lock (v2, from v1)" for a version above 1, else null. One wording, used by show, check and CONTRACT.md. */
export const amendedLine = record => (record && record.version > 1 ? `amended after lock (v${record.version}, from v${record.supersedes})` : null);

// ---- the record --------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const withHash = o => {
  const base = { id: o.id, text: o.text, ...(o.criterion ? { criterion: o.criterion } : {}), ...(o.check ? { check: o.check } : {}) };
  return { ...base, sha256: sha256Of(canonicalJson({ id: o.id, text: o.text, criterion: o.criterion ?? null, check: o.check ?? null })) };
};

/** A complete record with its own hash. Every field is the harness's: `obligations` came through the lint, `source` from the run's report.json, `approval` from the gate. */
export function buildRecord({ run, version, supersedes = null, lockedAt, source, obligations, amendment = null, approval }) {
  const rec = { schema: CONTRACT_SCHEMA, version, supersedes, run, locked_at: lockedAt, source, obligations: obligations.map(withHash), amendment, approval };
  return { ...rec, sha256: recordHash(rec) };
}

/** What the run's report.json says the contract is made from (full-width hashes or null). A run with no thin contract (a stopped run, a 0.8.1 run) has nulls and the lock says "not recorded". */
export function sourceOf(runDir) {
  const t = readRunJson(runDir, 'report.json')?.thin_contract;
  const h = v => (typeof v === 'string' && HEX64.test(v) ? v : null);
  return { task_sha256: h(t?.task_sha256), criteria_sha256: h(t?.criteria_sha256), signed_text_sha256: h(t?.signed_text_sha256), thin_contract_sha256: h(t?.sha256) };
}

// ---- reading -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function requestOf(line) {
  const ok = Number.isInteger(line.version) && line.version >= 1 && typeof line.obligation_id === 'string' && OBLIGATION_ID.test(line.obligation_id)
    && typeof line.reason === 'string' && line.reason.trim() && line.reason.length <= REASON_MAX_CHARS
    && typeof line.proposed_text === 'string' && line.proposed_text.trim() && line.proposed_text.length <= MAX_TEXT_CHARS;
  return ok ? { seq: line.seq, version: line.version, obligation_id: line.obligation_id, reason: line.reason, proposed_text: line.proposed_text, ts: line.ts }
    : { seq: line.seq, invalid: true };
}

/** The contract's state from a verified ledger's lines: pure. Problems are inconsistencies in the ledger's own contract lines (a sequence that is not 1, 2, 3 ...). */
export function stateFromLines(lines) {
  const versions = [];
  const decisions = new Map();
  const requests = [];
  const problems = [];
  for (const l of lines) {
    if (l.event === 'contract_locked' || (l.event === 'amend_decided' && l.decision === 'approved')) {
      const want = versions.length + 1;
      if (l.version !== want) problems.push(`ledger line ${l.seq}: version ${JSON.stringify(l.version)}, expected ${want}`);
      if (want === 1 && l.event !== 'contract_locked') problems.push(`ledger line ${l.seq}: the first version must be a lock`);
      if (want > 1 && l.event !== 'amend_decided') problems.push(`ledger line ${l.seq}: version ${want} must come from an approved amendment`);
      versions.push({ version: l.version, seq: l.seq, event: l.event, record_sha256: l.record_sha256, gate: l.gate, sha256: l.sha256, supersedes: l.supersedes ?? null, request_seq: l.request_seq ?? null });
    }
    if (l.event === 'amend_decided') decisions.set(l.request_seq, { decision: l.decision, seq: l.seq, gate: l.gate ?? null, version: l.version ?? null });
    if (l.event === 'amend_requested') requests.push(requestOf(l));
  }
  const current = versions.length ? versions.length : null;
  const shown = requests.map(r => {
    const d = decisions.get(r.seq);
    const status = d ? d.decision : r.invalid ? 'invalid' : r.version < (current ?? 0) ? 'stale' : 'open';
    return { ...r, status, decided_at_seq: d?.seq ?? null };
  });
  return { versions, current, requests: shown, problems };
}

/** { ok, versions, current, requests, problems } for a run folder, or { ok: false, problem } when its ledger does not verify (nothing can be trusted then). */
export function contractState(runDir) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { ok: false, problem: `the gate ledger is broken at line ${ledger.failedAt}: ${ledger.reason}` };
  return { ok: true, ...stateFromLines(ledger.lines), lines: ledger.lines };
}

/** The record of version n as the file holds it: { record } | { missing: true } | { problem }. Reads never follow a link (src/run-files.js). */
export function loadVersion(runDir, n) {
  const r = readRunFile(join(runDir, CONTRACT_DIR), `v${n}.json`);
  if (r.missing) return { missing: true };
  if (r.refusal) return { problem: `${CONTRACT_DIR}/v${n}.json: ${r.refusal}` };
  let record;
  try { record = JSON.parse(r.text); } catch { return { problem: `${CONTRACT_DIR}/v${n}.json is not JSON` }; }
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.schema !== CONTRACT_SCHEMA || record.version !== n) return { problem: `${CONTRACT_DIR}/v${n}.json is not a ${CONTRACT_SCHEMA} record of version ${n}` };
  if (recordHash(record) !== record.sha256) return { problem: `${CONTRACT_DIR}/v${n}.json does not match its own sha256 (edited after it was written?)` };
  return { record };
}

/** The current record, or { none: true } (no contract), or { problem }. The ledger names the version; the file must be the one the ledger's line hashes. */
export function loadCurrent(runDir) {
  const st = contractState(runDir);
  if (!st.ok) return { problem: st.problem };
  if (st.problems.length) return { problem: st.problems[0] };
  if (!st.current) return { none: true, state: st };
  const v = loadVersion(runDir, st.current);
  if (v.missing) return { problem: `the ledger holds version ${st.current} but ${CONTRACT_DIR}/v${st.current}.json is missing` };
  if (v.problem) return { problem: v.problem };
  const line = st.versions[st.current - 1];
  if (line.record_sha256 !== v.record.sha256) return { problem: `${CONTRACT_DIR}/v${st.current}.json is not the record the ledger's line ${line.seq} names` };
  return { record: v.record, state: st };
}

// ---- writing files -----------------------------------------------------------------------------------------------------------------------------------------------------------------------

function syncDir(dir) {
  let fd;
  try { fd = openSync(dir, 'r'); fsyncSync(fd); } catch { /* a directory fsync is unsupported on some platforms; the file itself is already written and synced */ } finally { if (fd !== undefined) closeSync(fd); }
}

// Atomic AND never-overwriting (P16; backend rule 9: nothing can hard-lock itself): the text is written to a temp file in the same folder and synced, then link() makes it the final name (link fails if the
// name exists, so an existing file is never replaced), the folder is synced, and the temp is removed. A crash before the link leaves only a temp file and no final file, so the next attempt succeeds; a
// crash after it leaves the whole file. Where the filesystem has no hard links (EPERM/ENOTSUP/EXDEV) it falls back to an exclusive create with a direct write, whose torn file has no authority (the ledger
// is the authority) but must be moved away by hand. `hooks.beforeLink` is a test seam for the crash between the two.
export function writeNewFile(dir, name, text, hooks = {}) {
  mkdirSync(dir, { recursive: true });
  const final = join(dir, name);
  const tmp = join(dir, `${name}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  const fd = openSync(tmp, 'wx');
  try {
    try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    hooks.beforeLink?.();
    try { linkSync(tmp, final); } catch (e) {
      if (e.code === 'EEXIST') return { exists: true };
      if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(e.code)) throw e;
      let fd2;
      try { fd2 = openSync(final, 'wx'); } catch (e2) { if (e2.code === 'EEXIST') return { exists: true }; throw e2; }
      try { writeSync(fd2, text); fsyncSync(fd2); } finally { closeSync(fd2); }
    }
    syncDir(dir);
    return { ok: true };
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}
const writeNew = writeNewFile;

// A view: temp file, fsync, rename over the old one, sync the directory.
function writeView(dir, name, text) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${name}.tmp-${process.pid}`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, join(dir, name));
  syncDir(dir);
}

// A gate's text file: written if absent, accepted if the same bytes are there already, refused if other bytes are (the name says what the bytes must be).
function writeProposal(runDir, name, text) {
  const r = writeNew(join(runDir, CONTRACT_DIR), name, text);
  if (r.exists) {
    const have = readRunFile(join(runDir, CONTRACT_DIR), name);
    if (have.text !== text) return refuse('proposal_conflict', `${CONTRACT_DIR}/${name} exists with other text; move it away (it is a stale proposal) and ask again`);
  }
  return { ok: true, rel: `${CONTRACT_DIR}/${name}` };
}

/** Where a gate stands (src/gate.js readGateAnswer): the CLI reads it through here, so the gate module stays the only reader of its own files. */
export const approvalOf = (runDir, gate, opts = {}) => readGateAnswer(runDir, gate, opts);

// ---- lock ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Lints a parsed draft and prepares the lock: the content, the exact text a person will be shown and its proposal file. Refuses a run that already has a contract (amend it instead) and a draft
 * the lint refuses. Writes only the proposal file, which holds nothing but the text.
 * -> { ok: true, content, text, sha256, rel } | { ok: false, code, message, problems? }
 */
export function prepareLock(runDir, draft, { criteriaIds = null } = {}) {
  const st = contractState(runDir);
  if (!st.ok) return refuse('ledger_broken', st.problem);
  if (st.current) return refuse('already_locked', `this run already has contract version ${st.current}; change it with an amendment request (contract_amend) that a person decides, never by locking again`);
  const lint = lintContractDraft(draft, { criteriaIds });
  if (!lint.ok) return { ...refuse('draft_refused', `the draft is refused by the lint (${lint.problems.length} problem${lint.problems.length === 1 ? '' : 's'}); nothing was written`), problems: lint.problems };
  const content = { run: basename(runDir), version: 1, supersedes: null, source: sourceOf(runDir), obligations: lint.obligations.map(withHash), amendment: null };
  const text = renderContractText(content);
  const sha256 = textSha256(Buffer.from(text, 'utf8'));
  const p = writeProposal(runDir, `proposal-${sha256.slice(0, 12)}.md`, text);
  if (!p.ok) return p;
  return { ok: true, content, text, sha256, rel: p.rel };
}

/**
 * The gate for a text: an existing pending or approved-and-usable gate of this kind for the same file and hash is reused (asking twice for one text clutters the ledger), otherwise a new one is requested.
 * -> { ok: true, gate, status } | { ok: false, code, message }
 */
export function ensureGate(runDir, { kind, rel, sha256 }, { now = () => Date.now() } = {}) {
  const gates = listGates(runDir, { now });
  if (gates === null) return refuse('ledger_broken', 'the gate ledger is broken');
  for (const g of [...gates].reverse()) {
    const s = readGateAnswer(runDir, g.id, { now });
    if (s.gate && s.gate.kind === kind && s.gate.text === rel && s.gate.sha256 === sha256 && (s.status === 'pending' || (s.status === 'approved' && s.usable))) return { ok: true, gate: g.id, status: s.status };
  }
  const r = requestGate(runDir, { kind, textPath: rel, price: null, seats: [], sensitivity: null, masks: {}, expiresAt: now() + CONTRACT_GATE_TTL_MS }, { now });
  return r.ok ? { ok: true, gate: r.gate.id, status: 'pending' } : r;
}

// The version file and the view, written under the ledger lock by recordUse's `before` hook.
function writeVersion(runDir, record) {
  const dir = join(runDir, CONTRACT_DIR);
  const w = writeNew(dir, `v${record.version}.json`, `${JSON.stringify(record, null, 2)}\n`);
  if (w.exists) return refuse('version_file_exists', `${CONTRACT_DIR}/v${record.version}.json exists but the ledger has no line for it (a crash between the file and the line?). It has no authority; move it away and try again`);
  return null;
}

// CONTRACT.md is the builder-facing VIEW, so it is written only after the ledger line that makes the version current: a failed append can never leave a builder reading a version the ledger does not hold. A crash or
// a write error between the line and the view leaves a stale view, which `council contract check` reports; the repair is to redirect `council contract show <run> --md` into contract/CONTRACT.md. The version stands. -> a warning text or null.
function writeViewAfter(runDir, record) {
  try { writeView(join(runDir, CONTRACT_DIR), 'CONTRACT.md', renderContractMd(record)); return null; } catch (e) { return `version ${record.version} is recorded, but ${CONTRACT_DIR}/CONTRACT.md could not be written (${e.code ?? e.message}); redirect council contract show <run> --md into contract/CONTRACT.md to write the text a builder should read`; }
}

/**
 * Locks version 1 on an APPROVED gate: one approval, one lock. The record is built here (identity fields are the harness's), its file and CONTRACT.md are written under the ledger lock, then the
 * `contract_locked` line. -> { ok: true, record, seq } | { ok: false, code, message }
 */
export function commitLock(runDir, { content, gate, sha256, rel }, { now = () => Date.now() } = {}) {
  const record = buildRecord({ ...content, lockedAt: new Date(now()).toISOString(), approval: { gate, text: rel, sha256 } });
  const res = recordUse(runDir, gate, 'contract_locked', { version: 1, supersedes: null, record_sha256: record.sha256 }, {
    now,
    before: ({ gate: g, lines }) => {
      if (g.kind !== GATE_KIND_LOCK || g.text !== rel || g.sha256 !== sha256) return { code: 'gate_mismatch', message: `gate ${gate} is not the approval of this contract text` };
      if (stateFromLines(lines).current) return { code: 'already_locked', message: 'another process locked this run\'s contract first' };
      const w = writeVersion(runDir, record);
      return w ? { code: w.code, message: w.message } : null;
    },
  });
  if (!res.ok) return res;
  const warning = writeViewAfter(runDir, record);
  return { ok: true, record, seq: res.seq, ...(warning ? { warning } : {}) };
}

// ---- amendments ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A request for an amendment: $0, decides nothing, appends one `amend_requested` line. It must name the CURRENT version and an obligation of it; the words are capped and are untrusted text that a
 * person reads before deciding. -> { ok: true, seq, version, obligation_id } | { ok: false, code, message }
 */
export function requestAmendment(runDir, { version, obligation_id, reason, proposed_text }, { now = () => Date.now() } = {}) {
  const cur = loadCurrent(runDir);
  if (cur.problem) return refuse('contract_unreadable', cur.problem);
  if (cur.none) return refuse('no_contract', 'this run has no locked contract');
  const { record, state } = cur;
  if (!Number.isInteger(version) || version !== record.version) return refuse('stale_version', `the current contract version is ${record.version}; a request names the version it was written against`);
  const o = record.obligations.find(x => x.id === obligation_id);
  if (!o) return refuse('no_such_obligation', `version ${record.version} has no obligation ${JSON.stringify(obligation_id)} (ids: ${record.obligations.map(x => x.id).join(', ')})`);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > REASON_MAX_CHARS) return refuse('bad_reason', `the reason must be 1 to ${REASON_MAX_CHARS} characters`);
  if (typeof proposed_text !== 'string' || !proposed_text.trim() || proposed_text.length > MAX_TEXT_CHARS) return refuse('bad_proposed_text', `the proposed text must be 1 to ${MAX_TEXT_CHARS} characters`);
  if (!reason.isWellFormed() || !proposed_text.isWellFormed()) return refuse('not_well_formed', 'the request holds a lone surrogate (text that is not well-formed UTF-16): it would be written to the contract as a replacement character and the contract would never check; nothing was filed'); // audit fix cnc-contract F2
  if (hiddenCount(reason) + hiddenCount(proposed_text)) return refuse('hidden_characters', 'the request holds hidden characters (tag, bidi or zero-width); a person approves what they can read');
  if (proposed_text === o.text) return refuse('no_change', 'the proposed text is the text the obligation already has');
  const open = state.requests.filter(r => r.status === 'open');
  if (open.length >= MAX_OPEN_REQUESTS) return refuse('too_many_open', `${open.length} requests are waiting for a person; wait for a decision before filing more`);
  if (open.some(r => r.obligation_id === obligation_id && r.proposed_text === proposed_text)) return refuse('duplicate', 'an open request already proposes exactly this text for this obligation');
  try {
    const line = appendEvent(runDir, 'amend_requested', { version: record.version, obligation_id, reason, proposed_text }, { now });
    return { ok: true, seq: line.seq, version: record.version, obligation_id };
  } catch (err) {
    return refuse(err.code ?? 'io_error', err.message);
  }
}

/**
 * Prepares a decision on one request: the request must be open and name the current version. Writes the exact text the person will read (the current and the proposed words) as contract/amend-r<seq>.md.
 * -> { ok: true, request, prior, text, sha256, rel } | { ok: false, code, message }
 */
export function prepareAmendment(runDir, requestSeq) {
  const cur = loadCurrent(runDir);
  if (cur.problem) return refuse('contract_unreadable', cur.problem);
  if (cur.none) return refuse('no_contract', 'this run has no locked contract');
  const request = cur.state.requests.find(r => r.seq === requestSeq);
  if (!request) return refuse('no_such_request', `no amendment request at ledger line ${requestSeq}`);
  if (request.status === 'approved' || request.status === 'declined') return refuse('already_decided', `request ${requestSeq} was already ${request.status}`);
  if (request.status === 'invalid') return refuse('invalid_request', `ledger line ${requestSeq} is not a well-formed request; nothing can be decided on it`);
  if (request.status === 'stale') return refuse('stale_version', `request ${requestSeq} was written against version ${request.version}; the contract is at version ${cur.record.version}. A new request must name the current version`);
  if (!cur.record.obligations.some(o => o.id === request.obligation_id)) return refuse('no_such_obligation', `version ${cur.record.version} has no obligation ${request.obligation_id}`);
  const text = renderAmendmentText({ run: cur.record.run, request, prior: cur.record });
  const sha256 = textSha256(Buffer.from(text, 'utf8'));
  const p = writeProposal(runDir, `amend-r${requestSeq}.md`, text);
  if (!p.ok) return p;
  return { ok: true, request, prior: cur.record, text, sha256, rel: p.rel };
}

/**
 * Records an APPROVED amendment: version n+1 names version n and the request's ledger line, the obligation's text is the proposed one, every other obligation is copied. One approval, one decision.
 * -> { ok: true, record, seq } | { ok: false, code, message }
 */
export function commitAmendment(runDir, { request, prior, gate, sha256, rel }, { now = () => Date.now() } = {}) {
  const obligations = prior.obligations.map(o => (o.id === request.obligation_id ? { id: o.id, text: request.proposed_text, ...(o.criterion ? { criterion: o.criterion } : {}), ...(o.check ? { check: o.check } : {}) } : o));
  const amendment = { request_seq: request.seq, obligation_id: request.obligation_id, reason: request.reason, from_version: prior.version };
  const record = buildRecord({ run: prior.run, version: prior.version + 1, supersedes: prior.version, lockedAt: new Date(now()).toISOString(), source: prior.source, obligations, amendment, approval: { gate, text: rel, sha256 } });
  const res = recordUse(runDir, gate, 'amend_decided', { request_seq: request.seq, decision: 'approved', version: record.version, supersedes: prior.version, record_sha256: record.sha256 }, {
    now,
    before: ({ gate: g, lines }) => {
      if (g.kind !== GATE_KIND_AMEND || g.text !== rel || g.sha256 !== sha256) return { code: 'gate_mismatch', message: `gate ${gate} is not the approval of this amendment text` };
      const st = stateFromLines(lines);
      if (st.current !== prior.version) return { code: 'stale_version', message: `the contract moved to version ${st.current} while this was being decided` };
      const r = st.requests.find(x => x.seq === request.seq);
      if (!r || r.status !== 'open') return { code: 'already_decided', message: `request ${request.seq} is no longer open (${r ? r.status : 'missing'})` };
      const w = writeVersion(runDir, record);
      return w ? { code: w.code, message: w.message } : null;
    },
  });
  if (!res.ok) return res;
  const warning = writeViewAfter(runDir, record);
  return { ok: true, record, seq: res.seq, ...(warning ? { warning } : {}) };
}

/** Records a person's refusal of a request: the gate was DECLINED through a person's channel, and this line says which request it answered. -> { ok: true, seq } | { ok: false, code, message } */
export function declineAmendment(runDir, { requestSeq, gate }, { now = () => Date.now() } = {}) {
  const res = recordDeclined(runDir, gate, 'amend_decided', { request_seq: requestSeq }, {
    now,
    before: ({ gate: g, lines }) => {
      if (g.kind !== GATE_KIND_AMEND) return { code: 'gate_mismatch', message: `gate ${gate} is not an amendment gate` };
      const r = stateFromLines(lines).requests.find(x => x.seq === requestSeq);
      return !r || r.status !== 'open' ? { code: 'already_decided', message: `request ${requestSeq} is no longer open${r ? ` (${r.status})` : ''}` } : null;
    },
  });
  return res;
}

// ---- show and check ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The lines `council contract show` prints. Derived from the ledger and the current record; nothing is stored for them. */
export function showContract(runDir) {
  const cur = loadCurrent(runDir);
  if (cur.problem) return { exit: 1, lines: [`contract: ${cur.problem}`] };
  if (cur.none) return { exit: 2, lines: ['contract: this run has no locked contract'] };
  const { record, state } = cur;
  const open = state.requests.filter(r => r.status === 'open');
  const L = [`contract v${record.version} of run ${record.run}${amendedLine(record) ? `: ${amendedLine(record)}` : ''}`, `record sha256 ${record.sha256}; locked ${record.locked_at}; approved through gate ${record.approval.gate}`];
  if (record.amendment) L.push(`amendment: request ${record.amendment.request_seq} changed obligation ${record.amendment.obligation_id} (version ${record.amendment.from_version} -> ${record.version})`);
  for (const o of record.obligations) {
    const asked = open.filter(r => r.obligation_id === o.id).length;
    L.push(`${o.id}  ${asked ? `amend requested (${asked} open)` : 'in force'}${o.criterion ? `  criterion ${o.criterion}` : ''}`);
  }
  const stale = state.requests.filter(r => r.status === 'stale').length, invalid = state.requests.filter(r => r.status === 'invalid').length;
  L.push(`requests: ${open.length} open, ${state.requests.filter(r => r.status === 'approved').length} approved, ${state.requests.filter(r => r.status === 'declined').length} declined${stale ? `, ${stale} stale` : ''}${invalid ? `, ${invalid} not well-formed` : ''}`);
  return { exit: 0, lines: L, record, state };
}

/**
 * `council contract check`'s record half, $0. Verifies: the ledger chain; each version's file (schema, own hash, obligation hashes); that the ledger's line for it names the same hash, gate and supersedes;
 * that its gate was APPROVED by a person's channel for exactly the text the record recomputes to (v1: the contract text; later: the amendment text from the request line and the version before);
 * that no version file exists without a ledger line (an orphan); CONTRACT.md equals a fresh rendering of the current version; and the source hashes still equal the run's report.json thin contract.
 * -> { present, exit, lines[] } where exit is 0 (holds), 1 (a problem, each on its own line) or 2 (no contract here: `present` false).
 */
export function checkContract(runDir) {
  const dir = join(runDir, CONTRACT_DIR);
  let names = [];
  try { names = readdirSync(dir); } catch { /* no contract folder: nothing to look at there */ }
  // A run HAS a contract when a version file exists or the ledger holds a lock/approved-amendment line. A folder that holds only a draft (draft.json, draft-reply.md) or a proposal waiting for a person
  // (proposal-*.md, amend-r*.md) is "no contract yet", and so is a ledger this command cannot read when no version file exists: both answer exactly as a run without a contract does (`present: false`).
  // CONTRACT.md counts too: it is written only after a ledger line made a version current, so a builder may be reading it even when the ledger line and the version file are gone.
  const hasVersionFile = names.some(n => /^v\d+\.json$/.test(n)) || names.includes('CONTRACT.md');
  const ledger = readLedger(runDir);
  if (!ledger.ok) return hasVersionFile ? { present: true, exit: 1, lines: [`the gate ledger is broken at line ${ledger.failedAt}: ${ledger.reason}`] } : { present: false, exit: 2, lines: [] };
  const st = { ...stateFromLines(ledger.lines), ok: true };
  if (!st.versions.length && !hasVersionFile) return { present: false, exit: 2, lines: [] };
  const bad = [...st.problems];
  const info = [];
  // orphans: a version file the ledger knows nothing about
  for (const n of names) {
    const m = /^v(\d+)\.json$/.exec(n);
    if (m && Number(m[1]) > st.versions.length) bad.push(`${CONTRACT_DIR}/${n} has no line in the ledger (a crash between the file and the line, or a file put there by hand): it has no authority`);
  }
  if (!st.versions.length) {
    if (names.includes('CONTRACT.md')) bad.push(`${CONTRACT_DIR}/CONTRACT.md exists but the ledger holds no locked version (the ledger line was cut away, or the file was put there by hand): a builder must not work from it`);
    return { present: true, exit: 1, lines: bad };
  }
  let prior = null;
  for (const line of st.versions) {
    const n = line.version;
    const v = loadVersion(runDir, n);
    if (v.missing) { bad.push(`${CONTRACT_DIR}/v${n}.json is missing (the ledger's line ${line.seq} names it)`); prior = null; continue; }
    if (v.problem) { bad.push(v.problem); prior = null; continue; }
    const r = v.record;
    if (r.sha256 !== line.record_sha256) bad.push(`v${n}: the ledger's line ${line.seq} names record ${String(line.record_sha256).slice(0, 12)} but the file is ${r.sha256.slice(0, 12)}`);
    if ((r.supersedes ?? null) !== (n === 1 ? null : n - 1) || (line.supersedes ?? null) !== (r.supersedes ?? null)) bad.push(`v${n}: supersedes ${JSON.stringify(r.supersedes)} does not follow the ledger (expected ${n === 1 ? 'null' : n - 1})`);
    for (const o of r.obligations || []) {
      if (sha256Of(canonicalJson({ id: o.id, text: o.text, criterion: o.criterion ?? null, check: o.check ?? null })) !== o.sha256) bad.push(`v${n}: obligation ${o.id} does not match its own hash`);
    }
    if (!r.approval || r.approval.gate !== line.gate) bad.push(`v${n}: the record's approval names gate ${r.approval?.gate}, the ledger's line names ${line.gate}`);
    // the approval: a person's channel approved exactly the text this record recomputes to
    const g = readGateAnswer(runDir, line.gate);
    if (g.status !== 'approved') bad.push(`v${n}: gate ${line.gate} reads ${g.status}${g.reason ? ` (${g.reason})` : ''}, not approved`);
    else {
      let want;
      if (n === 1) want = textSha256(Buffer.from(textOfRecord(r), 'utf8'));
      else {
        const req = st.requests.find(x => x.seq === line.request_seq);
        if (!req || req.invalid || !prior) bad.push(`v${n}: the request the ledger names (line ${line.request_seq}) cannot be read, so the approved text cannot be recomputed`);
        else want = textSha256(Buffer.from(renderAmendmentText({ run: r.run, request: req, prior }), 'utf8'));
        if (req && !req.invalid && r.amendment && (r.amendment.request_seq !== req.seq || r.amendment.obligation_id !== req.obligation_id)) bad.push(`v${n}: the record's amendment does not match request ${req.seq}`);
        if (req && !req.invalid && prior) {
          const o = r.obligations.find(x => x.id === req.obligation_id);
          if (!o || o.text !== req.proposed_text) bad.push(`v${n}: obligation ${req.obligation_id} is not the text the person approved`);
          for (const p of prior.obligations) if (p.id !== req.obligation_id && r.obligations.find(x => x.id === p.id)?.sha256 !== p.sha256) bad.push(`v${n}: obligation ${p.id} changed, but the approved amendment named only ${req.obligation_id}`);
          if (r.obligations.length !== prior.obligations.length) bad.push(`v${n}: the list of obligations changed in size, which no amendment approves`);
        }
      }
      if (want !== undefined && (want !== r.approval.sha256 || want !== g.gate.sha256)) bad.push(`v${n}: the text the record recomputes to (${want.slice(0, 12)}) is not the text gate ${line.gate} approved (${g.gate.sha256.slice(0, 12)})`);
      if (g.gate.text !== r.approval.text) bad.push(`v${n}: the record says the approved text is ${r.approval.text}, the gate holds ${g.gate.text}`);
    }
    prior = r;
  }
  // the view and the source
  const cur = prior;
  if (cur && cur.version === st.versions.length) {
    const view = readRunFile(dir, 'CONTRACT.md');
    if (view.text !== renderContractMd(cur)) bad.push(`${CONTRACT_DIR}/CONTRACT.md differs from the current record (it is a view of the record: council contract show <run> --md > <run>/contract/CONTRACT.md writes the right text)`);
    const t = readRunJson(runDir, 'report.json')?.thin_contract;
    // Audit fix cnc-contract F1: a contract locked from a thin contract (non-null source hashes) is checked against it. With report.json missing, unparseable or without a `thin_contract` there is no comparison
    // to make, and "cannot compare" is not "holds" (without a contract the same states exit 2): deleting the key together with an edit of the run's criteria used to pass. A contract locked with no source (null) is unchanged.
    if (!t && ['task_sha256', 'criteria_sha256', 'signed_text_sha256', 'thin_contract_sha256'].some(k => cur.source?.[k])) bad.push('source: the contract was locked from the thin contract in the run\'s report.json, which is missing, unreadable or no longer has a thin_contract: the plan the contract was locked from cannot be compared');
    if (t) for (const [k, was] of [['task_sha256', cur.source?.task_sha256], ['criteria_sha256', cur.source?.criteria_sha256], ['signed_text_sha256', cur.source?.signed_text_sha256], ['sha256', cur.source?.thin_contract_sha256]]) {
      if (was && t[k] !== was) bad.push(`source drift: the run's report.json thin_contract ${k} is no longer the one the contract was locked from`);
    }
    if (!bad.length) { info.push(`contract v${cur.version}: record, approval and ledger agree${amendedLine(cur) ? ` - ${amendedLine(cur)}` : ''}`); info.push(`record sha256 ${cur.sha256}`); }
  }
  return { present: true, exit: bad.length ? 1 : 0, lines: bad.length ? bad : info, current: cur };
}
