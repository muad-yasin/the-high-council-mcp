// S20 slice 2, control 1, step R3: report.json lists the requests to start a pass at layer 3 and their decisions, `run_controls[]`, derived from the gate ledger when the report is written (src/run-controls.js runControlsOf; the shape in src/report-shape.js; the row in
// schemas/report-v1.json). Additive and experimental, present only when the run has one, like `raises` (RC-12 in run-controls.test.js). The modules are used through namespace imports, so a tree without the new function still LOADS this file and each row fails on its own.
//   R3-1 the shape and the schema (absent, present, rejected);  R3-2 a request and its routed decision in report.json, through the real CLI;  R3-3 an UNDECIDED request stays listed (the resume decides nothing);  R3-4 the handler's own route and the person's decision in report.json;  R3-5 a decline;  R3-6 a partial report carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runControls from '../src/run-controls.js';
import * as reportShape from '../src/report-shape.js';
import { runThroughChecks } from './helpers/build-check.js';
import { routeNextPass, PERSON_WORDS } from './helpers/route-pass.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_PRELOAD = join(root, 'test', 'helpers', 'build-check-only-preload.js');   // 0.8.4 S4: a child with the build-check wording in force
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const writer = { provider: 'external', model: 'claude-code-session' };
const chainOf = critic => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic },
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'rcr-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  // 0.8.4 S4 (C&C's Q-m migration): the same command with the build-check wording in force; a run that waits at the build check is answered good_to_build by a test-only handler and resumed (test/helpers/build-check.js)
  const runChecked = args => runThroughChecks(a => spawnSync(process.execPath, ['--import', CHECK_PRELOAD, join(root, 'src', 'cli.js'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }), args, runDir);
  const answer = (name, text) => writeFileSync(join(runDir(), `${name}.md`), text);
  return { dir, run, runChecked, runDir, answer, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;
// the run at the revise pause with the reviser's answer in: layers 1 and 2 object, layer 3 signs off, so a routed pass 2 (layer 3 only) finishes as a ladder sign-off (22) and a plain resume of pass 2 pauses again at revise-2 (3). The mock judges count their asks per PROCESS
// (src/providers.js scriptedAsks), so no pattern can sign off in pass 2 yet object in pass 1 across the resume processes: a request that nobody decides is therefore shown without a finished run (R3-3).
const atPass2 = id => {
  const p = project(chainOf(critics('x', 'x', 'o', id)));
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
  p.answer('build', plan(1));
  const r = p.run(['--resume', p.runDir()]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  p.answer('revise-1', plan(2));
  return p;
};
const report = (p, file = 'report.json') => JSON.parse(readFileSync(join(p.runDir(), file), 'utf8'));
const { default: Ajv2020 } = await import('ajv/dist/2020.js');
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
const mockConfig = { name: 'r3', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'a' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'a' }, critics: [{ provider: 'mock', model: 'mock-critic-script-o-r3', lab: 'c' }] } };
const mockResult = async () => (await import('../src/chain.js')).runChain({ request: 'Req.', config: mockConfig, log: () => {} });
const rowA = { pass: 2, request: { seq: 1, channel: 'cli', person_words: null, at: '2026-11-04T12:00:00.000Z' }, decision: { seq: 2, decision: 'routed', decided_by: 'handler', person_words: null, reason: 'ready', at: '2026-11-04T12:01:00.000Z' } };

test('R3-1 the shape and the schema: no run_controls key without rows; with rows they are carried as given and validate; a bad value is rejected', async () => {
  const base = { runId: 'x', chain: 'r3', task: 't', result: await mockResult(), config: mockConfig };
  assert.equal('run_controls' in reportShape.reportJsonShape(base), false, 'absent first');
  assert.equal('run_controls' in reportShape.reportJsonShape({ ...base, result: { ...base.result, run_controls: [] } }), false, 'and absent for none');
  const withRows = reportShape.reportJsonShape({ ...base, result: { ...base.result, run_controls: [rowA, { pass: 3, request: rowA.request, decision: null }, { pass: 4, request: null, decision: { ...rowA.decision, decided_by: 'person', person_words: 'Yes, route it.', reason: runControls.RELAY_REASON } }, { pass: 5, request: rowA.request, decision: { ...rowA.decision, decision: 'declined', reason: 'not now' } }] } });
  assert.deepEqual(withRows.run_controls.map(r => [r.pass, r.request?.seq ?? null, r.decision?.decision ?? null]), [[2, 1, 'routed'], [3, 1, null], [4, null, 'routed'], [5, 1, 'declined']]);
  assert.ok(validate(withRows), JSON.stringify(validate.errors, null, 2));
  for (const bad of [{ ...rowA, decision: { ...rowA.decision, decision: 'approved' } }, { ...rowA, request: { ...rowA.request, channel: 'web' } }, { ...rowA, pass: 0 }, { pass: 2 }]) {
    assert.equal(validate(reportShape.reportJsonShape({ ...base, result: { ...base.result, run_controls: [bad] } })), false, JSON.stringify(bad));
  }
});

test('R3-2 through the real CLI: a request and the handler\'s routed decision are in report.json, in the ledger\'s words', () => {
  const p = atPass2('r32');
  try {
    const pressed = routeNextPass(p, { reason: 'ready for the overseer' });
    // CHANGED ACCEPTED (0.8.4 S4, C&C's Q-m migration; OLD/NEW/WHY): OLD: this resume exited 22 at the layer-3 (ladder) sign-off. NEW: with the build-check wording in force the run waits at build-check-1, a test-only handler answers good_to_build, and the resumed run ends AGREED (exit 0). WHY: the handler's build check follows layer 3's sign-off (CA4); every other assertion of the row is unchanged.
    const r = p.runChecked(['--resume', p.runDir()]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rep = report(p);
    assert.equal(rep.run_controls.length, 1);
    const row = rep.run_controls[0];
    assert.deepEqual({ pass: row.pass, rseq: row.request.seq, channel: row.request.channel, rwords: row.request.person_words, dseq: row.decision.seq, decision: row.decision.decision, by: row.decision.decided_by, dwords: row.decision.person_words, reason: row.decision.reason },
      { pass: 2, rseq: pressed.request, channel: 'session', rwords: PERSON_WORDS, dseq: 2, decision: 'routed', by: 'handler', dwords: null, reason: 'ready for the overseer' });
    assert.match(row.request.at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(validate(rep), JSON.stringify(validate.errors, null, 2));
  } finally { p.done(); }
});

test('R3-3 an UNDECIDED request stays listed with decision null: the resume that follows goes on under the ladder\'s own count and decides nothing', () => {
  const p = atPass2('r33');
  try {
    assert.equal(p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]).status, 27);
    assert.deepEqual(runControls.runControlsOf(p.runDir()).map(x => [x.pass, x.request?.seq, x.request?.channel, x.decision]), [[2, 1, 'session', null]]);
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /ladder: pass 2 starts at layer 3/, 'nothing was routed');
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')), 'pass 2 ran under the ladder\'s own count and paused at its reviser');
    assert.deepEqual(runControls.runControlsOf(p.runDir()).map(x => [x.pass, x.request?.seq, x.decision]), [[2, 1, null]], 'the resume decided nothing: the request is still listed, undecided');
  } finally { p.done(); }
});

test('R3-4 the handler\'s own route has request null; the person\'s decision carries his words as typed and the relay sentence as its reason', () => {
  const own = atPass2('r34a');
  try {
    assert.equal(own.run(['route-decide', own.runDir(), '--route', '--reason', 'the plan is ready']).status, 0);
    assert.equal(own.runChecked(['--resume', own.runDir()]).status, 0);   // 0.8.4 S4: answered by the test-only handler, ends agreed (see R3-2's comment)
    const row = report(own).run_controls[0];
    assert.deepEqual({ pass: row.pass, request: row.request, decided_by: row.decision.decided_by, reason: row.decision.reason }, { pass: 2, request: null, decided_by: 'handler', reason: 'the plan is ready' });
  } finally { own.done(); }
  const person = atPass2('r34b');
  try {
    assert.equal(person.run(['route-decide', person.runDir(), '--route', '--person-words', 'Yes, route it to layer 3.']).status, 0);
    assert.equal(person.runChecked(['--resume', person.runDir()]).status, 0);   // 0.8.4 S4: answered by the test-only handler, ends agreed (see R3-2's comment)
    const d = report(person).run_controls[0].decision;
    assert.deepEqual({ by: d.decided_by, words: d.person_words, reason: d.reason }, { by: 'person', words: 'Yes, route it to layer 3.', reason: runControls.RELAY_REASON });
  } finally { person.done(); }
});

test('R3-5 a decline: the run goes on at layer 1, and the decline is listed with its reason', () => {
  const p = atPass2('r35');
  try {
    assert.equal(p.run(['--resume', p.runDir(), '--next-pass-layer-3', '--person-words', PERSON_WORDS]).status, 27);
    assert.equal(p.run(['route-decide', p.runDir(), '1', '--decline', '--reason', 'one more pass at layer 1 first']).status, 0);
    const r = p.run(['--resume', p.runDir()]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /ladder: pass 2 starts at layer 3/);
    assert.deepEqual(runControls.runControlsOf(p.runDir()).map(x => [x.request.seq, x.decision.decision, x.decision.reason]), [[1, 'declined', 'one more pass at layer 1 first']]);
  } finally { p.done(); }
});

test('R3-6 a partial report (a stopped run) carries the rows too, an undecided request included', async () => {
  const rows = [{ pass: 2, request: rowA.request, decision: null }];
  const partial = reportShape.partialReportJsonShape({ stoppedBy: 'budget', runId: 'x', chain: 'r3', task: 't', result: { ...(await mockResult()), run_controls: rows }, config: mockConfig });
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.run_controls, rows);
  const empty = mkdtempSync(join(tmpdir(), 'rcr-empty-'));
  try { assert.deepEqual(runControls.runControlsOf(empty), [], 'a run with no ledger has no rows'); } finally { rmSync(empty, { recursive: true, force: true }); }
});
