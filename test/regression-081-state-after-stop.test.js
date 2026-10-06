// 0.8.1 FX-7 (the 2026-10-02 audit of 0.8.0, finding 7): state.json said "running" after three kinds of stop: a cut-off
// draft (STOPPED-truncated.*), a preflight objection (STOPPED-preflight.md) and a key-shaped prompt (STOPPED-secret.md).
// deriveRunStatus did not know the three markers, so the stop exit's own state write read the still-living process as
// running; the secret exit did not write state at all. Each stop is reached here offline, through the CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRunStatus } from '../src/run-status.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const base = () => JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
function workspace(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-fx7-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  if (chain) writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain, null, 2));
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
// A synthetic Anthropic-shaped key, built here, never a real one.
const KEY = ['sk', '-ant-api03-', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7d'].join('');

function assertStopped(runDir, marker) {
  assert.ok(readdirSync(runDir).includes(marker), `${marker} written`);
  const state = readJson(join(runDir, 'state.json'));
  assert.equal(state.phase, 'stopped', `state.json phase after ${marker}`);
  assert.equal(state.stage, null);
  assert.equal(deriveRunStatus(runDir, readJson(join(runDir, 'run.json'))), 'stopped', `deriveRunStatus after ${marker}`);
}

test('FX-7: a cut-off draft (exit 17) leaves state.json at stopped', () => {
  const c = base(); c.name = 'fx7-cut'; c.seats.builder = { provider: 'mock', model: 'mock-draft-cut', lab: c.seats.builder?.lab || 'mock-builder' };
  const dir = workspace(c);
  const r = run(dir, ['--chain', 'fx7-cut', '--task', 'tasks/t.md']);
  assert.equal(r.status, 17, r.stdout + r.stderr);
  assertStopped(onlyRun(dir), 'STOPPED-truncated.json');
});

test('FX-7: a preflight objection (exit 10) leaves state.json at stopped', () => {
  const c = base(); c.name = 'fx7-pre'; c.preflight = { seats: [{ provider: 'mock', model: 'mock-preflight-object', lab: 'pre' }] };
  const dir = workspace(c);
  const r = run(dir, ['--chain', 'fx7-pre', '--task', 'tasks/t.md']);
  assert.equal(r.status, 10, r.stdout + r.stderr); // EXIT_PREFLIGHT_BLOCKED in src/cli.js
  assertStopped(onlyRun(dir), 'STOPPED-preflight.md');
});

test('FX-7: a key-shaped prompt (exit 11) leaves state.json at stopped', () => {
  const dir = workspace(null);
  assert.equal(run(dir, ['--chain', 'mock-external', '--task', 'tasks/t.md']).status, 3);
  const runDir = onlyRun(dir);
  const pending = readdirSync(runDir).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${pending}.md`), `# Plan\n\nUse ${KEY} here.\n`);
  const again = run(dir, ['--resume', join('runs', readdirSync(join(dir, 'runs'))[0])]);
  assert.equal(again.status, 11, again.stdout + again.stderr);
  assertStopped(runDir, 'STOPPED-secret.md');
});
