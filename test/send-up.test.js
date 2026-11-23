// The "send up" stop choice (0.8.4 debate trees; A-DRAFT wording). Since 1 Nov 2026 it is turned off: a typed `--send-up` is refused (SU-2) and nothing offers it (SU-5, SU-11). What stays is the replay of a choice an older run folder recorded: at a layer-1 revision-bound stop, a recorded send-up passes layer 1's open objections up to layer 2 through the stall escalation's own path (SU-1, SU-3, SU-4, SU-6 to SU-10). It uses no revision;
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
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';
import { reportJsonShape } from '../src/report-shape.js';
import { effectiveLimits, stopIdOf, passCeiling, stopSentence, canSendUp, roundChoiceEntry } from '../src/overseer-rounds.js';
import * as HESC from './held-prompts/held-escalation.js';
import { objectionId } from '../src/objection-ids.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

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
// the choice an older run's person typed back then, as run.json holds it: the replay of a recorded send-up is what stays (a typed one is refused, SU-2)
const recordSendUp = p => { const meta = JSON.parse(readFileSync(join(p.runDir, 'run.json'), 'utf8')); meta.roundChoices = [roundChoiceEntry(partialStop(p), 'send_up')]; writeFileSync(join(p.runDir, 'run.json'), JSON.stringify(meta, null, 2)); };
const schemaOk = report => { const v = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'))); const ok = v(JSON.parse(JSON.stringify(report))); return { ok, errors: v.errors }; };

test('SU-1 end to end: an older run folder that recorded a send-up at layer 1\'s revision bound still goes on from it: no revision is used, layer 2 reviews and the ruling stage runs, the row says trigger send_up', () => {
  const p = layerOneStop('su1');
  try {
    const stop = partialStop(p);
    assert.deepEqual({ kind: stop.kind, why: stop.why, layer: stop.layer, pass: stop.pass }, { kind: 'layer_bound', why: 'revisions', layer: 1, pass: 2 });
    const again = p.run(['--resume', p.runDir]);
    assert.equal(again.status, 23);
    assert.doesNotMatch(again.stdout + again.stderr, /--send-up/, 'the stop screen no longer offers the choice');
    recordSendUp(p);
    const r = p.run(['--resume', p.runDir]);
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
    // CHANGED (0.8.4 apply, the red pins of ROUND2 INTRO-7fe-base). OLD: the match took the intro's tail "whose judges reviewed it", which the new words change on the branch where no ruling was read (this run's ruling stage is answered unreadably by the mock). NEW: the match is scoped to the passed-up section and keeps only what tells this case apart from a stall's ("sent up", not "passed up"); the layer table's own "the plan was sent up a layer while ..." is outside the section.
    assert.ok(board.includes('## Objections passed up a layer'), 'premise: the board has the passed-up section');
    assert.match(board.slice(board.indexOf('## Objections passed up a layer')).split('\n## ')[0], /the plan was sent up a layer, whose judges/);
    assert.deepEqual(schemaOk(report).errors ?? null, null, 'the report still validates');
  } finally { p.done(); }
});

// every file of a temp project: its path and size, and the bytes of every run.json (a refused command must leave all of it as it was)
const snapshot = dir => {
  const out = [];
  const walk = (d, rel) => { for (const e of readdirSync(d, { withFileTypes: true })) { const path = join(d, e.name); const r = join(rel, e.name); if (e.isDirectory()) walk(path, r); else out.push(`${r}:${readFileSync(path).length}${e.name === 'run.json' ? `:${readFileSync(path, 'utf8')}` : ''}`); } };
  walk(dir, '');
  return out.sort();
};
const TURNED_OFF = /--send-up is turned off in this version: to answer a stopped run, use --continue or --finish\. Nothing was run and nothing was spent\./;

test('SU-2 a typed --send-up is refused in every mode and writes nothing: at a layer-1 stop, with --continue, on a start, on a dry run, at another stop, on a subcommand and with --help', () => {
  const p = layerOneStop('su2');
  const cap = project([judge('o', 'su2a', 'l1', 1), judge('o', 'su2b', 'l2', 2), judge('x', 'su2c', 'l3', 3)]);
  try {
    const first = cap.run(['--chain', 'sup', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    const capDir = join(cap.dir, 'runs', readdirSync(join(cap.dir, 'runs'))[0]);
    const before = snapshot(p.dir); const beforeCap = snapshot(cap.dir);
    const refused = [[p, ['--resume', p.runDir, '--send-up']], [p, ['--resume', p.runDir, '--send-up', '--continue']], [p, ['--chain', 'sup', '--task', 'tasks/t.md', '--send-up']],
      [p, ['--chain', 'sup', '--task', 'tasks/t.md', '--dry-run', '--send-up']], [cap, ['--resume', capDir, '--send-up']], [p, ['gate', 'answer', p.runDir, 'x', '--send-up']], [p, ['--help', '--send-up']]];
    for (const [who, args] of refused) {
      const r = who.run(args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, TURNED_OFF, args.join(' '));
    }
    assert.deepEqual(snapshot(p.dir), before, 'a refused command wrote nothing (the layer-1 stop project)');
    assert.deepEqual(snapshot(cap.dir), beforeCap, 'a refused command wrote nothing (the overseer-round stop project)');
    const fin = p.run(['--resume', p.runDir, '--finish']);
    assert.ok(fin.status === 0 || fin.status === 22, fin.stdout + fin.stderr);
    assert.equal(existsSync(join(p.runDir, 'report.json')), true, 'the choices that stay still work');
  } finally { p.done(); cap.done(); }
});

// ---- the chain, on the cache stub: wording and the stall path
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };   // 0.8.4 SG-1: rated 5 (the stall half runs with the rating demand; a rating changes neither the id nor the stall window)
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub raised X in passes 1 and 2 with no relation. NEW: pass 1 carries relation 'new', pass 2 (the same seat raising X again) `continues <id>`. WHY: relationRule is recorded (NS-0193): a judge failure without its relation is an unreadable reply, and a `new` on a standing id mints #2.
async function chainRun({ roundChoices = [], stall = false }) {
  const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest(stall ? DEMAND : null);   // 0.8.4 SG-1: the stall climb needs the rating demand (and answer_back, in the config); the person's send_up is not gated
  setCache({ invalidate() {}, get(label) {
    const text = label === 'panel-1-raiser-alpha' ? objects({ ...X, relation: 'new' }) : label === 'panel-2-raiser-alpha' ? objects({ ...X, relation: `continues ${objectionId('raiser-alpha', X)}` }) : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row 'SU-3'): OLD: `answer_back: { enabled: true }` on every run of this stub. NEW: answer_back (and the dispute window) only on the stall half: `...(stall ? { answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 } } : {})`; the send-up half runs on a chain without the answer-back list, as the SU-1 CLI chain does (its stop is read in the TAP: SU-1 ok). WHY: the TAP's error line "without a choice the run stops at layer 1's revision bound" (expected true, actual false): with ratingDemand and layerOneGoUpLine recorded, the automatic go-up at layer 1's revision bound (src/chain.js:6676, `layer1BoundGoUp(stop) && callGates.goUpOn && layerOneGoUpLineOn()`, goUpOn = ledgerOn && severityOn = answer_back on && the demand, src/call-gates.js:47-49) sends layer 1's objection up instead of stopping, so the first run no longer stops. Where the chain has no answer-back list the go-up cannot fire and the stop stands, the state an older run folder with a recorded send-up came from. The relation fields of the stub stay (the stall half reads them; an off-chain ignores them, caa86e36). Nothing after the first assertion ran in job 12: the send-up replay and the stall half are for the box to decide.
  const config = { name: 'fixture-sup', criteria: [CRITERION], signoff: 'unanimous', ...(stall ? { answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 } } : {}),
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

test('SU-5 no stop sentence offers --send-up: not at a layer-1 revision stop, not at any other', () => {
  const stop = { kind: 'layer_bound', why: 'revisions', layer: 1, overseer_round: 1, pass: 2, bound: 1, used: 1 };
  for (const at of [stop, { ...stop, layer: 2 }, { kind: 'overseer_cap', overseer_round: 1, pass: 2, cap: 1, rounds: 1 }, { kind: 'layer_bound', why: 'unheard', layer: 1, passes: 3, reasks: 2, overseer_round: 1, pass: 2 }]) {
    const text = stopSentence(at, { runDir: 'runs/x' });
    assert.ok(!/--send-up|pass the plan up/.test(text), JSON.stringify(at));
    assert.match(text, /--continue/); assert.match(text, /--finish/);
  }
});

test('SU-11 the usage text no longer lists --send-up', () => {
  const p = project([judge('o', 'su11a', 'l1', 1)]);
  try {
    const r = p.run(['--help']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = r.stdout + r.stderr;
    assert.ok(text.includes('--continue | --finish'), 'the usage text is printed');
    assert.ok(!/send-up/.test(text), 'and it does not mention --send-up');
  } finally { p.done(); }
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

test('SU-7 the dissent block of a run that went on after a recorded send-up says layer 1 had used its revisions, not that the objection stood unchanged', () => {
  const p = project([judge('x', 'su7a', 'l1', 1), judge('o', 'su7b', 'l2', 2), judge('o', 'su7c', 'l3', 3)], { dispute: { enabled: true, stall_rounds: 9 } });
  try {
    assert.equal(p.run(['--chain', 'sup', '--task', 'tasks/t.md']).status, 23);
    p.runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    recordSendUp(p);
    const r = p.run(['--resume', p.runDir]);
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
