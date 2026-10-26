// E4 UNIT TWO (gate page Review/Build_0.8.3/m6-closing/E4_Gate_Page.md, approved by C&C 14 Oct 2026): the objection ledger wired into runChain for the TOP layer of a layered chain with answer_back. The sentences are HELD
// (test/held-prompts/held-083.js): these tests inject them with setHeldForTest. Every reply comes from a label-keyed cache (the E84 harness style). Layer 1 = la, layer 2 (the top) = lb. $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { HELD_OFF, withHeldOff } from './helpers/held-off.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as RS from '../src/report-shape.js'; // namespace access, so the file still loads against a tree without ledgerOverflowWords (a staged red)
const { reportJsonShape } = RS;
const ledgerOverflowWords = r => RS.ledgerOverflowWords(r);
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const QUOTE = '`The worker retries failed requests.`';
const F_A = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.' };
const F_A2 = { criterion: 'The plan names an owner.', problem: 'Layer one: nobody owns the limit.', fix: 'Name one.' };
const ID_A = objectionId('la', F_A); const ID_A2 = objectionId('la', F_A2);
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const objecting = (...fs) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: fs, verdict_line: 'no' });
const withdraw = (id, evidence) => ({ answers: [{ id, status: 'withdrawn', evidence }] });
const LEDGER_H = '# The objection ledger';
const WORDS_ALL = { criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock, overseerLedgerSection: H.overseerLedgerSection, ledgerOverflowExit: H.ledgerOverflowExit };

async function run(replies, { maxRounds = 4, words = WORDS_ALL, extra = {} } = {}) {
// CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026; X16' scope run on the box). OLD: the helper's `words: false` case set NO override, which meant "the held words are not recorded". NEW: it sets the explicit off map (test/helpers/held-off.js), so the door test still proves the off path once src/roles.js records the words; the map behaves the same today.
// CHANGED ACCEPTED TEST (decider-readiness part (i) fix-up, 24 Okt 2026; the X16'' scope run read 23 failures, not the predicted 19). OLD: the helper's `words: true` case injected the PARTIAL map, so every other held name fell through to src/roles.js once it records them. NEW: the map is merged over the explicit off state (withHeldOff), so only the names the test injects are on. WHY: setHeldForTest replaces the whole map; a door test must say which words are on and keep the rest off. This changed test was failing (w2) in the X16'' run. The map behaves the same today.
  setHeldForTest(words ? withHeldOff(words) : HELD_OFF);
  const hashes = new Map(); const prompts = new Map(); const served = []; const logs = [];
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, ...(layer === undefined ? {} : { layer }) });
  const config = {
    name: 'fixture-e4', criteria: [CRITERION], maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true }, ...extra,
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la', 1), seat('lb', 2)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-e4', log: l => logs.push(l), config });
  return { result, prompts, served, logs, config };
}
// Round 1: la objects with F_A. Round 2: la withdraws F_A quoting the draft (reasoning E1) and is clean, so lb (the top layer) is asked; lb objects with F_B. Round 3: la is clean, lb is asked again.
const F_B = { criterion: 'The plan names an owner.', problem: 'Top layer: nobody owns the limit.', fix: 'Name one.' };
const E1 = 'It now states the limit in section one.';
const climb = () => label => (label === 'panel-1-la' ? objecting(F_A)
  : label === 'panel-2-la' ? signoff(withdraw(ID_A, `${E1} ${QUOTE}`))
    : label === 'panel-2-lb' ? objecting(F_B) : undefined);

test('E4 w1: the TOP layer\'s prompt carries the ledger (a closed row with the judge\'s own reasoning; later its own open objection); layer 1\'s never does', async () => {
  const { prompts } = await run(climb());
  const two = prompts.get('panel-2-lb');
  assert.ok(two.includes(LEDGER_H), 'the top layer is shown the ledger');
  assert.ok(two.includes(ID_A) && two.includes('withdrew it with a quote that was found') && two.includes(E1), 'a closed row with the judge\'s own words from its reply');
  const three = prompts.get('panel-3-lb');
  assert.ok(three.includes(LEDGER_H) && three.includes('open.') && three.includes('Top layer: nobody owns the limit.'), 'round 3: the top layer\'s own open objection is in it');
  for (const l of ['panel-1-la', 'panel-2-la', 'panel-3-la']) assert.equal(prompts.get(l).includes(LEDGER_H), false, `${l}: layer 1 is not shown it`);
});

test('E4 w2: without the held sentence the top layer is asked with the ordinary prompt and the log says so; on a chain WITHOUT answer_back it says why no ledger was built [PINS: no sentence, no ledger]', async () => {
  const held = await run(climb(), { words: { criticStatedPassNote: H.criticStatedPassNote, otherReviewersBlock: H.otherReviewersBlock } });
  assert.equal(held.prompts.get('panel-2-lb').includes(LEDGER_H), false);
  assert.ok(held.logs.some(l => l.includes('ledger section held')));
  const off = await run(climb(), { extra: { answer_back: undefined } });
  assert.equal(off.prompts.get('panel-2-lb').includes(LEDGER_H), false);
  assert.ok(off.logs.some(l => l.includes('ledger not built: answer_back is off')));
});

test('E4 w3: the judge\'s reasoning lives ON the in-memory answer row and never reaches report.json (non-enumerable: a spliced row takes it along), while the top layer is shown it', async () => {
  const { result, prompts } = await run(climb());
  assert.ok(prompts.get('panel-2-lb').includes(E1));
  const row = result.answerBackReplies.find(r => r.id === ID_A && r.effect === 'withdrawn');
  assert.equal(Object.getOwnPropertyDescriptor(row, 'evidence').enumerable, false);
  assert.equal(JSON.stringify(result.answerBackReplies).includes(E1), false, 'not in the serialized records');
  assert.equal('evidence' in { ...row }, false, 'a copy (spread) does not carry it either');
});

test('E4 w4: OVERFLOW of the ACTIVE rows stops the run BEFORE the top ask: layerStop ledger_overflow, the top row not_asked, nothing sent to lb, no reviser, the later block does not overwrite it', async () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ criterion: CRITERION, problem: `Open objection number ${i}: ${'x'.repeat(1400)}`, fix: 'Fix it.' }));
  const replies = label => (label === 'panel-1-lb' ? objecting(...big) : undefined);
  const { result, served, logs } = await run(replies);
  assert.equal(result.passed, false);
  assert.equal(result.layerStop?.reason, 'ledger_overflow', 'the !layerStop guard keeps the later block from rewriting it as no_objection_to_revise');
  assert.equal(result.layerStop.layer, 2);
  assert.ok(result.layerStop.ledger.rows >= 1 && result.layerStop.ledger.chars > 40000, JSON.stringify(result.layerStop.ledger)); // 40 problems under one criterion with no quote share ONE id (answer-back.js): one row, its joined problems over the limit
  const top = result.layers.filter(r => r.layer === 2).pop();
  assert.equal(top.state, 'not_asked');
  assert.equal(served.filter(l => l === 'panel-2-lb').length, 0, 'nothing was sent to the top layer');
  assert.equal(served.includes('revise-2'), false, 'the reviser was not entered');
  assert.ok(logs.some(l => l.includes(`round ${result.layerStop.round}:`) && l.includes('too many to show the top layer in full') && l.includes('Start a new run on a narrower request')), 'the named exit is in the stop line, with the round that stopped');
  // Bug audit 2026-10-24 C-004: the round that stopped here DID ask layer 1 (la, signed off) and paid for it: its verdict is a panelVerdicts row of that round (6dbb52f1 lost it with the early break); the top layer was never asked, so it has none.
  const stopped = result.panelVerdicts.filter(v => v.round === result.layerStop.round);
  assert.deepEqual(stopped.map(v => [v.lab, v.verdict]), [['la', 'signed_off']], 'the asked layer is recorded for the stopped round, the unasked one is not');
  if (result.dispute) assert.equal(result.dispute.reason, 'layer_not_signed_off'); // the dispute stage is off in this fixture
});

// Bug audit 2026-10-24 C-004 (notes half): a judge reply of the stopped round carries a notes part; the stop used to skip the fold that turns the stash into items or dropped rows, so the note vanished from report.json review_notes. Same fixture as w4 with the lane on; la's round-2 sign-off carries one proposal note.
test('E4 w4b: a ledger stop still records the review notes of the layers it asked (the item is in report.json review_notes)', async () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ criterion: CRITERION, problem: `Open objection number ${i}: ${'x'.repeat(1400)}`, fix: 'Fix it.' }));
  const replies = label => (label === 'panel-1-lb' ? objecting(...big) : label === 'panel-2-la' ? signoff({ proposals: [{ text: 'Add a retry queue' }] }) : undefined);
  const { result, config } = await run(replies, { extra: { reviewNotes: { enabled: true, perKind: 3 } } });
  assert.equal(result.layerStop?.reason, 'ledger_overflow');
  const rep = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e4', chain: 'fixture-e4', task: 't.md', result, config })));
  assert.ok(rep.review_notes, 'the lane ran');
  assert.ok(JSON.stringify(rep.review_notes.items).includes('Add a retry queue'), `the note of the asked layer is an item: ${JSON.stringify(rep.review_notes)}`);
});

test('E4 w5: the top layer\'s layers[] row carries the ledger COUNTS (no text), and the report validates against the schema, overflow included', async () => {
  const { result, config } = await run(climb());
  const row = result.layers.find(r => r.round === 3 && r.layer === 2);
  assert.ok(row.ledger && row.ledger.rows >= 2 && row.ledger.active >= 1 && Number.isInteger(row.ledger.chars) && Number.isInteger(row.ledger.tokens_est));
  assert.equal(JSON.stringify(row.ledger).includes(ID_A), false, 'counts only');
  const ajv = new Ajv2020({ strict: false, allErrors: true }); ajv.addFormat('date-time', true);
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  const rep = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e4', chain: 'fixture-e4', task: 't.md', result, config })));
  assert.ok(validate(rep), JSON.stringify(validate.errors, null, 2));
  const big = Array.from({ length: 40 }, (_, i) => ({ criterion: CRITERION, problem: `Open ${i}: ${'x'.repeat(1400)}`, fix: 'Fix it.' }));
  const over = await run(label => (label === 'panel-1-lb' ? objecting(...big) : undefined));
  const rep2 = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-e4', chain: 'fixture-e4', task: 't.md', result: over.result, config: over.config })));
  assert.ok(validate(rep2), JSON.stringify(validate.errors, null, 2));
  assert.equal(rep2.layerStop.reason, 'ledger_overflow');
});

test('E4 w6: RESUME = ZERO NEW CALLS with a ledger: a second sitting over the same folder replays everything and rebuilds the same ledger text', async () => {
  const { makeStageCache, writeSideStage } = await import('../src/stage-cache.js');
  const dir = mkdtempSync(join(tmpdir(), 'e4-resume-'));
  const sitting = async () => {
    setHeldForTest(WORDS_ALL); setCache(makeStageCache({ dir, fingerprint: 'f' }));
    const prompts = new Map(); const real = [];
    setPromptSpy(p => prompts.set(p.label, p.user));
    const tag = `${process.pid}-w6`;
    const seat = (lab, model, layer) => ({ provider: 'mock', model, lab, maxTokens: 3000, layer });
    const config = { name: 'fixture-e4-resume', criteria: [CRITERION], maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, freedoms: { pass: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, critics: [seat('la', 'mock-critic-answers-withdraw-quoted', 1), seat('lb', `mock-critic-script-xo-${tag}`, 2)] } };
    const result = await runChain({ request: 'Write a one-paragraph plan for a bake sale.', runId: 'r-e4r', log: () => {}, config, onStage: s => { if (!s.cached) real.push(s.label); writeSideStage(dir, s, { fingerprint: 'f' }); } });
    return { prompts, real, result };
  };
  const a = await sitting();
  const ledgerPrompts = [...a.prompts].filter(([, u]) => u.includes(LEDGER_H));
  assert.ok(ledgerPrompts.length >= 1, 'fixture: the top layer was shown a ledger in the first sitting');
  const b = await sitting();
  assert.deepEqual(b.real, [], 'zero new calls on the resume');
  for (const [label, user] of ledgerPrompts) assert.equal(b.prompts.get(label), user, `${label}: the rebuilt prompt (ledger included) is byte-identical`);
});

test('E4 w7: the named exit: the --resume refusal text for an overflow-stopped run says what to do instead (held sentence), and is silent for any other run; the refusal itself is unchanged (PIN)', () => {
  setHeldForTest(HELD_OFF);   // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026): OLD no override = held; NEW the explicit off map, because the first assertion is the shipped-without-the-sentence state
  const report = { layerStop: { round: 2, layer: 2, reason: 'ledger_overflow', labs: ['lb'], ledger: { rows: 12, active: 12, closed_cut: 0, chars: 51234, tokens_est: 12809 } } };
  assert.equal(ledgerOverflowWords(report), null, 'no held sentence yet (the shipped state): nothing added');
  setHeldForTest(WORDS_ALL);
  const words = ledgerOverflowWords(report);
  assert.match(words, /Start a new run on a narrower request, or split the request/);
  assert.match(words, /12 objections, 51234 characters; the limit is 40000/);
  const board = RS.renderLayersBoard([{ round: 2, layer: 2, labs: ['lb'], state: 'not_asked' }], report.layerStop);
  assert.match(board, /fewer objections\. This is not agreement\./);
  assert.equal(/objections\.\./.test(board), false, 'the held sentence brings its own full stop: the board adds none'); // (the sentence legitimately contains "council tree ...")
  assert.equal(ledgerOverflowWords({ layerStop: { reason: 'only_stated_passes' } }), null);
  assert.equal(ledgerOverflowWords({}), null);
  // the CLI refusal itself (exit code and generic text) for a finished run with this stop, without the sentence
  const work = mkdtempSync(join(tmpdir(), 'e4-refuse-'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const cli = join(root, 'src', 'cli.js');
  // CHANGED ACCEPTED (decider-readiness part (i) fix-up, 24 Okt 2026): the child that proves the refusal text WITHOUT the sentence starts with the explicit off preload (test/helpers/held-off-preload.js), so it keeps proving the off path once roles.js records the sentence; the child behaves the same today.
  const sh = (...a) => spawnSync(process.execPath, ['--import', join(root, 'test', 'helpers', 'held-off-preload.js'), cli, ...a], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(sh('--task', 'task.md', '--chain', 'mock').status, 0);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs'))[0]);
  const rj = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ ...rj, layerStop: report.layerStop }));
  const resumed = sh('--resume', runDir);
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /already finished \(it has a report\.json\)/);
  assert.equal(/narrower request/.test(resumed.stderr), false, 'PIN: without the held sentence the refusal is the generic one');
});

// Bug audit 2026-10-24 C-005 (ledger half): with the dispute stage on, a ledger-overflow stop wrote "layer 2 gave no usable verdict" into the dissent block at the top of the deliverable although the top layer was never asked (the log line and the board named the ledger). The block now says what the log line says.
test('E4 w7: a ledger-overflow stop with the dispute stage on says in the dissent block that the ledger did not fit, not that a layer gave no usable verdict', async () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ criterion: CRITERION, problem: `Open objection number ${i}: ${'x'.repeat(1400)}`, fix: 'Fix it.' }));
  const { result } = await run(label => (label === 'panel-1-lb' ? objecting(...big) : undefined), { extra: { dispute: { enabled: true, stall_rounds: 99 } } });
  assert.equal(result.layerStop?.reason, 'ledger_overflow');
  assert.equal(result.dispute?.ran, true, 'the dispute stage ran');
  assert.equal(result.dispute.reason, 'layer_not_signed_off');
  assert.match(result.deliverable, /\(the objection ledger did not fit for layer 2 of round \d+, so the panel stopped there\)/, result.deliverable.slice(0, 900));
  assert.doesNotMatch(result.deliverable, /gave no usable verdict/);
});
