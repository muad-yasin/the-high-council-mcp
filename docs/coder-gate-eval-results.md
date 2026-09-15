# coder-gate fixture eval - results

Method: `node scripts/eval-fixtures.mjs --self-test` was run against the 10 fixed fixtures in
`fixtures/coder-gate-eval/cases/` (5 "buggy", 5 "clean") on 2026-09-15, verifying each fixture's
own honesty (base passes its test, the diff applies, the result fails its test iff the case is
buggy) and then checking the scorer against three mock verdict sets with known right answers - no
real model or panel was run, and this page makes no comparison between reviewers.

## Raw output

```
Fixture integrity (base passes its test; diff applies; result fails iff buggy)
  01  buggy   base pass  apply ok  after fail  ok
  02  clean   base pass  apply ok  after pass  ok
  03  clean   base pass  apply ok  after pass  ok
  04  buggy   base pass  apply ok  after fail  ok
  05  buggy   base pass  apply ok  after fail  ok
  06  clean   base pass  apply ok  after pass  ok
  07  clean   base pass  apply ok  after pass  ok
  08  buggy   base pass  apply ok  after fail  ok
  09  clean   base pass  apply ok  after pass  ok
  10  buggy   base pass  apply ok  after fail  ok

mock verdicts: exactly the buggy cases flagged
  flagged 5 | buggy flagged 5 | clean flagged 0 | clean passed 5 | buggy passed 0

mock verdicts: always pass
  flagged 0 | buggy flagged 0 | clean flagged 0 | clean passed 5 | buggy passed 5

mock verdicts: always flag
  flagged 10 | buggy flagged 5 | clean flagged 5 | clean passed 0 | buggy passed 0

self-test passed
```

Fixtures run: 10 (5 buggy, 5 clean). All 10 passed integrity (`ok`): the base compiles and passes
its own test, the diff applies cleanly, and the post-diff result fails iff the fixture is marked
buggy. The three mock verdict sets each scored exactly as their own known-correct answer predicts
(perfect-oracle: 5/5 true positives, 0 false positives; always-pass: 5/5 false negatives; always-
flag: 5/5 false positives) - this is the scorer proving itself correct against fixed answers, not
a measurement of any reviewer.

## What this is not

There is no panel-vs-single-model comparison mechanism in this repository to run. What exists and
is exercised above is fixture integrity plus scorer self-consistency against three mock verdict
sets with known answers - `scripts/eval-fixtures.mjs --verdicts <file.json>` scores a verdict file
an operator supplies by hand (e.g. from a real coder-gate run), but no automated run of a panel or
a single model against these fixtures has been produced, here or anywhere else in this repo. A
real panel-vs-single-model run, if one is ever produced, would need its own separate results entry
here with its own raw numbers - it should not be assumed to exist because this page exists.
