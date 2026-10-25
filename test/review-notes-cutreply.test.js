// Notes lane 2b-0b (C&C ruling 16 Okt 2026, after the 2b-0 trace): a reply the provider CUT OFF at its cap (usage stop length) never contributes notes, on any path: it can parse from an early fence the model abandoned (the M3 comment
// in chain.js), a cut OBJECTION still counts as a verdict, and a cut sign-off can be followed by a clean re-ask. Its notes are counted dropped `reply_cut_off` and the seat gets no notes ask again in that overseer round.
// Before this unit (probe m6-closing/notes2b_reask_probe.mjs S12/S13 on 0faaf14): the restored cut objection's notes and the cut retry's notes (after a clean re-ask) were READ. Fixture of test/review-notes-wiring.test.js. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as H from './held-prompts/held-083.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
const objecting = (extra = {}) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ criterion: CRITERION, problem: 'No limit.', fix: 'Add one.' }], verdict_line: 'no', ...extra });
const P = (...texts) => texts.map(text => ({ text }));
const WORDS = { reviewNotesAsk: H.reviewNotesAsk, reviewNotesRevise: () => 'W', reviewNotesMemory: () => 'M', reviewNotesAnswer: () => 'A' };
const ASK_H = '## Proposals and improvement ideas';
const LEN = { input: 0, output: 10, stop: 'length' };

async function run(replies, usage) {
  setHeldForTest(WORDS);
  const prompts = new Map(); const served = [];
  setBudget(null); setPromptSpy(p => prompts.set(p.label, p.user));
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: label.startsWith('panel-') ? usage(label) : { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-cut', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true }, reviewNotes: { enabled: true, perKind: 3 },
    seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, critics: [seat('la', 1), seat('lb', 2), seat('lc', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-cut', log: () => {}, config });
  return { result, prompts, served, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-cut', chain: 'fixture-cut', task: 't.md', result, config }))) };
}
const itemsOf = r => r.review_notes.items.map(i => `${i.lab}:${i.pass}:${i.attempt}:${i.text}`);
const droppedOf = r => r.review_notes.dropped.map(d => `${d.lab}:${d.pass}:${d.why}`);

test('CR-1 (path i): the bigger-cap retry is unreadable, the CUT first reply is restored and its OBJECTION still counts as a verdict (the writer revises), but its notes are NOT read: counted dropped reply_cut_off', async () => {
  const replies = l => (l === 'panel-1-la' ? objecting({ proposals: P('cut-objection-p') }) : l === 'panel-1-la-retry' ? 'not json at all' : undefined);
  const { report, served } = await run(replies, l => (l === 'panel-1-la' ? LEN : { input: 0, output: 0 }));
  assert.ok(served.includes('panel-1-la-retry'), 'the retry was tried');
  assert.ok(served.includes('revise-1'), 'the cut objection still counted as a verdict: the draft went to the reviser');
  assert.deepEqual(itemsOf(report), []);
  assert.deepEqual(droppedOf(report), ['la:1:reply_cut_off']);
});

test('CR-2 (path ii): a cut sign-off (the retry is cut too) is an abstention and the re-ask comes back clean: the notes of BOTH cut replies are counted dropped reply_cut_off (one row per cut reply), none read', async () => {
  const replies = l => (l === 'panel-1-la' ? signoff({ proposals: P('cut-first-p') }) : l === 'panel-1-la-retry' ? signoff({ proposals: P('cut-retry-p') }) : undefined);
  const { report, served } = await run(replies, l => (l === 'panel-1-la' || l === 'panel-1-la-retry' ? LEN : { input: 0, output: 0 }));
  assert.ok(served.includes('panel-1-la-reask1'), 'the cut sign-off was re-asked');
  assert.deepEqual(itemsOf(report), []);
  assert.deepEqual(droppedOf(report), ['la:1:reply_cut_off', 'la:1:reply_cut_off']);
});

test('CR-3: the seat that lost notes to a cut reply gets NO notes ask again in that overseer round (the restored cut objection sends the draft to the reviser and la is asked again in pass 2)', async () => {
  const replies = l => (l === 'panel-1-la' ? objecting({ proposals: P('cut-objection-p') }) : l === 'panel-1-la-retry' ? 'not json at all' : undefined);
  const { prompts, served } = await run(replies, l => (l === 'panel-1-la' ? LEN : { input: 0, output: 0 }));
  assert.ok(prompts.get('panel-1-la').includes(ASK_H), 'the first ask carried the notes ask');
  const next = served.find(x => /^panel-[2-9]-la$/.test(x));
  assert.ok(next, 'la was asked again in a later pass');
  assert.equal(prompts.get(next).includes(ASK_H), false, `${next}: no ask after a cut reply in this overseer round`);
});

test('CR-4: a reply that was NOT cut off keeps today\'s behaviour: the restored/ordinary objection with notes and a normal stop reads its notes (the rule is the stop reason, not the notes)', async () => {
  const { report } = await run(l => (l === 'panel-1-la' ? objecting({ proposals: P('normal-p') }) : undefined), () => ({ input: 0, output: 10, stop: 'stop' }));
  assert.deepEqual(itemsOf(report), ['la:1::normal-p']);
  assert.deepEqual(droppedOf(report), []);
});
