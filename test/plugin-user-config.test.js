// 0.8.1 M9 (plan M9 Work 1-2; MAN-6 declined, so the repository root stays the plugin): the provider keys can be typed into Claude Code's plugin
// settings dialog. Each dialog field reaches the server under its OWN name, COUNCIL_PLUGIN_<PROVIDER>_API_KEY, never as the standard variable, so an
// optional field the user left empty cannot replace a key they exported in their shell. One helper reads every key (src/key-env.js).
// Offline: no call, no key. The server is the plugin's real entry, `node src/mcp/server.js`, with the manifest's env applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerNames, envKeyName, isKeyOptional, accountHint } from '../src/providers.js';
import { keyEnvValue, usableKeyValue, PLUGIN_ENV_PREFIX } from '../src/key-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const [server] = Object.values(plugin.mcpServers);
// Every provider that needs a key (derived from providers.js: no hand-kept list, no xAI field can appear).
const keyed = providerNames().filter(p => !isKeyOptional(p));

test('the dialog declares one optional, masked field per provider that needs a key, and the server env maps each onto its own COUNCIL_PLUGIN_ name', () => {
  assert.deepEqual(Object.keys(plugin.userConfig).sort(), keyed.map(p => `${p}_api_key`).sort());
  for (const p of keyed) {
    const field = plugin.userConfig[`${p}_api_key`];
    assert.equal(field.type, 'string');
    assert.equal(field.sensitive, true, `${p}: a key is stored in the secure credential store, never in settings.json`);
    assert.equal(field.required, undefined, `${p}: optional: a person uses the labs they have a key for`);
    assert.equal(field.default, undefined, `${p}: no default key`);
    assert.ok(field.title && field.description);
    assert.equal(server.env[`${PLUGIN_ENV_PREFIX}${envKeyName(p)}`], `\${user_config.${p}_api_key}`, p);
  }
  // Nothing else in the env, and never the standard variable name (an empty optional field must not shadow a key from the shell).
  assert.deepEqual(Object.keys(server.env).sort(), keyed.map(p => `${PLUGIN_ENV_PREFIX}${envKeyName(p)}`).sort());
  assert.ok(!Object.keys(server.env).some(k => keyed.map(envKeyName).includes(k)));
  assert.ok(!JSON.stringify(plugin).toLowerCase().includes('grok') && !JSON.stringify(plugin).toLowerCase().includes('xai'));
});

test('keyEnvValue: the dialog value when usable, else the standard variable; empty, whitespace and an unsubstituted placeholder count as unset', () => {
  const E = 'OPENROUTER_API_KEY';
  const P = PLUGIN_ENV_PREFIX + E;
  assert.equal(keyEnvValue(E, { [P]: 'dialog', [E]: 'shell' }), 'dialog');
  for (const unusable of ['', '   ', '\t\n', '${user_config.openrouter_api_key}', ' ${user_config.openrouter_api_key} ']) {
    assert.equal(keyEnvValue(E, { [P]: unusable, [E]: 'shell' }), 'shell', JSON.stringify(unusable));
    assert.equal(keyEnvValue(E, { [P]: unusable }), null);
    assert.equal(keyEnvValue(E, { [E]: unusable }), null, 'a standard variable that is unusable is unset too');
  }
  assert.equal(keyEnvValue(E, {}), null);
  assert.equal(usableKeyValue(undefined), false);
});

// A minimal stdio client for the real server entry; reads key presence from the dry_run tool's `missingKeys`, never the key.
async function missingKeysOf(env, dotenv = '') {
  const cwd = mkdtempSync(join(tmpdir(), 'thc-plugin-keys-'));
  if (dotenv) writeFileSync(join(cwd, '.env'), dotenv);
  const child = spawn(process.execPath, [join(root, ...server.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '').split('/'))], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...env } });
  let buf = ''; const pending = new Map(); let id = 1;
  child.stdout.on('data', d => { buf += d; let nl; while ((nl = buf.indexOf('\n')) !== -1) { const l = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(l); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* not a reply */ } } });
  const rpc = (method, params) => new Promise(r => { const i = id++; pending.set(i, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-keys-test', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const r = await rpc('tools/call', { name: 'dry_run', arguments: { chain: 'cheap-7-v2', json: true } });
    const text = r.result.content.map(c => c.text).join('');
    return JSON.parse(text.slice(text.indexOf('{'))).missingKeys.map(m => m.envVar);
  } finally { child.kill(); }
}

test('the real server entry: a dialog key, a shell key, an empty or placeholder dialog value with a shell key, and a .env key are each found; nothing set is reported missing', async () => {
  const P = `${PLUGIN_ENV_PREFIX}OPENROUTER_API_KEY`;
  assert.deepEqual(await missingKeysOf({}), ['OPENROUTER_API_KEY'], 'fixture: with nothing set the key is missing');
  assert.deepEqual(await missingKeysOf({ [P]: 'dialog-value' }), [], 'dialog value');
  assert.deepEqual(await missingKeysOf({ OPENROUTER_API_KEY: 'shell-value' }), [], 'shell value');
  assert.deepEqual(await missingKeysOf({ [P]: '', OPENROUTER_API_KEY: 'shell-value' }), [], 'an empty dialog value (what Claude Code passes for a field left empty) does not shadow the shell key');
  assert.deepEqual(await missingKeysOf({ [P]: '${user_config.openrouter_api_key}', OPENROUTER_API_KEY: 'shell-value' }), [], 'an unsubstituted placeholder does not shadow it either');
  assert.deepEqual(await missingKeysOf({ [P]: '   ' }, 'OPENROUTER_API_KEY=dotenv-value\n'), [], 'whitespace in the dialog value falls through to .env');
});

test('council doctor reports a dialog key as set and never prints its value', () => {
  const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const cwd = mkdtempSync(join(tmpdir(), 'thc-plugin-doctor-'));
  const env = { PATH: process.env.PATH, HOME: cwd, [`${PLUGIN_ENV_PREFIX}OPENROUTER_API_KEY`]: secret };
  const out = execFileSync(process.execPath, [join(root, 'src', 'cli.js'), 'doctor'], { cwd, env, encoding: 'utf8' });
  assert.match(out, /openrouter\s+OPENROUTER_API_KEY\s+set \(plugin settings dialog\)/, 'doctor names where the key came from');
  assert.ok(!out.includes(secret));
});

test('source scan: no code in src/ reads a provider key from process.env by its own variable name (one helper, src/key-env.js)', () => {
  const offenders = [];
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))) {
    if (f === 'key-env.js' || f === 'http-server.js') continue; // http-server.js is not packaged (its own, separate daily cap and keys)
    readFileSync(join(root, 'src', f), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/process\.env\[(spec\.key|envName|envKeyName\([^)]*\))\]/.test(line)) offenders.push(`src/${f}:${i + 1}: ${t.slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('a rejected key points at the place the key came from: the settings dialog when the dialog value is the one in use, else .env', () => {
  const had = { ...process.env };
  try {
    delete process.env.OPENROUTER_API_KEY; delete process.env[`${PLUGIN_ENV_PREFIX}OPENROUTER_API_KEY`];
    process.env.OPENROUTER_API_KEY = 'shell-value';
    assert.match(accountHint(401, 'openrouter/x'), /fix it in \.env/);
    process.env[`${PLUGIN_ENV_PREFIX}OPENROUTER_API_KEY`] = 'dialog-value';
    const hint = accountHint(401, 'openrouter/x');
    assert.match(hint, /plugin's settings dialog/);
    assert.doesNotMatch(hint, /in \.env/);
    assert.ok(!hint.includes('dialog-value') && !hint.includes('shell-value'), 'never the value');
  } finally { for (const k of ['OPENROUTER_API_KEY', `${PLUGIN_ENV_PREFIX}OPENROUTER_API_KEY`]) { if (had[k] === undefined) delete process.env[k]; else process.env[k] = had[k]; } }
});
