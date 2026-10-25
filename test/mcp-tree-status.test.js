// The OUTPUT BUILDER of the MCP tool `tree_status` (0.8.3 M6 slice S7, B's new-files part). The tool's registration, its TOOL_TRUST entry and the 19 -> 20 counts are A's; this file proves what the builder hands over:
// the payload's keys (additive, camelCase, two money figures and no total), the untrusted fields (named, each present, hidden characters removed, and every run-folder or model sentence found only under a named field),
// the result for a run id that is not a tree root, a member, a linked folder or not a run at all, and that nothing is written. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markUntrustedFields, TRUST_META_KEY } from '../src/return-path.js';
import { TOOL_TRUST } from '../src/mcp/untrusted.js';
import { TREE_STATUS_UNTRUSTED_FIELDS, treeStatusPayload, treeStatusResult, treeStatusTrustRule } from '../src/mcp/tree-status.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { gatherReadinessFacts } from '../src/tree-ready.js';
import { chooseNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { ROOT_ID, syntheticRun } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { mcpCalls } from './helpers/mcp-calls.js';
import { adoptedTree } from './helpers/adoption-fixture.js';

const snapshot = dir => { const out = {}; const walk = p => { for (const n of readdirSync(p).sort()) { const f = join(p, n); if (statSync(f).isDirectory()) { out[`${f}/`] = true; walk(f); } else out[f] = readFileSync(f, 'utf8'); } }; walk(dir); return out; };
const T1 = '2026-10-11T12:00:01.000Z';
const facts = (over = {}) => ({
  rootId: 'rootid', treeId: 'rootid', position: { lastEventId: 'e9', lastEventAt: T1, events: 9 }, consistency: null, problems: [], stopMarker: false, piiGate: 'off',
  readiness: { source: 'computed', verdict: 'incomplete', reasons: [{ severity: 'incomplete', code: 'open_stop', scope: 'R@g1', text: 'a needs_decision stop (e7) is open' }], eventId: 'e9', at: T1 },
  gate: { ok: true, problems: [{ code: 'mirror_disagrees', node: 'R/M1@g1', runId: 'r1', keys: ['r1:a'] }] },
  nodes: [{ node: 'R', generation: 1, depth: 0, runId: 'rootid', phase: 'closed', outcome: 'passed', nextGeneration: null }],
  waiting: [{ node: 'R/M2', why: ['R/M1 is not registered yet'] }], awaitingApproval: ['a'.repeat(64)], dead: [{ node: 'R/M1/M1', why: ['R/M1/M1 is not registered: dead'] }],
  held: { registeredNotStarted: [{ node: 'R/M1', generation: 2, runId: 'run-m1', grantUsd: 5.25 }], parentChanged: [{ frontierKey: 'b'.repeat(64) }], guardRefusals: [{ node: 'R/M3', generation: 1, guard: 'g', item: 'an item' }] },
  splitChanged: [{ kind: 'verified', node: 'R', generation: 1, verified: 'c'.repeat(12), now: 'd'.repeat(12) }],
  openStops: [{ id: 'e7', node: 'R/M2', generation: 1, text: 'Stop e7: R/M2 generation 1 ended.\n' }],
  limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1, runs: 3, raised: [{ id: 'e4', at: T1, limit: 'maxRuns', from: 12, to: 20 }] },
  money: { unit: 'usd', rootCapUsd: 100, memberSpend: { sumUsd: 0.7, members: [{ node: 'R', generation: 1, runId: 'rootid', started: true, runSpentUsd: 0.7 }, { node: 'R/M1', generation: 1, runId: 'kidid', started: false, runSpentUsd: 0 }], reservations: [] }, adjustments: { sumUsd: -0.3, reservations: [{ key: 'k' }] } },
  ...over,
});
const KEYS = ['run', 'treeId', 'verdict', 'stopMarker', 'abandoned', 'piiGate', 'memberRefusals', 'closedUnstarted', 'consistency', 'problems', 'gate', 'nodes', 'waiting', 'awaitingApproval', 'heldNodes', 'keptNodes', 'dead', 'held', 'openStops', 'limits', 'money', 'view'].sort();

test('the payload: exactly the documented keys, the view is the text `council tree status` prints, the money keeps two figures and has no total, and the check itself fails on a merged figure', () => {
  const f = facts();
  const p = treeStatusPayload(f);
  assert.deepEqual(Object.keys(p).sort(), KEYS);
  assert.equal(p.view, renderTreeStatus(f)); assert.deepEqual(p.verdict, { value: 'incomplete', source: 'computed', eventId: 'e9', at: T1, reasons: [{ severity: 'incomplete', code: 'open_stop', scope: 'R@g1', text: 'a needs_decision stop (e7) is open' }] });
  assert.deepEqual(Object.keys(p.money).sort(), ['adjustments', 'memberSpend', 'rootCapUsd', 'unit']); assert.deepEqual(p.money.memberSpend, { sumUsd: 0.7, runs: 1 }); assert.deepEqual(p.money.adjustments, { sumUsd: -0.3, reservations: 1 });
  assert.deepEqual(Object.keys(p.held).sort(), ['guardRefusals', 'parentChanged', 'registeredNotStarted', 'splitChanged']);
  assert.equal(JSON.stringify(p).match(/"(total|treeSpent|combined|grand)[A-Za-z]*"/i), null, 'no merged-total key anywhere');
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, 'plain JSON: it survives a round trip');
  assert.notEqual(JSON.stringify({ ...p, money: { ...p.money, totalUsd: 0.4 } }).match(/"(total|treeSpent|combined|grand)[A-Za-z]*"/i), null, 'bad input: the scan sees a merged figure');
  const empty = treeStatusPayload(facts({ money: null, limits: null, openStops: [], waiting: [], dead: [], awaitingApproval: [] }));
  assert.equal(empty.money, null); assert.equal(empty.limits, null); assert.deepEqual(empty.openStops, []);
});

test('the untrusted fields: each is a key of the payload, the rule is the one A pastes into TOOL_TRUST, marking names exactly them and strips hidden characters, and the compare fails on a different entry', () => {
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026). OLD: the sample facts held no deferred stop. NEW: one (reason 'x', no hidden character, so the hidden-character count of 4 below is unchanged). WHY: 65ec14a (19 Okt, session channel `stop_deferred`; Muad 19 Okt 12:50 "1: yes 2: yes") put 'deferredStops' in TREE_STATUS_UNTRUSTED_FIELDS, but the payload adds it only when a stop was deferred, so `'deferredStops' in p` could not hold for facts without one.
  const p = treeStatusPayload(facts({ openStops: [{ id: 'e7', node: 'R', generation: 1, text: `Stop e7\n${String.fromCodePoint(0xE0041)}hidden ${String.fromCodePoint(0x202E)}reversed\n` }], deferredStops: [{ stopId: 'e7', conditions: ['person_only_form'], reason: 'x', actor: 'session' }], draftedStops: [{ stopId: 'e7', draftId: 'e8', bytes: 7, at: T1, text: 'A plan.', reason: 'x', changeAsked: null }] }));       // CHANGED ACCEPTED AGAIN (red triage, C&C thcmcp-cd Q5 23 Okt 2026; cause: 1d9eecd, GAP A, on this base): TREE_STATUS_UNTRUSTED_FIELDS also names 'draftedStops', which the payload adds only when a draft waits; the sample holds one (plain text, no hidden character: the count of 4 below is unchanged)
  for (const f of TREE_STATUS_UNTRUSTED_FIELDS) assert.ok(f in p, `${f} is a key of the payload`);
  const rule = treeStatusTrustRule();
  assert.deepEqual(rule, { wrap: 'fields', fields: [...TREE_STATUS_UNTRUSTED_FIELDS] });
  const marked = markUntrustedFields(p, rule.fields);
  assert.deepEqual(marked.untrusted_fields, rule.fields); assert.match(marked.untrusted_notice, /written by AI models/);
  assert.equal(marked.hidden_removed.tag_characters + marked.hidden_removed.bidi_controls, 4, 'one tag character and one bidi control, in two named fields (the stop text and the view that quotes it)');
  assert.equal(JSON.stringify(marked).includes(String.fromCodePoint(0xE0041)), false);
  const unmarked = markUntrustedFields(p, []);
  assert.equal(JSON.stringify(unmarked).includes(String.fromCodePoint(0xE0041)), true, 'bad input: with no field named the hidden character stays');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert.equal(same({ wrap: 'fields', fields: ['view'] }, rule), false, 'bad input: another entry does not compare equal');
});

test('TRIPWIRE (not a pin): the TOOL_TRUST entry for tree_status equals the builder\'s rule; since 7bf4942 untrusted.js imports treeStatusTrustRule(), so this holds by construction and proves nothing by itself: the evidence is the `_meta` fields check of the real-session test at the end of this file', () => {
  assert.deepEqual(TOOL_TRUST.tree_status, treeStatusTrustRule());
});

test('every run-folder or model sentence is found only under a named field: the stop text of a child whose handoff says A fixture handoff appears in view and openStops and nowhere in the unnamed fields', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const res = treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work });
  const p = JSON.parse(res.content[0].text);
  const SENTINEL = 'A fixture handoff';
  const where = Object.entries(p).filter(([, v]) => JSON.stringify(v).includes(SENTINEL)).map(([k]) => k).sort();
  assert.deepEqual(where, ['openStops', 'view'], 'the model sentence is under named fields only');
  assert.ok(where.every(k => TREE_STATUS_UNTRUSTED_FIELDS.includes(k)));
  assert.equal(p.openStops.length, 1); assert.match(p.openStops[0].text, new RegExp(`council tree decide ${ROOT_ID}`));
  assert.equal(p.run, ROOT_ID); assert.equal(p.verdict.source, 'computed');
  // bad: a field that does carry the sentence but is not named would be found by the same scan
  assert.deepEqual(Object.entries({ ...p, notes: SENTINEL }).filter(([, v]) => JSON.stringify(v).includes(SENTINEL)).map(([k]) => k).filter(k => !TREE_STATUS_UNTRUSTED_FIELDS.includes(k)), ['notes']);
});

test('the result for what is not a tree root: a bad id, a missing run, a plain run, a member (it names its tree) and a linked folder each give { error } in the same shape, and nothing is written', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const err = run => JSON.parse(treeStatusResult({ runsDir: r.t.runsDir, run, work: r.t.work }).content[0].text);
  const before = snapshot(r.t.work);
  assert.deepEqual(err('../etc'), { error: 'no such run' }); assert.deepEqual(err(undefined), { error: 'no such run' }); assert.deepEqual(err('2026-01-01T00-00-00-000Z'), { error: 'no such run' });
  const plain = '2026-02-02T00-00-00-000Z'; syntheticRun({ runsDir: r.t.runsDir }, plain, {});
  assert.match(err(plain).error, /is not the root of a recursive-councils tree/);
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d) && d !== plain);
  assert.ok(member, 'a member run exists');
  assert.match(err(member).error, new RegExp(`is a member of the tree ${ROOT_ID}, not its root`));
  symlinkSync(join(r.t.runsDir, ROOT_ID), join(r.t.runsDir, '2026-03-03T00-00-00-000Z'));
  assert.match(err('2026-03-03T00-00-00-000Z').error, /symbolic link/);
  mkdirSync(join(r.t.runsDir, '2026-04-04T00-00-00-000Z'), { recursive: true });
  const afterSnap = snapshot(r.t.work);
  const ok = treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work });
  assert.equal(ok.content.length, 1); assert.equal(ok.content[0].type, 'text'); assert.equal(JSON.parse(ok.content[0].text).error, undefined);
  assert.deepEqual(snapshot(r.t.work), afterSnap, 'building the result wrote nothing');
  assert.notDeepEqual(before, afterSnap, 'bad: the snapshot sees the folders this test itself added');
});

test('CONTAINMENT: a member folder with a symbolic link in it (a HANDOFF.md pointing outside the working folder) ends the call with an error naming the member, and the outside text never reaches the result; the same tree without the link answers', async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const call = () => JSON.parse(treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work }).content[0].text);
  assert.equal(call().error, undefined, 'without the link the tree answers');
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d));
  const dir = join(r.t.runsDir, member);
  const outside = mkdtempSync(join(tmpdir(), 'thc-outside-'));
  writeFileSync(join(outside, 'secret.md'), '## What this is\nOUTSIDE-SENTINEL-LINE\n');
  renameSync(join(dir, 'HANDOFF.md'), join(dir, 'HANDOFF.md.orig'));
  symlinkSync(join(outside, 'secret.md'), join(dir, 'HANDOFF.md'));
  const raw = treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work }).content[0].text;
  assert.equal(raw.includes('OUTSIDE-SENTINEL-LINE'), false, 'the text of a file outside the working folder is not returned');
  assert.match(JSON.parse(raw).error, new RegExp(`the tree's member run ${member} is not a folder this tool may read: .*symbolic link`));
});

test('R16: the tool passes the secret denylist all the way down (readiness, the report, the eligibility of the next child): a member whose run.json names a `.env` task path with other content is "cannot check" through treeStatusResult, while the same record read without it sees a drift', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d));
  const metaFile = join(r.t.runsDir, member, 'run.json'); const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  writeFileSync(join(r.t.work, '.env'), 'SECRET=hunter2\n'); writeFileSync(metaFile, JSON.stringify({ ...meta, task: '.env' }));
  const open = gatherReadinessFacts(r.t.rootDir, { work: r.t.work }).nodes.find(n => n.node === 'R/M1');
  assert.notEqual(open.run.contractExit, 0, 'the control: without the denylist the .env is read and the task reads as changed');
  const eligible = chooseNextChild(r.t.rootDir, { work: r.t.work });
  assert.match(JSON.stringify(eligible.waiting), /no longer holds PLAN 5\.5 items 1-2/, 'and the eligibility check of the consumer sees it too');
  const p = JSON.parse(treeStatusResult({ runsDir: r.t.runsDir, run: ROOT_ID, work: r.t.work }).content[0].text);
  assert.equal(p.error, undefined);
  assert.equal(p.verdict.reasons.some(x => x.code === 'contract_check' && /R\/M1/.test(x.scope)), false, 'the tool did not read the .env: no drift verdict');
  assert.doesNotMatch(JSON.stringify(p.waiting), /no longer holds PLAN 5\.5 items 1-2/, 'nor in the waiting reasons');
  assert.equal(JSON.stringify(p).includes('hunter2'), false);
});

test('the module reads run folders only through src/run-files.js and writes nothing: no raw file call, no writer, no lock, no clock', () => {
  const src = readFileSync(new URL('../src/mcp/tree-status.js', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /readFileSync|writeFileSync|readdirSync|openSync|appendFileSync|copyFileSync|createReadStream|createWriteStream|appendTreeEvent|withTreeLock|Date\.now|new Date|Math\.random|process\.env/);
  assert.match(src, /import \{[^}]*trustedRunDir[^}]*\} from '\.\.\/run-files\.js'/);
});

// REGISTRATION (0.8.3 M6 S7, commit a): the tool through a REAL MCP session (`cli.js --mcp`, a spawned server speaking JSON-RPC over stdio), not the builder called directly. The server's working folder is the fixture's, so its
// `runs/` is the fixture's `runs/`. $0, offline.
test('registered: tools/call tree_status through a real MCP session answers with the builder\'s payload, names the untrusted fields, still refuses a run that is not a tree root, and passes the secret denylist (the R16 .env fixture)', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const member = readdirSync(r.t.runsDir).find(d => d !== ROOT_ID && /^\d{4}-/.test(d));
  const metaFile = join(r.t.runsDir, member, 'run.json'); const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  writeFileSync(join(r.t.work, '.env'), 'SECRET=hunter2\n'); writeFileSync(metaFile, JSON.stringify({ ...meta, task: '.env' }));
  const res = await mcpCalls(r.t.work, [{ name: 'tree_status', arguments: { run: ROOT_ID } }, { name: 'tree_status', arguments: { run: member } }, { name: 'tree_status', arguments: { run: 'no-such-run' } }]);
  const root = res.get(2).result; const asMember = res.get(3).result; const missing = res.get(4).result;
  assert.equal(root.isError, undefined, JSON.stringify(res.get(2)));
  const p = JSON.parse(root.content[0].text);
  assert.equal(p.error, undefined); assert.equal(p.run, ROOT_ID);
  assert.deepEqual(Object.keys(p).filter(k => !['untrusted_fields', 'untrusted_notice'].includes(k)).sort(), KEYS, 'the payload keys the builder documents');
  assert.deepEqual(root._meta?.[TRUST_META_KEY]?.fields, TREE_STATUS_UNTRUSTED_FIELDS, 'the wrapper marks exactly the builder\'s untrusted fields');
  assert.equal(p.verdict.reasons.some(x => x.code === 'contract_check' && /R\/M1/.test(x.scope)), false, 'the server passed the denylist: the .env was not read');
  assert.equal(root.content[0].text.includes('hunter2'), false);
  assert.match(JSON.parse(asMember.content[0].text).error, /is a member of the tree .*, not its root/, 'a member names its tree');
  assert.equal(JSON.parse(missing.content[0].text).error, 'no such run');
});

test('C4: the tree_status payload of a tree with an ADOPTION carries adoptedNodes (ids only, additive); the field is not in the untrusted list', async () => {
  const { t } = adoptedTree({});
  const p = treeStatusPayload(gatherStatusFacts(t.rootDir, { work: t.work }));
  assert.deepEqual(p.adoptedNodes, [{ node: 'R/M1/A', generation: 1, runId: p.adoptedNodes[0].runId, slot: 'R/M1/B@g2', under: 'R/M1@g2', decisionId: null }]);
  assert.equal(TREE_STATUS_UNTRUSTED_FIELDS.includes('adoptedNodes'), false);
  // known-bad input (the row can fail): a tree that adopted nothing has no such field, so the assertion above would be red on it
  const plain = await trackedRealRoot({ ...pricedChildren(), cap: 100 }); approvePending(plain);
  const pp = treeStatusPayload(gatherStatusFacts(plain.t.rootDir, { work: plain.t.work }));
  assert.equal(pp.adoptedNodes, undefined);
  assert.throws(() => assert.deepEqual(pp.adoptedNodes, p.adoptedNodes));
});
