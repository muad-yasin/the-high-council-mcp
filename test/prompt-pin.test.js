// Call pin (0.7.8; reduced 12 Nov 2026). Each mock chain below runs through the real CLI with a loader hook that wraps src/providers.js's call() and writes down every call it is handed; the run's number of calls and its exit code are compared with the values recorded at 0d87668.
// CHANGED ACCEPTED (0.8.4 apply, batch 1; his 12 Nov 2026 word: "I don't see why we would need a test that pins wording. That is not a test, that is bloat."; his 8:a: the wording tests that still pass go before the PR). OLD: this file also compared the sha256 of the lot of prompts (and of the wording files, src/roles.js with src/prompts/) with a recorded value: ROLES_SHA256 (one test) and `sha` per chain. Red on 0b9d5275 (printed, jobs 159 and 163): the roles.js sha and all eleven chain shas. NEW: no hash is compared; what stays is behaviour, the calls each mock chain makes and the exit it ends with. WHY: a recorded hash is a wording pin. The history of earlier re-records of those hashes is in git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Recorded at 0d87668. `status` is the CLI's exit code (mock-security-review's mock reviewer blocks: 7). 0.8.3 exit 22: mock-dispute, mock-patch and mock-partitioned finish with their mock panel NOT agreed, which now exits 22 instead of 0 (calls unchanged).
// mock-relay is left out: its panel order comes from Math.random (bug audit 2026-09-26 #2) and a relay
// reviewer sees the reviews before it, so its prompts differ from run to run.
const PINNED = {
  'mock': { calls: 6, status: 0 },
  'mock-debate': { calls: 15, status: 0 },
  'mock-unanimous': { calls: 8, status: 0 },
  'mock-proposals': { calls: 16, status: 0 },
  'mock-questions': { calls: 16, status: 0 },
  'mock-dispute': { calls: 12, status: 22 },
  'mock-criteria-kinds': { calls: 6, status: 0 },
  'mock-open': { calls: 15, status: 0 },
  'mock-patch': { calls: 7, status: 22 },
  'mock-security-review': { calls: 5, status: 7 },
  'mock-partitioned': { calls: 6, status: 22 },
};
const TASK = 'Plan a small command-line tool that renames photos by the date they were taken.\n';

test('every mock chain makes the calls it made and ends with the exit it had', () => {
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
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(register).href, '--import', pathToFileURL(join(repo, 'test/helpers/fixed-envelope-id-preload.js')).href, join(repo, 'src/cli.js'), '--chain', chain, '--task', 'task.md', '--allow-unfenced'],
        { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, THC_PROMPT_LOG: log }, timeout: 60_000 });
      const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      got[chain] = { calls: lines.length, status: r.status };
    }
    assert.deepEqual(got, PINNED, 'a mock chain now makes a different number of calls or ends with a different exit');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
