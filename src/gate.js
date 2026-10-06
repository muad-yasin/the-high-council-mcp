// The gate: a send that waits for a person (0.8.1 plan DR-3, DR-4, M3; persistence register P4).
//
// A gate names a text file in the run folder and the sha256 of its bytes. A person answers it through a
// channel a person uses (PERSON_CHANNELS: the terminal, `council gate answer`, or an MCP elicitation that
// shows the whole text), bound to the hash of the text they were shown (decided rule 10). A run may start
// on an approved gate that is `usable` only.
//
// Contract.
//   requestGate(runDir, {kind, textPath, price, seats, sensitivity, masks, follow_up?, expiresAt?}, {now?})
//       -> { ok: true, gate } | { ok: false, code, message }
//   answerGate(runDir, gateId, {channel, shownSha256, decision, actor, reason?, tty}, {now?})
//       -> { ok: true, status, seq, warning? } | { ok: false, code, message }
//   readGateAnswer(runDir, gateId, {now?})
//       -> { status: 'pending' | 'approved' | 'declined' | 'expired' | 'invalid', reason?, gate?, answer?,
//            usable?, usable_until?, used? }   (the last three on `approved` only)
//   listGates(runDir, {now?}) -> [{ id, status, reason? }] | null when the ledger is broken
//   recordSent(runDir, gateId, fields?, {now?}) -> { ok: true, seq } | { ok: false, code, message }
//       the `sent` line of an approved, usable gate (one approval, one send); written by `council --advice-adopt`
//   recordMoreMaterial(runDir, {items}, {now?}) -> { ok: true, seq } | { ok: false, code, message }   (DR-8)
//   moreMaterialRecorded(runDir) -> boolean
//   recordStopped(runDir, {stoppedBy, spentUsd}, {now?}) -> { ok: true, seq } | { ok: false, code, message }   (M6)
//   PERSON_CHANNELS, GATE_TTL_MS, GATE_SCHEMA, GATES_DIR, textSha256, metaSha256
//
// Owned state: `runs/<id>/gates/<gate_id>.json` (schema gate/1, a view) and the `gate_requested` and
// `gate_answered` lines of the run's ledger (the record, src/gate-ledger.js).
//
// The ledger is the truth; the gate file is a view of it. An answer is committed when its ledger line is
// written; the gate file is rewritten after. So:
//   - `approved` is read only from a `gate_answered` line in a ledger that verifies, carrying the gate's
//     recorded hash, AND the text file's bytes hashing to it now. A gate file whose status, answer, text,
//     hash, expiry or metadata (price, seats, sensitivity, masks: bound by `meta_sha256`) disagrees with the
//     ledger reads `invalid` (gate_record_mismatch).
//   - A crash between the ledger line and the view leaves the file saying `pending` with no answer; the
//     ledger wins, so an answered gate can never be answered twice nor stranded unanswerable.
//   - The chain cannot see an edit of the LAST ledger line, or a line appended by anything that can write
//     the run folder (decided rule 9). Comparing the view with the ledger catches an edit of one of the two;
//     an edit of both together is not detected.
//   - `expired` is derived from `expires_at` on read and is never written. An approval does not outlive its
//     gate either: `approved` stays the status (it is history), and `usable` is false once `expires_at` has
//     passed or once a `sent` line names the gate (`used`). M4 starts a run on approved + usable only.
//   - Refusals are not events: a refused answer (wrong hash, expired, not a person's channel, ...) appends
//     nothing.
//   - `invalid` (a fifth value; the plan lists four, see Review/0.8.1-decisions.md) covers what cannot be
//     trusted: a broken ledger (gate_ledger_corrupt), an unreadable or contradicting gate file, an unknown
//     gate, a text file changed after approval or reached through a link out of the run folder. It is never
//     `approved`.
//
// This module is the only writer of `gate_answered` and of a gate file's `approved`; it reads no
// environment variable and no command-line flag (test/gate-answer.test.js scans for both).
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { withLedger, readLedger, sha256Hex, LedgerBusyError, LedgerCorruptError, LedgerWriteError } from './gate-ledger.js';

// A gate is answered only through a channel a person uses (decided rule 10, DR-3). One constant, so 0.8.3
// adds `ui` here together with its proof that a click is a person's.
export const PERSON_CHANNELS = Object.freeze(['cli', 'elicitation']);
export const GATE_SCHEMA = 'gate/1';
export const GATES_DIR = 'gates';
// Ten minutes: the life of a council_quote (QUOTE_TTL_MS in src/mcp/advice.js), the thing an advice gate
// approves, so a gate never outlives its quote by default. M4 passes the quote's own expiry as expiresAt.
// Defined here rather than imported because this module must not depend on the MCP layer.
export const GATE_TTL_MS = 10 * 60_000;
const DECISIONS = ['approved', 'declined'];
const GATE_ID = /^g[1-9][0-9]{0,5}$/;
const KIND = /^[a-z][a-z_]{0,31}$/;
const MASK_KEY = /^[a-z][a-z0-9_]{0,31}$/;
// Seat descriptions and labels are shown to the person before they approve, so they are short strings:
// 300 characters is about three terminal lines, room for a retention sentence quoted from a lab's page.
const FIELD_MAX = 300;
const SEATS_MAX = 16; // above any shipped advice chain (advise-premium has the most seats)

/** sha256 of a text file's raw bytes: the one definition the gate, the CLI and (M4) the quote share. */
export const textSha256 = bytes => sha256Hex(bytes);

// JSON with object keys sorted at every depth, so equal metadata always hashes equal.
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v));
// The metadata as it is written to the gate file: JSON's own rules (an undefined key is dropped), so the hash
// at request time and the hash recomputed from the file are of the same thing. Without this, a price with
// `expected_usd: undefined` hashed differently from the file and made a gate no one could answer.
// `follow_up` (0.8.1 DR-8) is absent on most gates; JSON drops an undefined key, so a gate without it hashes as it did in M3.
const asWritten = ({ price, seats, sensitivity, masks, follow_up }) => JSON.parse(JSON.stringify({ price, seats, sensitivity, masks, follow_up }));
/** sha256 binding what the person is told about a send: price, seats, sensitivity, masks, and the follow-up line when there is one. */
export const metaSha256 = meta => sha256Hex(canonical(asWritten(meta)));

const refuse = (code, message) => ({ ok: false, code, message });
const gatePath = (runDir, id) => join(runDir, GATES_DIR, `${id}.json`);

// Temp file in the same directory, fsync, rename, then sync the directory (plan section 4, "Atomic").
function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  let dfd;
  try { dfd = openSync(join(path, '..'), 'r'); fsyncSync(dfd); } catch { /* a directory fsync is unsupported on some platforms; the rename is already done */ } finally { if (dfd !== undefined) closeSync(dfd); }
}

const inside = (root, p) => { const r = relative(root, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };

// The text must live inside the run folder (DR-15: an advice brief is `runs/<id>/advice-brief.md`), so a
// gate can never point `gate show` at a file elsewhere on the disk: checked by path AND after following
// links (a link inside the run folder to a file outside it is refused). Stored relative, "/"-separated.
function textInside(runDir, textPath) {
  if (typeof textPath !== 'string' || !textPath) return null;
  const abs = resolve(runDir, textPath);
  if (!inside(resolve(runDir), abs)) return null;
  return { abs, rel: relative(resolve(runDir), abs).split(sep).join('/') };
}

// The bytes of a gate's text, or null when it cannot be read or resolves (through links) outside the run
// folder. Every read of a gate's text goes through here, so a forged `text` in a gate file or a ledger line
// ("../x", a link) reads as unreadable, never as a file elsewhere.
export function readGateText(runDir, rel) {
  const where = textInside(runDir, rel);
  if (!where) return null;
  try {
    if (!inside(realpathSync(runDir), realpathSync(where.abs))) return null;
    return readFileSync(where.abs);
  } catch { return null; }
}

const isStr = v => typeof v === 'string' && v.length <= FIELD_MAX;
const isMoney = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// The shapes the person is shown. Refused, not repaired: a price of '5' would otherwise print as "unpriced".
function metaProblem({ price, seats, sensitivity, masks, follow_up }) {
  if (price !== null && !(price && typeof price === 'object' && !Array.isArray(price) && isMoney(price.ceiling_usd)
    && (price.expected_usd === undefined || isMoney(price.expected_usd)) && Object.keys(price).every(k => ['ceiling_usd', 'expected_usd'].includes(k)))) {
    return ['bad_price', 'price must be null or { ceiling_usd: number >= 0, expected_usd?: number >= 0 }'];
  }
  if (!Array.isArray(seats) || seats.length > SEATS_MAX || !seats.every(s => s && typeof s === 'object' && !Array.isArray(s) && Object.values(s).every(v => v === null || isStr(v)))) {
    return ['bad_seats', `seats must be an array of at most ${SEATS_MAX} objects whose values are strings of at most ${FIELD_MAX} characters`];
  }
  if (sensitivity !== null && !(sensitivity && typeof sensitivity === 'object' && !Array.isArray(sensitivity) && isStr(sensitivity.label) && isStr(sensitivity.set_by) && Object.keys(sensitivity).length === 2)) {
    return ['bad_sensitivity', 'sensitivity must be null or { label: string, set_by: string }'];
  }
  if (!masks || typeof masks !== 'object' || Array.isArray(masks) || !Object.entries(masks).every(([k, n]) => MASK_KEY.test(k) && Number.isInteger(n) && n >= 0)) {
    return ['bad_masks', 'masks must map short lowercase names to whole numbers >= 0'];
  }
  if (follow_up !== undefined && !(isStr(follow_up) && follow_up.length > 0)) return ['bad_follow_up', `follow_up must be absent or a line of at most ${FIELD_MAX} characters`];
  return null;
}

// Ledger trouble becomes a refusal with its code; any other file error is `io_error`, never a stack trace.
function refusalFor(err) {
  if (err instanceof LedgerBusyError || err instanceof LedgerCorruptError || err instanceof LedgerWriteError) return refuse(err.code, err.message);
  return refuse('io_error', `a gate file could not be read or written (${err.code ?? err.message})`);
}

/**
 * Records a pending gate for a text file in the run folder: one `gate_requested` ledger line, then the gate
 * file. The hash is computed here from the file's bytes, never taken from the caller.
 */
export function requestGate(runDir, { kind, textPath, price = null, seats = [], sensitivity = null, masks = {}, follow_up, expiresAt } = {}, { now = () => Date.now() } = {}) {
  if (typeof kind !== 'string' || !KIND.test(kind)) return refuse('bad_kind', 'the gate kind must be a short lowercase name');
  const where = textInside(runDir, textPath);
  if (!where) return refuse('text_outside_run', 'the gate text must be a file inside the run folder');
  let meta;
  try { meta = asWritten({ price, seats, sensitivity, masks, follow_up }); } catch { return refuse('bad_price', 'the price, seats, sensitivity and masks must be plain JSON data'); }
  const problem = metaProblem(meta);
  if (problem) return refuse(...problem);
  const bytes = readGateText(runDir, where.rel);
  if (!bytes) return refuse('text_unreadable', `cannot read ${where.rel} inside the run folder (missing, or a link to a file outside it)`);
  const t = now();
  const expires = expiresAt === undefined ? t + GATE_TTL_MS : Number(expiresAt);
  if (!Number.isFinite(expires) || expires <= t) return refuse('bad_expiry', 'the gate must expire in the future');
  try {
    mkdirSync(join(runDir, GATES_DIR), { recursive: true });
    return withLedger(runDir, ({ lines, append }) => {
      const id = `g${lines.filter(l => l.event === 'gate_requested').length + 1}`;
      const record = {
        schema: GATE_SCHEMA, id, kind, status: 'pending', text: where.rel, sha256: textSha256(bytes), bytes: bytes.length,
        ...meta, meta_sha256: metaSha256(meta), requested_at: new Date(t).toISOString(), expires_at: new Date(expires).toISOString(), answer: null,
      };
      const line = append('gate_requested', { gate: id, kind, text: record.text, sha256: record.sha256, bytes: record.bytes, meta_sha256: record.meta_sha256, expires_at: record.expires_at });
      record.seq = line.seq;
      // If this write fails the gate is in the ledger without a view: it reads `invalid`
      // (gate_record_unreadable) and cannot be answered, and a new gate can be requested.
      writeAtomic(gatePath(runDir, id), `${JSON.stringify(record, null, 2)}\n`);
      return { ok: true, gate: record };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

function readRecord(runDir, id) {
  try {
    const r = JSON.parse(readFileSync(gatePath(runDir, id), 'utf8'));
    return r && typeof r === 'object' && r.schema === GATE_SCHEMA && r.id === id ? r : null;
  } catch { return null; }
}

// The gate's state from a verified ledger's lines plus its file. Shared by the reader and the writer so
// the two can never disagree about what "pending" means.
function stateOf(runDir, id, lines, t) {
  const requested = lines.find(l => l.event === 'gate_requested' && l.gate === id);
  if (!requested) return { status: 'invalid', reason: 'gate_not_found' };
  const record = readRecord(runDir, id);
  if (!record) return { status: 'invalid', reason: 'gate_record_unreadable' };
  const mismatch = { status: 'invalid', reason: 'gate_record_mismatch' };
  if (record.sha256 !== requested.sha256 || record.text !== requested.text || record.expires_at !== requested.expires_at
    || record.kind !== requested.kind || record.seq !== requested.seq) return mismatch;
  // What the person is told (price, seats, sensitivity, masks, follow_up) is bound to the ledger too.
  if (record.meta_sha256 !== requested.meta_sha256 || metaSha256(record) !== requested.meta_sha256) return mismatch;
  const answered = lines.find(l => l.event === 'gate_answered' && l.gate === id);
  if (!answered) {
    // A file that claims an answer the ledger does not hold was edited by hand: trust neither.
    if (record.status !== 'pending' || record.answer !== null) return mismatch;
    if (t >= Date.parse(record.expires_at)) return { status: 'expired', gate: record };
    return { status: 'pending', gate: record };
  }
  if (!DECISIONS.includes(answered.decision) || answered.sha256 !== requested.sha256 || answered.meta_sha256 !== requested.meta_sha256
    || !PERSON_CHANNELS.includes(answered.channel)) return mismatch;
  // The view either lags the ledger (a crash before it was rewritten: still pending, no answer) or agrees
  // with it exactly. Anything else is an edit of one of the two (M3 review M1: an edited last line).
  const lagging = record.status === 'pending' && record.answer === null;
  const agrees = record.status === answered.decision && record.answer && record.answer.decision === answered.decision
    && record.answer.seq === answered.seq && record.answer.channel === answered.channel;
  if (!lagging && !agrees) return mismatch;
  return { status: answered.decision, gate: record, answer: answered };
}

/**
 * Where a gate stands. `approved` only when a verified ledger holds a person's approval of the recorded
 * hash and the text file still hashes to it; then `usable` says whether a run may still start on it. Never
 * writes.
 */
export function readGateAnswer(runDir, gateId, { now = () => Date.now() } = {}) {
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return { status: 'invalid', reason: 'gate_not_found' };
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { status: 'invalid', reason: 'gate_ledger_corrupt' };
  const t = now();
  const state = stateOf(runDir, gateId, ledger.lines, t);
  if (state.status === 'approved') {
    const bytes = readGateText(runDir, state.gate.text);
    if (!bytes || textSha256(bytes) !== state.gate.sha256) return { status: 'invalid', reason: 'hash_mismatch', gate: state.gate };
    const used = ledger.lines.some(l => l.event === 'sent' && l.gate === gateId);
    return { ...state, used, usable_until: state.gate.expires_at, usable: !used && t < Date.parse(state.gate.expires_at) };
  }
  return state;
}

/** Every gate the ledger names, with its status. Never writes. */
export function listGates(runDir, { now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return null;
  return ledger.lines.filter(l => l.event === 'gate_requested').map(l => {
    const s = readGateAnswer(runDir, l.gate, { now });
    return { id: l.gate, status: s.status, ...(s.reason ? { reason: s.reason } : {}) };
  });
}

/**
 * The only way a gate is answered. Refuses, appending nothing: channel_not_person, bad_decision,
 * gate_not_found, gate_ledger_corrupt, gate_busy, gate_record_unreadable, gate_record_mismatch,
 * gate_not_pending, gate_expired, hash_mismatch, io_error. An approval needs the text's bytes now, the
 * recorded hash and the hash the person was shown to agree; a decline needs only the shown hash to be the
 * recorded one (nothing is sent, and a person can always say no: decided rule 10). On success: one
 * `gate_answered` line, then the gate file rewritten; if that rewrite fails the answer stands (the ledger
 * holds it) and the result carries a `warning`.
 */
export function answerGate(runDir, gateId, { channel, shownSha256, decision, actor = null, reason = null, tty = null } = {}, { now = () => Date.now() } = {}) {
  if (!PERSON_CHANNELS.includes(channel)) return refuse('channel_not_person', `a gate is answered only through a channel a person uses (${PERSON_CHANNELS.join(', ')}), not ${JSON.stringify(channel)}`);
  if (!DECISIONS.includes(decision)) return refuse('bad_decision', `the decision must be one of ${DECISIONS.join(', ')}`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const t = now();
      const state = stateOf(runDir, gateId, lines, t);
      if (state.status === 'invalid') {
        const messages = { gate_not_found: `no gate ${gateId} in this run`, gate_record_unreadable: `gates/${gateId}.json cannot be read`, gate_record_mismatch: `gates/${gateId}.json does not match the ledger` };
        return refuse(state.reason, messages[state.reason] ?? state.reason);
      }
      if (state.status === 'approved' || state.status === 'declined') return refuse('gate_not_pending', `gate ${gateId} was already answered (${state.status})`);
      if (state.status === 'expired') return refuse('gate_expired', `gate ${gateId} expired at ${state.gate.expires_at}`);
      const record = state.gate;
      const shown = typeof shownSha256 === 'string' ? shownSha256.slice(0, 12) : 'none';
      if (shownSha256 !== record.sha256) return refuse('hash_mismatch', `the text shown (${shown}) is not the text of gate ${gateId} (${record.sha256.slice(0, 12)})`);
      if (decision === 'approved') {
        const bytes = readGateText(runDir, record.text);
        const nowSha = bytes ? textSha256(bytes) : null;
        if (nowSha !== record.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed on disk since it was shown (recorded ${record.sha256.slice(0, 12)}, on disk ${nowSha ? nowSha.slice(0, 12) : 'missing'})`);
      }
      const line = append('gate_answered', { gate: gateId, decision, sha256: record.sha256, meta_sha256: record.meta_sha256, channel, actor, reason, tty });
      const answered = { ...record, status: decision, answer: { decision, channel, actor, reason, tty, at: line.ts, seq: line.seq } };
      try {
        writeAtomic(gatePath(runDir, gateId), `${JSON.stringify(answered, null, 2)}\n`);
      } catch (err) {
        return { ok: true, status: decision, seq: line.seq, warning: `the answer is recorded in the ledger (line ${line.seq}); gates/${gateId}.json could not be rewritten (${err.code ?? err.message}) and still says pending, which reads correctly` };
      }
      return { ok: true, status: decision, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * Records that the text of an approved gate is being sent: one `sent` line naming the gate. The only writer of
 * `sent` for a gate, so `used` (one approval, one send) is decided here, under the ledger lock. Refuses, appending
 * nothing: gate_not_found, gate_ledger_corrupt, gate_busy, gate_record_unreadable, gate_record_mismatch,
 * gate_not_approved (pending or declined), gate_expired, gate_used, hash_mismatch (the text changed since the
 * approval), io_error.
 */
export function recordSent(runDir, gateId, fields = {}, { now = () => Date.now() } = {}) {
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const t = now();
      const state = stateOf(runDir, gateId, lines, t);
      if (state.status === 'invalid') return refuse(state.reason, `gate ${gateId} cannot be trusted (${state.reason})`);
      if (state.status !== 'approved') return refuse(state.status === 'expired' ? 'gate_expired' : 'gate_not_approved', `gate ${gateId} is ${state.status}, not approved`);
      if (lines.some(l => l.event === 'sent' && l.gate === gateId)) return refuse('gate_used', `gate ${gateId} was already used for a send; one approval covers one send`);
      if (t >= Date.parse(state.gate.expires_at)) return refuse('gate_expired', `the approval of gate ${gateId} lapsed at ${state.gate.expires_at}`);
      const bytes = readGateText(runDir, state.gate.text);
      if (!bytes || textSha256(bytes) !== state.gate.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed after it was approved`);
      const line = append('sent', { ...fields, gate: gateId, sha256: state.gate.sha256 });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * The `more_material_requested` line (0.8.1 DR-8): an advice run whose answer listed what is missing from the brief records it in
 * its own ledger, after a send its gate approved, so the next call's approval text can say it follows that request. Written by
 * `council --advice-adopt` once report.json is written. -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordMoreMaterial(runDir, { items }, { now = () => Date.now() } = {}) {
  if (!Number.isInteger(items) || items < 1) return refuse('bad_items', 'items must be a whole number >= 1');
  try {
    return withLedger(runDir, ({ lines, append }) => {
      if (!lines.some(l => l.event === 'sent')) return refuse('not_sent', 'this run recorded no send, so it has no answer to follow up');
      const line = append('more_material_requested', { items });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/** Whether the run's ledger verifies and holds a `more_material_requested` line. A broken or missing ledger reads false. */
export function moreMaterialRecorded(runDir) {
  const ledger = readLedger(runDir);
  return ledger.ok && ledger.lines.some(l => l.event === 'more_material_requested');
}

/**
 * The `stopped` line (0.8.1 M6, the event M3 reserved): an adopted advice run that ended at exit 18 records who stopped it and what it
 * had spent, after its `sent` line. -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordStopped(runDir, { stoppedBy, spentUsd }, { now = () => Date.now() } = {}) {
  if (!['user', 'client_cancel', 'wall_clock'].includes(stoppedBy)) return refuse('bad_stopped_by', 'stoppedBy must be user, client_cancel or wall_clock');
  if (typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || spentUsd < 0) return refuse('bad_spent', 'spentUsd must be a number >= 0');
  try {
    return withLedger(runDir, ({ lines, append }) => {
      if (!lines.some(l => l.event === 'sent')) return refuse('not_sent', 'this run recorded no send, so there is nothing to stop');
      const line = append('stopped', { stoppedBy, spentUsd });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}
