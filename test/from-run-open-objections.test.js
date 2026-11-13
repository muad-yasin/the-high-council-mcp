// 0.8.4 round 1, item 9a for `council handoff --from-run` (C&C's order after the commit of 9a/10a). Through the real CLI, $0: the ladder run of test/ladder-agreed-end-open.test.js (layer 1 objects to every draft, rated 5; the ladder starts pass 4 at layer 2;
// layers 2 and 3 sign off; the handling session answers good_to_build; the handoff seat stays external). Then `council handoff --from-run` is run on that folder: its handoff seat is the same external one, so the command writes the prompt it would send.
// What tells the case apart (not a wording pin): the rows of the open-objection block in the from-run prompt are the rows the run's own handoff prompt carried (same ids, same order, same rating in force, same problem), and their number is the report's
// signed_text.open_objections. RED on the tip: from-run passes no rows (0 of 3). The comparison is between two prompts the CLI wrote, never against a list typed here.
// Controls (derived from the same folder): the report with handoff_text.open_objections taken out (a report written before this field) gives the from-run prompt with no block, and the prompt with the record is longer by the block;
// the record validates against schemas/report-v1.json (no schema error names handoff_text); a run that ended with every judge signed off records none.
// A departure from the shipped chain: a copy under its own name (a9-ladder; the zero-spend scanner reads a shipped chain's name as a chain with real seats), prompt_cache and `extra` removed, every seat but the writer and the handoff a mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { answerBuildChecks } from './helpers/build-check.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');

let RUN = null;
function ladderRun() {
  if (RUN) return RUN;
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  delete c.prompt_cache;
  c.name = 'fr-ladder';
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', decider: 'mock-builder' };
  let q = 0;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser' || slot === 'handoff') continue;   // the writer and the handoff seat stay external: answered here
    s.model = slot === 'critics' ? (s.layer === 1 ? `mock-exch-support-keep-always-sev5-frq${q++}` : `mock-exch-support-keep-clean-frq${q++}`)
      : slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-fr-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', 'fr-ladder.json'), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', 'fr-ladder', '--task', 'tasks/x.md', '--max-usd', 'none']);
  let ownPrompt = null;
  for (let i = 0; i < 16 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+)(-full)?\.md$/.test(f));
    if (p.some(f => /^NEEDS-build-check-\d+\.md$/.test(f))) answerBuildChecks(R());
    else if (p.includes('NEEDS-handoff.md')) { ownPrompt = readFileSync(join(R(), 'NEEDS-handoff.md'), 'utf8'); writeFileSync(join(R(), 'handoff.md'), 'Status: ready_for_build\n\nBuild it.\n'); }
    else if (w) writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`);
    else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
  }
  RUN = { exit: r.status, dir: d, rd: R(), run, ownPrompt, report: JSON.parse(readFileSync(join(R(), 'report.json'), 'utf8')) };
  return RUN;
}

// the rows of the open-objection block as the prompt prints them: "- <id> (raised in layer N; rated 5.0 ...): <critic-claim>...</critic-claim>"
const rowsOf = text => text.split('\n').filter(l => /^- \S+ \(raised in layer/.test(l));

// `council handoff --from-run` on a copy of the run folder (its report.json optionally edited by `edit`): the prompt file the command writes for the external seat
function fromRunPrompt(edit) {
  const w = ladderRun();
  const runs = mkdtempSync(join(tmpdir(), 'thc-fr-copy-'));
  mkdirSync(join(runs, 'chains')); cpSync(join(w.dir, 'chains'), join(runs, 'chains'), { recursive: true });
  mkdirSync(join(runs, 'tasks')); cpSync(join(w.dir, 'tasks'), join(runs, 'tasks'), { recursive: true });
  const rd = join(runs, 'runs', w.rd.split('/').at(-1)); mkdirSync(join(runs, 'runs')); cpSync(w.rd, rd, { recursive: true });
  if (edit) { const rep = JSON.parse(readFileSync(join(rd, 'report.json'), 'utf8')); edit(rep); writeFileSync(join(rd, 'report.json'), JSON.stringify(rep)); }
  const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', rd], { cwd: runs, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: runs }, timeout: 180000 });
  const file = join(rd, 'handoff-from-run.prompt.md');
  let text = null; try { text = readFileSync(file, 'utf8'); } catch { /* none */ }
  return { status: r.status, out: `${r.stderr}${r.stdout}`, text };
}

function premise(w) {   // the shape of jobs 149/150/153: a ladder sign-off agreed on the handler's check with the whole panel not signed off, objections standing
  assert.equal(w.exit, 0, 'premise: the run ends');
  assert.equal(w.report.passed, false, 'premise: the whole panel did not sign off');
  assert.equal(w.report.ending?.kind, 'agreed', 'premise: the run ends agreed');
  assert.ok(w.report.ending.basis.includes('handler_check'), 'premise: on the handler\'s build check');
  assert.ok(w.ownPrompt, 'premise: the run asked its handoff seat (external, read at its pause)');
  assert.ok(w.report.signed_text.open_objections > 0, 'premise: objections stand at the end');
}

test('from-run 9a: the handoff prompt of `council handoff --from-run` lists the same open objections the run\'s own handoff prompt listed (ids, order, rating in force, problem), as many as the report counts', () => {
  const w = ladderRun();
  premise(w);
  const own = rowsOf(w.ownPrompt);
  assert.equal(own.length, w.report.signed_text.open_objections, 'premise: the run\'s own prompt lists one row for each objection that stands');
  const f = fromRunPrompt();
  assert.equal(f.status, 3, `from-run writes the prompt for the external seat and waits (exit 3; got ${f.status}: ${f.out.slice(-300)})`);
  assert.ok(f.text, 'the prompt file was written');
  assert.deepEqual(rowsOf(f.text), own, 'the same rows in the same order');
});

test('from-run 9a controls (same folder): the report with no record gives the prompt as it was; with the record the prompt is longer by the block; the record validates and holds the rows as the judges wrote them', () => {
  const w = ladderRun();
  premise(w);
  const before = fromRunPrompt(rep => { delete rep.handoff_text.open_objections; });
  assert.equal(before.status, 3);
  assert.deepEqual(rowsOf(before.text), [], 'a report written before the field: no rows, no block');
  const withRows = fromRunPrompt();
  assert.ok(withRows.text.length > before.text.length, 'the record adds the block');
  const added = withRows.text.split('\n').filter(l => /^- \S+ \(raised in layer/.test(l));
  assert.equal(added.length, w.report.signed_text.open_objections);
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(JSON.parse(readFileSync(join(repo, 'schemas', 'report-v1.json'), 'utf8')));
  validate(w.report);
  assert.deepEqual((validate.errors ?? []).filter(e => /handoff_text/.test(e.instancePath)).map(e => `${e.instancePath} ${e.message}`), [], 'no schema error names handoff_text');
  const rec = w.report.handoff_text.open_objections;
  assert.ok(Array.isArray(rec) && rec.length === w.report.signed_text.open_objections && rec.every(o => /^O-/.test(o.id) && o.severity === 5 && o.layer === 1 && typeof o.problem === 'string' && !/critic-claim/.test(o.problem)), 'the record holds id, layer, rating and the problem as the judge wrote it (no container)');
});
