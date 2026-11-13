// 0.8.4 T14 (CA2/D17): the call sites that DECLARE a parallel group (src/chain.js `group`) each rest on one claim: the prompt reads none of its group-mates. These rows guard the claim where it can be wrong.
//   G1  independent panel: critic 1 is asked live, critic 2 (same pass, same layer, stale by prompt, stamped by the old code) is KEPT: a live sibling does not make a group-mate pay
//   G2  relay panel ("each sees the verdicts before it"): the same two critics, but the critic asked SECOND is NOT kept: its first ask carries the first one's verdict, so that critic is a real dependency and no group is declared (the order comes from a probe run: relay asks in a seeded-shuffle order)
//   G3  the prompt-spy pin behind G1/G2: the independent panel's second critic prompt holds no sibling verdict ("Reviewer A"), the relay's does; a peer read added to the independent panel later turns this red
//   G4  (plan T14-s iii) a layer-2 stage is asked again after a layer-1 stage was rewritten in a later sitting: the group names the LAYER, so layers are dependencies of each other
//   G5  (plan T14-s iv) a re-ask is not grouped: a SCAN pin on the declaration (reads the line, not the behaviour: a re-ask needs a scripted fixture this file does not build)
//   G6  one prompt-spy pin per group: the first ask of a panel critic, of a proposer and of a debater holds no reply text of its group-mates (a peer read added later turns this red; the vacuity guards say when a fixture reply is too short to prove it)
// Offline, $0, runChain with a fake cache (the seam setCache gives). RED BASE 61a36cc1 (no setWordingStamp, no panelGroup): the file loads; G1, G2 and G4 fail by TypeError at setWordingStamp, G5 fails at its first assertion (no declaration line), G3 and G6 PASS there (PINs of today's prompts; the resets are optional-chained).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as chain from '../src/chain.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const hash12 = text => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12);   // the format of writtenBy.text (pinned by P9 in stale-guard.test.js); local so these rows load on a tree that has no src/stale-guard.js

afterEach(() => { chain.setCache(null); chain.setBudget(null); chain.setWordingStamp?.(null); chain.setPromptSpy(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', objections: [] });
const OLD = { version: '0.0.1', sitting: 1 };
const configOf = relay => ({
  name: 'fixture-groups', criteria: [CRITERION], signoff: 'unanimous', ...(relay ? { panel: 'relay' } : {}), freedoms: { pass: true },
  seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' },
    critics: [{ provider: 'mock', model: 'mock-review-fixture', lab: 'la', maxTokens: 3000 }, { provider: 'mock', model: 'mock-review-fixture', lab: 'lb', maxTokens: 3000 }] },
});
const run = relay => chain.runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-groups', log: () => {}, config: configOf(relay) });
// build: replayed (stamped, sitting 1); panel-1-la: no record (asked live); panel-1-lb: stale by prompt, stamped by the old code
const store = (invalidated, stale = 'panel-1-lb') => ({
  get: l => (l === 'build' ? { text: DRAFT, writtenBy: { ...OLD, text: hash12(DRAFT) } }
    : l === stale ? { text: signoff, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(signoff) } } : null),
  invalidate: l => invalidated.push(l), warn: () => {},
});

// A relay panel asks its critics ONE AT A TIME in a seeded-shuffle order (chain.js), not in config order. A probe run (no cache, the prompt spy) tells which is asked first; the prompts are collected in the order they were asked.
async function relayProbe() {
  const asked = [];
  chain.setPromptSpy(p => { if (/^panel-1-l[ab]$/.test(p.label) && !asked.some(a => a.label === p.label)) asked.push({ label: p.label, user: p.user }); });
  chain.setCache(null);
  await run(true);
  chain.setPromptSpy(null);
  assert.equal(asked.length, 2, 'fixture: both relay critics were asked');
  return asked;
}

test('G1 independent panel: a live sibling does not make a group-mate pay; the stale second critic is kept', async () => {
  const invalidated = [];
  chain.setCache(store(invalidated)); chain.setWordingStamp({ version: '0.8.4' });
  const r = await run(false);
  assert.deepEqual(invalidated, [], 'nothing was set aside');
  assert.equal(r.stages.find(s => s.label === 'panel-1-lb').cached, true, 'critic 2 was replayed');
  assert.ok(!r.stages.find(s => s.label === 'panel-1-la').cached, 'critic 1 was asked live');
  assert.deepEqual(chain.wordingKept().map(k => k.stage), ['panel-1-lb']);
});

test('G2 relay panel: the critic asked second reads the first one\'s verdict, so it is NOT in a group and a live first critic makes it a miss (the order is taken from a probe run, not from the config)', async () => {
  const [first, second] = await relayProbe();
  const invalidated = [];
  chain.setCache(store(invalidated, second.label)); chain.setWordingStamp({ version: '0.8.4' });
  const r = await run(true);
  assert.deepEqual(invalidated, [second.label], 'set aside, asked again');
  assert.ok(!r.stages.find(s => s.label === second.label).cached);
  assert.ok(!r.stages.find(s => s.label === first.label).cached, 'the first critic was asked live');
  assert.deepEqual(chain.wordingKept(), []);
});

test('G3 the prompts behind the declaration: the independent panel\'s second critic sees no sibling verdict, the relay panel\'s second critic does (CONDITIONAL: only if the first critic\'s mock reply parses into a critique)', async () => {
  const prompts = new Map();
  chain.setPromptSpy(p => { if (/^panel-1-l[ab]$/.test(p.label) && !prompts.has(p.label)) prompts.set(p.label, p.user); });
  chain.setCache(null);
  await run(false);
  assert.ok(prompts.has('panel-1-la') && prompts.has('panel-1-lb'), 'fixture: both critics were asked');
  assert.doesNotMatch(prompts.get('panel-1-lb'), /Reviewer A/, 'no sibling verdict in an independent first ask');
  chain.setPromptSpy(null);
  const [first, second] = await relayProbe();
  assert.doesNotMatch(first.user, /Reviewer A/, 'the first relay critic has nobody before it');
  assert.match(second.user, /Reviewer A/, 'the second relay critic carries the earlier verdict: why a relay panel is not grouped');
});

// Restored (0.8.4 T14 fix-up, box run of 08 Nov 2026: `layeredConfig is not defined`): commit 4c6de8a5 defined this fixture; the rewrite in 6805be01 dropped the definition and kept the use in G4.
const layeredConfig = () => ({
  name: 'fixture-groups-layered', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true },
  seats: { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' },
    critics: [1, 2, 3].map(layer => ({ provider: 'mock', model: 'mock-review-fixture', lab: `l${layer}`, maxTokens: 3000, layer })) },
});

test('G4 a layer-2 critic is asked again after the layer-1 stage before it was rewritten in a later sitting: layers are not group-mates', async () => {
  const invalidated = [];
  chain.setCache({
    get: l => (l === 'build' ? { text: DRAFT, writtenBy: { ...OLD, text: hash12(DRAFT) } }
      : l === 'panel-1-l1' ? { text: signoff, writtenBy: { ...OLD, sitting: 2, text: hash12(signoff) } }   // replayed, written by a LATER sitting than the layer-2 stage
      : l === 'panel-1-l2' ? { text: signoff, promptHash: 'f'.repeat(16), fromDisk: true, writtenBy: { ...OLD, text: hash12(signoff) } } : null),
    invalidate: l => invalidated.push(l), warn: () => {},
  });
  chain.setWordingStamp({ version: '0.8.4' });
  await chain.runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-groups-l', log: () => {}, config: layeredConfig() });
  assert.deepEqual(invalidated, ['panel-1-l2'], 'the layer-2 critic was set aside and asked again');
  assert.deepEqual(chain.wordingKept(), []);
});

test('G5 SCAN PIN (T14-s iv): the panel group is declared for a first ask only (attempt 0, no tag), never for a re-ask or a relay panel', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/chain.js'), 'utf8');
  const line = src.split('\n').find(l => l.includes('const panelGroup ='));
  assert.ok(line, 'the declaration exists');
  assert.match(line, /attempt === 0 && tag === '' && !relay \?/, line);
  assert.equal(src.split('\n').filter(l => /group:\s*panelGroup/.test(l)).length, 2, 'only the first ask and its cut-off retry carry it');
});

// every string value of a JSON reply, at least 12 characters long (a distinctive piece of what a seat wrote)
const stringsOf = text => { const out = []; const walk = v => { if (typeof v === 'string') { if (v.length >= 12) out.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; try { walk(JSON.parse(text)); } catch { /* not JSON: no strings */ } return out; };

test('G6 prompt-spy pins, one per group: a first ask holds no reply text of its group-mates (panel critics, proposers, debaters)', async () => {
  const config = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../chains/mock-debate.json'), 'utf8'));
  const prompts = new Map();
  chain.setPromptSpy(p => { if (!prompts.has(p.label)) prompts.set(p.label, p.user); });   // the first prompt of a label
  chain.setCache(null);
  const r = await chain.runChain({ request: 'Plan a small tea shop.', runId: 'r-groups-spy', log: () => {}, config });
  const replyOf = label => r.stages.find(s => s.label === label)?.text ?? '';
  for (const [group, mates] of [['panel', ['panel-1-mock-a', 'panel-1-mock-b']], ['propose', ['propose-mock-a', 'propose-mock-b']], ['debate', ['debate-mock-a', 'debate-mock-b']]]) {
    assert.ok(mates.every(l => prompts.has(l)), `fixture: ${group}: both mates were asked (${[...prompts.keys()].join(', ')})`);
    for (const [x, y] of [[mates[0], mates[1]], [mates[1], mates[0]]]) {
      const mine = stringsOf(replyOf(y)).filter(t => !prompts.get(y).includes(t));   // what the sibling wrote ITSELF: strings it echoed from its own prompt are input the group-mates share, not a leak
      assert.ok(mine.length > 0, `vacuity guard: ${group}: ${y} wrote at least one string that is not in its own prompt`);
      for (const t of mine) assert.equal(prompts.get(x).includes(t), false, `${group}: the first ask ${x} holds text its group-mate ${y} wrote: ${t.slice(0, 60)}`);
    }
  }
});
