// 0.8.4 lane A wiring: the six call-site slots that were never wired (H2-q/r, H2-g/h, H1-e/H2-n, H7, H2-f). Each row injects ONLY that slot's held words (test/helpers/held-names-preload.js for a spawned command,
// setHeldForTest in process), runs the real verb (or runChain), and reads what the run wrote. The words stay held in src/roles.js, so a row with the words recorded is the apply's behaviour and a row with them
// unrecorded is today's. A control (key off, words off, test fenced) shows the slot is a gate, not an unconditional edit. No new sentence: every text read here is a name of test/held-prompts/held-084-a.js.
// Offline, $0. Spawned rows need no key; the tree row runs a real member through the real command.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { disputeSystemFor, systemTextsFor } from '../src/stage-system.js';
import { askedForOfNeeds } from '../src/answered-by.js';
import { verifiedSystemOfNeeds } from '../src/stage-instructions.js';
import { apiStarter, runTree } from '../src/tree-run.js';
import * as R from '../src/roles.js';
import { renderSummaryBlock, summaryRecordOf } from '../src/summary-block.js';
import * as H from './held-prompts/held-084-a.js';
import { DEMAND } from './helpers/rating-demand.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { externalChildren } from './helpers/child-chains.js';
import { approvePending } from './helpers/sitting.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-names-preload.js');
afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });

const RUN = '2026-09-29T09-00-00-000Z';
const CRITERIA = ['The plan names a data store.', 'The plan lists the API routes.', 'No section contradicts another.'];
const PLAN = "# Plan\n\n## 2. Reading\n\nThe module caches by path [UNVERIFIED: settle by reading _get_module_details in the interpreter's runpy module].\n\n## 3. Risks\n\nThe cache may be stale [UNVERIFIED: check the cache_ttl setting in src/cache.js].\n";
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
// CHANGED ACCEPTED (old bar: no delivered_text in the fixture's report.json): the gap check now reads the plan's BODY, which the report's delivered_text record finds (src/tree-split.js bodyOfDelivered), so the finished-run fixture carries the record a real run writes.
const recordOf = (body, notes = []) => ({ body_sha256: sha256(body), harness_notes: notes });
const REPORT = JSON.stringify({ passed: true, criteria: CRITERIA, thin_contract: { sha256: 'a'.repeat(64) }, delivered_text: recordOf(PLAN) });
const TASK_PLAIN = 'Plan a small reading list app.\n';
const TASK_WITH_TEST = 'Plan a small reading list app. The test it must pass is fenced below.\n\n```js\n// test/items.test.js\nimport assert from \'node:assert\';\nassert.ok(true);\n```\n';
const ONE_SHOT_HARNESS = ['oneShotItemOneClosing', 'oneShotReplanLead', 'oneShotAssumptionsReport'];
const BLOCKERS_TODAY = 'Send the blockers back to the person who owns the plan.';

const chainOf = (handoffModel, extra = {}) => ({
  name: 'wire', description: 'test', maxRounds: 2, stopOnPass: true, handoff: true,
  estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, handoff: { provider: 'mock', model: handoffModel }, critics: [{ provider: 'mock', model: 'mock-critic-passer', lab: 'a' }] },
  ...extra,
});
// A workspace with the task and the chain; `files` (when given) also makes the finished-run folder a `handoff --from-run` reads.
function workspace({ handoffModel = 'mock-builder', chainExtra = {}, files = null, task = TASK_PLAIN, chainJson = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-wire-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'plans'));
  writeFileSync(join(dir, 'tasks', 't.md'), task);
  writeFileSync(join(dir, 'plans', 'plan.md'), PLAN);
  writeFileSync(join(dir, 'chains', 'wire.json'), JSON.stringify(chainJson ?? chainOf(handoffModel, chainExtra)));
  if (files) {
    mkdirSync(join(dir, 'runs', RUN), { recursive: true });
    writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'wire', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'runs', RUN, name), text);
  }
  return dir;
}
const cmd = (dir, args, names = [], env = {}) => spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, HOME: dir, THC_HELD_NAMES: names.join(','), ...env } });
const read = (dir, run, name) => { const p = join(dir, 'runs', run, name); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
const FROM_RUN = ['handoff', '--from-run', join('runs', RUN)];
const withDir = (opts, fn) => { const dir = workspace(opts); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
// `handoff --from-run` on the finished-run folder: the HANDOFF.md it wrote, the WARNINGS.md beside it.
const fromRun = (opts, names) => withDir({ files: { 'deliverable.md': PLAN, 'report.json': REPORT }, ...opts }, dir => {
  const r = cmd(dir, FROM_RUN, names);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { handoff: read(dir, RUN, 'HANDOFF.md'), warnings: read(dir, RUN, 'WARNINGS.md'), out: r.stdout };
});
// A whole run of the chain (`--draft` hands it the plan, so the passer signs it off in round 1): the HANDOFF.md, WARNINGS.md and report.json of the run folder.
const wholeRun = (opts, names, extraArgs = []) => withDir(opts, dir => {
  const r = cmd(dir, ['--chain', 'wire', '--task', 'tasks/t.md', ...extraArgs], names);
  // CHANGED ACCEPTED (old bar: exit 0). mock-critic-passer states no verdict in this chain, so the run ends with exit 22 ("stopped with open failures"; the box run of the first version of this row and the probe's base side both showed it). The handoff is still written for a run that did not agree, and none of the slots read here depends on agreement, so the bar is the exit the fixture is known to give. Any other exit is a broken fixture.
  assert.equal(r.status, 22, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.ok(existsSync(join(dir, 'runs')), 'the run wrote a run folder');
  const id = readdirSync(join(dir, 'runs'))[0];
  const rp = read(dir, id, 'report.json');
  return { handoff: read(dir, id, 'HANDOFF.md'), warnings: read(dir, id, 'WARNINGS.md'), deliverable: read(dir, id, 'deliverable.md'), report: rp ? JSON.parse(rp) : null };
});

// ---- H2-q / H2-r: builder_kind reaches both builderSection callers ----
test('H2-q: `handoff --from-run` on a chain with builder_kind "one_shot" writes the harness half\'s one-shot words; the key off writes today\'s text', () => {
  const on = fromRun({ chainExtra: { builder_kind: 'one_shot' } }, ONE_SHOT_HARNESS);
  for (const n of ONE_SHOT_HARNESS) assert.ok(on.handoff.includes(H[n]()), `${n} reaches HANDOFF.md`);
  assert.ok(!on.handoff.includes(BLOCKERS_TODAY), 'the "send the blockers back" sentence is replaced, not kept beside the one-shot words');
  const noKey = fromRun({}, ONE_SHOT_HARNESS);
  assert.ok(noKey.handoff.includes('## Before you build') && noKey.handoff.includes(BLOCKERS_TODAY), 'a chain without the key: today\'s section');
  assert.ok(!noKey.handoff.includes(H.oneShotAssumptionsReport()));
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: this row, and the H2-h, H2-g, H2-n, H1-e, H7 and H2-f rows below, also ran the slot with its words UNRECORDED and read today's text. NEW: those held halves are REMOVED (K7): the oneShot*, verifyFirstParagraph, handoffNoTestsLine, disputedMarkSentence and externalStageParagraph words are recorded in every shipped run. Sibling at each: the 'on' half of the same test (the words reach the file); the key-off and fenced-test controls, which are the person's own settings, stay. WHY: the lane A words recorded (src/prompts/recorded-084-a.js and the other recorded-084 files).
});

test('H2-r: a whole run of a chain with builder_kind "one_shot" writes the same one-shot words into its own HANDOFF.md; the key off writes today\'s text', () => {
  const on = wholeRun({ chainExtra: { builder_kind: 'one_shot' } }, ONE_SHOT_HARNESS);
  for (const n of ONE_SHOT_HARNESS) assert.ok(on.handoff.includes(H[n]()), `${n} reaches HANDOFF.md`);
  assert.ok(!on.handoff.includes(BLOCKERS_TODAY));
  const off = wholeRun({}, ONE_SHOT_HARNESS);
  assert.ok(off.handoff.includes('## Before you build') && off.handoff.includes(BLOCKERS_TODAY));
  assert.ok(!off.handoff.includes(H.oneShotAssumptionsReport()));
});

// ---- H2-g / H2-h: the plan reaches both lintMilestones callers ----
const MS = { handoffModel: 'mock-handoff-milestones', chainExtra: { handoff_contract: { milestones: true } } };   // the mock reply has milestones that discharge C1-C3 and no "Verify first" section
const GAP_1 = /handoff_milestones: verify_first_missing: section 2 of the plan rests on 'The module caches by path\.', which the plan marks UNVERIFIED, and the 'Verify first' section does not name it\./;
const GAP_2 = /handoff_milestones: verify_first_missing: section 3 of the plan rests on 'The cache may be stale\.'/;
test('H2-h: `handoff --from-run` on a milestone chain finds the UNVERIFIED claims the handoff does not name: one gap each in WARNINGS.md and the Before-you-build list', () => {
  const on = fromRun(MS, ['verifyFirstParagraph']);
  assert.match(on.warnings, GAP_1); assert.match(on.warnings, GAP_2);
  assert.match(on.handoff, /Gaps the harness found in this handoff's milestones[\s\S]*verify_first_missing: section 2 of the plan rests on/);
  assert.match(on.out, /handoff milestones: \d+ gap\(s\) \([^)]*verify_first_missing/);
});

test('H2-g: a whole run on a milestone chain finds the same gaps: report.json, WARNINGS.md and HANDOFF.md carry them', () => {
  const on = wholeRun(MS, ['verifyFirstParagraph'], ['--draft', 'plans/plan.md']);
  assert.match(on.warnings, GAP_1); assert.match(on.warnings, GAP_2);
  assert.deepEqual(on.report.handoff_milestones.findings.filter(f => f.kind === 'verify_first_missing').length, 2);
  assert.match(on.handoff, /Gaps the harness found in this handoff's milestones[\s\S]*verify_first_missing: section 2 of the plan rests on/);
});

// ---- FINDING 2 (C&C's ruling): the gap check reads the plan's own BODY, never the harness notes above it ----
const NOTE_MARKER = '[UNVERIFIED: read src/queue.js to settle it]';
const NOTE_ABOVE = `### It states the assumptions it was written under.\n*Raised by a lab, never resolved.*\n\nThe queue drops jobs on restart ${NOTE_MARKER}.\n\n---\n`;   // a harness note: model-quoted text, ended by a --- line like the dissent block
const reportOf = delivered => JSON.stringify({ passed: true, criteria: CRITERIA, thin_contract: { sha256: 'a'.repeat(64) }, ...(delivered ? { delivered_text: delivered } : {}) });
test('F2, --from-run: a harness note above the body that quotes an UNVERIFIED marker the body lacks gives no gap; the body\'s own two markers still do', () => {
  const on = fromRun({ ...MS, files: { 'deliverable.md': NOTE_ABOVE + PLAN, 'report.json': reportOf(recordOf(PLAN, ['dissent_block'])) } }, ['verifyFirstParagraph']);
  assert.match(on.warnings, GAP_1); assert.match(on.warnings, GAP_2);
  assert.doesNotMatch(on.warnings, /queue drops jobs/, 'the note\'s marker is not the plan\'s claim');
  assert.equal(on.warnings.match(/verify_first_missing/g).length, 2);
});
test('F2 limit, --from-run: a deliverable the report cannot separate (no delivered_text record) passes no plan, so the gap check is off for it', () => {
  const off = fromRun({ ...MS, files: { 'deliverable.md': NOTE_ABOVE + PLAN, 'report.json': reportOf(null) } }, ['verifyFirstParagraph']);
  assert.doesNotMatch(off.warnings, /verify_first_missing/);
});
// C&C's question (11 Nov): after the apply every delivered plan can carry the handling session's summary block on top of deliverable.md (`council summary-add`: report.json delivered_text.summary_block). pickDraft strips it by that record, and delivered_text.body_sha256 is not changed by the block,
// so the body is still found. The summary-block behaviour needed no fix, so this is a PIN. Its note-above case is red on fdc4fd21 for the Finding 2 reason (the old plan was the whole text, note included: three gaps); its no-note case passes there and has no red short of a deliberate breakage (pin only).
test('F2, --from-run after `council summary-add`: the summary block on top of deliverable.md does not hide the body (the same two gaps, with a note above the body and without one)', () => {
  const summary = 'The plan reads a cache by path.';
  const block = renderSummaryBlock({ text: summary, headline: 'The run ended without agreement.' });
  for (const [label, above, notes] of [['a note above the body', NOTE_ABOVE, ['dissent_block']], ['no note above the body', '', []]]) {
    const delivered = { ...recordOf(PLAN, notes), summary_block: summaryRecordOf(block, summary, '2026-11-11T00:00:00.000Z') };
    const on = fromRun({ ...MS, files: { 'deliverable.md': block + above + PLAN, 'report.json': reportOf(delivered) } }, ['verifyFirstParagraph']);
    assert.match(on.warnings, GAP_1, label); assert.match(on.warnings, GAP_2, label);
    assert.doesNotMatch(on.warnings, /queue drops jobs/, label);
    assert.equal(on.warnings.match(/verify_first_missing/g).length, 2, label);
  }
});
const disputeChain = () => {
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-dispute.json'), 'utf8'));
  return { ...base, name: 'wire', handoff: true, handoff_contract: { milestones: true }, seats: { ...base.seats, handoff: { provider: 'mock', model: 'mock-handoff-milestones' }, critics: base.seats.critics.map(c => (c.model === 'mock-critic-holdout' ? { ...c, model: 'mock-critic-holdout-marker' } : c)) } };
};
test('F2, a whole run that ends not agreed: the dissent block above the body quotes an UNVERIFIED marker the body lacks, and the gap check reports nothing for it', () => {
  const on = wholeRun({ chainJson: disputeChain() }, ['verifyFirstParagraph']);
  assert.ok(on.deliverable.includes(NOTE_MARKER), 'premise: the delivered file carries the marker above the body');
  assert.ok(on.report.delivered_text.harness_notes.includes('dissent_block'), 'premise: the record says a note sits above the body');
  assert.doesNotMatch(on.warnings, /verify_first_missing/);
  assert.equal(on.report.handoff_milestones.findings.some(f => f.kind === 'verify_first_missing'), false);
});

// ---- H1-e / H2-n: withNoTestsLine at both render sites ----
test('H2-n: `handoff --from-run` ends the seat\'s text with the no-test-file line when no fenced block of the task is a test file, and adds nothing when one is', () => {
  const LINE = H.handoffNoTestsLine();
  assert.ok(fromRun({}, ['handoffNoTestsLine']).handoff.includes(LINE), 'no fenced block: the line is in HANDOFF.md');
  assert.ok(!fromRun({ task: TASK_WITH_TEST }, ['handoffNoTestsLine']).handoff.includes(LINE), 'a fenced test file: no line');
});

const chainHandoff = async (request, names) => {
  setHeldForTest(Object.fromEntries(names.map(n => [n, H[n]])));
  const result = await runChain({ request, log: () => {}, runId: 'r-wire', config: chainOf('mock-builder') });
  return result.handoff;
};
test('H1-e: the run\'s handoff stage (src/chain.js) adds the same line to the handoff text it returns: one copy, only when no fenced block is a test file', async () => {
  const LINE = H.handoffNoTestsLine();
  const on = await chainHandoff(TASK_PLAIN, ['handoffNoTestsLine']);
  assert.equal(on.split(LINE).length - 1, 1, 'exactly once');
  assert.ok(!(await chainHandoff(TASK_WITH_TEST, ['handoffNoTestsLine'])).includes(LINE), 'a fenced test file: no line');
});

// ---- H7: the DISPUTED sentence reaches the dispute pass (the call and the estimator's row) ----
test('H7: disputeSystemFor puts the sentence right after "Never delete a disputed claim silently." once, with and without the rating demand, and the estimator prices the same text', () => {
  const S = H.disputedMarkSentence(); const ANCHOR = 'Never delete a disputed claim silently.';
  const layered = { signoff: 'unanimous', seats: { critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a', layer: 1 }, { provider: 'mock', model: 'mock-critic-b', lab: 'b', layer: 2 }] } };
  setHeldForTest({ disputedMarkSentence: H.disputedMarkSentence });
  const plain = disputeSystemFor({});
  assert.ok(plain.includes(`${ANCHOR} ${S}`)); assert.equal(plain.split(S).length - 1, 1);
  assert.equal(plain.replace(` ${S}`, ''), R.DISPUTE_SYSTEM, 'nothing else moved');
  setHeldForTest({ disputedMarkSentence: H.disputedMarkSentence, ...DEMAND });
  const rated = disputeSystemFor(layered);
  assert.ok(rated.includes(`${ANCHOR} ${S}`) && rated.includes(R.SEVERITY_WRITER_SENTENCE), 'the rating demand and the final read edits still find their spans');
  assert.ok(systemTextsFor('dispute', layered).every(t => t.includes(S)), 'the estimator\'s dispute row is the same text');
});

test('H7 through the real command: the prompt the dispute seat is sent carries the sentence (the mock-dispute chain reaches the dispute stage)', () => {
  const sentFor = names => withDir({}, dir => {
    const log = join(dir, 'prompts.jsonl');
    cmd(dir, ['--chain', 'mock-dispute', '--task', 'tasks/t.md'], names, { THC_PROMPT_LOG: log });
    const rows = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    return rows.filter(row => row.label === 'dispute');
  });
  const on = sentFor(['disputedMarkSentence']);
  assert.ok(on.length >= 1, 'the dispute stage ran');
  assert.ok(on.every(row => row.system.includes(`Never delete a disputed claim silently. ${H.disputedMarkSentence()}`)));
});

// ---- H2-f: the paragraph above "## System prompt" of every NEEDS-<stage>.md ----
const PARAGRAPH = H.externalStageParagraph();
// CHANGED ACCEPTED TEST (0.8.4, the twelve unowned tip reds, row R04). OLD (cd950020): the builder seat of chains/mock-external.json "asks for claude-code-session": `askedForOfNeeds(needs) === 'claude-code-session'`. NEW: that seat is the session seat and its NEEDS file carries NO asked-for line, with the paragraph on and off alike; the reader finds nothing. A second leg seats a builder WITH a model (a copy of the same chain, builder model subscription:opus-5.5): its NEEDS file carries the line "This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model." and the reader returns that model, with the paragraph on and off alike. WHY: askedForSentence (src/answered-by.js) says nothing for the session seat (NO_MODEL_SEAT, since 0.8.3), so the OLD expectation contradicted the 0.8.3 rule; a null from the reader alone cannot fail (it is also what a reader that finds nothing returns), so the positive leg is the leg that can fail.
const MODEL_CHAIN = (() => { const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-external.json'), 'utf8')); return { ...base, name: 'wire', seats: { ...base.seats, builder: { provider: 'external', model: 'subscription:opus-5.5' } } }; })();
const ASKED_LINE = 'This seat is asked for subscription:opus-5.5. If a different model answers, say so with answered_model.';
const headOf = needs => needs.split('\n## System prompt')[0];
test('H2-f: a run paused at an external seat writes NEEDS-build.md with the paragraph right above "## System prompt"; the file still reads (asked-for model, system text against the run\'s own record)', () => {
  const pause = (names, { chain = 'mock-external', chainJson = null } = {}) => withDir(chainJson ? { chainJson } : {}, dir => {
    const r = cmd(dir, ['--chain', chain, '--task', 'tasks/t.md', '--max-usd', 'none'], names);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const id = readdirSync(join(dir, 'runs'))[0];
    const needs = read(dir, id, 'NEEDS-build.md');
    return { needs, v: verifiedSystemOfNeeds(needs, read(dir, id, 'build.prompt.json')), asked: askedForOfNeeds(needs) };
  });
  const on = pause(['externalStageParagraph']);
  assert.ok(on.needs.includes(`${PARAGRAPH}\n\n## System prompt\n\n`), 'directly above the system prompt');
  assert.equal(on.needs.split(PARAGRAPH).length - 1, 1);
  assert.ok(on.needs.indexOf(PARAGRAPH) > on.needs.indexOf('# External stage: build'), 'below the file\'s own header');
  assert.equal(typeof on.v.system, 'string', `the run's own record accepts the file (refused: ${on.v.refused})`);
  // the session seat (chains/mock-external.json builder, model claude-code-session) asks for no model: no asked-for line in the header, on or off, and the reader finds none
  const off = pause([]);
  assert.deepEqual([/^This seat is asked for /m.test(headOf(on.needs)), /^This seat is asked for /m.test(headOf(off.needs)), on.asked, off.asked], [false, false, null, null], 'the session seat\'s NEEDS file carries no asked-for line, with the paragraph on and off');
  // a seat WITH a model: the line is in the header and the reader returns the model, with the paragraph on and off
  for (const names of [['externalStageParagraph'], []]) {
    const withModel = pause(names, { chain: 'wire', chainJson: MODEL_CHAIN });
    assert.ok(/^This seat is asked for /m.test(headOf(withModel.needs)), 'control: the pattern that finds no asked-for line for the session seat does find one here');
    assert.ok(headOf(withModel.needs).includes(`\n${ASKED_LINE}\n`),`a seat with a model: its NEEDS file carries the asked-for line (names: ${names.join(',') || 'none'})`);
    assert.equal(withModel.asked, 'subscription:opus-5.5', 'and the reader returns that model');
  }
});

test('H2-f, the tree-member form: a real member paused at its external builder carries the paragraph above "## System prompt" too', { timeout: 300_000 }, async () => {
  const beforeOptions = process.env.NODE_OPTIONS; const beforeNames = process.env.THC_HELD_NAMES;
  process.env.NODE_OPTIONS = `${beforeOptions ? `${beforeOptions} ` : ''}--import ${preload}`;
  process.env.THC_HELD_NAMES = 'externalStageParagraph';
  try {
    const r = await trackedRealRoot(externalChildren()); approvePending(r);
    const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
    assert.equal(first.status, 'waiting');
    const needs = readFileSync(join(r.t.runsDir, first.runId, 'NEEDS-build.md'), 'utf8');
    assert.match(needs, /The tree resumes this node and holds the answer to the prompt below/, 'the member form');
    assert.ok(needs.includes(`${PARAGRAPH}\n\n## System prompt\n\n`), 'the paragraph above the system prompt');
  } finally {
    if (beforeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = beforeOptions;
    if (beforeNames === undefined) delete process.env.THC_HELD_NAMES; else process.env.THC_HELD_NAMES = beforeNames;
  }
});
