// test/seat-role.test.js
//
// v6 §1: the seat-role mechanism's hard compatibility requirement - a
// chain config with no `role` set produces byte-identical prompts to
// today. Golden-hash proof, not an assertion of "looks the same": the
// SHA-256 below was computed against the unmodified DEBATE_SYSTEM
// constant before this diff touched anything, and is a literal constant
// here rather than derived - a test that recomputes its own expected
// value from the code under test cannot catch that code drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { applySeatRole, validateSeatRole, LENSES, DEFAULT_PERSONAS } from '../src/seat-role.js';
import { lintChain } from '../src/chain-lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const chainsDir = join(here, '..', 'chains');

const GOLDEN_DEBATE_SYSTEM_SHA256 = '7dd78f4e8ad77b5c30b84f420e2a86e6ace7146cd4c5082ec8e34a3894fe3c9d';
const sha256 = s => createHash('sha256').update(s).digest('hex');

test('golden hash: DEBATE_SYSTEM itself is byte-identical to what it was before this diff', () => {
  assert.equal(sha256(R.DEBATE_SYSTEM), GOLDEN_DEBATE_SYSTEM_SHA256);
});

test('test_role_compat: no role produces the exact same prompt, not merely an equal-looking one', () => {
  const noRole = applySeatRole(R.DEBATE_SYSTEM, undefined);
  assert.equal(noRole, R.DEBATE_SYSTEM);
  assert.equal(sha256(noRole), GOLDEN_DEBATE_SYSTEM_SHA256);
  // null must degrade the same as undefined - a chain author writing
  // "role": null must not get a different result than omitting it.
  const nullRole = applySeatRole(R.DEBATE_SYSTEM, null);
  assert.equal(nullRole, R.DEBATE_SYSTEM);
});

test('a role with only a lens appends exactly the lens block, once', () => {
  const out = applySeatRole(R.DEBATE_SYSTEM, { lens: 'adversary' });
  assert.notEqual(sha256(out), GOLDEN_DEBATE_SYSTEM_SHA256);
  assert.ok(out.startsWith(R.DEBATE_SYSTEM), 'the base prompt must be a prefix - suffix only, never a rewrite');
  assert.match(out, /\[SEAT ROLE\]/);
  assert.match(out, new RegExp(LENSES.adversary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(out, /arguing as/, 'no persona set - no persona text');
});

test('a role with only a persona appends persona text and no lens directive', () => {
  const out = applySeatRole(R.DEBATE_SYSTEM, { persona: 'parzival' });
  assert.match(out, /arguing as parzival/);
  for (const lensText of Object.values(LENSES)) assert.doesNotMatch(out, new RegExp(lensText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a role with both lens and persona appends both blocks', () => {
  const out = applySeatRole(R.DEBATE_SYSTEM, { lens: 'security-and-legal', persona: 'moses' });
  assert.match(out, new RegExp(LENSES['security-and-legal'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(out, /arguing as moses/);
});

test('validateSeatRole: undefined/null role is valid (role is optional)', () => {
  assert.deepEqual(validateSeatRole(undefined), []);
  assert.deepEqual(validateSeatRole(null), []);
});

test('validateSeatRole: role:{} with neither field is invalid', () => {
  const problems = validateSeatRole({});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /neither "lens" nor "persona"/);
});

test('validateSeatRole: an unknown lens is invalid and names the bad value', () => {
  const problems = validateSeatRole({ lens: 'contrarian' });
  assert.ok(problems.some(p => p.includes('contrarian')));
});

test('validateSeatRole: every real lens enum value is valid alone', () => {
  for (const lens of Object.keys(LENSES)) {
    assert.deepEqual(validateSeatRole({ lens }), [], `lens "${lens}" should be valid`);
  }
});

test('validateSeatRole: a non-string persona is invalid', () => {
  const problems = validateSeatRole({ persona: 42 });
  assert.ok(problems.some(p => p.includes('persona')));
});

test('validateSeatRole: a stray field on role is invalid', () => {
  const problems = validateSeatRole({ lens: 'adversary', costume: 'wizard hat' });
  assert.ok(problems.some(p => p.includes('costume')));
});

test('validateSeatRole: role that is not an object (e.g. a bare string) is invalid', () => {
  const problems = validateSeatRole('adversary');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must be an object/);
});

test('chain-lint: an invalid role is caught fail-loud, with a fix naming the file', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x' },
      critics: [{ provider: 'anthropic', model: 'y', role: { lens: 'not-a-real-lens' } }],
    },
  }, 'chains/fixture.json');
  const roleFindings = findings.filter(f => f.kind === 'invalid-seat-role');
  assert.equal(roleFindings.length, 1);
  assert.match(roleFindings[0].message, /not-a-real-lens/);
  assert.match(roleFindings[0].fix, /chains\/fixture\.json/);
});

test('chain-lint: a valid role produces no invalid-seat-role finding', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x' },
      critics: [{ provider: 'anthropic', model: 'y', role: { lens: 'integrator', persona: 'noah' } }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'invalid-seat-role').length, 0);
});

test('chain-lint: no role at all produces no invalid-seat-role finding (role is optional)', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x' },
      critics: [{ provider: 'anthropic', model: 'y' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'invalid-seat-role').length, 0);
});

// v6 phase 5 (docs/v6-decisions.md "Phase 5 - role debate chain"): this is the first shipped
// chain that deliberately declares a role on every critic seat, so it is excluded from the
// "nothing declares a role yet" compatibility proof below - not because compatibility stops
// mattering, but because this file now proves the OPPOSITE property for that one chain (see the
// test right after this one). Every other chain must still prove byte-identical prompts; only
// this named exception is allowed to differ, and only because it does so on purpose.
const CHAINS_WITH_ROLES_BY_DESIGN = ['plan-debate-roles-c1.json'];

test('test_role_compat, golden hash across every shipped chain: no seat in any non-role-bearing chains/*.json declares a role, and applying the (absent) role to each is byte-identical to DEBATE_SYSTEM', () => {
  const files = readdirSync(chainsDir).filter(f => f.endsWith('.json') && !CHAINS_WITH_ROLES_BY_DESIGN.includes(f));
  assert.ok(files.length >= 30, `expected at least 30 shipped chains, found ${files.length}`);
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
    const seats = [
      cfg.seats?.criteria, cfg.seats?.builder, cfg.seats?.reviser, cfg.seats?.finalist,
      cfg.seats?.skeleton, cfg.seats?.handoff, cfg.seats?.questions, cfg.seats?.judge,
      ...(cfg.seats?.proposers || []), ...(cfg.seats?.critics || []),
    ].filter(Boolean);
    for (const seat of seats) {
      assert.equal(seat.role, undefined, `${f}: a shipped chain must not already declare a role - this test's compatibility proof assumes none do yet`);
      const out = applySeatRole(R.DEBATE_SYSTEM, seat.role);
      assert.equal(sha256(out), GOLDEN_DEBATE_SYSTEM_SHA256, `${f}: debate-stage system prompt must be byte-identical with no role set`);
    }
  }
});

test('plan-debate-roles-c1.json: every proposer seat declares a valid role, applying it changes the debate-stage prompt away from the golden hash, and the mirrored critics array stays role-free', () => {
  // BUILD-FIX 2026-09-14: this chain was originally written with role on seats.critics alone
  // (phase 1/2's critics-does-double-duty shape). chain.js's debate stage resolves its seats via
  // `config.seats.proposers || config.seats.critics`, so that legacy shape happened to still
  // work at runtime - but v6 phase 7's chain-lint (role-on-non-proposer-seat) correctly treats
  // it as unsupported now that proposers/critics are meant to be declared separately once a role
  // is in play, and CLI doctor's fail-loud gate blocks the chain from running at all with that
  // finding present. Fixed by declaring both arrays: seats.proposers carries the role, the
  // mirrored seats.critics (same five labs, used later for the panel/critique stage) does not.
  const cfg = JSON.parse(readFileSync(join(chainsDir, 'plan-debate-roles-c1.json'), 'utf8'));
  const proposers = cfg.seats.proposers;
  const critics = cfg.seats.critics;
  assert.equal(proposers.length, 5, 'one proposer/debate seat per lens/persona, no more, no fewer');
  assert.equal(critics.length, 5, 'the panel/critique stage still runs one seat per lab');
  const findings = lintChain(cfg, 'chains/plan-debate-roles-c1.json');
  assert.equal(findings.filter(f => f.kind === 'invalid-seat-role').length, 0);
  assert.equal(findings.filter(f => f.kind === 'role-on-non-proposer-seat').length, 0, 'no role may leak onto seats.critics or any other non-proposer seat');
  for (const seat of proposers) {
    assert.notEqual(seat.role, undefined, `${seat.lab}: this chain exists specifically to give every proposer seat a role`);
    assert.equal(validateSeatRole(seat.role).length, 0, `${seat.lab}: role must be valid`);
    const out = applySeatRole(R.DEBATE_SYSTEM, seat.role);
    assert.notEqual(sha256(out), GOLDEN_DEBATE_SYSTEM_SHA256, `${seat.lab}: a seat with a role must NOT produce the no-role golden hash`);
    assert.ok(out.startsWith(R.DEBATE_SYSTEM), 'role text is appended after the base prompt, never replacing or reordering it');
  }
  for (const seat of critics) {
    assert.equal(seat.role, undefined, `${seat.lab}: the panel/critique-stage seat must never carry a role (v6 phase 2 stage isolation)`);
  }
  // No two seats share a lens or a persona - one of each per seat, matching the plan's 1:1
  // five-lens/five-persona design, not a coincidence a future edit could quietly break.
  assert.equal(new Set(proposers.map(s => s.role.lens)).size, 5);
  assert.equal(new Set(proposers.map(s => s.role.persona)).size, 5);
  // The panel stage is still the same five labs as the debate stage, not a silently different
  // roster - only the role field differs between the two arrays.
  assert.deepEqual(new Set(proposers.map(s => s.lab)), new Set(critics.map(s => s.lab)));
});

test('DEFAULT_PERSONAS is exactly the five author-approved names, no more, no fewer', () => {
  assert.deepEqual(DEFAULT_PERSONAS, ['moses', 'noah', 'matthew', 'van-gogh', 'parzival']);
});

// v6 phase 7 bug-audit fixes (2026-09-13), regression coverage.

test('applySeatRole resolves a known persona key against personas.js, enriching but not replacing the raw key', () => {
  const out = applySeatRole(R.DEBATE_SYSTEM, { persona: 'parzival' });
  assert.match(out, /arguing as parzival \(Parzival\)\. Asks the question everyone else assumed was already answered\./);
});

test('applySeatRole falls back to the raw string for an unresolved persona - operator-supplied personas still work', () => {
  const out = applySeatRole(R.DEBATE_SYSTEM, { persona: 'my-custom-operator-persona' });
  const appended = out.slice(R.DEBATE_SYSTEM.length);
  assert.match(appended, /arguing as my-custom-operator-persona\. Let that voice/);
  assert.doesNotMatch(appended, /\(/, 'no parenthetical display name for an unresolved persona');
});

test('applySeatRole accepts a custom personas map, not just the shipped default', () => {
  const custom = { 'my-key': { name: 'My Name', voice: 'Speaks only in questions.' } };
  const out = applySeatRole(R.DEBATE_SYSTEM, { persona: 'my-key' }, custom);
  assert.match(out, /arguing as my-key \(My Name\)\. Speaks only in questions\./);
});

test('chain-lint: role on a non-proposer seat is flagged as a silent no-op', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x', role: { lens: 'adversary' } },
      critics: [{ provider: 'anthropic', model: 'y' }],
    },
  }, 'chains/fixture.json');
  const noop = findings.filter(f => f.kind === 'role-on-non-proposer-seat');
  assert.equal(noop.length, 1);
  assert.match(noop[0].message, /seats\.builder/);
  assert.match(noop[0].fix, /seats\.proposers/);
});

test('chain-lint: the same check catches a role on seats.critics too', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x' },
      critics: [{ provider: 'anthropic', model: 'y', role: { persona: 'noah' } }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'role-on-non-proposer-seat').length, 1);
});

test('chain-lint: a role on seats.proposers is never flagged as a no-op', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'x' },
      builder: { provider: 'anthropic', model: 'x' },
      proposers: [{ provider: 'anthropic', model: 'z', role: { lens: 'integrator' } }],
      critics: [{ provider: 'anthropic', model: 'y' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'role-on-non-proposer-seat').length, 0);
});
