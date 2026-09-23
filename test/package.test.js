// relay/test/package.test.js
//
// A published tarball is public forever and cannot be unpublished freely, so
// what goes into it is checked here rather than remembered. The first
// `npm pack --dry-run` on this package was 83 files / 709 KB because `files`
// was unset - it would have shipped the entire GitHub Pages site, docs/ and
// all, to every user on every npx invocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// `npm pack --dry-run --json` reports exactly what would ship, which beats
// re-deriving the ignore rules here and getting them subtly wrong.
const packed = (() => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
  return JSON.parse(out)[0].files.map(f => f.path);
})();

test('the tarball ships no private or irrelevant files', () => {
  const forbidden = packed.filter(f =>
    /^docs\//.test(f) ||        // the Pages site: 700 KB no CLI user needs
    /^test\//.test(f) ||
    /^runs\//.test(f) ||        // run output is the author's business material
    /^tasks\//.test(f) ||       // as are task files
    f === '.env' ||
    /^\.env\..*(?<!example)$/.test(f) ||
    /^maintainers\//.test(f) || // internal project docs (2026-09-23 layout)
    f === 'CLAUDE.md' || f === 'HANDOFF.md');
  assert.deepEqual(forbidden, [], 'these must not be published');
});

test('the tarball ships everything the CLI needs at runtime', () => {
  // Excluding one of these produces a package that installs and then fails on
  // first use - the packaged equivalent of the missing-tasks/ README bug.
  for (const needed of ['package.json', 'src/cli.js', 'src/chain.js', 'src/providers.js',
                        'src/roles.js', 'src/cost.js', 'src/pricing.json', 'src/mcp/server.js',
                        'chains/verify.json', 'README.md', 'LICENSE', '.env.example']) {
    assert.ok(packed.includes(needed), `${needed} is missing from the tarball`);
  }
  // Every chain the README names must actually ship.
  for (const c of ['verify', 'cheap', 'plan-debate', 'plan-auto', 'plan-unanimous', 'mock-budget']) {
    assert.ok(packed.includes(`chains/${c}.json`), `chains/${c}.json is missing from the tarball`);
  }
});

test('only the council command goes on a stranger\'s PATH', () => {
  // `relay` was the pre-rename name. Publishing it would claim a very generic
  // command globally for everyone who installs this.
  assert.deepEqual(Object.keys(pkg.bin), ['council']);
  assert.ok(!('relay' in pkg.bin), 'relay must not be published as a global command');
});

test('the npm listing links back to the project', () => {
  assert.match(pkg.repository.url, /github\.com\/muad-yasin\/the-high-council-mcp/);
  assert.ok(pkg.homepage && pkg.bugs?.url, 'homepage and bugs url must be set');
  assert.ok(pkg.keywords?.includes('mcp'), 'searchable for mcp');
});
