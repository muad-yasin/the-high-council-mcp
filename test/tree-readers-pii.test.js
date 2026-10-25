// S8-6b part 1 (C&C's go, 12 Oct 2026; MCP-surface SHA-stop: the P9/P14 pins move, old -> new): the readers show the tree's PERSONAL-DATA MODE (tree.json `piiGate`, written by `council tree start --pii-gate`, read by src/tree-pii-mode.js).
//   The five states a reader can show: off | warn | hard-stop | unusable (a value that is neither mode) | unreadable (tree.json itself cannot be read: never the same text as "off").
//   TREE_HANDOFF.md, tree/report.json (key `piiGate`), the status view (and so the MCP `view` text) and the MCP tree_status payload (key `piiGate`) all say it, from ONE exported constant in src/tree-handoff.js.
//   THE REASON of an `unusable` value embeds up to 40 characters of tree.json content: it appears in TREE_HANDOFF.md ONLY, terminal-safe; the report, the status view, the MCP payload and the MCP `view` show the state word, never the reason.
// New exports are read through a namespace (the habit from the views-lock slip). Everything is mock and $0; every folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as H from '../src/tree-handoff.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { TREE_STATUS_UNTRUSTED_FIELDS, treeStatusPayload } from '../src/mcp/tree-status.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { readTreeRecord, startTree, treeDirOf } from '../src/tree-record.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { track } from './helpers/temp-trees.js';
import { newTree } from './helpers/tree-fixture.js';

const STATES = ['hard-stop', 'off', 'unreadable', 'unusable', 'warn'];
const HOSTILE = `LOUD${String.fromCodePoint(0x202E)}${String.fromCharCode(0x1b)}[31mred${'x'.repeat(60)}`;

/** A started tree whose tree.json carries `piiGate` (omitted = a tree started without the flag). The shared fixture's newTree has no such parameter on this base (A's part B adds one), so the tree is started here, beside the fixture's working folder, task and chain hashes. */
function piiTree(piiGate) {
  const t = newTree({ cap: 100 }); track(t.work);
  const rootDir = join(t.runsDir, '2026-10-12T20-00-00-000Z');
  startTree(rootDir, { rootCapUsd: 100, rootTask: makeRootTaskPin(join(t.work, 'tasks', 'x.md'), t.work), ...(piiGate ? { piiGate } : {}), chains: [0, 1, 2].map(depth => ({ depth, name: depth ? t.childChain : t.rootChain, sha256: t.shaIn(depth ? t.childChain : t.rootChain) })) });
  return { ...t, rootDir };
}
const treeJson = rootDir => join(treeDirOf(rootDir), 'tree.json');
/** A tree.json a hand edit left holding `value` as its mode: sound JSON, schema intact; the record reports the hash difference besides (the only way to reach `unusable`: the writer refuses a bad mode). */
function withMode(piiGate, value) { const t = piiTree(piiGate); const j = JSON.parse(readFileSync(treeJson(t.rootDir), 'utf8')); j.piiGate = value; writeFileSync(treeJson(t.rootDir), JSON.stringify(j)); return t; }
function unreadable() { const t = piiTree('warn'); writeFileSync(treeJson(t.rootDir), '{ not json'); return t; }

/** Every surface of a tree, as { handoff, report, reportText, status, facts, payload, view }. */
function surfaces(t) {
  const hf = H.gatherHandoffFacts(t.rootDir, { work: t.work });
  const report = buildTreeReport(t.rootDir, { work: t.work });
  const facts = gatherStatusFacts(t.rootDir, { work: t.work });
  const payload = treeStatusPayload(facts);
  return { hf, handoff: H.renderTreeHandoff(hf), report, reportText: renderTreeReport(report), facts, status: renderTreeStatus(facts), payload, view: payload.view };
}

test('PI-1: a tree started with --pii-gate warn / hard-stop and one started without it: all four readers name the state, from the one constant', () => {
  for (const [piiGate, state] of [[undefined, 'off'], ['warn', 'warn'], ['hard-stop', 'hard-stop']]) {
    const s = surfaces(piiTree(piiGate));
    assert.equal(s.hf.piiGate, state, 'handoff facts');
    assert.equal(s.report.piiGate, state, 'report');
    assert.equal(JSON.parse(s.reportText).piiGate, state, 'report.json text');
    assert.equal(s.facts.piiGate, state, 'status facts');
    assert.equal(s.payload.piiGate, state, 'MCP payload');
    const line = H.piiModeLine(state);
    for (const [name, text] of [['handoff', s.handoff], ['status', s.status], ['mcp view', s.view]]) {
      assert.ok(text.includes(`${line}\n`), `${name} carries the line for ${state}`);
      for (const other of STATES.filter(x => x !== state)) assert.ok(!text.includes(H.piiModeLine(other)), `${name} (${state}) does not carry the line for ${other}`);
    }
    assert.match(s.status, new RegExp(`^${H.PII_MODE_TITLE}: ${state}\\b`, 'm'), 'the title is the first words of the line');
  }
});

test('PI-2: tree.json cannot be read: the state is `unreadable` on every surface - not "off" - and the early-return (record problems) branch of the status facts carries it', () => {
  const s = surfaces(unreadable());
  assert.ok(s.facts.problems.length > 0, 'this is the record-problems branch of gatherStatusFacts');
  assert.ok(s.hf.problems.length > 0, 'and of gatherHandoffFacts');
  for (const got of [s.hf.piiGate, s.report.piiGate, s.facts.piiGate, s.payload.piiGate]) assert.equal(got, 'unreadable');
  for (const text of [s.handoff, s.status, s.view]) { assert.ok(text.includes(H.piiModeLine('unreadable'))); assert.ok(!text.includes(H.piiModeLine('off'))); }
});

test('PI-3: a value that is neither mode is `unusable` on every surface; its reason (40 characters of tree.json) is printed in TREE_HANDOFF.md ONLY, terminal-safe, and nowhere else', () => {
  const s = surfaces(withMode('warn', HOSTILE));
  for (const got of [s.hf.piiGate, s.report.piiGate, s.facts.piiGate, s.payload.piiGate]) assert.equal(got, 'unusable');
  assert.ok(s.facts.problems.length > 0, 'the hand edit also trips the record hash: the early-return branch again');
  // where the reason IS printed: the handoff, through terminalSafe and one line
  assert.match(s.handoff, /LOUD/, 'the handoff names the reason');
  assert.ok(!/[‮\u001b]/.test(s.handoff), 'no bidi override and no escape character reaches the file');
  // where it is NOT printed: every other surface, searched in full, in the serialised form too
  for (const [name, text] of [['report.json', s.reportText], ['status view', s.status], ['MCP view', s.view], ['MCP payload', JSON.stringify(s.payload)], ['status facts', JSON.stringify(s.facts)], ['report object', JSON.stringify(s.report)]]) {
    assert.ok(!text.includes('LOUD'), `${name} does not carry the reason`);
    assert.ok(!text.includes('xxxx'), `${name} does not carry the tail of the reason`);
  }
  assert.ok(H.piiModeLine('unusable').includes('unusable'));
});

test('PI-4: piiModeOf reads a record: the five states, the reason only for `unusable` and cut to 40 characters, and the table of words has exactly the five states', () => {
  assert.deepEqual(H.piiModeOf({ tree: null }), { state: 'unreadable', reason: null });
  assert.deepEqual(H.piiModeOf({}), { state: 'unreadable', reason: null });
  assert.deepEqual(H.piiModeOf({ tree: { schema: 'tree/1' } }), { state: 'off', reason: null });
  assert.deepEqual(H.piiModeOf({ tree: { piiGate: 'warn' } }), { state: 'warn', reason: null });
  assert.deepEqual(H.piiModeOf({ tree: { piiGate: 'hard-stop' } }), { state: 'hard-stop', reason: null });
  for (const bad of ['Warn', 'off', '', null, 7, ['warn'], { mode: 'warn' }, true]) assert.equal(H.piiModeOf({ tree: { piiGate: bad } }).state, 'unusable', JSON.stringify(bad));
  const long = H.piiModeOf({ tree: { piiGate: HOSTILE } });
  assert.equal(long.state, 'unusable'); assert.ok(long.reason.includes('LOUD'));
  assert.ok(long.reason.includes(String.fromCodePoint(0x202E)), 'the reason handed to the renderer still carries the bidi override (JSON.stringify escapes ESC to text but not this), so the handoff assertion in PI-3 is what shows terminalSafe removed it'); assert.ok(!long.reason.includes('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'the reason is cut by treePiiModeFrom, not extended here');
  assert.deepEqual(Object.keys(H.PII_MODE_WORDS).sort(), STATES);
  assert.ok(Object.isFrozen(H.PII_MODE_WORDS));
});

test('PI-5: the payload key is not an untrusted field (a fixed word of five), and a facts object that carries no mode renders as "not known", never as "off"', () => {
  assert.ok(!TREE_STATUS_UNTRUSTED_FIELDS.includes('piiGate'), 'the untrusted classification does not change');
  for (const t of [piiTree(), piiTree('warn'), unreadable(), withMode('warn', HOSTILE)]) assert.ok(STATES.includes(surfaces(t).payload.piiGate));
  const t = piiTree('warn');
  assert.equal(readTreeRecord(t.rootDir).tree.piiGate, 'warn', 'the fixture really wrote the mode');
  const { piiGate, ...noMode } = gatherStatusFacts(t.rootDir, { work: t.work });
  assert.equal(piiGate, 'warn');
  assert.ok(renderTreeStatus(noMode).includes(H.piiModeLine('unreadable')) && !renderTreeStatus(noMode).includes(H.piiModeLine('warn')));
});
