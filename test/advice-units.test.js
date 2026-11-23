// test/advice-units.test.js
//
// 0.8.4 (the add-on removal, wave 2): this file was the advice add-on's unit suite (the brief and its caps, the masking, the guards and their ledger, the sensitivity tiers, the chains' admission, the price at the
// brief cap, the layout of the answer the agent reads, the stop seam of src/advise.js). src/advice-brief.js, advice-mask.js, advice-guards.js, advice-tier.js, send-path-refusals.js, send-profiles.js, advise.js,
// advice-run.js and src/mcp/advice.js are gone, so every test that drove them is removed. Four tests reach code that STAYS and are kept: the request deadline (src/providers.js), the audit line with a prompt
// hash (src/audit.js), the two hold constants (src/mcp/hold-budget.js) and the schema, rewritten to say what is true now (the `advise` property is gone, `stoppedBy` keeps its legacy values, the root copies stay out).
// Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOLD_S, START_MARGIN_S } from '../src/mcp/hold-budget.js';
import { setRequestDeadlineAt, requestTimeoutNow, REQUEST_DEADLINE_MS } from '../src/providers.js';
import { createAuditWriter, verifyAuditLog, parseAuditLog } from '../src/audit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD two tests read holdSecondsFor (default 25 for every client, an explicit value clamped to 30) and the client's name and capabilities from the McpServer. NEW the two constants that stay in src/mcp/advice.js are pinned. WHY holdSecondsFor is removed with the tools; the server's typed-limit dialogs still count with DEFAULT_HOLD_S and START_MARGIN_S (the second old test only exercised the MCP SDK's getClientVersion). Logged under COVERAGE LEFT BEHIND.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the two constants were imported from src/mcp/advice.js (wave 1: the same file, then without holdSecondsFor). NEW: from src/mcp/hold-budget.js, where they live now. WHY: src/mcp/advice.js is gone; the server's typed-limit dialogs still count with a 25 s hold and keep 5 s for the start.
test('hold budget: the typed-limit dialogs count with a 25 s hold and keep 5 s for the start', () => {
  assert.equal(DEFAULT_HOLD_S, 25);
  assert.equal(START_MARGIN_S, 5);
});

test('the request deadline is absolute: a request starting late gets what is left, never a fresh full allowance', () => {
  try {
    const t = 1_000_000;
    setRequestDeadlineAt(t + 60_000);
    assert.equal(requestTimeoutNow(t), 60_000);
    assert.equal(requestTimeoutNow(t + 59_000), 1_000, 'a call starting one second before the deadline gets one second');
    assert.equal(requestTimeoutNow(t + 90_000), 1, 'after the deadline the floor is 1 ms');
    setRequestDeadlineAt(t + 10_000_000_000);
    assert.equal(requestTimeoutNow(t), REQUEST_DEADLINE_MS, 'never more than the per-request default');
    setRequestDeadlineAt(null);
    assert.equal(requestTimeoutNow(t), REQUEST_DEADLINE_MS);
  } finally { setRequestDeadlineAt(null); }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the audit writer was given chain 'advise-single' and the stage labels 'advise-x' / 'advise-y'. NEW: chain 'plan-single' and the labels 'panel-x' / 'panel-y'. WHY: the names are only labels in a hash-chained line (src/audit.js has no advise-keyed branch); the chain advise-single is gone from the repository, so the test no longer names it.
test('the audit line carries the prompt sha256 and size when it has them, still verifies, and an old line still verifies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-audit-'));
  try {
    const w = createAuditWriter({ runDir: dir, run: 'R', chain: 'plan-single', user: 'u' });
    w.recordStage({ label: 'panel-x', provider: 'openrouter', model: 'openai/gpt-6.1-sol', lab: 'x', usage: { input: 10, output: 5 }, usd: 0.01, promptSha256: 'b'.repeat(64), promptBytes: 1234, endpoint: 'Azure', scan: 'clean' });
    w.recordStage({ label: 'panel-y', provider: 'mock', model: 'm', lab: 'y', usage: { input: 1, output: 1 }, usd: 0 });
    w.close();
    const lines = parseAuditLog(readFileSync(join(dir, 'audit.jsonl'), 'utf8'));
    assert.equal(lines[0].promptSha256, 'b'.repeat(64)); assert.equal(lines[0].promptBytes, 1234); assert.equal(lines[0].endpoint, 'Azure'); assert.equal(lines[0].scan, 'clean');
    assert.ok(!('promptSha256' in lines[1]), 'a line without them is the old shape');
    assert.equal(verifyAuditLog(lines).valid, true);
    const tampered = structuredClone(lines); tampered[0].promptBytes = 1;
    assert.equal(verifyAuditLog(tampered).valid, false, 'the new fields are inside the hash');
    assert.ok(!JSON.stringify(lines).includes('Should we'), 'no prompt text');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "the reports schema documents the additive fields as experimental" (schema.properties.advise is experimental and has sent_to and dispositions). NEW: the schema has NO `advise` property any more (the add-on is removed), the root copies of brief_sha256, sent_to, dispositions and stopped_by stay out, and `stoppedBy` keeps its legacy values (user, client_cancel, wall_clock) so a report-partial.json an earlier version wrote still validates. The chain-count bar is kept as it was. WHY: the REM-w16 text: "schemas/report-v1.json no longer describes it (0.8.4)"; a report an earlier version wrote still validates because additionalProperties is open.
test('the reports schema: no `advise` property, the root copies stay out, and stoppedBy keeps its legacy values', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.equal('advise' in schema.properties, false, 'the advise property is no longer described');
  for (const k of ['brief_sha256', 'sent_to', 'dispositions', 'stopped_by']) assert.equal(k in schema.properties, false, k);
  for (const v of ['budget', 'user', 'client_cancel', 'wall_clock']) assert.ok(schema.properties.stoppedBy.enum.includes(v), `stoppedBy keeps ${v}`);
  // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): 21 chains moved to archive/chains/ and two advise chains were added, so chains/ holds 45; the floor was 61.
  // 0.8.3 (lane B), CHANGED ACCEPTED TEST: old bar = 45 entries in chains/; new bar = 41 .json configs (15 more chains retired to chains/outdated/, a directory entry that is not a chain) (Muad 18 Okt 2026, "Your pick sounds good").
  // CHANGED ACCEPTED TEST (0.8.4, 36a: the eight one-model chains left chains/): OLD bar 41 chain files. NEW bar: 34. WHY: the count moves with the thing it counts (42 files, 8 left).
  // CHANGED ACCEPTED TEST (0.8.4 add-on removal): OLD bar >= 30 chain files in chains/. NEW bar >= 26. WHY the count moves with the thing it counts: four advice chains left chains/ for test/fixtures/advice-chains/, and chains/ holds 26 .json files now (derived with ls).
  assert.ok(readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).length >= 26);   // CHANGED (0.8.4 seats unit, Muad 10 Nov 2026 01:10): was >= 34; four chains moved to chains/outdated/
});
