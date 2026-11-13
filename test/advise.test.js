// CHANGED ACCEPTED (label rename part 2, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD "$X per run, expected; $Y at most."; NEW "$X per run expected, with an upper estimate of $Y." WHY: the same figure, one name (src/cli.js, priced-again line).
// test/advise.test.js
//
// 0.8.4 (the add-on removal, wave 2): the advice add-on is REMOVED. This file used to be the add-on's engine suite (src/advise.js, the advisor prompts in src/roles.js, the advise-* chains,
// the dry run of an advise chain, nine chain-lint rules, the CLI run of an advise chain): about 55 tests, all of which drove code that is gone, so they are removed with it.
// What stays here is the part of that suite that is still true and the refusals that are NEW: a chain file that still carries an `advise` block is refused by runChain itself (so --rematch
// and --replay cannot run one), by chain-lint (kind `advise-removed`) and by the CLI start. The start_run refusal is in test/advice-tools.test.js; the refusal of an old advice FOLDER is in
// test/handoff-from-run.test.js, test/regression-081-handoff-advice-refused.test.js, test/advice-authority.test.js and test/resumability.test.js.
// WORDING_0.8.4.md, "ADD-ON REMOVAL": REM-w22 (CLI), REM-w23 (chain-lint), REM-w30 (runChain). The one fixture chain with an `advise` block that is left is test/fixtures/advice-chains/mock-advise-quick.json (mock seats only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { chainFilePath, readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => readChainFile(root, name);
const labels = r => r.stages.map(s => s.label);
const BRIEF = '# Should we cache the price list?\n\nWe plan to cache the price list in memory for 24 hours to avoid a call per request.\n';

// ---------------------------------------------------------------------------
// Nothing that exists changes.

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: every chain in chains/ was checked, and the advise-* / mock-advise-* ones had to enable advise. NEW: no file of chains/ may set the block at all, and the four fixtures (test/fixtures/advice-chains/) must enable it. WHY: the advice chains are not shipped any more; the rule (only the advise namespace sets the block) is unchanged.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "no shipped chain sets the advise block, and each advise-* and mock-advise-* chain left (the four fixtures) enables it" (it counted the four fixtures). NEW: no file of chains/ or chains/outdated/ sets the block or is named advise-*; the one fixture left, mock-advise-quick, has the block and mock seats only. WHY: the other three fixtures are removed by Helper A with their last reader; this file no longer needs them.
test('advise: no shipped chain (chains/, chains/outdated/) sets the advise block or is named advise-*, and the one fixture left, mock-advise-quick, carries the block on mock seats only', () => {
  for (const d of ['chains', join('chains', 'outdated')]) {
    for (const f of readdirSync(join(root, d)).filter(x => x.endsWith('.json'))) {
      assert.ok(!/^(mock-)?advise-/.test(f), `${d}/${f} is named like an advice chain`);
      const c = JSON.parse(readFileSync(join(root, d, f), 'utf8'));
      assert.equal(c.advise, undefined, `${d}/${f} sets advise`);
    }
  }
  const fx = chain('mock-advise-quick');
  assert.equal(fx.advise?.enabled, true);
  assert.ok([...(fx.seats.critics || []), ...(fx.seats.builder ? [fx.seats.builder] : [])].every(s => s.provider === 'mock'), 'a fixture that every refusal test reads must never reach a provider');
});

test('advise: a chain without the flag runs the planning flow and its result carries no advise key', async () => {
  setCache(null); setBudget(null);
  const r = await runChain({ config: chain('mock'), request: 'A request.', log: () => {} });
  assert.equal('advise' in r, false);
  assert.ok(labels(r).some(l => l.startsWith('panel-') || l.startsWith('critique-')));
  assert.ok(!labels(r).some(l => l.startsWith('advise-')));
});

// ---------------------------------------------------------------------------
// REM-w30: runChain refuses a chain with an `advise` block, whoever calls it.

test('REM-w30: runChain refuses a chain with an "advise" block before any call (the CLI, --rematch, --replay and a direct import all go through it); nothing is staged', async () => {
  setCache(null); setBudget(null);
  const seen = [];
  const go = config => runChain({ config, request: BRIEF, log: () => {}, onStage: s => seen.push(s.label) });
  await assert.rejects(go(chain('mock-advise-quick')),
    err => err.message === 'the chain "mock-advise-quick" has an "advise" block: the advice add-on was removed in 0.8.4, so the chain cannot run. Nothing was sent and nothing was spent.', 'REM-w30, whole');
  const noName = { ...chain('mock-advise-quick') }; delete noName.name;
  await assert.rejects(go(noName), /^Error: this chain has an "advise" block: the advice add-on was removed in 0.8.4, so the chain cannot run\. Nothing was sent and nothing was spent\.$/);
  // the block is refused whatever it says: a switched-off block is still a chain written for the removed add-on
  await assert.rejects(go({ ...chain('mock-advise-quick'), advise: { enabled: false } }), /has an "advise" block: the advice add-on was removed in 0.8.4/);
  assert.deepEqual(seen, [], 'no stage ran');
});

// ---------------------------------------------------------------------------
// REM-w23: chain-lint.

test('REM-w23: chain-lint names an "advise" block as one finding of kind advise-removed (the message and the fix are the wording rows\'), and the same config without the block lints clean', () => {
  const withBlock = chain('mock-advise-quick');
  const found = lintChain(withBlock, 'chains/x.json').filter(f => f.kind === 'advise-removed');
  assert.equal(found.length, 1);
  assert.equal(found[0].message, 'this chain has an "advise" block: the advice add-on was removed in 0.8.4, so the chain cannot run.');
  assert.equal(found[0].fix, 'Remove "advise" from chains/x.json, or use a planning chain.');
  // none of the nine old advise-* rules is left: the only finding about the block is the one above
  assert.deepEqual(lintChain(withBlock, 'x.json').map(f => f.kind).filter(k => k.startsWith('advise')), ['advise-removed']);
  const { advise, ...plain } = withBlock;
  assert.deepEqual(lintChain(plain, 'x.json').filter(f => f.kind.startsWith('advise')), []);
});

// ---------------------------------------------------------------------------
// REM-w22: the CLI start.

test('REM-w22: the CLI start of a chain file with an "advise" block exits 2 with the sentence on stderr; nothing runs, no run folder is made', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advise-cli-'));
  writeFileSync(join(dir, 'brief.md'), BRIEF);
  mkdirSync(join(dir, 'chains'), { recursive: true });
  copyFileSync(chainFilePath(root, 'mock-advise-quick'), join(dir, 'chains', 'mock-advise-quick.json'));
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--task', 'brief.md', '--chain', 'mock-advise-quick'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 60_000 });
  assert.equal(r.status, 2, r.stderr);
  // REM-w22 (the CLI row). The source and WORDING_0.8.4.md carry "Remove the block, or use a planning chain."; the build brief's paraphrase of the sentence leaves it out.
  assert.match(r.stderr, /Chain "mock-advise-quick" has an "advise" block: the advice add-on was removed in 0.8.4, so this chain cannot run\. Remove the block, or use a planning chain\. Nothing was sent and nothing was spent\./);
  assert.ok(!existsSync(join(dir, 'runs')) || readdirSync(join(dir, 'runs')).length === 0, 'no run folder');
});
