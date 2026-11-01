// PRICES lane unit 1 (1 Nov 2026): scripts/refresh-openrouter-prices.mjs records the host picture behind each OpenRouter row (`hosts`: date, count, lowest / median / highest input and output price, filters) and leaves
// the counted `in` / `out` alone. The script derives its root from its own path, so each test runs a COPY of it in a temp tree (the script, a small pricing.json and chains/) with fixture answers, offline, $0.
// The routing flag ("Not used in Standard routing") exists only as a divider row of the model page, so the page fixture below has the real markup shape (data-testid="routing-mode-divider", aria-label="Open <name> details",
// prices as `$0.45<span ...>000</span>`), taken from openrouter.ai/deepseek/deepseek-v4.1-flash-1017 read 2026-11-01.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join('scripts', 'refresh-openrouter-prices.mjs');

const ROWS = {
  asOf: '2026-10-23', _openrouterCheckedAt: '2026-10-25', _openrouterStaleDays: 45, _openrouterNote: 'old note',
  'openrouter/vendor/alpha': { in: 0.3, out: 1.2, _source: 'fixture' },
  'openrouter/vendor/beta': { in: 1, out: 2, _source: 'fixture' },
  'openrouter/vendor/promo': { in: 2, out: 4, expires: '2027-01-01', _source: 'fixture' },
  'anthropic/claude-x': { in: 3, out: 15, _source: 'fixture read 2026-10-23' },
};
const CHAIN = { seats: { critics: [{ provider: 'openrouter', model: 'vendor/alpha', maxTokens: 360000 }, { provider: 'openrouter', model: 'vendor/alpha', maxTokens: 393216 }, { provider: 'openrouter', model: 'vendor/beta', maxTokens: 8000 }] } };

// one endpoint as the endpoints API writes it (prices per token)
const ep = (provider, tag, inM, outM, maxc, extra = {}) => ({ provider_name: provider, tag, quantization: 'fp8', pricing: { prompt: String(inM / 1e6), completion: String(outM / 1e6) }, max_completion_tokens: maxc, context_length: 262144, service_tier: null, ...extra });
const ALPHA = [
  ep('Aaa', 'aaa/fp8', 0.1, 0.4, 400000),
  ep('Bbb', 'bbb', 0.2, 0.8, 400000),
  ep('Ccc', 'ccc/priority', 0.9, 3.6, 400000),           // a fast tier by tag: left out
  ep('Ddd', 'ddd', 0.3, 1.2, 100000),                    // cannot return 360000 tokens: left out
  ep('Eee', 'eee/us', 0.45, 1.8, 500000),                // the page marks it "Not used in Standard routing"
  ep('Fff', 'fff', 0.25, 1.0, null),                     // publishes no limit: counted
  ep('Ggg', 'ggg', 0.7, 2.8, 400000, { service_tier: 'flex' }),   // a flex tier by the answer's own field: left out
];
const cell = v => `<td class="or-table__cell text-right"><span class="tabular-nums text-foreground">$${v}<span aria-hidden="true" class="invisible select-none">000</span></span></td>`;
const prow = (name, i, o) => `<tr class="or-table__row"><th class="or-table__cell" scope="row"><button type="button" aria-label="Open ${name} details"><span class="truncate">${name}</span></button></th>${cell(i)}${cell(o)}${cell('0.009')}</tr>`;
const DIVIDER = label => `<tr class="or-table__row" data-testid="routing-mode-divider"><td class="or-table__cell" colSpan="7"><div><span>${label}</span></div></td></tr>`;
const page = (above, label, below) => `<html><body><table><tbody>${above.join('')}${label === null ? '' : DIVIDER(label)}${below.join('')}</tbody></table></body></html>`;
const ALPHA_PAGE = page([prow('Aaa', '0.1', '0.4'), prow('Bbb', '0.2', '0.8')], 'Not used in Standard routing:', [prow('Eee', '0.45', '1.80')]);

function tree({ endpoints = { 'vendor__alpha.json': { data: { endpoints: ALPHA } } }, pages = { 'vendor__alpha.html': ALPHA_PAGE }, rows = ROWS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rfp-hosts-'));
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'ep'));
  copyFileSync(join(root, SCRIPT), join(dir, SCRIPT));
  writeFileSync(join(dir, 'src', 'pricing.json'), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(join(dir, 'chains', 'fixture.json'), JSON.stringify(CHAIN));
  for (const [f, v] of Object.entries(endpoints)) writeFileSync(join(dir, 'ep', f), JSON.stringify(v));
  for (const [f, v] of Object.entries(pages)) writeFileSync(join(dir, 'ep', f), v);
  // the model list: every openrouter row at its own price (per token)
  const list = { data: Object.entries(rows).filter(([k]) => k.startsWith('openrouter/')).map(([k, v]) => ({ id: k.slice(11), pricing: { prompt: String(v.in / 1e6), completion: String(v.out / 1e6) } })) };
  writeFileSync(join(dir, 'models.json'), JSON.stringify(list));
  return dir;
}
const run = (dir, extra = ['--endpoints', 'ep', '--pages', 'ep', '--write']) => spawnSync(process.execPath, [SCRIPT, 'models.json', ...extra], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '2099-01-01' }, encoding: 'utf8' });
const rowsOf = dir => JSON.parse(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'));

test('RFH-1: the host picture is the eligible hosts only (tiers, the length bound and the page flag), per side lowest / median / highest; with --hosts-only the counted price is untouched', () => {
  const dir = tree();
  const r = run(dir, ['--endpoints', 'ep', '--pages', 'ep', '--hosts-only', '--write']);
  assert.equal(r.status, 0, r.stderr);
  const row = rowsOf(dir)['openrouter/vendor/alpha'];
  assert.deepEqual([row.in, row.out], [0.3, 1.2], 'hosts never moves the counted price');
  assert.equal(row._source, 'fixture');
  // eligible: Aaa, Bbb, Fff (Ccc and Ggg are tiers, Ddd is too short, Eee is under the page divider)
  assert.equal(row.hosts.checked, '2099-01-01');
  assert.equal(row.hosts.count, 3);
  assert.equal(row.hosts.providers, 3);
  assert.deepEqual(row.hosts.in, { low: 0.1, median: 0.2, high: 0.25 });
  assert.deepEqual(row.hosts.out, { low: 0.4, median: 0.8, high: 1 });
  assert.equal(row.hosts.filters.length, 5);
  assert.match(row.hosts.filters[3], /counts in this host picture at its dearest figure/);
  assert.match(row.hosts.filters[4], /Open Inference included/);
  assert.match(row.hosts.filters[0], /tiers left out \(2 host\(s\)\)/);
  assert.match(row.hosts.filters[1], /at least 360000 tokens.*1 host\(s\) left out; 1 publish no limit and are counted/);
  assert.match(row.hosts.filters[2], /1 host\(s\) the page marks "Not used in Standard routing" left out/);
  assert.match(r.stdout, /vendor\/alpha: file 0\.3\/1\.2 -> 0\.25\/1  dearest eligible host 0\.25\/1 \(input\/output per Mtok; 3 hosts; lowest 0\.1\/0\.4, median 0\.2\/0\.8; dearest: fff fp8 ctx 262144\)  LOWERED NOT APPLIED \(--hosts-only\)  evidence vendor__alpha\.json/);
});

test('RFH-2: every other row stays byte-identical (a row without an answer, a row with `expires`, a direct row, the header keys), and a second run replaces the block instead of stacking it', () => {
  const dir = tree();
  const before = rowsOf(dir);
  assert.equal(run(dir).status, 0);
  const first = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const after = JSON.parse(first);
  for (const k of ['openrouter/vendor/beta', 'openrouter/vendor/promo', 'anthropic/claude-x']) assert.deepEqual(after[k], before[k], `${k} unchanged`);
  assert.equal(after._openrouterCheckedAt, '2099-01-01');
  assert.equal(first.split('"hosts"').length - 1, 1, 'one hosts block');
  assert.equal(run(dir).status, 0);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), first, 'the same input twice gives the same bytes');
  // the text outside the alpha row is the original text, character for character
  const orig = `${JSON.stringify(before, null, 2)}\n`;
  const cut = s => s.slice(s.indexOf('"openrouter/vendor/beta"'));
  assert.equal(cut(first), cut(orig));
});

test('RFH-3: an unreadable routing flag never drops a host: no page, a divider with another label, a row that matches two hosts, a row that matches none', () => {
  const noPage = tree({ pages: {} });
  assert.equal(run(noPage).status, 0);
  let h = rowsOf(noPage)['openrouter/vendor/alpha'].hosts;
  assert.equal(h.count, 4, 'Eee is counted when the page is not given');
  assert.deepEqual(h.out, { low: 0.4, median: 0.9, high: 1.8 });   // (0.8 + 1.0) / 2
  assert.match(h.filters[2], /routing flag not read \(no page given\)/);

  const other = tree({ pages: { 'vendor__alpha.html': page([prow('Aaa', '0.1', '0.4')], 'Not used in Fast routing:', [prow('Eee', '0.45', '1.80')]) } });
  assert.equal(run(other).status, 0);
  h = rowsOf(other)['openrouter/vendor/alpha'].hosts;
  assert.equal(h.count, 4);
  assert.match(h.filters[2], /routing flag not read \(the page has a routing divider with another label\)/);

  // two endpoints of one provider at one price: the page row cannot say which one it means, so both stay
  const twins = [...ALPHA, ep('Eee', 'eee/fp8', 0.45, 1.8, 500000)];
  const two = tree({ endpoints: { 'vendor__alpha.json': { data: { endpoints: twins } } } });
  assert.equal(run(two).status, 0);
  h = rowsOf(two)['openrouter/vendor/alpha'].hosts;
  assert.equal(h.count, 5, 'both Eee hosts are counted');
  assert.match(h.filters[2], /0 host\(s\).*1 page row\(s\) could not be matched to one host and their hosts stay counted/);

  const none = tree({ pages: { 'vendor__alpha.html': page([], 'Not used in Standard routing:', [prow('Zzz', '9.99', '9.99')]) } });
  assert.equal(run(none).status, 0);
  assert.equal(rowsOf(none)['openrouter/vendor/alpha'].hosts.count, 4);
});

test('RFH-4: an even count takes the mean of the two middle prices per side; a page with no divider says so and leaves every host in', () => {
  const four = [ep('A', 'a', 0.1, 1, 400000), ep('B', 'b', 0.2, 2, 400000), ep('C', 'c', 0.4, 5, 400000), ep('D', 'd', 0.9, 9, 400000)];
  const dir = tree({ endpoints: { 'vendor__alpha.json': { data: { endpoints: four } } }, pages: { 'vendor__alpha.html': page([prow('A', '0.1', '1')], null, []) } });
  assert.equal(run(dir).status, 0);
  const h = rowsOf(dir)['openrouter/vendor/alpha'].hosts;
  assert.deepEqual(h.in, { low: 0.1, median: 0.3, high: 0.9 });
  assert.deepEqual(h.out, { low: 1, median: 3.5, high: 9 });
  assert.match(h.filters[2], /no "Not used in Standard routing" divider/);
});

test('RFH-5: a dry run writes nothing; --fetch into the repository is refused before any network read', () => {
  const dir = tree();
  const before = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const dry = run(dir, ['--endpoints', 'ep', '--pages', 'ep']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\(dry: 1 row\(s\) would change, 1 host picture\(s\) would be written; pass --write\)/);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), before);
  const inside = run(dir, ['--fetch', join(dir, 'saved')]);
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /refused: --fetch .* is inside the repository/);
});

test('RFH-6: a page row whose host is already out by tier is not reported as unmatched; a model with no eligible host says so, gets no block and is not an error', () => {
  const pg = page([prow('Aaa', '0.1', '0.4')], 'Not used in Standard routing:', [prow('Ccc', '0.9', '3.6')]);
  const dir = tree({ pages: { 'vendor__alpha.html': pg } });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const h = rowsOf(dir)['openrouter/vendor/alpha'].hosts;
  assert.ok(!/could not be matched/.test(h.filters[2]), h.filters[2]);
  assert.equal(h.count, 4, 'Eee is counted: this page does not flag it');

  const short = tree({ endpoints: { 'vendor__alpha.json': { data: { endpoints: [ep('Ddd', 'ddd', 0.3, 1.2, 100000)] } } } });
  const s = run(short);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /vendor\/alpha: .*NO ELIGIBLE HOST: 1 endpoint\(s\) listed, 1 outside the fast tiers, 0 able to return 360000 tokens/);
  assert.equal(rowsOf(short)['openrouter/vendor/alpha'].hosts, undefined);
});

test('RFH-7: --hosts-only writes the host blocks and nothing else: a row the list prices higher is not raised, no _source line is added and _openrouterCheckedAt does not move', () => {
  const dir = tree();
  const list = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
  list.data.find(m => m.id === 'vendor/beta').pricing = { prompt: String(5 / 1e6), completion: String(9 / 1e6) };   // beta's headline is far above its row
  writeFileSync(join(dir, 'models.json'), JSON.stringify(list));
  const r = run(dir, ['--endpoints', 'ep', '--pages', 'ep', '--hosts-only', '--write']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /vendor\/beta: .*RAISE NOT APPLIED \(--hosts-only\)/);
  const t = rowsOf(dir);
  assert.deepEqual(t['openrouter/vendor/beta'], ROWS['openrouter/vendor/beta'], 'beta is byte-for-byte what it was');
  assert.equal(t._openrouterCheckedAt, '2026-10-25', 'the stamp stays');
  assert.equal(t['openrouter/vendor/alpha'].hosts.checked, '2099-01-01', 'the block carries its own date');
  assert.deepEqual([t['openrouter/vendor/alpha'].in, t['openrouter/vendor/alpha'].out], [0.3, 1.2]);
  // without the flag the same input raises beta and moves the stamp (the control)
  const plain = tree(); writeFileSync(join(plain, 'models.json'), JSON.stringify(list));
  assert.equal(run(plain).status, 0);
  assert.equal(rowsOf(plain)['openrouter/vendor/beta'].in, 5);
  assert.equal(rowsOf(plain)._openrouterCheckedAt, '2099-01-01');
});

test('RFH-8: an endpoint\'s own service_tier excludes it only when it is one of the fast-tier words; "standard", "default" or a word not seen yet stays counted', () => {
  const eps = [ep('Aaa', 'aaa', 0.1, 0.4, 400000), ep('Std', 'std', 0.2, 0.8, 400000, { service_tier: 'standard' }), ep('Def', 'def', 0.3, 1.2, 400000, { service_tier: 'default' }),
    ep('Pri', 'pri', 0.9, 3.6, 400000, { service_tier: 'priority' }), ep('Flx', 'flx', 0.8, 3.2, 400000, { service_tier: 'Flex' }), ep('Ult', 'ult', 0.7, 2.8, 400000, { service_tier: 'ultrafast' }), ep('New', 'new', 0.6, 2.4, 400000, { service_tier: 'turbo' })];
  const dir = tree({ endpoints: { 'vendor__alpha.json': { data: { endpoints: eps } } }, pages: {} });
  assert.equal(run(dir).status, 0);
  const h = rowsOf(dir)['openrouter/vendor/alpha'].hosts;
  assert.equal(h.count, 4, 'Aaa, Std, Def and the unknown "turbo" stay; priority, Flex and ultrafast go');
  assert.deepEqual(h.in, { low: 0.1, median: 0.25, high: 0.6 });
  assert.match(h.filters[0], /tiers left out \(3 host\(s\)\)/);
});

test('RFH-9: a page that has no endpoints table at all is "routing flag not read", never "no host is marked"; a page with the table and no divider still says so', () => {
  const dir = tree({ pages: { 'vendor__alpha.html': '<html><body><p>The model page changed its layout.</p></body></html>' } });
  assert.equal(run(dir).status, 0);
  const h = rowsOf(dir)['openrouter/vendor/alpha'].hosts;
  assert.equal(h.count, 4, 'Eee stays counted');
  assert.match(h.filters[2], /routing flag not read \(the page shows no endpoints table\)/);
  assert.ok(!/no host is marked|shows no "Not used/.test(h.filters[2]));
});

test('RFH-10: a block is dated with the day the answers were READ (the folder\'s _fetch.json), never today; a folder without that stamp is refused by --write and writes nothing', () => {
  const dir = tree();
  const before = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const bare = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--hosts-only', '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });
  assert.equal(bare.status, 2, bare.stdout + bare.stderr);
  assert.match(bare.stderr, /has no _fetch\.json .* the day these answers were read is unknown\. Nothing was written/);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), before);
  writeFileSync(join(dir, 'ep', '_fetch.json'), JSON.stringify({ fetchedAt: '2026-10-20T08:00:00.000Z' }));
  const stamped = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--hosts-only', '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });
  assert.equal(stamped.status, 0, stamped.stderr);
  assert.equal(rowsOf(dir)['openrouter/vendor/alpha'].hosts.checked, '2026-10-20', 'the day of the stamp, not today');
});

// ---- unit 2: the counted price is the dearest eligible host, in both directions ----
const GAMMA = [ep('Ggg', 'ggg/fp4', 0.4, 1.6, 400000, { quantization: 'fp4', context_length: 131072 }), ep('Hhh', 'hhh', 0.9, 3.0, 400000)];
function tree2() {
  const rows = { ...ROWS, 'openrouter/vendor/gamma': { in: 0.05, out: 0.2, _source: 'fixture gamma' } };
  const dir = tree({ rows, endpoints: { 'vendor__alpha.json': { data: { endpoints: ALPHA } }, 'vendor__gamma.json': { data: { endpoints: GAMMA } } } });
  return dir;
}
const today = () => new Date().toISOString().slice(0, 10);
const runToday = (dir, extra = []) => { writeFileSync(join(dir, 'ep', '_fetch.json'), JSON.stringify({ fetchedAt: new Date().toISOString() })); return spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', ...extra, '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' }); };

test('RFU-1: --write sets each row to exactly the dearest eligible host, lowering a dear row and raising a cheap one, with a dated _source line, the evidence file and the stamp date', () => {
  const dir = tree2();
  const r = runToday(dir);
  assert.equal(r.status, 0, r.stderr);
  const t = rowsOf(dir);
  assert.deepEqual([t['openrouter/vendor/alpha'].in, t['openrouter/vendor/alpha'].out], [0.25, 1], 'alpha 0.3/1.2 -> its dearest eligible host');
  assert.deepEqual([t['openrouter/vendor/gamma'].in, t['openrouter/vendor/gamma'].out], [0.9, 3], 'gamma 0.05/0.2 -> its dearest eligible host');
  assert.match(t['openrouter/vendor/alpha']._source, /^fixture; openrouter\.ai\/api\/v1\/models\/vendor\/alpha\/endpoints and the model page, read \d{4}-\d{2}-\d{2}: counted price set to the dearest eligible host 0\.25\/1\.0 per Mtok \(3 hosts\), was 0\.3\/1\.2$/);
  assert.match(r.stdout, /vendor\/alpha: .*LOWERED {2}evidence vendor__alpha\.json/);
  assert.match(r.stdout, /vendor\/gamma: .*RAISED {2}evidence vendor__gamma\.json/);
  assert.match(r.stdout, /1 raised, 1 lowered/);
  assert.equal(t._openrouterCheckedAt, today(), 'the date is the day the answers were read');
  assert.match(t._openrouterNote, /dearest eligible host per side, raised or lowered/);
  for (const k of ['openrouter/vendor/beta', 'openrouter/vendor/promo', 'anthropic/claude-x']) assert.deepEqual(t[k], ROWS[k], `${k} unchanged`);
});

test('RFU-2: counted prices are refused from answers that were not read today (a host\'s price moves within a day): exit 2, nothing written; --hosts-only is not refused', () => {
  const dir = tree2();
  writeFileSync(join(dir, 'ep', '_fetch.json'), JSON.stringify({ fetchedAt: '2020-01-01T00:00:00.000Z' }));
  const before = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const old = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });
  assert.equal(old.status, 2, old.stdout + old.stderr);
  assert.match(old.stderr, /the answers were read on 2020-01-01, not today \(\d{4}-\d{2}-\d{2}\)/);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), before);
  const hostsOnlyRun = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--hosts-only', '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });
  assert.equal(hostsOnlyRun.status, 0, hostsOnlyRun.stderr);
  assert.equal(rowsOf(dir)['openrouter/vendor/alpha'].hosts.checked, '2020-01-01');
});

test('RFU-3: a row with no host picture keeps the old rule (raised to the list\'s headline when 5% below it, never lowered) and is named as such', () => {
  const rows = { ...ROWS, 'openrouter/vendor/beta': { in: 1, out: 2, _source: 'fixture' } };
  const dir = tree({ rows });
  const list = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
  list.data.find(m => m.id === 'vendor/beta').pricing = { prompt: String(5 / 1e6), completion: String(1 / 1e6) };   // input far above the row, output below it
  writeFileSync(join(dir, 'models.json'), JSON.stringify(list));
  const r = runToday(dir);
  assert.equal(r.status, 0, r.stderr);
  const beta = rowsOf(dir)['openrouter/vendor/beta'];
  assert.deepEqual([beta.in, beta.out], [5, 2], 'input raised to the headline, output never lowered');
  assert.match(beta._source, /raised from 1\/2 \(the cap was projecting less than the list\)/);
  assert.ok(!/evidence/.test(r.stdout.split('\n').find(l => l.startsWith('vendor/beta'))), 'no host evidence for a row without a picture');
});

test('RFU-4: --list-hosts prints every endpoint with its precision, context length and output limit, and why one is left out', () => {
  const dir = tree2();
  const r = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--list-hosts'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '2099-01-01' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /vendor\/gamma {2}ggg\/fp4 +fp4 +ctx 131072 +max 400000 +0\.4\/1\.6\n/);
  assert.match(r.stdout, /vendor\/alpha {2}ccc\/priority .* OUT: fast tier/);
  assert.match(r.stdout, /vendor\/alpha {2}ddd .* max 100000 .* OUT: output limit 100000 < 360000/);
  assert.match(r.stdout, /vendor\/alpha {2}eee\/us .* OUT: page: Not used in Standard routing/);
  assert.match(r.stdout, /vendor\/alpha {2}fff .* max unpublished /);
});

test('RFU-5: a TIER-DRIVEN row (the dearest prompt-size tier gives another figure than the base prices) is HELD at today\'s figure and marked in its block; the host picture still records the dearest tier, and a host-driven row beside it is applied', () => {
  const eps = [ep('Tiered', 'tiered', 0.1, 0.5, 400000, { pricing: { prompt: String(0.1 / 1e6), completion: String(0.5 / 1e6), overrides: [{ min_prompt_tokens: 100000, prompt: String(0.5 / 1e6), completion: String(2.5 / 1e6) }] } }), ep('Plain', 'plain', 0.2, 0.9, 400000)];
  const rows = { ...ROWS, 'openrouter/vendor/gamma': { in: 0.05, out: 0.2, _source: 'fixture gamma' } };
  const dir = tree({ rows, endpoints: { 'vendor__alpha.json': { data: { endpoints: eps } }, 'vendor__gamma.json': { data: { endpoints: GAMMA } } }, pages: {} });
  const r = runToday(dir);
  assert.equal(r.status, 0, r.stderr);
  const t = rowsOf(dir);
  assert.deepEqual([t['openrouter/vendor/alpha'].in, t['openrouter/vendor/alpha'].out], [0.3, 1.2], 'the tier part is held, and the base-price dearest host (0.2/0.9) is below today\'s figure');
  assert.equal(t['openrouter/vendor/alpha'].hosts.tier_driven, true);
  assert.deepEqual(t['openrouter/vendor/alpha'].hosts.in, { low: 0.2, median: 0.35, high: 0.5 }, 'the picture still records the dearest tier');
  assert.match(r.stdout, /vendor\/alpha: file 0\.3\/1\.2 HELD \(tier part: the dearest tier is 0\.5\/2\.5: no single figure prices it right; the tier is recorded in the row's tiers and not yet counted; the base-price dearest host is 0\.2\/0\.9, not above today's figure\)/);
  assert.deepEqual([t['openrouter/vendor/gamma'].in, t['openrouter/vendor/gamma'].out], [0.9, 3], 'a host-driven row beside it is applied');
  assert.equal(t['openrouter/vendor/gamma'].hosts.tier_driven, undefined);
  assert.doesNotMatch(t['openrouter/vendor/alpha']._source, /counted price set/, 'a held row gets no _source line');
  const l = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--list-hosts'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '2099-01-01' }, encoding: 'utf8' });
  assert.match(l.stdout, /tiered +fp8 +ctx 262144 +max 400000 +0\.5\/2\.5 +\(base 0\.1\/0\.5; tier from 100000 tokens 0\.5\/2\.5\)/);
});

test('RFU-6: ANY write that reads a saved folder is refused when the folder\'s stamp is not from today, even when no row would move; --hosts-only keeps the stamp date', () => {
  const dir = tree();
  const t0 = JSON.parse(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'));
  t0['openrouter/vendor/alpha'] = { in: 0.25, out: 1, _source: 'fixture' };   // already the dearest eligible host of the fixture, so nothing moves
  writeFileSync(join(dir, 'src', 'pricing.json'), `${JSON.stringify(t0, null, 2)}\n`);
  writeFileSync(join(dir, 'ep', '_fetch.json'), JSON.stringify({ fetchedAt: '2020-01-01T00:00:00.000Z' }));
  const before = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, 'models.json', '--endpoints', 'ep', '--pages', 'ep', '--write'], { cwd: dir, env: { ...process.env, PRICING_CHECKED_AT: '' }, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /the answers were read on 2020-01-01, not today/);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), before, 'the stamp date does not move backwards');
});

test('RFU-7: a tier-driven row still takes the HOST part: it counts the higher of today\'s figure and the dearest eligible host at BASE price (never the tier, never lowered), with a dated _source line and the evidence file', () => {
  const eps = [ep('Tiered', 'tiered', 0.1, 0.5, 400000, { pricing: { prompt: String(0.1 / 1e6), completion: String(0.5 / 1e6), overrides: [{ min_prompt_tokens: 100000, prompt: String(0.5 / 1e6), completion: String(2.5 / 1e6) }] } })];
  const rows = { ...ROWS, 'openrouter/vendor/alpha': { in: 0.05, out: 0.7, _source: 'fixture' } };   // input below the base host, output above it
  const dir = tree({ rows, endpoints: { 'vendor__alpha.json': { data: { endpoints: eps } } }, pages: {} });
  const r = runToday(dir);
  assert.equal(r.status, 0, r.stderr);
  const a = rowsOf(dir)['openrouter/vendor/alpha'];
  assert.deepEqual([a.in, a.out], [0.1, 0.7], 'input raised to the base host, output not lowered, the tier (0.5 / 2.5) not counted');
  assert.equal(a.hosts.tier_driven, true);
  assert.match(a._source, /counted price set to the dearest eligible host at base price 0\.1\/0\.7 per Mtok \(1 hosts; its price tier is not counted yet\), was 0\.05\/0\.7/);
  assert.match(r.stdout, /vendor\/alpha: file 0\.05\/0\.7 -> 0\.1\/0\.7 \(the dearest eligible host at base price; tier part held: .*RAISED {2}evidence vendor__alpha\.json/);
});

test('RFU-8: a row WRITES its tiers (0.8.4 unit 2b): at each prompt-size threshold the dearest rate any eligible host can charge there, ascending, written before the host picture; a time-of-day override FOLDS INTO THE BASE (the cap has no clock) and never into the tiers; a second run replaces the line', () => {
  const tier = (provider, tag, i, o, ov) => ep(provider, tag, i, o, 400000, { pricing: { prompt: String(i / 1e6), completion: String(o / 1e6), overrides: ov } });
  const mk = (from, i, o) => ({ min_prompt_tokens: from, prompt: String(i / 1e6), completion: String(o / 1e6) });
  const night = (i, o) => ({ utc_start: '00:00', utc_end: '06:00', prompt: String(i / 1e6), completion: String(o / 1e6) });
  const eps = [tier('A', 'a', 0.1, 0.5, [mk(100000, 0.5, 2.5)]), tier('B', 'b', 0.2, 0.9, [mk(200000, 0.4, 1.8), mk(100000, 0.3, 1.2)]), tier('C', 'c', 0.15, 0.6, [night(0.25, 1.0)])];
  const rows = { ...ROWS, 'openrouter/vendor/alpha': { in: 0.05, out: 0.1, _source: 'fixture' } };   // the fixture row sits BELOW every base
  const dir = tree({ rows, endpoints: { 'vendor__alpha.json': { data: { endpoints: eps } } }, pages: {} });
  const r = runToday(dir);
  assert.equal(r.status, 0, r.stderr);
  const a = rowsOf(dir)['openrouter/vendor/alpha'];
  // base-counted: A 0.1/0.5, B 0.2/0.9, C 0.15/0.6 raised by its night window to 0.25/1.0 -> the dearest base-counted is 0.25/1.0, which only the folding of the window can produce
  assert.deepEqual([a.in, a.out], [0.25, 1], 'the night window of host C is the dearest base-counted price');
  // at 100000: A 0.5/2.5, B 0.3/1.2 -> 0.5/2.5; at 200000: B 0.4/1.8 -> not dearer than the step before -> no new tier; the window is NOT a tier
  assert.deepEqual(a.tiers, [{ from: 100000, in: 0.5, out: 2.5 }]);
  assert.equal(a.hosts.tier_driven, true);
  const first = readFileSync(join(dir, 'src', 'pricing.json'), 'utf8');
  const again = runToday(dir);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(dir, 'src', 'pricing.json'), 'utf8'), first, 'the same input twice gives the same bytes, one tiers line');
  assert.equal(first.split('"tiers"').length - 1, 1);
});
