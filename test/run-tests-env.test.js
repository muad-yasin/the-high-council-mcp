// 0.8.2 (ChatGPT review 1, intake 2026-10-06, F12/F13): the run_tests seat tool ran the target's test file with the harness's whole
// environment, provider keys included, and a test file is arbitrary code. The child now gets an allowlist. Driven through the real
// runTool: the child writes its own environment to a file and this test reads it back. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool } from '../src/tools.js';

const DUMP = "import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\n"
  + "test('dump', () => { writeFileSync('env-dump.json', JSON.stringify(process.env)); });\n";
const FAKE = {
  ANTHROPIC_API_KEY: 'sk-ant-fake-for-the-env-test',
  OPENROUTER_API_KEY: 'sk-or-fake-for-the-env-test',
  COUNCIL_PLUGIN_OPENROUTER_API_KEY: 'sk-or-plugin-fake-for-the-env-test',
  FOO_SECRET: 'random-secret-by-shape',
  NODE_OPTIONS: '--no-warnings',
};

function withEnv(vars, fn) {
  const saved = {};
  for (const k of [...Object.keys(vars), 'NODE_TEST_CONTEXT']) { saved[k] = process.env[k]; }
  delete process.env.NODE_TEST_CONTEXT;
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('run_tests: the child does not inherit provider keys, plugin-dialog keys, other secrets or NODE_OPTIONS, but still runs and keeps PATH and HOME', () => {
  const ws = mkdtempSync(join(tmpdir(), 'thc-run-tests-env-'));
  try {
    writeFileSync(join(ws, 'package.json'), '{"name":"x","version":"0.0.0"}');
    writeFileSync(join(ws, 'env.test.mjs'), DUMP);
    const r = withEnv(FAKE, () => runTool('run_tests', { file: 'env.test.mjs' }, { cwd: ws }));
    assert.equal(r.ok, true, `the test file ran and passed: ${JSON.stringify(r)}`);
    const seen = JSON.parse(readFileSync(join(ws, 'env-dump.json'), 'utf8'));
    for (const k of Object.keys(FAKE)) assert.equal(k in seen, false, `${k} reached the child`);
    for (const v of Object.values(FAKE)) assert.ok(!JSON.stringify(seen).includes(v), 'a secret value reached the child under another name');
    assert.ok(seen.PATH, 'PATH is kept (the child needs node)');
    assert.ok(seen.HOME || seen.USERPROFILE, 'HOME is kept');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('run_tests: a positive control - a variable the allowlist keeps (LC_*) does reach the child, so the dump reads the real environment', () => {
  const ws = mkdtempSync(join(tmpdir(), 'thc-run-tests-env-'));
  try {
    writeFileSync(join(ws, 'package.json'), '{"name":"x","version":"0.0.0"}');
    writeFileSync(join(ws, 'env.test.mjs'), DUMP);
    withEnv({ LC_THC_PROBE: 'kept', THC_PROBE_DROPPED: 'dropped' }, () => runTool('run_tests', { file: 'env.test.mjs' }, { cwd: ws }));
    const seen = JSON.parse(readFileSync(join(ws, 'env-dump.json'), 'utf8'));
    assert.equal(seen.LC_THC_PROBE, 'kept');
    assert.equal('THC_PROBE_DROPPED' in seen, false, 'a variable not on the allowlist is dropped');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('testChildEnv: names are compared case-insensitively (Windows spells them Path, SystemRoot), and the spelling is kept', async () => {
  const { testChildEnv } = await import('../src/tools.js');
  const out = testChildEnv({ Path: 'C:\\bin', SYSTEMROOT: 'C:\\Windows', ComSpec: 'cmd.exe', lc_all: 'C', OPENROUTER_API_KEY: 'k', Council_Plugin_X_Api_Key: 'k', FOO_SECRET: 's' });
  assert.deepEqual(Object.keys(out).sort(), ['ComSpec', 'Path', 'SYSTEMROOT', 'lc_all']);
});
