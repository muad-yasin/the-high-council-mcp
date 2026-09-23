// test/argued.test.js
//
// "How this plan was argued" (opt-in, `argued: { enabled: true }`; Muad 2026-09-23, "let's do #3").
// All offline, on mock seats. Pinned here: the flag off changes nothing (no stage, no key, every
// prompt byte-identical), the stage runs once after the handoff on the handoff seat, the writer is
// fed a fact pack and nothing about a debate that did not happen passes unflagged, report.json is
// additive, the dry run prices it, and the external-seat path works through the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runChain } from '../src/chain.js';
import { estimateChainRows } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';
import { reportJsonShape } from '../src/report-shape.js';
import { buildArguedFacts, checkArguedRefs, decisionsSection, arguedWarnings, knownRefsOf, ARGUED_SYSTEM } from '../src/argued.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const EXTERNAL = { provider: 'external', model: 'claude-code-session' };
const base = () => ({ ...chain('mock-debate'), alternatives: { enabled: true } });
const withArgued = (extra = {}) => ({ ...base(), argued: { enabled: true }, ...extra });
const labels = r => r.stages.map(s => s.label);
const run = (config, opts = {}) => runChain({ config, request: 'A mock task.', log: () => {}, ...opts });

test('argued off: no stage, no result key - absent and enabled:false are the same run', async () => {
  for (const config of [base(), { ...base(), argued: { enabled: false } }]) {
    const r = await run(config);
    assert.ok(!labels(r).some(l => l.startsWith('argued')));
    assert.equal('argued' in r, false);
    assert.equal('argued' in reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: r }), false);
  }
});

test('argued: the flag touches no other prompt - every shared stage has the same prompt hash, on or off', async () => {
  const off = await run(base());
  const on = await run(withArgued());
  const hashes = r => Object.fromEntries(r.stages.map(s => [s.label, s.promptHash]));
  const a = hashes(off); const b = hashes(on);
  assert.ok(Object.values(a).every(Boolean), 'precondition: every stage records a prompt hash');
  assert.deepEqual(Object.keys(b).filter(l => !(l in a)), ['argued'], 'the flag adds exactly one stage');
  for (const l of Object.keys(a)) assert.equal(b[l], a[l], `stage ${l}'s prompt changed when argued was switched on`);
});

test('argued: one stage after the handoff, on the handoff seat, and it writes a checked section', async () => {
  const r = await run(withArgued());
  const L = labels(r);
  assert.equal(L.at(-1), 'argued');
  assert.equal(L.at(-2), 'handoff');
  const st = r.stages.find(s => s.label === 'argued');
  assert.equal(st.model, 'mock-builder', 'no handoff seat in this chain, so the builder writes it');
  const { text, check, facts_counts, file } = r.argued;
  assert.equal(file, 'ARGUED.md');
  for (const h of ['# How this plan was argued', '## The big options', '## The objections and how the authors answered', '## What is still disputed', '## Where each lab stood']) assert.ok(text.includes(h), `missing ${h}`);
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.ok(check.refs_cited >= 6);
  assert.equal(facts_counts.labs, 2);
  assert.equal(facts_counts.alternatives, 2);
  assert.ok(!r.deliverable.includes('How this plan was argued'), 'the section never goes into the deliverable');
});

test('argued: a dedicated handoff seat writes it, not the builder', async () => {
  const c = withArgued();
  c.seats = { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-seat' } };
  const r = await run(c);
  assert.equal(r.stages.find(s => s.label === 'argued').model, 'mock-handoff-seat');
});

test('argued: a debate that never happened is flagged - an invented id and an invented lab', async () => {
  const c = withArgued();
  c.seats = { ...c.seats, handoff: { provider: 'mock', model: 'mock-argued-inventor' } };
  const r = await run(c);
  const { check } = r.argued;
  assert.equal(check.ok, false);
  assert.deepEqual(check.unknown_refs, ['PHANTOM-9']);
  assert.deepEqual(check.unknown_labs, ['phantom-lab']);
  assert.ok(r.argued.text.includes('PHANTOM-9'), 'the text is kept as written - flagged, never silently fixed');
  const w = arguedWarnings(check);
  assert.ok(w.some(l => l.startsWith('argued_unknown_ref:') && l.includes('PHANTOM-9')));
  assert.ok(w.some(l => l.startsWith('argued_unknown_lab:') && l.includes('phantom-lab')));
});

// ---------------------------------------------------------------------------
// The fact pack and the check, directly.

const PROPOSALS = [
  { id: 'OA-1', lab: 'oa', title: 'Queue', withdrawn: true, replaced_by: 'GG-1' },
  { id: 'OA-2', lab: 'oa', title: 'Cache', amended: true },
  { id: 'GG-1', lab: 'gg', title: 'Worker pool' },
  { id: 'GG-2', lab: 'gg', title: 'Metrics' },
];
const DEBATE = {
  posts: [
    { by: 'gg', on: 'OA-2', stance: 'object', text: 'cache is unbounded' },
    { by: 'gg', on: 'OA-1', stance: 'merge', text: 'same as GG-1', merge_with: 'GG-1' },
    { by: 'oa', on: 'GG-2', stance: 'object', text: 'metrics out of scope' },
    { by: 'oa', on: 'GG-1', stance: 'support', text: 'fine' },
    { by: 'canary', on: 'GG-1', stance: 'object', text: 'evidence-free', canary: true },
  ],
  replies: [
    { id: 'OA-2', action: 'amend', text: 'bounded at 1k' },
    { id: 'OA-1', action: 'withdraw', text: 'merged', replaced_by: 'GG-1' },
    { id: 'GG-2', action: 'keep', text: 'it is in scope' },
    { by: 'canary', id: 'GG-1', action: 'keep', text: 'held', canary: true },
  ],
};
const facts = () => buildArguedFacts({
  proposals: PROPOSALS,
  scoreRows: [{ id: 'OA-1', status: 'withdrawn' }, { id: 'OA-2', status: 'accepted' }, { id: 'GG-1', status: 'accepted' }, { id: 'GG-2', status: 'cut' }],
  debate: DEBATE,
  disputes: [{ round: 2, reason: 'the panel asked for a second database; declined' }],
  dispute: { ran: true, reason: 'round_cap', open_objections: [{ criterion: 'Security', lab: 'gg', problem: 'no auth on the admin route', first_raised_round: 1 }] },
  signoff: [{ provider: 'oa', signedOff: true, passed: false }, { provider: 'gg', signedOff: false, passed: false }],
  plan: '# Plan\n\n## 1. Scope\n\nx\n\n## 4. Decisions\n\n### Queue or pool\n- Choice: pool\n- Why the others lost: queue adds a broker\n\n## 5. Risks\n\ny',
});

test('facts: canary posts never reach the writer; objected proposals are ranked by what followed', () => {
  const f = facts();
  assert.ok(!JSON.stringify(f).includes('evidence-free'), 'a canary post is not a lab\'s objection');
  assert.ok(!f.labs.some(l => l.lab === 'canary'));
  assert.deepEqual(f.objected_proposals.map(o => o.on), ['OA-1', 'OA-2', 'GG-2'], 'withdrawal, then amendment, then a cut part');
  assert.equal(f.objected_proposals[0].author_replies[0].action, 'withdraw');
  assert.ok(!f.objected_proposals.some(o => o.objections.some(x => x.stance === 'support')), 'a support post is not an objection');
  assert.equal(f.counts.objections, 3);
});

test('facts: several labs objecting to one withdrawn proposal make one entry, and the others still make the top five', () => {
  const proposals = [
    { id: 'AA-1', lab: 'aa', title: 'Monolith', withdrawn: true },
    ...['AA-2', 'AA-3', 'AA-4', 'AA-5', 'AA-6'].map(id => ({ id, lab: 'aa', title: id })),
  ];
  const debate = {
    posts: [
      ...['bb', 'cc', 'dd'].map(by => ({ by, on: 'AA-1', stance: 'object', text: `${by}: too big` })),
      ...['AA-2', 'AA-3', 'AA-4', 'AA-5'].map(on => ({ by: 'bb', on, stance: 'object', text: `nit on ${on}` })),
    ],
    replies: [
      { id: 'AA-1', action: 'withdraw', text: 'split it' },
      ...['AA-2', 'AA-3', 'AA-4', 'AA-5'].map(id => ({ id, action: 'keep', text: 'kept' })),
    ],
  };
  const f = buildArguedFacts({ proposals, debate, scoreRows: [{ id: 'AA-1', status: 'withdrawn' }] });
  assert.equal(f.objected_proposals.filter(o => o.on === 'AA-1').length, 1, 'one entry per proposal, however many labs objected');
  const aa1 = f.objected_proposals[0];
  assert.equal(aa1.on, 'AA-1');
  assert.deepEqual(aa1.objections.map(o => o.by), ['bb', 'cc', 'dd']);
  assert.deepEqual(aa1.author_replies, [{ action: 'withdraw', text: 'split it' }], 'the reply is the author\'s, to the proposal - listed once');
  assert.ok(aa1.objections.every(o => !('answer' in o) && !('caused' in o)), 'no objection is paired with the reply as its cause');
  assert.deepEqual(f.objected_proposals.map(o => o.on), ['AA-1', 'AA-2', 'AA-3', 'AA-4', 'AA-5']);
  assert.equal(f.counts.objections, 7);
  assert.equal(f.counts.objected_proposals, 5);
  assert.match(ARGUED_SYSTEM, /never records that an objection caused/);
});

test('facts: the only citable ids are ones a reader can find in BOARD.md or the plan', () => {
  const f = facts();
  assert.ok(!/"ref":\s*"(?:AP|AR|RV|P|R|D|U)\d+"/.test(JSON.stringify(f)), 'no internal post/reply/dispute numbering');
  const { refs } = knownRefsOf(f);
  assert.deepEqual([...refs].sort(), ['DECISIONS', 'GG-1', 'GG-2', 'OA-1', 'OA-2']);
  assert.deepEqual(checkArguedRefs(GOOD.replace('(`OA-1`, `gg`)', '(`P2`, `R2`)'), f).unknown_refs, ['P2', 'R2']);
});

test('facts: disputes, the decision records and per-lab stances', () => {
  const f = facts();
  assert.equal(f.declined_objections[0].round, 2);
  assert.equal(f.unresolved.open_objections[0].lab, 'gg');
  assert.match(f.decisions.text, /^## 4\. Decisions/);
  assert.ok(!f.decisions.text.includes('Risks'), 'the section stops at the next heading of its level');
  const oa = f.labs.find(l => l.lab === 'oa');
  assert.equal(oa.final_verdict, 'signed off');
  assert.equal(f.labs.find(l => l.lab === 'gg').final_verdict, 'objected');
  assert.deepEqual([oa.proposed, oa.accepted, oa.withdrawn, oa.objections_raised, oa.supports_raised], [2, 1, 1, 1, 1]);
});

test('decisionsSection: numbered and unnumbered headings, and none', () => {
  assert.match(decisionsSection('# P\n\n# Decisions\n\na\n\n# Next\n'), /^# Decisions\n\na$/);
  assert.match(decisionsSection('## §3 Decisions\nb\n### sub\nc\n## After'), /sub\nc$/);
  assert.equal(decisionsSection('# P\n\nno records here'), null);
});

const GOOD = `# How this plan was argued

Two labs.

## The big options

The plan took the pool (\`DECISIONS\`).

## The objections and how the authors answered

- \`gg\` asked to merge \`OA-1\` into \`GG-1\`; the author withdrew it (\`OA-1\`, \`gg\`). UTF-8 input stays as it was.

## What is still disputed

- \`gg\` on security; a declined request in round 2 (\`gg\`).

## Where each lab stood

- \`oa\`: signed off.
- \`gg\`: objected.
`;

test('check: a section that cites only the record passes, and prose like UTF-8 is not an id', () => {
  const c = checkArguedRefs(GOOD, facts());
  assert.equal(c.ok, true, JSON.stringify(c));
});

test('check: an unknown id (backticked or bare), an unknown lab, a missing lab line and a missing section are each flagged', () => {
  const f = facts();
  assert.deepEqual(checkArguedRefs(GOOD.replace('(`DECISIONS`)', '(`GG-7`)'), f).unknown_refs, ['GG-7']);
  assert.deepEqual(checkArguedRefs(GOOD.replace('Two labs.', 'Two labs, see P9 and OA-7.'), f).unknown_refs, ['OA-7', 'P9']);
  const lab = checkArguedRefs(GOOD.replace('- `gg`: objected.', '- `grok`: objected.'), f);
  assert.deepEqual(lab.unknown_labs, ['grok']);
  assert.deepEqual(lab.missing_labs, ['gg']);
  assert.deepEqual(checkArguedRefs(GOOD.replace('## What is still disputed', '## Open'), f).missing_sections, ['What is still disputed']);
});

test('the writer prompt forbids invention and demands a cited id on every claim', () => {
  assert.match(ARGUED_SYSTEM, /Use only the fact pack/);
  assert.match(ARGUED_SYSTEM, /Nothing recorded\./);
  assert.match(ARGUED_SYSTEM, /End every claim about the debate with the ids it rests on/);
  assert.match(ARGUED_SYSTEM, /do not say the debate made the plan better/);
});

// ---------------------------------------------------------------------------
// Config, dry run, stage contract.

test('dry run: one argued row on the handoff seat, only when on; nothing else moves', () => {
  const off = estimateChainRows(base());
  const on = estimateChainRows(withArgued());
  assert.equal(on.length, off.length + 1);
  const row = on.find(r => r.label === 'argued');
  assert.ok(row, 'the dry run must price the stage');
  assert.deepEqual(on.filter(r => r.label !== 'argued'), off);
  assert.ok(!estimateChainRows({ ...withArgued(), descending: { order: ['plan'] } }).some(r => r.label === 'argued'));
});

test('dry run: on the plan-7 rosters the stage is an external seat, so it adds $0; a billed seat is priced', () => {
  for (const name of ['plan-premium-7', 'plan-open-7']) {
    const row = estimateChainRows({ ...chain(name), argued: { enabled: true } }).find(r => r.label === 'argued');
    assert.equal(row.seat, 'external/claude-code-session', `${name}: the stage must land on the external handoff seat`);
    assert.equal(row.usd, 0);
  }
  const billed = { ...chain('plan-open-7'), argued: { enabled: true } };
  billed.seats = { ...billed.seats, handoff: billed.seats.critics[0] };
  const row = estimateChainRows(billed).find(r => r.label === 'argued');
  assert.ok(row.priced && row.usd > 0, 'a billed handoff seat must be priced for the stage');
});

test('lint: the flag lints clean, a typo is caught, descending is refused, and no shipped chain enables it', () => {
  assert.deepEqual(lintChain(withArgued()), []);
  assert.ok(lintChain({ ...withArgued(), argued: { enable: true } }).some(f => f.kind === 'invalid-argued-config'));
  assert.ok(lintChain({ ...withArgued(), argued: { enabled: 'yes' } }).some(f => f.kind === 'invalid-argued-config'));
  assert.ok(lintChain({ ...withArgued(), descending: { order: ['plan'] } }).some(f => f.kind === 'argued-with-descending'));
  const shipped = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'));
  for (const f of shipped) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    assert.ok(!(c.argued && c.argued.enabled), `${f} enables argued - that is Muad's call after he has seen an example`);
  }
});

test('stage contract: the label maps to its own kind, after handoff', async () => {
  const { stageKindOf, stageKindsFor, isStructuredStage } = await import('../src/stage-contract.js');
  assert.equal(stageKindOf('argued'), 'argued');
  assert.equal(stageKindOf('argued-retry'), 'argued');
  assert.equal(isStructuredStage('argued'), false);
  const kinds = stageKindsFor(withArgued());
  assert.equal(kinds.at(-1), 'argued');
  assert.equal(kinds.at(-2), 'handoff');
  assert.ok(!stageKindsFor(base()).includes('argued'));
});

test('report.json: an additive argued field carrying the file, the counts and the check - never the text', async () => {
  const r = await run(withArgued());
  const rep = reportJsonShape({ runId: 'x', chain: 'c', task: 't', result: r });
  assert.equal(rep.argued.file, 'ARGUED.md');
  assert.equal(rep.argued.ok, true);
  assert.deepEqual(rep.argued.unknown_refs, []);
  assert.equal(rep.argued.facts_counts.labs, 2);
  assert.equal('text' in rep.argued, false);
});

// ---------------------------------------------------------------------------
// Through the real CLI, with the plan-7 shape: an external handoff seat.

const cli = join(root, 'src', 'cli.js');
function cliDir(config) {
  const dir = mkdtempSync(join(tmpdir(), 'argued-cli-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', `${config.name}.json`), JSON.stringify(config, null, 2));
  return dir;
}
function cliRun(args, dir) {
  try {
    return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('CLI: an external handoff seat pauses for the section too; the answer lands in ARGUED.md and an invented id in WARNINGS.md', () => {
  const c = withArgued({ name: 'test-argued-ext' });
  c.seats = { ...c.seats, handoff: EXTERNAL };
  const dir = cliDir(c);
  const first = cliRun(['--chain', 'test-argued-ext', '--task', 'tasks/x.md'], dir);
  assert.equal(first.code, 3, first.out);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  assert.ok(existsSync(join(runDir, 'NEEDS-handoff.md')));
  writeFileSync(join(runDir, 'handoff.md'), 'HANDOFF\n\nRead PLAN.md.\n');
  const second = cliRun(['--resume', `runs/${id}`], dir);
  assert.equal(second.code, 3, second.out);
  const needs = readFileSync(join(runDir, 'NEEDS-argued.md'), 'utf8');
  assert.match(needs, /How this plan was argued/);
  assert.match(needs, /# Fact pack/);
  writeFileSync(join(runDir, 'argued.md'), GOOD.replace('(`DECISIONS`)', '(`NOPE-3`)'));
  const third = cliRun(['--resume', `runs/${id}`], dir);
  assert.equal(third.code, 0, third.out);
  assert.match(readFileSync(join(runDir, 'ARGUED.md'), 'utf8'), /^# How this plan was argued/);
  assert.ok(!readFileSync(join(runDir, 'deliverable.md'), 'utf8').includes('How this plan was argued'));
  assert.match(readFileSync(join(runDir, 'WARNINGS.md'), 'utf8'), /argued_unknown_ref: .*NOPE-3/);
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.argued.ok, false);
  assert.ok(report.argued.unknown_refs.includes('NOPE-3'));
});

test('CLI: a chain without the flag writes no ARGUED.md and no report field', () => {
  const dir = cliDir({ ...base(), name: 'test-no-argued' });
  const r = cliRun(['--chain', 'test-no-argued', '--task', 'tasks/x.md'], dir);
  assert.equal(r.code, 0, r.out);
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  assert.equal(existsSync(join(runDir, 'ARGUED.md')), false);
  assert.equal('argued' in JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')), false);
});
