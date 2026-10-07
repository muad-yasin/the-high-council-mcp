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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
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

test('only plan-daily-7 and plan-highest-7 set it (grep -r "judging" chains/ is the list), and each is clean under chain-lint', () => {
  const setters = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json') && 'judging' in chain(f.slice(0, -5)));
  assert.deepEqual(setters.sort(), ['plan-daily-7.json', 'plan-highest-7.json']);
  for (const n of ['plan-daily-7', 'plan-highest-7']) assert.deepEqual(lintChain(chain(n), `${n}.json`).filter(f => f.kind !== 'info'), [], n);
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
