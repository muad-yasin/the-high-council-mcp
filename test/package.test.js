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

test('the http server and express stay out of the tarball (0.7.8)', () => {
  // src/http-server.js is not part of the release (CLAUDE.md) but shipped in 0.7.7 anyway, where a
  // scanner read it as package code. It stays in the repo for a clone's `npm run http-server`; the
  // package leaves it out, and express, which only it used, is a devDependency.
  assert.ok(!packed.includes('src/http-server.js'), 'src/http-server.js must not be published');
  assert.ok(!('express' in (pkg.dependencies || {})), 'express is not a runtime dependency');
  assert.ok('express' in (pkg.devDependencies || {}), 'express stays installable in a clone');
  assert.equal(pkg.scripts['http-server'], 'node src/http-server.js', 'npm run http-server keeps working in a clone');
  const importsExpress = packed.filter(f => /\.(m?js|cjs)$/.test(f))
    .filter(f => /(from\s+|import\(\s*|require\(\s*)['"]express['"]/.test(readFileSync(join(root, f), 'utf8')));
  assert.deepEqual(importsExpress, [], 'no shipped file may import express');
});

test('the tarball ships the published report.json schema', () => {
  // Not needed at runtime: shipped so a reader can validate a run folder against the format version
  // its report.json names (docs/report-format.md), from the same package that wrote it.
  assert.ok(packed.includes('schemas/report-v1.json'), 'schemas/report-v1.json is missing from the tarball');
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
