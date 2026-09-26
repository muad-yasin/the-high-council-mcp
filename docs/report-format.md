# The run format (`report.json`)

Every finished run writes `runs/<id>/report.json`: the whole run as data. It holds the acceptance
criteria, every proposal, every debate post and reply, each reviewer's sign-off or objections, what
the plan did with each proposal, and what every model call cost. `BOARD.md` is the same record for
people. If you build something on top of a run, read the JSON. Do not parse the markdown.

The format is published as a JSON Schema (draft 2020-12): [`schemas/report-v1.json`](../schemas/report-v1.json),
shipped in the npm package too. Every field in it has a description.

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
- `stoppedBy`: `"budget"`, the only stop that writes a partial report so far.
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

## Checking a run folder

```js
import Ajv2020 from 'ajv/dist/2020.js';
const ajv = new Ajv2020({ allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validate = ajv.compile(schemaJson);   // schemas/report-v1.json
validate(reportJson) || console.error(validate.errors);
```

`test/report-schema.test.js` does the same against real offline runs of the shipped mock chains
that finish in one sitting (14 of the 17; the other three pause for a person or stop at their cap),
a resumed `mock-external` run, a descending-mode run, and one run with every optional stage turned
on. `test/report-partial.test.js` validates the `report-partial.json` of capped `mock-budget`,
multi-round, descending, `--rematch` and `--replay` runs against the same schema.
