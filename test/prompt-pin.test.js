// Prompt pin (0.7.8). The owner's rule for 0.7.8: no prompt changes. Two live case studies run
// against the prompts as they were at 0d87668 (0.7.7 + the http-server fix), so nothing in
// src/roles.js, and no other text a seat receives, may change without his decision.
//
// A prompt cannot be tested by running it (the mock provider ignores prompt text), but it can be
// recorded. Each mock chain below runs through the real CLI with a loader hook that wraps
// src/providers.js's call() and writes down every system prompt and message it is handed. Run
// folders and temp paths are normalised out and the calls sorted (panel seats run in parallel, and
// the relay panel's order is random), and the sha256 of the lot is compared with the value recorded
// at 0d87668. src/roles.js is pinned byte for byte as well.
//
// A mismatch means a seat now receives different text. If that is intended, it needs the owner's
// go first; then re-record the values here (the failure message prints the new ones) and say so in
// the CHANGELOG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = s => createHash('sha256').update(s).digest('hex');

// Re-recorded 2026-09-26 on the owner's go ("Yes and Yes"): tiered councils (thc-research brief 13)
// ADD prompt builders to src/roles.js (deep dive, majority guard). The prompts the mock chains below
// send are unchanged - that check was not re-recorded.
// Re-recorded 2026-10-02 on the owner's go (0.8.1 MAN-1, "go"): the council advisor (thc-research brief 27)
// ADDS the advisor, debate and synthesis prompts to src/roles.js (154 lines added, none removed). No existing
// prompt changed, and the mock-chain check below was not re-recorded.
// Re-recorded 2026-10-07 on the owner's go (0.8.2): the held prompt sentences of the wiring block (P1-P13, handoff milestones, lanes, contract draft) are recorded. The mock-chain shas below changed because the judges', the criteria seat's and the final editor's prompts did.
// Re-recorded 2026-10-07 on the owner's yes (via C&C; Astra's 0.8.2 review, roadmap items 27 and 28): criticUnansweredNote (the re-ask about unanswered own objections), the writer's self-review
// opening (only for the writer's seat under "selfReview": "allowed"), the deep dive's "not a vote" wording and deepDiveVerdictLine (moved here from src/chain.js). The mock-chain shas below did not change.
// Re-recorded 2026-10-14 on the owner's yes (Muad, to C&C, 14 Okt 2026 17:28: "Fix all four now"; his yes covers moving this checksum now for the container hardening, T2-6): src/roles.js gained the import of src/container-text.js,
// containerText around the interpolated text at the three bare container sites (proposer-answer, draft-before, draft-after) and the delegation of claimText / advisorText / writerText to it for their own tags. No template string and no sentence
// a model reads changed; the mock-chain check below was not re-recorded (its digests did not move). The checksum before this change: 416033c24c8dafe5f6d2e889510b833391e38dd25baec52895f5561db008d846.
// Re-recorded 2026-10-18 on the owner's ruling (Muad 18 Okt 2026: the notes lane is ON in 0.8.3 with the Fable > Astra > Fable pass-2 wording, which is the gate; E items 189, 192, 193, 194, 197): src/roles.js gained reviewNotesAsk, reviewNotesRevise, reviewNotesMemory and reviewNotesAnswer (the four lane sentences, recorded all together). No existing prompt changed and the mock-chain check below was not re-recorded (no mock chain carries `reviewNotes`; its digests did not move). The checksum before this change: b80e5ab027105c3b00807c8a4e16d06f9aec9c5a601f8909df75debc64e9249b.
// Re-recorded 2026-10-18 on the owner's yes (Muad, 18 Okt 2026, to C&C: "Yes to the two slices as you suggested"; "1: OK as written ... 2: I'd also go with the broader version"): src/roles.js gained the approved "Dependencies to verify" paragraph at the end of HANDOFF_SYSTEM (the plain handoff and, through the same slice, the milestone handoff). The mock-chain digests below moved for the chains that have a handoff stage (the digest hashes the prompts SENT, and the handoff system prompt gained the paragraph); calls and exit codes did not move. The checksum before this change: 2a9c5d3902ae1bc24f1e7d0e2f747b4d363d725c21eca9bae07d3e8aae744c00.
// Re-recorded 2026-10-19: Muad approved the LABEL sentence, the <earlier-plan> tag and its place at the end of the builder prompt (via C&C, 19 Okt 2026; binding text: the detail heading "THE SESSION SEES THE OLD PLAN WHEN IT DECIDES A RE-PLAN; THE <earlier-plan> TAG ..."). src/roles.js gained EARLIER_PLAN_LABEL and builderUser's optional `earlierPlan` block. A prompt with no earlier plan is byte for byte what it was (the chain prompt hashes below did not move).
// Re-recorded 2026-10-20 on the owner's yes (Muad, 20 Okt 2026, via C&C thcmcp-6d: "Yes of course it should say the model"). OLD/NEW/WHY per flipped pin:
//   ROLES_SHA256  OLD 255950235280066a4c9a6559b17155d1da21fa5ce718fb14ecf59a5499373135  NEW 6b1949f193858e7bdcc98fbe36f2d92b0e47140e025b3212ab80b2282eb7586a  WHY src/roles.js renderClaim: the dispute prompt's "Raised by:" line names the objection's seat MODEL id (was the lab string) and adds " (layer N)" for a model on more than one layer of a layered critics panel; a record with no model reads "(model not recorded)".
//   mock-dispute  OLD 6d26755f7cb59035  NEW 6c4c02f5221b34e6  WHY the mock dispute chain's dispute prompt carries that line (the other ten mock chains do not send it: their digests did not move).
// ROLES_SHA256  OLD 6b1949f193858e7bdcc98fbe36f2d92b0e47140e025b3212ab80b2282eb7586a  NEW 6d18feb54e6a2f624a40dd31e0c197abda416a3be7d71dd9a4c64ae4e9594768  WHY (20 Okt 2026, T2-6 container hardening, same class as the 14 Okt re-record; NO sentence changed): src/roles.js criticUser strips the quotes of a prior review's lab attribute BEFORE claimText, not after, so a lab written as <"/prior-review> cannot become a closing tag. Output for an ordinary lab is byte-for-byte as before; the mock-chain digests did not move. Authority for the re-record: Muad's 14 Okt 2026 "Fix all four now" (T2-6), as relayed by C&C thcmcp-6d on 20 Okt; the reason it needs no new wording yes: C&C ruling that escaping changes bytes, not words. Checked: the prompt built from a lab with quotes differs from the old one only for a lab whose quote-strip assembles a tag (the tag start is now escaped inside the lab attribute); no sentence text moved.
// Re-recorded 2026-10-24 (decider-readiness APPLY PATCH, PROVISIONAL): the 16 held prompts JOIN the 0.8.3 wording review (Muad, 24 Okt 2026: "Yes, to the 11 written prompts for 0.8.3, and please stop asking about new prompts"; the conflict decider and early finish: "Yes to conflict decider and early finish"); the words themselves still need the Fable > Astra > Fable pass and his one yes [recorded at the apply, 24 Okt 2026: there is no separate owner yes on the wording; the pass-2 wording review's FINALs (7 FINAL, 15 KEEP of the 22 held-prompt items) are the sign-off, C&C ruling]. The values below were measured on a SCRATCH src/roles.js that appends the 16 drafted functions verbatim; lane A's real roles.js differs in bytes, so at the apply this block is RE-RECORDED from the real file (ROLES_SHA256 = sha256 of src/roles.js; the eleven digests below were read from the box with nothing masked and the review_id fixed by test/helpers/fixed-envelope-id-preload.js (tree 4497d0e8 = the tree of the previous commit plus that scratch roles.js; log set-4497d0e8-box-20261024-041641.txt); an earlier version of this note said eight chains move and mock, mock-unanimous and mock-security-review do not: that was read from box logs whose diff was cut at the context-lines limit, so the last three chains were never shown, and it was wrong):
//   ROLES_SHA256  OLD 6d18feb54e6a2f624a40dd31e0c197abda416a3be7d71dd9a4c64ae4e9594768  NEW 3bb97200046b9107010d53c7a5a0ff0207de88632f103210b276c7a6fe68df62  WHY src/roles.js records the 16 held functions (conflictDeciderSystem/User, reviserDecisionNote, reviserEarlyFinishNote, earlyFinishAskSection and the 11 of held-083.js).  AND (24 Okt 2026, apply patch fix-up 4): NEW 60bd4a075a39999425b37910d8da9205c4fda1712625d7cb4d4e8b2e86f2f44e WHY the scratch file now carries the claimText wraps of 15295d25 in otherReviewersBlock and overseerLedgerSection (rebuilt from the held files; read on the box, tree 2b6dca29, set-2b6dca29-box-20261024-044934.txt: the 11 digests and the tree-budget PIN did NOT move).  AND (apply patch fix-up 5): NEW 70b8ce2d1a37caf2b1145770aa5facf126d5e45c5447c42b4b5664fa99281520 WHY the held ledger function applies claimText to `head` at the interpolation the container guard reads (6dbb52f1) instead of where `head` is defined; the scratch file is rebuilt from the held files at that tip (read on the box, tree 8a6c969e, set-8a6c969e-box-20261024-050344.txt: the 11 digests and the tree-budget PIN did NOT move).
//   mock  OLD 684270c78d106687  NEW 7eb4ebeb278c32fa  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-criteria-kinds  OLD 1cf434c1f3cb5da2  NEW 1bdb20c2644d4d4b  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-debate  OLD 0433264523372b4b  NEW 22e50265dbf67732  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-dispute  OLD 6c4c02f5221b34e6  NEW c9c16af32812f718  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-open  OLD a4c7db010281f914  NEW 06b9997e305c2b9f  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-partitioned  OLD 398b6ed838214a40  NEW d1b3a2dcc41f8bd9  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-patch  OLD 6a707383a9dc7d6a  NEW 220ecb4bb3c6e1df  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-proposals  OLD 58481b3e65b9e703  NEW 9d7207378062870a  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-questions  OLD 0e8f151f27513910  NEW 7b4b492a9576b6d1  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-security-review  OLD a9e59ab0033dd72b  NEW d1a6705b2ed2751e  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
//   mock-unanimous  OLD 61db3b8d52abbdfe  NEW 2401c2cc4255dfdb  WHY this mock chain's judge prompts now carry the recorded "Reply identity" section (a CLI run puts the envelope in force as soon as src/roles.js records verdictEnvelopeSection); its review_id is drawn from randomBytes; the draft_id is a sha256 of the shown draft, so it is stable; the test's child fixes the review_id with test/helpers/fixed-envelope-id-preload.js, so nothing is masked.
// Re-recorded at the 0.8.3 apply (24 Okt 2026), real file, not the scratch:
//   ROLES_SHA256  OLD 70b8ce2d1a37caf2b1145770aa5facf126d5e45c5447c42b4b5664fa99281520  NEW 37cd72cc942e615f8aacecbbe434b8fa2c9afa4f7ddad68205b1d9a7456a5505  WHY src/roles.js records the 16 held prompt functions from the edited held files (16 functions and the DISPOSITION constant); the wording is the pass-2 review's. The PINNED mock-chain digests below are the box run's to re-capture if the table moves (the whole got object).
// Re-recorded 25 Okt 2026 (lane T, G1, CR-2E-003) on the owner's yes: Muad, 25 Okt 2026 14:45, "Yes to all" (adopting Astra's decision list, its prompt wording included; Review/Bugs_0.8.3/cr-943906f/THC-0.8.3-recursive-council-design-review.md line 62):
//   ROLES_SHA256  OLD 37cd72cc942e615f8aacecbbe434b8fa2c9afa4f7ddad68205b1d9a7456a5505  NEW ae75f5767fdd2c6050cd8efe2704b379753005d399bbe1f80d9046578b775866  WHY src/roles.js treeSplitWriterNote: the one context_refs sentence of the "children" bullet is replaced by Astra's paragraph (the reference grammar, the goal duty, the exclusions the harness supplies; its three typographic quote pairs and one apostrophe written as the prompt's own straight quotes). The mock chains below are not tree members and never receive the split note: their digests do not move.
const ROLES_SHA256 = 'ae75f5767fdd2c6050cd8efe2704b379753005d399bbe1f80d9046578b775866';
// Recorded at 0d87668. `status` is the CLI's exit code (mock-security-review's mock reviewer blocks: 7). 0.8.3 exit 22: mock-dispute, mock-patch and mock-partitioned finish with their mock panel NOT agreed, which now exits 22 instead of 0 (calls and sha unchanged: no prompt changed).
// mock-relay is left out: its panel order comes from Math.random (bug audit 2026-09-26 #2) and a relay
// reviewer sees the reviews before it, so its prompts differ from run to run.
const PINNED = {
  'mock': { calls: 6, status: 0, sha: '04e8a94d1091adf3' },
  'mock-debate': { calls: 15, status: 0, sha: '01ece0a2cb1e6ba3' },
  'mock-unanimous': { calls: 8, status: 0, sha: '3eee6f1ff728c852' },
  'mock-proposals': { calls: 16, status: 0, sha: '75ad9d6f83248225' },
  'mock-questions': { calls: 16, status: 0, sha: 'c3dd1124528031ec' },
  'mock-dispute': { calls: 12, status: 22, sha: '07dac8be066b51c6' },
  'mock-criteria-kinds': { calls: 6, status: 0, sha: 'e7d59cf99569be28' },
  'mock-open': { calls: 15, status: 0, sha: '51e1a8529008cbfb' },
  'mock-patch': { calls: 7, status: 22, sha: '70b4cf275371e092' },
  'mock-security-review': { calls: 5, status: 7, sha: '8910a2cd7310820c' },
  'mock-partitioned': { calls: 6, status: 22, sha: '4ad3c879146db9c6' }
};
const TASK = 'Plan a small command-line tool that renames photos by the date they were taken.\n';

test('src/roles.js is byte-identical to 0.7.7 + 0d87668', () => {
  assert.equal(sha256(readFileSync(join(repo, 'src/roles.js'))), ROLES_SHA256,
    'src/roles.js changed: no prompt changes without the owner\'s go (see the comment at the top of this file)');
});

test('every prompt a mock chain sends is unchanged', () => {
  const real = pathToFileURL(join(repo, 'src/providers.js')).href;
  const work = mkdtempSync(join(tmpdir(), 'thc-prompt-pin-'));
  try {
    const wrap = pathToFileURL(join(work, 'providers-wrap.mjs')).href;
    writeFileSync(join(work, 'providers-wrap.mjs'), [
      "import { appendFileSync } from 'node:fs';",
      `import { call as realCall } from ${JSON.stringify(`${real}?real`)};`,
      `export * from ${JSON.stringify(`${real}?real`)};`,
      'export async function call(provider, opts) {',
      '  appendFileSync(process.env.THC_PROMPT_LOG, JSON.stringify({ provider, model: opts.model, system: opts.system, messages: opts.messages }) + "\\n");',
      '  return realCall(provider, opts);',
      '}',
    ].join('\n'));
    writeFileSync(join(work, 'hooks.mjs'), [
      'export async function resolve(spec, ctx, next) {',
      '  const r = await next(spec, ctx);',
      `  return r.url === ${JSON.stringify(real)} ? { ...r, url: ${JSON.stringify(wrap)} } : r;`,
      '}',
    ].join('\n'));
    const register = join(work, 'register.mjs');
    writeFileSync(register, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(work, 'hooks.mjs')).href)});\n`);

    const got = {};
    for (const chain of Object.keys(PINNED)) {
      const dir = join(work, chain);
      mkdirSync(join(dir, 'chains'), { recursive: true });
      copyFileSync(join(repo, 'chains', `${chain}.json`), join(dir, 'chains', `${chain}.json`));
      writeFileSync(join(dir, 'task.md'), TASK);
      const log = join(dir, 'prompts.jsonl');
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(register).href, '--import', pathToFileURL(join(repo, 'test/helpers/fixed-envelope-id-preload.js')).href, join(repo, 'src/cli.js'), '--chain', chain, '--task', 'task.md', '--allow-unfenced'],
        { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, THC_PROMPT_LOG: log }, timeout: 60_000 });
      const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      const norm = lines.map(l => l.split(dir).join('<DIR>').replace(/\d{4}-\d\d-\d\dT\d\d[:-]\d\d[:-]\d\d[.-]\d{3}Z/g, '<TS>')).sort();   // apply patch (24 Okt 2026): once the verdict-envelope sentence is recorded every judge prompt carries a review_id drawn from randomBytes; the child below starts with test/helpers/fixed-envelope-id-preload.js, which makes that id a constant, so nothing in the prompts is masked (C&C ruling 24 Okt 2026: deterministic ids are tighter than any mask)
      got[chain] = { calls: lines.length, status: r.status, sha: sha256(norm.join('\n')).slice(0, 16) };
    }
    assert.deepEqual(got, PINNED, 'a seat now receives different text - no prompt changes without the owner\'s go');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
