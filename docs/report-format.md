# The run format (`report.json`)

Every finished run writes `runs/<id>/report.json`: the whole run as data. It holds the acceptance
criteria, every proposal, every debate post and reply, each reviewer's sign-off or objections, what
the plan did with each proposal, and what every model call cost. `BOARD.md` is the same record for
people. If you build something on top of a run, read the JSON. Do not parse the markdown.

The format is published as a JSON Schema (draft 2020-12): [`schemas/report-v1.json`](../schemas/report-v1.json),
shipped in the npm package too. Every top-level field in it has a description; a nested field has one where its meaning is not clear from its name.

## Versioning

- `schemaVersion` (an integer, first key in the file) names the format version. It is `1`.
- It changes only on a **breaking** change: a field renamed or removed, or its type or meaning
  changed. A breaking change gets a new schema file (`report-v2.json`) and a changelog entry.
- **Adding a field is not breaking** and does not change `schemaVersion`. Ignore fields you do not
  know. The schema leaves `additionalProperties` open so an older reader still accepts a newer report.
- A `report.json` with no `schemaVersion` was written before 0.7.7. Read it as version 1.
- This is separate from the `schemaVersion` a chain file may declare. That one versions
  `chains/*.json`; this one versions `report.json`.

## Stable and experimental fields

Each top-level property in the schema carries `"x-stability": "stable"` or `"experimental"`.

- **Stable** fields keep their name, type and meaning for all of version 1: `schemaVersion`, `runId`,
  `chain`, `task`, `fromRun`, `criteria`, `questions`, `passed`, `outcome`, `lastCritique`,
  `signoff`, `proposals`, `dropouts`, `debate` (`posts`, `replies`), `scoreboard`, `totals`, `maxUsd`,
  `stages`, `alternatives`.
- **Experimental** fields belong to newer or opt-in stages. They may change shape in a minor
  release, and the changelog says so when one does. Examples: `panelVerdicts`, `dispute`,
  `disputes`, `security_review`, `claims`, `lints`, `argued`, `debate.diagnostics`,
  `debate.dropped` (since 0.7.8: the debate posts and author replies the harness rejected, per lab
  and reason; `[]` when none were), `notQuorate` (since 0.7.8: only on a chain that sets
  `quorum.minHeard`, when a round's sign-off had too few verdicts to count), `deep_dive` (since
  0.7.8: only on a chain with a deep-dive seat, what it checked and found, and what it cost).
  Also since 0.7.8, with the majority guard on, a `debate.replies[]` withdrawal that does not quote
  the argument it concedes to carries `unargued: true`, and its proposal stays for the builder.

Since 0.8.0 (all experimental, all additive, none read by any verdict, prompt or stop):
`criteria_lints[]` ($0 word-level findings over the criteria list, run before any paid round: no
criterion asks the plan to be consistent with itself, most criteria only ask that something be named,
a vague word with no number or check; `[]` when clean, never a stop), `criteria_sha256` (a fingerprint of the criteria list, the same one the lock block at the end of
`HANDOFF.md` carries; `council check-lock HANDOFF.md --run runs/<id>` compares them), `checks_sha256` (since 0.8.1: a
fingerprint of how each criterion is checked, its `check` and `on` from `criteria_kinds`, null for the others; the lock block
lists each check under its criterion and carries this hash in a second marker, which `check-lock` verifies too), `thin_contract` (0.8.2, experimental: one record of the task, criteria, checks, evidence and signed text hashes, all 64-hex, plus `sha256` over the record without that field: canonical JSON, keys sorted at every depth, no whitespace, UTF-8, an unknown component the literal null; `evidence.ground_truth_sha256` is over each shown `{ tool, args, result }` without `result_ref`; `council contract check runs/<id>` recomputes it, and it is tamper-evident, not tamper-proof; absent for an advice run), `handoff_milestones` (0.8.2, experimental, only when the chain sets `handoff_contract.milestones`: `{ status, milestones, findings[] }`, what a $0 lint found in the milestones the handoff seat wrote; never changes `passed`), `criteria_ids` (positional, index-aligned with `criteria`: `C1`, `C2`, ...) and `missing_criteria[]`
(sign-offs whose criteria table left criteria out, by round and lab; `[]` when none did, and a reply
with no table at all is not listed); `cut_despite_support[]` (proposals the plan cut although another
lab supported them in the debate, with supporters and objectors; only when the run had proposals and a
debate); `disagreement_map[]` (one row per review round: each lab's verdict, `(carried)` when it was
reused on an unchanged draft).

Since 0.8.2, `panelVerdicts[].lane` (additive, only for a seat with a review lane, the optional `plan-lanes-4` chain). Since 0.8.1 (optional and additive, none read by any verdict, prompt or stop): `field_cuts[]` (every place a model's text was cut before other seats read it: stage, field, original and kept length; `[]` when nothing was cut), `disputes[].round` can be `"build"` (the builder's own DECLINED lines; a reply made only of them stops the run), `panelVerdicts[].no_answer` (`"no answer: thinking used the whole cap"`: an unheard seat whose reply was cut off at its cap after spending its tokens on thinking and carried no text; never a pass), `stages[].cappedAt` (the output cap a reply was asked at: the seat's own, or the bigger one an Anthropic seat's retry used) and `stages[].noAnswer` (the same mark on the stage), and `advise` (the council advisor's roll-up, only on an advice call).

Most optional stages add their field only when the chain turns that stage on. When the field is
missing, the stage did not run. It does not mean the stage found nothing.

## Read it defensively

- Some fields come from a model's own JSON reply, and the harness passes them through with little
  checking. The schema marks them "model-supplied". Examples: a proposal's `title`/`what`/`how`, a
  reply's `text`, the extra keys an `amend` reply brings. Check a field exists before you use it.
- `signoff[].lab` is the seat's lab (since 0.7.7). `signoff[].provider` holds the same value despite
  its name; it is deprecated and stays until a version 2. Read `lab ?? provider`.
- `alternatives.dropouts[].reason_code` (since 0.7.7) matches the spelling in `signoff[]` and
  `panelVerdicts[]`; `reasonCode` is its deprecated alias.
- `signoff[].passed` means the seat *stated a pass*: it declined to give a verdict. It is not the
  run's top-level `passed`.
- A `stages[]` entry with `priced: false` shows `usd: 0`, which means *unknown*, not free. Check
  `totals.unpriced` too.
- `totals.usd` is the sum of the stages' settled `usd`. It excludes an unsettled reservation (a call that was sent when the process ended and never settled): `council --spend`, `run_status` and a resume's cap count
  such a reservation at its worst case, so those figures can be higher than the report's total.
- `task` is never absolute (since 0.7.7): it is relative to the directory the run was started in,
  or the file name alone if the task lives outside it. Reports from 0.7.6 and earlier can carry an
  absolute path after a resume, rematch, replay or `init`. `task_sha256` (experimental) is the
  SHA-256 of the task text, so a reader can match a report to its task file without the path. The
  path still names a file on the author's disk; consider dropping it before you publish a run.
- `fromRun` follows the same rule since 0.7.7: relative to the start directory, or the run
  folder's name alone.

## A run the spend cap stopped (`report-partial.json`)

A run that stops early writes no `report.json`: that file existing means the run finished. Since
0.7.7, a run the per-run spend cap stopped writes `report-partial.json` next to
`STOPPED-budget.json` instead, so a run capped after many rounds can still be read as data. It is
the same schema, built by the same function from what the run had when it stopped, with three
experimental fields added:

- `partial`: always `true`. It never appears in `report.json`.
- `stoppedBy`: `"budget"` (the per-run spend cap, exit 4), or, since 0.8.1, for an advice call stopped at exit 18: `"user"` (a
  person, `council stop`), `"client_cancel"` (the MCP client cancelled or went away) or `"wall_clock"` (a chain's own
  `advise.max_wall_ms` passed; no shipped chain sets one since 0.8.2, the value stays readable for runs recorded before). A stopped advice call's `advise` holds the answers that were paid for (`advise.status`
  `"stopped"`). A reader must ignore a value it does not know.
- `stoppedAtStage`: the label of the stage the run stopped before. That stage was never paid for.

Read it knowing the run did not finish:

- A stage the run never reached has the value that means "did not run": `null`, `[]`, `false`,
  or the field is absent. `passed`, `outcome` and `signoff` describe the state at the stop. They
  are not a verdict.
- `stages`, `totals`, `proposals`, `debate` and `panelVerdicts` (one row per seat per review round)
  hold everything that did happen, up to the stop.
- `finished_at` is when the run stopped. The privacy rules are the same as for `report.json`:
  `task` and `fromRun` are never absolute.
- `BOARD-partial.md` is the same board for people, headed as a stopped run's. It is written once
  the run has got far enough to have a board.
- A `--resume` deletes both files together with `STOPPED-budget.json`, because they describe the
  run as it stood at that stop. If the resumed run finishes, it writes `report.json`. If the cap
  stops it again, it writes fresh partial files. A capped `--rematch` or `--replay` folder gets
  them too.

## An advice call (`advise`, `advise.sent_to`, `advise.dispositions`, `advise.stopped_by`)

A run of an advice chain (the council advisor: `council_advise`, or `council --chain advise-...`) carries the experimental `advise`
object (the headline leaning, every seat's blind and final position with quote-checked risks, the debate, the dissent in each seat's own
words, what it cost), absent on every other run. Inside it:

- `advise.sent_to[]`: one row per seat the brief went to: `lab`, `model`, `provider`, `retention` (the preview's wording: "ZDR-tagged by
  OpenRouter", "retains, ..." quoting the lab's own page, or "unknown"), `retention_class` and `served_by` (the hosts the provider
  named, often empty). The wording comes from a dated table (`src/advice-retention.json`); "ZDR" is OpenRouter's routing tag, not a
  guarantee about the host.
- `advise.dispositions[]`: the accept, reject or defer, with a reason, the caller recorded before this call for each objection of the
  previous advice call (`id` is `<run>#<lab>`). Caller-supplied text.
- `advise.stopped_by`: present only when the call stopped short of its plan. In `report.json` (an answered call) it is `own_cap` or
  `run_cap`: a debate round or the synthesis was skipped for money. Since 0.8.1 a call stopped by a person, its client or its wall
  clock ends at exit 18 and writes `report-partial.json` instead, whose `advise.stopped_by` (and top-level `stoppedBy`) is `user`,
  `client_cancel` or `wall_clock`; the debate or synthesis that did not run is named in `advise.debate.stopped` or
  `advise.synthesis.flag`. Before 0.8.1 `client_cancel` and `wall_clock` could appear in `report.json`.

The brief is the run's task file, so its hash is the top-level `task_sha256`: the sha256 of the exact text every seat was sent (after
masking), the text the person confirmed. It is not the text.

**`passed` and `outcome` on an advice call are not a sign-off.** No draft was reviewed: `passed` is `true` whenever the call ran,
and `outcome` says whether the advisors' answers agreed (`consensus`, `no_consensus`, or `degraded` with a dropout). `verdict_stats` and `metrics_report` skip every report that carries `advise` (and say how many they
skipped), so advice calls never count as sign-offs there.

Next to `report.json` an advice run also leaves `advise-log.json`: a date, the mode, how the person approved (`approval`: `elicitation` or
`cli`) and which gate (`gate`, since 0.8.1), the seats, `brief_sha256`, hashed words of the
question (so a repeat can be recognised; no brief text), the quoted and the spent price, the wall clock, the leaning, how many positions
dissented and their ids, the dispositions, and one empty `owner_rating` (`{"rating": "useful" | "not useful" | "unclear", "note": ""}`)
for a person to fill in later. The advice tools read this file, and only the folder, to apply their limits.

## Checking a run folder

```js
import Ajv2020 from 'ajv/dist/2020.js';
const ajv = new Ajv2020({ allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schemaJson);   // schemas/report-v1.json
validate(reportJson) || console.error(validate.errors);
```

`test/report-schema.test.js` does the same against real offline runs of the shipped mock chains
that finish in one sitting (18 of the 21; the other three pause for a person or stop at their cap),
a resumed `mock-external` run, a descending-mode run, and one run with every optional stage turned
on. `test/report-partial.test.js` validates the `report-partial.json` of capped `mock-budget`,
multi-round, descending, `--rematch` and `--replay` runs against the same schema.
