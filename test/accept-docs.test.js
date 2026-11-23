// 0.8.4 D2 (UNIT 3): the acceptance is documented where a person and an agent look, and it adds no MCP tool (a step on stop_decide). Source-text pins, in the style of test/ruling-docs.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

test('AD-1 the code: the verb is a subcommand, non-spending, dispatched with a literal, helped by ONE line, and the session half is the step of stop_decide (no new tool)', () => {
  const cli = read('src/cli.js');
  assert.match(cli, /const SUBCOMMANDS = new Set\(\[[^\]]*'accept'/);
  assert.match(read('src/caps.js'), /NON_SPENDING_SUBCOMMANDS = Object\.freeze\(\[[^\]]*'accept'/);
  assert.match(cli, /if \(argv\[0\] === 'accept'\) \{/);
  assert.equal((cli.match(/council accept runs\/<r> --reason/g) || []).length, 1, 'one help entry');
  const tool = read('src/mcp/stop-decide.js');
  assert.match(tool, /Step 'accept' answers the acceptance of a run that has ended without agreement/);
  assert.doesNotMatch(tool, /step 'accept' is not built|Step 'accept' is not built/);
  const server = read('src/mcp/server.js');
  assert.equal((server.match(/^server\.tool\(/gm) || []).length, 21, 'no new tool in server.js (the count of tools stays what docs/index.html says)');
});

test('AD-2 README, AI-README, CHANGELOG and docs/report-format.md each name the verb and the step and say what they promise: nobody is agreed with, nothing changes but one line and the Status', () => {
  // CHANGED (0.8.4 apply, the README rework): the step sentence is in the Known limits, which moved to KNOWN-LIMITS.md; the README entry reads the README and the limits file together (OLD: README.md alone).
  const readme = `${read('README.md')}\n${read('KNOWN-LIMITS.md')}`; const ai = read('AI-README.md'); const log = read('CHANGELOG.md'); const fmt = read('docs/report-format.md');
  for (const [name, text] of [['README.md and KNOWN-LIMITS.md', readme], ['AI-README.md', ai], ['CHANGELOG.md', log]]) {
    assert.match(text, /council accept/, name);
    assert.match(text, /step `accept` of (the )?`?stop_decide`?/, name);
    assert.match(text, /agrees with no judge/, name);
  }
  assert.match(ai, /delivered_text\.same_as_signed/);
  assert.match(ai, /one yes is recorded in `over_disagreement` and the session still accepts/);
  assert.match(fmt, /`acceptance`/);
  assert.match(fmt, /file_sha256_at_end/);
});
