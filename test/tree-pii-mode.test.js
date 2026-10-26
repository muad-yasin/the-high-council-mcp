// The tree's personal-data mode (0.8.3 M6 S5b part A; contract Review/Build_0.8.3/m6-closing/S5b_PII_Gate_And_Registration_Precheck_Contract.md section 3): `council tree start --pii-gate warn|hard-stop` records the mode in tree.json as
//   piiGate: 'warn' | 'hard-stop'
// the ONE source every member of the tree is held to. Three states, read by src/tree-pii-mode.js treePiiModeFrom, which never throws:
//   no field   -> { status: 'off' }          every tree written before this slice, and a tree started without the flag (they ran with the gate off)
//   a good one -> { status: 'on', mode }
//   anything else, or a tree that is not an object -> { status: 'unusable', reason }: a member start is REFUSED on it (A builds that in src/tree-member.js). This is the opposite of the root task pin, where "unknown" is harmless: reading damage
//   as "off" here would run a tree's children with the gate off, which is fail-OPEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTreeFile, readTreeRecord, startTree } from '../src/tree-record.js';
// the reader is imported at the top so that a missing module fails each test that needs it by itself (and the record-writer assertions of PM-3 are reached on their own)
const { treePiiModeFrom } = await import('../src/tree-pii-mode.js').catch(() => ({ treePiiModeFrom: () => { throw new Error('src/tree-pii-mode.js does not exist yet'); } }));

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'thc-piimode-')); made.push(d); return d; };
const SHA = 'a'.repeat(64);
const CHAINS = [0, 1, 2].map(depth => ({ depth, name: depth ? 'priced-debate' : 'split-root', sha256: SHA }));
const GOLDENS = join(import.meta.dirname, 'fixtures', 'tree-json');
const FILES = readdirSync(GOLDENS).filter(f => f.endsWith('.json')).sort();
const newRoot = () => { const dir = tmp(); const rootDir = join(dir, '2026-10-12T00-00-00-000Z'); mkdirSync(rootDir, { recursive: true }); return rootDir; };

test('PM-1 every tree.json frozen before this slice reads as OFF (never a throw), and the two frozen with the field read as ON with their mode; the record loads either way', () => {
  // known-bad controls (each outcome is reachable, so the loop below is not true of a constant reader): a field on a real object is NOT off, a tampered copy of a golden is NOT on
  assert.notDeepEqual(treePiiModeFrom({ schema: 'tree/1', piiGate: 'warn' }), { status: 'off' });
  assert.notEqual(treePiiModeFrom({ ...JSON.parse(readFileSync(join(GOLDENS, 'tree-pii-warn.json'), 'utf8')), piiGate: 'WARN' }).status, 'on');
  assert.ok(FILES.includes('tree-35a9b38.json') && FILES.includes('tree-pii-warn.json') && FILES.includes('tree-pii-hard-stop.json'), FILES.join(', '));
  for (const f of FILES) {
    const tree = JSON.parse(readFileSync(join(GOLDENS, f), 'utf8'));
    const mode = /^tree-pii-(.+)\.json$/.exec(f)?.[1];
    assert.deepEqual(treePiiModeFrom(tree), mode ? { status: 'on', mode } : { status: 'off' }, f);
    const rootDir = newRoot(); mkdirSync(join(rootDir, 'tree'), { recursive: true }); copyFileSync(join(GOLDENS, f), join(rootDir, 'tree', 'tree.json'));
    const rec = readTreeRecord(rootDir); assert.ok(!rec.treeError && rec.tree, `${f}: the record loads`); assert.deepEqual(treePiiModeFrom(rec.tree), mode ? { status: 'on', mode } : { status: 'off' }, f);
  }
});

test('PM-2 a damaged field reads as UNUSABLE with a reason, never as off and never a throw: null, empty, other words, other cases, padded words, numbers, booleans, arrays, objects', () => {
  // known-bad controls: the two good words are NOT unusable, and a missing key is NOT unusable (the reader is neither always-unusable nor always-on)
  for (const w of ['warn', 'hard-stop']) assert.deepEqual(treePiiModeFrom({ piiGate: w }), { status: 'on', mode: w });
  assert.deepEqual(treePiiModeFrom({}), { status: 'off' });
  for (const v of [null, '', 'off', 'on', 'WARN', 'Hard-Stop', 'warn ', ' warn', 'hard stop', 'hard_stop', 'hard-stop\n', 'warn,hard-stop', 0, 1, true, false, ['warn'], [], {}, { mode: 'warn' }, undefined]) {
    const r = treePiiModeFrom({ schema: 'tree/1', piiGate: v });
    assert.equal(r.status, 'unusable', `${JSON.stringify(v)}`); assert.match(r.reason, /\S/);
  }
  // a tree that is not an object, or a hostile one, is unusable too (the opposite of the root task pin: here "unknown" would be fail-open)
  for (const t of [null, undefined, 'x', 5, true, [], () => 1]) assert.equal(treePiiModeFrom(t).status, 'unusable', String(t));
  const hostile = new Proxy({}, { has() { throw new Error('boom'); }, get() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
  assert.equal(treePiiModeFrom(hostile).status, 'unusable');
  assert.deepEqual(treePiiModeFrom({ schema: 'tree/1' }), { status: 'off' }, 'a missing key on a real object is the only way to be off');
  assert.deepEqual(treePiiModeFrom({ piiGate: 'warn', extra: 1 }), { status: 'on', mode: 'warn' }, 'an additional key is not damage (the record is additive)');
});

test('PM-3 createTreeFile writes the field when given a good mode (and only then), refuses any other value BEFORE anything is written, and the tree_started hash covers the field', () => {
  const none = newRoot(); const a = createTreeFile(none, { rootCapUsd: 5, chains: CHAINS });
  assert.equal(Object.hasOwn(a.tree, 'piiGate'), false); assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(none, 'tree', 'tree.json'), 'utf8')), 'piiGate'), false);
  for (const mode of ['warn', 'hard-stop']) {
    const rootDir = newRoot(); const { tree, started } = startTree(rootDir, { rootCapUsd: 5, chains: CHAINS, piiGate: mode });
    assert.equal(tree.piiGate, mode); assert.equal(JSON.parse(readFileSync(join(rootDir, 'tree', 'tree.json'), 'utf8')).piiGate, mode);
    const rec = readTreeRecord(rootDir); assert.equal(rec.corrupt.length, 0, JSON.stringify(rec.corrupt)); assert.deepEqual(treePiiModeFrom(rec.tree), { status: 'on', mode });
    assert.ok(started && rec.events[0].treeJsonSha256 === rec.treeSha256, 'tree_started carries the hash of the file as written, field included');
  }
  for (const bad of [null, '', 'off', 'WARN', 'hard stop', 0, true, ['warn'], {}]) {
    const rootDir = newRoot();
    assert.throws(() => createTreeFile(rootDir, { rootCapUsd: 5, chains: CHAINS, piiGate: bad }), /piiGate/, JSON.stringify(bad));
    assert.equal(existsSync(join(rootDir, 'tree')), false, `${JSON.stringify(bad)}: nothing was written, not even the folder`);
  }
  assert.deepEqual(treePiiModeFrom(a.tree), { status: 'off' });
});

test('PM-4 a damaged field in tree.json reads as an unusable MODE (fail closed), and the record\'s own hash check also reports the edit: the only complaint readTreeRecord makes is that tree.json differs from the hash tree_started recorded', () => {
  const rootDir = newRoot(); startTree(rootDir, { rootCapUsd: 5, chains: CHAINS, piiGate: 'warn' });
  // known-bad control: before the damage the same record reads ON and has no complaint at all
  const intact = readTreeRecord(rootDir); assert.deepEqual(treePiiModeFrom(intact.tree), { status: 'on', mode: 'warn' }); assert.equal(intact.corrupt.length, 0);
  const file = join(rootDir, 'tree', 'tree.json'); const t = JSON.parse(readFileSync(file, 'utf8')); t.piiGate = 7;
  writeFileSync(file, JSON.stringify(t, null, 2));
  const rec = readTreeRecord(rootDir);
  assert.ok(rec.tree && !rec.treeError, 'the schema check accepts the file, so the reader sees the field');
  assert.equal(treePiiModeFrom(rec.tree).status, 'unusable');
  assert.ok(rec.corrupt.every(c => /differs from the hash/.test(c.reason)), `the only complaint is the hash that tree_started recorded: ${JSON.stringify(rec.corrupt)}`);
});
