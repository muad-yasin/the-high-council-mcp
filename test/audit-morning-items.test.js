// 0.8.2 morning items (owner answers via C&C, 7 Oct 2026; brief Review/Build_0.8.2/BRIEF-MorningItems-20261007.md). $0, offline.
// Item 2: the never-lower rule also refuses an explicit effort BELOW the model's own default (a model whose default is above "high").
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { loweringReasons, reasoningProblems, rowOf } from '../src/reasoning.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shippedPath = join(root, 'chains', 'x.json');
const userPath = '/tmp/some-project/chains/x.json';
const chainWith = (model, extra) => ({ seats: { critics: [{ provider: 'openrouter', model, maxTokens: 16000, ...(extra ? { extra } : {}) }] } });
const hits = (cfg, path) => lintChain(cfg, path).filter(f => f.kind === 'reasoning-not-high');

test('item 2: the table really has above-high-default rows (so the rule below is exercised on real data, not an injected table)', () => {
  for (const [m, def] of [['z-ai/glm-5.3-flash', 'max'], ['z-ai/glm-5.3', 'max'], ['qwen/qwen3.8-max-0902', 'xhigh']]) {
    const row = rowOf({ provider: 'openrouter', model: m });
    assert.equal(row?.defaultAboveHigh, true, m);
    assert.equal(row?.defaultEffort, def, m);
  }
});

test('item 2: an explicit "high" on a model whose default is above high is a lowering: refused for a shipped chain, passes in a user\'s own chain', () => {
  for (const m of ['z-ai/glm-5.3-flash', 'z-ai/glm-5.3', 'qwen/qwen3.8-max-0902']) {
    const cfg = chainWith(m, { reasoning: { effort: 'high' } });
    const found = hits(cfg, shippedPath);
    assert.equal(found.length, 1, `${m}: ${JSON.stringify(found)}`);
    assert.match(found[0].message, /own default/);
    assert.deepEqual(hits(cfg, userPath), [], `${m}: a user's own chain passes through`);
  }
});

test('item 2: below the model\'s own default is refused, at the default or above it passes, and no effort at all passes', () => {
  assert.equal(hits(chainWith('z-ai/glm-5.3-flash', { reasoning: { effort: 'xhigh' } }), shippedPath).length, 1, 'xhigh is below this model\'s default (max)');
  assert.deepEqual(hits(chainWith('z-ai/glm-5.3-flash', { reasoning: { effort: 'max' } }), shippedPath), [], 'the model\'s own default');
  assert.deepEqual(hits(chainWith('qwen/qwen3.8-max-0902', { reasoning: { effort: 'xhigh' } }), shippedPath), [], 'the model\'s own default');
  assert.deepEqual(hits(chainWith('qwen/qwen3.8-max-0902', { reasoning: { effort: 'max' } }), shippedPath), [], 'above the default is not a lowering');
  assert.deepEqual(hits(chainWith('z-ai/glm-5.3-flash'), shippedPath), []);
  assert.deepEqual(hits(chainWith('z-ai/glm-5.3-flash', { provider: { zdr: true } }), shippedPath), []);
});

test('item 2: the same words nested under extra_body are read, and a model whose default is high is not affected', () => {
  assert.equal(hits(chainWith('z-ai/glm-5.3-flash', { extra_body: { reasoning: { effort: 'high' } } }), shippedPath).length, 1);
  assert.deepEqual(hits(chainWith('openai/gpt-6.1-sol', { reasoning: { effort: 'high' } }), shippedPath), [], 'a model whose own default is not above high keeps "high" as the explicit setting');
  // The word check is the one list: loweringReasons (and so reasoningProblems) report it, one finding per setting (a word the older check already flags is not reported twice).
  const seat = { provider: 'openrouter', model: 'z-ai/glm-5.3-flash', maxTokens: 16000 };
  assert.equal(loweringReasons({ reasoning: { effort: 'high' } }, seat).length, 1);
  assert.equal(loweringReasons({ reasoning: { effort: 'low' } }, seat).length, 1);
  assert.equal(loweringReasons({ reasoning: { effort: 'high' } }).length, 0, 'without a seat there is no model to compare with');
  assert.equal(reasoningProblems({ ...seat, extra: { reasoning: { effort: 'high' } } }).length, 1);
});

// ---- Item 3a: verdictWord reads emphasis, backticks and a closing colon (cnc-prompts-parsers backlog; owner "Your recommendation to both, yes") ----
import { verdictWord, isMetVerdict, isReadableVerdict } from '../src/criteria-kinds.js';
import { normaliseCritique } from '../src/chain.js';
import { signoffTableGap } from '../src/criteria-ledger.js';

const CRITERIA = ['C1 The plan names an owner', 'C2 The plan has a rollback'];
const rowsWith = verdict => ({ meets: true, criteria: CRITERIA.map((criterion, i) => ({ criterion, verdict: i === 1 ? verdict : 'MET', evidence: 'quoted' })) });
const FAILED_FORMS = ['**FAILED**', 'Failed:', '`FAILED`', 'NOT MET:', '**Failed:**', '**Failed**:', '__FAILED__', '`Not met`:', '*NOT MET*', '**NOT_MET**', 'Fail:'];
const MET_FORMS = ['**PASSED**', '**MET**', 'Passed:', 'Met:', '`MET`', '**Met.**', '_PASS_', '**YES**:'];

test('item 3a: emphasis, backticks and a closing colon are not part of the verdict word (both directions)', () => {
  for (const w of FAILED_FORMS) {
    assert.equal(isReadableVerdict(w), true, w);
    assert.equal(isMetVerdict(w), false, w);
    const c = normaliseCritique(rowsWith(w));
    assert.equal(c.meets, false, `${w}: a failing row does not sign off`);
    assert.deepEqual(c.failures.map(f => f.criterion), [CRITERIA[1]], w);
  }
  for (const w of MET_FORMS) {
    assert.equal(isMetVerdict(w), true, w);
    assert.equal(normaliseCritique(rowsWith(w)).meets, true, w);
    assert.equal(signoffTableGap(rowsWith(w), CRITERIA), null, w);
  }
});

test('item 3a: the cell is still the WHOLE word, so a hedge is neither (no "first word" reading: "NOT MET" is not "NOT", "Met, except the TTL" is not MET)', () => {
  for (const w of ['**Partially met**', 'Met, except the TTL', 'MET (partially)', '**UNCHECKED**', 'Not met yet?', 'METHOD', 'Failed to check', '`see notes`', '**', '`', ':', '']) {
    assert.equal(isReadableVerdict(w), false, JSON.stringify(w));
  }
  assert.equal(verdictWord('NOT_MET'), 'NOT_MET', 'an underscore inside the word is kept (the FAILED reading allows it)');
  assert.equal(verdictWord('**Failed:**'), 'FAILED');
});

test('item 3a: a row that reads as neither word, in a chain WITHOUT signoff_table.required, does not fail the reply; with meets:true it still signs off (stated, not new: only the table gate refuses it)', () => {
  const c = normaliseCritique(rowsWith('**Partially met**'));
  assert.equal(c.meets, true, 'pre-existing: without signoff_table.required a critic\'s own meets:true stands');
  assert.equal(normaliseCritique({ ...rowsWith('**Partially met**'), meets: undefined }).unreadable, true, 'with no meets:true and no all-MET table it is an abstention, never consent');
  assert.equal(signoffTableGap(rowsWith('**Partially met**'), CRITERIA)?.kind, 'unreadable_verdict', 'under signoff_table.required it is an incomplete table');
});

// ---- Item 3b: every label chain.js can call a seat with has a stage kind, or is named below as one no shipped chain can reach ----
import { readFileSync, readdirSync } from 'node:fs';
import { stageKindOf, stageKindsFor, buildStageContract, isStructuredStage, requiredSectionsFor, renderStagePromptBundle } from '../src/stage-contract.js';
import { validateDeliverable } from '../src/partial-deliverable.js';

// The labels the code passes to invoke(): `label: 'x'` and `label: \`x-${...}\`` in src/chain.js, each `${...}` read as one sample name. The Tier 2 scan read only `label: 'criteria...'`, so it could not see these.
export function callLabels(src) {
  const out = new Set();
  for (const m of src.matchAll(/\blabel:\s*(['`])/g)) {
    let i = m.index + m[0].length; let text = ''; let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (depth === 0 && c === m[1]) break;
      if (m[1] === '`' && c === '$' && src[i + 1] === '{') { if (depth === 0) text += 'x'; depth++; i++; continue; }
      if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
      text += c;
    }
    if (!(m[1] === '`' && src[m.index + m[0].length] === '$')) out.add(text); // `${opts.label}-retry` is the retry of a label scanned on its own (checked below)
  }
  return [...out];
}
// Labels that no shipped chain can pause on, with the reason (each feature is OFF in every shipped chain: the test below checks that, so enabling one turns this red).
const NOT_REACHED = {
  'preflight-x': 'config.preflight', 'ambiguity-x': 'config.ambiguity_union', 'allocator-x': 'config.allocator', 'dispute-review-x': 'config.dispute.review',
  claims: 'config.claims', challenge: 'config.challenge', 'challenge-revise': 'config.challenge', 'descending-x': 'config.descending', 'descending-x-critic-x': 'config.descending',
};
const chainSrc = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
const LABELS = callLabels(chainSrc);

test('item 3b: the label scan has a floor and a control (a scanner that finds nothing is red, not green)', () => {
  assert.ok(LABELS.length >= 35, `found ${LABELS.length}`);
  for (const known of ['criteria', 'criteria-retry', 'build', 'dispute', 'cold-read', 'deep-dive-revise', 'x'.length ? 'panel-x-x' : '']) assert.ok(LABELS.includes(known), `${known} in ${LABELS.join(' ')}`);
  assert.deepEqual(callLabels('f({ label: `a-${b ? `c${d}` : ""}-e`, x: 1 }); g({ label: \'plain\' })').sort(), ['a-x-e', 'plain']);
});

test('item 3b: every label chain.js calls a seat with maps to a stage kind (so prepare_stage_prompt does not refuse it), or is named as unreachable', () => {
  const unmapped = LABELS.filter(l => stageKindOf(l) === null && !(l in NOT_REACHED));
  assert.deepEqual(unmapped, [], 'labels with no stage kind: add a kind or name them in NOT_REACHED with the reason');
  for (const l of Object.keys(NOT_REACHED)) assert.ok(LABELS.includes(l), `${l} is no longer a label: drop it from NOT_REACHED`);
  for (const l of LABELS.filter(l => !(l in NOT_REACHED))) { const k = stageKindOf(`${l}-retry`); assert.ok(k === null || k === stageKindOf(l), `${l}-retry`); }
});

test('item 3b: the features behind NOT_REACHED are off in every shipped chain', () => {
  const on = [];
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'));
    for (const [flag, v] of [['preflight', c.preflight], ['ambiguity_union', c.ambiguity_union?.enabled], ['allocator', c.allocator?.enabled], ['dispute.review', c.dispute?.review], ['claims', c.claims?.enabled], ['challenge', c.challenge?.enabled], ['descending', c.descending]]) if (v) on.push(`${f}: ${flag}`);
  }
  assert.deepEqual(on, []);
});

test('item 3b: dispute has its own kind, deep-dive-revise is a revise stage, canary-reply is a reply stage, cold-read has its own kind; each accepts a real-shaped answer and refuses a wrong-shaped one', () => {
  assert.equal(stageKindOf('dispute'), 'dispute', 'its prompt is not the reviser\'s: the panel is finished and the writer marks what could not be settled');
  assert.equal(stageKindOf('deep-dive-revise'), 'revise');
  assert.equal(stageKindOf('canary-reply-glm5.3'), 'reply');
  assert.equal(stageKindOf('cold-read'), 'cold-read');
  assert.equal(stageKindOf('cold-read-retry'), 'cold-read');
  // a revised draft is plain text; an empty answer is refused (both kinds)
  for (const k of ['revise', 'dispute']) {
    assert.equal(validateDeliverable(k, '# Plan\n\nThe owner is UNVERIFIED: a named file was never shown.\n').ok, true, k);
    assert.equal(validateDeliverable(k, '   ').ok, false, k);
  }
  // the bundle a driving session hands the writer carries the dispute job, not the reviser's (src/roles.js DISPUTE_SYSTEM)
  const bundle = renderStagePromptBundle({ contract: buildStageContract({}, 'dispute'), taskText: 't', chainName: 'plan-daily-7', label: 'dispute', run: 'r', references: [] });
  assert.match(bundle, /UNVERIFIED/);
  assert.match(bundle, /will not review the result/);
  assert.equal(/union of every critic/.test(bundle), false, 'not the reviser\'s brief');
  assert.equal(stageKindsFor({ signoff: 'unanimous', dispute: { enabled: true } }).includes('dispute'), true);
  assert.equal(stageKindsFor({ signoff: 'unanimous' }).includes('dispute'), false);
  // the cold reader's own format (src/roles.js COLD_READ_SYSTEM): JSON with raised + contradictions
  assert.equal(isStructuredStage('cold-read'), true);
  assert.deepEqual(requiredSectionsFor('cold-read'), ['raised', 'contradictions']);
  assert.equal(validateDeliverable('cold-read', '{ "raised": false, "contradictions": [] }').ok, true);
  assert.equal(validateDeliverable('cold-read', '{ "raised": true, "contradictions": [{ "sections": ["A", "B"], "note": "n" }] }').ok, true);
  assert.equal(validateDeliverable('cold-read', 'The plan reads fine to me.').ok, false);
  assert.equal(validateDeliverable('cold-read', '{ "raised": false }').ok, false);
  // a canary reply is read as a reply (same JSON shape as a debate reply)
  const canaryKind = stageKindOf('canary-reply-x');
  assert.equal(validateDeliverable(canaryKind, '{ "replies": [{ "id": "P1", "action": "keep" }] }').ok, true);
  assert.equal(validateDeliverable(canaryKind, 'I keep it.').ok, false);
  assert.equal(validateDeliverable(canaryKind, '{ "posts": [] }').ok, false);
  // the contract for the new kind can be built, and a chain lists it only when it runs it
  assert.equal(buildStageContract({}, 'cold-read').stage_id, 'cold-read');
  assert.equal(stageKindsFor({ signoff: 'unanimous', coldRead: { enabled: true } }).includes('cold-read'), true);
  assert.equal(stageKindsFor({ signoff: 'unanimous' }).includes('cold-read'), false);
});

// The symptom, through the real server: prepare_stage_prompt on a run paused at "dispute" / "deep-dive-revise" / "cold-read" used to answer "could not resolve this stage".
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

function mcpCalls(cwd, calls) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, 'src/cli.js'), '--mcp'], { cwd, env: { PATH: process.env.PATH, HOME: cwd } });
    const byId = new Map(); let buf = '';
    const timer = setTimeout(() => { child.kill(); fail(new Error(`timed out; got ids ${[...byId.keys()]}`)); }, 60_000);
    child.stdout.on('data', d => {
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, m); } catch { /* not JSON-RPC */ } }
      if (calls.every((_, i) => byId.has(i + 2))) { clearTimeout(timer); child.stdin.end(); child.kill(); done(calls.map((_, i) => byId.get(i + 2))); }
    });
    child.stdin.write([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stage-kinds', version: '0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, ...calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: c }))].map(x => JSON.stringify(x)).join('\n') + '\n');
  });
}

test('item 3b, through the server: prepare_stage_prompt writes the bundle for a run paused at dispute, deep-dive-revise and cold-read (a control label still works)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'thc-kinds-')); const work = join(base, 'work');
  try {
    for (const d of [work, join(work, 'tasks'), join(work, 'runs')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(work, 'tasks', 't.md'), '# A plan\n\nPlan a small note-taking app.\n');
    const labels = ['build', 'dispute', 'deep-dive-revise', 'cold-read', 'canary-reply-glm5.3'];
    const ids = labels.map((label, n) => {
      const id = `2026-10-07T10-00-0${n}-000Z`; const dir = join(work, 'runs', id); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: 'mock-external', task: join(work, 'tasks', 't.md'), cwd: work, startedAt: '2026-10-07T10:00:00.000Z' }));
      writeFileSync(join(dir, `NEEDS-${label}.md`), 'prompt');
      return { id, dir, label };
    });
    const res = await mcpCalls(work, ids.map(r => ({ name: 'prepare_stage_prompt', arguments: { run: r.id } })));
    ids.forEach((r, i) => {
      const body = JSON.stringify(res[i]?.result ?? res[i]);
      assert.equal(/could not resolve this stage/.test(body), false, `${r.label}: ${body.slice(0, 300)}`);
      assert.ok(existsSync(join(r.dir, 'stage_prompt.md')), `${r.label}: no stage_prompt.md written`);
    });
  } finally { rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});

// ---- Item 4: patch-mode withdrawal at run level (the 0f9a761 gap note; cnc-prompts-parsers F2) ----
import { readFileSync as readSrc } from 'node:fs';
import { runChain, setPromptSpy } from '../src/chain.js';

const patchRun = async model => {
  const base = JSON.parse(readSrc(join(root, 'chains', 'mock-patch.json'), 'utf8')); // inline config: no chain file is added (the page's and README's counts derive from chains/)
  const config = { ...base, maxRounds: 3, answer_back: { enabled: true }, seats: { ...base.seats, critics: [{ provider: 'mock', model, lab: 'la' }, { provider: 'mock', model: 'mock-critic-cut-signoff-then-fits', lab: 'lb' }] } };
  assert.deepEqual(lintChain(config, join(tmpdir(), 'patch-item4.json')).filter(f => /answer-back|handoff|debate-hygiene/.test(f.kind)), [], 'the chain is one in which answer-back runs');
  const seen = [];
  setPromptSpy(p => seen.push(p));
  try { return { r: await runChain({ request: 'Write a short fixture deliverable.', config, runId: 'r-item4', log: () => {} }), seen }; } finally { setPromptSpy(null); }
};

test('item 4: in patch mode a withdrawal that quotes text only the "Was:" block still holds is refused; the same withdrawal quoting the draft is accepted (control)', async () => {
  const was = await patchRun('mock-critic-patch-withdraws-was');
  const p2 = was.seen.find(p => p.label === 'panel-2-la').user;
  const split = p2.indexOf('## Changed since your last review');
  assert.ok(split > 0, 'round 2 shows the judge the changed-passages section (patch mode)');
  assert.ok(/Was:\n(`{3,})\nBody text\.\n\1/.test(p2.slice(split)), 'the objected text sits inside a "Was:" block');
  const wasText = p2.slice(split).match(/Was:\n(`{3,})\n([^\n]+)\n\1/)?.[2] ?? '';
  assert.ok(wasText.trim().length >= 8, `the text the judge quotes (the first Was: block) is not empty or too short to count (${JSON.stringify(wasText)}): an empty quote could not refuse on its own`);
  assert.equal(p2.slice(0, split).includes('Body text.'), false, 'and is no longer in the draft the judge was shown');
  const effects = was.r.answerBackReplies.filter(a => a.round === 2 && a.lab === 'la');
  assert.deepEqual(effects.map(a => a.effect), ['withdrawal_refused'], JSON.stringify(was.r.answerBackReplies));
  assert.equal(effects[0].quoted, false);
  assert.equal(was.r.passed, false, 'a refused withdrawal keeps the objection: the run does not pass on it');

  const draft = await patchRun('mock-critic-patch-withdraws-draft');
  assert.deepEqual(draft.r.answerBackReplies.filter(a => a.round === 2 && a.lab === 'la').map(a => [a.effect, a.quoted]), [['withdrawn', true]], 'control: a quote that IS in the draft counts');
  assert.equal(draft.r.passed, true);
});
