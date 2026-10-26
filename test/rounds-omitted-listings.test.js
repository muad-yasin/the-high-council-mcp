// CR-4B-007, the other two places (25 Okt 2026): a chain that leaves out maxRounds runs with the default of 2 passes, and the dry run's text, the run log and state.json already say so (test/rounds-omitted.test.js). The `--dry-run --json`
// answer and the MCP tool `list_chains` still printed the raw key: null in the one, no key in the other. Neither field is documented as "the chain's own setting"; both now show the cap the run uses. A chain with overseer rounds keeps null / no key (its
// ceiling is derived and shown as passCeiling). Real verbs, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpCalls } from './helpers/mcp-calls.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rounds-listings-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const { maxRounds: _dropped, ...omitted } = base;
  writeFileSync(join(dir, 'chains', 'rl-omitted.json'), JSON.stringify({ ...omitted, name: 'rl-omitted' }));
  writeFileSync(join(dir, 'chains', 'rl-set.json'), JSON.stringify({ ...base, name: 'rl-set', maxRounds: 3 }));
  return dir;
}

test('RL-1 (real verbs): `--dry-run --json` prints the effective maxRounds for a chain that omits it, its own value for one that sets it, and null for an overseer chain', () => {
  const dir = project();
  const dry = chain => JSON.parse(spawnSync(process.execPath, [cli, '--chain', chain, '--task', 'tasks/x.md', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } }).stdout);
  assert.equal(dry('rl-omitted').maxRounds, 2);
  assert.equal(dry('rl-set').maxRounds, 3);
  const o = dry('plan-mini-council');                                                    // a shipped chain with overseer rounds (maxOverseerRounds): a dry run calls nothing
  assert.ok('maxOverseerRounds' in o, 'the chain has overseer rounds');
  assert.equal(o.maxRounds, null, 'an overseer chain keeps null (its ceiling is passCeiling)');
});

test('RL-2 (real MCP session): list_chains shows the effective maxRounds of a chain that omits it and the set value of one that does not', async () => {
  const dir = project();
  const res = await mcpCalls(dir, [{ name: 'list_chains', arguments: {} }]);
  const chains = JSON.parse(res.get(2).result.content[0].text);
  const by = n => chains.find(c => c.name === n);
  assert.equal(by('rl-omitted').maxRounds, 2);
  assert.equal(by('rl-set').maxRounds, 3);
});
