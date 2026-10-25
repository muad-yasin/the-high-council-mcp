// The suite must cost $0 (13 Oct 2026, Haiku batch 4 A7 #1, C&C's class-wide fix; CLAUDE.md: mock chains need no keys). A test that STARTS a run (a CLI child with --chain, or start_run / resume_run over MCP) on a shipped chain with
// a real provider seat can make a paid call the moment a key is reachable: the child falls back to the checkout's own .env (src/cli.js applies `[cwd/.env, package/.env]`), so `npm test` on a clone set up per the README can be billed.
// v0.8.2 shipped such a start (test/mcp-bundle-host.test.js, the placeholder test). This scanner reads every test file and refuses such a start. WHAT IT SCANS: (a) MCP tool calls `name: 'start_run' | 'resume_run'` with `chain: '<name>'`;
// (b) CLI children `'--chain', '<name>'` (an argument list) and `--chain <name>` in a command string. A chain is REAL when any of its seats has a provider other than mock, external or ollama (those are priced at $0: needsPrice, src/cost.js).
// ALLOWED: a start with `dry-run` in the same call (it prices and calls nothing); lint, doctor and price-only uses never start a run, so they do not match; a line (or the one above) carrying `// zero-spend-ok: <why>` for a start that is
// provably unable to reach a key (say how). The marker needs its reason on the same line: a bare `zero-spend-ok:` is itself a hit (C&C, 14 Oct 2026: it was a free bypass). A file with a marker must also use test/helpers/no-real-keys.js
// (malformed provider keys: never filled from .env, never sent), in one of its TWO forms and with NO exemption: `malformedProviderKeys()` for a child process's env, `withMalformedKeysInProcess(fn)` for code that runs in this process
// (C&C, 14 Oct 2026: an in-process fixture is the class this exists for, because in-process code reads keys from process.env). A test that runs an advice session for real (`COUNCIL_ADVISE_MOCK` set to '0') must use the helper too.
// WHAT IT DOES NOT SEE: a chain built inline in the test (those use mock providers); a chain name held in a variable; and the helper check is FILE-LEVEL (C&C accepted it as a recorded limit, 14 Oct 2026): one use of the helper anywhere in a
// file satisfies the rule for the whole file, so a second child process in that file that forgets it is not caught; a server entry passed into a helper whose spawn line only says `entry` (as in `boot({ entry: [server] })`) and a start built by pushing `'--mcp'` into an array later; a COMMENT containing `COUNCIL_ADVISE_MOCK: '1'` satisfies the server-start rule (the same text match as everywhere else); and an in-process answer that reaches no provider call at all (src/gate-cli.js `answerAtTerminal` only writes the ledger) is outside the helper's reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerNames, envKeyName, isFreeProvider } from '../src/providers.js';
import { keyEnvValue, keyProblem } from '../src/key-env.js';
import { applyEnvFile } from '../src/env-file.js';
import { malformedProviderKeys, withMalformedKeysInProcess } from './helpers/no-real-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FREE = new Set(['mock', 'external', 'ollama']);
const REASONED = /zero-spend-ok:\s*\S/;

// 0.8.3 (lane B): the retired chains in chains/outdated/ count as real too: a test that copies one into a temp project and starts it would spend, so the scan reads both folders.
export function realChains(chainsDir = join(root, 'chains')) {
  const out = new Set();
  const dirs = [chainsDir, join(chainsDir, 'outdated')].filter(existsSync);
  for (const [dir, f] of dirs.flatMap(d => readdirSync(d).filter(n => n.endsWith('.json')).map(n => [d, n]))) {
    let c; try { c = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    let real = false;
    (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.provider === 'string' && !FREE.has(o.provider)) real = true; Object.values(o).forEach(walk); } })(c.seats ?? c);
    if (real) out.add(f.slice(0, -5));
  }
  return out;
}

/** [{ line, chain, how }] for every start of a run on a chain in `real` that is not a dry run and not marked zero-spend-ok. */
export function paidStarts(text, real) {
  const lines = text.split('\n'); const found = [];
  const lineOf = idx => text.slice(0, idx).split('\n').length;
  const marked = n => REASONED.test(lines[n - 1] ?? '') || REASONED.test(lines[n - 2] ?? '');
  // The pricing allowance is the match's OWN line (a dry run on a neighbouring line must not hide a real start): `dry-run`, `forecast-cost` or the dry() helper on that line makes it a pricing call. A CLI form must also sit next to a
  // process start (spawn, exec, a run helper) within a few lines: a README assertion or a message that merely names a command is not a start.
  const lineText = idx => lines[lineOf(idx) - 1] ?? '';
  const around = (idx, len) => text.slice(Math.max(0, idx - 220), idx + len + 220);
  const add = (idx, len, chain, how, needsSpawn) => {
    if (!real.has(chain)) return;
    if (/dry-run|forecast-cost|\bdry\(/.test(lineText(idx))) return;
    if (needsSpawn && !/spawn|exec|child_process|\brun\w*\(/i.test(around(idx, len))) return;
    const line = lineOf(idx); if (!marked(line)) found.push({ line, chain, how });
  };
  for (const m of text.matchAll(/name:\s*'start_run'[^\n]{0,200}?chain:\s*'([^']+)'/g)) add(m.index, m[0].length, m[1], 'start_run', false);
  // A RESUME takes its chain from the saved run.json (`resume_run { run }`, submit_stage's own resume, CLI `--resume`), so a resumed real chain is a real chain written into a run.json in a file that resumes.
  if (/resume_run|submit_stage|'--resume'/.test(text)) for (const m of text.matchAll(/run\.json[\s\S]{0,260}?chain:\s*'([^']+)'/g)) add(m.index, m[0].length, m[1], 'run.json for a resume', false);
  for (const m of text.matchAll(/'--chain',\s*'([^']+)'/g)) add(m.index, m[0].length, m[1], 'cli --chain', true);
  for (const m of text.matchAll(/--chain[ =]([a-z0-9][a-z0-9-]*)/g)) add(m.index, m[0].length, m[1], 'cli --chain (string)', true);
  return found;
}

/** Line numbers of a `zero-spend-ok:` marker with nothing after the colon. */
export function bareMarkers(text) {
  return text.split('\n').flatMap((l, i) => (/zero-spend-ok:/.test(l) && !REASONED.test(l) ? [i + 1] : []));
}

const HELPER = /malformedProviderKeys|withMalformedKeysInProcess/;
const MOCK_ON = /COUNCIL_ADVISE_MOCK['"]?\s*(:|=)\s*['"]?1\b/;
// A test line that STARTS the MCP server: `'--mcp'` as an argv element (`[cli, '--mcp']`, `[['--mcp'], ...]`), or a spawn of the server entry itself (`[server]`, `[join(root, ...server.args...`).
const ARGV_START = /[\[,]\s*['"`]--mcp['"`]\s*[\],]/;                                                  // `'--mcp'` as an argv element, any quote style
const COMMAND_START = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\w*\([^\n]*(--mcp\b|run mcp\b)/;       // a command string: `council --mcp`, `npm run mcp`
const INLINE_ENTRY = /\b(spawn|spawnSync|execFile|execFileSync)\w*\([^\n]*mcp['"`\/,\s]+server\.js/;              // the entry written inline: [join(root, 'src', 'mcp', 'server.js')] or 'src/mcp/server.js'
const MCP_ENTRY_VARIABLE = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^\n]*\bmcp\b[^\n]*server\.js/g;             // a variable (whatever its name) holding the MCP server's entry, not src/ui/server.js
/** Line numbers of a reasoned marker in a file that never uses either form of the malformed-keys helper. No exemption: the reason text cannot excuse it (file-level, see the header). */
export function markersWithoutKeys(text) {
  if (HELPER.test(text)) return [];
  return text.split('\n').flatMap((l, i) => (REASONED.test(l) ? [i + 1] : []));
}
/**
 * Line numbers where a test starts the MCP server in a file that neither sets `COUNCIL_ADVISE_MOCK` to '1' nor uses either form of the helper (C&C, 14 Oct 2026: an UNSET variable is real mode by design, so a server a test starts must not be
 * able to reach a usable key, WHATEVER the file does: first built for files that approve a gate, widened the same day to every server start, fail closed). File-level, like the rest. There is no gate-approval pattern list any more
 * (so the `elicit` word C&C asked for has nothing to join: the count and the rule match because the rule has no condition beyond the server start).
 */
export function mcpServerWithoutMockOrKeys(text) {
  if (HELPER.test(text) || MOCK_ON.test(text)) return [];
  const names = [...text.matchAll(MCP_ENTRY_VARIABLE)].map(m => m[1]);
  const viaVariable = names.length || /server\.args/.test(text)
    ? new RegExp(`\\b(spawn|spawnSync)\\w*\\([^\\n]*\\[\\s*(${[...names, 'join\\(root,\\s*\\.\\.\\.server\\.args'].join('|')})`) : null;
  return text.split('\n').flatMap((l, i) => (ARGV_START.test(l) || COMMAND_START.test(l) || INLINE_ENTRY.test(l) || (viaVariable && viaVariable.test(l)) ? [i + 1] : []));
}
/** Line numbers where a real-mode advice session is switched on (`COUNCIL_ADVISE_MOCK` set to '0') in a file that never uses either form of the helper. */
export function mockOffWithoutKeys(text) {
  if (HELPER.test(text)) return [];
  return text.split('\n').flatMap((l, i) => (/COUNCIL_ADVISE_MOCK['"]?\s*(:|=)\s*['"]?0\b/.test(l) ? [i + 1] : []));
}

test('no test starts a run on a shipped chain with a real provider seat (the suite costs $0 whatever keys are reachable)', () => {
  const real = realChains();
  assert.ok(real.size >= 10 && real.has('plan-high-council') && !real.has('mock') && !real.has('mock-budget'), `the classification reads the shipped chains (${real.size} real)`);
  const hits = [];
  for (const f of readdirSync(join(root, 'test')).filter(n => n.endsWith('.test.js') && n !== 'no-paid-chain-spawn.test.js')) {
    const text = readFileSync(join(root, 'test', f), 'utf8');
    for (const h of paidStarts(text, real)) hits.push(`test/${f}:${h.line} ${h.how} on "${h.chain}"`);
    for (const n of bareMarkers(text)) hits.push(`test/${f}:${n} a zero-spend-ok marker with no reason`);
    for (const n of markersWithoutKeys(text)) hits.push(`test/${f}:${n} a zero-spend-ok marker in a file that never uses malformedProviderKeys() or withMalformedKeysInProcess() (test/helpers/no-real-keys.js)`);
    for (const n of mcpServerWithoutMockOrKeys(text)) hits.push(`test/${f}:${n} an MCP server started with COUNCIL_ADVISE_MOCK unset (real mode), in a file that uses no malformed-keys helper (test/helpers/no-real-keys.js)`);
    for (const n of mockOffWithoutKeys(text)) hits.push(`test/${f}:${n} a real-mode advice session (COUNCIL_ADVISE_MOCK 0) in a file that never uses the malformed-keys helper (test/helpers/no-real-keys.js)`);
  }
  assert.deepEqual(hits, [], `${hits.join('; ')}\n` + 'a test that starts a run on a real chain can bill a user whose clone holds a key: use a mock chain, or prove no key is reachable and mark the line `// zero-spend-ok: <why>` (a reason is required, and the file uses the malformed-keys helper in one of its two forms)');
});

test('the scanner flags a start on a real chain and lets a dry run, a mock chain and a REASONED marked line through; a bare marker is a hit, and a marked file (or a real-mode advice session) must use the malformed-keys helper, with no in-process exemption', () => {
  const real = new Set(['single-vendor-openai']);
  assert.equal(paidStarts("{ name: 'start_run', arguments: { chain: 'single-vendor-openai', task: 't' } }", real).length, 1, 'start_run on a real chain');
  assert.equal(paidStarts("spawnSync(node, [cli, '--task', 't.md', '--chain', 'single-vendor-openai'])", real).length, 1, 'a CLI child on a real chain');
  assert.equal(paidStarts('run(`node cli.js --chain single-vendor-openai --task t.md`)', real).length, 1, 'a command string');
  assert.equal(paidStarts("spawnSync('node', [cli, '--forecast-cost', '--chain', 'single-vendor-openai'])", real).length, 0, 'a price-only forecast');
  assert.equal(paidStarts("const r = dry(['--chain', 'single-vendor-openai']);", real).length, 0, 'the dry() helper');
  assert.equal(paidStarts("assert.ok(readme.includes(`--chain single-vendor-openai --max-usd 1`));", real).length, 0, 'a README assertion that only names the command');
  assert.equal(paidStarts("writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'single-vendor-openai' }));\nawait call('resume_run', { run: id });", real).length, 1, 'a run.json for a resume');
  assert.equal(paidStarts("writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'single-vendor-openai' }));\nconst read = readRun(dir);", real).length, 0, 'a run.json in a file that never resumes');
  assert.equal(paidStarts("const a = ['--dry-run'];\nspawnSync('node', [cli, '--task', 't', '--chain', 'single-vendor-openai']);", real).length, 1, 'a dry run on the line above does not hide a real start');
  assert.equal(paidStarts("spawnSync(node, [cli, '--chain', 'single-vendor-openai', '--dry-run'])", real).length, 0, 'a dry run');
  assert.equal(paidStarts("{ name: 'start_run', arguments: { chain: 'mock', task: 't' } }", real).length, 0, 'a mock chain');
  assert.equal(paidStarts("// zero-spend-ok: a keyless clone\n{ name: 'start_run', arguments: { chain: 'single-vendor-openai' } }", real).length, 0, 'a marked line');
  // C&C, 14 Oct 2026: the marker needs its reason (a bare one was a free bypass), and a marked file must give its children the malformed keys (test/helpers/no-real-keys.js) unless the fixture is in-process.
  const start = "{ name: 'start_run', arguments: { chain: 'single-vendor-openai' } }";
  assert.equal(paidStarts(`// zero-spend-ok:\n${start}`, real).length, 1, 'a bare marker does not excuse the start');
  assert.equal(paidStarts(`// zero-spend-ok:   \n${start}`, real).length, 1, 'a marker followed only by spaces does not either');
  assert.deepEqual(bareMarkers(`a\n// zero-spend-ok:\nb\n// zero-spend-ok:   \n// zero-spend-ok: a keyless clone`), [2, 4], 'both bare markers are named by line');
  assert.deepEqual(markersWithoutKeys('// zero-spend-ok: a keyless clone\nspawn(node)'), [1], 'a reasoned marker in a file with no helper');
  assert.deepEqual(markersWithoutKeys('// zero-spend-ok: a keyless clone\nenv: { ...malformedProviderKeys() }'), [], 'with the helper');
  assert.deepEqual(markersWithoutKeys('// zero-spend-ok: in-process, spawns nothing'), [1], 'an in-process fixture is NOT exempt any more (C&C, 14 Oct 2026): its reason text cannot excuse it');
  assert.deepEqual(markersWithoutKeys('// zero-spend-ok: runs here\nwithMalformedKeysInProcess(() => run())'), [], 'the in-process form satisfies the rule');
  assert.deepEqual(mockOffWithoutKeys("env: { COUNCIL_ADVISE_MOCK: '0' }"), [1], 'a real-mode advice session with no helper');
  assert.deepEqual(mockOffWithoutKeys("mcpSession(dir, { COUNCIL_ADVISE_MOCK: '0', ...malformedProviderKeys() })"), [], 'with the child-env form');
  assert.deepEqual(mockOffWithoutKeys("COUNCIL_ADVISE_MOCK: '1'"), [], 'the mock form is not real mode');
  // C&C, 14 Oct 2026: an UNSET variable is real mode; a test that STARTS the server must set it to '1' or carry a helper form, whatever else the file does (widened the same day from "files that approve a gate").
  const SERVER = "const child = spawn(process.execPath, [cli, '--mcp'], { cwd });";
  assert.deepEqual(mcpServerWithoutMockOrKeys(SERVER), [1], 'a real-mode server start');
  assert.deepEqual(mcpServerWithoutMockOrKeys(`a\nconst args = () => [cliPath, '--mcp'];`), [2], 'a start through a helper (the argv element alone is enough)');
  assert.deepEqual(mcpServerWithoutMockOrKeys("for (const [args, dotenv] of [[['--mcp'], 'X=1']]) run(args);"), [1], 'an argv array passed to a runner');
  assert.deepEqual(mcpServerWithoutMockOrKeys('spawn(process.execPath, [cli, "--mcp"], { cwd });'), [1], 'double quotes');
  assert.deepEqual(mcpServerWithoutMockOrKeys('spawn(process.execPath, [cli, `--mcp`], { cwd });'), [1], 'a template literal');
  assert.deepEqual(mcpServerWithoutMockOrKeys("execSync('node src/cli.js --mcp < in.json');"), [1], 'a command string');
  assert.deepEqual(mcpServerWithoutMockOrKeys("execSync('npm run mcp');"), [1], 'npm run mcp');
  assert.deepEqual(mcpServerWithoutMockOrKeys("const server = join(root, 'src', 'mcp', 'server.js');\nconst r = spawnSync(process.execPath, [server], { cwd });"), [2], 'the direct entry in a variable named server');
  assert.deepEqual(mcpServerWithoutMockOrKeys("const entry = join(root, 'src/mcp/server.js');\nconst r = spawn(process.execPath, [entry], { cwd });"), [2], 'the direct entry in a variable of any name');
  assert.deepEqual(mcpServerWithoutMockOrKeys("const r = spawnSync(process.execPath, [join(root, 'src', 'mcp', 'server.js')], { cwd });"), [1], 'the direct entry written inline');
  assert.deepEqual(mcpServerWithoutMockOrKeys("const server = resolve(here, '../src/ui/server.js');\nconst c = spawn(process.execPath, [server], { env });"), [], 'the UI host server is not the MCP server');
  assert.deepEqual(mcpServerWithoutMockOrKeys("const c = spawn(process.execPath, [join(root, ...server.args[0].split('/'))], { cwd });"), [1], 'the direct entry of a bundle manifest');
  assert.deepEqual(mcpServerWithoutMockOrKeys(`${SERVER} // COUNCIL_ADVISE_MOCK: '1'`), [], 'the mock mode is set');
  assert.deepEqual(mcpServerWithoutMockOrKeys(`${SERVER}\nenv: { ...malformedProviderKeys() }`), [], 'a helper form');
  assert.deepEqual(mcpServerWithoutMockOrKeys("assert.deepEqual(npm.packageArguments, [{ type: 'positional', value: '--mcp' }]);"), [], 'a manifest assertion is not a start');
  assert.deepEqual(mcpServerWithoutMockOrKeys("// the docs say run `council --mcp` to serve"), [], 'prose naming the flag is not a start');
});

test('the malformed-keys helper: every paid provider key is present and unusable, so a .env cannot fill it and nothing is sent (control: an EMPTY value is filled from the .env)', () => {
  const keys = malformedProviderKeys();
  const names = providerNames().filter(p => !isFreeProvider(p)).map(envKeyName);
  assert.deepEqual(Object.keys(keys).sort(), [...names].sort(), 'one key per paid provider, named from src/providers.js');
  assert.ok(names.includes('ANTHROPIC_API_KEY') && names.includes('OPENROUTER_API_KEY') && !names.includes('OLLAMA_API_KEY'));
  const dotenv = names.map(n => `${n}=a-key-from-the-checkout-dot-env`).join('\n');
  const env = { ...keys }; applyEnvFile(dotenv, env);
  for (const n of names) {
    assert.equal(keyEnvValue(n, env), null, `${n}: no usable key reaches a provider`);
    assert.equal(keyProblem(n, env), 'malformed', `${n}: it is present and malformed, so the .env value was not filled in`);
  }
  const control = Object.fromEntries(names.map(n => [n, ''])); applyEnvFile(dotenv, control);
  assert.equal(keyEnvValue('OPENAI_API_KEY', control), 'a-key-from-the-checkout-dot-env', 'control: an empty value is filled from the .env (this is the leak the helper closes)');
});

test('the in-process form: every paid provider key is the malformed value inside the call (sync, async and a throw), nothing usable reaches a provider, and each earlier value, or its absence, is restored after', async () => {
  const names = providerNames().filter(p => !isFreeProvider(p)).map(envKeyName);
  const sentinel = names[0]; const saved = process.env[sentinel]; process.env[sentinel] = 'prior-value';   // one name already set, the others as the machine has them
  const was = Object.fromEntries(names.map(n => [n, process.env[n]]));
  try {
    const inside = () => Object.fromEntries(names.map(n => [n, { value: keyEnvValue(n, process.env), problem: keyProblem(n, process.env) }]));
    assert.deepEqual([keyEnvValue(sentinel, process.env), keyProblem(sentinel, process.env)], ['prior-value', null], 'control: OUTSIDE the wrapped call the sentinel is a usable key, so "unusable inside" is not true of every read');
    const sync = withMalformedKeysInProcess(inside);
    for (const n of names) assert.deepEqual(sync[n], { value: null, problem: 'malformed' }, `${n}: unusable inside the call`);
    const asyncSeen = await withMalformedKeysInProcess(async () => { await Promise.resolve(); return inside(); });
    for (const n of names) assert.deepEqual(asyncSeen[n], { value: null, problem: 'malformed' }, `${n}: unusable inside an async call`);
    assert.throws(() => withMalformedKeysInProcess(() => { throw new Error('boom'); }), /boom/);
    await assert.rejects(withMalformedKeysInProcess(async () => { throw new Error('later'); }), /later/);
    for (const n of names) assert.equal(process.env[n], was[n], `${n}: the earlier value (or its absence) is back after a return, a resolve and both throws`);
    assert.equal(process.env[sentinel], 'prior-value');
  } finally { if (saved === undefined) delete process.env[sentinel]; else process.env[sentinel] = saved; }
});

