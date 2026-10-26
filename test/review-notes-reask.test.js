// Notes lane 2b-0 (gate note Notes_Lane_2b_Gate_Note.md; C&C PASS ON CONDITIONS 16 Okt 2026, rulings Q1 / Q1b / Q3): the notes of EVERY reply of a pass that parsed - the first reply, a `-answered` attempt, each re-ask - are read
// at the recording step iff the seat ENDS the pass with a recorded verdict (first reply first, ONE shared budget, an id already given in the pass costs no slot); each item records its attempt (the stage-label suffix of the file
// that holds its reply: '' first reply, 'reask1', 'reask2', 'answered'). A seat that ends the pass unheard keeps the drop; a cut-off first reply replaced by the bigger-cap retry is counted dropped `reply_cut_off`.
// Before this unit the notes of a first reply that a re-ask replaced were dropped (`verdict_not_recorded`), and those of a blocking-question attempt, of a cut-off retry's first reply and of a STATED_PASS_OPEN first reply were lost with
// NO record at all (probe m6-closing/notes2b_reask_probe.mjs, before/after files next to it). Fixture style of test/review-notes-wiring.test.js and test/layered-answer-back.test.js; every reply comes from a label-keyed cache. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const F_A = { criterion: CRITERION, problem: 'Layer one: no retry limit is specified.', fix: 'Specify one.' };
const F_B = { criterion: CRITERION, problem: 'Layer two: the retry limit has no unit.', fix: 'Give it a unit.' };
const ID_A = objectionId('la', F_A); const ID_B = objectionId('lb', F_B);
const DRAFT = 'The worker retries failed requests.'; const QUOTE = '`The worker retries failed requests.`';
const verdict = (meets, extra = {}) => JSON.stringify({ meets, criteria: [{ criterion: CRITERION, verdict: meets ? 'MET' : 'FAILED', evidence: meets ? 'Checked.' : 'Missing.' }], failures: meets ? [] : [F_A], verdict_line: meets ? 'ok' : 'no', ...extra });
const objecting = (f, extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no', ...extra });
const withdraw = (id, evidence = QUOTE) => ({ answers: [{ id, status: 'withdrawn', evidence }] });
const P = (...t) => t.map(text => ({ text })); const I = (...t) => t.map(text => ({ text, about: `about ${text}` }));
const ASK_H = '## Proposals and improvement ideas';
const WORDS = { reviewNotesAsk: H.reviewNotesAsk, reviewNotesRevise: () => 'W', reviewNotesMemory: () => 'M', reviewNotesAnswer: () => 'A' };

// Two layered judges (la 1, lb 2) with answer_back. `replies(label)` -> text or undefined (default: a clean sign-off); `usage(label)` -> usage.
async function run(replies, { usage = () => ({ input: 0, output: 0 }), extra = {}, held = {}, notes = { enabled: true, perKind: 3 }, maxRounds = 6 } = {}) {
  setHeldForTest({ ...WORDS, ...held });
  const prompts = new Map(); const served = []; const logs = [];
  setBudget(null); setPromptSpy(p => prompts.set(p.label, p.user));
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label.endsWith('-question')) return { text: 'The limit is a number of attempts.', provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = label.startsWith('panel-') ? (replies(label) ?? verdict(true)) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: label.startsWith('panel-') ? usage(label) : { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-reask', criteria: [CRITERION], maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, ...(notes ? { reviewNotes: notes } : {}), ...extra,
    seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, critics: [seat('la', 1), seat('lb', 2)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-reask', log: l => logs.push(l), config });
  return { result, prompts, served, logs, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-reask', chain: 'fixture-reask', task: 't.md', result, config }))) };
}
// Round 1: la clean, lb objects. Rounds 2-3: la objects (lb is not asked). Round 4: la withdraws its objection, lb is asked: `lb4(label)` is what it says (its first reply and its re-asks).
const retention = lb4 => label => {
  if (label === 'panel-1-lb') return objecting(F_B);
  if (label === 'panel-2-la' || label === 'panel-3-la') return verdict(false);
  if (label === 'panel-4-la') return verdict(true, withdraw(ID_A));
  if (/^panel-4-lb/.test(label)) return lb4(label);
  return undefined;
};
const itemsOf = report => report.review_notes.items.map(i => `${i.lab}:${i.pass}:${i.attempt}:${i.kind}:${i.text}`);
const droppedOf = report => report.review_notes.dropped.map(d => `${d.lab}:${d.pass}:${d.why}${d.kind ? `:${d.kind}` : ''}`);

test('RR-1 (condition a): an answer_back judge signs off clean without answering its own old objection, carrying notes; the re-ask answers it; the FIRST reply\'s notes are read (attempt "") and nothing is counted dropped; the re-ask carries no notes ask', async () => {
  const { report, prompts, served, result } = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('first-p'), ideas: I('first-i') }) : verdict(true, withdraw(ID_B)))));
  assert.ok(served.includes('panel-4-lb-reask1'), 'the unanswered objection led to a re-ask');
  assert.equal(prompts.get('panel-4-lb-reask1').includes(ASK_H), false);
  assert.equal(result.passed, true);
  assert.deepEqual(itemsOf(report), ['lb:4::proposal:first-p', 'lb:4::idea:first-i']);
  assert.deepEqual(droppedOf(report), [], 'a first reply whose items were read is not also counted dropped');
});

test('RR-2 (conditions b and the budget): notes in the first reply AND in the re-ask share ONE budget (perKind 3: 4 proposals offered, 3 read, 1 cut), the first reply first, each item naming its attempt; an id already given in the pass is skipped BEFORE the cut and costs no slot', async () => {
  const two = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('a', 'b') }) : verdict(true, { ...withdraw(ID_B), proposals: P('c', 'd') }))));
  assert.deepEqual(itemsOf(two.report), ['lb:4::proposal:a', 'lb:4::proposal:b', 'lb:4:reask1:proposal:c']);
  assert.deepEqual(two.report.review_notes.cut.map(c => [c.lab, c.pass, c.kind, c.count]), [['lb', 4, 'proposal', 1]], 'one proposal cut, not two budgets');
  const dup = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('a', 'b') }) : verdict(true, { ...withdraw(ID_B), proposals: P('a', 'c', 'd') }))));
  assert.deepEqual(itemsOf(dup.report), ['lb:4::proposal:a', 'lb:4::proposal:b', 'lb:4:reask1:proposal:c'], 'the repeated item "a" is read once (its first time) and takes no slot: "c" is read, only "d" is cut');
  assert.equal(dup.report.review_notes.cut[0].count, 1);
  assert.ok(droppedOf(dup.report).includes('lb:4:duplicate_of_earlier_reply:proposal'), 'the repeat is counted, not silent');
});

test('RR-3: the re-ask also leaves the objection unanswered (the first reply stays the fallback): the run does not pass, and the notes of both replies are read', async () => {
  const { report, result } = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('first-p') }) : verdict(true, { proposals: P('second-p') }))), { maxRounds: 4 });
  assert.equal(result.passed, false);
  assert.deepEqual(itemsOf(report), ['lb:4::proposal:first-p', 'lb:4:reask1:proposal:second-p']);
  assert.deepEqual(droppedOf(report), []);
});

test('RR-4 (the class, one row per trigger; changed by 2b-1a, C&C M4 ruling 16 Okt 2026: the content_filter case moved to test/review-notes-writer.test.js WR-1, a provider-ended reply contributes no notes): a first reply carrying notes that a re-ask replaces - an incomplete table, a reply that states no verdict - has its notes READ when the seat ends heard (attempt "")', async () => {
  const clean = () => undefined;
  const cases = [
    ['incomplete table', JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok', proposals: P('t-first') }), { extra: { signoff_table: { required: true } } }, 't-first'],
    ['no verdict stated', JSON.stringify({ proposals: P('n-first') }), {}, 'n-first'],
  ];
  for (const [name, first, opts, text] of cases) {
    const { report, served } = await run(l => (l === 'panel-1-la' ? first : l === 'panel-1-lb' ? verdict(true) : clean(l)), opts);
    assert.ok(served.includes('panel-1-la-reask1'), `${name}: re-asked`);
    assert.deepEqual(itemsOf(report), [`la:1::proposal:${text}`], name);
    assert.deepEqual(droppedOf(report), [], name);
  }
});

test('RR-5: a STATED PASS: with open own objections the stated pass is re-asked and its notes are read once the re-ask answers (before this unit: lost with no record); a seat that ends ON its stated pass has its notes counted dropped verdict_not_recorded', async () => {
  const passJson = JSON.stringify({ pass: true, pass_reason: 'rather not judge', proposals: P('pass-first') });
  const open = await run(retention(l => (l === 'panel-4-lb' ? passJson : verdict(true, withdraw(ID_B)))), { extra: { freedoms: { pass: true } }, held: { criticStatedPassNote: () => 'You stated a pass while holding open objections of your own.' } });
  assert.deepEqual(itemsOf(open.report), ['lb:4::proposal:pass-first']);
  assert.deepEqual(droppedOf(open.report), []);
  const ends = await run(l => (l === 'panel-1-la' ? passJson : undefined), { extra: { freedoms: { pass: true } } });
  assert.deepEqual(itemsOf(ends.report), []);
  assert.deepEqual(droppedOf(ends.report), ['la:1:verdict_not_recorded']);
});

test('RR-6 (condition 1, the `-answered` attempt): a blocking question that carries notes in attempt 0, answered, then a clean attempt 1: attempt 0\'s notes are READ with attempt "" (before this unit: never stashed, never counted: lost with no record)', async () => {
  const { report, served } = await run(l => (l === 'panel-1-la' ? JSON.stringify({ blocking_question: 'Is the limit per request?', proposals: P('q0-p'), ideas: I('q0-i') }) : undefined), { extra: { freedoms: { blocking_questions: true } } });
  assert.ok(served.includes('panel-1-la-answered'));
  assert.deepEqual(itemsOf(report), ['la:1::proposal:q0-p', 'la:1::idea:q0-i']);
  assert.deepEqual(droppedOf(report), []);
  const both = await run(l => (l === 'panel-1-la' ? JSON.stringify({ blocking_question: 'Is the limit per request?', proposals: P('q0-p') }) : l === 'panel-1-la-answered' ? verdict(true, { proposals: P('q1-p') }) : undefined), { extra: { freedoms: { blocking_questions: true } } });
  assert.deepEqual(itemsOf(both.report), ['la:1::proposal:q0-p', 'la:1:answered:proposal:q1-p'], 'both attempts read, the attempt names the file that holds the reply');
});

test('RR-7: the first reply was CUT OFF at its cap but parsed, carried notes and was replaced by the bigger-cap retry: its notes are counted dropped reply_cut_off (a cut reply can parse from a lucky span, no salvage), not lost with no record; the retry\'s own notes are read', async () => {
  const cutUsage = l => (l === 'panel-1-la' ? { input: 0, output: 10, stop: 'length' } : { input: 0, output: 0 });
  const { report, served } = await run(l => (l === 'panel-1-la' ? verdict(true, { proposals: P('cut-first') }) : l === 'panel-1-la-retry' ? verdict(true, { proposals: P('retry-p') }) : undefined), { usage: cutUsage });
  assert.ok(served.includes('panel-1-la-retry'));
  assert.deepEqual(itemsOf(report), ['la:1:retry:proposal:retry-p']);
  assert.deepEqual(droppedOf(report), ['la:1:reply_cut_off']);
});

test('RR-8: a seat that ends the pass UNHEARD keeps the drop: an incomplete-table first reply with notes, then a re-ask that is unreadable: nothing is read, one verdict_not_recorded', async () => {
  const noTable = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok', proposals: P('lost-p') });
  const { report, served } = await run(l => (l === 'panel-1-la' ? noTable : /^panel-1-la-reask/.test(l) ? 'not json at all' : undefined), { extra: { signoff_table: { required: true } }, maxRounds: 1 });
  assert.ok(served.includes('panel-1-la-reask1'));
  assert.deepEqual(itemsOf(report), []);
  assert.deepEqual(droppedOf(report), ['la:1:verdict_not_recorded']);
});

test('RR-9 (condition 5): no verdict, sign-off or objection record changes: the same re-asked scenario with and without notes gives byte-identical signoff, panelVerdicts, answerBackReplies and outcome', async () => {
  const strip = r => JSON.stringify({ signoff: r.report.signoff, panelVerdicts: r.report.panelVerdicts, answerBackReplies: r.result.answerBackReplies, passed: r.report.passed, disputes: r.report.disputes });
  const withNotes = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('x'), ideas: I('y') }) : verdict(true, { ...withdraw(ID_B), proposals: P('z') }))));
  const without = await run(retention(l => (l === 'panel-4-lb' ? verdict(true) : verdict(true, withdraw(ID_B)))));
  assert.equal(strip(withNotes), strip(without));
  assert.equal(itemsOf(withNotes.report).length, 3);
});

test('RR-10 (condition 2, resume identity): a second run on the same replies of a re-asked seat gives a byte-identical review_notes block, attempt field included, and the same prompts', async () => {
  const replies = retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('a', 'b') }) : verdict(true, { ...withdraw(ID_B), proposals: P('a', 'c') })));
  const first = await run(replies); const again = await run(replies);
  assert.ok(first.report.review_notes.items.every(i => typeof i.attempt === 'string'));
  assert.deepEqual(first.report.review_notes.items.map(i => i.attempt), ['', '', 'reask1']);
  assert.equal(JSON.stringify(again.report.review_notes), JSON.stringify(first.report.review_notes));
  for (const [label, prompt] of first.prompts) assert.equal(again.prompts.get(label), prompt, label);
});

test('RR-11 (lane off): a chain WITHOUT the switch whose judge asks a blocking question with notes in attempt 0 logs and records exactly what it did before: no review_notes block and no "ignored" line for the superseded attempt', async () => {
  const { report, logs } = await run(l => (l === 'panel-1-la' ? JSON.stringify({ blocking_question: 'Is the limit per request?', proposals: P('off-p') }) : undefined), { notes: null, extra: { freedoms: { blocking_questions: true } } });
  assert.equal(report.review_notes, undefined);
  assert.equal(logs.some(l => /review notes:.*ignored/.test(l)), false);
});

test('RR-12 (report schema): a re-asked run\'s report.json, with the items\' attempt field and the dropped rows, validates against schemas/report-v1.json (attempt is a string: "" for the first reply, otherwise a stage-label suffix)', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { report } = await run(retention(l => (l === 'panel-4-lb' ? verdict(true, { proposals: P('a', 'b') }) : verdict(true, { ...withdraw(ID_B), proposals: P('a', 'c') }))));
  assert.deepEqual(report.review_notes.items.map(i => i.attempt), ['', '', 'reask1']);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
});
