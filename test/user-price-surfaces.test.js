// The project's own price row on the surface that prices IN-PROCESS (0.8.3 user price row P2b; gate page UserPriceRow_Gate_Page.md sections 8 and 10): the library's price().
// The CLI (and everything that spawns it) is covered by test/user-price-cli.test.js. $0, offline.
// 0.8.4 (the add-on removal): the second surface, the MCP server's advice quote (council_quote refusing an unreadable pricing.user.json), is gone with the tool; no MCP server is started here any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { price } from '../src/api.js';
import { resetUserPrices, UserPriceFileError } from '../src/price-table.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'vendor/not-in-the-price-table';

function project(row) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-userprice-surf-')); mkdirSync(join(dir, 'chains'));
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(dir, 'chains', 'u.json'), JSON.stringify({ ...base, name: 'u', seats: { ...base.seats, criteria: { provider: 'openrouter', model: MODEL, maxTokens: 500 } } }));
  if (row !== undefined) writeFileSync(join(dir, 'pricing.user.json'), typeof row === 'string' ? row : JSON.stringify(row));
  return dir;
}

test('library price(): an unshipped model is unpriced until the project\'s pricing.user.json prices it; an unreadable file throws; the rows of one folder do not leak into the next call', () => {
  try {
    const bare = project();
    assert.deepEqual(price({ chain: 'u', cwd: bare }).unpriced, [`openrouter/${MODEL}`]);
    const priced = project({ [`openrouter/${MODEL}`]: { in: 1, out: 4 } });
    const p = price({ chain: 'u', cwd: priced });
    assert.deepEqual(p.unpriced, []); assert.ok(p.totalUsd > 0);
    assert.throws(() => price({ chain: 'u', cwd: project('{nope') }), e => e instanceof UserPriceFileError && /pricing\.user\.json: it is not valid JSON/.test(e.message));
    assert.deepEqual(price({ chain: 'u', cwd: bare }).unpriced, [`openrouter/${MODEL}`], 'a call for a folder without the file sees no rows left over from the earlier one');
  } finally { resetUserPrices(); }
});
