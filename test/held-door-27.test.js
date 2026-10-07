// Roadmap item 27 (Astra's 0.8.2 review, 7 Oct 2026, F1), the door: a judge whose CLEAN sign-off leaves some of its own earlier objections without an answer is re-asked once, told which
// ids; what is still unanswered after that is carried as an open failure. The re-ask sentence is held (src/held-roles.js, drafted in test/held-prompts/held-next.js): until it is recorded the
// behaviour is unchanged, so a judge that omits `answers` still lets the round pass (the gap Astra reproduced). $0, offline.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { applyAnswers } from '../src/answer-back.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import * as HN from './held-prompts/held-next.js';
import * as R from '../src/roles.js';
const RECORDED = Object.keys(HN).some(n => n in R);
const BEFORE = { skip: RECORDED && 'the sentence is recorded in src/roles.js: this test describes the state before the re-record' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); });
const on = () => setHeldForTest({ criticUnansweredNote: HN.criticUnansweredNote });

// Judge 'la' objects to the first draft and signs off the revision (how it answers depends on the model); judge 'lb' always signs off and never has objections of its own.
const answerChain = (model, extra = {}, lb = 'mock-critic-cut-signoff-then-fits') => {
  const base = chain('mock-unanimous');
  return { ...base, maxRounds: 3, answer_back: { enabled: true }, ...extra, seats: { ...base.seats, critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: lb, lab: 'lb' }] } };
};
const go = async (model, extra, lb) => {
  const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'Write a short fixture deliverable.', config: answerChain(model, extra, lb), runId: 'r-27', log: () => {} });
  return { r, seen };
};
const NOTE = 'it gave no answer for your objection';
const laOpen = r => (r.signoff.find(s => s.lab === 'la')?.objections || []);

test('27: before the sentence is recorded, nothing changes: a judge that omits `answers` still signs off and the run passes (Astra F1, as reproduced)', BEFORE, async () => {
  const { r, seen } = await go('mock-critic-answers-omit');
  assert.equal(r.passed, true);
  assert.equal(seen.some(p => /-reask\d$/.test(p.label)), false, 'no re-ask');
  assert.deepEqual(r.answerBackReplies.map(x => [x.round, x.lab, x.effect]), [[2, 'la', 'unanswered']]);
});

test('27 door: with the sentence, the judge is re-asked once with the ids it left unanswered; still none: the objection stays open and the run does not pass', async () => {
  on();
  const { r, seen } = await go('mock-critic-answers-omit');
  const first = seen.find(p => p.label === 'panel-2-la');
  const reask = seen.find(p => p.label === 'panel-2-la-reask1');
  assert.ok(first && reask, seen.map(p => p.label).join(', '));
  const id = objectionId('la', { criterion: 'It states the assumptions it was written under.' });
  assert.equal(first.user.includes(NOTE), false, 'the first ask is untouched');
  assert.ok(reask.user.startsWith(first.user), 'the note is appended to the same prompt');
  assert.ok(reask.user.endsWith(`\n\n${HN.criticUnansweredNote({ ids: [id] })}`), reask.user.slice(-600));
  assert.equal(seen.some(p => p.label === 'panel-2-la-reask2'), false, 'one re-ask only (a cost cap)');
  assert.equal(seen.some(p => /^panel-\d+-lb-reask/.test(p.label)), false, 'a judge with no objections of its own is never re-asked');
  assert.equal(r.passed, false, 'an unanswered objection is not a sign-off');
  const r2 = r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la');
  assert.equal(r2.verdict, 'objected', 'recorded as an objection, not as unheard');
  assert.equal(r2.reason_code, null);
  assert.ok(r.panelVerdicts.every(v => v.reason_code !== 'UNANSWERED_OBJECTIONS'), 'the internal code never reaches the report');
  assert.ok(laOpen(r).some(o => o.id === id && o.carried_from_round >= 1), JSON.stringify(laOpen(r)));
});

test('27 door: a judge that answers once it is told (a quoted withdrawal) signs off and the run passes', async () => {
  on();
  const { r, seen } = await go('mock-critic-answers-after-note');
  assert.ok(seen.some(p => p.label === 'panel-2-la-reask1' && p.user.includes(NOTE)));
  assert.equal(r.passed, true);
  assert.deepEqual(r.answerBackReplies.filter(x => x.round === 2).map(x => [x.lab, x.effect]), [['la', 'withdrawn']], 'the re-ask\'s answers replace the first ask\'s record');
});

test('27 door: answered judges are untouched: a quoted withdrawal passes at once, a sustained objection stays open without any re-ask', async () => {
  on();
  const quoted = await go('mock-critic-answers-withdraw-quoted');
  assert.equal(quoted.r.passed, true);
  assert.equal(quoted.seen.some(p => /-reask\d$/.test(p.label)), false);
  const sustained = await go('mock-critic-answers-sustain');
  assert.equal(sustained.r.passed, false);
  assert.equal(sustained.seen.some(p => /^panel-\d+-la-reask/.test(p.label)), false);
});

test('27 door: when another judge objects, the round is revised anyway: no re-ask is paid for, and the unanswered objection is carried at once', async () => {
  on();
  const { r, seen } = await go('mock-critic-answers-omit', {}, 'mock-critic-holdout');
  assert.equal(seen.some(p => /^panel-\d+-la-reask/.test(p.label)), false);
  const r2 = r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la');
  assert.equal(r2.verdict, 'objected');
  assert.equal(r2.reason_code, null);
  const id = objectionId('la', { criterion: 'It states the assumptions it was written under.' });
  assert.ok(laOpen(r).some(o => o.id === id && o.carried_from_round >= 1), JSON.stringify(laOpen(r)));
});

test('27 door: a table gap and unanswered objections in one reply get ONE re-ask whose note names both, table first', async () => {
  on();
  const { seen } = await go('mock-critic-answers-omit', { signoff_table: { required: true } });
  const reasks = seen.filter(p => /^panel-2-la-reask\d$/.test(p.label));
  assert.equal(reasks.length, 1, reasks.map(p => p.label).join(', '));
  const u = reasks[0].user;
  const t = u.indexOf('# Your previous reply could not be counted');
  assert.ok(t > 0 && u.indexOf('It also gave no answer for your objection') > t, u.slice(-900));
  assert.equal(u.split('# Your previous reply could not be counted').length, 2, 'one heading, not two');
});

test('27 door: an EXTERNAL judge (a NEEDS file a session answers) gets the same note on its re-ask, not "could not be read"', async () => {
  on();
  const criterion = 'The plan defines a retry limit.';
  const failure = { criterion, problem: 'No retry limit is specified.', fix: 'Specify a retry limit.' };
  const hashes = new Map(); const prompts = new Map();
  setBudget(null);
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ get(label) {
    let text = 'The worker retries failed requests.';
    if (label.startsWith('panel-')) {
      const fail = label === 'panel-1-la';
      text = JSON.stringify({ meets: !fail, criteria: [{ criterion, verdict: fail ? 'FAILED' : 'MET', evidence: fail ? 'No limit appears.' : 'Checked.' }], failures: fail ? [failure] : [], verdict_line: fail ? 'Limit missing.' : 'Pass.' });
    }
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = (provider, lab) => ({ provider, model: provider === 'external' ? 'subscription:test' : 'mock-review-fixture', lab, maxTokens: 3000 });
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-27-ext', log: () => {}, config: {
    name: 'fixture-27-external', criteria: [criterion], maxRounds: 2, signoff: 'unanimous', answer_back: { enabled: true },
    seats: { builder: seat('mock', 'writer'), reviser: seat('mock', 'writer'), critics: [seat('external', 'la'), seat('mock', 'lb')] },
  } });
  const reask = prompts.get('panel-2-la-reask1');
  assert.ok(reask, [...prompts.keys()].join(', '));
  assert.ok(reask.endsWith(`\n\n${HN.criticUnansweredNote({ ids: [objectionId('la', failure)] })}`), reask.slice(-600));
  assert.equal(reask.includes('could not be read'), false);
  assert.equal(r.passed, false, 'Astra\'s reproduction now fails: the omitted answer no longer passes');
});

test('applyAnswers().unanswered: own objections with no answer, in the carried shape; never ones the judge answered or listed again; `carried` unchanged', () => {
  const OWN = [{ id: 'O-aaaaaaaa', criterion: 'C1', problem: 'p1' }, { id: 'O-bbbbbbbb', criterion: 'C2', problem: 'p2', quote: 'q' }];
  const DRAFT = 'Reads go through one shared cache.';
  const un = critique => applyAnswers({ lab: 'a', critique: { meets: true, failures: [], ...critique }, own: OWN, shownDraft: DRAFT, round: 2 });
  const ids = r => r.unanswered.map(o => o.id);
  assert.deepEqual(ids(un({})), ['O-aaaaaaaa', 'O-bbbbbbbb'], 'omitted');
  assert.deepEqual(ids(un({ answers: [] })), ['O-aaaaaaaa', 'O-bbbbbbbb'], 'empty');
  assert.deepEqual(ids(un({ answers: 'all fine' })), ['O-aaaaaaaa', 'O-bbbbbbbb'], 'not an array');
  assert.deepEqual(ids(un({ answers: [{ id: 'O-aaaaaaaa', status: 'withdrawn', evidence: '`one shared cache`' }] })), ['O-bbbbbbbb'], 'partial');
  assert.deepEqual(ids(un({ answers: [{ id: 'O-zzzzzzzz', status: 'withdrawn', evidence: 'x' }] })), ['O-aaaaaaaa', 'O-bbbbbbbb'], 'an unknown id answers nothing');
  const complete = un({ answers: [{ id: 'O-aaaaaaaa', status: 'withdrawn', evidence: '`one shared cache`' }, { id: 'O-bbbbbbbb', status: 'sustained', evidence: 'still' }] });
  assert.deepEqual(ids(complete), [], 'complete');
  const relisted = applyAnswers({ lab: 'a', critique: { meets: false, failures: [{ criterion: 'C1' }] }, own: [{ ...OWN[0], id: objectionId('a', { criterion: 'C1' }) }], shownDraft: DRAFT, round: 2 });
  assert.deepEqual(relisted.unanswered, [], 'listed again as a failure: the judge still holds it');
  assert.deepEqual(un({}).unanswered[1], { criterion: 'C2', problem: 'p2', fix: '', quote: 'q', id: 'O-bbbbbbbb', carried_from_round: 1 });
  assert.deepEqual(un({}).carried, [], 'carried is unchanged: the stall rule of test/verdict-words.test.js still holds');
});

test('criticUnansweredNote: one id or several, with and without its heading; never the word "table"', () => {
  assert.match(HN.criticUnansweredNote({ ids: ['O-aaaaaaaa'] }), /^# Your previous reply could not be counted\n\nIt said the draft meets the criteria, but it gave no answer for your objection O-aaaaaaaa\. /);
  assert.match(HN.criticUnansweredNote({ ids: ['O-a', 'O-b', 'O-c'] }), /your objections O-a, O-b and O-c\./);
  assert.match(HN.criticUnansweredNote({ ids: ['O-a', 'O-b'], also: true }), /^It also gave no answer for your objections O-a and O-b\. /);
  assert.equal(/table/i.test(HN.criticUnansweredNote({ ids: ['O-a'] })), false);
});

// Label-keyed cache runs for the review's cases (Sonnet review of item 27, 7 Oct 2026): `replies(label)` gives a judge's reply text, or null for a clean sign-off with a full table and no answers.
const C1 = 'The plan defines a retry limit.';
const F1 = { criterion: C1, problem: 'No retry limit is specified.', fix: 'Specify a retry limit.' };
const C2 = 'The plan names who is paged.';
const F2 = { criterion: C2, problem: 'Nobody is paged.', fix: 'Name the on-call.' };
const cacheRun = async (replies, extra = {}) => {
  const hashes = new Map(); const prompts = new Map();
  setBudget(null);
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  const clean = JSON.stringify({ meets: true, criteria: [C1, C2].map(c => ({ criterion: c, verdict: 'MET', evidence: 'Checked.' })), failures: [], verdict_line: 'Pass.' });
  setCache({ get(label) {
    const text = label.startsWith('panel-') ? (replies(label) ?? clean) : 'The worker retries failed requests.';
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = lab => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000 });
  const r = await runChain({ request: 'Write a worker plan.', runId: 'r-27-c', log: () => {}, config: {
    name: 'fixture-27-c', criteria: [C1, C2], maxRounds: 2, signoff: 'unanimous', answer_back: { enabled: true }, ...extra,
    seats: { builder: seat('writer'), reviser: seat('writer'), critics: [seat('la'), seat('lb')] },
  } });
  return { r, prompts };
};
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [C1, C2].map(c => ({ criterion: c, verdict: fs.some(f => f.criterion === c) ? 'FAILED' : 'MET', evidence: 'x' })), failures: fs, verdict_line: 'No.' });

test('27 (review finding 1): a re-ask that ANSWERS but is refused for its table again does not bring the answered objection back', async () => {
  on();
  const noTable = answers => JSON.stringify({ meets: true, criteria: [], failures: [], ...(answers ? { answers } : {}), verdict_line: 'Pass.' });
  const id = objectionId('la', F1);
  const { r, prompts } = await cacheRun(label => label === 'panel-1-la' ? objects(F1)
    : label === 'panel-2-la' ? noTable(null)
      : label === 'panel-2-la-reask1' ? noTable([{ id, status: 'withdrawn', evidence: '`The worker retries failed requests.`' }]) : null, { signoff_table: { required: true } });
  assert.ok(prompts.has('panel-2-la-reask1'));
  assert.deepEqual(r.answerBackReplies.filter(x => x.round === 2).map(x => [x.lab, x.effect]), [['la', 'withdrawn']]);
  const row = r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la');
  assert.equal(row.verdict, 'unheard', 'still refused for its table: unheard, as before item 27');
  assert.equal(row.reason_code, 'INCOMPLETE_TABLE');
  assert.equal((r.signoff.find(s => s.lab === 'la')?.objections || []).some(o => o.id === id), false, 'the withdrawn objection is not carried back');
});

test('27 (review finding 1): a re-ask that comes back unreadable keeps the objections it was asked about open', async () => {
  on();
  const id = objectionId('la', F1);
  const { r } = await cacheRun(label => label === 'panel-1-la' ? objects(F1) : /^panel-2-la-reask/.test(label) ? 'I could not finish' : null);
  const row = r.panelVerdicts.find(v => v.round === 2 && v.lab === 'la');
  assert.equal(row.verdict, 'objected');
  assert.ok((r.signoff.find(s => s.lab === 'la')?.objections || []).some(o => o.id === id));
  assert.equal(r.passed, false);
});

test('27 (review finding 3): a judge that answers one objection and skips another, while objecting, keeps the skipped one open (no re-ask)', async () => {
  on();
  const a = objectionId('la', F1); const b = objectionId('la', F2);
  const { r, prompts } = await cacheRun(label => label === 'panel-1-la' ? objects(F1, F2)
    : label === 'panel-2-la' ? JSON.stringify({ meets: true, criteria: [C1, C2].map(c => ({ criterion: c, verdict: 'MET', evidence: 'ok' })), failures: [], answers: [{ id: a, status: 'sustained', evidence: 'still' }], verdict_line: 'Pass.' }) : null);
  assert.equal(prompts.has('panel-2-la-reask1'), false, 'it objects anyway (a sustained objection): no re-ask is paid for');
  const open = (r.signoff.find(s => s.lab === 'la')?.objections || []).map(o => o.id);
  assert.ok(open.includes(a) && open.includes(b), JSON.stringify(open));
});
