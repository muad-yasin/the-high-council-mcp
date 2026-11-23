// Mini unit, commit 1 (gate note addendum 1, C&C ruling of 16 Okt 2026): the default path's limits are DERIVED, not typed. (DL-1) the three places that declare the default per-run cap agree (the CLI constant, the Claude
// Desktop bundle's max_usd default, the Registry listing's MAX_USD_PER_RUN default), and every planning chain whose MAXIMUM or whose FLOOR (the dry run's cheapest end: one overseer round) is above that default
// says "above the default cap" with the dry run's own figures, in its description and in its README row. The Desktop bundle sets BOTH MAX_USD_PER_RUN and COUNCIL_MAX_USD_LIMIT from that one setting, so there $7 is a
// hard ceiling nobody can type above. (DL-2) what the proposal-ceiling lift does at the real cap: the same limit that let a 136,000-token proposal call through under the old 36,300 ceiling refuses it BEFORE the
// stage under the lifted ceiling (a stage-start refusal, not a mid-call overrun). Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryRunReport } from '../src/dry-run.js';
import { runChain, setBudget, setCache, BudgetExceeded } from '../src/chain.js';

afterEach(() => { setBudget(null); setCache(null); });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = f => readFileSync(join(root, f), 'utf8');
const money = n => `$${n.toFixed(2)}`;
// M7 apply (group 2 fix-up 2, 18 Okt 2026): the default lives in ONE module, src/default-cap.js (cli.js and the MCP server import it); this pin read it out of src/cli.js, where it no longer sits
const cliDefault = Number(/export const DEFAULT_MAX_USD = (\d+)/.exec(text('src/default-cap.js'))[1]);
const manifestDefault = JSON.parse(text('mcpb/manifest.json')).user_config.max_usd.default;
// A3b U1 (18 Okt 2026): the Claude Desktop bundle's default is its OWN figure, DESKTOP_DEFAULT_MAX_USD in the same module.
const desktopDefault = Number(/export const DESKTOP_DEFAULT_MAX_USD = (\d+)/.exec(text('src/default-cap.js'))[1]);
const registryDefault = Number(JSON.parse(text('server.json')).packages.flatMap(p => p.environmentVariables ?? []).find(v => v.name === 'MAX_USD_PER_RUN').default);
const PHRASE = `above the default cap of $${cliDefault}`; // derived, written the way the text writes it ($7, not $7.00): a stale "$7" after a change of the default must fail
const TIERS = ['plan-mini-council', 'plan-medium-council', 'plan-high-council'];   // 0.8.4 seats unit: plan-mini-council-sol-session retires (Muad 10 Nov 2026 01:10)
const figures = name => { const r = dryRunReport(JSON.parse(text(`chains/${name}.json`)), { defaultCapUsd: cliDefault }); return { exp: r.estimate.expectedUsd, max: r.estimate.maximumUsd, floor: r.estimate.floorUsd }; };
const descriptionOf = name => JSON.parse(text(`chains/${name}.json`)).description;
// README split (owner, 26 Okt 2026: "one final commit"): the section moved word for word to AI-README.md (the Which-chain table and the Claude Desktop paragraph); the row and the paragraph are read there.
const readmeRow = name => text('AI-README.md').split('\n').find(l => l.startsWith(`| \`${name}\` |`));

// CHANGED ACCEPTED TEST (A3b U1, 18 Okt 2026). OLD: the three declarations of the default per-run cap agreed (src/default-cap.js DEFAULT_MAX_USD, the mcpb manifest default, server.json). NEW: the registry listing still agrees with the CLI
// default, and the Claude Desktop bundle default is its own named figure (DESKTOP_DEFAULT_MAX_USD). WHY: Muad's pick 3 (18 Okt: "the Claude Desktop default spend ceiling goes from $7 to $10"); in the bundle the value also becomes COUNCIL_MAX_USD_LIMIT.
test('DL-1a: server.json MAX_USD_PER_RUN agrees with the CLI default (src/default-cap.js DEFAULT_MAX_USD), and the mcpb manifest default is DESKTOP_DEFAULT_MAX_USD', () => {
  assert.ok(Number.isFinite(cliDefault) && cliDefault > 0);
  assert.equal(registryDefault, cliDefault, 'the Registry listing default');
  assert.equal(manifestDefault, desktopDefault, 'the Claude Desktop bundle default (it also becomes COUNCIL_MAX_USD_LIMIT)');
});

test('DL-1c: the two defaults are two names (decoupling): the Desktop figure is read by nothing in src/ but its own module, the CLI and the MCP server read DEFAULT_MAX_USD, and the texts that name each say which', () => {
  assert.ok(Number.isFinite(desktopDefault) && desktopDefault > 0, 'a number of its own');
  const readers = [];
  const walk = d => { for (const n of readdirSync(join(root, d))) { const p = `${d}/${n}`; if (statSync(join(root, p)).isDirectory()) walk(p); else if (n.endsWith('.js') && text(p).includes('DESKTOP_DEFAULT_MAX_USD')) readers.push(p); } };
  walk('src');
  assert.deepEqual(readers, ['src/default-cap.js'], 'no code path follows the Desktop figure');
  assert.match(text('src/cli.js'), /import \{[^}]*\bDEFAULT_MAX_USD\b[^}]*\} from '\.\/default-cap\.js'/, 'the CLI imports the CLI default');
  assert.match(text('src/mcp/server.js'), /import \{[^}]*\bDEFAULT_MAX_USD\b[^}]*\} from '\.\.\/default-cap\.js'/, 'the MCP server imports the CLI default');
  assert.ok(text('mcpb/README.md').includes(`default $${desktopDefault} in the bundle)`), 'mcpb/README.md names both figures');
  const readme = text('AI-README.md');
  assert.ok(readme.includes(`(default $${desktopDefault} in the bundle; on the command line your limit is the number you type)`), 'AI-README.md Desktop paragraph names both figures');
  // FINDING (not on the owed list of the ladder unit; 10 Nov 2026, the default cap moves to $12 and the Desktop default with it). OLD bar: the 0.8.3 CHANGELOG line was pinned with the CURRENT Desktop figure (`$${desktopDefault} (0.8.3)`), so it moved whenever the figure moved. NEW bar: the 0.8.3 line keeps the $10 it announced (a released entry is history and is not edited), and the Unreleased entry names the current CLI and Desktop figures.
  assert.ok(text('CHANGELOG.md').includes('default spend ceiling for a new install is $10 (0.8.3)'), 'the 0.8.3 CHANGELOG line keeps its own figure');
  assert.ok(text('CHANGELOG.md').includes(`The default spending cap is $${cliDefault} (it was $7), and the Claude Desktop bundle's default spend ceiling for a new install is $${desktopDefault} (it was $10).`), 'the Unreleased CHANGELOG line names both current figures');
});

// NEW (0.8.4 apply, the README rework; the count rule of CLAUDE.md: a figure typed by hand is derived by a test). The README types the default cap in two places; the figure is the code's, and "(it was $7)" is the 0.8.3 default (the CHANGELOG pin above says the same).
test('DL-1e: the README names the default cap the code has: the "What\'s new in 0.8.4" line and the first run\'s suggested --max-usd', () => {
  const readme = text('README.md').replace(/\s+/g, ' ');
  assert.ok(readme.includes(`the default spending cap is $${cliDefault} (it was $7)`), 'the 0.8.4 line names the current default');
  assert.ok(readme.includes(`\`--max-usd ${cliDefault}\` puts $${cliDefault} there as the suggestion`), 'the first run suggests the default');
});

test('DL-1b: every planning chain whose maximum or floor is above the default cap says "above the default cap" with the dry run\'s figures, in its description and in its README row; the default chain\'s expected figure and floor fit under the default', () => {
  const said = [];
  for (const name of TIERS) {
    const f = figures(name);
    const over = f.max > cliDefault || f.floor > cliDefault;
    if (!over) continue;
    said.push(name);
    for (const [where, t] of [['description', descriptionOf(name)], ['README row', readmeRow(name)]]) {
      assert.ok(t.includes(PHRASE), `${name} ${where}: names "${PHRASE}"`);
      assert.ok(t.includes(money(f.max)), `${name} ${where}: carries the dry run's maximum ${money(f.max)}`);
      if (f.floor > cliDefault) assert.ok(t.includes(money(f.floor)), `${name} ${where}: carries the dry run's floor ${money(f.floor)} (cheapest end)`);
    }
  }
  // CHANGED ACCEPTED TEST (roster apply, 18 Okt 2026). OLD: plan-mini-council was among the chains above the default cap ($7.87 at most). NEW: its upper estimate is $5.27 and fits under the $7 default, so it is NOT in the scan; Medium and High still are. WHY: the accepted Mini roster (Astra's, Haiku on the subscription, one overseer round); the dry run decides, not a typed list.
  // CHANGED ACCEPTED TEST (0.8.4, the layer exchange loses its switch, 4 Nov 2026). OLD: `!said.includes('plan-mini-council')`: neither Mini chain was above the default cap ($6.27 and $5.79 at most), so the scan found Medium and High only. NEW: the scan finds
  // all four planning chains: the Mini chains are in it too ($16.86 and $26.97 at most), and the check above (inside the loop) then holds their description and their README row to the same sentence. The next assertion, the default chain's expected figure and floor
  // fit under the cap ($1.93 and $1.93), is unchanged. WHY: the exchange between the judges of a layer runs in every layered chain with unanimous sign-off, so the dry run prices it (seven rounds per pass in the upper estimate, one in the expected figure); the build's ruling of 4 Nov 2026
  // is that the seven-round maximum is printed wherever it applies, in true sentences. Whether the default chain should still start under its own cap is the owner's question, not this test's.
  // KEPT STRICTER (0.8.4 unit 4, rebased onto the tip, 4 Nov 2026; Mini-C&C's merge fact R201): OLD at the tip: `['plan-mini-council', 'plan-mini-council-sol-session', 'plan-medium-council', 'plan-high-council'].every(n => said.includes(n))`. NEW: the scan finds exactly the planning chains of TIERS, no more and no fewer. WHY: the upper estimate now includes a judge's re-asks and the automatic retries, so all four stay above the default cap (derived below, never typed), and a chain that fell out of the scan or a new one that joined it must fail here.
  assert.deepEqual(said.sort(), [...TIERS].sort(), `the scan found the chains above the default (${said.join(', ')})`);
  const d = figures('plan-mini-council');
  assert.ok(d.exp <= cliDefault && d.floor <= cliDefault, 'a first-time user can finish a normal run of the default chain under the default cap (expected and floor fit)');
});

test('DL-1c: a chain\'s description never says "above the default cap of $7" when neither its maximum nor its floor is above it (the phrase is derived, not decorative)', () => {
  for (const name of TIERS) {
    const f = figures(name);
    if (f.max <= cliDefault && f.floor <= cliDefault) assert.equal(descriptionOf(name).includes('above the default cap of'), false, name);
  }
});

// DL-1d (0.8.4 cap sentences, 11 Nov 2026). A hand-typed claim beside a regenerated figure, about which side of the default cap the expected figure or the cheapest end is on, must be true in BOTH directions. scripts/regen-derived-figures.mjs
// rewrites only the singular "expected figure ($X) fits under it" form and checks one direction; the plural "the expected figure ($X) and the cheapest end ($Y) fit under it" passed it, and two shipped chains were left saying it of an expected
// figure above the default cap. The scan is derived from the folder (the dry run decides, not a typed list) and the cap from src/default-cap.js. `capProblems` is a pure function so the same code reads the real files and the known-bad fixtures below.
const CONV = /and the expected figure \(\$[0-9][0-9,.]*\) are above|the upper estimate and the expected figure are above it|and expected figure \(\$[0-9][0-9,.]*\) are above/;   // the words that say the expected figure is above the cap
const capProblems = (name, where, t, { exp, floor }, cap) => {
  const out = [];
  if (exp > cap && /expected figure[^;]{0,200}\bfits? under\b/.test(t)) out.push(`${name} ${where}: says its expected figure fits under the default cap of $${cap}, but ${money(exp)} is above it`);
  if (floor > cap && /cheapest end[^;]{0,200}\bfits? under\b/.test(t)) out.push(`${name} ${where}: says its cheapest end fits under the default cap of $${cap}, but ${money(floor)} is above it`);
  if (exp <= cap && CONV.test(t)) out.push(`${name} ${where}: says its expected figure is above the default cap of $${cap}, but ${money(exp)} is not`);
  return out;
};
test('DL-1d: no planning chain description or AI-README row says anything about its expected figure or its cheapest end against the default cap that its dry run figures contradict', () => {
  const NAMES = readdirSync(join(root, 'chains')).filter(n => /^plan-.*\.json$/.test(n)).map(n => n.slice(0, -5)).sort();
  let checked = 0;
  for (const name of NAMES) {
    const f = figures(name);
    for (const [where, t] of [['description', descriptionOf(name)], ['README row', readmeRow(name)]]) {
      if (!t) continue;
      checked += 1;
      assert.deepEqual(capProblems(name, where, t, f, cliDefault), []);
    }
  }
  assert.ok(NAMES.length >= 7 && checked >= NAMES.length, `the scan read ${checked} texts of ${NAMES.length} chains`);
});
test('DL-1d-red: the checker FAILS on a plural "fit under" of an expected figure above the cap and on the words "the expected figure is above" for a figure that is not, and passes the true forms (its own red: no tree needed)', () => {
  const cap = cliDefault, over = cap + 2, under = cap - 3;
  const fitsPlural = `The upper estimate ($900.00) is above the default cap of $${cap}; the expected figure ($${over.toFixed(2)}) and the cheapest end ($${under.toFixed(2)}, one overseer round, the dry run's floor) fit under it.`;
  const formD = `The upper estimate ($900.00) and the expected figure ($${over.toFixed(2)}) are above the default cap of $${cap}; the cheapest end ($${under.toFixed(2)}, one overseer round, the dry run's floor) fits under it.`;
  const rowD = `Its upper estimate ($900.00) and expected figure ($${over.toFixed(2)}) are above the default cap of $${cap}; the cheapest end ($${under.toFixed(2)}) fits under it.`;
  assert.equal(capProblems('x', 'description', fitsPlural, { exp: over, floor: under }, cap).length, 1, 'plural fit-under of an expected figure above the cap');
  assert.equal(capProblems('x', 'description', formD, { exp: under, floor: under }, cap).length, 1, 'the words of an expected figure above the cap, on a chain whose expected figure is under it');
  assert.equal(capProblems('x', 'README row', rowD, { exp: under, floor: under }, cap).length, 1, 'the same for the AI-README row words');
  assert.deepEqual(capProblems('x', 'description', formD, { exp: over, floor: under }, cap), [], 'the words fit a chain whose expected figure is above the cap and whose cheapest end is not');
  assert.deepEqual(capProblems('x', 'README row', rowD, { exp: over, floor: under }, cap), [], 'the row words fit it too');
  assert.deepEqual(capProblems('x', 'description', `The upper estimate ($900.00) is above the default cap of $${cap}; the expected figure ($${under.toFixed(2)}) fits under it.`, { exp: under, floor: under }, cap), [], 'the words for an expected figure under the cap, true');
  assert.equal(capProblems('x', 'description', `The cheapest end ($${over.toFixed(2)}) fits under it.`, { exp: over, floor: over }, cap).length, 1, 'a cheapest end above the cap said to fit under it');
});

const REQUEST = 'Write a plan.';
async function proposalsRun(perPart, limitUsd) {
  setCache(null); setBudget(limitUsd);
  const stages = [];
  const config = { name: 'dl2', maxRounds: 1, proposals: { parts: 3, maxTokens: perPart }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' },
      proposers: [{ provider: 'mock', model: 'mock-priced', maxTokens: 136000, lab: 'p1' }], critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] } };
  try { await runChain({ request: REQUEST, log: () => {}, onStage: s => stages.push(s.label), runId: 'r-dl2', config }); return { stages }; }
  catch (err) { return { err, stages }; }
}

test('DL-2: the same $100 limit lets a 136,000-token proposal call through under the OLD 36,300 ceiling and refuses it BEFORE the stage under the lifted one (BudgetExceeded at stage start, nothing of the stage paid)', async () => {
  const old = await proposalsRun(12000, 100);
  assert.equal(old.err instanceof BudgetExceeded, false, String(old.err?.stack || ''));
  assert.ok(old.stages.some(l => /^propos/.test(l)), `the old ceiling (36,300 x $1000/M = $36.30) fits under $100 and the proposal call ran: ${old.stages.join(',')}`);
  const lifted = await proposalsRun(46000, 100);
  assert.ok(lifted.err instanceof BudgetExceeded, `the lifted ceiling (136,000 x $1000/M = $136) is refused: ${lifted.err ?? 'no error'}`);
  assert.equal(lifted.stages.some(l => /^propos/.test(l)), false, 'refused before the stage: no proposal stage was recorded');
});
