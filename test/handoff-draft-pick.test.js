// Which draft a handoff, and the run-level `--from-run`, hand on (13 Oct 2026; audit items 4 + 5 + 15a, and 9's `-full` part). src/handoff-from-run.js `pickDraft` / `pickBuildDraft` / `pickNoteLines`.
//
// Every run folder here comes from the REAL CLI on mock chains ($0, no provider call): the recorded stops (`<label>.usage.json` stop "length", cappedAt) are the ones the writer wrote, not typed here.
// A "stopped run" fixture is a copy of named stage files from such a run into a fresh folder: the picker reads names and records, and a stopped run is exactly a folder without the later files.
// The existing order test (test/handoff-from-run.test.js, "pickDraft: deliverable, else final, ...") stays as the control for the old order.
//
// What stays out (ROADMAP 74, 0.8.4): a patch-format revise-N.md with NO revise-N-full.md beside it is still handed on as it is.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickDraft, pickBuildDraft, pickNoteLines, partialBanner, stopState } from '../src/handoff-from-run.js';
import { parseDisputes, stripDeclined } from '../src/draft-disputes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const mock = model => ({ provider: 'mock', model });
const chainOf = (seats, extra = {}) => ({
  name: 'pd', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: { criteria: mock('mock-criteria'), builder: mock('mock-builder'), reviser: mock('mock-builder'), critics: [{ ...mock('mock-critic-a'), lab: 'a' }, { ...mock('mock-critic-b'), lab: 'b' }], ...seats }, ...extra,
});
const ENV = { PATH: process.env.PATH };
const read = p => readFileSync(p, 'utf8');

let base; const REAL = {};
// one real CLI run on a chain; -> { dir, run, code }. `chain` is a config object or the name of a shipped chain.
function realRun(label, chain, extraArgs = []) {
  const dir = join(base, `real-${label}`); mkdirSync(join(dir, 'tasks'), { recursive: true }); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A mock task.');
  let name = chain;
  if (typeof chain === 'object') { name = 'pd'; writeFileSync(join(dir, 'chains', 'pd.json'), JSON.stringify(chain)); }
  const r = spawnSync(process.execPath, [cli, '--chain', name, '--task', 'tasks/x.md', ...extraArgs], { cwd: dir, encoding: 'utf8', env: ENV, timeout: 90_000 });
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, code: r.status, out: r.stdout + r.stderr };
}
before(() => {
  base = mkdtempSync(join(tmpdir(), 'thc-draft-pick-'));
  REAL.buildCutTwice = realRun('a', chainOf({ builder: mock('mock-draft-cut') }));                                  // exit 17: build.md and build-retry.md both cut off
  REAL.buildRescued = realRun('b', chainOf({ builder: { ...mock('mock-draft-cut-then-fits'), maxTokens: 800 } })); // build.md cut off, build-retry.md whole, the run finishes
  REAL.reviseCutTwice = realRun('c', chainOf({ reviser: mock('mock-draft-cut') }));                                 // exit 17: build.md whole, revise-1.md and revise-1-retry.md cut off
  REAL.finalCutTwice = realRun('d', chainOf({ finalist: mock('mock-draft-cut') }));                                 // exit 17: build.md, revise-1.md whole; final.md and final-retry.md cut off
  REAL.reviseErrorTwice = realRun('e', chainOf({ reviser: mock('mock-draft-error') }));                              // exit 17: build.md whole; revise-1.md and revise-1-retry.md ended by the provider with stop "error"
  REAL.deepDive = realRun('t', 'mock-tiered');                                                                      // a deep-dive chain: build.md, deep-dive-revise.md, deliverable.md
  REAL.patchFallback = realRun('p', 'mock-patch-fallback');                                                         // patch mode: revise-1.md (raw edit blocks) and revise-1-full.md
});
after(() => { rmSync(base, { recursive: true, force: true }); });

// a fresh folder holding copies of the named stage files (and each one's usage record) from a real run
let n = 0;
function folderWith(real, names, over = {}) {
  const dir = join(base, `f${++n}`); mkdirSync(dir);
  for (const f of names) {
    copyFileSync(join(real.run, f), join(dir, f));
    const u = f.replace(/\.md$/, '.usage.json'); if (u !== f && existsSync(join(real.run, u))) copyFileSync(join(real.run, u), join(dir, u));
  }
  for (const [f, text] of Object.entries(over)) writeFileSync(join(dir, f), text);
  return dir;
}

test('fixtures: the real runs left the files and the recorded stops these tests stand on', () => {
  assert.equal(REAL.buildCutTwice.code, 17); assert.equal(REAL.reviseCutTwice.code, 17); assert.equal(REAL.finalCutTwice.code, 17);
  assert.equal(REAL.buildRescued.code, 0); assert.equal(REAL.deepDive.code, 0); assert.equal(REAL.patchFallback.code, 0);
  const stop = (real, f) => JSON.parse(read(join(real.run, f))).usage.stop;
  assert.equal(stop(REAL.buildRescued, 'build.usage.json'), 'length', 'the first build was cut off');
  assert.equal(stop(REAL.buildRescued, 'build-retry.usage.json'), undefined, 'the retry finished');
  assert.equal(stop(REAL.finalCutTwice, 'final.usage.json'), 'length'); assert.equal(stop(REAL.finalCutTwice, 'final-retry.usage.json'), 'length');
  for (const f of ['build.md', 'deep-dive-revise.md']) assert.ok(existsSync(join(REAL.deepDive.run, f)), `a real deep-dive run leaves ${f}`);
  for (const f of ['revise-1.md', 'revise-1-full.md']) assert.ok(existsSync(join(REAL.patchFallback.run, f)), `a real patch-mode run leaves ${f}`);
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-1 item 4: the deep-dive revision
test('DP-1: a run that stopped after deep-dive-revise hands on the deep-dive revision, not the build it replaced', () => {
  const dir = folderWith(REAL.deepDive, ['build.md', 'deep-dive-revise.md']);
  const revision = parseDisputes(read(join(dir, 'deep-dive-revise.md'))).draft;
  assert.notEqual(revision, stripDeclined(read(join(dir, 'build.md'))), 'fixture: the revision is a different text');
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'deep-dive-revise.md');
  assert.equal(pick.text, revision);
  assert.equal(pickBuildDraft(dir).name, 'build.md', 'the FIRST-draft picker never takes the revision');
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-2 item 5: the retry
test('DP-2: a build cut off at its output-token cap with a working retry hands on the retry; an empty build.md beside a retry is not "nothing to hand off"', () => {
  const dir = folderWith(REAL.buildRescued, ['build.md', 'build-retry.md']);
  const retry = stripDeclined(read(join(dir, 'build-retry.md')));
  for (const pick of [pickDraft(dir), pickBuildDraft(dir)]) { assert.equal(pick.name, 'build-retry.md'); assert.equal(pick.text, retry); }
  const empty = folderWith(REAL.buildRescued, ['build-retry.md'], { 'build.md': '' });
  assert.equal(pickDraft(empty).name, 'build-retry.md');
  assert.equal(pickBuildDraft(empty).name, 'build-retry.md');
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-3 item 15a: an unreadable candidate
test('DP-3: a revise-N.md that cannot be read (here a directory) does not crash the pick: the next draft is handed on and the skipped file is named', () => {
  const dir = folderWith(REAL.reviseCutTwice, ['build.md']);
  mkdirSync(join(dir, 'revise-1.md'));
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'build.md');
  assert.deepEqual(pick.skipped, [{ name: 'revise-1.md', why: 'could not be read' }]);
  assert.deepEqual(pickNoteLines(pick), ['`revise-1.md` could not be read; `build.md` is handed on.']);
  assert.deepEqual(pickNoteLines(pickDraft(folderWith(REAL.reviseCutTwice, ['build.md']))), [], 'a pick that passed nothing over says nothing');
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-4 item 9 (-full part)
test('DP-4: the full rewrite beside a patch-mode revise is handed on, not the raw edit blocks', () => {
  const dir = folderWith(REAL.patchFallback, ['build.md', 'revise-1.md', 'revise-1-full.md']);
  assert.match(read(join(dir, 'revise-1.md')), /<<<<<<< SEARCH/, 'fixture: revise-1.md is the raw edit blocks');
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'revise-1-full.md');
  assert.doesNotMatch(pick.text, /<<<<<<< SEARCH/);
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-5 item 5: a failed retry hands on nothing from that round
test('DP-5: a final cut off twice (a REAL recorded stop) hands on the last complete round, not the fragment; a revise round cut off twice hands on the build', () => {
  const finalDir = folderWith(REAL.finalCutTwice, ['build.md', 'revise-1.md', 'final.md', 'final-retry.md']);
  const pick = pickDraft(finalDir);
  assert.equal(pick.name, 'revise-1.md');
  assert.deepEqual(pick.skipped.map(s => s.name), ['final-retry.md', 'final.md']);
  assert.ok(pick.skipped.every(s => /cut off at its output-token cap \(stop "length"\)/.test(s.why)), JSON.stringify(pick.skipped));
  assert.equal(pick.failed, undefined);
  const reviseDir = folderWith(REAL.reviseCutTwice, ['build.md', 'revise-1.md', 'revise-1-retry.md']);
  assert.equal(pickDraft(reviseDir).name, 'build.md');
  assert.deepEqual(pickDraft(reviseDir).skipped.map(s => s.name), ['revise-1-retry.md', 'revise-1.md']);
  assert.deepEqual(pickNoteLines(pick), ['`final-retry.md` was cut off at its output-token cap (stop "length"); `final.md` was cut off at its output-token cap (stop "length"); `revise-1.md` is handed on.']);
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-6 Q1: the first-draft picker
test('DP-6: pickBuildDraft keeps the first-draft meaning: the build stage only, the working retry over the first try, a later round is never picked', () => {
  const dir = folderWith(REAL.buildRescued, ['build.md', 'build-retry.md', 'revise-1.md', 'deliverable.md']);
  assert.equal(pickBuildDraft(dir).name, 'build-retry.md');
  assert.equal(pickDraft(dir).name, 'deliverable.md', 'the latest-draft picker is unchanged for a finished run');
  const full = folderWith(REAL.finalCutTwice, ['build.md', 'revise-1.md', 'final.md', 'final-retry.md']);
  assert.equal(pickBuildDraft(full).name, 'build.md');
  assert.equal(pickBuildDraft(folderWith(REAL.deepDive, ['deep-dive-revise.md'])), null, 'no build stage file: nothing');
});

// ---------------------------------------------------------------------------------------------------------------------------------- DP-7 Q2: every candidate failed
test('DP-7: when every candidate failed the highest-ranked is handed on and says so (never silently)', () => {
  const dir = folderWith(REAL.buildCutTwice, ['build.md', 'build-retry.md']);
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'build-retry.md');
  assert.match(pick.failed, /cut off at its output-token cap \(stop "length"\)/);
  assert.equal(pick.skipped, undefined);
  assert.match(pickNoteLines(pick).join('\n'), /`build-retry\.md` was cut off at its output-token cap \(stop "length"\), and no other draft in the run folder finished, so what follows is not a finished plan\./);
  const banner = partialBanner({ state: stopState(REAL.buildCutTwice.run), draftName: pick.name, runId: 'R', pick });
  assert.match(banner, /> `build-retry\.md` was cut off at its output-token cap \(stop "length"\)/);
});

// ---------------------------------------------------------------------------------------------------------------------------------- the real verbs
// A workspace holding a copy of a run folder (named stage files) with a run.json that points at a chain whose handoff seat is a mock model (the model text is the mock's: this checks the banner and the exit, not a handoff's content).
function handoffWorkspace(real, names, over = {}) {
  const dir = mkdtempSync(join(base, 'hw-')); const RUN = '2026-10-13T09-00-00-000Z';
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  writeFileSync(join(dir, 'chains', 'hand.json'), JSON.stringify(chainOf({ handoff: mock('mock-builder') }, { name: 'hand', maxRounds: 1 })));
  writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'hand', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
  const rd = join(dir, 'runs', RUN);
  copyFileSync(join(real.run, 'criteria.md'), join(rd, 'criteria.md'));
  for (const f of names) { copyFileSync(join(real.run, f), join(rd, f)); const u = f.replace(/\.md$/, '.usage.json'); if (existsSync(join(real.run, u))) copyFileSync(join(real.run, u), join(rd, u)); }
  for (const [f, text] of Object.entries(over)) writeFileSync(join(rd, f), text);
  return { dir, rd, RUN };
}
const handoff = (w, args = []) => spawnSync(process.execPath, [cli, 'handoff', '--from-run', join('runs', w.RUN), ...args], { cwd: w.dir, encoding: 'utf8', env: { ...ENV, HOME: w.dir }, timeout: 90_000 });

test('DP-8: `council handoff --from-run` on a run whose every draft was cut off writes the fragment WITH a banner that names the file and the stop', () => {
  const w = handoffWorkspace(REAL.buildCutTwice, ['build.md', 'build-retry.md'], { 'STOPPED-truncated.json': JSON.stringify({ stage: 'build' }) });
  const r = handoff(w);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = read(join(w.rd, 'HANDOFF.md'));
  assert.match(text, /^> \*\*Not a signed-off plan\.\*\*.*\(`build-retry\.md`\)/);
  assert.match(text, /> `build-retry\.md` was cut off at its output-token cap \(stop "length"\), and no other draft in the run folder finished, so what follows is not a finished plan\./);
  assert.match(r.stderr, /handoff: `build-retry\.md` was cut off at its output-token cap/, 'the console says it too');
});

test('DP-9: `council handoff --from-run` with an unreadable newest draft hands on the next one and the banner names both files', () => {
  const w = handoffWorkspace(REAL.reviseCutTwice, ['build.md'], {});
  mkdirSync(join(w.rd, 'revise-1.md'));
  const r = handoff(w);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = read(join(w.rd, 'HANDOFF.md'));
  assert.match(text, /\(`build\.md`\)/, 'the banner names the draft it came from');
  assert.match(text, /> `revise-1\.md` could not be read; `build\.md` is handed on\./);
});

test('DP-10: `council handoff --from-run` on a run whose final failed hands on the last complete round', () => {
  const w = handoffWorkspace(REAL.finalCutTwice, ['build.md', 'revise-1.md', 'final.md', 'final-retry.md'], { 'STOPPED-truncated.json': JSON.stringify({ stage: 'final' }) });
  const r = handoff(w);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = read(join(w.rd, 'HANDOFF.md'));
  assert.match(text, /\(`revise-1\.md`\)/);
  assert.match(text, /> `final-retry\.md` was cut off at its output-token cap \(stop "length"\); `final\.md` was cut off at its output-token cap \(stop "length"\); `revise-1\.md` is handed on\./);
});

test('DP-11: nothing readable and non-empty in the folder: exit 2 with the corrected list of what counts', () => {
  const w = handoffWorkspace(REAL.buildRescued, [], { 'build.md': '' });
  const r = handoff(w);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nothing to hand off - .* holds no draft \(deliverable\.md, or a final, revise-N, deep-dive-revise or build draft that can be read and is not empty\)/);
});

// the run-level --from-run: the earlier run's FIRST draft, and the retry that replaced a cut-off first try
function secondRun(real, names, extra = [], over = {}) {
  const w = join(base, `second-${++n}`); mkdirSync(join(w, 'tasks'), { recursive: true }); mkdirSync(join(w, 'chains'));
  writeFileSync(join(w, 'tasks', 'x.md'), 'A mock task.');
  writeFileSync(join(w, 'chains', 'pd2.json'), JSON.stringify(chainOf({}, { name: 'pd2', maxRounds: 1 })));
  const from = folderWith(real, names, over);
  for (const f of ['criteria.md', 'criteria.usage.json']) copyFileSync(join(real.run, f), join(from, f));
  const r = spawnSync(process.execPath, [cli, '--chain', 'pd2', '--task', 'tasks/x.md', '--from-run', from, ...extra], { cwd: w, encoding: 'utf8', env: ENV, timeout: 90_000 });
  return { r, w, from };
}
test('DP-12: the run-level `--from-run` hands the panel the first draft that WORKED (build-retry.md over a cut-off build.md), and says nothing when it passed nothing over', () => {
  // 0.8.3 exit 22: a finished run whose mock panel did not agree exits 22; this test is not about agreement (exit-not-agreed.test.js pins the rule), so it accepts the two finished exits.
  const { r, w } = secondRun(REAL.buildRescued, ['build.md', 'build-retry.md']);
  assert.ok([0, 22].includes(r.status), r.stdout + r.stderr);
  const run = join(w, 'runs', readdirSync(join(w, 'runs'))[0]);
  const deliverable = read(join(run, 'deliverable.md'));
  assert.match(deliverable, /MOCK DELIVERABLE for model mock-draft-cut-then-fits/, 'the retry reached the panel');
  assert.doesNotMatch(deliverable, /because it re\s*$/);
  assert.doesNotMatch(r.stderr, /--from-run: `/, 'a pick that passed nothing over prints no pass-over line');
});
test('DP-13: the run-level `--from-run` exits 2 naming build.md when the run has no build draft at all, and says what it needs when the drafts exist but are empty', () => {
  const none = secondRun(REAL.buildRescued, [], []);
  assert.equal(none.r.status, 2); assert.match(none.r.stderr, /--from-run: no such file: .*build\.md/);
  const empty = secondRun(REAL.buildRescued, [], [], { 'build.md': '' });
  assert.equal(empty.r.status, 2); assert.match(empty.r.stderr, /holds no first draft that can be read and is not empty \(build\.md, build-retry\.md\)/);
});

// the resume path is the second reader: a run started with `--from-run` that paused at an external seat, resumed after the earlier run's first draft changed on disk (a marker in build-retry.md), shows the marker in the next prompt
test('DP-14: a RESUMED `--from-run` run re-reads the earlier run\'s first draft the same way (build-retry.md over build.md)', () => {
  const w = join(base, `resume-${++n}`); mkdirSync(join(w, 'tasks'), { recursive: true }); mkdirSync(join(w, 'chains'));
  writeFileSync(join(w, 'tasks', 'x.md'), 'A mock task.');
  writeFileSync(join(w, 'chains', 'pdx.json'), JSON.stringify(chainOf({ reviser: { provider: 'external', model: 'claude-code-session' } }, { name: 'pdx' })));
  const from = folderWith(REAL.buildRescued, ['build.md', 'build-retry.md']);
  for (const f of ['criteria.md', 'criteria.usage.json']) copyFileSync(join(REAL.buildRescued.run, f), join(from, f));
  const first = spawnSync(process.execPath, [cli, '--chain', 'pdx', '--task', 'tasks/x.md', '--from-run', from], { cwd: w, encoding: 'utf8', env: ENV, timeout: 90_000 });
  assert.equal(first.status, 3, first.stdout + first.stderr);                                    // paused at the external reviser
  const runDir = join(w, 'runs', readdirSync(join(w, 'runs'))[0]);
  assert.match(read(join(runDir, 'NEEDS-revise-1.md')), /mock-draft-cut-then-fits/, 'the first start handed the retry');
  writeFileSync(join(from, 'build-retry.md'), '# RESUME MARKER draft\n');
  const again = spawnSync(process.execPath, [cli, '--resume', runDir], { cwd: w, encoding: 'utf8', env: ENV, timeout: 90_000 });
  assert.equal(again.status, 3, again.stdout + again.stderr);
  assert.match(read(join(runDir, 'NEEDS-revise-1.md')), /RESUME MARKER/, 'the resume re-read build-retry.md, not the cut-off build.md');
});

// the names read are the names a stage writes: nothing else in a folder is opened (the MCP from_run jail check lists exactly these files)
test('DP-15: a file no stage writes (build-full.md, final-full.md, revise-x.md) is never picked or read', () => {
  const dir = folderWith(REAL.buildRescued, ['build.md', 'build-retry.md'], { 'build-full.md': '# planted\n', 'final-full.md': '# planted\n', 'deep-dive-revise-full.md': '# planted\n', 'revise-x.md': '# planted\n' });
  assert.equal(pickDraft(dir).name, 'build-retry.md');
  assert.equal(pickBuildDraft(dir).name, 'build-retry.md');
});

// the banner's second sentence is "The run <reason>.": the reason of a run stopped by a cut-off draft or a refused task had no verb ("The run a draft was cut off at its token cap.")
test('DP-16: the banner of a run stopped by a cut-off draft, or by a refused task, reads as a sentence', () => {
  const cut = handoffWorkspace(REAL.buildRescued, ['build.md'], { 'STOPPED-truncated.json': JSON.stringify({ stage: 'build' }) });
  const r1 = handoff(cut);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(read(join(cut.rd, 'HANDOFF.md')), /> The run stopped because a draft was cut off at its token cap\. The panel did not sign off/);
  assert.match(r1.stdout, /\(the run stopped because a draft was cut off at its token cap: /, 'the console line says the same');
  const refused = handoffWorkspace(REAL.buildRescued, ['build.md'], { 'STOPPED-preflight.md': '# refused\n' });
  const r2 = handoff(refused);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(read(join(refused.rd, 'HANDOFF.md')), /> The run stopped because the task was refused before any stage\. The panel did not sign off/);
});

// the other half of "failed": a reply the PROVIDER ended with error / content_filter / refusal (chain.js draftIncomplete), not a cut-off
test('DP-17: a revise round the provider ended with an error twice (a REAL recorded stop) hands on the build; the same with a recorded refusal; each reason is named', () => {
  assert.equal(REAL.reviseErrorTwice.code, 17);
  const dir = folderWith(REAL.reviseErrorTwice, ['build.md', 'revise-1.md', 'revise-1-retry.md']);
  const pick = pickDraft(dir);
  assert.equal(pick.name, 'build.md');
  assert.deepEqual(pickNoteLines(pick), ['`revise-1-retry.md` ended with stop "error"; `revise-1.md` ended with stop "error"; `build.md` is handed on.']);
  // content_filter and refusal go through the same chain.js test: the recorded stop of one file is edited to "refusal" (the ONLY edit; disclosed, no mock model answers a draft seat with it)
  for (const f of ['revise-1.usage.json', 'revise-1-retry.usage.json']) {
    const rec = JSON.parse(read(join(dir, f))); rec.usage.stop = 'refusal'; writeFileSync(join(dir, f), JSON.stringify(rec));
  }
  assert.deepEqual(pickNoteLines(pickDraft(dir)), ['`revise-1-retry.md` ended with stop "refusal"; `revise-1.md` ended with stop "refusal"; `build.md` is handed on.']);
  // the same refusals on the ONLY draft: handed on, and said to be unfinished
  const only = folderWith(REAL.reviseErrorTwice, ['build.md']);
  const rec = JSON.parse(read(join(only, 'build.usage.json'))); rec.usage.stop = 'refusal'; writeFileSync(join(only, 'build.usage.json'), JSON.stringify(rec));
  assert.match(pickDraft(only).failed, /^ended with stop "refusal"$/);
});

// the run-level --from-run has no HANDOFF.md to carry a banner, so a first draft that every attempt failed to complete is refused (C&C ruling 13 Oct 2026)
test('DP-18: the run-level `--from-run` on a run whose every build attempt was cut off refuses with exit 2, naming each file and its recorded stop; nothing starts', () => {
  const { r, w } = secondRun(REAL.buildCutTwice, ['build.md', 'build-retry.md']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--from-run: .* holds no finished first draft: `build-retry\.md` was cut off at its output-token cap \(stop "length"\); `build\.md` was cut off at its output-token cap \(stop "length"\)\. No call was made\. Use --from-run on a run that finished a draft, or start a fresh run without it\./);
  assert.ok(!existsSync(join(w, 'runs')), 'no run folder was made');
  // the same folder with ONE finished attempt goes on (a control for the refusal's condition)
  const { r: ok } = secondRun(REAL.buildRescued, ['build.md', 'build-retry.md']);
  // 0.8.3 exit 22: a finished run whose mock panel did not agree exits 22; this test is not about agreement (exit-not-agreed.test.js pins the rule), so it accepts the two finished exits.
  assert.ok([0, 22].includes(ok.status), ok.stdout + ok.stderr);
});

// the same refusal on the resume path: a run started with --from-run paused at an external seat; the earlier run's build records now say every attempt failed; the resume refuses (the way out is a fresh run)
test('DP-19: a RESUMED `--from-run` run whose earlier run now has no finished first draft refuses with exit 2 (no call is made)', () => {
  const w = join(base, `resume-${++n}`); mkdirSync(join(w, 'tasks'), { recursive: true }); mkdirSync(join(w, 'chains'));
  writeFileSync(join(w, 'tasks', 'x.md'), 'A mock task.');
  writeFileSync(join(w, 'chains', 'pdx.json'), JSON.stringify(chainOf({ reviser: { provider: 'external', model: 'claude-code-session' } }, { name: 'pdx' })));
  const from = folderWith(REAL.buildRescued, ['build.md', 'build-retry.md']);
  for (const f of ['criteria.md', 'criteria.usage.json']) copyFileSync(join(REAL.buildRescued.run, f), join(from, f));
  const first = spawnSync(process.execPath, [cli, '--chain', 'pdx', '--task', 'tasks/x.md', '--from-run', from], { cwd: w, encoding: 'utf8', env: ENV, timeout: 90_000 });
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const runDir = join(w, 'runs', readdirSync(join(w, 'runs'))[0]);
  for (const f of ['build.usage.json', 'build-retry.usage.json']) { const rec = JSON.parse(read(join(from, f))); rec.usage.stop = 'length'; writeFileSync(join(from, f), JSON.stringify(rec)); }
  const again = spawnSync(process.execPath, [cli, '--resume', runDir], { cwd: w, encoding: 'utf8', env: ENV, timeout: 90_000 });
  assert.equal(again.status, 2, again.stdout + again.stderr);
  assert.match(again.stderr, /--from-run: .* holds no finished first draft: `build-retry\.md` was cut off at its output-token cap \(stop "length"\); `build\.md` was cut off at its output-token cap \(stop "length"\)\./);
});
