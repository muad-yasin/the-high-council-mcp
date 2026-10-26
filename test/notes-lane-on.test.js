// The notes lane is ON (A2, 18 Okt 2026; Muad: "lane ON in 0.8.3 with the pass-2 wording", E195). Offline, $0. These rows use the REAL src/roles.js (no setHeldForTest words): they are the proof that
// the four lane sentences are recorded, that the six planning chains run the lane and no other shipped chain does, that the judge is asked with the pass-2 wording, that the retired text is gone from
// everything that ships, that every chain description carries the same memory clause the code prints, and that an external writer pauses at the handoff and never at `handoff-notes`.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, ExternalPause, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reviewNotesActive, notesMemoryClause, LANE_HELD_NAMES } from '../src/review-notes-lane.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as R from '../src/roles.js';
import { noteId, MEMORY_MAX_TOKENS_EST } from '../src/review-notes.js';
import { priceOf } from '../src/cost.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chainOf = f => JSON.parse(readFileSync(join(ROOT, 'chains', f), 'utf8'));
afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

// Hand-typed: the six planning chains that carry `reviewNotes` (Muad 15 Okt 23:09 "4: all three" tiers; the two Chinese chains as their siblings, China_Chains_Gate_Note, picks 59-62).
const LANE_CHAINS = ['plan-china-high-council.json', 'plan-china-medium-council.json', 'plan-china-mini-council.json', 'plan-high-council.json', 'plan-medium-council.json', 'plan-mini-council-sol-session.json', 'plan-mini-council.json', 'plan-default-opro-council.json'];   // 0.8.3 (lane B, commit 2): the one-key chain carries `reviewNotes` like its siblings (CHANGED ACCEPTED: the list grows by the new shipped chain; hand-typed on purpose)

test('NL-1: the real src/roles.js records all four lane sentences, and the lane is active on exactly the planning chains in LANE_CHAINS plus plan-claude-council', () => {
  for (const n of LANE_HELD_NAMES) assert.equal(typeof R[n], 'function', `${n} is recorded in src/roles.js`);
  const active = readdirSync(join(ROOT, 'chains')).filter(f => f.endsWith('.json') && reviewNotesActive(chainOf(f)));
  // OLD (before 18 Okt 2026): exactly LANE_CHAINS (six). NEW: those six plus plan-claude-council, which carries `reviewNotes` and has NO paid seat (every seat external, dry run $0.00): it has no paid memory block, so NL-4 and NL-4b, which require the memory clause and a dollar bound, keep reading LANE_CHAINS (six) only. WHY: a new shipped chain, 76's file, Muad's name and shape (18 Okt 14:01-14:04).
  assert.deepEqual(active, [...LANE_CHAINS, 'plan-claude-council.json'].sort());
});

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok', ...extra });
async function runLive({ replies = () => undefined, builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' }, withHandoff = false, cacheText = () => undefined } = {}) {
  const prompts = new Map(); const served = []; const logs = [];
  setPromptSpy(p => { prompts.set(p.label, p.user); });
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const own = cacheText(label); if (own !== undefined) return own === null ? null : { text: own, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    if (builder.provider === 'external' && (label === 'handoff' || label === 'notes-answer')) return null;
    const text = label.startsWith('panel-') ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = {
    name: 'fixture-lane-on', criteria: [CRITERION], signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, freedoms: { pass: true }, reviewNotes: { enabled: true, perKind: 3 }, ...(withHandoff ? { handoff: true } : {}),
    seats: { builder, reviser: builder, ...(withHandoff ? { handoff: builder } : {}), critics: [seat('la', 1), seat('lb', 2), seat('lc', 3)] },
  };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-lane-on', log: l => logs.push(l), config });
  return { result, prompts, served, logs, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-lane-on', chain: 'fixture-lane-on', task: 't.md', result, config }))) };
}

test('NL-2: with the REAL roles a judge is asked for notes with the pass-2 wording, the lane is on without any injection, and no log line says it is held', async () => {
  setHeldForTest(null);
  const { prompts, logs, report } = await runLive({ replies: l => (l === 'panel-1-la' ? signoff({ proposals: [{ text: 'Add a queue' }] }) : undefined) });
  const ask = prompts.get('panel-1-la');
  assert.ok(ask.includes('An improvement idea changes something the plan already contains.'), 'E189 ask sentence');
  assert.ok(ask.includes('A requirement the plan misses belongs in your verdict as an objection, not here.'), 'E189 requirement sentence');
  assert.equal(ask.includes('improves something the plan already contains'), false, 'the held wording is gone');
  assert.ok(report.review_notes && report.review_notes.items.length === 1, 'the item is recorded');
  assert.equal(logs.some(l => /review notes held|not all recorded yet/.test(l)), false, 'E195: the lane-is-off log line is gone');
});

test('NL-3: the retired lane-off and held-draft wording is nowhere in anything that ships (src, config, schemas, chains, mcpb, docs, README, CHANGELOG)', () => {
  const RETIRED = ['nobody on the panel reviewed', 'you will pass it on as a builder task', 'the lane is off (review notes held)', 'prompt sentences are not all recorded yet', 'The lane does nothing until its prompt sentences are recorded',
    'In 0.8.3 the lane is off', 'improves something the plan already contains', 'Builder tasks from review notes', 'You wrote the plan you are about to be shown'];
  const files = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules' || n === 'archive') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(js|json|md|html|mjs)$/.test(n)) files.push(p); } };
  for (const dir of ['src', 'config', 'schemas', 'chains', 'mcpb', 'docs']) if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
  files.push(join(ROOT, 'README.md'), join(ROOT, 'AI-README.md'), join(ROOT, 'CHANGELOG.md'));   // AI-README.md: the README's moved sections (26 Okt 2026)
  assert.ok(files.length > 100, `the scan found ${files.length} files`);
  const hits = [];
  for (const f of files) { const t = readFileSync(f, 'utf8'); for (const s of RETIRED) if (t.includes(s)) hits.push(`${f.slice(ROOT.length + 1)}: ${s}`); }
  assert.deepEqual(hits, []);
});

test('NL-4: each of the six chain descriptions carries the memory clause the code prints (one number, never a copy: a count moves with the thing it counts)', () => {
  for (const f of LANE_CHAINS) {
    const c = chainOf(f); const clause = notesMemoryClause(c);
    assert.ok(clause.includes('judge calls read from overseer round 2 on') && clause.includes('paid input that neither figure prices'), `${f}: the clause exists`);
    assert.ok(c.description.includes(clause), `${f}: the description carries "${clause}"`);
  }
});

test('NL-4b: the README known-limit bullet carries the same memory-block token count and the same worst-case dollar bounds the code computes (block x judges x later overseer rounds x passes, at the table prices)', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes(`up to ${MEMORY_MAX_TOKENS_EST} tokens per call`), 'README: the token count');
  for (const f of LANE_CHAINS) {
    const c = chainOf(f); const name = f.replace('.json', '');
    const block = c.seats.critics.reduce((n, s) => n + (s.provider === 'external' ? 0 : (MEMORY_MAX_TOKENS_EST / 1e6) * priceOf(s.provider, s.model).in), 0);
    const passes = 1 + Object.values(c.layerRevisions ?? {}).reduce((a, b) => a + b, 0);
    const bound = (block * (c.maxOverseerRounds - 1) * passes).toFixed(2);
    assert.ok(readme.includes(`$${bound} for \`${name}\``), `README: "$${bound} for ${name}"`);
  }
});

test('NL-5: an external writer pauses at the folded handoff (never at handoff-notes); once the handoff is answered, the NOTE lines become a harness record, not a call', async () => {
  const external = { provider: 'external', model: 'claude-code-session', lab: 'writer' };
  const notes = l => (l === 'panel-1-la' ? signoff({ proposals: [{ text: 'Add a queue' }] }) : undefined);
  let pause = null;
  try { await runLive({ replies: notes, builder: external, withHandoff: true }); } catch (e) { pause = e; }
  assert.ok(pause, 'the run pauses at an external seat');
  assert.equal(pause.label, 'handoff', 'it pauses at the handoff, the folded notes answer; never at handoff-notes');
  const id = noteId('proposal', 'Add a queue');
  const answered = await runLive({ replies: notes, builder: external, withHandoff: true, cacheText: l => (l === 'handoff' ? `# Handoff\n\nBuild it.\n\nNOTE-TAKEN: ${id}` : l === 'handoff-notes' ? null : undefined) });   // handoff-notes is not on disk yet: the harness writes it from the handoff reply
  const rec = answered.result.stages.filter(s => s.label === 'handoff-notes');
  assert.equal(rec.length, 1, 'one handoff-notes record');
  assert.equal(rec[0].provider, 'harness', 'a harness record, never a call');
  assert.equal(answered.report.review_notes.items[0].answer.status, 'builder_task', 'NOTE-TAKEN after a signed plan = passed on as a builder task');
  assert.equal(answered.served.filter(l => l === 'notes-answer').length, 0, 'the fold made no standalone notes-answer call');
});
