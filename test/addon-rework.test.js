// test/addon-rework.test.js
//
// 0.8.1 M1: the research patches (27, 26, 25, 31, 29 and the retention wording fix) applied onto
// 0.8.0, and the silent breaks that merge left (S1-S5, found by the 2026-10-01 review of the patch
// series). S1 lives in test/mcp-tool-latency.test.js; the rest are here. Offline, mock chains, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { runResumability } from '../src/run-status.js';
import { dryRunReport } from '../src/dry-run.js';
import { verdictStats } from '../src/verdict-stats.js';
import { metricsReport } from '../src/metrics.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-rework-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), '# Advice\n\nShould the note list keep ticked items or remove them?\n');
  return dir;
};
const run = (dir, args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, ...extra }, timeout: 60_000 });
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateReport = ajv.compile(schema);

// An advice run stopped by its own wall clock before the first call: the mock pre-start wait (1.5 s) is
// longer than the chain's wall clock (1 s, the lint's minimum), so the stop lands before anything is called.
function stoppedAdviceRun() {
  const dir = workspace();
  const c = chain('mock-advise-single');
  c.name = 'mock-wall'; c.advise.max_wall_ms = 1000;
  writeFileSync(join(dir, 'chains', 'mock-wall.json'), JSON.stringify(c, null, 2));
  const r = run(dir, ['--task', 'tasks/t.md', '--chain', 'mock-wall'], { COUNCIL_MOCK_PRESTART_MS: '1500' });
  return { dir, r, runDir: onlyRun(dir) };
}

test('S2 + S3: an advice run stopped before its first call is not resumable, and state.json at rest says so', () => {
  const { r, runDir } = stoppedAdviceRun();
  assert.equal(r.status, 18, r.stdout + r.stderr);
  // 0.8.1 M6: the marker names its cause (STOPPED-<stoppedBy>.json), and the status mirrors budget_stopped.
  assert.ok(existsSync(join(runDir, 'STOPPED-wall_clock.json')));
  // S2: it used to fall through to 'process_gone', resumable with nothing to do.
  const s = runResumability(runDir, readJson(join(runDir, 'run.json')));
  assert.deepEqual([s.status, s.resumable, s.reason, s.needs], ['wall_clock_stopped', false, 'wall_clock_stopped', null]);
  assert.equal(s.stoppedAt.stoppedBy, 'wall_clock');
  assert.equal(s.stoppedAt.beforeFirstCall, true);
  // S3: the exit-18 branch now calls finalState(), so state.json is not left saying "running".
  const state = readJson(join(runDir, 'state.json'));
  assert.equal(state.phase, 'wall_clock_stopped');
  assert.equal(state.stage, null);
});

test('S4: a resume clears a leftover STOPPED-user.json along with the other stop markers', () => {
  const dir = workspace();
  const id = '2026-10-02T20-00-00-000Z';
  const first = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/t.md', '--max-usd', '1', '--run-id', id]);
  assert.equal(first.status, 4, first.stdout + first.stderr);
  const runDir = join(dir, 'runs', id);
  writeFileSync(join(runDir, 'STOPPED-user.json'), JSON.stringify({ reason: 'client_cancel', spentUsd: 0 }));
  const again = run(dir, ['--resume', `runs/${id}`, '--max-usd', '100']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(existsSync(join(runDir, 'STOPPED-user.json')), false, 'a stale stop marker outlived the resume');
  assert.equal(existsSync(join(runDir, 'STOPPED-budget.json')), false);
});

test('S5: the dry-run JSON prices an advice chain from its own rounds, carries its ceiling, and reads the task as the brief', () => {
  for (const name of ['advise-standard', 'mock-advise-standard']) {
    const c = chain(name);
    const r = dryRunReport(c, { taskChars: null });
    assert.deepEqual(r.advise, { usd: c.advise.usd, rounds: c.advise.rounds, seats: c.seats.critics.length }, name);
    // The cheapest end is a blind wave that agrees: no debate round. It used to equal the worst case.
    const blindOnly = dryRunReport({ ...c, advise: { ...c.advise, rounds: 0 } }, {}).estimate.worstCaseUsd;
    assert.equal(r.estimate.floorUsd, blindOnly, name);
    if (c.advise.rounds > 0 && r.estimate.worstCaseUsd > 0) assert.ok(r.estimate.floorUsd < r.estimate.worstCaseUsd, name);
  }
  // A brief twice the assumed prompt: priced as the whole prompt (replaced), not added to the assumption.
  const c = chain('advise-standard');
  const assumed = c.estimate.promptTokens;
  const r = dryRunReport(c, { taskChars: assumed * 2 * 4 });
  const replaced = dryRunReport({ ...c, estimate: { ...c.estimate, promptTokens: assumed * 2 } }, {}).estimate.worstCaseUsd;
  assert.equal(r.estimate.worstCaseWithTaskUsd, replaced);
  // A planning chain keeps both old rules: floor = one review round, the task added to the assumption.
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): plan-fast moved to archive/chains/; cheap-7-v2 stands in as the planning chain.
  const p = chain('cheap-7-v2');
  const pr = dryRunReport(p, { taskChars: 80_000 });
  assert.equal(pr.advise, undefined);
  assert.equal(pr.estimate.floorUsd, dryRunReport({ ...p, maxRounds: 1 }, {}).estimate.worstCaseUsd);
  const assumedP = p.estimate?.promptTokens ?? 4000;
  assert.equal(pr.estimate.worstCaseWithTaskUsd, dryRunReport({ ...p, estimate: { ...(p.estimate || {}), promptTokens: assumedP + 20_000 } }, {}).estimate.worstCaseUsd);
});

// One finished mock advice call from the CLI, the way a person at the terminal starts one.
function answeredAdviceRun(chainName = 'mock-advise-standard') {
  const dir = workspace();
  const r = run(dir, ['--task', 'tasks/t.md', '--chain', chainName]);
  return { dir, r, runDir: onlyRun(dir) };
}

test('N1-N4: the naming pass: advice fields nested under advise, one hash per concept, no full prompt hash in stages[]', () => {
  const { dir, r, runDir } = answeredAdviceRun();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = readJson(join(runDir, 'report.json'));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  // N1, N2, N3: none of the patch's root copies.
  for (const k of ['stopped_by', 'brief_sha256', 'sent_to', 'dispositions']) assert.equal(k in report, false, `root ${k}`);
  const c = chain('mock-advise-standard');
  const seats = c.seats.critics.length + (c.advise.synthesis === 'seat' ? 1 : 0);
  assert.ok(Array.isArray(report.advise.sent_to) && report.advise.sent_to.length === seats, JSON.stringify(report.advise.sent_to));
  assert.deepEqual(report.advise.dispositions, []);
  // N2: the brief is the task file, so its hash is task_sha256.
  const task = readFileSync(join(dir, 'tasks', 't.md'), 'utf8');
  assert.equal(report.task_sha256, createHash('sha256').update(task).digest('hex'));
  // N4: stages[] keeps the 16-hex promptHash; the full hash, size, endpoint and scan are in audit.jsonl only.
  for (const s of report.stages) for (const k of ['promptSha256', 'promptBytes', 'endpoint', 'scan']) assert.equal(k in s, false, `${s.label}.${k}`);
  const audit = readFileSync(join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(audit.some(l => /^[0-9a-f]{64}$/.test(l.promptSha256 || '')), 'audit.jsonl carries the full prompt hash');
});

test('N5: verdict_stats and metrics skip a report that carries advise, and say how many they skipped', () => {
  const { dir, r } = answeredAdviceRun('mock-advise-single');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = verdictStats(join(dir, 'runs'), { days: 3650 });
  assert.equal(v.adviceRunsSkipped, 1);
  assert.equal(v.runsSeen, 0);
  assert.deepEqual(v.chains, []);
  const m = metricsReport(join(dir, 'runs'), { days: 3650 });
  assert.equal(m.adviceRunsSkipped, 1);
  assert.equal(m.runsSeen, 0);
});

test('N6: the schema and docs/report-format.md say passed and outcome are not a sign-off on an advice call', () => {
  for (const k of ['passed', 'outcome']) assert.match(schema.properties[k].description, /carries `advise`[^.]*not a sign-off/, k);
  const doc = readFileSync(join(root, 'docs', 'report-format.md'), 'utf8');
  assert.match(doc, /`passed` and `outcome` on an advice call are not a sign-off/);
});

// ---- the MCP side, through a real stdio server -----------------------------------------------------------------------------
// One session; council_advise's elicitation is answered the way a person who read the text and pressed "send" would.
// `person: false`: a client that cannot ask anyone (no elicitation capability).
function mcpSession(cwd, env = {}, { person = true } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '1', COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { action: 'accept', content: { send: true } } })}\n`);
      else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: person ? { elicitation: {} } : {}, clientInfo: { name: 'addon-rework', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result?.structuredContent ?? m.result; },
    async close() { child.stdin.end(); await new Promise(r => { child.on('exit', r); setTimeout(r, 3000); }); child.kill(); },
  };
}
const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should the note list keep ticked items or remove them?',
  decision_at_stake: 'Removing them loses the history; keeping them clutters the list.',
  options_considered: [{ name: 'Keep', summary: 'Grey them out at the bottom.' }, { name: 'Remove', summary: 'Delete on tick.' }],
  tried: [{ what: 'Asked two users', result: 'They disagreed.' }],
  sensitivity: 'public', not_included: ['the conversation'],
});
const SALT = '.the-high-council-advice-salt';
async function waitFor(fn, ms = 20_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; }

test('Work 5 (P15): council_quote writes nothing, even in an empty HOME; the first council_advise creates the salt (0600), and the question hash survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-salt-'));
  let s = mcpSession(dir);
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.ok(q.quote_id, JSON.stringify(q));
    assert.deepEqual(readdirSync(dir), [], 'council_quote is read-only: nothing in HOME or the project');
    // 0.8.1 DR-6: the hold counts from the start of the call and covers the approval and the run's start-up, so a 1 s hold no
    // longer leaves time for the answer; this test is about the salt, so it holds for the default.
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 25 });
    assert.ok(a.run, JSON.stringify(a));
    assert.ok(existsSync(join(dir, SALT)));
    assert.equal(statSync(join(dir, SALT)).mode & 0o777, 0o600);
    assert.match(readFileSync(join(dir, SALT), 'utf8'), /^[0-9a-f]{32}$/);
    assert.ok(await waitFor(() => existsSync(join(dir, 'runs', a.run, 'report.json'))), 'the mock call finished');
  } finally { await s.close(); }
  // A new server process: the same question gets the same hash, so the duplicate guard still recognises it.
  const firstLog = readJson(join(dir, 'runs', readdirSync(join(dir, 'runs'))[0], 'advise-log.json'));
  s = mcpSession(dir);
  try {
    const again = await s.call('council_quote', { brief: { ...BRIEF(), new_evidence: 'A third user asked for both: ticked items kept but hidden behind a toggle.' }, mode: 'single' });
    assert.ok(again.quote_id, JSON.stringify(again));
    const a2 = await s.call('council_advise', { quote_id: again.quote_id, confirm_sha256: again.text.sha256, wait_seconds: 25 });
    assert.ok(a2.run, JSON.stringify(a2));
    assert.ok(await waitFor(() => existsSync(join(dir, 'runs', a2.run, 'advise-log.json'))));
    assert.equal(readJson(join(dir, 'runs', a2.run, 'advise-log.json')).question_hash, firstLog.question_hash);
  } finally { await s.close(); }
});

test('Work 5 (P15): a salt file that exists but holds no salt refuses council_advise (salt_unavailable) and sends nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-salt-'));
  writeFileSync(join(dir, SALT), 'not a salt\n');
  const s = mcpSession(dir);
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 1 });
    assert.equal(a.code, 'salt_unavailable', JSON.stringify(a));
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(readFileSync(join(dir, SALT), 'utf8'), 'not a salt\n', 'the file is left for the person to judge');
  } finally { await s.close(); }
});

// 0.8.2 (owner, 6 Oct 2026, "yes" to two new single seats): the swaps gain glm-flash and qwen, the shipped advice chains gain their two files.
test('Work 6: the shipped roster: advise-standard is Sol, GLM-5.3 and Gemini 3.8 Flash; the swaps are sol, astra, gemini, deepseek, opus, glm-flash, qwen; every advice chain is not resumable after a stop', async () => {
  const std = chain('advise-standard');
  assert.deepEqual(std.seats.critics.map(s => s.model), ['openai/gpt-6.1-sol', 'z-ai/glm-5.3', 'google/gemini-3.8-flash']);
  assert.equal(std.seats.critics[1].maxTokens, 54_000, 'GLM-5.3 at its default effort (research report 31 section 7.2)');
  const { SEAT_CHAINS } = await import('../src/mcp/advice.js');
  assert.deepEqual(Object.keys(SEAT_CHAINS).sort(), ['astra', 'deepseek', 'gemini', 'glm-flash', 'opus', 'qwen', 'sol']);
  const shipped = readdirSync(join(root, 'chains')).filter(f => /^advise-/.test(f)).map(f => f.slice(0, -5)).sort();
  assert.deepEqual(shipped, ['advise-premium', 'advise-single', 'advise-single-astra', 'advise-single-deepseek', 'advise-single-gemini', 'advise-single-glm-flash', 'advise-single-opus', 'advise-single-qwen', 'advise-standard']);
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    if (c.advise?.enabled === true) assert.equal(c.resumeAfterStop, false, f);
  }
});

test('Work 6 (DR-7): advise-premium lints clean, seats no denied model and no Anthropic seat, every seat is priced, and an operator can quote it ($0)', async () => {
  const { lintChain } = await import('../src/chain-lint.js');
  const { deniedReasonsOf } = await import('../src/denied-models.js');
  const { priceOf } = await import('../src/cost.js');
  const c = chain('advise-premium');
  assert.deepEqual(lintChain(c, 'advise-premium'), []);
  for (const s of c.seats.critics) {
    assert.deepEqual(deniedReasonsOf([s]), [], s.model);
    assert.ok(!/anthropic\//.test(s.model), `${s.model}: the caller is Claude`);
    assert.ok(priceOf(s.provider, s.model), `${s.model} is priced`);
  }
  // A quote is free and sends nothing. The operator selects the chain, opens the floor to public and raises the money limits.
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-premium-'));
  // 0.8.1 decided rule 5d: the floor is the operator's setting; a project's policy.json cannot lower it.
  const s = mcpSession(dir, { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public', COUNCIL_ADVISE_MOCK: '0', COUNCIL_ADVISE_CHAIN_COUNCIL: 'advise-premium', COUNCIL_ADVISE_MAX_USD_PER_CALL: '10', COUNCIL_ADVISE_MAX_USD_PER_SESSION: '10', COUNCIL_ADVISE_MAX_USD_PER_DAY: '10' });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    assert.ok(q.quote_id, JSON.stringify(q));
    assert.equal(q.seats.length, 6);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { await s.close(); }
});

test('Work 7 (audit A5): home and service paths become [PATH_n] (/root, /srv, /home); /rooted is not a path to mask', async () => {
  const { mask } = await import('../src/advice-mask.js');
  const r = mask('Logs are in /root/app.log and the unit in /srv/notes/unit.conf and the checkout in /home/max/notes and /rooted/x is a word.');
  assert.match(r.text, /in \[PATH_\d\] and the unit in \[PATH_\d\] and the checkout in \[PATH_\d\] and/);
  assert.ok(!/\/root\/|\/srv\/|\/home\//.test(r.text), r.text);
  assert.match(r.text, /\/rooted\/x/);
  // Only a path that starts a token: relative paths that contain root or srv are not home paths (M1 review).
  assert.equal(mask('see src/root/index.js and lib/srv/x.js').text, 'see src/root/index.js and lib/srv/x.js');
  assert.match(mask('(/home/max/notes) and `/srv/app/x` and /root').text, /^\(\[PATH_\d\]\) and `\[PATH_\d\]` and \[PATH_\d\]$/);
});

test('Work 7 (audit A5): the IBAN shapes come from the PII gate, not a copy', () => {
  const src = readFileSync(join(root, 'src', 'advice-mask.js'), 'utf8');
  assert.match(src, /IBAN_SHAPE_RE as IBAN, IBAN_SPACED_RE as IBAN_SPACED \} from '\.\/pii-gate\.js'/);
  assert.ok(!/const IBAN\w* = \//.test(src), 'no local IBAN regex');
});

test('Work 7 (audit A5): a bare Mistral-shaped or Together-shaped key in a brief is refused secret_shaped, with no provider named', async () => {
  // Synthetic strings with the two shapes (32 letters and digits; 64 lowercase hex), built here: never real keys.
  const mistralShaped = createHash('sha256').update('synthetic-a').digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  const togetherShaped = createHash('sha256').update('synthetic-b').digest('hex');
  assert.equal(mistralShaped.length, 32);
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-keys-'));
  const s = mcpSession(dir);
  try {
    for (const k of [mistralShaped, togetherShaped]) {
      const brief = { ...BRIEF(), tried: [{ what: `Called the API with ${k}`, result: 'It answered.' }] };
      const q = await s.call('council_quote', { brief, mode: 'single' });
      assert.equal(q.code, 'secret_shaped', JSON.stringify(q));
    }
    assert.deepEqual(readdirSync(dir), [], 'nothing written');
  } finally { await s.close(); }
});

test('Work 9 (DR-3): the operator allowance is gone: no file names it, and a cheap internal call with no way to ask a person starts nothing (awaiting_approval since M4)', async () => {
  const name = 'COUNCIL_ADVISE_' + 'AUTO_USD'; // built, so this file does not match its own check
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'docs')), ...walk(join(root, 'test')), join(root, 'README.md')]
    .filter(f => /\.(js|mjs|json|md|html)$/.test(f));
  const hits = files.filter(f => readFileSync(f, 'utf8').includes(name));
  assert.deepEqual(hits, []);
  const dir = mkdtempSync(join(tmpdir(), 'thc-addon-noallow-'));
  // A client with no elicitation, and the old variable set as an operator might have left it: it changes nothing.
  const s = mcpSession(dir, { [name]: '5' }, { person: false });
  try {
    const q = await s.call('council_quote', { brief: { ...BRIEF(), sensitivity: 'internal' }, mode: 'single' });
    assert.match(q.next, /The user will be asked to approve the send/);
    assert.ok(q.price.ceiling_usd < 5, 'the call is well inside what the old allowance would have covered');
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 1 });
    // 0.8.1 M4: the call waits for a person (council gate answer, or a client that can ask); the old variable approves nothing.
    assert.equal(a.status, 'awaiting_approval', JSON.stringify(a));
    assert.equal(existsSync(join(dir, 'runs', a.run, 'advise-log.json')), false, 'nothing started');
    assert.equal(existsSync(join(dir, 'runs', a.run, 'run.json')), false, 'nothing started');
  } finally { await s.close(); }
});

// ---- the public contract after the patches -------------------------------------------------------------------------------
// The same walk that recorded test/fixtures/report-v1-080-keys.json from the 0.8.0 schema: every property path and its type.
function schemaKeys(s) {
  const out = {};
  const typeOf = n => (n.type !== undefined ? n.type : n.$ref ? { $ref: n.$ref } : ['anyOf', 'oneOf', 'allOf'].find(k => n[k]) ? { [['anyOf', 'oneOf', 'allOf'].find(k => n[k])]: n[['anyOf', 'oneOf', 'allOf'].find(k => n[k])].map(typeOf) } : n.const !== undefined || n.enum ? 'enum' : 'any');
  const walk = (n, p) => {
    if (!n || typeof n !== 'object') return;
    if (n.properties) for (const [k, v] of Object.entries(n.properties)) { out[`${p}/properties/${k}`] = typeOf(v); walk(v, `${p}/properties/${k}`); }
    if (n.items && typeof n.items === 'object') walk(n.items, `${p}/items`);
    for (const k of ['anyOf', 'oneOf', 'allOf']) if (n[k]) n[k].forEach((x, i) => walk(x, `${p}/${k}/${i}`));
    if (n.additionalProperties && typeof n.additionalProperties === 'object') walk(n.additionalProperties, `${p}/additionalProperties`);
  };
  walk(s, '');
  for (const [d, v] of Object.entries(s.$defs || {})) walk(v, `/$defs/${d}`);
  return out;
}

test('report.json stays additive (decided rule 11): every 0.8.0 property is still there with the same type', () => {
  const was = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'report-v1-080-keys.json'), 'utf8'));
  const now = schemaKeys(schema);
  assert.equal(Object.keys(was.keys).length, was.count);
  const lost = Object.keys(was.keys).filter(k => !(k in now));
  assert.deepEqual(lost, [], 'a 0.8.0 property disappeared');
  const retyped = Object.keys(was.keys).filter(k => JSON.stringify(now[k]) !== JSON.stringify(was.keys[k]));
  assert.deepEqual(retyped, [], 'a 0.8.0 property changed type');
});

test('the two advice golden reports (mock single, mock council) validate against the schema', () => {
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const r = readJson(join(root, 'test', 'fixtures', f));
    assert.equal(validateReport(r), true, `${f}: ${JSON.stringify(validateReport.errors)}`);
    assert.ok(r.advise && Array.isArray(r.advise.sent_to) && Array.isArray(r.advise.dispositions), f);
    assert.match(r.task_sha256, /^[0-9a-f]{64}$/, f);
  }
});

test('stage labels are the 0.8.0 set for every mock planning chain (renaming one orphans paused runs)', () => {
  const was = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'stage-labels-080.json'), 'utf8')).chains;
  for (const [name, w] of Object.entries(was)) {
    const dir = workspace();
    writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
    const r = run(dir, ['--task', 'tasks/t.md', '--chain', name, '--max-usd', '100']);
    assert.equal(r.status, w.exit, `${name}: ${r.stderr.slice(-400)}`);
    const rd = onlyRun(dir);
    const rep = existsSync(join(rd, 'report.json')) ? 'report.json' : existsSync(join(rd, 'report-partial.json')) ? 'report-partial.json' : null;
    const labels = rep ? readJson(join(rd, rep)).stages.map(s => s.label) : readdirSync(rd).filter(x => x.endsWith('.usage.json')).map(x => x.slice(0, -11));
    assert.deepEqual([...new Set(labels)].sort(), w.labels, name);
  }
});

test('the advice answer says "leaning" and none of decided rule 2\'s words (verdict, better, safer, more reliable)', async () => {
  const { adviceResult, QUOTE_DESCRIPTION, advisorDescription } = await import('../src/mcp/advice.js');
  const banned = /\b(verdict|better|safer|more reliable)\b/i;
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const report = readJson(join(root, 'test', 'fixtures', f));
    const r = adviceResult({ run: 'R1', report, log: { wall_ms: 1000 } });
    // The harness's own words: the text with every value of the fields the answer itself names as model-written
    // (structuredContent.untrusted_fields) cut out. What a model wrote is data, not the harness speaking.
    const strings = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
    const modelText = r.structuredContent.untrusted_fields.flatMap(k => strings(r.structuredContent[k])).filter(s => s.length > 3).sort((a, b) => b.length - a.length);
    let own = r.content.map(c => c.text).join('\n');
    for (const s of modelText) own = own.split(s).join(' ');
    assert.match(own, /leaning/i, f);
    assert.ok(!banned.test(own), `${f}: "${own.match(banned)?.[0]}" in: ${own.split('\n').filter(l => banned.test(l)).join(' | ')}`);
  }
  for (const d of [QUOTE_DESCRIPTION, advisorDescription({ single: chain('advise-single'), council: chain('advise-standard') })]) assert.ok(!banned.test(d), d.match(banned)?.[0]);
});

test('decided rule 2 in every public advice text: the deliverable, BOARD.md, the advice chain descriptions and the advice schema text say "leaning", never "verdict"', async () => {
  const { renderAdvice, renderAdviseBoard } = await import('../src/advise.js');
  const banned = /\b(verdicts?|better|safer|more reliable)\b/i;
  // Model-written values (answers, risks, quotes, the synthesis text) are cut out first: they are data, not the harness speaking.
  const modelText = a => [a.verdict_text, a.next_step, ...(a.opinions || []).flatMap(o => [o.first, o.final].flatMap(x => [x?.answer, x?.restated_question, x?.would_change_if, ...(x?.risks || []).flatMap(r => [r.risk, r.quote])])),
    ...(a.dissent || []).flatMap(d => [d.answer, d.would_change_if, d.top_risk?.risk, d.top_risk?.quote]), ...(a.missing_from_brief || []),
    ...(a.debate?.rounds || []).flatMap(r => r.replies.flatMap(x => [x.changed_because, x.still_contested]))].filter(s => typeof s === 'string' && s.length > 3).sort((x, y) => y.length - x.length);
  for (const f of ['report-advice-single.json', 'report-advice-council.json']) {
    const a = readJson(join(root, 'test', 'fixtures', f)).advise;
    for (const [what, text0] of [['deliverable', renderAdvice(a)], ['board', renderAdviseBoard(a, { sent_to: a.sent_to, dispositions: a.dispositions, brief_sha256: 'a'.repeat(64) })]]) {
      let text = text0; for (const s of modelText(a)) text = text.split(s).join(' ');
      assert.ok(!banned.test(text), `${f} ${what}: "${text.match(banned)?.[0]}" in: ${text.split('\n').filter(l => banned.test(l)).join(' | ')}`);
    }
    assert.match(renderAdvice(a), /\*\*Leaning: /);
  }
  for (const f of readdirSync(join(root, 'chains')).filter(f => /advise-.*\.json$/.test(f))) {
    const d = chain(f.slice(0, -5)).description;
    assert.ok(!banned.test(d), `${f}: "${d.match(banned)?.[0]}"`);
  }
  const chainSchema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const adviseSchemaText = JSON.stringify(chainSchema.properties.advise);
  assert.ok(!banned.test(adviseSchemaText), adviseSchemaText.match(banned)?.[0]);
  // The report schema's advise text may name the field `verdict` in backticks; prose may not use the word.
  assert.ok(!banned.test(schema.properties.advise.description.replace(/`verdict(_text)?`/g, '')), schema.properties.advise.description);
});
