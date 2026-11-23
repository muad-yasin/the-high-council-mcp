# Capture, performance and run-mode detail

`SKILL.md` states the rules below in short form, and this file has the long form of each. One differs: for a proof of motion, `SKILL.md` section 5 names the fixed settings and the viewing before the report, and the line below names the frame-to-frame diffs to judge it with.

## The three kinds of run

- **Never write "headless" without its mode.** Three kinds of run answer different claims:

| Mode | What runs | Answers | Never use for |
|---|---|---|---|
| A. No graphics device | Simulation, physics, saves, logic | Behaviour rules, gates | Any visual claim; a graphics-API-specific path |
| B. Invisible with rendering | A real player build on a virtual display: a headless compositor on the real GPU, or a virtual X server with a software rasteriser | Does it draw, where, from which camera; smoke runs that need the render path | GPU timing; feel |
| C. Visible on the target | The build in a real window on the machine players use | Feel, GPU timing, final captures | - |

  Name the graphics API too: a feature that exists on one API only is verified on that API only. Recipes and open questions: `references/invisible-and-batch-runs.md`.

## Input, waits and invisible runs

- **Drive the check through the path a player's input takes.** Calling a handler directly bypasses hit-testing, focus and ordering. For a driving or action game that means device events fed to the input system so the bindings, action maps and controller code run - never writing the vehicle's throttle field. An autodrive that writes controls directly is valid for a systems smoke and proves nothing about bindings; say which one ran. Isolated test fixtures may lack the game's own startup registrations (`references/unity.md`).
- **Wait on a condition with a loud timeout, never a sleep.** "Until the vehicle has stopped", "until the tile is resident". Riot's engineers reported that sleep-based tests were fragile and behaved differently across hardware, and exposed no pure sleep in their framework.
- **An invisible run stays invisible and isolated.** No window on the person's screen, sound muted and checked, its own save and settings folder (never the player's), a hard timeout, and the machine's heavy-job rules: announce it, take the shared lock, cap memory, never while someone is using the machine. Lowering a job's priority is not permission to run beside another heavy job; wait or ask (`tool-and-action-discipline`). Check your engine licence for what it says about automated and unattended runs before building CI on them.

## The smoke gate: notes

- The practice is old (Riot Games ran a blocker set of smoke tests on every new build of *League of Legends* and withheld a failing build from further testing; Riot, 2016) and engines ship the pieces for it (`references/unity.md`, `references/unreal.md`).
- **Criteria are tiered, blocking or reported** (the rule is `verification-and-critique`'s: "Criteria come in two tiers, and the verdict never bends"; this skill applies it to the smoke card). Blocking criteria (the build starts, each feature fired, no unexpected exception) gate the handover; reported ones (timings, a capture to look at) are measured and written down and never re-run on their own. Decide the tier before the run.
- **A FAIL stands.** Going on past a failed blocking criterion is a separate decision by whoever owns the build, recorded with its reason; it is never a re-run until green. A flaky check is recorded as flaky and fixed or demoted to reported; retries are for transport failures, not for wrong answers (`tool-and-action-discipline`: retries are for transport failures, never for wrong answers). A passing smoke is not repeated to confirm itself.
- Engines can record and replay input (`references/unity.md`); whether replay reproduces physics exactly on your engine version is unverified here.
- For Unreal or Godot, the questions to answer are how the test runner reports results, what a batch or dedicated-server run can execute, and how a capture is triggered (`references/unreal.md`).

## Game gates and replay: single sentences

- Mutation testing is the cheap proof for logic gates (`backend-developer`, generated-data-and-simulation reference).
- A result file also names what fired, which is how a feature that never ran reads as 0 and not as silence.
- Ask first whether the check can fail at all.
- A replayed route is compared by state traces within tolerance bands unless the simulation is deterministic.

## Capture: what a player would see

- **The player's own camera at play speed is always one of the framings**, with a named resolution and state, taken from the smoked build, with the file named by those. A race circle visible only on the minimap and ring posts rendered giant both reached the owner's drive without any check having looked through the player camera.
- **More than one framing, more than one state.** Wide and close shots find different defects; the default state is not the only one (empty, full, damaged, night, rain, loading, error).
- **Capture matrix, not a screenshot.** The game axes: quality tier, time of day, weather, resolution the game ships at. UI aspect ratios are `frontend-developer`'s.
- **A stand-in capture path is not evidence about post-processing or renderer features.** A harness that bypasses the real render loop says nothing about them; check the real game view of the real build.
- **A still cannot certify motion.** Judge a loop, a spring or a camera move with frame-to-frame diffs and numeric traces (position, speed, contact), recorded in the same run as the capture, then a person.
- **Read state for "did it behave", captures for "does it draw".** A state query (positions, speeds, violation counters, lane ids) sees what a screenshot cannot. Make no efficacy claim for it: reliability and cost are not measured here.
- **Measure per class of place, not only in aggregate.** A fix can make plain road five times smoother and junction mouths worse; the average hides it. Report metrics per class (plain road, junction, indoor, night), and include the place the person actually drove.
- **A vision-model read, including your own, is a measurement, not taste** (`verification-and-critique`: "Vision-model reads of images are measurements, not taste"; `visual-craft`). The game protocol and its evidence: `references/vision-qa.md`.

## Performance runs

- **Frame-time percentiles (p50, p95, p99, worst) on a fixed scripted route**, at the highest speed the game allows when streaming changed, with build type, graphics API, quality tier, resolution and machine named. An average hides every hitch.
- **Run on the weakest target, in a player build, not the editor.** Engine loading settings can have no effect in the editor, so loading behaviour is evidence only from a build (`references/unity.md`). Start with the shader and driver caches in the state a player's first run has: point the run at an empty cache directory; never delete the machine's own.
- **On a quiet machine.** A timing run beside another heavy job is not a measurement, and a timing run on someone's working machine is a heavy job that needs their OK.
- **One change per run**, against a baseline with the same route, build type and warm-up. Every budget is a hypothesis until a route run agrees.
- **Set the budget from percentiles measured on your target**, not from a figure borrowed from another platform. A draw-call target from a mobile headset is not a requirement for a desktop game.
- **Keep the raw frame log**, so another reader can re-derive the percentiles, and **log hitch causes, not only frames**: which system spent the time (loads, GC, compile), so "stutter" becomes a named event.
- **Software rendering says whether, not how fast.** GPU frame time can only be measured on the target; use CPU-side budgets in CI and GPU numbers from the target machine.
