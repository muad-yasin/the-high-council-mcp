// test/claude-plugin.test.js
//
// The repo root is also a Claude Code plugin and its own one-entry marketplace
// (.claude-plugin/plugin.json + marketplace.json). A real install can only be proven by running
// `claude plugin marketplace add` / `claude plugin install`, which needs the claude CLI - not a
// unit test. What can be checked offline is what that install depends on:
// - Claude Code copies the plugin into its cache and runs `npm ci --ignore-scripts` there only
//   when the root has package.json AND a lockfile. Without package-lock.json the MCP server starts
//   with no node_modules and dies on its first import.
// - The server must be addressed through ${CLAUDE_PLUGIN_ROOT}: the cached copy's path is not
//   known in advance, and the client's working directory is the user's project.
// - A root .mcp.json would also be read as *project* MCP config by anyone who opens a clone of
//   this repo, where ${CLAUDE_PLUGIN_ROOT} means nothing - so the server is declared inline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const pkg = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

test('plugin manifest tracks package.json: same version, same license', () => {
  assert.equal(plugin.version, pkg.version, 'bump .claude-plugin/plugin.json with package.json - installed users only update when it changes');
  assert.equal(plugin.license, pkg.license);
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'plugin names are kebab-case and immutable once published');
});

test('the MCP server runs from the cached plugin copy, with no key, proxy or npx fetch baked in', () => {
  const servers = Object.values(plugin.mcpServers);
  assert.equal(servers.length, 1);
  const [server] = servers;
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${CLAUDE_PLUGIN_ROOT}/src/mcp/server.js']);
  assert.ok(existsSync(join(root, 'src/mcp/server.js')));
  assert.equal(server.env, undefined, 'BYOK only: keys come from the user\'s own .env / environment, never the manifest');
});

test('dependencies can be installed by Claude Code itself: package.json plus an npm lockfile at the root', () => {
  assert.ok(existsSync(join(root, 'package-lock.json')), 'without a lockfile Claude Code skips the dependency install silently');
  const lock = readJson('package-lock.json');
  for (const dep of Object.keys(pkg.dependencies)) {
    assert.ok(lock.packages[`node_modules/${dep}`], `${dep} is a dependency but missing from package-lock.json - npm ci would fail`);
  }
});

test('no root .mcp.json - it would double as broken project MCP config in every clone', () => {
  assert.equal(existsSync(join(root, '.mcp.json')), false);
});

test('the marketplace lists exactly this plugin, from the repo root', () => {
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.source, './');
  assert.equal(entry.strict, undefined, 'plugin.json stays the authority for components');
  assert.equal(entry.skills, undefined, 'a skills list on a root-source entry would replace the full skills/ scan');
});

test('every skill the plugin ships is a skills/<name>/SKILL.md the default scan finds', () => {
  const dirs = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter(d => d.isDirectory());
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(existsSync(join(root, 'skills', d.name, 'SKILL.md')), `skills/${d.name} would not load as a plugin skill`);
});
