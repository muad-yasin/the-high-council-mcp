// The dry run's two figures (0.8.2 item 8c; ChatGPT review 1 #5; owner 7 Oct 2026): EXPECTED (the chain's own assumed sizes, the typical output of a review; what worstCaseUsd has always held) and
// CHANGED ACCEPTED (label rename, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD the printed label "at most" / "MAXIMUM" / "Maximum:"; NEW "upper estimate" / "UPPER ESTIMATE" / "Upper estimate:". WHY: only the printed figure label moved; the held sentences (README/docs/chain descriptions) still say "at most" and their pins here are unchanged.
// MAXIMUM (every planned call at its whole output allowance, an Anthropic seat's one retry included, exactly as the spend cap's projection charges a call). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dryRunReport } from '../src/dry-run.js';
import { estimateChainRows, projectStage, worstCaseOf } from '../src/cost.js';
import { readChainFile } from './helpers/chain-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => readChainFile(root, name);

test('every shipped chain: maximum is at least expected, row by row, and the old field keeps its value', () => {
  for (const f of readdirSync(join(root, 'chains')).filter(n => n.endsWith('.json'))) {
    const c = chain(f.slice(0, -5));
    if (!c.seats) continue;
    const r = dryRunReport(c, { defaultCapUsd: 7 });
    assert.equal(r.estimate.worstCaseUsd, r.estimate.expectedUsd, `${f}: worstCaseUsd is the expected figure under its old name`);
    if (!f.startsWith('mock')) assert.ok(r.estimate.maximumUsd >= r.estimate.expectedUsd - 1e-9, `${f}: maximum ${r.estimate.maximumUsd} < expected ${r.estimate.expectedUsd}`);
    // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: the two passes plan the same calls (same row count). NEW: the maximum plans every call the expected figure plans, and its extra rows are only revise / conflict rows. WHY: a layered chain with ONE overseer round (plan-mini-council, plan-china-mini-council since
    // the accepted rosters) has no revise call in the expected plain-run shape (a clean climb: n - 1 = 0 revises) while its maximum allows revisions (every allowed revision used in the round), so the maximum has a revise-all row the expected pass does not; the equal-count invariant was only true while every layered chain had two or more rounds.
    const maxRows = estimateChainRows(c, { maximum: true });
    assert.ok(r.rows.every(row => maxRows.some(m => m.label === row.label)), `${f}: the maximum plans every call the expected figure plans`);
    assert.deepEqual(maxRows.filter(m => !r.rows.some(row => row.label === m.label)).map(m => m.label).filter(l => !/^(revise|conflict)/.test(l)), [], `${f}: the maximum's extra rows are only revise / conflict rows`);
    // The mock fixtures set caps far below their rows' typical sizes (mock-budget: 50 tokens): their expected rows exceed the cap, which no real chain does.
    if (!f.startsWith('mock')) for (const row of r.rows) if (row.priced) assert.ok(row.maximumUsd >= row.usd - 1e-9, `${f} ${row.label}`);
  }
});

test('the maximum is the cap\'s own projection: each planned call at its seat\'s whole output allowance, plus an Anthropic seat\'s one retry; a review uses panelMaxTokens', () => {
  const priced = { provider: 'mock', model: 'mock-priced' };
  const anthropic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 20000 };
  const config = {
    name: 't', maxRounds: 1, signoff: 'unanimous', criteria: ['It exists.'], estimate: { promptTokens: 1000, draftTokens: 2000, critiqueTokens: 500 },
    seats: { builder: { ...priced, maxTokens: 8000 }, reviser: { ...priced, maxTokens: 8000 }, finalist: null, critics: [{ ...priced, maxTokens: 30000, panelMaxTokens: 5000 }, anthropic] },
  };
  const max = estimateChainRows(config, { maximum: true });
  const build = max.find(r => r.label === 'build');
  assert.equal(build.output, 8000);
  assert.equal(build.usd, worstCaseOf('mock', 'mock-priced', { promptChars: build.input * 4, maxTokens: 8000 }).usd);
  const panelMock = max.find(r => r.label.startsWith('panel-1-mock'));
  assert.equal(panelMock.output, 5000, 'a review is asked for panelMaxTokens, not the seat\'s maxTokens');
  const panelAnthropic = max.find(r => r.label.startsWith('panel-1-anthropic'));
  assert.equal(panelAnthropic.output, 20000);
  assert.equal(panelAnthropic.usd, projectStage(anthropic, { user: 'x'.repeat(panelAnthropic.input * 4) }), 'first attempt plus the same-effort retry, as invoke() projects it');
  assert.ok(panelAnthropic.usd > worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: panelAnthropic.input * 4, maxTokens: 20000 }).usd, 'the retry is on top of the first attempt');
  // expected pricing is untouched by the new mode
  const exp = estimateChainRows(config);
  assert.deepEqual(exp.map(r => r.label), max.map(r => r.label));
  assert.ok(exp.find(r => r.label.startsWith('panel-1-mock')).output < 5000 || exp.find(r => r.label.startsWith('panel-1-mock')).output === 500, 'expected still prices the typical review output');
});

test('an external seat costs nothing in either figure; an unpriced seat adds nothing to either (it is the cap\'s blind spot, shown elsewhere)', () => {
  const config = { name: 't', maxRounds: 1, criteria: ['x'], seats: { builder: { provider: 'external' }, critics: [{ provider: 'mock', model: 'mock-unpriced-thing', maxTokens: 1000 }] } };
  const r = dryRunReport(config, {});
  assert.equal(r.estimate.maximumUsd, 0); assert.equal(r.estimate.expectedUsd, 0);
});

test('the JSON adds expectedUsd, maximumUsd, maximumWithTaskUsd and cap.maximumAboveDefault, and cheap-7-v2 (a retired chain, read from chains/outdated/ as a fixture) shows the gap the README used to hide', () => {
  const c = chain('cheap-7-v2');
  const r = dryRunReport(c, { defaultCapUsd: 7, taskChars: 80_000 });
  assert.equal(typeof r.estimate.maximumUsd, 'number');
  assert.ok(r.estimate.maximumWithTaskUsd > r.estimate.maximumUsd, 'an 80,000-character task raises the maximum');
  assert.equal(r.cap.maximumAboveDefault, true);
  assert.ok(r.estimate.maximumUsd > 1.5 * r.estimate.expectedUsd, `cheap-7-v2: maximum ${r.estimate.maximumUsd} should be well above expected ${r.estimate.expectedUsd}`);
  const none = dryRunReport(chain('mock'), { defaultCapUsd: 7 });
  assert.equal(none.cap.maximumAboveDefault, false);
});

test('the printed dry run shows both figures and says what each one is; the figures equal the JSON\'s', () => {
  const env = { PATH: process.env.PATH, HOME: '/tmp' };
  const out = spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'plan-medium-council', '--dry-run'], { encoding: 'utf8', env }).stdout;
  const json = JSON.parse(spawnSync(process.execPath, [join(root, 'src/cli.js'), '--chain', 'plan-medium-council', '--dry-run', '--json'], { encoding: 'utf8', env }).stdout);
  const fmt = n => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
  assert.match(out, new RegExp(`TOTAL .*${fmt(json.estimate.expectedUsd).replace('$', '\\$')} {2}per run {2}\\(expected\\)`));
  assert.match(out, new RegExp(`UPPER ESTIMATE .*${fmt(json.estimate.maximumUsd).replace('$', '\\$')} {2}per run {2}\\(every call at its whole output allowance\\)`));
  assert.match(out, /Upper estimate: every planned call writes its seat's whole output allowance/);
  assert.doesNotMatch(out, /Worst case is the full round cap/);
});

test('review fixes (item 8): first-mode critiques and dispute reviews call at maxTokens, only the unanimous panel at panelMaxTokens; a deep-dive Anthropic seat gets its retry in the maximum', () => {
  const priced = { provider: 'mock', model: 'mock-priced' };
  const critic = { ...priced, maxTokens: 30000, panelMaxTokens: 5000 };
  const first = estimateChainRows({ name: 't', maxRounds: 1, signoff: 'first', criteria: ['x'], seats: { builder: { ...priced, maxTokens: 8000 }, critics: [critic] } }, { maximum: true });
  assert.equal(first.find(r => r.label === 'critique-1').output, 30000, 'first mode asks for maxTokens, as chain.js does');
  const unanimous = estimateChainRows({ name: 't', maxRounds: 1, signoff: 'unanimous', criteria: ['x'], seats: { builder: { ...priced, maxTokens: 8000 }, critics: [critic] } }, { maximum: true });
  assert.equal(unanimous.find(r => r.label.startsWith('panel-1')).output, 5000);
  const anthropic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 20000 };
  const dd = estimateChainRows({ name: 't', maxRounds: 1, criteria: ['x'], estimate: { promptTokens: 1000, draftTokens: 2000, critiqueTokens: 500 }, deep_dive: { enabled: true, maxCalls: 1 }, seats: { builder: { ...priced, maxTokens: 100 }, deep_dive: anthropic, critics: [critic] } }, { maximum: true }).find(r => r.label.startsWith('deep-dive-anthropic'));
  assert.equal(dd.usd, projectStage(anthropic, { user: 'x'.repeat(dd.input * 4) }), 'first attempt plus the same-effort retry');
});
