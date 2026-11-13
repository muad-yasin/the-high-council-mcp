// 0.8.4 M1 COMPLETE, unit U1 (the Q15(c) dissent record). U1-1 (this commit): the overrule SOURCE is one function read by W41's display; later commits add the dissent record's rows (DS-1..DS-8) to this file.
// Row DS-9a (the refactor's source pin): `layerThreeOverrulesOf` (W41's display filters) reads `layerThreeOverrulesSource` and does not iterate `escalations` itself; the source is the one place that iterates them for the top layer's overrules. The behaviour pin of the refactor is the whole S7c suite
// (test/s7c-reasons.test.js, test/s7c-cost.test.js), unchanged. The dissent builder (U1-2) joins DS-9: it must call the same source and not iterate `escalations` either.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget, BudgetExceeded } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape, partialReportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { bodyOfDelivered } from '../src/tree-split.js';
import * as HB from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../src/chain.js'), 'utf8');
const bodyOf = name => { const m = new RegExp(`const ${name} = [\\s\\S]*?\\n  \\};\\n`).exec(src); assert.ok(m, `${name} is defined in src/chain.js`); return m[0]; };

test('DS-9a: W41\'s display filters read the ONE overrule source; only the source iterates the escalation rows', () => {
  const source = bodyOf('layerThreeOverrulesSource');
  const display = bodyOf('layerThreeOverrulesOf');
  assert.match(source, /for \(const e of escalations\)/, 'the source iterates the escalation rows (S8\'s sorting rows are concatenated inside it)');
  assert.match(display, /layerThreeOverrulesSource\(\)/, 'W41 reads the source');
  assert.doesNotMatch(display, /\bescalations\b/, 'W41 does not iterate the escalation rows itself');
});

// ---- U1-2 (records): the dissent record. HELD behind `dissentRecordSection` (its text is U1-3): these rows inject a stub function, so only the RECORD is under test. Fixture = the go-up fixture of test/s7-go-up.test.js: layer 2 hits its bound, the plan goes up to layer 3, which overrules the block (unrated or rated 5: it stays open) and signs off.
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', severity: 5 };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker', severity: 5 };
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures Y and L3F carried no rating and no relation, and the dissent section read 'Not rated'. NEW: they carry severity 5, a first raise carries relation 'new' (N) and a repeat by the same seat `continues <id>` (again), so the section reads 'Rated 5' and the board line 'rated 5'. WHY: ratingDemand and relationRule are recorded (src/prompts/recorded-084-b.js): on this layered unanimous chain a failure without a rating or a relation is an unreadable reply; dissentRecordSection prints 'Rated 5' for a rated block (recorded-084-b.js:257).
const N = f => ({ ...f, relation: 'new' });
const again = (f, lab = 'mid-beta') => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const idL3 = objectionId('top-gamma', L3F);
const REASON = 'Section two names the owner.';
const REASON2 = 'Still covered by section two.';
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const keepsOf = (f, id) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [again(f)], verdict_line: 'no', answers: [{ id, status: 'sustained', evidence: 'No owner is named in section two.' }] });
const rules = list => JSON.stringify({ rulings: list });
const rated = (f, severity = 5) => ({ ...f, severity });
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const STUB = { dissentRecordSection: () => '' };
const BOUND = { 'panel-1-mid-beta': objects(N(Y)), 'panel-2-mid-beta': objects(again(Y)) };
const OVERRULE = { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: REASON }]) };
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };

async function run({ held, answers = {}, ov = { rounds: 3, bounds: { 1: 1, 2: 1 } }, retags = null, session = false, stopAt = null } = {}) {
  setHeldForTest(held);
  const script = { ...BOUND, ...answers };
  setCache({ invalidate() {}, get(label) {
    if (label === stopAt) throw new BudgetExceeded({ label, seat: 'raiser-alpha', spent: 0, cap: 1, projected: 2, gate: 2 });
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    if (label.startsWith('build-check-')) return null;
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = session ? SESSION : { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-u1', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: ov.rounds, layerRevisions: ov.bounds,
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result; let err = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-u1', log: () => {}, config, ...(retags ? { retags } : {}) }); } catch (e) { if (!stopAt) throw e; err = e; }
  if (err) return { err, config };
  return { result, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-u1', chain: 'fixture-u1', task: 't.md', result, config }))) };
}
const schema = JSON.parse(readFileSync(resolve(here, '../schemas/report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateAll = ajv.compile(schema);
const validateDissents = ajv.compile({ $defs: schema.$defs, ...schema.properties.dissents });

test('DS-1: an escalated sign-off with the block overruled and still open: the report carries the dissent (name, ratings, ruling with reasons, status open, no kept), and the dispute entry is marked', async () => {
  const { report } = await run({ held: { ...GOUP, ...STUB }, answers: OVERRULE });
  assert.equal(report.dissents?.length, 1, JSON.stringify(report.dissents));
  const d = report.dissents[0];
  assert.deepEqual([d.name, d.lab, d.id, d.criterion, d.problem, d.quote, d.status], ['mid-beta', 'mid-beta', idY, CRITERION, 'No owner is named.', 'The worker', 'open']);
  assert.deepEqual([d.ruling.layer, d.ruling.round, d.ruling.source], [3, 3, 'escalation']);
  assert.ok(d.ruling.reasons.length === 1 && d.ruling.reasons[0].lab === 'top-gamma' && d.ruling.reasons[0].text.includes(REASON), JSON.stringify(d.ruling.reasons));
  assert.equal('kept' in d, false, 'the seat never answered after the ruling: kept is absent (Q4)');
  assert.deepEqual(d.rating.changes, []);
  assert.equal(report.dispute?.reason, 'escalated_signoff');
  assert.equal(report.dispute.open_objections.find(o => o.id === idY)?.dissent, true);
});

test('DS-1b (the finding\'s regression): the AGREED case - a handling session answered good_to_build at the escalated sign-off: the ending is agreed, the dispute stage did not run, and the dissent is on the record with the basis mark', async () => {
  const { report } = await run({ held: { ...GOUP, ...STUB, ...CHECK }, session: true, answers: { ...OVERRULE, 'build-check-1': answer('good_to_build', `${idY} can be built; the owner is named while building.`) } });
  assert.equal(report.ending?.kind, 'agreed', JSON.stringify(report.ending));
  assert.ok(report.ending.basis.includes('dissent_on_record'), JSON.stringify(report.ending.basis));
  assert.equal(report.dispute?.ran, false, 'agreedByCheck skips the dispute branch');
  assert.equal(report.dispute.open_objections, undefined);
  assert.equal(report.dissents?.length, 1);
  assert.equal(report.dissents[0].id, idY);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'DS-2 (held): without the dissent wording recorded there is no `dissents` key, no entry mark and no basis mark' sat here. NEW: removed; its siblings DS-1 and DS-1b assert the recorded dissent (the key, the entry mark and the basis mark) in the not-agreed and the agreed case. WHY: dissentRecordSection is recorded (src/prompts/recorded-084-b.js:255).
test('DS-3 (box risk: long fixture): a `not yet`-style second round: the seat keeps the block in rounds 4 and 5, the plan goes up again in round 6 and the second ruling signs off: the dissent shows the SECOND ruling and `kept` is read against the first overrule', async () => {
  const answers = { 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: REASON }]), 'panel-3-top-gamma': objects(N(L3F)),
    'panel-4-mid-beta': keepsOf(Y, idY), 'panel-5-mid-beta': keepsOf(Y, idY),
    'rule-6-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: REASON2 }]), 'panel-6-top-gamma': withdrawsOf(idL3) };
  const { report } = await run({ held: { ...GOUP, ...STUB }, ov: { rounds: 3, bounds: { 1: 1, 2: 1 } }, answers });
  const d = report.dissents?.find(x => x.id === idY);
  assert.ok(d, JSON.stringify(report.dissents));
  assert.deepEqual([d.ruling.round, d.ruling.reasons[0].text.includes(REASON2)], [6, true], 'the second ruling wins');
  assert.equal(d.kept?.round, 5, 'the latest answer that kept it after the first overrule');
  assert.ok(d.kept.reason?.includes('No owner is named in section two.'), JSON.stringify(d.kept));
});

test('DS-4: the seat withdraws the block with a found quote and the run agrees in full: no dissent (pins that the builder reads the shared open list)', async () => {
  const answers = { ...OVERRULE, 'panel-3-top-gamma': objects(N(L3F)), 'panel-4-mid-beta': withdrawsOf(idY), 'panel-4-top-gamma': withdrawsOf(idL3) };
  const { report } = await run({ held: { ...GOUP, ...STUB }, answers });
  assert.equal('dissents' in report, false);
});

test('DS-5: a re-tag (the block rated 5, re-tagged to 7 by the handler): the rating shows as raised, in force and the change with its pass and who made it', async () => {
  const answers = { 'panel-1-mid-beta': objects(N(rated(Y))), 'panel-2-mid-beta': objects(again(rated(Y))), ...OVERRULE };
  const { report } = await run({ held: { ...DEMAND, ...GOUP, ...STUB }, answers, retags: [{ pass: 3, id: idY, severity: 7, reason: 'A missing owner is worse than first thought.' }] });
  const d = report.dissents?.find(x => x.id === idY);
  assert.ok(d, JSON.stringify(report.dissents));
  assert.deepEqual(d.rating, { as_raised: 5, in_force: 7, changes: [{ pass: 3, from: 5, to: 7, by: 'handler' }] });
});

test('DS-6: a rated-3 block (closed by the overrule, re-tagged to 3) is not a dissent', async () => {
  const answers = { 'panel-1-mid-beta': objects(N(rated(Y))), 'panel-2-mid-beta': objects(again(rated(Y))), ...OVERRULE };
  const { report } = await run({ held: { ...DEMAND, ...GOUP, ...STUB }, answers, retags: [{ pass: 3, id: idY, severity: 3, reason: 'A missing owner does not change what is built.' }] });
  assert.equal('dissents' in report, false);
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the row also ran the held state (no dissent wording recorded) and validated its report without the `dissents` key. NEW: that half is removed; the live report is validated. WHY: dissentRecordSection is recorded.
test('DS-8: the schema accepts the report with the dissents, the basis mark and the entry flag are declared, and a malformed dissent is rejected', async () => {
  const live = await run({ held: { ...GOUP, ...STUB }, answers: OVERRULE });
  assert.ok(validateAll(live.report), JSON.stringify(validateAll.errors));
  assert.ok(validateDissents(live.report.dissents), JSON.stringify(validateDissents.errors));
  assert.equal(validateDissents([{ ...live.report.dissents[0], status: 'closed' }]), false, 'a status other than open is refused (so this row can fail)');
  assert.ok(schema.properties.ending.properties.basis.items.enum.includes('dissent_on_record'));
  assert.equal(schema.properties.dispute.properties.open_objections.items.properties.dissent.type, 'boolean');
});

// CHANGED ACCEPTED (0.8.4 S8 c3 closure, found by the S8 unit set). OLD: the pin found the builder by `const dissentRows = (() => {`. NEW: `(?:const|let) dissentRows = ...`; the assertions on the builder body (it reads layerThreeOverrulesSource() once, never iterates the escalation rows, never reads dissentRows or dissents) are unchanged. WHY: the closure filters the finished list once at the end (`dissentRows = dissentRows.filter(...)`, a dissent is an overrule that left the objection open, and one the closing read closed is not), so the declaration is `let`; the builder itself is the same function. PREDICTED RED ON THE OLD TEST: yes, it is the red of set-0008fba9 (the committed tree without this fix): 'the builder is defined in src/chain.js'.
test('DS-9b: the dissent builder reads the ONE overrule source and does not iterate the escalation rows itself', () => {
  const m = /(?:const|let) dissentRows = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/.exec(src);
  assert.ok(m, 'the builder is defined in src/chain.js');
  assert.match(m[0], /layerThreeOverrulesSource\(\)/);
  assert.doesNotMatch(m[0], /of escalations|escalations\.|escalations\)/);
});

test('DS-10: a partial report never carries the dissents: they are computed at the end, and the partial-report block has no such key (source pin)', () => {
  const m = /const optional = \{[\s\S]*?\n    \};/.exec(src);
  assert.ok(m, 'the partial-report block is found');
  assert.doesNotMatch(m[0], /dissentRows|\bdissents\b/);
});

const REAL = { dissentRecordSection: HB.dissentRecordSection };
const sectionOf = text => { const i = text.indexOf('## Dissents on the record'); if (i < 0) return null; const j = text.indexOf('\n---\n', i); return text.slice(i, j + 5); };

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the section and board pins said 'Not rated' / 'not rated', and a last assertion said that with no dissent wording recorded the board was unchanged. NEW: 'Rated 5' / 'rated 5' (the stub block is rated 5), and the held-board assertion is removed (the stub-renders-nothing assertion before it stays). WHY: dissentRecordSection (recorded-084-b.js:257) and src/report-shape.js:445; the wording is recorded.
test('DS-7: the deliverable carries the new section in the not-agreed case AND in the agreed case (where no dissent block is built), once per dissent, wrapped, ending with a `---` line so the body is still found; the harness note and the board line follow', async () => {
  const notAgreed = await run({ held: { ...GOUP, ...REAL }, answers: OVERRULE });
  const agreed = await run({ held: { ...GOUP, ...REAL, ...CHECK }, session: true, answers: { ...OVERRULE, 'build-check-1': answer('good_to_build', `${idY} can be built; the owner is named while building.`) } });
  for (const [name, w] of [['not agreed', notAgreed], ['agreed', agreed]]) {
    const text = w.result.deliverable;
    const sec = sectionOf(text);
    assert.ok(sec, `${name}: the section is in the deliverable`);
    assert.equal((sec.match(/^### /gm) || []).length, w.report.dissents.length, `${name}: one entry per dissent`);
    assert.ok(sec.includes(`*mid-beta, ${idY}. Rated 5. Overruled by layer 3 in round 3.*`) && sec.includes(REASON) && sec.includes('Layer 3 signed off and overruled the objections below.'), sec);
    assert.ok(w.report.delivered_text.harness_notes.includes('dissent_record_block'), `${name}: ${JSON.stringify(w.report.delivered_text.harness_notes)}`);
    const split = bodyOfDelivered(text, w.result.deliveredText);
    assert.ok(split.body && !split.error, `${name}: the body is still found after the harness blocks: ${split.error}`);
    assert.equal(split.body.includes('Dissents on the record'), false);
    const board = renderBoardMd({ runId: 'r-u1', result: w.result });
    assert.ok(board.includes('## Dissents on the record') && board.includes(`- ${idY} (mid-beta): rated 5; overruled by layer 3 in round 3; not answered after the overrule; open.`), `${name}: the board line`);
    assert.ok(board.includes('the dissents-on-the-record block'), `${name}: the text-label note`);
  }
  assert.ok(notAgreed.result.deliverable.indexOf('## Unresolved dissent') < notAgreed.result.deliverable.indexOf('## Dissents on the record'), 'after the existing block');
  assert.equal(agreed.result.deliverable.includes('## Unresolved dissent'), false, 'the agreed case has no old block');
  const held = await run({ held: { ...GOUP, ...STUB }, answers: OVERRULE });
  assert.equal(held.result.deliverable.includes('Dissents on the record'), false, 'a stub that renders nothing adds nothing');
});

test('DS-8b: with the real section the live report validates, and the harness-note value is declared', async () => {
  const live = await run({ held: { ...GOUP, ...REAL }, answers: OVERRULE });
  assert.ok(validateAll(live.report), JSON.stringify(validateAll.errors));
  assert.ok(schema.properties.delivered_text.properties.harness_notes.items.enum.includes('dissent_record_block'));
});

test('DS-10b (the real partial-report row; box risk: a thrown BudgetExceeded): a run stopped after an escalation overrule has a partial report with the overruled outcome (the control: the run got that far) and NO dissents, and it validates', async () => {
  const { err, config } = await run({ held: { ...GOUP, ...REAL, ...CHECK }, session: true, stopAt: 'panel-4-raiser-alpha', answers: { ...OVERRULE, 'build-check-1': answer('not_yet', `${idY}: Name the owner of the worker before building.`) } });   // CHANGED (box run of 08 Nov 2026): a not_yet that does not name every demanded objection is refused (build-check.js judgeBuildCheck), so the run paused at the check before the stop the row reads
  assert.ok(err instanceof BudgetExceeded, `expected the stop, got ${err}`);
  const partial = JSON.parse(JSON.stringify(partialReportJsonShape({ stoppedBy: 'budget', stoppedAtStage: err.label, runId: 'r-u1', chain: 'fixture-u1', task: 't.md', result: err.partial, config })));
  assert.equal(partial.escalations?.[0]?.outcome?.[0]?.result, 'overruled', 'the ruling had happened');
  assert.equal('dissents' in partial, false);
  assert.ok(validateAll(partial), JSON.stringify(validateAll.errors));
});
