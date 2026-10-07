// 0.8.1 pre-release audit round (MAN-4), area A6 (docs, manifests and landing against the code), findings fixed in the docs batch. Each test fails on 0d4a519.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const read = f => readFileSync(join(root, f), 'utf8');

test('A6-2: `council doctor`\'s "Start here" one-key line names planning chains, never the add-on\'s advice chains', () => {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
  const out = execFileSync(process.execPath, [cli, 'doctor'], { cwd: mkdtempSync(join(tmpdir(), 'thc-a62-')), env, encoding: 'utf8', stdio: 'pipe' });
  const line = out.split('\n').find(l => /^\s*one key:/.test(l));
  assert.ok(line, 'doctor prints a one-key line');
  assert.doesNotMatch(line, /advise-/, line);
  // 0.8.2 item 8c (owner, 7 Oct 2026): the line names the expected figure and the maximum, no longer a "worst case".
  assert.match(line, /OPENROUTER_API_KEY alone runs [a-z0-9-]+ \(expected \$[\d.]+, at most \$[\d.]+/);
});

test('A6-10: no user-visible string in src/ or a chain description names a private project or a home path', () => {
  const bad = /--repo \.\.\/(?!my-project)\S+|\.\.\/[A-Z]{2,}\b|~\/Projects\/|\/home\/[a-z]+\//;   // a usage string may show ../my-project, never a real project's name
  const hits = [];
  for (const f of readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'))) {
    read(`src/${f}`).split('\n').forEach((l, i) => { if (bad.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*')) hits.push(`src/${f}:${i + 1}`); });
  }
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    const d = JSON.parse(read(`chains/${f}`)).description || '';
    if (bad.test(d)) hits.push(`chains/${f} description`);
  }
  assert.deepEqual(hits, []);
});

test('A6-6/A6-9: advise-single\'s description names the reasoning high and the 48,000-character limit; cheap-7 chains do not claim "every seat gets a 36000-token ceiling"', () => {
  const single = JSON.parse(read('chains/advise-single.json')).description;
  assert.doesNotMatch(single, /reasoning medium/);
  assert.doesNotMatch(single, /12,000-character limit/);
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): cheap-7 moved to archive/chains/ and is still checked there.
  for (const n of ['archive/chains/cheap-7', 'chains/cheap-7-v2']) assert.doesNotMatch(JSON.parse(read(`${n}.json`)).description, /Every seat gets a 36000-token ceiling/);
  assert.doesNotMatch(read('CHANGELOG.md'), /reasoning medium/);
});

test('A6-4/A6-7/A6-8: counts and dates in the docs follow the code', () => {
  assert.match(read('TROUBLESHOOTING.md'), /cheap-7-v2/);
  assert.doesNotMatch(read('README.md'), /2026-12-04/);
  assert.doesNotMatch(read('docs/index.html'), /doubled for Anthropic seats/);
  assert.match(read('docs/skills.html'), /Last updated 2026-10-0[56]/);
  assert.doesNotMatch(read('docs/report-format.md'), /14 of the 17/);
  assert.doesNotMatch(read('docs/report-format.md'), /Every field in it has a description/);
  assert.doesNotMatch(read('CLAUDE.md'), /while the repo is private/);
});

test('A3-5 (docs): no chain description or README sentence still says the council makes "six calls at most"', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) assert.doesNotMatch(JSON.parse(read(`chains/${f}`)).description || '', /six calls at most/i, f);
  assert.doesNotMatch(read('README.md'), /six calls at most/i);
});
