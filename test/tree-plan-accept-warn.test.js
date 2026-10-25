// CR-SOL-001 (the owner's answer, Muad 25 Okt 2026: "2: yes, I'm not exactly sure but your recommendation sounds fine"): in a tree started with --pii-gate warn, accepting a CHANGED plan is not refused for personal data. warn never refuses a run
// (a member's start goes on and records its findings), so the writer and the table test the BLOCKING result of the personal-data gate, not its findings; the key scan still refuses for every mode. The event keeps the count warn let through
// (scan.piiWarned, written only under warn). Real all-mock trees, $0; the person answers through decideHandler (the real verb), the session through the one writer (there is no MCP form for an accept: SESSION_FORMS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf, TreeRefusal } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { acceptChangedPlan } from '../src/tree-accept.js';
import { buildAcceptPlan } from '../src/tree-decide-accept.js';
import { EVENTS_SCHEMA, eventShapeError, planAuthorityOf, transitionRefusal } from '../src/tree-transitions.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { sha256Of } from '../src/thin-contract.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const MAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');
const ADDED_MAIL = `\nQuestions about the store go to ${MAIL} until the release.\n`;
const KEY_URL = ['postgres', '://user:', 'pass', '@', 'db.internal', '/db'].join('');

async function finished(piiGate) {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }), ...(piiGate ? { piiGate } : {}) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const planFile = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId, 'deliverable.md');
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const accepted = r => eventsOf(r).filter(e => e.event === 'plan_accepted');
async function changed(r, start, node, text) {
  const edited = readFileSync(planFile(r, node), 'utf8') + text;
  writeFileSync(planFile(r, node), edited);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const stop = stopsOf(r, node).at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), `a stop is open for ${node}`);
  return { stop, edited };
}
const session = (r, stop) => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', via: 'mcp', reason: 'one sentence naming the contact; same obligations, same split', runsDir: r.t.runsDir });
const refusal = fn => { try { fn(); } catch (e) { if (e instanceof TreeRefusal) return e.reason; throw e; } assert.fail('no refusal'); };
const decide = async (r, flags, answers) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), errors: io.errors() };
};

test('WARN, SESSION: a changed plan that holds an e-mail (here one the edit itself added) is accepted; the event records piiFindings 0 and piiWarned 1, and the node reads the accepted body', { timeout: 400_000 }, async () => {
  const { r, start } = await finished('warn');
  const { stop, edited } = await changed(r, start, 'R/M2', ADDED_MAIL);
  session(r, stop);
  const ev = accepted(r);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].actor, ev[0].scan, ev[0].acceptedBodySha256], ['session', { keyFindings: 0, piiFindings: 0, piiWarned: 1 }, sha256Of(edited)]);
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(state.openStops.includes(stop.id), false, 'the stop is answered');
  assert.equal(planAuthorityOf(nodeOf(r, 'R/M2')), sha256Of(edited), 'the record holds the accepted body');
});

test('WARN, PERSON through `council tree decide --accept-plan`: the form says what warn lets through (types, never the value), the typed id records ONE plan_accepted with piiWarned 1', { timeout: 400_000 }, async () => {
  const { r, start } = await finished('warn');
  const { stop } = await changed(r, start, 'R/M2', ADDED_MAIL);
  const b = buildAcceptPlan({ rootDir: r.t.rootDir, rootId: ROOT_ID, stopArg: stop.id });
  assert.equal(b.refusal, undefined, `the form builds a text (refused instead: ${b.refusal})`);
  assert.ok(b.text.includes('The file holds no key-shaped string that the tree\'s own checks would refuse. It holds 1 personal-data-shaped string (email), which this tree lets through because it was started with --pii-gate warn.'), b.text);
  const scanSentence = b.text.split('\n').find(l => l.startsWith('What stays the same:'));
  assert.equal(scanSentence.includes(MAIL), false, 'the scan sentence names the type, never the value (the diff above it shows the edit itself, as it must)');
  const out = await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  const ev = accepted(r);
  assert.deepEqual([ev.length, ev[0].actor, ev[0].scan], [1, 'person', { keyFindings: 0, piiFindings: 0, piiWarned: 1 }]);
});

test('WARN, the key scan still refuses for every actor: a key-shaped string in the edit is refused by the writer, and the refusal names the key only (warn blocks no personal data)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished('warn');
  const { stop } = await changed(r, start, 'R/M2', `\nThe store reads ${KEY_URL} and mails ${MAIL}.\n`);
  const sentence = /^the changed plan holds 1 key-shaped string \([^)]+\): the tree holds no plan that its own key and personal-data checks refuse\. Edit the file to remove it and ask again$/;
  assert.match(refusal(() => session(r, stop)), sentence);
  const b = buildAcceptPlan({ rootDir: r.t.rootDir, rootId: ROOT_ID, stopArg: stop.id });
  assert.match(String(b.refusal), sentence, 'the person\'s form is refused with the same sentence');
  assert.equal(accepted(r).length, 0);
});

test('HARD-STOP (a tree with no recorded mode is asked as hard-stop): an e-mail added by the edit is still refused, and no piiWarned is written anywhere', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2', ADDED_MAIL);
  assert.match(refusal(() => session(r, stop)), /^the changed plan holds 1 personal-data finding \(email\): the tree holds no plan that its own key and personal-data checks refuse\. Edit the file to remove it and ask again$/);
  assert.equal(accepted(r).length, 0);
});

test('THE RECORD: a plan_accepted line reads only with scan.piiWarned absent or a whole number >= 0, and the table still refuses any blocking personal-data finding (piiFindings > 0)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished('warn');
  const { stop, edited } = await changed(r, start, 'R/M2', ADDED_MAIL);
  const state = stateOf(readTreeRecord(r.t.rootDir));
  const n = nodeOf(r, 'R/M2');
  const base = { event: 'plan_accepted', stopId: stop.id, node: 'R/M2', generation: 1, runId: n.runId, actor: 'session', via: 'mcp', reason: 'r', previousBodySha256: n.deliveredBodySha256, acceptedBodySha256: sha256Of(edited), splitSha256: n.verifiedSplit?.sha ?? null, ...(n.thinContractSha256 ? { thinContractSha256: n.thinContractSha256 } : {}) };
  const line = scan => ({ schema: EVENTS_SCHEMA, id: 'e9999', at: new Date().toISOString(), ...base, scan });
  assert.equal(eventShapeError(line({ keyFindings: 0, piiFindings: 0, piiWarned: 1 })), null, 'a warned count reads');
  assert.equal(eventShapeError(line({ keyFindings: 0, piiFindings: 0 })), null, 'no warned count (hard-stop) reads');
  for (const bad of [-1, 1.5, '1', null]) assert.match(String(eventShapeError(line({ keyFindings: 0, piiFindings: 0, piiWarned: bad }))), /plan_accepted: field "scan" is missing or malformed/, `piiWarned ${JSON.stringify(bad)} does not read`);
  assert.equal(transitionRefusal(state, { ...base, scan: { keyFindings: 0, piiFindings: 0, piiWarned: 1 } }), null, 'the table accepts a warned count');
  assert.match(transitionRefusal(state, { ...base, scan: { keyFindings: 0, piiFindings: 1 } })?.reason ?? '', /1 personal-data finding\(s\)/, 'a blocking finding still refuses');
});
