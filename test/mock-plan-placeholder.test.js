// The TEST-ONLY mock seats whose plan carries a placeholder an input scan reads (0.8.3 M6 S5b; C&C ruling 3, 12 Oct): a provider's plan section reaches a consumer's bundle, and the registration pre-check of a tree reads it with the SAME scans a
// run uses on its inputs. Real models never write these on purpose, so a test needs a seat that does, deterministically, offline, $0. The names:
//   mock-plan-placeholder-url            a password in a URL on a REAL-LOOKING host (the S5b-1 case: refused)
//   mock-plan-placeholder-url-localhost  the same URL on `localhost` (the S5b-2 case: a reserved placeholder host, registers)
//   mock-plan-placeholder-url-lookalike  the same URL on a look-alike of a reserved host (still refused)
//   mock-plan-placeholder-email          an e-mail address on a real-looking domain (the S5b-3 case, under --pii-gate)
// The text is ASSEMBLED AT RUNTIME from parts (src/providers.js and this file never hold a complete one: this repo is public and its own scanners read it, MPH-3), is written by the builder AND the reviser seat (so the reviewed text keeps it), and
// sits under `## Overview`, the heading the shared split fixture's provider_refs name. The same file holds Q1 (C&C ruling 12 Oct): `council handoff` on a run whose task holds a placeholder on a reserved host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '../src/providers.js';
import { secretShapesIn } from '../src/outbound-scan.js';
import { scanForPii } from '../src/pii-gate.js';
import { scanText } from '../src/key-redaction.js';
import { cli } from './helpers/tree-fixture.js';
import { sectionOf } from '../src/tree-derive.js';

const URL_NAME = ['URL credentials (scheme', '://user:', 'pass@)'].join('');   // the scanner's own pattern name, assembled like the placeholders (MPH-3 scans this file)
const url = host => ['postgres', '://user:', 'pass', '@', host, '/db'].join('');
const BUILDER = 'You are the builder in a multi-model review chain.';
const REVISER = 'You are the builder in a multi-model review chain,\nrevising';
const text = async (model, system) => (await call('mock', { model, system, messages: [{ role: 'user', content: 'Plan it.' }], maxTokens: 4000 })).text;
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });

test('MPH-1 each placeholder seat writes its text under `## Overview` as builder AND as reviser, and the scans read it as named (db.internal refused, localhost reserved, look-alike refused, e-mail a personal-data finding)', async () => {
  const cases = [
    ['mock-plan-placeholder-url', { default: [URL_NAME], exempt: [URL_NAME], email: ['email'] }],
    ['mock-plan-placeholder-url-localhost', { default: [URL_NAME], exempt: [], email: [] }],
    ['mock-plan-placeholder-url-lookalike', { default: [URL_NAME], exempt: [URL_NAME], email: ['email'] }],
    ['mock-plan-placeholder-email', { default: [], exempt: [], email: ['email'] }],
  ];
  // `email`: what the PERSONAL-DATA gate finds. A URL password on a real-looking host also reads as an address (the password and the host around the at sign, as it always did: test/reserved-placeholder-hosts.test.js RES-4); on a reserved host it does not.
  for (const [model, want] of cases) {
    for (const [role, system, head] of [['builder', BUILDER, 'MOCK DELIVERABLE for model '], ['reviser', REVISER, 'REVISED MOCK DELIVERABLE for model ']]) {
      const t = await text(model, system);
      assert.ok(t.startsWith(head), `${model} as ${role}: the ordinary mock draft is kept (critics sign it): ${t.slice(0, 60)}`);
      assert.match(t, /\n## Overview\n/, `${model} as ${role}: under the Overview heading`);
      // the consumer's bundle is cut with this very function (src/tree-derive.js: sectionOf(provider plan text, a provider_refs heading), which must find the heading EXACTLY once): the placeholder is INSIDE the section it cuts
      const cut = sectionOf(t, 'Overview');
      assert.equal(cut.count, 1, `${model} as ${role}: the Overview heading exists exactly once`);
      assert.deepEqual(secretShapesIn(cut.section).map(f => f.name), want.default, `${model} as ${role}: the cut section carries the same finding as the whole text`);
      assert.deepEqual(secretShapesIn(t).map(f => f.name), want.default, `${model} as ${role}: the default scan`);
      assert.deepEqual(secretShapesIn(t, { exemptReservedHosts: true }).map(f => f.name), want.exempt, `${model} as ${role}: the input scan`);
      assert.deepEqual(scanForPii(t).findings.filter(f => f.type === 'email').map(f => f.type), want.email, `${model} as ${role}: the personal-data gate`);
    }
  }
});

test('MPH-2 nothing else changed: an ordinary mock seat writes no placeholder, and a placeholder seat asked as a critic or for criteria answers as every mock does', async () => {
  for (const system of [BUILDER, REVISER]) {
    const t = await text('mock-builder', system);
    assert.doesNotMatch(t, /## Overview/);
    assert.deepEqual(secretShapesIn(t), []);
    assert.deepEqual(scanForPii(t).findings, []);
  }
  const critic = await text('mock-plan-placeholder-url', 'You are an independent critic of a draft.');
  assert.equal(typeof JSON.parse(critic).meets, 'boolean', `a critic reply is a verdict, not a plan: ${critic.slice(0, 80)}`);
  assert.doesNotMatch(critic, /db\.internal|## Overview/);
});

test('MPH-3 the repo never holds a complete placeholder: the repo\'s own scanners find nothing in src/providers.js or in this file (the control: a complete one IS found)', () => {
  const read = rel => readFileSync(join(import.meta.dirname, rel), 'utf8');
  assert.equal(scanText(url('db.internal')).length, 1, 'control: the scanner reads a complete URL placeholder');
  assert.equal(scanForPii(['jane.doe', '@', 'mail-corp', '.de'].join('')).findings.length, 1, 'control: and a complete address');
  for (const rel of ['../src/providers.js', 'mock-plan-placeholder.test.js']) {
    assert.deepEqual(scanText(read(rel), rel), [], `${rel}: no key-shaped string`);
    assert.deepEqual(scanForPii(read(rel)).findings.filter(f => f.type === 'email'), [], `${rel}: no e-mail address`);
  }
});

test('Q1 `council handoff` on a run whose task holds a placeholder on a RESERVED host runs (the re-scan agrees with the run\'s own input scan); on a real-looking host it is refused (exit 11, the same lines)', () => {
  for (const [host, status] of [['localhost', 0], [['db', 'internal'].join('.'), 11]]) {
    const dir = mkdtempSync(join(tmpdir(), 'thc-q1-')); made.push(dir);
    const rd = join(dir, 'runs', '2026-10-12T09-00-00-000Z');
    mkdirSync(join(dir, 'tasks')); mkdirSync(rd, { recursive: true });
    writeFileSync(join(dir, 'tasks', 't.md'), `Plan a small reading list app. Config: ${url(host)}\n`);
    writeFileSync(join(rd, 'run.json'), JSON.stringify({ chain: 'mock', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
    writeFileSync(join(rd, 'deliverable.md'), '# Plan\n\n## Decisions\n\nWe use SQLite.\n');
    writeFileSync(join(rd, 'report.json'), JSON.stringify({ passed: true, criteria: ['The plan names a data store.'] }));
    const r = spawnSync(process.execPath, [cli, 'handoff', '--from-run', join('runs', '2026-10-12T09-00-00-000Z'), '--chain', 'mock'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
    assert.equal(r.status, status, `${host}: ${r.stdout}${r.stderr}`);
    if (status === 11) { assert.match(r.stderr, /handoff: refused - the task file contains 1 credential-shaped string\(s\)/); assert.equal(existsSync(join(rd, 'HANDOFF.md')), false); }
    else assert.ok(existsSync(join(rd, 'HANDOFF.md')), `${host}: the handoff was written`);
  }
});
