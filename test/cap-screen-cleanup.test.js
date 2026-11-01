// The limit-screen cleanup (0.8.4 DUALCAP; Muad's yes, 1 Nov 2026): a per-cap limit screen (the caps switch on, start or raise) no longer carries the pricing.user.json
// paragraph or the host-preference paragraph; the dry run prints both (the price source already, as userPriceLines; the host preference now, as preferenceSentence).
// The screen with the switch off is unchanged, byte for byte (C2 pins its digest). Offline, $0: buildCapScreen is pure, and C3 drives the real CLI's --dry-run, which calls nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildCapScreen, ENFORCEMENT_SENTENCES, COMPLETION_SENTENCE } from '../src/cap-screen.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'qwen/qwen3.7-plus';   // a shipped OpenRouter row
const USER_PRICES = [{ key: `openrouter/${MODEL}`, in: 9, out: 9 }];
const PREFERENCES = [{ key: `openrouter/${MODEL}`, prefer: ['azure/us', 'wafer/mxfp4'] }];
const INPUT = { kind: 'run', subject: { chain: 'c', task: 't.md' }, notesMemory: 'the notes memory', estimate: { usd: 1.25 }, maximum: { usd: 3.5 }, priceAsOf: '2026-10-30', suggestion: { usd: 7, source: 'MAX_USD_PER_RUN' }, userPrices: USER_PRICES, preferences: PREFERENCES };
const GONE = [/Priced from pricing\.user\.json/, /Host preference \(/, /only as good as those figures/, /each host keeps its own listed price/];

test('C1 a per-cap limit screen (start and raise) leaves out the pricing.user.json and host-preference paragraphs; the title, the head, the figures, the "Not counted" line, the ask and the guardrail paragraph stay', () => {
  const start = buildCapScreen({ ...INPUT, cap: { id: 'openrouter', of: ['anthropic', 'openrouter'] } });
  for (const re of GONE) assert.doesNotMatch(start.text, re, start.text);
  assert.equal(start.fields.userPrices, null);
  assert.equal(start.fields.preferences, null);
  const lines = start.text.split('\n');
  assert.equal(lines[0], 'OPENROUTER spending limit (cap 2 of 2: anthropic, openrouter)');
  assert.equal(lines[1], 'Start this run? Chain: c. Task: t.md.');
  assert.ok(start.text.includes('Calls through openrouter, by the dry run\'s count at the prices of 2026-10-30: about '), start.text);
  assert.ok(start.text.includes('Not counted in either figure: the notes memory.'), start.text);
  assert.ok(start.text.includes('Your limit for openrouter: type the total, in US dollars,'), start.text);
  assert.ok(start.text.includes(ENFORCEMENT_SENTENCES[start.enforcement]), start.text);
  assert.ok(start.text.includes(COMPLETION_SENTENCE), start.text);
  const raise = buildCapScreen({ ...INPUT, kind: 'raise', cap: { id: 'openrouter', of: ['anthropic', 'openrouter'] }, history: { previousCapUsd: 5, spentUsd: 4.5, floorUsd: 4.5, suggestedUsd: 6 } });
  for (const re of GONE) assert.doesNotMatch(raise.text, re, raise.text);
});

test('C2 the screen with the switch off is byte for byte what it was, both paragraphs included (sha256 of the text from fixed inputs)', () => {
  const plain = buildCapScreen(INPUT);
  assert.ok(plain.text.includes('Priced from pricing.user.json') && plain.text.includes('Host preference ('), plain.text);
  assert.equal(createHash('sha256').update(plain.text).digest('hex'), 'f5e0b91abfe94970b9c30d4e343e92cda669cced7c8330f759fbef05290739ad', plain.text);
});

test('C3 the dry run (switch on, the real CLI, --dry-run) names the price source and the host preference, each once', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-screen-cleanup-'));
  mkdirSync(join(work, 'tasks')); mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'Plan a tiny change.\n');
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
  writeFileSync(join(work, 'chains', 'u.json'), JSON.stringify({ ...base, name: 'u', seats: { ...base.seats, criteria: { provider: 'openrouter', model: MODEL, maxTokens: 500 } } }));
  writeFileSync(join(work, 'pricing.user.json'), JSON.stringify({ [`openrouter/${MODEL}`]: { in: 9, out: 9 } }));
  writeFileSync(join(work, 'provider-preference.json'), JSON.stringify({ [`openrouter/${MODEL}`]: { prefer: ['azure/us', 'wafer/mxfp4'] } }));
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'u', '--task', 'tasks/x.md', '--dry-run'], { cwd: work, env: { PATH: process.env.PATH, HOME: work, COUNCIL_SPEND_CAPS: 'openrouter' }, encoding: 'utf8', timeout: 60_000 });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const count = re => (out.match(re) ?? []).length;
  assert.equal(count(/openrouter\/qwen\/qwen3\.7-plus: from pricing\.user\.json in your project folder/g), 1, out);
  assert.equal(count(/Host preference \(provider-preference\.json in your project folder\): openrouter\/qwen\/qwen3\.7-plus: azure\/us, wafer\/mxfp4\./g), 1, out);
});
