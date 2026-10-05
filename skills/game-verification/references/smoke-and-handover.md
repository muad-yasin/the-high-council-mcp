# The smoke gate and the handover note

*Templates for `SKILL.md` section 2. The practice is documented in the open (Riot Games, "Automated Testing for League of Legends", 2016: a blocker set of smoke tests runs on CI for every new build, and a build that fails it is not deployed to a test environment; Unreal's Gauntlet is documented as launching a build, driving it and parsing its logs and crashes). The tier names, the expected-signal table and the handover note are this skill's own organisation, from one prototype's practice, not measured against alternatives.*

## One smoke card per build

Written before the run, kept next to the build. Five or six lines are enough; a long card is a smell.

```
Build:      <commit> / <build id> / <artifact hash>      Machine: <CPU, GPU or none, driver, OS>
Run mode:   <A no graphics | B invisible with rendering | C visible>   Graphics API: <...>
Log path:   <this run's own log>      Result file: <path>      Timeout: <hard cap>
Features in this build, one row each:
  <feature> | expected signal: <counter / state query / log line> | minimum: <n> | tier: BLOCKING | REPORTED
  Reach: <the route or script step that must pass the feature's trigger; the run ends after it>
Also blocking: the build starts and reaches the real entry scene; no logged exception or error outside the expected list.
Expected list (messages that are allowed): <...>
Not covered by this smoke: <what it cannot reach, stated now>
```

Reading the result:

- A BLOCKING signal below its minimum, a missing or unparseable result file, an unexpected exception, or an unreached feature is a **FAIL**. A skipped check is counted apart and reads as INCONCLUSIVE, never PASS.
- REPORTED rows are written into the handover note and never re-run on their own.
- A FAIL stands. Proceeding past it is a separate decision by the build's owner, recorded with its reason. A fix is a new build with a new smoke.
- If the run ends before the last row's trigger, that row is "unreached", which is a coverage failure and not a pass.

Where an engine can assert on the log itself, use it: Unity's `LogAssert.Expect` fails a test if an expected message does not appear in the log (Test Framework 1.5 API, read 2026-10-04), which turns "the log said 0" into a failure instead of a line.

## The handover note: one screen

```
Build:        <commit / build id>, smoked on <date>, run mode <A/B/C>
In it:        - <feature or change> (new | changed | unchanged but touched)
Not in it:    - <anything the person might expect: proposals awaiting a yes, parked work>
Smoke:        PASS | FAIL (proceeding by <who>, because <reason>) | partly: <what ran>
  Covered:    - <feature> reached, signal <n> (expected >= <m>)
  Not covered / unverified: - <what no check reached, and why>
  Reported only: - <timings, captures, with file names>
Try first:    <the one or two things that most need a person's hands>
Worth a session? <yes | not yet, because ...>
```

The honesty rule behind it (what was verified, how, and what was not) is `verification-and-critique`, Part 4. A note that says "all good" and names nothing is the failure it prevents.

## Replaying a person's route

1. Record the playtester's input (or just the route) during a normal session; keep the file with the build id it was recorded on.
2. Replay it on each later build as a smoke row (REPORTED at first; BLOCKING once it has proved stable).
3. Compare state traces (positions, speeds, events fired) inside tolerance bands. Exact equality is only a fair demand when the simulation is deterministic and the engine's replay is known to reproduce physics; on one engine version that is unverified here.
4. Report per place: the places a person drove are where defects were found that no aggregate showed.
