// 0.7.9 (owner decision via C&C, 2026-09-28): the outbound key scan, on by default. Every prompt is
// checked against src/secret-patterns.js before it leaves - in invoke() for every provider call and
// every external seat's NEEDS file, and up front over the input files so the refusal names the file
// and line. `--allow-secret-shaped` (saved in run.json; MCP start_run `allow_secret_shaped`) is the
// one override. The scan reads and never rewrites, so a clean run's prompts are byte-identical.
//
// Fixtures are assembled at runtime from a repeating filler, as in test/secret-patterns.test.js, so
// no string in this file looks like a real key. All offline, mock seats, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setOutboundScan } from '../src/chain.js';
import { secretShapesIn, SecretShapedPrompt, assertOutboundClean } from '../src/outbound-scan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

const fill = (n, set = 'aZ3kQ9xB') => Array.from({ length: n }, (_, i) => set[i % set.length]).join('');
const hex = n => fill(n, '0a1b2c3d4e5f6789');
const j = (...parts) => parts.join('');

// The same formats as test/secret-patterns.test.js: [name, text, the part that must never be printed].
const FORMATS = [
  ['OpenRouter', j('OPENROUTER_API_KEY=', 'sk', '-or-v1-', hex(64)), hex(64)],
  ['OpenAI', j('sk', '-', fill(48)), fill(48)],
  ['OpenAI project', j('sk', '-proj-', fill(40)), fill(40)],
  ['Anthropic', j('sk', '-ant-api03-', fill(40)), fill(40)],
  ['Google AI', j('AI', 'za', fill(35)), fill(35)],
  ['Groq', j('gsk', '_', fill(40)), fill(40)],
  ['Hugging Face', j('hf', '_', fill(34)), fill(34)],
  ['Together', j('TOGETHER_API_KEY=', hex(64)), hex(64)],
  ['Z.ai', j('ZAI_API_KEY=', hex(32), '.', fill(16)), fill(16)],
  ['Mistral', j('MISTRAL_API_KEY=', fill(32)), fill(32)],
  ['GitHub classic', j('gh', 'p_', fill(36)), fill(36)],
  ['GitHub fine-grained', j('github', '_pat_', fill(60)), fill(60)],
  ['Stripe live secret', j('sk', '_live_', fill(24)), fill(24)],
  ['Stripe restricted', j('rk', '_live_', fill(24)), fill(24)],
  ['Bearer header', j('Authorization: Bearer ', fill(40)), fill(40)],
  ['PGP private key block', j('-----BEGIN PGP ', 'PRIVATE KEY BLOCK-----\n', fill(60), '\n-----END PGP ', 'PRIVATE KEY BLOCK-----'), fill(60)],
  ['PEM private key', j('-----BEGIN ', 'PRIVATE KEY-----\n', fill(60), '\n-----END ', 'PRIVATE KEY-----'), fill(60)],
  ['URL user:pass', j('postgres://deploy:', fill(20), '@db.internal/app'), fill(20)],
  ['URL empty user', j('redis://:', fill(20), '@cache:6379'), fill(20)],
  ['camelCase AccessToken', j('AccessToken = "', fill(30), '"'), fill(30)],
  ['camelCase openAiApiKey', j('openAiApiKey: "', fill(30), '"'), fill(30)],
];

// A scratch folder with its own empty .env, so the CLI never falls back to a package-level one.
function workspace(taskText) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-outbound-'));
  writeFileSync(join(dir, '.env'), '');
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'x.md'), taskText);
  return dir;
}
const council = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });

for (const [name, text, secret] of FORMATS) {
  test(`CLI: a ${name} key in the task stops the mock chain before stage 1 (exit 11), named but never printed`, () => {
    const dir = workspace(`# Plan\n\nPlan a small app.\n${text}\n`);
    const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
    assert.equal(r.status, 11, r.stdout + r.stderr);
    assert.match(r.stderr, /OUTBOUND KEY SCAN/);
    assert.match(r.stderr, /tasks\/x\.md:4 /, 'names the file and line');
    assert.equal((r.stdout + r.stderr).includes(secret), false, 'the value is never printed');
    assert.equal(existsSync(join(dir, 'runs')), false, 'no run folder, nothing sent');
  });
}

test('CLI: --allow-secret-shaped proceeds, and is saved in run.json', () => {
  const dir = workspace(`Plan a small app.\n${FORMATS[0][1]}\n`);
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--allow-secret-shaped']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [id] = readdirSync(join(dir, 'runs'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'runs', id, 'run.json'), 'utf8')).allowSecretShaped, true);
  assert.ok(existsSync(join(dir, 'runs', id, 'report.json')));
});

test('CLI: a key in a --context document is refused with that file and line', () => {
  const dir = workspace('Plan a small app.\n');
  mkdirSync(join(dir, 'ctx'));
  writeFileSync(join(dir, 'ctx', 'notes.md'), `line one\nline two\n${FORMATS[3][1]}\n`);
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--context', 'ctx']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /ctx\/notes\.md:3 +Anthropic/);
});

test('CLI: a resume keeps --allow-secret-shaped from run.json (mock-external pauses again, not refused)', () => {
  const dir = workspace(`Plan a small app.\n${FORMATS[1][1]}\n`);
  const first = council(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md', '--allow-secret-shaped']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const [id] = readdirSync(join(dir, 'runs'));
  const again = council(dir, ['--resume', join('runs', id)]);
  assert.equal(again.status, 3, again.stdout + again.stderr);
});

test('CLI: a clean task gives byte-identical prompts with the scan on and waived', () => {
  const hashes = args => {
    const dir = workspace('# Plan\n\nPlan a small note-taking app.\n');
    const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', ...args]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [id] = readdirSync(join(dir, 'runs'));
    const run = join(dir, 'runs', id);
    return Object.fromEntries(readdirSync(run).filter(f => f.endsWith('.usage.json')).map(f => [f, JSON.parse(readFileSync(join(run, f), 'utf8')).promptHash]));
  };
  const on = hashes([]);
  const off = hashes(['--allow-secret-shaped']);
  assert.ok(Object.keys(on).length >= 3 && Object.values(on).every(Boolean), 'precondition: stages record prompt hashes');
  assert.deepEqual(on, off);
});

test('invoke(): a key in the request stops runChain at its first stage, with nothing recorded', async () => {
  let recorded = 0;
  await assert.rejects(
    runChain({ config: chain('mock'), request: `Plan it.\n${FORMATS[2][1]}`, log: () => {}, onStage: () => { recorded++; } }),
    err => err instanceof SecretShapedPrompt && err.label === 'criteria' && err.findings.length === 1
      && err.findings[0].part === 'user' && !JSON.stringify(err.findings).includes(FORMATS[2][2]),
  );
  assert.equal(recorded, 0);
});

test('invoke(): an external seat is scanned before its NEEDS prompt is handed out', async () => {
  const config = chain('mock-external');
  await assert.rejects(
    runChain({ config, request: `Plan it.\n${FORMATS[4][1]}`, log: () => {} }),
    err => err instanceof SecretShapedPrompt,
  );
});

test('invoke(): setOutboundScan({ allow: true }) waives it; clean prompts are unaffected either way', async () => {
  setOutboundScan({ allow: true });
  try {
    const r = await runChain({ config: chain('mock'), request: `Plan it.\n${FORMATS[2][1]}`, log: () => {} });
    assert.ok(r.stages.length > 0);
  } finally { setOutboundScan({ allow: false }); }
  const clean = await runChain({ config: chain('mock'), request: 'Plan it.', log: () => {} });
  assert.ok(clean.stages.length > 0);
});

test('scan: pattern name and line only; prose passwords and context-only shapes are out of scope', () => {
  const hits = secretShapesIn(`a\nb\n${FORMATS[0][1]}`);
  assert.deepEqual(hits.map(h => h.line), [3]);
  assert.equal(JSON.stringify(hits).includes(FORMATS[0][2]), false);
  assert.deepEqual(secretShapesIn('the password is hunter2, keep it together'), []);
  assert.deepEqual(secretShapesIn(`We work together. Commit ${hex(64)}.`), []);
  assert.doesNotThrow(() => assertOutboundClean('x', { system: 'const apiKey = config.apiKey;', user: 'CACHE_KEY=1' }));
});

// Verify pass 2026-09-28 F1 (C&C's split by source): generic shapes (a URL password, a named or
// env-style assignment, a Bearer header) are checked in the user's inputs before the run; prompts
// that carry model output are checked for distinctive key formats only.
const PLACEHOLDER = 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/notes\nSESSION_SECRET=change-me-in-production';

test('split: a placeholder URL in the task stops the run up front', () => {
  const dir = workspace(`Plan a small app.\n${PLACEHOLDER}\n`);
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /URL credentials|credential assignment/);
});

test('split: the same placeholder in model output (an external build answer) does not stop the run', () => {
  const dir = workspace('Plan a small app.\n');
  const first = council(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const [id] = readdirSync(join(dir, 'runs'));
  const pending = readdirSync(join(dir, 'runs', id)).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(dir, 'runs', id, `${pending}.md`), `# Plan\n\nConfig:\n\n${PLACEHOLDER}\n`);
  const again = council(dir, ['--resume', join('runs', id)]);
  assert.notEqual(again.status, 11, again.stdout + again.stderr);
  assert.equal(existsSync(join(dir, 'runs', id, 'STOPPED-secret.md')), false);
});

test('split: a distinctive key in model output still stops the run, and resume can override it', () => {
  const dir = workspace('Plan a small app.\n');
  const first = council(dir, ['--chain', 'mock-external', '--task', 'tasks/x.md']);
  assert.equal(first.status, 3, first.stdout + first.stderr);
  const [id] = readdirSync(join(dir, 'runs'));
  const run = join(dir, 'runs', id);
  const pending = readdirSync(run).find(f => f.startsWith('NEEDS-')).slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(run, `${pending}.md`), `# Plan\n\nUse ${FORMATS[3][1]} here.\n`);
  const again = council(dir, ['--resume', join('runs', id)]);
  assert.equal(again.status, 11, again.stdout + again.stderr);
  const stopped = readFileSync(join(run, 'STOPPED-secret.md'), 'utf8');
  assert.match(stopped, /Anthropic/);
  assert.equal(stopped.includes(FORMATS[3][2]), false);
  assert.match(stopped, /allow_secret_shaped: true/);
  const allowed = council(dir, ['--resume', join('runs', id), '--allow-secret-shaped']);
  assert.notEqual(allowed.status, 11, allowed.stdout + allowed.stderr);
});

test('split: assertOutboundClean skips generic shapes; secretShapesIn keeps them for inputs', () => {
  assert.doesNotThrow(() => assertOutboundClean('x', { system: '', user: PLACEHOLDER }));
  assert.ok(secretShapesIn(PLACEHOLDER).length >= 2);
  assert.throws(() => assertOutboundClean('x', { system: '', user: FORMATS[0][1] }), SecretShapedPrompt);
});

test('F4: a key in a --criteria file is refused up front, named by file and line, never echoed', () => {
  const dir = workspace('Plan a small app.\n');
  writeFileSync(join(dir, 'crit.md'), `- It names an owner.\n- It uses ${FORMATS[3][1]} nowhere.\n`);
  const r = council(dir, ['--chain', 'mock', '--task', 'tasks/x.md', '--criteria', 'crit.md']);
  assert.equal(r.status, 11, r.stdout + r.stderr);
  assert.match(r.stderr, /crit\.md:2 +Anthropic/);
  assert.equal((r.stdout + r.stderr).includes(FORMATS[3][2]), false);
  assert.equal(existsSync(join(dir, 'runs')), false);
});

test('F1(b): MCP resume_run and api.resume can pass the override', () => {
  const server = readFileSync(join(root, 'src/mcp/server.js'), 'utf8');
  assert.match(server, /allow_secret_shaped: z\.boolean\(\)\.optional\(\)[^\n]*STOPPED-secret/);
  assert.match(server, /\.\.\.\(allowSecretShaped \? \['--allow-secret-shaped'\] : \[\]\)/);
  const api = readFileSync(join(root, 'src/api.js'), 'utf8');
  assert.match(api, /export async function resume\(\{[^}]*allowSecretShaped/);
});
