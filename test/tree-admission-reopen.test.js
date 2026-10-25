// D2 F9 with D3 F9-1 (B14a/b, B12g): a child its approved preview admitted and that registration then refuses (a limit or the budget moved) makes the frontier wait for a new approval (the reopen line admission_changed); a child
// not admitted for budget names the cap raise (S7 on the frontier screen, S8/S8b in readiness, A-DRAFT); and a sitting with nothing to do while an approved child waits for money says so and exits 20, never a "done" 0.
// Real verbs on all-mock chains, $0; the plans are drafts handed to each run (api.run's `draft`). approvePending (test/helpers/sitting.js) writes the approval through the table, as the fixtures of the other tree tests do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sittingLines, exitCodeOf } from '../src/tree-resume.js';
import { decideHandler } from '../src/tree-decide.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { readinessOf } from '../src/tree-ready.js';
import { runTree } from '../src/tree-run.js';
import { DEFAULT_LIMITS, readTreeRecord } from '../src/tree-record.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { block3, ownQuestions, plan3 } from './helpers/split-fixture.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';


test('T9 (F9a + F13b, B14b): two split children\'s frontiers approved before any sitting, each preview admitting its children against today\'s run count; registration then refuses one for the run limit -> that frontier waits for approval again (admission_changed), its new preview shows the child "not admitted: run limit", and the limit raise reaches its gate', { timeout: 900_000 }, async () => {
  const r = await trackedRealRoot({ ...splitChildren(), limits: { ...DEFAULT_LIMITS, maxRuns: 8 } });
  writeFileSync(join(r.t.work, 'm1-plan.md'), plan3(ownQuestions(block3())));                 // R/M1 splits (K1 carries an obligation: criteria C1..C3)
  const m3Block = ownQuestions(block3()); m3Block.classes = m3Block.classes.filter(c => c.id !== 'C3'); for (const c of m3Block.children) c.inherits = c.inherits.map(x => (x === 'C3' ? 'C2' : x));
  writeFileSync(join(r.t.work, 'm3-plan.md'), plan3(m3Block));                                // R/M3 splits (K3: criteria C1..C2)
  const start = draftStarter(r, { 'R/M1': 'm1-plan.md', 'R/M3': 'm3-plan.md' });
  const kinds = (...names) => readTreeRecord(r.t.rootDir).events.filter(e => names.includes(e.event));
  approvePending(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });              // R/M1 and R/M3 run and split; their frontiers wait
  assert.ok(kinds('split_verified').some(e => e.node === 'R/M1') && kinds('split_verified').some(e => e.node === 'R/M3'), JSON.stringify(first).slice(0, 400));
  approvePending(r); approvePending(r);                                                         // both approved before any sitting: each preview admitted against today's run count
  const run = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const reopen = kinds('blocked').filter(e => e.check === 'admission_changed');
  assert.ok(reopen.length >= 1, `a child an approved preview admitted was refused at registration: ${JSON.stringify(run).slice(0, 400)}`);
  // CR-RC-004 (RULE 1c): the sitting that meets the refusal prints its way on in that line (sittingLines is what `tree resume` prints)
  assert.equal(run.status, 'refused', JSON.stringify(run).slice(0, 400));
  assert.match(sittingLines(run, ROOT_ID).join('\n'), /was not registered \(admission_changed\): .*not admitted: run limit \([^)]*\); run `council tree approve` again/);
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.equal(pending?.key, reopen.at(-1).frontierKey, 'that frontier waits for a new approval');
  const view = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending }).view;
  assert.ok((view.children ?? []).some(c => !c.registered && c.admitted === false && /not admitted: run limit/.test(c.notAdmittedReason ?? '')), JSON.stringify(view.children));
  const io = terminal(['9', 'n']); const timer = setTimeout(() => io.stdin.end(), 8000);
  await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'max-runs': '9' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  assert.match(io.shown() + io.errors(), /Raise maxRuns from 8 to 9/, io.shown() + io.errors());
});

test('S7 + S8b + F9-1: a child not admitted for budget names the cap raise on the frontier screen; once the frontier is approved readiness names it on the unexpanded milestone, and a sitting with nothing else to do prints the way on and exits 20', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), cap: 10 });                         // an equal share of the free money is under the child chain's cheapest end
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  const notAdmitted = (d.view.children ?? []).filter(c => c.admitted === false);
  assert.ok(notAdmitted.length, JSON.stringify(d.view.children));
  for (const c of notAdmitted) assert.match(c.notAdmittedReason ?? c.reason ?? '', /not admitted: budget \(.*; you can raise the tree's cap with council tree decide \S+ --amend-cap <total>\)/);
  approvePending(r);
  const reasons = readinessOf(r.t.rootDir, { work: r.t.work }).reasons.filter(x => x.code === 'unexpanded');
  assert.ok(reasons.some(x => /\(it was not admitted for budget: raise the tree's cap with `council tree decide \S+ --amend-cap <total>`, then `council tree approve \S+` offers it again\)/.test(x.text)), JSON.stringify(reasons));
  const out = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out).slice(0, 400));
  assert.ok((out.refusedForBudget ?? []).length, 'the sitting carries what waits for money');
  assert.match(sittingLines(out, ROOT_ID).join('\n'), /was approved but not admitted for budget: raise the tree's cap with `council tree decide \S+ --amend-cap <total>`/);
  assert.equal(exitCodeOf(out), 20);
});
