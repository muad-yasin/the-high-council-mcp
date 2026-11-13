// 0.8.4 round 1, A1-1 (the headline words of a ladder sign-off that the handler's build check ended agreed). Through the real CLI, $0: the ladder run of test/ladder-agreed-end-open.test.js (layer 1 objects to every draft, rated 5; the ladder starts pass 4
// at layer 2; layers 2 and 3 sign off; the handling session answers good_to_build). A copy of the shipped chain under its own name (a11-ladder; the zero-spend scanner reads a shipped chain's name as a chain with real seats), prompt_cache and `extra`
// removed, every seat but the writer and the handoff a mock. What tells the case apart (not a wording pin): the sentence the report's own readers print for this ending (agreedAfterEscalationWords, which the headline, the status line and the
// terminal verdict print) does not say that objections were PASSED UP when the record shows nothing was (report.escalations is empty and escalated_signoff.ladder is true), and it names the layers escalated_signoff.below lists.
// Controls (derived from the same report, one field edited): without `ladder` (a stall escalation's sign-off) the sentence still says objections were passed up; a request's sign-off keeps its own sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerBuildChecks } from './helpers/build-check.js';
import { agreedAfterEscalationWords, verdictHeadline } from '../src/verdict-headline.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');

let RUN = null;
function ladderRun() {
  if (RUN) return RUN;
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  delete c.prompt_cache;
  c.name = 'a11-ladder';
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', decider: 'mock-builder' };
  let q = 0;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser' || slot === 'handoff') continue;   // the writer and the handoff seat stay external: answered here
    s.model = slot === 'critics' ? (s.layer === 1 ? `mock-exch-support-keep-always-sev5-a11q${q++}` : `mock-exch-support-keep-clean-a11q${q++}`)
      : slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-a11-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', 'a11-ladder.json'), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', 'a11-ladder', '--task', 'tasks/x.md', '--max-usd', 'none']);
  for (let i = 0; i < 16 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+)(-full)?\.md$/.test(f));
    if (p.some(f => /^NEEDS-build-check-\d+\.md$/.test(f))) answerBuildChecks(R());
    else if (p.includes('NEEDS-handoff.md')) writeFileSync(join(R(), 'handoff.md'), 'Status: ready_for_build\n\nBuild it.\n');
    else if (w) writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`);
    else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
  }
  RUN = { exit: r.status, report: JSON.parse(readFileSync(join(R(), 'report.json'), 'utf8')) };
  return RUN;
}

function premise(w) {   // a ladder sign-off agreed on the handler's check, the whole panel not signed off, and nothing passed up
  assert.equal(w.exit, 0, 'premise: the run ends');
  const rep = w.report;
  assert.equal(rep.passed, false, 'premise: the whole panel did not sign off');
  assert.equal(rep.ending?.kind, 'agreed', 'premise: the run ends agreed');
  assert.equal(rep.escalated_signoff?.ladder, true, 'premise: a ladder sign-off');
  assert.ok(Array.isArray(rep.escalated_signoff.below) && rep.escalated_signoff.below.length > 0, 'premise: a layer was not asked in that pass');
  assert.deepEqual(rep.escalations ?? [], [], 'premise: nothing was passed up in this run');
}

test('A1-1: the words of a ladder sign-off that the handler agreed do not say objections were passed up (the record shows none) and name the layers the pass did not ask', () => {
  const w = ladderRun();
  premise(w);
  const words = agreedAfterEscalationWords(w.report);
  assert.ok(typeof words === 'string' && words.length > 0, 'the case has words');
  assert.doesNotMatch(words, /passed up/, 'nothing was passed up in a ladder sign-off');
  assert.ok(words.includes(`layer ${w.report.escalated_signoff.below.join(', ')}`), `it names the layers the pass did not ask (${w.report.escalated_signoff.below.join(', ')})`);
  const head = verdictHeadline(w.report);
  assert.equal(head.label, 'AGREED');
  assert.equal(head.words, words, 'the headline prints the same sentence');
});

test('A1-1 controls (derived from the same report, one field edited): without `ladder` the sentence still says objections were passed up; a request\'s sign-off keeps its own sentence', () => {
  const w = ladderRun();
  premise(w);
  const stall = JSON.parse(JSON.stringify(w.report)); delete stall.escalated_signoff.ladder;
  assert.match(agreedAfterEscalationWords(stall), /signed off after objections were passed up/, 'a stall escalation\'s sign-off is as it was');
  const request = JSON.parse(JSON.stringify(w.report)); delete request.escalated_signoff.ladder; request.escalated_signoff.requested = true;
  assert.match(agreedAfterEscalationWords(request), /a pass that was asked to start at layer 3/, 'a request\'s sign-off is as it was');
});
