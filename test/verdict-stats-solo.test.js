// 0.8.4, the stats reader (C&C's ruling of 12 Nov 2026 on the late item): `council stats` and MCP verdict_stats count a sign-off as SOLO when another seat still objects. Since 0.8.4 a row that SIGNED OFF lists the objections it holds
// below the bar (rated under 4: the seat counts as clear), so reading "a non-empty list" as "still objecting" made every other judge's sign-off solo in a run where every judge agreed. Now another seat still objects only when it
// OBJECTED (signedOff false); a row that did not sign off and did not object (an abstention) is counted by its list, as it was.
// Through the real write path, $0: a layered mock chain (a copy of the shipped planning chain under its own name, vs-solo, every seat a mock or the external writer; the zero-spend scanner reads a shipped chain's name as real seats),
// the critics on DISTINCT labs (the shipped chain's own `lab` per seat; with one shared lab solo is 0 before and after), one layer-1 judge tags its objection 3 (below the bar) on every ask and signs off, every other judge signs off clean.
// The run is written by the real CLI (report.json through reportJsonShape); verdictStats reads that folder.
// What tells the case apart (not a wording pin): the stats field soloSignoffs of every lab other than the one that listed the objection. RED on the tip: they count 1 each. Controls (derived from the same real report.json, one row edited,
// each in its own folder): an OBJECTING row (signedOff false) makes the other seats' sign-offs solo; an ABSTAINING row that lists objections (signedOff null) counts as before; the same run with the list emptied shows none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerBuildChecks } from './helpers/build-check.js';
import { verdictStats } from '../src/verdict-stats.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'src', 'cli.js');

let RUN = null;
function agreedRun() {
  if (RUN) return RUN;
  const c = JSON.parse(readFileSync(join(repo, 'chains', 'plan-mini-council.json'), 'utf8'));
  delete c.prompt_cache;
  c.name = 'vs-solo';   // a copy under its own name: every seat of it is mock or external, and no-paid-chain-spawn reads a shipped chain's name as a chain with real seats
  const FIXED = { criteria: 'mock-criteria', skeleton: 'mock-skeleton', handoff: 'mock-builder', decider: 'mock-builder' };
  let q = 0, tagged = false;
  for (const [slot, v] of Object.entries(c.seats)) for (const s of (Array.isArray(v) ? v : [v])) {
    if (!s || typeof s !== 'object') continue;
    delete s.extra;
    if (slot === 'builder' || slot === 'reviser') continue;   // the writer stays external
    if (slot === 'critics') { s.model = (s.layer === 1 && !tagged && (tagged = true)) ? `mock-exch-support-keep-always-sev3-vsq${q++}` : `mock-exch-support-keep-clean-vsq${q++}`; }
    else s.model = slot === 'proposers' ? ['mock-proposer-a', 'mock-proposer-b'][q++ % 2] : (FIXED[slot] ?? 'mock-builder');
    s.provider = 'mock'; if (!s.lab) s.lab = `${slot}-lab`;
  }
  const d = mkdtempSync(join(tmpdir(), 'thc-vs-'));
  mkdirSync(join(d, 'chains')); mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'chains', 'vs-solo.json'), JSON.stringify(c, null, 1));
  writeFileSync(join(d, 'tasks', 'x.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: d }, timeout: 180000 });
  let RD = null;
  const R = () => RD ?? (RD = join(d, 'runs', readdirSync(join(d, 'runs')).sort()[0]));
  const files = () => { try { return readdirSync(R()); } catch { return []; } };
  const pending = () => files().filter(f => /^NEEDS-/.test(f) && !files().includes(f.replace(/^NEEDS-/, '')));
  let r = run(['--chain', 'vs-solo', '--task', 'tasks/x.md', '--max-usd', 'none']);
  for (let i = 0; i < 12 && r.status === 3; i++) {
    const p = pending();
    const w = p.find(f => /^NEEDS-(build|revise-\d+)(-full)?\.md$/.test(f));
    if (p.some(f => /^NEEDS-build-check-\d+\.md$/.test(f))) answerBuildChecks(R());
    else if (w) writeFileSync(join(R(), w.replace(/^NEEDS-/, '')), `# Plan v${i + 1}\n\nRename each photo by its EXIF date; keep a dry-run flag and a log of every rename.\n`);
    else break;
    r = run(['--resume', R(), '--max-usd', 'none']);
  }
  RUN = { exit: r.status, dir: d, rd: R(), report: JSON.parse(readFileSync(join(R(), 'report.json'), 'utf8')) };
  return RUN;
}

// a runs folder holding ONE run: the real folder, its report.json optionally edited by `edit(report)` (a derived control)
function runsWith(edit) {
  const w = agreedRun();
  const runs = join(mkdtempSync(join(tmpdir(), 'thc-vs-runs-')), 'runs'); mkdirSync(runs);
  const rd = join(runs, w.rd.split('/').at(-1)); cpSync(w.rd, rd, { recursive: true });
  if (edit) { const rep = JSON.parse(readFileSync(join(rd, 'report.json'), 'utf8')); edit(rep); writeFileSync(join(rd, 'report.json'), JSON.stringify(rep)); }
  return runs;
}
const solo = runs => Object.fromEntries(verdictStats(runs).labs.filter(l => l.signoffs > 0).map(l => [l.lab, l.soloSignoffs]));

function premise(w) {   // every judge agreed; one of them lists an objection it holds below the bar; the judges are on distinct labs
  assert.equal(w.exit, 0, 'premise: the run ends');
  const rows = w.report.signoff;
  assert.ok(rows.length >= 3, 'premise: a panel');
  assert.ok(rows.every(s => s.signedOff === true), `premise: every judge signed off (${rows.map(s => `${s.lab}:${s.signedOff}`).join(' ')})`);
  assert.equal(new Set(rows.map(s => s.provider)).size, rows.length, 'premise: the judges are on distinct labs');
  const listing = rows.filter(s => (s.objections ?? []).length > 0);
  assert.equal(listing.length, 1, 'premise: exactly one signed-off row lists an objection');
  assert.ok(listing[0].objections.every(o => typeof o.severity === 'number' && o.severity < 4), 'premise: it is rated below the bar');
  return listing[0];
}

test('stats: a run where every judge signed off shows no solo sign-off, whatever objection below the bar a signed-off row lists', () => {
  const w = agreedRun();
  const listing = premise(w);
  const s = solo(runsWith());
  assert.ok(Object.keys(s).length >= 3, 'every lab signed off once');
  assert.deepEqual(Object.values(s).filter(n => n !== 0), [], `no lab's sign-off is solo (got ${JSON.stringify(s)}; the listing row is ${listing.provider})`);
});

test('stats controls (derived from the same report.json, one row edited): an objecting row makes the others solo; an abstaining row that lists objections counts as before; an emptied list shows none', () => {
  const w = agreedRun();
  const listing = premise(w);
  const others = w.report.signoff.filter(s => s.provider !== listing.provider).map(s => s.provider);
  // objecting row: the listing seat did NOT sign off (it objected)
  const objecting = solo(runsWith(rep => { const r = rep.signoff.find(s => s.provider === listing.provider); r.signedOff = false; }));
  assert.deepEqual(others.map(l => objecting[l]), others.map(() => 1), 'an objecting row makes every other seat\'s sign-off solo');
  // abstaining row: it neither signed off nor objected, and still lists what it holds: counted as before
  const abstaining = solo(runsWith(rep => { const r = rep.signoff.find(s => s.provider === listing.provider); r.signedOff = null; }));
  assert.deepEqual(others.map(l => abstaining[l]), others.map(() => 1), 'an abstaining row with a list counts as before');
  // an all-agreed run with empty lists
  const empty = solo(runsWith(rep => { for (const r of rep.signoff) r.objections = []; }));
  assert.deepEqual(Object.values(empty).filter(n => n !== 0), [], 'empty lists: none');
});
