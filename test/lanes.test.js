// 0.8.2 item 7 (owner 6 Oct 2026: optional lanes chain, YES): the `lane` seat field, the one door every critic system prompt goes through, and the new chain. The lane WORDS are a held prompt (P11): until the
// re-record they are '' and a lane seat runs as a plain panel seat. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { LANE_IDS, withLane, laneTextOf, setLaneTextsForTest } from '../src/lanes.js';
import { lintChain } from '../src/chain-lint.js';
import { runChain, ExternalPause } from '../src/chain.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainFile = n => JSON.parse(readFileSync(join(root, 'chains', `${n}.json`), 'utf8'));
const mockDebate = () => chainFile('mock-debate');

test('withLane adds NOTHING (not even a newline) when the seat has no lane or the lane has no text, and appends the paragraph after a blank line when it has', () => {
  const sys = R.criticSystem(false);
  assert.equal(withLane({ model: 'm' }, sys), sys);
  assert.equal(withLane({ lane: 'security_failure' }, sys), `${sys}\n\n${R.LANE_TEXT.security_failure}`, 'the recorded lane paragraph (0.8.2 re-record, P11)');
  assert.equal(laneTextOf('security_failure'), R.LANE_TEXT.security_failure);
  try {
    setLaneTextsForTest({ security_failure: 'LANE-SEC' });
    assert.equal(withLane({ lane: 'security_failure' }, sys), `${sys}\n\nLANE-SEC`);
    assert.equal(withLane({ lane: 'correctness_interfaces' }, sys), sys, 'a lane with no text adds nothing');
    assert.equal(withLane({}, sys), sys);
  } finally { setLaneTextsForTest(null); }
  assert.deepEqual([...LANE_IDS], ['correctness_interfaces', 'security_failure', 'implementation_verification']);
});

test('lint: a lane is accepted on a panel critic with a known id and refused everywhere it would silently do nothing', () => {
  const base = mockDebate();
  const kinds = cfg => lintChain(cfg, 'x.json').filter(f => f.kind === 'invalid-lane').map(f => f.message);
  const withLaneOn = (lane) => ({ ...base, seats: { ...base.seats, critics: base.seats.critics.map((s, i) => (i === 0 ? { ...s, lane } : s)) } });
  assert.deepEqual(kinds(withLaneOn('security_failure')), []);
  assert.match(kinds(withLaneOn('nonsense'))[0], /not one of correctness_interfaces/);
  assert.match(kinds({ ...base, seats: { ...base.seats, builder: { ...base.seats.builder, lane: 'security_failure' } } })[0], /seats\.builder has a "lane"/);
  assert.match(kinds({ ...withLaneOn('security_failure'), descending: true })[0], /descending/);
});

// ---- wiring: the real system prompt a critic is sent ------------------------------------------------------------------------------------------------------------------------

/** The system prompt the first panel critic is sent: an external critic pauses the run carrying the exact text. */
async function criticSystemSeen(extra = {}, lane = 'security_failure') {
  const cfg = mockDebate();
  cfg.seats = { ...cfg.seats, critics: [{ provider: 'external', model: 'session', lab: 'ext', ...(lane ? { lane } : {}) }, ...cfg.seats.critics.slice(1)] };
  Object.assign(cfg, extra);
  let pause = null;
  try { await runChain({ request: 'Plan a small tool.', config: cfg, log: () => {} }); } catch (e) { if (e instanceof ExternalPause) pause = e; else throw e; }
  return pause;
}

test('wiring, unanimous panel: the lane paragraph reaches the critic\'s real system prompt, and is absent without a lane', async () => {
  try {
    setLaneTextsForTest({ security_failure: 'LANE-SEC-PARAGRAPH' });
    const withText = await criticSystemSeen();
    assert.ok(withText, 'the external critic paused the run');
    assert.match(withText.label, /^panel-1/);
    assert.ok(withText.system.endsWith('\n\nLANE-SEC-PARAGRAPH'), 'the paragraph is the last thing in the prompt');
    const noLane = await criticSystemSeen({}, null);
    assert.ok(!noLane.system.includes('LANE-SEC-PARAGRAPH'));
    assert.equal(noLane.system, R.criticSystem(false), 'no lane: exactly the shipped critic prompt');
  } finally { setLaneTextsForTest(null); }
});

test('wiring, first mode (the single rotating critic): the same door', async () => {
  try {
    setLaneTextsForTest({ security_failure: 'LANE-SEC-PARAGRAPH' });
    const p = await criticSystemSeen({ signoff: 'first' });
    assert.ok(p, 'paused');
    assert.ok(p.system.endsWith('\n\nLANE-SEC-PARAGRAPH'), p.label);
  } finally { setLaneTextsForTest(null); }
});

test('source scan: chain.js builds a critic system prompt in ONE place; a bare R.criticSystem( anywhere else is a call site a lane would miss', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8').split('\n');
  const bare = src.map((l, i) => [i + 1, l]).filter(([, l]) => /R\.criticSystem\(/.test(l) && !/^\s*\/\//.test(l));
  assert.equal(bare.length, 1, `bare uses: ${bare.map(([n]) => n)}`);
  assert.match(bare[0][1], /withLane\(seat,/, 'and that one is inside criticPromptFor, which applies the lane');
  assert.equal(src.filter(l => /criticPromptFor\(/.test(l)).length, 5, 'the helper (1) and the four call sites');
});

test('report.json panelVerdicts carry the lane, only for a seat that has one', async () => {
  const cfg = mockDebate();
  cfg.seats = { ...cfg.seats, critics: cfg.seats.critics.map((s, i) => (i === 0 ? { ...s, lane: 'security_failure' } : s)) };
  const r = await runChain({ request: 'Plan a small tool.', config: cfg, log: () => {} });
  const lanes = r.panelVerdicts.map(v => v.lane);
  assert.ok(lanes.includes('security_failure'));
  assert.ok(r.panelVerdicts.some(v => v.lane === undefined), 'the other critics have no lane field');
});

test('report.json panelVerdicts carry the lane in first mode too (the five first-mode records had no lane; the review found it)', async () => {
  const cfg = mockDebate();
  cfg.signoff = 'first';
  cfg.seats = { ...cfg.seats, critics: cfg.seats.critics.map(s => ({ ...s, lane: 'security_failure' })) };
  const r = await runChain({ request: 'Plan a small tool.', config: cfg, log: () => {} });
  assert.ok(r.panelVerdicts.length >= 1);
  assert.ok(r.panelVerdicts.every(v => v.lane === 'security_failure'), JSON.stringify(r.panelVerdicts.map(v => v.lane)));
});

test('lint: a lane on an advise chain or inside a descending seat map would silently do nothing, so it is refused; a prototype name is never a lane', () => {
  const base = chainFile('plan-lanes-4');
  const kinds = cfg => lintChain(cfg, 'x.json').filter(f => f.kind === 'invalid-lane').length;
  assert.equal(kinds({ ...base, advise: { enabled: true, rounds: 1, usd: 1 } }), 1, 'advise chains build their own advisor prompts');
  assert.equal(kinds({ ...base, seats: { ...base.seats, descending: { plan: { provider: 'mock', model: 'm', lane: 'security_failure' } } } }), 1);
  assert.equal(laneTextOf('constructor'), '');
  assert.equal(laneTextOf('__proto__'), '');
  assert.equal(withLane({ lane: 'constructor' }, 'SYS'), 'SYS');
});

// ---- the chain ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('plan-lanes-4: lints clean; one writer off the panel; three reviewers with three distinct lanes; cap 7; reasoning high wherever the model takes it; GLM gets the 360,000 panel cap', () => {
  const c = chainFile('plan-lanes-4');
  assert.deepEqual(lintChain(c, 'plan-lanes-4.json'), []);
  assert.equal(c.maxRounds, 7);
  assert.equal(c.signoff, 'unanimous');
  const critics = c.seats.critics;
  assert.equal(critics.length, 3);
  assert.deepEqual(critics.map(s => s.lane).sort(), [...LANE_IDS].sort());
  assert.ok(!critics.some(s => s.lab === c.seats.builder.lab), 'the writer holds no panel seat');
  for (const s of critics) {
    const high = s.extra?.reasoning?.effort === 'high';
    if (s.model === 'z-ai/glm-5.3-flash') assert.equal(s.extra, undefined, 'GLM 5.3 Flash defaults above high: no setting');
    else assert.ok(high, `${s.model} states reasoning high`);
  }
  const glm = critics.find(s => s.model === 'z-ai/glm-5.3-flash');
  assert.equal(glm.panelMaxTokens, 360000);
  assert.ok(critics.filter(s => s !== glm).every(s => s.maxTokens === 36000 && s.panelMaxTokens === undefined));
  assert.match(c.description, /not verified/i, 'the endpoint-routing disclosure');
  assert.match(c.description, /cannot be measured|nothing here claims/i, 'no efficacy claim');
  assert.match(c.description, /recorded in src\/roles\.js/, 'says the lane words are recorded (0.8.2 re-record, P11)');
  assert.ok(!/better|best|more accurate|outperform/i.test(c.description.replace(/nothing here claims it plans better than another chain/i, '').replace(/starting hypothesis, not a measured optimum/i, '')), 'no efficacy wording beyond the sentence that disclaims it');
});

test('plan-lanes-4: the SHAPE runs end to end (every seat swapped for a mock), with its lanes, and the panel carries them', async () => {
  const c = chainFile('plan-lanes-4');
  const mock = (s, model) => ({ provider: 'mock', model, lab: s.lab, ...(s.lane ? { lane: s.lane } : {}) });
  const seats = { criteria: mock(c.seats.criteria, 'mock-criteria'), builder: mock(c.seats.builder, 'mock-builder'), reviser: mock(c.seats.reviser, 'mock-builder'), handoff: mock(c.seats.handoff, 'mock-builder'),
    critics: c.seats.critics.map((s, i) => mock(s, ['mock-critic-a', 'mock-critic-b', 'mock-critic-a'][i])) };
  const r = await runChain({ request: 'Plan a small tool.', config: { ...c, seats }, log: () => {} });
  assert.equal(typeof r.passed, 'boolean');
  assert.deepEqual([...new Set(r.panelVerdicts.map(v => v.lane))].sort(), [...LANE_IDS].sort());
});

test('plan-lanes-4: the chain file exists and validates against the chain schema; it has no skeleton seat (the skeleton stage runs only with proposals, so a seat there would be dead config)', async () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const c = chainFile('plan-lanes-4');
  assert.equal(validate(c), true, JSON.stringify(validate.errors));
  assert.ok(readdirSync(join(root, 'chains')).includes('plan-lanes-4.json'));
  assert.equal(c.seats.skeleton, undefined);
  assert.doesNotMatch(c.description, /writes the skeleton/);
});

test('plan-lanes-4: every seat that states reasoning high has a dated row in src/reasoning-table.json that says so; the writer is Sonnet 5.5 and its row exists (the table had none: reasoning-not-high would have passed without it)', () => {
  const table = JSON.parse(readFileSync(join(root, 'src', 'reasoning-table.json'), 'utf8'));
  const rows = table.models || table;
  const c = chainFile('plan-lanes-4');
  assert.equal(c.seats.builder.model, 'anthropic/claude-sonnet-5.5');
  for (const [role, seat] of Object.entries({ builder: c.seats.builder, reviser: c.seats.reviser, handoff: c.seats.handoff, ...Object.fromEntries(c.seats.critics.map((s, i) => [`critic${i}`, s])) })) {
    const row = rows[`openrouter/${seat.model}`];
    assert.ok(row, `${role}: no row for openrouter/${seat.model} in the reasoning table`);
    if (row.defaultAboveHigh) assert.equal(seat.extra, undefined, `${role}: a model whose default is above high gets no setting`);
    else { assert.equal(row.form, 'openrouter-effort'); assert.equal(seat.extra?.reasoning?.effort, 'high', `${role} states reasoning high`); }
  }
  assert.equal(rows['openrouter/anthropic/claude-sonnet-5.5'].defaultEffort, 'high');
});
