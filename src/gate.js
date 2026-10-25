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
//   recordDeclined(runDir, gateId, 'amend_decided', fields?, {now?, before?}) -> the same, for a gate a person DECLINED (0.8.2 item 6d)
//   recordUse(runDir, gateId, event, fields?, {now?, before?}) -> the same; event is one of USE_EVENTS (sent, contract_locked, amend_decided): recordSent is recordUse for `sent` (0.8.2 item 6d)
//       the `sent` line of an approved, usable gate (one approval, one send); written by `council --advice-adopt`
//   recordMoreMaterial(runDir, {items}, {now?}) -> { ok: true, seq } | { ok: false, code, message }   (DR-8)
//   moreMaterialRecorded(runDir) -> boolean
//   recordStopped(runDir, {stoppedBy, spentUsd}, {now?}) -> { ok: true, seq } | { ok: false, code, message }   (M6)
//   The `run_cap` kind (0.8.3 M6 typed cap T3; see RUN_CAP_KIND below): requestGate takes `cap` (the bound pending decision); answerGate takes `typedCap` (the person's raw text) and `client`; and
//   consumeRunCap(runDir, gateId, {runId, scopeSha256}, {now?}) -> { ok: true, seq, gate, runId, capUsd, capMicroUsd } | { ok: false, code, message }   (the single `cap_consumed` use)
//   runCapAuthority(runDir, {runId?, now?}) -> { status: 'none' } | { status: 'ok', gate, runId, operation, capUsd, capMicroUsd, channel, actor, seq } | { status: 'invalid', reason }   (a read, never a write)
//   capScopeSha256(scope) -> hex   RUN_CAP_KIND, CAP_OPERATION
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
import { parseCapInput } from './cap-input.js';
// The two ledger functions the contract record (src/contract-record.js) reads and appends through, so that only the gate modules name the ledger file: the verified ledger, and the public events (appendEvent refuses every other).
export { readLedger, appendEvent } from './gate-ledger.js';

// A gate is answered only through a channel a person uses (decided rule 10, DR-3). One constant, so 0.8.3
// adds `ui` here together with its proof that a click is a person's.
export const PERSON_CHANNELS = Object.freeze(['cli', 'elicitation']);
// SESSION CHANNEL (0.8.3 M7; Muad 19 Okt 2026 "the main session gets the first say"; C&C thcmcp-6d rulings): the controlling session may answer a gate of a TREE decision kind, with a written reason, and ONLY those kinds. A send-path gate (advice and every other kind) stays a person's:
// otherwise the session could approve its own paid send. This list is the gate-level fence by KIND; the fence by FORM is the tree table (answeredByRefusal sessionAllowed), because every decide form is spent under the one kind tree_decide.
export const SESSION_CHANNEL = 'session';
export const SESSION_ELIGIBLE_KINDS = Object.freeze(['tree_decide', 'tree_frontier']);       // tree_frontier: the session answers only a gate it requested, and only the frontier_approved table row (first approval of a split, the figures it saw) and src/tree-approve-session.js decide whether it may
/** The ONE call that answers a gate on the session channel (the scan in test/gate-answer.test.js keeps every other module off answerGate): approve, with the session's written reason. The kind, requester and reason rules are answerGate's. */
export function answerGateAsSession(runDir, gateId, { shownSha256, reason }, opts) {
  return answerGate(runDir, gateId, { channel: SESSION_CHANNEL, shownSha256, decision: 'approved', actor: 'main-session', reason, tty: false }, opts);
}
const answeredOnAllowedChannel = (channel, kind) => PERSON_CHANNELS.includes(channel) || (channel === SESSION_CHANNEL && SESSION_ELIGIBLE_KINDS.includes(kind));
export const GATE_SCHEMA = 'gate/1';
export const GATES_DIR = 'gates';
// Ten minutes: the life of a council_quote (QUOTE_TTL_MS in src/mcp/advice.js), the thing an advice gate
// approves, so a gate never outlives its quote by default. M4 passes the quote's own expiry as expiresAt.
// Defined here rather than imported because this module must not depend on the MCP layer.
export const GATE_TTL_MS = 10 * 60_000;
const DECISIONS = ['approved', 'declined'];
// What uses up an approval (one approval, one use): a send (advice), a contract lock, or the approval of a contract amendment (0.8.2 item 6d). The `sent` line is written by recordSent and the
// other two by src/contract-record.js through recordUse, so `used` is decided in one place, under the ledger lock.
export const USE_EVENTS = Object.freeze(['sent', 'contract_locked', 'amend_decided', 'tree_frontier_approved', 'tree_decided', 'tree_checked', 'cap_consumed']);   // the last three: 0.8.3 M5b, a tree's frontier approval and `tree decide`; M6 S2, `tree check` (src/tree-gate.js)
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
// JSON writes NaN and Infinity as null, and null is an ACCEPTED value in several fields (a seat's "unknown", a cap's "no ceiling"), so a check made on the written form would take a NaN for an honest null (box-21, 14 Oct 2026: run-cap-gate.test.js 'ceiling NaN'). The class is closed here, once: every round trip below refuses a non-finite number, wherever it sits.
class NonFiniteError extends TypeError {}
const finiteOnly = (key, v) => { if (typeof v === 'number' && !Number.isFinite(v)) throw new NonFiniteError(`${key || 'the value'} is not a finite number (NaN or Infinity); every amount and count in a gate must be a finite number`); return v; };
const asWritten = ({ price, seats, sensitivity, masks, follow_up, cap }) => JSON.parse(JSON.stringify({ price, seats, sensitivity, masks, follow_up, cap }, finiteOnly));
/** sha256 binding what the person is told about a send: price, seats, sensitivity, masks, and the follow-up line when there is one. */
export const metaSha256 = meta => sha256Hex(canonical(asWritten(meta)));

// 0.8.3 M6 typed cap T3 (typed-cap gate page section 3; 14 Oct 2026): the `run_cap` gate kind. The text it names is the SCREEN a person reads (src/cap-screen.js); the pending decision is the `cap` object below, bound into meta_sha256
// like the price and seats, so it cannot be changed after the screen is shown. The answer is a TYPED amount: the person's text goes through parseCapInput HERE, against the ceiling bound in `cap`, and the normalized dollars
// and the integer micro-dollars are written on `gate_answered` from that parse - never from a caller's argument. An approval without typed text is refused by answerGate itself, so no channel (the terminal, an MCP dialog, a later
// caller) can approve with a bare yes. The use is `cap_consumed`, single-use for ever (consumeRunCap); continuing a run under its consumed cap is the read-only runCapAuthority.
export const RUN_CAP_KIND = 'run_cap';
// `start` a main run; `resume_legacy` a resume of a run made before the typed cap; `tree_start` a tree's root cap; `side:<verb>` a replay, rematch, handoff, contract draft or digest start (a new logical run).
// T4b (14 Oct 2026): a run may carry a SEQUENCE of consumptions. The first is one of the five above; every later one is `raise` (a new typed TOTAL after a budget stop) or `amend_scope` (a new typed total after the scope the first
// limit was typed under changed, a recorded amendment among others). One typed limit still has ONE spender: a GATE is consumed once (gate_used); a RUN's limit in force is its LAST consumption (runCapAuthority).
export const CAP_OPERATION = /^(start|resume_legacy|tree_start|raise|amend_scope|side:[a-z][a-z-]{0,23})$/;
const LATER_OPERATION = /^(raise|amend_scope)$/;
const CAP_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CAP_KEYS = ['ceiling_source', 'ceiling_usd', 'operation', 'run_id', 'scope_sha256'];
function capProblem(cap) {
  if (!cap || typeof cap !== 'object' || Array.isArray(cap) || Object.keys(cap).sort().join() !== CAP_KEYS.join()) return ['bad_cap', `a run_cap gate needs cap = { ${CAP_KEYS.join(', ')} } and nothing else`];
  if (typeof cap.operation !== 'string' || !CAP_OPERATION.test(cap.operation)) return ['bad_cap', 'cap.operation must be start, resume_legacy, tree_start or side:<verb>'];
  if (typeof cap.run_id !== 'string' || !CAP_RUN_ID.test(cap.run_id)) return ['bad_cap', 'cap.run_id must be the run id the limit is typed for'];
  if (typeof cap.scope_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(cap.scope_sha256)) return ['bad_cap', 'cap.scope_sha256 must be a sha256 hex digest of what the run will do (capScopeSha256)'];
  if (cap.ceiling_usd !== null && !(typeof cap.ceiling_usd === 'number' && Number.isFinite(cap.ceiling_usd) && cap.ceiling_usd > 0)) return ['bad_cap', 'cap.ceiling_usd must be null or a number above 0'];
  if (cap.ceiling_source !== null && !isStr(cap.ceiling_source)) return ['bad_cap', 'cap.ceiling_source must be null or a short string'];
  // Pairing (C&C ruling, 14 Oct 2026): both null is the honest "no ceiling known"; a figure with no named origin, or an origin with no figure, is refused. A closed list of sources is a T5 obligation (B_STATE follow-up list).
  if ((cap.ceiling_usd === null) !== (cap.ceiling_source === null)) return ['bad_cap', 'cap.ceiling_usd and cap.ceiling_source must both be null or both be set'];
  return null;
}
/** sha256 of the canonical JSON of what a run will do (task file hash, chain file hash, seats, policy hash, sensitivity floor, PII mode, the ceiling in force...). The caller assembles the object; this is the one hash both the request and the consumption use. */
// A non-finite number in the scope THROWS (finiteOnly, above): a NaN ceiling would otherwise hash like "no ceiling" and the stale-screen check could not tell them apart.
export const capScopeSha256 = scope => sha256Hex(canonical(JSON.parse(JSON.stringify(scope, finiteOnly))));

function capAnswerProblem(answered, cap) {
  if (typeof answered.cap_usd !== 'string' || !Number.isInteger(answered.cap_micro_usd)) return 'cap_answer_unreadable';
  const parsed = parseCapInput(answered.cap_usd, { ceilingUsd: cap.ceiling_usd, ceilingSource: cap.ceiling_source, paid: true });
  return parsed.ok && parsed.capUsd === answered.cap_usd && parsed.capMicroUsd === answered.cap_micro_usd ? null : 'cap_answer_inconsistent';
}

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
export function requestGate(runDir, { kind, textPath, price = null, seats = [], sensitivity = null, masks = {}, follow_up, cap, expiresAt, requestedBy } = {}, { now = () => Date.now() } = {}) {
  if (requestedBy !== undefined && requestedBy !== 'session') return refuse('bad_requester', 'a gate is requested by the session or, when nothing is said, by a person');
  if (typeof kind !== 'string' || !KIND.test(kind)) return refuse('bad_kind', 'the gate kind must be a short lowercase name');
  const where = textInside(runDir, textPath);
  if (!where) return refuse('text_outside_run', 'the gate text must be a file inside the run folder');
  let meta;
  try { meta = asWritten({ price, seats, sensitivity, masks, follow_up, cap }); }
  catch (e) { return e instanceof NonFiniteError ? refuse('bad_number', `${e.message}; every amount and count in a gate must be an ordinary number`) : refuse('bad_price', 'the price, seats, sensitivity and masks must be plain JSON data'); }
  const problem = metaProblem(meta) ?? (kind === RUN_CAP_KIND ? capProblem(meta.cap) : (meta.cap !== undefined ? ['bad_cap', 'only a run_cap gate takes cap'] : null));
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
      // REQUESTER MARK (6d, 19 Okt): only a gate the SESSION asked for may be answered by the session; absent = a person's (every older line). On the hash-chained ledger line, not in the view file.
      const line = append('gate_requested', { gate: id, kind, text: record.text, sha256: record.sha256, bytes: record.bytes, meta_sha256: record.meta_sha256, expires_at: record.expires_at, ...(requestedBy === 'session' ? { requested_by: 'session' } : {}) });
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
// metaSha256 refuses a non-finite number, and a gate file edited to hold 1e999 PARSES as Infinity: that reads as a changed record, never as a crash (a throw here would leave the reader without an answer).
const metaHashOrNull = rec => { try { return metaSha256(rec); } catch (e) { if (e instanceof NonFiniteError) return null; throw e; } };
function stateOf(runDir, id, lines, t) {
  const requested = lines.find(l => l.event === 'gate_requested' && l.gate === id);
  if (!requested) return { status: 'invalid', reason: 'gate_not_found' };
  const record = readRecord(runDir, id);
  if (!record) return { status: 'invalid', reason: 'gate_record_unreadable' };
  const mismatch = { status: 'invalid', reason: 'gate_record_mismatch' };
  if (record.sha256 !== requested.sha256 || record.text !== requested.text || record.expires_at !== requested.expires_at
    || record.kind !== requested.kind || record.seq !== requested.seq) return mismatch;
  // What the person is told (price, seats, sensitivity, masks, follow_up) is bound to the ledger too.
  if (record.meta_sha256 !== requested.meta_sha256 || metaHashOrNull(record) !== requested.meta_sha256) return mismatch;
  // 0.8.3 M6 T3: a run_cap gate carries its pending decision (`cap`) in the bound metadata; any other kind carries none.
  const isCap = requested.kind === RUN_CAP_KIND;
  if (isCap ? capProblem(record.cap) : record.cap !== undefined) return mismatch;
  const answered = lines.find(l => l.event === 'gate_answered' && l.gate === id);
  if (!answered) {
    // A file that claims an answer the ledger does not hold was edited by hand: trust neither.
    if (record.status !== 'pending' || record.answer !== null) return mismatch;
    if (t >= Date.parse(record.expires_at)) return { status: 'expired', gate: record };
    return { status: 'pending', gate: record };
  }
  if (!DECISIONS.includes(answered.decision) || answered.sha256 !== requested.sha256 || answered.meta_sha256 !== requested.meta_sha256
    || !answeredOnAllowedChannel(answered.channel, requested.kind)
    || (answered.channel === SESSION_CHANNEL && requested.requested_by !== 'session')) return mismatch;
  // The typed amount: present, consistent and inside the bound ceiling on an approved run_cap answer; on no other answer. (A consistent edit of BOTH fields on the LAST ledger line is not detected: the chain cannot see it, decided rule 9.)
  if (isCap && answered.decision === 'approved' ? capAnswerProblem(answered, record.cap) : (Object.hasOwn(answered, 'cap_usd') || Object.hasOwn(answered, 'cap_micro_usd'))) return mismatch;
  // The view either lags the ledger (a crash before it was rewritten: still pending, no answer) or agrees
  // with it exactly. Anything else is an edit of one of the two (M3 review M1: an edited last line).
  const lagging = record.status === 'pending' && record.answer === null;
  const agrees = record.status === answered.decision && record.answer && record.answer.decision === answered.decision
    && record.answer.seq === answered.seq && record.answer.channel === answered.channel
    && (!isCap || answered.decision !== 'approved' || (record.answer.cap_usd === answered.cap_usd && record.answer.cap_micro_usd === answered.cap_micro_usd));
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
    const used = ledger.lines.some(l => USE_EVENTS.includes(l.event) && l.gate === gateId);
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
export function answerGate(runDir, gateId, { channel, shownSha256, decision, actor = null, reason = null, tty = null, typedCap, client = null } = {}, { now = () => Date.now() } = {}) {
  if (!PERSON_CHANNELS.includes(channel) && channel !== SESSION_CHANNEL) return refuse('channel_not_person', `a gate is answered only through a channel a person uses (${PERSON_CHANNELS.join(', ')}), not ${JSON.stringify(channel)}`);
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
      if (channel === SESSION_CHANNEL) {
        if (!SESSION_ELIGIBLE_KINDS.includes(record.kind)) return refuse('channel_not_session_eligible', `a ${record.kind} gate is answered only by a person (${PERSON_CHANNELS.join(' or ')}): the session may answer ${SESSION_ELIGIBLE_KINDS.join(' and ')} gates only`);       // B-DRAFT
        if (lines.find(l => l.event === 'gate_requested' && l.gate === gateId)?.requested_by !== 'session') return refuse('gate_not_session_requested', `gate ${gateId} was asked for by a person: only the person answers it (the session answers a gate it asked for itself)`);       // B-DRAFT
        if (typeof reason !== 'string' || !reason.trim()) return refuse('session_reason_required', 'the session answers a gate with its written reason: none was given');       // B-DRAFT
      }
      const shown = typeof shownSha256 === 'string' ? shownSha256.slice(0, 12) : 'none';
      if (shownSha256 !== record.sha256) return refuse('hash_mismatch', `the text shown (${shown}) is not the text of gate ${gateId} (${record.sha256.slice(0, 12)})`);
      if (decision === 'approved') {
        const bytes = readGateText(runDir, record.text);
        const nowSha = bytes ? textSha256(bytes) : null;
        if (nowSha !== record.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed on disk since it was shown (recorded ${record.sha256.slice(0, 12)}, on disk ${nowSha ? nowSha.slice(0, 12) : 'missing'})`);
      }
      // A run_cap approval is a TYPED amount (the typed-cap page, section 3): the text a person typed is parsed here against the ceiling bound in the gate, and the dollars written are the parse's. Never a caller's figure; no bare yes.
      let capFields = {};
      if (record.kind === RUN_CAP_KIND && decision === 'approved') {
        if (typeof typedCap !== 'string') return refuse('cap_required', `gate ${gateId} asks for a limit in US dollars: approving it means typing one. Nothing was recorded.`);
        const parsed = parseCapInput(typedCap, { ceilingUsd: record.cap.ceiling_usd, ceilingSource: record.cap.ceiling_source, paid: true });
        if (!parsed.ok) return refuse(`cap_${parsed.code}`, parsed.sentence);
        capFields = { cap_usd: parsed.capUsd, cap_micro_usd: parsed.capMicroUsd };
        if (channel === 'elicitation' && client && typeof client === 'object') {
          const cn = typeof client.name === 'string' ? client.name.slice(0, 100) : null; const cv = typeof client.version === 'string' ? client.version.slice(0, 100) : null;
          if (cn) capFields.client_name = cn;
          if (cv) capFields.client_version = cv;
        }
      } else if (typedCap !== undefined) return refuse('cap_not_asked', `gate ${gateId} does not ask for a typed limit with this answer. Nothing was recorded.`);
      const line = append('gate_answered', { gate: gateId, decision, sha256: record.sha256, meta_sha256: record.meta_sha256, channel, actor, reason, tty, ...capFields });
      const answered = { ...record, status: decision, answer: { decision, channel, actor, reason, tty, at: line.ts, seq: line.seq, ...(capFields.cap_usd ? { cap_usd: capFields.cap_usd, cap_micro_usd: capFields.cap_micro_usd } : {}) } };
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
export function recordSent(runDir, gateId, fields = {}, opts = {}) {
  return recordUse(runDir, gateId, 'sent', fields, opts);
}

/**
 * The one writer of a line that uses up an approval: `sent` (through recordSent), `contract_locked` and `amend_decided` (0.8.2 item 6d). The same refusals as recordSent, and the same guarantees: the
 * gate is approved, usable, unused, and its text still hashes to the approved hash, all checked under the ledger lock, so one approval is one use. `before({ gate, lines })` (optional) runs under
 * the same lock after those checks and before the line is appended: it may refuse with { code, message } (nothing is appended), and it is where the contract's record file is written, so the file and
 * the line are made under one lock, file first (a crash between the two leaves a file with no line, which `council contract check` reports and which has no authority).
 */
export function recordUse(runDir, gateId, event, fields = {}, { now = () => Date.now(), before = null } = {}) {
  if (!USE_EVENTS.includes(event)) return refuse('bad_event', `${JSON.stringify(event)} does not use an approval`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const t = now();
      const state = stateOf(runDir, gateId, lines, t);
      if (state.status === 'invalid') return refuse(state.reason, `gate ${gateId} cannot be trusted (${state.reason})`);
      if (state.status !== 'approved') return refuse(state.status === 'expired' ? 'gate_expired' : 'gate_not_approved', `gate ${gateId} is ${state.status}, not approved`);
      if (lines.some(l => USE_EVENTS.includes(l.event) && l.gate === gateId)) return refuse('gate_used', `gate ${gateId} was already used; one approval covers one use`);
      if (t >= Date.parse(state.gate.expires_at)) return refuse('gate_expired', `the approval of gate ${gateId} lapsed at ${state.gate.expires_at}`);
      const bytes = readGateText(runDir, state.gate.text);
      if (!bytes || textSha256(bytes) !== state.gate.sha256) return refuse('hash_mismatch', `the text of gate ${gateId} changed after it was approved`);
      if (before) { const refused = before({ gate: state.gate, lines }); if (refused) return refuse(refused.code, refused.message); }
      const line = append(event, { ...fields, gate: gateId, sha256: state.gate.sha256 });
      return { ok: true, seq: line.seq };
    }, { now });
  } catch (err) {
    return refusalFor(err);
  }
}

/**
 * The line that records a person's REFUSAL against a request that went through a gate: `amend_decided` with decision "declined" (0.8.2 item 6d). Written only when the gate reads `declined` (a person's
 * channel declined it), under the ledger lock; `before({ lines })` may refuse (the request must still be open). It is the counterpart of recordUse, so the contract's ledger events stay written by this module.
 * -> { ok: true, seq } | { ok: false, code, message }
 */
export function recordDeclined(runDir, gateId, event, fields = {}, { now = () => Date.now(), before = null } = {}) {
  if (event !== 'amend_decided') return refuse('bad_event', `${JSON.stringify(event)} does not record a refusal`);
  if (typeof gateId !== 'string' || !GATE_ID.test(gateId)) return refuse('gate_not_found', `no gate ${JSON.stringify(gateId)}`);
  try {
    return withLedger(runDir, ({ lines, append }) => {
      const state = stateOf(runDir, gateId, lines, now());
      if (state.status !== 'declined') return refuse('gate_not_declined', `gate ${gateId} is ${state.status}; a refusal is recorded only after a person declined its gate`);
      if (before) { const refused = before({ gate: state.gate, lines }); if (refused) return refuse(refused.code, refused.message); }
      const line = append(event, { ...fields, decision: 'declined', gate: gateId });
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

/**
 * Uses up an approved `run_cap` gate for ONE run: one `cap_consumed` line, under the ledger lock (typed-cap page section 3). Strictly single-use PER GATE: any second consume of the same gate fails (`gate_used`), whatever the run id - a crashed
 * start is re-answered by a new gate, and continuing a run under its cap is runCapAuthority's read-only job (never a second consume of the same gate). T4b: a RUN may carry a sequence of consumptions (first start | resume_legacy | ..., later raise | amend_scope, each gate requested after the previous consumption); `committedMicroUsd` is what the cap will already count (the caller's figure) and a total not above it is refused (below_exposure). Refuses, appending nothing: cap_copied (the run id is not the one the limit was typed for),
 * cap_stale (the scope rebuilt now, `capScopeSha256` of what the run will do, is not the one the person was shown), not_run_cap, and recordUse's own (gate_not_approved, gate_expired, gate_used, hash_mismatch ...).
 * -> { ok: true, seq, gate, runId, capUsd, capMicroUsd } | { ok: false, code, message }
 */
export function consumeRunCap(runDir, gateId, { runId, scopeSha256, committedMicroUsd = 0 } = {}, { now = () => Date.now() } = {}) {
  const st = readGateAnswer(runDir, gateId, { now });
  if (st.gate && st.gate.kind !== RUN_CAP_KIND) return refuse('not_run_cap', `gate ${gateId} is a ${st.gate.kind} gate, not a limit for a run`);
  // The figure is read BEFORE the lock, so the pre-read must already be an approval (a use line is never written with no figure), and the locked ledger must still hold that very figure (checked in `before`).
  if (st.status === 'invalid') return refuse(st.reason, `gate ${gateId} cannot be trusted (${st.reason})`);
  if (st.status !== 'approved') return refuse(st.status === 'expired' ? 'gate_expired' : 'gate_not_approved', `gate ${gateId} is ${st.status}, not approved`);
  const answered = st.answer;
  const res = recordUse(runDir, gateId, 'cap_consumed', { run_id: runId, cap_micro_usd: answered.cap_micro_usd }, {
    now,
    before: ({ gate, lines }) => {
      if (gate.kind !== RUN_CAP_KIND) return { code: 'not_run_cap', message: `gate ${gateId} is a ${gate.kind} gate, not a limit for a run` };
      const locked = lines.find(l => l.event === 'gate_answered' && l.gate === gateId);
      if (!locked || locked.cap_micro_usd !== answered.cap_micro_usd) return { code: 'cap_record_mismatch', message: `the answer of gate ${gateId} changed while it was being used; nothing was started` };
      if (gate.cap.run_id !== runId) return { code: 'cap_copied', message: `this limit was typed for run ${gate.cap.run_id}, not for run ${runId}, so it cannot start this run. Nothing was started.` };
      // T4b: the order of a run's consumptions. The first is never a raise or an amendment (there is nothing to raise); every later one is, and its gate must have been requested AFTER the previous consumption (a gate requested
      // earlier and used late asks about a state of the run that is gone). A repeated gate is gate_used (recordUse). 
      const prior = lines.filter(l => l.event === 'cap_consumed');
      const later = LATER_OPERATION.test(gate.cap.operation);
      if (!prior.length && later) return { code: 'cap_sequence', message: `gate ${gateId} raises or amends a limit, but this run has no limit to raise yet. Nothing was started.` };
      if (prior.length && !later) return { code: 'cap_sequence', message: `this run already has a limit; gate ${gateId} is a first limit, not a raise or an amendment. Nothing was started.` };
      if (prior.length) {
        const requested = lines.find(l => l.event === 'gate_requested' && l.gate === gateId);
        if (!requested || !(requested.seq > prior[prior.length - 1].seq)) return { code: 'cap_sequence_stale', message: `gate ${gateId} was requested before the run's latest limit was recorded, so it asks about a state of the run that is gone. Nothing was started; start again to see the current screen.` };
      }
      // A total is a total for the WHOLE run: not above what the cap will already count (the caller's figure; src/resume-ceiling.js for a budget stop), it could not carry the run one more call.
      if (committedMicroUsd > 0 && answered.cap_micro_usd <= committedMicroUsd) return { code: 'below_exposure', message: `the limit typed ($${answered.cap_usd}) is not above what this run has already counted ($${(committedMicroUsd / 1e6).toString()}), so it cannot carry the run any further. Nothing was started. Type a total above $${(committedMicroUsd / 1e6).toString()}.` };
      if (gate.cap.scope_sha256 !== scopeSha256) return { code: 'cap_stale', message: 'the task, the chain or the settings changed after the limit screen was shown, so the limit you typed no longer applies. Nothing was started. Start again to see the new screen.' };
      return null;
    },
  });
  return res.ok ? { ok: true, seq: res.seq, gate: gateId, runId, capUsd: answered.cap_usd, capMicroUsd: answered.cap_micro_usd } : res;
}

/**
 * The limit a run is authorized under: a READ of its ledger, never a write. { status: 'none' } (no cap consumed: a LEGACY run, which gets no synthesized approval) |
 * { status: 'ok', gate, runId, operation, capUsd, capMicroUsd, channel, actor, seq } | { status: 'invalid', reason }. Fails closed: a broken ledger, more than one `cap_consumed` line (two authorities),
 * a consumed gate that does not read approved (or whose screen text changed), a use line that disagrees with its gate (cap_record_mismatch), or - when `runId` is given - a use line for another run (cap_copied: a folder copied
 * or moved carries the original run's id). The caller (a resume) holds the run lock while it reads this; `cap_amended` (the tree budget record) is another reader's.
 */
export function runCapAuthority(runDir, { runId, now = () => Date.now() } = {}) {
  const ledger = readLedger(runDir);
  if (!ledger.ok) return { status: 'invalid', reason: 'gate_ledger_corrupt' };
  const used = ledger.lines.filter(l => l.event === 'cap_consumed');
  if (!used.length) return { status: 'none' };
  // T4b: a run's limit in force is its LAST consumption, and EVERY consumption must hold: its gate approved and unchanged, its use line agreeing with its gate, the run id right, and the sequence valid (the first is not a raise or an
  // amendment; every later one is, and its gate was requested after the previous consumption; a gate is never used twice). Any failure makes the whole run invalid (fail closed): a total that cannot be traced is no authority.
  let prev = null; let last = null; const seen = new Set();
  for (const u of used) {
    if (seen.has(u.gate)) return { status: 'invalid', reason: 'cap_consumed_more_than_once' };
    seen.add(u.gate);
    const st = stateOf(runDir, u.gate, ledger.lines, now());
    if (st.status !== 'approved' || st.gate.kind !== RUN_CAP_KIND) return { status: 'invalid', reason: st.status === 'invalid' ? st.reason : 'cap_gate_not_approved' };
    const bytes = readGateText(runDir, st.gate.text);
    if (!bytes || textSha256(bytes) !== st.gate.sha256) return { status: 'invalid', reason: 'hash_mismatch' };
    if (u.sha256 !== st.gate.sha256 || u.run_id !== st.gate.cap.run_id || u.cap_micro_usd !== st.answer.cap_micro_usd) return { status: 'invalid', reason: 'cap_record_mismatch' };
    if (runId !== undefined && u.run_id !== runId) return { status: 'invalid', reason: 'cap_copied' };
    if (prev && u.run_id !== prev.run_id) return { status: 'invalid', reason: 'cap_copied' };   // every consumption of one ledger is for ONE run
    const later = LATER_OPERATION.test(st.gate.cap.operation);
    if (!prev && later) return { status: 'invalid', reason: 'cap_sequence' };
    if (prev) {
      if (!later) return { status: 'invalid', reason: 'cap_sequence' };
      const requested = ledger.lines.find(l => l.event === 'gate_requested' && l.gate === u.gate);
      if (!requested || !(requested.seq > prev.seq)) return { status: 'invalid', reason: 'cap_sequence_stale' };
    }
    last = { gate: u.gate, runId: u.run_id, operation: st.gate.cap.operation, capUsd: st.answer.cap_usd, capMicroUsd: st.answer.cap_micro_usd, channel: st.answer.channel, actor: st.answer.actor, seq: u.seq, scopeSha256: st.gate.cap.scope_sha256 };
    prev = u;
  }
  return { status: 'ok', ...last, consumptions: used.length };
}
