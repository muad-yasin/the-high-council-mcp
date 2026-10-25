// The project's own price row on the surfaces that price IN-PROCESS (0.8.3 user price row P2b; gate page UserPriceRow_Gate_Page.md sections 8 and 10): the library's price() and the MCP server's advice quote.
// The CLI (and everything that spawns it) is covered by test/user-price-cli.test.js. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { price } from '../src/api.js';
import { resetUserPrices, UserPriceFileError } from '../src/price-table.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
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

// A live MCP server over stdio in advice-mock mode (the add-on's tools answer from mock chains, nothing is sent): the quote tool reads the same file in ITS process.
function quoteIn(dir) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, COUNCIL_ADVISE_MOCK: '1' } });
    let buf = ''; let err = '';
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out: ${err}`)); }, 30_000);
    const send = m => child.stdin.write(JSON.stringify(m) + '\n');
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1); let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'council_quote', arguments: { mode: 'single', brief: {
            schema_version: 'advice-brief/1', moment: 'before_commit', question: 'Keep ticked items or remove them?', decision_at_stake: 'History versus clutter.',
            options_considered: [{ name: 'Keep', summary: 'Grey them out.' }, { name: 'Remove', summary: 'Delete on tick.' }], tried: [{ what: 'Asked two users', result: 'They disagreed.' }], sensitivity: 'public', not_included: ['the conversation'] } } } });
        } else if (m.id === 2) { clearTimeout(timer); child.kill(); done(m.result); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'user-price-surfaces', version: '0' } } });
  });
}

test('MCP advice quote: with an unreadable pricing.user.json the quote REFUSES with the file named (a raised row lost silently would under-count the cap); with a readable file or none it quotes as before', async () => {
  const bad = project('{"openrouter/vendor/x": {"in": 0, "out": 1}}');
  const r = await quoteIn(bad);
  assert.equal(r.isError, true, JSON.stringify(r).slice(0, 400));
  assert.match(r.content[0].text, /REFUSED \(price_file_unreadable\): pricing\.user\.json: openrouter\/vendor\/x: .*above 0.*not used at all/);
  const fine = await quoteIn(project());
  assert.notEqual(fine.isError, true, JSON.stringify(fine).slice(0, 400));
});
