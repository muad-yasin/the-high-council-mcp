// 0.8.3 M6 S0 (b): the two `split_changed` refusals read differently and `council tree status` (S6) will print them. (A) the FRONTIER path (tree-loop.js: the approval showed split X, the plan now holds Y): the frontier is
// pending again and a new approval answers it. (B) verifySplit (tree-expansion.js, M5f (a)): a node@generation that already has its ONE split_verified was verified again against another plan: the first verification
// stands, nothing reopens, no approval is waiting. The reader is keyed on what the record carries (B: scope node@gN, no frontierKey; A: the frontierKey), the record itself is unchanged. All-mock, $0.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, treeDirOf } from '../src/tree-record.js';
import { verifySplit } from '../src/tree-expansion.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { splitChangedOf } from '../src/tree-split-changed.js';
import { renderSplitChanged, prefixOf } from '../src/tree-stop.js';
import { approveHandler } from '../src/tree-approve.js';
import { terminal } from './helpers/terminal.js';
import { realRoot } from './helpers/real-root.js';
import { pricedChildren } from './helpers/child-chains.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { writeFileSync } from 'node:fs';

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const rootOf = async opts => { const r = await realRoot({ ...pricedChildren(), ...opts }); made.push(r.t.work); return r; };
const D = 'd'.repeat(64);

/** (B): the record is made to name another sha for R@g1 (as test/tree-split.test.js does), then verifySplit runs on the real plan. */
async function verifiedAgainstAnother() {
  const r = await rootOf();
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${D}"`) : l)).join('\n'));
  const v = verifySplit(r.t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir: r.runDir, work: r.t.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.equal(v.refusal?.check, 'split_changed', JSON.stringify(v.refusal));
  return { r, now: v.sha256 };
}
/** (A): an approved frontier whose preview names another verified split, so the registration is refused as split_changed (as test/tree-loop.test.js does). */
async function frontierSplitChanged() {
  const r = await rootOf();
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const preview = structuredClone(d.preview); preview.splitSha256 = 'c'.repeat(64);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...preview, boundSha256: d.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: 1, boundSha256: d.boundSha256 });
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.deepEqual([reg.kind, reg.check], ['refused', 'split_changed']);
  return { r, d, key: d.frontierKey, now: String(r.split) };
}
/** every file under a folder with its bytes: the reader must leave all of it alone */
const snapshot = dir => { const out = {}; const walk = p => { for (const n of readdirSync(p).sort()) { const f = join(p, n); if (statSync(f).isDirectory()) { out[`${f}/`] = true; walk(f); } else out[f] = readFileSync(f, 'utf8'); } }; walk(dir); return out; };

test('(B) a node verified once and verified again against another plan: the reader returns it keyed on node+generation, and the text says the first verification stands, that nothing is waiting, and names no command at all', async () => {
  const { r, now } = await verifiedAgainstAnother();
  const items = splitChangedOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual(items, [{ kind: 'verified', node: 'R', generation: 1, verified: 'd'.repeat(12), now: now.slice(0, 12) }]);
  const lines = renderSplitChanged(items, 'rootid');
  assert.deepEqual(lines, [`R@g1: its plan changed after it was verified (verified split ${'d'.repeat(12)}, plan now ${now.slice(0, 12)}). The first verification stands; nothing new is verified from this plan and no approval is waiting on it.`]);
  assert.equal(/tree approve|approve it again|council tree|decide|regenerat/i.test(lines.join('\n')), false, 'no approval and no route is named for (B)');
});

test('(A) an approved frontier refused as split_changed: the reader returns it while the frontier is reopened, and the text names the approval as the remedy; a newer approval answers it', async () => {
  const { r, d, key, now } = await frontierSplitChanged();
  const items = splitChangedOf(readTreeRecord(r.t.rootDir));
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].kind, items[0].frontierKey, items[0].verified, items[0].now], ['frontier', key, 'c'.repeat(12), now.slice(0, 12)]);
  const text = renderSplitChanged(items, 'rootid').join('\n');
  assert.match(text, new RegExp(`Frontier ${prefixOf(key)}: the plan changed after the approval was shown \\(approved split c{12}, plan now ${now.slice(0, 12)}\\)`));
  assert.match(text, /approve it again \(`council tree approve rootid`\)/);
  assert.equal(/first verification stands/.test(text), false, 'the (B) remedy is not (A)\'s');
  // a newer approval of the corrected preview answers the refusal: it is history, the reader no longer lists it
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: key, revision: 2, boundSha256: d.boundSha256 });
  assert.deepEqual(splitChangedOf(readTreeRecord(r.t.rootDir)), []);
});

test('a tree with no split_changed refusal reads as none; a refusal of another check (held_changed) is not listed; the reader writes and changes nothing', async () => {
  const r = await rootOf();
  assert.deepEqual(splitChangedOf(readTreeRecord(r.t.rootDir)), []);
  appendTreeEvent(r.t.rootDir, { event: 'blocked', reason: 'expansion_refused', scope: 'R/M1@g1', transition: 'derivation', check: 'held_changed', detail: 'x', frontierKey: 'a'.repeat(64) });
  assert.deepEqual(splitChangedOf(readTreeRecord(r.t.rootDir)), []);
  const before = snapshot(r.t.work);
  splitChangedOf(readTreeRecord(r.t.rootDir));
  renderSplitChanged([], 'rootid');
  assert.deepEqual(snapshot(r.t.work), before, 'every byte and every folder is as it was');
});

test('(B) a second refusal of the same node@generation lists once, keyed on node+generation (the latest record)', async () => {
  const { r } = await verifiedAgainstAnother();
  verifySplit(r.t.rootDir, { node: 'R', generation: 1, runId: ROOT_ID, runDir: r.runDir, work: r.t.work, inheritedGlobal: [], ancestorQuestions: [] });
  const blockedB = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'blocked' && e.check === 'split_changed');
  assert.equal(blockedB.length, 2, 'two refusal records');
  const items = splitChangedOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual(items.map(i => [i.kind, i.node, i.generation]), [['verified', 'R', 1]]);
});

test('(C) `tree approve` itself records a split_changed (item 3, the record names another verified split than the plan holds) with the node as scope and NO frontierKey: it is not (B) - an approval IS pending there - and its text must not say none is waiting', async () => {
  const r = await rootOf();
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${'ab'.repeat(32)}"`) : l)).join('\n'));
  const io = terminal([]);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  assert.notEqual(code, 0, io.shown() + io.errors());
  const items = splitChangedOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual(items, [{ kind: 'approve_refused', node: 'R', generation: 1, verified: 'ab'.repeat(6), now: String(r.split).slice(0, 12) }]);
  const text = renderSplitChanged(items, 'rootid').join('\n');
  assert.equal(text, `R@g1: the split recorded as verified (${'ab'.repeat(6)}) is not the block its plan holds now (${String(r.split).slice(0, 12)}); \`council tree approve\` refuses its frontier while they differ.`);
  assert.equal(/no approval is waiting|first verification stands/.test(text), false, 'neither (B)\'s sentences');
});
