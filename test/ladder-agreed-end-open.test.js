// 0.8.4 round 1, items 9a and 10a (his answers 9:a and 10:a, 12 Nov 2026). Through the real CLI, $0: the ladder run of test/a1-ladder-sign-off.test.js (layer 1 objects to every draft, rated 5; the ladder starts pass 4 at layer 2;
// layers 2 and 3 sign off; the handling session answers good_to_build), with the handoff seat left external so the test reads the handoff PROMPT at its pause and answers it. One run, three rows. Departures from the shipped chain:
// a copy under its own name (a9-ladder; the zero-spend scanner reads a shipped chain's name as a chain with real seats), prompt_cache and `extra` removed, every seat but the writer and the handoff a mock, as in a1.
// What tells the case apart (not a wording pin):
//   9a  the handoff prompt carries exactly one row for each objection that stands (the report's signed_text.open_objections): its id, the rating in force, the problem inside a claim container. On the tip no such row is in the prompt (job 153).
//   10a the row of layer 1 in pass 4 (below the layer the ladder started the pass at) has state not_asked AND floor_by 'ladder'; the rows of layers 2 and 3 in passes 1-3 (above an objecting layer 1) have no floor_by.
//   no schema error in the report names a layers[] row (the floor_by enum gained 'ladder'); an error elsewhere in the report is not this test's.
// Controls (pure, no run): a prompt built with no open objections is byte for byte the prompt without the new argument; the block is built only from what the caller passes, one row each. The wording of the lead sentence and of the row is not pinned here: the scripted compare of the words reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { answerBuildChecks } from './helpers/build-check.js';
import { handoffPrompt } from '../src/handoff-prompt.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');

let RUN = null;
function ladderRun() {
  if (RUN) return RUN;
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  delete c.prompt_cache;
  c.name = 'a9-ladder';   // a copy under its own name: every seat of it is mock or external, and no-paid-chain-spawn reads a shipped chain's name as a chain with real seats
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', decider: 'mock-builder' };
  let q = 0;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser' || slot === 'handoff') continue;   // the writer and the handoff seat stay external: answered here
    s.model = slot === 'critics' ? (s.layer === 1 ? `mock-exch-support-keep-always-sev5-a9q${q++}` : `mock-exch-support-keep-clean-a9q${q++}`)
      : slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-a9-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', 'a9-ladder.json'), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', 'a9-ladder', '--task', 'tasks/x.md', '--max-usd', 'none']);
  let handoffPromptText = null; const buildCheckPrompts = [];
  const steps = [];
  for (let i = 0; i < 16 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+)(-full)?\.md$/.test(f));
    steps.push(p.join(','));
    if (p.some(f => /^NEEDS-build-check-\d+\.md$/.test(f))) { for (const f of p.filter(f => /^NEEDS-build-check-\d+\.md$/.test(f))) buildCheckPrompts.push(readFileSync(join(R(), f), 'utf8')); answerBuildChecks(R()); }
    else if (p.includes('NEEDS-handoff.md')) { handoffPromptText = readFileSync(join(R(), 'NEEDS-handoff.md'), 'utf8'); writeFileSync(join(R(), 'handoff.md'), 'Status: ready_for_build\n\nBuild it.\n'); }
    else if (w) writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`);
    else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
  }
  const report = JSON.parse(readFileSync(join(R(), 'report.json'), 'utf8'));
  RUN = { exit: r.status, report, handoffPromptText, buildCheckPrompts, steps };
  return RUN;
}

// the rows of the build check's own form: "- <id> (raised in layer N; rated 5.0 ...): <critic-claim>"
const rowIds = text => [...text.matchAll(/^- (\S+) \(raised in layer (\d)/gm)].map(m => m[1]);

function premise(w) {   // the printed shape of jobs 149/150/153: a ladder sign-off agreed on the handler's check with the whole panel not signed off
  assert.equal(w.exit, 0, `premise: the run ends (steps: ${w.steps.join(' | ')})`);
  assert.equal(w.report.passed, false, 'premise: the whole panel did not sign off');
  assert.equal(w.report.ending?.kind, 'agreed', 'premise: the run ends agreed');
  assert.ok(w.report.ending.basis.includes('handler_check'), 'premise: on the handler\'s build check');
  assert.equal(w.report.escalated_signoff?.ladder, true, 'premise: a ladder sign-off');
  assert.ok(w.handoffPromptText, 'premise: the handoff seat was asked (external, read at its pause)');
  assert.ok(w.buildCheckPrompts.length > 0, 'premise: the handler was asked for its build check');
}

test('9a: a run agreed on the handler\'s check with objections open gives the handoff prompt one row for each objection that stands at the end (id, rating in force, problem in a claim container)', () => {
  const w = ladderRun();
  premise(w);
  const n = w.report.signed_text.open_objections;   // the count the block is built from (standingAtEnd): the same number the report records
  assert.ok(n > 0, 'premise: objections stand at the end');
  const shown = new Set(w.buildCheckPrompts.flatMap(rowIds));
  const rows = w.handoffPromptText.split('\n').filter(l => /^- \S+ \(raised in layer/.test(l));
  assert.equal(rows.length, n, 'one row in the handoff prompt for each objection that stands');
  const ids = rows.map(l => l.match(/^- (\S+) \(/)[1]);
  assert.equal(new Set(ids).size, n, 'no id twice');
  for (const id of ids) assert.ok(shown.has(id), `${id} is one the handler was shown in its build check`);
  for (const l of rows) {
    assert.match(l, /rated 5/, 'the rating in force shows');
    assert.match(l, /<critic-claim>[\s\S]+<\/critic-claim>/, 'the problem is inside a claim container');
  }
});

test('10a: the layer-1 row of the pass the ladder started at layer 2 says why it was not asked (floor_by ladder, state not_asked); the rows above an objecting layer 1 do not carry it; the report still validates', () => {
  const w = ladderRun();
  premise(w);
  const rows = w.report.layers;
  const last = Math.max(...rows.map(r => r.round));
  const below = rows.filter(r => r.round === last && r.layer === 1);
  assert.equal(below.length, 1, 'premise: layer 1 has a row in the last pass');
  assert.equal(below[0].state, 'not_asked', 'the state stays not_asked: its readers are unchanged');
  assert.equal(below[0].floor_by, 'ladder', 'the row below the layer the ladder started the pass at says so');
  const above = rows.filter(r => r.round < last && r.layer > 1);
  assert.ok(above.length > 0 && above.every(r => r.state === 'not_asked'), 'premise: layers 2 and 3 above an objecting layer 1 were not asked in passes 1 to 3');
  assert.deepEqual(above.filter(r => r.floor_by !== undefined), [], 'a layer not asked because a layer below objected is not marked');
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });   // as test/report-schema.test.js does: the schema's own annotation keyword
  const validate = ajv.compile(JSON.parse(readFileSync(join(repo, 'schemas', 'report-v1.json'), 'utf8')));
  validate(w.report);
  assert.deepEqual((validate.errors ?? []).filter(e => /\/layers\//.test(e.instancePath)).map(e => `${e.instancePath} ${e.message}`), [], 'no schema error names a layers[] row');
});

test('9a controls (pure): no open objections passed = the prompt is byte for byte what it was; with rows the prompt as it was comes first and each row is added once', () => {
  const config = JSON.parse(readFileSync(join(repo, 'chains', 'mock.json'), 'utf8'));
  const base = { config, request: 'Plan X.', draft: '# Plan\n\nDo X.\n', planFile: 'PLAN.md', checks: '', criteria: [] };
  const plain = handoffPrompt(base);
  assert.deepEqual(handoffPrompt({ ...base, openObjections: null }), plain);
  assert.deepEqual(handoffPrompt({ ...base, openObjections: [] }), plain);
  const rows = [{ id: 'O-1', layer: 1, severity: 5, problem: 'p one' }, { id: 'O-2', layer: 2, severity: null, problem: 'p two' }];
  const withRows = handoffPrompt({ ...base, openObjections: rows });
  assert.equal(withRows.system, plain.system, 'no system sentence is added');
  assert.ok(withRows.user.startsWith(plain.user), 'the prompt as it was comes first');
  const added = withRows.user.slice(plain.user.length);
  assert.deepEqual(rowIds(added), ['O-1', 'O-2']);
  const [one, two] = added.split('\n').filter(l => l.startsWith('- '));
  assert.ok(/rated 5/.test(one) && !/not rated/.test(one) && one.includes('<critic-claim>p one</critic-claim>'), 'a rated objection shows its rating, its problem in a claim container');
  assert.ok(/not rated/.test(two) && two.includes('<critic-claim>p two</critic-claim>'), 'an objection with no rating says so');
});
