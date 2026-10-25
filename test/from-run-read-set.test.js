// The MCP jail list for a --from-run folder is the CLI's read set (13 Oct 2026, with the draft-pick unit). start_run's `from_run` (and the resume_run re-check) jail-check every file of the folder the CLI will read, so a symlink to a
// file outside the project is refused. The run-level `--from-run` now reads build-retry.md (the retry that replaced a cut-off first try) and the build stage records (build.usage.json, build-retry.usage.json); those names were not on the
// list, so a symlink under any of them was read unchecked. src/from-run-files.js is the one list; pickBuildDraft opens exactly it and server.js checks exactly it. Offline: mock chain, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickBuildDraft } from '../src/handoff-from-run.js';
import { BUILD_READ_SET, BUILD_DRAFT_FILES } from '../src/from-run-files.js';
import { malformedProviderKeys } from './helpers/no-real-keys.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
function mcpSession(cwd, calls, { timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const want = new Set([1, ...calls.map((_, i) => i + 2)]);
    const byId = new Map();
    let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, timeoutMs);
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ }
      }
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(byId); }
    });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inputs', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);

// a project with an earlier run folder whose files are ordinary, and a file OUTSIDE the project that a symlink can point at
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-readset-'));
  const outside = mkdtempSync(join(tmpdir(), 'thc-readset-outside-'));
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  const from = join(dir, 'runs', 'earlier'); mkdirSync(from, { recursive: true });
  writeFileSync(join(from, 'build.md'), '# Plan\n\nBody.\n');
  writeFileSync(join(from, 'criteria.md'), '{"criteria":["It names a data store."]}\n');
  writeFileSync(join(outside, 'private.txt'), 'outside the project\n');
  return { dir, outside, from, target: join(outside, 'private.txt') };
}
const start = (dir, chain = 'mock', rounds = 1) => mcpSession(dir, [{ name: 'start_run', arguments: { chain, task: 'tasks/t.md', from_run: 'runs/earlier', rounds } }]).then(res => body(res.get(2)));

for (const name of ['build-retry.md', 'build-retry.usage.json', 'build.usage.json']) {
  test(`MCP start_run: ${name} in the from_run folder that is a symlink to a file outside the project is refused before anything is read`, async () => {
    const p = project();
    try {
      symlinkSync(p.target, join(p.from, name));
      const out = await start(p.dir);
      assert.equal(out.started, false, JSON.stringify(out));
      assert.match(out.error, /^from_run: .*outside the working directory/, JSON.stringify(out));
      assert.deepEqual(readdirSync(join(p.dir, 'runs')), ['earlier'], 'no run folder was made: nothing was started');
    } finally { rmSync(p.dir, { recursive: true, force: true }); rmSync(p.outside, { recursive: true, force: true }); }
  });
}

// a CONTROL, no red of its own: the narrowed name grammar (test DP-15 in handoff-draft-pick.test.js has the red) already keeps every look-alike name out; this pins that the reader's candidates are the leaf list
test('control: pickBuildDraft opens exactly the draft files of src/from-run-files.js, whatever else the folder holds, and the records are derived from them', () => {
  const p = project();
  try {
    // every look-alike name is a DIRECTORY, which pickBuildDraft reports by name when it tries to open it as a candidate
    for (const n of ['build.md', 'build-retry.md', 'build-full.md', 'build-full-retry.md', 'build-2.md', 'Build.md', 'build.md.bak']) { rmSync(join(p.from, n), { force: true }); mkdirSync(join(p.from, n)); }
    const pick = pickBuildDraft(p.from);
    assert.equal(pick, null, 'nothing readable');
    // the unreadable names it tried are exactly the listed ones: ask again with a readable one beside, which makes it return the skipped list
    writeFileSync(join(p.from, 'readable.txt'), 'x');
    rmSync(join(p.from, 'build.md'), { recursive: true }); writeFileSync(join(p.from, 'build.md'), '# Plan\n');
    const again = pickBuildDraft(p.from);
    assert.equal(again.name, 'build.md');
    assert.deepEqual((again.skipped || []).map(s => s.name), ['build-retry.md'], 'only the listed names were opened (build-full.md, build-2.md, Build.md are never candidates)');
    assert.deepEqual([...BUILD_DRAFT_FILES].sort(), ['build-retry.md', 'build.md']);
    assert.deepEqual(BUILD_READ_SET.filter(f => f.endsWith('.json')).sort(), ['build-retry.usage.json', 'build.usage.json']);
    assert.deepEqual(BUILD_READ_SET, [...BUILD_DRAFT_FILES, ...BUILD_DRAFT_FILES.map(f => f.replace(/\.md$/, '.usage.json'))]);
  } finally { rmSync(p.dir, { recursive: true, force: true }); rmSync(p.outside, { recursive: true, force: true }); }
});

// the positive control and the resume path: ordinary files are NOT refused (a jail that refused every folder holding a build-retry.md would pass the three tests above and break from_run for every run whose first build was retried); the run
// seats an external reviser, so the spawned CLI pauses by itself (exit 3) and the test can wait for its NEEDS file; then resume_run's re-check (it shares startRunInputRefusal) refuses a build-retry.md swapped for a symlink out of the project
test('MCP: ordinary build-retry.md and records are not refused; resume_run re-checks the folder and refuses a build-retry.md that became a symlink out of the project', async () => {
  const p = project();
  try {
    mkdirSync(join(p.dir, 'chains'));
    writeFileSync(join(p.dir, 'chains', 'pdx.json'), JSON.stringify({ name: 'pdx', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'external', model: 'claude-code-session' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }, { provider: 'mock', model: 'mock-critic-b', lab: 'b' }] } }));
    writeFileSync(join(p.from, 'build-retry.md'), '# Plan\n\nThe retried draft.\n');
    writeFileSync(join(p.from, 'build.usage.json'), JSON.stringify({ usage: { input: 1, output: 800, stop: 'length' }, cappedAt: 800 }));
    writeFileSync(join(p.from, 'build-retry.usage.json'), JSON.stringify({ usage: { input: 1, output: 16 }, cappedAt: 1600 }));
    const out = await start(p.dir, 'pdx', 2); // two rounds: the first draft fails the scripted critic, so the external reviser is asked
    assert.equal(out.started, true, JSON.stringify(out));
    const runId = out.run;
    for (let i = 0; i < 300 && !(runId && existsSync(join(p.dir, 'runs', runId, 'NEEDS-revise-1.md'))); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(existsSync(join(p.dir, 'runs', runId, 'NEEDS-revise-1.md')), 'the run started and paused at the external reviser');
    rmSync(join(p.from, 'build-retry.md')); symlinkSync(p.target, join(p.from, 'build-retry.md'));
    const res = await mcpSession(p.dir, [{ name: 'resume_run', arguments: { run: runId } }]);
    const again = body(res.get(2));
    assert.equal(again.resumed, false, JSON.stringify(again));
    assert.match(JSON.stringify(again), /from_run: .*outside the working directory/);
  } finally { rmSync(p.dir, { recursive: true, force: true }); rmSync(p.outside, { recursive: true, force: true }); }
});
