// Who decides what an advice call sends and to whom (0.8.1 plan M5 Work 1 and 4, decided rules 5a and 5d, audit A4): the chain comes
// from the package or the operator's folder, never the project's chains/; the sensitivity floor is the operator's, a project's
// policy.json may raise it and never lower it; the person reads the whole text and who set each part of the label. Mock-only, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sensitivityFloorOf, sensitivityOf, sensitivityWords } from '../src/advice-tier.js';
import { adviceChainDirs, loadAdviceChain } from '../src/send-profiles.js';
import { gateSeatsOf } from '../src/send-path-refusals.js';
import { requestGate } from '../src/gate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const shipped = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const sha = t => createHash('sha256').update(t).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BRIEF = (over = {}) => ({
  schema_version: 'advice-brief/1', moment: 'before_commit',
  question: 'Should we drop the legacy invoices column before the release?',
  decision_at_stake: 'A dropped column cannot be restored once the migration has run in production.',
  options_considered: [{ name: 'Drop it now', summary: 'Run the migration before the release.' }, { name: 'Do less', summary: 'Keep the column and add a new one beside it.' }],
  tried: [{ what: 'Ran the migration on a copy of the data', result: 'It passed in 3 seconds.' }],
  sensitivity: 'internal', not_included: ['the conversation', 'environment variables'],
  excerpts: [], ...over,
});

// A project that tries to decide for itself: its own chain under the shipped mock chain's name (another lab; since the 6 Oct 2026 owner decision (no wall clocks) the shipped chains have no wall clock either,
// so the lab name is what tells the two apart) and a policy.json that tries to open the floor.
function hostileProject() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-authority-'));
  mkdirSync(join(dir, 'chains'));
  for (const name of ['mock-advise-single', 'advise-single']) {
    const c = shipped(name);
    c.seats.critics = c.seats.critics.map(s => ({ ...s, lab: 'project-lab' }));
    delete c.advise.max_wall_ms;
    writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify(c));
  }
  writeFileSync(join(dir, 'policy.json'), JSON.stringify({ advice_sensitivity_floor: 'public' }));
  return dir;
}

function session(cwd, { env = {}, person = null } = {}) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, COUNCIL_ADVISE_MOCK: '1', COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env } });
  const pending = new Map(); let buf = ''; let n = 0; const asked = [];
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined) { asked.push(m); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: person ? person(m) : { action: 'decline' } })}\n`); }
      else if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: person ? { elicitation: {} } : {}, clientInfo: { name: 'authority', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    asked,
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result; },
    async close() { child.stdin.end(); await Promise.race([new Promise(r => child.on('exit', r)), sleep(3000)]); child.kill(); },
  };
}

test('the floor: the operator sets it (default internal); policy.json may raise it, never lower it; an unknown value is confidential', () => {
  assert.deepEqual(sensitivityFloorOf({ env: {}, policy: null }), { floor: 'internal', operator: 'internal', operator_source: 'default', project: null, floor_source: 'default' });
  assert.equal(sensitivityFloorOf({ env: {}, policy: { advice_sensitivity_floor: 'public' } }).floor, 'internal', 'a project cannot lower it');
  assert.equal(sensitivityFloorOf({ env: { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public' }, policy: null }).floor, 'public', 'the operator can');
  const raised = sensitivityFloorOf({ env: { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public' }, policy: { advice_sensitivity_floor: 'confidential' } });
  assert.equal(raised.floor, 'confidential'); assert.equal(raised.floor_source, 'policy.json');
  assert.equal(sensitivityFloorOf({ env: { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'open' }, policy: null }).floor, 'confidential');
  assert.equal(sensitivityFloorOf({ env: {}, policy: { advice_sensitivity_floor: 'whatever' } }).floor, 'confidential');
  // the caller's label only tightens; missing or unknown is confidential
  assert.equal(sensitivityOf(undefined, { env: { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public' } }).effective, 'confidential');
  assert.equal(sensitivityOf('unknown', { env: {} }).effective, 'confidential');
  assert.equal(sensitivityOf('public', { env: {}, policy: { advice_sensitivity_floor: 'public' } }).effective, 'internal');
  // the person reads who set each part
  const words = sensitivityWords(sensitivityOf('public', { env: {}, policy: { advice_sensitivity_floor: 'public' } }));
  assert.match(words, /treated as internal; operator floor internal \(default\); project policy\.json public \(cannot lower it\); the agent labelled it public, raised by the floor/);
  assert.ok(words.length <= 300, 'fits the gate\'s field');
  assert.match(sensitivityWords(sensitivityOf('internal', { env: { COUNCIL_ADVICE_SENSITIVITY_FLOOR: 'public' } })), /operator floor public \(COUNCIL_ADVICE_SENSITIVITY_FLOOR\); project policy\.json: none; the agent labelled it internal$/);
});

test('the chain loader: the package\'s chains/, or the operator\'s folder first; never the working folder\'s chains/', () => {
  const work = hostileProject();
  assert.deepEqual(loadAdviceChain('mock-advise-single', { env: {}, work }), shipped('mock-advise-single'));
  assert.equal(loadAdviceChain('../package', { env: {}, work }), null);
  const operator = mkdtempSync(join(tmpdir(), 'thc-operator-'));
  const mine = { ...shipped('mock-advise-single'), description: 'the operator\'s own' };
  writeFileSync(join(operator, 'mock-advise-single.json'), JSON.stringify(mine));
  assert.equal(loadAdviceChain('mock-advise-single', { env: { COUNCIL_ADVICE_CHAINS_DIR: operator }, work }).description, 'the operator\'s own');
  assert.deepEqual(loadAdviceChain('mock-advise-standard', { env: { COUNCIL_ADVICE_CHAINS_DIR: operator }, work }), shipped('mock-advise-standard'), 'the package still answers what the operator folder lacks');
  for (const bad of ['chains', join(work, 'chains'), work, join(operator, 'nope')]) {
    assert.match(adviceChainDirs({ env: { COUNCIL_ADVICE_CHAINS_DIR: bad }, work }).error, /not an absolute path|inside the working folder|not a folder/, bad);
    assert.equal(loadAdviceChain('mock-advise-single', { env: { COUNCIL_ADVICE_CHAINS_DIR: bad }, work }), null, bad);
  }
});

test('a project chains/ and a project policy.json lowering the floor change nothing in the quote; the preview says the floor was not lowered', async () => {
  const dir = hostileProject();
  const s = session(dir);
  try {
    const r = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'public' }), mode: 'single' });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const q = r.structuredContent;
    assert.deepEqual(q.seats.map(x => x.lab), shipped('mock-advise-single').seats.critics.map(x => x.lab));
    assert.ok(!JSON.stringify(q).includes('project-lab'));
    assert.equal(q.sensitivity.effective, 'internal');
    assert.equal(q.sensitivity.project_floor, 'public');
    assert.match(r.content[0].text, /project policy\.json public \(cannot lower it\)/);
    assert.match(q.approval, /reads the whole masked text/);
  } finally { await s.close(); }
});

test('an unusable COUNCIL_ADVICE_CHAINS_DIR stops the server with one line instead of falling back', () => {
  const dir = hostileProject();
  for (const bad of [join(dir, 'chains'), 'relative/chains']) {
    const r = spawnSync(process.execPath, [cli, '--mcp'], { cwd: dir, encoding: 'utf8', input: '', timeout: 20_000, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVICE_CHAINS_DIR: bad } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COUNCIL_ADVICE_CHAINS_DIR .* (inside the working folder|not an absolute path)/);
  }
});

test('the approval dialog shows the whole text and who set each part of the label (rules 5a, 5d)', async () => {
  const dir = hostileProject();
  let message = null;
  const s = session(dir, { person: m => { message = m.params.message; return { action: 'decline' }; } });
  try {
    const q = (await s.call('council_quote', { brief: BRIEF(), mode: 'single' })).structuredContent;
    const d = (await s.call('council_advise', { quote_id: q.quote_id, confirm_sha256: q.text.sha256 })).structuredContent;
    assert.equal(d.code, 'declined', JSON.stringify(d));
    const text = readFileSync(join(dir, 'runs', d.run, 'advice-brief.md'), 'utf8');
    assert.equal(sha(text), q.text.sha256);
    assert.ok(message.includes(text), 'the elicitation message holds the whole text');
    assert.match(message, /operator floor internal \(default\); project policy\.json public \(cannot lower it\); the agent labelled it internal/);
    const gate = JSON.parse(readFileSync(join(dir, 'runs', d.run, 'gates', 'g1.json'), 'utf8'));
    assert.match(gate.sensitivity.set_by, /operator floor internal \(default\)/);
  } finally { await s.close(); }
});

// The terminal channel through a real pseudo-terminal (python3's pty module), as in test/send-path.test.js.
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

test('--advice-adopt runs the package\'s chain, not a project chain of the same name (M4 review entry item for M5)', { skip: !hasPython && 'python3 is not installed' }, () => {
  const dir = hostileProject();
  // An approved advice folder as the server builds it, the gate binding the package chain's seats, answered by a person.
  const approved = id => {
    const run = join(dir, 'runs', id);
    mkdirSync(run, { recursive: true });
    const text = `# A brief\n\nShould we keep the legacy invoices column? (${id})\n`;
    writeFileSync(join(run, 'advice-brief.md'), text);
    writeFileSync(join(run, 'advice.meta.json'), JSON.stringify({ schema: 'advice-meta/1', quote_id: `q_${'1'.repeat(24)}`, chain: 'mock-advise-single', gate: 'g1', brief_sha256: sha(text), mode: 'single', advisor: 'sol', effective_sensitivity: 'internal', question_hash: sha(id).slice(0, 16), question_words: [sha(`w${id}`).slice(0, 8)], has_new_evidence: false, quoted: { worst_usd: 0, expected_usd: 0, ceiling_usd: 1 }, previous_run: null, dispositions: [] }));
    const g = requestGate(run, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 1 }, seats: gateSeatsOf(shipped('mock-advise-single')), sensitivity: { label: 'internal', set_by: 'test' } });
    assert.ok(g.ok, g.message);
    const answered = inPty(dir, ['gate', 'answer', `runs/${id}`, 'g1'], 'y\n');
    assert.equal(answered.status, 0, answered.stdout);
    return run;
  };
  const adopt = (run, env = {}) => spawnSync(process.execPath, [cli, '--advice-adopt', `runs/${run.split('/').pop()}`], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_COOLDOWN_MS: '0', ...env }, timeout: 60_000 });
  // The project's chain under the same name uses another lab: the run reads clean only if the package's chain is the one loaded (before 0.8.2 admission also refused it for having no wall clock).
  const run = approved('2026-10-03T01-00-00-001Z');
  const r = adopt(run);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(run, 'report.json')));
  assert.ok(!readFileSync(join(run, 'report.json'), 'utf8').includes('project-lab'));
  // an unusable operator folder refuses the adopt instead of falling back to the package's chains
  const second = approved('2026-10-03T01-00-00-002Z');
  const r2 = adopt(second, { COUNCIL_ADVICE_CHAINS_DIR: join(dir, 'chains') });
  assert.equal(r2.status, 2, r2.stderr);
  assert.match(r2.stderr, /COUNCIL_ADVICE_CHAINS_DIR .* inside the working folder/);
  assert.equal(existsSync(join(second, 'advise-log.json')), false);
});

test('review D1: an advice folder is never resumed through a project chain that shadows its name (resume_run and --resume)', async () => {
  const dir = hostileProject();
  // A started advice run that stopped without a report, its project shadow chain NOT marked as advice (so a chain lookup misreads it).
  const shadow = shipped('advise-single'); delete shadow.advise; writeFileSync(join(dir, 'chains', 'advise-single.json'), JSON.stringify(shadow));
  const id = '2026-10-03T03-00-00-001Z';
  const run = join(dir, 'runs', id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'advice-brief.md'), '# A brief\n');
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'advise-single', task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  writeFileSync(join(run, 'advise-log.json'), JSON.stringify({ schema: 'advise-log/1', run: id, ts: Date.now(), origin: 'tool', quoted: { ceiling_usd: 1 } }));
  const s = session(dir);
  try {
    const r = await s.call('resume_run', { run: id });
    assert.match(r.content[0].text, /this is an advice run, which is not resumed over MCP/);
    assert.equal(existsSync(join(run, 'build.md')), false);
  } finally { await s.close(); }
  // The CLI's --resume of an advice folder takes the advice lookup: a bad operator folder refuses it by name, and a chain that
  // only the project has is not found.
  const env = { PATH: process.env.PATH, HOME: dir };
  const bad = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: dir, encoding: 'utf8', env: { ...env, COUNCIL_ADVICE_CHAINS_DIR: join(dir, 'chains') }, timeout: 60_000 });
  assert.equal(bad.status, 2, bad.stderr); assert.match(bad.stderr, /--resume: COUNCIL_ADVICE_CHAINS_DIR .* inside the working folder/);
  writeFileSync(join(dir, 'chains', 'project-only.json'), JSON.stringify(shipped('mock-advise-single')));
  writeFileSync(join(run, 'run.json'), JSON.stringify({ chain: 'project-only', task: join(run, 'advice-brief.md'), cwd: dir, maxUsd: 1 }));
  const missing = spawnSync(process.execPath, [cli, '--resume', `runs/${id}`], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(missing.status, 2, missing.stderr); assert.match(missing.stderr, /--resume: no advice chain "project-only"/);
});

test('review D3: a project .env cannot set the operator\'s advice settings, for the server or the CLI', async () => {
  const dir = hostileProject();
  // Lower the floor and point the operator folder at the project's own chains: both are ignored, so the server starts normally.
  writeFileSync(join(dir, '.env'), `COUNCIL_ADVICE_SENSITIVITY_FLOOR=public\nCOUNCIL_ADVICE_CHAINS_DIR=${join(dir, 'chains')}\n`);
  const s = session(dir);
  try {
    const r = await s.call('council_quote', { brief: BRIEF({ sensitivity: 'public' }), mode: 'single' });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.structuredContent.sensitivity.effective, 'internal');
    assert.equal(r.structuredContent.sensitivity.operator_source, 'default');
    assert.ok(!JSON.stringify(r.structuredContent.seats).includes('project-lab'));
  } finally { await s.close(); }
});
