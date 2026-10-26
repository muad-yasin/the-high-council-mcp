// The person's approval of a recursive-councils tree, through the existing gate (0.8.3 M5b; PLAN 8.2, 3). Nothing new decides anything here: this module writes the text a person will read under tree/, asks src/gate.js for a
// gate on the ROOT run folder (so `council gate answer <rootId> <gate>` finds it too), asks src/gate-cli.js to take the answer at a terminal, and reads the answer back with the rules a tree adds on top of the gate's own:
//   - only the channel `cli` approves a tree gate (the gate module also knows `elicitation`, a client's dialog; a tree refuses it), and the answer must have been given at a terminal (tty true);
//   - the person types the first characters of the frontier key before the y/N (the text's last line says which), so a stray "y" cannot approve what was not read;
//   - an approval is usable once, inside the gate's lifetime (ten minutes): `recordTreeUse` is the single place an approval is spent, and an expired or used gate approves nothing and writes nothing.
// This file reads no environment variable and no command-line argument: how a verb was asked is src/tree-cli.js's business, and nothing it is given can approve (test/tree-approve.test.js scans for that).
import { mkdirSync, openSync, closeSync, writeSync, fsyncSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { answerGateAsSession, readGateAnswer, readGateText, recordUse, requestGate, textSha256 } from './gate.js';
import { answerAtTerminal } from './gate-cli.js';
import { TREE_DIR } from './tree-record.js';

export const TREE_GATE_KINDS = Object.freeze({ frontier: 'tree_frontier', decide: 'tree_decide', check: 'tree_check' });
export const GATE_TEXT_DIR = 'gate-texts';
/** The use event each kind spends (src/gate.js USE_EVENTS). */
export const USE_EVENT_OF = Object.freeze({ tree_frontier: 'tree_frontier_approved', tree_decide: 'tree_decided', tree_check: 'tree_checked' });

/**
 * Writes the exact text (content-addressed under tree/gate-texts/, so asking twice for the same text is the same file) and requests a gate on the root run folder. -> { ok: true, gate } | { ok: false, code, message }.
 * `expiresAt` defaults to the gate's own ten minutes; `now` is injectable so a test needs no real wait.
 */
export function requestTreeGate(rootDir, { kind, text, requestedBy }, { now = () => Date.now(), expiresAt } = {}) {
  if (!Object.values(TREE_GATE_KINDS).includes(kind)) return { ok: false, code: 'bad_kind', message: `${JSON.stringify(kind)} is not a tree gate kind` };
  if (typeof text !== 'string' || !text) return { ok: false, code: 'text_empty', message: 'a tree gate needs the exact text a person will read' };
  const dir = join(rootDir, TREE_DIR, GATE_TEXT_DIR);
  mkdirSync(dir, { recursive: true });
  const rel = `${TREE_DIR}/${GATE_TEXT_DIR}/${kind}-${textSha256(Buffer.from(text, 'utf8')).slice(0, 16)}.txt`;
  const tmp = `${join(rootDir, rel)}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, join(rootDir, rel));
  return requestGate(rootDir, { kind, textPath: rel, ...(expiresAt === undefined ? {} : { expiresAt }), ...(requestedBy ? { requestedBy } : {}) }, { now });
}

/**
 * Takes the person's answer at a terminal (src/gate-cli.js answerAtTerminal: the whole text, then the typed prefix, then y/N; stdin AND stdout must be a terminal). `expectPrefix` is what must be typed; `decline`
 * records a refusal instead (declining is always allowed and needs no typing). Returns the terminal answer's exit code: 0 recorded, 1 not confirmed or refused (nothing written), 2 no terminal.
 */
export function askTreeGate(rootDir, gateId, { expectPrefix, typedLabel = null, decline = false, stdin, stdout, stderr, now, onNotApproved = null } = {}) {
  // the prompt does not repeat what must be typed: the text above says it, and reading it is the point. `typedLabel` names what is typed when it is not a frontier key's prefix (M5d: the new value, the amount, the node path).
  const typed = expectPrefix ? { expect: String(expectPrefix), prompt: typedLabel ? `Type ${typedLabel} shown in the last line above: ` : `Type the first ${String(expectPrefix).length} characters of the frontier key shown in the last line above: ` } : null;
  return answerAtTerminal(rootDir, gateId, { decline, typed, stdin, stdout, stderr, onNotApproved, ...(now ? { now } : {}) });
}

/** The PERSON's answer to the advice add-on's brief gate (a gate of kind `advice` in a run folder, not a tree gate): the same terminal answer, which keeps its terminal check. Kept here because this file is one of the few that may import gate-cli.js (ROADMAP 77, step 4b). */
export const askBriefAtTerminal = (runDir, gateId, { stdin, stdout, stderr, now } = {}) => answerAtTerminal(runDir, gateId, { startsRun: true, stdin, stdout, stderr, ...(now ? { now } : {}) });

/**
 * K10 (C2a-record commit 5): the channel a gate was answered on -> who answered, for the record (`actor`, `via`). `cli` is a person at a terminal (the caller checks the tty); `elicitation` is a person through a client dialog; any other channel is nobody's answer to a tree gate (null: the record never calls it a person's).
 * A gate itself is answered only on a person's channel (src/gate.js PERSON_CHANNELS); the session channel of Atomic_Tree_Budget_Gate_Page section 4 is not built, and when it is, it maps to { actor: 'session', via: 'mcp' } here.
 */
export function answeredByChannel(channel) {
  if (channel === 'session') return { actor: 'session', via: 'mcp' };       // the session channel (src/gate.js SESSION_CHANNEL): the written reason is the caller's to add (treeApproval does)
  if (channel === 'cli') return { actor: 'person', via: 'terminal' };
  if (channel === 'elicitation') return { actor: 'person', via: 'elicitation' };
  return null;
}

/**
 * Is this gate a tree approval that may still be acted on? { approved: true, gate, answer } or { approved: false, reason }. The gate's own `approved` is not enough: the answer must have come through the channel `cli`
 * at a terminal, the kind must be a tree kind, and the approval must be unused and unexpired.
 */
export function treeApproval(rootDir, gateId, { kind, now } = {}) {
  const s = readGateAnswer(rootDir, gateId, now ? { now } : {});
  if (s.status !== 'approved') return { approved: false, reason: s.status === 'invalid' ? `gate ${gateId} cannot be trusted (${s.reason})` : `gate ${gateId} is ${s.status}, not approved` };
  if (!Object.values(TREE_GATE_KINDS).includes(s.gate.kind) || (kind && s.gate.kind !== kind)) return { approved: false, reason: `gate ${gateId} is a ${s.gate.kind} gate, not ${kind ?? 'a tree gate'}` };
  const bySession = s.answer?.channel === 'session' && typeof s.answer?.reason === 'string' && s.answer.reason.trim() !== '';       // the session channel: no terminal, but a written reason; the TABLE decides per form whether a session answer is accepted
  if (!bySession && (s.answer?.channel !== 'cli' || s.answer?.tty !== true)) return { approved: false, reason: `gate ${gateId} was answered on channel ${JSON.stringify(s.answer?.channel)}${s.answer?.tty === true ? '' : ' without a terminal'}: a tree gate is approved only at a terminal, on channel cli` };
  if (s.used) return { approved: false, reason: `gate ${gateId} was already used; one approval covers one use` };
  if (!s.usable) return { approved: false, reason: `the approval of gate ${gateId} lapsed at ${s.usable_until}` };
  // K10 (C2a-record commit 5): WHO answered, read from THIS answer's channel and nowhere else (the ledger's own `actor` is the OS user name, src/gate-cli.js, and is not read)
  return { approved: true, gate: s.gate, answer: s.answer, answeredBy: { ...answeredByChannel(s.answer.channel), ...(bySession ? { reason: s.answer.reason.trim() } : {}) } };
}

/** Spends an approval: one `tree_frontier_approved` / `tree_decided` / `tree_checked` line in the gate ledger naming the gate (refused when the gate is used, expired, not approved or its text changed). -> { ok: true, seq, answeredBy: { actor, via } } | { ok: false, code, message }. */
export function recordTreeUse(rootDir, gateId, kind, fields = {}, { now } = {}) {
  const event = USE_EVENT_OF[kind];
  if (!event) return { ok: false, code: 'bad_kind', message: `${JSON.stringify(kind)} is not a tree gate kind` };
  // The gate would let an approval given on another channel be used; a tree never does: the tree's own reading comes first, here, so no caller can forget it.
  const a = treeApproval(rootDir, gateId, { kind, ...(now ? { now } : {}) });
  if (!a.approved) return { ok: false, code: 'not_a_tree_approval', message: a.reason };
  const used = recordUse(rootDir, gateId, event, fields, now ? { now } : {});
  return used.ok ? { ...used, answeredBy: a.answeredBy } : used;      // K10: the writers take who answered from THIS read, never from a caller of the verb
}

/**
 * The SESSION answers a tree gate it asked for (src/tree-decide-session.js): the gate must be pending, a tree_decide gate, hold the quoted hash, and its text on disk must still hash to it; then gate.js answers it on the session channel (kind, requester and
 * reason rules are the gate's). -> { ok: true } | { ok: false, message }. B-DRAFT sentences.
 */
export function answerTreeGateAsSession(rootDir, gateId, { shownSha256, reason }, { now } = {}) {
  const clock = now ? { now } : {};
  const g = readGateAnswer(rootDir, gateId, clock);
  if (g.status !== 'pending') return { ok: false, message: `gate ${gateId} is ${g.status === 'invalid' ? `unreadable (${g.reason})` : g.status}: ask again` };
  const bytes = readGateText(rootDir, g.gate.text);
  if (![TREE_GATE_KINDS.decide, TREE_GATE_KINDS.frontier].includes(g.gate.kind) || g.gate.sha256 !== shownSha256 || !bytes || textSha256(bytes) !== shownSha256) return { ok: false, message: `gate ${gateId} is not the quote of this text` };
  const ans = answerGateAsSession(rootDir, gateId, { shownSha256, reason }, clock);
  return ans.ok ? { ok: true } : { ok: false, message: `the gate refused the session's answer (${ans.code}): ${ans.message}` };
}
