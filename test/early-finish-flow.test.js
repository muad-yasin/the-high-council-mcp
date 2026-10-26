// ROADMAP 83 commit 2 (C&C thcmcp-6d rulings a-d, 20 Okt 2026): the session's early-finish proposal. A layered chain whose reviser is the person's OWN session (provider external) may end its reply with `EARLY-FINISH: <why>`;
// the NEXT pass asks the overseer layer only. Its yes ends the run NOT agreed (passed false, stop.kind early_finish); its objection is an ordinary overseer verdict. Offline, $0. The drafted words are injected with setHeldForTest:
// without both recorded sentences the feature is off. Scripted judges: `mock-critic-script-<pattern>-<id>` (x object, o sign off, one character per ask in this process); every test gives its models its own id.
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

test('EF-F1 (the yes): the revise proposes, the next pass asks the overseer layer ONLY, its yes ends the run NOT agreed; nothing of that pass is a verdict, a layers row or a sign-off', async () => {
  const events = []; setProgressHook(e => events.push(e));
  const { result, stages, logs, prompts } = await go(chainOf(trio('f1')), { 'revise-1': `${PLAN}\nEARLY-FINISH: only wording is open, the builder can do it` });
  assert.equal(result.passed, false);
  assert.deepEqual({ kind: result.stop.kind, chosen: result.stop.chosen, pass: result.stop.pass, overseer_round: result.stop.overseer_round, overseer: result.stop.overseer }, { kind: 'early_finish', chosen: 'early', pass: 2, overseer_round: 1, overseer: ['l3'] });
  assert.equal(result.stop.reason, 'only wording is open, the builder can do it');
  assert.ok(result.stop.items.length >= 1 && result.stop.items.every(i => /^O-[0-9a-f]{8}$/.test(i.id) && i.lab === 'l1'), JSON.stringify(result.stop.items));
  assert.ok(stages.includes('panel-2-l3') && !stages.includes('panel-2-l1') && !stages.includes('panel-2-l2'), `only the top layer was asked in pass 2: ${stages.filter(l => /^panel-/.test(l))}`);
  // GATE ROW 1: no reader that counts a sign-off sees the early yes
  assert.equal(result.panelVerdicts.some(v => v.round === 2), false, 'no panelVerdicts row for the early ask');
  assert.equal(result.layers.some(r => r.round === 2), false, 'no layers[] row for the early ask');
  assert.equal((result.signoff ?? []).some(x => x.lab === 'l3' || x.seat === 'l3'), false, 'signoff[] was not rebuilt from the early ask: pass 1 never asked l3');
  for (const lab of result.stop.overseer) assert.ok(stages.includes(`panel-2-${lab}`), `${lab} was asked afresh in the early pass (no carried verdict stands in for it)`);
  // the carried objection is the pass that triggered the revise, from the record
  assert.ok(result.lastCritique && result.lastCritique.meets !== true && result.lastCritique.failures.length >= 1, 'lastCritique is still the objections of pass 1');
  const l3 = events.filter(e => e.kind === 'verdict' && e.label === 'panel-2-l3');
  assert.ok(l3.length >= 1 && l3.every(e => e.earlyAnswer === true), `the live event for the overseer's answer is labelled: ${JSON.stringify(l3)}`);
  assert.equal(events.some(e => e.kind === 'verdict' && e.label === 'panel-1-l1' && e.earlyAnswer), false, 'an ordinary verdict is not');
  assert.ok(logs.some(l => /finishing early at the session's proposal/.test(l)));
  assert.match(prompts.get('panel-2-l3').user, /# The session proposes to finish now/);
  assert.equal(/# The session proposes to finish now/.test(prompts.get('panel-1-l1').user), false, 'the lower layer never sees the proposal');
});

test('EF-F2 (the send-back): the overseer objects to the proposal: an ordinary overseer verdict, the run goes on with a full climb and can pass', async () => {
  const c = chainOf([judge('xo', 'f2a', 'l1', 1), judge('o', 'f2b', 'l2', 2), judge('xo', 'f2c', 'l3', 3)]);
  const { result, stages, logs } = await go(c, { 'revise-1': `${PLAN}\nEARLY-FINISH: small things`, 'revise-2': PLAN });
  assert.equal(result.stop, undefined, 'no early finish was recorded');
  assert.equal(result.passed, true, JSON.stringify(result.stop));
  assert.ok(stages.includes('panel-2-l3') && !stages.includes('panel-2-l1'), 'pass 2 asked the overseer only');
  assert.ok(stages.includes('panel-3-l1'), 'pass 3 is the full climb again');
  assert.ok(logs.some(l => /did not agree to finish early/.test(l)));
  assert.ok(result.panelVerdicts.some(v => v.round === 2 && v.verdict === 'objected'), 'the send-back is recorded as the overseer layer objection it is');
});

test('EF-F3 (off while the words are not recorded): the line is stripped, logged, and the run is exactly an ordinary run', async () => {
  const { result, stages, logs } = await go(chainOf(trio('f3')), { 'revise-1': `${PLAN}\nEARLY-FINISH: small things` }, { held: false });
  assert.equal(result.passed, true);
  assert.equal(result.stop, undefined);
  assert.ok(stages.includes('panel-2-l1'), 'the second pass is the full climb');
  assert.ok(logs.some(l => /an EARLY-FINISH line was in the reply and was not acted on/.test(l)));
  assert.equal(/EARLY-FINISH/.test(result.draft ?? ''), false);
});

test('EF-F4 (an API reviser may not propose): a mock/API reviser that writes the line is ignored and logged, even with the words recorded', async () => {
  const c = chainOf(trio('f4'), { provider: 'mock', model: 'mock-builder', lab: 'author' });
  const { result, stages, logs } = await go(c, { 'revise-1': `${PLAN}\nEARLY-FINISH: small things` });
  assert.equal(result.stop, undefined);
  assert.ok(stages.includes('panel-2-l1'));
  assert.ok(logs.some(l => /not acted on/.test(l)));
});

test('EF-F5 (who is told): only a session reviser is told it may propose, and only while both sentences are recorded', async () => {
  const pauseUser = async (config, held) => {
    // CHANGED ACCEPTED TEST (decider-readiness unit, 24 Okt 2026). OLD: `null` was the not-recorded state (EF-F5's pauseUser). NEW: the explicit off map (test/helpers/held-off.js). WHY: once src/roles.js records the held names, `null` means "the real words", and the test would prove nothing about the off path; the map behaves the same today.
    setHeldForTest(held ? { reviserEarlyFinishNote, earlyFinishAskSection } : HELD_OFF);
    setCache({ invalidate() {}, get: () => null });
    try { await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-ef5', config }); return null; } catch (e) { return pendingPauses(e).find(p => p.label === 'revise-1')?.user ?? null; }
  };
  assert.match(await pauseUser(chainOf(trio('f5a')), true), /EARLY-FINISH: <why/, 'a session reviser with the words recorded is told');
  assert.equal(/EARLY-FINISH/.test(await pauseUser(chainOf(trio('f5b')), false) ?? ''), false, 'not while the words are not recorded');
  setHeldForTest({ reviserEarlyFinishNote, earlyFinishAskSection }); setCache({ invalidate() {}, get: () => null });
  const seen = new Map(); setPromptSpy(p => seen.set(p.label, { system: p.system, user: p.user }));
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-ef5c', config: chainOf(trio('f5c'), { provider: 'mock', model: 'mock-builder', lab: 'author' }) });
  assert.equal(/EARLY-FINISH/.test(seen.get('revise-1')?.user ?? ''), false, 'an API reviser is not told');
  assert.ok(seen.has('revise-1'), 'the API reviser ran live');
});

test('EF-F6 (ruling d, dispute on): every open objection of the triggering pass is a named builder task in the handoff, in the dissent block and in dispute.open_objections - the SAME count; the record says early_finish, not a round cap; the Status and milestones read exactly as without the section', async () => {
  const { parseMilestones } = await import('../src/milestones.js');
  const HANDOFF = 'Status: ready_for_build\n\n## Summary\n\nBuild the retry worker.\n\n## Milestones\n\n### M1 - Retries\nEntry: none\nWork: add the retry loop\nExit: the worker retries up to three times\n';
  const c = { ...chainOf(trio('f6')), handoff: true, dispute: { enabled: true, stall_rounds: 2 } };
  const { result } = await go(c, { 'revise-1': `${PLAN}\nEARLY-FINISH: small things`, dispute: PLAN, handoff: HANDOFF });
  assert.equal(result.stop.kind, 'early_finish');
  const n = result.stop.items.length;
  assert.ok(n >= 1);
  const tasks = (result.handoff.match(/^- BT-\d+ \(O-[0-9a-f]{8},/gm) || []).length;
  assert.equal(tasks, n, `the handoff names ${tasks} builder task(s), the stop lists ${n}`);
  for (const i of result.stop.items) assert.ok(result.handoff.includes(`(${i.id},`), `${i.id} is a named task`);
  const body = result.deliverable ?? result.draft ?? '';
  const dissent = body.slice(body.indexOf('## Unresolved dissent')).split(/\n---\n/)[0];
  assert.ok(dissent.startsWith('## Unresolved dissent'), 'the dissent block is there');
  assert.equal(dissent.split('\n').filter(l => /^### /.test(l)).length, n, 'the dissent block lists exactly the same N objections');
  assert.equal(/round cap/.test(dissent), false, 'the dissent block does not claim a round cap');
  assert.match(dissent, /finished early at the session's proposal/);
  assert.equal(result.dispute.reason, 'early_finish');
  assert.equal(result.dispute.open_objections?.length ?? result.dispute.open_objections, n, 'dispute.open_objections is the same N');
  const section = result.handoff.indexOf('\n## Builder tasks left open at the early finish');
  assert.ok(section > 0);
  const before = parseMilestones(result.handoff.slice(0, section)); const after = parseMilestones(result.handoff);
  assert.equal(after.status, 'ready_for_build'); assert.equal(after.milestones.length, 1);
  assert.deepEqual(after, before, 'the appended section changes nothing parseMilestones reads (Status, milestones, checklist, findings)');
});
