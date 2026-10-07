// 0.8.2 item 2 (ChatGPT review 1, intake 2026-10-06, F1b/F1c; owner: all of it in 0.8.2; C&C widened it to writes and to paths taken from run.json, 6 Oct 2026):
// the MCP tools that read or write a run folder or tasks/ followed symbolic links out of it. Driven through the real server process, as the intake demands
// (a plain-fs toy test says nothing about the handler). Each scenario plants ONE symlink (file or directory) that points at a sentinel outside the folder and
// asserts the sentinel never comes back and no outside file is written or changed. Positive controls prove the same tools work on a clean run.
// Offline, $0. A symlink anywhere in a run folder refuses the run for every MCP tool: the harness never creates one there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const SENTINEL = 'TOP-SECRET-SENTINEL-4f9c2a';
const VICTIM = 'VICTIM-ORIGINAL-CONTENT';

function mcp(cwd, calls, { timeoutMs = 60_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
    const want = new Set(calls.map((_, i) => i + 2));
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
      if ([...want].every(id => byId.has(id))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'symlink-containment', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const textOf = m => JSON.stringify(m?.result ?? m?.error ?? m);

// One workspace: a working folder, and an "outside" folder with a sentinel file and a victim file that must never change.
function world() {
  const base = mkdtempSync(join(tmpdir(), 'thc-symlink-'));
  const work = join(base, 'work'); const out = join(base, 'outside');
  for (const d of [work, join(work, 'tasks'), join(work, 'runs'), out]) mkdirSync(d, { recursive: true });
  writeFileSync(join(out, 'secret.txt'), `${SENTINEL}\nsecond line\n`);
  writeFileSync(join(out, 'victim.txt'), VICTIM);
  const run = (n, files = {}) => {
    const id = `2026-10-06T17-00-0${n}-000Z`; const dir = join(work, 'runs', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: join(work, 'tasks', 't.md'), cwd: work, startedAt: '2026-10-06T17:00:00.000Z' }));
    for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
    return { id, dir };
  };
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
  return { base, work, out, run, secret: join(out, 'secret.txt'), victim: join(out, 'victim.txt'), clean: () => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) };
}

test('controls: on a clean run the same tools work and return the run\'s own text', async () => {
  const w = world();
  try {
    const r = w.run(1, { 'deliverable.md': '# Deliverable\n\nCLEAN-CONTENT\n', 'run.log': 'Stage: build\ncost: $0.01\n', 'NEEDS-build.md': 'prompt for build' });
    const [file, status, list, ext, outline, task] = await mcp(w.work, [
      { name: 'read_run_file', arguments: { run: r.id, file: 'deliverable.md' } },
      { name: 'run_status', arguments: { run: r.id } },
      { name: 'list_runs', arguments: {} },
      { name: 'external_prompt', arguments: { run: r.id } },
      { name: 'plan_outline', arguments: { run: r.id } },
      { name: 'write_task', arguments: { name: 'fresh', content: '# Fresh task\n' } },
    ]);
    assert.match(textOf(file), /CLEAN-CONTENT/);
    assert.match(textOf(status), /Stage: build/);
    assert.match(textOf(list), new RegExp(r.id));
    assert.match(textOf(ext), /prompt for build/);
    assert.match(textOf(outline), /Deliverable/);
    assert.equal(readFileSync(join(w.work, 'tasks', 'fresh.md'), 'utf8'), '# Fresh task\n');
  } finally { w.clean(); }
});

test('read_run_file, run_status, external_prompt and plan_outline do not follow a symlink out of the run folder (each in its own run)', async () => {
  const w = world();
  try {
    const a = w.run(1); symlinkSync(w.secret, join(a.dir, 'deliverable.md'));
    const b = w.run(2); symlinkSync(w.secret, join(b.dir, 'run.log'));
    const d = w.run(3); symlinkSync(w.secret, join(d.dir, 'NEEDS-build.md'));
    const e = w.run(4); symlinkSync(w.secret, join(e.dir, 'deliverable.md'));
    const f = w.run(5, { 'report.json': '{"passed":true}' }); symlinkSync(join(w.work, 'tasks', 't.md'), join(f.dir, 'BOARD.md'));
    const res = await mcp(w.work, [
      { name: 'read_run_file', arguments: { run: a.id, file: 'deliverable.md' } },
      { name: 'run_status', arguments: { run: b.id } },
      { name: 'external_prompt', arguments: { run: d.id } },
      { name: 'plan_outline', arguments: { run: e.id } },
      { name: 'read_run_file', arguments: { run: f.id, file: 'BOARD.md' } },
    ]);
    res.forEach((m, i) => assert.ok(!textOf(m).includes(SENTINEL), `call ${i}: the sentinel came back: ${textOf(m).slice(0, 300)}`));
    assert.ok(!textOf(res[4]).includes('Plan a small note-taking app'), 'a symlink to another file in the working folder is refused too (containment is the run folder, not the working folder)');
    for (const m of res) assert.match(textOf(m), /symbolic link|refused|no such/i, `the refusal says why: ${textOf(m).slice(0, 200)}`);
  } finally { w.clean(); }
});

test('list_runs: a run folder with a symlinked run.log leaks nothing, and a dangling symlink entry in runs/ does not break the listing', async () => {
  const w = world();
  try {
    w.run(1, { 'run.log': 'Stage: build\n' });
    const b = w.run(2); symlinkSync(w.secret, join(b.dir, 'run.log'));
    symlinkSync(join(w.base, 'does-not-exist'), join(w.work, 'runs', '2026-10-06T17-00-09-000Z'));
    const [list] = await mcp(w.work, [{ name: 'list_runs', arguments: {} }]);
    assert.ok(!list.error && !list.result?.isError, `the listing itself must not fail: ${textOf(list).slice(0, 300)}`);
    assert.ok(!textOf(list).includes(SENTINEL));
    assert.match(textOf(list), /2026-10-06T17-00-01-000Z/, 'the clean run is still listed');
  } finally { w.clean(); }
});

test('prepare_stage_prompt does not read a task path that run.json names outside the working folder, and does not write through a symlinked stage_prompt.md', async () => {
  const w = world();
  try {
    // (a) run.json's task field points at a file outside the working folder (path from run-folder data).
    const f = w.run(1, { 'NEEDS-build.md': 'prompt' });
    writeFileSync(join(f.dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: w.secret, cwd: w.work }));
    // (b) the output file is a symlink to a victim.
    const g = w.run(2, { 'NEEDS-build.md': 'prompt' }); symlinkSync(w.victim, join(g.dir, 'stage_prompt.md'));
    const [a, b] = await mcp(w.work, [
      { name: 'prepare_stage_prompt', arguments: { run: f.id } },
      { name: 'prepare_stage_prompt', arguments: { run: g.id } },
    ]);
    assert.ok(!textOf(a).includes(SENTINEL), `the response carries the outside file: ${textOf(a).slice(0, 300)}`);
    const written = join(f.dir, 'stage_prompt.md');
    if (existsSync(written)) assert.ok(!readFileSync(written, 'utf8').includes(SENTINEL), 'stage_prompt.md carries the outside file');
    assert.equal(readFileSync(w.victim, 'utf8'), VICTIM, 'a symlinked stage_prompt.md was written through');
    assert.ok(!textOf(b).includes(SENTINEL));
  } finally { w.clean(); }
});

test('submit_stage and run_status(brief) do not write through a symlink or a dangling symlink in the run folder', async () => {
  const w = world();
  try {
    const h = w.run(1, { 'NEEDS-build.md': 'prompt' });
    const pwned = join(w.out, 'pwned.md');
    symlinkSync(pwned, join(h.dir, 'build.md')); // dangling: existsSync says "no answer yet"
    const i = w.run(2); symlinkSync(w.victim, join(i.dir, 'RESUME.md'));
    await mcp(w.work, [
      { name: 'submit_stage', arguments: { run: h.id, stage: 'build', content: '# Build\n\nWRITTEN-BY-CLIENT\n' } },
      { name: 'run_status', arguments: { run: i.id, brief: true } },
    ]);
    assert.equal(existsSync(pwned), false, 'submit_stage created a file outside the run folder through a dangling symlink');
    assert.equal(readFileSync(w.victim, 'utf8'), VICTIM, 'run_status(brief) wrote RESUME.md through a symlink');
  } finally { w.clean(); }
});

test('write_task refuses a symlinked tasks/<name>.md and a symlinked tasks/ folder, and leaves the outside file and folder untouched', async () => {
  const w = world();
  try {
    symlinkSync(w.victim, join(w.work, 'tasks', 'evil.md'));
    const [file] = await mcp(w.work, [{ name: 'write_task', arguments: { name: 'evil', content: 'OVERWRITTEN' } }]);
    assert.equal(readFileSync(w.victim, 'utf8'), VICTIM, `write_task followed the file symlink: ${textOf(file).slice(0, 200)}`);
    assert.match(textOf(file), /symbolic link|refused/i);

    const w2 = world();
    try {
      rmSync(join(w2.work, 'tasks'), { recursive: true, force: true });
      symlinkSync(w2.out, join(w2.work, 'tasks'));
      const [dir] = await mcp(w2.work, [{ name: 'write_task', arguments: { name: 'planted', content: 'PLANTED' } }]);
      assert.deepEqual(readdirSync(w2.out).sort(), ['secret.txt', 'victim.txt'], `write_task wrote into a symlinked tasks/ folder: ${textOf(dir).slice(0, 200)}`);
      assert.match(textOf(dir), /symbolic link|refused|outside/i);
    } finally { w2.clean(); }
  } finally { w.clean(); }
});

test('run_status(brief) does not summarize a task path that run.json names outside the working folder (the resume brief reads it too)', async () => {
  const w = world();
  try {
    const r = w.run(1, { 'NEEDS-build.md': 'prompt' });
    writeFileSync(join(r.dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: w.secret, cwd: w.work }));
    const ok = w.run(2, { 'NEEDS-build.md': 'prompt' }); // control: the recorded task inside the working folder is summarized
    const [outside, inside] = await mcp(w.work, [
      { name: 'run_status', arguments: { run: r.id, brief: true } },
      { name: 'run_status', arguments: { run: ok.id, brief: true } },
    ]);
    assert.ok(!textOf(outside).includes(SENTINEL), `the brief carries the outside file: ${textOf(outside).slice(0, 300)}`);
    assert.match(textOf(inside), /A plan/, 'control: the task inside the working folder is summarized');
  } finally { w.clean(); }
});

// ---- found by the item 2 review (Sonnet reviewer, 6 Oct 2026) ----

test('a run.json that names a hostile cwd cannot widen where a task path may be read from: the root is the server\'s own working folder', async () => {
  const w = world();
  try {
    const r = w.run(1, { 'NEEDS-build.md': 'prompt' });
    // cwd is the PARENT of the working folder, so 'outside/secret.txt' is "inside" the recorded cwd; it is not inside the server's working folder.
    writeFileSync(join(r.dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: 'outside/secret.txt', cwd: w.base }));
    const root1 = w.run(2, { 'NEEDS-build.md': 'prompt' });
    writeFileSync(join(root1.dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: w.secret, cwd: '/' }));
    const res = await mcp(w.work, [
      { name: 'run_status', arguments: { run: r.id, brief: true } },
      { name: 'prepare_stage_prompt', arguments: { run: r.id } },
      { name: 'run_status', arguments: { run: root1.id, brief: true } },
      { name: 'prepare_stage_prompt', arguments: { run: root1.id } },
    ]);
    res.forEach((m, i) => assert.ok(!textOf(m).includes(SENTINEL), `call ${i} carries the outside file: ${textOf(m).slice(0, 200)}`));
    for (const id of [r.id, root1.id]) {
      const written = join(w.work, 'runs', id, 'stage_prompt.md');
      if (existsSync(written)) assert.ok(!readFileSync(written, 'utf8').includes(SENTINEL), 'stage_prompt.md carries the outside file');
    }
  } finally { w.clean(); }
});

// A sequential session: each step is built from the previous answers (the quote id is only known after council_quote).
function mcpSteps(cwd, steps) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_COOLDOWN_MS: '0' } });
    const results = []; const byId = new Map(); let buf = ''; let next = 0;
    const timer = setTimeout(() => { child.kill(); fail(new Error('timed out')); }, 60_000);
    const send = o => child.stdin.write(JSON.stringify(o) + '\n');
    const fire = () => {
      if (next >= steps.length) { clearTimeout(timer); child.kill(); return done(results); }
      const id = next + 2; const call = steps[next](results);
      next++; byId.set(id, null);
      send({ jsonrpc: '2.0', id, method: 'tools/call', params: call });
    };
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); fire(); }
        else if (m.id !== undefined && byId.has(m.id)) { results.push(m); fire(); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'symlink-containment', version: '0' } } });
  });
}

test('council_advise records objection dispositions without following a symlinked advise-log.json.tmp (the write was a bare writeFileSync)', async () => {
  const w = world();
  try {
    const id = '2026-10-06T17-00-05-000Z'; const dir = join(w.work, 'runs', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'advise-single' }));
    // A valid-shape ledger entry with a timestamp in the future, so it stays "in session" for the guards.
    writeFileSync(join(dir, 'advise-log.json'), JSON.stringify({ ts: Date.now() + 3_600_000, quoted: { ceiling_usd: 0.1 }, dissent_ids: [`${id}#glm5.3`], dispositions: [] }));
    symlinkSync(w.victim, join(dir, 'advise-log.json.tmp'));
    const brief = { schema_version: 'advice-brief/1', moment: 'before_commit', question: 'Should we drop the legacy invoices column before the release?',
      decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
      options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
      tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }], sensitivity: 'internal', not_included: ['the conversation', 'environment variables'] };
    const [quote, advise] = await mcpSteps(w.work, [
      () => ({ name: 'council_quote', arguments: { brief, mode: 'single' } }),
      results => {
        const t = JSON.stringify(results[0].result);
        const q = t.match(/quote_id: \\"(q_[0-9a-f]{24})\\"/)?.[1]; const sha = t.match(/confirm_sha256: \\"([0-9a-f]{64})\\"/)?.[1];
        assert.ok(q && sha, `a quote came back: ${t.slice(0, 300)}`);
        return { name: 'council_advise', arguments: { quote_id: q, confirm_sha256: sha, wait_seconds: 0, dispositions: [{ id: `${id}#glm5.3`, decision: 'accept', reason: 'The objection is right, we will keep the column.' }] } };
      },
    ]);
    assert.ok(!quote.result?.isError, textOf(quote).slice(0, 300));
    assert.equal(readFileSync(w.victim, 'utf8'), VICTIM, `the disposition record was written through the link: ${textOf(advise).slice(0, 300)}`);
    // and it was refused for THIS reason (not by some unrelated earlier failure): the planted link makes the run folder unusable
    assert.match(textOf(advise), /ledger_unreadable.*symbolic link|symbolic link.*ledger_unreadable/s, textOf(advise).slice(0, 400));
  } finally { w.clean(); }
});

test('a run.json whose cwd points at another folder cannot choose the chain config: only the server\'s own working folder and the package are searched', async () => {
  const w = world();
  try {
    // <base>/chains/mock-external.json is attacker-shaped: its draftTokens would show up as approx_length in the stage bundle.
    mkdirSync(join(w.base, 'chains'));
    writeFileSync(join(w.base, 'chains', 'mock-external.json'), JSON.stringify({ name: 'mock-external', estimate: { draftTokens: 987654321 }, seats: {} }));
    const r = w.run(1, { 'NEEDS-build.md': 'prompt' });
    writeFileSync(join(r.dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: join(w.work, 'tasks', 't.md'), cwd: w.base }));
    const control = w.run(2, { 'NEEDS-build.md': 'prompt' }); // cwd = the working folder: the same call must still work
    const [hostile, ok] = await mcp(w.work, [
      { name: 'prepare_stage_prompt', arguments: { run: r.id } },
      { name: 'prepare_stage_prompt', arguments: { run: control.id } },
    ]);
    assert.match(textOf(ok), /stage_prompt\.md/, `control: ${textOf(ok).slice(0, 200)}`);
    const written = join(r.dir, 'stage_prompt.md');
    const bundle = existsSync(written) ? readFileSync(written, 'utf8') : textOf(hostile);
    assert.ok(!bundle.includes('987654321'), 'the stage bundle was built from a chain config in the folder run.json names');
  } finally { w.clean(); }
});
