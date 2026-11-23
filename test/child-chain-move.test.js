// 0.8.4 H-CC-a commit 2 (Muad's pick of 05 Nov 2026: the tree's child runs use the parent's chain by default, and daily7-sub-a moves to chains/outdated/): the file is where the pick put it, the "no such chain" hint says
// it was retired in 0.8.4, `tree start --child-chain daily7-sub-a` is refused with that hint, and a tree that registered it as its child chain gets "unavailable" with the same hint at its next sitting. $0, nothing is run.
// The new export (OUTDATED_0_8_4) is read through a NAMESPACE import so the file loads on a tree without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import * as CN from '../src/chain-name.js';
import { outdatedChainHint } from '../src/chain-name.js';
import { DEFAULT_HANDLERS, treeCommand } from '../src/tree-cli.js';
import { ChainUnavailable, loadChainConfig } from '../src/tree-derive-load.js';
import { installSplitRoot } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const io = () => { const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough(); let o = ''; let e = ''; stdout.on('data', d => { o += d; }); stderr.on('data', d => { e += d; }); return { stdin, stdout, stderr, out: () => o, err: () => e }; };

test('CM-1 daily7-sub-a is in chains/outdated/ and not in chains/; chain-name.js lists it as retired in 0.8.4, and the earlier lists are as they were', () => {
  assert.equal(existsSync(join(root, 'chains', 'daily7-sub-a.json')), false);
  assert.equal(existsSync(join(root, 'chains', 'outdated', 'daily7-sub-a.json')), true);
  assert.deepEqual([...(CN.OUTDATED_0_8_4 ?? [])], ['daily7-sub-a', 'plan-default-opro-council', 'plan-mini-council-sol-session', 'plan-china-mini-council', 'verify']);   // CHANGED ACCEPTED TEST (0.8.4 seats and retirements unit): OLD: eight names. NEW: those eight plus the four chains the unit moved to chains/outdated/ (plan-default-opro-council, plan-mini-council-sol-session, plan-china-mini-council, verify), in the order chain-name.js lists them. WHY: the list is the thing it counts; missed by the retirement commit's set   // 0.8.4 (36a): the seven advise-single chains joined the list   // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: twelve names, led by the seven advise-single chains. NEW: those seven are no longer in OUTDATED_0_8_4 (five names are left: daily7-sub-a, plan-default-opro-council, plan-mini-council-sol-session, plan-china-mini-council, verify). WHY: the advise-single chains left the repository with the advice add-on; their names are in REMOVED_ADVICE_CHAINS (src/chain-name.js) and CM-5 below pins the sentence.
  assert.ok(CN.OUTDATED_CHAINS.includes('daily7-sub-a'));
  assert.equal(CN.OUTDATED_0_8_2.includes('daily7-sub-a') || CN.OUTDATED_0_8_3.includes('daily7-sub-a'), false, 'it is in exactly one list');
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the title and a second assertion also covered outdatedAdviceChainHint('daily7-sub-a') ("retired from the package (0.8.4)"). NEW: the chain hint only. WHY: outdatedAdviceChainHint is removed from src/chain-name.js with the add-on (it was the advice tools' own hint function); outdatedChainHint is the one hint every verb uses.
test('CM-2 the hint names 0.8.4 for daily7-sub-a, and the 0.8.2 / 0.8.3 names keep their years', () => {
  assert.match(outdatedChainHint('daily7-sub-a'), /"daily7-sub-a" was retired from the package \(0\.8\.4\): it is in the repository as chains\/outdated\/daily7-sub-a\.json, not in the npm package\. To use it again, copy that file from GitHub into this project's chains\/ folder\./);
  assert.match(outdatedChainHint(CN.OUTDATED_0_8_2[0]), /\(0\.8\.2\)/); assert.match(outdatedChainHint(CN.OUTDATED_0_8_3[0]), /\(0\.8\.3\)/);
});

test('CM-3 `tree start --child-chain daily7-sub-a` is refused (exit 1) with the hint, and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cm-')); made.push(dir);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); installSplitRoot(dir);
  const d = io();
  const code = await treeCommand(['start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'daily7-sub-a', '--max-usd', '5'], { work: dir, ...d, handlers: { ...DEFAULT_HANDLERS, start: x => DEFAULT_HANDLERS.start({ ...x, deps: {} }) } });
  assert.equal(code, 1, d.err());
  assert.match(d.err(), /--child-chain: the chain daily7-sub-a is not in .* or in the package\. "daily7-sub-a" was retired from the package \(0\.8\.4\)/);
  assert.equal(existsSync(join(dir, 'runs')), false, 'no runs/ folder was made');
});

test('CM-4 a tree that registered daily7-sub-a as its child chain: its next load of that depth is ChainUnavailable and carries the hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-cm-')); made.push(dir);
  const tree = { chains: [{ depth: 0, name: 'split-root', sha256: 'x' }, { depth: 1, name: 'daily7-sub-a', sha256: 'abc' }, { depth: 2, name: 'daily7-sub-a', sha256: 'abc' }] };
  assert.throws(() => loadChainConfig({ tree, depth: 1, work: dir }), e => e instanceof ChainUnavailable && /the chain file daily7-sub-a\.json is not in the working folder's chains\/ or the package\./.test(e.message) && /retired from the package \(0\.8\.4\)/.test(e.message));
});

// 0.8.4 add-on removal (Muad's Q9 (a), wording row REM-w1, A-DRAFT): the eight advice chains that left the repository still get a sentence when a person names one: it says where the chain went and names no file.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the REM-w1 sentence was asserted from both hint functions (outdatedChainHint and outdatedAdviceChainHint). NEW: from outdatedChainHint only. WHY: outdatedAdviceChainHint is removed with the add-on; the sentence and the list are unchanged.
test('CM-5 every advice chain that left the repository (advise-premium and the seven advise-single chains) gets the REM-w1 sentence from the hint; none is in an OUTDATED list; a retired chain that is still in chains/outdated/ keeps its own sentence', () => {
  const NAMES = ['advise-premium', 'advise-single', 'advise-single-astra', 'advise-single-deepseek', 'advise-single-gemini', 'advise-single-glm-flash', 'advise-single-opus', 'advise-single-qwen'];
  assert.deepEqual([...(CN.REMOVED_ADVICE_CHAINS ?? [])].sort(), [...NAMES].sort());   // through the namespace, like OUTDATED_0_8_4 above, so the file loads on a tree without the export
  for (const name of NAMES) {
    const want = ` "${name}" was removed in 0.8.4 with the advice add-on. Its file is no longer in the repository; the git history keeps it.`;
    assert.equal(outdatedChainHint(name), want, name);
    assert.equal(CN.OUTDATED_CHAINS.includes(name), false, `${name} is not in an OUTDATED list`);
    assert.equal(existsSync(join(root, 'chains', 'outdated', `${name}.json`)), false, `${name}.json is deleted`);
    assert.doesNotMatch(want, /chains\/outdated|COUNCIL_ADVICE_CHAINS_DIR|copy that file/);
  }
  assert.match(outdatedChainHint('daily7-sub-a'), /retired from the package \(0\.8\.4\): it is in the repository as chains\/outdated\/daily7-sub-a\.json/);
});
