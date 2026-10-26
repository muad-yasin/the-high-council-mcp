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
const TIERS = ['plan-mini-council', 'plan-mini-council-sol-session', 'plan-medium-council', 'plan-high-council'];
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
  assert.ok(text('CHANGELOG.md').includes(`default spend ceiling for a new install is $${desktopDefault} (0.8.3)`), 'the CHANGELOG line');
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
  assert.ok(said.includes('plan-medium-council') && said.includes('plan-high-council') && !said.includes('plan-mini-council'), `the scan found the chains above the default (${said.join(', ')})`);
  const d = figures('plan-mini-council');
  assert.ok(d.exp <= cliDefault && d.floor <= cliDefault, 'a first-time user can finish a normal run of the default chain under the default cap (expected and floor fit)');
});

test('DL-1c: a chain\'s description never says "above the default cap of $7" when neither its maximum nor its floor is above it (the phrase is derived, not decorative)', () => {
  for (const name of TIERS) {
    const f = figures(name);
    if (f.max <= cliDefault && f.floor <= cliDefault) assert.equal(descriptionOf(name).includes('above the default cap of'), false, name);
  }
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
