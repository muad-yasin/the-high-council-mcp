// The "send up" stop choice (0.8.4 debate trees; A-DRAFT wording): at a layer-1 revision-bound stop, `--resume <run> --send-up` passes layer 1's open objections up to layer 2 through the stall escalation's own path. It uses no revision;
// layer 2 reviews the plan blind, then rules with the raiser hidden. Offline, $0: mock judges (a layer-1 judge that always objects, layers 2 and 3 that sign off) and the cache stub of test/stall-escalation.test.js.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget, RoundStopped } from '../src/chain.js';
import { reportJsonShape } from '../src/report-shape.js';
import { effectiveLimits, stopIdOf, passCeiling, stopSentence, canSendUp, roundChoiceEntry } from '../src/overseer-rounds.js';
import * as HESC from './held-prompts/held-escalation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); });

// ---- the CLI, end to end on mock judges
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'sup', signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
const project = (critics, over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'sup-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'sup.json'), JSON.stringify(chainOf(critics, over)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
};
// layer 1 objects in every pass, layer 2 and layer 3 sign off whenever they are asked: the run stops at layer 1's revision bound (1 revision) in pass 2.
const layerOneStop = id => { const p = project([judge('x', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('o', `${id}c`, 'l3', 3)]); const r = p.run(['--chain', 'sup', '--task', 'tasks/t.md']); assert.equal(r.status, 23, r.stdout + r.stderr); p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]); return p; };
const partialStop = p => JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
const schemaOk = report => { const v = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'))); const ok = v(JSON.parse(JSON.stringify(report))); return { ok, errors: v.errors }; };

test('SU-1 end to end: stopped at layer 1\'s revision bound, --send-up passes the plan up: no revision is used, layer 2 reviews and the ruling stage runs, the row says trigger send_up', () => {
  const p = layerOneStop('su1');
  try {
    const stop = partialStop(p);
    assert.deepEqual({ kind: stop.kind, why: stop.why, layer: stop.layer, pass: stop.pass }, { kind: 'layer_bound', why: 'revisions', layer: 1, pass: 2 });
    const again = p.run(['--resume', p.runDir]);
    assert.equal(again.status, 23);
    assert.match(again.stdout + again.stderr, /--send-up \(layer 1's open objections go up to layer 2/, 'the stop screen names the choice');
    const r = p.run(['--resume', p.runDir, '--send-up']);
    assert.ok(r.status === 0 || r.status === 22, r.stdout + r.stderr);
    const choices = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')).roundChoices;
    assert.deepEqual(choices.map(c => [c.stop, c.choice]), [[stopIdOf(stop), 'send_up']]);
    const files = readdirSync(p.runDir);
    assert.ok(files.includes('revise-1.md') && !files.includes('revise-2.md'), 'the one revision was used before the stop; the send-up used none');
    assert.ok(files.some(f => /^panel-3-l2/.test(f)) && files.some(f => /^rule-3-l2/.test(f)), 'pass 3: layer 2 reviewed the plan and its ruling stage ran');
    assert.ok(files.some(f => /^panel-3-l3/.test(f)), 'the top layer read the plan in the same pass (the passes the escalation needs were granted)');
    assert.ok(!/round cap \(\d+\) reached/.test(r.stdout + r.stderr), 'the run did not end on the pass cap');
    assert.equal(existsSync(join(p.runDir, 'STOPPED-layer_bound.json')) || existsSync(join(p.runDir, 'report-partial.json')), false, 'the stop markers are gone once the run went on');
    const report = JSON.parse(readFileSync(join(p.runDir, 'report.json'), 'utf8'));
    assert.equal(report.escalations.length, 1);
    assert.deepEqual({ trigger: report.escalations[0].trigger, from: report.escalations[0].from_layer, to: report.escalations[0].to_layer, pass: report.escalations[0].pass }, { trigger: 'send_up', from: 1, to: 2, pass: 3 });
    assert.equal(report.layers.find(x => x.round === 3 && x.layer === 1).state, 'escalated');
    assert.equal(report.layers.find(x => x.round === 3 && x.layer === 1).escalated_by, 'send_up');
    // what Muad reads after a send-up must not say the objections "stood unchanged": the deliverable (dissent block, escalated sign-off block), the board (layer table, passed-up section) and the run log
    const texts = ['deliverable.md', 'BOARD.md'].filter(f => existsSync(join(p.runDir, f))).map(f => [f, readFileSync(join(p.runDir, f), 'utf8')]);
    assert.ok(texts.length === 2, 'both files exist');
    for (const [f, t] of texts) assert.ok(!/stood unchanged/.test(t), `${f} says the objections stood unchanged`);
    const board = texts.find(([f]) => f === 'BOARD.md')[1];
    assert.match(board, /sent up a layer while its objections were still open/);
    assert.match(board, /still open when layer 1 had used its revisions in pass 2/);
    assert.ok(!/stood unchanged/.test(r.stdout + r.stderr), 'nor does the run log or the final verdict line');
    assert.match(board, /the plan was sent up a layer, whose judges reviewed it/);
    assert.deepEqual(schemaOk(report).errors ?? null, null, 'the report still validates');
  } finally { p.done(); }
});

test('SU-2 refusals leave nothing behind: with --continue, without --resume, at the overseer-round limit, and for a finished run', () => {
  const p = layerOneStop('su2');
  const cap = project([judge('o', 'su2a', 'l1', 1), judge('o', 'su2b', 'l2', 2), judge('x', 'su2c', 'l3', 3)]);
  try {
    const runJson = () => readFileSync(join(p.runDir, 'run.json'), 'utf8');
    const before = runJson();
    let r = p.run(['--resume', p.runDir, '--send-up', '--continue']);
    assert.equal(r.status, 2); assert.match(r.stdout + r.stderr, /third choice beside --continue and --finish: give one\. Nothing was run and nothing was spent/);
    r = p.run(['--chain', 'sup', '--task', 'tasks/t.md', '--send-up']);
    assert.equal(r.status, 2); assert.match(r.stdout + r.stderr, /--send-up answers a stopped run: use it with --resume <run folder>\. Nothing was run and nothing was spent/);
    assert.equal(runJson(), before, 'a refused command wrote nothing');
    const first = cap.run(['--chain', 'sup', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const capDir = join(cap.dir, 'runs', readdirSync(join(cap.dir, 'runs'))[0]);
    r = cap.run(['--resume', capDir, '--send-up']);
    assert.equal(r.status, 2); assert.match(r.stdout + r.stderr, /offered only when layer 1 has used its revisions and still objects; this run is stopped for another reason \(the overseer-round limit\)\. Choose --continue or --finish/);
    assert.equal('roundChoices' in JSON.parse(readFileSync(join(capDir, 'run.json'), 'utf8')), false, 'nothing recorded at the wrong stop');
    const fin = p.run(['--resume', p.runDir, '--finish']);
    assert.ok(fin.status === 0 || fin.status === 22, fin.stdout + fin.stderr);
    assert.equal(existsSync(join(p.runDir, 'report.json')), true);
  } finally { p.done(); cap.done(); }
});

// ---- the chain, on the cache stub: wording and the stall path
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
async function chainRun({ roundChoices = [], stall = false }) {
  const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setCache({ invalidate() {}, get(label) {
    const text = label === 'panel-1-raiser-alpha' || label === 'panel-2-raiser-alpha' ? objects(X) : label.startsWith('panel-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-sup', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, ...(stall ? { dispute: { enabled: true, stall_rounds: 2 } } : {}),
    maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, seats: { builder, reviser: builder, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-sup', log: () => {}, config, roundChoices }).catch(e => { e.prompts = prompts; throw e; });
  return { result, prompts, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-sup', chain: 'fixture-sup', task: 't.md', result, config }))) };
}

test('SU-3 the stop, then the choice: a send-up records trigger send_up and its three reworded sentences; a stall escalation keeps trigger stall and the recorded text byte for byte', async () => {
  const stopped = await chainRun({}).then(() => null, e => e);
  assert.ok(stopped instanceof RoundStopped, 'without a choice the run stops at layer 1\'s revision bound');
  const entry = roundChoiceEntry({ ...stopped.stop, pass: stopped.stop.pass }, 'send_up');
  const { report, prompts } = await chainRun({ roundChoices: [entry] });
  assert.equal(report.escalations[0].trigger, 'send_up');
  const rule = prompts.get('rule-3-mid-beta');
  assert.ok(rule, 'layer 2 ruled in pass 3');
  assert.match(rule.system, /were still open after the first layer had used all the revisions it was allowed\. Rule on each of them/);
  assert.ok(!/stood unchanged/.test(rule.system + rule.user), 'nothing in the ruling prompt says the objection stood unchanged');
  assert.match(rule.user, /it was still open when the first layer had used its revisions in round 2\./);
  assert.equal(rule.system.split('\n')[0], HESC.escalationRulingSystem().split('\n')[0], 'the first line is the recorded one');
  assert.ok(!rule.user.includes('raiser-alpha'), 'the raiser stays hidden');
  const stall = await chainRun({ stall: true });
  assert.equal(stall.report.escalations[0].trigger, 'stall');
  assert.equal(stall.prompts.get('rule-3-mid-beta').system, HESC.escalationRulingSystem(), 'the stall wording is byte for byte the recorded one');
  assert.equal(stall.prompts.get('rule-3-mid-beta').user, HESC.escalationRulingUser({ request: 'Write a worker plan with a retry limit.', plan: stall.prompts.get('rule-3-mid-beta').user.split('# The plan as it stands\n\n')[1].split('\n\n# The objections')[0], items: [{ id: stall.report.escalations[0].ids[0], first_round: 1, rounds: [1, 2], criterion: CRITERION, problem: X.problem, quote: X.quote }] }), 'and so is the stall item sentence');
});

test('SU-4 the pass ceiling: a recorded send-up grants layer 2 its passes on the backstop ceiling and no revision; other choices and stops are untouched', () => {
  const cfg = chainOf([judge('x', 'su4a', 'l1', 1), judge('o', 'su4b', 'l2', 2)]);
  const stop = { kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 1, pass: 2, bound: 1 };
  const base = effectiveLimits(cfg, []);
  const up = effectiveLimits(cfg, [roundChoiceEntry(stop, 'send_up')]);
  assert.equal(base.passes, passCeiling(cfg));
  assert.equal(up.passes, passCeiling(cfg) + cfg.layerRevisions[2] + 2, 'passes granted: layer 2\'s loop plus its first review and the top layer\'s read');
  assert.deepEqual(up.layerRevisions, base.layerRevisions, 'no revision is granted');
  assert.equal(up.overseer, base.overseer);
  assert.equal(effectiveLimits(cfg, [roundChoiceEntry({ ...stop, layer: 2 }, 'send_up')]).passes, base.passes, 'a send_up entry at another stop grants nothing');
  assert.equal(effectiveLimits(cfg, [roundChoiceEntry({ kind: 'overseer_cap', overseer_round: 1, pass: 2, cap: 1 }, 'send_up')]).passes, base.passes);
  assert.equal(canSendUp(stop), true); assert.equal(canSendUp({ ...stop, layer: 2 }), false); assert.equal(canSendUp({ kind: 'overseer_cap' }), false); assert.equal(canSendUp({ ...stop, why: 'unheard' }), false);
});

test('SU-5 the stop sentence names --send-up at a layer-1 revision stop only', () => {
  const stop = { kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 1, pass: 2, bound: 1, used: 1 };
  assert.match(stopSentence(stop), /--send-up/);
  for (const other of [{ ...stop, layer: 2 }, { kind: 'overseer_cap', overseer_round: 1, pass: 2, cap: 1, rounds: 1 }, { kind: 'layer_bound', why: 'unheard', layer: 1, passes: 3, reasks: 2, overseer_round: 1, pass: 2 }]) assert.ok(!/--send-up/.test(stopSentence(other)), JSON.stringify(other));
});

test('SU-6 the four texts: a send-up reads truthfully, a stall reads byte for byte as it did', async () => {
  const { escalatedSignoffBlock } = await import('../src/escalation.js');
  const { layerStateWord, LAYER_STATE_WORDS } = await import('../src/layers.js');
  const esc = trigger => [{ pass: 3, round: 2, to_layer: 2, ids: ['O-aaaaaaaa'], trigger, rulings: [], outcome: [{ id: 'O-aaaaaaaa', lab: 'l1', layer: 1, result: 'undecided', problem: 'p' }] }];
  const block = trigger => escalatedSignoffBlock({ end: { pass: 4, layer: 3 }, escalations: esc(trigger), replies: [], signoff: [], standing: new Set() });
  assert.match(block('stall'), /objections that stood unchanged over consecutive rounds were passed up a layer instead of ending the run\. This is not consensus\./);
  assert.match(block('send_up'), /objections that were still open after layer 1 had used its revisions were sent up a layer instead of ending the run\. This is not consensus/);
  assert.ok(!/stood unchanged/.test(block('send_up')));
  const mixed = escalatedSignoffBlock({ end: { pass: 4, layer: 3 }, escalations: [...esc('stall'), ...esc('send_up')], replies: [], signoff: [], standing: new Set() });
  assert.match(mixed, /stood unchanged over consecutive rounds were passed up a layer, and objections that were still open after layer 1 had used its revisions were sent up a layer, instead of ending the run\./);
  assert.equal(layerStateWord({ state: 'escalated' }), LAYER_STATE_WORDS.escalated, 'a stall row keeps its recorded word');
  assert.equal(LAYER_STATE_WORDS.escalated, 'not asked (objections that stood unchanged were passed up a layer)');
  assert.equal(layerStateWord({ state: 'escalated', escalated_by: 'send_up' }), 'not asked (the plan was sent up a layer while its objections were still open)');
  assert.equal(layerStateWord({ state: 'objected' }), LAYER_STATE_WORDS.objected);
});

test('SU-7 the dissent block of a run that went on after a send-up says layer 1 had used its revisions, not that the objection stood unchanged', () => {
  const p = project([judge('x', 'su7a', 'l1', 1), judge('o', 'su7b', 'l2', 2), judge('o', 'su7c', 'l3', 3)], { dispute: { enabled: true, stall_rounds: 9 } });
  try {
    assert.equal(p.run(['--chain', 'sup', '--task', 'tasks/t.md']).status, 23);
    p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    const r = p.run(['--resume', p.runDir, '--send-up']);
    assert.ok(r.status === 0 || r.status === 22, r.stdout + r.stderr);
    const deliverable = readFileSync(join(p.runDir, 'deliverable.md'), 'utf8');
    assert.match(deliverable, /it was still open when layer 1 had used its revisions in round 2 and was sent up a layer, where no ruling closed it/);
    assert.ok(!/stood unchanged/.test(deliverable));
  } finally { p.done(); }
});

test('SU-8 the conflict note: a swing found in the pass that was sent up says layer 1 had used its revisions; a stall keeps its words', async () => {
  const { renderDecisionsBoard } = await import('../src/report-shape.js');
  const d = [{ pass: 2, ids: ['O-aaaaaaaa', 'O-bbbbbbbb'], labs: ['l1', 'l2'], layers: [1, 2], silent_round: 2, why: 'escalated' }];
  assert.match(renderDecisionsBoard(d, [{ round: 2, trigger: 'stall' }]), /the pass that found it stalled, and its objections were passed up a layer instead/);
  assert.match(renderDecisionsBoard(d), /the pass that found it stalled, and its objections were passed up a layer instead/, 'no escalation rows: the recorded words');
  assert.match(renderDecisionsBoard(d, [{ round: 2, trigger: 'send_up' }]), /the pass that found it ended at layer 1's revision limit, and its objections were sent up a layer instead/);
});

test('SU-9 a run that had a stall AND a send-up (handler A has a stall already): every text says both causes, each decision its own', async () => {
  const { renderDecisionsBoard } = await import('../src/report-shape.js');
  const mixed = [{ round: 2, trigger: 'stall' }, { round: 5, trigger: 'send_up' }];
  const d = pass => ({ pass, ids: ['O-aaaaaaaa', 'O-bbbbbbbb'], labs: ['l1', 'l2'], layers: [1, 2], silent_round: pass, why: 'escalated' });
  const board = renderDecisionsBoard([d(2), d(5)], mixed);
  const lines = board.split('\n').filter(l => l.startsWith('- Pass'));
  assert.match(lines[0], /the pass that found it stalled, and its objections were passed up a layer instead/, 'the stall pass keeps the stall words');
  assert.match(lines[1], /the pass that found it ended at layer 1's revision limit, and its objections were sent up a layer instead/, 'the send-up pass says what is true for it');
  const { renderEscalationsBoard } = await import('../src/report-shape.js');
  const rows = tr => tr.map((t, i) => ({ round: 2 + i, pass: 3 + i, to_layer: 2, trigger: t, ids: [], rulings: [], outcome: [] }));
  assert.match(renderEscalationsBoard(rows(['stall', 'send_up'])), /Some of a lower layer's objections stood unchanged for the stall rule's rounds and some were still open after layer 1 had used its revisions, so instead of ending the run the plan was passed up a layer/);
  assert.match(renderEscalationsBoard(rows(['stall'])), /A lower layer's objections stood unchanged for the stall rule's rounds, so instead of ending the run the plan was passed up a layer, whose judges/);
});

test('SU-10 the final verdict line: the stall words byte for byte, the send-up words, and both for a run that had both', async () => {
  const { escalationCauseWords } = await import('../src/escalation.js');
  assert.equal(escalationCauseWords([{ trigger: 'stall' }]), 'objections that stood unchanged were passed up');
  assert.equal(escalationCauseWords(undefined), 'objections that stood unchanged were passed up');
  assert.equal(escalationCauseWords([{ trigger: 'send_up' }]), "objections that were still open at layer 1's revision limit were sent up");
  assert.equal(escalationCauseWords([{ trigger: 'stall' }, { trigger: 'send_up' }]), "objections that stood unchanged were passed up and others that were still open at layer 1's revision limit were sent up");
});
