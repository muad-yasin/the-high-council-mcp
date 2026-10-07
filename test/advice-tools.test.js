// test/advice-tools.test.js
//
// council_quote and council_advise, end to end over stdio against mock chains (thc-research brief 29). Offline, $0, no keys: every seat is
// a mock seat (or the tool refuses before any seat is called). What is pinned: a brief over the cap or with a key in it is refused with
// nothing written; a wrong hash, an unpriced seat, the per-call cap, a repeat, a missing approval channel and an open objection each
// refuse before anything is called; an accepted elicitation and the host route start a run (0.8.1: there is no allowance); a hold that ends early hands
// back a run id and run_status finishes the job; a client's cancel, a client that leaves and the wall clock each stop the optional
// stages and keep what was paid for; the record (advise-log.json, report.json, audit.jsonl) says what left and holds no brief text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyAuditLog, parseAuditLog } from '../src/audit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateReport = ajv.compile(schema);
const sha = t => createHash('sha256').update(t).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The operator's advice-chain folder for a test's work folder: a sibling, outside the work folder, as COUNCIL_ADVICE_CHAINS_DIR must be
// (0.8.1 decided rule 5d: an advice chain never comes from the project's chains/). A Session passes it when it exists.
const chainsOf = dir => `${dir}-chains`;

// One stdio session, kept open: calls by id, notifications collected, server-to-client requests (elicitation) answered by `onRequest`.
class Session {
  constructor(cwd, { env = {}, capabilities = {}, clientName = 'advice-test', onRequest = null } = {}) {
    this.cwd = cwd; this.notes = []; this.requests = []; this.pending = new Map(); this.nextId = 10; this.buf = '';
    this.child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_COOLDOWN_MS: '0', ...(existsSync(chainsOf(cwd)) ? { COUNCIL_ADVICE_CHAINS_DIR: chainsOf(cwd) } : {}), ...env } });
    this.exited = new Promise(r => this.child.on('exit', r));
    this.child.stdout.on('data', d => {
      this.buf += d; let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.method && m.id !== undefined) {
          this.requests.push(m);
          Promise.resolve(onRequest ? onRequest(m) : { action: 'decline' }).then(result => this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`));
        } else if (m.method) this.notes.push(m);
        else if (m.id !== undefined && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      }
    });
    this.ready = this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities, clientInfo: { name: clientName, version: '0' } })
      .then(() => this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  }
  rpc(method, params, id = this.nextId++) {
    const p = new Promise(r => this.pending.set(id, r));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    p.id = id;
    return p;
  }
  async call(name, args) { await this.ready; const m = await this.rpc('tools/call', { name, arguments: args }); return m.result ?? m; }
  /** Starts a call and returns its id at once, for a test that cancels it. */
  async start(name, args, progressToken) { await this.ready; const p = this.rpc('tools/call', { name, arguments: args, ...(progressToken ? { _meta: { progressToken } } : {}) }); return { id: p.id, promise: p }; }
  cancel(id) { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'test' } })}\n`); }
  async list() { await this.ready; return (await this.rpc('tools/list', {})).result.tools; }
  async close() { try { this.child.stdin.end(); } catch { /* gone */ } await Promise.race([this.exited, sleep(3000)]); this.child.kill(); }
}

const workdir = () => { const d = mkdtempSync(join(tmpdir(), 'thc-advice-')); return d; };
const BRIEF = (over = {}) => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'],
  ...over,
});
const OTHER = (over = {}) => BRIEF({ ...over, question: 'Which queue should the new email worker use for retries?', options_considered: [{ name: 'Redis streams', summary: 'Already in the stack.' }, { name: 'SQS', summary: 'A new managed dependency.' }] });
const MOCK = { COUNCIL_ADVISE_MOCK: '1' };
// A client that can ask the person, and a person who reads the text and presses "send": since 0.8.1 the only way a test approves a
// send besides the host statement (plan DR-3: no allowance, no test switch).
const PERSON = { capabilities: { elicitation: {} }, onRequest: () => ({ action: 'accept', content: { send: true } }) };
const sc = r => r.structuredContent;
const textOf = r => r.content.map(c => c.text).join('\n');

// An operator's chain of the shipped mock panel with its own wall clock, found before the package's chains by name.
function userChain(dir, name, from, { wall = 120_000, usd } = {}) {
  mkdirSync(chainsOf(dir), { recursive: true });
  const c = JSON.parse(readFileSync(join(root, 'chains', `${from}.json`), 'utf8'));
  c.name = name; c.advise.max_wall_ms = wall; if (usd) c.advise.usd = usd;
  writeFileSync(join(chainsOf(dir), `${name}.json`), JSON.stringify(c, null, 2));
  return c;
}
const folders = dir => (existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : []);
// Since 0.8.1 (DR-15) every council_advise call that passes the guards gets a run folder before anyone approves it; a run that
// STARTED is one with an advise-log.json (written by --advice-adopt before any call).
const started = dir => folders(dir).filter(f => existsSync(join(dir, 'runs', f, 'advise-log.json')));
async function settled(session, run, seconds = 25) {
  for (let i = 0; i < 4; i++) {
    const r = await session.call('run_status', { run, wait_seconds: seconds, until: 'settled' });
    if (sc(r)?.kind === 'advice' || sc(r)?.refused) return r;
    const body = r.content?.[0]?.text ? JSON.parse(r.content[0].text) : {};
    if (body.progress?.settled || (body.status && body.status !== 'running')) return r;
  }
  assert.fail('the run never settled');
}
// Hold until the run's child has finished writing, so the folder can be removed.
async function finish(dir, run) {
  const pidOf = () => { try { return JSON.parse(readFileSync(join(dir, 'runs', run, 'run.json'), 'utf8')).pid; } catch { return null; } };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (let i = 0; i < 160; i++) {
    // 0.8.1 M6: a stopped run ends with its STOPPED-<cause>.json marker (and report-partial.json when it ran calls).
    const done = ['report.json', 'STOPPED-user.json', 'STOPPED-client_cancel.json', 'STOPPED-wall_clock.json', 'STOPPED-error.md'].some(f => existsSync(join(dir, 'runs', run, f)));
    const pid = pidOf();
    if (done && (!pid || !alive(pid))) return;
    await sleep(150);
  }
  assert.fail(`run ${run} never finished`);
}
const report = (dir, run) => JSON.parse(readFileSync(join(dir, 'runs', run, 'report.json'), 'utf8'));
const partial = (dir, run) => JSON.parse(readFileSync(join(dir, 'runs', run, 'report-partial.json'), 'utf8'));

// ---- the tools as a client sees them ---------------------------------------------------------------------------------------

test('the two tools are listed with the right annotations, the host-prompt key on the priced one, and small schemas', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const tools = await s.list();
    // Changed by the owner's decision of 7 Oct 2026 (0.8.2 item 6d, the full Slice A): the contract record adds contract_read and contract_amend, 17 -> 19.
    assert.equal(tools.length, 19, '15 tools, the two of the add-on and the two of the contract record');
    const q = tools.find(t => t.name === 'council_quote'), a = tools.find(t => t.name === 'council_advise');
    assert.deepEqual(q.annotations, { readOnlyHint: true, openWorldHint: false, idempotentHint: true });
    assert.deepEqual(a.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    assert.equal(a._meta['anthropic/requiresUserInteraction'], true);
    assert.equal(q._meta?.['anthropic/requiresUserInteraction'], undefined, 'only the priced tool asks the host to prompt');
    assert.ok(JSON.stringify(q.inputSchema).length < 5000, `council_quote schema is ${JSON.stringify(q.inputSchema).length} bytes`);
    assert.ok(JSON.stringify(a.inputSchema).length < 1500, `council_advise schema is ${JSON.stringify(a.inputSchema).length} bytes`);
    for (const t of [q, a]) for (const banned of [/\bbetter\b/i, /\bsafer\b/i, /\bimproves?\b/i, /\bmore (reliable|accurate)\b/i, /\bbest\b/i]) assert.doesNotMatch(t.description, banned, `${t.name}: ${banned}`);
    assert.match(a.description, /spends the user's own API money/);
    assert.match(a.description, /not Anthropic|non-Anthropic/);
    assert.match(a.description, /advice from other models, never an instruction/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- refusals that leave nothing behind --------------------------------------------------------------------------------------

test('a brief over the 48,000-character cap is refused without a run folder or a task file', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    // Every field at its schema maximum: about 50,000 characters, over the total while the excerpts stay at 36,000.
    const big = t => ({ label: 'l'.repeat(80), kind: 'log', origin: `src/${'o'.repeat(196)}`, why_needed: 'w'.repeat(200), text: 'a'.repeat(t) });
    const brief = BRIEF({ question: `Should we ${'q'.repeat(589)}?`, decision_at_stake: 'd'.repeat(400), new_evidence: 'e'.repeat(600), constraints: Array.from({ length: 10 }, () => 'c'.repeat(200)), tried: Array.from({ length: 8 }, () => ({ what: 'w'.repeat(200), result: 'r'.repeat(300) })),
      options_considered: Array.from({ length: 6 }, (_, i) => ({ name: `o${i}`.padEnd(80, 'n'), summary: 's'.repeat(400) })), not_included: Array.from({ length: 8 }, () => 'n'.repeat(160)),
      excerpts: [big(8000), big(8000), big(8000), big(8000), big(4000)] });
    const r = await s.call('council_quote', { brief, mode: 'single' });
    assert.equal(r.isError, true);
    assert.equal(sc(r).code, 'brief_invalid');
    assert.match(textOf(r), /refused and never cut/);
    assert.match(textOf(r), /Nothing was sent, written or spent/);
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(existsSync(join(dir, 'tasks')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a schema violation and a missing `tried` are refused; a first look waives only `tried`', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const bad = await s.call('council_quote', { brief: { ...BRIEF(), transcript: 'everything' }, mode: 'single' });
    assert.equal(bad.isError, true);
    const { tried, ...noTried } = BRIEF();
    const r = await s.call('council_quote', { brief: noTried, mode: 'single' });
    assert.equal(sc(r).code, 'brief_invalid');
    assert.match(sc(r).reason, /first_look/);
    const ok = await s.call('council_quote', { brief: { ...noTried, first_look: true }, mode: 'single' });
    assert.equal(ok.isError, undefined);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a key in the brief is blocked before anything is written, and is never masked', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const brief = BRIEF({ excerpts: [{ label: 'env', kind: 'config', why_needed: 'The question is about this config.', text: `OPENROUTER_API_KEY=sk-or-v1-${'a1b2c3d4'.repeat(8)}` }] });
    const r = await s.call('council_quote', { brief, mode: 'single' });
    assert.equal(sc(r).code, 'secret_shaped');
    assert.doesNotMatch(textOf(r), /sk-or-v1-a1b2/, 'the value is never echoed');
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(existsSync(join(dir, 'tasks')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the quote masks an email and a home path, hashes the masked text, and what is written for the run is exactly that text', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const brief = BRIEF({ question: 'Does max.muster@example.com own the invoices table in /home/max/app?', excerpts: [{ label: 'a', kind: 'code', origin: 'src/a.js', why_needed: 'The question is about this line.', text: 'owner = "ops@acme-corp.de"' }] });
    const q = await s.call('council_quote', { brief, mode: 'single' });
    assert.equal(q.isError, undefined, textOf(q));
    assert.deepEqual(Object.keys(sc(q).text.masked).sort(), ['EMAIL', 'PATH']);
    assert.match(textOf(q), /masked before sending: 2 email, 1 path/);
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 });
    assert.equal(sc(a).kind, 'advice', textOf(a));
    const run = sc(a).run;
    // 0.8.1 DR-15: the brief lives in the run folder, never in the project's tasks/ folder (which a commit can publish, audit A8).
    const task = readFileSync(join(dir, 'runs', run, 'advice-brief.md'), 'utf8');
    assert.equal(existsSync(join(dir, 'tasks')), false);
    assert.ok(!/max\.muster@example\.com|ops@acme-corp\.de|\/home\/max/.test(task), 'nothing the masking covers is in the file the run reads');
    assert.match(task, /\[EMAIL_1\]/);
    assert.equal(sha(task), sc(q).text.sha256, 'the file is the exact text the person confirmed');
    assert.equal(report(dir, run).task_sha256, sc(q).text.sha256);
    await finish(dir, run);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a wrong confirm_sha256 is refused and nothing is written; a used quote cannot be used again; an expired quote is named', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_ADVISE_QUOTE_TTL_MS: '700' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const wrong = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: 'f'.repeat(64) });
    assert.equal(sc(wrong).code, 'hash_mismatch');
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(existsSync(join(dir, 'tasks')), false);
    await sleep(900);
    assert.equal(sc(await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256 })).code, 'quote_expired');
    const q2 = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(await s.call('council_advise', { quote_id: 'q_' + '0'.repeat(24), confirm_sha256: sc(q2).text.sha256 })).code, 'quote_missing');
    // 0.8.1 M4: an approval lapses with its quote, so the 0.7 s quote life above would lapse this approval too; the call that starts
    // a run is made in a session with the normal quote life.
    await s.close();
    const s2 = new Session(dir, { env: MOCK, ...PERSON });
    try {
      const q3 = await s2.call('council_quote', { brief: BRIEF(), mode: 'single' });
      const ok = await s2.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, wait_seconds: 20 });
      assert.equal(sc(ok).kind, 'advice', textOf(ok));
      assert.match(sc(await s2.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256 })).code, /quote_missing|quote_used/);
      await finish(dir, sc(ok).run);
    } finally { await s2.close(); }
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('an unpriced seat is refused (fail closed), naming the price table', async () => {
  const dir = workdir(); mkdirSync(chainsOf(dir), { recursive: true });
  writeFileSync(join(chainsOf(dir), 'unpriced.json'), JSON.stringify({ name: 'unpriced', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1, rounds: 0, synthesis: 'none', max_wall_ms: 60000 },
    seats: { critics: [{ provider: 'openrouter', model: 'nobody/nothing-model', maxTokens: 1000, lab: 'n', extra: { provider: { zdr: true, data_collection: 'deny' } } }] } }));
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'unpriced' } });
  try {
    const r = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(r).code, 'seat_not_allowed');
    assert.match(sc(r).reason, /no price|advise-unpriced/);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the per-call cap refuses before any call: a mock-priced seat projects dollars the limit does not allow', async () => {
  const dir = workdir(); mkdirSync(chainsOf(dir), { recursive: true });
  writeFileSync(join(chainsOf(dir), 'pricey.json'), JSON.stringify({ name: 'pricey', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 100, rounds: 0, synthesis: 'none', max_wall_ms: 60000 },
    seats: { critics: [{ provider: 'mock', model: 'mock-priced', maxTokens: 50000, lab: 'p' }] } }));
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'pricey' }, ...PERSON });
  try {
    const r = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(r).code, 'cap_call');
    assert.match(sc(r).next, /COUNCIL_ADVISE_MAX_USD_PER_CALL/);
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(existsSync(join(dir, 'tasks')), false);
    const mx = await s.call('council_quote', { brief: BRIEF(), mode: 'single', max_usd: 1 });
    assert.equal(sc(mx).code, 'over_ceiling', 'a caller can only lower the ceiling, and a lower one refuses a dearer blind round');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('policy.json: the operator\'s floor and provider list apply, a personal-data label is never sent, and a confidential brief does not go to a council', async () => {
  const dir = workdir(); let s = new Session(dir, {});
  try {
    const personal = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'personal_data' }), mode: 'single' });
    assert.equal(sc(personal).code, 'sensitivity'); assert.match(sc(personal).reason, /never sent/);
    const unknown = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'unknown' }), mode: 'council' });
    assert.equal(sc(unknown).code, 'sensitivity'); assert.match(sc(unknown).reason, /one seat, not to a council/);
    const single = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'unknown' }), mode: 'single' });
    assert.equal(single.isError, undefined, textOf(single));
    assert.equal(sc(single).sensitivity.effective, 'confidential');
    assert.match(textOf(single), /gpt-6\.1-sol.*ZDR-tagged by OpenRouter/);
    assert.match(textOf(single), /not a guarantee/);
    await s.close();
    // Muse Spark 1.3 has no ZDR-tagged endpoint. It is not a shipped chain since 0.8.1 (DR-16), so the operator seats it as the single
    // chain, the way a user who wants it would (the shipped advise-single with the seat swapped).
    const mine = JSON.parse(readFileSync(join(root, 'chains', 'advise-single.json'), 'utf8'));
    mine.name = 'my-muse';
    mine.seats.critics = [{ provider: 'openrouter', model: 'meta/muse-spark-1.3', maxTokens: 9000, lab: 'muse-spark1.3', extra: { reasoning: { effort: 'medium' } }, estimate: { critiqueTokens: 5500 } }];
    // 0.8.1 decided rule 5d: the operator's own folder (outside the project) and the operator's floor setting, never the project's.
    const operatorDir = mkdtempSync(join(tmpdir(), 'thc-operator-chains-'));
    writeFileSync(join(operatorDir, 'my-muse.json'), JSON.stringify(mine, null, 2));
    s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'my-muse', COUNCIL_ADVICE_CHAINS_DIR: operatorDir } });
    const muse = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'public' }), mode: 'single' });
    assert.equal(sc(muse).code, 'sensitivity', 'the default floor is internal, which a no-ZDR seat does not reach');
    await s.close();
    s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'my-muse', COUNCIL_ADVICE_CHAINS_DIR: operatorDir, COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public' } });
    const open = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'public' }), mode: 'single' });
    assert.equal(open.isError, undefined, 'the operator can open the floor to public');
    await s.close();
    rmSync(operatorDir, { recursive: true, force: true });
    s = new Session(dir, {}); // back to the shipped single chain for the policy checks
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['anthropic'] }));
    const pol = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(pol).code, 'policy');
    writeFileSync(join(dir, 'policy.json'), '{ broken');
    assert.equal(sc(await s.call('council_quote', { brief: BRIEF(), mode: 'single' })).code, 'policy_unreadable');
    assert.equal(existsSync(join(dir, 'runs')), false, 'all of that was free');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the default single seat at the real brief cap: GPT-6.1 Sol, priced from the table, with both mode prices named', async () => {
  const dir = workdir(); const s = new Session(dir, {});
  try {
    const big = BRIEF({ excerpts: [1, 2, 3, 4].map(i => ({ label: `e${i}`, kind: 'log', why_needed: 'The question is about this block.', text: `line ${i} `.repeat(250) })) });
    const q = await s.call('council_quote', { brief: big, mode: 'single' });
    assert.equal(sc(q).seats[0].model, 'openai/gpt-6.1-sol');
    // Sol at 36,000 output tokens (owner, 4 Oct 2026, 0.8.1 milestone R: the single-advice chain's cap 12,000 -> 36,000; was 12,000 on 2026-10-02):
    // $0.4039 worst at a 3,000-token brief (3,571 in x $2.2/M + 36,000 out x $11/M); at most $0.4224 at the 48,000-character cap.
    assert.ok(sc(q).price.worst_usd > 0.38 && sc(q).price.worst_usd < 0.46, `worst ${sc(q).price.worst_usd}`);
    const c = await s.call('council_quote', { brief: big, mode: 'council' });
    // The decided council (decided rule 4, DR-7): Sol, GLM-5.3, Gemini 3.8 Flash; brief 31's table prices it at $0.748 worst.
    assert.deepEqual(sc(c).seats.map(x => x.lab), ['gpt6.1-sol', 'glm5.3', 'gemini3.8-flash']);
    // 2026-10-06 audit: GLM-5.3's output row 4.4 -> 7.0 (the live list), so the council's worst case is about $1.14 at this brief (was $0.87).
    assert.ok(sc(c).price.worst_usd > 1.05 && sc(c).price.worst_usd < 1.2, `council worst ${sc(c).price.worst_usd}`);
    const tools = await s.list();
    assert.match(tools.find(t => t.name === 'council_advise').description, /about \$0\.08\d expected and at most \$1\.32 with a brief at the 48,000-character limit/);
    assert.match(tools.find(t => t.name === 'council_advise').description, /about \$0\.75 expected and at most \$1\.40/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- approval --------------------------------------------------------------------------------------------------------------

test('no approval channel in the client: awaiting_approval, a run folder with the exact text and a pending gate, nothing spent (0.8.1 DR-3, DR-15)', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { COUNCIL_ADVISE_MOCK: '1' } });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const r = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256 });
    assert.equal(r.isError, undefined, textOf(r));
    assert.equal(sc(r).status, 'awaiting_approval');
    assert.equal(sc(r).gate, 'g1');
    assert.match(sc(r).next, new RegExp(`cli\\.js gate answer \\S*runs/${sc(r).run} g1`));   // A3-3: node + the absolute cli.js + the absolute run folder, not a bare `council`
    assert.match(sc(r).next, /Do not approve it yourself/);
    assert.doesNotMatch(sc(r).next, /COUNCIL_ADVISE_APPROVAL/, 'the reply does not steer the agent toward the removed host statement (audit A1)');
    const run = join(dir, 'runs', sc(r).run);
    assert.equal(sha(readFileSync(join(run, 'advice-brief.md'), 'utf8')), sc(q).text.sha256, 'the exact text the quote showed');
    assert.equal(JSON.parse(readFileSync(join(run, 'gates', 'g1.json'), 'utf8')).status, 'pending');
    assert.equal(existsSync(join(run, 'advise-log.json')), false, 'nothing counts against the limits');
    assert.equal(existsSync(join(run, 'run.json')), false, 'nothing started');
    assert.equal(existsSync(join(dir, 'tasks')), false);
    // the same quote again picks up the same gate
    const again = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256 });
    assert.equal(sc(again).run, sc(r).run);
    assert.equal(sc(again).gate, 'g1');
    const st = JSON.parse(textOf(await s.call('run_status', { run: sc(r).run })));
    assert.equal(st.status, 'awaiting_approval');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('elicitation: the person sees the price, the hash and the exact text; decline is recorded on the gate and starts nothing, accept starts the run', async () => {
  const dir = workdir(); const seen = [];
  let answer = { action: 'decline' };
  const s = new Session(dir, { env: { COUNCIL_ADVISE_MOCK: '1' }, capabilities: { elicitation: {} }, onRequest: m => { seen.push(m); return answer; } });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const declined = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256 });
    assert.equal(sc(declined).code, 'declined');
    const d1 = join(dir, 'runs', sc(declined).run);
    assert.equal(JSON.parse(readFileSync(join(d1, 'gates', 'g1.json'), 'utf8')).answer.channel, 'elicitation');
    assert.equal(JSON.parse(readFileSync(join(d1, 'gates', 'g1.json'), 'utf8')).status, 'declined');
    assert.equal(existsSync(join(d1, 'advise-log.json')), false, 'a declined call is not counted and not started');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'elicitation/create');
    const msg = seen[0].params.message;
    for (const part of [sc(q).text.sha256, 'Price: worst case', 'The text that would be sent', 'Should we drop the legacy invoices column', 'not a guarantee']) assert.ok(msg.includes(part), part);
    assert.equal(seen[0].params.requestedSchema.properties.send.type, 'boolean');
    const q2 = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    answer = { action: 'accept', content: { send: false } };
    assert.equal(sc(await s.call('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256 })).code, 'declined', 'accept with send false is a no');
    const q3 = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    answer = { action: 'accept', content: { send: true } };
    const ok = await s.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, wait_seconds: 20 });
    assert.equal(sc(ok).kind, 'advice', textOf(ok));
    await finish(dir, sc(ok).run);
    const log = JSON.parse(readFileSync(join(dir, 'runs', sc(ok).run, 'advise-log.json'), 'utf8'));
    assert.equal(log.approval, 'elicitation');
    assert.equal(log.gate, 'g1');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the host-prompt statement is gone: a server with COUNCIL_ADVISE_APPROVAL set refuses to start, with one line (0.8.1 DR-3)', () => {
  const dir = workdir();
  try {
    for (const v of ['host', '', 'anything']) {
      const r = spawnSync(process.execPath, [cli, '--mcp'], { cwd: dir, encoding: 'utf8', input: '', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_MOCK: '1', COUNCIL_ADVISE_APPROVAL: v }, timeout: 20_000 });
      assert.equal(r.status, 2, `value ${JSON.stringify(v)}`);
      assert.match(r.stderr, /COUNCIL_ADVISE_APPROVAL was removed in 0\.8\.1/);
      assert.equal(r.stderr.trim().split('\n').length, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- repeats and objections ------------------------------------------------------------------------------------------------------

test('a repeat is refused; new_evidence in the brief lets it through; a different question passes', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 });
    assert.equal(sc(a).kind, 'advice');
    await finish(dir, sc(a).run);
    const again = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(again).code, 'duplicate'); assert.equal(sc(again).run, sc(a).run);
    assert.match(sc(again).next, /new_evidence/);
    const short = await s.call('council_quote', { brief: BRIEF({ new_evidence: 'too short' }), mode: 'single' });
    assert.equal(short.isError, true, 'new_evidence under 40 characters is not evidence');
    const evid = await s.call('council_quote', { brief: BRIEF({ new_evidence: 'The migration also failed on the staging copy with a lock timeout.' }), mode: 'single' });
    assert.equal(evid.isError, undefined, textOf(evid));
    const other = await s.call('council_quote', { brief: OTHER(), mode: 'single' });
    assert.equal(other.isError, undefined);
    const a2 = await s.call('council_advise', { quote_id: sc(evid).quote_id, confirm_sha256: sc(evid).text.sha256, wait_seconds: 20 });
    assert.equal(sc(a2).kind, 'advice');
    await finish(dir, sc(a2).run);
    assert.equal(report(dir, sc(a2).run).advise.status, 'answered');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the disposition gate: open objections block the next call until each has an accept, reject or defer with its own reason', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 25 });
    assert.equal(sc(a).kind, 'advice', textOf(a));
    await finish(dir, sc(a).run);
    const ids = sc(a).dissent.map(d => d.id);
    assert.equal(ids.length, 2);
    const q2 = await s.call('council_quote', { brief: OTHER(), mode: 'single' });
    assert.equal(q2.isError, undefined, 'the quote is free and does not refuse what only the next call can fix');
    assert.deepEqual(sc(q2).open_objections, ids);
    const blocked = await s.call('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256 });
    assert.equal(sc(blocked).code, 'dispositions_missing'); assert.deepEqual(sc(blocked).ids, ids);
    assert.equal(folders(dir).length, 1, 'nothing new was started');
    const q3 = await s.call('council_quote', { brief: OTHER(), mode: 'single' });
    const thin = await s.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, dispositions: ids.map(id => ({ id, decision: 'reject', reason: 'no' })) });
    assert.equal(sc(thin).code, 'disposition_invalid');
    const unknown = await s.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, dispositions: [{ id: `${sc(a).run}#nobody`, decision: 'accept', reason: 'A reason that is long enough' }] });
    assert.equal(sc(unknown).code, 'disposition_unknown');
    const partial = await s.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, dispositions: [{ id: ids[0], decision: 'accept', reason: 'The rollback point is fair; I will add it' }] });
    assert.equal(sc(partial).code, 'dispositions_missing'); assert.deepEqual(sc(partial).ids, [ids[1]], 'the one that was recorded no longer blocks');
    const ok = await s.call('council_advise', { quote_id: sc(q3).quote_id, confirm_sha256: sc(q3).text.sha256, wait_seconds: 20, dispositions: [{ id: ids[1], decision: 'reject', reason: 'That objection is about a table this change never touches' }] });
    assert.equal(sc(ok).kind, 'advice', textOf(ok));
    await finish(dir, sc(ok).run);
    const log = JSON.parse(readFileSync(join(dir, 'runs', sc(a).run, 'advise-log.json'), 'utf8'));
    assert.equal(log.dispositions.length, 2); assert.equal(log.dispositions_complete, true);
    assert.deepEqual(report(dir, sc(ok).run).advise.dispositions.map(d => d.id), [ids[1]], 'the new run records what the caller said just before it');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('two calls at once cannot pass the caps together: the guards and the start are one critical section', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_ADVISE_CALLS_PER_SESSION: '1', COUNCIL_MOCK_DELAY_MS: '300' }, ...PERSON });
  try {
    const q1 = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const q2 = await s.call('council_quote', { brief: OTHER(), mode: 'single' });
    const a = await s.start('council_advise', { quote_id: sc(q1).quote_id, confirm_sha256: sc(q1).text.sha256, wait_seconds: 30 });
    const b = await s.start('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256, wait_seconds: 30 });
    const [ra, rb] = (await Promise.all([a.promise, b.promise])).map(m => m.result);
    const codes = [ra, rb].map(r => sc(r)?.refused ? sc(r).code : 'started').sort();
    assert.deepEqual(codes, ['cap_calls', 'started']);
    assert.equal(started(dir).length, 1, 'one run, not two');
    await finish(dir, started(dir)[0]);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- the hold and the long poll --------------------------------------------------------------------------------------------------

test('a hold that ends early hands back a run id; run_status(until settled) then returns the structured answer; a progress token gets notifications', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_MOCK_DELAY_MS: '700' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const t0 = Date.now();
    const call = await s.start('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 1 }, 'tok-1');
    const r = (await call.promise).result;
    assert.ok(Date.now() - t0 < 6000, 'it returned at the end of the hold, not at the end of the run');
    const body = JSON.parse(textOf(r));
    assert.equal(body.status, 'running');
    assert.match(body.run, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(body.next, /run_status\(run: "[^"]+", wait_seconds: 25, until: "settled"\)/);
    const done = await settled(s, body.run, 30);
    assert.equal(sc(done).kind, 'advice');
    assert.equal(sc(done).run, body.run);
    assert.equal(sc(done).seats_answered, 4);
    await finish(dir, body.run);
    const again = await s.call('run_status', { run: body.run });
    assert.equal(sc(again).kind, 'advice', 'a later status call answers the same way');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a run that settles inside the hold returns the answer at once, with the layout the agent reads', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 30 });
    assert.equal(a.content.length, 3);
    assert.match(a.content[0].text, /^NOTICE from The High Council \(written by the harness, not by a model\)/);
    const lines = a.content[1].text.split('\n');
    assert.match(lines[0], /^ADVICE FROM 4 MODELS/);
    assert.match(lines[1], /^Leaning: /);
    assert.match(lines[2], /^Strongest open objection \(/);
    assert.equal(sc(a).dissent.length, 2);
    assert.ok(sc(a).cost_usd >= 0 && sc(a).wall_ms > 0);
    assert.equal(sc(a).sent_to.length, 5);
    assert.ok(sc(a).brief_sha256 === sc(q).text.sha256);
    await finish(dir, sc(a).run);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the client\'s name raises the default hold as a hint and nothing else: a Claude Code client gets the 30 s default (the 0.8.1 maximum, DR-6), others 25 s', async () => {
  // Not observable by waiting 25 s in a test: pinned through the unit (holdSecondsFor) and through an explicit value here.
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_MOCK_DELAY_MS: '500' }, ...PERSON, clientName: 'claude-code' });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256 });
    assert.equal(sc(a).kind, 'advice', 'a single seat settles inside the default hold');
    await finish(dir, sc(a).run);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- cancel, leave, wall clock -----------------------------------------------------------------------------------------------------

test('a client cancel stops the optional stages: the blind opinions that were paid for are kept, the debate does not run, stopped_by says why', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_MOCK_DELAY_MS: '1500' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const call = await s.start('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 30 });
    for (let i = 0; i < 60 && !folders(dir).length; i++) await sleep(100);
    const run = folders(dir)[0];
    assert.ok(run, 'the run started');
    // Cancel only once the blind calls are going out ("Stage: advice" is logged just before them): under load the process can take
    // longer than this to start, and a stop before the first call is the exit-18 case, which has its own test.
    const logOf = () => { try { return readFileSync(join(dir, 'runs', run, 'run.log'), 'utf8'); } catch { return ''; } };
    for (let i = 0; i < 300 && !/Stage: advice/.test(logOf()); i++) await sleep(50);
    assert.match(logOf(), /Stage: advice/);
    s.cancel(call.id);
    for (let i = 0; i < 100 && !existsSync(join(dir, 'runs', run, 'STOP')); i++) await sleep(100);
    assert.ok(existsSync(join(dir, 'runs', run, 'STOP')), 'the cancel became a STOP file in the run folder');
    await finish(dir, run);
    // 0.8.1 M6 (decided rule 6): the stop ends the run at exit 18 with report-partial.json, never report.json.
    assert.equal(existsSync(join(dir, 'runs', run, 'report.json')), false);
    const r = partial(dir, run);
    assert.equal(r.partial, true); assert.equal(r.stoppedBy, 'client_cancel');
    assert.equal(r.advise.stopped_by, 'client_cancel');
    assert.equal(r.advise.debate.rounds_run, 0);
    assert.equal(r.advise.seats_answered, 4, 'the calls in flight finished and were recorded');
    assert.ok(r.totals.usd >= 0);
    assert.equal(validateReport(r), true, JSON.stringify(validateReport.errors));
    const log = JSON.parse(readFileSync(join(dir, 'runs', run, 'advise-log.json'), 'utf8'));
    assert.equal(log.stopped_by, 'client_cancel'); assert.equal(log.status, 'stopped');
    const later = await s.call('run_status', { run });
    assert.equal(sc(later).stopped_by, 'client_cancel', 'the partial record is still readable afterwards');
    assert.match(textOf(later), /stopped short \(client_cancel\)/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a client that leaves stops the advice runs this server started', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { ...MOCK, COUNCIL_MOCK_DELAY_MS: '1500' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 0 });
    const run = JSON.parse(textOf(a)).run;
    assert.ok(run);
    await s.close();
    await finish(dir, run);
    // 0.8.1 M6: either way it ends stopped by the client (exit 18), never with report.json.
    assert.ok(existsSync(join(dir, 'runs', run, 'STOPPED-client_cancel.json')));
    assert.equal(existsSync(join(dir, 'runs', run, 'report.json')), false);
    if (existsSync(join(dir, 'runs', run, 'report-partial.json')) && partial(dir, run).advise) {
      // The usual outcome: the blind calls were in flight, they finished, the debate did not run.
      assert.equal(partial(dir, run).advise.stopped_by, 'client_cancel');
      assert.equal(partial(dir, run).advise.debate.rounds_run, 0);
    }
    // Under load the stop can land before the first paid call: then nothing was called (a partial report with no advise). Also correct.
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the wall-clock ceiling stops a run whose calls are slow: the calls still running at the deadline are cut, stoppedBy wall_clock', async () => {
  const dir = workdir(); userChain(dir, 'mock-wall', 'mock-advise-standard', { wall: 1000 });
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_COUNCIL: 'mock-wall', COUNCIL_MOCK_DELAY_MS: '1300' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 0 });
    const run = JSON.parse(textOf(a)).run;
    await finish(dir, run);
    const r = partial(dir, run); // 0.8.1 M6: exit 18, report-partial.json
    assert.equal(r.stoppedBy, 'wall_clock');
    // The deadline is every request's own (setRequestDeadlineAt): the four 1.3 s calls are cut at 1 s, so nothing readable was kept.
    assert.equal(r.advise ?? null, null);
    assert.equal(r.dropouts.length, 4);
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', run, 'STOPPED-wall_clock.json'), 'utf8')).beforeFirstCall, false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- the review's findings (brief 29 review fixes) ---------------------------------------------------------------------------------

test('invisible characters and look-alike alphabets cannot hide a key or an email from the scans', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const key = `sk-or-v1-${'a1b2c3d4'.repeat(8)}`;
    const zw = BRIEF({ excerpts: [{ label: 'env', kind: 'config', why_needed: 'The question is about this config.', text: `K=${key.slice(0, 20)}​${key.slice(20)}` }] });
    assert.equal(sc(await s.call('council_quote', { brief: zw, mode: 'single' })).code, 'brief_invalid', 'a zero-width space is refused');
    const tags = BRIEF({ excerpts: [{ label: 'env', kind: 'config', why_needed: 'The question is about this config.', text: [...key].map(c => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join('') }] });
    assert.equal(sc(await s.call('council_quote', { brief: tags, mode: 'single' })).code, 'brief_invalid', 'a key spelled in tag characters is refused');
    const wide = [...key].map(c => (c >= '!' && c <= '~' ? String.fromCodePoint(c.codePointAt(0) + 0xFEE0) : c)).join('');
    const full = BRIEF({ excerpts: [{ label: 'env', kind: 'config', why_needed: 'The question is about this config.', text: `K=${wide}` }] });
    assert.equal(sc(await s.call('council_quote', { brief: full, mode: 'single' })).code, 'secret_shaped', 'a full-width key is found on the normalised copy');
    const fw = BRIEF({ question: 'Does ｍａｘ＠ｅｘａｍｐｌｅ．ｃｏｍ own the invoices table?' });
    assert.equal(sc(await s.call('council_quote', { brief: fw, mode: 'single' })).code, 'pii_left', 'a full-width email the masker does not match is caught after masking');
    assert.equal(existsSync(join(dir, 'runs')), false);
    assert.equal(existsSync(join(dir, 'tasks')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a placeholder-shaped token in the brief is refused (mask_collision), over the operator\'s COUNCIL_MAX_USD_LIMIT is refused, each before anything is written', async () => {
  const dir = workdir(); const s = new Session(dir, { env: { COUNCIL_MAX_USD_LIMIT: '0.1' } });
  try {
    const col = await s.call('council_quote', { brief: BRIEF({ question: 'Should we email [EMAIL_1] about dropping the legacy invoices column?' }), mode: 'single' });
    assert.equal(sc(col).code, 'mask_collision');
    const lim = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(sc(lim).code, 'over_server_limit');
    assert.match(sc(lim).reason, /COUNCIL_MAX_USD_LIMIT/);
    assert.equal(existsSync(join(dir, 'runs')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the per-call limit compares the ceiling, not the worst case: a limit between the two refuses', async () => {
  const dir = workdir();
  const c = userChain(dir, 'mock-mid', 'mock-advise-single', { usd: 1.4 });
  c.seats.critics = [{ provider: 'mock', model: 'mock-priced', maxTokens: 50, lab: 'p' }];
  writeFileSync(join(chainsOf(dir), 'mock-mid.json'), JSON.stringify(c));
  const s1 = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'mock-mid' }, ...PERSON });
  try {
    const q = await s1.call('council_quote', { brief: BRIEF(), mode: 'single' });
    assert.equal(q.isError, undefined, textOf(q));
    const { worst_usd: worst, ceiling_usd: ceiling } = sc(q).price;
    assert.ok(worst < ceiling, `${worst} < ${ceiling}`);
    const limit = ((worst + ceiling) / 2).toFixed(3);
    const s2 = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'mock-mid', COUNCIL_ADVISE_MAX_USD_PER_CALL: limit }, ...PERSON });
    try { assert.equal(sc(await s2.call('council_quote', { brief: BRIEF(), mode: 'single' })).code, 'cap_call'); } finally { await s2.close(); }
  } finally { await s1.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the run is started with --max-usd equal to the quoted ceiling (the money backstop), and the chain is admitted again at call time', async () => {
  const dir = workdir(); userChain(dir, 'mock-recheck', 'mock-advise-single', { usd: 0.75 });
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'mock-recheck' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 });
    assert.equal(sc(a).kind, 'advice');
    await finish(dir, sc(a).run);
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', sc(a).run, 'run.json'), 'utf8')).maxUsd, 0.75);
    const q2 = await s.call('council_quote', { brief: OTHER(), mode: 'single' });
    // Owner decision, 6 Oct 2026 (no wall clocks): this test edited the chain by deleting its wall clock, which admission no longer refuses; it now swaps in an external seat, which it still refuses.
    const c = JSON.parse(readFileSync(join(chainsOf(dir), 'mock-recheck.json'), 'utf8')); c.seats.critics = [{ provider: 'external', model: 'session', lab: 'h' }];
    writeFileSync(join(chainsOf(dir), 'mock-recheck.json'), JSON.stringify(c));
    assert.equal(sc(await s.call('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256 })).code, 'seat_not_allowed', 'a chain edited after the quote is checked again');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the answer reads with the caller\'s own text back: a placeholder a model repeats is unmasked', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF({ question: 'Does max.muster@example.com own the legacy invoices column?' }), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 });
    assert.match(sc(a).answer, /Contact max\.muster@example\.com\./);
    assert.ok(!/\[EMAIL_1\]/.test(sc(a).answer));
    assert.match(readFileSync(join(dir, 'runs', sc(a).run, 'deliverable.md'), 'utf8'), /\[EMAIL_1\]/, 'the file on disk stays masked');
    await finish(dir, sc(a).run);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a council of three mock labs with no synthesis seat (the shape of the shipped council) runs end to end', async () => {
  const dir = workdir(); mkdirSync(chainsOf(dir), { recursive: true });
  writeFileSync(join(chainsOf(dir), 'mock-three.json'), JSON.stringify({ name: 'mock-three', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1, rounds: 1, synthesis: 'none', max_wall_ms: 120000 },
    seats: { critics: [{ provider: 'mock', model: 'mock-advisor-proceed', lab: 'a' }, { provider: 'mock', model: 'mock-advisor-yield-argued', lab: 'b' }, { provider: 'mock', model: 'mock-advisor-stop', lab: 'c' }] } }));
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_COUNCIL: 'mock-three' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 30 });
    assert.equal(sc(a).kind, 'advice', textOf(a));
    assert.equal(sc(a).seats_asked, 3); assert.equal(sc(a).sent_to.length, 3);
    assert.equal(report(dir, sc(a).run).advise.synthesis.seat, null);
    assert.match(a.content[0].text, /^NOTICE/);
    await finish(dir, sc(a).run);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('list_chains marks the advice chains as tools-only', async () => {
  const dir = workdir(); const s = new Session(dir, {});
  try {
    const chains = JSON.parse(textOf(await s.call('list_chains', {})));
    assert.equal(chains.find(c => c.name === 'advise-single').advice_tools_only, true);
    assert.equal(chains.find(c => c.name === 'mock').advice_tools_only, undefined);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('one quote cannot start two runs, even when two calls with it arrive together and approval takes a while', async () => {
  const dir = workdir(); let asked = 0;
  const s = new Session(dir, { env: { COUNCIL_ADVISE_MOCK: '1' }, capabilities: { elicitation: {} }, onRequest: async () => { asked++; await sleep(300); return { action: 'accept', content: { send: true } }; } });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const args = { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 };
    const a = await s.start('council_advise', args), b = await s.start('council_advise', args);
    const rs = (await Promise.all([a.promise, b.promise])).map(m => m.result);
    const codes = rs.map(r => (sc(r)?.refused ? sc(r).code : 'started')).sort();
    assert.deepEqual(codes, ['quote_used', 'started']);
    assert.equal(asked, 1, 'the person was asked once');
    assert.equal(folders(dir).length, 1);
    await finish(dir, folders(dir)[0]);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a call cancelled while the person is still being asked starts nothing, even if the dialog is then accepted', async () => {
  const dir = workdir(); let release; const gate = new Promise(r => { release = r; }); let seen = 0;
  const s = new Session(dir, { env: { COUNCIL_ADVISE_MOCK: '1' }, capabilities: { elicitation: {} }, onRequest: async () => { seen++; await gate; return { action: 'accept', content: { send: true } }; } });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const call = await s.start('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 0 });
    for (let i = 0; i < 100 && !seen; i++) await sleep(50);
    assert.equal(seen, 1, 'the dialog is open');
    s.cancel(call.id);
    await sleep(300);
    release();
    await sleep(1500);
    assert.equal(started(dir).length, 0, 'no run was started for a call the client had cancelled');
    for (const f of folders(dir)) assert.equal(JSON.parse(readFileSync(join(dir, 'runs', f, 'gates', 'g1.json'), 'utf8')).status, 'pending', 'and the late accept approved nothing');
    assert.equal(existsSync(join(dir, 'tasks')), false);
  } finally { release(); await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('two servers in one working folder cannot pass a one-call cap together', async () => {
  const dir = workdir(); const env = { ...MOCK, COUNCIL_ADVISE_CALLS_PER_SESSION: '1', COUNCIL_MOCK_DELAY_MS: '300' };
  // The person answers after half a second, so both calls have their folder and gate before either starts: the cap is then held by
  // the second critical section's re-check (M4 review: without the delay this test never reached it).
  const SLOW = { capabilities: { elicitation: {} }, onRequest: async () => { await sleep(500); return { action: 'accept', content: { send: true } }; } };
  const s1 = new Session(dir, { env, ...SLOW }), s2 = new Session(dir, { env, ...SLOW });
  try {
    const q1 = await s1.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const q2 = await s2.call('council_quote', { brief: OTHER(), mode: 'single' });
    const a = await s1.start('council_advise', { quote_id: sc(q1).quote_id, confirm_sha256: sc(q1).text.sha256, wait_seconds: 30 });
    const b = await s2.start('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256, wait_seconds: 30 });
    const rs = (await Promise.all([a.promise, b.promise])).map(m => m.result);
    assert.deepEqual(rs.map(r => (sc(r)?.refused ? sc(r).code : 'started')).sort(), ['cap_calls', 'started']);
    assert.equal(started(dir).length, 1);
    await finish(dir, started(dir)[0]);
  } finally { await s1.close(); await s2.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a stop asked for before the first call ends the run with exit 18 and nothing spent: the wall clock, and a client cancel during start-up', async () => {
  const dir = workdir(); userChain(dir, 'mock-wall1', 'mock-advise-single', { wall: 1000 });
  const s = new Session(dir, { env: { COUNCIL_ADVISE_CHAIN_SINGLE: 'mock-wall1', COUNCIL_MOCK_PRESTART_MS: '1500' }, ...PERSON });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 0 });
    const run = JSON.parse(textOf(a)).run;
    await finish(dir, run);
    // 0.8.1 M6: the marker names its cause.
    assert.ok(existsSync(join(dir, 'runs', run, 'STOPPED-wall_clock.json')));
    assert.equal(existsSync(join(dir, 'runs', run, 'report.json')), false);
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', run, 'STOPPED-wall_clock.json'), 'utf8')).stoppedBy, 'wall_clock');
    const st = JSON.parse(textOf(await s.call('run_status', { run })));
    assert.equal(st.status, 'wall_clock_stopped');
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', run, 'advise-log.json'), 'utf8')).status, 'stopped');
    assert.equal(JSON.parse(readFileSync(join(dir, 'runs', run, 'advise-log.json'), 'utf8')).spent_usd, 0);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
  const dir2 = workdir(); const s2 = new Session(dir2, { env: { ...MOCK, COUNCIL_MOCK_PRESTART_MS: '3000' }, ...PERSON });
  try {
    const q = await s2.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const call = await s2.start('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 30 });
    for (let i = 0; i < 100 && !folders(dir2).length; i++) await sleep(50);
    const run = folders(dir2)[0];
    s2.cancel(call.id);
    await finish(dir2, run);
    assert.ok(existsSync(join(dir2, 'runs', run, 'STOPPED-client_cancel.json')), 'the cancel became a stop before the first call');
    assert.equal(JSON.parse(readFileSync(join(dir2, 'runs', run, 'STOPPED-client_cancel.json'), 'utf8')).beforeFirstCall, true);
  } finally { await s2.close(); rmSync(dir2, { recursive: true, force: true }); }
});

test('refusals after dispositions were written say so, and a dispositions write leaves no torn file', async () => {
  // The person approves the first call and declines the second.
  let asked = 0;
  const dir = workdir(); const s = new Session(dir, { env: MOCK, capabilities: { elicitation: {} }, onRequest: () => (++asked === 1 ? { action: 'accept', content: { send: true } } : { action: 'decline' }) });
  try {
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'council' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 25 });
    await finish(dir, sc(a).run);
    const ids = sc(a).dissent.map(d => d.id);
    // A second brief the person declines: the call is refused after the dispositions were written.
    const q2 = await s.call('council_quote', { brief: OTHER({ sensitivity: 'confidential' }), mode: 'single' });
    assert.equal(q2.isError, undefined, textOf(q2));
    const r = await s.call('council_advise', { quote_id: sc(q2).quote_id, confirm_sha256: sc(q2).text.sha256, dispositions: ids.map((id, i) => ({ id, decision: 'accept', reason: `A specific reason number ${i} for this one` })) });
    assert.equal(sc(r).code, 'declined');
    assert.match(textOf(r), /The dispositions you gave were recorded/);
    assert.ok(!/Nothing was sent, written or spent/.test(textOf(r)));
    assert.equal(sc(r).dispositions_recorded, true);
    assert.equal(existsSync(join(dir, 'runs', sc(a).run, 'advise-log.json.tmp')), false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- other ways in -----------------------------------------------------------------------------------------------------------------

test('start_run and resume_run refuse an advice chain: the tools that preview and ask the user are the only way in over MCP', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), '# A brief\n\nShould we?\n');
    for (const chain of ['mock-advise-single', 'advise-single', 'advise-standard']) {
      const r = await s.call('start_run', { chain, task: 'tasks/t.md' });
      const body = JSON.parse(textOf(r));
      assert.equal(body.started, false); assert.match(body.error, /runs only through council_quote and council_advise/);
    }
    assert.equal(existsSync(join(dir, 'runs')), false);
    const q = await s.call('council_quote', { brief: BRIEF(), mode: 'single' });
    const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 20 });
    await finish(dir, sc(a).run);
    const res = JSON.parse(textOf(await s.call('resume_run', { run: sc(a).run })));
    assert.equal(res.resumed, false); assert.match(res.error, /advice run, which is not resumed over MCP/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI starts an advice call only on an approved gate (--advice-adopt, 0.8.1 DR-15), and --advice-meta is gone', async () => {
  // The cases that need a person's approval (a brief changed after approval, one approval one send, the gate binding the chain and
  // the cap) are in test/send-path.test.js, which approves through a real terminal as the plan asks.
  const { requestGate } = await import('../src/gate.js');
  const dir = workdir();
  const env = { PATH: process.env.PATH, HOME: dir };
  const cliRun = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  try {
    const id = '2026-10-03T00-00-00-000Z';
    const run = join(dir, 'runs', id);
    mkdirSync(run, { recursive: true });
    const text = '# A brief\n\nShould we?\n';
    writeFileSync(join(run, 'advice-brief.md'), text);
    const meta = { schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: 'mock-advise-single', gate: 'g1', brief_sha256: sha(text), mode: 'single', advisor: 'sol', effective_sensitivity: 'internal', question_hash: 'a'.repeat(16), question_words: ['deadbeef'], quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] };
    writeFileSync(join(run, 'advice.meta.json'), JSON.stringify(meta));
    // the removed flag
    const old = cliRun(['--chain', 'mock-advise-single', '--task', 'runs/x.md', '--advice-meta', 'm.json']);
    assert.equal(old.status, 2);
    assert.match(old.stderr, /--advice-meta was removed in 0\.8\.1/);
    // no gate yet, then a pending gate: refused, nothing written
    assert.equal(cliRun(['--advice-adopt', `runs/${id}`]).status, 2);
    assert.ok(requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1 }, seats: [{ lab: 'mock-a', model: 'mock-x', retention: 'unknown' }], expiresAt: Date.now() + 600_000 }).ok);
    const pending = cliRun(['--advice-adopt', `runs/${id}`]);
    assert.equal(pending.status, 2);
    assert.match(pending.stderr, /gate g1 is pending, not approved/);
    assert.equal(existsSync(join(run, 'run.json')), false);
    assert.equal(existsSync(join(run, 'advise-log.json')), false);
    // anything next to it is refused; a folder outside runs/ is refused
    assert.match(cliRun(['--advice-adopt', `runs/${id}`, '--task', 'x.md']).stderr, /--task cannot be given with it/);
    assert.match(cliRun(['--advice-adopt', 'elsewhere']).stderr, /is not a folder in/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the record -----------------------------------------------------------------------------------------------------------------------

test('the record: report.json validates in both modes; advise-log.json holds no brief text and an empty owner_rating; audit.jsonl shows which text went where and verifies', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const runs = [];
    for (const [brief, mode] of [[BRIEF(), 'single'], [OTHER(), 'council']]) {
      const q = await s.call('council_quote', { brief, mode });
      const a = await s.call('council_advise', { quote_id: sc(q).quote_id, confirm_sha256: sc(q).text.sha256, wait_seconds: 30 });
      assert.equal(sc(a).kind, 'advice', textOf(a));
      await finish(dir, sc(a).run);
      runs.push([sc(a).run, sc(q).text.sha256, mode, sc(q).text.bytes]);
      if (mode === 'single') { /* the single run has no dissent, so the council quote is not blocked */ }
    }
    for (const [run, hash, mode] of runs) {
      const r = report(dir, run);
      assert.equal(validateReport(r), true, `${mode}: ${JSON.stringify(validateReport.errors)}`);
      assert.equal(r.task_sha256, hash);
      assert.ok(Array.isArray(r.advise.sent_to) && r.advise.sent_to.length >= 1 && r.advise.sent_to.every(x => x.retention && 'served_by' in x));
      assert.deepEqual(r.advise.dispositions, []);
      const log = JSON.parse(readFileSync(join(dir, 'runs', run, 'advise-log.json'), 'utf8'));
      assert.equal(log.schema, 'advise-log/1'); assert.equal(log.origin, 'tool'); assert.equal(log.mode, mode);
      assert.equal(log.brief_sha256, hash);
      assert.equal(log.owner_rating, null, 'one empty field a person fills in later');
      assert.ok(log.wall_ms > 0 && log.spent_usd === 0 && typeof log.quoted.ceiling_usd === 'number' && log.date.match(/^\d{4}-\d{2}-\d{2}$/));
      const raw = readFileSync(join(dir, 'runs', run, 'advise-log.json'), 'utf8');
      for (const word of ['invoices', 'legacy', 'queue', 'worker', 'Redis']) assert.ok(!raw.includes(word), `no brief text in advise-log.json: ${word}`);
      assert.match(raw, /No brief text is kept here/);
      const lines = parseAuditLog(readFileSync(join(dir, 'runs', run, 'audit.jsonl'), 'utf8'));
      const calls = lines.filter(l => l.type !== 'chain-close');
      assert.ok(calls.length >= 1 && calls.every(l => /^[0-9a-f]{64}$/.test(l.promptSha256) && l.promptBytes > 0 && l.scan === 'clean' && 'endpoint' in l));
      assert.equal(verifyAuditLog(lines).valid, true);
      assert.ok(!readFileSync(join(dir, 'runs', run, 'audit.jsonl'), 'utf8').includes('invoices'), 'the audit line carries a hash, never the prompt');
    }
    const list = JSON.parse(textOf(await s.call('list_runs', {})));
    assert.match(list[0].state, /^done: advice from \d of \d seat\(s\), leaning /, 'an abandoned run is found later by list_runs');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('`advisor` is only for single mode, and an unknown advisor id is not in the schema', async () => {
  const dir = workdir(); const s = new Session(dir, { env: MOCK, ...PERSON });
  try {
    const r = await s.call('council_quote', { brief: BRIEF(), mode: 'council', advisor: 'astra' });
    assert.equal(sc(r).code, 'advisor_needs_single');
    const bad = await s.call('council_quote', { brief: BRIEF(), mode: 'single', advisor: 'grok' });
    assert.equal(bad.isError, true, 'grok is not an option, and never will be');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
