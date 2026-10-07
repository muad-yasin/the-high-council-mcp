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

// Re-recorded 2026-09-26 on the owner's go ("Yes and Yes"): tiered councils (thc-research brief 13)
// ADD prompt builders to src/roles.js (deep dive, majority guard). The prompts the mock chains below
// send are unchanged - that check was not re-recorded.
// Re-recorded 2026-10-02 on the owner's go (0.8.1 MAN-1, "go"): the council advisor (thc-research brief 27)
// ADDS the advisor, debate and synthesis prompts to src/roles.js (154 lines added, none removed). No existing
// prompt changed, and the mock-chain check below was not re-recorded.
// Re-recorded 2026-10-07 on the owner's go (0.8.2): the held prompt sentences of the wiring block (P1-P13, handoff milestones, lanes, contract draft) are recorded. The mock-chain shas below changed because the judges', the criteria seat's and the final editor's prompts did.
// Re-recorded 2026-10-07 on the owner's yes (via C&C; Astra's 0.8.2 review, roadmap items 27 and 28): criticUnansweredNote (the re-ask about unanswered own objections), the writer's self-review
// opening (only for the writer's seat under "selfReview": "allowed"), the deep dive's "not a vote" wording and deepDiveVerdictLine (moved here from src/chain.js). The mock-chain shas below did not change.
const ROLES_SHA256 = '416033c24c8dafe5f6d2e889510b833391e38dd25baec52895f5561db008d846';
// Recorded at 0d87668. `status` is the CLI's exit code (mock-security-review's mock reviewer blocks: 7).
// mock-relay is left out: its panel order comes from Math.random (bug audit 2026-09-26 #2) and a relay
// reviewer sees the reviews before it, so its prompts differ from run to run.
const PINNED = {
  'mock': { calls: 6, status: 0, sha: '684270c78d106687' },
  'mock-debate': { calls: 15, status: 0, sha: 'd47c00576fa9e8fa' },
  'mock-unanimous': { calls: 8, status: 0, sha: '61db3b8d52abbdfe' },
  'mock-proposals': { calls: 16, status: 0, sha: '58481b3e65b9e703' },
  'mock-questions': { calls: 16, status: 0, sha: '50f29660123da0b1' },
  'mock-dispute': { calls: 12, status: 0, sha: '6d26755f7cb59035' },
  'mock-criteria-kinds': { calls: 6, status: 0, sha: '79ed605ce608bbf9' },
  'mock-open': { calls: 15, status: 0, sha: 'a94445bca06fffaa' },
  'mock-patch': { calls: 7, status: 0, sha: '6a707383a9dc7d6a' },
  'mock-security-review': { calls: 5, status: 7, sha: 'a9e59ab0033dd72b' },
  'mock-partitioned': { calls: 6, status: 0, sha: '398b6ed838214a40' }
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
