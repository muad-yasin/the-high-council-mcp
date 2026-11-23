// 0.8.4 S4 (M1), U1+U2: the REAL verbs. Drives `node src/cli.js` in temp projects with the build-check wording injected into the child (test/helpers/build-check-preload.js): (1) a layered chain with no handling session ends AGREED with no build check (exit 0,
// `ending` in report.json, `passed` true); (2) a layered chain whose writer is the handler's own session waits at the build check (exit 3, NEEDS-build-check-1.md), an answer that is no answer is moved aside and the run waits again, and a good_to_build ends it agreed
// (exit 0); (3) the same chains with the wording HELD end as they always did. Offline, $0 (mock seats).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = join(root, 'test', 'helpers', 'build-check-preload.js');
const HELD_PRELOAD = join(root, 'test', 'helpers', 'no-build-check-preload.js');   // the HELD state forced, whatever src/roles.js records
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
const chain = (writer) => ({ name: 'bc', maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [seat('mock-exch-support-keep-clean', 'e1', 1), seat('mock-exch-support-keep-clean', 'e2', 2), seat('mock-exch-support-keep-clean', 'e3', 3)] } });
const project = (config, name = 'bc') => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-cli-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const env = { PATH: process.env.PATH, HOME: dir };
  const run = (args, { word = true } = {}) => spawnSync(process.execPath, ['--import', word ? PRELOAD : HELD_PRELOAD, join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir };
};
const report = p => JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
const PLAN = '# Plan\n\n1. Boil the water.\n';

test('REAL VERBS (1), T15i / T15s: a layered chain with no handling session ends AGREED with no build check - exit 0, `ending` agreed with basis no_handling_session, `passed` true, the verdict line says so; with the wording HELD the same chain exits 0 with no ending', () => {
  const p = project(chain({ provider: 'mock', model: 'mock-builder', lab: 'author' }));
  const r = p.run(['--chain', 'bc', '--task', 'tasks/t.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = report(p);
  assert.deepEqual([rep.passed, rep.outcome, rep.ending.kind, rep.ending.handler_check, rep.ending.basis, rep.ending.refused_answers], [true, 'consensus', 'agreed', 'none', ['layer_3_sign_off', 'no_handling_session'], 0]);
  assert.equal(readdirSync(p.runDir()).some(f => f.startsWith('NEEDS-')), false, 'T15s: the run ends without waiting for anybody: no NEEDS file');
  assert.match(r.stdout, /verdict:\s+every lab on the panel signed off; agreed on layer 3's sign-off; no build check was made, because no session was there to make one/);
  assert.match(r.stdout, /panel:\s+e1 ✓\s+e2 ✓\s+e3 ✓/);
  assert.match(readFileSync(join(p.runDir(), 'BOARD.md'), 'utf8'), /## Agreed on layer 3's sign-off, no build check/);
  const held = project(chain({ provider: 'mock', model: 'mock-builder', lab: 'author' }));
  const h = held.run(['--chain', 'bc', '--task', 'tasks/t.md'], { word: false });
  assert.equal(h.status, 0, h.stdout + h.stderr);
  assert.equal(report(held).ending, undefined);
});
test('REAL VERBS (2): a layered chain whose writer is the handler\'s session waits at the build check (exit 3, NEEDS-build-check-1.md); a non-answer is moved aside and it waits again; good_to_build ends it agreed (exit 0)', () => {
  const p = project(chain(SESSION));
  const r1 = p.run(['--chain', 'bc', '--task', 'tasks/t.md']);
  assert.equal(r1.status, 3, 'paused at the external builder: ' + r1.stdout + r1.stderr);
  writeFileSync(join(p.runDir(), 'build.md'), PLAN);
  const r2 = p.run(['--resume', p.runDir()]);
  assert.equal(r2.status, 3, 'every layer signed off and the run waits for the handler: ' + r2.stdout + r2.stderr);
  const needs = join(p.runDir(), 'NEEDS-build-check-1.md');
  assert.ok(existsSync(needs), 'the question is a file');
  const text = readFileSync(needs, 'utf8');
  assert.match(text, /good_to_build or not_yet/); assert.match(text, /# The objections still open\n\nNone\./);
  assert.equal(existsSync(join(p.runDir(), 'report.json')), false, 'a run that waits has no report.json');
  writeFileSync(join(p.runDir(), 'build-check-1.md'), 'Looks fine to me.');
  const r3 = p.run(['--resume', p.runDir()]);
  assert.equal(r3.status, 3, 'no answer: it waits again: ' + r3.stdout + r3.stderr);
  assert.match(r3.stdout + r3.stderr, /build check 1: the handler's answer was refused \(it is neither good_to_build nor not_yet\)/);
  assert.ok(readdirSync(join(p.runDir(), 'superseded')).some(f => /^build-check-1\.1\.md$/.test(f)), 'the refused answer is moved aside, never deleted');
  writeFileSync(join(p.runDir(), 'build-check-1.md'), JSON.stringify({ answer: 'good_to_build', reasons: 'Nothing is open.' }));
  const r4 = p.run(['--resume', p.runDir()]);
  assert.equal(r4.status, 0, r4.stdout + r4.stderr);
  const rep = report(p);
  assert.deepEqual([rep.passed, rep.outcome, rep.ending.kind, rep.ending.handler_check, rep.ending.refused_answers, rep.build_checks.map(c => c.answer)], [true, 'consensus', 'agreed', 'good_to_build', 1, ['good_to_build']]);
  assert.match(r4.stdout, /verdict:\s+every lab on the panel signed off/);
});

test('REAL VERBS (3), the M1-G1 verdict\'s named limit: the `panel:` line prints a seat that STATED a pass as "(stated a pass)", not "?" (which is for a seat with no usable reply, and the legend says so only then)', () => {
  const config = { name: 'pl', maxRounds: 2, signoff: 'unanimous', freedoms: { pass: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-clean', 'signer'), seat('mock-critic-passer', 'passer')] } };
  const p = project(config, 'pl');
  const r = p.run(['--chain', 'pl', '--task', 'tasks/t.md'], { word: false });
  const line = (r.stdout.match(/panel:.*/) || [''])[0];
  assert.ok(line, `no panel line: exit ${r.status}: ${r.stdout.slice(-1200)}${r.stderr.slice(-600)}`);
  assert.match(line, /signer ✓/); assert.match(line, /passer \(stated a pass\)/); assert.doesNotMatch(line, /\?/);
  assert.doesNotMatch(r.stdout, /\? = no usable reply/, 'the legend for "?" is not printed when no seat had an unusable reply');
});
