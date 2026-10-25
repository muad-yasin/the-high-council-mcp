// Notes lane 2b-1a, the RECORDS half of the writer side (gate note Notes_Lane_2b1_Gate_Note.md; C&C PASS ON CONDITIONS 16 Okt 2026): the writer's section in the revise prompt, the writer's answers RECORDED (never believed), the cross-round
// memory block, report.json answers + answers_from, the BOARD section, and the M4 rule (a reply the provider ended with error / content_filter / refusal contributes no notes, like a cut one). What machines read (the handoff fold, HANDOFF.md
// block) is 2b-1b. The lane sentences are HELD: test/held-prompts/held-083.js drafts (E items) are injected with setHeldForTest. Offline, $0. Fixture of test/review-notes-wiring.test.js (la 1, lb 2, lc 3, maxOverseerRounds 3).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape, renderBoardMd } from '../src/report-shape.js';
import { noteId } from '../src/review-notes.js';
import { CUT_MARK } from '../src/objection-ledger.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const objecting = (extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ criterion: CRITERION, problem: 'No limit.', fix: 'Add one.' }], verdict_line: 'no', ...extra });
const P = (...texts) => texts.map(text => ({ text }));
const I = (...texts) => texts.map(text => ({ text, about: `about ${text}` }));
const idP = text => noteId('proposal', text); const idI = text => noteId('idea', text);
const WORDS = { reviewNotesAsk: H.reviewNotesAsk, reviewNotesRevise: H.reviewNotesRevise, reviewNotesMemory: H.reviewNotesMemory, reviewNotesAnswer: () => 'A' };
const PROP_H = '## Proposals and improvement ideas from the review judges'; const MEM_H = '## Proposals and improvement ideas from the last overseer round';

async function run(replies, { revise = () => undefined, usage = () => ({ input: 0, output: 0 }), extra = {}, notes = { enabled: true, perKind: 3 }, held = WORDS } = {}) {
  setHeldForTest(held);
  const prompts = new Map(); const served = []; const logs = [];
  setBudget(null); setPromptSpy(p => prompts.set(p.label, p.user));
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? (revise(label) ?? `${DRAFT}\n\nRevision ${label.slice(7)}.`) : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: label.startsWith('panel-') ? usage(label) : { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-writer', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true }, ...(notes ? { reviewNotes: notes } : {}), ...extra,
    seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, critics: [seat('la', 1), seat('lb', 2), seat('lc', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-writer', log: l => logs.push(l), config });
  return { result, prompts, served, logs, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-writer', chain: 'fixture-writer', task: 't.md', result, config }))) };
}
// pass 1: la objects and adds a proposal and two ideas; the writer revises; everything else signs off
const LA = label => (label === 'panel-1-la' ? objecting({ proposals: P('Add a dead-letter queue'), ideas: I('Name the owner', 'State the limit as a number') }) : undefined);
const answerOf = (report, id) => report.review_notes.items.find(i => i.id === id)?.answer;

test('WR-1 (M4 rule, C&C 16 Okt 2026): a sign-off the provider ended with error / content_filter / refusal contributes NO notes (like a cut one): counted dropped reply_incomplete, the seat gets no ask again in that overseer round; the re-ask\'s own notes are read', async () => {
  for (const stop of ['content_filter', 'error', 'refusal']) {
    const replies = l => (l === 'panel-1-la' ? signoff({ proposals: P('f-first') }) : /^panel-1-la-reask/.test(l) ? signoff({ proposals: P('f-reask') }) : undefined);
    const { report, served } = await run(replies, { usage: l => (l === 'panel-1-la' ? { input: 0, output: 0, stop } : { input: 0, output: 0 }) });
    assert.ok(served.includes('panel-1-la-reask1'), `${stop}: re-asked`);
    assert.deepEqual(report.review_notes.items.map(i => i.text), ['f-reask'], `${stop}: only the re-ask's notes are read`);
    assert.deepEqual(report.review_notes.dropped.map(d => `${d.lab}:${d.pass}:${d.why}`), ['la:1:reply_incomplete'], stop);
  }
  // an OBJECTION the provider ended early keeps its verdict (the harness only turns a SIGN-OFF into an abstention): its notes are dropped, the verdict is not
  const obj = await run(l => (l === 'panel-1-la' ? objecting({ proposals: P('o-first') }) : undefined), { usage: l => (l === 'panel-1-la' ? { input: 0, output: 0, stop: 'content_filter' } : { input: 0, output: 0 }) });
  assert.ok(obj.served.includes('revise-1'), 'the objection still counted as a verdict');
  assert.deepEqual(obj.report.review_notes.items, []);
  assert.deepEqual(obj.report.review_notes.dropped.map(d => d.why), ['reply_incomplete']);
});

test('WR-2: the revise prompt carries the writer\'s section AFTER the objections, with every item once (grouped, quoted); a chain whose lane is off (held words missing) gets the revise prompt byte for byte as before', async () => {
  const on = await run(LA);
  const p = on.prompts.get('revise-1');
  assert.ok(p.includes(PROP_H), 'the section is there');
  assert.ok(p.indexOf(PROP_H) > p.indexOf('No limit.'), 'after the objections');
  for (const id of [idP('Add a dead-letter queue'), idI('Name the owner'), idI('State the limit as a number')]) assert.equal(p.split(id).length - 1, 1, `${id} once`);
  // A2 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = held: only the ask; new bar = held: only the ask, the other three masked; why = src/roles.js now records the four lane sentences (Muad 18 Okt, E195), so 'the real roles.js records none of them' no longer holds; a partial or missing set must be MASKED explicitly (setHeldForTest with the names set to undefined).
  const off = await run(LA, { held: { reviewNotesRevise: undefined, reviewNotesMemory: undefined, reviewNotesAnswer: undefined, reviewNotesAsk: H.reviewNotesAsk } });
  assert.equal(off.prompts.get('revise-1').includes(PROP_H), false);
  const none = await run(LA, { notes: null });
  assert.equal(off.prompts.get('revise-1'), none.prompts.get('revise-1'), 'lane off = the chain without the key');
});

test('WR-3: the writer\'s closing answer lines are RECORDED as given (taken / declined with reason / same as / no line = unanswered) with the stage that carried them; the writer\'s claim is not checked; the deliverable text carries no answer lines', async () => {
  const a = idP('Add a dead-letter queue'); const b = idI('Name the owner'); const c = idI('State the limit as a number');
  const revise = l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}\nNOTE-DECLINED: ${b}: out of scope for this plan` : undefined);
  const { report, result } = await run(LA, { revise });
  assert.equal(answerOf(report, a).status, 'taken'); assert.equal(answerOf(report, a).from, 'revise-1');
  assert.deepEqual([answerOf(report, b).status, answerOf(report, b).reason], ['declined', 'out of scope for this plan']);
  assert.equal(answerOf(report, c).status, 'unanswered');
  assert.deepEqual(report.review_notes.answers_from, ['revise-1']);
  assert.equal(JSON.stringify(result.deliveredText ?? result.signedText ?? '').includes('NOTE-'), false, 'no answer line in the delivered text');
  const same = await run(LA, { revise: l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-SAME: ${c}: ${b}\nNOTE-TAKEN: ${b}` : undefined) });
  assert.deepEqual([answerOf(same.report, c).status, answerOf(same.report, c).same_as], ['same', b]);
  const conflict = await run(LA, { revise: l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}\nNOTE-DECLINED: ${a}: no` : undefined) });
  assert.equal(answerOf(conflict.report, a).status, 'conflicting');
});

test('WR-4 (verdicts unchanged): the same run with and without the writer\'s answer lines gives byte-identical signoff, panelVerdicts and outcome; answers change only review_notes', async () => {
  const strip = r => JSON.stringify({ signoff: r.report.signoff, panelVerdicts: r.report.panelVerdicts, passed: r.report.passed, disputes: r.report.disputes });
  const a = idP('Add a dead-letter queue');
  const withAnswers = await run(LA, { revise: l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}` : undefined) });
  const without = await run(LA);
  assert.equal(strip(withAnswers), strip(without));
  assert.notEqual(withAnswers.report.review_notes.items[0].answer.status, without.report.review_notes.items[0].answer.status);
});

test('WR-5 (patch mode): when the patch does not apply, the first reply\'s answer lines AND the full rewrite\'s answer lines are both recorded, each with its own stage', async () => {
  const a = idP('Add a dead-letter queue'); const b = idI('Name the owner');
  const bad = `<<<<<<< SEARCH\nnot in the draft\n=======\nx\n>>>>>>> REPLACE\nNOTE-TAKEN: ${a}`;
  const revise = l => (l === 'revise-1' ? bad : l === 'revise-1-full' ? `${DRAFT}\n\nFull rewrite.\nNOTE-DECLINED: ${b}: no` : undefined);
  const { report, served } = await run(LA, { revise, extra: { revise: { mode: 'patch' } } });
  assert.ok(served.includes('revise-1-full'), 'the patch failed and the fallback ran');
  assert.deepEqual([answerOf(report, a).status, answerOf(report, a).from], ['taken', 'revise-1']);
  assert.deepEqual([answerOf(report, b).status, answerOf(report, b).from], ['declined', 'revise-1-full']);
});

test('WR-6 (memory): from the second overseer round on every judge reads the LAST round\'s items with the writer\'s answers; round 1 and a lane-off chain carry no block; a block over the 40,000-character limit is cut with the cut named', async () => {
  const a = idP('Add a dead-letter queue');
  const replies = l => (l === 'panel-1-la' ? LA(l) : l === 'panel-2-lc' ? objecting() : undefined);
  const revise = l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}` : undefined);
  const r = await run(replies, { revise });
  const second = [...r.prompts].filter(([l]) => /^panel-[3-9]-/.test(l));
  assert.ok(second.length > 0, 'a second overseer round happened');
  assert.ok(second.every(([, u]) => u.includes(MEM_H)), 'every judge prompt of round 2 carries the block');
  assert.ok(second[0][1].includes('the writer says it took it'), 'with the writer\'s answer');
  assert.equal([...r.prompts].filter(([l]) => /^panel-[12]-/.test(l)).some(([, u]) => u.includes(MEM_H)), false, 'round 1 has none');
  const off = await run(replies, { revise, notes: null });
  assert.equal([...off.prompts.values()].some(u => u.includes(MEM_H)), false, 'lane off: none');
  const big = 'x'.repeat(7000);
  const long = await run(l => (l === 'panel-1-la' ? objecting({ proposals: P(`${big}1`, `${big}2`, `${big}3`), ideas: I(`${big}4`, `${big}5`, `${big}6`) }) : l === 'panel-1-lb' ? undefined : l === 'panel-2-lc' ? objecting() : undefined), { revise });
  const m = [...long.prompts].find(([l]) => /^panel-[3-9]-la$/.test(l))?.[1] ?? '';
  assert.ok(m.includes(MEM_H));
  assert.ok(m.length < 60000, 'the block respects the limit');
  assert.ok(m.includes(CUT_MARK), 'items were shortened with the visible cut mark');
});

test('WR-7 (resume identity): a second run on the same replies gives a byte-identical review_notes block (answers and answers_from included) and the same prompts', async () => {
  const a = idP('Add a dead-letter queue');
  const revise = l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}` : undefined);
  const replies = l => (l === 'panel-1-la' ? LA(l) : l === 'panel-2-lc' ? objecting() : undefined);
  const first = await run(replies, { revise }); const again = await run(replies, { revise });
  assert.ok(first.report.review_notes.items.length > 0);
  assert.equal(JSON.stringify(again.report.review_notes), JSON.stringify(first.report.review_notes));
  for (const [label, prompt] of first.prompts) assert.equal(again.prompts.get(label), prompt, label);
});

test('WR-8 (BOARD): the board has a "Proposals and improvement ideas" section per overseer round with raised / cut / not answered counts, the writer "says it took it", never "so it is right", and quoted judge text cannot add a heading', async () => {
  const a = idP('Add a dead-letter queue');
  const revise = l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}` : undefined);
  const { result } = await run(l => (l === 'panel-1-la' ? objecting({ proposals: P('Add a queue\n\n## FAKE HEADING\nmore'), ideas: I('Name the owner') }) : undefined), { revise: l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${idP('Add a queue\n\n## FAKE HEADING\nmore')}` : undefined) });
  const md = renderBoardMd({ runId: 'r-writer', result });
  assert.match(md, /## Proposals and improvement ideas/);
  assert.match(md, /### Overseer round 1: 2 kept, 0 cut for the cap, 1 not answered/);   // A2: E189 round-line wording (was '2 raised, 0 cut, 1 not answered')
  assert.ok(md.includes('the writer says it took it'));
  assert.equal(/so it is right/i.test(md), false);
  assert.equal(/^## FAKE HEADING/m.test(md), false, 'a note cannot add a heading');
});

test('WR-9 (report schema): a report with answers validates against schemas/report-v1.json', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const a = idP('Add a dead-letter queue');
  const { report } = await run(LA, { revise: l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}\nNOTE-DECLINED: ${idI('Name the owner')}: no` : undefined) });
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
  assert.ok(validate(report), JSON.stringify(validate.errors, null, 2));
  assert.ok(report.review_notes.items.every(i => typeof i.answer?.status === 'string'));
});

test('WR-10 (nothing the writer wrote disappears silently): answers that did not become an answer are counted in review_notes.answer_counts - a line naming no item, a DECLINED with no reason, a repeated line, and a LATER different answer for an id already answered (the first answer stands)', async () => {
  const a = idP('Add a dead-letter queue'); const b = idI('Name the owner');
  const revise = l => (l === 'revise-1' ? `${DRAFT}\n\nRevision 1.\nNOTE-TAKEN: ${a}\nNOTE-TAKEN: ${a}\nNOTE-DECLINED: ${b}\nNOTE-TAKEN: N-00000000` : l === 'revise-2' ? `${DRAFT}\n\nRevision 2.\nNOTE-DECLINED: ${a}: changed my mind` : undefined);
  const { report } = await run(l => (l === 'panel-1-la' ? LA(l) : l === 'panel-2-la' ? objecting() : undefined), { revise });
  const c = report.review_notes.answer_counts;
  assert.equal(answerOf(report, a).status, 'taken', 'the first answer stands');
  assert.equal(c.answered_again, 1); assert.equal(c.repeated, 1); assert.equal(c.reasonless, 1); assert.equal(c.unknown_answer_ids, 1);
  assert.equal(c.malformed, 0, 'a malformed answer line (a SAME whose target is not an id) is not collected by the closing walk at all: it stays in the text as visible plan text, so the count is a defensive zero today');
});
