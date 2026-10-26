// E142 (A3b, 18 Okt 2026; final wording of pass 2): the refusal for a price row that cannot be used says the COST cannot be projected against the spend cap (not that the cap "cannot hold" it), and a cap that is not a finite number
// is said as an unknown amount, never "$NaN". Offline, $0; the catalog is pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCouncilError } from '../src/errors.js';
import { formatUsd } from '../src/cost.js';

const base = { provider: 'openrouter', model: 'vendor/model', roles: 'builder' };

test('EF-1: an unusable price row under a cap: "its cost cannot be projected against the spend cap of $5.00", with the old "cannot hold it" gone from that sentence; the absent-row sentence keeps its own words', () => {
  const t = formatCouncilError('COUNCIL-E002', { ...base, problem: 'unusable', capUsd: 5 });
  assert.ok(t.includes('"openrouter/vendor/model" (builder) has an entry in src/pricing.json, but its price cannot be used (it must be two numbers, in and out, each zero or more), so its cost cannot be projected against the spend cap of $5.00. Nothing was sent and nothing was spent.'), t);
  assert.ok(!t.includes('cannot hold it'));
  // OLD (2ba3d10): the cap was formatted by a local helper with two decimals. NEW (C&C ruling): formatUsd, the one formatter every other screen uses, so one cap reads one way (a cap under $1 prints four decimals there).
  for (const capUsd of [0.5, 7, 12.345]) assert.ok(formatCouncilError('COUNCIL-E002', { ...base, problem: 'unusable', capUsd }).includes(`against the spend cap of ${formatUsd(capUsd)}.`), String(capUsd));
  const absent = formatCouncilError('COUNCIL-E002', { ...base, problem: 'missing', capUsd: 5 });
  assert.ok(absent.includes('has no listed price, so the spend cap of $5.00 cannot hold it:'), 'control: the absent-row sentence is unchanged');
});

test('EF-2: a cap that is not a finite number is said as an unknown amount in both capped sentences, never "$NaN"', () => {
  for (const capUsd of [NaN, Infinity, 'abc', '']) for (const problem of ['unusable', 'missing']) {
    const t = formatCouncilError('COUNCIL-E002', { ...base, problem, capUsd });
    assert.ok(!/\$NaN|\$Infinity/.test(t), `${problem} ${String(capUsd)}: ${t}`);
    assert.ok(t.includes(`the spend cap of ${formatUsd(capUsd)}`) && formatUsd(capUsd) === 'an unknown amount', `${problem} ${String(capUsd)}`);
  }
});

// E163b (A3b, 18 Okt 2026; final wording of pass 2). OLD/NEW/WHY: the example row's figures are said to be an example (a reader copied 1.0/4.0 as a real price); the README says the refusal's way out exists since 0.8.3 (the file did not exist in 0.8.2); the
// Known-limits bullet says which screens list the file's rows now (the side commands show the screen since E171/E177a; only `council tree start` does not); the MCP refusal's next step says WHO acts (a person) instead of an imperative in agent-read text.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = f => readFileSync(join(root, f), 'utf8');

test('EF-3: the three fix lines of the unpriced-seat refusal say the example figures are an example', () => {
  for (const problem of ['unusable', 'missing', undefined]) {
    const t = formatCouncilError('COUNCIL-E002', { ...base, problem, ...(problem === undefined ? {} : { capUsd: 5 }) });
    assert.ok(t.includes("(USD per million tokens; the figures are an example, not this model's price: check the lab's own price page)"), `${problem}: ${t}`);
  }
});

test('EF-4: README spend-cap sentence ("since 0.8.3, the way out") and Known-limits bullet (which screens list the file), and the MCP refusal names who acts', () => {
  const readme = text('README.md');
  assert.ok(readme.includes('(exit 5; the message names the seat and, since 0.8.3, the way out: add a row for it to `pricing.user.json`'));
  assert.ok(readme.includes("A run's limit screen, and the screen of a paid rematch, replay, handoff, contract draft or digest, lists the seats priced by that file, with their figures, so a low figure is visible before you type a limit; `council tree start` shows no such screen and uses the file's figure without saying so (`council doctor` and `--dry-run` list the file's rows)."));
  assert.ok(!readme.includes('the side commands (rematch, replay, handoff, digest, contract draft, tree start) show no such screen'));
  assert.ok(text('src/mcp/advice.js').includes("'The file is read once at server start: a person fixes or removes pricing.user.json in the project folder and restarts the server; a new quote can then be asked for.'"));
});
