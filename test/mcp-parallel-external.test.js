// MCP external_prompt / submit_stage with several stages waiting at once (bug audit 2026-09-26 #4).
// A panel of external critics pauses together, but external_prompt named only the first stage and
// submit_stage accepted only the first, so the rest could not be answered over MCP. Now
// external_prompt lists every waiting stage and returns any one's prompt, submit_stage accepts any
// of them, and the run resumes only once none is left. Offline: mock and external seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { waitForRunEnd } from './helpers/child-gone.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const EXT = lab => ({ provider: 'external', model: 'claude-code-session', lab });
const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
// The pass with the pair the prompt carries (read from <label>.envelope.json when it exists: once the verdict-envelope sentence is recorded a reply without review_id and draft_id is dropped as unheard); plain PASS when it does not.
const passWithIds = (runDir, stage) => { const f = join(runDir, `${stage}.envelope.json`); return existsSync(f) ? JSON.stringify({ ...(({ review_id, draft_id }) => ({ review_id, draft_id }))(JSON.parse(readFileSync(f, 'utf8'))), ...JSON.parse(PASS) }) : PASS; };

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
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parallel', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ];
    child.stdin.write(requests.map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const body = m => JSON.parse(m.result.content[0].text);
// One call per session, in order: each later call depends on what the one before wrote to disk.
const call = async (dir, name, args) => body((await mcpSession(dir, [{ name, arguments: args }])).get(2));

test('two external critics: both are listed, either can be answered first, and the run resumes after the last', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-parallel-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'chains', 'two-ext.json'), JSON.stringify({
      name: 'two-ext', description: 'test', maxRounds: 1, signoff: 'unanimous',
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [EXT('ea'), { provider: 'mock', model: 'mock-critic-a', lab: 'mb' }, EXT('ec')],
      },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'two-ext', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const runDir = join(dir, 'runs', run);

    const p = await call(dir, 'external_prompt', { run });
    assert.deepEqual(p.waiting, ['panel-1-ea', 'panel-1-ec']);
    assert.equal(p.stage, 'panel-1-ea');
    const second = await call(dir, 'external_prompt', { run, stage: 'panel-1-ec' });
    assert.equal(second.stage, 'panel-1-ec');
    assert.ok(second.prompt.length > 0);
    assert.match((await call(dir, 'external_prompt', { run, stage: 'panel-1-mb' })).error, /not waiting/);

    // The second-listed stage first: accepted, and the run does not resume yet.
    const a = await call(dir, 'submit_stage', { run, stage: 'panel-1-ec', content: passWithIds(runDir, 'panel-1-ec') });
    assert.equal(a.written, 'panel-1-ec.md', JSON.stringify(a));
    assert.equal(a.resumed, false);
    assert.deepEqual(a.waiting, ['panel-1-ea']);
    assert.ok(!existsSync(join(runDir, 'report.json')));
    // The last one resumes the run, which finishes.
    const b = await call(dir, 'submit_stage', { run, stage: 'panel-1-ea', content: passWithIds(runDir, 'panel-1-ea') });
    assert.equal(b.resumed, true, JSON.stringify(b));
    await waitForRunEnd(runDir);
    assert.ok(existsSync(join(runDir, 'report.json')), 'the run finished after both answers');
    // CHANGED ACCEPTED TEST (decider-readiness apply patch fix-up 2, 24 Okt 2026; C&C ruling: this test passed on the on-state while both external answers were dropped as unheard, i.e. for the wrong reason). OLD: the answers were plain PASS and only the run's finish was asserted (the mock critic's pass finished it). NEW: the answers carry the pair when one is recorded, and the report must show both external seats HEARD (signed_off, not unheard).
    const heard = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')).panelVerdicts.filter(v => v.round === 1 && (v.lab === 'ea' || v.lab === 'ec'));
    assert.deepEqual(heard.map(v => v.verdict).sort(), ['signed_off', 'signed_off'], `both external answers were heard, not dropped as unheard: ${JSON.stringify(heard)}`);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// 0.8.4 (S9-02): external_prompt reads a long prompt in pages (max_chars, part). Neither argument: the whole prompt and the answer's keys as before. The pages put together are the whole prompt, cut by code point.
test('external_prompt max_chars / part: the pages put together are the whole prompt; no argument gives the old answer; part without max_chars and a part past the end are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-pages-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app. \u{1F600}\n');
    writeFileSync(join(dir, 'chains', 'one-ext.json'), JSON.stringify({
      name: 'one-ext', description: 'test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [EXT('ea')] },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'one-ext', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const whole = await call(dir, 'external_prompt', { run });
    assert.equal(Object.hasOwn(whole, 'part') || Object.hasOwn(whole, 'parts') || Object.hasOwn(whole, 'total_chars'), false, 'no paging keys without the arguments');
    const total = Array.from(whole.prompt).length;
    assert.ok(total > 1500, `the prompt is long enough to page (${total} characters)`);
    const pages = [];
    const p1 = await call(dir, 'external_prompt', { run, max_chars: 700 });
    assert.deepEqual([p1.part, p1.parts, p1.total_chars], [1, Math.ceil(total / 700), total]);
    pages.push(p1.prompt);
    for (let n = 2; n <= p1.parts; n++) pages.push((await call(dir, 'external_prompt', { run, max_chars: 700, part: n })).prompt);
    assert.equal(pages.join(''), whole.prompt, 'the pages put together are the whole prompt');
    assert.ok(pages.every(x => Array.from(x).length <= 700));
    assert.equal(p1.waiting.length, 1);
    assert.match((await call(dir, 'external_prompt', { run, max_chars: 700, part: p1.parts + 1 })).error, /does not exist/);
    assert.match((await call(dir, 'external_prompt', { run, part: 2 })).error, /part needs max_chars/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// 0.8.4 (S9-08): prepare_stage_prompt takes an optional stage, like external_prompt. No stage: the first waiting stage, written to stage_prompt.md as before. Another waiting stage: its own file, so the two bundles
// do not overwrite each other; a stage the run is not waiting for is refused.
test('prepare_stage_prompt stage: the first stage keeps stage_prompt.md, another waiting stage gets its own bundle, a stage not waited for is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-prepare-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'chains', 'two-ext.json'), JSON.stringify({
      name: 'two-ext', description: 'test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [EXT('ea'), { provider: 'mock', model: 'mock-critic-a', lab: 'mb' }, EXT('ec')] },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'two-ext', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const runDir = join(dir, 'runs', run);
    const a = await call(dir, 'prepare_stage_prompt', { run });
    assert.equal(a.stage, 'panel-1-ea');
    assert.equal(a.written, join(runDir, 'stage_prompt.md'), 'no stage: the old file name');
    const b = await call(dir, 'prepare_stage_prompt', { run, stage: 'panel-1-ec' });
    assert.equal(b.stage, 'panel-1-ec');
    assert.equal(b.written, join(runDir, 'stage_prompt-panel-1-ec.md'));
    assert.match(readFileSync(b.written, 'utf8'), /panel-1-ec/);
    assert.match(readFileSync(a.written, 'utf8'), /panel-1-ea/, 'the first bundle was not overwritten');
    const same = await call(dir, 'prepare_stage_prompt', { run, stage: 'panel-1-ea' });
    assert.equal(same.written, join(runDir, 'stage_prompt.md'), 'naming the first stage is the same as naming none');
    assert.match((await call(dir, 'prepare_stage_prompt', { run, stage: 'panel-1-mb' })).error, /not waiting/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// Bug audit 2026-09-28 (external seats #1): stage labels with a dot (plan-daily-7's `opus5.5-sub`)
// failed the tools' old /^[a-z0-9-]+$/ schema, so no such stage could be answered over MCP.
test('a dotted lab (opus5.5-sub) can be fetched and answered over MCP; a ".." label is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-dotted-'));
  try {
    mkdirSync(join(dir, 'tasks'));
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'chains', 'dotted.json'), JSON.stringify({
      name: 'dotted', description: 'test', maxRounds: 1, signoff: 'unanimous',
      estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
      seats: {
        criteria: { provider: 'mock', model: 'mock-criteria' },
        builder: { provider: 'mock', model: 'mock-builder' },
        reviser: { provider: 'mock', model: 'mock-builder' },
        critics: [{ provider: 'external', model: 'subscription:opus-5.5', lab: 'opus5.5-sub' }],
      },
    }));
    const first = spawnSync(process.execPath, [cli, '--chain', 'dotted', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const p = await call(dir, 'external_prompt', { run, stage: 'panel-1-opus5.5-sub' });
    assert.equal(p.stage, 'panel-1-opus5.5-sub', JSON.stringify(p));
    const bad = (await mcpSession(dir, [{ name: 'submit_stage', arguments: { run, stage: '..panel', content: PASS } }])).get(2);
    assert.ok(bad.error || bad.result?.isError, `a ".." label must be refused, got ${JSON.stringify(bad)}`);
    // CHANGED ACCEPTED TEST (decider-readiness apply patch fix-up, 24 Okt 2026; the full suite on fad02049 listed it, #1646). OLD: the answer was PASS, a verdict with no ids. NEW: once src/roles.js records the verdict-envelope sentence the prompt carries a review_id and a draft_id and a reply without them is not counted (unheard), so the run did not finish; the answer carries the pair read from the call's record (`panel-1-opus5.5-sub.envelope.json`), as the answering session copies it from the prompt; without a record (words not recorded) it is PASS as before. WHY: the property under test is that a dotted lab can be fetched and answered over MCP.
    const envFile = join(dir, 'runs', run, 'panel-1-opus5.5-sub.envelope.json');
    const answer = existsSync(envFile) ? JSON.stringify({ ...(({ review_id, draft_id }) => ({ review_id, draft_id }))(JSON.parse(readFileSync(envFile, 'utf8'))), ...JSON.parse(PASS) }) : PASS;
    const a = await call(dir, 'submit_stage', { run, stage: 'panel-1-opus5.5-sub', content: answer });
    assert.equal(a.written, 'panel-1-opus5.5-sub.md', JSON.stringify(a));
    assert.equal(a.resumed, true);
    // The answer resumes the run in a detached child. Wait for it to finish before the cleanup below,
    // or rmSync races its writes (CI 2026-09-29, v0.7.9 tag build: ENOTEMPTY on runs/<id>).
    const runDir = join(dir, 'runs', run);
    await waitForRunEnd(runDir);
    assert.ok(existsSync(join(runDir, 'report.json')), 'the run finished after the answer');
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// Bug audit 2026-09-28 (area 6 MED-1): start_run checked context files against the denylist, but a
// resume re-read the folder unchecked, so a secret added during a pause reached every seat.
test('an MCP resume refuses when a context folder gained a denied file during the pause', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-mcp-ctx-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'ctx')); mkdirSync(join(dir, 'secrets'));
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    writeFileSync(join(dir, 'ctx', 'direction.md'), 'Keep it small.\n');
    writeFileSync(join(dir, 'secrets', 'token.md'), 'SECRET-MARKER-123\n');
    const first = spawnSync(process.execPath, [cli, '--chain', 'mock-external', '--task', 'tasks/t.md', '--context', 'ctx'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    assert.equal(first.status, 3, first.stdout + first.stderr);
    const run = readdirSync(join(dir, 'runs'))[0];
    const waiting = (await call(dir, 'external_prompt', { run })).stage;
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join('..', 'secrets', 'token.md'), join(dir, 'ctx', 'zz.md'));
    const r = await call(dir, 'submit_stage', { run, stage: waiting, content: '# Plan\n\nA small app.\n' });
    assert.equal(r.resumed, false, JSON.stringify(r));
    assert.match(r.error || JSON.stringify(r), /refused to resume: context: refused/);
    for (const f of readdirSync(join(dir, 'runs', run))) {
      if (f.startsWith('NEEDS-')) assert.doesNotMatch(readFileSync(join(dir, 'runs', run, f), 'utf8'), /SECRET-MARKER-123/, f);
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
