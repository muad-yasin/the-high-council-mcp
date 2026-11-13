---
name: open-world-streaming
description: Designs and reviews streaming for large or open worlds on weak hardware - per-cell budgets in bytes, objects and draw calls, one load scheduler with a fixed main-thread budget, collision that is ready before a vehicle arrives, two coordinate frames (world and engine) with one conversion seam, first-use shader hitches, and the counters that show a stall. Use when a task adds or tunes tile or cell streaming, LOD or draw distance, collision loading, floating origin or large world coordinates, loading hitches, a quality tier for integrated GPUs, or a report that the game stutters while moving fast or that a feature works near the start but not after driving away. Not for authoring the assets or the data pipeline that makes the cells, and not for running or reporting performance measurements (verification-and-critique).
license: MIT
---

# Open-World Streaming and Low-End Performance

A streamed world fails in motion, not at rest. The frame that hitches is the one where a cell finishes loading, a shader compiles for the first time, a collider is cooked or the garbage collector runs; at speed the player crosses a cell in seconds, so each of those events has a deadline. It also fails quietly: a feature that works near the start and never fires a few kilometres away usually compared positions from two coordinate frames (section 4).

**Evidence and grades.** **D** = documented in a named primary source (`references/sources.md`); **I** = inferred, or own arithmetic shown; **F** = a field failure seen on one real project and told without its coordinates, which is an observation and not a measurement of anything general. Every budget below is a starting value to measure. The documentation facts were read against the Unity 6000.6 / URP 17.6 manuals (dates in `references/sources.md`); no rule here has been tested on a shipped streamed world of this skill's own, and the F rules come from one project.

**Engines.** The mechanisms are engine-general; setting names, defaults and links are Unity 6000.6 (`references/unity.md`). Nothing here is verified for Unreal or Godot. The questions to answer there are the equivalents of the main-thread integration budget, collision cooking, pipeline-state warm-up and large-coordinate handling.

**Long forms.** Many rules below are shortened: `references/rules-in-full.md` has each in full, by section.

**This skill owns:** streaming budgets and ceilings, the load scheduler, the runtime coordinate frames and rebasing, collision readiness, first-use hitches. **It hands off:** how cells and assets are produced, and the on-disk coordinate system and tile keys, to whatever pipeline produces them (the generator rules, `backend-developer`, apply there; engine-space frames and rebasing are decided here); running and reporting a measurement to `verification-and-critique`; whether a third-party licence permits a use to `research-and-sourcing`; scene-authoring performance under a fixed camera to `visual-craft`, whose line "LOD ladders earn their cost only when viewing distance varies" stops applying the moment the camera travels, which is this skill's case.

## 1. Budgets: bytes first, per cell, checked at build time

- **Decide first whether to stream at all.** Measure the whole world resident on the lowest target, in a Player build: memory and load time. If both fit with a margin, nothing measured calls for a streamer, so build none. If not, keep the small core everything needs resident and stream the rest (I).
- **Memory bandwidth is the first ceiling on an integrated GPU**, because CPU and GPU share one pool of RAM. Do the arithmetic for the target before choosing render features, then measure: sustained bandwidth is below the theoretical peak.
- **Choose the cheapest pipeline that does the job on the lowest tier.** In URP that means Forward rather than Deferred (D). Forward allows 9 realtime lights per object (D), so a night street with many lamps forces a decision on purpose: baked or emissive lamp light, or Forward+.
- **A feature that helps a CPU-bound machine can hurt a GPU-bound one.** GPU Resident Drawer adds some GPU work, and GPU occlusion culling can raise rendering time when little is occluded (D). Measure each on the weakest target before making it a default; do not adopt it because it is new.
- **Budget every cell, not the scene.** Set a ceiling per cell for bytes (on disk and in memory), objects, draw calls and triangles, and check every cell at build time against the ceiling and against the previous build, on the worst cell and the 99th-percentile cell, not the mean. A generator change that multiplies one class of cell shows up as a count long before it shows up as a hitch (F: over twelve times the control's triangles in one class, found only because someone counted). Triangles come last in the order of suspects, and still get a ceiling.

## 2. One scheduler, with a fixed main-thread budget

Loading uses worker threads, but integrating loaded data, uploading it, running awake and enable callbacks and activating objects happen on the main thread.

- **Engine time slices are ceilings, not costs, and they sit on different threads** (D for Unity's loading cap, upload slice and GC slice), so adding them up gives no frame budget. Budget the main thread from a profile of a top-speed drive: your integration, activation, collider attach, gameplay and collection must fit the frame with a margin.
- **One scheduler owns all load, integrate and unload work under a fixed per-frame main-thread budget.** Speed changes the lookahead, not the budget. Shrinking the budget at speed lengthens loads exactly when the crossing deadline is tightest (I). Systems request cells; they never start loads.
- **Integrate in pieces no larger than the budget, and time each kind.** One mesh or one object per step, a cursor that resumes next frame, and a separate maximum per kind of piece. F: a cell built in two big steps blew its step budget; splitting it into single meshes and objects showed which kinds were left (a windowed functional run, not a timing run).
- **The engine's loading knobs may not govern your streamer at all:** they govern the engine's own async loads and imported assets (D). A streamer that reads its own files and builds meshes through the Mesh API must time-slice its own integration. Take loading timings from a Player build, never from Editor play mode.
- **Serialise main-thread integration, not I/O.** Reads and decoding may run in parallel on workers; integration and activation take turns inside the budget. Size the lookahead from top speed: time per cell = cell size / speed (I). The slowest cell's request-to-ready time has to fit well inside that, with at least one ring ahead in the direction of travel.
- **A late cell has a defined policy, collision first.** The order is its collider, then its render mesh at the lowest LOD, then detail; if the collider is not ready, the game holds or slows the vehicle instead of letting it drive into empty space, and the event is counted (I). Write down before a run whether "zero late cells" is a blocking criterion or a reported one (`task-scoping`: criteria first).
- **Never run a global unload-unused-assets sweep while the player moves.** Unity documents it as walking the whole object hierarchy (D); its cost is not published, so treat it as a possibly long main-thread pause until measured (I).
- **Unload is work too.** Destroying meshes and objects takes main-thread time per item, so unloads go through the scheduler's budget like loads and are timed on their own.

## 3. Shape the content to be cheap to stream

- **Few objects per cell.** Scene activation time grows with the number of game objects, active or inactive alike (D, one vendor's measurement: direction reliable, numbers not portable). Merge static meshes per cell and material and keep hierarchies flat, at a size that still culls: a merged cell mesh is one big bounding volume. Measure draw calls and GPU time together.
- **Keep imported render meshes on the asynchronous upload path** (D; what makes a mesh eligible: `references/unity.md`). Meshes you build at runtime through the Mesh API are outside this path (I); free their CPU copy with `UploadMeshData(true)` once nothing needs it.
- **The drivable surface's collider is gameplay, not an approximation.** Keep collision on separate meshes (a collision mesh must be readable in a Player and a render mesh should not be; D) and simplify buildings and off-road freely. Under the wheels do not: the collider there must be at least as faithful as the render surface along the wheel paths (F: a road collider twice as coarse as the render road threw cars into the air at speed on a flat street). Check it by measuring the collider along driven lines, not by looking at the render. This skill owns the rule; asset-budget skills point here.
- **Cook collision ahead of time.** Runtime cooking spikes the CPU. Bake in a job and attach with exactly the same cooking options, or the bake is discarded (D; the API and the other reuse conditions: `references/unity.md`). Schedule bakes early and complete them late; completing right after scheduling blocks the main thread (I).
- **Build LOD and distance merging (HLOD) per cell.** Distance merging is your own build step: group cells in a quadtree, each level merging the meshes of its children (I). What Unity offers, and its licence question: the long form.
- **Baked occlusion data does not suit tile streaming:** Unity loads one occlusion data asset at a time (D), and geometry built at runtime is in no bake (I). Use street-canyon geometry, distance and HLOD, and measure GPU occlusion culling as a tier-up option.
- **Texture memory is a budget, not a default.** Textures that do not stream eat the same memory budget as mipmap streaming, and some kinds never stream (D). A facade atlas as a texture array, or instanced props drawn through a Graphics API, fall outside mipmap streaming: size those on purpose.

## 4. Large coordinates: two frames, one seam

A single-precision float has 0.5 m spacing between about 4.2 and 8.4 million metres, 2 mm at 25 km and 0.12 mm at 2 km (I, own float32 computation). Projected national grids put northings in the millions of metres, in that range; keep engine-space coordinates within a few kilometres of the origin.

- **Keep world positions in doubles, or in cell index plus local float**, and rebase the rendering origin every few kilometres: as a rule of thumb, an inference to tune, beyond about 2 km from the origin, with hysteresis, between physics sub-steps and never inside one. Rebasing by whole cells keeps every offset exact in float (I).
- **After the first rebase two frames exist.** The **world frame** never moves. The **engine frame** (floats) moves on every rebase. Name the frame in the type or field, convert in one place (`ToWorld` / `FromWorld`, nothing else converts), and do every distance, range and trigger check in one stated frame. On a rebase, move everything in the engine frame in one step between physics steps (rigid bodies, particles, trails, cached positions, the camera), then sync physics transforms; never move world-frame data. Test every position-consuming feature after a forced rebase away from the start: a feature near the start proves nothing here (F).
- **Simulation and replay state lives in the world frame**, or receives the shift event, so a run does not change with where a rebase happened (I; determinism).
- **URP has no camera-relative rendering that we could find** (I: no URP page found on 2026-10-04), so rendering precision is what forces the engine frame to stay near the origin.

## 5. Hitches you only see on first use

- **Shader and pipeline-state warm-up.** On Vulkan, DirectX 12 and Metal the driver can still compile a pipeline on first draw after a shader-variant warm-up (D). Record the pipeline states in a development build (Unity: `GraphicsStateCollection`) and replay them behind a loading screen (D; compute and ray-tracing shaders cannot be traced), then run the scripted route with cache-miss tracing on and treat a non-empty miss collection as a failed warm-up (I). The 6000.6 manual calls that API experimental: check your version.
- **Driver caches decide what a test shows.** Mesa keeps an on-disk shader cache (D): for a cold-start run, point it at a fresh empty directory or switch it off, rather than deleting anyone's cache. Every driver has one, and a timing run names which state it used.
- **Steady driving allocates nothing.** Per-frame GC allocation on a route is zero in steady driving: incremental collection can still fall back to a full blocking one (D), so any steady allocation is a future full collection.

## 6. Instrument the scheduler

Log per-frame load, integrate and upload milliseconds and a stall count, so "stutters" becomes "frame 8123 spent 7 ms integrating cell 4,12" (I). Count late cells, rebases and every streamed feature that should appear near the player, compare memory after a full loop of the route with memory at its start (a climb is something that never unloaded; I), and read the counters after each drive: a counter that reads 0 where it cannot be 0 is a defect, not a clean result (`verification-and-critique`: "A filter or gate that returns nothing is suspect").

## Mistakes to flag

- A streamer built before measuring whether the whole world fits on the lowest target.
- Rendering features adopted because they are new, with no run on the weakest target.
- A budget in triangles with no byte, object or draw-call ceiling behind it, or per-cell counts never compared with the previous build.
- Loads started by individual systems instead of one scheduler; several integrations in flight at once.
- Engine loading knobs tuned for a streamer that does not use engine loads; loading timings taken in Editor play mode.
- Engine time slices added up as if they were one thread's cost.
- Readable render meshes, or collision cooked at runtime on the main thread.
- A simplified collider under a drivable surface; a collider judged by the render.
- Large per-cell object counts, deep hierarchies, or per-object scripts on streamed props; or one huge merged mesh per cell with no culling check.
- Float world positions kept far from the origin; positions from two frames compared without conversion; a rebase that misses a cached position.
- A late cell with no policy, or a streamed feature whose counter nobody read.
- A global unused-asset unload during play.
- First-use shader or pipeline compiles discovered on the player's machine instead of a loading screen.
- A driver cache deleted for a cold test, or a timing quoted without saying whether the cache was cold or warm.
- A vendor's mobile numbers quoted as if they were measurements of this game.

Depth: `references/rules-in-full.md`, `references/unity.md` (the engine settings, where each is documented, dated), `references/sources.md` (primary links, version, date read).
