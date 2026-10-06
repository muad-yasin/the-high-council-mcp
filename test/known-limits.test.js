// 0.8.1 M10 (plan M10 Tests, section 7 item 2): the README's "Known limits" section says what 0.8.1 cannot promise. One phrase per unverified item U1-U7 and per
// limit the plan names, and none of the phrases of the 0.8.0 defects this release fixed (each is in the CHANGELOG with its FX number and regression test) or the
// "Known defects in 0.8.0" heading. A limit is deleted when it stops being true, never because it is embarrassing (CLAUDE.md): this test keeps both directions honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const start = readme.indexOf('## Known limits, stated plainly');
const limits = readme.slice(start, readme.indexOf('\n## ', start + 10));

test('the Known limits section exists', () => { assert.ok(start > 0 && limits.length > 2000); });

test('one phrase per unverified item U1-U7, and per limit plan section 7 names', () => {
  const must = [
    ['U1', /U1: `zdr`, `data_collection` and `max_price` together on a real OpenRouter request/],
    ['U2', /U2: whether the output cap bounds reasoning tokens/],
    ['U3', /U3: whether a billed timeout is retried and charged twice/],
    ['U4', /U4: what a real client shows for an approval prompt/],
    ['U5', /U5: what each provider bills for an aborted request/],
    ['U6', /U6: Sol's real output length and latency/],
    ['U7', /U7: cancellation semantics under the protocol revision/],
    ['no live provider or client', /not verified against a live provider or client/],
    ['ledger tamper-evident, not tamper-proof', /tamper-evident, not tamper-proof/],
    ['the terminal answer is friction', /friction, not enforcement/],
    ['a person must answer every gate; scripted or unattended use unsupported', /scripted or\s+unattended use is not supported/],
    ['planning runs cannot be stopped', /Planning runs still cannot be stopped/],
    ['Astra only through OpenRouter, no subscription route', /reachable only through OpenRouter: there\s+is no subscription route/],
    ['advise-premium: no ZDR-tagged endpoint, public-only, raised per-call limit', /`advise-premium` sends your text to labs that have no zero-retention-tagged endpoint/],
    ['the retention table is a dated snapshot', /dated snapshot \(`src\/advice-retention\.json`\)/],
    ['the advice brief lives in the run folder', /advice brief is written into the run folder/],
    ['a headless client waits for a terminal answer', /headless Claude Code, a script\) gets `awaiting_approval`/],
    ['advise-single ceiling', /`advise-single`'s ceiling is \$1\.32/],
    ['untested on case-insensitive file systems', /Untested on case-insensitive file systems \(macOS, Windows\)/],
    ['the dry run does not price every cap', /dry run does not price every cap/],
    ['a retry past the request deadline', /cannot finish inside the 45-minute request deadline/],
    ['a run paused under 0.8.0 is re-paid', /paused under 0\.8\.0 on a chain that 0\.8\.1 changed/],
    ['the red-test dates', /2026-10-31.*2026-11-21.*2026-12-05/s],
    ['DeepSeek on Together unconfirmed', /DeepSeek V4 Flash on Together/],
    ['reasoning fields not exercised live', /not exercised in a live call/],
    ['a failed start after approval is counted', /A failed start after approval is counted at the full ceiling/],
    ['one approval, two runs', /One approval can start two runs if the approved run folder is copied/],
    ['Gemini 2.5 closed to new projects', /Six shipped chains seat Gemini 2\.5/],
    ['the direct-Anthropic retry may never fire', /retry of a direct Anthropic seat whose thinking used the whole cap may never fire/],
    ['run-folder fields not marked untrusted', /Some fields an agent reads about a run are not marked as untrusted text/],
    ['the terminal approval command under .mcpb', /terminal command for approving a call was not run under the `\.mcpb` route/],
    ['a killed process records nothing', /A process killed in the middle of a call records nothing/],
    ['plugin strict validation warning', /claude plugin validate --strict \.` fails on it: "CLAUDE\.md at the plugin root is not loaded as project context"/],
  ];
  const missing = must.filter(([, re]) => !re.test(limits)).map(([name]) => name);
  assert.deepEqual(missing, []);
});

test('none of the phrases of the fixed 0.8.0 defects, nor the "Known defects in 0.8.0" heading', () => {
  const gone = [
    /Known defects in 0\.8\.0/,
    /overwrites the first call's cost/,
    /worstCaseWithTaskUsd: null/,
    /untouched `HANDOFF\.md` as edited/,
    /quotes a full-length commit hash/,
    /no lock block, without a warning/,
    /`state\.json` still says `running`/,
    /`handoff\.md` and `HANDOFF\.md` are one file/,
    /covers each\s+criterion's wording, not how it is checked/,
  ];
  assert.deepEqual(gone.filter(re => re.test(limits)).map(String), []);
});
