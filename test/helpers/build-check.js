// 0.8.4 S4 (M1): the build-check wording is ONE held read (buildCheckSystem + buildCheckUser; the reasons note rides with them) that gates BOTH the build check AND the `ending` record, which for a run with no handling session says "agreed, no build check" (C&C's Q-a ADDENDUM and copy correction 11, src/build-check.js buildCheckLive).
// A test that needs the recorded state merges CHECK into its held map (`{ ...DEMAND, ...CHECK }`); a test that must keep today's ending whatever src/roles.js records merges NO_CHECK. `answer()` writes a handler's answer, for a cache script or for the run folder's `build-check-<n>.md`.
import * as HB084 from '../held-prompts/held-084-b.js';

/** The held map that puts the build check and the `ending` record in force. */
export const CHECK = Object.freeze({ buildCheckSystem: HB084.buildCheckSystem, buildCheckUser: HB084.buildCheckUser, buildCheckReasonsNote: HB084.buildCheckReasonsNote, buildCheckRefusalNote: HB084.buildCheckRefusalNote });
/** The held map that keeps them OUT, whatever src/roles.js records. */
export const NO_CHECK = Object.freeze({ buildCheckSystem: undefined, buildCheckUser: undefined, buildCheckReasonsNote: undefined, buildCheckRefusalNote: undefined });
/** The text of a handler's answer: JSON { answer, reasons }. */
export const answer = (a, reasons = '') => JSON.stringify({ answer: a, reasons });

// ---- family 2 (an external-writer run that now waits at the build check): the test-only handler answer (C&C's ruling of 4 Nov 2026) ----
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Answers every build check the run is waiting at: for each NEEDS-build-check-<n>.md with no build-check-<n>.md it writes good_to_build with a reason that names every objection id the check lists (a test-only handler, the shape of the answer
 * CA4 asks for). Returns how many it answered (0 = the run is waiting for something else).
 */
export function answerBuildChecks(runDir, { answer: a = 'good_to_build', note = 'The build can do it.' } = {}) {
  let n = 0;
  for (const f of readdirSync(runDir)) {
    const m = /^NEEDS-build-check-(\d+)\.md$/.exec(f);
    if (!m || existsSync(join(runDir, `build-check-${m[1]}.md`))) continue;
    const ids = [...new Set([...readFileSync(join(runDir, f), 'utf8').matchAll(/^- ([OL]-[0-9a-f]{8}(?:#r?\d+)?) \(/gm)].map(x => x[1]))];
    writeFileSync(join(runDir, `build-check-${m[1]}.md`), answer(a, ids.length ? `${ids.map(id => `${id}: ${note}`).join(' ')}` : (a === 'not_yet' ? note : '')));
    n += 1;
  }
  return n;
}
/**
 * Runs a CLI command through every build check: `run(args)` is the test's own spawn wrapper, `runDir()` the run folder. While the run exits 3 at a build check it is answered (answerBuildChecks) and resumed; any other end, or a pause for something else,
 * is returned as it came. The answer is good_to_build, so an escalated or ladder sign-off now ends AGREED (exit 0, `ending` agreed, `passed` false).
 */
export function runThroughChecks(run, args, runDir, opts = {}) {
  let r = run(args);
  for (let i = 0; i < 20 && r.status === 3 && existsSync(runDir()) && answerBuildChecks(runDir(), opts) > 0; i++) r = run(['--resume', runDir()]);
  return r;
}
