// 0.8.4 the refreshed list of zero-retention hosts (Muad's pick (b) for an old list: the person refreshes it with ONE command, `council refresh-zdr-list`; C&C's results: the old list refuses and names the command; a failed refresh writes nothing and the refusal stands;
// the newer of the shipped and the refreshed list is used; a file the project can write never adds an allowed host; a forged newer date is detected, not prevented). Offline, $0: the fetch is a stub, the folders are the test's own.
// WHAT IS PINNED, by test: ZF-1 narrowTable: shipped intersected with fresh, per model and per slug, fresh prices, never a host or a model the shipped table lacks. ZF-2 zdrTableFor: no file = shipped; a newer valid file is used and is narrowed AGAIN at read (a hand-edited file that
// adds a host adds nothing); an older or equal date is not used; a date after today is not used and is reported; an unreadable or misshapen file is not used and says why. ZF-3 refreshZdrList: success writes the narrowed list dated today and says how many models kept and lost;
// every failure (fetch error, HTTP error, not JSON, no rows, a changed shape) writes NOTHING and leaves an existing file byte for byte as it was, and says the list in use is unchanged. ZF-4 the sentences of the refusals that name the command and the date after today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'thc-zf-')); made.push(d); return d; };
const loadTable = async () => { const m = await import('../src/zdr-table.js').catch(() => null); assert.ok(m, 'src/zdr-table.js exists'); return m; };
const loadZR = async () => { const m = await import('../src/zero-retention.js').catch(() => null); assert.ok(m, 'src/zero-retention.js exists'); return m; };
const loadRefresh = async () => { const m = await import('../src/zdr-refresh.js').catch(() => null); assert.ok(m, 'src/zdr-refresh.js exists'); return m; };

const H = (i, o) => ({ in: i, out: o });
const SHIPPED = { asOf: '2026-11-10', models: { 'a/one': { hosts: { x: H(1, 2), y: H(1, 2) }, safety_retention: 0 }, 'a/two': { hosts: { p: H(3, 4) }, safety_retention: 0 }, 'a/gone': { hosts: { q: H(1, 1) }, safety_retention: 0 } } };
const FRESH = { asOf: '2026-12-20', models: { 'a/one': { hosts: { y: H(1.5, 2.5), z: H(1, 1) }, safety_retention: 1 }, 'a/two': { hosts: { p: H(3, 4) }, safety_retention: 0 }, 'b/new': { hosts: { w: H(1, 1) }, safety_retention: 0 } } };

test('ZF-1: narrowTable keeps the shipped table intersected with the fresh one, per model and per slug, with the fresh prices, and never a host or a model the shipped table lacks', async () => {
  const { narrowTable } = await loadTable();
  const n = narrowTable(SHIPPED, FRESH);
  assert.deepEqual(n, { asOf: '2026-12-20', models: { 'a/one': { hosts: { y: H(1.5, 2.5) }, safety_retention: 1 }, 'a/two': { hosts: { p: H(3, 4) }, safety_retention: 0 } } }, 'x moved away, z and b/new are new (not used), a/gone is not on the fresh list');
  assert.equal(JSON.stringify(narrowTable(SHIPPED, SHIPPED)), JSON.stringify(SHIPPED), 'the shipped table narrowed by itself is itself');
  assert.deepEqual(narrowTable(SHIPPED, { asOf: '2026-12-20', models: {} }).models, {}, 'a fresh list with nothing in common keeps nothing');
});

test('ZF-2: the list a folder is held to: shipped unless a newer, readable, not-future refreshed file narrows it; the file is narrowed again at read', async () => {
  const ZR = await loadZR(), T = await loadTable();
  const w = dir(), write = (obj, raw) => writeFileSync(join(w, 'zdr-hosts.user.json'), raw ?? JSON.stringify(obj));
  const of = (work = w, today = '2026-12-25') => ZR.zdrTableFor(work, { today, shipped: SHIPPED });
  assert.deepEqual([of().source, of().table === SHIPPED, of(null).source], ['shipped', true, 'shipped'], 'no file: the shipped list');
  write(FRESH);
  const used = of(); assert.equal(used.source, 'refreshed'); assert.deepEqual(used.table, T.narrowTable(SHIPPED, FRESH)); assert.deepEqual([used.future, used.problem], [null, null]);
  write({ ...FRESH, models: { ...FRESH.models, 'a/two': { hosts: { p: H(3, 4), evil: H(0, 0) }, safety_retention: 0 }, 'c/extra': { hosts: { e: H(1, 1) }, safety_retention: 0 } } });
  assert.deepEqual(of().table.models['a/two'].hosts, { p: H(3, 4) }, 'a hand-edited file that adds a host adds nothing');
  assert.equal('c/extra' in of().table.models, false, 'nor a model');
  write({ ...FRESH, asOf: '2026-11-10' }); assert.equal(of().source, 'shipped', 'a date equal to the shipped one is not newer');
  write({ ...FRESH, asOf: '2026-11-01' }); assert.equal(of().source, 'shipped', 'an older date is not used');
  write({ ...FRESH, asOf: '2027-01-02' }); const fut = of(); assert.deepEqual([fut.source, fut.future], ['shipped', '2027-01-02'], 'a date after today is not used and is reported');
  write(null, '{ not json'); const un = of(); assert.equal(un.source, 'shipped'); assert.match(un.problem, /^zdr-hosts\.user\.json could not be read \(.*\), so the list this program shipped with is used$/);
  write({ asOf: '2026-12-20', models: { 'a/one': { hosts: [], safety_retention: 0 } } }); assert.match(of().problem, /^zdr-hosts\.user\.json is not a list this program can read \(the model a\/one has no hosts object\), so the list this program shipped with is used$/);
  write({ models: {} }); assert.match(of().problem, /\(it has no date\)/);
});

const rowsOf = list => list.flatMap(([model, tags]) => tags.map(([tag, p, c, safety]) => ({ model_id: model, tag, safety_retention: !!safety, pricing: { prompt: String(p / 1e6), completion: String(c / 1e6) } })));
const okFetch = body => async () => ({ ok: true, status: 200, json: async () => body });
const STUB_ROWS = rowsOf([['a/one', [['y', 1.5, 2.5], ['z', 1, 1]]], ['a/two', [['p', 3, 4]]], ['b/new', [['w', 1, 1]]]]);

test('ZF-3: refreshZdrList writes the narrowed list dated today and says what it kept; every failure writes nothing and leaves an existing file as it was', async () => {
  const { refreshZdrList } = await loadRefresh();
  const w = dir(), file = join(w, 'zdr-hosts.user.json');
  const r = await refreshZdrList({ work: w, fetchImpl: okFetch({ data: STUB_ROWS }), today: '2026-12-20', shipped: SHIPPED });
  assert.equal(r.ok, true, r.lines.join(' '));
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(written, { asOf: '2026-12-20', models: { 'a/one': { hosts: { y: H(1.5, 2.5) }, safety_retention: 0 }, 'a/two': { hosts: { p: H(3, 4) }, safety_retention: 0 } } });
  assert.deepEqual(r.lines, ["Refreshed the list of zero-retention hosts: OpenRouter's list of 2026-12-20, narrowed to the hosts this program shipped with, is in zdr-hosts.user.json (2 models; 1 model of the shipped list no longer has a host this program may use). A host OpenRouter added after this version was released is not used until a newer version ships its own list."]);
  assert.equal(readdirSync(w).filter(f => f.includes('.tmp-')).length, 0, 'no temporary file is left');
  const before = readFileSync(file, 'utf8');
  const bad = {
    'the fetch fails': async () => { throw Object.assign(new Error('boom'), { cause: { code: 'ENOTFOUND' } }); },
    'HTTP 503': async () => ({ ok: false, status: 503, json: async () => ({}) }),
    'not JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }),
    'no rows': okFetch({ data: [] }),
    'no data field': okFetch({ endpoints: STUB_ROWS }),
    'a changed shape': okFetch({ data: STUB_ROWS.map(x => ({ id: x.model_id, slug: x.tag })) }),
  };
  for (const [name, fetchImpl] of Object.entries(bad)) {
    const f = await refreshZdrList({ work: w, fetchImpl, today: '2027-02-01', shipped: SHIPPED });
    assert.equal(f.ok, false, name); assert.match(f.lines[0], /^Could not refresh the list of zero-retention hosts: .*\. Nothing was written; the list in use is unchanged\.$/, name);
    assert.equal(readFileSync(file, 'utf8'), before, `${name}: the existing file is as it was`);
  }
  const w2 = dir();
  await refreshZdrList({ work: w2, fetchImpl: bad['HTTP 503'], today: '2027-02-01', shipped: SHIPPED });
  assert.equal(existsSync(join(w2, 'zdr-hosts.user.json')), false, 'a failed first refresh creates no file');
  const reasons = await Promise.all([bad['the fetch fails'], bad['HTTP 503'], bad['not JSON']].map(fetchImpl => refreshZdrList({ work: dir(), fetchImpl, shipped: SHIPPED })));
  assert.match(reasons[0].lines[0], /OpenRouter's list could not be fetched \(ENOTFOUND\)/); assert.match(reasons[1].lines[0], /answered HTTP 503/); assert.match(reasons[2].lines[0], /is not JSON/);
});

test('ZF-4: the refusals name the command; a refreshed list dated after today is refused and says so; the line names a refreshed list', async () => {
  const ZR = await loadZR();
  const seats = [{ provider: 'openrouter', model: 'a/one' }];
  const stale = ZR.resolveZeroRetention(seats, { table: SHIPPED, flag: 'on', now: Date.parse('2027-01-31T00:00:00Z') });
  assert.match(stale.refusal, /To refresh it, run: council refresh-zdr-list\. To run anyway, switch it off with --zero-retention off\.$/);
  const fut = ZR.resolveZeroRetention(seats, { table: SHIPPED, flag: 'on', future: '2027-01-02', now: Date.parse('2026-12-25T00:00:00Z') });
  assert.equal(fut.refusal, 'Zero retention is on, but the refreshed list of zero-retention hosts in zdr-hosts.user.json is dated 2027-01-02, which is after today, so it is not used. Nothing was started and nothing was spent. Run council refresh-zdr-list to replace it, or switch zero retention off with --zero-retention off.');
  assert.match(ZR.zeroRetentionLines({ on: true, covered: 1, notCovered: 0, asOf: '2026-12-20', source: 'refreshed' })[0], /OpenRouter's list of 2026-12-20 \(refreshed in this folder\) gives for its model/);
  assert.doesNotMatch(ZR.zeroRetentionLines({ on: true, covered: 1, notCovered: 0, asOf: '2026-11-10', source: 'shipped' })[0], /refreshed/);
});
