// Unit D (B3 prep): the final read - at a layered unanimous run that ends WITHOUT agreement, the top-layer seats that have not read the plan as it ends read it once
// (src/final-read.js, runFinalRead in src/chain.js). Offline, mock seats only, $0. The end used is CODE-4 route A1: layer 1 is never heard, so layers 2 and 3 are never asked.
// The judges are scripted mock models (`mock-critic-script-o-<id>` signs off; counters live in the process, so every test gives its models its own suffix).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import { runChain, setCache, setBudget, setProgressHook, BudgetExceeded, ExternalPause } from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { lintChain } from '../src/chain-lint.js';
import { estimateChainRows, expectedOutputTokensOf } from '../src/cost.js';
import { systemTextsFor } from '../src/stage-system.js';
import { critic, chainOf, neverHeardChain, snapshot } from './helpers/final-read-chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { HELD_OFF, withHeldOff } from './helpers/held-off.js';
import * as VE from '../src/verdict-envelope.js';
import * as H from './held-prompts/held-083.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
afterEach(() => { setCache(null); setBudget(null); setProgressHook(null); setHeldForTest(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce(false); });
const go = async (config, opts = {}) => {
  const lines = [];
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-final-read', ...opts, config });
  return { r, log: lines.join('\n') };
};
const FR = { final_read: { enabled: true } };
const stageLabels = r => r.stages.map(s => s.label);

test('switch OFF: the run is exactly what the tree before unit D produced (captured from 82232b36), no final_read key, no final-read stage, no block', async () => {
  const { r } = await go(neverHeardChain('base'));
  const fixture = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'final-read-switch-off-82232b36.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot(r))), fixture, 'with the switch off, nothing a reader of report.json sees may differ from the tree before this unit (draftShaByRound is now filled for every layered round, and nothing persists it)');
  assert.ok(!('finalRead' in r));
  assert.ok(!stageLabels(r).some(l => l.startsWith('final-read-')));
});

test('switch ON at a never-heard end: each unread layer-3 seat is asked once; an unreadable one is re-asked once and recorded "did NOT read"; the ending, signoff[], panelVerdicts and layers are untouched', async () => {
  const off = await go(neverHeardChain('on-off'));
  const { r, log } = await go(neverHeardChain('on', FR));
  // the precondition, asserted so the test cannot pass vacuously: nobody at layer 3 had read anything before the stage
  assert.equal(off.r.passed, false);
  assert.deepEqual(r.layers.map(x => `${x.layer}:${x.state}`), ['1:unheard', '2:not_asked', '3:not_asked']);
  assert.ok(r.finalRead.ran);
  assert.deepEqual(r.finalRead.seats.map(s => s.last_read_sha), [null, null]);
  assert.deepEqual(r.finalRead.seats.map(s => [s.lab, s.layer, s.read, s.reasked]), [['l3a', 3, true, false], ['l3b', 3, false, true]]);
  assert.equal(r.finalRead.seats[0].meets, true);
  assert.match(r.finalRead.seats[1].why, /.+/);
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('final-read-')).sort(), ['final-read-l3a', 'final-read-l3b', 'final-read-l3b-reask1']);
  // one call per unread seat (+ the one re-ask) and nothing else changed
  for (const k of ['signoff', 'panelVerdicts', 'layers', 'passed']) assert.deepEqual(r[k], off.r[k], `${k} must not be touched by the final read`);
  assert.equal(computeOutcome(r), computeOutcome(off.r));
  assert.match(log, /Stage: final read/);
  assert.match(log, /l3b: did NOT read the final plan/);
  assert.match(log, /LAYER 3 DID NOT READ THE FINAL PLAN \(l3b\)/);
  assert.match(r.deliverable, /^## Layer 3 on the final plan/m);
  assert.match(r.deliverable, /### l3b: DID NOT READ/);
  assert.ok(r.deliverable.indexOf('## Layer 3 on the final plan') < r.deliverable.indexOf('MOCK DELIVERABLE'), 'the record sits above the plan, never in it');
  assert.ok(r.dispute === undefined || r.dispute.ran === false, 'no objection was open in this end, so there was no dispute rewrite');
});

test('switch ON, run ends AGREED and nothing changed after the sign-off: every layer-3 seat has read exactly this plan, so nothing is asked (ran:false)', async () => {
  const { r } = await go(chainOf([critic('mock-critic-script-o-fra1-ag', 'l1', 1), critic('mock-critic-script-o-fra2-ag', 'l2', 2), critic('mock-critic-script-o-fra3-ag', 'l3', 3)], FR));
  assert.equal(r.passed, true);
  assert.deepEqual(r.finalRead, { ran: false, reason: 'every_top_seat_read_this_plan', run_end: 'agreed', final_sha: r.finalRead.final_sha, seats: [] });
  assert.ok(!stageLabels(r).some(l => l.startsWith('final-read-')));
});

// An AGREED end whose body changed after the sign-off: the final edit (a finalist seat) rewrites the plan layer 3 had signed. The mock finalist returns text under its own model name, so the plan differs.
const agreedChanged = (tag, l3pattern, extra = {}) => chainOf([
  critic('mock-critic-script-o-fre1-' + tag, 'l1', 1), critic('mock-critic-script-o-fre2-' + tag, 'l2', 2), critic(`mock-critic-script-${l3pattern}-fre3-${tag}`, 'l3', 3),
], { ...FR, ...extra, seats: { ...chainOf([]).seats, critics: [critic('mock-critic-script-o-fre1-' + tag, 'l1', 1), critic('mock-critic-script-o-fre2-' + tag, 'l2', 2), critic(`mock-critic-script-${l3pattern}-fre3-${tag}`, 'l3', 3)], finalist: { provider: 'mock', model: 'mock-finalist', lab: 'editor' } } });

test('switch ON, AGREED end but the final edit changed the plan: layer 3 reads it again; no objection leaves the ending agreed, an objection ends it NOT agreed (outcome) with passed and signoff[] untouched', async () => {
  const calm = await go(agreedChanged('calm', 'o'));
  assert.equal(calm.r.passed, true);
  assert.equal(calm.r.finalRead.ran, true);
  assert.equal(calm.r.finalRead.run_end, 'agreed');
  assert.deepEqual(calm.r.finalRead.seats.map(s => [s.lab, s.read, s.meets]), [['l3', true, true]]);
  assert.equal(computeOutcome(calm.r), 'consensus');
  assert.match(calm.log, /every layer signed off, but the plan changed after/);
  assert.doesNotMatch(calm.log, /NOT agreement/);
  const hard = await go(agreedChanged('hard', 'ox'));
  assert.equal(hard.r.passed, true, 'passed is the panel\'s own verdict and stays');
  assert.equal(hard.r.signoff.every(s => s.signedOff === true), true, 'signoff[] stays');
  assert.deepEqual(hard.r.finalRead.seats.map(s => [s.lab, s.read, s.meets]), [['l3', true, false]]);
  assert.equal(computeOutcome(hard.r), 'no_consensus', 'a layer-3 objection to the final plan ends an agreed run as not agreed');
  assert.match(hard.log, /LAYER 3 OBJECTED TO THE FINAL PLAN: every layer had signed off on an earlier text, but this run is NOT agreement/);
  assert.match(hard.r.deliverable, /\*\*Layer 3 objected to the final plan, so this run is NOT agreement\.\*\*/);
});

test('switch ON, AGREED end, plan changed, and layer 3 does not read the final plan (an external seat answers the panel, then garbage twice): the run is NOT agreed (fail closed, outcome degraded), passed stays true', async () => {
  const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
  const config = () => ({ ...agreedChanged('unread', 'o'), seats: { ...agreedChanged('unread', 'o').seats, critics: [critic('mock-critic-script-o-frx1-un', 'l1', 1), critic('mock-critic-script-o-frx2-un', 'l2', 2), { provider: 'external', model: 'claude-code-session', lab: 'ext', layer: 3 }] } });
  const saved = new Map(); const answers = new Map();
  let out;
  for (let i = 0; i < 12 && !out; i++) {
    setCache({ get: label => saved.get(label) ?? (answers.has(label) ? { text: answers.get(label).text, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, promptHash: answers.get(label).promptHash } : null) });
    try { out = await go(config(), { onStage: s => saved.set(s.label, s) }); } catch (e) {
      if (!(e instanceof ExternalPause)) throw e;
      answers.set(e.label, { text: e.label.startsWith('panel-') ? PASS : 'not a verdict at all', promptHash: e.promptHash });
    }
  }
  assert.ok(out, 'the run finished after the pauses were answered');
  const { r, log } = out;
  assert.equal(r.passed, true);
  assert.deepEqual(r.finalRead.seats.map(s => [s.lab, s.read, s.reasked]), [['ext', false, true]]);
  assert.equal(r.finalRead.run_end, 'agreed');
  assert.equal(computeOutcome(r), 'degraded');
  assert.match(log, /This run is NOT agreement: every layer had signed off on an earlier text, but layer 3 did not read the final plan\./);
  assert.match(r.deliverable, /\*\*This run is NOT agreement: layer 3 did not read the final plan\.\*\*/);
});

test('real verb: an agreed run whose final edit layer 3 objects to exits 22, says NOT agreement in the verdict line and at the top of the BOARD, and report.json keeps passed true', () => {
  const work = mkdtempSync(join(tmpdir(), 'final-read-agreed-'));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  writeFileSync(join(work, 'chains', 'fa.json'), JSON.stringify({ ...agreedChanged('cli', 'ox'), summary: 'final read agreed end' }));
  const run = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'fa', '--max-usd', '1'], { cwd: work, encoding: 'utf8' });
  assert.equal(run.status, 22, run.stdout + run.stderr);
  assert.match(run.stdout, /verdict:  NOT agreement: every layer had signed off an earlier text, but layer 3 objected to the final plan/);
  assert.match(run.stdout, /^final read: l3 objected \(\d+\) - the run is NOT agreed$/m);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.outcome, 'no_consensus');
  assert.equal(report.final_read.run_end, 'agreed');
  assert.match(readFileSync(join(runDir, 'BOARD.md'), 'utf8'), /^# Debate board[^\n]*\n\n## Not agreed: layer 3 objected to the final plan/);
});

test('an unread seat\'s cause is the envelope\'s when the reply parsed but carried no ids (the panel\'s own words), not "malformed JSON"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'final-read-env-'));
  setHeldForTest(withHeldOff({ verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote, criticEnvelopeUnreadableWhy: H.criticEnvelopeUnreadableWhy, criticEnvelopeUnreadableLabel: H.criticEnvelopeUnreadableLabel }));
  VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce(true);
  const config = chainOf([critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frv2-env', 'l2a', 2), critic('mock-critic-envelope-m-fr3-env', 'l3m', 3)], FR);
  const { r } = await go(config);
  const seat = r.finalRead.seats.find(x => x.lab === 'l3m');
  assert.equal(seat.read, false);
  assert.equal(seat.why, H.criticEnvelopeUnreadableWhy({ kind: 'missing' }));
  assert.doesNotMatch(seat.why, /malformed JSON/);
});

test('a spend stop inside the final read is control flow: the run stops with BudgetExceeded (resumable), it is not swallowed into "did not read"', async () => {
  const config = chainOf([
    critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frb2-bx', 'l2a', 2),
    { provider: 'mock', model: 'mock-priced', lab: 'l3big', layer: 3, maxTokens: 8000, estimate: { critiqueTokens: 8000 } },
  ], FR);
  setBudget(1);
  const err = await go(config).then(() => null, e => e);
  assert.ok(err instanceof BudgetExceeded, String(err));
  assert.equal(err.label, 'final-read-l3big', 'the stop is the final read\'s own call, not a stop somewhere else in the run');
  assert.ok(!err.partial?.stages?.some(s => s.label.startsWith('final-read-')), 'the gate stopped the call before it was sent');
});

test('an external layer-3 seat pauses AT the final read; the answered seat is replayed at $0 on resume, the other seat is not asked again, and the record is the same', async () => {
  const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
  const config = () => chainOf([
    critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frr2-rs', 'l2a', 2),
    critic('mock-critic-script-o-frr3-rs', 'l3a', 3), { provider: 'external', model: 'claude-code-session', lab: 'ext', layer: 3 },
  ], FR);
  const saved = new Map();
  const paused = await go(config(), { onStage: s => saved.set(s.label, s) }).then(() => null, e => e);
  assert.ok(paused instanceof ExternalPause, String(paused));
  assert.equal(paused.label, 'final-read-ext');
  assert.ok(saved.has('final-read-l3a'), 'the other layer-3 seat was asked before the pause');
  setCache({ get: label => saved.get(label) ?? (label === 'final-read-ext' ? { text: PASS, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, promptHash: paused.promptHash } : null) });
  const { r } = await go(config());
  assert.deepEqual(r.finalRead.seats.map(s => [s.lab, s.read, s.reasked]), [['l3a', true, false], ['ext', true, false]]);
  assert.equal(r.stages.find(s => s.label === 'final-read-l3a').cached, true, 'the seat answered before the pause is replayed from disk, not asked again');
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('final-read-')).sort(), ['final-read-ext', 'final-read-l3a'], 'one call per seat, no duplicate');
  assert.equal(r.passed, false);
});

test('lint: final_read is refused where it would do nothing (not layered, or not unanimous), accepted on a layered unanimous chain, and an unknown key is refused', () => {
  const layered = chainOf([critic('mock-critic-script-o-frl1', 'a', 1), critic('mock-critic-script-o-frl2', 'b', 2)], FR);
  assert.deepEqual(lintChain(layered).filter(f => /final/.test(f.kind)), []);
  const unlayered = { ...layered, seats: { ...layered.seats, critics: layered.seats.critics.map(({ layer, ...c }) => c) } };
  assert.ok(lintChain(unlayered).some(f => f.kind === 'final-read-needs-layers'));
  assert.ok(lintChain({ ...layered, signoff: 'first' }).some(f => f.kind === 'final-read-needs-layers'));
  assert.ok(lintChain({ ...layered, final_read: { enabled: true, rounds: 2 } }).some(f => /final_read/.test(JSON.stringify(f))), 'an unknown key under final_read is refused');
});

test('the dry run: final-read rows have a system text and a panel-call expected size, only in the MAXIMUM figure and only with the switch on; a re-ask has no expected size', () => {
  const config = chainOf([critic('mock-critic-script-o-frd1', 'a', 1), critic('mock-critic-script-o-frd2', 'b', 2), critic('mock-critic-script-o-frd3', 'c', 3)], { ...FR, maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 } });
  const seat = config.seats.critics[2];
  assert.ok(systemTextsFor('final-read-L3-c', config, seat).every(t => typeof t === 'string' && t.length > 0));
  // the final read honours no freedoms (a stated pass, a blocking question): its system text does not move when the chain grants them, the panel's does
  const withFreedoms = { ...config, freedoms: { pass: true, blocking_questions: true } };
  assert.deepEqual(systemTextsFor('final-read-L3-c', withFreedoms, seat), systemTextsFor('final-read-L3-c', config, seat));
  assert.notDeepEqual(systemTextsFor('panel-L3-c', withFreedoms, seat), systemTextsFor('panel-L3-c', config, seat));
  assert.equal(expectedOutputTokensOf('final-read-c', seat, config.estimate), expectedOutputTokensOf('panel-1-c', seat, config.estimate));
  assert.equal(expectedOutputTokensOf('final-read-c-reask1', seat, config.estimate), null);
  const rowsOf = (cfg, maximum) => estimateChainRows(cfg, { maximum }).filter(r => r.label.startsWith('final-read-'));
  assert.equal(rowsOf(config, true).length, 1);
  assert.deepEqual(rowsOf(config, false), []);
  assert.deepEqual(rowsOf({ ...config, final_read: undefined }, true), []);
  // a chain whose plan is rewritten after the sign-off (a final edit seat or a challenge) has the read in the EXPECTED figure too; B3 has neither
  assert.equal(rowsOf({ ...config, seats: { ...config.seats, finalist: { provider: 'mock', model: 'mock-finalist', lab: 'editor' } } }, false).length, 1);
  assert.equal(rowsOf({ ...config, challenge: { enabled: true } }, false).length, 1);
  // a layered unanimous chain with no maxOverseerRounds (the other estimator branch) gets the row too
  const { maxOverseerRounds, layerRevisions, ...plain } = config;
  assert.equal(rowsOf(plain, true).length, 1);
  assert.deepEqual(rowsOf(plain, false), []);
});

test('real verb: the CLI on a mock chain ends not agreed (exit 22), writes final_read into report.json (schema-valid), the BOARD section and the block above the plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'final-read-cli-'));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const config = neverHeardChain('cli', FR);
  writeFileSync(join(work, 'chains', 'fr.json'), JSON.stringify({ ...config, summary: 'final read test' }));
  const run = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'fr', '--max-usd', '1'], { cwd: work, encoding: 'utf8' });
  assert.equal(run.status, 22, run.stdout + run.stderr);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.final_read.ran, true);
  assert.match(run.stdout, /^final read: l3a no objection; l3b DID NOT READ$/m, 'the end-of-run summary carries the closing statement too');
  assert.deepEqual(report.final_read.seats.map(s => [s.lab, s.read]), [['l3a', true], ['l3b', false]]);
  assert.equal(report.passed, false);
  assert.match(readFileSync(join(runDir, 'BOARD.md'), 'utf8'), /## Final read by layer 3/);
  assert.match(readFileSync(join(runDir, 'deliverable.md'), 'utf8'), /^## Layer 3 on the final plan/m);
  assert.ok(readdirSync(runDir).includes('final-read-l3b-reask1.md'));
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  assert.ok(ajv.compile(schema)(report), 'report.json must validate against schemas/report-v1.json');
});

test('chain-schema: final_read and dispute.review validate (the schema listed neither before unit D)', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  assert.ok(validate({ ...base, final_read: { enabled: true }, dispute: { enabled: true, review: true } }), JSON.stringify(validate.errors));
  assert.ok(!validate({ ...base, final_read: { enabled: true, extra: 1 } }), 'an unknown key under final_read is refused by the schema');
});
