// maintainers/MODEL-CAPS.md is generated (0.8.2 item 9; the owner's idea of 7 Oct 2026): this test regenerates it from src/pricing.json, src/reasoning-table.json and chains/*.json and fails on ANY difference
// (the landing-page and skills-catalog pattern), so the file cannot drift from its sources. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModelCaps, OUT_FILE } from '../scripts/model-caps-report.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('maintainers/MODEL-CAPS.md equals what the script writes from its sources (edit the sources, run node scripts/model-caps-report.mjs)', () => {
  assert.equal(readFileSync(join(root, OUT_FILE), 'utf8'), generateModelCaps(root), `${OUT_FILE} is stale: run node scripts/model-caps-report.mjs`);
});

test('every real model seated in a shipped chain has a row; a seat with no price row or no reasoning row is flagged, never skipped; the file says it is generated', () => {
  const text = readFileSync(join(root, OUT_FILE), 'utf8');
  assert.match(text, /^# Model caps \(GENERATED: edit the sources, then run the script/);
  const seen = new Set();
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (typeof n.provider === 'string' && typeof n.model === 'string' && !['mock', 'external'].includes(n.provider)) seen.add(`${n.provider}/${n.model}`);
    Object.values(n).forEach(walk);
  };
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')));
  assert.ok(seen.size > 10, 'found the shipped seats');
  for (const k of seen) assert.ok(text.includes(`| \`${k}\` |`), `${k} has no row`);
  // the seats the 0.8.2 chains rely on carry real figures
  assert.match(text, /\| `openrouter\/deepseek\/deepseek-v4\.1-flash` \|[^\n]*360,000/);
  assert.match(text, /\| `openrouter\/z-ai\/glm-5\.3-flash` \|[^\n]*360,000/);
});
