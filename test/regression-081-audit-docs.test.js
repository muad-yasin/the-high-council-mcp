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

test('A6-2: `council doctor`\'s "Start here" block never names the add-on\'s advice chains, and (0.8.4) prints no one-key line while no shipped chain runs on one key plus the session', () => {
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/API_KEY/.test(k)) delete env[k];
  const out = execFileSync(process.execPath, [cli, 'doctor'], { cwd: mkdtempSync(join(tmpdir(), 'thc-a62-')), env, encoding: 'utf8', stdio: 'pipe' });
  const line = out.split('\n').find(l => /^\s*one key:/.test(l));
  // CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10 and 01:56: plan-default-opro-council retires; every shipped chain answers its criteria stage through the Claude subscription). OLD: doctor printed a one-key line (OPENROUTER_API_KEY plus your agent session ... runs plan-default-opro-council (expected ..., upper estimate ...)) and the test pinned its shape and that it never names an advise- chain. NEW: no one-key line exists, so the test pins that the Start here block never names an advise- chain and that, if a one-key line ever returns, it has the old shape. WHY: the line is derived from the seats and the chain that earned it is gone; the guard against advice chains in "Start here" (audit A6-2) stays.
  const startHere = out.slice(out.indexOf('Start here:'), out.indexOf('before paying:'));
  assert.ok(startHere.length > 20, 'the Start here block was found');
  assert.doesNotMatch(startHere, /advise-/, startHere);
  if (line) assert.match(line, /plus your agent session \(Claude Code, for example\) runs [a-z0-9-]+ \(expected \$[\d.]+, upper estimate \$[\d.]+/);
  else assert.equal(line, undefined);
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

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD: the test also read chains/advise-standard.json and checked its description (reasoning high, the 48,000-character limit). NEW: the two advise-standard assertions are gone. WHY: the chain left chains/ with the advice add-on; the cheap-7 and CHANGELOG assertions stay.
test('A6-6/A6-9: cheap-7 chains do not claim "every seat gets a 36000-token ceiling"; the CHANGELOG does not say "reasoning medium"', () => {
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): cheap-7 moved to archive/chains/ and is still checked there.
  for (const n of ['chains/outdated/cheap-7', 'chains/outdated/cheap-7-v2']) assert.doesNotMatch(JSON.parse(read(`${n}.json`)).description, /Every seat gets a 36000-token ceiling/);
  assert.doesNotMatch(read('CHANGELOG.md'), /reasoning medium/);
});

test('A6-4/A6-7/A6-8: counts and dates in the docs follow the code', () => {
  assert.match(read('TROUBLESHOOTING.md'), /plan-mini-council/);   // names the first-run chain (0.8.3 lane B, commit 2; 0.8.4 seats unit: the default chain, plan-default-opro-council retired)
  for (const f of ['README.md', 'KNOWN-LIMITS.md', 'AI-README.md']) assert.doesNotMatch(read(f), /2026-12-04/);   // README split (26 Okt 2026): the moved sections are scanned too; KNOWN-LIMITS.md joined with the Known limits (0.8.4 README rework)
  assert.doesNotMatch(read('docs/index.html'), /doubled for Anthropic seats/);
  assert.match(read('docs/skills.html'), /Last updated 2026-11-13/);
  assert.doesNotMatch(read('docs/report-format.md'), /14 of the 17/);
  // 0.8.3 (W, CR-4E-004, 25 Okt 2026): the count is derived, not banned one old string at a time. The schema test runs every shipped mock chain but the three that pause for a person or stop at their cap.
  const mockChains = readdirSync(join(root, 'chains')).filter(f => /^mock.*\.json$/.test(f)).length;
  assert.ok(read('docs/report-format.md').includes(`(${mockChains - 3} of the ${mockChains}; the other three pause`), `docs/report-format.md should say "${mockChains - 3} of the ${mockChains}"`);
  assert.doesNotMatch(read('docs/report-format.md'), /Every field in it has a description/);
  assert.doesNotMatch(read('CLAUDE.md'), /while the repo is private/);
});

test('A3-5 (docs): no chain description or README sentence still says the council makes "six calls at most"', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) assert.doesNotMatch(JSON.parse(read(`chains/${f}`)).description || '', /six calls at most/i, f);
  for (const f of ['README.md', 'KNOWN-LIMITS.md', 'AI-README.md']) assert.doesNotMatch(read(f), /six calls at most/i);   // KNOWN-LIMITS.md joined with the Known limits (0.8.4 README rework)
});
