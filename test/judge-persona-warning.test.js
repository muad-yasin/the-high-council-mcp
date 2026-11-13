// B3 prep, JUDGE lane, a small fix-up on top of unit P (C&C ruling 1 Nov 2026, option A): a chain whose critics carry a `persona` but which does not switch `seat_personas` on runs no persona at all. That is dead config that reads as a feature,
// so it is WARNED about (never refused: toggling the switch stays one edit): `council doctor --chain` prints a WARNING: line and the run path prints a PRE-FLIGHT WARNING: line (not on a resume). lintChain has no warning tier and is untouched.
// The exit code is the same with and without the warning. The sentence is A-DRAFT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const J = await import('../src/judge-persona.js').catch(() => ({}));   // a missing export fails each test that uses it by name

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-unanimous.json'), 'utf8'));
const withPersonas = extra => ({ ...base, ...extra, seats: { ...base.seats, critics: base.seats.critics.map((c, i) => ({ ...c, persona: ['Moses', 'Noah'][i] })) } });

test('judgePersonaWarnings (pure): a persona on a critic with the switch absent or off warns once, naming the personas; with the switch on, or with no persona, nothing', () => {
  assert.equal(typeof J.judgePersonaWarnings, 'function');
  for (const cfg of [withPersonas({}), withPersonas({ seat_personas: { enabled: false, form: 'voice' } })]) {
    const w = J.judgePersonaWarnings(cfg);
    assert.equal(w.length, 1); assert.match(w[0].message, /Moses/); assert.match(w[0].message, /Noah/); assert.match(w[0].message, /seat_personas/);
  }
  assert.deepEqual(J.judgePersonaWarnings(withPersonas({ seat_personas: { enabled: true, form: 'voice' } })), []);
  assert.deepEqual(J.judgePersonaWarnings(base), []);
  assert.deepEqual(J.judgePersonaWarnings(null), []); assert.deepEqual(J.judgePersonaWarnings({}), []);
});

const project = chains => {
  const dir = mkdtempSync(join(tmpdir(), 'jpw-')); mkdirSync(join(dir, 'chains'));
  for (const [n, c] of Object.entries(chains)) writeFileSync(join(dir, 'chains', `${n}.json`), JSON.stringify(c));
  writeFileSync(join(dir, 'task.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120000 });
  return { dir, run };
};

test('council doctor --chain prints the WARNING for persona-without-switch and nothing otherwise; the exit code is the same either way', () => {
  const p = project({ lone: withPersonas({}), switched: withPersonas({ seat_personas: { enabled: true, form: 'voice' } }), plain: base });
  const lone = p.run(['doctor', '--chain', 'chains/lone.json']);
  const switched = p.run(['doctor', '--chain', 'chains/switched.json']);
  const plain = p.run(['doctor', '--chain', 'chains/plain.json']);
  assert.equal(lone.status, 0, lone.stdout + lone.stderr); assert.equal(switched.status, 0); assert.equal(plain.status, 0);
  assert.match(lone.stdout, /WARNING: .*seat_personas/);
  assert.doesNotMatch(switched.stdout + switched.stderr, /WARNING: .*persona/); assert.doesNotMatch(plain.stdout + plain.stderr, /WARNING: .*persona/);
  assert.match(lone.stdout, /no lint problems\./, 'the warning does not turn the lint result into a failure');
});

test('the run path: the pre-flight list prints it once at the start, a run with the switch on or no persona prints none, and the exit status is the same as the plain chain\'s', () => {
  const p = project({ lone: withPersonas({}), switched: withPersonas({ seat_personas: { enabled: true, form: 'voice' } }), plain: base });
  const run = n => p.run(['--chain', n, '--task', 'task.md']);
  const lone = run('lone'); const plain = run('plain'); const switched = run('switched');
  assert.equal(lone.status, plain.status, 'the warning never changes the exit status');
  assert.match(lone.stdout + lone.stderr, /PRE-FLIGHT WARNING: .*seat_personas/);
  assert.equal((lone.stdout + lone.stderr).match(/PRE-FLIGHT WARNING: .*seat_personas/g).length, 1);
  assert.doesNotMatch(plain.stdout + plain.stderr, /PRE-FLIGHT WARNING: .*persona/);
  assert.doesNotMatch(switched.stdout + switched.stderr, /PRE-FLIGHT WARNING: .*persona/);
});
