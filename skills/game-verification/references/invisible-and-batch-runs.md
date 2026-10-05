# Invisible runs, batch mode and game CI

*Graded: documented (D, primary page read), practice (P, one prototype on one Linux desktop with a GPU), inferred (I). Engine-specific flags and pages are in `unity.md` and `unreal.md`.*

## The three modes, in detail

| Mode | What it is | What it can answer | What it cannot |
|---|---|---|---|
| A. No graphics device | A build or editor run that never initialises a GPU | Simulation, physics, scripted scenarios, saves, traffic and rule logic on a machine with no display | Rendering, shaders, UI layout, GPU timing, baked lighting. Nothing draws, so nothing in it is evidence for a visual claim |
| B. Invisible with rendering | A real player build, rendering for real, on a display nobody sees | Does it draw, where, from which camera; smoke runs that need the real render path and scene wiring; captures for "does it draw" | GPU timing on the player's machine; feel; anything the virtual display or software rasteriser changes |
| C. Visible on the target | The build in a real window on the machine players use | Feel, GPU timing, final captures | Nothing is hidden, so it cannot run unattended on someone's working machine |

Mode B has two recipes (P: both worked on one Linux desktop; a GPU-less server is **not verified**):

1. **A headless compositor on the real GPU.** The build renders on the real GPU into a display no one sees. Fast, and the render path is the real one.
2. **A virtual X server with a software rasteriser** (the community recipe for smoke-test screenshots on machines with no GPU; forum evidence from 2016 to 2019 and one 2026 anecdote, I). It says whether something draws and where, not how fast the real GPU draws it. Whether it renders a streamed scene on your engine version is an open question below.

Whichever you use, set the resolution and frame rate low enough that the run is cheap, record both with the result, and name the graphics API: a feature documented for one API only (Unity's GPU-driven batching paths, for example) is verified on that API only.

## Rules for any invisible run

- **It stays invisible.** No window on the person's screen, no sound (muted at the run's audio setting and checked, because a silent-by-intent run once played audio on the owner's speakers), a hard timeout, and a watchdog that ends a hung run.
- **It stays isolated.** Its own user-data folder for saves and settings, so it can never touch the player's save or a newer build's. Older builds' launchers should be given their own folder for the same reason.
- **It is a heavy job.** Announce it, take the machine's shared lock if there is one, cap its memory, and never start it while someone is playing or working. Do not start one beside another heavy job because it is niced; wait or ask.
- **Its log and result file are the evidence.** Give each run its own log path; fail on a missing, empty or unparseable result; count skipped checks apart from passed ones.
- **Software rendering is not a timing instrument.** GPU frame time on a low-end target can only be measured on that machine. In CI, use CPU-side budgets (streaming time, physics step, allocations); take GPU numbers on the target.

## Game CI, kept short

- Hosted CI for a game needs the engine's licence handled for unattended use; read the engine's own terms for automated callers before building on it. Vendor CI actions change; read their current documentation rather than a remembered one (`unity.md` has the one corrected fact this skill carried).
- Pin the build and machine on every result (SKILL.md section 4).
- Prefer reading **state** (object trees, counters, check results) over reading pixels for "did it behave". An in-game test hook that returns state or frame-time percentiles for a scenario is the pattern; make it absent from release builds. A 2026 vendor write-up recommends the same (single vendor, no efficacy claim made here).

## Open questions to settle on your first run (record what you watched)

1. Does a dedicated-server or no-graphics build of your game run the gates, and with which log and result files?
2. Does a virtual display with a software rasteriser render a capture of a streamed scene on a GPU-less server, and does a shader cache change the result between runs?
3. Do exit codes and result files agree on a deliberately crashed scenario?
4. What does the first performance run on your weakest target show for p99 on the fixed route, and how far does it move between two runs of the same build? (Measure the spread once to know how big a difference means anything; it is not a standing confirmation run.)
