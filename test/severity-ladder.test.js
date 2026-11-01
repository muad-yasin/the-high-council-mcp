// B3 prep, JUDGE lane: the LADDER AS BUILT (his word, 1 Nov 2026: "yes, undo it": the strict climb was taken out; the ladder works as built for B2/B3). The ladder's count takes the plan up a layer after the block of layer-1 passes whether or not a 4+ is open; the switch changes
// what a seat READS and how a pass SIGNS OFF, not where the ladder goes. These tests pin what stays: the floor jump fires with a 4+ open, the switch-off cycle, a below-4 judge climbing in pass 1, the typed --next-pass-layer-3 and layer 3's re-tag (unit 4a) with the in-force dispute line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// two seats per layer (the switch refuses a one-seat layer): layer 1's first seat is the one that keeps objecting
const seatsOf = (first, id) => [
  { provider: 'mock', model: `mock-critic-script-${first}-${id}1`, lab: 'l1a', layer: 1 }, { provider: 'mock', model: `mock-critic-script-o-${id}1b`, lab: 'l1b', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-o-${id}2`, lab: 'l2a', layer: 2 }, { provider: 'mock', model: `mock-critic-script-o-${id}2b`, lab: 'l2b', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-o-${id}3`, lab: 'l3a', layer: 3 }, { provider: 'mock', model: `mock-critic-script-o-${id}3b`, lab: 'l3b', layer: 3 }];
const chainOf = (critics, over = {}) => ({
  name: 'strict', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'strict-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'strict.json'), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const askedOf = report => { const by = {}; for (const r of report.layers) if (r.state !== 'not_asked') (by[r.round] ||= []).push(r.layer); return Object.keys(by).map(Number).sort((a, b) => a - b).map(n => by[n]); };
const reportOf = dir => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));

test('the floor jump FIRES with a 4+ open: with the switch ON and a 5 kept at layer 1 the ladder takes the plan up after its block of three layer-1 passes, as built (pass 4 starts at layer 2)', () => {
  const p = project(chainOf(seatsOf('x-sev5', 'j'), { severity: { enabled: true }, maxOverseerRounds: 1 }));
  try {
    const r = p.run(['--chain', 'strict', '--task', 'tasks/t.md', '--ladder']);
    const rep = reportOf(p.runDir());
    assert.deepEqual(askedOf(rep).map(a => a[0]).slice(0, 4), [1, 1, 1, 2], r.stdout + r.stderr);
    assert.equal(rep.layers.some(l => l.state === 'not_asked' && l.layer === 1 && l.round === 4), true, 'layer 1 was not asked in pass 4');
  } finally { p.done(); }
});

test('where it does not apply the cycle is today\'s: the switch OFF with the same objections (a 5 is an ordinary objection) climbs on the count, pass 4 starts at layer 2', () => {
  const p = project(chainOf(seatsOf('x-sev5', 'm'), { maxOverseerRounds: 1 }));
  try {
    const r = p.run(['--chain', 'strict', '--task', 'tasks/t.md', '--ladder']);
    const rep = reportOf(p.runDir());
    assert.deepEqual(askedOf(rep).map(a => a[0]).slice(0, 4), [1, 1, 1, 2], r.stdout + r.stderr);   // the lowest layer asked per pass: layers 2 and 3 here sign off, so pass 4 goes on to layer 3 in the same pass
  } finally { p.done(); }
});

test('--next-pass-layer-3 still starts a pass at layer 3 with a 5 open at layer 1 (the typed control overrides the floor), and layer 3\'s re-tag of that objection below 4 (unit 4a) is shown in the dispute record AND the severity record as the value in force: a ladder sign-off that is not agreement', async () => {
  const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.'; const EV = 'Section two sets the retry limit to five attempts.';
  const F = { criterion: CRITERION, problem: 'No retry limit is specified.', fix: 'Specify one.', severity: 5 }; const ID = objectionId('la', F);
  const signoff = extra => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok', ...extra });
  const replies = label => (label === 'panel-1-la' ? JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [F], verdict_line: 'no' })
    : label === 'panel-2-lc' ? signoff({ retags: [{ id: ID, severity: 2, reason: 'It does not change what is built.' }] }) : undefined);
  const hashes = new Map(); const served = []; setPromptSpy(p => hashes.set(p.label, promptHashOf(p.system, p.user)));
  setCache({ invalidate: () => {}, get(label) { served.push(label); const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT; return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) }; } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-strict-l3', criteria: [CRITERION], maxRounds: 4, maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, signoff: 'unanimous', answer_back: { enabled: true }, severity: { enabled: true }, dispute: { enabled: true },
    seats: { builder: seat(['writer']), reviser: seat(['writer']), critics: [['la', 1], ['lb', 2], ['lc', 3]].map(seat) } };
  try {
    const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-strict-l3', log: () => {}, config, ladder: { block: 3, visits: 3, credit: 0, exchange: 0 }, ladderSteps: [{ pass: 2, floor: 3, at: '2026-11-01T00:00:00.000Z', via: 'cli' }] });
    assert.equal(served.includes('panel-2-la') || served.includes('panel-2-lb'), false, 'pass 2 asked layer 3 only, with the 5 still open at layer 1');
    assert.equal(r.passed, false, 'a ladder sign-off is not agreement');
    assert.deepEqual(r.severityRun.retags.map(x => [x.id, x.from, x.to, x.applied_to, x.pass]), [[ID, 5, 2, 2, 2]]);
    assert.deepEqual(r.severityRun.swept.map(o => [o.lab, o.original, o.severity]), [['la', 5, 2]], 'the severity record shows the value in force and the original');
    assert.deepEqual((r.dispute?.open_objections || []).filter(o => o.id === ID).map(o => o.severity), [2], 'the dispute record shows the same number, read from the value in force (the older snapshot says 5)');
  } finally { setPromptSpy(null); setCache(null); setBudget(null); }
});

test('below 4 does not hold the climb: with the switch on and a layer-1 judge whose only objection is rated 3, layer 1 signs off and the plan climbs in the same pass (layers 2 and 3 are asked in pass 1), exactly as without the switch', () => {
  const p = project(chainOf(seatsOf('x-sev3', 'w'), { severity: { enabled: true }, maxOverseerRounds: 1 }));
  try {
    const r = p.run(['--chain', 'strict', '--task', 'tasks/t.md', '--ladder']);
    const rep = reportOf(p.runDir());
    assert.deepEqual(askedOf(rep)[0], [1, 2, 3], r.stdout + r.stderr);
  } finally { p.done(); }
});
