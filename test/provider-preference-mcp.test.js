// 0.8.4 PRICES unit 3: the MCP server's advice tools refuse BEFORE a person approves when provider-preference.json cannot be read in full. The CLI child that would run an approved call refuses at its start (exit 2), and an approved call
// that never started is counted at its full ceiling (README, "A failed start after approval"): so the server reads the file at start like pricing.user.json and the quote says why. A live MCP server over stdio in advice-mock mode, $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
function project(pref) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-pref-mcp-')); mkdirSync(join(dir, 'chains'));
  if (pref !== undefined) writeFileSync(join(dir, 'provider-preference.json'), typeof pref === 'string' ? pref : JSON.stringify(pref));
  return dir;
}
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
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'provider-preference-mcp', version: '0' } } });
  });
}

test('MCP advice quote: with an unreadable provider-preference.json the quote REFUSES with the file named and the preference file named in the way out; with a readable file or none it quotes as before', async () => {
  const bad = await quoteIn(project({ 'openrouter/a/b': { prefer: ['Bad Tag'] } }));
  assert.equal(bad.isError, true, JSON.stringify(bad).slice(0, 400));
  assert.match(bad.content[0].text, /REFUSED \(price_file_unreadable\): provider-preference\.json: openrouter\/a\/b: "Bad Tag" is not an endpoint tag.*not used at all/s);
  assert.match(bad.content[0].text, /fixes or removes provider-preference\.json in the project folder and restarts the server/);
  assert.doesNotMatch(bad.content[0].text, /pricing\.user\.json/);
  const good = await quoteIn(project({ 'openrouter/a/b': { prefer: ['azure/us'] } }));
  assert.ok(!good.isError, JSON.stringify(good).slice(0, 400));
  const none = await quoteIn(project());
  assert.ok(!none.isError, JSON.stringify(none).slice(0, 400));
});
