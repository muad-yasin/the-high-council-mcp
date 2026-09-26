# Timing, lifecycle, input, and viewport lore

Read before verifying any UI work live, before wiring anything lifecycle-, overlay-, or input-shaped, and whenever a check passes in a way that feels too easy. Most entries exist because an obvious-looking signal lied.

## 1. The doctrine, and where it stops

- **Lineage.** *Make illegal states unrepresentable* (Yaron Minsky) -> *Making Impossible States Impossible* (Richard Feldman) -> *Parse, Don't Validate* (Alexis King): rather than checking at every use site that a value is sane, shape the type or API so an insane value can't be constructed. The practitioner framing converges from the other side: a junior implements the happy path, a senior owns the lifecycle costs, and the tier above designs the convention so nobody downstream has to know.
- **The counter-argument worth holding** (Sean Goedecke's critique of the idea taken too far): hard constraints produce brittleness - a model that forbids a state the product later wants costs a refactor instead of an `if`. Constrain what has actually bitten you.
- **The ranking when a bug recurs:** (1) make the class unrepresentable; (2) a build-failing mechanical guard - catches rather than prevents, but never forgets; (3) a comment recording the fix - the worst option.

## 2. Timing and references

- **Activation doesn't run setup synchronously.** In many UI frameworks, showing/mounting an element schedules its setup for a later tick. An automated check that activates and clicks in the same call observes pre-setup state no real user can reach. Put a real frame boundary between them.
- **Force a layout pass before reading measured positions on first activation.** Layout is commonly deferred; a position or size read immediately after enabling can be stale or exactly zero.
- **Peer references resolve lazily at point of use.** A controller that disables/enables a sibling (a hidden screen's expensive renderer or camera, for instance) must resolve that sibling when it acts, not assume its own setup already ran - an early call silently no-ops and the hidden resource keeps costing every frame with zero visible symptom.
- **The real cost of an off-screen view is what it keeps doing, not what it contains.** A hidden-but-enabled renderer, camera, or canvas still pays its per-frame cost. Disable what's hidden, not just its content.
- **Anything positioned over moving or scrollable content reprojects every visible frame** from the live target position. A one-time position bake desyncs silently the moment the target, camera, or layout moves.
- **Live/runtime edits in editor or hot-reload sessions are transient.** Several verification passes on one project trusted positions that had been nudged live and silently reverted, masked because an unrelated anchor happened to still line up. Redo the accepted value as a persisted edit and re-verify from a fresh session.
- **Build/generate tooling can silently run stale code.** A UI builder or generator run while a rebuild is pending can produce output from the previous build while logging success. Verify the produced artifact's structure, not the log.

## 3. Lifecycle

- **Every lifecycle handler must be idempotent.** A resume handler that computed and offered a pending reward guarded against overwriting an *existing* offer but not against creating a *new* one - so ordinary repeated background/foreground cycles produced duplicate offers for one event. Before shipping, answer: what happens if this fires twice in a row, or fires when nothing changed?
- **Cached viewport and safe-area readings go stale.** A measurement cached early in startup, while the platform is still settling dimensions in stages (an immersive-mode transition finishing after first layout), builds UI for the wrong size and never corrects. It reproduces only on real hardware, not in a desktop preview window. Re-measure on the platform's own settling signal, or document why it's safe not to.
- **Device safe areas are often not reproducible in a plain editor preview.** Use a device simulator that models real cutouts; one correct fix was once reverted because the plain preview showed "no visible change."
- **On the web, use the viewport units and insets built for this:** `svh`/`lvh`/`dvh` instead of `100vh` (which ignores mobile browser chrome), and `env(safe-area-inset-*)` with `viewport-fit=cover` for notches - both are Baseline widely available. Size components with container queries rather than viewport breakpoints when the same component lives in containers of different widths. Check a newer feature's Baseline status before depending on it.
- **Prefer keep-out validation over reserved bands.** Reserving an unpainted band for notches and corners produced a recurring "black bar" defect on one project. Painting backgrounds to the true edge and running a build-failing check that no text or hit target sits inside named keep-out shapes removed the defect class and cost ordinary layouts nothing.

## 4. Input

- **Press-and-hold: every release path reaches one idempotent reset** - release, pointer exit or drag-off (which can fire without a release), a cancelled touch, app backgrounded mid-hold, element hidden while held. Keep the component pure input plumbing that raises one held-changed event.
- **Disabled states can erase explanations or read as breakage** - design-level lessons owned by `ux-design` (its `references/field-lessons.md`).
- **Two simultaneous inputs, a system interruption mid-gesture, and gesture navigation at screen edges** are five-minute manual checks worth running on a real device build before release.

## 5. Transient messages and scheduled content

- **A one-shot message and a periodic refresh sharing a render target race.** A "why that failed" message was written correctly, then wiped a second later by an unrelated timer refresh of the same panel. Making the message last longer is a band-aid; give it its own slot, or make the refresh skip while a message is pending.
- **Multiple triggers on one notification surface need a serialization policy designed up front** - minimum gap, which source pauses for which, what is guaranteed next. Several beats landing within seconds read as spam or a bug, and an important beat gets buried by a routine one.
- **A foreground trigger coordinating with an autonomous feed registers pending intent, then waits for a may-fire gate** (SKILL.md rule 10). Named failures: a torn-down trigger wedging the feed forever; an unbalanced clear un-pausing another trigger's claim.

## 6. Release-build-only failures

- **Production build transforms remove code only reached dynamically.** Minification, tree-shaking, and managed-code stripping can drop types or functions reached only by reflection, dynamic import, or deserialization - producing a crash that exists only in the release build, at the moment that path first runs. Cheapest detection: build a production-configured artifact locally and run a startup smoke test exercising every dynamic/deserialization path, plus an explicit preserve list for anything reached reflectively.
- **Profile rebuild/re-render cost once on low-end hardware before launch.** Development-machine timings say nothing about a budget device. Watch the frequently-updating regions first (live counters, tickers, long lists); splitting a frequently-changing element away from mostly-static siblings is the usual fix when one invalidates the other.
- **A small device matrix beats trying to test everything:** one tall modern flagship, one budget low-memory device, one older device near the minimum supported OS. Sweep shapes in a simulator first; reserve physical devices for performance and touch feel.
