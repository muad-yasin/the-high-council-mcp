// 0.8.4, settled item E10 (the maintainer was asked whether the shipped layered chains should use 2 or 3 stall rounds and chose 3): `dispute.stall_rounds` is 3 in every layered chain of chains/ (a chain whose critics all carry a
// `layer`: the nine layered planning chains and mock-layered; C&C's ruling of 4 Nov 2026 on the scope). A stall is one objection standing unchanged for that many verdicts of its judge in a row (0.8.4 S5); the rule itself reads the window from the
// chain (test/stall-escalation.test.js parameterises it), so this file pins only what the shipped files say. The layered chains are DERIVED from the files, not typed here.
// Rows: SSW-1 one per layered chain: the dispute stage is on and its stall window is 3; SSW-2 (control: passes on the tree before E10) each lints clean with it; SSW-3 (control) the derivation finds the ten chains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chains = readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8'))]);
const layered = chains.filter(([, c]) => Array.isArray(c.seats?.critics) && c.seats.critics.length > 0 && c.seats.critics.every(s => Number.isInteger(s?.layer)));

// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10): OLD: at least ten layered chains (the ten E10 covered) incl. plan-mini-council-sol-session. NEW: at least eight, and plan-the-high-council in the named list instead of the Sol-session copy. WHY: two layered chains retired (the Sol-session copy and plan-default-opro-council, plus plan-china-mini-council) and the count is derived from the files.
test('SSW-3 (control) the layered chains of chains/ are found from the files: at least the eight that remain', () => {
  assert.ok(layered.length >= 8, `${layered.length} layered chains: ${layered.map(([f]) => f).join(', ')}`);
  for (const f of ['plan-mini-council.json', 'plan-medium-council.json', 'plan-high-council.json', 'plan-the-high-council.json', 'mock-layered.json']) assert.ok(layered.some(([n]) => n === f), `${f} is layered`);
});

for (const [file, config] of layered) {
  test(`SSW-1 ${file}: the dispute stage is on and its stall window is 3`, () => {
    assert.equal(config.dispute?.enabled, true);
    assert.equal(config.dispute?.stall_rounds, 3);
  });
  test(`SSW-2 (control) ${file}: lints clean with that window`, () => {
    assert.deepEqual(lintChain(config, join(ROOT, 'chains', file)), []);
  });
}
