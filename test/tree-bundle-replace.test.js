// M5f (b) (the maintainer's ruling, 9 Oct): writeBundle on a bundle that DIFFERS. For a node that is NOT registered (a child refused at admission, whose bundle was written, then derived again with other bytes)
// the old folder is moved aside as `<name>.replaced-<n>` (n counting up, never deleted) and the new bundle is written and registered; for a REGISTERED node it is a refusal (the registration carries
// bundleSha256 and the start check refuses a mismatch: the loop must not silently repair what that check exists to catch); an unreadable record refuses too (it cannot say). Nothing reads a
// `.replaced-*` folder. The test cannot produce a natural input change (a provider's plan is pinned, the parent's drift is a parent_changed), so it makes the ON-DISK bundle differ from what the next
// sitting derives: the same state writeBundle sees. All-mock, $0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TreeRefusal, EVENTS_FILE, readTreeRecord, treeDirOf } from '../src/tree-record.js';
import { registerNextChild } from '../src/tree-loop.js';
import { writeBundle } from '../src/tree-derive.js';
import { bundleDirName, bundleSha256Of } from '../src/tree-continuation.js';
import { realRoot } from './helpers/real-root.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const tree = async () => { const r = await realRoot({ ...pricedChildren() }); made.push(r.t.work); approvePending(r); return r; };
const refuse = () => { throw new TreeRefusal({ code: 'continuation_refused', transition: 'node_registered', reason: 'not admitted: budget (test)' }); };
const inputs = r => join(r.t.rootDir, 'tree', 'inputs');
const folders = r => readdirSync(inputs(r)).filter(n => !n.startsWith('.tmp-')).sort();
const NAME = bundleDirName('R/M1', 1);

test('(b) END TO END: a child refused at admission leaves its bundle; when the next sitting derives other bytes the old folder is MOVED ASIDE (.replaced-1), the new bundle registers, and a third round counts up (.replaced-2) with .replaced-1 untouched', { timeout: 200_000 }, async () => {
  const r = await tree();
  const a = registerNextChild(r.t.rootDir, { work: r.t.work, deps: { register: refuse } });
  assert.deepEqual([a.kind, a.node], ['refused', 'R/M1']);
  const dir = join(inputs(r), NAME); const original = readFileSync(join(dir, 'context.md'), 'utf8');
  writeFileSync(join(dir, 'context.md'), `${original}\nAN OLDER DERIVATION.\n`);                    // the folder on disk is not what this sitting derives
  const b = registerNextChild(r.t.rootDir, { work: r.t.work, deps: { register: refuse } });          // refused again: the bundle was rewritten first
  assert.equal(b.kind, 'refused');
  assert.deepEqual(folders(r), [NAME, `${NAME}.replaced-1`]);
  assert.equal(readFileSync(join(inputs(r), `${NAME}.replaced-1`, 'context.md'), 'utf8'), `${original}\nAN OLDER DERIVATION.\n`, 'MOVED, not deleted: the old bytes are intact');
  assert.equal(readFileSync(join(dir, 'context.md'), 'utf8'), original, 'the new bundle is the sitting\'s own derivation');
  writeFileSync(join(dir, 'context.md'), `${original}\nA SECOND OLDER ONE.\n`);
  const c = registerNextChild(r.t.rootDir, { work: r.t.work });                                       // and this time it registers
  assert.equal(c.kind, 'registered', JSON.stringify(c));
  assert.deepEqual(folders(r), [NAME, `${NAME}.replaced-1`, `${NAME}.replaced-2`], 'n counts up');
  assert.equal(readFileSync(join(inputs(r), `${NAME}.replaced-1`, 'context.md'), 'utf8'), `${original}\nAN OLDER DERIVATION.\n`, '.replaced-1 is untouched by the second move');
  assert.equal(readFileSync(join(inputs(r), `${NAME}.replaced-2`, 'context.md'), 'utf8'), `${original}\nA SECOND OLDER ONE.\n`);
  assert.equal(c.event.bundleSha256, bundleSha256Of(join(inputs(r), NAME)), 'the registration carries the hash of the bundle in place');
  assert.notEqual(c.event.bundleSha256, bundleSha256Of(join(inputs(r), `${NAME}.replaced-2`)));
});

test('(b) a REGISTERED node\'s bundle is never rewritten: a differing derivation is a refusal, the folder is as it was and nothing is moved', { timeout: 200_000 }, async () => {
  const r = await tree();
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  const dir = join(inputs(r), NAME); const files = Object.fromEntries(['task.md', 'criteria.json', 'context.md', 'node.json'].map(f => [f, readFileSync(join(dir, f), 'utf8')]));
  assert.throws(() => writeBundle(r.t.rootDir, { node: 'R/M1', generation: 1, files: { ...files, 'context.md': `${files['context.md']}\nchanged\n` } }), /differs in context\.md, and R\/M1@g1 is registered: a registered node's bundle is never rewritten/);
  assert.deepEqual(folders(r), [NAME]); assert.equal(readFileSync(join(dir, 'context.md'), 'utf8'), files['context.md']);
  assert.equal(writeBundle(r.t.rootDir, { node: 'R/M1', generation: 1, files }).written, false, 'the identical bytes stay an idempotent no-op for a registered node');
});

test('(b) an unreadable record cannot say whether the node is registered: nothing is moved or rewritten', { timeout: 200_000 }, async () => {
  const r = await tree();
  registerNextChild(r.t.rootDir, { work: r.t.work, deps: { register: refuse } });
  const dir = join(inputs(r), NAME); const files = Object.fromEntries(['task.md', 'criteria.json', 'context.md', 'node.json'].map(f => [f, readFileSync(join(dir, f), 'utf8')]));
  appendFileSync(join(treeDirOf(r.t.rootDir), EVENTS_FILE), 'this is not an event\n');
  assert.ok(readTreeRecord(r.t.rootDir).corrupt.length > 0);
  assert.throws(() => writeBundle(r.t.rootDir, { node: 'R/M1', generation: 1, files: { ...files, 'task.md': 'changed\n' } }), /is missing or cannot be read to say whether R\/M1@g1 is registered/);
  assert.deepEqual(folders(r), [NAME]); assert.equal(readFileSync(join(dir, 'task.md'), 'utf8'), files['task.md']);
});

test('(b) nothing reads a `.replaced-*` folder: a bundle is addressed by its name (no src/tree-*.js lists tree/inputs), and the replaced node runs from its new bundle', { timeout: 200_000 }, async () => {
  // the scan is a literal pattern (a lister that builds its path from a variable named otherwise would pass it): its limit, and that it can fail, are shown on samples
  const LISTS_INPUTS = text => /readdirSync\([^)]*inputs/.test(text) || /readdirSync\(base\)/.test(text);
  assert.equal(LISTS_INPUTS("readdirSync(join(rootDir, 'tree', 'inputs'))"), true); assert.equal(LISTS_INPUTS('readdirSync(base)'), true); assert.equal(LISTS_INPUTS('readdirSync(runDir)'), false);
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter(n => /^tree-.*\.js$/.test(n))) {
    assert.equal(LISTS_INPUTS(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')), false, `${f} lists tree/inputs`);
  }
  const r = await tree();
  registerNextChild(r.t.rootDir, { work: r.t.work, deps: { register: refuse } });
  writeFileSync(join(inputs(r), NAME, 'context.md'), 'an older bundle\n');
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered');
  assert.ok(existsSync(join(inputs(r), `${NAME}.replaced-1`)));
  assert.equal(reg.event.bundleSha256, bundleSha256Of(reg.bundleDir ?? join(inputs(r), NAME)), 'the start check reads the bundle by name: the hash matches the registration');
});

test('(b) a MISSING record refuses like a corrupt one (the maintainer, 9 Oct: a bundle always sits beside tree.json + events.jsonl): nothing is moved or rewritten', () => {
  const rootDir = join(mkdtempSync(join(tmpdir(), 'thc-norecord-')), 'runs', ROOT_ID); made.push(join(rootDir, '..', '..'));
  const files = { 'task.md': 'x\n', 'criteria.json': '[]\n', 'context.md': 'x\n', 'node.json': '{}\n' };
  writeBundle(rootDir, { node: 'R/M1', generation: 1, files });
  assert.throws(() => writeBundle(rootDir, { node: 'R/M1', generation: 1, files: { ...files, 'task.md': 'changed\n' } }), /is missing or cannot be read to say whether R\/M1@g1 is registered/);
  assert.deepEqual(readdirSync(join(rootDir, 'tree', 'inputs')), [NAME]); assert.equal(readFileSync(join(rootDir, 'tree', 'inputs', NAME, 'task.md'), 'utf8'), 'x\n');
  assert.equal(writeBundle(rootDir, { node: 'R/M1', generation: 1, files }).written, false, 'identical bytes stay a no-op');
});
