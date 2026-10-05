# Sources for open-world-streaming

Unity pages are the 6000.6 manual and scripting API (pages "Built on: 2026-10-03"), URP 17.6 settings from the 6000.6 `urp/` section, HDRP 17.6. Base for Unity rows: `https://docs.unity3d.com/6000.6/Documentation/`. "Read" is the date the page text was read as raw text; where only one date is given, nothing was re-read later. Grades: **D** documented in the named source, **I** inferred or own arithmetic. A claim is only as dated as its row.

| Claim | Source (path under the base, unless a full URL) | Read | Grade |
|---|---|---|---|
| Per-priority integration caps (2, 4, 10, 50 ms), default BelowNormal; governs Resources/AssetBundle/scene async loads; no effect in the Editor; platform overrides | `ScriptReference/Application-backgroundLoadingPriority.html` | 2026-10-05 | D |
| Async upload time slice (1 to 33 ms, render thread, time reallocated when idle) | `ScriptReference/QualitySettings-asyncUploadTimeSlice.html` | 2026-10-05 | D |
| Async upload buffer (2 to 2047 MB, auto-resize at a cost) | `ScriptReference/QualitySettings-asyncUploadBufferSize.html` | 2026-10-05 | D |
| Incremental GC slice 3 ms is a guideline; idle-time use with VSync or target frame rate; full collection under pressure | `ScriptReference/Scripting.GarbageCollector-incrementalTimeSliceNanoseconds.html` | 2026-10-05 | D |
| Incremental GC default on; too many reference changes fall back to a full collection; write barriers; unsupported on web | `Manual/performance-incremental-garbage-collection.html` | 2026-10-05 | D |
| Async upload eligibility for meshes and textures (read/write, Resources, blend shapes, bone weights, quads, mesh compression Off, Android LZ4) | `Manual/LoadingTextureandMeshData-make-compatible.html` | 2026-10-05 | D |
| BakeMesh: thread-safe, Read/Write required in a Player, reuse conditions, EntityId overload | `ScriptReference/Physics.BakeMesh.html` | 2026-10-05 | D |
| Cooking options, cleaning and welding preconditions | `ScriptReference/MeshColliderCookingOptions.html`, `Manual/prepare-mesh-for-mesh-collider.html` | 2026-10-05 | D |
| Pre-bake collision meshes on player build | `ScriptReference/PlayerSettings-bakeCollisionMeshes.html` | 2026-10-05 | D |
| Procedural meshes: MeshData from any thread, one call for many; `UploadMeshData(true)` | `ScriptReference/Mesh.AllocateWritableMeshData.html`, `ScriptReference/Mesh.UploadMeshData.html` | 2026-10-05 | D |
| `Resources.UnloadUnusedAssets`: hierarchy walk, static variables examined, script stack not examined | `ScriptReference/Resources.UnloadUnusedAssets.html` | 2026-10-05 | D |
| InstantiateAsync: integration and awake on the main thread | `ScriptReference/Object.InstantiateAsync.html` | 2026-10-05 | D |
| `SetIntegrationTimeMS` exists on the async instantiate operation | `ScriptReference/AsyncInstantiateOperation.SetIntegrationTimeMS.html` | 2026-10-05 (page fetched; only existence relied on) | D |
| `allowSceneActivation = false`: progress stops at 0.9 and the operation queue stalls | `ScriptReference/AsyncOperation-allowSceneActivation.html` | 2026-10-05 | D |
| AssetBundle LZMA must be decompressed whole to read an asset; LZ4 is chunk-based | `Manual/assetbundles-compression-format.html` | 2026-10-05 | D |
| Shader variant warm-up caveat on DX12, Vulkan, Metal | `ScriptReference/ShaderVariantCollection.WarmUp.html` | 2026-10-05 | D |
| Pipeline-state tracing and warming: development builds only, per-API collections, compute and ray tracing not traceable, DX11/GL/GLES/WebGL fall back, manual calls it experimental | `Manual/shader-pso-introduction.html`, `Manual/shader-pso-trace.html`, `Manual/shader-pso-trace-warming.html` | 2026-10-05 | D |
| `GraphicsStateCollection`: `WarmUpProgressively`, `cacheMissCollection` | `ScriptReference/Rendering.GraphicsStateCollection.html` | 2026-10-05 | D |
| Forward versus Deferred; lights per object (9 / unlimited / unlimited opaque, 9 transparent) | `Manual/urp/rendering-paths-comparison.html` | 2026-10-05 | D |
| URP performance configuration (depth and opaque texture, shadow cascades, MSAA) | `Manual/urp/configure-for-better-performance.html` | 2026-10-05 | D |
| URP asset: render scale filters; FSR needs shader model 4.5 and stays active at 1.0; STP forces TAA | `Manual/urp/universalrp-asset.html`, `Manual/urp/stp/stp-upscaler.html` (STP: compute, shader model 5.0, no OpenGL ES) | 2026-10-05 | D |
| GPU Resident Drawer: Forward+ or Deferred+, compute APIs except OpenGL ES and visionOS, Enlighten off, no MaterialPropertyBlocks, at most 128 materials | `Manual/urp/gpu-resident-drawer.html` | 2026-10-05 | D |
| GPU Resident Drawer adds GPU work; disabling static batching helps | `Manual/urp/gpu-resident-drawer-performance.html` | 2026-10-05 | D |
| GPU occlusion culling needs the drawer; bounding-sphere approximation; may raise rendering time | `Manual/urp/gpu-culling.html` | 2026-10-05 | D |
| BatchRendererGroup: needs SRP Batcher, "Keep All" variants, unsafe code; no frustum or occlusion culling of its instances; platform list has Linux with Vulkan only | `Manual/batch-renderer-group-how.html`, `Manual/batch-renderer-group-getting-started.html` | 2026-10-05 | D |
| Mesh LOD: import-time, at least 256 triangles, LOD0 under static batching / particles / VFX, `forceMeshLod` for `RenderMeshInstanced`, poor on disconnected pieces | `Manual/lod/mesh-lod-introduction.html`, `Manual/lod/mesh-lod-generator.html` | 2026-10-05 | D |
| Baked occlusion data: one asset loads at a time | `Manual/occlusion-culling-scene-loading.html` | 2026-10-05 | D |
| Mipmap streaming: 512 MB default budget; unsupported for terrain textures, texture arrays, cubemap arrays, 3D textures; lowest mip without a Mesh Filter | `Manual/class-QualitySettings.html`, `Manual/TextureStreaming-introduction.html`, `Manual/TextureStreaming-configure.html` (the budget also counts textures that do not stream: confirmed in `TextureStreaming-configure.html`) | 2026-10-05 | D |
| Camera-relative rendering is documented for HDRP | https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.6/manual/Camera-Relative-Rendering.html | 2026-10-05 | D |
| No camera-relative rendering page for URP | Absence only: no page found by search on 2026-10-04 | 2026-10-04 | I |
| Mesa shader cache variables and defaults | https://docs.mesa3d.org/envvars.html (`MESA_SHADER_CACHE_DIR`, `MESA_SHADER_CACHE_DISABLE`, `MESA_SHADER_CACHE_MAX_SIZE`) | 2026-10-05 | D |
| Vendor HLOD package: version 0.0.1-preview, minimum Unity 2018.3, Unity Companion License, last commit 2023-02-15 | https://github.com/Unity-Technologies/HLODSystem (`com.unity.hlod/package.json`, `com.unity.hlod/LICENSE.md` read 2026-10-05; last-commit date from the GitHub API read 2026-10-04) | 2026-10-05 | D |
| Scene activation time grows linearly with GameObject count, active or inactive; CPU-readable meshes activate slowly; few roots help | Meta, "Avoiding Hitches When Loading Scenes in Unity", https://developers.meta.com/horizon/blog/avoiding-hitches-when-loading-scenes-in-unity/ (2021-12-15; Quest 2, Unity 2020.3.8f1). Page text read in a browser; its numbers are in charts, not in the text | 2026-10-04 | D for that vendor's own measurement on that device; I for any transfer to PC |
| Vehicles fell through the world when an origin shift was split across a frame | Unity Discussions, "Draw distance: what's the plan? HLOD, imposters, floating origin", https://discussions.unity.com/t/draw-distance-whats-the-plan-hlod-imposters-floatingorigin/792027 (practitioner post, 2020; read through a summarising fetch tool, not as raw text) | 2026-10-04 | I |
| Bandwidth arithmetic: 2400 MT/s x 8 B x 2 channels = 38.4 GB/s; / 60 = 640 MB per frame; one channel halves it | Own arithmetic from theoretical peak; sustained bandwidth is lower and unmeasured here | 2026-10-04 | I |
| float32 spacing: about 0.5 m at 5.8e6 m, about 2 mm at 25,000 m, about 0.12 mm at 2,000 m | Own computation (numpy float32 spacing) | 2026-10-04 | I |
| Crossing time: 300 km/h = 83.3 m/s; a 256 m cell is crossed in 3.07 s | Own arithmetic | 2026-10-04 | I |

**Field failures (grade F in the skill).** Four rules rest on failures seen on one real project, told without their coordinates: positions from two frames compared without conversion (section 4), a road collider coarser than the render road (section 3), a generator change that multiplied one class of cell more than twelve times over its control (section 1), and a streamer's integration step far above its budget until work was split per mesh and per object. They are observations from one game, not published measurements.

**Not verified here.** Any budget on a real streamed world: no build, game or profiler was run for this skill. The per-frame cost split on any target machine; the memory factor for readable meshes; whether runtime-built meshes use the async upload path; whether `Graphics.RenderMeshInstanced` draws gain from GPU Resident Drawer; AssetBundle per-bundle overhead and "LZ4 loads like uncompressed"; whether a desktop Linux Unity player persists its own pipeline cache; the Unity-specific Vulkan versus OpenGL behaviour on Mesa. These are what the first performance spike of a project should measure.
