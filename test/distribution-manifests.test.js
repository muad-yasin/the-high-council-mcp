// server.json (the official MCP Registry listing) and mcpb/manifest.json (the Claude Desktop bundle)
// are typed by hand, like the landing page, so what they claim about this repo is checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const pkg = readJson('package.json');
const serverJson = readJson('server.json');
const manifest = readJson('mcpb/manifest.json');
const serverSrc = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
const toolNames = [...serverSrc.matchAll(/server\.tool\('([a-z_]+)'/g)].map(m => m[1]).sort();
const keyVars = readFileSync(join(root, '.env.example'), 'utf8').match(/^[A-Z_]+_API_KEY(?==)/gm);

test('server.json: the registry name is package.json mcpName, and the versions move together', () => {
  assert.equal(serverJson.name, pkg.mcpName);
  assert.match(pkg.mcpName, /^io\.github\.muad-yasin\//, 'GitHub auth only grants io.github.<user>/');
  assert.equal(serverJson.version, pkg.version, 'bump server.json with package.json');
  const npm = serverJson.packages.find(p => p.registryType === 'npm');
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.version, pkg.version);
  assert.deepEqual(npm.packageArguments, [{ type: 'positional', value: '--mcp' }], 'npx the-high-council --mcp');
  assert.ok(serverJson.description.length <= 100, `the registry caps description at 100 characters, got ${serverJson.description.length}`);
  assert.match(serverJson.$schema, /\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
});

test('server.json: every provider key is listed, optional and secret; no key is ever required', () => {
  const listed = serverJson.packages[0].environmentVariables;
  for (const k of keyVars) {
    const v = listed.find(e => e.name === k);
    assert.ok(v, `${k} is not listed`);
    assert.equal(v.isSecret, true, k);
    assert.equal(v.isRequired, false, `${k}: the mock chains run with no key at all`);
    assert.ok(!('default' in v) && !('value' in v), `${k} must never carry a value`);
  }
});

test('mcpb manifest: version, entry point and tool list match the package', () => {
  assert.equal(manifest.version, pkg.version, 'bump mcpb/manifest.json with package.json');
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.server.entry_point, 'src/mcp/server.js');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/src/mcp/server.js']);
  assert.deepEqual(manifest.tools.map(t => t.name).sort(), toolNames, 'the manifest lists exactly the tools the server registers');
  assert.equal(manifest.license, pkg.license);
});

test('mcpb manifest: keys are the user\'s own - sensitive, optional, empty by default', () => {
  const env = manifest.server.mcp_config.env;
  for (const k of keyVars) {
    const m = /^\$\{user_config\.([a-z_]+)\}$/.exec(env[k] || '');
    assert.ok(m, `${k} is not wired to a user_config entry`);
    const uc = manifest.user_config[m[1]];
    assert.equal(uc.type, 'string');
    assert.equal(uc.sensitive, true, `${k} must be stored as a secret`);
    assert.equal(uc.required, false, k);
    assert.equal(uc.default, '', `${k} defaults to empty, never to a key`);
  }
});

test('mcpb manifest: the spend ceiling is required, positive, and one the model cannot lift', () => {
  const env = manifest.server.mcp_config.env;
  assert.equal(env.MAX_USD_PER_RUN, '${user_config.max_usd}');
  assert.equal(env.COUNCIL_MAX_USD_LIMIT, '${user_config.max_usd}');
  const uc = manifest.user_config.max_usd;
  assert.equal(uc.required, true);
  assert.ok(uc.min > 0, 'a 0 ceiling would read as "no ceiling"');
  assert.equal(env.COUNCIL_WORKDIR, '${user_config.workdir}');
  assert.equal(manifest.user_config.workdir.type, 'directory');
});

test('the tarball ships the JS API, its types and nothing from mcpb/ or server.json', () => {
  const files = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))[0].files.map(f => f.path);
  for (const f of ['src/api.js', 'types/index.d.ts']) assert.ok(files.includes(f), f);
  assert.ok(!files.some(f => f.startsWith('mcpb/') || f === 'server.json'), 'bundle and registry files stay out of the npm package');
});
