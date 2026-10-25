// 0.8.3 M7 apply, C2a-record commit 5, K10 (plan + gate answer: Review/Build_0.8.3/m7/C2a_Commit5_K10_Plan_2026-10-18.md; C&C thcmcp-6d: plan PASS, defaults 4.1-4.6 accepted): WHO answered a gate-bound event.
// `actor` (person | session), `via` (terminal | elicitation | mcp) and, for the session, `reason` are REQUIRED on every new gate-bound event by ONE table function (answeredByRefusal), and the value comes from the one gate read that spends the approval
// (src/tree-gate.js: answeredByChannel -> treeApproval -> recordTreeUse), never from a caller of the verb. No gate-bound tree event can come from a session today (a gate is answered only on cli / elicitation, a tree gate only on cli at a terminal), so the
// SESSION rows are reachable only by events written through the real table; the PERSON values are proved on the real verbs (`council tree approve`, `council tree decide --abandon`). A record from before the field folds with `answeredBy: null` and reads
// 'unknown (before the field)', never as a person. $0. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as TR from '../src/tree-transitions.js';
import * as TG from '../src/tree-gate.js';
import { effectiveLimits } from '../src/tree-budget.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier, describeFrontier } from '../src/tree-frontier.js';
import { frontierKey } from '../src/tree-identity.js';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { FIXTURE_BOUND, GATE_FIELDS, ROOT_ID, SPLIT, closedRootTree, root } from './helpers/tree-fixture.js';
import { prefixOf } from '../src/tree-stop.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

// a namespace import, so that a missing export (the base of this commit, for the red run) fails the tests that call it and not the whole file at link time
const { answeredByRefusal, answeredByPhrase, foldRecord, transitionRefusal } = TR;
const { answeredByChannel } = TG;
const GF = { gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256 };          // the gate fields WITHOUT who answered
const PERSON = { actor: 'person', via: 'terminal' };
const SESSION = { actor: 'session', via: 'mcp', reason: 'the named conditions hold' };
const WHO = /records who gave it/, CHANNEL = /names its channel/, PERSON_ONLY = /person's only/, REASON = /carries its written reason/;
const why = (st, e) => transitionRefusal(st, e)?.reason ?? '';        // the table answers null or { code, transition, reason }
const refusalOf = fn => { try { fn(); return null; } catch (e) { if (e && typeof e.reason === 'string') return e.reason; throw e; } };
const tree = () => { const t = closedRootTree(); track(t.work); return t; };

test('K10 the validator: a missing or unknown actor, a channel the actor cannot use, a session where only a person may answer, and a session without its reason are refused; everything else passes', () => {
  assert.match(answeredByRefusal({}), WHO);
  assert.match(answeredByRefusal({ actor: 'sitting', via: 'terminal' }), WHO, 'the sitting is a system record, never an answer');
  assert.match(answeredByRefusal({ actor: 'agent', via: 'mcp' }), WHO);
  assert.match(answeredByRefusal({ actor: 'person' }), CHANNEL);
  assert.match(answeredByRefusal({ actor: 'person', via: 'mcp' }), CHANNEL, 'a person does not answer through the session channel');
  assert.match(answeredByRefusal({ actor: 'session', via: 'terminal', reason: 'r' }, { sessionAllowed: true }), CHANNEL);
  assert.match(answeredByRefusal(SESSION), PERSON_ONLY, 'the default is a person\'s answer only');
  assert.match(answeredByRefusal({ ...SESSION, reason: '  ' }, { sessionAllowed: true }), REASON);
  assert.match(answeredByRefusal({ actor: 'session', via: 'mcp' }, { sessionAllowed: true }), REASON);
  assert.equal(answeredByRefusal(PERSON), null);
  assert.equal(answeredByRefusal({ actor: 'person', via: 'elicitation' }), null);
  assert.equal(answeredByRefusal(SESSION, { sessionAllowed: true }), null);
});

test('K10 the channel of a gate answer maps to who answered: cli is a person at the terminal, elicitation a person through a dialog, anything else is nobody\'s answer (null, so the record never calls it a person\'s)', () => {
  assert.deepEqual(answeredByChannel('cli'), { actor: 'person', via: 'terminal' });
  assert.deepEqual(answeredByChannel('elicitation'), { actor: 'person', via: 'elicitation' });
  for (const other of ['mcp', 'ui', '', undefined, null]) assert.equal(answeredByChannel(other), null, `${JSON.stringify(other)} is not a person's channel`);
  // session channel (EDITED, disclosed; OLD: 'session' was nobody's answer): the gate's session channel is the session via mcp
  assert.deepEqual(answeredByChannel('session'), { actor: 'session', via: 'mcp' });
});

test('K10 the rows, on the real table: a gate-bound event without actor/via is refused, the session is refused where only a person may answer, and a person at the terminal passes (abandon, cap amendment, raised limit; the two plain records only once they claim a gate)', () => {
  // tree_abandoned (final, so each case gets its own tree)
  assert.match(refusalOf(() => appendTreeEvent(tree().rootDir, { event: 'tree_abandoned', ...GF })), WHO);
  assert.match(refusalOf(() => appendTreeEvent(tree().rootDir, { event: 'tree_abandoned', ...GF, ...SESSION })), PERSON_ONLY);
  assert.match(refusalOf(() => appendTreeEvent(tree().rootDir, { event: 'tree_abandoned', ...GF, actor: 'person', via: 'mcp' })), CHANNEL);
  const ok = tree(); appendTreeEvent(ok.rootDir, { event: 'tree_abandoned', ...GF, ...PERSON });
  assert.equal(stateOf(readTreeRecord(ok.rootDir)).abandoned.eventId, readTreeRecord(ok.rootDir).events.at(-1).id);
  // cap_amended, limit_raised (a person's: a new total, a raised ceiling)
  const cap = { event: 'cap_amended', fromCapUsd: 100, toCapUsd: 150, expectedRevision: 1, ...GF };
  const t = tree();
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, cap)), WHO);
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { ...cap, ...SESSION })), PERSON_ONLY);
  assert.equal(refusalOf(() => appendTreeEvent(t.rootDir, { ...cap, ...PERSON })), null);
  const lim = { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 3, to: 5, ...GF };
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, lim)), WHO);
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { ...lim, ...SESSION })), PERSON_ONLY);
  assert.equal(refusalOf(() => appendTreeEvent(t.rootDir, { ...lim, ...PERSON })), null);
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 5, to: 6 })), WHO, 'a bare line raises the ceiling too (effectiveLimits reads any limit_raised), so it says who answered as well');
  // the two plain records: a person's answer only once they claim a gate
  const st = stateOf(readTreeRecord(t.rootDir));
  for (const e of [{ event: 'accounting_accepted', reservationIds: ['r:1'], ...GF }, { event: 'integration_recorded', agreement: 'R:A1', result: 'pass', ...GF, bound: {} }]) {
    assert.match(why(st, e), WHO, e.event);
    assert.match(why(st, { ...e, ...SESSION }), PERSON_ONLY, e.event);
    assert.equal(transitionRefusal(st, { ...e, ...PERSON }), null, e.event);
    const { gateId, shownSha256, ...bare } = e;
    assert.equal(transitionRefusal(st, bare), null, `${e.event} without a gate claims nothing`);
  }
});

test('K10 a frontier approval: it says who answered; the session may answer a split frontier with its reason (inside the typed cap, A\'s section 4) and nothing else', () => {
  const t = tree();
  const children = [{ node: 'R/M1', generation: 1 }];
  const key = frontierKey({ parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy: null, children });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, children, boundSha256: FIXTURE_BOUND });
  const approval = { event: 'frontier_approved', ...GF, frontierKey: key, revision: 1, boundSha256: FIXTURE_BOUND };
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, approval)), WHO);
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { ...approval, actor: 'session', via: 'mcp' })), REASON);
  // EDITED, disclosed (OLD: the session approval carried only who and why): the session channel's frontier approval also carries the figures it saw (sessionConditions)
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { ...approval, ...SESSION })), /carries the figures it saw/);
  assert.equal(refusalOf(() => appendTreeEvent(t.rootDir, { ...approval, ...SESSION, sessionConditions: { availableUsd: 10, grantsUsd: 4, unknownSpendHeldUsd: 0 } })), null, 'the session answered a split frontier with its written reason and its figures');
  const f = stateOf(readTreeRecord(t.rootDir)).frontiers.get(key);
  assert.deepEqual(f.approvals.at(-1).answeredBy, { actor: 'session', via: 'mcp', reason: SESSION.reason });
  assert.equal(answeredByPhrase(f.approvals.at(-1)), 'the session (reason: the named conditions hold)');
  appendTreeEvent(t.rootDir, { ...approval, revision: 2, ...PERSON });
  assert.equal(answeredByPhrase(stateOf(readTreeRecord(t.rootDir)).frontiers.get(key).approvals.at(-1)), 'a person at the terminal');
});

// ---- the rows that need a record state: a stop to answer, a node stopped at its budget. Raw events, folded (as test/tree-supersession-adopted.test.js does).
const G = { gateId: 'g', shownSha256: '0'.repeat(64) };
const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, ...PERSON, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status, share: 'released' });
const BASE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1)];
const STOPPED = [...BASE, { id: 'e5', event: 'node_stopped', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', reason: 'budget' }];
const CLOSED = [...BASE, closed('e5', 'R/M1', 1, 'needs_decision'), { id: 'e6', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] }];

test('K10 a top-up and a decision that answers a stop are a person\'s only (EDITED, disclosed; OLD: the session MAY answer a top-up with its reason; WHY: Muad 14 Okt 12:22, "a top-up or cap raise stays typed", 6d ruling 19 Okt): without actor/via they are refused, a session answer is refused, a person\'s is accepted', () => {
  const top = { event: 'grant_issued', node: 'R/M1', generation: 1, amount: 2, unit: 'usd', ...G };
  const s1 = foldRecord(STOPPED);
  assert.match(why(s1, top), WHO);
  assert.match(why(s1, { ...top, actor: 'session', via: 'mcp' }), PERSON_ONLY, 'a session top-up is refused with or without a reason: money stays typed');
  assert.match(why(s1, { ...top, ...SESSION }), PERSON_ONLY, 'the session may not give a top-up, reason or not');
  assert.equal(transitionRefusal(s1, { ...top, ...PERSON }), null);
  const dec = { event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: 'e6', ...G };
  const s2 = foldRecord(CLOSED);
  assert.match(why(s2, dec), WHO);
  // session channel (EDITED, disclosed; OLD: any decision that answers a stop was a person's only): the session may answer a SUB-PLAN regenerate, with its written reason; a ROOT re-plan and an OBLIGATION decision stay a person's
  assert.equal(transitionRefusal(s2, { ...dec, ...SESSION, planMode: 'fresh' }), null, 'the session may answer a sub-plan regenerate with its reason and its planMode');
  assert.match(why(s2, { ...dec, ...SESSION }), /planMode fresh or data .* no default/, 'a session regenerate states planMode (6d: no default between data and fresh)');
  assert.match(why(s2, { ...dec, actor: 'session', via: 'mcp' }), REASON, 'and not without it');
  assert.match(why(s2, { ...dec, ...SESSION, replansRoot: true }), PERSON_ONLY, 'a root re-plan is a person\'s');
  assert.match(why(s2, { ...dec, ...SESSION, obligation: 'C1' }), PERSON_ONLY, 'an obligation decision is a person\'s');
  assert.equal(transitionRefusal(s2, { ...dec, ...PERSON }), null);
});

test('K10 a person\'s close of a node (node_closed, incomplete): it says who answered, the session cannot give it (C&C 6d condition 7: a row of its own)', () => {
  const REGISTERED = BASE.filter(e => e.id !== 'e4b');          // R/M1 registered, never started
  const close = { event: 'node_closed', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', outcome: 'incomplete', passed: false, status: null, share: 'released', returnedUsd: 0, planCopy: null, ...G };
  const st = foldRecord(REGISTERED);
  assert.match(why(st, close), WHO);
  assert.match(why(st, { ...close, ...SESSION }), PERSON_ONLY);
  assert.equal(transitionRefusal(st, { ...close, ...PERSON }), null, 'control: with who answered the close passes');
});

test('K10 an OLD record that holds a bare limit_raised line still folds and loads, and the line still raises the ceiling (the strict rule judges only a NEW event; replay is unaffected)', () => {
  const bare = { id: 'e9', event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 3, to: 99 };
  assert.doesNotThrow(() => foldRecord([...BASE, bare]));
  const t = tree();
  const next = Math.max(...readTreeRecord(t.rootDir).events.map(e => Number(e.id.slice(1)))) + 1;
  appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', ...bare, id: `e${next}`, at: new Date().toISOString() })}\n`);
  const rec = readTreeRecord(t.rootDir);
  assert.equal(rec.corrupt.length, 0, 'the bare line is a well formed record');
  assert.equal(effectiveLimits(rec.tree, rec.events).maxChildrenPerSplit, 99, 'and it raises the limit as it always did');
  assert.match(refusalOf(() => appendTreeEvent(t.rootDir, { event: 'limit_raised', limit: 'maxChildrenPerSplit', from: 99, to: 120 })), WHO, 'while a NEW bare line is refused');
});

test('K10 the real verbs: `council tree approve` and `council tree decide --abandon` record actor person / via terminal that the caller never passed; the same events stripped of who answered are refused by the table; the fold and the phrase read it back', async () => {
  // approve (a real root with a pending frontier, as test/tree-approval-text-compat.test.js drives it)
  const r = await trackedRealRoot();
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const io = terminal([prefixOf(d.frontierKey), 'y']);
  assert.equal(await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }), 0, io.shown() + io.errors());
  const events = readTreeRecord(r.t.rootDir).events;
  const ev = events.find(e => e.event === 'frontier_approved');
  const before = foldRecord(events.slice(0, events.indexOf(ev)));         // the record as it stood just before the approval (the preview is in it)
  assert.deepEqual([ev.actor, ev.via], ['person', 'terminal']);
  assert.equal(ev.reason, undefined);
  const { actor, via, ...stripped } = ev;
  assert.match(why(before, stripped), WHO, 'the same approval without who answered is refused');
  const folded = stateOf(readTreeRecord(r.t.rootDir)).frontiers.get(ev.frontierKey);
  assert.deepEqual(folded.approvals.at(-1).answeredBy, { actor: 'person', via: 'terminal', reason: null });
  assert.equal(answeredByPhrase(folded.approvals.at(-1)), 'a person at the terminal');
  // abandon (a person's only)
  const a = await trackedRealRoot();
  const io2 = terminal([ROOT_ID, 'y']);
  assert.equal(await decideHandler({ rootDir: a.t.rootDir, rootId: ROOT_ID, flags: { abandon: true }, work: a.t.work, stdin: io2.stdin, stdout: io2.stdout, stderr: io2.stderr, now: () => Date.now() }), 0, io2.shown() + io2.errors());
  const eventsA = readTreeRecord(a.t.rootDir).events;
  const ab = eventsA.find(e => e.event === 'tree_abandoned');
  const beforeA = foldRecord(eventsA.slice(0, eventsA.indexOf(ab)));
  assert.deepEqual([ab.actor, ab.via], ['person', 'terminal']);
  const { actor: _a, via: _v, ...abStripped } = ab;
  assert.match(why(beforeA, abStripped), WHO);
  assert.match(why(beforeA, { ...abStripped, ...SESSION }), PERSON_ONLY);
  assert.equal(transitionRefusal(beforeA, ab), null, 'control: the event as the verb wrote it passes the table');
});

test('K10 GOLDEN pre-field record: events written before the field fold unchanged, `answeredBy` is null and reads \'unknown (before the field)\' (never a person), the record still loads from disk, and the next ordinary event appends', () => {
  const noWho = BASE.map(e => (e.event === 'frontier_approved' ? { ...e, actor: undefined, via: undefined } : e));
  const st = foldRecord([...noWho, { id: 'e5', event: 'node_stopped', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', reason: 'budget' }]);
  const approval = st.frontiers.get('kA').approvals.at(-1);
  assert.equal(approval.answeredBy, null);
  assert.equal(answeredByPhrase(approval), 'unknown (before the field)');
  assert.doesNotMatch(answeredByPhrase(approval), /person/);
  assert.equal(answeredByPhrase(undefined), 'unknown (before the field)');
  const dec = foldRecord([...CLOSED, { id: 'e7', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: 'e6', ...G }]).decisions.get('e7');
  assert.equal(dec.answeredBy, null);
  assert.equal(answeredByPhrase(dec), 'unknown (before the field)');
  // on disk: a pre-field approval line written the way an older version wrote it (bypassing today's table) loads without damage, and the next ordinary event appends
  const t = tree();
  const children = [{ node: 'R/M1', generation: 1 }];
  const key = frontierKey({ parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, openedBy: null, children });
  appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: key, parentNode: 'R', parentGeneration: 1, parentRunId: ROOT_ID, splitSha256: SPLIT, children, boundSha256: FIXTURE_BOUND });
  const next = Math.max(...readTreeRecord(t.rootDir).events.map(e => Number(e.id.slice(1)))) + 1;
  appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', id: `e${next}`, event: 'frontier_approved', ...GF, frontierKey: key, revision: 1, boundSha256: FIXTURE_BOUND, at: new Date().toISOString() })}\n`);
  const rec = readTreeRecord(t.rootDir);
  assert.equal(rec.corrupt.length, 0, 'the pre-field line is a well formed record');
  assert.equal(stateOf(rec).frontiers.get(key).approvals.at(-1).answeredBy, null);
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'continuation_refused', scope: 'tree', check: 'k10-golden', detail: 'the next ordinary event after a pre-field record' });
  assert.equal(readTreeRecord(t.rootDir).events.at(-1).event, 'blocked');
});

// ---- CALL-SITE COMPLETENESS BY TOOLING (C&C thcmcp-6d, condition 1): requiring actor/via on append turns a writer that forgets it into a hard refusal in a real run. This scans src/ for every append of a gate-bound kind.
const ALWAYS = ['frontier_approved', 'grant_issued', 'cap_amended', 'tree_abandoned', 'node_closed_unstarted', 'bundle_input_allowed', 'decision_recorded', 'limit_raised', 'integration_recorded', 'accounting_accepted', 'price_answered', 'stop_deferred', 'stop_draft_written', 'stop_draft_change_asked'];
const WITH_GATE_ONLY = ['node_closed', 'needs_decision_opened'];          // only the lines that carry a gate are a person's answer (the sitting writes the others)
/** -> [{ kind, line }] of the gate-bound appends in `text` that do not hand actor AND via (or the object `base` that carries them) to the writer. */
function missingWho(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!/appendTreeEvent(?:Locked)?\(/.test(line)) continue;
    const m = /event: '([a-z_]+)'/.exec(line); if (!m) continue;
    const kind = m[1];
    const gated = ALWAYS.includes(kind) || (WITH_GATE_ONLY.includes(kind) && /\bgateId\b/.test(line));
    if (gated && !(/\bactor\b[^}]*\bvia\b/.test(line) || /\.\.\.used\.answeredBy|\.\.\.base\b/.test(line))) out.push({ kind, line: line.trim().slice(0, 120) });
  }
  return out;
}
test('K10 call-site completeness: every append of a gate-bound kind in src/ hands who answered to the table; the scanner flags a writer that forgets it (known-bad input) and finds the writers it should', () => {
  assert.deepEqual(missingWho("appendTreeEventLocked(rootDir, { event: 'tree_abandoned', gateId, shownSha256 }, { facts, now });").map(f => f.kind), ['tree_abandoned'], 'known-bad: a writer without who answered');
  assert.deepEqual(missingWho("appendTreeEventLocked(rootDir, { event: 'node_closed', node, outcome: 'passed' }, {});"), [], 'a close with no gate is the sitting\'s and needs no answer');
  assert.deepEqual(missingWho("appendTreeEventLocked(rootDir, { event: 'node_closed', outcome: 'incomplete', gateId, shownSha256 }, {});").map(f => f.kind), ['node_closed']);
  const files = [];
  for (const dir of ['src', 'src/mcp']) for (const f of readdirSync(join(root, dir))) if (f.endsWith('.js')) files.push(join(dir, f));
  const seen = new Map(); const bad = [];
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    for (const x of missingWho(text)) bad.push(`${f}: ${x.kind}: ${x.line}`);
    for (const line of text.split('\n')) { const m = /appendTreeEvent(?:Locked)?\(.*event: '([a-z_]+)'/.exec(line); if (m && (ALWAYS.includes(m[1]) || (WITH_GATE_ONLY.includes(m[1]) && /\bgateId\b/.test(line)))) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1); }
  }
  assert.deepEqual(bad, [], 'every gate-bound append names actor and via');
  for (const k of [...ALWAYS, ...WITH_GATE_ONLY]) assert.ok((seen.get(k) ?? 0) >= 1, `the scanner finds the writer of ${k}`);
  assert.ok(seen.get('decision_recorded') >= 3, 'the three decision writers');
});
