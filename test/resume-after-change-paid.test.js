// The PAID PATH of the resume-after-a-change screen (0.8.4, the ladder unit): test/resume-after-change.test.js feeds the screen hand-built numbers; this one runs a real paid start against a loopback OpenRouter stub (the seat bills, the stage records
// its cost), edits the chain file, resumes, and reads the amend screen the CLI wrote to disk. The sentence must appear on THE REAL SCREEN, and its cost figure must be the figure the screen then counts as "Already counted" (the cost of the
// finished step, which the limit keeps counting when the step is asked again). Offline, $0: the key is a placeholder literal. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call as mockCall } from '../src/providers.js';
import { formatUsd } from '../src/cost.js';
import { startTyped, typeCap } from './helpers/typed-cap.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-11-10T07-00-00-000Z';
const PROBE_BODY = { error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } };

// the first request is answered as the mock proposer would, every later one is refused with the probe's 404 (the run then stops with one finished PAID step on disk)
async function stub() {
  const hits = [];
  const srv = createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', async () => {
    hits.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (hits.length > 1) { res.writeHead(404); return res.end(JSON.stringify(PROBE_BODY)); }
    const body = JSON.parse(raw); const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'); const user = body.messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
    const r = await mockCall('mock', { model: 'mock-proposer-a', system, messages: [{ role: 'user', content: user }], maxTokens: body.max_tokens ?? body.max_completion_tokens });
    res.writeHead(200); res.end(JSON.stringify({ id: 'stub-1', model: body.model, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output } }));
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
}

test('RC-5 (the paid path): after the chain file changed, the amend screen the CLI writes says how many finished steps were made under the earlier chain, that the paid one is paid again, and its cost, and that cost is the figure the screen counts as already counted; with the chain unchanged there is no such sentence (the swapped input)', async () => {
  const s = await stub();
  try {
    const dir = mkdtempSync(join(tmpdir(), 'thc-rc-paid-')); mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
    const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    const seat = { provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: s.url };
    const chainPath = join(dir, 'chains', 'rc.json');
    writeFileSync(chainPath, JSON.stringify({ ...base, name: 'rc', seats: { ...base.seats, proposers: [seat, ...base.seats.proposers] } }));
    const run = args => new Promise(done => {
      let out = '';
      const child = spawn(process.execPath, [cli, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: tmpdir(), OPENROUTER_API_KEY: 'sk-or-v1-placeholder-not-a-key', COUNCIL_ALLOW_LOOPBACK_KEY_HOST: '1' } });
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      child.on('exit', code => done({ code, out }));
    });
    const rd = join(dir, 'runs', RUN);
    await startTyped(run, ['--chain', 'rc', '--task', 'tasks/t.md', '--run-id', RUN], rd);
    // the one finished PAID step and its recorded cost
    const paid = readdirSync(rd).filter(f => f.endsWith('.usage.json')).map(f => ({ f, u: JSON.parse(readFileSync(join(rd, f), 'utf8')) })).filter(x => x.u.provider === 'openrouter' && Number.isFinite(x.u.usd) && x.u.usd > 0);
    assert.equal(paid.length, 1, `the premise: one finished paid step on disk (${readdirSync(rd).join(', ')})`);
    const cost = formatUsd(paid[0].u.usd);
    // control: nothing changed -> the next resume that asks a limit question says nothing of earlier steps. (A resume with an unchanged chain asks no limit question at all: it needs no screen.)
    const unchanged = readdirSync(rd).filter(n => /^cap-screen-\d+\.md$/.test(n));
    for (const n of unchanged) assert.doesNotMatch(readFileSync(join(rd, n), 'utf8'), /finished steps? of this run (was|were) made under the earlier chain or task/);
    // the chain changes: the proposer's token allowance, so that step's inputs differ
    const edited = JSON.parse(readFileSync(chainPath, 'utf8')); edited.seats.proposers[0].maxTokens = 600;
    writeFileSync(chainPath, JSON.stringify(edited));
    const hits = s.hits.length;
    const asked = await run(['--resume', rd]);
    assert.equal(asked.code, 21, asked.out);
    assert.equal(s.hits.length, hits, 'no request before the new limit');
    const screens = readdirSync(rd).filter(n => /^cap-screen-\d+\.md$/.test(n)).sort();
    const screen = readFileSync(join(rd, screens.at(-1)), 'utf8');
    assert.match(screen, /Changed since the limit for this run was typed: the chain file\./);
    // FINDING (not on the owed list of the ladder unit; sets 5 and 6, red on this line). OLD bar: the sentence counts "1 finished step" (the premise: only the step of the edited seat is stale). NEW bar: it counts every finished step on disk that carries an inputs fingerprint, read here from the run folder (the fingerprint is the whole chain's, so editing one seat's allowance makes every finished step stale; the box printed 7). WHY: the old bar was never run (until round 10 the sentence was not printed at all), and the fingerprint is per run, not per step. The sentence itself is the unchanged A-DRAFT sentence of src/stale-stages.js.
    const stale = [...new Set(readdirSync(rd).map(f => /^(.+)\.(?:prompt|usage)\.json$/.exec(f)?.[1]).filter(Boolean))].filter(l => existsSync(join(rd, `${l}.md`)) && [`${l}.prompt.json`, `${l}.usage.json`].some(f => { try { return typeof JSON.parse(readFileSync(join(rd, f), 'utf8')).inputsFingerprint === 'string'; } catch { return false; } })).length;
    assert.ok(stale > 1, `the premise: every finished step is stale, more than the one paid step (${stale})`);
    const sentence = new RegExp(`${stale} finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again\\. The paid step is paid again if asked again, and what it cost before \\(${cost.replace(/[$.]/g, '\\$&')}\\) still counts toward the limit\\.`);
    assert.match(screen, sentence, `the sentence is on the real screen, with the recorded cost ${cost}`);
    assert.match(screen, new RegExp(`Already counted: ${cost.replace(/[$.]/g, '\\$&')}\\.`), 'the figure in the sentence is the figure the screen counts');
    assert.ok(typeCap(rd, '25'), 'the limit can be typed');
  } finally { await s.close(); }
});
