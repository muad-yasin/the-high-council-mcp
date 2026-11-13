// plan-claude-council (0.8.3; Muad 18 Okt 2026 13:59-14:04 named it; 0.8.4 seats unit, Muad 10 Nov 2026 01:23, "API keys by default": proposers Sonnet 5.5 + Opus 5.5 + Fable 5.2, layer 1 Haiku + Haiku + Sonnet, layer 2 Sonnet + Sonnet + Opus,
// layer 3 Fable 5.2 + Opus 5.5). The eleven model seats are direct Anthropic API seats; the six single seats (criteria, skeleton, builder, reviser, handoff, decider) stay external (a Claude Code session answers them). This file shows what a person
// gets from the file, offline and for $0: the dry run prices it, a start without a key stops at the key check before anything is sent. The runs go from a scratch folder with a bare environment, and every paid provider's key is a MALFORMED
// value (test/helpers/no-real-keys.js: a present value is never filled from the package's own .env, and a malformed one is never sent).
// CHANGED ACCEPTED TEST (0.8.4 seats unit): OLD bar: fifteen external seats, a dry run of $0.00 / $0.00, a start that pauses at the first external stage (exit 3), six judges, four labs. NEW bar: the seats above, the dry run's two figures
// (the ones the chain's description and the README print), a start that exits 5 at the missing-key check (the output of a real start, seen on the box), eight judges, four labs, and keys, row labels and row figures for the twin seats. WHY: the chain
// moved from the subscription to the API (the owner's pick), so every one of these facts moved with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { DEFAULT_CHAIN, PROMOTED_CHAINS } from '../src/chain-name.js';
import { panelLabCount, everySeatOf } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';
import { registerSeatKeys, seatKeyOf } from '../src/seat-key.js';
import { estimateChainRows, PREVIEW_READS_EXPECTED, PREVIEW_EXPECTED_CLIMB } from '../src/cost.js';
import { resolveRun } from '../src/resolve-run.js';
import { twinViolations, withTwinMaxTokens } from './helpers/twin-rows.js';
import { billingAccountOf } from '../src/caps.js';
import { isFreeProvider } from '../src/providers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const file = join(root, 'chains', 'plan-claude-council.json');
const chain = JSON.parse(readFileSync(file, 'utf8'));
const run = (cwd, args) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() }, encoding: 'utf8', timeout: 60_000 });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'pcc-')); mkdirSync(join(d, 'tasks')); return d; };

test('PCC-1: the single seats are external, the eleven model seats are Anthropic API seats at high, and it is not the default chain', () => {
  const singles = [chain.seats.criteria, chain.seats.skeleton, chain.seats.builder, chain.seats.reviser, chain.seats.handoff, chain.seats.decider];
  for (const s of singles) assert.equal(s.provider, 'external');
  const models = [...chain.seats.proposers, ...chain.seats.critics];
  assert.equal(models.length, 11);   // 3 proposers + 8 judges
  for (const s of models) { assert.equal(s.provider, 'anthropic'); assert.equal(s.extra?.output_config?.effort, 'high', `${s.persona}: high`); }
  assert.deepEqual(chain.seats.proposers.map(s => [s.persona, s.model]), [['Noah', 'claude-sonnet-5-5'], ['Husayn', 'claude-opus-5-5'], ['Abraham', 'claude-fable-5-2']]);
  const byLayer = l => chain.seats.critics.filter(s => s.layer === l).map(s => [s.persona, s.model]);
  assert.deepEqual(byLayer(1), [['Matthew', 'claude-haiku-5-5'], ['Van Gogh', 'claude-haiku-5-5'], ['Herbert', 'claude-sonnet-5-5']]);
  assert.deepEqual(byLayer(2), [['Plato', 'claude-sonnet-5-5'], ['da Vinci', 'claude-sonnet-5-5'], ['Moses', 'claude-opus-5-5']]);
  assert.deepEqual(byLayer(3), [['Melchizedek', 'claude-fable-5-2'], ['Karpathy', 'claude-opus-5-5']]);
  assert.equal(chain.seats.critics.length, 8);
  assert.equal(chain.seats.proposers.length, 3);
  assert.notEqual(DEFAULT_CHAIN, 'plan-claude-council');
  assert.equal(PROMOTED_CHAINS.includes('plan-claude-council'), false, 'it is not promoted');
  assert.deepEqual(lintChain(chain, file), [], 'the shipped file lints clean');
});

test('PCC-2: the dry run prints the two figures the description prints, and asks for no key', () => {
  const d = scratch(); const t = join(d, 't.md');
  writeFileSync(t, 'Plan a tiny CLI that prints the date.\n');
  const out = run(d, ['--chain', 'plan-claude-council', '--task', t, '--dry-run']);
  assert.equal(out.status, 0, out.stderr);
  const expected = chain.description.match(/\$([0-9.]+) expected/)[1], upper = chain.description.match(/an upper estimate of \$([0-9.]+)/)[1];
  assert.match(out.stdout, new RegExp(`TOTAL\\s.*\\$${expected.replace('.', '\\.')}\\s+per run\\s+\\(expected\\)`));
  // CHANGED ACCEPTED (label rename, 20 Okt 2026): OLD /MAXIMUM/ NEW /UPPER ESTIMATE/ - the printed row label only.
  assert.match(out.stdout, new RegExp(`UPPER ESTIMATE\\s.*\\$${upper.replace('.', '\\.')}\\s+per run`));
  // OLD (0.8.4 before the re-seat): /36 of 36 stages are answered by external seats/ (every seat external). NEW: only the single seats are external, six of the 44 stages the dry run counts. DERIVATION: 44 = the stages of the shape above; the six are the criteria, skeleton, build, revise, handoff and decider stages, one each.
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: 'rows that read the shipped chains\' old round fields'; 10 Nov 2026). OLD: 6 of 44 (the overseer shape's stage count). NEW: 34 of 275: the chain is a ladder chain, whose dry run prices the preview of top-layer reads; the 34 external stages are the criteria, skeleton, build, dispute and handoff (5) plus the revises: reads x (climb1 + climb2) + (reads - 1) = 29 for the preview's numbers (src/cost.js previewOfLadder), of the 275 stages the ladder preview counts. The bar is the value the box showed (tree 7d4d4ef7); the two figures above it passed there.
  // CHANGED ACCEPTED (0.8.4 apply, group 7, C&C RULING_STEP5_6 (PCC-2); figures printed in job 72's TAP, no src change since 0fa409f7). OLD: 34 of 275. NEW: 34 of 305, DERIVED here by term from the chain's own seat counts and the preview's numbers (the dry run sums the `times` of the EXPECTED rows, src/cli.js:1872-1873): the preview prices PREVIEW_READS_EXPECTED top-layer reads, each climbing
  // min(PREVIEW_EXPECTED_CLIMB, the chain's own ladder allowance) layer-1 and layer-2 passes and one layer-3 visit; every judge of a layer is asked once per pass of that layer, and a judge's exchange adds one debate row and one reply row on the same count (layer 1 B2, layers 2 and 3 S6): 3 families x the panel rows; plus the single stages (criteria, skeleton, build, handoff, and the dispute and
  // canary stages where the chain has them), three proposer rows each for the proposals, the debate and the reply, and the revises (reads x (climb 1 + climb 2) + (reads - 1)). The old 275 was this sum without the two upper layers' exchange rows (2 x (9 + 6) = 30 rows, S6): those rows are listed only while the short-exchange words are recorded (src/cost.js upperExchangeLayers, shortExchangeOn()), and they were recorded at dc60423a (job 106: this row is green at f60ebad2 and red from dc60423a), so the pin was written while they were still held.
  const reads = PREVIEW_READS_EXPECTED; const key = chain.ladder;
  const climb = { 1: Math.min(PREVIEW_EXPECTED_CLIMB[1], key.block * (key.visits + 1)), 2: Math.min(PREVIEW_EXPECTED_CLIMB[2], key.visits), 3: 1 };
  const judges = layer => chain.seats.critics.filter(k => k.layer === layer).length;
  const panelRows = [1, 2, 3].reduce((n, l) => n + judges(l) * reads * climb[l], 0);
  const revises = reads * (climb[1] + climb[2]) + (reads - 1);
  const singles = 3 + (chain.dispute?.enabled ? 1 : 0) + (chain.canary?.enabled ? 1 : 0) + (chain.handoff ? 1 : 0);   // criteria, skeleton, build
  const total = singles + 3 * chain.seats.proposers.length + revises + 3 * panelRows;
  const external = 3 + (chain.dispute?.enabled ? 1 : 0) + (chain.handoff ? 1 : 0) + revises;   // the writer-side seats are external: criteria, skeleton, build, dispute, handoff and every revise
  assert.match(out.stdout, new RegExp(`${external} of ${total} stages are answered by external seats`));
  assert.doesNotMatch(out.stdout + out.stderr, /missing|API_KEY/i);
});

// CHANGED ACCEPTED TEST (0.8.4 wiring unit, 10 Nov 2026): OLD bar: a start under malformed provider keys stopped at the KEY CHECK (exit 5, COUNCIL-E001 "The "anthropic" API key isn't set"). NEW bar: it stops one step earlier, at the route decision, with the SAME exit code (5, the code every lab's malformed
// key exits with) and another sentence: this helper makes the Anthropic key MALFORMED, and a malformed Anthropic key never routes silently (group 1's ruling, now wired): the sentence says the key is set but unusable and names both ways out. A start with NO Anthropic key still reaches the key check (the second case below).
// WHY: the key check says "isn't set" for a key that is set and broken, which is the wrong thing to tell the person; the route decision says which key and what to do. Nothing is started and no run folder is made either way.
test('PCC-3 (real verb): a start with a malformed Anthropic key stops at the route decision (exit 5 as before, naming the key and both ways out); a start with no Anthropic key at all stops at the key check (exit 5, COUNCIL-E001 naming the lab); neither starts a stage, writes a run folder or sends anything', () => {
  const d = scratch(); const t = join(d, 't.md');
  writeFileSync(t, 'Plan a tiny CLI that prints the date.\n');
  for (const extra of [[], ['--max-usd', '1000']]) {
    // zero-spend-ok: every provider key in this child's environment is malformed (test/helpers/no-real-keys.js: never filled from .env, never sent), the Anthropic key check stops the start before any stage, and the test asserts that stop
    const r = run(d, ['--chain', 'plan-claude-council', '--task', t, ...extra]);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.match(r.stderr, /ANTHROPIC_API_KEY is set, but/);
    assert.match(r.stderr, /--claude-route openrouter/);
    assert.match(r.stderr, /Nothing was started and nothing was spent\./);
    // no Anthropic key at all (blank, and no OpenRouter key either, or the route decision would speak first; the folder holds its own .env so the package's is never applied; the other providers' keys stay malformed): the route stays direct and the key check speaks, as before
    writeFileSync(join(d, '.env'), '# no keys here\n');
    const absent = spawnSync(process.execPath, [cli, '--chain', 'plan-claude-council', '--task', t, ...extra], { cwd: d, env: { PATH: process.env.PATH, HOME: d, ...malformedProviderKeys(), ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '' }, encoding: 'utf8', timeout: 60_000 });   // zero-spend-ok: every provider key in this child's environment is malformed or blank (test/helpers/no-real-keys.js), and the key check stops the start before any stage
    assert.equal(absent.status, 5, absent.stdout + absent.stderr);
    assert.match(absent.stdout + absent.stderr, /COUNCIL-E001/);
    assert.match(absent.stdout + absent.stderr, /The "anthropic" API key isn't set, so chain "plan-claude-council" can't call that lab/);
  }
  assert.equal(existsSync(join(d, 'runs')), false, 'no run folder: nothing was started');
});

test('PCC-4: one lab per MODEL (Muad 19 Okt, answer 2: a repeated model is one lab): no -lN / -p suffix, the same model carries the same lab on every seat, the three proposers keep three distinct labs (or their blind proposals would collapse into one), and the panel counts 4 labs for 4 models', () => {
  const modelSeats = [chain.seats.criteria, ...chain.seats.proposers, ...chain.seats.critics];
  const labOf = new Map();
  for (const s of modelSeats) { assert.ok(!/-(l[123]|p)$/.test(s.lab), `${s.lab}: a per-layer or per-role suffix`); assert.equal(labOf.get(s.model) ?? s.lab, s.lab, `${s.model} has two labs`); labOf.set(s.model, s.lab); }
  assert.equal(new Set(labOf.values()).size, labOf.size, 'two models share a lab');
  assert.equal(new Set(chain.seats.proposers.map(s => s.lab)).size, 3);
  assert.equal(panelLabCount(chain), 4);
});

test('PCC-5: the eight judges get eight distinct seat keys: the first seat of a model on its lowest layer is the bare lab, the next layer <lab>-l<layer>, and a second seat of one layer <lab>-l<layer>-<n>', () => {
  const c = structuredClone(chain);
  registerSeatKeys(c);
  const keys = c.seats.critics.map(s => [s.persona, seatKeyOf(s)]);
  assert.deepEqual(keys, [['Matthew', 'haiku5.5'], ['Van Gogh', 'haiku5.5-l1-2'], ['Herbert', 'sonnet5.5'], ['Plato', 'sonnet5.5-l2'], ['da Vinci', 'sonnet5.5-l2-2'], ['Moses', 'opus5.5'], ['Melchizedek', 'fable5.2'], ['Karpathy', 'opus5.5-l3']]);
  assert.equal(new Set(keys.map(k => k[1])).size, 8);
  assert.equal(new Set(chain.seats.critics.map(s => s.persona)).size, 8, 'a name per seat');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, the twin-row bar of C&C, 12 Nov, restated after jobs 105, 112, 113). OLD: "a twin seat's -2 row costs exactly what its sibling costs" (pick = [input, output, usd, times], equal): red from dc60423a (job 106: green at f60ebad2) because the twin's persona name ('Van Gogh' for 'Matthew', 'da Vinci' for 'Plato') is part of its system text and the name is longer: the row's input is already multiplied by its times, so the first
// error's 24 was ONE token per call over 24 times (jobs 72, 105). NEW, keeping the row's subject (a twin is priced like its sibling): for every twin row family in both modes (labels `-L<layer>-<lab>-2` with -reask, -reask3, -solo and -x<n>) the times, the output and the PRICE ROW (priceOf) are EXACTLY equal; every priced system-text variant of the twin equals its sibling's once each persona name is replaced by one placeholder; and the per-call input gap is DERIVED from the two persona names
// (test/helpers/twin-rows.js), not read off the estimator. WHY: the persona name is the one legitimate difference (printed: twin text = sibling text plus the name, +1 character on the haiku pair and +3 on the sonnet pair; no panel call sends a priced variant, so a spy cannot tell twins apart: jobs 112, 113). RED SOURCE (a test-side input): the same check on a clone whose twin has a different maxTokens fails on the output line (asserted below as a control; a seat's identity is its model, so the pairing stays).
test('PCC-6: every row label of the dry run is unique, expected and upper, and a twin seat\'s "-2" rows are priced like its sibling\'s: equal times, output and price row, equal variants once the persona names are removed, and an input gap derived from the two names', () => {
  for (const maximum of [false, true]) {
    const rows = estimateChainRows(structuredClone(chain), { maximum });
    const labels = rows.map(r => r.label);
    assert.equal(new Set(labels).size, labels.length, `${maximum ? 'upper' : 'expected'}: duplicate label ${labels.filter((l, i) => labels.indexOf(l) !== i).join(', ')}`);
    for (const [lab, layer] of [['haiku5.5', 1], ['sonnet5.5', 2]]) assert.ok(rows.some(r => r.label.includes(`-L${layer}-${lab}-2`)), `${lab}-2: rows exist on layer ${layer} (${maximum ? 'upper' : 'expected'})`);
  }
  const looseTwinRows = [false, true].reduce((n, maximum) => n + estimateChainRows(structuredClone(chain), { maximum }).filter(r => /-L\d+-[^-]+-2(-|$)/.test(r.label)).length, 0);
  const { violations, rowsChecked } = twinViolations(structuredClone(chain));
  assert.ok(rowsChecked > 0, 'twin rows were checked');
  assert.equal(rowsChecked, looseTwinRows, 'every row of a "-2" twin was examined (the pattern missed none)');
  assert.deepEqual(violations, [], 'every twin row family is priced like its sibling except for the persona name');
  // control (a test-side input): the haiku twin with a smaller maxTokens (4000) fails on an OUTPUT line of its rows and only on its own rows
  const bad = twinViolations(withTwinMaxTokens(chain, 'haiku5.5', 1));
  assert.ok(bad.violations.some(v => /^upper: .*-L1-haiku5\.5-2.*: output \d+ !== \d+$/.test(v)), `the control fails on an output line of the twin's rows in the upper figure: ${bad.violations.slice(0, 3).join(' | ')}`);
  assert.ok(bad.violations.every(v => /^(upper|expected): [^:]*-L1-haiku5\.5-2[^:]*: /.test(v)), `and only on the twin's own rows: ${bad.violations.filter(v => !/-L1-haiku5\.5-2/.test(v)).slice(0, 3).join(' | ')}`);
});

// ---- 0.8.4 SESSION SWITCH: the shipped chains on the session route (resolveRun, `session` chosen). Rows PCC-7..PCC-9. Offline, $0, nothing is sent: resolveRun only reads and converts. ----
// A hand table (the model of a Claude seat -> the session string it must become), not the function under test.
const SESSION_OF = { 'claude-sonnet-5-5': 'subscription:sonnet-5.5', 'claude-opus-5-5': 'subscription:opus-5.5', 'claude-fable-5-2': 'subscription:fable-5.2', 'claude-haiku-5-5': 'subscription:haiku-5.5' };
const session = (config, over = {}) => resolveRun(structuredClone(config), { flag: 'session', env: {}, ...over });
// The seat slots of a chain FILE, derived from the JSON itself (a single seat, a list, the descending map, preflight.seats, the default security reviewer), with the role names the harness prints: not the code under test.
const slotsOfFile = c => {
  const out = [];
  for (const [k, v] of Object.entries(c.seats ?? {})) {
    if (Array.isArray(v)) v.forEach((x, i) => { if (x) out.push({ role: `${k}[${i}]`, seat: x }); });
    else if (v && typeof v.provider === 'string') out.push({ role: k, seat: v });
    else if (v && typeof v === 'object' && k === 'descending') for (const [stage, x] of Object.entries(v)) if (x) out.push({ role: `descending.${stage}`, seat: x });
  }
  (c.preflight?.seats ?? []).forEach((x, i) => { if (x) out.push({ role: `preflight.seats[${i}]`, seat: x }); });
  if (c.security_review?.enabled === true && !c.seats?.security_reviewer) out.push({ role: 'security_reviewer (default)', seat: { provider: 'anthropic', model: 'claude-fable-5-1' } });
  return out;
};
const isClaudeSlot = x => x.seat.provider === 'anthropic' || /^anthropic\//.test(x.seat.model ?? '');
const isBillingSlot = x => x.seat.provider !== 'mock' && x.seat.provider !== 'external' && !isFreeProvider(x.seat.provider);

test('PCC-7 (session route): all 11 Claude API seats of the shipped chain convert (4 labs, twins keep their seat keys), the criteria seat (already external, lab opus5.5-sub) and the five other single seats are untouched, nothing still bills, the converted chain lints clean', () => {
  const r = session(chain);
  assert.equal(r.stop, undefined, r.message);
  assert.equal(r.route, 'session'); assert.equal(r.why, 'chosen');
  assert.equal(r.routed.length, 11, 'three proposers and eight judges');
  // the walk names a LIST slot by its key (no index): `proposers` three times and `critics` eight times
  assert.deepEqual(r.routed.map(x => x.slot).sort(), [...Array(3).fill('proposers'), ...Array(8).fill('critics')].sort());
  assert.equal(new Set(r.routed.map(x => x.lab)).size, 4, 'sonnet5.5, opus5.5, fable5.2, haiku5.5');
  for (const x of r.routed) { assert.equal(x.now, SESSION_OF[x.model], `${x.slot}: ${x.model}`); assert.equal(x.now.startsWith('subscription:'), true); }
  // every converted seat: external, the session string, nothing of the API call left, everything else as it was
  for (const key of ['proposers', 'critics']) {
    chain.seats[key].forEach((orig, i) => {
      const got = r.config.seats[key][i];
      const { extra, ...rest } = orig;
      assert.deepEqual(got, { ...rest, provider: 'external', model: SESSION_OF[orig.model] }, `${key}[${i}] ${orig.persona}`);
      assert.equal('extra' in got, false, `${key}[${i}]: the effort field is for an API call`);
      assert.equal(got.lab, orig.lab); assert.equal(got.persona, orig.persona); assert.equal(got.layer, orig.layer);
    });
  }
  // the single seats: the very same objects as in the unrouted chain, and equal to the file
  for (const k of ['criteria', 'skeleton', 'builder', 'reviser', 'handoff', 'decider']) {
    assert.equal(r.config.seats[k], r.unrouted.seats[k], `${k}: the very same object`);
    assert.deepEqual(r.config.seats[k], chain.seats[k], `${k}: as the file has it`);
  }
  assert.deepEqual([r.config.seats.criteria.provider, r.config.seats.criteria.model, r.config.seats.criteria.lab], ['external', 'subscription:opus-5.5', 'opus5.5-sub'], 'the criteria seat was external before conversion and is not renamed');
  // the money rule: a fully converted chain has no seat that bills, and says so
  assert.deepEqual(r.stillBilling, []);
  assert.deepEqual(everySeatOf(r.config).filter(x => billingAccountOf(x) !== null), []);
  assert.equal(everySeatOf(r.config).some(x => x.provider === 'anthropic'), false, 'no direct Anthropic seat is left');
  assert.equal(panelLabCount(r.config), 4, 'four labs on the panel, as on the API roster');
  // the input is never changed
  const input = structuredClone(chain); resolveRun(input, { flag: 'session', env: {} });
  assert.deepEqual(input, chain, 'resolveRun left its input as it was');
  // the twins keep their seat keys: the same keys as the API roster's, in every slot (PCC-5's eight, exactly)
  const api = structuredClone(chain); registerSeatKeys(api);
  const apiKeys = [...api.seats.proposers, ...api.seats.critics].map(seatKeyOf);
  const conv = structuredClone(r.config); registerSeatKeys(conv);
  assert.deepEqual([...conv.seats.proposers, ...conv.seats.critics].map(seatKeyOf), apiKeys);
  assert.deepEqual(conv.seats.critics.map(seatKeyOf), ['haiku5.5', 'haiku5.5-l1-2', 'sonnet5.5', 'sonnet5.5-l2', 'sonnet5.5-l2-2', 'opus5.5', 'fable5.2', 'opus5.5-l3']);
  // the lint: the converted chain says what the direct one does (nothing), and no cache finding
  const findings = lintChain(r.config, file);
  assert.deepEqual(findings, [], `the converted chain lints clean: ${findings.map(f => f.kind).join(', ')}`);
  assert.equal(findings.some(f => /cache/.test(f.kind)), false);
});

test('PCC-7b (session route): the same decision from the setting, from a dry run and under a malformed Anthropic key; no key is looked at', () => {
  for (const [what, over] of [
    ['the environment setting', { flag: undefined, env: { COUNCIL_CLAUDE_ROUTE: 'session' } }],
    ['a dry run', { dry: true }],
    ['a malformed Anthropic key and a malformed OpenRouter key', { env: { ANTHROPIC_API_KEY: 'sk-test-dummy\nkey', OPENROUTER_API_KEY: 'sk-test-dummy\nkey' } }],
    ['no key at all', { env: { ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '' } }],
  ]) {
    const r = session(chain, over);
    assert.equal(r.stop, undefined, `${what}: ${r.message}`);
    assert.equal(r.route, 'session', what); assert.equal(r.routed.length, 11, what); assert.deepEqual(r.stillBilling, [], what);
  }
});

// THE ADDED ROW OF C&C: on a shipped MIXED chain the Claude seats convert, the other seats are named as paid, and the cap is still asked (a paid seat remains, by billingAccountOf). The expected numbers come from the chain FILES (slotsOfFile), and a small table pins them as well.
const MIXED = { 'plan-high-council': [4, 11], 'plan-the-high-council': [4, 11], 'plan-medium-council': [3, 8], 'plan-mini-council': [2, 9], 'plan-claude-council': [11, 0] };
test('PCC-8 (session route): every shipped chain with Claude seats: those seats convert; the non-Claude seats that bill are named with role and provider; the spending limit is still asked exactly when a paid seat remains', () => {
  const names = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  assert.ok(names.length >= 20, `the chains folder is read: ${names.length} files`);
  const seen = [];
  for (const name of names) {
    const c = JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
    const slots = slotsOfFile(c);
    const claude = slots.filter(isClaudeSlot);
    if (claude.length === 0) continue;
    seen.push(name);
    const billing = slots.filter(x => !isClaudeSlot(x) && isBillingSlot(x));
    const r = session(c);
    assert.equal(r.stop, undefined, `${name}: ${r.message}`);
    assert.equal(r.route, 'session', name);
    assert.equal(r.routed.length, claude.length, `${name}: every Claude seat converts`);
    assert.deepEqual(r.routed.map(x => x.slot).sort(), claude.map(x => x.role.replace(/\[\d+\]$/, '')).sort(), `${name}: the converted slots (a list slot is named by its key)`);
    assert.deepEqual(r.stillBilling.map(x => `${x.role}|${x.provider}`).sort(), billing.map(x => `${x.role}|${x.seat.provider}`).sort(), `${name}: the seats that still bill, with role and provider`);
    // no Claude seat is left in the resolved roster; the paid seats that remain are exactly the named ones
    assert.equal(everySeatOf(r.config).some(x => x.provider === 'anthropic' || /^anthropic\//.test(x.model ?? '')), false, `${name}: no Claude seat is left`);
    const paid = everySeatOf(r.config).filter(x => billingAccountOf(x) !== null);
    assert.equal(paid.length, billing.length, `${name}: the cap is asked for exactly when something still bills`);
    if (billing.length) { assert.ok(paid.every(x => billingAccountOf(x) === 'openrouter'), `${name}: the remaining account`); assert.ok(r.stillBilling.every(x => x.provider === 'openrouter'), name); }
    // every named seat is one of the ones the file says bills
    for (const [role, provider] of billing.map(x => [x.role, x.seat.provider])) assert.ok(r.stillBilling.some(x => x.role === role && x.provider === provider), `${name}: ${role} is named`);
    // the lint says on the converted chain what it says on the direct one (RR-9's oracle), with the finding kinds in the message
    const chainFile = join(root, 'chains', `${name}.json`);
    assert.deepEqual(lintChain(r.config, chainFile), lintChain(c, chainFile), `${name}: the lint of the converted chain equals the direct chain's: ${lintChain(r.config, chainFile).map(f => f.kind).join(', ')}`);
    if (MIXED[name]) assert.deepEqual([claude.length, billing.length], MIXED[name], `${name}: the pinned counts`);
  }
  assert.deepEqual(seen.sort(), Object.keys(MIXED).sort(), 'the shipped chains that seat a Claude model: a new one needs its row here');
});

test('PCC-9 (session route): a shipped chain with no Claude seat is not a session run (no_claude_seat, nothing converted), whatever the keys are', () => {
  for (const name of ['plan-china-high-council', 'plan-china-medium-council', 'mock', 'mock-external', 'mock-security-review', 'local-ollama']) {
    const c = JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
    assert.equal(slotsOfFile(c).some(isClaudeSlot), false, `${name}: precondition, no Claude seat`);
    for (const env of [{}, { ANTHROPIC_API_KEY: 'sk-test-dummy\nkey' }, { ANTHROPIC_API_KEY: 'sk-test-dummy-key', OPENROUTER_API_KEY: 'sk-test-dummy-key' }]) {
      const r = session(c, { env });
      assert.equal(r.stop, undefined, `${name}: ${r.message}`);
      assert.equal(r.route, 'anthropic', name); assert.equal(r.why, 'no_claude_seat', name); assert.deepEqual(r.routed, [], name);
    }
  }
});
