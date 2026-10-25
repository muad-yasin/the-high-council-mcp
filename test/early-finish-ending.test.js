// ROADMAP 83 gate rows that need a whole run (C&C thcmcp-6d ruling b, 20 Okt 2026). Offline, $0.
//  EF-E1 (gate row 2, run level): the ending recorded beside an answer given after the panel is `early_finish`, never `finish_chosen` (that word says a PERSON chose to finish at a limit) - read through the notes lane's handoff fold.
//  EF-E2 (resume): a replay of the same run from its stage files reaches the same break; every stage is replayed, none is a new call.
//  EF-E3 (counts): overseer_rounds counts the overseer layer's verdict and equals stop.overseer_round.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as H from './held-prompts/held-083.js';
import { reviserEarlyFinishNote, earlyFinishAskSection } from './held-prompts/held-083-early.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objecting = extra => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ criterion: CRITERION, problem: 'No limit.', fix: 'Add one.' }], verdict_line: 'no', ...extra });
const A = 'N-f71370af';   // the id the lane gives the judge's proposal below (asserted in EF-E1, so a change shows there)
const WORDS = { reviewNotesAsk: H.reviewNotesAsk, reviewNotesRevise: H.reviewNotesRevise, reviewNotesMemory: H.reviewNotesMemory, reviewNotesAnswer: H.reviewNotesAnswer, reviserEarlyFinishNote, earlyFinishAskSection };
const config = {
  name: 'fixture-early', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true }, handoff: true, reviewNotes: { enabled: true, perKind: 3 },
  seats: { builder: { provider: 'external', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'external', model: 'mock-builder', lab: 'writer' }, handoff: { provider: 'external', model: 'mock-builder', lab: 'writer' },
    critics: ['la', 'lb', 'lc'].map((lab, i) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer: i + 1 })) },
};
const answers = {
  'panel-1-la': objecting({ proposals: [{ text: 'Add a dead-letter queue' }] }),
  'revise-1': `${DRAFT}\n\nRevision 1.\nEARLY-FINISH: only wording is open`,
  'panel-2-lc': signoff(),
  handoff: `# Plan\n\nBuild it.\n\nNOTE-TAKEN: ${A}`,
};
const cacheOf = store => ({ invalidate() {}, get: label => store.get(label) ?? (label === 'handoff-notes' ? null : label in answers ? { text: answers[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : label.startsWith('panel-') ? { text: signoff(), provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : { text: DRAFT, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }) });
const go = async store => {
  setHeldForTest(WORDS); setBudget(null); setCache(cacheOf(store));
  const rows = [];
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-early', log: () => {}, config, onStage: r => rows.push(r) });
  return { result, rows, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-early', chain: 'fixture-early', task: 't.md', result, config }))) };
};

test('EF-E1 (gate row 2 at run level): the answer\'s ending is early_finish, never finish_chosen', async () => {
  const { result, report } = await go(new Map());
  assert.equal(result.stop?.kind, 'early_finish', JSON.stringify(result.stop));
  assert.deepEqual(report.review_notes.items.map(i => i.id), [A], 'the one proposal of the judge, with the id the handoff answer names');
  const item = report.review_notes.items[0];
  assert.equal(item.answer.ending, 'early_finish');
  assert.notEqual(item.answer.ending, 'finish_chosen');
});

test('EF-E2 (resume): replayed from its stage files the run reaches the same early finish and every stage is a replay', async () => {
  const store = new Map();
  const first = await go(store);
  for (const r of first.rows) store.set(r.label, { text: r.text, provider: r.provider, model: r.model, usage: r.usage, usd: r.usd });
  const again = await go(store);
  assert.deepEqual({ kind: again.result.stop.kind, pass: again.result.stop.pass, items: again.result.stop.items, overseer: again.result.stop.overseer }, { kind: first.result.stop.kind, pass: first.result.stop.pass, items: first.result.stop.items, overseer: first.result.stop.overseer });
  assert.ok(again.rows.length > 0 && again.rows.every(r => r.cached === true), `not replayed: ${again.rows.filter(r => r.cached !== true).map(r => r.label)}`);
});

test('EF-E3 (counts): overseer_rounds counts the overseer layer\'s verdict and equals stop.overseer_round', async () => {
  const { result } = await go(new Map());
  assert.equal(result.stop.overseer_round, 1);
  assert.equal(result.overseer_rounds, result.stop.overseer_round);
});
