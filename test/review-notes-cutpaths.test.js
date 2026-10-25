// Notes lane 2b-0b, C&C's three review checks on BOTH cut paths (verdict unchanged byte for byte, the no-further-ask block, resume identity incl. the order of the dropped rows). See test/review-notes-cutreply.test.js for the rule.
// (header of the rule file follows) Notes lane 2b-0b (C&C ruling 16 Okt 2026, after the 2b-0 trace): a reply the provider CUT OFF at its cap (usage stop length) never contributes notes, on any path: it can parse from an early fence the model abandoned (the M3 comment
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
const usageCut = labels => l => (labels.includes(l) ? LEN : { input: 0, output: 0 });
// path (i): la's reply is a cut OBJECTION, the retry is unreadable (the cut reply is restored). path (ii): la's reply and its retry are cut SIGN-OFFS, the re-ask is clean; lb objects in pass 1 so la is asked again in pass 2.
const PATH_I = notes => ({ replies: l => (l === 'panel-1-la' ? objecting(notes ? { proposals: P('cut-objection-p') } : {}) : l === 'panel-1-la-retry' ? 'not json at all' : undefined), usage: usageCut(['panel-1-la']) });
const PATH_II = notes => ({ replies: l => (l === 'panel-1-la' ? signoff(notes ? { proposals: P('cut-first-p') } : {}) : l === 'panel-1-la-retry' ? signoff(notes ? { proposals: P('cut-retry-p') } : {}) : l === 'panel-1-lb' ? objecting() : undefined), usage: usageCut(['panel-1-la', 'panel-1-la-retry']) });
const PATHS = [['i', PATH_I], ['ii', PATH_II]];

test('CR-5 (verdict unchanged, both cut paths): the same scenario with and without notes in the cut reply gives byte-identical signoff, panelVerdicts and outcome: a cut OBJECTION still counts as a verdict; only the notes are dropped', async () => {
  const strip = r => JSON.stringify({ signoff: r.report.signoff, panelVerdicts: r.report.panelVerdicts, passed: r.report.passed, disputes: r.report.disputes });
  for (const [name, mk] of PATHS) {
    const a = await run(mk(true).replies, mk(true).usage); const b = await run(mk(false).replies, mk(false).usage);
    assert.equal(strip(a), strip(b), `path ${name}`);
    assert.deepEqual(itemsOf(a.report).filter(t => /cut-/.test(t)), [], `path ${name}: no note of a cut reply is read`);
    assert.ok(droppedOf(a.report).includes('la:1:reply_cut_off'), `path ${name}: counted`);
  }
});

test('CR-6 (the ask block, BOTH paths): after a cut reply the seat\'s next pass in the same overseer round carries no notes ask', async () => {
  for (const [name, mk] of PATHS) {
    const { prompts, served } = await run(mk(true).replies, mk(true).usage);
    assert.ok(prompts.get('panel-1-la').includes(ASK_H), `path ${name}: the first ask carried it`);
    const next = served.find(x => /^panel-[2-9]-la$/.test(x));
    assert.ok(next, `path ${name}: la was asked again in a later pass`);
    assert.equal(prompts.get(next).includes(ASK_H), false, `path ${name} ${next}: no ask after a cut reply in this overseer round`);
  }
});

test('CR-7 (resume identity, BOTH paths): a second run on the same replies gives a byte-identical review_notes block, the dropped rows in the same (seat) order, and the same prompts', async () => {
  for (const [name, mk] of PATHS) {
    const first = await run(mk(true).replies, mk(true).usage); const again = await run(mk(true).replies, mk(true).usage);
    assert.ok(first.report.review_notes.dropped.length >= 1, `path ${name}: there is something to compare`);
    assert.equal(JSON.stringify(again.report.review_notes), JSON.stringify(first.report.review_notes), `path ${name}`);
    for (const [label, prompt] of first.prompts) assert.equal(again.prompts.get(label), prompt, `path ${name} ${label}`);
  }
});
