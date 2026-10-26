// The public price figures are claims about this repo (the landing-page test's reasoning): every expected and maximum figure the README and the landing page print for a chain is derived here from
// CHANGED ACCEPTED (label rename, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD the printed label "at most" / "MAXIMUM" / "Maximum:"; NEW "upper estimate" / "UPPER ESTIMATE" / "Upper estimate:". WHY: only the printed figure label moved; the held sentences (README/docs/chain descriptions) still say "at most" and their pins here are unchanged.
// the dry run itself, so a price change, a chain edit or a change to the maximum's definition turns this red until the text is updated (0.8.2 item 8c; owner 7 Oct 2026; C&C: "every new public number
// must come from a dry run the tests can re-derive"). Offline, $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { DEFAULT_MAX_USD, DESKTOP_DEFAULT_MAX_USD } from '../src/default-cap.js';
import { readChainFile } from './helpers/chain-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const page = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
const figures = name => { const r = dryRunReport(readChainFile(root, name), { defaultCapUsd: 7 }); return { exp: `$${r.estimate.expectedUsd.toFixed(2)}`, max: `$${r.estimate.maximumUsd.toFixed(2)}`, e: r.estimate.expectedUsd, m: r.estimate.maximumUsd }; };
// 0.8.3 (lane B), CHANGED ACCEPTED TEST: old bar = the table rows of cheap-7-v2, plan-premium-7, plan-highest-7 and plan-daily-7 carried derived figures; new bar = the three retired ones left the table (chains/outdated/), cheap-7-v2 left too (Muad's D1/D2 answers of 23 Okt 2026); the first-ten-minutes text below still names it until the new one-key chain's commit.
const CHAINS = ['plan-high-council', 'plan-medium-council', 'plan-mini-council', 'plan-mini-council-sol-session', 'plan-default-opro-council'];   // 0.8.3 (lane B, commit 2): the one-key chain's row joins

test('README: the table of recommended chains prints each chain\'s expected and maximum figure exactly as the dry run gives them', () => {
  for (const name of CHAINS) {
    const f = figures(name);
    const row = readme.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, name);
    assert.ok(row.trimEnd().endsWith(`| ${f.exp} / ${f.max} |`), `${name}: the row should end with "${f.exp} / ${f.max}", it is: ...${row.slice(-40)}`);
  }
  assert.match(readme, /\| Chain \| Who does what \| Needs \| Expected \/ upper estimate \|/);
  assert.ok(readme.split('\n').find(l => l.startsWith('| `local-ollama` |')).trimEnd().endsWith('| $0 / $0 |'));
});

// 0.8.3 (W, CR-4A-003, 25 Okt 2026), NEW TEST: the "cheapest end" printed under the $7 default cap is a figure the dry run gives (its floor), in the README row AND in the chain's own description (the README printed $6.74 against the description's generated $6.75).
test('plan-medium-council: the cheapest end the README row and the chain description print is the dry run\'s own floor', () => {
  const floor = dryRunReport(readChainFile(root, 'plan-medium-council'), { defaultCapUsd: 7 }).estimate.floorUsd;
  assert.ok(Number.isFinite(floor), 'the dry run gives a floor');
  const row = readme.split('\n').find(l => l.startsWith('| `plan-medium-council` |'));
  assert.ok(row.includes(`the cheapest end ($${floor.toFixed(2)})`), `the row should say "the cheapest end ($${floor.toFixed(2)})"`);
  assert.ok(readChainFile(root, 'plan-medium-council').description.includes(`the cheapest end, $${floor.toFixed(2)},`), 'the description says the same figure');
});

// 0.8.3 (lane B, commit 2), CHANGED ACCEPTED TEST (Muad 23 Okt 2026: cheap-7-v2 retires, the quick start names the new one-key chain and "--max-usd 10"): OLD = the example named cheap-7-v2's two figures and a cap just above its maximum; NEW = the example names plan-default-opro-council's two figures and the Claude Desktop default cap, which is above its expected figure and below its upper estimate (and the default cap of $7 is below the upper estimate, which is why the command names a cap at all).
test('README: the first-ten-minutes example names the expected and the upper figure of plan-default-opro-council and the Desktop default cap in the run command', () => {
  const f = figures('plan-default-opro-council');
  assert.ok(readme.includes(`\`plan-default-opro-council\` expects ${f.exp}, with an upper estimate of ${f.max}`), 'the sentence under step 4');
  assert.ok(readme.includes(`--chain plan-default-opro-council --max-usd ${DESKTOP_DEFAULT_MAX_USD}`), 'the command carries the Desktop default cap');
  assert.ok(f.e < DEFAULT_MAX_USD && f.m > DEFAULT_MAX_USD && f.e < DESKTOP_DEFAULT_MAX_USD && f.m > DESKTOP_DEFAULT_MAX_USD, `the text's claims hold: expected ${f.exp} under both caps, upper estimate ${f.max} above both`);
});

test('plan-default-opro-council: its description prints the dry run\'s own expected and upper-estimate figures (a public number the test can re-derive)', () => {
  const f = figures('plan-default-opro-council');
  const d = readChainFile(root, 'plan-default-opro-council').description;
  assert.ok(d.includes(`${f.exp} expected`) && d.includes(`an upper estimate of ${f.max}`), `the description should print ${f.exp} and ${f.max}`);
});

test('README: the retired chains no longer have bullets or table rows quoting figures (they are in chains/outdated/)', () => {
  for (const n of ['plan-daily-7', 'plan-lanes-4', 'plan-premium-7', 'plan-highest-7']) {
    assert.equal(readme.split('\n').some(l => l.startsWith(`| \`${n}\` |`)), false, `${n}: no table row`);
    assert.doesNotMatch(readme, new RegExp(`\\*\\*\`${n}\`\\*\\* -`), `${n}: no bullet`);
  }
});

test('landing page: the chain cards print each chain\'s expected and maximum figure, and say which side of the default cap the expected one is', () => {
  // 0.8.3 (lane B): the cheap-7-v2, plan-premium-7, plan-highest-7 and plan-daily-7 cards left the page with their chains (chains/outdated/).
  for (const n of ['cheap-7-v2', 'plan-premium-7', 'plan-highest-7', 'plan-daily-7']) assert.doesNotMatch(page, new RegExp(`>${n}</div>`), `${n}: no card`);
  const c = figures('plan-default-opro-council');
  assert.ok(page.includes(`it is expected to cost ${c.exp}, with an upper estimate of ${c.max}`));
  assert.ok(page.includes(`--chain plan-default-opro-council --max-usd ${DESKTOP_DEFAULT_MAX_USD}`));
});

test('no public text calls the expected figure a worst case any more', () => {
  assert.doesNotMatch(readme, /\$11\.22 worst case|worst-case price for your task|Worst case \|/);
  assert.doesNotMatch(page, /\$\d+\.\d\d worst case|worst-case price/);
});

// 0.8.3 (lane B, C&C ruling 23 Okt 2026; A-DRAFT): the README names the chains that "expect to cost more than the default cap". Lane E found the old hand-typed list omitted plan-medium-council ($7.16) and
// plan-high-council; the set is now DERIVED: every shipped chain with a real (non-mock) seat whose expected figure, from its own dry run, is above the default cap. The sentence must name exactly those.
test('README: the chains said to expect more than the default cap are exactly the shipped chains whose own expected figure is above it', () => {
  const over = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => {
    const cfg = readChainFile(root, n);
    const real = JSON.stringify(cfg.seats ?? {}).match(/"provider":"([a-z0-9-]+)"/g)?.some(x => !/"(mock|external)"/.test(x));
    return real && dryRunReport(cfg, { defaultCapUsd: DEFAULT_MAX_USD }).estimate.expectedUsd > DEFAULT_MAX_USD;
  }).sort();
  assert.ok(over.length >= 3, `the check can fail: some shipped chains are over the cap (${over})`);
  const m = readme.match(/((?:`[a-z0-9-]+`(?:,\s+| and\s+)?)+)\s+expect to cost more than the default cap/);
  assert.ok(m, 'the sentence is there');
  const named = [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map(x => x[1]).sort();
  assert.deepEqual(named, over, 'the README names exactly the chains whose expected figure is above the default cap');
  // TROUBLESHOOTING.md says it again (the hand-typed list there went stale the same way): it must name the same set, the one-key chain is named in its own sentence (its expected figure is under the cap), not in this list.
  const t = readFileSync(join(root, 'TROUBLESHOOTING.md'), 'utf8').match(/((?:`[a-z0-9-]+`(?:,\s+| and\s+)?)+)\s+expect more than the default \$7 cap/);
  assert.ok(t, 'the TROUBLESHOOTING sentence is there');
  const tNamed = [...t[1].matchAll(/`([a-z0-9-]+)`/g)].map(x => x[1]).sort();
  assert.deepEqual(tNamed, over, 'TROUBLESHOOTING names the same chains');
});
