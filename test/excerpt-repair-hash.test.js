// 0.8.4 D38 (C&C 09 Nov 2026, condition on option I): a repair pause on a RESUMED run with an excerpt visible. The pause keeps the prompt it was asked and the resume is held to the hash of it; since the excerpt block is
// placed inside invoke(), the copy kept by the call site must be the PLACED text (src/chain.js sentUserOf). Proved here with a near-JSON panel reply: the pause's stored hash equals the hash of the prompt that is re-sent
// on the resume, so the resume pauses again WITHOUT asking the model, and after the repair the round goes on with the seat still asked once. Offline, $0 (the provider call is stubbed; fixtures are synthetic).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChain, setBudget, setCache, setPromptSpy, setRepairPauses, ExternalPause } from '../src/chain.js';
import { makeStageCache, writeSideStage } from '../src/stage-cache.js';
import { setAsideOriginal } from '../src/near-json.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { setHeldForTest } from '../src/held-roles.js';
import { buildExcerptEntry } from '../src/excerpt-record.js';
import { excerptsBlock } from './held-prompts/held-084-a.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setRepairPauses(false); });
const FP = 'fingerprint-1';
const NEAR = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}, "failures": []}';
const FIXED = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}], "failures": []}';
const GOOD = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "REVISED MOCK DELIVERABLE"}]}';
const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a' };
const B = { provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 20000, lab: 'seat-b' };
const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const entry = () => buildExcerptEntry(1, { request_kind: 'session_read', requested_by: null, objection_id: null, why: 'To check.', source_kind: 'repository_file', path: 'src/a.js', lines: '1-2', text: 'alpha one\nalpha two', file_sha256: null, edited: false, pasted_by: null, advisor: null, advisor_said: null, answered_stage: 'build', scans: { key_shape: 'clear', personal_data: 'not_scanned' }, approval: { status: 'not_required', actor: null, channel: null, at: '2026-11-09T05:00:00.000Z', reason: null } });
const config = { name: 'repair-hash', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { builder: { provider: 'mock', model: 'mock-builder' }, critics: [A, B] } };

async function withStub(fn) {
  const had = process.env.OPENROUTER_API_KEY;
  setRepairPauses(true);
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  const calls = [];
  const restore = stubFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.model);
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: body.model === A.model ? NEAR : GOOD }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  });
  try { return await fn(calls); } finally { restore(); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
}
const rejectionOf = async p => { try { await p; } catch (e) { return e; } return null; };

test('a near-JSON panel reply on a run with an excerpt visible: the pause holds the hash of the PLACED prompt, the resume re-sends that very prompt, pauses again without paying again, and goes on after the repair', async () => {
  setHeldForTest({ excerptsBlock });
  const dir = mkdtempSync(join(tmpdir(), 'excerpt-repair-'));
  await withStub(async calls => {
    const sent = [];
    setPromptSpy(p => { if (/^panel-1-seat-a/.test(p.label)) sent.push(p); });
    const onStage = s => writeSideStage(dir, s, { fingerprint: FP });
    const run = () => runChain({ request: 'Req.', config, excerpts: [entry()], log: () => {}, onStage });
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const first = await rejectionOf(run());
    assert.ok(first instanceof ExternalPause && first.repair, `expected a repair pause, got ${first && (first.stack || first)}`);
    assert.ok(sent[0].user.includes('alpha one'), 'the prompt the seat was sent carries the excerpt (else this proves nothing)');
    assert.equal(first.promptHash, promptHashOf(sent[0].system, sent[0].user), 'the pause is held to the hash of the text that was SENT, the block included');
    setAsideOriginal({ runDir: dir, label: first.label, promptHash: first.promptHash, fingerprint: FP });   // what the command does at the pause
    const askedA = () => calls.filter(m => m === A.model).length;
    assert.equal(askedA(), 1);
    // the resume before anyone repaired it
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const again = await rejectionOf(run());
    assert.ok(again instanceof ExternalPause && again.repair, 'pauses again');
    assert.equal(askedA(), 1, 'the paid stage is not asked again: the re-sent prompt hashes the same as the one the pause holds');
    assert.equal(promptHashOf(sent.at(-1).system, sent.at(-1).user), first.promptHash, 'the prompt re-sent on the resume is the same text');
    // a good repair
    writeFileSync(join(dir, `${first.label}.md`), FIXED);
    setCache(makeStageCache({ dir, fingerprint: FP }));
    const done = await rejectionOf(run());
    assert.equal(done instanceof ExternalPause, false, `the round goes on after the repair (${done && (done.stack || done)})`);
    assert.equal(askedA(), 1);
    assert.ok(readFileSync(join(dir, 'build.md'), 'utf8').length > 0, 'the stage before the pause replayed from disk');
  });
});
