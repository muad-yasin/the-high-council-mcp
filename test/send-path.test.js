// The shared send path (0.8.1 plan DR-5, M4): the twelve pre-send refusals in their order, the kind seam, and the
// advice tools' schema sizes. Mock-only, $0, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { preSendRefusals, gateSeatsOf } from '../src/send-path-refusals.js';
import { profileFor, KINDS } from '../src/send-profiles.js';
import { registerAdviceTools } from '../src/mcp/advice.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shipped = name => { try { return JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8')); } catch { return null; } };
// A mock seat with fixture prices (src/pricing.json's mock rows), dear enough that its blind round is above $1.
const PRICEY = { name: 'pricey', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1, rounds: 0, synthesis: 'none', max_wall_ms: 60000 }, seats: { critics: [{ provider: 'mock', model: 'mock-priced', maxTokens: 50000, lab: 'p' }] } };
// The shipped single chain with its seat swapped to one that has no ZDR-tagged endpoint (as test/advice-tools.test.js does).
const NO_ZDR = (() => { const c = shipped('advise-single'); c.name = 'no-zdr'; c.seats.critics = [{ provider: 'openrouter', model: 'meta/muse-spark-1.3', maxTokens: 9000, lab: 'muse-spark1.3', extra: { reasoning: { effort: 'medium' } }, estimate: { critiqueTokens: 5500 } }]; return c; })();
const loadChain = name => (name === 'pricey' ? PRICEY : name === 'no-zdr' ? NO_ZDR : shipped(name));

const BRIEF = () => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'],
  excerpts: [],
});
const KEY = `OPENROUTER_API_KEY=sk-or-v1-${'a1b2c3d4'.repeat(8)}`;

// One mutation per rule, each touching its own part of the case. Where two touch the same setting (the chain for
// rules 4, 5 and 9, policy.json for 3 and 11), the earlier rule's mutation is applied last, so its value is the one in
// force: the table then tests that the earlier rule is checked first, not which mutation was applied last.
const RULES = [
  ['brief_invalid', c => { delete c.brief.tried; }],
  ['advisor_needs_single', c => { c.input.mode = 'council'; c.input.advisor = 'sol'; }],
  ['policy_unreadable', c => { c.policy = '{ broken'; }],
  ['seat_not_allowed', c => { c.env.COUNCIL_ADVISE_MOCK = '0'; c.env.COUNCIL_ADVISE_CHAIN_SINGLE = 'no-such-chain'; }],
  ['sensitivity', c => { c.env.COUNCIL_ADVISE_MOCK = '0'; c.env.COUNCIL_ADVISE_CHAIN_SINGLE = 'no-zdr'; }], // an internal brief, a seat that keeps text
  ['secret_shaped', c => { c.brief.excerpts.push({ label: 'env', kind: 'config', why_needed: 'The question is about this config.', text: KEY }); }],
  ['mask_collision', c => { c.brief.question = 'Should we email [EMAIL_1] about dropping the legacy invoices column?'; }],
  ['pii_left', c => { c.brief.decision_at_stake = 'Does ｍａｘ＠ｅｘａｍｐｌｅ．ｃｏｍ own the invoices table?'; }],
  ['over_ceiling', c => { c.env.COUNCIL_ADVISE_MOCK = '0'; c.env.COUNCIL_ADVISE_CHAIN_SINGLE = 'pricey'; }],
  ['over_server_limit', c => { c.usdLimit = 0.1; }],
  ['policy', c => { c.policy = JSON.stringify({ max_usd_per_run: 0.5 }); }], // the mock chain's ceiling is $1
  ['cap_call', c => { c.env.COUNCIL_ADVISE_MAX_USD_PER_CALL = '0.5'; }], // rule 12, the guards: one of their codes
];

function run(applied) {
  const c = { brief: BRIEF(), input: { mode: 'single' }, env: { COUNCIL_ADVISE_MOCK: '1' }, policy: null, usdLimit: null };
  for (const i of [...applied].sort((a, b) => b - a)) RULES[i][1](c);
  const work = mkdtempSync(join(tmpdir(), 'send-path-'));
  if (c.policy !== null) writeFileSync(join(work, 'policy.json'), c.policy);
  return preSendRefusals('advice', { brief: c.brief, ...c.input }, { work, runsDir: join(work, 'runs'), env: c.env, loadChain, usdLimit: c.usdLimit });
}

test('the untouched case passes all twelve', () => {
  const r = run([]);
  assert.equal(r.refusal, undefined, JSON.stringify(r.refusal));
  assert.equal(r.ok, true);
});

test('each rule alone refuses with its own code', () => {
  RULES.forEach(([code], i) => assert.equal(run([i]).refusal?.code, code, `rule ${i + 1}`));
});

test('the ordered refusal table: a case that breaks two rules gets the earlier rule\'s code, for every pair of the twelve', () => {
  for (let i = 0; i < RULES.length; i++) {
    for (let j = i + 1; j < RULES.length; j++) {
      assert.equal(run([i, j]).refusal?.code, RULES[i][0], `rules ${i + 1} and ${j + 1}`);
    }
  }
});

test('a key-shaped brief is secret_shaped and the key is never echoed; a brief over the limit is brief_invalid', () => {
  const r = run([5]);
  assert.equal(r.refusal.code, 'secret_shaped');
  assert.doesNotMatch(JSON.stringify(r.refusal), /a1b2c3d4a1b2/);
  const c = BRIEF();
  c.excerpts = [1, 2, 3, 4, 5, 6, 7].map(i => ({ label: `e${i}`, kind: 'log', why_needed: 'The question is about this block.', text: 'x'.repeat(7999) }));
  const big = preSendRefusals('advice', { brief: c, mode: 'single' }, { work: mkdtempSync(join(tmpdir(), 'send-path-')), runsDir: '/nonexistent', env: { COUNCIL_ADVISE_MOCK: '1' }, loadChain });
  assert.equal(big.refusal.code, 'brief_invalid');
});

test('the kind seam: only `advice` is registered, and an unregistered kind is refused, never defaulted', () => {
  assert.deepEqual(KINDS, ['advice']);
  assert.equal(profileFor('advice').kind, 'advice');
  for (const k of ['x', 'verify', '', undefined, '__proto__', 'constructor', 'toString']) {
    assert.throws(() => profileFor(k), err => err.code === 'unknown_kind', String(k));
  }
  assert.throws(() => preSendRefusals('x', { brief: BRIEF(), mode: 'single' }, { work: tmpdir(), runsDir: '/nonexistent', env: {}, loadChain }), err => err.code === 'unknown_kind');
});

test('the advice tools\' schemas stay within their recorded sizes (council_quote 3,708 bytes, council_advise 1,047), and no tool takes a kind', async () => {
  const work = mkdtempSync(join(tmpdir(), 'send-path-'));
  const server = new McpServer({ name: 'p', version: '0' });
  registerAdviceTools(server, { work, runsDir: join(work, 'runs'), loadChain, spawnRun: async () => ({}), waitForProgress: async () => null, statusOf: () => null, nextRunId: () => 'x', env: {} });
  const client = new Client({ name: 'c', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const { tools } = await client.listTools();
    const size = name => JSON.stringify(tools.find(t => t.name === name).inputSchema).length;
    assert.ok(size('council_quote') <= 3708, `council_quote ${size('council_quote')}`);
    assert.ok(size('council_advise') <= 1047, `council_advise ${size('council_advise')}`);
    for (const t of tools) assert.ok(!('kind' in (t.inputSchema.properties || {})), `${t.name} takes a kind`);
  } finally { await client.close(); await server.close(); }
});

// ---- approval on the gate (M4 Work 3-5) -------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requestGate, answerGate, textSha256 } from '../src/gate.js';

const cli = join(root, 'src', 'cli.js');
const sha = t => createHash('sha256').update(t).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One stdio MCP session against the real server; `person` answers the server's elicitation like a person who read it.
function session(cwd, { env = {}, person = null } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '1', COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) {
        const r = person ? person(m) : { action: 'decline' };
        child.stdin.write(`${JSON.stringify(r?.__error ? { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: r.__error } } : { jsonrpc: '2.0', id: m.id, result: r })}\n`);
      }
      else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: person ? { elicitation: {} } : {}, clientInfo: { name: 'send-path', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result?.structuredContent ?? m.result; },
    async close() { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); },
  };
}
const ACCEPT = () => ({ action: 'accept', content: { send: true } });
const waitFor = async (pred, ms = 30_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); } return false; };
const QUESTION_WORDS = ['legacy', 'invoices', 'column', 'migration', 'production'];

// The terminal channel through a real pseudo-terminal (python3's pty module), as in test/gate-answer.test.js.
const hasPython = spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
function inPty(cwd, args, answer) {
  const py = `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1]); os.execv(sys.argv[2], sys.argv[2:])
out = b''; sent = False
while True:
    try: b = os.read(fd, 4096)
    except OSError: break
    if not b: break
    out += b
    if not sent and b'[y/N]' in out:
        os.write(fd, sys.stdin.buffer.read()); sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  return spawnSync('python3', ['-c', py, cwd, process.execPath, cli, ...args], { encoding: 'utf8', input: answer, timeout: 60_000 });
}

test('the terminal route (DR-3): no dialog in the client -> awaiting_approval -> a person answers at a terminal -> the same quote starts the run', { skip: !hasPython && 'python3 is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-e2e-'));
  const s = session(dir);
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const w = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(w.status, 'awaiting_approval', JSON.stringify(w));
    const run = join(dir, 'runs', w.run);
    // what the person approves at the terminal is the exact text the quote hashed
    const answered = inPty(dir, ['gate', 'answer', `runs/${w.run}`, w.gate], 'y\n');
    assert.equal(answered.status, 0, answered.stdout);
    assert.match(answered.stdout, /Should we drop the legacy invoices column/);
    assert.match(answered.stdout, new RegExp(q.text.sha256));
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 25 });
    assert.equal(a.kind, 'advice', JSON.stringify(a).slice(0, 400));
    assert.ok(await waitFor(() => existsSync(join(run, 'report.json'))));
    const log = JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8'));
    assert.equal(log.approval, 'cli');
    assert.equal(log.gate, w.gate);
    assert.equal(log.brief_sha256, q.text.sha256);
    // P7: the record holds no brief text, only hashed words
    const raw = readFileSync(join(run, 'advise-log.json'), 'utf8').toLowerCase();
    for (const word of QUESTION_WORDS) assert.ok(!raw.includes(word), `"${word}" is in advise-log.json`);
    // one approval, one send
    const again = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.match(again.code, /quote_missing|quote_used/);
  } finally { await s.close(); }
});

test('a pending gate does not count against the calls-per-session cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-cap-'));
  const nobody = session(dir, { env: { COUNCIL_ADVISE_CALLS_PER_SESSION: '1' } });
  try {
    const q = await nobody.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal((await nobody.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 })).status, 'awaiting_approval');
  } finally { await nobody.close(); }
  const s = session(dir, { env: { COUNCIL_ADVISE_CALLS_PER_SESSION: '1' }, person: ACCEPT });
  try {
    const q = await s.call('council_quote', { brief: { ...BRIEF(), question: 'Which queue should the new email worker use for retries?' }, mode: 'single' });
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256, wait_seconds: 25 });
    assert.equal(a.kind, 'advice', JSON.stringify(a).slice(0, 300));
    assert.ok(await waitFor(() => existsSync(join(dir, 'runs', a.run, 'report.json'))));
  } finally { await s.close(); }
});

// An advice call's run folder as the server builds it: the brief, advice-meta/1 and a gate binding the chain's real seats, ceiling
// and sensitivity (gateSeatsOf, the same definition the server and --advice-adopt use). `meta` overrides fields of the meta file only.
function adviceFolder(dir, id, { chain = 'mock-advise-single', text = '# A brief\n\nShould we keep the legacy invoices column?\n', ceiling = 1, sensitivity = { label: 'internal', set_by: 'caller' }, expiresAt = Date.now() + 600_000, meta = {} } = {}) {
  const run = join(dir, 'runs', id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'advice-brief.md'), text);
  writeFileSync(join(run, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain, gate: 'g1', brief_sha256: sha(text), mode: 'single', advisor: 'sol', effective_sensitivity: sensitivity.label, question_hash: sha(id).slice(0, 16), question_words: [sha(`w${id}`).slice(0, 8), sha(`v${id}`).slice(0, 8)], has_new_evidence: false, quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: ceiling }, previous_run: null, dispositions: [], ...meta }));
  const config = chain === 'no-zdr' ? NO_ZDR : shipped(chain);
  const g = requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: ceiling }, seats: gateSeatsOf(config), sensitivity, expiresAt });
  assert.ok(g.ok, g.message);
  return run;
}
// A person at a terminal answers the gate (the only way these tests approve or decline: plan M4, "the way a person does").
function personAnswers(dir, run, { decline = false } = {}) {
  const r = inPty(dir, ['gate', 'answer', `runs/${run.split('/').pop()}`, 'g1', ...(decline ? ['--decline'] : [])], 'y\n');
  assert.equal(r.status, 0, r.stdout);
}
const adopt = (dir, run, extraArgs = [], env = {}) => spawnSync(process.execPath, [cli, '--advice-adopt', `runs/${run.split('/').pop()}`, ...extraArgs], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env }, timeout: 60_000 });
const noPty = !hasPython && 'python3 is not installed';

test('--advice-adopt refuses a pending, declined or expired gate, whatever the environment holds, and starts nothing', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-adopt-'));
  const pending = adviceFolder(dir, '2026-10-03T00-00-00-001Z');
  const declined = adviceFolder(dir, '2026-10-03T00-00-00-002Z');
  personAnswers(dir, declined, { decline: true });
  // approved while it lives (12 s is room for a terminal answer on a loaded machine), then adopted after it lapsed
  const lapses = Date.now() + 12_000;
  const expired = adviceFolder(dir, '2026-10-03T00-00-00-003Z', { expiresAt: lapses });
  personAnswers(dir, expired);
  while (Date.now() <= lapses) spawnSync('sleep', ['0.5']);
  // every setting a caller might hope approves something
  const env = { COUNCIL_ADVISE_APPROVAL: 'host', ['COUNCIL_ADVISE_' + 'AUTO_USD']: '100', COUNCIL_ADVISE_MOCK: '1', COUNCIL_GATE_APPROVE: '1' };
  for (const [run, want] of [[pending, /is pending, not approved/], [declined, /is declined, not approved/], [expired, /lapsed/]]) {
    const r = adopt(dir, run, [], env);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, want);
    assert.equal(existsSync(join(run, 'advise-log.json')), false);
    assert.equal(existsSync(join(run, 'run.json')), false);
    assert.ok(!readFileSync(join(run, 'gate-ledger.jsonl'), 'utf8').includes('"event":"sent"'));
  }
});

test('review H1: the gate, not advice.meta.json, decides the chain and the cap: a swapped chain is refused, a raised ceiling is ignored', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-h1-'));
  const swapped = adviceFolder(dir, '2026-10-03T00-00-01-001Z', { meta: { chain: 'mock-advise-standard' } });
  personAnswers(dir, swapped);
  const r1 = adopt(dir, swapped);
  assert.equal(r1.status, 2, r1.stderr);
  assert.match(r1.stderr, /does not seat what gate g1 showed the person/);
  assert.equal(existsSync(join(swapped, 'advise-log.json')), false);
  const raised = adviceFolder(dir, '2026-10-03T00-00-01-002Z', { ceiling: 0.5, meta: { quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 50 } } });
  personAnswers(dir, raised);
  const r2 = adopt(dir, raised, [], { MAX_USD_PER_RUN: '0' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /cap: +\$0\.50/, 'the gate\'s ceiling, not the meta file\'s, and not MAX_USD_PER_RUN');
  assert.equal(JSON.parse(readFileSync(join(raised, 'report.json'), 'utf8')).maxUsd, 0.5);
  // --max-usd may lower it, never raise it
  const lower = adviceFolder(dir, '2026-10-03T00-00-01-003Z', { ceiling: 0.5 });
  personAnswers(dir, lower);
  assert.match(adopt(dir, lower, ['--max-usd', '9']).stdout, /cap: +\$0\.50/);
});

test('review H1: an advice gate that bound no price or no seats is refused at adopt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-h1b-'));
  const text = '# A brief\n\nShould we?\n';
  const run = join(dir, 'runs', '2026-10-03T00-00-02-001Z');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'advice-brief.md'), text);
  writeFileSync(join(run, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: 'mock-advise-single', gate: 'g1', brief_sha256: sha(text), mode: 'single', advisor: 'sol', effective_sensitivity: 'internal', question_hash: 'a'.repeat(16), question_words: ['deadbeef'], quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] }));
  assert.ok(requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', expiresAt: Date.now() + 600_000 }).ok); // no price, no seats
  // a unit-level approval: this test is about what adopt refuses, not about how a person approves
  assert.ok(answerGate(run, 'g1', { channel: 'cli', shownSha256: textSha256(Buffer.from(text)), decision: 'approved', tty: true }).ok);
  const r = adopt(dir, run);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not name the seats and the ceiling/);
});

test('review H1: the sensitivity tier is checked again at adopt, against the chain that would run', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-tier-'));
  // The operator's folder, outside the work folder (0.8.1 decided rule 5d: never the project's chains/ for an advice chain).
  const operator = mkdtempSync(join(tmpdir(), 'send-path-tier-chains-'));
  writeFileSync(join(operator, 'no-zdr.json'), JSON.stringify(NO_ZDR));
  const run = adviceFolder(dir, '2026-10-03T00-00-03-001Z', { chain: 'no-zdr', sensitivity: { label: 'internal', set_by: 'caller' } });
  personAnswers(dir, run);
  const r = adopt(dir, run, [], { COUNCIL_ADVICE_CHAINS_DIR: operator });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no endpoint OpenRouter tags zero-data-retention/);
});

test('review M1: --advice-adopt takes nothing that could change what was approved', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-m1-'));
  mkdirSync(join(dir, 'ctx'));
  writeFileSync(join(dir, 'ctx', 'a.md'), 'text nobody approved\n');
  const run = adviceFolder(dir, '2026-10-03T00-00-04-001Z');
  personAnswers(dir, run);
  for (const extra of [['--context', 'ctx'], ['--criteria', 'x.md'], ['--allow-secret-shaped'], ['--pii-gate', 'warn'], ['stray']]) {
    const r = adopt(dir, run, extra);
    assert.equal(r.status, 2, extra.join(' '));
    assert.match(r.stderr, /cannot be given with it/);
  }
  assert.equal(existsSync(join(run, 'run.json')), false);
  assert.equal(adopt(dir, run, ['--allow-unfenced', '--chain', 'mock-advise-single']).status, 0, 'the allowed flags still work');
});

test('review M3: an adopt by hand is held to the money guards: past the calls cap it is refused', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-m3-'));
  const env = { COUNCIL_ADVISE_CALLS_PER_SESSION: '1' };
  const first = adviceFolder(dir, '2026-10-03T00-00-05-001Z');
  const second = adviceFolder(dir, '2026-10-03T00-00-05-002Z');
  personAnswers(dir, first);
  personAnswers(dir, second);
  assert.equal(adopt(dir, first, [], env).status, 0);
  const r = adopt(dir, second, [], env);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /cap_calls/);
  assert.equal(existsSync(join(second, 'advise-log.json')), false);
});

test('advise-log.json is written when the run starts and again when it ends; a run killed in between leaves the first version', { skip: noPty }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-log-'));
  const run = adviceFolder(dir, '2026-10-03T00-00-00-004Z');
  personAnswers(dir, run);
  const child = spawn(process.execPath, [cli, '--advice-adopt', `runs/${run.split('/').pop()}`], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_MOCK_DELAY_MS: '20000' }, stdio: 'ignore' });
  assert.ok(await waitFor(() => existsSync(join(run, 'advise-log.json'))), 'written at the start');
  const first = JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8'));
  assert.equal(first.status, 'started');
  assert.equal(first.spent_usd, null);
  child.kill('SIGKILL');
  await new Promise(r => child.on('exit', r));
  const after = JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8'));
  assert.deepEqual(after, first, 'the killed run leaves the first version, so the money guards still count it');
  assert.ok(readdirSync(run).includes('advise-log.json'));
});

test('review low: a dismissed dialog leaves the gate pending (awaiting_approval); a client error names the terminal command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-dialog-'));
  let mode = 'cancel';
  const s = session(dir, { person: () => (mode === 'cancel' ? { action: 'cancel' } : { __error: 'the client could not show it' }) });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(a.status, 'awaiting_approval', JSON.stringify(a));
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', a.run, 'gates', 'g1.json'), 'utf8')).status, 'pending', 'a dismissal is not a decline');
    mode = 'error';
    const q2 = await s.call('council_quote', { brief: { ...BRIEF(), question: 'Which queue should the new email worker use for retries?' }, mode: 'single' });
    const b = await s.call('council_advise', { quote_id: q2.quote_id, confirm_sha256: q2.text.sha256 });
    assert.equal(b.code, 'no_approval_channel', JSON.stringify(b));
    assert.match(b.next, new RegExp(`cli\\.js gate answer \\S*runs/${b.run} g1`));   // A3-3: node + the absolute cli.js + the absolute run folder
  } finally { await s.close(); }
});

test('an approved brief changed afterwards is refused at adopt; one approval starts one run', { skip: noPty }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-once-'));
  const run = adviceFolder(dir, '2026-10-03T00-00-06-001Z');
  personAnswers(dir, run);
  const text = readFileSync(join(run, 'advice-brief.md'), 'utf8');
  writeFileSync(join(run, 'advice-brief.md'), `${text}one more line\n`);
  const changed = adopt(dir, run);
  assert.equal(changed.status, 2);
  assert.match(changed.stderr, /hash_mismatch|not the text that was approved/);
  assert.equal(existsSync(join(run, 'run.json')), false);
  writeFileSync(join(run, 'advice-brief.md'), text);
  const ok = adopt(dir, run);
  assert.equal(ok.status, 0, ok.stderr);
  const log = JSON.parse(readFileSync(join(run, 'advise-log.json'), 'utf8'));
  assert.equal(log.approval, 'cli');
  assert.equal(log.gate, 'g1');
  assert.ok(readFileSync(join(run, 'gate-ledger.jsonl'), 'utf8').includes('"event":"sent"'));
  const twice = adopt(dir, run);
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /already started|already used/);
});

test('P6: the golden advice-meta/1 file reads; a wrong schema, a missing gate or chain, or brief text in it is refused', async () => {
  const { readAdviceMeta } = await import('../src/advice-run.js');
  const golden = join(root, 'test', 'fixtures', 'advice-meta', 'golden.json');
  const ok = readAdviceMeta(golden);
  assert.equal(ok.error, undefined, ok.error);
  assert.equal(ok.meta.gate, 'g1');
  const base = JSON.parse(readFileSync(golden, 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'send-path-meta-'));
  for (const [why, edit] of [['schema', m => { m.schema = 'advice-meta/2'; }], ['gate', m => { delete m.gate; }], ['chain', m => { m.chain = '../x'; }], ['quoted', m => { m.quoted = null; }]]) {
    const m = structuredClone(base); edit(m);
    writeFileSync(join(dir, 'm.json'), JSON.stringify(m));
    assert.ok(readAdviceMeta(join(dir, 'm.json')).error, why);
  }
  // no brief text: every string value is an id, a hash, a name or a label
  const strings = JSON.stringify(base).match(/"[^"]{40,}"/g) || [];
  assert.ok(strings.every(v => /^"[0-9a-f]{64}"$/.test(v)), `long strings other than hashes: ${strings}`);
});

test('P14: an unreadable advice lock left by a crash is taken over once older than 30 s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-path-lock-'));
  mkdirSync(join(dir, '.council-advice-lock'));
  const lock = join(dir, '.council-advice-lock', '.council.lock');
  writeFileSync(lock, '');
  const old = (Date.now() - 31_000) / 1000;
  const { utimesSync } = await import('node:fs');
  utimesSync(lock, old, old);
  const s = session(dir);
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 });
    assert.equal(a.status, 'awaiting_approval', JSON.stringify(a));
  } finally { await s.close(); }
});
