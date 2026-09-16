// Bug-audit fix, 2026-09-16: src/cli.js's `--resume` silently dropped the `--from-run`-handed
// draft and built a brand-new one instead of reviewing the original - defeating `--from-run`'s
// whole purpose for any run paused on an external seat. Root cause: `resumeMeta.fromRun` (read
// from run.json) was used to restore `config.criteria` on resume, but never to restore
// `handedDraft` - so a resumed process's `draft` variable stayed null, took the "build for real"
// branch instead of "build (skipped - reviewing a draft handed in)", and (since the builder seat
// is external in every affected chain shape) paused fresh on a brand-new "build" stage nobody
// had ever seen or answered.
//
// Reproduction, end to end via the real CLI (execFileSync, same technique as
// test/spans-cli.test.js): a completed run (chains/mock.json) hands its build.md as the draft to
// a second run (an external-builder/external-handoff chain) via --from-run - the ORIGINAL
// invocation already exercises the "skip build" path and pauses at the external "handoff" stage.
// The bug only shows up on the SECOND, --resume'd process (a fresh node invocation reading
// run.json cold) - proven here by asserting a resumed run reaches handoff again (never a fresh
// "build" pause) and completes with a deliverable byte-identical to the handed draft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

const EXTERNAL_HANDOFF_CHAIN = {
  name: 'test-external-handoff',
  maxRounds: 2,
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'external', model: 'claude-code-session' },
    reviser: { provider: 'external', model: 'claude-code-session' },
    critics: [
      { provider: 'mock', model: 'mock-critic-passer' },
      { provider: 'mock', model: 'mock-critic-passer' },
    ],
  },
  handoff: true,
};

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), 'from-run-resume-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', 'test-external-handoff.json'), JSON.stringify(EXTERNAL_HANDOFF_CHAIN, null, 2));
  return dir;
}

function run(cliArgs, dir) {
  try {
    return { code: 0, out: execFileSync('node', [cli, ...cliArgs], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function onlyRunId(dir) {
  return readdirSync(join(dir, 'runs'))[0];
}

test('a run paused on an external seat, after --resume, still reviews the --from-run-handed draft rather than building a new one', () => {
  const dir = freshDir();

  // Run 1: a plain, fully-mock chain that completes normally - the source of the handed draft.
  const run1 = run(['--chain', 'mock', '--task', 'tasks/x.md'], dir);
  assert.equal(run1.code, 0, `run1 should complete cleanly: ${run1.out}`);
  const run1Id = onlyRunId(dir);
  const run1BuildMd = readFileSync(join(dir, 'runs', run1Id, 'build.md'), 'utf8');

  // Run 2: hands run1's build.md as its draft, via --from-run. The builder is external, so with
  // the draft correctly skipping the build stage, this pauses at "handoff" (also external),
  // never at "build" - confirming the ORIGINAL invocation's own skip-build path works.
  const run2Start = run(['--chain', 'test-external-handoff', '--task', 'tasks/x.md', '--from-run', `runs/${run1Id}`], dir);
  assert.equal(run2Start.code, 3, `run2's first invocation should pause (exit 3): ${run2Start.out}`);
  assert.match(run2Start.out, /PAUSED: stage "handoff" is an external seat/, 'the original invocation must pause at handoff, not build');
  const run2Id = readdirSync(join(dir, 'runs')).find(id => id !== run1Id);
  assert.ok(!existsSync(join(dir, 'runs', run2Id, 'NEEDS-build.md')), 'no NEEDS-build.md after the original invocation - build was correctly skipped');

  // Answer the external handoff stage, then resume - a FRESH node process, reading run.json cold.
  writeFileSync(join(dir, 'runs', run2Id, 'handoff.md'), 'External handoff reply text.');
  const resumed = run(['--resume', `runs/${run2Id}`], dir);

  assert.equal(resumed.code, 0, `resume should complete cleanly, not pause again: ${resumed.out}`);
  assert.match(resumed.out, /Round 1: build \(skipped - reviewing a draft handed in\)/,
    'the RESUMED process must also skip build - this is the line the bug removed');
  assert.ok(!existsSync(join(dir, 'runs', run2Id, 'NEEDS-build.md')),
    'the resumed process must never pause on a brand-new "build" stage nobody answered - this is the bug\'s exact symptom');

  const deliverable = readFileSync(join(dir, 'runs', run2Id, 'deliverable.md'), 'utf8');
  assert.equal(deliverable, run1BuildMd, 'the completed run\'s deliverable must be byte-identical to the handed draft - proof the panel reviewed the ORIGINAL draft, not a freshly built one');
});

test('regression guard: a resumed run with an explicit --draft (not --from-run alone) is unaffected - draftPath already worked before this fix', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'my-draft.md'), 'MOCK DELIVERABLE for model mock-builder\n\nBody text.');

  const run2Start = run(['--chain', 'test-external-handoff', '--task', 'tasks/x.md', '--draft', 'my-draft.md'], dir);
  assert.equal(run2Start.code, 3);
  const run2Id = onlyRunId(dir);

  writeFileSync(join(dir, 'runs', run2Id, 'handoff.md'), 'External handoff reply text.');
  const resumed = run(['--resume', `runs/${run2Id}`], dir);
  assert.equal(resumed.code, 0, `resume should complete cleanly: ${resumed.out}`);
  assert.match(resumed.out, /Round 1: build \(skipped - reviewing a draft handed in\)/);
});
