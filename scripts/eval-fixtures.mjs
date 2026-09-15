#!/usr/bin/env node
// MLLM Coder v4 item 5 (relay/runs/2026-09-15T01-35-10-051Z/deliverable.md): a fixed, offline
// fixture set for scoring review verdicts, and the scorer itself.
//
// What this is: 10 one-file, one-hunk changes in fixtures/coder-gate-eval/cases/NN/ - base.js, a
// diff.patch against it (applied as target.js), a check.mjs test, and case.json naming whether the
// change is "buggy" or "clean". It produces a detection count on this fixed set, nothing more.
// What this is not: a measurement of how good any reviewer, panel or model is, or a comparison
// between them. No such claim is made or implied anywhere, and a count on 10 hand-written
// fixtures could not support one.
//
//   node scripts/eval-fixtures.mjs --self-test
//     Makes no model call and no network request. Checks every fixture is honest (the base passes
//     its test, the diff applies, and the result fails its test iff the case says "buggy"), then
//     checks the scorer against three mock verdict sets whose right answers are known.
//   node scripts/eval-fixtures.mjs --verdicts verdicts.json
//     Scores a verdict file an operator produced by hand (e.g. from a coder-gate run): an object
//     mapping every case id to "flag" or "pass". Never automated, never required.
//
// Needs git (for `git apply`, which works outside a repository) - applying a diff is delegated
// rather than parsed here, because a diff parser is a standing exclusion in this project.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = join(root, 'fixtures', 'coder-gate-eval', 'cases');
const VERDICTS = new Set(['flag', 'pass']);

export function loadCases(dir = CASES_DIR) {
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().map(id => {
    const c = JSON.parse(readFileSync(join(dir, id, 'case.json'), 'utf8'));
    if (c.id !== id) throw new Error(`case ${id}: case.json id is "${c.id}"`);
    if (c.expected !== 'buggy' && c.expected !== 'clean') throw new Error(`case ${id}: expected must be "buggy" or "clean", got "${c.expected}"`);
    return { ...c, dir: join(dir, id) };
  });
}

// NODE_TEST_CONTEXT is set when this script itself runs under `node --test` (test/eval-fixtures
// .test.js). Inherited, it makes the child test runner report to a parent that isn't listening
// instead of setting its own exit status, so a failing fixture would read as passing. Stripped.
function nodeTest(cwd) {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test', 'check.mjs'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  if (r.error) throw r.error;
  return r.status === 0;
}

// Applies one case in a temp dir and runs its test before and after. Every step is reported, so a
// fixture that fails to apply is visible as that, not as a "buggy" result.
export function runCase(c) {
  const work = mkdtempSync(join(tmpdir(), `eval-case-${c.id}-`));
  try {
    copyFileSync(join(c.dir, 'base.js'), join(work, 'target.js'));
    copyFileSync(join(c.dir, 'check.mjs'), join(work, 'check.mjs'));
    const basePasses = nodeTest(work);
    const apply = spawnSync('git', ['apply', join(c.dir, 'diff.patch')], { cwd: work, encoding: 'utf8' });
    if (apply.error) throw new Error(`git is required to apply fixture diffs: ${apply.error.message}`);
    const applies = apply.status === 0;
    const afterPasses = applies ? nodeTest(work) : null;
    return { basePasses, applies, afterPasses };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Every case must have a verdict - a missing one is an error, never silently counted as "pass".
export function scoreVerdicts(cases, verdicts) {
  const rows = cases.map(c => {
    const v = verdicts[c.id];
    if (!VERDICTS.has(v)) throw new Error(`verdict for case ${c.id} must be "flag" or "pass", got ${JSON.stringify(v)}`);
    const flagged = v === 'flag';
    return { id: c.id, expected: c.expected, flagged, correct: flagged === (c.expected === 'buggy') };
  });
  const count = pred => rows.filter(pred).length;
  return {
    rows,
    flagged: count(r => r.flagged),
    truePositives: count(r => r.flagged && r.expected === 'buggy'),
    falsePositives: count(r => r.flagged && r.expected === 'clean'),
    trueNegatives: count(r => !r.flagged && r.expected === 'clean'),
    falseNegatives: count(r => !r.flagged && r.expected === 'buggy'),
  };
}

function printScore(label, s) {
  console.log(`\n${label}`);
  console.log('  case  expected  verdict  matches');
  for (const r of s.rows) console.log(`  ${r.id.padEnd(4)}  ${r.expected.padEnd(8)}  ${(r.flagged ? 'flag' : 'pass').padEnd(7)}  ${r.correct ? 'yes' : 'no'}`);
  console.log(`  flagged ${s.flagged} | buggy flagged ${s.truePositives} | clean flagged ${s.falsePositives} | clean passed ${s.trueNegatives} | buggy passed ${s.falseNegatives}`);
}

export function selfTest(cases = loadCases()) {
  const failures = [];
  const buggy = cases.filter(c => c.expected === 'buggy').length;
  if (cases.length !== 10 || buggy !== 5) failures.push(`expected 10 cases split 5 buggy / 5 clean, found ${cases.length} with ${buggy} buggy`);

  console.log('Fixture integrity (base passes its test; diff applies; result fails iff buggy)');
  for (const c of cases) {
    const r = runCase(c);
    const ok = r.basePasses && r.applies && r.afterPasses === (c.expected === 'clean');
    console.log(`  ${c.id}  ${c.expected.padEnd(6)}  base ${r.basePasses ? 'pass' : 'FAIL'}  apply ${r.applies ? 'ok' : 'FAIL'}  after ${r.afterPasses === null ? '-' : r.afterPasses ? 'pass' : 'fail'}  ${ok ? 'ok' : 'BROKEN'}`);
    if (!ok) failures.push(`fixture ${c.id} is broken`);
  }

  const verdictsFrom = f => Object.fromEntries(cases.map(c => [c.id, f(c)]));
  const expectations = [
    ['mock verdicts: exactly the buggy cases flagged', verdictsFrom(c => (c.expected === 'buggy' ? 'flag' : 'pass')), { flagged: buggy, truePositives: buggy, falsePositives: 0, falseNegatives: 0 }],
    ['mock verdicts: always pass', verdictsFrom(() => 'pass'), { flagged: 0, truePositives: 0, falseNegatives: buggy }],
    ['mock verdicts: always flag', verdictsFrom(() => 'flag'), { flagged: cases.length, falsePositives: cases.length - buggy, trueNegatives: 0 }],
  ];
  for (const [label, verdicts, want] of expectations) {
    const s = scoreVerdicts(cases, verdicts);
    printScore(label, s);
    for (const [k, v] of Object.entries(want)) if (s[k] !== v) failures.push(`${label}: ${k} is ${s[k]}, expected ${v}`);
  }

  console.log(failures.length ? `\nSELF-TEST FAILED\n- ${failures.join('\n- ')}` : '\nself-test passed');
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exit(selfTest().length ? 1 : 0);
  }
  const i = args.indexOf('--verdicts');
  if (i !== -1 && args[i + 1] && existsSync(args[i + 1])) {
    printScore(`verdicts from ${args[i + 1]}`, scoreVerdicts(loadCases(), JSON.parse(readFileSync(args[i + 1], 'utf8'))));
    process.exit(0);
  }
  console.error('usage: node scripts/eval-fixtures.mjs --self-test | --verdicts <file.json>');
  process.exit(2);
}
