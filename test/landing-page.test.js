// relay/test/landing-page.test.js
//
// docs/index.html is a static landing page whose headline numbers are claims
// about this repo: how many chains ship, how many MCP tools exist, how many
// providers are supported, what the default spend ceiling is. Nothing derives
// them - they are typed into the HTML - so they go stale silently and the page
// keeps looking authoritative while lying.
//
// This is not hypothetical. The page shipped saying 29 chain configs and 12
// MCP tools when the repo had 30 and 11, and its own tools table directly
// below the "12" listed eleven rows. A static page cannot compute these at
// render time, so the check lives here instead: change the repo without
// changing the page and the suite fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(root, 'docs', 'index.html');
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : null;

// The stat strip renders each figure as `>N</div>` immediately followed by a
// label div. Matching the pair keeps this from tripping over unrelated numbers.
function statFor(label) {
  const m = page.match(new RegExp(`>([\\$\\d]+)</div>\\s*<div[^>]*>${label}</div>`));
  assert.ok(m, `no stat card labelled "${label}" found in docs/index.html`);
  return m[1];
}

test('landing page: chain config count matches chains/', { skip: !page && 'no docs/index.html' }, () => {
  const real = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).length;
  assert.equal(statFor('chain configs'), String(real));
  // The prose repeats it further down the page; that copy drifts too.
  assert.match(page, new RegExp(`${real} chain configs live in`),
    `the chains section prose disagrees with the real count (${real})`);
});

test('landing page: MCP tool count matches the registered tools', { skip: !page && 'no docs/index.html' }, () => {
  const server = readFileSync(join(root, 'src', 'mcp', 'server.js'), 'utf8');
  const real = (server.match(/^server\.tool\(/gm) || []).length;
  assert.ok(real > 0, 'found no registered MCP tools to compare against');
  assert.equal(statFor('MCP tools'), String(real));
});

test('landing page: provider count matches providers.js', { skip: !page && 'no docs/index.html' }, () => {
  const providers = readFileSync(join(root, 'src', 'providers.js'), 'utf8');
  const real = (providers.match(/key: '[A-Z_]+'/g) || []).length;
  assert.equal(statFor('providers supported'), String(real));
});

test('landing page: default spend cap matches the CLI default', { skip: !page && 'no docs/index.html' }, () => {
  const cli = readFileSync(join(root, 'src', 'cli.js'), 'utf8');
  const real = cli.match(/const DEFAULT_MAX_USD = (\d+)/)[1];
  assert.equal(statFor('default spend cap'), `$${real}`);
});

test('landing page: ships no scripts and no third-party requests', { skip: !page && 'no docs/index.html' }, () => {
  // The design arrived depending on Claude Design's dc-runtime (unlicensed,
  // and it pulled React and Babel from unpkg at runtime) and on Google Fonts.
  // Both were removed deliberately; this keeps them removed.
  assert.equal((page.match(/<script/g) || []).length, 0, 'the page must stay script-free');
  const external = [...page.matchAll(/https?:\/\/[^"')\s]+/g)].map(m => m[0])
    .filter(u => !/^https:\/\/(github\.com|sower-industries\.de)/.test(u));
  assert.deepEqual(external, [], 'the page must make no third-party requests');
});
