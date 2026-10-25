// maintainers/MODEL-CAPS.md is generated (0.8.2 item 9; the owner's idea of 7 Oct 2026): this test regenerates it from src/pricing.json, src/reasoning-table.json and chains/*.json and fails on ANY difference
// (the landing-page and skills-catalog pattern), so the file cannot drift from its sources. Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateModelCaps, maxOutputCell, OUT_FILE } from '../scripts/model-caps-report.mjs';

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
  // 0.8.3 (the 1017 unit, 23 Okt 2026; Muad: "Make sure DeepSeek V4.1 Flash is updated to version 1017 on our chains as well"): the 360,000 of advise-single-deepseek now sits on the row of the 1017 id; no shipped chain seats the undated id any more, so it has no row. CHANGED ACCEPTED (a): same check, the id that is seated.
  assert.match(text, /\| `openrouter\/deepseek\/deepseek-v4\.1-flash-1017` \|[^\n]*360,000/);
  // 23 Okt 2026 (the GLM lab-limit unit): the advice cap of GLM-5.3 Flash is the lab's 131,072 now; the check still pins that the advice chain is on the row with its cap.
  assert.match(text, /\| `openrouter\/z-ai\/glm-5\.3-flash` \|[^\n]*131,072 \(advice\): advise-single-glm-flash/);
});

test('the output-limit cell: a number prints as a number; a number WITH a note is marked as the owner\'s pick; null WITH a dated note says "no published limit"; null without a note stays "-" (the router listed none)', () => {
  assert.equal(maxOutputCell({ maxOutput: 131072 }), '131,072');
  assert.equal(maxOutputCell({ maxOutput: null, maxOutputNote: 'no output limit found on example.org; read 2026-10-23' }), 'no published limit found');
  assert.equal(maxOutputCell({ maxOutput: null }), '-');
  assert.equal(maxOutputCell({ maxOutput: 384000, maxOutputNote: "the owner's pick (2026-10-24), not a lab figure" }), "384,000 (owner's pick)");
  assert.ok(generateModelCaps(root).includes("| 384,000 (owner's pick) |"), 'the seated 0813 row shows the mark in MODEL-CAPS');
  assert.ok(generateModelCaps(root).includes('"no published limit found"'), 'the notes explain the wording');
});
