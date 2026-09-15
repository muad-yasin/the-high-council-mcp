// test/no-digest-in-prompt-paths.test.js
//
// v6 item E's binding architectural requirement (relay/runs/2026-09-15T15-12-52-325Z/deliverable.md):
// the dissent digest must be structurally incapable of influencing the review it describes.
// Enforced as a fact about the import graph, not a promise in a comment: nothing reachable from
// src/chain.js or src/roles.js (the chain's execution and prompt-construction entry points) may
// import src/dissent-digest.js, and src/dissent-digest.js may import neither of those two files
// (nor anything that transitively does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

// Static, regex-based import extraction - a fallback deliberately allowed by the plan
// ("statically walks... or greps, as fallback") rather than a full AST parse.
const IMPORT_RE = /import\s+(?:[^'"]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g;

function resolveImport(fromFile, spec) {
  let p = resolve(dirname(fromFile), spec);
  if (!p.endsWith('.js')) p += '.js';
  return p;
}

function importsOf(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) out.push(resolveImport(file, m[1]));
  return out;
}

function reachableFrom(entryFile) {
  const seen = new Set();
  const queue = [entryFile];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf(f)) if (!seen.has(dep)) queue.push(dep);
  }
  return seen;
}

const chainFile = join(srcDir, 'chain.js');
const rolesFile = join(srcDir, 'roles.js');
const digestFile = join(srcDir, 'dissent-digest.js');

test('nothing reachable from chain.js imports dissent-digest.js', () => {
  const reachable = reachableFrom(chainFile);
  assert.ok(!reachable.has(digestFile),
    'src/chain.js (directly or transitively) imports src/dissent-digest.js - this breaks the ' +
    'structural read-only guarantee v6 item E depends on');
});

test('nothing reachable from roles.js imports dissent-digest.js', () => {
  const reachable = reachableFrom(rolesFile);
  assert.ok(!reachable.has(digestFile),
    'src/roles.js (directly or transitively) imports src/dissent-digest.js - this breaks the ' +
    'structural read-only guarantee v6 item E depends on');
});

test('dissent-digest.js does not import chain.js or roles.js, directly or transitively', () => {
  const reachable = reachableFrom(digestFile);
  assert.ok(!reachable.has(chainFile), 'src/dissent-digest.js imports src/chain.js');
  assert.ok(!reachable.has(rolesFile), 'src/dissent-digest.js imports src/roles.js');
});

test('sanity: the walker actually finds real edges (chain.js does import roles-adjacent providers.js)', () => {
  // Guards against a walker bug (e.g. a broken regex) silently passing the tests above for the
  // wrong reason - a "no findings because nothing was found" false negative.
  const reachable = reachableFrom(chainFile);
  assert.ok(reachable.has(join(srcDir, 'providers.js')), 'walker failed to find a known real import edge from chain.js');
});
