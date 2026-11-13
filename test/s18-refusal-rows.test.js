// 0.8.4 S18 (RU-S18-02, item 18 R, Q5 (a)+(b)): the REFUSED answers to the build check are records. Drives the real CLI (`node src/cli.js`) in temp projects with the build-check wording injected into the child (test/helpers/build-check-preload.js, whose CHECK map now also
// carries the held refusal sentence buildCheckRefusalNote). A refusal ends in a pause, so no report is written then: the row is written beside the set-aside files (superseded/build-check-<n>.<k>.refusal.json) and report.json `build_check_refusals` is derived from the run folder at the end,
// like ending.refused_answers (which stays as the schema defines it). The NEEDS file of a refused check says why at its top (held sentence, WORDING S18-w6) and the check's own text is untouched. Offline, $0 (mock seats). Fixture helpers COPIED from test/build-check-cli.test.js.
// Written without a run (no tests on the laptop). The ids_missing case is a whole-run row in test/s18-check-ratings.test.js (T21y); this file covers the other two reasons through the real verbs. The red is the parent commit (no row, no sentence).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = join(root, 'test', 'helpers', 'build-check-preload.js');
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
const chain = writer => ({ name: 'bc', maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [seat('mock-exch-support-keep-clean', 'e1', 1), seat('mock-exch-support-keep-clean', 'e2', 2), seat('mock-exch-support-keep-clean', 'e3', 3)] } });
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 's18-refusal-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'bc.json'), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, ['--import', PRELOAD, join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir };
};

test('Q5 (a)+(b): two refused answers to one build check (neither good_to_build nor not_yet; a not_yet without reasons) are two rows of report.json build_check_refusals, in order, a sibling of build_checks (one row for the answered check); each refusal says why at the top of the NEEDS file, which keeps the check\'s own text; ending.refused_answers is 2', () => {
  const p = project(chain(SESSION));
  assert.equal(p.run(['--chain', 'bc', '--task', 'tasks/t.md']).status, 3, 'premise: paused at the external builder');
  writeFileSync(join(p.runDir(), 'build.md'), '# Plan\n\n1. Boil the water.\n');
  assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'premise: the run waits at the build check');
  const needs = join(p.runDir(), 'NEEDS-build-check-1.md');
  const before = readFileSync(needs, 'utf8');
  assert.doesNotMatch(before, /Your last answer to this check was set aside/, 'premise: a check that was never refused carries no refusal sentence');
  writeFileSync(join(p.runDir(), 'build-check-1.md'), 'Looks fine to me.');
  assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'the non-answer is set aside and the run waits again');
  const second = readFileSync(needs, 'utf8');
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: ...The check below is unchanged. An answer counts only when it names every id it lists. NEW: ...The check below is unchanged. Your answer must name every id the check requires. WHY: src/prompts/recorded-084-b.js buildCheckRefusalNote (apply f60ebad2).
  assert.match(second, /^# External stage: build-check-1\n\n# Your last answer to this check was set aside\n\nIt was neither good_to_build nor not_yet\.\n\nThe check below is unchanged\. Your answer must name every id the check requires\./, 'Q5 (b): the refusal says why at the top of the NEEDS file');
  const checkOf = t => t.slice(t.indexOf('## System prompt'), t.indexOf('<!-- INTEGRITY'));   // the integrity footer is a hash of the whole file, so it differs
  assert.equal(checkOf(second), checkOf(before), 'the check itself (system and user prompt) is exactly as it was');
  writeFileSync(join(p.runDir(), 'build-check-1.md'), JSON.stringify({ answer: 'not_yet', reasons: '' }));
  assert.equal(p.run(['--resume', p.runDir()]).status, 3, 'a not_yet without reasons is set aside too');
  assert.match(readFileSync(needs, 'utf8'), /# Your last answer to this check was set aside\n\nA not_yet needs its reasons\./, 'the sentence follows the LATEST refusal');
  writeFileSync(join(p.runDir(), 'build-check-1.md'), JSON.stringify({ answer: 'good_to_build', reasons: 'Nothing is open.' }));
  const end = p.run(['--resume', p.runDir()]);
  assert.equal(end.status, 0, end.stdout + end.stderr);
  const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
  assert.deepEqual(rep.build_check_refusals, [
    { n: 1, label: 'build-check-1', pass: rep.build_checks[0].pass, why: 'unreadable', missing: [], required: [] },
    { n: 1, label: 'build-check-1', pass: rep.build_checks[0].pass, why: 'no_reasons', missing: [], required: [] }], 'RU-S18-02: each refusal is a row (check, pass, why, missing, required), in the order they were made');
  assert.deepEqual([rep.build_checks.length, rep.build_checks[0].answer, rep.ending.refused_answers], [1, 'good_to_build', 2], 'build_checks keeps one row per ANSWERED check (its last row is the decision); the count stays as the schema defines it');
});
