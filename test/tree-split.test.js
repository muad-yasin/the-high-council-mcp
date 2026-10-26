// 0.8.3 M3: the split contract (PLAN 5.1-5.5). Part 1: the pure checks of PLAN 5.3 on strings ($0, no model, no run). Every invalid case below is ONE edit of the same valid three-child block, so a rule that fires
// is the rule that edit breaks (a check is evidence only if it can fail). Part 2 (further down) reads real $0 mock runs for PLAN 5.5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPLIT_MARKER, basisNamesHeading, bodyOfDelivered, checkSplit, extractSplitBlocks, firstDifference, headingsOf, planMilestones, splitContractOf, splitSha256 } from '../src/tree-split.js';
import { parseMilestones } from '../src/milestones.js';
import { sha256Of } from '../src/thin-contract.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { block3, plan3, planWith, validBlock } from './helpers/split-fixture.js';

const CRITERIA = ['C1', 'C2', 'C3', 'C4'];
const clone = v => JSON.parse(JSON.stringify(v));

const run = (block, opts = {}, extra = {}) => checkSplit({ text: planWith(block, opts), criteriaIds: CRITERIA, ...extra });
const rules = r => r.findings.map(f => f.rule);
/** Apply one edit to a copy of the valid block and check that the named rule (and check number) fires. */
function refused(edit, rule, check, { opts, extra } = {}) {
  const b = validBlock(); edit(b);
  const r = run(b, opts, extra);
  assert.equal(r.valid, false, `valid despite the edit that breaks ${rule}`);
  const f = r.findings.find(x => x.rule === rule);
  assert.ok(f, `expected rule ${rule}; got ${JSON.stringify(rules(r))}`);
  assert.equal(f.check, check, `${rule} is check ${check} of PLAN 5.3`);
  return f;
}

test('a valid three-child block has no finding; its sha256 is the canonical form (key order does not change it)', () => {
  const r = run(validBlock());
  assert.deepEqual(r.findings, []);
  assert.equal(r.valid, true); assert.equal(r.present, true); assert.equal(r.blockCount, 1);
  const reordered = Object.fromEntries(Object.entries(validBlock()).reverse());
  assert.equal(splitSha256(reordered), r.sha256, 'canonical JSON: keys sorted at every depth');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  const report = splitContractOf({ text: planWith(validBlock()), criteriaIds: CRITERIA });
  assert.deepEqual([report.valid, report.sha256, report.findings], [true, r.sha256, []]);
});

test('PLAN 5.3 check 1: two blocks, a block that does not parse, an unclosed block, a missing field, duplicate ids, and both directions of milestone coverage are each refused naming the rule', () => {
  const two = checkSplit({ text: planWith(validBlock(), { fenceCount: 2 }), criteriaIds: CRITERIA });
  assert.ok(rules(two).includes('two_blocks')); assert.equal(two.valid, false);
  const bad = checkSplit({ text: planWith(validBlock()).replace('"milestones"', '"milestones" ;;'), criteriaIds: CRITERIA });
  assert.ok(rules(bad).includes('block_json')); assert.equal(bad.sha256, null);
  const unclosed = checkSplit({ text: planWith(validBlock()).replace(/\n```\n$/, '\n'), criteriaIds: CRITERIA });
  assert.ok(rules(unclosed).includes('block_unclosed'));
  refused(b => { delete b.agreements; }, 'shape', 1);
  refused(b => { b.children[1].scope = 7; }, 'shape', 1);
  refused(b => { b.milestones[1].id = 'M1'; }, 'duplicate_milestone_id', 1);
  refused(b => { b.children[1].id = 'K1'; }, 'duplicate_child_id', 1);
  const dupAgreement = refused(b => { b.agreements.push(clone(b.agreements[0])); }, 'duplicate_agreement_id', 1);
  assert.equal(dupAgreement.id, 'A1', 'a repeated agreement id is named');
  const missing = refused(() => {}, 'milestone_missing_from_block', 1, { opts: { extraMilestones: ['M6'] } });
  assert.equal(missing.id, 'M6', 'a plan whose ## Milestones holds a milestone heading the block omits is refused naming the missing id');
  const phantom = refused(b => { b.milestones.push({ id: 'M9', status: 'needs-decision', basis: 'x', open_question: 'y' }); }, 'milestone_not_in_plan', 1);
  assert.equal(phantom.id, 'M9');
});

test('PLAN 5.3 check 2: status, basis and open_question', () => {
  refused(b => { b.milestones[0].status = 'maybe'; }, 'bad_status', 2);
  const f = refused(b => { b.milestones[3].open_question = 'Is it ready?'; }, 'ready_with_question', 2);
  assert.equal(f.id, 'M4');
  refused(b => { b.milestones[3].basis = 'Nothing in the plan says so'; }, 'basis_names_no_section', 2);
  refused(b => { b.milestones[0].open_question = null; }, 'missing_open_question', 2);
  refused(b => { b.milestones[4].open_question = '  '; }, 'missing_open_question', 2);
  refused(b => { b.milestones[2].basis = ''; }, 'missing_basis', 2);
});

test('the basis of a ready milestone names a real heading of the plan: a heading of 3+ words may be a substring; a shorter one ("Scope", "Risks") must be the WHOLE basis; milestone headings do not count', () => {
  const heads = headingsOf(planWith(validBlock()));
  assert.equal(basisNamesHeading('Release and rollback plan', heads), true);
  assert.equal(basisNamesHeading('see the section "Release and rollback plan" for the settled rollout', heads), true, 'a 3+ word heading may sit inside a sentence');
  assert.equal(basisNamesHeading('release AND rollback   plan', heads), true, 'whitespace and case are normalised');
  assert.equal(basisNamesHeading('Scope', heads), true, 'a short heading passes as the whole basis');
  assert.equal(basisNamesHeading('## Scope', heads), true);
  assert.equal(basisNamesHeading('the scope is small and the risks are known', heads), false, 'a short heading must not let a sentence pass');
  assert.equal(basisNamesHeading('Overview and scope', heads), false);
  assert.equal(basisNamesHeading('M4 - Release', heads), false, 'a milestone heading is not a section that settles a milestone');
  assert.equal(basisNamesHeading('Milestones', heads), false);
  assert.equal(basisNamesHeading('', heads), false);
  // a heading inside a code fence is not a heading
  assert.equal(basisNamesHeading('Hidden section in a fence', headingsOf('# T\n\n```\n## Hidden section in a fence\n```\n')), false);
});

test('PLAN 5.3 check 3: classes, inherits, delegated coverage and the global rule below the root', () => {
  const unclassed = refused(b => { b.classes = b.classes.filter(c => c.id !== 'C2'); b.children.forEach(k => { k.inherits = k.inherits.filter(i => i !== 'C2'); }); }, 'unclassed_criterion', 3);
  assert.equal(unclassed.id, 'C2', 'an unclassed criterion id is named');
  refused(b => { b.classes.push({ id: 'C2', class: 'global' }); }, 'duplicate_class', 3);
  refused(b => { b.classes[0].class = 'optional'; }, 'bad_class', 3);
  refused(b => { b.classes.push({ id: 'C9', class: 'global' }); }, 'unknown_criterion', 3);
  refused(b => { b.children[0].inherits = ['C1']; }, 'inherits_not_delegated', 3);
  refused(b => { b.children[0].inherits = ['C7']; }, 'inherits_not_delegated', 3);
  const unused = refused(b => { b.children[2].inherits = []; b.children[0].inherits = []; }, 'delegated_not_inherited', 3);
  assert.equal(unused.id, 'C2', 'a criterion classed delegated that no child inherits is refused naming the missing id');
  // below the root: an ancestor's global obligation (C1 here) cannot be classed root-only or delegated
  const narrowed = refused(b => { b.classes[0].class = 'root-only'; }, 'global_narrowed', 3, { extra: { inheritedGlobal: ['C1'] } });
  assert.equal(narrowed.id, 'C1');
  assert.deepEqual(rules(run(validBlock(), {}, { inheritedGlobal: ['C1'] })), [], 'the same block is valid when the ancestor global is classed global again');
  assert.deepEqual(rules(run((() => { const b = validBlock(); b.classes[0].class = 'root-only'; return b; })())), [], 'at the root the rule has no input');
});

test('PLAN 5.3 check 4: decompose milestones and children map one to one; the number of children is NOT checked', () => {
  const orphan = refused(b => { b.children.pop(); b.children.forEach(k => { k.provides = k.provides.filter(e => e.sibling !== 'K3'); k.expects = k.expects.filter(e => e.sibling !== 'K3'); }); }, 'decompose_without_child', 4);
  assert.equal(orphan.id, 'M3');
  refused(b => { b.children[2].milestone = 'M4'; }, 'child_milestone_not_decompose', 4);     // names a ready milestone
  refused(b => { b.children[2].milestone = 'M5'; }, 'child_milestone_not_decompose', 4);     // names a needs-decision milestone
  refused(b => { b.children[2].milestone = 'M42'; }, 'child_milestone_missing', 4);          // names a missing one
  refused(b => { b.children[2].milestone = 'M2'; }, 'milestone_with_many_children', 4);
});

test('PLAN 5.3 check 5: agreements are complete and symmetric', () => {
  const asym = refused(b => { b.children[1].expects[0].agreements = []; }, 'asymmetric_agreement', 5);
  assert.equal(asym.id, 'A1');
  refused(b => { b.children[0].provides = b.children[0].provides.filter(e => e.sibling !== 'K3'); }, 'sibling_missing', 5);
  refused(b => { b.children[1].expects = b.children[1].expects.filter(e => e.sibling !== 'K1'); }, 'sibling_missing', 5);
  refused(b => { b.children[0].provides.push({ sibling: 'K9', agreements: [] }); }, 'unknown_sibling', 5);
  const noEnd = refused(b => { b.agreements[0].from = 'K9'; }, 'agreement_endpoints', 5);       // an agreement whose `from` names no child
  assert.equal(noEnd.id, 'A1');
  refused(b => { b.agreements[0].to = 'K3'; }, 'agreement_endpoints', 5);
  refused(b => { b.children[0].provides[0].agreements = ['A1', 'A7']; b.children[1].expects[0].agreements = ['A1', 'A7']; }, 'unknown_agreement', 5);
  refused(b => { b.agreements[0].integration_check = ' '; }, 'missing_integration_check', 5);
  refused(b => { b.agreements[0].provider_refs = []; }, 'missing_provider_refs', 5);
  refused(b => { b.children[0].provides[0].agreements = []; }, 'asymmetric_agreement', 5);       // an agreement listed nowhere on the providing side
});

test('PLAN 5.3 check 6: a cycle in the provides/expects graph is refused', () => {
  const f = refused(b => {
    b.agreements.push({ id: 'A2', from: 'K2', to: 'K1', what: 'K2 hands K1 its page list.', provider_refs: ['Web layer pages'], integration_check: 'Compare the page list.' });
    b.children[1].provides[0].agreements = ['A2']; b.children[0].expects[0].agreements = ['A2'];
  }, 'cycle', 6);
  assert.deepEqual(f.path.slice(0, 1), f.path.slice(-1), 'the cycle is named, first node to first node');
  assert.match(f.message, /K1 -> K2 -> K1|K2 -> K1 -> K2/);
});

test('PLAN 5.3 checks 7 and 8: depth and the number of children are not checks; a scope identical to its milestone and an ancestor\'s question are refused', () => {
  // five children and a split at depth 2 are VALID blocks: the limits are applied at admission (PLAN 5.3 checks 4 and 7)
  const b5 = validBlock();
  for (const [id, m] of [['M4', 'K4'], ['M5', 'K5']]) {
    const ms = b5.milestones.find(x => x.id === id); ms.status = 'decompose'; ms.open_question = `What does ${m} do?`;
    b5.children.push({ id: m, milestone: id, scope: `Build ${m}.`, inherits: [], obligations: [], context_refs: [], provides: [], expects: [] });
  }
  for (const k of b5.children) for (const o of b5.children) { if (o.id === k.id) continue; for (const dir of ['provides', 'expects']) if (!k[dir].some(e => e.sibling === o.id)) k[dir].push({ sibling: o.id, agreements: [] }); }
  const five = run(b5);
  assert.deepEqual(rules(five), [], 'five children: a valid block'); assert.equal(five.valid, true);
  const deep = run(validBlock(), {}, { inheritedGlobal: ['C1'], ancestorQuestions: ['Something else entirely?'] });
  assert.equal(deep.valid, true, 'a split at depth 2 (an ancestor above it) is a valid block');
  const withDepth = validBlock(); withDepth.depth = 9; withDepth.size = 'huge'; withDepth.milestones[0].depth = 4;
  assert.equal(run(withDepth).valid, true, 'there is no size or depth field in the schema, so neither decides anything');
  // check 8
  const t = planMilestones(planWith(validBlock())).milestones.find(m => m.id === 'M1');
  assert.equal(refused(b => { b.children[0].scope = t.title; }, 'scope_identical', 8).id, 'K1');            // its milestone's title
  refused(b => { b.children[0].scope = '  Storage   layer\n'; }, 'scope_identical', 8);                      // whitespace normalised
  refused(b => { b.children[0].scope = t.heading; }, 'scope_identical', 8);                                  // its heading line
  refused(b => { b.children[0].scope = t.section; }, 'scope_identical', 8);                                  // its whole section
  assert.equal(run(validBlock()).valid, true, 'a scope that merely mentions the milestone is narrower, not identical');
  const q = refused(() => {}, 'repeated_question', 8, { extra: { ancestorQuestions: ['which   store holds the records?'.replace('which', 'Which')] } });
  assert.equal(q.id, 'M1');
});

test('finding the block: a marked fence inside a longer fence is an example, not a block; ~~~ fences count; CRLF is read; an unmarked fence is not a block; a mention of the marker in prose is not a block', () => {
  const json = JSON.stringify(validBlock());
  assert.equal(extractSplitBlocks(`\`\`\`\`markdown\n\`\`\`${SPLIT_MARKER}\n${json}\n\`\`\`\n\`\`\`\`\n`).length, 0, 'a nested example');
  assert.equal(extractSplitBlocks(`~~~${SPLIT_MARKER}\n${json}\n~~~\n`).length, 1);
  assert.equal(extractSplitBlocks(`\`\`\`${SPLIT_MARKER}\r\n${json}\r\n\`\`\`\r\n`).length, 1);
  assert.equal(extractSplitBlocks(`\`\`\`json\n${json}\n\`\`\`\n`).length, 0);
  assert.equal(extractSplitBlocks(`The fence is marked ${SPLIT_MARKER} in the harness.\n`).length, 0);
  assert.equal(checkSplit({ text: 'No block here.\n\n## Milestones\n\n### M1 - x\n', criteriaIds: CRITERIA }).present, false);
  assert.equal(splitContractOf({ text: 'No block here.', criteriaIds: CRITERIA }), null, 'a plan with no block gets no split_contract field');
});

test('planMilestones reads the same milestone ids as src/milestones.js parseMilestones (one reading of the format)', () => {
  const text = planWith(validBlock());
  assert.deepEqual(planMilestones(text).milestones.map(m => m.id), parseMilestones(text).milestones.map(m => m.id));
  const fenced = `${text}\n\n\`\`\`\n### M77 - an example in a fence\n\`\`\`\n`;
  assert.deepEqual(planMilestones(fenced).milestones.map(m => m.id), ['M1', 'M2', 'M3', 'M4', 'M5']);
});

test('firstDifference names the first field that differs, as a path; key order does not matter', () => {
  const a = validBlock(); const b = validBlock();
  assert.equal(firstDifference(a, b), null);
  assert.equal(firstDifference(a, Object.fromEntries(Object.entries(b).reverse())), null);
  b.children[1].scope = 'Changed.';
  assert.equal(firstDifference(a, b).path, 'children[1].scope');
  const c = validBlock(); c.children[0].inherits.push('C3');
  assert.equal(firstDifference(a, c).path, 'children[0].inherits[1]');
  const d = validBlock(); d.agreements = [];
  assert.equal(firstDifference(a, d).path, 'agreements[0]');
  const e = validBlock(); e.extra = 1;
  assert.equal(firstDifference(a, e).path, 'extra');
});

test('the body of a delivered file is the suffix whose sha256 is delivered_text.body_sha256: harness notes above it (each ends in a --- line) are skipped; a --- inside the body is not a boundary; no match is an error, never the whole file', () => {
  const body = 'Plan body.\n\n---\n\nA rule inside the body.\n\n## Milestones\n';
  const dissent = '## Unresolved dissent\n\n2 objection(s) were still open.\n---\n';
  const cold = '## Cold-reader findings\n\nNone.\n\n---\n';
  const delivered = notes => ({ body_sha256: sha256Of(body), harness_notes: notes });
  assert.deepEqual(bodyOfDelivered(body, delivered([])), { body });
  assert.deepEqual(bodyOfDelivered(dissent + body, delivered(['dissent_block'])), { body });
  assert.deepEqual(bodyOfDelivered(dissent + cold + body, delivered(['dissent_block', 'cold_read_block'])), { body });
  const bad = bodyOfDelivered(dissent + body + 'tampered', delivered(['dissent_block']));
  assert.match(bad.error, /delivered_text\.body_sha256/); assert.equal(bad.body, undefined, 'never a fallback to the whole file');
  assert.match(bodyOfDelivered(body, {}).error, /no delivered_text\.body_sha256/);
  assert.ok(bodyOfDelivered(dissent + body, delivered([])).error, 'with no notes recorded the file must be the body itself');
});

// ================================================================================================================================================================ part 2: PLAN 5.5 on real $0 mock runs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/api.js';
import { defaultAncestorCheck } from '../src/tree-continuation.js';
import { expansionCheck, recordExpansionRefusal, refusalWords, verifySplit } from '../src/tree-expansion.js';
import { EVENTS_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { ROOT_ID, approveFrontier, cli, closedRootTree, lineageFile, newTree, root } from './helpers/tree-fixture.js';

const sha = t => createHash('sha256').update(t).digest('hex');
// the schema every report is checked against (the same validator as test/signed-vs-delivered.test.js)
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')));
const MOCK_DEBATE = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
/** A test-local chain (mock-debate with another handoff seat and the like): chains/ of the repo is untouched. */
const chainWith = (seatOver = {}, extra = {}) => ({ ...MOCK_DEBATE, ...extra, seats: { ...MOCK_DEBATE.seats, ...seatOver } });
const CHAINS = {
  'split-ok': chainWith({ handoff: { provider: 'mock', model: 'mock-handoff-split' } }),
  'split-drift': chainWith({ handoff: { provider: 'mock', model: 'mock-handoff-split-drift' } }),
  'split-cold': chainWith({ handoff: { provider: 'mock', model: 'mock-handoff-split' }, coldRead: { provider: 'mock', model: 'mock-cold-read-yes', lab: 'cold' } }, { coldRead: { enabled: true } }),
  'split-final': chainWith({ handoff: { provider: 'mock', model: 'mock-handoff-split' }, finalist: { provider: 'mock', model: 'mock-finalist' } }),
};

/** A tree whose root chain is `chain`; the root registered, its plan handed in as a draft, run to the end through the library (a real $0 mock run). */
async function rootRun(chain = 'split-ok', planText = plan3(), { cap = 50 } = {}) {
  const t = newTree({ cap, rootChain: chain, extraChains: { [chain]: CHAINS[chain] } });
  registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'plan.md'), planText);
  const res = await api.run({ chain, task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), draft: 'plan.md', rounds: 1 });
  assert.equal(res.exitCode, 0, res.outputTail);
  const runDir = join(t.runsDir, ROOT_ID);
  return { t, runDir, report: () => JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')), work: t.work, node: { node: 'R', generation: 1, runId: ROOT_ID, runDir, work: t.work, inheritedGlobal: [], ancestorQuestions: [] } };
}
const events = rootDir => readTreeRecord(rootDir).events;
const contractExit = (t, runDir) => spawnSync(process.execPath, [cli, 'contract', 'check', runDir], { cwd: t.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: t.work } }).status;

test('a real $0 run whose plan carries a valid block records split_contract (never changing passed); PLAN 5.5 items 1-4 hold; verifySplit writes split_verified naming the block\'s sha256 and creates no folder', async () => {
  const r = await rootRun();
  const report = r.report();
  assert.equal(report.passed, true);
  assert.deepEqual([report.split_contract.valid, report.split_contract.findings], [true, []]);
  assert.equal(report.split_contract.sha256, splitSha256(block3()));
  assert.equal(validate(report), true, `a real report with split_contract (no findings) validates: ${JSON.stringify(validate.errors)}`);
  assert.equal(contractExit(r.t, r.runDir), 0);
  const check = expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.equal(check.refusal, null, check.refusal && refusalWords(check.refusal));
  assert.equal(check.sha256, report.split_contract.sha256);
  assert.equal(defaultAncestorCheck(r.runDir, { work: r.work }), null, 'the ancestor check (items 1-3) passes: PLAN 7.6 step 2');
  const before = readdirSync(r.t.runsDir);
  const v = verifySplit(r.t.rootDir, r.node);
  assert.equal(v.refusal, null);
  const ev = events(r.t.rootDir).at(-1);
  assert.deepEqual([ev.event, ev.node, ev.runId, ev.splitSha256], ['split_verified', 'R', ROOT_ID, report.split_contract.sha256]);
  assert.deepEqual(readdirSync(r.t.runsDir), before, 'no child folder');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).active, null, 'a record, not a transition');
});

test('PLAN 5.3: a plan with no split block records `blocked: no split` and creates no child folder; a decompose milestone repeating an ancestor\'s question records `blocked: repeated question`', async () => {
  const none = await rootRun('split-ok', plan3(block3(), { noFence: true }));
  assert.equal(none.report().split_contract, undefined, 'no block: no split_contract field');
  const runsBefore = readdirSync(none.t.runsDir); const reportBytes = readFileSync(join(none.runDir, 'report.json'), 'utf8');
  const v = verifySplit(none.t.rootDir, none.node);
  assert.deepEqual([v.refusal.item, v.refusal.check], [3, 'no_split']);
  const ev = events(none.t.rootDir).at(-1);
  assert.deepEqual([ev.event, ev.reason, ev.check, ev.scope], ['blocked', 'expansion_refused', 'no_split', 'R@g1']);
  assert.deepEqual(readdirSync(none.t.runsDir), runsBefore, 'no child folder');
  assert.equal(readFileSync(join(none.runDir, 'report.json'), 'utf8'), reportBytes, 'report.json (and so `passed`) is untouched');
  assert.equal(stateOf(readTreeRecord(none.t.rootDir)).sticky.size, 0, 'a record only: it does not block the tree');
  // a repeated question: the child plan's decompose milestone asks what an ancestor asked
  const rep = await rootRun();
  const v2 = verifySplit(rep.t.rootDir, { ...rep.node, ancestorQuestions: ['which   store holds the records?'.replace('which', 'Which')] });
  assert.deepEqual([v2.refusal.item, v2.refusal.check], [4, 'repeated_question']);
  const ev2 = events(rep.t.rootDir).at(-1);
  assert.deepEqual([ev2.event, ev2.reason, ev2.check], ['blocked', 'expansion_refused', 'repeated_question']);
});

test('the handoff reproduced a different scope: expansion is refused naming the field (children[1].scope), no child folder, `passed` untouched; the contract check alone is 0 (it is not the panel\'s approval)', async () => {
  const r = await rootRun('split-drift');
  assert.equal(r.report().passed, true);
  assert.equal(contractExit(r.t, r.runDir), 0, 'the files are what the run wrote');
  const runsBefore = readdirSync(r.t.runsDir);
  const check = expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.deepEqual([check.refusal.item, check.refusal.check, check.refusal.field], [3, 'handoff_differs', 'children[1].scope']);
  assert.match(check.refusal.detail, /children\[1\]\.scope/);
  assert.match(defaultAncestorCheck(r.runDir, { work: r.work }), /PLAN 5\.5 item 3 \(handoff_differs\): children\[1\]\.scope/, 'an ancestor whose handoff drifted fails the child\'s start check too (the M2 gap, closed)');
  verifySplit(r.t.rootDir, r.node);
  const ev = events(r.t.rootDir).at(-1);
  assert.deepEqual([ev.event, ev.reason, ev.check], ['blocked', 'expansion_refused', 'handoff_differs']);
  assert.match(ev.detail, /children\[1\]\.scope/);
  assert.deepEqual(readdirSync(r.t.runsDir), runsBefore); assert.equal(r.report().passed, true);
});

test('a handoff that does not reproduce the block at all is refused (the default mock handoff ignores its prompt, as it always did): no HANDOFF copy, nothing to compare', async () => {
  const t = newTree({ cap: 50, rootChain: 'mock-debate' });
  registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'plan.md'), plan3());
  const res = await api.run({ chain: 'mock-debate', task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), draft: 'plan.md', rounds: 1 });
  assert.equal(res.exitCode, 0, res.outputTail);
  const runDir = join(t.runsDir, ROOT_ID);
  const handoff = readFileSync(join(runDir, 'HANDOFF.md'), 'utf8');
  assert.match(handoff, /MOCK HANDOFF\n\nRead the plan\. Start with "begin"\./, 'the default mock handoff reply is unchanged by the two new models');
  assert.equal(handoff.includes(SPLIT_MARKER), false);
  const check = expansionCheck({ runDir, work: t.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.deepEqual([check.refusal.item, check.refusal.check, check.refusal.field], [3, 'handoff_block', 'HANDOFF.md']);
});

test('`contract check` exits 0 on an untouched run and 1 after deliverable.md is edited, and expansion is refused at item 2', async () => {
  const r = await rootRun();
  assert.equal(contractExit(r.t, r.runDir), 0);
  assert.equal(expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal, null);
  writeFileSync(join(r.runDir, 'deliverable.md'), `${readFileSync(join(r.runDir, 'deliverable.md'), 'utf8')}\nAn edit after the run.\n`);
  assert.equal(contractExit(r.t, r.runDir), 1);
  const check = expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.deepEqual([check.refusal.item, check.refusal.check], [2, 'contract_check']);
  assert.match(check.refusal.detail, /exits 1 \(drift\)/);
  assert.match(defaultAncestorCheck(r.runDir, { work: r.work }), /PLAN 5\.5 item 2/);
});

test('three runs whose `contract check` exits 0 are still refused, each naming its field: passed:false (a real run); signed_text.signed_off:false (report.json edited by hand: a real run cannot have it with passed true); delivered_text.same_as_signed:false with changed_by [final_edit] (a real final edit) (a contract check alone is never the panel\'s approval)', async () => {
  const edit = (r, fn) => { const rep = r.report(); fn(rep); writeFileSync(join(r.runDir, 'report.json'), JSON.stringify(rep)); };
  const a = await rootRun('split-ok', plan3(block3(), { preface: '' }));      // a REAL run the panel did not pass: its draft lacks the line the mock critics sign
  assert.equal(a.report().passed, false);
  assert.equal(contractExit(a.t, a.runDir), 0, 'passed is not part of the sealed record');
  assert.deepEqual([expansionCheck({ runDir: a.runDir, work: a.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.check, expansionCheck({ runDir: a.runDir, work: a.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.field], ['panel_passed', 'passed']);
  // the order is the plan's: a run that fails item 1 AND item 2 is refused at item 1
  writeFileSync(join(a.runDir, 'deliverable.md'), `${readFileSync(join(a.runDir, 'deliverable.md'), 'utf8')}\nEdited after the run.\n`);
  assert.equal(contractExit(a.t, a.runDir), 1, 'now the files drifted too');
  assert.deepEqual([expansionCheck({ runDir: a.runDir, work: a.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.item, expansionCheck({ runDir: a.runDir, work: a.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.check], [1, 'panel_passed'], 'items are checked in order: item 1 is reported first');
  const b = await rootRun();
  edit(b, rep => { rep.signed_text.signed_off = false; });
  assert.equal(contractExit(b.t, b.runDir), 0);
  assert.deepEqual([expansionCheck({ runDir: b.runDir, work: b.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.check, expansionCheck({ runDir: b.runDir, work: b.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.field], ['signed_off', 'signed_text.signed_off']);
  const c = await rootRun('split-final');
  assert.deepEqual([c.report().delivered_text.same_as_signed, c.report().delivered_text.changed_by], [false, ['final_edit']], 'a real final edit changed the body after the sign-off');
  assert.equal(contractExit(c.t, c.runDir), 0, 'the files are what the run wrote');
  const rc = expansionCheck({ runDir: c.runDir, work: c.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal;
  assert.deepEqual([rc.item, rc.check, rc.field], [1, 'delivered_is_signed', 'delivered_text.same_as_signed']);
  assert.match(rc.detail, /final_edit/);
  const d = await rootRun();
  edit(d, rep => { rep.handoff_text.made_from_signed = false; });
  assert.equal(expansionCheck({ runDir: d.runDir, work: d.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal.field, 'handoff_text.made_from_signed');
});

test('a harness note above the body (the cold-reader block): the block is read from the BODY of deliverable.md (found by delivered_text.body_sha256); but item 1 refuses such a run, because the 0.8.2 label made_from_signed is false when the handoff also saw a note', async () => {
  const r = await rootRun('split-cold');
  const report = r.report();
  assert.deepEqual(report.delivered_text.harness_notes, ['cold_read_block']);
  assert.equal(report.delivered_text.same_as_signed, true, 'a note above an unchanged body is a note, not a change');
  const file = readFileSync(join(r.runDir, 'deliverable.md'), 'utf8');
  assert.ok(file.startsWith('## Cold'), 'the note sits above the body');
  assert.notEqual(sha(file), report.delivered_text.body_sha256);
  assert.equal(report.split_contract.valid, true, 'the report field is read from the body too');
  assert.equal(contractExit(r.t, r.runDir), 0);
  // FINDING (reported to C&C): the handoff is made from the delivered text, note included, so its hash is not the signed text's and `handoff_text.made_from_signed` is false (src/text-labels.js). Read literally, PLAN 5.5 item 1
  // therefore refuses any run with a harness note above its body, naming that field. Fail closed, as built; no shipped chain enables the cold reader.
  assert.equal(report.handoff_text.made_from_signed, false);
  const first = expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal;
  assert.deepEqual([first.item, first.check, first.field], [1, 'handoff_from_signed', 'handoff_text.made_from_signed']);
  assert.match(first.detail, /harness note \(cold_read_block\) sits above the plan's body/, 'the refusal says why in plain words');
  assert.match(first.detail, /does not expand in 0\.8\.3/);
  // Items 2-4 do not depend on that: with the one label set as if the handoff had been made from the signed body, the comparison reads both blocks past the note and passes
  const rep = r.report(); rep.handoff_text.made_from_signed = true;
  writeFileSync(join(r.runDir, 'report.json'), JSON.stringify(rep));
  assert.equal(contractExit(r.t, r.runDir), 0);
  const check = expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [] });
  assert.equal(check.refusal, null, check.refusal && refusalWords(check.refusal));
  assert.equal(check.sha256, splitSha256(block3()));
  // and a body that no suffix of the file matches is refused naming body_sha256, never read as the whole file
  rep.delivered_text.body_sha256 = 'f'.repeat(64);
  writeFileSync(join(r.runDir, 'report.json'), JSON.stringify(rep));
  const bad = expansionCheck({ runDir: r.runDir, work: r.work, upTo: 3 }).refusal;
  assert.deepEqual([bad.item, bad.check, bad.field], [3, 'body_block', 'delivered_text.body_sha256']);
});

test('PLAN 5.5 item 4: with a frontier key, its approval must exist, be valid and be for THIS split; an invalid split is refused naming the rule and a missing field', async () => {
  const r = await rootRun();
  const sha3 = splitSha256(block3());
  const ask = (key, frontiers) => expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [], ancestorQuestions: [], frontierKey: key, frontier: key ? frontiers.get(key) : null });
  const noApproval = ask('a'.repeat(64), new Map());
  assert.deepEqual([noApproval.refusal.item, noApproval.refusal.check], [4, 'approval']);
  const wrong = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2', 'R/M3']);                   // previewed for the fixture's made-up split hash
  const state = stateOf(readTreeRecord(r.t.rootDir));
  const refusedWrong = ask(wrong, state.frontiers).refusal;
  assert.deepEqual([refusedWrong.check, refusedWrong.field], ['approval', 'splitSha256']);
  const right = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2', 'R/M3'], { split: sha3 });
  assert.equal(ask(right, stateOf(readTreeRecord(r.t.rootDir)).frontiers).refusal, null, 'an approved frontier for this split passes item 4');
  const hashed = approveFrontier(r.t.rootDir, ['R/M1', 'R/M2'], { split: sha3, hash: 'c'.repeat(64), approvalHash: 'd'.repeat(64) });   // approval bound a different hash
  const refusedHash = ask(hashed, stateOf(readTreeRecord(r.t.rootDir)).frontiers).refusal;
  assert.deepEqual([refusedHash.check, refusedHash.field], ['approval', 'frontier_approved']);
  // a block that parses but breaks a rule is refused at item 4 (the handoff reproduced it faithfully)
  const broken = block3(); broken.agreements[0].integration_check = '';
  const bad = await rootRun('split-ok', plan3(broken));
  assert.equal(bad.report().split_contract.valid, false);
  assert.equal(bad.report().split_contract.findings[0].rule, 'missing_integration_check');
  assert.equal(validate(bad.report()), true, `a real report whose split_contract has a finding validates (check, rule and message are all present): ${JSON.stringify(validate.errors)}`);
  assert.deepEqual(Object.keys(bad.report().split_contract.findings[0]).sort(), ['check', 'message', 'rule']);
  assert.equal(bad.report().passed, true, 'split_contract never changes passed');
  const refusedBad = expansionCheck({ runDir: bad.runDir, work: bad.work, inheritedGlobal: [], ancestorQuestions: [] }).refusal;
  assert.deepEqual([refusedBad.item, refusedBad.check, refusedBad.field], [4, 'split_invalid', 'missing_integration_check']);
  assert.equal(defaultAncestorCheck(bad.runDir, { work: bad.work }), null, 'an ancestor needs items 1-3 only: the block is still the signed block');
});

test('the transition table takes split_verified for a registered node only, and the fold keeps the split a frontier was previewed for', async () => {
  const t = closedRootTree({ cap: 10 });
  appendTreeEvent(t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: 'a'.repeat(64), children: ['R/M1'] });   // `children` (S8 held state): the paths the verified block names (the frontier approved below is R/M1)
  assert.throws(() => appendTreeEvent(t.rootDir, { event: 'split_verified', node: 'R/M1', generation: 1, runId: 'x', splitSha256: 'a'.repeat(64), children: ['R/M1/M1'] }), /not registered/);
  const key = approveFrontier(t.rootDir, ['R/M1'], { split: 'e'.repeat(64) });
  assert.equal(stateOf(readTreeRecord(t.rootDir)).frontiers.get(key).splitSha256, 'e'.repeat(64));
  assert.equal(typeof recordExpansionRefusal, 'function');
});

test('an EXPANSION never runs PLAN 5.3 checks 3 and 8 by silence: expansionCheck at item 4 throws without inheritedGlobal and ancestorQuestions (C&C, M3 PASS), while an ancestor check (items 1-3) needs neither', async () => {
  const r = await rootRun();
  assert.throws(() => expansionCheck({ runDir: r.runDir, work: r.work }), /inheritedGlobal is required for an expansion/);
  assert.throws(() => expansionCheck({ runDir: r.runDir, work: r.work, inheritedGlobal: [] }), /ancestorQuestions is required for an expansion/);
  assert.throws(() => verifySplit(r.t.rootDir, { ...r.node, ancestorQuestions: undefined }), /ancestorQuestions is required/);
  assert.equal(expansionCheck({ runDir: r.runDir, work: r.work, upTo: 3 }).refusal, null, 'items 1-3 need neither');
  assert.equal(defaultAncestorCheck(r.runDir, { work: r.work }), null);
});

// ---------------------------------------------------------------------------------------------------------------------- M5f (a) (the maintainer's ruling, M5c go): ONE verified split per node@generation
test('(a) the record holds ONE verified split per node@generation: the table refuses a second (the same sha too); verifySplit on the same block returns the EXISTING record (one event, the same return value); on another block it refuses and writes a blocked record with check split_changed', async () => {
  const r = await rootRun();
  const first = verifySplit(r.t.rootDir, r.node);
  assert.equal(first.refusal, null);
  const n = events(r.t.rootDir).length;
  const again = verifySplit(r.t.rootDir, r.node);
  assert.deepEqual([again.refusal, again.sha256], [null, first.sha256]); assert.deepEqual(again.event, first.event, 'the existing record, not a new one');
  assert.equal(events(r.t.rootDir).length, n, 'no second event');
  for (const splitSha256 of [first.sha256, 'c'.repeat(64)]) {
    assert.throws(() => appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256, children: first.event.children }), /R@g1 already has a verified split[^]*never holds two/);
  }
  const refused = events(r.t.rootDir).slice(n);
  assert.deepEqual(refused.map(e => [e.event, e.reason]), [['blocked', 'transition_refused'], ['blocked', 'transition_refused']], 'a refused transition is a blocked record, never a second split_verified');
  // another block: the record is made to name a different sha (a hand-edited record; the plan itself is guarded by `contract check` first), so the check finds the plan unlike the record
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').map(l => (l.includes('"event":"split_verified"') ? l.replace(/"splitSha256":"[0-9a-f]{64}"/, `"splitSha256":"${'d'.repeat(64)}"`) : l)).join('\n'));
  const before = events(r.t.rootDir).length;
  const other = verifySplit(r.t.rootDir, r.node);
  assert.deepEqual([other.refusal.item, other.refusal.check, other.refusal.field], [4, 'split_changed', 'splitSha256'], JSON.stringify(other.refusal));
  assert.match(other.refusal.detail, /R@g1 was verified with split d{12}[^]*the first verification stands/);
  const added = events(r.t.rootDir).slice(before);
  assert.deepEqual(added.map(e => [e.event, e.reason, e.check, e.scope]), [['blocked', 'expansion_refused', 'split_changed', 'R@g1']]);
  assert.equal(events(r.t.rootDir).filter(e => e.event === 'split_verified').length, 1, 'still exactly one verified split');
});
