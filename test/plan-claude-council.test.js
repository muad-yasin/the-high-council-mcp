// plan-claude-council (0.8.3; Muad 18 Okt 2026 13:59-14:04: the Claude-only subscription chain, "Yes to both" on the name and the two description sentences). The file is 76's, byte for byte; this file shows what a person gets from it,
// offline and for $0: every seat is external, so the dry run prints $0.00 twice and a real start pauses at the first external stage. The runs go from a scratch folder with a bare environment, and every paid provider's key is a MALFORMED
// value (test/helpers/no-real-keys.js: a present value is never filled from the package's own .env, and a malformed one is never sent). What is true on its own: the chain has no paid seat, so no key is used even if one were loaded; a
// COUNCIL_* setting in the package's .env is not blanked by this setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { DEFAULT_CHAIN, PROMOTED_CHAINS } from '../src/chain-name.js';
import { panelLabCount } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chain = JSON.parse(readFileSync(join(root, 'chains', 'plan-claude-council.json'), 'utf8'));
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() }, encoding: 'utf8', timeout: 60_000 });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'pcc-')); mkdirSync(join(d, 'tasks')); return d; };

test('PCC-1: every seat is external, nothing has a model price to read, and it is not the default chain', () => {
  const seats = [chain.seats.criteria, chain.seats.skeleton, chain.seats.builder, chain.seats.reviser, chain.seats.handoff, chain.seats.decider, ...chain.seats.proposers, ...chain.seats.critics];
  assert.equal(seats.length, 15);   // 6 single seats + 3 proposers + 6 judges
  for (const s of seats) assert.equal(s.provider, 'external');
  assert.equal(chain.seats.critics.length, 6);
  assert.equal(chain.seats.proposers.length, 3);
  assert.notEqual(DEFAULT_CHAIN, 'plan-claude-council');
  assert.equal(PROMOTED_CHAINS.includes('plan-claude-council'), false, 'it is not promoted');
});

test('PCC-2: the dry run prints $0.00 expected and $0.00 upper estimate and asks for no key', () => {
  const d = scratch(); const t = join(d, 't.md');
  writeFileSync(t, 'Plan a tiny CLI that prints the date.\n');
  const out = run(d, ['--chain', 'plan-claude-council', '--task', t, '--dry-run']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /TOTAL\s.*\$0\.0000\s+per run\s+\(expected\)/);
  // CHANGED ACCEPTED (label rename, 20 Okt 2026): OLD /MAXIMUM/ NEW /UPPER ESTIMATE/ - the printed row label only.
  assert.match(out.stdout, /UPPER ESTIMATE\s.*\$0\.0000\s+per run/);
  assert.match(out.stdout, /28 of 28 stages are answered by external seats/);
  assert.doesNotMatch(out.stdout + out.stderr, /missing|API_KEY/i);
});

test('PCC-3 (real verb): a start with no keys and no --max-usd pauses at the first external stage (exit 3, NEEDS-criteria.md), asks for no limit, reserves nothing and writes its folder in the working directory', () => {
  const d = scratch(); const t = join(d, 't.md');
  writeFileSync(t, 'Plan a tiny CLI that prints the date.\n');
  const r = run(d, ['--chain', 'plan-claude-council', '--task', t]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  const runs = readdirSync(join(d, 'runs'));
  assert.equal(runs.length, 1);
  const files = readdirSync(join(d, 'runs', runs[0]));
  assert.ok(files.includes('NEEDS-criteria.md'), files.join(','));
  assert.equal(existsSync(join(d, 'runs', runs[0], 'spend-reservations.jsonl')), false, 'nothing was reserved: no paid call exists');
  assert.doesNotMatch(r.stdout + r.stderr, /awaiting|type the limit|gate answer/i);
});

test('PCC-4: one lab per MODEL (Muad 19 Okt, answer 2: a repeated model is one lab): no -lN / -p suffix, the same model carries the same lab on every seat, the three proposers keep three distinct labs (or their blind proposals would collapse into one), and the panel counts 4 labs for 4 models', () => {
  const modelSeats = [chain.seats.criteria, ...chain.seats.proposers, ...chain.seats.critics];
  const labOf = new Map();
  for (const s of modelSeats) { assert.ok(!/-(l[123]|p)$/.test(s.lab), `${s.lab}: a per-layer or per-role suffix`); assert.equal(labOf.get(s.model) ?? s.lab, s.lab, `${s.model} has two labs`); labOf.set(s.model, s.lab); }
  assert.equal(new Set(labOf.values()).size, labOf.size, 'two models share a lab');
  assert.equal(new Set(chain.seats.proposers.map(s => s.lab)).size, 3);
  assert.equal(panelLabCount(chain), 4);
});
