# Unity: the engine-specific facts behind `game-verification`

*Dated: Unity 6000.6 manual pages and package manuals read on 2026-10-04 (D); rows marked D(h) were read by a research helper on 2026-10-01 and not repeated (D as reported); P is practice on one prototype; I is inferred. Nothing here was run by this skill's authors on 6000.6 except where marked P. Re-check any row against the manual for your version before relying on it.*

## Batch mode, logs and exit codes

- **`-nographics`: the graphics device is not initialised** (D). It "doesn't allow you to bake GI" because Enlighten real-time GI needs a GPU for its Meta Pass; whether progressive CPU baking is also blocked is not stated (D(h), I). Output logs are turned off in this mode, so name a log file with `-logFile` (`-` writes to the console) (D). A `-batchmode` player "doesn't display anything or accept user input" (D), so an in-build smoke injects input events or replays a trace (below).
- **Give every scripted run its own `-logFile`.** A run with no log and no result file cannot be read.
- **`-quit` with `-runTests` ends the Editor before in-progress tests complete**; the Test Framework says `-quit` is not supported while tests are running (D). A CI script passing both can exit cleanly after running nothing: check the result file's test count.
- **Exit codes are not a verdict.** An unhandled exception in batch-mode script code makes the Editor exit with code 1 (D). The Test Framework states "there is currently no common definition for exit codes reported by individual Unity components under test" (D). A test fails if Unity logs a message other than a regular log or warning (Test Framework 1.5, D). A **player** that logs an exception in a callback may keep running (I, one forum thread), and its exit code is whatever the game passes to `Application.Quit`, so a player smoke parses its log and result file.
- **Unity CLI `unity test`** documents exit code 8 for failed tests, 6 for other failures and 7 for an unreachable service or Editor (D(h), CLI reference and beta notes). Read it against your installed CLI version.
- **Play-mode tests on a built player:** `-testPlatform` with a build target runs "Play mode tests that run on a Player built for the specified platform" (D, 6000.6 Test Framework command line).
- **Assert on the log:** `LogAssert.Expect` fails a test if an expected message does not appear (D, Test Framework 1.5 API).

## Input and frames

- **`InputTestFixture` starts from "a blank, default-initialized version of the Input System"** and does not have the custom registrations a project performs at startup (D, Input System 1.19 Testing page). A fixture can therefore pass while the real bindings never ran; an in-build smoke is what proves them.
- **Record and replay input:** `InputEventTrace` can write event traces to files or streams, load them back and replay recorded streams (D, Input System 1.19 Events page). Whether replay reproduces your physics exactly on 6000.6 is unverified (I).
- **Activation timing:** activating a GameObject calls `Awake` and `OnEnable` at once; `Start` is called on the frame the script is enabled, just before its first `Update` (D, 6000.6 ScriptReference). Wait one real frame after activation before acting.
- **Enter Play Mode settings change what a repeated run sees.** The 6000.6 manual documents "Reload Scene only" (no domain reload) as the default, and the 6.6 What's New says that is the default **for new projects**; what an upgraded project has is not stated (D(h)). Static state therefore may or may not reset between play-mode runs: read the project's `EditorSettings.asset` before relying on either.

## Performance

- **Performance Testing package 3.5:** a development player is always built when tests run through the Test Framework; it suggests one quality level, VSync off, and "remove camera and run in batchmode if you are not measuring rendering"; its compatibility table ends at 2023.2, so its use on 6000.6 is unverified (D, 2026-10-04). Compare development builds with development builds, never with a release build.
- **Loading settings can be inert in the editor.** `Application.backgroundLoadingPriority` is documented as having no effect in the Editor, only in a built player (D, 6000.6 `Application.backgroundLoadingPriority` page, read 2026-10-04). Time loading in a player build.
- **API-specific render paths.** On the 6000.6 pages, the GPU Resident Drawer needs Forward+ or Deferred+, and the Batch Renderer Group manual lists Linux with Vulkan only (D(h), 2026-10-01). A run forced onto a different graphics API may not exercise those paths; say which API ran.

## Test hooks and build symbols

- **`DEVELOPMENT_BUILD` is deprecated in 6.6 (warning UAC0009) and becomes a hard compile error in 6.8** (D(h), 6.6 upgrade guide). If a test hook is gated on it, move the gate to a project-defined scripting symbol (I) and keep the hook out of release builds.
- **Unity CLI and Pipeline package** (D 2026-10-04 for the walkthrough; D(h) for dates): the CLI is a standalone binary, experimental; release notes reached beta.11 on 2026-09-22. The Pipeline package's runtime server can drive a running build through a Runtime Pipeline Manager component with "Enable in builds" ticked, which is a vendor route to query and drive state in a build; it needs Unity 6.0 or later. Unity deprecated the in-editor MCP server of its AI Assistant package in favour of the CLI's built-in one, and says third-party MCP packages are not affected (D(h)). Whether to adopt it is the project owner's decision after a trial on their own project.
- **Hosted CI:** the open-source `game-ci` test-runner action documents `unityVersion: auto` as reading the project's version file; the "auto" failure applies when testing a Unity package (D, game.ci docs read 2026-10-04). It also documents a licence-return step for professional licences. Its caching and speed claims are the vendor's own.
- **Editor platform support:** the Unity Editor officially supports Ubuntu 22.04 and 24.04; other Linux distributions are unofficial (D(h), 2026-10-01).
