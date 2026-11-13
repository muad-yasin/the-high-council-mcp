// 3 Nov 2026 (owner's pick "Auto + handler tool"; headings "THE REPAIR TOOL'S SHAPE ..." and "THE REPAIR TOOL LEAVES NO TRACE IN THC'S RECORD ..." in the detail file): the MCP repair tool, repair_reply, driven through the
// real server on REAL paused runs, $0: a mock panel where mock-near-json answers almost JSON (a near_json pause), and a mock panel where mock-retyped-table signs off with a complete table whose criterion texts are
// retyped (a table_rows pause). Each base run is made once by the CLI and copied into a fresh working folder per group, so every group starts from the same paused state. One assertion per test.
// A call that resumes the run spawns a detached child; every group whose call can resume waits for that child to exit before it ends.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { malformedProviderKeys } from './helpers/no-real-keys.js';
import { childGone, waitForRunEnd } from './helpers/child-gone.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const KEY = `sk-or-v1-${'a1b2c3d4'.repeat(8)}`;   // a distinctive key shape (as test/mcp-submit-stage-scan.test.js)
// The third criterion already starts with the word mock-retyped-table puts first, so its row stays exact and is matched by text: the pause flags rows 1 and 2 only (the marker's `rows`).
const TABLE_CRITERIA = ['Alpha names the venue, the date and the stand layout.', 'Omega names the venue, the date and the stand layout.', 'Restated budget adds up and names its sources.'];

function mcp(cwd, calls) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd, ...malformedProviderKeys() } });
    const byId = new Map(); let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ } }
      if (calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'repair-reply-tool', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c })),
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}
const payload = m => { const t = m?.result?.content?.[0]?.text; try { return JSON.parse(t); } catch { return { raw: t ?? JSON.stringify(m) }; } };
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k]]));

// A real run paused for a repair, made by the CLI -> { work, id, dir, stage }.
function pausedRun(name, chain) {
  const work = mkdtempSync(join(tmpdir(), `thc-repair-tool-${name}-`));
  mkdirSync(join(work, 'tasks'), { recursive: true });
  mkdirSync(join(work, 'chains'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small bake sale.\n');
  writeFileSync(join(work, 'chains', `${chain.name}.json`), JSON.stringify(chain));
  const p = spawnSync(process.execPath, [cli, '--chain', chain.name, '--task', 'tasks/t.md'], { cwd: work, env: { PATH: process.env.PATH, HOME: work }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 3, `fixture: the run paused: ${p.stdout}${p.stderr}`);
  const id = readdirSync(join(work, 'runs'))[0];
  const dir = join(work, 'runs', id);
  // The stage that waits for a repair (a run may also wait on an external stage).
  const stage = readdirSync(dir).filter(f => /^NEEDS-.*\.md$/.test(f)).map(f => f.replace(/^NEEDS-|\.md$/g, '')).find(l => existsSync(join(dir, `${l}.repair.json`)));
  assert.ok(stage, `fixture: the run waits for a repair: ${readdirSync(dir).join(', ')}`);
  return { work, id, dir, stage, out: p.stdout };
}
// The same paused run in a fresh working folder. Every path run.json names inside the base folder (the start folder, the task) is moved to the copy, so a resume from the copy reads the copy's own files.
function copyOf(base, name) {
  const work = mkdtempSync(join(tmpdir(), `thc-repair-tool-${name}-`));
  cpSync(base.work, work, { recursive: true });
  const dir = join(work, 'runs', base.id);
  writeFileSync(join(dir, 'run.json'), readFileSync(join(dir, 'run.json'), 'utf8').split(JSON.stringify(base.work).slice(1, -1)).join(JSON.stringify(work).slice(1, -1)));
  return { ...base, work, dir };
}
const originalText = w => readFileSync(join(w.dir, 'originals', `${w.stage}.1.md`), 'utf8');
const nearJsonRepair = original => original.replace('"failures": [ "verdict_line"', '"failures": [], "verdict_line"');
const topLevel = w => readdirSync(w.dir).sort();

let nj; let tb; let both;
before(() => {
  nj = pausedRun('nj', { name: 'repair-tool-nj', description: 'Test: a one-judge mock panel whose judge answers almost JSON (repaired, it signs off, so a resumed run ends).', maxRounds: 2, signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-near-json', lab: 'nj' }] } });
  tb = pausedRun('tb', { name: 'repair-tool-tb', description: 'Test: two criteria that differ only in their first word, and a judge that retypes first words: a complete table row matching cannot read.', maxRounds: 2, signoff: 'unanimous', signoff_table: { required: true }, criteria: TABLE_CRITERIA, seats: { builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-retyped-table', lab: 'rt' }] } });
  // C&C's review of unit 6 (4 Nov 2026): a panel where a repair AND an external stage wait at once (the external seat and the near-JSON judge pause together).
  both = pausedRun('both', { name: 'repair-tool-both', description: 'Test: a panel with an external judge and a judge that answers almost JSON: both stages wait at once.', maxRounds: 2, signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'external', model: 'claude-code-session', lab: 'ex' }, { provider: 'mock', model: 'mock-near-json', lab: 'nj' }] } });
});

describe('a near_json repair with text', () => {
  let w; let usageBefore; let original; let repair; let first; let second;
  before(async () => {
    w = copyOf(nj, 'text');
    usageBefore = readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8');
    original = originalText(w);
    repair = nearJsonRepair(original);
    [first, second] = (await mcp(w.work, [
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: repair } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: repair } },
    ])).map(payload);
  });
  after(async () => { assert.ok(await childGone(w.dir), 'the resumed child exited'); });

  test('RR-1 the tool answers that the stage was repaired, with its kind and the file it wrote', () => {
    assert.deepEqual(pick(first, ['repaired', 'stage', 'kind', 'written']), { repaired: true, stage: w.stage, kind: 'near_json', written: `${w.stage}.md` }, JSON.stringify(first).slice(0, 400));
  });
  test('RR-2 the run resumes (no stage was left waiting)', () => {
    assert.equal(first.resumed, true, JSON.stringify(first).slice(0, 400));
  });
  test('RR-3 the stage file holds the repair byte for byte', () => {
    assert.equal(readFileSync(join(w.dir, `${w.stage}.md`), 'utf8'), repair);
  });
  test('RR-4 the top level holds neither the pause marker nor the NEEDS file', () => {
    assert.deepEqual([existsSync(join(w.dir, `${w.stage}.repair.json`)), existsSync(join(w.dir, `NEEDS-${w.stage}.md`))], [false, false]);
  });
  test('RR-5 the resumed run ends and its report counts the repaired stage at the paid call (its provider, model and cost), never as an external answer', async () => {
    const paid = JSON.parse(usageBefore);
    const report = JSON.parse(readFileSync(await waitForRunEnd(w.dir), 'utf8'));
    const rows = report.stages.filter(s => s.label === w.stage).map(s => pick(s, ['provider', 'model', 'usd']));
    assert.deepEqual(rows, [pick(paid, ['provider', 'model', 'usd'])], JSON.stringify(report.stages.filter(s => s.label === w.stage)));
  });
  test('RR-6 originals/ keeps the original reply byte for byte, beside the accepted pause record and the request', () => {
    assert.deepEqual({ files: readdirSync(join(w.dir, 'originals')).sort(), original: originalText(w) }, { files: [`${w.stage}.1.md`, `${w.stage}.1.needs.md`, `${w.stage}.1.repair.json`].sort(), original });
  });
  test('RR-7 a second call is refused: a stage is repaired once', () => {
    assert.equal(second.error, `"${w.stage}" was already repaired (or its repair was declined); a stage is repaired once, so nothing was written`, JSON.stringify(second).slice(0, 400));
  });
});

describe('a decline', () => {
  let w; let original; let answer;
  before(async () => {
    w = copyOf(nj, 'decline');
    original = originalText(w);
    [answer] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
  });
  after(async () => { assert.ok(await childGone(w.dir), 'the resumed child exited'); });

  test('RD-1 the tool answers that the repair was declined', () => {
    assert.deepEqual(pick(answer, ['repaired', 'declined']), { repaired: true, declined: true }, JSON.stringify(answer).slice(0, 400));
  });
  test('RD-2 the accepted pause record in originals/ says declined', () => {
    assert.equal(JSON.parse(readFileSync(join(w.dir, 'originals', `${w.stage}.1.repair.json`), 'utf8')).declined, true);
  });
  test('RD-3 no NEEDS file of the stage is left at the top level', () => {
    assert.equal(existsSync(join(w.dir, `NEEDS-${w.stage}.md`)), false);
  });
  test('RD-4 the stage file is the original reply, unchanged', () => {
    assert.equal(readFileSync(join(w.dir, `${w.stage}.md`), 'utf8'), original);
  });
});

describe('a table repair with restore_rows', () => {
  let w; let original; let answer;
  before(async () => {
    w = copyOf(tb, 'rows');
    original = originalText(w);
    [answer] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, restore_rows: [1, 2] } }])).map(payload);
  });
  after(async () => { assert.ok(await childGone(w.dir), 'the resumed child exited'); });

  test('RT-1 the tool answers with the kind and the rows it changed', () => {
    assert.deepEqual(pick(answer, ['repaired', 'kind', 'changed']), { repaired: true, kind: 'table_rows', changed: [1, 2] }, JSON.stringify(answer).slice(0, 400));
  });
  test('RT-2 each named row now carries the exact text of the criterion at its position (row 3 already did)', () => {
    assert.deepEqual(JSON.parse(readFileSync(join(w.dir, `${w.stage}.md`), 'utf8')).criteria.map(r => r.criterion), TABLE_CRITERIA);
  });
  test('RT-3 nothing but the criterion texts changed (verdicts, evidence, ids and every other field are the original\'s)', () => {
    const strip = o => ({ ...o, criteria: o.criteria.map(r => ({ ...r, criterion: null })) });
    assert.deepEqual(strip(JSON.parse(readFileSync(join(w.dir, `${w.stage}.md`), 'utf8'))), strip(JSON.parse(original)));
  });
});

describe('refusals on a near_json pause (nothing is written)', () => {
  let w; let before_; let r = {};
  before(async () => {
    w = copyOf(nj, 'refuse-nj');
    const snapshot = () => JSON.stringify([topLevel(w), readdirSync(join(w.dir, 'originals')).sort(), readFileSync(join(w.dir, `${w.stage}.usage.json`), 'utf8'), existsSync(join(w.dir, `${w.stage}.repair.json`)) ? readFileSync(join(w.dir, `${w.stage}.repair.json`), 'utf8') : null]);   // the marker: null once moved (a tool that took a repair here fails RX-11 on its own line)
    before_ = snapshot();
    const original = originalText(w);
    // The repair that changes a word goes last: a tool that took it would close the pause, and the calls after it would answer about a closed pause instead of their own case.
    const names = ['none', 'two', 'rows', 'key', 'label', 'notWaiting', 'prompt', 'bundle', 'ids', 'words'];
    const out = await mcp(w.work, [
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: nearJsonRepair(original), decline: true } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, restore_rows: [1] } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: nearJsonRepair(original).replace('All criteria met.', `All criteria met. ${KEY}`) } },
      { name: 'repair_reply', arguments: { run: w.id, stage: '../run.json', decline: true } },
      { name: 'repair_reply', arguments: { run: w.id, stage: 'build', decline: true } },
      { name: 'external_prompt', arguments: { run: w.id, stage: w.stage } },
      { name: 'prepare_stage_prompt', arguments: { run: w.id } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, ids: [{ from: 'O-00000000', to: 'O-00000001' }] } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: nearJsonRepair(original).replace('All criteria met.', 'All criteria are met.') } },
    ]);
    names.forEach((n, i) => { r[n] = out[i]; });
    r.after = snapshot();
  });

  test('RX-1 no input at all is refused', () => {
    assert.equal(payload(r.none).error, 'give exactly one of text, restore_rows, ids or decline: true; nothing was written');
  });
  test('RX-2 two inputs at once are refused', () => {
    assert.equal(payload(r.two).error, 'give exactly one of text, restore_rows, ids or decline: true; nothing was written');
  });
  test('RX-3 restore_rows on a near_json pause is refused', () => {
    assert.equal(payload(r.rows).error, `"${w.stage}" waits for a repair of a reply that is almost JSON: give text (or decline: true), not restore_rows; nothing was written`);
  });
  test('RX-4 a repair that changes a word is not taken', () => {
    assert.match(String(payload(r.words).error), new RegExp(`^the repair of "${w.stage}" was not taken, and nothing was written: the repair does not read word for word like the original`));
  });
  test('RX-5 a repair that holds a key shape is refused by the credential scan', () => {
    assert.match(String(payload(r.key).error), new RegExp(`^the repair for "${w.stage}" was not written: it holds `));
  });
  test('RX-6 a stage label that is a path is refused by the argument check, before the tool runs', () => {
    assert.match(String(r.label?.result?.content?.[0]?.text ?? r.label?.error?.message ?? ''), /Invalid arguments for tool repair_reply/, JSON.stringify(r.label).slice(0, 300));
  });
  test('RX-7 a stage that waits for no repair is refused', () => {
    assert.equal(payload(r.notWaiting).error, 'run is not waiting for a repair of "build"');
  });
  test('RX-8 external_prompt names repair_reply for a repair label', () => {
    assert.equal(payload(r.prompt).answerWith, `repair_reply(run, "${w.stage}", text: <the reply with its JSON fixed>) or repair_reply(run, "${w.stage}", decline: true)`);
  });
  test('RX-9 external_prompt names the kind of the repair', () => {
    assert.equal(payload(r.prompt).repair, 'near_json');
  });
  test('RX-10 prepare_stage_prompt writes no bundle when only a repair waits', () => {
    assert.equal(payload(r.bundle).error, `"${w.stage}" waits for a repair of a reply its seat already wrote, not for a new answer, so no stage bundle was written. Read the request with external_prompt and answer it with repair_reply.`);
  });
  test('RX-12 ids on a near_json pause are refused (4 Nov 2026: the id-slip input)', () => {
    assert.equal(payload(r.ids).error, `"${w.stage}" waits for a repair of a reply that is almost JSON: give text (or decline: true), not ids; nothing was written`);
  });
  test('RX-11 after every refusal the run folder is as it was (files, originals/, the paid record, the marker)', () => {
    assert.equal(r.after, before_);
  });
});

describe('refusals on a table pause', () => {
  let w; let r = {};
  before(async () => {
    w = copyOf(tb, 'refuse-tb');
    const out = await mcp(w.work, [
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, text: originalText(w) } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, restore_rows: [4] } },
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, restore_rows: [1, 1] } },
      { name: 'external_prompt', arguments: { run: w.id, stage: w.stage } },
      // Last: a tool that took it would close the pause, and a call after it would answer about a closed pause.
      { name: 'repair_reply', arguments: { run: w.id, stage: w.stage, restore_rows: [3] } },
    ]);
    [r.text, r.range, r.twice, r.prompt, r.unflagged] = out.map(payload);
  });

  test('RY-1 text on a table pause is refused', () => {
    assert.equal(r.text.error, `"${w.stage}" waits for a repair of its sign-off table: give restore_rows (or decline: true), not text; nothing was written`);
  });
  test('RY-2 a row the seat did not write is refused (a missing row is never filled)', () => {
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `...each once: the criteria the table left without a row (a row the seat did not write...`. NEW: `...each once: a row may be restored only where its words did not fit the criterion at its position (a row the seat did not write...` in RY-2, RY-3 and RY-5 (K5). WHY: the reviewed refusal of src/repair-reply.js:60.
    assert.equal(r.range.error, 'restore_rows may name only rows 1, 2, each once: a row may be restored only where its words did not fit the criterion at its position (a row the seat did not write is never added, and no criterion gets two rows); nothing was written');
  });
  test('RY-3 a row named twice is refused', () => {
    assert.equal(r.twice.error, 'restore_rows may name only rows 1, 2, each once: a row may be restored only where its words did not fit the criterion at its position (a row the seat did not write is never added, and no criterion gets two rows); nothing was written');
  });
  test('RY-5 a row the pause did not flag is refused: its criterion already has a row, so it never gets a second one', () => {
    assert.equal(r.unflagged.error, 'restore_rows may name only rows 1, 2, each once: a row may be restored only where its words did not fit the criterion at its position (a row the seat did not write is never added, and no criterion gets two rows); nothing was written');
  });
  test('RY-4 external_prompt names restore_rows for a table repair', () => {
    assert.equal(r.prompt.answerWith, `repair_reply(run, "${w.stage}", restore_rows: [<row numbers>]) or repair_reply(run, "${w.stage}", decline: true)`);
  });
});

describe('a repair and an external stage wait at once', () => {
  test('RW-1 prepare_stage_prompt bundles the external stage and lists the repair that also waits', async () => {
    const w = copyOf(both, 'both');
    const external = readdirSync(w.dir).filter(f => /^NEEDS-.*\.md$/.test(f)).map(f => f.replace(/^NEEDS-|\.md$/g, '')).find(l => !existsSync(join(w.dir, `${l}.repair.json`)));
    const [a] = (await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id } }])).map(payload);
    assert.deepEqual(pick(a, ['stage', 'repairs']), { stage: external, repairs: [w.stage] }, JSON.stringify(a).slice(0, 400));
  });
  // 0.8.4 (S9-08, redone on this base): a stage may be named. A stage that waits for a repair is refused like the unnamed case (its seat already replied and was paid), the external stage named is the same as naming none, a stage not waited for is refused.
  test('RW-2a prepare_stage_prompt with a stage: a stage that waits for a repair is refused with the unnamed case\'s sentence, and the repair stays listed', async () => {
    const w = copyOf(both, 'both-named');
    const [named] = (await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id, stage: w.stage } }])).map(payload);
    assert.equal(named.error, `"${w.stage}" waits for a repair of a reply its seat already wrote, not for a new answer, so no stage bundle was written. Read the request with external_prompt and answer it with repair_reply.`);
    assert.deepEqual(named.repairs, [w.stage]);
    assert.equal(existsSync(join(w.dir, 'stage_prompt.md')) || readdirSync(w.dir).some(f => f.startsWith('stage_prompt-')), false, 'no bundle was written');
  });
  test('RW-2b prepare_stage_prompt with a stage: a stage the run is not waiting for is refused', async () => {
    const w = copyOf(both, 'both-unknown');
    const [ghost] = (await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id, stage: 'panel-9-nobody' } }])).map(payload);
    assert.match(ghost.error, /not waiting/);
  });
  test('RW-2c (control: the old tree passes it too) naming the external stage that is not a repair is the same as naming none: stage_prompt.md', async () => {
    const w = copyOf(both, 'both-first');
    const external = readdirSync(w.dir).filter(f => /^NEEDS-.*\.md$/.test(f)).map(f => f.replace(/^NEEDS-|\.md$/g, '')).find(l => !existsSync(join(w.dir, `${l}.repair.json`)));
    const [first] = (await mcp(w.work, [{ name: 'prepare_stage_prompt', arguments: { run: w.id, stage: external } }])).map(payload);
    assert.equal(first.written, join(w.dir, 'stage_prompt.md'));
    assert.deepEqual(pick(first, ['stage', 'repairs']), { stage: external, repairs: [w.stage] });
  });
});

// 0.8.4 (S9-02 on this base; Mini-C&C's FIX of 4 Nov 2026): external_prompt reads a long prompt in pages, and a page of a stage that waits for a REPAIR must still say what the whole answer says: `repair` (the kind) and `answerWith`
// (repair_reply, never submit_stage), on every page. Real paused run, $0. Two subtests so each assertion can show its own failure from one known-bad input (a stage that waits for no repair).
const PAGED = { fixture: () => nj, stageOf: w => w.stage };
describe('external_prompt in pages on a repair stage', () => {
  let w; let page1; let page2;
  before(async () => {
    w = copyOf(PAGED.fixture(), 'paged');
    [page1, page2] = (await mcp(w.work, [
      { name: 'external_prompt', arguments: { run: w.id, stage: PAGED.stageOf(w), max_chars: 500, part: 1 } },
      { name: 'external_prompt', arguments: { run: w.id, stage: PAGED.stageOf(w), max_chars: 500, part: 2 } },
    ])).map(payload);
  });
  test('RP-0 (control: holds on any tree that pages) the prompt has a second page of its own', () => {
    assert.equal(page1.part, 1);
    assert.ok(page1.parts >= 2, JSON.stringify(pick(page1, ['parts', 'total_chars', 'error'])));
    assert.equal(page2.part, 2);
  });
  test('RP-1 page 2 of a stage that waits for a repair still names the repair and the repair_reply call', async t => {
    await t.test('(a) the kind of the repair', () => assert.equal(page2.repair, 'near_json'));
    await t.test('(b) answerWith is the repair_reply call', () => assert.equal(page2.answerWith, `repair_reply(run, "${w.stage}", text: <the reply with its JSON fixed>) or repair_reply(run, "${w.stage}", decline: true)`));
  });
});

describe('run-folder checks', () => {
  test('RZ-1 a symbolic link in the run folder is refused', async () => {
    const w = copyOf(nj, 'link');
    symlinkSync(join(w.dir, 'run.json'), join(w.dir, 'originals', 'link.md'));
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    // CHANGED ACCEPTED (0.8.4 F3). OLD: a.error equal to the whole sentence. NEW: the same sentence with the link's name between this call's markers (src/return-path.js fragment(); the name is read from the run folder). WHY: only the value read from the folder is marked, the harness's words are not.
    assert.match(a.error, new RegExp(`^refused: runs/${w.id}/<<<THC-UNTRUSTED-TEXT ([0-9a-f]+)>>>originals/link\\.md<<<END THC-UNTRUSTED-TEXT \\1>>> is a symbolic link, and the harness never creates one in a run folder \\(remove it, or look at the folder yourself\\)$`));
  });
  test('RZ-2 a tree member is repaired and not resumed: the tree resumes it', async () => {
    const w = copyOf(nj, 'member');
    const meta = JSON.parse(readFileSync(join(w.dir, 'run.json'), 'utf8'));
    writeFileSync(join(w.dir, 'run.json'), JSON.stringify({ ...meta, tree: { treeId: 'tree-a', node: 'R/a', generation: 1 } }));
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    assert.deepEqual(pick(a, ['repaired', 'resumed', 'tree', 'command']), { repaired: true, resumed: false, tree: true, command: 'council tree resume tree-a' }, JSON.stringify(a).slice(0, 400));
  });
  test('RZ-3 a reply file already at the label is never overwritten: the resume checks it', async () => {
    const w = copyOf(nj, 'present');
    writeFileSync(join(w.dir, `${w.stage}.md`), nearJsonRepair(originalText(w)));
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    assert.equal(a.error, `"${w.stage}" already has a reply file (${w.stage}.md) that the run has not yet checked against the original, so nothing was written; resume the run (resume_run) to have it checked`);
  });
  test('RZ-4 an unreadable pause marker is refused', async () => {
    const w = copyOf(nj, 'marker');
    writeFileSync(join(w.dir, `${w.stage}.repair.json`), '{ not json');
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    assert.equal(a.error, `${w.stage}.repair.json cannot be read, so there is nothing to hold a repair to and nothing was written; look at the run folder`);
  });
  test('RZ-5 an original that cannot be read is refused', async () => {
    const w = copyOf(nj, 'gone');
    renameSync(join(w.dir, 'originals', `${w.stage}.1.md`), join(w.dir, 'originals', `${w.stage}.1.md.moved`));
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    assert.equal(a.error, `the original reply of "${w.stage}" cannot be read from originals/, so no repair can be checked against it and nothing was written`);
  });
  test('RZ-6 a pause record that names a kind of repair the harness does not know is refused (fail closed)', async () => {
    const w = copyOf(nj, 'kind');
    const marker = JSON.parse(readFileSync(join(w.dir, `${w.stage}.repair.json`), 'utf8'));
    writeFileSync(join(w.dir, `${w.stage}.repair.json`), JSON.stringify({ ...marker, kind: 'made-up' }));
    const [a] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, decline: true } }])).map(payload);
    assert.equal(a.error, `the pause record of "${w.stage}" names a kind of repair the harness does not know, so nothing was written; look at the run folder`);
  });
});

// 4 Nov 2026 (unit 8): an exchange post on an objection id one character off (kind id_slip). A real run of a layered mock chain with the exchange on, whose slip judge (mock-exch-slip-keep) writes every id it posts on one
// character off. Its own base run, built in this group's hook: on a tree without the id-slip pause the post is dropped and the run goes on, so only this group fails, at the hook (exit code and output in the message).
describe('an id_slip repair with ids', () => {
  let sl; let w; let r = {}; let marker; let original;
  before(async () => {
    sl = pausedRun('sl', { name: 'repair-tool-sl', description: 'Test: a layered mock panel with the exchange on, whose slip judge writes every objection id it posts on one character off.', maxRounds: 2, signoff: 'unanimous', seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [{ provider: 'mock', model: 'mock-exch-slip-keep', lab: 'e1', layer: 1 }, { provider: 'mock', model: 'mock-exch-support-keep', lab: 'e2', layer: 1 }, { provider: 'mock', model: 'mock-critic-x', lab: 'e3', layer: 2 }] } });
    const refusals = copyOf(sl, 'sl-refuse');
    marker = JSON.parse(readFileSync(join(refusals.dir, `${refusals.stage}.repair.json`), 'utf8'));
    const out = await mcp(refusals.work, [
      { name: 'repair_reply', arguments: { run: refusals.id, stage: refusals.stage, ids: [{ from: marker.slips[0].from, to: 'O-00000000' }] } },
      { name: 'repair_reply', arguments: { run: refusals.id, stage: refusals.stage, text: originalText(refusals) } },
      { name: 'external_prompt', arguments: { run: refusals.id, stage: refusals.stage } },
    ]);
    [r.otherPair, r.text, r.prompt] = out.map(payload);
    w = copyOf(sl, 'sl-ids');
    original = originalText(w);
    [r.answer] = (await mcp(w.work, [{ name: 'repair_reply', arguments: { run: w.id, stage: w.stage, ids: marker.slips } }])).map(payload);
  });
  after(async () => { if (w) assert.ok(await childGone(w.dir), 'the resumed child exited'); });

  test('RI-1 the tool answers that the stage was repaired, with the kind and the shown ids it now names', () => {
    assert.deepEqual(pick(r.answer, ['repaired', 'kind', 'changed']), { repaired: true, kind: 'id_slip', changed: marker.slips.map(p => p.to) }, JSON.stringify(r.answer).slice(0, 400));
  });
  test('RI-2 the stage file is the original with each slipped id set to its shown id, nothing else changed', () => {
    const o = JSON.parse(original);
    const to = new Map(marker.slips.map(p => [p.from, p.to]));
    assert.deepEqual(JSON.parse(readFileSync(join(w.dir, `${w.stage}.md`), 'utf8')), { ...o, posts: o.posts.map(p => (to.has(p.on) ? { ...p, on: to.get(p.on) } : p)) });
  });
  test('RI-3 a pair the pause did not find is refused', () => {
    assert.equal(r.otherPair.error, `ids may name only these pairs, each once: ${marker.slips.map(p => `${p.from} -> ${p.to}`).join(', ')} (the ids one character from an id the seat was shown); nothing was written`);
  });
  test('RI-4 text on an id_slip pause is refused', () => {
    assert.equal(r.text.error, `"${sl.stage}" waits for a repair of an objection id one character off: give ids (or decline: true), not text; nothing was written`);
  });
  test('RI-5 external_prompt names ids for an id_slip repair', () => {
    assert.equal(r.prompt.answerWith, `repair_reply(run, "${sl.stage}", ids: [{ from: "<id>", to: "<id>" }]) or repair_reply(run, "${sl.stage}", decline: true)`);
  });
  test('RI-7 the request (external_prompt\'s prompt, the NEEDS file the CLI wrote) is the id-slip request', () => {
    assert.match(String(r.prompt.prompt), new RegExp(`^# Repair needed: ${sl.stage} \\(an objection id one character off\\)`));
  });
  test('RI-6 the real CLI says what an id-slip pause is', () => {
    assert.match(sl.out, new RegExp(`PAUSED: stage "${sl.stage}" got a reply that names an objection id one character off; it needs a repair \\(only that id may change\\)\\.`));
  });
});
