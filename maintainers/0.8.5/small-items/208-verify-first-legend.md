# 208: the "Verify first" gap check reads a marker legend as a claim, and misses a match when the apostrophes differ

> Prepared for 0.8.5, not built: input for a later build session, not a build order. Read against the code at commit 0b4016a5; line numbers are that commit's. Nothing was run to prepare this note, so every "expected red" below is a prediction that the first test run must confirm.

## What is wrong

When a plan marks a claim `[UNVERIFIED: ...]`, the handoff seat is asked to list it in a "Verify first" section, and the harness checks that it did.
- The check, `verifyFirstGaps` (`src/verify-first.js:54-60`), reads every UNVERIFIED marker of the plan through `unverifiedMarkers` (`src/claim-markers.js:135-144`).
- It reports `verify_first_missing` for each marker that the section does not name.
- A marker counts as named (`src/verify-first.js:43-48`) when the section holds an identifier-like token from its claim or from what would settle it, or the first 40 characters of either (8 characters or more).
- The gaps reach `WARNINGS.md` and the handoff's list of gaps through `lintMilestones` (`src/milestones.js:127`; pinned end to end by `test/lane-a-wiring.test.js:109-112`).
- It runs when a chain sets `handoff_contract.milestones` (`src/cli.js:5046`, and `:1150` for `handoff --from-run`). Every shipped planning chain sets it, and the words that switch the check on are recorded (`verifyFirstParagraph`, exported by `src/roles.js:35`).

Two inputs give a gap that is not one:
1. **A legend.** A plan can restate the marker vocabulary as a key, for example a line that shows `[UNVERIFIED: <the one reading that would settle it>]`, the form the writer's own rule gives (`src/prompts/recorded-084-a.js:82`). `unverifiedMarkers` treats every `[UNVERIFIED: ...]` in a text line as a marker (the pattern is at `src/claim-markers.js:24`). So the legend becomes a "claim" made of its lead-in words, which no "Verify first" line names: one false gap per legend.
2. **An apostrophe written two ways.** `norm` (`src/verify-first.js:15`) removes straight quotes and apostrophes only. Take a claim written with a curly apostrophe (U+2019) in the plan and a straight one in the handoff, or the reverse.
   - The 40-character match fails when the apostrophe falls inside the claim's first 40 characters.
   - It is then a false gap only when nothing else names the marker: no identifier-like token in the claim or in what would settle it, and no match on the settle-by text (`src/verify-first.js:45-47`).
   - The repo has normalisers that treat both apostrophe forms alike (`normQuote` and `normQuoteTight`, `src/post-quotes.js:8` and `:11`), but `normQuote` also removes `_` (see change 2).

One thing that looks wrong is not: **the check does not cut a claim at its apostrophe.**
- `sentencesOf` (`src/claim-markers.js:34-48`) ends a sentence only at `.`, `!` or `?` followed by a space or the end of the line, and never inside a marker. It has no rule for apostrophes.
- `unverifiedMarkers` keeps the whole sentence as the claim (`:141`).
- What misleads is the message: it wraps the claim in single quotes (`src/verify-first.js:59`, ``rests on '${m.claim.slice(0, 80)}'``). A claim such as "The cache's key is stale." therefore reads, to a person or a script that takes the text up to the next single quote, as "The cache".
- A marker standing alone on a list line gives the claim ".". It cannot match by its own text, but it can still match by what the marker says would settle it.

## The smallest change

1. **The legend.** In `unverifiedMarkers` (`src/claim-markers.js:135-144`), skip a marker whose whole body is one placeholder in angle brackets (`<...>`), the form of the rule's own key.
   - Do not change `sentencesOf`. It is shared with the three findings of `checkClaimMarkers` (`claim_unmarked`, `claim_disputed_early`, `claim_range_unshown`; `src/claim-markers.js:88-111`).
   - Another rule for what a legend is (for example one keyed on a line's opening words) is the builder's choice, made with its advisor. The rule above is the narrowest one that matches the form the harness itself prints.
   - The rule is unconfirmed against a real plan: no plan with a legend was read for this note, and VF-L below uses the same form, so it cannot fail on a legend of another shape. The builder's first check is to read the legend of a real plan.
2. **The apostrophe.** Make `norm` in `src/verify-first.js:15` also remove the curly quote and apostrophe characters (U+2018, U+2019, U+201C, U+201D).
   - Add those characters only. Do not call `normQuote` instead: it also removes `_`, and `named` matches underscore tokens such as `cache_ttl` against the normalised section (`src/verify-first.js:41` and `:45`).
   - `norm` serves both the section's text and the marker's text, so both sides change together.
3. **Optional, A-DRAFT:** a message that cannot be misread, for example the claim in double quotes. The sentence is pinned word for word in `test/handoff-verify-first.test.js:24` (`msg`) and `test/lane-a-wiring.test.js:107-108`, and changing it needs the owner's yes (question 2).

## The test, and how it fails first

New cases in `test/handoff-verify-first.test.js`, offline and at $0, with the held words recorded the way the file's own tests record them (`setHeldForTest(ALL)`):
- **VF-L.** Take a plan with a legend line that shows `[UNVERIFIED: <the one reading that would settle it>]` and one real marker. Assert that `unverifiedMarkers` returns one marker, and that `verifyFirstGaps`, given a handoff that names the real one, returns no gap.
  - Expected red today (not run): two markers and one gap, the legend's.
- **VF-Q.** Take a plan claim with a curly apostrophe inside its first 40 characters, no identifier-like token in the claim or in its settle-by text, and a "Verify first" line that quotes the claim with a straight apostrophe; then the reverse. Assert no gap.
  - Expected red today (not run): one gap each way. Without those conditions the case can pass today on a token or on the settle-by text, which proves nothing.

These run with the change:
- the files that import the two modules (`unverifiedMarkers` has one caller in `src/`, `src/verify-first.js:56`): `test/claim-markers.test.js`, `test/handoff-verify-first.test.js`, `test/plan-checks.test.js`, `test/review-notes-handoff.test.js` and `test/severity-dissent-handoff.test.js`;
- `test/lane-a-wiring.test.js`, which pins the message;
- the source scanners.

## The owner's gates

- **Prompt wording:** none for changes 1 and 2. A convention for naming an assumption by an id (question 1) would be new wording in the writer's and the handoff seat's rules.
- **Sentences a person or a session reads:** none for changes 1 and 2. Change 3 rewrites a message that a person reads in `WARNINGS.md` and in the handoff. It is A-DRAFT, and its two pins become changed accepted tests.
- **Money:** none.
- **Hand-typed counts:** none.

## What the change must not touch

- `sentencesOf` and the findings of `checkClaimMarkers`.
- The held words of the "Verify first" list (`src/prompts/recorded-084-a.js`).
- The message, unless the owner says yes to change 3.
- The order and the number of gaps for the plans the existing tests use.
- A real marker on the same line as a legend: it must still be read.
- A legend that shows `[DISPUTED: ...]` may also raise `claim_disputed_early` (`src/claim-markers.js:107`). That was not checked and is outside this item.

## Questions only the owner can answer

1. Should a plan give each assumption an id that a "Verify first" line can name? No such convention exists in `src/` today. Matching stays a text heuristic without one, and adding one is new prompt wording.
2. Should the message stop wrapping the claim in single quotes (change 3)?
