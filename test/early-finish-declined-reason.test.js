// BUG-D-001 (bug audit 24 Okt 2026; duplicate BUG-B-005): the saved report must keep what the run's own handoff printed for a declined objection - the reviser's reason - so
// `council handoff --from-run` rebuilds the same builder tasks. Offline, $0, mock chains (the early-finish harness of test/early-finish-flow.test.js).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy, pendingPauses, setProgressHook } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reviserEarlyFinishNote, earlyFinishAskSection } from './held-prompts/held-083-early.js';
import { HELD_OFF } from './helpers/held-off.js';

afterEach(() => { setCache(null); setBudget(null); setHeldForTest(null); setPromptSpy(null); setProgressHook(null); });
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const PLAN = 'The worker retries failed requests up to three times.\n\nStep one. Step two.';
const chainOf = (critics, reviser = { provider: 'external', model: 'claude-code-session', lab: 'author' }) => ({
  name: 'ef-test', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser, critics },
});
const withAnswerBack = c => ({ ...c, answer_back: { enabled: true } });   // a DECLINED line names its objection only on a chain that asks for ids (answer_back.enabled)
const trio = id => [judge('xo', `${id}a`, 'l1', 1), judge('o', `${id}b`, 'l2', 2), judge('o', `${id}c`, 'l3', 3)];
const go = async (config, answers, { held = true } = {}) => {
  setBudget(null);
  // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026). OLD: `null` was the not-recorded state (go(), used by EF-F3 and the held:false case). NEW: the explicit off map (test/helpers/held-off.js). WHY: once src/roles.js records the held names, `null` means "the real words", and the test would prove nothing about the off path; the map behaves the same today.
  setHeldForTest(held ? { reviserEarlyFinishNote, earlyFinishAskSection } : HELD_OFF);
  setCache({ invalidate() {}, get: label => (label in answers ? { text: answers[label], provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0 } : null) });
  const stages = []; const logs = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, { system: p.system, user: p.user }));
  const result = await runChain({ request: 'A mock task.', log: l => logs.push(l), onStage: s => stages.push(s.label), runId: 'r-ef', config });
  return { result, stages, logs, prompts };
};

test('ED-1 (write side): a declined objection keeps its reason in stop.items (declined_reason, cut at 600 characters); an undeclined one has none', async () => {
  const first = await go(withAnswerBack(chainOf(trio('d1'))), { 'revise-1': `${PLAN}\nEARLY-FINISH: only wording is open` });
  const id = first.result.stop.items[0].id;
  assert.match(id, /^O-[0-9a-f]{8}$/);
  const reason = `${'because the quote shows it is already covered, '.repeat(20)}end`;
  // the scripted judges count asks per model string in this process: the second run gets its own suffix (the objection id depends on the lab, not on the model string)
  const second = await go(withAnswerBack(chainOf(trio('d2'))), { 'revise-1': `${PLAN}\nEARLY-FINISH: only wording is open\nDECLINED: ${id}: ${reason}` });
  const item = second.result.stop.items.find(i => i.id === id);
  assert.equal(item.handled, 'declined');
  assert.equal(typeof item.declined_reason, 'string');
  assert.ok(item.declined_reason.length <= 600 && reason.startsWith(item.declined_reason.slice(0, 40)), item.declined_reason);
  for (const i of second.result.stop.items.filter(x => x.id !== id)) assert.equal('declined_reason' in i, false, 'only a declined item carries a reason');
  assert.equal('declined_reason' in first.result.stop.items[0], false);
});

test('ED-2 (read side): the handoff rebuilt from the report (earlyTasksFromReport) says what the run\'s own handoff said, the reason included', async () => {
  const { earlyTasksFromReport, withBuilderTasks } = await import('../src/chain.js');
  const report = { passed: false,
    stop: { kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items: [{ id: 'O-aaaaaaaa', lab: 'l1', handled: 'declined', declined_reason: 'the quote shows it is covered' }, { id: 'O-bbbbbbbb', lab: 'l1', handled: 'changed' }], overseer: ['l3'] },
    dispute: { ran: true, reason: 'early_finish', open_objections: [{ criterion: 'c1', lab: 'l1', problem: 'p1', id: 'O-aaaaaaaa' }, { criterion: 'c2', lab: 'l1', problem: 'p2', id: 'O-bbbbbbbb' }] } };
  const tasks = earlyTasksFromReport(report);
  assert.equal(tasks[0].declined_reason, 'the quote shows it is covered');
  assert.equal('declined_reason' in tasks[1], false);
  assert.match(withBuilderTasks('H', tasks), /the reviser declined it: the quote shows it is covered/);
});

test('ED-3 (schema): stop.items accepts a string declined_reason and rejects a non-string one', async () => {
  const { readFileSync } = await import('node:fs');
  const Ajv2020 = (await import('ajv/dist/2020.js')).default;
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile({ $defs: schema.$defs, ...schema.properties.stop });
  const stop = items => ({ kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items, overseer: ['l3'] });
  assert.equal(validate(stop([{ id: 'O-aaaaaaaa', lab: 'l1', handled: 'declined', declined_reason: 'why' }])), true, JSON.stringify(validate.errors));
  assert.equal(validate(stop([{ id: 'O-aaaaaaaa', lab: 'l1', handled: 'declined', declined_reason: 5 }])), false);
});
