// 0.8.1 M10 (plan M10 Tests, section 7 item 2): the "Known limits" section (in README.md until 0.8.4, now in KNOWN-LIMITS.md) says what 0.8.1 cannot promise. One phrase per unverified item U1-U7 and per
// limit the plan names, and none of the phrases of the 0.8.0 defects this release fixed (each is in the CHANGELOG with its FX number and regression test) or the
// "Known defects in 0.8.0" heading. A limit is deleted when it stops being true, never because it is embarrassing (CLAUDE.md): this test keeps both directions honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CLIENT_FILE_BYTES } from '../src/tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// CHANGED (0.8.4 apply, the README rework). OLD: the section was read from README.md. NEW: the section moved word for word into KNOWN-LIMITS.md (the package ships it) and the README keeps the heading with one sentence and a link. The presence checks read the limits file; every ABSENCE check reads the limits file's section AND the README's own (`bothLimits`), so a limit that came back in either file is caught.
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const limitsFile = readFileSync(join(root, 'KNOWN-LIMITS.md'), 'utf8');
const sectionOf = text => { const at = text.indexOf('## Known limits, stated plainly'); const end = text.indexOf('\n## ', at + 10); return { at, text: text.slice(at, end === -1 ? undefined : end) }; };
const start = sectionOf(limitsFile).at;
const limits = sectionOf(limitsFile).text;
const bothLimits = `${limits}\n${sectionOf(readme).text}`;

test('the Known limits section exists', () => { assert.ok(start > 0 && limits.length > 2000); });

// NEW (0.8.4 apply): the README points to the limits file, and the manual's link lands on the heading the file carries.
test('the README keeps the Known limits heading with one sentence and a link to KNOWN-LIMITS.md, and the limits file carries the heading the manual\'s link lands on', () => {
  const own = sectionOf(readme);
  assert.ok(own.at > 0, 'the README keeps the heading');
  assert.match(own.text, /\]\(KNOWN-LIMITS\.md\)/, 'and links to the limits file');
  assert.ok(own.text.length < 1000, 'and holds a pointer, not the limits');
  assert.ok(limitsFile.includes('\n## Known limits, stated plainly\n'), 'the file carries the heading');
  assert.match(readFileSync(join(root, 'AI-README.md'), 'utf8'), /\]\(KNOWN-LIMITS\.md#known-limits-stated-plainly\)/, 'the manual links to the heading in the file');
});

test('one phrase per limit plan section 7 names (the advice-tool limits U1-U7 left with the add-on, 0.8.4)', () => {
  const must = [
    ['ledger tamper-evident, not tamper-proof', /tamper-evident, not tamper-proof/],
    ['the terminal answer is friction', /friction, not enforcement/],
    ['a planning run can be paused from outside only at the next pass boundary', /A planning run can be asked to pause from outside, but only at the next pass boundary/],
    ['Astra only through OpenRouter, no subscription route', /reachable only through OpenRouter: there\s+is no subscription route/],
    // 0.8.4 zero retention (C&C ruling on the safety-retention residual, 10 Nov 2026): the setting asks for zero-retention hosts only and a request cannot rule out one kind of host by itself; the README says so and names the account setting that does (WORDING ZR-w7)
    ['the zero-retention setting cannot rule out one kind of host by itself', /The zero-retention setting asks for zero-retention hosts only, and a request cannot rule out one kind of host by itself \(0\.8\.4\)\.\*\*/],
    // 0.8.4 cache part (b)2, FIX 2 (Helper B 1c(1), Mini-C&C): caching is on in every shipped planning chain, so the README says what a write costs and the two cases that pay it and get no read (WORDING CACHE-O23)
    ['a call that writes a cache entry costs more and the entry may never be read', /A call that writes a cache entry costs more than the same call without a cache mark, and the entry may never be read \(0\.8\.4\)\.\*\*/],
    ['the refreshed list can only narrow the shipped one', /a host OpenRouter added after this version was released is not used, and a model whose hosts moved is refused, until a newer version ships its own list\./],
    ['the account setting that rules it out', /The account setting "zero-data-retention only" in OpenRouter's privacy settings rules that out\./],
    // 0.8.4 (network-error resume, his decision 9 of 28 Okt 2026): a dropped connection is sent again and each failed attempt is counted at the call's expected cost, so the README must say the counted total can sit below the bill.
    ['a resumed attempt is counted at its expected cost, so the total can be below the bill', /so the counted total can be\s+lower than the bill/],
    // 0.8.4 unit 1 (excerpts, WORDING DOC-w1): the dry run cannot know the project text a session adds, and a file reply cannot carry the structured answers.
    ['the dry run cannot include excerpts', /The dry run cannot include excerpts\./],
    ['text requests and session reads go through the stage-answer tool', /Text requests and session reads are answered through the stage-answer tool\./],
    ['the approval screen keeps every text it showed you', /The approval screen keeps every text it showed you\./],
    // N is derived from the exported constant, so the README cannot drift from the cap (C&C 09 Nov 2026)
    ['excerpts are not shown in a descending run (the A-DRAFT row U1-w9; the log line is D38-w5 (c))', /Excerpts are not shown in a descending run\.\*\* A chain in descending mode does not show the text a handling session adds during the run, and the files the session read are not recorded; the run log says so\./],
    ['text added during a run is checked for keys only (the A-DRAFT row U1-w17)', /Text added during a run is checked for keys only\.\*\* Project text the handling session adds during a run \(an excerpt\) is checked for key-shaped strings before any seat is shown it\. It is not checked for personal data/],
    ['a passage over the byte cap cannot be quoted', new RegExp(`A passage of a project file over ${MAX_CLIENT_FILE_BYTES} bytes cannot be quoted\\.\\*\\* The harness keeps at most ${MAX_CLIENT_FILE_BYTES} bytes`)],
    // 0.8.4 unit 4 (his pick OWNER 6, 03 Nov 2026: "a re-ask can overrun the cap"): the cap is checked at an expected cost, so the README must say it can be overrun, and both ways.
    ['the cap is checked against an expected cost, not a worst case', /The spend cap is checked against an \*\*expected cost\*\*, not a worst case\./],
    ['an answer-back call is checked at its worst case, like a call with no expected size (it is not a re-ask)', /an answer-back call\s+\(`-answered`, `-question`, which is not a re-ask\) are checked at their worst case/],
    // CHANGED ACCEPTED TEST (0.8.4 round 1, A8-1; his 4:a/5:a answers on the cost wording): OLD: 'a run can end above the limit in two ways: a repeat above its expected cost, and a price step' (/A run can therefore end above your limit in two ways.** A re-ask or a retry can cost more than its expected cost. And a long call can pass a price step its estimate did not reach/). NEW: the one statement the four copies now make, without a count of ways: a run can end above the limit when its last calls write more than expected; a re-ask or retry and a price step are cases of it. WHY: the count "two" was not a fact of the code (a call can write more than its expected size, up to its whole maxTokens, whatever the reason); the limit is still stated and still names both cases. The witness stays: the README must keep saying a run can end above the limit, and why.
    ['a run can end above the limit when its last calls write more than expected: a re-ask or retry and a price step are cases of it', /A run can therefore end above your limit when its last calls write more than expected\.\*\*\s+A\s+call checked at an expected size can write more than that, up to its whole `maxTokens`\.\s+A re-ask or a retry that costs\s+more than its expected cost is one case of this\.\s+A long call that passes a price step its estimate did not reach is\s+another/],
    // 0.8.4 unit 0b, changed by his pick of 04 Nov 2026 ("2: typical cost"). CHANGED ACCEPTED. OLD: a 5xx re-send settles failed at $0 and the README said THC does not guess whether a provider bills for it, /does not guess whether a provider bills a 5xx/.
    // NEW: a 5xx attempt of a seat that bills is counted at a typical cost, so the README must say the total can be above or below the bill and that those attempts count for the rule that stops a stage from being sent again. WHY: the OLD sentence is untrue now.
    // CHANGED ACCEPTED (0.8.4 add-on removal, REM-w19 area). OLD: the pin ended with "; the advice add-on is.". NEW: the sentence ends after "a 5xx.". WHY: the add-on is removed, so the clause is untrue to keep and the name of the pin moved with it.
    ['the deep dive and the one-call side commands are not sent again after a 5xx', /The\s+deep\s+dive\s+and\s+the\s+side\s+commands\s+that\s+make\s+one\s+call\s+\(`digest`,\s+`handoff\s+\-\-from\-run`,\s+contract\s+drafts\)\s+are\s+not\s+sent\s+again\s+after\s+a\s+5xx\./],
    ['a 5xx attempt is counted at a typical cost, so the total can be above or below the bill', /A\s+provider\s+may\s+not\s+bill\s+a\s+5xx\s+at\s+all,\s+so\s+the\s+counted\s+total\s+can\s+be\s+higher\s+or\s+lower\s+than\s+the\s+bill/],
    ['the dry run\'s upper estimate leaves out the repeated attempts after a provider error, the counted total includes them', /The\s+dry\s+run's\s+upper\s+estimate\s+leaves\s+out\s+these\s+repeated\s+attempts\s+after\s+a\s+provider\s+error,\s+while\s+the\s+counted\s+total\s+includes\s+them\./],
    ['a stage run again with two counted 5xx attempts behind it is not sent again after a dropped connection', /Those\s+5xx\s+attempts\s+count\s+for\s+the\s+rule\s+above:\s+when\s+a\s+stage\s+is\s+run\s+again,\s+for\s+example\s+by\s+a\s+resume,\s+one\s+with\s+two\s+of\s+them\s+behind\s+it\s+is\s+not\s+sent\s+again\s+after\s+a\s+dropped\s+connection/],
    // 0.8.4 T14 (owner 05 Nov 2026, "1 is good"): a run paused on 0.8.3 or earlier has no record of the version that wrote its stages, so it is not covered by the new keep-as-saved rule; the README must say so, in the terms of the changelog line about runs paused before this version.
    ['a resume after the chain or the task changed runs the affected steps again and a paid chain pays again (0.8.4, ladder unit)', /A resume after the chain or the task changed asks again every finished step it affects that the run reaches, and a paid chain pays for it again\./],
    ['a run paused before this version can re-run some stages when it resumes (0.8.3 or earlier, resumed on 0.8.4)', /A run paused before this version can re-run some stages when it resumes \(a run paused on 0\.8\.3 or earlier, resumed on 0\.8\.4\)\./],
    ['a resume after an update keeps saved replies, with two exceptions', /A resume after an update keeps saved replies, with two exceptions\./],
    ['untested on case-insensitive file systems', /Untested on case-insensitive file systems \(macOS, Windows\)/],
    ['the dry run does not price every cap', /dry run's expected figure does not price every cap/],
    // owner decision 6 Oct 2026 ("2h is OK"): the request deadline went from 45 minutes to 2 hours, so the pinned sentence changed with it.
    ['with severity on a plan can be signed off while objections rated below 4 stay open', /a plan can be signed off while objections rated below 4 stay open/],
    ['a retry past the request deadline', /whether a reply that long fits inside the 2-hour request deadline is not known/],
    // Moved to the current version by the audit finding cnc-cli-resume F1 (a run paused under 0.8.1 is re-paid on 0.8.2): the sentence names both causes.
    ['a run paused under 0.8.1 is re-paid', /paused under 0\.8\.1 on a chain or a prompt that 0\.8\.2 changed/],
    // 0.8.2 item 2 (ChatGPT review 1 F12/F13, owner: all of it in 0.8.2): the run_tests limit is pinned so it cannot be deleted without the test saying so.
    ['run_tests is trusted code', /`run_tests` runs a repository's own test files as trusted code, with no sandbox/],
    ['symlink containment untested on Windows', /symbolic-link containment of the MCP tools is untested on Windows/],
    // 0.8.2 item 7: the reasoning table was regenerated on 2026-10-07 (to add Sonnet 5.5's row), so its date moved from 2026-12-05 to 2026-12-06; the README line moved with it.
    // 0.8.3 step (g): the README line named 2026-11-21 for the price rows (true for a stamp of 2026-10-06) and 2026-12-06 for the reasoning table (regenerated 2026-10-07); the files say 2026-12-08 (stamp 2026-10-23) and, after the table was regenerated on 2026-10-23, 2026-12-23. The dates are now in date order.
    // CHANGED ACCEPTED (price-table refresh, 25 Okt 2026; C&C GO (a)): the OpenRouter rows were compared with the live list on 2026-10-25 (0 rows raised), so the freshness test turns red on 2026-12-10, not 2026-12-08 (stamp + 45 days + 1); the README line moved with it. OLD /2026-12-08/; NEW /2026-12-10/ (a re-record of the one date, not a loosening).
    // CHANGED ACCEPTED (0.8.4 release chores, 11 Nov 2026; C&C ruling). OLD /2026-11-21.*2026-12-10.*2026-12-23/s; NEW /`npm test` turns red on dates, by design:\*\*.*2026-12-01.*2026-12-23.*2026-12-26.*2026-12-27.*2027-01-01/s.
    // WHY: the gpt-5.6-sol row lost its `expires` date (2026-11-21 is no longer a red day); the OpenRouter rows were compared on 2026-11-11, so their freshness test turns red on 2026-12-27 (stamp + 45 + 1), not 2026-12-10; the zero-retention list (src/zdr-hosts.json, read 2026-11-10; test/zero-retention.test.js ZR-6)
    // turns red on 2026-12-26 and the Gemini 4 Argon (2026-12-01) and the two Gemini Flash rows (2027-01-01) are `expires` rows: all were red days the bullet left out. The pin is ANCHORED at the bullet's own opening words, because this section also holds the Pricing paragraph, which names 2026-12-01 and 2027-01-01 before the bullet: an unanchored
    // pattern would still pass with a date dropped from the bullet. Five dates, in date order, so it is stricter than before, not looser. RED RUN: this row run on the tree before the README edit fails (the bullet still says 2026-11-21).
    ['the red-test dates', /`npm test` turns red on dates, by design:\*\*.*2026-12-01.*2026-12-23.*2026-12-26.*2026-12-27.*2027-01-01/s],
    ['DeepSeek on Together unconfirmed', /DeepSeek V4 Flash on Together/],
    ['reasoning fields not exercised live', /not exercised in a live call/],
    // 0.8.2 (owner, 6 Oct 2026, archive the unused chains): four of the six moved to archive/chains/, so the sentence says Two; the next test derives the count.
    // 0.8.4 add-on removal (REM-w34): the limit is reworded to the typed limit; the old wording was about the advice send path.
    ['one typed limit, two runs', /One typed limit can start two runs if its run folder is copied before the run starts/],
    ['the direct-Anthropic retry may never fire', /retry of a direct Anthropic seat whose thinking used the whole cap may never fire/],
    ['run-folder fields not marked untrusted', /Some fields an agent reads about a run are not marked as untrusted text/],
    // Changed by the owner's decision of 7 Oct 2026 (0.8.2 item 8b, the reservation record): a killed process no longer records nothing; the limit now says it stays charged at its worst case.
    ['a killed process leaves the call charged at its worst case', /A process killed in the middle of a paid call leaves that call charged at its worst case/],
    // 0.8.3 harness (a): the answerer of a session seat is the session's own statement.
    ['the answerer of a session seat is declared, never checked', /Who answered a seat that a coding-agent session fills is the session's own statement and is never checked/],
    ['plugin strict validation warning', /claude plugin validate --strict \.` fails on it: "CLAUDE\.md at the plugin root is not loaded as project context"/],
    // 0.8.3 (lane T, LB group, READ-B LB-2, C&C ruling (ii) 25 Okt 2026): a smaller plan of a tree gets the goal only from a heading of the task, and a task with no heading that can hold the goal (none at all, or only exclusions headings) is given whole.
    ['a smaller plan gets the goal only from a heading; a task with no goal heading is given whole', /A task with no headings at all, or whose only headings are exclusions headings, is given whole\./],
    // 0.8.4 DUALCAP unit 3a (C&C's rulings of 1 Nov 2026): with per-provider spend caps on, three command classes are refused before anything is sent (src/caps.js capsRefusedClassOf).
    ['per-provider caps: a tree does not run', /With per-provider spend caps on \(`COUNCIL_SPEND_CAPS`\), a recursive-council tree does not run/],
    ['per-provider caps: the paid side commands do not run', /With per-provider spend caps on, the paid side commands do not run/],
    // 0.8.4 DUALCAP unit 4b2: the Desktop dialog has one limit field (the started-run limit of 4b2 was deleted by 4c1, which makes it untrue).
    ['per-provider caps: the plugin cannot set per-provider limits', /The Desktop plugin cannot set per-provider limits/],
    // 0.8.4 (PRICES unit 3, 1 Nov 2026): the host preference file and the one thing about it nobody documents.
    // 0.8.4 (PRICES unit 2b, 1 Nov 2026): long-prompt price steps are recorded. CHANGED ACCEPTED TEST (DUALCAP 4d, 1 Nov 2026). OLD bar: the limit said the spend cap and the price limit still use the row's base figure. NEW bar: the cap, the price limit
    // and the dry run's maximum read the step, so the limit narrows to what stays true: the dry run's expected figure still prices every row at its base figure. WHY: unit 4d wires the call's prompt size into every rate lookup; the limit is narrowed, not deleted.
    ['the dry run\'s expected figure does not count long-prompt price steps', /the dry run's expected figure still prices every row at its base figure/],
    // 0.8.4 (Open Inference block, his decision 8 of 28 Okt 2026): the wording of a refusal caused by the block is unprobed, and the stop keeps the price_refused name.
    ['a refusal caused by the Open Inference block has not been seen', /A refusal caused by the Open Inference block has not been seen \(0\.8\.4\)/],
    // 0.8.4 (S20 slice 1): the relay of a raised limit rests on the session's word; the tool cannot verify the permission.
    // 0.8.4 (finish at once): the relay of a finish-now rests on the session's word too.
    ['the owner\'s pause is the person\'s too', /The owner's pause is the person's too: the session continues it by resuming the run, and ends it only with the person's words, `finish` or `finish_now`\./],
    ['a stop only the person decides takes no answer of the session\'s own', /At a stop only the person decides \(the hard stop after seven overseer rounds off the ladder, and on a ladder run the stop at the limit the person typed, at any number\) it gives no answer of its own, and the gate refuses one/],   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `and on the permanent ladder the stop at the limit its person typed`. NEW: `and on a ladder run the stop at the limit the person typed`. WHY: the reviewed row of README.md (the limit about stop_decide, the apply, commit 1); the limit stays.
    ['a relayed choice at a stop, or a relayed acceptance, is the handling session carrying the person\'s own words', /A relayed choice at a stop, or a relayed acceptance of a plan, is the handling session carrying the person's own words \(0\.8\.4\)/],
    ['a relayed raise is the handler session\'s word', /A relayed raise of the spending limit is the handler session's word \(0\.8\.4\)/],
    ['the relayed raise reaches MCP too (0.8.4 H10)', /`resume_run` over MCP with `max_usd` and `person_words`/],
    ['a host preference rests on documented ordering and one undocumented interaction', /does not say how `order` combines with `provider\.max_price`/],
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
  assert.deepEqual(gone.filter(re => re.test(bothLimits)).map(String), []);
});

// 0.8.4 DUALCAP unit 4c1: a limit made untrue by the code is deleted in the same commit (CLAUDE.md), and stays deleted: the caps' started-run limit (4b2) went with
// the resume under the caps.
test('the per-provider caps limits that a later unit made untrue are gone', () => {
  const gone = [/With per-provider spend caps on, a run that has started cannot be continued yet/];
  assert.deepEqual(gone.filter(re => re.test(bothLimits)).map(String), []);
});

// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026 01:10: verify, the only shipped chain that seated Gemini 2.5, moves to chains/outdated/). OLD: the README's Known limit "One shipped chain seats Gemini 2.5" had to name exactly the shipped chains that seat it (derived), and a pin required the sentence. NEW: no shipped chain seats Gemini 2.5, so the limit is gone from the README (CLAUDE.md: a limit is deleted when the code makes it untrue, in the same commit), and this test keeps both directions: the limit is not there, and no shipped chain seats the model, so it cannot be missing while still true. WHY: the code made the limit untrue.
test('the Gemini 2.5 limit is gone because no shipped chain seats Gemini 2.5 (derived: if one ever does, this fails and the limit must come back)', () => {
  const seating = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json') && /gemini-2\.5/.test(readFileSync(join(root, 'chains', f), 'utf8'))).map(f => f.slice(0, -5)).sort();
  assert.deepEqual(seating, [], 'a shipped chain seats Gemini 2.5 again: restore the Known limit about it');
  assert.doesNotMatch(bothLimits, /shipped chains? seats? Gemini 2\.5/, 'the limit sentence is gone');
});

// 0.8.4 add-on removal (Q10): the Known limits that spoke of the advice tools are gone, and the section names no removed tool, chain or verb.
test('the Known limits name no removed advice tool', () => {
  assert.doesNotMatch(bothLimits, /council_quote|council_advise|advise-standard|advise-premium|council advise-rate/);
  assert.doesNotMatch(bothLimits, /\bU[1-7]: /);
});
