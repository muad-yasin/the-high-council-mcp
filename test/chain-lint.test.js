// test/chain-lint.test.js
//
// v5 §1 candidate 5: fail-loud pre-flight chain linting - missing stage
// contracts, unreachable stages, missing tool (provider) references.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { priceOf } from '../src/cost.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const root = resolve(here, '..');

test('a clean chain config has no findings', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }, 'chains/fixture.json');
  assert.deepEqual(findings, []);
});

test('test_chain_lint_catches_errors: a missing stage contract, an unreachable stage, and a missing tool reference, each with a fix', () => {
  const findings = lintChain({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critc: { provider: 'anthropic', model: 'claude-sonnet-5' },  // typo'd key: missing stage contract
      critics: [],                                                  // unreachable stage
      builder: { provider: 'nosuchlab', model: 'x' },               // missing tool reference
    },
  }, 'chains/fixture.json');

  const kinds = findings.map(f => f.kind).sort();
  assert.deepEqual(kinds, ['missing-stage-contract', 'missing-tool-reference', 'unreachable-stage']);
  for (const f of findings) {
    assert.ok(f.fix && f.fix.length > 0, `${f.kind} must carry an actionable fix`);
    assert.match(f.fix, /chains\/fixture\.json/, `${f.kind}'s fix must name the real file path`);
  }
});

test('missing seats.critics entirely (not just empty) is also unreachable-stage', () => {
  const findings = lintChain({ seats: { criteria: { provider: 'anthropic', model: 'x' } } }, 'chains/fixture.json');
  assert.ok(findings.some(f => f.kind === 'unreachable-stage'));
});

test('an unrecognized provider is only reported once even if it appears on multiple seats', () => {
  const findings = lintChain({
    seats: {
      builder: { provider: 'nosuchlab', model: 'x' },
      reviser: { provider: 'nosuchlab', model: 'y' },
      critics: [{ provider: 'anthropic', model: 'z' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'missing-tool-reference').length, 1);
});

test('mock and external providers are never flagged', () => {
  const findings = lintChain({
    seats: {
      builder: { provider: 'mock', model: 'x' },
      reviser: { provider: 'external' },
      critics: [{ provider: 'mock', model: 'z' }],
    },
  }, 'chains/fixture.json');
  assert.equal(findings.filter(f => f.kind === 'missing-tool-reference').length, 0);
});

test('a malformed/empty config never throws', () => {
  assert.deepEqual(lintChain({}), [{
    kind: 'unreachable-stage',
    message: 'seats.critics is missing or empty, so the critique/panel round can never run a real review.',
    fix: 'Add at least one seat to "seats.critics" in <chain>, e.g. { "provider": "anthropic", "model": "claude-sonnet-5" }.',
  }]);
  assert.deepEqual(lintChain(null), lintChain({}));
  assert.deepEqual(lintChain(undefined), lintChain({}));
});

test('council doctor --chain <file> exits 1 and lists all three problems, each with a fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-cli-'));
  const chainPath = join(dir, 'broken.json');
  writeFileSync(chainPath, JSON.stringify({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critc: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [],
      builder: { provider: 'nosuchlab', model: 'x' },
    },
  }));
  assert.throws(() => execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' }));
  try {
    execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' });
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /missing-stage-contract/);
    assert.match(err.stderr, /unreachable-stage/);
    assert.match(err.stderr, /missing-tool-reference/);
    assert.match(err.stderr, /fix:/);
  }
});

test('council doctor --chain <file> exits 0 on a clean chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-cli-clean-'));
  const chainPath = join(dir, 'clean.json');
  writeFileSync(chainPath, JSON.stringify({
    seats: {
      criteria: { provider: 'anthropic', model: 'claude-sonnet-5' },
      builder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      critics: [{ provider: 'anthropic', model: 'claude-sonnet-5' }],
    },
  }));
  const out = execFileSync('node', [cli, 'doctor', '--chain', chainPath], { encoding: 'utf8' });
  assert.match(out, /no lint problems/);
});

test('council --chain <broken chain name> refuses to run, fail-loud, before any metered call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-lint-run-'));
  const chainsDir = join(dir, 'chains');
  mkdirSync(chainsDir);
  writeFileSync(join(chainsDir, 'broken.json'), JSON.stringify({
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      critics: [],
    },
  }));
  const taskPath = join(dir, 'task.md');
  writeFileSync(taskPath, 'A tiny task.');
  assert.throws(() => execFileSync('node', [cli, '--chain', 'broken', '--task', taskPath], { encoding: 'utf8', cwd: dir }));
  try {
    execFileSync('node', [cli, '--chain', 'broken', '--task', taskPath], { encoding: 'utf8', cwd: dir });
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr, /chain lint/);
    assert.match(err.stderr, /unreachable-stage/);
  }
});

test('item 6: chains/plan-two-strong.json (the roster-inversion chain) passes chain-lint', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'plan-two-strong.json'), 'utf8'));
  const findings = lintChain(config, 'chains/plan-two-strong.json');
  assert.deepEqual(findings, []);
});

// Check 12: self-review. The real incident is the cheap-7 run of 2026-09-20 -
// one lab wrote the criteria, skeleton, draft and every revision AND held a
// critic seat, so it voted on its own work under unanimous signoff.

test('self-review: the builder\'s own lab on the critic panel fails lint under unanimous signoff', () => {
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [
        { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
        { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      ],
    },
  }, 'chains/fixture.json');
  const selfReview = findings.filter(f => f.kind === 'self-review');
  assert.equal(selfReview.length, 1);
  assert.match(selfReview[0].message, /seats\.builder is lab "sonnet5"/);
  // The fix must name the real escape hatch, not just the problem.
  assert.match(selfReview[0].fix, /selfReview/);
});

test('self-review: the reviser is caught too, and separately from the builder', () => {
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      reviser: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [
        { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
        { provider: 'openrouter', model: 'openai/gpt-5-mini', lab: 'gpt5-mini' },
      ],
    },
  }, 'chains/fixture.json');
  const kinds = findings.filter(f => f.kind === 'self-review').map(f => f.message);
  assert.equal(kinds.length, 2);
  assert.ok(kinds.some(m => /seats\.builder is lab "gpt5-mini"/.test(m)));
  assert.ok(kinds.some(m => /seats\.reviser is lab "sonnet5"/.test(m)));
});

test('self-review: "selfReview": "allowed" is an explicit, greppable escape', () => {
  const config = {
    signoff: 'unanimous',
    selfReview: 'allowed',
    seats: {
      builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
      critics: [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' }],
    },
  };
  assert.deepEqual(lintChain(config, 'chains/fixture.json').filter(f => f.kind === 'self-review'), []);
});

test('self-review: a near-miss escape value fails loudly rather than silently reading as "not allowed"', () => {
  for (const value of [true, 'yes', 'Allowed']) {
    const findings = lintChain({
      signoff: 'unanimous',
      selfReview: value,
      seats: { builder: { provider: 'mock', model: 'mock-a', lab: 'a' }, critics: [{ provider: 'mock', model: 'mock-b', lab: 'b' }] },
    }, 'chains/fixture.json');
    const f = findings.filter(x => x.kind === 'self-review');
    assert.equal(f.length, 1, `expected ${JSON.stringify(value)} to be rejected`);
    assert.match(f[0].message, /must be the exact string "allowed"/);
  }
});

test('self-review: keys on lab, not provider - several labs on one provider is the normal case, not a finding', () => {
  // Every mock chain puts several labs on the "mock" provider by design, and
  // cheap-7's seven labs all share the "openrouter" provider. A check keyed on
  // provider would fire on all of them and miss the real defect entirely.
  const findings = lintChain({
    signoff: 'unanimous',
    seats: {
      builder: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [
        { provider: 'mock', model: 'mock-critic', lab: 'panel-one' },
        { provider: 'mock', model: 'mock-critic', lab: 'panel-two' },
      ],
    },
  }, 'chains/fixture.json');
  assert.deepEqual(findings.filter(f => f.kind === 'self-review'), []);
});

test('self-review: scoped to unanimous signoff, where the author\'s lab holds a real veto', () => {
  const seats = {
    builder: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' },
    critics: [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', lab: 'sonnet5' }],
  };
  assert.deepEqual(lintChain({ seats }, 'chains/fixture.json').filter(f => f.kind === 'self-review'), []);
  assert.equal(lintChain({ signoff: 'unanimous', seats }, 'chains/fixture.json').filter(f => f.kind === 'self-review').length, 1);
});

// The sweep: which shipped chains does this rule actually fail? Pinned so that
// adding a chain that grades its own work, or quietly "fixing" cheap-7 with the
// escape hatch, fails the suite instead of passing unnoticed.
test('self-review: exactly one shipped chain fails it, and it is the superseded one', () => {
  const failing = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).filter(f => {
    const config = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    return lintChain(config, `chains/${f}`).some(x => x.kind === 'self-review');
  });
  assert.deepEqual(failing, ['cheap-7.json']);
});

test('cheap-7-v2: seven independent labs vote, and neither author is among them', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'cheap-7-v2.json'), 'utf8'));
  assert.deepEqual(lintChain(config, 'chains/cheap-7-v2.json'), []);

  // Seven voting labs. Removing the builder's critic seat must not cost a seat: the panel
  // is the mechanism, and shrinking it to six was a regression the fix caused, not a fix.
  const criticLabs = config.seats.critics.map(s => s.lab || s.provider);
  assert.equal(criticLabs.length, 7);
  assert.equal(new Set(criticLabs).size, 7, 'seven seats must be seven distinct labs, not one lab twice');

  // Neither the lab that drafts nor the lab that sets the bar votes on whether it was cleared.
  // chain-lint only guards builder/reviser, so the criteria half is pinned here instead.
  for (const kind of ['builder', 'reviser', 'skeleton', 'handoff', 'criteria']) {
    const lab = config.seats[kind].lab;
    assert.ok(!criticLabs.includes(lab), `${kind}'s lab (${lab}) must not hold a panel seat`);
  }

  // Deliberate absences, both decided 2026-09-20. Anthropic: the downstream Claude review
  // happens after the run, not inside the vote. Kimi: a seat that may route through another
  // lab is not an independent seat.
  assert.ok(!criticLabs.some(l => /sonnet|claude|anthropic/i.test(l)));
  assert.ok(!JSON.stringify(config.seats.critics).includes('kimi'));

  // No escape hatch in our own chain.
  assert.ok(!('selfReview' in config));
});

test('cheap-7-v2: every seat is priced, because an unpriced seat is an uncapped seat', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'cheap-7-v2.json'), 'utf8'));
  const seats = [...Object.values(config.seats).filter(s => !Array.isArray(s)), ...config.seats.critics];
  for (const s of seats) {
    assert.ok(priceOf(s.provider, s.model), `${s.provider}/${s.model} has no entry in src/pricing.json - it would project $0 and escape the spend cap`);
  }
});

// Pre-release audit 2026-09-23 (lint #2): opt-in flag blocks used to accept any inner key, so a
// typo silently skipped the stage - including the paid alternatives stage. Both the schema and
// chain-lint now reject an unknown key in each of the five blocks.
test('chain-lint: a typo inside an opt-in flag block is reported, not silently ignored', async () => {
  const { readFileSync: rf } = await import('node:fs');
  const Ajv = (await import('ajv')).default;
  const schema = JSON.parse(rf(new URL('../config/chain-schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = { seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] }, maxRounds: 1 };

  const typo = { ...base, alternatives: { enable: true } };
  const f = lintChain(typo, 'typo.json').filter(x => x.kind === 'invalid-alternatives-config');
  assert.equal(f.length, 1, 'the stage would silently never run');
  assert.match(f[0].message, /alternatives\.enable is not a recognized key/);
  assert.match(f[0].fix, /did you mean "enabled"/);
  assert.equal(validate(typo), false, 'the schema rejects it too');

  for (const [block, bad] of [['decisions', { eanbled: true }], ['canary', { enabeld: true }], ['lints', { enabbled: true }], ['ambiguity_union', { enable: true }]]) {
    const cfg = { ...base, [block]: bad };
    assert.equal(lintChain(cfg, 'x.json').filter(x => x.kind === `invalid-${block.replace(/_/g, '-')}-config`).length, 1, block);
    assert.equal(validate(cfg), false, `${block}: schema`);
  }
  // Wrong types are reported; correct, complete blocks are clean in both.
  assert.equal(lintChain({ ...base, alternatives: { enabled: true, maxTokens: 0 } }, 'x.json').filter(x => x.kind === 'invalid-alternatives-config').length, 1);
  assert.equal(lintChain({ ...base, canary: { enabled: true, sampleRate: 2 } }, 'x.json').filter(x => x.kind === 'invalid-canary-config').length, 1);
  const good = { ...base, decisions: { enabled: true }, alternatives: { enabled: true, maxTokens: 3000 }, canary: { enabled: true, sampleRate: 0.1 }, lints: { enabled: true, forks: [] }, ambiguity_union: { enabled: false } };
  assert.deepEqual(lintChain(good, 'good.json').filter(x => /^invalid-(decisions|alternatives|canary|lints|ambiguity-union)-config$/.test(x.kind)), []);
  assert.equal(validate(good), true, JSON.stringify(validate.errors));
});

// Pre-release audit 2026-09-23 (personas #2): a role on the debating seats is only ever applied in
// the debate stage, so with proposals or debate off it is a silent no-op - and used to lint clean.
test('chain-lint: a debating-seat role in a chain that never debates is reported', () => {
  const seats = {
    criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' },
    proposers: [{ provider: 'mock', model: 'mock-proposer-a', lab: 'a', role: { persona: 'moses' } }, { provider: 'mock', model: 'mock-proposer-b', lab: 'b' }],
    critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }],
  };
  const kinds = cfg => lintChain(cfg, 'x.json').filter(f => f.kind === 'role-without-debate');
  assert.equal(kinds({ seats, maxRounds: 1 }).length, 1, 'no proposals and no debate');
  assert.equal(kinds({ seats, maxRounds: 1, proposals: { parts: 1 } }).length, 1, 'proposals but debate off');
  assert.match(kinds({ seats, maxRounds: 1, proposals: { parts: 1 } })[0].message, /does not enable "debate"/);
  assert.deepEqual(kinds({ seats, maxRounds: 1, proposals: { parts: 1 }, debate: true }), [], 'a debating chain is fine');
  // With no proposers array the critics are the debating seats, and the rule follows them.
  const critSeats = { ...seats, proposers: undefined, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a', role: { lens: 'security-and-legal' } }] };
  assert.equal(kinds({ seats: critSeats, maxRounds: 1 }).length, 1);
});
