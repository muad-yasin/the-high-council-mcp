// B3 prep, JUDGE lane, unit 4a: layer 3's re-tags. With the chain's severity switch on, the TOP layer is shown the objection ledger with each open entry's severity IN FORCE and may answer with `retags`: [{ id, severity, reason }]. A re-tag counts only from a counted verdict of the
// top layer, is checked against the ledger it was shown, takes effect when the pass settles, and is recorded (applied and refused). A re-tag that puts an objection into a holding band stops that pass from being signed off. $0, offline; every reply comes from a label-keyed cache.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
const Sev = await import('../src/severity.js');

afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
const F = (problem, severity) => ({ criterion: CRITERION, problem, fix: 'Fix it.', ...(severity === undefined ? {} : { severity }) });
const F_LA = F('Layer one: no retry limit is specified.', 3);
const ID_LA = objectionId('la', F_LA);
const objecting = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no' });
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok', ...extra });
const PASS = JSON.stringify({ pass: true, pass_reason: 'I would rather not judge this round.' });
const withdraw = id => ({ answers: [{ id, status: 'withdrawn', evidence: '`The worker retries failed requests.`' }] });

async function run(replies, { critics, maxRounds = 3, freedoms = true, answerBack = true } = {}) {
  const served = []; const logs = []; const hashes = new Map(); const prompts = new Map();
  setPromptSpy(p => { hashes.set(p.label, promptHashOf(p.system, p.user)); prompts.set(p.label, p.user); });
  setCache({ invalidate: () => {}, get(label) {
    served.push(label);
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-retag', criteria: [CRITERION], maxRounds, signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), ...(freedoms ? { freedoms: { pass: true } } : {}), severity: { enabled: true },
    seats: { builder: seat(['writer']), reviser: seat(['writer']), critics: critics.map(seat) } };
  const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-retag', log: l => logs.push(l), config });
  return { r, served, logs, prompts };
}

test('applyRetags (pure): checks each re-tag against the ledger it was shown, derives `from`, refuses and records, and the higher value of two seats applies', () => {
  const run0 = Sev.createSeverityRun();
  run0.commit('la', 'O-aaaaaaaa', 3, 1); run0.commit('lb', 'O-bbbbbbbb', 8, 1);
  const ledger = new Map([['O-aaaaaaaa', { lab: 'la', status: 'active', severity: 3 }], ['O-bbbbbbbb', { lab: 'lb', status: 'active', severity: 8 }], ['O-cccccccc', { lab: 'lc', status: 'closed', severity: 5 }]]);
  const res = run0.applyRetags(2, [
    { seat: 's1', retags: [{ id: 'O-aaaaaaaa', severity: 5, reason: 'worse than rated' }, { id: 'O-aaaaaaaa', severity: 6, reason: 'again' }, { id: 'O-zzzzzzzz', severity: 5, reason: 'x' }, { id: 'O-cccccccc', severity: 9, reason: 'x' }, { id: 'O-bbbbbbbb', severity: 8, reason: 'same' }, { id: 'O-bbbbbbbb', severity: 11, reason: 'x' }] },
    { seat: 's2', retags: [{ id: 'O-aaaaaaaa', severity: 7.5, reason: 'much worse' }, { id: 'O-bbbbbbbb', severity: 6 }] },
  ], ledger);
  assert.deepEqual(res.applied, [{ id: 'O-aaaaaaaa', lab: 'la', from: 3, to: 7.5 }], 'two seats named one id: the higher value applies');
  assert.deepEqual(res.refused.map(x => [x.seat, x.id, x.why]), [['s1', 'O-aaaaaaaa', 'second_retag_same_pass'], ['s1', 'O-zzzzzzzz', 'id_not_in_ledger'], ['s1', 'O-cccccccc', 'row_closed'], ['s1', 'O-bbbbbbbb', 'no_change'], ['s1', 'O-bbbbbbbb', 'unreadable_value'], ['s2', 'O-bbbbbbbb', 'no_reason']]);
  assert.equal(run0.inForce('la', 'O-aaaaaaaa'), 7.5); assert.equal(run0.peek('la', 'O-aaaaaaaa', 2), 7.5, 'a later read sees the value in force');
  const snap = run0.snapshot();
  assert.equal(snap, null, 'nothing closed yet'); run0.closePass(2, [{ id: 'O-aaaaaaaa', lab: 'la', severity: 7.5 }]);
  assert.deepEqual(run0.snapshot().retags.map(r => [r.seat, r.from, r.to, r.applied_to, r.by]), [['s1', 3, 5, 7.5, 'layer3'], ['s2', 3, 7.5, 7.5, 'layer3']].slice(0, 2), 'both seats\' rows are recorded with the value that applied');
});

test('overrides are measured against the raiser\'s FIRST tag, never the re-tagged value: listing the objection again at its own first tag records nothing, another value records one', () => {
  const r0 = Sev.createSeverityRun();
  r0.commit('la', 'O-aaaaaaaa', 3, 1);
  r0.applyRetags(2, [{ seat: 's', retags: [{ id: 'O-aaaaaaaa', severity: 7, reason: 'r' }] }], new Map([['O-aaaaaaaa', { lab: 'la', status: 'active', severity: 3 }]]));
  r0.commit('la', 'O-aaaaaaaa', 3, 3); r0.closePass(3, []);
  assert.deepEqual(r0.snapshot().overrides, [], 'the raiser claimed its own first tag again: not an override');
  r0.commit('la', 'O-aaaaaaaa', 4, 4);
  assert.deepEqual(r0.snapshot().overrides.map(o => [o.first, o.claimed, o.direction]), [[3, 4, 'upgrade']]);
});

test('a re-tag by layer 3 that puts a swept objection into a holding band stops that pass from being signed off; the objection is revised; the raiser listing it again at its own first tag is held by the value in force and records no override; the record has the re-tag; a closed row shows no severity', async () => {
  // The ledger is built from the passes that are FINISHED, so layer 3 sees an objection from the pass after the one that raised it: pass 1 layer 1 (la swept 3, lc held 8) is revised; pass 2 layer 1 is clean (la leaves its swept one unanswered), so layer 3 (lb) is asked and re-tags.
  const F_LC = F('Layer one: no owner.', 8); const ID_LC = objectionId('lc', F_LC);
  const replies = label => (label === 'panel-1-la' ? objecting(F_LA) : label === 'panel-1-lc' ? objecting(F_LC)
    : label === 'panel-2-lc' ? signoff(withdraw(ID_LC))
    : label === 'panel-2-lb' ? signoff({ retags: [{ id: ID_LA, severity: 7.5, reason: 'A retry limit that is missing makes the worker loop forever.' }] })
    : label === 'panel-3-la' ? objecting(F_LA)
    : label === 'panel-4-la' ? signoff(withdraw(ID_LA)) : undefined);
  const { r, served, prompts, logs } = await run(replies, { critics: [['la', 1], ['lc', 1], ['lb', 2]], maxRounds: 4 });
  assert.equal(served.includes('panel-1-lb'), false, 'pass 1: layer 1 objects, layer 3 is not asked');
  assert.ok(prompts.get('panel-2-lb').includes('Severity: 3.'), 'layer 3 is shown the severity of the open entry');
  assert.ok(prompts.get('panel-2-lb').includes('"retags"'), 'and is told it may re-tag');
  assert.equal(r.panelVerdicts.find(v => v.round === 2 && v.lab === 'lb').verdict, 'signed_off', 'the seat signed (its meets:true is never rewritten)');
  assert.ok(served.includes('revise-2'), 'but the pass was not signed off: the re-tagged objection is revised');
  assert.ok(logs.some(l => /layer 3 re-tagged/.test(l)), 'and the log says why');
  assert.equal(r.panelVerdicts.find(v => v.round === 3 && v.lab === 'la').verdict, 'objected', 'pass 3: la lists it again at its own first tag (3); the value in force (7.5) holds');
  assert.equal(served.includes('panel-3-lb'), false, 'layer 1 objects, so layer 3 is not asked in pass 3');
  assert.equal(r.passed, true, 'pass 4: la withdraws, layer 3 signs');
  assert.equal(prompts.get('panel-4-lb').includes('Severity:'), false, 'the rows are closed by then: no severity line on a closed row');
  assert.deepEqual(r.severityRun.retags.map(x => [x.id, x.from, x.to, x.applied_to, x.pass]), [[ID_LA, 3, 7.5, 7.5, 2]]);
  assert.deepEqual(r.severityRun.overrides, [], 'a raiser claiming its own first tag is no override');
});

test('B3 pins: a top-layer swept-only VERDICT passes (B3\'s shape); a top-layer swept-only STATED PASS ends top_layer_not_explicit with a true log line; a lower-layer swept-only stated pass lets the climb go on', async () => {
  const F_LB = F('Top layer: the limit has no unit.', 3); const F_LD = F('Top layer: no owner.', 8); const F_LC = F('Layer one: no owner.', 8);
  // (1) the verdict case
  const v = await run(label => (label === 'panel-1-lb' ? objecting(F_LB) : undefined), { critics: [['la', 1], ['lb', 2]], freedoms: false });
  assert.equal(v.r.passed, true, 'a swept-only verdict signs off; the run passes with the swept row kept');
  assert.deepEqual(v.r.severityRun.swept.map(o => [o.lab, o.severity]), [['lb', 3]]);
  // (2) the top-layer stated pass: lb raised a swept objection in pass 1 while ld (same layer) held the plan; in pass 2 lb states a pass
  const ID_LD = objectionId('ld', F_LD);
  const t = await run(label => (label === 'panel-1-lb' ? objecting(F_LB) : label === 'panel-1-ld' ? objecting(F_LD) : label === 'panel-2-lb' ? PASS : label === 'panel-2-ld' ? signoff(withdraw(ID_LD)) : undefined), { critics: [['la', 1], ['lb', 2], ['ld', 2]] });
  assert.equal(t.r.passed, false); assert.equal(t.r.layerStop?.reason, 'top_layer_not_explicit');
  assert.equal(t.logs.some(l => /nothing was objected to/.test(l)), false, 'the false line never appears');
  assert.ok(t.logs.some(l => /did not sign off explicitly/.test(l)), 'the true line does');
  // (3) a lower-layer stated pass: la raised a swept objection in pass 1 while lc held layer 1; in pass 2 la states a pass, lc is clean: layer 1 is signed off and the climb reaches layer 2
  const ID_LC = objectionId('lc', F_LC);
  const l = await run(label => (label === 'panel-1-la' ? objecting(F_LA) : label === 'panel-1-lc' ? objecting(F_LC) : label === 'panel-2-la' ? PASS : label === 'panel-2-lc' ? signoff(withdraw(ID_LC)) : undefined), { critics: [['la', 1], ['lc', 1], ['lb', 2]] });
  assert.ok(l.served.includes('panel-2-lb'), 'the climb went on to layer 2 in pass 2');
  assert.equal(l.r.passed, true);
});

test('a volunteered re-tag in a pass with no ledger shown is recorded as refused (no_ledger_shown), never dropped, and changes nothing', async () => {
  // answer_back off: no ledger is built, so the top layer is told nothing about re-tags; a model that volunteers one is refused on the record.
  const replies = label => (label === 'panel-1-lb' ? signoff({ retags: [{ id: 'O-aaaaaaaa', severity: 8, reason: 'I think it is worse.' }] }) : undefined);
  const { r } = await run(replies, { critics: [['la', 1], ['lb', 2]], answerBack: false });
  assert.equal(r.passed, true, 'nothing was applied: the sign-off stands');
  assert.deepEqual(r.severityRun.retags, []);
  assert.deepEqual(r.severityRun.retags_refused.map(x => [x.id, x.seat, x.pass, x.why]), [['O-aaaaaaaa', 'lb', 1, 'no_ledger_shown']]);
});

test('a volunteered re-tag by a LOWER layer is recorded as refused (not_top_layer), never dropped, and changes nothing', async () => {
  const replies = label => (label === 'panel-1-la' ? signoff({ retags: [{ id: 'O-aaaaaaaa', severity: 9, reason: 'I want it worse.' }] }) : undefined);
  const { r } = await run(replies, { critics: [['la', 1], ['lb', 2]] });
  assert.equal(r.passed, true, 'nothing was applied');
  assert.deepEqual(r.severityRun.retags, []);
  assert.deepEqual(r.severityRun.retags_refused.map(x => [x.id, x.seat, x.pass, x.why]), [['O-aaaaaaaa', 'la', 1, 'not_top_layer']]);
});
