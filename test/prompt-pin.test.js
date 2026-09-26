// Prompt pin (0.7.8). The owner's rule for 0.7.8: no prompt changes. Two live case studies run
// against the prompts as they were at 0d87668 (0.7.7 + the http-server fix), so nothing in
// src/roles.js, and no other text a seat receives, may change without his decision.
//
// A prompt cannot be tested by running it (the mock provider ignores prompt text), but it can be
// recorded. Each mock chain below runs through the real CLI with a loader hook that wraps
// src/providers.js's call() and writes down every system prompt and message it is handed. Run
// folders and temp paths are normalised out and the calls sorted (panel seats run in parallel, and
// the relay panel's order is random), and the sha256 of the lot is compared with the value recorded
// at 0d87668. src/roles.js is pinned byte for byte as well.
//
// A mismatch means a seat now receives different text. If that is intended, it needs the owner's
// go first; then re-record the values here (the failure message prints the new ones) and say so in
// the CHANGELOG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = s => createHash('sha256').update(s).digest('hex');

const ROLES_SHA256 = '97f8c508a0cf1052d9f56ebffc1bfe74475699f8b081229705db690bd76d5953';
// Recorded at 0d87668. `status` is the CLI's exit code (mock-security-review's mock reviewer blocks: 7).
// mock-relay is left out: its panel order comes from Math.random (bug audit 2026-09-26 #2) and a relay
// reviewer sees the reviews before it, so its prompts differ from run to run.
const PINNED = {
  'mock': { calls: 6, status: 0, sha: '520ad3092871a1d4' },
  'mock-debate': { calls: 15, status: 0, sha: '6b07fd64d5524b7f' },
  'mock-unanimous': { calls: 8, status: 0, sha: 'bed869a2e353c06f' },
  'mock-proposals': { calls: 16, status: 0, sha: 'a17518831726993a' },
  'mock-questions': { calls: 16, status: 0, sha: '626b10b8e5769823' },
  'mock-dispute': { calls: 12, status: 0, sha: '238059db706e3883' },
  'mock-criteria-kinds': { calls: 6, status: 0, sha: '10fbc27214ea3fcf' },
  'mock-open': { calls: 15, status: 0, sha: '803252bcad7ff0f3' },
  'mock-patch': { calls: 7, status: 0, sha: 'a2910b3051f24b82' },
  'mock-security-review': { calls: 5, status: 7, sha: 'f1d0c3db8716d5ef' },
  'mock-partitioned': { calls: 6, status: 0, sha: 'c7cff1d1987e1d38' }
};
const TASK = 'Plan a small command-line tool that renames photos by the date they were taken.\n';

test('src/roles.js is byte-identical to 0.7.7 + 0d87668', () => {
  assert.equal(sha256(readFileSync(join(repo, 'src/roles.js'))), ROLES_SHA256,
    'src/roles.js changed: no prompt changes without the owner\'s go (see the comment at the top of this file)');
});

test('every prompt a mock chain sends is unchanged', () => {
  const real = pathToFileURL(join(repo, 'src/providers.js')).href;
  const work = mkdtempSync(join(tmpdir(), 'thc-prompt-pin-'));
  try {
    const wrap = pathToFileURL(join(work, 'providers-wrap.mjs')).href;
    writeFileSync(join(work, 'providers-wrap.mjs'), [
      "import { appendFileSync } from 'node:fs';",
      `import { call as realCall } from ${JSON.stringify(`${real}?real`)};`,
      `export * from ${JSON.stringify(`${real}?real`)};`,
      'export async function call(provider, opts) {',
      '  appendFileSync(process.env.THC_PROMPT_LOG, JSON.stringify({ provider, model: opts.model, system: opts.system, messages: opts.messages }) + "\\n");',
      '  return realCall(provider, opts);',
      '}',
    ].join('\n'));
    writeFileSync(join(work, 'hooks.mjs'), [
      'export async function resolve(spec, ctx, next) {',
      '  const r = await next(spec, ctx);',
      `  return r.url === ${JSON.stringify(real)} ? { ...r, url: ${JSON.stringify(wrap)} } : r;`,
      '}',
    ].join('\n'));
    const register = join(work, 'register.mjs');
    writeFileSync(register, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(work, 'hooks.mjs')).href)});\n`);

    const got = {};
    for (const chain of Object.keys(PINNED)) {
      const dir = join(work, chain);
      mkdirSync(join(dir, 'chains'), { recursive: true });
      copyFileSync(join(repo, 'chains', `${chain}.json`), join(dir, 'chains', `${chain}.json`));
      writeFileSync(join(dir, 'task.md'), TASK);
      const log = join(dir, 'prompts.jsonl');
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(register).href, join(repo, 'src/cli.js'), '--chain', chain, '--task', 'task.md', '--allow-unfenced'],
        { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, THC_PROMPT_LOG: log }, timeout: 60_000 });
      const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      const norm = lines.map(l => l.split(dir).join('<DIR>').replace(/\d{4}-\d\d-\d\dT\d\d[:-]\d\d[:-]\d\d[.-]\d{3}Z/g, '<TS>')).sort();
      got[chain] = { calls: lines.length, status: r.status, sha: sha256(norm.join('\n')).slice(0, 16) };
    }
    assert.deepEqual(got, PINNED, 'a seat now receives different text - no prompt changes without the owner\'s go');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
