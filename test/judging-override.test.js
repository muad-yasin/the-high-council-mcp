// 0.8.2 item 10 (owner, 7 Oct 2026, deliberate): plan-daily-7 and plan-highest-7 let every seat with another role judge and vote, blind, the plan's writer too. The chain-level override that makes chain-lint
// allow it is explicit and greppable; a chain without it is still checked by both rules it switches off. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { lintChain } from '../src/chain-lint.js';
import { labOf } from '../src/chain.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => readChainFile(root, name);
const kinds = (cfg, file = 'x.json') => lintChain(cfg, file).map(f => f.kind);
const mock = () => chain('mock-tiered');

test('the override: a mass seat that also votes, and a deep-dive seat on a voting lab, are findings WITHOUT "judging": "all-roles" and not with it', () => {
  const t = mock();
  const overlap = { ...t, seats: { ...t.seats, proposers: [...t.seats.proposers, { provider: 'mock', model: 'mock-proposer-b', lab: 'anchor-a' }], deep_dive: { provider: 'mock', model: 'mock-deep', lab: 'anchor-a' } } };
  assert.ok(kinds(overlap).includes('mass-seat-votes'));
  assert.ok(kinds(overlap).includes('deep-dive-votes'));
  const allowed = { ...overlap, judging: 'all-roles' };
  assert.equal(kinds(allowed).includes('mass-seat-votes'), false);
  assert.equal(kinds(allowed).includes('deep-dive-votes'), false);
});

test('the override must be that exact string; anything else is a finding (and does not switch the rules off)', () => {
  const t = mock();
  const overlap = { ...t, seats: { ...t.seats, proposers: [...t.seats.proposers, { provider: 'mock', model: 'mock-proposer-b', lab: 'anchor-a' }] } };
  for (const bad of ['All-Roles', true, 'all', '']) {
    const k = kinds({ ...overlap, judging: bad });
    assert.ok(k.includes('judging'), JSON.stringify(bad));
    assert.ok(k.includes('mass-seat-votes'), `${JSON.stringify(bad)} does not waive the rule`);
  }
});

test('the schema accepts only "all-roles" for judging', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate({ ...chain('plan-daily-7') }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...chain('plan-daily-7'), judging: 'everyone' }), false);
});

// 0.8.3 M0 (owner decision 7, 8 Oct 2026; PLAN 11.1): daily7-sub-a, the recursive-councils child chain, is committed with daily7's "judging": "all-roles" (its external writer also judges), so it joins the list.
// 0.8.3 E5 (15 Oct 2026): plan-high-council keeps "judging": "all-roles" so the six of its twelve judges that also propose or write architectures may sit on the panel (test/plan-high-council.test.js pins the panel to exactly those twelve).
// R1 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = the seven chains named in the title; new bar = the seven plus plan-china-mini-council and plan-china-medium-council (both 'judging': 'all-roles' like plan-mini-council and plan-medium-council); why = picks 59-62 added plan-china-mini-council and plan-china-medium-council as 'the same machinery' as their tier siblings (m6-closing/China_Chains_Gate_Note.md lines 8, 12; Muad 15 Okt 22:34 'additional and advertised', 23:09 '4: all three'); each carries exactly the sibling's value, so the typed list names them; the lists stay hand-typed. The two Chinese chains are listed as their siblings are (China_Chains_Gate_Note, picks 59-62, 16 Okt 2026); Muad's yes on the chain at M7.
// 0.8.3 (lane B), CHANGED ACCEPTED TEST: old bar = eleven shipped setters incl. plan-daily-7 and plan-highest-7; new bar = nine, those two moved to chains/outdated/ (Muad 18 Okt 2026, "Your pick sounds good"); they stay lint-checked below, as fixtures.
test('only daily7-sub-a, plan-high-council, plan-medium-council, plan-mini-council, plan-mini-council-sol-session, plan-default-opro-council, the Chinese chains and plan-claude-council set it (grep -r "judging" chains/ is the list), and each is clean under chain-lint', () => {
  // OLD (before 18 Okt 2026, plan-claude-council): nine setters; NEW: ten, plan-claude-council carries `judging` like its planning siblings. WHY: a new shipped chain (Muad 18 Okt 14:01 / 14:04, "Yes to both").
  // OLD (before 20 Okt 2026, plan-china-high-council): ten setters; NEW: eleven. WHY: a new shipped chain (Muad 18 Okt 13:28 "Yes to the suggested chinese High").
  // OLD (before 23 Okt 2026, lane B commit 2): eleven setters; NEW: twelve. WHY: a new shipped chain, plan-default-opro-council (Muad's name and roster; 'judging': 'all-roles' because GPT-6 Luna proposes and judges).
  const setters = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json') && 'judging' in chain(f.slice(0, -5)));
  assert.deepEqual(setters.sort(), ['daily7-sub-a.json', 'plan-china-high-council.json', 'plan-china-medium-council.json', 'plan-china-mini-council.json', 'plan-claude-council.json', 'plan-default-opro-council.json', 'plan-high-council.json', 'plan-medium-council.json', 'plan-mini-council-sol-session.json', 'plan-mini-council.json']);   // 0.8.3 tiers: Medium keeps the override (DeepSeek, Qwen and MiMo propose and judge); the new Mini and its Sol-session copy set it too (MiMo both proposes and judges; Mini unit commit 2)
  for (const n of ['daily7-sub-a', 'plan-claude-council', 'plan-default-opro-council', 'plan-daily-7', 'plan-high-council', 'plan-medium-council', 'plan-mini-council', 'plan-mini-council-sol-session', 'plan-china-mini-council', 'plan-china-medium-council', 'plan-china-high-council', 'plan-highest-7']) assert.deepEqual(lintChain(chain(n), `${n}.json`).filter(f => f.kind !== 'info'), [], n);
});

for (const n of ['plan-daily-7', 'plan-highest-7']) {
  test(`${n}: every seat with another role is also a judge, the writer too (selfReview allowed), the criteria seat is the Opus 5.5 subscription session, and the chain says so plainly`, () => {
    const c = chain(n);
    const judges = c.seats.critics.map(labOf);
    assert.equal(new Set(judges).size, judges.length, 'judge labs are unique');
    for (const s of [...c.seats.proposers, ...c.seats.alternatives, c.seats.deep_dive, c.seats.criteria]) assert.ok(judges.includes(labOf(s)), `${labOf(s)} judges`);
    assert.ok(judges.includes('sonnet5-writer'), 'the plan\'s writer judges');
    const writer = c.seats.critics.find(s => labOf(s) === 'sonnet5-writer');
    assert.deepEqual([writer.provider, writer.model], [c.seats.builder.provider, c.seats.builder.model], 'the same Claude Code session that writes');
    assert.equal(c.judging, 'all-roles'); assert.equal(c.selfReview, 'allowed');
    assert.deepEqual([c.seats.criteria.provider, c.seats.criteria.model, c.seats.criteria.lab], ['external', 'subscription:opus-5.5', 'opus5.5-sub']);
    assert.equal(judges.length, 13);
    assert.match(c.description, /EVERY SEAT VOTES/); assert.match(c.description, /7 Oct 2026/); assert.match(c.description, /the plan's WRITER/);
    assert.equal(/no model writes and votes|alone vote|only the anchors vote/i.test(c.description), false, 'the old independence claims are gone');
    // routing by label: the writer's panel stage must not reach the Opus session, the Opus seat's must, and the criteria labels (no lab in them) are named
    assert.equal(`panel-3-${labOf(writer)}`.includes('opus5.5-sub'), false);
    assert.ok(`panel-3-opus5.5-sub-reask1`.includes('opus5.5-sub'));
    assert.match(c.description, /criteria, criteria-retry, criteria-feasibility-retry/);
  });
}
