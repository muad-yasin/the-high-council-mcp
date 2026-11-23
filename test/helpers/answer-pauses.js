// 0.8.4 HS (Muad 05 Nov 2026: every layered chain needs a handling session): a test that drives a layered chain through the CLI with its reviser seat EXTERNAL meets a pause (exit 3, NEEDS-<label>.md) at every revision. This answers them
// the way a session does (the stage-file protocol every external seat uses: write <label>.md beside NEEDS-<label>.md) and resumes, until the run ends in anything but a pause. Not a test file.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITER_STAGE = /^(skeleton|build|revise-\d+|handoff)$/;   // the stage labels of chain.js (3682 skeleton, 4119 build, 6007 revise-<round>, handoff)
/** Answers every NEEDS-<label>.md of a writer stage that has no <label>.md with a plain plan (`text`, or one that names the stage). A build-check pause is not answered here (build-check.js's answerBuildChecks does that). Returns how many it answered. */
export function answerPauses(runDir, text = null) {
  let n = 0;
  for (const f of readdirSync(runDir)) {
    const m = /^NEEDS-(.+)\.md$/.exec(f);
    if (!m || !WRITER_STAGE.test(m[1]) || existsSync(join(runDir, `${m[1]}.md`))) continue;   // only the session's writer stages: never a question to the person (a conflict stop is exit 25, not a pause), a build check or the artifacts block
    writeFileSync(join(runDir, `${m[1]}.md`), text ?? `# A plan\n\nThe session's answer to ${m[1]}.\n`);   // distinct per stage, so two revisions are never the same text
    n += 1;
  }
  return n;
}

/**
 * `first` is what the start returned (an object with `code` or `status`); while it is a pause (3) and a pause could be answered, answer it and `--resume`. `run(args)` is the test's own spawn wrapper (sync or async).
 * `runDir` is the run folder or a function that finds it. Returns the last result: the end of the run, or a pause nothing here can answer.
 */
export async function resumeThroughPauses(run, runDir, first, { text, max = 40 } = {}) {
  let r = first;
  for (let i = 0; i < max && (r.code ?? r.status) === 3; i++) {
    const dir = typeof runDir === 'function' ? runDir() : runDir;
    if (!existsSync(dir) || answerPauses(dir, text) === 0) break;
    r = await run(['--resume', dir]);
  }
  return r;
}
