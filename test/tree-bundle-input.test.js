// 0.8.3 M6 S5b part B, c3a: the registration pre-check and the `bundle_input` stop. A child whose DERIVED input would be refused at its own start (the outbound key scan; the personal-data gate under 'hard-stop') is not registered: a person gets a
// stop on a node that is not in the record, and the sitting ends held_by_stop. Before this, the child was registered and then refused on every sitting (exit 11), with no run folder and no stop to answer. Real flow: a real root run, a provider
// child whose plan carries the text (the test-only mock models mock-plan-placeholder-*), the real sitting, the real stop text. All-mock, $0. The text of the finding is assembled from parts: this repo is public and its own scanners read this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf } from '../src/tree-resume.js';
import { readinessOf } from '../src/tree-ready.js';
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { gatherStatusFacts } from '../src/tree-status.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { presenceProblems } from './helpers/event-presence.js';
import { LEAF_PLAN, approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { decideHandler } from '../src/tree-decide.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { inputSecretFindings, piiGateReport, textSecretFindings } from '../src/run-preflight.js';

const HOST = ['db', 'internal'].join('.');                      // the host of the mock plan's URL: part of the VALUE (the shape's name is generic); it must appear in no event and no text a person reads

// a real root whose provider R/M1 and its consumer R/M2 (R/M2 expects an agreement from R/M1, so R/M1's plan text reaches R/M2's context.md) run on a chain whose builder and reviser say `model`
async function treeWith(model, opts = {}) {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model, maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3(), ...opts }); approvePending(r);
  return r;
}
const sittingsUntilQuiet = async (r, hooks = {}) => { let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work, hooks }); if (last.status !== 'limit_reached') break; } return last; };
const stopsOf = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input');

test('A DIRTY PROVIDER TEXT: the consumer is NOT registered; ONE bundle_input stop is opened (no runId, the carrier named, the finding by file/line/name only); the sitting ends held_by_stop (exit 20), the independent sibling still ran', async () => {
  const r = await treeWith('mock-plan-placeholder-url');
  const out = await sittingsUntilQuiet(r);
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  assert.equal(exitCodeOf(out), 20);
  const stops = stopsOf(r); assert.equal(stops.length, 1, 'exactly one stop');
  const [stop] = stops;
  assert.equal(stop.node, 'R/M2'); assert.equal(stop.generation, 1); assert.equal(Object.hasOwn(stop, 'runId'), false, 'a node that never existed has no run');
  assert.deepEqual(stop.parent, { node: 'R', generation: 1 });
  assert.deepEqual(stop.carriers, [{ node: 'R/M1', generation: 1 }]);
  assert.ok(stop.findings.length >= 1 && stop.findings.every(f => f.file === 'context.md' && Number.isInteger(f.line) && typeof f.name === 'string'), JSON.stringify(stop.findings));
  assert.ok(stop.affected.some(a => a.node === 'R/M2' && a.generation === 1) && stop.affected.some(a => a.node === 'R/M1' && a.generation === 1), JSON.stringify(stop.affected));
  const state = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(state.nodes.has('R/M2@g1'), false, 'R/M2 was never registered');
  assert.equal(eventsOf(r).some(e => e.event === 'node_registered' && e.node === 'R/M2'), false);
  assert.equal(existsSync(join(r.t.rootDir, 'tree', 'inputs', 'R', 'M2@g1')) || existsSync(join(r.t.rootDir, 'tree', 'inputs', 'R/M2@g1')), false, 'no bundle was written for it');
  assert.ok(state.nodes.has('R/M3@g1') && state.nodes.get('R/M3@g1').phase === 'closed', 'the independent sibling R/M3 ran to its end');
  assert.equal(JSON.stringify(eventsOf(r)).includes(HOST), false, 'the value of the finding is in no event');
  assert.deepEqual(presenceProblems(eventsOf(r)), [], 'the production writer wrote every field the audit lists for the stop');
});

test('THE NEXT SITTING neither re-derives the child nor opens a second stop (stale K is skipped BEFORE derive); readiness is incomplete and names R/M2@g1; the stop text and the status view carry the way on and never the value', async () => {
  const r = await treeWith('mock-plan-placeholder-url');
  await sittingsUntilQuiet(r);
  const before = eventsOf(r).length; let derived = 0;
  const out = await runTree(r.t.rootDir, { work: r.t.work, hooks: { afterDerive: () => { derived += 1; } } });
  assert.equal(out.status, 'held_by_stop'); assert.equal(derived, 0, 'the held child is not derived again');
  assert.equal(eventsOf(r).length, before, 'nothing was written: no second stop, no blocked record');
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.notEqual(v.verdict, 'ready');
  assert.ok(v.reasons.some(x => x.code === 'open_stop' && x.scope === 'R/M2@g1'), JSON.stringify(v.reasons));
  const [stop] = stopsOf(r);
  const text = needsDecisionStopText(r.t.rootDir, stop);
  assert.ok(text, 'the stop has a text of its own (the node is not in the record)');
  for (const needle of ['R/M2 generation 1 was not registered and nothing was started or spent', 'context.md line', 'R/M1 generation 1, a finished node', 'Spent: $0.00', 'spends money under a new approval', `council tree decide ${ROOT_ID} --stop ${stop.id}`]) assert.ok(text.includes(needle), `the stop text has: ${needle}\n${text}`);
  assert.equal(text.includes(HOST), false);
  const facts = gatherStatusFacts(r.t.rootDir, { work: r.t.work });
  assert.ok(facts.openStops.some(s => s.id === stop.id && /council tree decide/.test(s.text ?? '')), 'the status view lists the stop WITH the command that answers it');
});

test('THE TABLE: a bundle_input stop can only name an unregistered child of a closed, verified parent at the generation the next registration would use - never a registered node, a stranger, a second stop on the same child, or one with no findings; each refusal has its own sentence, and a valid one is accepted', async () => {
  // the positive control first, on a fresh tree: a hand-written valid stop for an unregistered child is ACCEPTED (at a base without the row every stop on an unregistered node is refused "is not closed")
  const fresh = await trackedRealRoot({ ...splitChildren(), plan: plan3() });
  const valid = { event: 'needs_decision_opened', source: 'bundle_input', node: 'R/M2', generation: 1, parent: { node: 'R', generation: 1 }, findings: [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }], carriers: [{ node: 'R/M1', generation: 1 }], affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] };
  const accepted = appendTreeEvent(fresh.t.rootDir, valid); assert.equal(accepted.source, 'bundle_input');
  const r = await treeWith('mock-plan-placeholder-url');
  await sittingsUntilQuiet(r);
  const [stop] = stopsOf(r);
  const base = { ...valid, findings: stop.findings, carriers: stop.carriers, affected: stop.affected };
  const refused = (over, why) => assert.throws(() => appendTreeEvent(r.t.rootDir, { ...base, ...over }), e => e.name === 'TreeRefusal' && why.test(e.reason), JSON.stringify(over));
  refused({}, /already has an open stop/);                                           // a second stop on the same child while the first is open
  refused({ node: 'R/M3', generation: 1, affected: [{ node: 'R/M3', generation: 1 }] }, /is registered/);   // a registered, finished node
  refused({ node: 'R/M7', generation: 1, affected: [{ node: 'R/M7', generation: 1 }] }, /not a child that the verified split of R names/);   // a stranger the parent does not name
  refused({ generation: 4, affected: [{ node: 'R/M2', generation: 4 }] }, /is not the generation the next registration of R\/M2 would use/);
  refused({ findings: [] }, /names what was found/);
  refused({ affected: [{ node: 'R/M1', generation: 1 }] }, /holds the node itself/);                  // the set must hold the node itself
  refused({ parent: { node: 'R/M1', generation: 1 } }, /not a closed node with a verified split|not a child/);   // R/M1 is closed but R/M2 is not its child (or it has no verified split)
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the way on: regenerate through the real verb

const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 8000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
test('THE WAY ON, real verbs: a regenerate answer gives the carrier and the child a new generation; the carrier is dirty again -> a NEW stop with a FRESH key (R/M2@g2), exactly one open, and the first stop is answered', async () => {
  const r = await treeWith('mock-plan-placeholder-url');
  let out = await sittingsUntilQuiet(r);
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  const first = stopsOf(r); assert.equal(first.length, 1); assert.equal(first[0].generation, 1);
  const d1 = decide(r, { stop: first[0].id }, ['Rewrite the connection section without a credential.\n.', first[0].id, 'y']);
  assert.equal(await d1.run(), 0, d1.io.shown() + d1.io.errors());
  for (const needle of ['  - R/M1@g1', '  - R/M2@g1']) assert.ok(d1.io.shown().includes(needle), `the form lists the set the stop recorded: ${needle}\n${d1.io.shown()}`);
  out = await runTree(r.t.rootDir, { work: r.t.work });                               // the sitting opens the generations the decision named (recovery) and waits for the approval of the replacement
  assert.equal(out.approvalWaits, true, JSON.stringify(out));
  const opened = eventsOf(r).filter(e => e.event === 'generation_opened').at(-1);
  assert.deepEqual(opened.nodes.map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1@g2', 'R/M2@g2'], 'the provider and the child enter at the next generation');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.length, 0, 'the first stop is answered');
  approvePending(r);
  out = await sittingsUntilQuiet(r);
  assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  const all = stopsOf(r); assert.equal(all.length, 2, 'the first stop (answered) and a NEW one');
  assert.equal(all[1].node, 'R/M2'); assert.equal(all[1].generation, 2); assert.notEqual(all[1].id, first[0].id);
  assert.deepEqual(all[1].carriers, [{ node: 'R/M1', generation: 2 }]);
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual(st.openStops, [all[1].id], 'exactly one stop is open');
  assert.equal(st.nodes.has('R/M2@g2'), false, 'the child is still not registered');
  assert.equal(st.nodes.get('R/M1@g2')?.phase, 'closed', 'the regenerated carrier ran again (under the new approval)');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- what is asked: the key scan always, the personal-data gate only under 'hard-stop', reserved placeholder hosts never

for (const [label, model, piiGate, stop, nameStarts] of [
  ['a reserved placeholder host (localhost) is exempt from the key scan: the child registers and runs', 'mock-plan-placeholder-url-localhost', undefined, false, null],
  ['a look-alike of a reserved host is NOT exempt: the key scan refuses it', 'mock-plan-placeholder-url-lookalike', undefined, true, 'URL credentials'],
  // CHANGED ACCEPTED (19 Okt 2026, C&C: a member handed no mode scans under the stop, and registration asks the SAME question: treeInputScanModeFrom): OLD expected the child to register and run (stop false). NEW: a tree that records no mode is asked as hard-stop, so the child is refused BEFORE it exists with a recorded stop, never registered and then refused at its start.
  ['an e-mail address on a real-looking domain, the tree carrying NO personal-data mode: asked as hard-stop (a member scans under the stop), so the child is refused before it exists', 'mock-plan-placeholder-email', undefined, true, 'pii:email'],
  ['the same address under `warn`: the gate never refuses a run, so it never keeps a child from registering', 'mock-plan-placeholder-email', 'warn', false, null],
  ['the same address under `hard-stop`: the child is refused BEFORE it exists (the run would exit 11 at its start)', 'mock-plan-placeholder-email', 'hard-stop', true, 'pii:email'],
]) {
  test(`WHAT IS ASKED: ${label}`, async () => {
    const r = await treeWith(model, piiGate ? { piiGate } : {});
    const out = await sittingsUntilQuiet(r);
    const stops = stopsOf(r); const st = stateOf(readTreeRecord(r.t.rootDir));
    if (!stop) {
      assert.equal(stops.length, 0, JSON.stringify(stops)); assert.equal(st.nodes.get('R/M2@g1')?.phase, 'closed', `R/M2 ran: ${JSON.stringify(out)}`);
    } else {
      assert.equal(out.status, 'held_by_stop', JSON.stringify(out)); assert.equal(stops.length, 1);
      // CHANGED ACCEPTED (19 Okt 2026, no-mode trees are asked as hard-stop): OLD every finding was the key scan's. NEW the same look-alike line also carries the PII gate's findings (pii:email, pii:secret), so for the key-scan row the key scan's finding must be PRESENT (some), for the PII row every finding is PII (every).
      const startsRight = f => f.name.startsWith(nameStarts);
      assert.ok(nameStarts === 'URL credentials' ? stops[0].findings.some(startsRight) && stops[0].findings.every(f => startsRight(f) || f.name.startsWith('pii:')) : stops[0].findings.every(startsRight), JSON.stringify(stops[0].findings));   // strict again: the key scan's finding is present and every other finding is the PII gate's
      assert.equal(st.nodes.has('R/M2@g1'), false);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the parent's own text

test('A FINDING IN TEXT THE PARENT OWNS (no carrier span): bundleInputCheck marks it parentOwned; when the parent is the ROOT the stop is recorded ON THE ROOT (node R, the live generation; `child` names the unregistered node), so the S8 form answers it with a NEW ROOT plan', async () => {
  const { bundleInputCheck, openBundleInputStop } = await import('../src/tree-bundle-input.js');     // loaded here, not at the top: at a base without the module the other tests must still LOAD and fail on what they assert
  // the pure half: a finding on a context.md line outside every carrier span, one inside, one in criteria.json
  const wordy = ['postgres', '://user:', 'pass', '@', HOST, '/db'].join('');
  const files = { 'task.md': 'Milestone: M2\n', 'criteria.json': '["ok"]\n', 'context.md': `# Context\nline two ${wordy}\n----- p -----\nsettings: ${wordy}\n----- end -----\n` };
  const spans = [{ node: 'R/M1', generation: 1, from: files['context.md'].indexOf('----- p'), to: files['context.md'].length }];
  const found = bundleInputCheck({ files, carrierSpans: spans });
  assert.deepEqual(found.findings.map(f => [f.file, f.line]), [['context.md', 2], ['context.md', 4]]);
  assert.deepEqual(found.carriers, [{ node: 'R/M1', generation: 1 }]); assert.equal(found.parentOwned, true, 'line 2 is in no span: the parent owns it');
  assert.equal(bundleInputCheck({ files: { ...files, 'context.md': '# Context\nclean\n' }, carrierSpans: spans }).findings.length, 0);
  // the record half, on a real root whose children are not registered yet
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  const opened = openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }], carriers: [], parentOwned: true } });
  assert.equal(opened.kind, 'stop_opened', JSON.stringify(opened));
  const s = opened.stop;
  assert.equal(s.node, 'R'); assert.equal(s.generation, 1); assert.deepEqual(s.child, { node: 'R/M3', generation: 1 }); assert.equal(Object.hasOwn(s, 'runId'), false);
  assert.deepEqual(s.carriers, [{ node: 'R', generation: 1 }]); assert.deepEqual(s.affected, [{ node: 'R', generation: 1 }, { node: 'R/M3', generation: 1 }]);
  // a second stop for the same child is refused, a different child is not
  assert.equal(openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: s.findings, carriers: [], parentOwned: true } }).kind, 'refused');
  const text = needsDecisionStopText(r.t.rootDir, s);
  assert.ok(text.includes(`answer it with a NEW ROOT plan: council tree decide ${ROOT_ID} --stop ${s.id}`) && text.includes('a new paid run') && text.includes('the parent: its own plan carries it') && text.includes('R/M3 generation 1 was not registered'), text);
  // the real S8 form takes it
  const d = decide(r, { stop: s.id }, ['Plan it again, with the settings kept out of the overview.\n.', s.id, 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.ok(d.io.shown().includes('(re-plan the root)'), d.io.shown());
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.length, 0);
  assert.ok(eventsOf(r).some(e => e.event === 'generation_opened' && e.nodes.some(n => n.node === 'R' && n.generation === 2)));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the root pre-check is a BACKSTOP: three sites, one scanner

test('ONE SCANNER, THREE SITES (what makes the root pre-check a backstop, C&C Q2): the same input set gives identical findings at `tree start` (the task), at `tree decide` (the typed text) and at registration (the bundle), for the key scan and for the personal-data gate', async () => {
  const { bundleInputCheck } = await import('../src/tree-bundle-input.js');
  const url = host => ['postgres', '://user:', 'pass', '@', host, '/db'].join('');
  const mail = ['jane.doe', '@', 'mail-corp', '.de'].join('');
  const text = ['# Plan', `reads ${url(HOST)}`, `local only ${url(['local', 'host'].join(''))}`, `look-alike ${url(['local', 'host', 'evil', 'com'].join('.'))}`, `write to ${mail}`, 'clean line', ''].join('\n');
  const strip = f => f.map(x => [x.line, x.name]);
  const atStart = strip(inputSecretFindings({ taskFile: 'task.md', taskText: text, config: {} }));
  const atDecide = strip(textSecretFindings(text, 'the decision text'));
  const atRegistration = strip(bundleInputCheck({ files: { 'task.md': text } }).findings);
  assert.ok(atStart.length === 2, `the real host and the look-alike are found, the reserved host is not: ${JSON.stringify(atStart)}`);
  assert.deepEqual(atDecide, atStart); assert.deepEqual(atRegistration, atStart);
  const piiAt = f => f.map(x => [x.line, x.type]);
  const pii = piiGateReport({ mode: 'hard-stop', sources: [['x', text]], forTree: true });
  const reg = bundleInputCheck({ files: { 'task.md': text }, piiMode: { status: 'on', mode: 'hard-stop' } }).findings.filter(f => f.name.startsWith('pii:'));
  assert.ok(pii.blocked && pii.findings.length >= 1);
  const order = l => l.map(x => JSON.stringify(x)).sort();
  assert.deepEqual(order(reg.map(f => [f.line, f.name.split(':')[1]])), order(piiAt(pii.findings)), 'the registration finds what the gate finds, position and type');
  // 'warn' never refuses a child
  assert.deepEqual(bundleInputCheck({ files: { 'task.md': text }, piiMode: { status: 'on', mode: 'warn' } }).findings.filter(f => f.name.startsWith('pii:')), []);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- E 58, read from the artifact (c4)

test('E 58 (the root-variant stop): the sentence says what the REAL decide form does - the finished, passed sibling is HELD, only the root is set aside, the refused child (never a nodes row) is not listed - and says the child was never registered', async () => {
  const { openBundleInputStop } = await import('../src/tree-bundle-input.js');
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1 });                    // R/M1 runs to its end: finished and passed
  const o = openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'URL credentials (scheme://user:pass@)' }], carriers: [], parentOwned: true } });
  assert.equal(o.kind, 'stop_opened');
  const text = needsDecisionStopText(r.t.rootDir, o.stop);
  assert.ok(text.includes("The finished sub-plans that passed are not thrown away: they are held, and when you approve the new root plan's children each is checked for reuse. R/M3 was never registered: the new root plan decides its own children."), text);
  // the form a person then gets: the sentence above is a claim about it
  const d = decide(r, { stop: o.stop.id }, ['Plan it again.\n.', 'no', 'n']);
  await d.run();
  const shown = d.io.shown();
  assert.match(shown, /SET ASIDE from now on \(1 node:[^\n]*\n {2}- R@g1\n/, 'only the root is set aside');
  assert.match(shown, /HELD \(1 node in 1 run: finished and passed;[^\n]*\n {2}- R\/M1@g1\n/, 'the finished sibling is held');
  assert.equal(shown.includes('R/M3'), false, 'the refused child is in neither list: it was never a node of the record');
});
