// 0.8.4 round 1, A1 (the ladder sign-off ending read on the BOARD). Through the real CLI, $0: a ladder run whose top layer signs off while layer 1's rated-5 objection is open, and the handling session
// answers good_to_build. The shipped chain (chains/plan-mini-council.json: the ladder from its key, credit 0) with mock judges: layer 1 objects to every draft (rated 5), layers 2 and 3 sign off with a full table;
// the writer (builder and reviser) stays external, answered here. Departures from the shipped chain: the copy is written and started under its own name, a1-ladder (the zero-spend scanner reads a shipped chain's name as a chain with real seats); prompt_cache and every extra deleted; proposers, criteria, skeleton, handoff and decider are mock seats; the judges are mock-exch
// seats by layer. Expected path: layer 1 objects in passes 1-3 (the block), pass 4 starts at layer 2, layer 2 signs off, layer 3 signs off, layer 1 is not asked.
// What tells the case apart (not a wording pin): the BOARD's signed-and-delivered section of an AGREED ending (ending.kind agreed on the handler's check) does not use the "not accepted" form, and the block above the plan is named
// as the ladder's (escalated_signoff.ladder), not as a stall escalation's. The controls are the unsigned non-agreed run (test/signed-vs-delivered.test.js keeps "Not accepted") and the pure rows in test/text-labels.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerBuildChecks } from './helpers/build-check.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');

function ladderRun() {
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  delete c.prompt_cache;
  c.name = 'a1-ladder';   // a copy under its own name: every seat of it is mock or external, and no-paid-chain-spawn reads a shipped chain's name as a chain with real seats
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', handoff: 'mock-builder', decider: 'mock-builder' };
  let q = 0;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser') continue;   // the writer stays external
    s.model = slot === 'critics' ? (s.layer === 1 ? `mock-exch-support-keep-always-sev5-a1q${q++}` : `mock-exch-support-keep-clean-a1q${q++}`)
      : slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-a1-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', 'a1-ladder.json'), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', 'a1-ladder', '--task', 'tasks/x.md', '--max-usd', 'none']);
  for (let i = 0; i < 12 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+)(-full)?\.md$/.test(f));
    if (p.some(f => /^NEEDS-build-check-\d+\.md$/.test(f))) answerBuildChecks(R());
    else if (w) writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`);
    else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
  }
  const read = f => readFileSync(join(R(), f), 'utf8');
  return { exit: r.status, report: JSON.parse(read('report.json')), board: read('BOARD.md') };
}

test('A1: a ladder sign-off agreed on the handler\'s build check (the panel did not sign off): the BOARD does not call it "not accepted", and names the ladder\'s block as the ladder\'s', () => {
  const w = ladderRun();
  // premise: the ladder shape of the job that printed it (agreed on the handler's check, passed false, layer 1 not asked in the last pass)
  assert.equal(w.exit, 0);
  assert.equal(w.report.passed, false, 'premise: the whole panel did not sign off');
  assert.equal(w.report.ending?.kind, 'agreed', 'premise: the run ends agreed');
  assert.ok(w.report.ending.basis.includes('handler_check'), 'premise: on the handler\'s build check');
  assert.equal(w.report.escalated_signoff?.ladder, true, 'premise: a ladder sign-off');
  assert.deepEqual(w.report.delivered_text.harness_notes, ['escalated_signoff_block'], 'premise: the harness block sits above the plan');
  const section = w.board.slice(w.board.indexOf('## Signed text and delivered text'));
  assert.ok(w.board.includes('## Signed text and delivered text'), 'the section is on the board');
  const first = section.split('\n\n')[1];
  assert.doesNotMatch(first, /Not accepted/, 'an agreed ending is not "not accepted"');
  assert.doesNotMatch(section.split('\n## ')[0], /the escalated sign-off block/, 'the ladder\'s block is not named as a stall escalation\'s');
});
