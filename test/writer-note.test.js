// 0.8.4 S4 (M1), Q-l: the WRITER'S FIX NOTE (W34; Q1(f), D35) and the records that sit beside it (T19a, T19l, T19f). Offline, $0: a cache stub answers every stage by its label (the stall-escalation tests' pattern), so the judges object, the writer
// answers and the raiser withdraws exactly when the script says. The wording W34 is HELD (test/held-prompts/held-084-b.js writerFixNote) and so is the rating demand (test/helpers/rating-demand.js): every run injects both, except the row that pins the
// HELD state (byte-identical: the sentence is not sent, a FIX-TAKEN line stays plain text, no `writer_notes`).
// Not claimed: how a model answers the sentence (the mock ignores prompt text); that a passage the writer names was really changed (the record keeps the writer's claim, unverified, and says so in the schema).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import * as DD from '../src/draft-disputes.js';      // namespace imports and a guarded dynamic import, so a tree without the new exports (the red tree) fails each row by assertion and not the whole file at link time
import * as RS from '../src/report-shape.js';
const { parseDisputes } = DD; const { reportJsonShape } = RS;
const fixTakenOf = (...a) => DD.fixTakenOf(...a);
const severityWithMakers = (...a) => RS.severityWithMakers(...a);
const WN = await import('../src/writer-note.js').catch(() => ({}));
const writerNoteRows = (...a) => WN.writerNoteRows(...a);
import * as HB084 from './held-prompts/held-084-b.js';
import * as RC from '../src/roles.js';   // the RECORDED words: the expected fix note below comes from here
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });
const HELD = { ...DEMAND, writerFixNote: HB084.writerFixNote };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const REVISED = 'The worker retries failed requests at most three times.';
const RAISER = 'raiser-alpha';
const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 8 };
const idX = objectionId(RAISER, X);
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failures carried no relation. NEW: a first raise carries relation 'new' (N), a raise of the same failure by the same seat in a later pass `continues <id>` (again). WHY: relationRule is recorded (NS-0193): a judge failure without its relation is an unreadable reply, and a `new` on a standing id mints #2.
const N = f => ({ ...f, relation: 'new' });
const again = (f, lab = RAISER) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const withdraws = id => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "at most three times."' }] });

// layers 1, 2, 3; every stage is answered from the script, else with a clean sign-off / the unchanged draft
async function run({ script = {}, maxRounds = 4, critics = [[RAISER, 1], ['mid-beta', 2], ['top-gamma', 3]], held = HELD } = {}) {
  const prompts = new Map(); const logs = [];
  setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(held);
  setCache({ invalidate() {}, get(label) {
    const text = label in script ? script[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-writer-note', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, maxRounds, seats: { builder, reviser: builder, critics: critics.map(seat) } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-writer-note', log: l => logs.push(l), config });
  return { result, config, prompts, logs };
}

// ---- the parser (pure) ----
test('fixTakenOf: only the exact form counts - the word, a standing-style id, one of the two phrases, a passage', () => {
  assert.deepEqual(fixTakenOf(`FIX-TAKEN: ${idX}: my own: at most three times`), { id: idX, by: 'writer_own', passage: 'at most three times' });
  assert.deepEqual(fixTakenOf(`FIX-TAKEN: ${idX}: the judge's line: State a limit.`), { id: idX, by: 'judge_line', passage: 'State a limit.' });
  assert.deepEqual(fixTakenOf(`FIX-TAKEN: ${idX}: the judge\u2019s line: State a limit.`), { id: idX, by: 'judge_line', passage: 'State a limit.' }, 'a typographic apostrophe, as models write it, is accepted');
  assert.deepEqual(fixTakenOf(`FIX-TAKEN: \`${idX}#r2\`: My own: a passage: with a colon`), { id: `${idX}#r2`, by: 'writer_own', passage: 'a passage: with a colon' });
  for (const bad of [`fix taken: ${idX}: my own: p`, `FIX-TAKEN: ${idX}: my own:`, `FIX-TAKEN: ${idX}: mine: p`, `FIX-TAKEN: not-an-id: my own: p`, `FIX-TAKEN: ${idX} my own: p`, 'FIX-TAKEN: my own: p']) assert.equal(fixTakenOf(bad), null, bad);
});
test('parseDisputes with the wording recorded: well-formed FIX-TAKEN lines (any order with DECLINED lines, closing chatter free) leave the draft and come back as fixTaken; a malformed one stays text', () => {
  const o2 = 'O-0a0a0a0a';
  const text = `${REVISED}\n\nFIX-TAKEN: ${idX}: my own: at most three times\nDECLINED: ${o2}: Section two sets it.\nFIX-TAKEN: ${o2}x: my own: nope\nThanks.`;
  const on = parseDisputes(text, { withIds: true, fixNote: true });
  assert.deepEqual(on.fixTaken, [{ id: idX, by: 'writer_own', passage: 'at most three times' }]);
  assert.equal(on.draft.includes('FIX-TAKEN: ' + idX), false);
  assert.deepEqual(on.disputeIds, [o2]);
  assert.ok(on.draft.includes(`FIX-TAKEN: ${o2}x`), 'a malformed line is plain text: it stays');
  const off = parseDisputes(text, { withIds: true, fixNote: false });
  assert.equal('fixTaken' in off, false, 'the key is absent while the wording is held');
  assert.ok(off.draft.includes(`FIX-TAKEN: ${idX}: my own: at most three times`), 'held: the line is plain text and stays in the draft, byte for byte as before');
  assert.equal(parseDisputes(REVISED, { fixNote: true }).fixTaken, undefined);
});

// ---- the note (pure) ----
test('writerNoteRows: built from the writer\'s lines only - a fix is never inferred, an objection with no line has no row, an unknown id is dropped, both kinds of line for one id is conflicting', () => {
  const failures = [{ id: 'O-aaaaaaaa', lab: 'a', fix: 'State a limit.' }, { id: 'O-bbbbbbbb', lab: 'b', fix: 'Name an owner.' }, { id: 'O-cccccccc', lab: 'c' }, { id: 'O-dddddddd', lab: 'd' }];
  const { rows, dropped } = writerNoteRows({
    failures,
    fixTaken: [{ id: 'O-aaaaaaaa', by: 'judge_line', passage: 'p1' }, { id: 'O-aaaaaaaa', by: 'writer_own', passage: 'p2' }, { id: 'O-cccccccc', by: 'writer_own', passage: 'p3' }, { id: 'O-eeeeeeee', by: 'writer_own', passage: 'p4' }],
    declined: ['Not a defect.', 'Also declined.'], declinedIds: ['O-bbbbbbbb', 'O-cccccccc'],
  });
  assert.deepEqual(rows, [
    { id: 'O-aaaaaaaa', lab: 'a', judge_fix: 'State a limit.', taken: 'writer_own', passage: 'p2' },   // the LAST fix line for an id counts
    { id: 'O-bbbbbbbb', lab: 'b', judge_fix: 'Name an owner.', taken: 'declined', reason: 'Not a defect.' },
    { id: 'O-cccccccc', lab: 'c', taken: 'conflicting' },
  ]);
  assert.deepEqual(dropped, ['O-eeeeeeee']);
  assert.equal('passage' in rows[1], false, 'a declined objection carries no passage');
});

// ---- T19a: the writer takes a fix that differs from the judge's line; the raiser withdraws with a quote found in the revised draft ----
test('T19a: the writer takes its own fix; the raiser\'s answer-back withdraws with a quote found in the revised draft: the objection clears as a FIX and the writer\'s note reads writer_own, with the judge\'s line beside it', async () => {
  const { result, prompts, config } = await run({ script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': `${REVISED}\n\nFIX-TAKEN: ${idX}: my own: at most three times`, 'panel-2-raiser-alpha': withdraws(idX) } });
  assert.equal(result.passed, true, 'the fix differs from the judge\'s line and the objection is still cleared (N25: the route does not depend on which fix was taken)');
  assert.deepEqual(result.writerNotes, [{ pass: 1, stage: 'revise-1', rows: [{ id: idX, lab: RAISER, judge_fix: 'State a limit.', taken: 'writer_own', passage: 'at most three times' }] }]);
  assert.deepEqual(result.severityRun.withdrawn.map(w => [w.lab, w.how, w.cleared_by]), [[RAISER, 'answer_back', 'fix']]);
  assert.equal(result.deliverable.includes('FIX-TAKEN'), false, 'the note line never reaches the deliverable');
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row T19a): OLD: /For each objection that stood, add one line: 'fix taken: the judge's line' or 'fix taken: my own'/ (the first sentence of W34 as the plan printed it). NEW: the whole recorded writerFixNote(), RC.writerFixNote(): 'Add one line for each standing objection, using the exact format below. For a fix, identify whose fix you took ... FIX-TAKEN: <id>: my own: <the passage> ...'. WHY: error 'The input did not match the regular expression /For each objection that stood, add one line ...': the reviewed wording replaced the sentence (git show f60ebad2 -- test/held-prompts/held-084-b.js, writerFixNote; recorded in src/prompts/recorded-084-b.js:78); the revise-1 prompt in the TAP carries the new text. The pin is stronger: the whole note, not a fragment.
  assert.ok(prompts.get('revise-1').includes(RC.writerFixNote()), 'the reviser prompt carries the recorded writer fix note');
  // the judge's line taken: the other phrase
  const judge = await run({ script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': `${REVISED}\n\nFIX-TAKEN: ${idX}: the judge's line: at most three times`, 'panel-2-raiser-alpha': withdraws(idX) } });
  assert.equal(judge.result.writerNotes[0].rows[0].taken, 'judge_line');
  // the record validates against the published schema
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const rep = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-writer-note', chain: 'fixture-writer-note', task: 't.md', result, config })));
  assert.ok(ajv.compile(schema)(rep), JSON.stringify(ajv.errors, null, 2));
  assert.equal(rep.writer_notes[0].rows[0].taken, 'writer_own');
});

// ---- T19l: the writer declines a standing objection with a reason ----
test('T19l: the writer declines a standing objection with a reason: the note reads declined with the reason and NO passage, and no fix-taken line is written for it; an id named by both kinds of line is conflicting; a line for an unknown id is left out and logged; an objection with no line has no row', async () => {
  const declined = await run({ maxRounds: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': `${DRAFT}\n\nDECLINED: ${idX}: Section two sets the limit.`, 'panel-2-raiser-alpha': objects(again(X)) } });
  assert.deepEqual(declined.result.writerNotes, [{ pass: 1, stage: 'revise-1', rows: [{ id: idX, lab: RAISER, judge_fix: 'State a limit.', taken: 'declined', reason: 'Section two sets the limit.' }] }]);
  assert.equal('passage' in declined.result.writerNotes[0].rows[0], false, 'no passage is written for a declined objection');
  const both = await run({ maxRounds: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': `${REVISED}\n\nFIX-TAKEN: ${idX}: my own: at most three times\nDECLINED: ${idX}: Section two sets the limit.`, 'panel-2-raiser-alpha': objects(again(X)) } });
  assert.deepEqual(both.result.writerNotes[0].rows, [{ id: idX, lab: RAISER, judge_fix: 'State a limit.', taken: 'conflicting' }]);
  const unknown = await run({ maxRounds: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': `${REVISED}\n\nFIX-TAKEN: O-deadbeef: my own: at most three times`, 'panel-2-raiser-alpha': objects(again(X)) } });
  assert.equal(unknown.result.writerNotes, undefined, 'a fix line for an id that is no standing objection makes no row');
  assert.ok(unknown.logs.some(l => /revise-1: 1 fix line\(s\) named no objection of this pass and were left out of the record \(O-deadbeef\)/.test(l)));
  const none = await run({ maxRounds: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'revise-1': REVISED, 'panel-2-raiser-alpha': objects(again(X)) } });
  assert.equal(none.result.writerNotes, undefined, 'the writer said nothing about the objection, so there is no note for it (a fix is never inferred from the diff)');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'HELD: with W34 not recorded the sentence is not sent, a FIX-TAKEN line is plain text that stays in the draft, and the report has no `writer_notes`' sat here. NEW: removed; its siblings T19a and T19l assert the recorded state (the sentence sent, FIX-TAKEN lines read into writer_notes). WHY: writerFixNote is recorded (src/prompts/recorded-084-b.js, W34).

// ---- T19f: the record holds the maker of each seat, each rating, every change of it, and the route by which each objection cleared ----
test('T19f: two layer-1 seats of two makers: the record holds the maker of each seat, each rating, every change of it and the route by which each objection cleared', async () => {
  const XA = X; const XB = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 8 };
  const idA = objectionId('raiser-a', XA); const idB = objectionId('raiser-b', XB);
  const { result, config } = await run({ maxRounds: 2, critics: [['raiser-a', 1], ['raiser-b', 1], ['mid-beta', 2], ['top-gamma', 3]], script: {
    'panel-1-raiser-a': objects(N(XA)), 'panel-1-raiser-b': objects(N(XB)), 'revise-1': REVISED,
    'panel-2-raiser-a': withdraws(idA), 'panel-2-raiser-b': objects(again({ ...XB, severity: 5 }, 'raiser-b')),
  } });
  // the seats carry real model ids for the report (the run itself needed none): the maker is read from the config the report is shaped with
  const seats = config.seats.critics.map(c => c.lab === 'raiser-a' ? { ...c, provider: 'anthropic', model: 'claude-opus-5-5' } : c.lab === 'raiser-b' ? { ...c, provider: 'openai', model: 'gpt-6.1' } : c);
  const sev = JSON.parse(JSON.stringify(severityWithMakers({ ...config, seats: { ...config.seats, critics: seats } }, result)));
  assert.deepEqual(sev.makers, { 'raiser-a': 'anthropic', 'raiser-b': 'openai' }, 'a maker per seat; a seat with none (a mock seat) is not listed');
  assert.deepEqual(sev.withdrawn.map(w => [w.id, w.lab, w.severity, w.cleared_by, w.pass]), [[idA, 'raiser-a', 8, 'fix', 2]], 'the rating when raised and the route by which it cleared');
  assert.deepEqual(sev.overrides.rows.map(o => [o.id, o.lab, o.first, o.claimed, o.direction, o.pass]), [[idB, 'raiser-b', 8, 5, 'downgrade', 2]], 'every change of a rating');
  assert.ok(sev.open_at_end.some(o => o.id === idB) && !sev.open_at_end.some(o => o.id === idA), 'the objection that did not clear is listed as open: its route is none');
  // without a maker anywhere the section is what it was
  assert.equal('makers' in severityWithMakers(config, result), false);
});
