// 0.8.4 item 6 (his 05 Nov 2026 "1: a", 10 Nov 18:06 "1:a", and his "a" on not-agreed ends): `council summary-add`, the handling session's plan summary and index at the top of deliverable.md AFTER a run has ended. Drives the REAL CLI on offline mock judges, $0, on a finished run that
// ended NOT agreed (fixture A and Aapi of finishedRun below, batch 1: an ordinary not-agreed end, the shape printed in job 159; no *.test.js file is imported). The wording of what the session writes from is recorded in src/roles.js now (handlerSummaryInstruction, handlerSummaryEndLine); the rows still pass the preload below where they were written with it, and it is no longer what turns the verb on, so a spawned CLI works with or without
// `--import test/helpers/held-summary-preload.mjs`; the row 'A6 recorded state' runs it WITHOUT (the verb works: exit 0, the block is written). What the rows pin: the block is at the top with THC's own ending words and the session's text, the file below it is the file the run wrote
// byte for byte, the record is additive (harness_notes, sha256 and body_sha256 untouched), the contract check gives the outcome it gave without the block, `council handoff --from-run` hands the plan on without it, a second call is refused, a crash between the two writes is completed
// from the sidecar, and every bad call is refused with a sentence and writes nothing. Written without a run (no tests on the laptop): the first box run decides the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, statSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { checkThinContract } from '../src/thin-contract-check.js';
import { verdictHeadline } from '../src/verdict-headline.js';
import { pickDraft } from '../src/handoff-from-run.js';
import { bodyOfDelivered } from '../src/tree-split.js';
import { changedPlanSnapshot } from '../src/tree-accept.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const preload = join(root, 'test', 'helpers', 'held-summary-preload.mjs');
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const HEADING = '## Summary and index (written by the handling session)';
const SUMMARY = '1. Summary\n- The plan settles a one-paragraph bake sale.\n\n2. Open\n- Nothing the plan leaves open.\n\n3. Key data points\n- None stated.\n\n4. Index\n- The plan: one paragraph.\n';

const bases = {};
function finishedRun(kind = 'handled', held = false) {
  const key = `${kind}${held ? '+held' : ''}`;
  if (bases[key]) return bases[key];
  const work = mkdtempSync(join(tmpdir(), `sumadd-${kind}-`));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const tag = `sumadd${kind}`;
  // Fixture A (batch 1; C&C's dated bar change, job 159; 'handledB' = shape B of test/s18-note-verb.test.js, used by one row, for its harness note): an ORDINARY not-agreed end through the real CLI. UNLAYERED, two scripted critics that object at every ask, maxRounds 1 (so the external reviser is never asked and no pause loop is needed), a mock builder, a mock handoff seat, handoff true. The 'handled' kind keeps the handling session (reviser provider external); the 'api' kind (Aapi) has a mock reviser. Differences from chains/plan-mini-council.json: no layers (plan: 3), no ladder, no dispute, no answer_back, no decisions/proposals/personas, a mock handoff seat (plan: external).
  const mockSeat = lab => ({ provider: 'mock', model: 'mock-builder', lab });
  const config = { name: `sumadd${kind}`, description: 'A fixture chain.', summary: 'summary add', maxRounds: kind === 'handledB' ? 2 : 1, signoff: 'unanimous', handoff: true, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: mockSeat('author'), reviser: kind === 'handled' || kind === 'handledB' ? { provider: 'external', model: 'claude-code-session', lab: 'handler' } : mockSeat('author'), handoff: mockSeat('hand'),
      critics: kind === 'handledB'
        ? [{ provider: 'mock', model: 'mock-unreadable', lab: 'l1a', layer: 1 }, { provider: 'mock', model: 'mock-unreadable', lab: 'l1b', layer: 1 }, { provider: 'mock', model: `mock-critic-script-o-${tag}2`, lab: 'l2a', layer: 2 }, { provider: 'mock', model: `mock-critic-script-x-${tag}3`, lab: 'l3a', layer: 3 }, { provider: 'mock', model: 'mock-unreadable', lab: 'l3b', layer: 3 }]
        : [{ provider: 'mock', model: `mock-critic-script-xxxxxxxxxx-${tag}1`, lab: 'l1' }, { provider: 'mock', model: `mock-critic-script-xxxxxxxxxx-${tag}2`, lab: 'l2' }] } };
  writeFileSync(join(work, 'chains', `sumadd${kind}.json`), JSON.stringify(config));
  const run = spawnSync(process.execPath, [...(held ? ['--import', preload] : []), cli, '--task', 'task.md', '--chain', `sumadd${kind}`, '--max-usd', '1'], { cwd: work, encoding: 'utf8' });
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  bases[key] = { work, runDir, exit: run.status, out: run.stdout + run.stderr };
  return bases[key];
}
function copyOfRun(kind = 'handled') {
  const b = finishedRun(kind);
  const dir = mkdtempSync(join(tmpdir(), 'sumadd-copy-'));
  const runDir = join(dir, 'run');
  cpSync(b.runDir, runDir, { recursive: true });
  return { work: dir, runDir };
}
const summaryFile = (work, text = SUMMARY, name = 'summary.md') => { const p = join(work, name); writeFileSync(p, text); return p; };
// held: whether the held instruction is injected (the preload); without it the verb is in its shipped state
const verb = (work, args, held = true) => spawnSync(process.execPath, [...(held ? ['--import', preload] : []), cli, 'summary-add', ...args], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work } });
const snap = runDir => Object.fromEntries(readdirSync(runDir).sort().map(f => [f, statSync(join(runDir, f)).isDirectory() ? '[folder]' : readFileSync(join(runDir, f), 'utf8')]));
const readReport = runDir => JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
const plan = runDir => readFileSync(join(runDir, 'deliverable.md'), 'utf8');

test('premise: the CLI run ends not agreed with a handling session, writing report.json and deliverable.md (the fixture, not the verb, decides this)', () => {
  for (const kind of ['handled', 'api']) assert.equal(finishedRun(kind).exit, 22, `premise: the ${kind} fixture ends not agreed, exit 22 (${finishedRun(kind).out.slice(-500)})`);
  const b = finishedRun();
  assert.ok(existsSync(join(b.runDir, 'report.json')) && existsSync(join(b.runDir, 'deliverable.md')), 'premise: the run wrote report.json and deliverable.md');
  const report = readReport(b.runDir);
  assert.equal(report.passed, false, 'premise: the run ended without every judge signing (printed, job 159: passed false, outcome no_consensus)');
  assert.equal(typeof verdictHeadline(report).text, 'string', 'premise: THC has its own words for how the run ended');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, batch 1; recorded state). OLD ('A6 shipped state: without the held instruction the verb offers nothing and writes nothing (exit 2, the sentence), so no run gets a block'): the verb run WITHOUT the preload exited 2 with "this build does not offer a summary block yet" and the run folder was unchanged. Red on the tip (printed, job 159, A0/A/B: summary-add with a file and no preload exits 0 and the block is written): handlerSummaryInstruction and handlerSummaryEndLine are recorded in src/roles.js (:47), so the shipped state this row pinned no longer exists.
// NEW: the same verb, no preload: it works. Exit 0, the block is the top of deliverable.md (the heading), and the only new file in the run folder is the sidecar the verb writes. Behaviour only: the instruction's and the end line's words are not pinned (his 12 Nov 2026 word: "I don't see why we would need a test that pins wording."). WHY: the subject (what the verb does when its words are not injected) on the state that ships. RED: the verb refused (the old exit-2 state) fails the status assert. Chain: fixture A of finishedRun above (not a chains/ file; differences from chains/plan-mini-council.json named there).
test('A6 recorded state: without the preload the verb works (the instruction and the end line are recorded): exit 0, the block is the top of deliverable.md and the only new file is the sidecar', () => {
  const c = copyOfRun();
  const before = Object.keys(snap(c.runDir));
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)], false);
  assert.equal(r.status, 0, `exit 0 (${r.stdout}${r.stderr})`);
  assert.ok(plan(c.runDir).startsWith(`${HEADING}\n`), 'the block is at the top of the plan');
  assert.deepEqual(Object.keys(snap(c.runDir)).filter(f => !before.includes(f)), ['handler-summary.json'], 'the only new file is the sidecar');
});

test('A6 with the instruction live and no file, the verb prints its usage and the instruction the session writes from, and writes nothing', () => {
  const c = copyOfRun();
  const before = snap(c.runDir);
  const r = verb(c.work, [c.runDir]);
  assert.equal(r.status, 0, `exit 0 (${r.stdout}${r.stderr})`);
  assert.match(r.stdout, /^usage: council summary-add <run folder> --summary-file <file>\n\nWrite the summary block for this finished plan, using only what the plan says\./);
  assert.deepEqual(snap(c.runDir), before, 'nothing was written');
});

test('A6 the block: at the top of deliverable.md with THC\'s own words for how the run ended and the session\'s text; the file below it is the file the run wrote, byte for byte; the record is additive (harness_notes, sha256 and body_sha256 untouched, every other field as it was)', () => {
  const c = copyOfRun('handledB');   // shape B (a layered not-agreed end with a final read): its delivered_text carries a harness note (the final-read block) that this row's last two asserts need; fixture A has none (batch 1, printed job 166)

  const before = { file: plan(c.runDir), report: readReport(c.runDir) };
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]);
  assert.equal(r.status, 0, `the summary is recorded (${r.stdout}${r.stderr})`);
  const file = plan(c.runDir); const report = readReport(c.runDir);
  assert.ok(file.startsWith(`${HEADING}\n\nHow the run ended: ${verdictHeadline(before.report).text}\n\n`), 'the block starts the file: the heading, then THC\'s own ending words (verdictHeadline), no new sentence');
  assert.ok(file.includes(SUMMARY.trim()), 'the session\'s text is in the block');
  const rec = report.delivered_text.summary_block;
  assert.ok(rec && Number.isInteger(rec.chars) && rec.chars > 0, 'the record names the block');
  assert.equal(sha(file.slice(0, rec.chars)), rec.sha256, 'the record\'s hash is the block\'s');
  assert.ok(file.slice(0, rec.chars).endsWith('\n---\n'), 'the block ends with ONE closing --- line');
  assert.equal(file.slice(rec.chars), before.file, 'everything below the block is the file as the run wrote it, byte for byte');
  assert.equal(rec.text_sha256, sha(SUMMARY.trim()), 'the record holds the hash of the session\'s text');
  const strip = r2 => { const o = JSON.parse(JSON.stringify(r2)); delete o.delivered_text.summary_block; return o; };
  assert.deepEqual(strip(report), before.report, 'every other field of report.json is as the run wrote it (harness_notes, sha256 and body_sha256 included)');
  assert.equal(JSON.parse(readFileSync(join(c.runDir, 'handler-summary.json'), 'utf8')).text, SUMMARY.trim(), 'the sidecar holds the session\'s own text');
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  assert.ok(ajv.compile(JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8')))(report), 'the rewritten report.json still validates against schemas/report-v1.json (delivered_text.summary_block is declared)');
  assert.deepEqual(bodyOfDelivered(file, report.delivered_text), bodyOfDelivered(before.file, before.report.delivered_text), 'the plan the run delivered is found in the file with the block as it was found without it');
  assert.ok(bodyOfDelivered(file, report.delivered_text).body !== undefined, 'premise: the body is found');
  const edited = file.replace('settles', 'SETTLES');
  assert.equal(edited === file, false, 'premise: the edit changes the block');
  // On a run with harness notes (this fixture) bodyOfDelivered looks for the suffix that hashes to body_sha256 after any `---` line, so it finds the plan whatever sits above it (an edited harness block above the body was never noticed by it, the summary block included; on a run with no notes the only start is 0 and an edited block means no body is found); a file whose block was edited is reported by the whole-file hash of the contract check, which the next row pins.
  assert.ok(report.delivered_text.harness_notes.length > 0, 'premise: this run has harness notes, so every --- line is a start');
  assert.ok(bodyOfDelivered(edited, report.delivered_text).body !== undefined, 'the plan is still found in a file whose block was edited: reporting the edit is the contract check\'s (next row)');
});

test('A6 the contract check: a run whose only addition is the summary block gets the same outcome from every comparison as without it (the pure check and `council contract check`)', () => {
  const c = copyOfRun();
  const before = { file: plan(c.runDir), report: readReport(c.runDir), handoff: readFileSync(join(c.runDir, 'HANDOFF.md'), 'utf8') };
  const cliBefore = spawnSync(process.execPath, [cli, 'contract', 'check', c.runDir], { cwd: c.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: c.work } });
  const pureBefore = checkThinContract({ report: before.report, deliverableText: before.file, handoffText: before.handoff });
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]);
  assert.equal(r.status, 0, `premise: the summary is recorded (${r.stdout}${r.stderr})`);
  const after = { file: plan(c.runDir), report: readReport(c.runDir) };
  assert.deepEqual(checkThinContract({ report: after.report, deliverableText: after.file, handoffText: before.handoff }), pureBefore, 'the thin-contract items are exactly what they were without the block');
  const cliAfter = spawnSync(process.execPath, [cli, 'contract', 'check', c.runDir], { cwd: c.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: c.work } });
  assert.deepEqual([cliAfter.status, cliAfter.stdout], [cliBefore.status, cliBefore.stdout], '`council contract check` says what it said without the block');
  const edited = after.file.replace('settles', 'SETTLES');
  assert.notDeepEqual(checkThinContract({ report: after.report, deliverableText: edited, handoffText: before.handoff }), pureBefore, 'an edited block is not stripped: the check no longer reads as it did');
});

test('A6 `council handoff --from-run` and the plan readers get the plan without the block (the other harness blocks go on as they always did)', () => {
  const c = copyOfRun();
  const original = plan(c.runDir);
  const was = pickDraft(c.runDir);
  assert.equal(was?.name, 'deliverable.md', 'premise: the highest-ranked draft is deliverable.md');
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]);
  assert.equal(r.status, 0, `premise: the summary is recorded (${r.stdout}${r.stderr})`);
  const now = pickDraft(c.runDir);
  assert.equal(now.text, original, 'the draft handed on is the file the run wrote, with no summary block');
  assert.equal(now.text.includes(HEADING), false);
});

test('A6 one block per run: a second call is refused and changes nothing', () => {
  const c = copyOfRun();
  assert.equal(verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]).status, 0, 'premise: the first call is recorded');
  const before = snap(c.runDir);
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work, 'Another text.\n', 'other.md')]);
  assert.equal(r.status, 2, `exit 2 (${r.stdout}${r.stderr})`);
  assert.match(r.stderr.trim(), /^summary-add: this run already has a summary block\. Nothing was written\.$/);
  assert.deepEqual(snap(c.runDir), before, 'nothing moved');
});

test('A6 a crash between the two writes: the record is there and the file lacks the block (it reads as no block); the next call writes the block with ITS OWN text and replaces the sidecar, so an earlier call\'s text is never kept silently (FIX 2 of the review of 6a6d2855)', () => {
  // OLD bar (named): "the sidecar is the authority: the first text is the block" (a later call with a different file got the FIRST call's text silently). NEW bar: the text of the later call is the block, in the sidecar and in the record.
  const c = copyOfRun();
  const original = plan(c.runDir);
  assert.equal(verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]).status, 0, 'premise: recorded');
  writeFileSync(join(c.runDir, 'deliverable.md'), original);   // what a crash after the record and before the file leaves
  assert.deepEqual(bodyOfDelivered(plan(c.runDir), readReport(c.runDir).delivered_text), bodyOfDelivered(original, readReport(c.runDir).delivered_text), 'premise: the file reads as no block');
  const sidecarText = () => JSON.parse(readFileSync(join(c.runDir, 'handler-summary.json'), 'utf8').trim().split('\n').pop()).text;
  assert.equal(sidecarText(), SUMMARY.trim(), 'premise: the sidecar holds the first call\'s text');
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work, 'A different text.\n', 'other.md')]);
  assert.equal(r.status, 0, `written (${r.stdout}${r.stderr})`);
  const file = plan(c.runDir);
  assert.ok(file.includes('A different text.') && !file.includes(SUMMARY.trim()), 'the block holds the LATER call\'s text, and the first text is not kept silently');
  assert.equal(sidecarText(), 'A different text.', 'the sidecar was replaced: it holds the text that was delivered');
  assert.equal(readReport(c.runDir).delivered_text.summary_block.text_sha256, sha('A different text.'), 'the record holds the hash of the delivered text');
  assert.equal(file.slice(readReport(c.runDir).delivered_text.summary_block.chars), original, 'the rest is the file the run wrote');
});

const REFUSALS = [
  // [title, setup (copy -> argv), exit, stderr pattern]
  ['a summary file that does not exist', c => [c.runDir, '--summary-file', join(c.work, 'nowhere.md')], 2, /^summary-add: .*nowhere\.md cannot be read\. Nothing was written\.$/],
  ['an empty summary file', c => [c.runDir, '--summary-file', summaryFile(c.work, '  \n')], 2, /^summary-add: the summary file is empty\. Nothing was written\.$/],
  ['an escape character', c => [c.runDir, '--summary-file', summaryFile(c.work, 'bell \u001b[31m\n')], 2, /^summary-add: the summary must be plain text/],
  ['a hidden direction mark', c => [c.runDir, '--summary-file', summaryFile(c.work, `text ${String.fromCharCode(0x202e)} txet\n`)], 2, /^summary-add: the summary must be plain text/],
  ['more than 20000 characters', c => [c.runDir, '--summary-file', summaryFile(c.work, 'x'.repeat(20001))], 2, /^summary-add: the summary is 20001 characters; at most 20000\. Nothing was written\.$/],
  ['a folder that is not a run', c => [join(c.work, 'nowhere'), '--summary-file', summaryFile(c.work)], 2, /^summary-add: .*nowhere is not a run folder\. Nothing was written\.$/],
];
for (const [title, args, exit, pattern] of REFUSALS) {
  test(`A6 refused, nothing written: ${title}`, () => {
    const c = copyOfRun();
    const argv = args(c);
    const before = snap(c.runDir);
    const r = verb(c.work, argv);
    assert.equal(r.status, exit, `${title}: exit (${r.stdout}${r.stderr})`);
    assert.match(r.stderr.trim(), pattern, `${title}: the sentence`);
    assert.deepEqual(snap(c.runDir), before, `${title}: the run folder is exactly as it was`);
  });
}

test('A6 refused, nothing written: a run that has not ended, a run with no handling session, and a deliverable that is no longer the file the run wrote (the body, or a harness block above it)', () => {
  const a = copyOfRun();
  rmSync(join(a.runDir, 'report.json'));
  const beforeA = snap(a.runDir);
  const ra = verb(a.work, [a.runDir, '--summary-file', summaryFile(a.work)]);
  assert.equal(ra.status, 2);   // REMOVED (0.8.4 apply, batch 1; his 12 Nov 2026 word on wording pins): OLD: the sentence "summary-add: this run has not ended, and the summary is added after the ending. Nothing was written." was matched whole. Red on the tip (printed, job 166: the program says "...and the summary can be added only after the ending. Nothing was written."). WHY: a sentence pin; exit 2 and nothing written stay.
  assert.deepEqual(snap(a.runDir), beforeA);
  const b = copyOfRun('api');
  const beforeB = snap(b.runDir);
  const rb = verb(b.work, [b.runDir, '--summary-file', summaryFile(b.work)]);
  assert.equal(rb.status, 2); assert.match(rb.stderr.trim(), /^summary-add: this run had no handling session, so a summary would be recorded as the words of someone the run did not have\. Nothing was written\.$/);
  assert.deepEqual(snap(b.runDir), beforeB);
  const c = copyOfRun();
  writeFileSync(join(c.runDir, 'deliverable.md'), `${plan(c.runDir)}\nAn edit after the run.\n`);
  const beforeC = snap(c.runDir);
  const rc = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]);
  assert.equal(rc.status, 2); assert.match(rc.stderr.trim(), /^summary-add: deliverable\.md is not the file the run wrote \(its hash differs from report\.json\)\. Nothing was written\.$/);
  assert.deepEqual(snap(c.runDir), beforeC);
  const d = copyOfRun('handledB');   // shape B: its delivered_text carries a harness block (the final-read block) above the plan; fixture A has none (batch 1, printed jobs 166 and 171)
  assert.ok(readReport(d.runDir).delivered_text.harness_notes.length > 0, 'premise: a harness block sits above the plan (so the edit below is inside it, not in the body)');
  const file = plan(d.runDir);
  writeFileSync(join(d.runDir, 'deliverable.md'), `${file[0] === 'X' ? 'Y' : 'X'}${file.slice(1)}`);   // the first character, inside the harness block above the body
  const beforeD = snap(d.runDir);
  const rd = verb(d.work, [d.runDir, '--summary-file', summaryFile(d.work)]);
  assert.equal(rd.status, 2); assert.match(rd.stderr.trim(), /^summary-add: deliverable\.md is not the file the run wrote \(its hash differs from report\.json\)\. Nothing was written\.$/, 'an edit in a harness block above the body is caught too: the note would be false');
  assert.deepEqual(snap(d.runDir), beforeD);
});

test('A6 `--summary-file` is an option of `council summary-add` only: any other command refuses it before anything runs', () => {
  const c = copyOfRun();
  const r = spawnSync(process.execPath, [cli, 'note-add', c.runDir, '--note', 'x', '--summary-file', 'f.md'], { cwd: c.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: c.work } });
  assert.equal(r.status, 2, `exit 2 (${r.stdout}${r.stderr})`);
  assert.match(r.stderr, /^--summary-file: an option of `council summary-add` only/);
});

test('A6 the tree\'s changed-plan reader (src/tree-accept.js changedPlanSnapshot) hashes and reads the plan without the block, and the block is not a harness note (its notes count is what it was)', () => {
  const c = copyOfRun();
  const original = plan(c.runDir);
  const was = changedPlanSnapshot(c.work, 'run');
  assert.ok(!was.unreadable, `premise: the snapshot reads (${was.unreadable})`);
  assert.equal(was.bodySha256, sha(original), 'premise: with no block the accepted body is the whole file');
  const r = verb(c.work, [c.runDir, '--summary-file', summaryFile(c.work)]);
  assert.equal(r.status, 0, `premise: the summary is recorded (${r.stdout}${r.stderr})`);
  const now = changedPlanSnapshot(c.work, 'run');
  assert.equal(now.bodySha256, sha(original), 'the plan that would be accepted is the file the run wrote: the block is not hashed into it');
  assert.equal(now.text, original, 'and it is not scanned or read as part of the plan');
  assert.equal(now.notes, was.notes, 'the block is not a harness note: tree-accept\'s refusal on a note above the plan is not triggered by it');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, batch 1; recorded state). OLD last assert: "shipped, without the held line, no line is printed" (finishedRun('handled') without the preload). Red on the tip (job 159: the `summary:` line is printed for the handled kinds with no preload; handlerSummaryEndLine is recorded). NEW: the same run prints it (true). WHY: the shipped state the assert pinned no longer exists. RED: a tree that does not record the end line prints none and the new assert fails. Title: the clause about a run without the held line is gone.
test('A6 the run-end line: a run that has a handling session prints it as its closing summary (a not-agreed end included) and run.log carries it; a run with no handling session prints none', () => {
  const withLine = finishedRun('handled', true);
  assert.equal(withLine.exit, 22, `premise: the run ends not agreed (${withLine.out.slice(-300)})`);
  const pattern = /^summary:  the handling session can add a summary and index of this plan at the top of deliverable\.md: run council summary-add (\S+) to see what to write\.$/m;
  const found = pattern.exec(withLine.out);
  assert.ok(found, 'the closing summary names the command and the run');
  assert.ok(found[1].endsWith(basename(withLine.runDir)), `the run named is this run (${found[1]})`);
  assert.ok(pattern.test(readFileSync(join(withLine.runDir, 'run.log'), 'utf8').trim().split('\n').slice(-3).join('\n')), 'it is within the last three lines of run.log, which is what run_status shows a session as lastLogLines (a security review\'s lines would follow it)');
  const noSession = finishedRun('api', true);
  assert.equal(noSession.exit, 22, 'premise: the no-session run ends not agreed');
  assert.equal(noSession.out.includes('council summary-add'), false, 'a run with no handling session prints no line');
  assert.equal(finishedRun('handled').out.includes('council summary-add'), true, 'recorded state (printed, job 159): the line is printed with no preload too; the preload is no longer what turns it on');
});

test('A6 composes with `council note-add`: after the summary block a note is added; the record and the block survive, and the contract check says what it says for the note alone', () => {
  const NOTE = 'I disagree: the retry limit is not a build blocker for this task.';
  const check = c => spawnSync(process.execPath, [cli, 'contract', 'check', c.runDir], { cwd: c.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: c.work } });
  const noteOnly = copyOfRun();
  const n1 = spawnSync(process.execPath, [cli, 'note-add', noteOnly.runDir, '--note', NOTE], { cwd: noteOnly.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: noteOnly.work } });
  assert.equal(n1.status, 0, `premise: the note is recorded (${n1.stdout}${n1.stderr})`);
  const both = copyOfRun();
  assert.equal(verb(both.work, [both.runDir, '--summary-file', summaryFile(both.work)]).status, 0, 'premise: the summary is recorded');
  const n2 = spawnSync(process.execPath, [cli, 'note-add', both.runDir, '--note', NOTE], { cwd: both.work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: both.work } });
  assert.equal(n2.status, 0, `the note is recorded after the summary (${n2.stdout}${n2.stderr})`);
  const report = readReport(both.runDir);
  assert.ok(report.delivered_text.summary_block, 'the note-add rewrite kept the summary record');
  assert.ok(plan(both.runDir).startsWith(HEADING), 'the block is still at the top');
  const a = check(noteOnly); const b = check(both);
  const tokens = (r, c) => r.stdout.split(c.runDir).join('<run>').split(c.work).join('<work>');   // each copy sits in its own temp folder: the paths are not what is compared
  assert.deepEqual([b.status, tokens(b, both)], [a.status, tokens(a, noteOnly)], '`council contract check` says what it says for the note alone');
});
