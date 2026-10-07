// The gate (0.8.1 plan DR-3, M3; persistence register P4): a send waits for a person who saw the exact
// text. answerGate is the only writer of an answer; only a person's channel (the terminal, an MCP
// elicitation) can answer; the answer is bound to the hash of the bytes the person was shown; submit_stage
// can never reach a gate; no environment variable or flag approves. Mock-only, $0, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, cpSync, statSync, symlinkSync, renameSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { requestGate, answerGate, readGateAnswer, readGateText, listGates, PERSON_CHANNELS, GATE_TTL_MS, textSha256 } from '../src/gate.js';
import { readLedger, verifyLedger, appendEvent, LEDGER_FILE } from '../src/gate-ledger.js';
import { submitStageAnswer } from '../src/stage-submission.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const src = join(repo, 'src');
const cli = join(src, 'cli.js');
const FIX = join(here, 'fixtures', 'gate');
const T0 = Date.parse('2026-10-02T12:00:00.000Z');
const at = ms => () => ms;
const BRIEF = 'The exact brief.\nSecond line.\n';

function freshGate(text = BRIEF, extra = {}) {
  // 0.8.2 (C&C, 7 Oct 2026: an advice gate is approved at the terminal only from a run folder inside a runs/ folder, src/gate-cli.js): the fixture's run folder sits in one, as a real advice run does.
  const base = mkdtempSync(join(tmpdir(), 'gate-answer-')); mkdirSync(join(base, 'runs'));
  const d = join(base, 'runs', 'r1'); mkdirSync(d);
  writeFileSync(join(d, 'advice-brief.md'), text);
  const r = requestGate(d, { kind: 'advice', textPath: 'advice-brief.md', price: { ceiling_usd: 0.75 }, seats: [{ lab: 'openai' }], sensitivity: { label: 'public', set_by: 'operator' }, masks: { email: 1 }, ...extra }, { now: at(T0) });
  assert.equal(r.ok, true, r.message);
  return { d, gate: r.gate, sha: textSha256(Buffer.from(text)) };
}
const ledger = d => readFileSync(join(d, LEDGER_FILE));
const person = (sha, decision = 'approved') => ({ channel: 'cli', shownSha256: sha, decision, actor: 'tester', tty: true });

test('requestGate hashes the file itself and records a pending gate', () => {
  const { d, gate, sha } = freshGate();
  assert.equal(gate.id, 'g1');
  assert.equal(gate.sha256, sha);
  assert.equal(gate.bytes, Buffer.byteLength(BRIEF));
  assert.equal(gate.expires_at, new Date(T0 + GATE_TTL_MS).toISOString());
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).status, 'pending');
  assert.equal(readLedger(d).lines.length, 1);
  // a caller-supplied hash is not an input
  writeFileSync(join(d, 'b.md'), 'b\n');
  const r = requestGate(d, { kind: 'advice', textPath: 'b.md', sha256: 'f'.repeat(64) }, { now: at(T0) });
  assert.equal(r.gate.sha256, textSha256(Buffer.from('b\n')));
});

test('requestGate refuses a text outside the run folder, an unreadable text, a bad kind and a past expiry', () => {
  const { d } = freshGate();
  assert.equal(requestGate(d, { kind: 'advice', textPath: '../outside.md' }).code, 'text_outside_run');
  assert.equal(requestGate(d, { kind: 'advice', textPath: '/etc/hostname' }).code, 'text_outside_run');
  assert.equal(requestGate(d, { kind: 'advice', textPath: '.' }).code, 'text_outside_run');
  assert.equal(requestGate(d, { kind: 'advice', textPath: 'nope.md' }).code, 'text_unreadable');
  assert.equal(requestGate(d, { kind: 'Advice!', textPath: 'advice-brief.md' }).code, 'bad_kind');
  assert.equal(requestGate(d, { kind: 'advice', textPath: 'advice-brief.md', expiresAt: T0 - 1 }, { now: at(T0) }).code, 'bad_expiry');
  assert.equal(readLedger(d).lines.length, 1, 'refusals append nothing');
});

test('the wrong hash appends nothing: not the recorded one, or the text changed on disk since the request', () => {
  const { d, sha } = freshGate();
  const before = ledger(d);
  assert.equal(answerGate(d, 'g1', person('0'.repeat(64)), { now: at(T0 + 1) }).code, 'hash_mismatch');
  assert.equal(answerGate(d, 'g1', person(undefined), { now: at(T0 + 1) }).code, 'hash_mismatch');
  writeFileSync(join(d, 'advice-brief.md'), `${BRIEF}one more line\n`);
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).code, 'hash_mismatch', 'the bytes are re-hashed now');
  assert.ok(ledger(d).equals(before));
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).status, 'pending');
});

test('the right hash appends one gate_answered line chained to the one before, and the gate file follows', () => {
  const { d, sha } = freshGate();
  const first = readFileSync(join(d, LEDGER_FILE), 'utf8').trimEnd();
  const r = answerGate(d, 'g1', person(sha), { now: at(T0 + 5000) });
  assert.deepEqual(r, { ok: true, status: 'approved', seq: 2 });
  const lines = readLedger(d).lines;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].prev, null);
  assert.equal(lines[1].prev, textSha256(Buffer.from(first)));
  assert.deepEqual({ ...lines[1], ts: undefined }, { schema: 'gate-ledger/1', seq: 2, prev: lines[1].prev, ts: undefined, event: 'gate_answered', gate: 'g1', decision: 'approved', sha256: sha, meta_sha256: lines[0].meta_sha256, channel: 'cli', actor: 'tester', reason: null, tty: true });
  assert.match(lines[0].meta_sha256, /^[0-9a-f]{64}$/);
  const rec = JSON.parse(readFileSync(join(d, 'gates', 'g1.json'), 'utf8'));
  assert.equal(rec.status, 'approved');
  assert.equal(rec.answer.seq, 2);
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 6000) }).status, 'approved');
});

test('only a channel a person uses can answer: allowance, host, ui, an agent and anything else are refused, appending nothing', () => {
  assert.deepEqual([...PERSON_CHANNELS], ['cli', 'elicitation']);
  assert.ok(Object.isFrozen(PERSON_CHANNELS));
  const { d, sha } = freshGate();
  const before = ledger(d);
  for (const channel of ['allowance', 'host', 'ui', 'agent', 'submit_stage', 'env', 'CLI', 'cli ', '', undefined, null, 0]) {
    assert.equal(answerGate(d, 'g1', { ...person(sha), channel }, { now: at(T0 + 1) }).code, 'channel_not_person', String(channel));
  }
  assert.equal(answerGate(d, 'g1', { ...person(sha), decision: 'maybe' }, { now: at(T0 + 1) }).code, 'bad_decision');
  assert.ok(ledger(d).equals(before));
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).status, 'pending');
});

test('an elicitation answer and a decline are recorded the same way', () => {
  const { d, sha } = freshGate();
  assert.equal(answerGate(d, 'g1', { channel: 'elicitation', shownSha256: sha, decision: 'declined', reason: 'not this', tty: null }, { now: at(T0 + 1) }).status, 'declined');
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 2) }).status, 'declined');
});

test('an expired gate reads expired, never approved, and cannot be answered', () => {
  const { d, sha } = freshGate();
  const before = ledger(d);
  const late = at(T0 + GATE_TTL_MS);
  assert.equal(readGateAnswer(d, 'g1', { now: late }).status, 'expired');
  assert.equal(answerGate(d, 'g1', person(sha), { now: late }).code, 'gate_expired');
  assert.ok(ledger(d).equals(before));
  // expired is derived, never written
  assert.equal(JSON.parse(readFileSync(join(d, 'gates', 'g1.json'), 'utf8')).status, 'pending');
  // a shorter expiry (M4: the quote's own) is honoured
  writeFileSync(join(d, 'b.md'), 'b\n');
  requestGate(d, { kind: 'advice', textPath: 'b.md', expiresAt: T0 + 1000 }, { now: at(T0) });
  assert.equal(readGateAnswer(d, 'g2', { now: at(T0 + 1000) }).status, 'expired');
});

test('a gate is answered once: the second answer is gate_not_pending', () => {
  const { d, sha } = freshGate();
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).ok, true);
  const before = ledger(d);
  assert.equal(answerGate(d, 'g1', person(sha, 'declined'), { now: at(T0 + 2) }).code, 'gate_not_pending');
  assert.ok(ledger(d).equals(before));
});

test('two processes answering one gate at once leave exactly one gate_answered line; the other is gate_not_pending', async () => {
  const { d, sha } = freshGate();
  const mod = join(src, 'gate.js');
  const barrier = join(d, 'go');
  const script = decision => `import { answerGate } from ${JSON.stringify(mod)}; import { existsSync } from 'node:fs';
    while (!existsSync(${JSON.stringify(barrier)})) {}
    const r = answerGate(${JSON.stringify(d)}, 'g1', { channel: 'cli', shownSha256: ${JSON.stringify(sha)}, decision: '${decision}', tty: true }, { now: () => ${T0 + 1} });
    process.stdout.write(r.ok ? 'ok' : r.code);`;
  const run = decision => new Promise(res => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script(decision)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', b => { out += b; });
    c.on('exit', () => res(out));
  });
  const kids = [run('approved'), run('declined')];
  setTimeout(() => writeFileSync(barrier, ''), 300);
  const results = (await Promise.all(kids)).sort();
  assert.deepEqual(results, ['gate_not_pending', 'ok']);
  const answers = readLedger(d).lines.filter(l => l.event === 'gate_answered');
  assert.equal(answers.length, 1);
  assert.equal(verifyLedger(d).ok, true);
});

test('a gate file edited to "approved" approves nothing; the ledger decides', () => {
  const { d, sha } = freshGate();
  const p = join(d, 'gates', 'g1.json');
  const rec = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...rec, status: 'approved', answer: { decision: 'approved', channel: 'cli', actor: 'x', reason: null, tty: true, at: 'x', seq: 2 } }));
  assert.deepEqual(readGateAnswer(d, 'g1', { now: at(T0 + 1) }), { status: 'invalid', reason: 'gate_record_mismatch' });
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).code, 'gate_record_mismatch');
  // a gate file whose hash was swapped for another text's
  writeFileSync(p, JSON.stringify({ ...rec, sha256: 'a'.repeat(64) }));
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).reason, 'gate_record_mismatch');
});

test('an unparseable gate file is never approved and refuses answers; an unknown gate is gate_not_found', () => {
  const { d, sha } = freshGate();
  writeFileSync(join(d, 'gates', 'g1.json'), '{"schema": "gate/1", "id": ');
  assert.deepEqual(readGateAnswer(d, 'g1', { now: at(T0 + 1) }), { status: 'invalid', reason: 'gate_record_unreadable' });
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).code, 'gate_record_unreadable');
  assert.equal(readGateAnswer(d, 'g9').reason, 'gate_not_found');
  assert.equal(readGateAnswer(d, '../g1').reason, 'gate_not_found');
  assert.equal(answerGate(d, 'g9', person(sha)).code, 'gate_not_found');
  assert.equal(readLedger(d).lines.length, 1);
});

test('a crash between the ledger line and the gate file: the ledger wins, so the gate is neither answered twice nor stranded', () => {
  const { d, sha } = freshGate();
  const p = join(d, 'gates', 'g1.json');
  const pending = readFileSync(p);
  answerGate(d, 'g1', person(sha), { now: at(T0 + 1) });
  writeFileSync(p, pending); // the view as it was before the answer
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 2) }).status, 'approved');
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 2) }).code, 'gate_not_pending');
});

test('an approved gate whose text changed afterwards is not approved any more', () => {
  const { d, sha } = freshGate();
  answerGate(d, 'g1', person(sha), { now: at(T0 + 1) });
  writeFileSync(join(d, 'advice-brief.md'), 'a different brief\n');
  assert.deepEqual({ ...readGateAnswer(d, 'g1', { now: at(T0 + 2) }), gate: undefined }, { status: 'invalid', reason: 'hash_mismatch', gate: undefined });
});

test('listGates names every gate with its status', () => {
  const runOk = mkdtempSync(join(tmpdir(), 'gate-list-'));
  cpSync(join(FIX, 'run-ok'), runOk, { recursive: true });
  assert.deepEqual(listGates(runOk), [{ id: 'g1', status: 'approved' }, { id: 'g2', status: 'declined' }]);
  const tampered = mkdtempSync(join(tmpdir(), 'gate-list-'));
  cpSync(join(FIX, 'run-tampered'), tampered, { recursive: true });
  assert.equal(listGates(tampered), null);
});

// ---- source scans: what no code path may do ----------------------------------------------------------
//
// The scans read the raw source text: comments are NOT stripped (a regex strip cannot tell a "/*" inside a
// string from a comment, and once hid 1,200 lines of cli.js from these very checks: M3 review H1). Over-
// matching fails closed: a comment that names a forbidden token gets reworded. scanGateRules() takes a map
// of file -> text, so the self-tests below plant each known evasion and prove the scan reports it.

const srcFiles = (dir = src) => readdirSync(dir).flatMap(e => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith('.js') ? [p] : [];
});
const rel = p => relative(repo, p).split('\\').join('/');
const realSources = () => new Map(srcFiles().map(p => [rel(p), readFileSync(p, 'utf8')]));

const GATE_MODULES = ['src/gate.js', 'src/gate-ledger.js', 'src/gate-cli.js'];
// Who may import each gate module, on purpose and in this list, so every addition is visible in review. M4 (plan DR-15)
// added: src/send-path.js (requests the gate, answers it with the client's dialog), src/cli.js (--advice-adopt records
// the send), src/advice-run.js (the adoption check) and src/run-status.js (a folder awaiting approval).
const IMPORTERS = {
  // 0.8.2 item 6d (owner, 7 Oct 2026: "we go with the full one"): src/contract-record.js asks the gate for the contract's lock and amendment approvals, through gate.js only.
  'gate.js': ['src/gate-cli.js', 'src/send-path.js', 'src/cli.js', 'src/advice-run.js', 'src/run-status.js', 'src/contract-record.js'],
  'gate-ledger.js': ['src/gate.js', 'src/gate-cli.js'],
  // 0.8.2 item 6d: src/contract-cli.js answers its lock and amendment gates through gate-cli.js's terminal answer (answerAtTerminal), never through answerGate itself.
  'gate-cli.js': ['src/cli.js', 'src/contract-cli.js'],
};
const PERSON_LITERALS = ["'cli'", "'elicitation'"];
// Who may import answerGate itself: the terminal command and the client's dialog. Each passes its channel as a literal.
const ANSWERERS = ['src/gate-cli.js', 'src/send-path.js'];
const WRITES = /\b(writeFileSync|appendFileSync|renameSync|writeSync|createWriteStream|copyFileSync|cpSync|ftruncateSync|truncateSync|writeFile|appendFile|rename)\b/;

// Every module specifier a file names: static and re-export `from`, side-effect `import '...'`, dynamic
// import(), require().
const specifiers = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g)].map(m => m[1]);

function scanGateRules(files) {
  const bad = [];
  for (const [file, text] of files) {
    if (!file.startsWith('src/')) continue;
    // R1: the gate modules read no environment and no command line, by any spelling.
    if (GATE_MODULES.includes(file)) {
      if (/\benv\b|\bargv\b|node:process|['"`]process['"`]/.test(text)) bad.push(`${file}: reads the environment or the command line`);
    }
    // R2: only the listed files import a gate module, never as a namespace.
    for (const spec of specifiers(text)) {
      const target = Object.keys(IMPORTERS).find(m => spec === `./${m}` || spec === `../${m}` || spec.endsWith(`/${m}`) || spec === m.slice(0, -3) || spec.endsWith(`/${m.slice(0, -3)}`));
      if (!target) continue;
      if (!IMPORTERS[target].includes(file)) bad.push(`${file}: imports ${target}, which only ${IMPORTERS[target].join(', ')} may`);
      const nsRe = new RegExp(`import\\s*\\*\\s*as\\s+\\w+\\s+from\\s*['"\`][^'"\`]*${target.replace('.', '\\.')}`);
      if (nsRe.test(text)) bad.push(`${file}: imports ${target} as a namespace`);
    }
    if (/\bimport\s*\(/.test(text) && /gate/.test(text) && !GATE_MODULES.includes(file)) {
      // a dynamic import is banned repo-wide already; near a gate it is named here too
      if ([...text.matchAll(/\bimport\s*\(([^)]*)\)/g)].some(m => /gate/.test(m[1]))) bad.push(`${file}: dynamic import near a gate module`);
    }
    // R3: the answer event and the ledger lock are named only inside the two gate modules that own them.
    if (file !== 'src/gate.js' && file !== 'src/gate-ledger.js') {
      if (/gate_answered/.test(text)) bad.push(`${file}: names gate_answered`);
      if (/\bwithLedger\b/.test(text)) bad.push(`${file}: names withLedger`);
    }
    // R4: only the answerers name answerGate, and an answerer passes only a person channel, as a literal, and names one. Nobody
    // re-exports it (a renamed re-export would let a file outside the list call it under another name: M4 review).
    if (file !== 'src/gate.js' && /\bexport\s*(\*|\{[^}]*\banswerGate\b)[^;]*['"`][^'"`]*\bgate(\.js)?['"`]|\bexport\s*\{[^}]*\banswerGate\b/.test(text)) bad.push(`${file}: re-exports answerGate`);
    if (file !== 'src/gate.js' && /\banswerGate\b/.test(text)) {
      if (!ANSWERERS.includes(file)) bad.push(`${file}: names answerGate, which only ${ANSWERERS.join(', ')} may`);
      const channels = [...text.matchAll(/\bchannel\s*:\s*([^,}\s]+)/g)].map(m => m[1]);
      if (!channels.length) bad.push(`${file}: names answerGate but no channel`);
      for (const ch of channels) if (!PERSON_LITERALS.includes(ch)) bad.push(`${file}: passes channel ${ch}`);
    }
    // R5: nothing outside the two gate modules both points at gate files and writes files.
    if (file !== 'src/gate.js' && file !== 'src/gate-ledger.js') {
      const pointsAtGates = /\b(LEDGER_FILE|GATES_DIR|LEDGER_LOCK_FILE)\b|gate-ledger|['"`/]gates['"`/]/.test(text);
      if (pointsAtGates && WRITES.test(text)) bad.push(`${file}: points at gate files and writes files`);
    }
  }
  // R6: cli.js hands the gate command its arguments and the working directory, nothing else.
  const cliText = files.get('src/cli.js');
  const block = cliText?.match(/if \(argv\[0\] === 'gate'\) \{[\s\S]*?\n\}/)?.[0];
  if (cliText && !block) bad.push('src/cli.js: the gate dispatch block was not found');
  if (block && /env|flag\(|--/.test(block)) bad.push('src/cli.js: the gate dispatch takes a setting');
  // R7: gate-cli.js reads exactly one option, --decline, which can only decline.
  const gc = files.get('src/gate-cli.js');
  if (gc) {
    const opts = [...new Set([...gc.matchAll(/['"`]--([a-z][a-z-]*)/g)].map(m => m[1]))];
    if (opts.join() !== 'decline') bad.push(`src/gate-cli.js: options ${opts.join(', ')}`);
  }
  return bad;
}

test('scan: the real source keeps every gate rule', () => {
  assert.deepEqual(scanGateRules(realSources()), []);
});

test('scan self-test: each known evasion is reported (M3 review H1)', () => {
  const base = realSources();
  const planted = (file, text, append = true) => {
    const m = new Map(base);
    m.set(file, append && m.has(file) ? `${m.get(file)}\n${text}\n` : text);
    return scanGateRules(m);
  };
  const cases = [
    // after cli.js's 'chains/*.json' string, where the old comment strip went blind
    ['src/cli.js', "withLedger(runDir, ({ append }) => append('gate_answered', {}));", /gate_answered|withLedger/],
    ['src/cli.js', "import { answerGate } from './gate.js'; answerGate(runDir, 'g1', opts);", /names answerGate, which only/],
    ['src/advise.js', "import { readGateAnswer } from './gate.js';", /imports gate\.js/],
    ['src/send-path.js', "export { answerGate as ag };", /re-exports answerGate/],
    ['src/gate-cli.js', "export * from './gate.js';", /re-exports answerGate/],
    ['src/gate-cli.js', "import { env } from 'node:process';", /reads the environment/],
    ['src/gate-cli.js', 'const { argv } = process;', /reads the environment/],
    ['src/gate.js', 'const e = globalThis.process.env;', /reads the environment/],
    ['src/x.js', "import * as G from './gate.js'; G['answer' + 'Gate'](d, 'g1', {});", /imports gate\.js/],
    ['src/x.js', "export { answerGate } from './gate.js';", /imports gate\.js/],
    ['src/x.js', "import { appendFileSync } from 'node:fs'; import { LEDGER_FILE } from './gate-ledger.js'; appendFileSync(join(d, LEDGER_FILE), 'x');", /imports gate-ledger\.js|writes files/],
    ['src/x.js', "import { writeFileSync } from 'node:fs'; writeFileSync(join(dir, 'gates', 'g1.json'), '{}');", /writes files/],
    ['src/x.js', "const L = 'gate-ledger' + '.jsonl'; fs.appendFileSync(L, 'x');", /writes files/],
    ['src/gate-cli.js', "answerGate(runDir, gateArg, { channel: someChannel });", /passes channel someChannel/],
    ['src/gate-cli.js', "answerGate(runDir, gateArg, { channel: 'host' });", /passes channel 'host'/],
    ['src/gate-cli.js', "if (args.includes('--yes')) {}", /options/],
  ];
  for (const [file, text, want] of cases) {
    const found = planted(file, text);
    assert.ok(found.some(f => want.test(f)), `not reported: ${file} + ${text}\n  got: ${JSON.stringify(found)}`);
  }
  // the cli.js dispatch taking a setting
  const m = new Map(base);
  m.set('src/cli.js', base.get('src/cli.js').replace("gateCommand(argv.slice(1), { work })", "gateCommand(argv.slice(1), { work, yes: process.env.X })"));
  assert.ok(scanGateRules(m).some(f => /dispatch takes a setting/.test(f)));
});

// The import closure of a module: every src file it reaches through relative imports (raw text, so an
// import named in a comment is followed too: over-approximation fails closed).
function closure(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return seen;
  seen.add(entry);
  for (const s of specifiers(readFileSync(entry, 'utf8'))) if (s.startsWith('.')) closure(resolve(dirname(entry), s), seen);
  return seen;
}

test('scan: submit_stage cannot reach the gate: its module closure holds no gate module, and its handler names nothing server.js imports from the gate or the advice tools', () => {
  const reach = [...closure(join(src, 'stage-submission.js'))].map(rel);
  assert.ok(reach.includes('src/stage-submission.js') && reach.length > 1, 'the closure walk found the imports');
  for (const g of ['src/gate.js', 'src/gate-ledger.js', 'src/mcp/advice.js']) assert.ok(!reach.includes(g), `submit_stage's code reaches ${g}`);
  const server = readFileSync(join(src, 'mcp', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /['"]\.\.\/gate(-ledger|-cli)?\.js['"]/, 'server.js imports a gate module directly');
  // server.js does import advice.js, which reaches gate.js from M4 on: the submit_stage handler must not
  // use anything that import brings in.
  const imported = [...server.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/advice\.js['"]/g)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  assert.ok(imported.length > 0, 'found what server.js imports from advice.js');
  const start = server.indexOf("server.tool('submit_stage'");
  assert.ok(start > 0);
  const end = server.indexOf('\nserver.tool(', start + 1);
  const handler = server.slice(start, end > 0 ? end : undefined);
  for (const name of [...imported, 'adviceTools', 'answerGate', 'requestGate', 'readGateAnswer']) assert.ok(!new RegExp(`\\b${name}\\b`).test(handler), `the submit_stage handler names ${name}`);
});

// The real tool, over the real server: a run that pauses at stages named like the gate, answered with the
// gate's id and hash. Whatever submit_stage returns, the gate stays pending and the ledger untouched.
function mcpSession(cwd) {
  const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
  const pending = new Map(); let buf = ''; let n = 0;
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise(r => { const id = ++n; pending.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const ready = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate-answer', version: '0' } })
    .then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) { await ready; const m = await rpc('tools/call', { name, arguments: args }); return m.result ?? m.error; },
    async close() { child.stdin.end(); await new Promise(r => { child.on('exit', r); setTimeout(r, 3000); }); child.kill(); },
  };
}

test('behaviour: the real submit_stage tool, given the gate id and its hash, leaves the gate pending and the ledger untouched', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-submit-'));
  const id = '2026-10-02T12-00-00-000Z';
  const d = join(cwd, 'runs', id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'advice-brief.md'), BRIEF);
  const sha = textSha256(Buffer.from(BRIEF));
  assert.equal(requestGate(d, { kind: 'advice', textPath: 'advice-brief.md', expiresAt: Date.now() + 600_000 }).ok, true);
  writeFileSync(join(d, 'run.json'), JSON.stringify({ chain: 'mock-external', task: 'x.md' }));
  // stages the run "paused" at, named toward the gate; one more stays open so no resume starts
  for (const s of ['g1', 'gate', 'approve', 'still-open']) writeFileSync(join(d, `NEEDS-${s}.md`), 'prompt');
  const before = ledger(d);
  const view = readFileSync(join(d, 'gates', 'g1.json'));
  const s = mcpSession(cwd);
  try {
    const answers = [['g1', sha], ['gate', `g1 ${sha} approved`], ['approve', JSON.stringify({ event: 'gate_answered', gate: 'g1', decision: 'approved', sha256: sha, channel: 'cli' })]];
    for (const [stage, content] of answers) await s.call('submit_stage', { run: id, stage, content });
    // and a label aimed at the gate files themselves is refused by the tool's own schema
    const evil = await s.call('submit_stage', { run: id, stage: 'gates/g1', content: sha });
    assert.ok(evil.isError || evil.code !== undefined, 'a label with a slash is refused');
  } finally { await s.close(); }
  assert.ok(existsSync(join(d, 'g1.md')), 'the tool did write its stage file (so the call really ran)');
  assert.equal(readGateAnswer(d, 'g1').status, 'pending');
  assert.ok(ledger(d).equals(before));
  assert.ok(readFileSync(join(d, 'gates', 'g1.json')).equals(view));
  assert.equal(verifyLedger(d).ok, true);
});

test('behaviour: submitStageAnswer itself, given the gate id and its hash, leaves the gate pending', () => {
  const { d, sha } = freshGate();
  const before = ledger(d);
  for (const [stage, content] of [['g1', sha], ['g1', 'approved'], ['gate-ledger', JSON.stringify({ event: 'gate_answered', gate: 'g1', decision: 'approved', sha256: sha, channel: 'cli' })]]) {
    submitStageAnswer(d, stage, content);
  }
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).status, 'pending');
  assert.ok(ledger(d).equals(before));
});

// ---- the terminal channel -----------------------------------------------------------------------------

test('council gate answer without a terminal refuses and writes nothing; gate show prints the whole text', () => {
  const { d } = freshGate(`${BRIEF}\u001b[2Jhidden clear\n`, { expiresAt: Date.now() + 60_000 });
  const before = ledger(d);
  const r = spawnSync(process.execPath, [cli, 'gate', 'answer', d, 'g1'], { encoding: 'utf8', input: 'y\n' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs a person at a terminal/);
  assert.ok(ledger(d).equals(before));
  const s = spawnSync(process.execPath, [cli, 'gate', 'show', d, 'g1'], { encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /status: pending/);
  assert.match(s.stdout, /The exact brief\.\nSecond line\./);
  assert.match(s.stdout, /masked before sending: 1 email/);
  assert.doesNotMatch(s.stdout, /\u001b/, 'control characters are not printed');
  assert.match(s.stdout, /holds 1 control or direction character/);
  const list = spawnSync(process.execPath, [cli, 'gate', 'show', d], { encoding: 'utf8' });
  assert.equal(list.stdout.trim(), 'g1  pending');
  assert.equal(spawnSync(process.execPath, [cli, 'gate', 'show', d, 'g7'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, 'gate'], { encoding: 'utf8' }).status, 2);
});

// A real pseudo-terminal through python3's pty module (no node-pty dependency). This is the CLI channel as
// a person uses it, and also proof of what DR-3 says: a pty passes the terminal check (friction, not
// enforcement). Skipped where python3 is missing.
const hasPython = spawnSync('python3', ['-c', 'import pty'], { encoding: 'utf8' }).status === 0;
function inPty(args, answer) {
  const py = `
import os, pty, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
out = b''
sent = False
while True:
    try:
        b = os.read(fd, 4096)
    except OSError:
        break
    if not b:
        break
    out += b
    if not sent and b'[y/N]' in out:
        os.write(fd, sys.stdin.buffer.read())
        sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  return spawnSync('python3', ['-c', py, process.execPath, cli, ...args], { encoding: 'utf8', input: answer, timeout: 30_000 });
}

test('council gate answer at a terminal: shows the text, approves on y; N writes nothing', { skip: !hasPython && 'python3 is not installed' }, () => {
  const { d, sha } = freshGate(BRIEF, { expiresAt: Date.now() + 60_000 });
  const no = inPty(['gate', 'answer', d, 'g1'], 'n\n');
  assert.equal(no.status, 1, no.stdout);
  assert.match(no.stdout, /Not confirmed\. Nothing was written/);
  assert.equal(readLedger(d).lines.length, 1);
  const yes = inPty(['gate', 'answer', d, 'g1'], 'y\n');
  assert.equal(yes.status, 0, yes.stdout);
  assert.match(yes.stdout, /The exact brief\./);
  assert.match(yes.stdout, /Approve sending exactly this text\? \[y\/N\]/);
  const ans = readLedger(d).lines.find(l => l.event === 'gate_answered');
  assert.equal(ans.channel, 'cli');
  assert.equal(ans.tty, true);
  assert.equal(ans.sha256, sha);
  assert.equal(ans.decision, 'approved');
  assert.equal(readGateAnswer(d, 'g1').status, 'approved');
});

test('council gate answer --decline at a terminal records a decline', { skip: !hasPython && 'python3 is not installed' }, () => {
  const { d } = freshGate(BRIEF, { expiresAt: Date.now() + 60_000 });
  const r = inPty(['gate', 'answer', d, 'g1', '--decline'], 'y\n');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(readGateAnswer(d, 'g1').status, 'declined');
});

// ---- the M3 review's findings, each a test --------------------------------------------------------------

test('review M1: an edited LAST ledger line (a decline turned into an approval) is caught by the gate file', () => {
  const { d, sha } = freshGate();
  answerGate(d, 'g1', person(sha, 'declined'), { now: at(T0 + 1) });
  const p = join(d, LEDGER_FILE);
  writeFileSync(p, readFileSync(p, 'utf8').replace('"decision":"declined"', '"decision":"approved"'));
  assert.equal(verifyLedger(d).ok, true, 'the chain cannot see an edit of its last line (decided rule 9)');
  assert.deepEqual(readGateAnswer(d, 'g1', { now: at(T0 + 2) }), { status: 'invalid', reason: 'gate_record_mismatch' });
});

test('review M2: price, seats, sensitivity and masks are bound to the ledger; editing any of them in the gate file is caught', () => {
  for (const edit of [r => { r.price.ceiling_usd = 0.01; }, r => { r.seats[0].lab = 'zero retention lab'; }, r => { r.sensitivity.label = 'public-ish'; }, r => { r.masks.email = 0; }, r => { r.meta_sha256 = 'b'.repeat(64); }]) {
    const { d, sha } = freshGate();
    const p = join(d, 'gates', 'g1.json');
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    edit(rec);
    writeFileSync(p, JSON.stringify(rec));
    assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 1) }).reason, 'gate_record_mismatch', String(edit));
    assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).code, 'gate_record_mismatch');
  }
});

test('review M2: requestGate refuses metadata it could not show honestly', () => {
  const { d } = freshGate();
  const base = { kind: 'advice', textPath: 'advice-brief.md' };
  assert.equal(requestGate(d, { ...base, price: { ceiling_usd: '5' } }).code, 'bad_price');
  assert.equal(requestGate(d, { ...base, price: { ceiling_usd: -1 } }).code, 'bad_price');
  assert.equal(requestGate(d, { ...base, price: { ceiling_usd: 1, note: 'x' } }).code, 'bad_price');
  assert.equal(requestGate(d, { ...base, seats: 'openai' }).code, 'bad_seats');
  assert.equal(requestGate(d, { ...base, seats: [{ lab: { nested: 1 } }] }).code, 'bad_seats');
  assert.equal(requestGate(d, { ...base, seats: [{ lab: 'x'.repeat(301) }] }).code, 'bad_seats');
  assert.equal(requestGate(d, { ...base, sensitivity: 'public' }).code, 'bad_sensitivity');
  assert.equal(requestGate(d, { ...base, masks: { email: 1.5 } }).code, 'bad_masks');
  assert.equal(requestGate(d, { ...base, masks: { 'E-Mail': 1 } }).code, 'bad_masks');
  assert.equal(readLedger(d).lines.length, 1, 'refusals append nothing');
});

test('review M4: an approval is usable until the gate expires and until a send names it; the status stays approved', () => {
  const { d, sha } = freshGate();
  answerGate(d, 'g1', person(sha), { now: at(T0 + 1) });
  const fresh = readGateAnswer(d, 'g1', { now: at(T0 + 2) });
  assert.equal(fresh.status, 'approved');
  assert.equal(fresh.usable, true);
  assert.equal(fresh.used, false);
  assert.equal(fresh.usable_until, new Date(T0 + GATE_TTL_MS).toISOString());
  const late = readGateAnswer(d, 'g1', { now: at(T0 + GATE_TTL_MS) });
  assert.equal(late.status, 'approved');
  assert.equal(late.usable, false, 'thirty days later is not "approved, unexpired"');
  appendEvent(d, 'sent', { gate: 'g1' });
  const sent = readGateAnswer(d, 'g1', { now: at(T0 + 3) });
  assert.equal(sent.used, true);
  assert.equal(sent.usable, false, 'one approval, one send');
});

test('review low: a decline needs only the shown hash; the text changing on disk does not block a person saying no', () => {
  const { d, sha } = freshGate();
  writeFileSync(join(d, 'advice-brief.md'), 'changed\n');
  assert.equal(answerGate(d, 'g1', person(sha), { now: at(T0 + 1) }).code, 'hash_mismatch', 'an approval still needs the bytes to match');
  assert.equal(answerGate(d, 'g1', person('0'.repeat(64), 'declined'), { now: at(T0 + 1) }).code, 'hash_mismatch', 'a decline of some other text is refused');
  assert.equal(answerGate(d, 'g1', person(sha, 'declined'), { now: at(T0 + 1) }).status, 'declined');
});

test('review low: a link inside the run folder to a file outside it is refused; a forged ../ text is never read', () => {
  const { d, sha } = freshGate();
  const outside = join(mkdtempSync(join(tmpdir(), 'gate-outside-')), 'secret.md');
  writeFileSync(outside, 'outside the run\n');
  symlinkSync(outside, join(d, 'link.md'));
  assert.equal(requestGate(d, { kind: 'advice', textPath: 'link.md' }).code, 'text_unreadable');
  assert.equal(readGateText(d, 'link.md'), null);
  assert.equal(readGateText(d, '../x.md'), null);
  // an approved gate whose text is swapped for a link afterwards is not approved any more
  answerGate(d, 'g1', person(sha), { now: at(T0 + 1) });
  renameSync(join(d, 'advice-brief.md'), join(d, 'moved.md'));
  writeFileSync(outside, BRIEF);
  symlinkSync(outside, join(d, 'advice-brief.md'));
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 2) }).reason, 'hash_mismatch');
});

test('review low: file errors become refusals, and a view that cannot be rewritten after the ledger line is a warning, not a lost answer', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const { d, sha } = freshGate();
  chmodSync(join(d, 'gates'), 0o555);
  try {
    const r = answerGate(d, 'g1', person(sha), { now: at(T0 + 1) });
    assert.equal(r.ok, true);
    assert.match(r.warning, /recorded in the ledger/);
  } finally { chmodSync(join(d, 'gates'), 0o755); }
  assert.equal(readGateAnswer(d, 'g1', { now: at(T0 + 2) }).status, 'approved', 'the ledger holds it; the lagging view reads correctly');
  // a directory where the ledger should be: a refusal, not a stack trace
  const e = mkdtempSync(join(tmpdir(), 'gate-io-'));
  writeFileSync(join(e, 'a.md'), 'a\n');
  mkdirSync(join(e, LEDGER_FILE));
  assert.equal(requestGate(e, { kind: 'advice', textPath: 'a.md' }).code, 'gate_ledger_corrupt');
});

test('review M3: gate show prints no escape sequence from the gate file and counts invisible characters in the text', () => {
  const { d } = freshGate(`Visible.​\u{E0041}\u{E0042}\n`, { seats: [{ lab: 'open\u001b]0;pwned\u0007ai', retention: '\u001b[8mhidden' }], expiresAt: Date.now() + 60_000 });
  const s = spawnSync(process.execPath, [cli, 'gate', 'show', d, 'g1'], { encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr);
  assert.doesNotMatch(s.stdout, /\u001b|\u0007/);
  assert.match(s.stdout, /holds 3 invisible character/);
});

test('review low: an unknown or misspelt option is refused before anything happens', () => {
  const { d } = freshGate(BRIEF, { expiresAt: Date.now() + 60_000 });
  const before = ledger(d);
  for (const args of [['answer', d, 'g1', '--declin'], ['answer', d, 'g1', '--yes'], ['show', d, 'g1', '--decline'], ['verify', d, 'extra']]) {
    const r = spawnSync(process.execPath, [cli, 'gate', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
  }
  assert.ok(ledger(d).equals(before));
});

test('metadata with an undefined key (a quote without an expected price) hashes as written: the gate stays answerable', () => {
  const { d } = freshGate();
  writeFileSync(join(d, 'b.md'), 'b\n');
  const r = requestGate(d, { kind: 'advice', textPath: 'b.md', price: { ceiling_usd: 1, expected_usd: undefined }, seats: [{ lab: 'openai', model: undefined }] }, { now: at(T0) });
  assert.equal(r.ok, true);
  assert.equal(readGateAnswer(d, 'g2', { now: at(T0 + 1) }).status, 'pending');
  assert.equal(answerGate(d, 'g2', person(textSha256(Buffer.from('b\n'))), { now: at(T0 + 1) }).ok, true);
});
