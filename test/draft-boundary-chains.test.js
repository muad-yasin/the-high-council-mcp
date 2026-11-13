// 0.8.4 D27 (his pick "Start + end lines, all chains"): the draft-boundary switch `draft_end_marker { enabled: true }` is on in every shipped chain that has a stage reading a plan, mock chains included.
// The advise chains read no plan and are out. The lists are DERIVED from chains/ (a chain with an `advise` block reads none), never typed, so a new chain file is judged the day it is added.
// The switch is config, not words: what it sends is gated again on the held words (test/draft-boundary-gate.test.js, added with the words), so shipping the switch now changes no prompt byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainsDir = join(root, 'chains');
const files = readdirSync(chainsDir).filter(f => f.endsWith('.json')).sort();
const load = f => JSON.parse(readFileSync(join(chainsDir, f), 'utf8'));
const adviseFiles = files.filter(f => load(f).advise !== undefined);
const planFiles = files.filter(f => !adviseFiles.includes(f));
// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD adviseFiles (chains in chains/ with an `advise` block) had to be non-empty, and the fourth test read them. NEW chains/ holds none (the check is that it stays that way), and the advice chains kept as fixtures (test/fixtures/advice-chains/) stand in for the "chains that read none" in the guard and the fourth test. WHY the four advice chains left chains/ and the eight in chains/outdated/ were deleted with the add-on.
const fixtureDir = join(root, 'test', 'fixtures', 'advice-chains');
const fixtureFiles = readdirSync(fixtureDir).filter(f => f.endsWith('.json')).sort();
const loadFixture = f => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8'));

test('the folder was read, and both kinds of chain are in it (a vacuous list would pass every check below)', () => {
  assert.ok(planFiles.length > 0, 'chains that read a plan');
  assert.ok(fixtureFiles.length > 0, 'advice chains that read none (fixtures)');
  assert.deepEqual(adviseFiles, [], 'the package ships no advice chain since 0.8.4');
  assert.equal(planFiles.length + adviseFiles.length, files.length);
});

test('D27: every shipped chain that reads a plan carries draft_end_marker { enabled: true }', () => {
  const missing = planFiles.filter(f => load(f).draft_end_marker?.enabled !== true);
  assert.deepEqual(missing, [], 'a shipped plan-reading chain without the boundary switch');
});

test('D27: the switch carries nothing else (the key table allows only enabled)', () => {
  for (const f of planFiles) assert.deepEqual(Object.keys(load(f).draft_end_marker ?? {}), ['enabled'], f);
});

test('D27: the advise chains read no plan and do not carry the switch', () => {
  const carrying = [...adviseFiles.filter(f => load(f).draft_end_marker !== undefined), ...fixtureFiles.filter(f => loadFixture(f).advise === undefined || loadFixture(f).draft_end_marker !== undefined)];
  assert.deepEqual(carrying, [], 'an advise chain with a boundary switch that no stage reads');
});

test('D27: no shipped chain draws a lint finding about the boundary switch or its pairing with the notes lane', () => {
  const found = files.flatMap(f => lintChain(load(f), `chains/${f}`).filter(x => /marker|boundary/i.test(x.kind)).map(x => `${f}: ${x.kind}`));
  assert.deepEqual(found, []);
});
