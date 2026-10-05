---
name: game-verification
description: Decides whether a game change works and whether a build may go to a person, without anyone watching - the cheapest check that can fail, a scripted smoke run of the integrated build that must reach and assert each new feature before any playtest, gates that fail on known-bad input, real input and real frames, three named kinds of invisible run, captures taken the way a player sees them, vision-model reads treated as measurements, and performance as percentiles on a fixed route. Use when a task changes gameplay, traffic, physics, rendering, UI, streaming or a build; before handing a build to a playtester or owner; when setting up or extending a smoke test, game CI or an invisible run; when a screenshot or vision read is about to be trusted; and when a check passed too easily. Not for generic review structure (verification-and-critique), pure-logic test craft (backend-developer), UI states (frontend-developer) or whether it looks right (visual-craft).
license: MIT
---

# Game Verification

Games hide wrong behaviour behind plausible behaviour. A car that drives, a street that renders and a menu that opens can each be wrong in a way no exception reports. The check has to be something that would have failed, run on the game and not on a stand-in for it.

**Rule zero: rig, harness and unit-test results are evidence about the rig.** A claim that a feature works in the game is settled only by a run of the integrated build: the real scene, the real wiring, real physics, real content loading. On one driving prototype, police behaviour was verified in a flat-ground rig and wired to the real engine with a compile check only; the first run in the real game was the owner's. Everything below follows from keeping that from happening again.

**Scope of the evidence.** The smoke gate, the invisible-run modes and the capture recipe come from one Unity driving prototype and one shipped Unity mobile game, and from one Linux desktop with a GPU; single-project practice, never measured against alternatives. The engine-command and CI claims come from vendor documentation, graded in the references. The vision-model rules come from published research, graded in `references/vision-qa.md`. Nothing here is verified for Unreal or Godot: the questions to answer there are how the test runner reports results, what a batch or dedicated-server run can execute, and how a capture is triggered (`references/unreal.md`).

**This skill owns:** which check fits a claim, the per-build smoke gate before any person plays, the kinds of invisible run, game gates, the capture recipe and the performance protocol. **It hands off:** review structure, per-criterion verdicts, "a gate that returns nothing is suspect" and how to report what was not verified (`verification-and-critique`); determinism and injectable clocks (`backend-developer`); UI states and viewport shapes (`frontend-developer`); whether a capture looks right (`visual-craft`); shared-machine and spend rules (`tool-and-action-discipline`).

## 1. The ladder: the cheapest rung that can fail, never above the integrated build

| Rung | Answers | Does not answer | Render mode (section 4) |
|---|---|---|---|
| 1 Pure logic test, engine-free | Is this formula, state machine or save migration right | Anything about the engine, rendering, physics integration | none |
| 2a Scripted scenario in a rig or test scene | Does the simulation obey its rules over a fixed seed and route | Whether the feature is wired into the game | none |
| 2b Scripted smoke run of the integrated build | Does the feature fire in the real game: wiring, spawning, coordinate frames, content loading, real physics, real input bindings | Feel; GPU cost | invisible, rendering if the claim is visual |
| 3 Capture from the real build | Does it draw, where, at what framing, in which state | Behaviour over time | invisible with rendering, or visible |
| 4 Performance run | Frame-time percentiles, memory, hitches on a route | Whether it is fun | visible on the target |
| 5 Human playtest | Feel, readability, taste | Regressions across forty scenarios | visible on the target |

Use the cheapest rung that can fail for each part of a claim - but **a claim about the game never stops above rung 2b. Rig-verified is the floor, not the gate.** Write down which rungs you used and which you skipped; a physics-integration claim backed by rung 1, or a visual claim backed by a run with no rendering, is a skipped rung and says so in the report.

## 2. The smoke gate: no build goes to a person before its smoke run passed

Before any build goes to a playtester or the owner, a scripted run of **that exact build** starts the game the way a player does, drives each new or changed feature to the point where it must act, and asserts that it did. The practice is old (Riot Games ran a blocker set of smoke tests on every new build of *League of Legends* and withheld a failing build from further testing; Riot, 2016) and engines ship the pieces for it (`references/unity.md`, `references/unreal.md`).

- **Every feature in the build has an expected signal**: a counter, a state query, a log line or a result-file field, with a minimum count. **Zero is a failure, not a quiet line.** Two builds of one prototype logged "0 shown" for a feature that never fired, because event rings compared world positions with a car transform in a shifted frame; nobody read the line. Print what fired (units spawned, rings shown, events started) next to what was expected.
- **The smoke must reach what it certifies.** A smoke that ends before the feature's trigger has certified nothing: an autodriven run stopped at 30 seconds, before the pursuit it was meant to cover, and the coverage criterion failed it correctly. The end condition of the run comes after the last expected signal, and a feature the run could not reach is reported as unreached, never as passed.
- **Read every run's log, including a person's drive logs, before the next build.** Unexpected exceptions and errors fail the run unless they are on a written expected list. A skipped check is counted apart from passed ones and never reads as a pass (`verification-and-critique`: "Skipped is not a pass").
- **Criteria are tiered, blocking or reported.** Blocking criteria (the build starts, each feature fired, no unexpected exception) gate the handover; reported ones (timings, a capture to look at) are measured and written down and never re-run on their own. Decide the tier before the run.
- **A FAIL stands.** Going on past a failed blocking criterion is a separate decision by whoever owns the build, recorded with its reason; it is never a re-run until green. A flaky check is recorded as flaky and fixed or demoted to reported; retries are for transport failures, not for wrong answers (`tool-and-action-discipline`: retries are for transport failures, never for wrong answers). A passing smoke is not repeated to confirm itself.
- **The artifact the smoke ran on is the artifact handed over.** Record its commit and build id; a rebuild after the smoke is a new, unsmoked build.
- **Replay the person's route as a regression.** Record a playtester's input or route and replay it on the next build, comparing state traces within tolerance bands unless the simulation is deterministic. A junction defect on one prototype was found only by diffing the places the owner had driven. Engines can record and replay input (`references/unity.md`); whether replay reproduces physics exactly on your engine version is unverified here.

Hand the build over with one screen (`references/smoke-and-handover.md`): what is in it, what the smoke covered, what is unverified, what to try first, and whether it is worth a session at all. A proposal that waited for a yes was once driven as if it were in the build, and a playtester asked what the prototype was; the note exists so neither happens.

## 3. Game gates: scripted scenarios that can fail

A game gate is a scripted run with a fixed seed, fixed physics timestep and fixed start state that ends in checkable outcomes: no rule violations counted, no vehicle stuck beyond a limit, a save that round-trips to identical state, every junction on a list resolved by the priority rule.

- **Outcomes are numbers and lists in a result file**, never "looks fine": counts, per-case verdicts, the worst offenders by name, and the denominator beside every count. "Zero violations" with "zero vehicles checked" is a failure. A result file also names what fired, which is how a feature that never ran reads as 0 and not as silence.
- **Every gate is shown to fail.** Keep one known-bad fixture per gate (a car forced through a stop sign, a corrupted save) and run it with the gate (`verification-and-critique`: "Before trusting a check, ask whether it could have come out the other way"). Mutation testing is the cheap proof for logic gates (`backend-developer`, generated-data-and-simulation reference). Neither exposes a check whose answer is fixed by how the world was built: if a road can only bend on the lattice lines it was draped on, "do the bends sit on the lattice" cannot say no. Ask first whether the check can fail at all.
- **Determinism is an input, not a hope.** Seed random sources, step at a fixed rate and make the clock injectable (`backend-developer`: "Randomness and time are injectable"). An input replay reproduces an outcome only when the simulation is deterministic; otherwise compare replays inside tolerance bands, and do not promise cross-machine determinism.
- **Load content the way the game does.** Rosters held in scene or editor data, settings, streaming and spawn paths: load them through the shipped path, or the gate tests a different game.
- **The author does not certify the gate.** Review the diff of the checks, not only of the code (`verification-and-critique`: "Check that the checker wasn't changed").

## 4. Real input, real frames, and what "headless" means

- **Drive the check through the path a player's input takes.** Calling a handler directly bypasses hit-testing, focus and ordering. For a driving or action game that means device events fed to the input system so the bindings, action maps and controller code run - never writing the vehicle's throttle field. An autodrive that writes controls directly is valid for a systems smoke and proves nothing about bindings; say which one ran. Isolated test fixtures may lack the game's own startup registrations (`references/unity.md`).
- **Put a real frame boundary after activation.** Enabling an object often does not run its start-up code at once; a check that acts in the same frame observes a state no player can reach (`frontend-developer`, timing reference, for the UI case).
- **Wait on a condition with a loud timeout, never a sleep.** "Until the vehicle has stopped", "until the tile is resident". Riot's engineers reported that sleep-based tests were fragile and behaved differently across hardware, and exposed no pure sleep in their framework.
- **Never write "headless" without its mode.** Three kinds of run answer different claims:

| Mode | What runs | Answers | Never use for |
|---|---|---|---|
| A. No graphics device | Simulation, physics, saves, logic | Behaviour rules, gates | Any visual claim; a graphics-API-specific path |
| B. Invisible with rendering | A real player build on a virtual display: a headless compositor on the real GPU, or a virtual X server with a software rasteriser | Does it draw, where, from which camera; smoke runs that need the render path | GPU timing; feel |
| C. Visible on the target | The build in a real window on the machine players use | Feel, GPU timing, final captures | - |

  Name the graphics API too: a feature that exists on one API only is verified on that API only. Recipes and open questions: `references/invisible-and-batch-runs.md`.
- **The log and the result file are the verdict; the exit code is a hint.** Give every scripted run its own log path. Fail on a non-zero exit, a missing or unparseable result file, and any logged exception or error not on the expected list. A run that crashed at start must not read as "no violations", and a runner told to quit early can exit cleanly having run nothing: check the result file's test count.
- **An invisible run stays invisible and isolated.** No window on the person's screen, sound muted and checked, its own save and settings folder (never the player's), a hard timeout, and the machine's heavy-job rules: announce it, take the shared lock, cap memory, never while someone is using the machine. Lowering a job's priority is not permission to run beside another heavy job; wait or ask (`tool-and-action-discipline`). Check your engine licence for what it says about automated and unattended runs before building CI on them.
- **Pin the build and the machine**: commit, build id, CPU, GPU or none, driver, OS. A result without them cannot be compared next week.

## 5. Capture: what a player would see

Whether a capture is the ground truth for "did it draw" is `visual-craft`'s rule; this is the game recipe.

- **The player's own camera at play speed is always one of the framings**, with a named resolution and state, taken from the smoked build, with the file named by those. A race circle visible only on the minimap and ring posts rendered giant both reached the owner's drive without any check having looked through the player camera.
- **More than one framing, more than one state.** Wide and close shots find different defects; the default state is not the only one (empty, full, damaged, night, rain, loading, error).
- **Capture matrix, not a screenshot.** The game axes: quality tier, time of day, weather, resolution the game ships at. UI aspect ratios are `frontend-developer`'s.
- **A stand-in capture path is not evidence about post-processing or renderer features.** A harness that bypasses the real render loop says nothing about them; check the real game view of the real build.
- **A still cannot certify motion.** Judge a loop, a spring or a camera move with frame-to-frame diffs and numeric traces (position, speed, contact), recorded in the same run as the capture, then a person.
- **Read state for "did it behave", captures for "does it draw".** A state query (positions, speeds, violation counters, lane ids) sees what a screenshot cannot. Make no efficacy claim for it: reliability and cost are not measured here.
- **Measure per class of place, not only in aggregate.** A fix can make plain road five times smoother and junction mouths worse; the average hides it. Report metrics per class (plain road, junction, indoor, night), and include the place the person actually drove.
- **A vision-model read, including your own, is a measurement, not taste** (`verification-and-critique`: "Vision-model reads of images are measurements, not taste"; `visual-craft`). The game protocol and its evidence: `references/vision-qa.md`.

## 6. Performance runs

- **Frame-time percentiles (p50, p95, p99, worst) on a fixed scripted route**, at the highest speed the game allows when streaming changed, with build type, graphics API, quality tier, resolution and machine named. An average hides every hitch.
- **Run on the weakest target, in a player build, not the editor.** Engine loading settings can have no effect in the editor, so loading behaviour is evidence only from a build (`references/unity.md`). Start with the shader and driver caches in the state a player's first run has: point the run at an empty cache directory; never delete the machine's own.
- **On a quiet machine.** A timing run beside another heavy job is not a measurement, and a timing run on someone's working machine is a heavy job that needs their OK.
- **One change per run**, against a baseline with the same route, build type and warm-up. Every budget is a hypothesis until a route run agrees.
- **Set the budget from percentiles measured on your target**, not from a figure borrowed from another platform. A draw-call target from a mobile headset is not a requirement for a desktop game.
- **Keep the raw frame log**, so another reader can re-derive the percentiles, and **log hitch causes, not only frames**: which system spent the time (loads, GC, compile), so "stutter" becomes a named event.
- **Software rendering says whether, not how fast.** GPU frame time can only be measured on the target; use CPU-side budgets in CI and GPU numbers from the target machine.

## 7. Playtest and feel are a separate loop

Metrics decide whether a change broke something; a person decides whether it feels right. A green gate does not stand in for a playtest, and a person is not asked to find what a gate could have found: the playtest follows a passed smoke and a handover note, and the person's drive is the gate for feel.

## Mistakes to flag

- A feature handed to a person that never ran in the integrated build; rig or compile-check results offered as the gate.
- A smoke that ended before the feature it certifies; a log line saying a feature fired zero times, left unread.
- A rung skipped silently: a physics-integration claim backed by a pure-logic test, a visual claim by a run with no rendering.
- "Headless" written without its mode; a verdict taken from the exit code; a skipped check counted as a pass.
- A gate never shown to fail; a check whose answer is guaranteed by construction; a count reported without its denominator.
- A FAIL answered by re-running until green; a rebuild after the smoke handed over as if it had been smoked.
- A scenario with unseeded randomness or a variable timestep compared against a golden output.
- The agent that wrote the checks also certifying them.
- A handler invoked directly where a real input path exists; an action in the frame an object was enabled; a fixed sleep.
- A single screenshot at the default state taken as proof; a stand-in capture path used for a post-processing claim; a metric reported in aggregate only.
- "Does this look right" asked of a model with no reference, heuristic or human judge on style.
- Frame-rate averages; a run on a fast machine, in the editor or beside another heavy job; a build and machine left unnamed.
- An invisible run that opens a window, plays sound or touches the player's save.

Depth: `references/smoke-and-handover.md`, `references/invisible-and-batch-runs.md`, `references/unity.md`, `references/unreal.md`, `references/vision-qa.md`.
