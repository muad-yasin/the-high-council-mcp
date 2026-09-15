# coder-gate eval fixtures

Ten fixed, one-file, one-hunk changes for scoring review verdicts offline. Each `cases/NN/` holds:

- `base.js` - the code before the change
- `diff.patch` - the change, applied to `base.js` as `target.js`
- `check.mjs` - a `node:test` file for `target.js` (named so `npm test` does not pick it up)
- `case.json` - `expected: "buggy"` (the change breaks `check.mjs`) or `"clean"` (it does not), plus a one-line note

Five are buggy and five are clean, so a reviewer that always flags or never flags matches only half.

```bash
node scripts/eval-fixtures.mjs --self-test            # no model call, no network
node scripts/eval-fixtures.mjs --verdicts verdicts.json   # score your own verdicts
```

`--self-test` checks that every fixture is honest: the base passes its test, the diff applies, and
the result fails iff the case says buggy. It then checks the scorer against three mock verdict
sets with known answers.

A verdict file maps every case id to `"flag"` or `"pass"`, for example `{ "01": "flag", "02": "pass", ... }`. A missing
id is an error.

This produces a detection count on ten hand-written fixtures. It is not a measurement of how good a
reviewer, panel or model is, and it supports no comparison between them.
